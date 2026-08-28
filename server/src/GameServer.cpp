#include "GameServer.hpp"

#include <chrono>
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <thread>
#include <limits>
#include <unordered_set>
#include <map>
#include <nlohmann/json.hpp>
#include <type_traits>

#include "client/Client.hpp"
#include "ecs/components.hpp"
#include "ecs/GunFactory.hpp"

#ifndef SERVER_SOURCE_DIR
#define SERVER_SOURCE_DIR "."
#endif
#ifndef SERVER_MAP_DIR
#define SERVER_MAP_DIR "../client/public/maps/graybox-arena"
#endif

namespace {
protocol::Weapon protocolWeapon(const Components::Gun& gun) {
    if (gun.itemType == ItemType::GUN_RIFLE) return protocol::Weapon::Rifle;
    if (gun.itemType == ItemType::GUN_SHOTGUN) return protocol::Weapon::Shotgun;
    return protocol::Weapon::None;
}

protocol::Weapon protocolWeapon(ItemType weapon) {
    if (weapon == ItemType::GUN_RIFLE) return protocol::Weapon::Rifle;
    if (weapon == ItemType::GUN_SHOTGUN) return protocol::Weapon::Shotgun;
    return protocol::Weapon::None;
}

std::uint64_t secondsToTicks(float seconds) {
    return static_cast<std::uint64_t>(
        std::ceil(seconds * static_cast<float>(GameServer::kTicksPerSecond)));
}

protocol::ScoreChange scoreRow(std::uint64_t tick, entt::entity player,
                               const Components::Score& score,
                               std::int16_t delta) {
    return {static_cast<std::uint32_t>(tick),
            static_cast<std::uint32_t>(player), score.points, delta,
            score.kills, score.deaths};
}

std::filesystem::path mapDirectory() {
    if (const char* configured = std::getenv("MAP_PACKAGE_DIR")) return configured;
    if (const char* root = std::getenv("MAP_PACKAGE_ROOT")) {
        const char* id = std::getenv("SERVER_MAP_ID");
        if (!id || id[0] == '\0') throw std::runtime_error("SERVER_MAP_ID is required with MAP_PACKAGE_ROOT");
        return std::filesystem::path(root) / id;
    }
    return SERVER_MAP_DIR;
}
}

std::string GameServer::resolveGameConfigPath(const char* environmentValue) {
    if (environmentValue && environmentValue[0] != '\0')
        return environmentValue;
    return std::string(SERVER_SOURCE_DIR) + "/game_config.json";
}

GameServer::GameServer()
    : GameServer(resolveGameConfigPath(std::getenv("GAME_CONFIG_PATH"))) {}

GameServer::GameServer(const std::string& gameConfigPath)
    : m_entityManager(*this), m_physicsWorld() {
    metricsSink_ = [](const std::string& line) { std::cout << line << '\n'; };
    m_gameConfig = GameConfig::loadFromFile(gameConfigPath);
    m_mapPackage = MapPackageLoader::load(mapDirectory());
    if (const char* expected = std::getenv("SERVER_MAP_ID"))
        if (expected[0] != '\0' && m_mapPackage.manifest.mapId != expected)
            throw std::runtime_error("configured SERVER_MAP_ID does not match loaded package");
    mapBody_ = m_physicsWorld.addStaticCollision(m_mapPackage.collision);
    phaseEndsAtTick_ = secondsToTicks(m_gameConfig.combat.roundSeconds);
    std::cout << "Loaded map " << m_mapPackage.manifest.mapId << " ("
              << m_mapPackage.collision.vertices.size() << " collision vertices, "
              << m_mapPackage.manifest.spawnPoints.size() << " spawns)\n";
}

const MapSpawnPoint& GameServer::selectSpawnPoint(
    entt::entity spawningPlayer) const {
    if (m_mapPackage.manifest.spawnPoints.empty())
        throw std::runtime_error("loaded map has no spawn points");

    const auto& registry = m_entityManager.getRegistry();
    const auto players = registry.view<Components::Transform3D,
                                       Components::PlayerLife>();
    std::size_t liveOpponents = 0U;
    for (const auto player : players)
        if (player != spawningPlayer &&
            !players.get<Components::PlayerLife>(player).dead)
            ++liveOpponents;

    const MapSpawnPoint* best = &m_mapPackage.manifest.spawnPoints.front();
    const MapSpawnPoint* visibleDuelSpawn = nullptr;
    float bestScore = -std::numeric_limits<float>::infinity();
    float visibleDuelDistance = std::numeric_limits<float>::infinity();
    for (const auto& spawn : m_mapPackage.manifest.spawnPoints) {
        float nearest = 10000.0F;
        float score = 0.0F;
        bool nearbyVisibleEnemy = false;
        for (const auto player : players) {
            if (player == spawningPlayer ||
                players.get<Components::PlayerLife>(player).dead)
                continue;
            const auto enemy =
                players.get<Components::Transform3D>(player).position;
            const float distance = glm::length(enemy - spawn.position);
            nearest = std::min(nearest, distance);
            const glm::vec3 eyeOffset{0.0F,
                                      m_gameConfig.movement.eyeHeight, 0.0F};
            const bool visible = !m_physicsWorld.staticRayBlocked(
                spawn.position + eyeOffset, enemy + eyeOffset);
            if (visible) {
                // Put the second joining player within clear sight of the first
                // so a fresh local match is immediately testable. Respawns and
                // matches with more players retain the safer distance scoring.
                if (spawningPlayer == entt::null && liveOpponents == 1U &&
                    distance >= 6.0F && distance < visibleDuelDistance) {
                    visibleDuelSpawn = &spawn;
                    visibleDuelDistance = distance;
                }
                score -= std::max(0.0F, 24.0F - distance);
                if (distance < 12.0F) nearbyVisibleEnemy = true;
            }
        }
        score += nearest;
        if (nearbyVisibleEnemy) score -= 10000.0F;
        if (score > bestScore) {
            bestScore = score;
            best = &spawn;
        }
    }
    return visibleDuelSpawn ? *visibleDuelSpawn : *best;
}

void GameServer::run() {
    using Clock = std::chrono::steady_clock;
    const auto pollInterval =
        std::chrono::duration_cast<Clock::duration>(
            std::chrono::duration<double>(FixedStepAccumulator::kStepSeconds));
    auto last = Clock::now();
    auto wake = last + pollInterval;
    for (;;) {
        const auto now = Clock::now();
        const std::chrono::duration<double> elapsed = now - last;
        last = now;
        {
            std::lock_guard<std::mutex> lock(m_gameMutex);
            advanceSimulation(elapsed.count());
            updateHeartbeat(elapsed.count());
        }
        std::this_thread::sleep_until(wake);
        wake += pollInterval;
        if (Clock::now() > wake + pollInterval) wake = Clock::now();
    }
}

