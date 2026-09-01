#include "TestHarness.hpp"

#include <algorithm>
#include <optional>
#include <variant>
#include <vector>

#include "GameServer.hpp"
#include "ecs/components.hpp"

namespace {
using EventDelivery =
    std::pair<std::optional<entt::entity>, ReliableGameEvent>;

void place(GameServer& server, entt::entity player,
           const glm::vec3& position) {
    auto& registry = server.m_entityManager.getRegistry();
    registry.get<Components::Transform3D>(player).position = position;
    const auto controller =
        registry.get<Components::CharacterController>(player).adapterId;
    server.m_physicsWorld.setCharacterPosition(controller, position);
    server.m_physicsWorld.setCharacterVelocity(controller, {0,0,0});
}

Components::PlayerInput fireInput(std::uint32_t sequence,
                                  std::uint32_t clientTick,
                                  bool held = true, std::int8_t slot = -1) {
    Components::PlayerInput input;
    input.mouseIsDown = held;
    input.dirtyClick = held;
    input.yaw = 0.0F;
    input.pitch = 0.0F;
    input.inputSequence = sequence;
    input.clientTick = clientTick;
    input.switchSlot = slot;
    return input;
}

std::size_t countType(const std::vector<EventDelivery>& events,
                      std::size_t variantIndex) {
    return static_cast<std::size_t>(std::count_if(
        events.begin(), events.end(), [variantIndex](const auto& event) {
            return event.second.index() == variantIndex;
        }));
}
}  // namespace

TEST_CASE(rifle_automatic_fire_obeys_tick_cadence_and_magazine_ammo) {
    GameServer server;
    const auto shooter = server.m_entityManager.createPlayer();
    std::vector<EventDelivery> events;
    server.setReliableEventHook(
        [&](auto recipient, const auto& event) {
            events.emplace_back(recipient, event);
        });
    server.queueValidatedInput(shooter, fireInput(1U, 1U));
    for (int tick = 0; tick < 61; ++tick) server.simulateOneTick();
    const auto& inventory = server.m_entityManager.getRegistry().get<
        Components::WeaponInventory>(shooter);
    EXPECT_EQ(countType(events, 0U), 11U);
    EXPECT_EQ(inventory.slots[0].gun.ammoInMag, 19);
    EXPECT_EQ(server.combatMetrics().shotsFired, 11U);
}

TEST_CASE(ads_intent_overrides_sprint_and_reduces_authoritative_speed) {
    GameServer server;
    const auto player = server.m_entityManager.createPlayer();
    auto input = fireInput(1U, 1U, false);
    input.movement = {0.0F, -1.0F};
    input.sprintHeld = true;
    input.adsHeld = true;
    server.queueValidatedInput(player, input);
    for (int tick = 0; tick < 20; ++tick) server.simulateOneTick();
    auto& registry = server.m_entityManager.getRegistry();
    const auto& movement = registry.get<Components::MovementState>(player);
    const auto& aiming = registry.get<Components::PlayerAiming>(player).value;
    const auto& velocity = registry.get<Components::Velocity3D>(player).linear;
    EXPECT_EQ(movement.mode, protocol::MovementMode::Normal);
    EXPECT_NEAR(aiming.aimProgress, 1.0F, 0.0001F);
    EXPECT_TRUE(std::hypot(velocity.x, velocity.z) <=
                server.m_gameConfig.movement.groundSpeed *
                    server.m_gameConfig.rifle.aim.adsMoveMultiplier + 0.05F);
    EXPECT_TRUE((server.makeEntityRecord(player, player).stateFlags & 2U) != 0U);
}

