#include "GameServer.hpp"

#include <box2d/box2d.h>
#include <box2d/math_functions.h>

#include <cassert>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <entt/entity/fwd.hpp>
#include <glm/glm.hpp>
#include <iostream>
#include <stdexcept>
#include <thread>

#include "RaycastSystem.hpp"
#include "World.hpp"
#include "client/Client.hpp"
#include "common/enums.hpp"
#include "ecs/EntityManager.hpp"
#include "ecs/components.hpp"
#include "physics/PhysicsWorld.hpp"
#include "util/units.hpp"

GameServer::GameServer() : m_entityManager(*this), m_physicsWorld(*this) {
    std::cout << "Initializing GameServer..." << std::endl;

    // Initialize volcanic world generator
    m_worldGenerator = std::make_unique<World>();

    // Configure world generation parameters
    const uint32_t seed = 834624467;
    const int worldSize = 512;  // 512x512 world
    const float islandSize = 0.75f;

    m_worldGenerator->setMasterSeed(seed);
    m_worldGenerator->setIslandSize(islandSize);
    m_worldGenerator->setNoiseLayers(3);

    // Generate the volcanic island terrain
    std::cout << "Generating volcanic island terrain..." << std::endl;
    m_worldGenerator->generateIsland(worldSize, worldSize, "");

    // Build terrain meshes for physics
    std::cout << "Building terrain meshes..." << std::endl;
    m_terrainMeshes = m_worldGenerator->buildTerrainMeshes();

    // Create Box2D physics from meshes
    std::cout << "Building physics from meshes..." << std::endl;
    m_worldGenerator->BuildMeshPhysics(m_terrainMeshes,
                                       m_physicsWorld.m_worldId);

    // Save final terrain visualization
    std::cout << "Saving final terrain image..." << std::endl;
    m_worldGenerator->saveFinalTerrainImage("final_terrain.png");

    // Store JSON file of terrain meshes for debugging
    m_worldGenerator->saveTerrainMeshesJSON(m_terrainMeshes,
                                            "terrain_meshes.json");

    // Initialize raycast system
    m_raycastSystem = std::make_unique<RaycastSystem>(
        m_entityManager.getRegistry(), m_physicsWorld.m_worldId);

    m_entityManager.initProjectilePool(256);

    std::cout << "GameServer initialization complete!" << std::endl;
}

void GameServer::run() {
    std::cout << "starting game server!" << std::endl;

    const std::chrono::duration<double> tickInterval(1.0 / m_tps);

    auto lastTime = std::chrono::steady_clock::now();

    while (1) {
        auto currentTime = std::chrono::steady_clock::now();
        std::chrono::duration<double> deltaTime = currentTime - lastTime;
        lastTime = currentTime;

        // socket server is ready
        if (m_socketLoop) {
            std::lock_guard<std::mutex> lock(m_gameMutex);
            tick(deltaTime.count());

            // Update heartbeat timer (send heartbeat every X seconds)
            updateHeartbeat(deltaTime.count());
        }

        auto tickTime = std::chrono::steady_clock::now() - currentTime;
        std::cout << "tick time: "
                  << std::chrono::duration<double, std::milli>(tickTime).count()
                  << "ms" << std::endl;

        auto sleepTime = tickInterval - tickTime;

        if (sleepTime > std::chrono::duration<double>::zero()) {
            std::this_thread::sleep_for(sleepTime);
        }
    }
}

void GameServer::processClientMessages() {
    for (auto& message : m_messages) {
        uint32_t id = message.first;
        std::string_view data = message.second;

        auto it = m_clients.find(id);
        if (it != m_clients.end()) {
            Client* client = it->second;
            try {  // TODO: I dont really like try-catch. Maybe lets just not
                   // read outside buffer and set outside bytes to zero
                client->onMessage(data);
            } catch (std::runtime_error error) {
                // Reading outside buffer view..
            }
        } else {
            std::cout << "Client with ID " << id << " not found" << std::endl;
        }
    }

    m_messages.clear();
}