void GameServer::consumeQueuedValidatedInput() {
    auto& registry = m_entityManager.getRegistry();
    std::unordered_set<std::uint32_t> consumedClients;
    std::unordered_set<std::uint32_t> consumedPlayers;

    const auto queuedAtStart = queuedInputs_.size();
    for (std::size_t index = 0; index < queuedAtStart; ++index) {
        auto queued = std::move(queuedInputs_.front());
        queuedInputs_.pop_front();
        Client* client = nullptr;
        if (queued.clientId) {
            const auto found = m_clients.find(*queued.clientId);
            if (found != m_clients.end()) client = found->second;
        }

        const bool validEntity =
            registry.valid(queued.player) &&
            registry.all_of<Components::PlayerInput>(queued.player);
        const bool validOwner =
            !queued.clientId ||
            (client && client->welcomed() && client->m_entity == queued.player);
        if (!validEntity || !validOwner) {
            if (client) client->markInputDequeued();
            continue;
        }

        const auto playerKey = static_cast<std::uint32_t>(queued.player);
        if (consumedPlayers.count(playerKey) != 0U ||
            (queued.clientId &&
             consumedClients.count(*queued.clientId) != 0U)) {
            queuedInputs_.push_back(std::move(queued));
            continue;
        }

        registry.replace<Components::PlayerInput>(queued.player,
                                                   queued.input);
        consumedPlayers.insert(playerKey);
        if (queued.clientId) {
            consumedClients.insert(*queued.clientId);
            client->markInputDequeued();
            if (queued.sequence) client->markInputProcessed(*queued.sequence);
        }
    }
}

void GameServer::updateMatchAndPlayerState(float) {
    if (m_currentTick >= phaseEndsAtTick_) {
        if (matchPhase_ == protocol::MatchPhase::Active)
            transitionToIntermission();
        else if (matchPhase_ == protocol::MatchPhase::Intermission)
            resetRound();
    }
    auto& registry = m_entityManager.getRegistry();
    const auto players = registry.view<Components::PlayerInput,
                                       Components::WeaponInventory,
                                       Components::PlayerLife>();
    for (const auto entity : players) {
        auto& input = players.get<Components::PlayerInput>(entity);
        auto& inventory = players.get<Components::WeaponInventory>(entity);
        const auto& life = players.get<Components::PlayerLife>(entity);
        if (!life.dead && matchPhase_ == protocol::MatchPhase::Active &&
            input.switchSlot >= 0) {
            const auto previous = inventory.activeSlot;
            if (inventory.setActiveSlot(
                    static_cast<std::uint8_t>(input.switchSlot)) &&
                previous != inventory.activeSlot) {
                auto& oldGun = inventory.slots[previous].gun;
                oldGun.reloadEndTick = 0;
                oldGun.reloadRemaining = 0.0F;
            }
        }
        input.switchSlot = -1;
    }
}

void GameServer::updateCharacterMotors(float delta) {
    auto& registry = m_entityManager.getRegistry();
    const auto view = registry.view<Components::Transform3D,
                                    Components::Velocity3D,
                                    Components::CharacterController,
                                    Components::PlayerInput,
                                    Components::PlayerLife>();
    for (const auto entity : view) {
        auto& input = view.get<Components::PlayerInput>(entity);
        auto& controller = view.get<Components::CharacterController>(entity);
        if (view.get<Components::PlayerLife>(entity).dead) {
            m_physicsWorld.setCharacterVelocity(controller.adapterId,
                                                {0.0F, 0.0F, 0.0F});
            input.jump = false;
            continue;
        }
        if (matchPhase_ != protocol::MatchPhase::Active) {
            m_physicsWorld.setCharacterVelocity(controller.adapterId,
                                                {0.0F, 0.0F, 0.0F});
            input.jump = false;
            continue;
        }
        const float forward = -input.movement.y;
        const float right = input.movement.x;
        const float sine = std::sin(input.yaw);
        const float cosine = std::cos(input.yaw);
        const float speed = m_gameConfig.movement.groundSpeed;
        const glm::vec3 desired{(sine * forward + cosine * right) * speed,
                                0.0F,
                                (-cosine * forward + sine * right) * speed};
        m_physicsWorld.updateCharacter(controller.adapterId, delta, desired,
                                       input.jump);
        input.jump = false;
    }
}

void GameServer::recordPlayerHistory() {
    HistoryFrame frame;
    frame.tick = static_cast<std::uint32_t>(m_currentTick);
    const auto& registry = m_entityManager.getRegistry();
    const auto players = registry.view<Components::Transform3D,
                                       Components::PlayerLife>();
    frame.players.reserve(players.size_hint());
    const float radius = m_gameConfig.movement.capsuleRadius;
    const float halfHeight = m_gameConfig.movement.capsuleHalfHeight;
    for (const auto player : players) {
        const auto position =
            players.get<Components::Transform3D>(player).position;
        frame.players.push_back(HistoricalPlayer{
            player, position,
            {{position.x, position.y + radius, position.z},
             {position.x, position.y + radius + 2.0F * halfHeight,
              position.z},
             radius},
            players.get<Components::PlayerLife>(player).dead});
    }
    std::sort(frame.players.begin(), frame.players.end(),
              [](const HistoricalPlayer& first,
                 const HistoricalPlayer& second) {
                  return static_cast<std::uint32_t>(first.entity) <
                         static_cast<std::uint32_t>(second.entity);
              });
    history_.push_back(std::move(frame));
    const std::size_t maxFrames =
        static_cast<std::size_t>(std::ceil(
            static_cast<double>(m_gameConfig.combat.maxLagCompensationMs) *
            static_cast<double>(kTicksPerSecond) / 1000.0)) + 1U;
    while (history_.size() > std::max<std::size_t>(2U, maxFrames))
        history_.pop_front();
}

std::uint32_t GameServer::acceptedHistoryTick(std::uint32_t requested) const {
    if (history_.empty()) return static_cast<std::uint32_t>(m_currentTick);
    return CombatGeometry::clampHistoryTick(
        requested, history_.front().tick, history_.back().tick);
}

const GameServer::HistoryFrame* GameServer::findHistoryFrame(
    std::uint32_t requested, std::uint32_t& accepted) const {
    if (history_.empty()) return nullptr;
    accepted = acceptedHistoryTick(requested);
    for (auto frame = history_.rbegin(); frame != history_.rend(); ++frame) {
        if (!CombatGeometry::tickBefore(accepted, frame->tick)) return &*frame;
    }
    return &history_.front();
}