TEST_CASE(action_ids_echo_authoritative_accept_and_cadence_rejection) {
    GameServer server;
    const auto shooter = server.m_entityManager.createPlayer();
    std::vector<EventDelivery> events;
    server.setReliableEventHook([&](auto recipient, const auto& event) {
        events.emplace_back(recipient, event);
    });
    auto accepted = fireInput(1U, 1U);
    accepted.fireActionId = 1001U;
    server.queueValidatedInput(shooter, accepted);
    server.simulateOneTick();
    auto rejected = fireInput(2U, 2U);
    rejected.fireActionId = 1002U;
    server.queueValidatedInput(shooter, rejected);
    server.simulateOneTick();
    std::vector<protocol::ActionResult> results;
    for (const auto& delivery : events)
        if (const auto* result = std::get_if<protocol::ActionResult>(&delivery.second))
            results.push_back(*result);
    EXPECT_EQ(results.size(), 2U);
    EXPECT_EQ(results[0].actionId, 1001U);
    EXPECT_TRUE(results[0].accepted);
    EXPECT_EQ(results[0].reason, protocol::ActionRejectReason::None);
    EXPECT_EQ(results[1].actionId, 1002U);
    EXPECT_TRUE(!results[1].accepted);
    EXPECT_EQ(results[1].reason, protocol::ActionRejectReason::Cadence);
}

TEST_CASE(shotgun_requires_trigger_edges_and_switching_selects_slots) {
    GameServer server;
    const auto shooter = server.m_entityManager.createPlayer();
    std::vector<EventDelivery> events;
    server.setReliableEventHook(
        [&](auto recipient, const auto& event) {
            events.emplace_back(recipient, event);
        });
    server.queueValidatedInput(shooter, fireInput(1U, 1U, true, 1));
    for (int tick = 0; tick < 55; ++tick) server.simulateOneTick();
    EXPECT_EQ(countType(events, 0U), 1U);
    auto& inventory = server.m_entityManager.getRegistry().get<
        Components::WeaponInventory>(shooter);
    EXPECT_EQ(inventory.activeSlot, 1U);
    EXPECT_EQ(inventory.slots[1].gun.ammoInMag, 5);
    server.queueValidatedInput(shooter, fireInput(2U, 56U, false));
    server.simulateOneTick();
    server.queueValidatedInput(shooter, fireInput(3U, 57U, true));
    server.simulateOneTick();
    EXPECT_EQ(countType(events, 0U), 2U);
    EXPECT_EQ(inventory.slots[1].gun.ammoInMag, 4);
    for (const auto& delivery : events) {
        const auto* confirmation =
            std::get_if<protocol::ShotConfirmed>(&delivery.second);
        if (!confirmation) continue;
        EXPECT_EQ(confirmation->weapon, protocol::Weapon::Shotgun);
        EXPECT_EQ(confirmation->pelletEndPositions.size(), 8U);
        EXPECT_TRUE(confirmation->pelletEndPositions.at(0).x !=
                        confirmation->pelletEndPositions.at(1).x ||
                    confirmation->pelletEndPositions.at(0).y !=
                        confirmation->pelletEndPositions.at(1).y ||
                    confirmation->pelletEndPositions.at(0).z !=
                        confirmation->pelletEndPositions.at(1).z);
    }
}

TEST_CASE(reload_completes_on_exact_tick_and_transfers_only_reserve_ammo) {
    GameServer server;
    const auto player = server.m_entityManager.createPlayer();
    auto& registry = server.m_entityManager.getRegistry();
    auto& gun = registry.get<Components::WeaponInventory>(player).slots[0].gun;
    auto& ammo = registry.get<Components::Ammo>(player);
    gun.ammoInMag = 25;
    ammo.amounts[static_cast<std::size_t>(AmmoType::LIGHT)] = 3;
    auto input = fireInput(1U, 1U, false);
    input.reloadRequested = true;
    server.queueValidatedInput(player, input);
    server.simulateOneTick();
    EXPECT_TRUE(gun.isReloading());
    for (int tick = 0; tick < 107; ++tick) server.simulateOneTick();
    EXPECT_EQ(gun.ammoInMag, 25);
    EXPECT_TRUE(gun.isReloading());
    server.simulateOneTick();
    EXPECT_EQ(gun.ammoInMag, 28);
    EXPECT_EQ(ammo.get(AmmoType::LIGHT), 0);
    EXPECT_TRUE(!gun.isReloading());
}