void GameServer::tick(double delta) {
    ++m_currentTick;
    processClientMessages();

    {  // game world update

        /* Pre physics systems */
        prePhysicsSystemUpdate(delta);

        /* Physics update (can get slow when connection spamming) */
        m_physicsWorld.tick(delta);

        /* Post physics systems */
        postPhysicsSystemUpdate(delta);

        m_entityManager.removeEntities();
    }

    flushProjectileSpawnBatch();
    flushProjectileDestroyBatch();

    {  // server update
        for (auto& c : m_clients) {
            Client& client = *c.second;
            client.writeGameState();
        }

        m_socketLoop->defer([this]() {
            std::lock_guard<std::mutex> lock(m_gameMutex);
            for (auto& c : m_clients) {
                Client& client = *c.second;
                client.sendBytes();
            }
        });
    }
}

void GameServer::prePhysicsSystemUpdate(double delta) {
    // biomeSystem();
    stateSystem();
    inputSystem(delta);
    gunSystem(delta);
    projectileSystem(delta);
    meleeSystem(delta);
    healthSystem(delta);
    cameraSystem();
}

void GameServer::postPhysicsSystemUpdate(double /*delta*/) {
    projectileImpactSystem();
}

void GameServer::biomeSystem() {
    entt::registry& reg = m_entityManager.getRegistry();

    // Query biome for each entity with a position
    reg.view<Components::EntityBase>().each([&](entt::entity entity,
                                                Components::EntityBase& base) {
        if (B2_IS_NULL(base.bodyId)) return;

        // Get entity's position
        b2Vec2 pos = b2Body_GetPosition(base.bodyId);

        // Convert from Box2D meters to world coordinates
        // (Assuming pixels are the world coordinate system)
        float worldX = pixels(pos.x);
        float worldY = pixels(pos.y);

        // Query biome at this position
        if (m_worldGenerator) {
            BiomeType currentBiome =
                m_worldGenerator->GetBiomeAtPosition(worldX, worldY);

            std::cout << "Entity " << static_cast<uint32_t>(entity)
                      << " is in biome: "
                      << m_worldGenerator->GetBiomeName(currentBiome) << "\n";
            // print out entity type
            std::cout << "Entity type: " << static_cast<uint32_t>(base.type)
                      << "\n";
        }
    });
}

void GameServer::stateSystem() {
    entt::registry& reg = m_entityManager.getRegistry();

    reg.view<Components::State>().each(
        [&](entt::entity entity, Components::State& state) { state.clear(); });
}

void GameServer::inputSystem(double delta) {
    entt::registry& reg = m_entityManager.getRegistry();

    reg.view<Components::Input, Components::EntityBase>().each(
        [&](entt::entity entity, Components::Input& input,
            Components::EntityBase& base) {
            uint8_t direction = input.direction;
            float angle = input.angle;

            float x = 0;
            float y = 0;

            if (direction & 1) y = -1.0f;
            if (direction & 2) x = -1.0f;
            if (direction & 4) y = 1.0f;
            if (direction & 8) x = 1.0f;

            // normalize input vector
            float length = std::sqrt(x * x + y * y);
            if (length != 0.0f) {
                x /= length;
                y /= length;
            }

            const float speed = 2.5f;

            b2Vec2 inputVector = {x, y};
            b2Vec2 velocity = {inputVector.x * speed, inputVector.y * speed};

            b2BodyId bodyId = base.bodyId;

            assert(B2_IS_NON_NULL(bodyId));

            b2Body_SetLinearVelocity(bodyId, velocity);
            b2Rot rotation = b2MakeRot(angle);
            b2Body_SetTransform(bodyId, b2Body_GetPosition(bodyId), rotation);
        });
}