protocol::ActionRejectReason GameServer::startReload(Components::Gun& gun,
                                                      Components::Ammo& ammo) {
    if (gun.reloadEndTick != 0)
        return protocol::ActionRejectReason::AlreadyReloading;
    if (gun.ammoInMag >= gun.magazineSize)
        return protocol::ActionRejectReason::MagazineFull;
    if (ammo.get(gun.ammoType) <= 0)
        return protocol::ActionRejectReason::NoReserve;
    const auto ticks = std::max<std::uint64_t>(1U,
                                               secondsToTicks(gun.reloadTime));
    gun.reloadEndTick = m_currentTick + ticks;
    gun.reloadRemaining = static_cast<float>(ticks) /
                          static_cast<float>(kTicksPerSecond);
    return protocol::ActionRejectReason::None;
}

void GameServer::completeReloads(entt::entity player) {
    auto& registry = m_entityManager.getRegistry();
    auto& inventory = registry.get<Components::WeaponInventory>(player);
    auto& ammo = registry.get<Components::Ammo>(player);
    for (auto& slot : inventory.slots) {
        auto& gun = slot.gun;
        if (gun.reloadEndTick == 0) continue;
        if (m_currentTick < gun.reloadEndTick) {
            gun.reloadRemaining = static_cast<float>(gun.reloadEndTick -
                                                     m_currentTick) /
                                  static_cast<float>(kTicksPerSecond);
            continue;
        }
        const int needed = gun.magazineSize - gun.ammoInMag;
        gun.ammoInMag += ammo.take(gun.ammoType, needed);
        gun.reloadEndTick = 0;
        gun.reloadRemaining = 0.0F;
        inventory.dirty = true;
    }
}

void GameServer::fireWeapon(entt::entity shooter, Components::Gun& gun,
                            const Components::PlayerInput& input) {
    auto& registry = m_entityManager.getRegistry();
    auto& life = registry.get<Components::PlayerLife>(shooter);
    gun.ammoInMag -= gun.ammoPerShot;
    const std::uint64_t cadence = std::max<std::uint64_t>(
        1U, static_cast<std::uint64_t>(std::ceil(
                static_cast<double>(kTicksPerSecond) / gun.fireRate)));
    gun.nextFireTick = m_currentTick + cadence;
    life.spawnProtectionRemaining = 0.0F;
    const std::uint32_t shotId = nextShotId_++;
    if (nextShotId_ == 0U) nextShotId_ = 1U;
    ++combatMetrics_.shotsFired;

    std::uint32_t acceptedTick = 0;
    const HistoryFrame* history = findHistoryFrame(input.clientTick, acceptedTick);
    if (history && acceptedTick != input.clientTick) ++combatMetrics_.historyClamps;
    glm::vec3 shooterPosition =
        registry.get<Components::Transform3D>(shooter).position;
    if (history) {
        for (const auto& historical : history->players)
            if (historical.entity == shooter)
                shooterPosition = historical.position;
    }
    const float cosinePitch = std::cos(input.pitch);
    const glm::vec3 aim = glm::normalize(glm::vec3{
        std::sin(input.yaw) * cosinePitch, std::sin(input.pitch),
        -std::cos(input.yaw) * cosinePitch});
    const glm::vec3 eye = shooterPosition +
                          glm::vec3{0.0F, m_gameConfig.movement.eyeHeight, 0.0F};
    const glm::vec3 origin = eye + aim * gun.barrelLength;
    std::vector<glm::vec3> pelletDirections;
    std::vector<protocol::Vec3> pelletEndPositions;
    pelletDirections.reserve(static_cast<std::size_t>(gun.pellets));
    pelletEndPositions.reserve(static_cast<std::size_t>(gun.pellets));
    for (int pellet = 0; pellet < gun.pellets; ++pellet) {
        const glm::vec3 direction = CombatGeometry::spreadDirection(
            aim, gun.spread, m_gameConfig.combat.serverSeed,
            static_cast<std::uint32_t>(shooter), shotId,
            static_cast<std::uint32_t>(pellet));
        const glm::vec3 end = origin + direction * gun.range;
        pelletDirections.push_back(direction);
        pelletEndPositions.push_back({end.x, end.y, end.z});
    }

    emitReliable(std::nullopt, protocol::ShotConfirmed{
        static_cast<std::uint32_t>(m_currentTick),
        static_cast<std::uint32_t>(shooter), input.inputSequence,
        input.fireActionId, shotId, protocolWeapon(gun),
        {origin.x, origin.y, origin.z},
        std::move(pelletEndPositions)});
    if (input.fireActionId != 0U)
        emitReliable(shooter, protocol::ActionResult{
            static_cast<std::uint32_t>(m_currentTick), input.fireActionId,
            protocol::ActionKind::Fire, true, protocol::ActionRejectReason::None,
            protocolWeapon(gun), static_cast<std::uint16_t>(gun.ammoInMag),
            static_cast<std::uint16_t>(registry.get<Components::Ammo>(shooter).get(gun.ammoType))});

    if (!history) return;
    std::map<std::uint32_t, float> damageByTarget;

    for (int pellet = 0; pellet < gun.pellets; ++pellet) {
        const glm::vec3& direction =
            pelletDirections[static_cast<std::size_t>(pellet)];
        const auto worldHit =
            m_physicsWorld.castStaticRay(origin, direction, gun.range);
        float nearestDistance = worldHit ? worldHit->distance : gun.range;
        const HistoricalPlayer* nearestPlayer = nullptr;
        std::optional<CombatGeometry::RayHit> playerHit;
        for (const auto& candidate : history->players) {
            if (candidate.entity == shooter || candidate.dead) continue;
            if (!registry.valid(candidate.entity) ||
                !registry.all_of<Components::Health,
                                 Components::PlayerLife>(candidate.entity) ||
                registry.get<Components::Health>(candidate.entity).current <=
                    0.0F ||
                registry.get<Components::PlayerLife>(candidate.entity).dead)
                continue;
            const auto hit = CombatGeometry::rayCapsule(
                origin, direction, candidate.capsule, nearestDistance);
            if (hit && hit->distance < nearestDistance) {
                nearestDistance = hit->distance;
                nearestPlayer = &candidate;
                playerHit = hit;
            }
        }
        if (nearestPlayer && playerHit) {
            ++combatMetrics_.pelletHits;
            emitReliable(std::nullopt, protocol::Impact{
                static_cast<std::uint32_t>(m_currentTick), shotId,
                static_cast<std::uint8_t>(pellet),
                {playerHit->position.x, playerHit->position.y,
                 playerHit->position.z},
                {playerHit->normal.x, playerHit->normal.y,
                 playerHit->normal.z},
                protocol::ImpactMaterial::Player});
            damageByTarget[static_cast<std::uint32_t>(nearestPlayer->entity)] +=
                gun.damage;
        } else if (worldHit) {
            emitReliable(std::nullopt, protocol::Impact{
                static_cast<std::uint32_t>(m_currentTick), shotId,
                static_cast<std::uint8_t>(pellet),
                {worldHit->position.x, worldHit->position.y,
                 worldHit->position.z},
                {worldHit->normal.x, worldHit->normal.y, worldHit->normal.z},
                protocol::ImpactMaterial::World});
        }
    }
    for (const auto& [rawTarget, damage] : damageByTarget) {
        const auto target = static_cast<entt::entity>(rawTarget);
        pendingDamage_.push_back(
            PendingDamage{shooter, target, damage, gun.itemType});
    }
}

