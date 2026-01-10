#include "GameServer.hpp"

#include <box2d/box2d.h>

#include <cassert>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <entt/entity/fwd.hpp>
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

    m_tickDurationMs = 1000.0 / static_cast<double>(m_tps);

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

            m_currentTick = m_tickCounter;
            m_currentServerTimeMs =
                static_cast<double>(m_currentTick) * m_tickDurationMs;
            tick(deltaTime.count());

            // Update heartbeat timer (send heartbeat every X seconds)
            updateHeartbeat(deltaTime.count());

            ++m_tickCounter;
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
    processClientMessages();

    {  // game world update

        /* Pre physics systems */
        prePhysicsSystemUpdate(delta);

        /* Physics update (can get slow when connection spamming) */
        m_physicsWorld.tick(delta);

        /* Post physics systems */

        m_entityManager.removeEntities();
    }

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
    biomeSystem();
    stateSystem();
    inputSystem(delta);
    meleeSystem(delta);
    healthSystem(delta);
    cameraSystem();
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
            // TODO: Store biome on entity if needed
            // For now, just log it for testing
            // You can add a Biome component if you want to track it
            // entt::component biomeComponent;
            // biomeComponent.type = currentBiome;
            // reg.emplace<Components::Biome>(entity, biomeComponent);
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
            assert(B2_IS_NON_NULL(base.bodyId));

            const bool shouldAttack = input.mouseIsDown || input.dirtyClick;
            const bool finishedCooldown = cooldown.update(delta);

            if (shouldAttack && finishedCooldown) {
                cooldown.reset();

                input.dirtyClick = false;

                state.setState(EntityStates::MELEE);

                const b2Vec2& pos = b2Body_GetPosition(base.bodyId);
                b2Rot rot = b2Body_GetRotation(base.bodyId);
                const float angle =
                    atan2f(2.0f * rot.c * rot.s, 1.0f - 2.0f * rot.s * rot.s);
                int playerRadius = 25;

                b2Vec2 meleePos = {
                    pixels(pos.x) + playerRadius * std::cos(angle),
                    pixels(pos.y) + playerRadius * std::sin(angle)};

                Hit(entity, meleePos, 15);
            }
        });
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
