#include "GameServer.hpp"

#include <box2d/b2_body.h>
#include <box2d/b2_fixture.h>
#include <box2d/b2_math.h>
#include <box2d/b2_world.h>

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