void GameServer::updateWeaponsAndFire() {
    auto& registry = m_entityManager.getRegistry();
    const auto players = registry.view<Components::PlayerInput,
                                       Components::PlayerLife,
                                       Components::WeaponInventory,
                                       Components::Ammo,
                                       Components::PlayerCombat>();
    for (const auto player : players) {
        auto& input = players.get<Components::PlayerInput>(player);
        auto& life = players.get<Components::PlayerLife>(player);
        auto& combat = players.get<Components::PlayerCombat>(player);
        completeReloads(player);
        auto& inventory = players.get<Components::WeaponInventory>(player);
        auto& gun = inventory.getActive().gun;
        auto& ammo = players.get<Components::Ammo>(player);
        const auto actionResult = [&](std::uint32_t actionId,
                                      protocol::ActionKind kind,
                                      protocol::ActionRejectReason reason) {
            if (actionId == 0U) actionId = input.inputSequence;
            emitReliable(player, protocol::ActionResult{
                static_cast<std::uint32_t>(m_currentTick), actionId, kind,
                reason == protocol::ActionRejectReason::None, reason,
                protocolWeapon(gun), static_cast<std::uint16_t>(gun.ammoInMag),
                static_cast<std::uint16_t>(ammo.get(gun.ammoType))});
        };
        if (input.reloadRequested) {
            const auto reason = matchPhase_ != protocol::MatchPhase::Active
                                    ? protocol::ActionRejectReason::MatchInactive
                                : life.dead
                                    ? protocol::ActionRejectReason::Dead
                                    : startReload(gun, ammo);
            if (input.reloadActionId != 0U)
                actionResult(input.reloadActionId, protocol::ActionKind::Reload,
                             reason);
        }
        if (matchPhase_ == protocol::MatchPhase::Active && !life.dead) {
            const bool wantsFire = input.mouseIsDown &&
                                   (gun.automatic || !combat.triggerWasDown);
            if (wantsFire) {
                protocol::ActionRejectReason reason = protocol::ActionRejectReason::None;
                if (gun.reloadEndTick != 0) reason = protocol::ActionRejectReason::AlreadyReloading;
                else if (m_currentTick < gun.nextFireTick) reason = protocol::ActionRejectReason::Cadence;
                else if (gun.ammoInMag < gun.ammoPerShot) reason = protocol::ActionRejectReason::NoAmmo;
                if (reason == protocol::ActionRejectReason::None) {
                    fireWeapon(player, gun, input);
                    inventory.dirty = true;
                } else {
                    ++combatMetrics_.rejectedFireAttempts;
                    if (input.fireActionId != 0U)
                        actionResult(input.fireActionId, protocol::ActionKind::Fire,
                                     reason);
                }
            }
        } else if (input.mouseIsDown) {
            ++combatMetrics_.rejectedFireAttempts;
            if (input.fireActionId != 0U)
                actionResult(input.fireActionId, protocol::ActionKind::Fire,
                             life.dead ? protocol::ActionRejectReason::Dead
                                       : protocol::ActionRejectReason::MatchInactive);
        }
        combat.triggerWasDown = input.mouseIsDown;
        input.reloadRequested = false;
        input.dirtyClick = false;
    }
}

void GameServer::resolvePendingDamage() {
    for (const auto& damage : pendingDamage_)
        applyDamage(damage.attacker, damage.target, damage.amount,
                    damage.weapon);
    pendingDamage_.clear();
}

bool GameServer::applyDamage(entt::entity attacker, entt::entity target,
                             float damage, ItemType weapon) {
    auto& registry = m_entityManager.getRegistry();
    if (!(std::isfinite(damage) && damage > 0.0F) ||
        !registry.valid(target) ||
        !registry.all_of<Components::Health, Components::PlayerLife>(target))
        return false;
    auto& life = registry.get<Components::PlayerLife>(target);
    if (life.dead || life.spawnProtectionRemaining > 0.0F) return false;
    auto& health = registry.get<Components::Health>(target);
    if (health.current <= 0.0F) return false;
    const float before = health.current;
    health.decrement(damage, attacker);
    life.killer = registry.valid(attacker) ? attacker : entt::null;
    life.killingWeapon = weapon;
    const auto roundedDamage = static_cast<std::uint16_t>(std::clamp(
        std::lround(before - health.current), 0L, 65535L));
    protocol::Damage event{
        static_cast<std::uint32_t>(m_currentTick),
        life.killer == entt::null
            ? std::optional<std::uint32_t>{}
            : std::optional<std::uint32_t>{
                  static_cast<std::uint32_t>(life.killer)},
        static_cast<std::uint32_t>(target), roundedDamage,
        static_cast<std::uint16_t>(std::clamp(
            std::lround(health.current), 0L, 65535L))};
    emitReliable(target, event);
    if (life.killer != entt::null && life.killer != target)
        emitReliable(life.killer, event);
    return before != health.current;
}

void GameServer::resolveHealthAndDeaths() {
    auto& registry = m_entityManager.getRegistry();
    const auto view = registry.view<Components::Health, Components::PlayerLife,
                                    Components::CharacterController,
                                    Components::Score>();
    for (const auto entity : view) {
        auto& health = view.get<Components::Health>(entity);
        auto& life = view.get<Components::PlayerLife>(entity);
        if (!life.dead && health.current <= 0.0F) {
            life.dead = true;
            life.deathTick = m_currentTick;
            life.respawnRemaining = m_gameConfig.combat.respawnSeconds;
            life.spawnProtectionRemaining = 0.0F;
            life.deathPublished = true;
            auto& victimScore = view.get<Components::Score>(entity);
            ++victimScore.deaths;
            m_physicsWorld.setCharacterVelocity(
                view.get<Components::CharacterController>(entity).adapterId,
                {0.0F, 0.0F, 0.0F});
            emitReliable(std::nullopt, protocol::Death{
                static_cast<std::uint32_t>(m_currentTick),
                static_cast<std::uint32_t>(entity),
                life.killer == entt::null
                    ? std::optional<std::uint32_t>{}
                    : std::optional<std::uint32_t>{
                          static_cast<std::uint32_t>(life.killer)},
                protocolWeapon(life.killingWeapon)});
            emitReliable(std::nullopt,
                         scoreRow(m_currentTick, entity, victimScore, 0));
            if (life.killer != entt::null && life.killer != entity &&
                registry.valid(life.killer) &&
                registry.all_of<Components::Score>(life.killer)) {
                auto& killerScore = registry.get<Components::Score>(life.killer);
                ++killerScore.kills;
                ++killerScore.points;
                emitReliable(std::nullopt,
                             scoreRow(m_currentTick, life.killer,
                                      killerScore, 1));
                if (killerScore.kills >= m_gameConfig.combat.scoreLimit &&
                    matchPhase_ == protocol::MatchPhase::Active)
                    transitionToIntermission();
            }
        }
    }
}

