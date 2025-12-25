#include "GameServer.hpp"

#include <box2d/b2_body.h>
#include <box2d/b2_circle_shape.h>
#include <box2d/b2_collision.h>
#include <box2d/b2_fixture.h>
#include <box2d/b2_math.h>
#include <box2d/b2_shape.h>
#include <box2d/b2_world.h>

#include <cassert>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <entt/entity/fwd.hpp>
#include <iostream>
#include <stdexcept>
#include <thread>

#include "RaycastSystem.hpp"
#include "WorldGenerator.hpp"
#include "client/Client.hpp"
#include "common/enums.hpp"
#include "ecs/EntityManager.hpp"
#include "ecs/components.hpp"
#include "physics/PhysicsWorld.hpp"
#include "util/units.hpp"

GameServer::GameServer() : m_entityManager(*this), m_physicsWorld(*this) {
    std::cout << "Initializing GameServer..." << std::endl;

    // Initialize world generator
    m_worldGenerator = std::make_unique<WorldGenerator>(*this);

    // Generate world
    WorldGenParams params;
    params.seed = 834624467;
    params.worldSizeChunks = 8;  // 8x8 chunks = 512x512 tiles = 32,768x32,768 pixels
    params.numRivers = 15;
    params.structureDensity = 0.015f;  // 1.5% density for more structures
    params.minCoverDensity = 0.05f;

    m_worldGenerator->GenerateWorld(params);

    // Initialize raycast system
    m_raycastSystem = std::make_unique<RaycastSystem>(
        m_entityManager.getRegistry(), *m_physicsWorld.m_world);

    // Spawn structures as entities
    std::cout << "Spawning structures..." << std::endl;
    const auto& structures = m_worldGenerator->GetStructures();
    constexpr float TILE_SIZE = 64.0f; // Each tile is 64x64 pixels
    
    for (const auto& structure : structures) {
        entt::entity entity = entt::null;
        
        // Convert tile coordinates to pixel coordinates
        float pixelX = structure.x * TILE_SIZE;
        float pixelY = structure.y * TILE_SIZE;

        switch (structure.type) {
            case StructureType::House:
            case StructureType::Wall:
                entity = m_entityManager.createWall(pixelX, pixelY,
                                                    structure.destructible);
                break;
            case StructureType::Fence:
                entity = m_entityManager.createFence(pixelX, pixelY);
                break;
            case StructureType::Rock:
                entity = m_entityManager.createRock();
                // Position it
                if (auto* base =
                        m_entityManager.getRegistry().try_get<Components::EntityBase>(
                            entity)) {
                    if (base->body) {
                        base->body->SetTransform(
                            b2Vec2(meters(pixelX),
                                   meters(pixelY)),
                            0);
                    }
                }
                break;
            case StructureType::Bush:
                entity = m_entityManager.createBush();
                // Position it
                if (auto* base =
                        m_entityManager.getRegistry().try_get<Components::EntityBase>(
                            entity)) {
                    if (base->body) {
                        base->body->SetTransform(
                            b2Vec2(meters(pixelX),
                                   meters(pixelY)),
                            0);
                    }
                }
                // Mark as destructible if specified
                if (structure.destructible) {
                    Components::Destructible dest;
                    dest.maxHealth = 20.0f;
                    dest.currentHealth = 20.0f;
                    m_entityManager.getRegistry().emplace<Components::Destructible>(
                        entity, dest);
                }
                break;
            case StructureType::Tree:
                entity = m_entityManager.createTree(pixelX, pixelY);
                break;
            case StructureType::Crate:
                entity = m_entityManager.createCrate();
                // Position it
                if (auto* base =
                        m_entityManager.getRegistry().try_get<Components::EntityBase>(
                            entity)) {
                    if (base->body) {
                        base->body->SetTransform(
                            b2Vec2(meters(pixelX),
                                   meters(pixelY)),
                            0);
                    }
                }
                // Mark as destructible if specified
                if (structure.destructible) {
                    Components::Destructible dest;
                    dest.maxHealth = 50.0f;
                    dest.currentHealth = 50.0f;
                    m_entityManager.getRegistry().emplace<Components::Destructible>(
                        entity, dest);
                }
                break;
        }
    }

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
    stateSystem();
    inputSystem(delta);
    applyRiverFlow(delta);
    meleeSystem(delta);
    healthSystem(delta);
    cameraSystem();
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

            b2Vec2 inputVector = b2Vec2(x, y);
            b2Vec2 velocity =
                b2Vec2(inputVector.x * speed, inputVector.y * speed);

            b2Body* body = base.body;

            assert(body != nullptr);

            body->SetLinearVelocity(velocity);
            body->SetTransform(body->GetPosition(), angle);
        });
    
    // Apply river flow after input velocity is set
    applyRiverFlow(delta);
}