TEST_CASE(dead_players_cannot_fire_and_invalid_aim_is_rejected) {
    GameServer server;
    const auto player = server.m_entityManager.createPlayer();
    server.triggerDeath(player);
    server.simulateOneTick();
    server.queueValidatedInput(player, fireInput(1U, 2U));
    server.simulateOneTick();
    EXPECT_EQ(server.combatMetrics().shotsFired, 0U);
    auto invalid = fireInput(2U, 3U);
    invalid.pitch = 2.0F;
    bool rejected = false;
    try { server.queueValidatedInput(player, invalid); }
    catch (const std::invalid_argument&) { rejected = true; }
    EXPECT_TRUE(rejected);
}

TEST_CASE(lag_compensation_hits_historical_capsule_after_target_moves) {
    GameServer server;
    server.m_gameConfig.rifle.aim.hipSpreadRadians = 0.0F;
    server.m_gameConfig.rifle.aim.adsSpreadRadians = 0.0F;
    server.m_gameConfig.rifle.aim.hipMoveSpreadRadians = 0.0F;
    server.m_gameConfig.rifle.aim.adsMoveSpreadRadians = 0.0F;
    server.m_gameConfig.rifle.aim.airborneSpreadRadians = 0.0F;
    const auto shooter = server.m_entityManager.createPlayer();
    const auto target = server.m_entityManager.createPlayer();
    place(server, shooter, {0,10,10});
    place(server, target, {0,10,0});
    auto& registry = server.m_entityManager.getRegistry();
    registry.get<Components::PlayerLife>(target).spawnProtectionRemaining = 0.0F;
    std::vector<EventDelivery> events;
    server.setReliableEventHook(
        [&](auto recipient, const auto& event) {
            events.emplace_back(recipient, event);
        });
    server.simulateOneTick();
    place(server, target, {10,10,0});
    server.queueValidatedInput(shooter, fireInput(5U, 1U));
    server.simulateOneTick();
    EXPECT_NEAR(registry.get<Components::Health>(target).current,
                76.0F, 0.0001F);
    EXPECT_TRUE(events.size() >= 4U);
    EXPECT_EQ(events[0].second.index(), 0U);  // shooter-only confirmation
    EXPECT_TRUE(!events[0].first.has_value());
    EXPECT_EQ(events[1].second.index(), 1U);  // broadcast impact
    EXPECT_TRUE(!events[1].first.has_value());
    EXPECT_EQ(events[2].second.index(), 2U);  // victim-private damage
    EXPECT_EQ(events[2].first.value(), target);
    EXPECT_EQ(events[3].second.index(), 2U);  // attacker-private damage
    EXPECT_EQ(events[3].first.value(), shooter);
}

TEST_CASE(server_tick_domain_history_is_bounded_and_outliers_clamp) {
    GameServer server;
    server.m_entityManager.createPlayer();
    for (int tick = 0; tick < 20; ++tick) server.simulateOneTick();
    EXPECT_EQ(server.acceptedHistoryTick(1U), 5U);
    EXPECT_EQ(server.acceptedHistoryTick(12U), 12U);
    EXPECT_EQ(server.acceptedHistoryTick(100U), 20U);
}

TEST_CASE(hitscan_excludes_self_and_historical_dead_players) {
    GameServer server;
    const auto shooter = server.m_entityManager.createPlayer();
    const auto corpse = server.m_entityManager.createPlayer();
    place(server, shooter, {0,10,10});
    place(server, corpse, {0,10,0});
    server.triggerDeath(corpse);
    server.simulateOneTick();
    server.queueValidatedInput(shooter, fireInput(1U, 2U));
    server.simulateOneTick();
    EXPECT_EQ(server.combatMetrics().pelletHits, 0U);
}

TEST_CASE(spawn_protection_blocks_damage_and_firing_cancels_own_protection) {
    GameServer server;
    const auto attacker = server.m_entityManager.createPlayer();
    const auto protectedPlayer = server.m_entityManager.createPlayer();
    EXPECT_TRUE(!server.applyDamage(attacker, protectedPlayer, 50.0F,
                                    ItemType::GUN_RIFLE));
    auto& registry = server.m_entityManager.getRegistry();
    EXPECT_NEAR(registry.get<Components::Health>(protectedPlayer).current,
                100.0F, 0.0001F);
    server.queueValidatedInput(protectedPlayer, fireInput(1U, 1U));
    server.simulateOneTick();
    EXPECT_NEAR(registry.get<Components::PlayerLife>(protectedPlayer)
                    .spawnProtectionRemaining,
                0.0F, 0.0001F);
    EXPECT_TRUE(server.applyDamage(attacker, protectedPlayer, 25.0F,
                                   ItemType::GUN_RIFLE));
}