void GameServer::meleeSystem(double delta) {
    entt::registry& reg = m_entityManager.getRegistry();

    reg.view<Components::EntityBase, Components::Input,
             Components::AttackCooldown, Components::State>()
        .each([&](entt::entity entity, Components::EntityBase& base,
                  Components::Input& input,
                  Components::AttackCooldown& cooldown,
                  Components::State& state) {
            if (reg.all_of<Components::Inventory>(entity)) {
                const auto& inventory = reg.get<Components::Inventory>(entity);
                if (inventory.hasGunInHands()) {
                    return;
                }
            }

            assert(B2_IS_NON_NULL(base.bodyId));

            const bool shouldAttack = input.mouseIsDown || input.dirtyClick;
            const bool finishedCooldown = cooldown.update(delta);

            if (shouldAttack && finishedCooldown) {
                cooldown.reset();

                input.dirtyClick = false;

                state.setState(EntityStates::MELEE);

                const b2Vec2& pos = b2Body_GetPosition(base.bodyId);
                const float angle =
                    b2Rot_GetAngle(b2Body_GetRotation(base.bodyId));
                int playerRadius = 25;

                b2Vec2 meleePos = {
                    pixels(pos.x) + playerRadius * std::cos(angle),
                    pixels(pos.y) + playerRadius * std::sin(angle)};

                Hit(entity, meleePos, 15);
            }
        });
}

void GameServer::gunSystem(double delta) {
    entt::registry& reg = m_entityManager.getRegistry();

    reg.view<Components::EntityBase, Components::Input, Components::Inventory>()
        .each([&](entt::entity entity, Components::EntityBase& base,
                  Components::Input& input, Components::Inventory& inventory) {
            if (B2_IS_NULL(base.bodyId)) return;

            if (input.switchSlot >= 0) {
                uint8_t slot = static_cast<uint8_t>(input.switchSlot);
                inventory.setActiveSlot(slot);
                input.switchSlot = -1;
            }

            auto& slot = inventory.getActive();
            if (!slot.isGun()) {
                input.dirtyClick = false;
                input.reloadRequested = false;
                return;
            }

            Components::Gun& gun = slot.gun;
            bool wasReloading = gun.isReloading();
            gun.update(static_cast<float>(delta));

            if (input.reloadRequested) {
                input.reloadRequested = false;
                if (!gun.isReloading() && gun.ammoInMag < gun.magazineSize) {
                    if (reg.all_of<Components::Ammo>(entity)) {
                        Components::Ammo& ammo =
                            reg.get<Components::Ammo>(entity);
                        if (ammo.get(gun.ammoType) > 0) {
                            gun.startReload();
                        }
                    }
                }
            }

            if (wasReloading && !gun.isReloading()) {
                if (reg.all_of<Components::Ammo>(entity)) {
                    Components::Ammo& ammo = reg.get<Components::Ammo>(entity);
                    int needed = gun.magazineSize - gun.ammoInMag;
                    int taken = ammo.take(gun.ammoType, needed);
                    gun.ammoInMag += taken;
                    inventory.dirty = true;
                }
            }

            bool wantsFire = gun.automatic
                                 ? (input.mouseIsDown || input.dirtyClick)
                                 : input.dirtyClick;

            if (!wantsFire) {
                return;
            }

            if (!gun.canFire()) {
                return;
            }

            gun.ammoInMag -= gun.ammoPerShot;
            gun.triggerCooldown();
            input.dirtyClick = false;
            inventory.dirty = true;

            if (reg.all_of<Components::State>(entity)) {
                Components::State& state = reg.get<Components::State>(entity);
                state.setState(EntityStates::SHOOTING);
            }

            b2Vec2 position = b2Body_GetPosition(base.bodyId);
            const float playerRadiusMeters = meters(25.0f);

            for (int pellet = 0; pellet < gun.pellets; ++pellet) {
                float random01 = static_cast<float>(rand()) / RAND_MAX;
                float spread = (random01 * 2.0f - 1.0f) * gun.spread;
                float angle = input.angle + spread;

                glm::vec2 origin = {position.x, position.y};
                glm::vec2 direction = {std::cos(angle), std::sin(angle)};
                float muzzleOffset = playerRadiusMeters + gun.barrelLength;
                glm::vec2 muzzleOrigin = origin + direction * muzzleOffset;

                if (gun.fireMode == GunFireMode::FIRE_HITSCAN) {
                    RayHit hit = m_raycastSystem->FireBullet(
                        entity, muzzleOrigin, direction, gun.range);

                    glm::vec2 endPoint =
                        hit.hit ? hit.point
                                : glm::vec2{
                                      muzzleOrigin.x + direction.x * gun.range,
                                      muzzleOrigin.y + direction.y * gun.range};

                    broadcastBulletTrace(entity, muzzleOrigin, endPoint);

                    if (hit.hit && hit.entity != entt::null) {
                        applyDamage(entity, hit.entity, gun.damage);
                    }
                } else {
                    entt::entity projectileEntity =
                        m_entityManager.acquireProjectile();

                    if (reg.valid(projectileEntity) &&
                        reg.all_of<Components::Projectile,
                                   Components::EntityBase>(projectileEntity)) {
                        auto& projectile =
                            reg.get<Components::Projectile>(projectileEntity);
                        auto& projBase =
                            reg.get<Components::EntityBase>(projectileEntity);

                        const float projectileSpeedPixels =
                            pixels(gun.projectileSpeed);

                        projectile.init(entity, gun, m_currentTick,
                                        pixels(muzzleOrigin.x),
                                        pixels(muzzleOrigin.y), direction.x,
                                        direction.y, projectileSpeedPixels);

                        b2Vec2 velocity = {direction.x * gun.projectileSpeed,
                                           direction.y * gun.projectileSpeed};

                        b2Vec2 muzzlePos = {muzzleOrigin.x, muzzleOrigin.y};

                        b2Body_Enable(projBase.bodyId);
                        b2Body_SetTransform(projBase.bodyId, muzzlePos,
                                            b2MakeRot(angle));
                        b2Body_SetLinearVelocity(projBase.bodyId, velocity);
                        b2Body_SetAngularVelocity(projBase.bodyId, 0.0f);
                    }
                }
            }
        });
}