void GameServer::advanceRespawns(float delta) {
    auto& registry = m_entityManager.getRegistry();
    const auto view = registry.view<Components::Transform3D,
                                    Components::Velocity3D,
                                    Components::Health,
                                    Components::PlayerLife,
                                    Components::CharacterController>();
    for (const auto entity : view) {
        auto& life = view.get<Components::PlayerLife>(entity);
        if (!life.dead) {
            life.spawnProtectionRemaining =
                std::max(0.0F, life.spawnProtectionRemaining - delta);
            continue;
        }
        if (life.deathTick == m_currentTick) continue;
        const std::uint64_t elapsedTicks = m_currentTick - life.deathTick;
        const std::uint64_t respawnTicks =
            secondsToTicks(m_gameConfig.combat.respawnSeconds);
        life.respawnRemaining = elapsedTicks >= respawnTicks
                                    ? 0.0F
                                    : m_gameConfig.combat.respawnSeconds -
                                          static_cast<float>(elapsedTicks) * delta;
        if (elapsedTicks < respawnTicks) continue;
        const auto& spawn = selectSpawnPoint(entity);
        auto& transform = view.get<Components::Transform3D>(entity);
        auto& velocity = view.get<Components::Velocity3D>(entity);
        auto& controller = view.get<Components::CharacterController>(entity);
        transform.position = spawn.position;
        transform.rotation =
            glm::angleAxis(spawn.yaw, glm::vec3{0.0F, 1.0F, 0.0F});
        velocity.linear = {0.0F, 0.0F, 0.0F};
        m_physicsWorld.setCharacterPosition(controller.adapterId, spawn.position);
        m_physicsWorld.setCharacterVelocity(controller.adapterId, velocity.linear);
        auto& health = view.get<Components::Health>(entity);
        health.current = health.max;
        health.dirty = true;
        life.dead = false;
        life.killer = entt::null;
        life.killingWeapon = ItemType::ITEM_NONE;
        life.deathPublished = false;
        life.spawnProtectionRemaining =
            m_gameConfig.combat.spawnProtectionSeconds;
        auto& inventory = registry.get<Components::WeaponInventory>(entity);
        inventory.slots[0].gun = GunFactory::makeRifle(m_gameConfig);
        inventory.slots[1].gun = GunFactory::makeShotgun(m_gameConfig);
        inventory.activeSlot = 0;
        inventory.dirty = true;
        auto& ammo = registry.get<Components::Ammo>(entity);
        ammo.amounts.fill(0);
        ammo.add(AmmoType::LIGHT, m_gameConfig.loadout.rifleReserveAmmo);
        ammo.add(AmmoType::SHELL, m_gameConfig.loadout.shotgunReserveAmmo);
        emitReliable(std::nullopt, protocol::Respawn{
            static_cast<std::uint32_t>(m_currentTick),
            static_cast<std::uint32_t>(entity),
            {spawn.position.x, spawn.position.y, spawn.position.z}, spawn.yaw});
    }
}

protocol::MatchState GameServer::matchState() const {
    return {matchPhase_, roundNumber_,
            static_cast<std::uint32_t>(phaseEndsAtTick_)};
}

void GameServer::emitReliable(std::optional<entt::entity> recipient,
                              ReliableGameEvent event) {
    ++observability_.reliableEvents;
    if (reliableEventHook_) reliableEventHook_(recipient, event);
    for (const auto& [id, client] : m_clients) {
        (void)id;
        if (!client || !client->welcomed() || client->closing()) continue;
        if (recipient && client->m_entity != *recipient) continue;
        std::visit(
            [client](const auto& message) {
                using Message = std::decay_t<decltype(message)>;
                if constexpr (std::is_same_v<Message, protocol::ShotConfirmed>)
                    client->queueShotConfirmed(message);
                else if constexpr (std::is_same_v<Message, protocol::Impact>)
                    client->queueImpact(message);
                else if constexpr (std::is_same_v<Message, protocol::Damage>)
                    client->queueDamage(message);
                else if constexpr (std::is_same_v<Message, protocol::Death>)
                    client->queueDeath(message);
                else if constexpr (std::is_same_v<Message, protocol::Respawn>)
                    client->queueRespawn(message);
                else if constexpr (std::is_same_v<Message, protocol::ScoreChange>)
                    client->queueScoreChange(message);
                else if constexpr (std::is_same_v<Message, protocol::RoundTransition>)
                    client->queueRoundTransition(message);
                else if constexpr (std::is_same_v<Message, protocol::ActionResult>)
                    client->queueActionResult(message);
            },
            event);
    }
}

void GameServer::transitionToIntermission() {
    if (matchPhase_ != protocol::MatchPhase::Active) return;
    matchPhase_ = protocol::MatchPhase::Ended;
    phaseEndsAtTick_ = m_currentTick;
    emitReliable(std::nullopt, protocol::RoundTransition{
        static_cast<std::uint32_t>(m_currentTick),
        protocol::RoundTransitionKind::Ended, matchState()});
    matchPhase_ = protocol::MatchPhase::Intermission;
    phaseEndsAtTick_ = m_currentTick +
                       secondsToTicks(m_gameConfig.combat.intermissionSeconds);
    emitReliable(std::nullopt, protocol::RoundTransition{
        static_cast<std::uint32_t>(m_currentTick),
        protocol::RoundTransitionKind::Intermission, matchState()});
}