TEST_CASE(simultaneous_fire_cancels_protection_before_damage_phase) {
    GameServer server;
    server.m_gameConfig.rifle.aim.hipSpreadRadians = 0.0F;
    server.m_gameConfig.rifle.aim.adsSpreadRadians = 0.0F;
    server.m_gameConfig.rifle.aim.hipMoveSpreadRadians = 0.0F;
    server.m_gameConfig.rifle.aim.adsMoveSpreadRadians = 0.0F;
    server.m_gameConfig.rifle.aim.airborneSpreadRadians = 0.0F;
    const auto first = server.m_entityManager.createPlayer();
    const auto second = server.m_entityManager.createPlayer();
    place(server, first, {0,10,10});
    place(server, second, {0,10,0});
    auto firstInput = fireInput(1U, 1U);
    auto secondInput = fireInput(1U, 1U);
    secondInput.yaw = 3.14159265359F;
    server.queueValidatedInput(first, firstInput);
    server.queueValidatedInput(second, secondInput);
    server.simulateOneTick();
    auto& registry = server.m_entityManager.getRegistry();
    EXPECT_NEAR(registry.get<Components::Health>(first).current,
                76.0F, 0.0001F);
    EXPECT_NEAR(registry.get<Components::Health>(second).current,
                76.0F, 0.0001F);
}

TEST_CASE(lethal_damage_emits_once_and_updates_killer_victim_scores) {
    GameServer server;
    const auto killer = server.m_entityManager.createPlayer();
    const auto victim = server.m_entityManager.createPlayer();
    auto& registry = server.m_entityManager.getRegistry();
    registry.get<Components::PlayerLife>(victim).spawnProtectionRemaining = 0.0F;
    std::vector<EventDelivery> events;
    server.setReliableEventHook(
        [&](auto recipient, const auto& event) {
            events.emplace_back(recipient, event);
        });
    EXPECT_TRUE(server.applyDamage(killer, victim, 100.0F,
                                   ItemType::GUN_SHOTGUN));
    server.simulateOneTick();
    EXPECT_TRUE(registry.get<Components::PlayerLife>(victim).dead);
    EXPECT_EQ(registry.get<Components::Score>(victim).deaths, 1U);
    EXPECT_EQ(registry.get<Components::Score>(killer).kills, 1U);
    EXPECT_EQ(registry.get<Components::Score>(killer).points, 1);
    EXPECT_EQ(countType(events, 2U), 2U);  // private Damage: victim + killer
    EXPECT_EQ(countType(events, 3U), 1U);  // broadcast Death
    EXPECT_EQ(countType(events, 5U), 2U);  // victim + killer score rows
    server.simulateOneTick();
    EXPECT_EQ(countType(events, 3U), 1U);
    EXPECT_EQ(countType(events, 5U), 2U);
}

TEST_CASE(respawn_event_occurs_once_on_exact_configured_tick) {
    GameServer server;
    const auto player = server.m_entityManager.createPlayer();
    std::vector<EventDelivery> events;
    server.setReliableEventHook(
        [&](auto recipient, const auto& event) {
            events.emplace_back(recipient, event);
        });
    server.triggerDeath(player);
    server.simulateOneTick();
    for (int tick = 0; tick < 179; ++tick) server.simulateOneTick();
    EXPECT_EQ(countType(events, 4U), 0U);
    server.simulateOneTick();
    EXPECT_EQ(countType(events, 4U), 1U);
    server.simulateOneTick();
    EXPECT_EQ(countType(events, 4U), 1U);
}