void GameServer::projectileSystem(double delta) {
    entt::registry& reg = m_entityManager.getRegistry();

    reg.view<Components::Projectile, Components::EntityBase>().each(
        [&](entt::entity entity, Components::Projectile& proj,
            Components::EntityBase& base) {
            if (!proj.active) return;
            if (B2_IS_NULL(base.bodyId)) return;

            proj.remainingLife -= static_cast<float>(delta);
            if (proj.remainingLife <= 0.0f) {
                m_projectileDestroyQueue.push_back(
                    static_cast<uint32_t>(entity));
                m_entityManager.releaseProjectile(entity);
            }
        });
}

void GameServer::projectileImpactSystem() {
    entt::registry& reg = m_entityManager.getRegistry();

    b2ContactEvents events = b2World_GetContactEvents(m_physicsWorld.m_worldId);

    for (int i = 0; i < events.beginCount; ++i) {
        b2ContactBeginTouchEvent& evt = events.beginEvents[i];

        b2BodyId bodyA = b2Shape_GetBody(evt.shapeIdA);
        b2BodyId bodyB = b2Shape_GetBody(evt.shapeIdB);

        void* userDataA = b2Body_GetUserData(bodyA);
        void* userDataB = b2Body_GetUserData(bodyB);

        entt::entity entityA = entt::null;
        entt::entity entityB = entt::null;

        if (userDataA) {
            entityA = reinterpret_cast<EntityBodyUserData*>(userDataA)->entity;
        }
        if (userDataB) {
            entityB = reinterpret_cast<EntityBodyUserData*>(userDataB)->entity;
        }

        bool aIsProjectile = userDataA && reg.valid(entityA) &&
                             reg.all_of<Components::Projectile>(entityA);
        bool bIsProjectile = userDataB && reg.valid(entityB) &&
                             reg.all_of<Components::Projectile>(entityB);

        if (!aIsProjectile && !bIsProjectile) continue;

        entt::entity projectileEntity = aIsProjectile ? entityA : entityB;
        entt::entity targetEntity = aIsProjectile ? entityB : entityA;

        auto& projectile = reg.get<Components::Projectile>(projectileEntity);
        if (!projectile.active) continue;
        if (projectile.owner == targetEntity) continue;

        if (targetEntity != entt::null && reg.valid(targetEntity)) {
            applyDamage(projectile.owner, targetEntity, projectile.damage);
        }
        m_projectileDestroyQueue.push_back(
            static_cast<uint32_t>(projectileEntity));
        m_entityManager.releaseProjectile(projectileEntity);
    }
}