void GameServer::resetPlayerForRound(entt::entity player,
                                     const MapSpawnPoint& spawn) {
    auto& registry = m_entityManager.getRegistry();
    auto& transform = registry.get<Components::Transform3D>(player);
    auto& velocity = registry.get<Components::Velocity3D>(player);
    auto& controller = registry.get<Components::CharacterController>(player);
    transform.position = spawn.position;
    transform.rotation =
        glm::angleAxis(spawn.yaw, glm::vec3{0.0F, 1.0F, 0.0F});
    velocity.linear = {0.0F, 0.0F, 0.0F};
    m_physicsWorld.setCharacterPosition(controller.adapterId, spawn.position);
    m_physicsWorld.setCharacterVelocity(controller.adapterId, velocity.linear);
    auto& health = registry.get<Components::Health>(player);
    health.current = health.max;
    health.attacker = entt::null;
    health.dirty = true;
    auto& life = registry.get<Components::PlayerLife>(player);
    life = Components::PlayerLife{};
    life.spawnProtectionRemaining =
        m_gameConfig.combat.spawnProtectionSeconds;
    registry.get<Components::Score>(player) = Components::Score{};
    auto& inventory = registry.get<Components::WeaponInventory>(player);
    inventory = Components::WeaponInventory{};
    inventory.addItem(GunFactory::makeRifle(m_gameConfig));
    inventory.addItem(GunFactory::makeShotgun(m_gameConfig));
    auto& ammo = registry.get<Components::Ammo>(player);
    ammo.amounts.fill(0);
    ammo.add(AmmoType::LIGHT, m_gameConfig.loadout.rifleReserveAmmo);
    ammo.add(AmmoType::SHELL, m_gameConfig.loadout.shotgunReserveAmmo);
    registry.get<Components::PlayerInput>(player) = Components::PlayerInput{};
    registry.get<Components::PlayerCombat>(player) = Components::PlayerCombat{};
}

void GameServer::resetRound() {
    if (matchPhase_ != protocol::MatchPhase::Intermission) return;
    ++roundNumber_;
    if (roundNumber_ == 0U) roundNumber_ = 1U;
    matchPhase_ = protocol::MatchPhase::Active;
    phaseEndsAtTick_ =
        m_currentTick + secondsToTicks(m_gameConfig.combat.roundSeconds);
    auto& registry = m_entityManager.getRegistry();
    const auto view = registry.view<Components::EntityBase,
                                    Components::Transform3D,
                                    Components::Velocity3D,
                                    Components::CharacterController,
                                    Components::Health,
                                    Components::PlayerLife,
                                    Components::Score,
                                    Components::WeaponInventory,
                                    Components::Ammo,
                                    Components::PlayerInput,
                                    Components::PlayerCombat>();
    std::vector<entt::entity> players;
    for (const auto entity : view)
        if (view.get<Components::EntityBase>(entity).type == PLAYER)
            players.push_back(entity);
    std::sort(players.begin(), players.end(), [](entt::entity first,
                                                 entt::entity second) {
        return static_cast<std::uint32_t>(first) <
               static_cast<std::uint32_t>(second);
    });
    for (std::size_t index = 0; index < players.size(); ++index) {
        const auto previousPoints =
            registry.get<Components::Score>(players[index]).points;
        const auto spawnIndex =
            (static_cast<std::size_t>(roundNumber_) + index) %
            m_mapPackage.manifest.spawnPoints.size();
        resetPlayerForRound(players[index],
                            m_mapPackage.manifest.spawnPoints[spawnIndex]);
        emitReliable(std::nullopt,
                     scoreRow(m_currentTick, players[index],
                              registry.get<Components::Score>(players[index]),
                              static_cast<std::int16_t>(std::clamp(
                                  -previousPoints,
                                  static_cast<std::int32_t>(
                                      std::numeric_limits<std::int16_t>::min()),
                                  static_cast<std::int32_t>(
                                      std::numeric_limits<std::int16_t>::max())))));
    }
    history_.clear();
    nextShotId_ = 1U;
    emitReliable(std::nullopt, protocol::RoundTransition{
        static_cast<std::uint32_t>(m_currentTick),
        protocol::RoundTransitionKind::Reset, matchState()});
    emitReliable(std::nullopt, protocol::RoundTransition{
        static_cast<std::uint32_t>(m_currentTick),
        protocol::RoundTransitionKind::Started, matchState()});
}

void GameServer::publishEventsAndSnapshots() {
    if (m_currentTick % (kTicksPerSecond / kSnapshotsPerSecond) != 0) return;
    if (snapshotHook_) snapshotHook_(m_currentTick);
    for (const auto& entry : m_clients) entry.second->writeGameState();
    if (networkFlushHook_) networkFlushHook_();
}

void GameServer::simulateOneTick() {
    using MetricsClock = std::chrono::steady_clock;
    const auto tickStarted = MetricsClock::now();
    if (m_currentTick == std::numeric_limits<std::uint64_t>::max())
        throw std::overflow_error("authoritative simulation tick overflow");
    ++m_currentTick;
    constexpr float delta = 1.0F / static_cast<float>(kTicksPerSecond);

    // Authoritative order: input, match/player state, motors, Jolt,
    // weapon/fire, damage/death, respawns, then publication.
    consumeQueuedValidatedInput();
    updateMatchAndPlayerState(delta);
    updateCharacterMotors(delta);
    const auto joltStarted = MetricsClock::now();
    m_physicsWorld.step(delta);
    observability_.observeJolt(
        std::chrono::duration<double, std::milli>(MetricsClock::now() -
                                                  joltStarted)
            .count());

    auto& registry = m_entityManager.getRegistry();
    const auto characters = registry.view<Components::Transform3D,
                                          Components::Velocity3D,
                                          Components::CharacterController>();
    for (const auto entity : characters) {
        auto& controller = characters.get<Components::CharacterController>(entity);
        const auto state = m_physicsWorld.characterState(controller.adapterId);
        characters.get<Components::Transform3D>(entity).position = state.position;
        characters.get<Components::Velocity3D>(entity).linear = state.velocity;
        controller.grounded = state.grounded;
    }
    recordPlayerHistory();
    updateWeaponsAndFire();
    resolvePendingDamage();
    resolveHealthAndDeaths();
    advanceRespawns(delta);
    m_entityManager.removeEntities();
    publishEventsAndSnapshots();
    observability_.observeTick(
        std::chrono::duration<double, std::milli>(MetricsClock::now() -
                                                  tickStarted)
            .count());
    if (metricsSink_ && m_currentTick % (5U * kTicksPerSecond) == 0U)
        metricsSink_(observabilityJson());
}

std::size_t GameServer::advanceSimulation(double elapsedSeconds) {
    const auto steps = accumulator_.consume(
        elapsedSeconds, [this](double) { simulateOneTick(); });
    observability_.observeAdvance(steps, accumulator_.lastDroppedSeconds());
    return steps;
}