TEST_CASE(score_limit_enters_intermission_and_reset_preserves_entity_ids) {
    GameServer server;
    const auto killer = server.m_entityManager.createPlayer();
    const auto victim = server.m_entityManager.createPlayer();
    auto& registry = server.m_entityManager.getRegistry();
    registry.get<Components::PlayerLife>(victim).spawnProtectionRemaining = 0.0F;
    auto& killerScore = registry.get<Components::Score>(killer);
    killerScore.kills = 24;
    killerScore.points = 24;
    std::vector<EventDelivery> events;
    server.setReliableEventHook(
        [&](auto recipient, const auto& event) {
            events.emplace_back(recipient, event);
        });
    server.applyDamage(killer, victim, 100.0F, ItemType::GUN_RIFLE);
    server.simulateOneTick();
    EXPECT_EQ(server.matchState().phase, protocol::MatchPhase::Intermission);
    std::vector<protocol::RoundTransitionKind> transitions;
    for (const auto& delivery : events)
        if (const auto* transition =
                std::get_if<protocol::RoundTransition>(&delivery.second))
            transitions.push_back(transition->transition);
    EXPECT_EQ(transitions.size(), 2U);
    EXPECT_EQ(transitions[0], protocol::RoundTransitionKind::Ended);
    EXPECT_EQ(transitions[1], protocol::RoundTransitionKind::Intermission);
    const auto joining = server.m_entityManager.createPlayer();
    server.queueValidatedInput(joining, fireInput(1U, 2U));
    server.simulateOneTick();
    EXPECT_EQ(server.combatMetrics().shotsFired, 0U);
    const std::uint64_t resetTick =
        static_cast<std::uint64_t>(server.matchState().phaseEndsAtTick);
    server.m_currentTick = resetTick - 1U;
    server.simulateOneTick();
    EXPECT_EQ(server.matchState().phase, protocol::MatchPhase::Active);
    EXPECT_EQ(server.matchState().roundNumber, 2U);
    transitions.clear();
    for (const auto& delivery : events)
        if (const auto* transition =
                std::get_if<protocol::RoundTransition>(&delivery.second))
            transitions.push_back(transition->transition);
    EXPECT_EQ(transitions.size(), 4U);
    EXPECT_EQ(transitions[2], protocol::RoundTransitionKind::Reset);
    EXPECT_EQ(transitions[3], protocol::RoundTransitionKind::Started);
    bool scoreResetPublished = false;
    for (const auto& delivery : events)
        if (const auto* score =
                std::get_if<protocol::ScoreChange>(&delivery.second))
            if (score->playerId == static_cast<std::uint32_t>(killer) &&
                score->score == 0 && score->delta == -25 &&
                score->kills == 0U && score->deaths == 0U)
                scoreResetPublished = true;
    EXPECT_TRUE(scoreResetPublished);
    EXPECT_TRUE(registry.valid(killer));
    EXPECT_TRUE(registry.valid(victim));
    EXPECT_TRUE(registry.valid(joining));
    EXPECT_EQ(registry.get<Components::Score>(killer).kills, 0U);
    EXPECT_EQ(registry.get<Components::Score>(victim).deaths, 0U);
    EXPECT_EQ(registry.get<Components::Health>(victim).current, 100.0F);
    const auto& killerInventory =
        registry.get<Components::WeaponInventory>(killer);
    EXPECT_EQ(killerInventory.slots[0].gun.ammoInMag,
              server.m_gameConfig.rifle.magazineSize);
    EXPECT_EQ(registry.get<Components::Ammo>(killer).get(AmmoType::LIGHT),
              server.m_gameConfig.loadout.rifleReserveAmmo);
    const auto resetPosition =
        registry.get<Components::Transform3D>(killer).position;
    bool isSpawn = false;
    for (const auto& spawn : server.m_mapPackage.manifest.spawnPoints)
        if (glm::length(resetPosition - spawn.position) < 0.1F)
            isSpawn = true;
    EXPECT_TRUE(isSpawn);
}

TEST_CASE(round_time_limit_transitions_after_exact_ten_minutes) {
    GameServer server;
    server.m_currentTick = 10U * 60U * GameServer::kTicksPerSecond - 1U;
    server.simulateOneTick();
    EXPECT_EQ(server.matchState().phase, protocol::MatchPhase::Intermission);
    EXPECT_EQ(server.matchState().phaseEndsAtTick,
              10U * 60U * GameServer::kTicksPerSecond +
                  10U * GameServer::kTicksPerSecond);
}
