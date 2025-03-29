
#include "GameServer.hpp"

#include <box2d/b2_math.h>

#include <chrono>
#include <iostream>
#include <thread>

#include "SocketServer.hpp"
#include "Systems.hpp"
#include "client/Client.hpp"
#include "ecs/EntityManager.hpp"
#include "ecs/components.hpp"
#include "physics/PhysicsWorld.hpp"

GameServer::GameServer() noexcept : m_running(false) { start(); }

GameServer::~GameServer() {
    stop();
    if (m_serverThread.joinable()) {
        m_serverThread.join();
    }
}

void GameServer::start() {
    m_running = true;
    m_serverThread = std::thread(&GameServer::run, this);
}

void GameServer::stop() { m_running = false; }

void GameServer::run() {
    std::cout << "starting game server!" << std::endl;
    const double tickRate = 10.0;
    const std::chrono::duration<double> tickInterval(1.0 / tickRate);

    auto lastTime = std::chrono::steady_clock::now();

    while (m_running) {
        auto currentTime = std::chrono::steady_clock::now();
        std::chrono::duration<double> deltaTime = currentTime - lastTime;
        lastTime = currentTime;

        tick(deltaTime.count());

        std::this_thread::sleep_for(tickInterval);
    }
}

void GameServer::processMessages() {
    SocketServer& socketServer = Systems::socketServer();

    std::lock_guard<std::mutex> lock(clientsMutex);

    for (auto& message : socketServer.m_messages) {
        uint32_t id = message.first;
        std::string_view data = message.second;

        auto it = clients.find(id);
        if (it != clients.end()) {
            Client* client = it->second;
            client->onMessage(data);
        } else {
            std::cout << "Client with ID " << id << " not found" << std::endl;
        }
    }

    socketServer.m_messages.clear();
}

void GameServer::tick(double delta) {
    processMessages();

    Systems::physicsWorld().tick(delta);

    clientInput();

    Systems::entityManager().removeEntities();

    updateClientCameras();

    syncClients();
}

void GameServer::updateClientCameras() {
    std::lock_guard<std::mutex> lock(clientsMutex);

    auto& registry = Systems::entityManager().getRegistry();

    for (auto& c : clients) {
        Client& client = *c.second;
    }
}

void GameServer::syncClients() {
    std::lock_guard<std::mutex> lock(clientsMutex);

    for (auto& c : clients) {
        Client& client = *c.second;

        client.sendBytes();
    }
}

void GameServer::clientInput() {
    auto view = Systems::entityManager()
                    .getRegistry()
                    .view<Components::Input, Components::Body>();

    for (auto entity : view) {
        uint8_t direction = Systems::entityManager()
                                .getRegistry()
                                .get<Components::Input>(entity)
                                .direction;

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

        b2Body* body = Systems::entityManager()
                           .getRegistry()
                           .get<Components::Body>(entity)
                           .body;

        body->SetLinearVelocity(velocity);
    }
}