void GameServer::queueValidatedInput(
    entt::entity player, const Components::PlayerInput& input) {
    if (!(std::isfinite(input.movement.x) && std::isfinite(input.movement.y) &&
          std::isfinite(input.yaw) && std::isfinite(input.pitch)) ||
        glm::length(input.movement) > 1.0001F ||
        input.yaw < -3.14159265359F || input.yaw > 3.14159265359F ||
        input.pitch < -1.57079632679F || input.pitch > 1.57079632679F)
        throw std::invalid_argument("invalid authoritative player input");
    if (queuedInputs_.size() >= 2048U)
        throw std::length_error("authoritative input queue is full");
    queuedInputs_.push_back({std::nullopt, player, input, std::nullopt});
    observability_.observeQueuedInputs(queuedInputs_.size());
}

void GameServer::queueValidatedInput(
    std::uint32_t clientId, entt::entity player,
    const Components::PlayerInput& input, std::uint32_t sequence) {
    if (!(std::isfinite(input.movement.x) && std::isfinite(input.movement.y) &&
          std::isfinite(input.yaw) && std::isfinite(input.pitch)) ||
        glm::length(input.movement) > 1.0001F ||
        input.yaw < -3.14159265359F || input.yaw > 3.14159265359F ||
        input.pitch < -1.57079632679F || input.pitch > 1.57079632679F)
        throw std::invalid_argument("invalid authoritative player input");
    if (queuedInputs_.size() >= 2048U)
        throw std::length_error("authoritative input queue is full");
    queuedInputs_.push_back({clientId, player, input, sequence});
    observability_.observeQueuedInputs(queuedInputs_.size());
}

std::size_t GameServer::welcomedClientCount() const {
    return static_cast<std::size_t>(std::count_if(
        m_clients.begin(), m_clients.end(),
        [](const auto& entry) { return entry.second && entry.second->welcomed(); }));
}

protocol::EntityRecord GameServer::makeEntityRecord(
    entt::entity entity, entt::entity recipient) const {
    (void)recipient;
    const auto& registry = m_entityManager.getRegistry();
    if (!registry.valid(entity) ||
        !registry.all_of<Components::EntityBase, Components::Transform3D,
                         Components::Velocity3D,
                         Components::CharacterController,
                         Components::PlayerInput, Components::PlayerLife>(entity))
        throw std::invalid_argument("entity is not a replicated player");
    if (registry.get<Components::EntityBase>(entity).type != PLAYER)
        throw std::invalid_argument("entity record requires a player");

    const auto& transform = registry.get<Components::Transform3D>(entity);
    const auto& velocity = registry.get<Components::Velocity3D>(entity);
    const auto& controller =
        registry.get<Components::CharacterController>(entity);
    const auto& input = registry.get<Components::PlayerInput>(entity);
    const auto& life = registry.get<Components::PlayerLife>(entity);
    protocol::EntityRecord record{};
    record.entityId = static_cast<std::uint32_t>(entity);
    record.kind = protocol::EntityKind::Player;
    record.position = {transform.position.x, transform.position.y,
                       transform.position.z};
    record.velocity = {velocity.linear.x, velocity.linear.y,
                       velocity.linear.z};
    record.bodyYaw = input.yaw;
    record.aimPitch = input.pitch;
    record.grounded = controller.grounded;
    record.stateFlags = life.dead ? 1U : 0U;

    const auto* inventory =
        registry.try_get<Components::WeaponInventory>(entity);
    if (inventory) {
        record.equippedWeapon = protocolWeapon(inventory->getActive().gun);
        if (inventory->getActive().gun.reloadEndTick != 0U)
            record.stateFlags |= 4U;
    }

    return record;
}

protocol::EntityHandle GameServer::makeEntityHandle(entt::entity entity) const {
    return {static_cast<std::uint32_t>(entt::to_entity(entity)),
            static_cast<std::uint16_t>(entt::to_version(entity))};
}

protocol::PublicEntityState GameServer::makePublicEntityState(
    entt::entity entity) const {
    const auto legacy = makeEntityRecord(entity, entt::null);
    return {makeEntityHandle(entity), legacy.kind, legacy.position,
            legacy.velocity, legacy.bodyYaw, legacy.aimPitch,
            legacy.grounded, legacy.stateFlags, legacy.equippedWeapon};
}

protocol::LocalAuthoritativeState GameServer::makeLocalAuthoritativeState(
    entt::entity entity) const {
    const auto owner = makeEntityRecord(entity, entity);
    const auto& registry = m_entityManager.getRegistry();
    const auto* health = registry.try_get<Components::Health>(entity);
    const auto* inventory =
        registry.try_get<Components::WeaponInventory>(entity);
    const auto* ammo = registry.try_get<Components::Ammo>(entity);
    if (!health || !inventory || !ammo)
        throw std::logic_error("local authoritative state is incomplete");
    const auto& gun = inventory->getActive().gun;
    const protocol::WeaponState weaponState{
        protocolWeapon(gun),
        static_cast<std::uint16_t>(std::clamp(gun.ammoInMag, 0, 65535)),
        static_cast<std::uint16_t>(
            std::clamp(ammo->get(gun.ammoType), 0, 65535)),
        static_cast<std::uint8_t>(gun.isReloading() ? 1U : 0U)};
    return {makeEntityHandle(entity), owner.position, owner.velocity,
            owner.bodyYaw, owner.aimPitch, owner.grounded, owner.stateFlags,
            static_cast<std::uint16_t>(std::clamp(
                std::lround(health->current), 0L, 65535L)), weaponState};
}

void GameServer::broadcastPlayerSpawn(entt::entity entity) {
    for (const auto& entry : m_clients) {
        Client* recipient = entry.second;
        if (!recipient || !recipient->welcomed() || recipient->closing())
            continue;
        recipient->queueSpawn(protocol::Spawn{
            static_cast<std::uint32_t>(m_currentTick),
            makePublicEntityState(entity)});
    }
}

void GameServer::broadcastSpawn(const protocol::Spawn& message) {
    for (const auto& entry : m_clients) entry.second->queueSpawn(message);
}

void GameServer::broadcastRemove(const protocol::Remove& message) {
    for (const auto& entry : m_clients) entry.second->queueRemove(message);
}

void GameServer::broadcastChat(const protocol::Chat& message) {
    for (const auto& entry : m_clients) entry.second->queueChat(message);
}

void GameServer::queueCurrentScoreboard(Client& recipient) const {
    const auto& registry = m_entityManager.getRegistry();
    const auto view = registry.view<Components::EntityBase, Components::Score>();
    std::vector<entt::entity> players;
    players.reserve(view.size_hint());
    for (const auto entity : view)
        if (view.get<Components::EntityBase>(entity).type == PLAYER)
            players.push_back(entity);
    std::sort(players.begin(), players.end(), [](entt::entity first,
                                                 entt::entity second) {
        return static_cast<std::uint32_t>(first) <
               static_cast<std::uint32_t>(second);
    });
    for (const auto player : players)
        recipient.queueScoreChange(
            scoreRow(m_currentTick, player,
                     registry.get<Components::Score>(player), 0));
}