void GameServer::flushProjectileSpawnBatch() {
    entt::registry& reg = m_entityManager.getRegistry();
    auto projectileView =
        reg.view<Components::Projectile, Components::EntityBase>();

    if (projectileView.begin() == projectileView.end()) {
        return;
    }

    for (auto& [id, client] : m_clients) {
        if (!reg.valid(client->m_entity) ||
            !reg.all_of<Components::Camera>(client->m_entity)) {
            continue;
        }

        Components::Camera& cam = reg.get<Components::Camera>(client->m_entity);
        bool targetValid = (cam.target != entt::null && reg.valid(cam.target));
        const b2Vec2& camPos =
            targetValid
                ? b2Body_GetPosition(
                      reg.get<Components::EntityBase>(cam.target).bodyId)
                : cam.position;
        float halfViewX = meters(cam.width) * 0.5f;
        float halfViewY = meters(cam.height) * 0.5f;

        b2AABB queryAABB;
        queryAABB.lowerBound = {camPos.x - halfViewX, camPos.y - halfViewY};
        queryAABB.upperBound = {camPos.x + halfViewX, camPos.y + halfViewY};

        struct SpawnPayload {
            uint32_t id;
            float originX;
            float originY;
            float dirX;
            float dirY;
            float speed;
            uint64_t spawnTick;
        };

        std::vector<SpawnPayload> newlyVisible;

        for (auto entity : projectileView) {
            auto& projectile =
                projectileView.get<Components::Projectile>(entity);
            auto& base = projectileView.get<Components::EntityBase>(entity);

            if (!projectile.active) continue;
            if (B2_IS_NULL(base.bodyId)) continue;
            if (!b2Body_IsEnabled(base.bodyId)) continue;

            const b2Vec2& pos = b2Body_GetPosition(base.bodyId);
            // TODO: this logic can be extracted into its own function... it is
            // also repeated on Client writeGameState
            if (pos.x < queryAABB.lowerBound.x ||
                pos.x > queryAABB.upperBound.x ||
                pos.y < queryAABB.lowerBound.y ||
                pos.y > queryAABB.upperBound.y) {
                continue;
            }

            uint32_t projectileId = static_cast<uint32_t>(entity);
            if (client->m_visibleProjectiles.insert(projectileId).second) {
                newlyVisible.push_back({projectileId, projectile.originX,
                                        projectile.originY, projectile.dirX,
                                        projectile.dirY, projectile.speed,
                                        projectile.spawnTick});
            }
        }

        if (newlyVisible.empty()) {
            continue;
        }

        client->m_writer.writeU8(ServerHeader::PROJECTILE_SPAWN_BATCH);
        client->m_writer.writeU64(m_currentTick);
        client->m_writer.writeU32(static_cast<uint32_t>(newlyVisible.size()));

        for (const auto& spawn : newlyVisible) {
            client->m_writer.writeU32(spawn.id);
            client->m_writer.writeFloat(spawn.originX);
            client->m_writer.writeFloat(spawn.originY);
            client->m_writer.writeFloat(spawn.dirX);
            client->m_writer.writeFloat(spawn.dirY);
            client->m_writer.writeFloat(spawn.speed);
            client->m_writer.writeU64(spawn.spawnTick);
        }
    }
}

