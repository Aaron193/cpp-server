#include "GameServer.hpp"

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

GameServer::GameServer() : m_entityManager(*this), m_physicsWorld(*this) {}

void GameServer::run() {
    std::cout << "starting game server!" << std::endl;
    const double tickRate = 10.0;
    const std::chrono::duration<double> tickInterval(1.0 / tickRate);

    auto lastTime = std::chrono::steady_clock::now();

    while (1) {
        auto currentTime = std::chrono::steady_clock::now();
        std::chrono::duration<double> deltaTime = currentTime - lastTime;
        lastTime = currentTime;

        tick(deltaTime.count());

        std::this_thread::sleep_for(tickInterval);
    }
}

void GameServer::processClientMessages() {
    std::lock_guard<std::mutex> lock(m_clientsMutex);

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
        prePhysicsSystemUpdate();

        /* Physics update */
        m_physicsWorld.tick(delta);

        /* Post physics systems */

        m_entityManager.removeEntities();
    }

    {  // server update
        std::lock_guard<std::mutex> lock(m_clientsMutex);

        for (auto& c : m_clients) {
            Client& client = *c.second;
            client.writeGameState();
            client.sendBytes();
        }
    }
}

/**
    Set forces and movement of entities based on input
*/
void GameServer::prePhysicsSystemUpdate() {
    inputSystem();
    cameraSystem();
}

void GameServer::inputSystem() {
    auto view = m_entityManager.getRegistry()
                    .view<Components::Input, Components::Body>();

    for (auto entity : view) {
        auto input =
            m_entityManager.getRegistry().get<Components::Input>(entity);

        uint8_t direction = input.direction;
        float angle = input.angle;

        uint8_t x = 0;
        uint8_t y = 0;

        if (direction & 1) y = -1;
        if (direction & 2) x = -1;
        if (direction & 4) y = 1;
        if (direction & 8) x = 1;

        // normalize input vector
        int length = std::sqrt(x * x + y * y);
        if (length != 0) {
            x /= length;
            y /= length;
        }

        const int speed = 5;

        b2Vec2 inputVector = b2Vec2(x, y);
        b2Vec2 velocity = b2Vec2(inputVector.x * speed, inputVector.y * speed);

        b2Body* body =
            m_entityManager.getRegistry().get<Components::Body>(entity).body;

        body->SetLinearVelocity(velocity);
        body->SetTransform(body->GetTransform().p, angle);
    }
}

// TODO: i dont really like how this iterates over the clients and not the
// camera components.
void GameServer::cameraSystem() {
    std::lock_guard<std::mutex> lock(m_clientsMutex);

    for (auto& c : m_clients) {
        Client& client = *c.second;

        entt::registry& reg = m_entityManager.getRegistry();

        Components::Camera& cam = reg.get<Components::Camera>(client.m_entity);

        // set cam.position to target position
        if (reg.valid(cam.target)) {
            b2Body* body = reg.get<Components::Body>(cam.target).body;
            cam.position = body->GetPosition();
        }
    }
}