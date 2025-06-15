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

GameServer::GameServer() : m_entityManager(*this), m_physicsWorld(*this) {
    // Setup world
    for (int i = 0; i < 10; i++) {
        m_entityManager.createCrate();
        m_entityManager.createBush();
    }
}

void GameServer::enqueueJob(std::function<void()> job) {
    {
        std::lock_guard<std::mutex> lock(m_jobQueueMutex);
        m_jobQueue.push(std::move(job));
    }
}

void GameServer::processJobs() {
    std::queue<std::function<void()>> jobs;
    {
        std::lock_guard<std::mutex> lock(m_jobQueueMutex);
        std::swap(jobs, m_jobQueue);
    }
    while (!jobs.empty()) {
        jobs.front()();
        jobs.pop();
    }
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
    processJobs();
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
        for (auto& c : m_clients) {
            Client& client = *c.second;
            client.writeGameState();
        }

        m_socketLoop->defer([&]() {
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

void GameServer::Die(entt::entity entity) {
    entt::registry& reg = m_entityManager.getRegistry();
    assert(reg.all_of<Components::EntityBase>(entity));

    EntityTypes type = reg.get<Components::EntityBase>(entity).type;

    switch (type) {
        case EntityTypes::SPECTATOR:
        case EntityTypes::CRATE:
            // These entities cannot die
            assert(false);
            break;

        case EntityTypes::PLAYER: {
            assert(reg.all_of<Components::Client>(entity));

            uint32_t id = reg.get<Components::Client>(entity).id;
            auto it = m_clients.find(id);
            assert(it != m_clients.end());

            Client* client = it->second;

            m_entityManager.scheduleForRemoval(client->m_entity);
            client->changeBody(m_entityManager.createSpectator(
                reg.get<Components::Health>(entity).attacker));
            client->m_active = false;
            client->m_writer.writeU8(ServerHeader::DIED);
            break;
        }
    }
}