void GameServer::flushProjectileDestroyBatch() {
    if (m_projectileDestroyQueue.empty()) {
        return;
    }

    for (auto& [id, client] : m_clients) {
        for (uint32_t projectileId : m_projectileDestroyQueue) {
            auto it = client->m_visibleProjectiles.find(projectileId);
            if (it == client->m_visibleProjectiles.end()) {
                continue;
            }
            client->m_visibleProjectiles.erase(it);
            client->m_writer.writeU8(ServerHeader::PROJECTILE_DESTROY);
            client->m_writer.writeU32(projectileId);
        }
    }

    m_projectileDestroyQueue.clear();
}

void GameServer::cameraSystem() {
    entt::registry& reg = m_entityManager.getRegistry();
    reg.view<Components::Camera>().each(
        [&](entt::entity entity, Components::Camera& cam) {
            if (reg.valid(cam.target)) {
                assert(reg.all_of<Components::EntityBase>(cam.target));

                b2BodyId bodyId =
                    reg.get<Components::EntityBase>(cam.target).bodyId;
                cam.position = b2Body_GetPosition(bodyId);
            }
        });
}

void GameServer::healthSystem(double delta) {
    entt::registry& reg = m_entityManager.getRegistry();

    reg.view<Components::Health>().each(
        [&](entt::entity entity, Components::Health& health) {
            if (health.current <= 0) {
                Die(entity);
            }
        });
}

void GameServer::applyDamage(entt::entity attacker, entt::entity target,
                             float damage) {
    entt::registry& reg = m_entityManager.getRegistry();

    if (reg.valid(target) && reg.all_of<Components::Health>(target)) {
        Components::Health& health = reg.get<Components::Health>(target);
        health.decrement(damage, attacker);

        if (reg.all_of<Components::State>(target)) {
            Components::State& state = reg.get<Components::State>(target);
            state.setState(EntityStates::HURT);
        }
    }

    if (reg.valid(target) && reg.all_of<Components::Destructible>(target)) {
        Components::Destructible& dest =
            reg.get<Components::Destructible>(target);
        dest.damage(damage);
    }
}

void GameServer::Hit(entt::entity attacker, b2Vec2& pos, int radius) {
    float mRadius = meters(radius);

    float x = meters(pos.x);
    float y = meters(pos.y);

    b2AABB queryAABB;
    queryAABB.lowerBound = {x - mRadius, y - mRadius};
    queryAABB.upperBound = {x + mRadius, y + mRadius};

    entt::registry& reg = m_entityManager.getRegistry();

    auto healthView = reg.view<Components::EntityBase, Components::Health>();

    for (auto entity : healthView) {
        if (attacker == entity) continue;

        assert(healthView.contains(entity));
        auto& base = healthView.get<Components::EntityBase>(entity);

        if (B2_IS_NULL(base.bodyId)) continue;

        // Get entity position
        b2Vec2 entityPos = b2Body_GetPosition(base.bodyId);

        // Simple distance check first
        b2Vec2 diff = {entityPos.x - x, entityPos.y - y};
        float distSq = diff.x * diff.x + diff.y * diff.y;
        if (distSq > (mRadius + 2.0f) * (mRadius + 2.0f))
            continue;  // Simple bounds check

        Components::Health& health = healthView.get<Components::Health>(entity);

        // Get all shapes for this body and test overlap
        int shapeCount = b2Body_GetShapeCount(base.bodyId);
        b2ShapeId* shapes = new b2ShapeId[shapeCount];
        b2Body_GetShapes(base.bodyId, shapes, shapeCount);

        bool hit = false;
        for (int i = 0; i < shapeCount; ++i) {
            b2ShapeId shapeId = shapes[i];

            // Get shape bounds
            b2AABB shapeAABB = b2Shape_GetAABB(shapeId);
            if (shapeAABB.lowerBound.x <= x + mRadius &&
                shapeAABB.upperBound.x >= x - mRadius &&
                shapeAABB.lowerBound.y <= y + mRadius &&
                shapeAABB.upperBound.y >= y - mRadius) {
                // damage entity
                const int DAMAGE = 10;
                health.decrement(DAMAGE, attacker);

                // if entity has a state, we will set it to hurt
                if (reg.all_of<Components::State>(entity)) {
                    Components::State& state =
                        reg.get<Components::State>(entity);

                    state.setState(EntityStates::HURT);
                }
                hit = true;
                break;  // Only hit once per entity
            }
        }
        delete[] shapes;
    }
}