void GameServer::triggerDeath(entt::entity player) {
    auto& registry = m_entityManager.getRegistry();
    if (!registry.valid(player) || !registry.all_of<Components::Health>(player))
        throw std::invalid_argument("death trigger requires a live player entity");
    auto& health = registry.get<Components::Health>(player);
    health.current = 0.0F;
    health.dirty = true;
    auto& life = registry.get<Components::PlayerLife>(player);
    life.killer = entt::null;
    life.killingWeapon = ItemType::ITEM_NONE;
}

void GameServer::setSnapshotHook(
    std::function<void(std::uint64_t)> hook) {
    snapshotHook_ = std::move(hook);
}

void GameServer::setNetworkFlushHook(std::function<void()> hook) {
    networkFlushHook_ = std::move(hook);
}

void GameServer::setReliableEventHook(std::function<void(
    std::optional<entt::entity>, const ReliableGameEvent&)> hook) {
    reliableEventHook_ = std::move(hook);
}

std::size_t GameServer::replicatedPlayerCount() const {
    const auto& registry = m_entityManager.getRegistry();
    const auto view = registry.view<Components::EntityBase>();
    std::size_t players = 0U;
    for (const auto entity : view)
        if (view.get<Components::EntityBase>(entity).type == PLAYER) ++players;
    return players;
}

ServerMetricsSnapshot GameServer::observabilityMetrics() const {
    return observability_.snapshot(
        replicatedPlayerCount(), combatMetrics_.shotsFired,
        combatMetrics_.pelletHits, combatMetrics_.rejectedFireAttempts,
        combatMetrics_.historyClamps);
}

std::string GameServer::observabilityJson() const {
    const auto metrics = observabilityMetrics();
    const auto distribution = [](const MetricDistribution& value) {
        return nlohmann::ordered_json{{"count", value.count},
                                      {"p50", value.p50},
                                      {"p95", value.p95},
                                      {"p99", value.p99},
                                      {"max", value.max}};
    };
    nlohmann::ordered_json json{
        {"event", "server_metrics"},
        {"serverTick", m_currentTick},
        {"tickMilliseconds", distribution(metrics.tickMilliseconds)},
        {"joltMilliseconds", distribution(metrics.joltMilliseconds)},
        {"snapshotMilliseconds",
         distribution(metrics.snapshotMilliseconds)},
        {"snapshotBytes", distribution(metrics.snapshotBytes)},
        {"accumulatorCalls", metrics.accumulatorCalls},
        {"catchUpSteps", metrics.catchUpSteps},
        {"maxStepsPerAdvance", metrics.maxStepsPerAdvance},
        {"droppedTimeSeconds", metrics.droppedTimeSeconds},
        {"playerCount", metrics.playerCount},
        {"queuedInputHighWater", metrics.queuedInputHighWater},
        {"pendingClientInputHighWater",
         metrics.pendingClientInputHighWater},
        {"outboundQueueBytesHighWater",
         metrics.outboundQueueBytesHighWater},
        {"outboundQueueMessagesHighWater",
         metrics.outboundQueueMessagesHighWater},
        {"transportBufferedBytesHighWater",
         metrics.transportBufferedBytesHighWater},
        {"coalescedSnapshots", metrics.coalescedSnapshots},
        {"snapshots", metrics.snapshots},
        {"reliableEvents", metrics.reliableEvents},
        {"inboundMessages", metrics.inboundMessages},
        {"inboundBytes", metrics.inboundBytes},
        {"outboundMessages", metrics.outboundMessages},
        {"outboundBytes", metrics.outboundBytes},
        {"rejectedMessages", metrics.rejectedMessages},
        {"malformedMessages", metrics.malformedMessages},
        {"rateLimitedMessages", metrics.rateLimitedMessages},
        {"unknownMessages", metrics.unknownMessages},
        {"backpressureCloses", metrics.backpressureCloses},
        {"shotsFired", metrics.shotsFired},
        {"pelletHits", metrics.pelletHits},
        {"rejectedFireAttempts", metrics.rejectedFireAttempts},
        {"historyClamps", metrics.historyClamps}};
    return json.dump();
}

void GameServer::resetObservabilityMetrics() { observability_.reset(); }

void GameServer::setMetricsSink(
    std::function<void(const std::string&)> sink) {
    metricsSink_ = std::move(sink);
}

void GameServer::recordInboundMessage(std::size_t bytes) {
    ++observability_.inboundMessages;
    observability_.inboundBytes += bytes;
}

void GameServer::recordOutboundMessage(std::size_t bytes) {
    ++observability_.outboundMessages;
    observability_.outboundBytes += bytes;
}

void GameServer::recordClientMessageMetric(ClientMessageMetric metric) {
    switch (metric) {
        case ClientMessageMetric::Rejected:
            ++observability_.rejectedMessages;
            break;
        case ClientMessageMetric::Malformed:
            ++observability_.malformedMessages;
            break;
        case ClientMessageMetric::RateLimited:
            ++observability_.rateLimitedMessages;
            break;
        case ClientMessageMetric::Unknown:
            ++observability_.unknownMessages;
            break;
        case ClientMessageMetric::Backpressure:
            ++observability_.backpressureCloses;
            break;
    }
}

void GameServer::observePendingClientInputs(std::size_t count) {
    observability_.observePendingClientInputs(count);
}

void GameServer::observeOutboundQueue(std::size_t messages,
                                      std::size_t bytes) {
    observability_.observeOutboundQueue(messages, bytes);
}

void GameServer::observeSnapshot(double milliseconds, std::size_t bytes) {
    observability_.observeSnapshot(milliseconds, bytes);
}

void GameServer::observeTransportBuffered(std::size_t bytes) {
    observability_.observeTransportBuffered(bytes);
}

void GameServer::recordCoalescedSnapshot() {
    ++observability_.coalescedSnapshots;
}

void GameServer::setServerRegistration(ServerRegistration* registration) {
    m_serverRegistration = registration;
}

void GameServer::updateHeartbeat(double delta) {
    if (!m_serverRegistration) return;
    m_heartbeatTimer += delta;
    if (m_heartbeatTimer >= m_heartbeatInterval) {
        m_heartbeatTimer = 0.0;
        m_serverRegistration->sendHeartbeatAsync(
            static_cast<int>(welcomedClientCount()));
    }
}