void GameServer::meleeSystem(double delta) {
    entt::registry& reg = m_entityManager.getRegistry();

    reg.view<Components::EntityBase, Components::Input,
             Components::AttackCooldown, Components::State>()
        .each([&](entt::entity entity, Components::EntityBase& base,
                  Components::Input& input,
                  Components::AttackCooldown& cooldown,
                  Components::State& state) {
            b2Body* body = base.body;
            assert(body != nullptr);

            const bool shouldAttack = input.mouseIsDown || input.dirtyClick;
            const bool finishedCooldown = cooldown.update(delta);

            if (shouldAttack && finishedCooldown) {
                cooldown.reset();

                input.dirtyClick = false;

                state.setState(EntityStates::MELEE);

                const b2Vec2& pos = body->GetPosition();
                const float angle = body->GetAngle();
                int playerRadius = 25;

                b2Vec2 meleePos =
                    b2Vec2(pixels(pos.x) + playerRadius * std::cos(angle),
                           pixels(pos.y) + playerRadius * std::sin(angle));

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

                b2Body* body = reg.get<Components::EntityBase>(cam.target).body;
                cam.position = body->GetPosition();
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
    queryAABB.lowerBound = b2Vec2(x - mRadius, y - mRadius);
    queryAABB.upperBound = b2Vec2(x + mRadius, y + mRadius);

    b2World* world = m_physicsWorld.m_world.get();

    m_physicsWorld.m_queryBodies->Clear();
    world->QueryAABB(m_physicsWorld.m_queryBodies, queryAABB);

    b2CircleShape hitbox;
    hitbox.m_radius = mRadius;

    b2Transform hitboxXf;
    hitboxXf.Set(b2Vec2(x, y), 0.0f);

    entt::registry& reg = m_entityManager.getRegistry();

    for (entt::entity entity : m_physicsWorld.m_queryBodies->entities) {
        if (attacker == entity) continue;

        if (!reg.all_of<Components::Health>(entity)) continue;

        assert(reg.all_of<Components::EntityBase>(entity));
        b2Body* body = reg.get<Components::EntityBase>(entity).body;
        assert(body != nullptr);

        Components::Health& health = reg.get<Components::Health>(entity);

        b2Fixture* fixture = body->GetFixtureList();

        for (b2Fixture* fixture = body->GetFixtureList(); fixture;
             fixture = fixture->GetNext()) {
            const b2Shape* shape = fixture->GetShape();
            b2Transform shapeXf = body->GetTransform();

            if (b2TestOverlap(&hitbox, 0, shape, 0, hitboxXf, shapeXf)) {
                // damage entity
                const int DAMAGE = 10;
                health.decrement(DAMAGE, attacker);

                // if entity has a state, we will set it to hurt
                if (reg.all_of<Components::State>(entity)) {
                    Components::State& state =
                        reg.get<Components::State>(entity);

                    state.setState(EntityStates::HURT);
                }
            }
        }
    }
}

void GameServer::applyRiverFlow(double delta) {
    entt::registry& reg = m_entityManager.getRegistry();
    static bool debugOnce = true;

    // Apply river flow velocity to entities in water
    reg.view<Components::EntityBase>().each(
        [&](entt::entity entity, Components::EntityBase& base) {
            if (!base.body) return;

            b2Vec2 pos = base.body->GetPosition();

            // Convert from Box2D meters to tile coordinates using shared unit helpers
            constexpr float TILE_SIZE = 64.0f;  // pixels per tile
            const float metersPerTile = meters(TILE_SIZE);

            int tileX = static_cast<int>(std::floor(pos.x / metersPerTile));
            int tileY = static_cast<int>(std::floor(pos.y / metersPerTile));

            // Check if entity is in water
            const Tile* tile = m_worldGenerator->GetTile(tileX, tileY);
            if (!tile) return;
            
            if (!(tile->flags & TileFlags::Water)) return;

            // Get river flow direction
            uint8_t flowDir = m_worldGenerator->GetFlowDirection(tileX, tileY);
            if (flowDir == WorldGenerator::NO_FLOW) return;

            // Convert flow direction (0-255) back to radians [-π, π]
            float angle = (static_cast<float>(flowDir) / 255.0f) * 2.0f * M_PI - M_PI;

            // Apply velocity in direction of flow
            const float RIVER_SPEED = 0.8f;  // River speed in m/s
            b2Vec2 flowVelocity(
                RIVER_SPEED * std::cos(angle),
                RIVER_SPEED * std::sin(angle)
            );

            // Get current velocity and add river component
            b2Vec2 currentVel = base.body->GetLinearVelocity();
            b2Vec2 newVel = currentVel + flowVelocity;

            base.body->SetLinearVelocity(newVel);
        });
}

void GameServer::Die(entt::entity entity) {
    entt::registry& reg = m_entityManager.getRegistry();
    assert(reg.all_of<Components::EntityBase>(entity));

    EntityTypes type = reg.get<Components::EntityBase>(entity).type;

    // Check if this is a destructible entity (structures)
    if (reg.all_of<Components::Destructible>(entity)) {
        auto& destructible = reg.get<Components::Destructible>(entity);
        if (destructible.isDestroyed()) {
            // Broadcast structure destruction to all clients
            for (auto& [id, client] : m_clients) {
                client->m_writer.writeU8(ServerHeader::STRUCTURE_DESTROY);
                client->m_writer.writeU32(static_cast<uint32_t>(entity));
            }
            
            // Schedule for removal
            m_entityManager.scheduleForRemoval(entity);
            return;
        }
    }

    // Entities cannot be 'killed' unless they have a health component
    if (!reg.all_of<Components::Health>(entity)) {
        return;
    }

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
            // For other entities with health, just remove them
            m_entityManager.scheduleForRemoval(entity);
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