void GameServer::Die(entt::entity entity) {
    entt::registry& reg = m_entityManager.getRegistry();
    assert(reg.all_of<Components::EntityBase>(entity));

    EntityTypes type = reg.get<Components::EntityBase>(entity).type;

    // Entities cannot be 'killed' unless they have a health component
    assert(reg.all_of<Components::Health>(entity));

    switch (type) {
        case EntityTypes::PLAYER: {
            assert(reg.all_of<Components::Client>(entity));

            uint32_t id = reg.get<Components::Client>(entity).id;
            auto it = m_clients.find(id);

            // It is possible for the client to have disconnected already
            if (it == m_clients.end()) {
                return;
            }

            Client* client = it->second;

            m_entityManager.scheduleForRemoval(client->m_entity);
            client->changeBody(m_entityManager.createSpectator(
                reg.get<Components::Health>(entity).attacker));
            client->m_active = false;
            client->m_writer.writeU8(ServerHeader::DIED);

            broadcastKill(entity);
            break;
        }

        default:
            std::cout << "Did not implement case for " << type << std::endl;
            assert(false);
            break;
    }
}

void GameServer::broadcastKill(entt::entity subject) {
    entt::registry& reg = m_entityManager.getRegistry();
    entt::entity killer = reg.get<Components::Health>(subject).attacker;

    for (auto& [id, client] : m_clients) {
        client->m_writer.writeU8(ServerHeader::NEWS);
        client->m_writer.writeU8(NewsType::KILL);
        client->m_writer.writeU32(static_cast<uint32_t>(subject));
        client->m_writer.writeU32(static_cast<uint32_t>(killer));
    }
}

void GameServer::broadcastMessage(const std::string& message) {
    for (auto& [id, client] : m_clients) {
        client->m_writer.writeU8(ServerHeader::NEWS);
        client->m_writer.writeU8(NewsType::TEXT);
        client->m_writer.writeString(message);
    }
}

// TODO: this should maybe be serialized from within Client.cpp game state AND
// this should not send to every client, only those who can see the trace
void GameServer::broadcastBulletTrace(entt::entity shooter, glm::vec2 start,
                                      glm::vec2 end) {
    float startX = pixels(start.x);
    float startY = pixels(start.y);
    float endX = pixels(end.x);
    float endY = pixels(end.y);

    for (auto& [id, client] : m_clients) {
        client->m_writer.writeU8(ServerHeader::BULLET_TRACE);
        client->m_writer.writeU32(static_cast<uint32_t>(shooter));
        client->m_writer.writeFloat(startX);
        client->m_writer.writeFloat(startY);
        client->m_writer.writeFloat(endX);
        client->m_writer.writeFloat(endY);
    }
}

void GameServer::setServerRegistration(ServerRegistration* registration) {
    m_serverRegistration = registration;
}

void GameServer::updateHeartbeat(double delta) {
    if (!m_serverRegistration) {
        return;  // No registration configured
    }

    m_heartbeatTimer += delta;

    if (m_heartbeatTimer >= m_heartbeatInterval) {
        m_heartbeatTimer = 0.0;

        // Send heartbeat with current player count
        int playerCount = static_cast<int>(m_clients.size());
        m_serverRegistration->sendHeartbeatAsync(playerCount);
    }
}
