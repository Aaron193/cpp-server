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
#include <cstdint>
#include <entt/entity/fwd.hpp>
#include <iostream>
#include <stdexcept>
#include <thread>

#include "client/Client.hpp"
#include "ecs/EntityManager.hpp"
#include "ecs/components.hpp"
#include "physics/PhysicsWorld.hpp"
#include "util/units.hpp"

// @TODO: make sure we have more C++ that typescript in thie project i dont want
// typescript to show on the git repo as the main language :C

GameServer::GameServer() : m_entityManager(*this), m_physicsWorld(*this) {}

void GameServer::run() {
    std::cout << "starting game server!" << std::endl;

    m_entityManager.createCrate();

    const std::chrono::duration<double> tickInterval(1.0 / m_tps);

    auto lastTime = std::chrono::steady_clock::now();

    while (1) {
        auto currentTime = std::chrono::steady_clock::now();
        std::chrono::duration<double> deltaTime = currentTime - lastTime;
        lastTime = currentTime;

        // socket server is ready
        if (m_socketLoop) {
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
    mutex_lock_t lock(m_clientsMutex);

    for (auto& message : m_messages) {
        uint32_t id = message.first;
        std::string_view data = message.second;

        auto it = m_clients.find(id);
        if (it != m_clients.end()) {
            Client* client = it->second;
            try {  // TODO: I dont really like try-catch. Maybe lets just not
                   // read outside buffer and set outside bytes to zero
                client->onMessage(data, lock);
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

        /* Physics update */
        m_physicsWorld.tick(delta);

        /* Post physics systems */

        m_entityManager.removeEntities();
    }

    {  // server update
        {
            mutex_lock_t lock(m_clientsMutex);

            for (auto& c : m_clients) {
                Client& client = *c.second;
                client.writeGameState();
            }
        }
        {
            m_socketLoop->defer([&]() {
                mutex_lock_t lock(m_clientsMutex);

                for (auto& c : m_clients) {
                    Client& client = *c.second;
                    client.sendBytes();
                }
            });
        }
    }
}

void GameServer::prePhysicsSystemUpdate(double delta) {
    stateSystem();
    inputSystem(delta);
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

    reg.view<Components::Input, Components::Body>().each(
        [&](entt::entity entity, Components::Input& input,
            Components::Body& b) {
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

            b2Body* body = b.body;

            assert(body != nullptr);

            body->SetLinearVelocity(velocity);
            body->SetTransform(body->GetPosition(), angle);
        });
}

/**
    @TODO: remove states from this function, decouple that logic into its own
    system... in other words get client iteration outside of this function to
    ensure pure ECS system logic
*/
void GameServer::meleeSystem(double delta) {
    entt::registry& reg = m_entityManager.getRegistry();

    reg.view<Components::Body, Components::Input, Components::State>().each(
        [&](entt::entity entity, Components::Body& bodyComp,
            Components::Input& input, Components::State& state) {
            b2Body* body = bodyComp.body;
            assert(body != nullptr);

            // update mouse up/down
            if (input.mouseIsDown) {
                assert(reg.all_of<Components::AttackCooldown>(entity));

                auto& cooldown = reg.get<Components::AttackCooldown>(entity);

                if (cooldown.update(delta)) {
                    // 1. (@TODO) create melee attack
                    // 2. set state to MELEE
                    state.setState(EntityStates::MELEE);

                    const b2Vec2& pos = body->GetPosition();
                    const float angle = body->GetAngle();
                    int playerRadius = 25;

                    b2Vec2 meleePos =
                        b2Vec2(pixels(pos.x) + playerRadius * std::cos(angle),
                               pixels(pos.y) + playerRadius * std::sin(angle));

                    Hit(entity, meleePos, 15);

                    {  // notify clients who can see us that our state has
                       // changed (TODO: i don't like putting this here)
                       // maybe instead of this, we go query each state
                       // comonent, and if it is not idle we then go through
                       // each client, check their visible entities, and
                       // serialize there
                        mutex_lock_t lock(m_clientsMutex);

                        auto state = reg.get<Components::State>(entity);

                        for (auto& c : m_clients) {
                            Client& client = *c.second;

                            if (client.m_previousVisibleEntities.find(entity) !=
                                client.m_previousVisibleEntities.end()) {
                                client.m_writer.writeU8(
                                    ServerHeader::ENTITY_STATE);
                                client.m_writer.writeU32(
                                    static_cast<uint32_t>(entity));
                                client.m_writer.writeU8(
                                    static_cast<uint8_t>(state.state));
                            }
                        }
                    }
                    cooldown.reset();
                }
            }
        });
}

void GameServer::cameraSystem() {
    entt::registry& reg = m_entityManager.getRegistry();
    reg.view<Components::Camera>().each(
        [&](entt::entity entity, Components::Camera& cam) {
            if (reg.valid(cam.target)) {
                assert(reg.all_of<Components::Body>(cam.target));

                b2Body* body = reg.get<Components::Body>(cam.target).body;
                cam.position = body->GetPosition();
            }
        });
}

void GameServer::healthSystem(double delta) {
    entt::registry& reg = m_entityManager.getRegistry();

    reg.view<Components::Health>().each(
        [&](entt::entity entity, Components::Health& health) {
            if (health.current <= 0) {
                // die
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

        assert(reg.all_of<Components::Type>(entity));

        EntityTypes type = reg.get<Components::Type>(entity).type;
        if (type != EntityTypes::PLAYER) continue;

        assert(reg.all_of<Components::Body>(entity));
        assert(reg.all_of<Components::Health>(entity));
        assert(reg.all_of<Components::State>(entity));

        b2Body* body = reg.get<Components::Body>(entity).body;
        assert(body != nullptr);

        b2Fixture* fixture = body->GetFixtureList();

        for (b2Fixture* fixture = body->GetFixtureList(); fixture;
             fixture = fixture->GetNext()) {
            const b2Shape* shape = fixture->GetShape();
            b2Transform shapeXf = body->GetTransform();

            if (b2TestOverlap(&hitbox, 0, shape, 0, hitboxXf, shapeXf)) {
                // damage player
                Components::Health& health =
                    reg.get<Components::Health>(entity);
                Components::State& state = reg.get<Components::State>(entity);

                const int DAMAGE = 10;
                health.current -= DAMAGE;

                state.setState(EntityStates::HURT);
            }
        }
    }
}