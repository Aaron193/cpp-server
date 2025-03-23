
#include "GameServer.hpp"

#include <chrono>
#include <iostream>
#include <thread>

#include "client/Client.hpp"

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

void GameServer::tick(double delta) {
    m_physicsWorld.tick(delta);

    std::lock_guard<std::mutex> lock(clientsMutex);

    for (auto& c : clients) {
        Client& client = *c.second;

        client.m_position.x += client.m_velocity.x;
        client.m_position.y += client.m_velocity.y;

        // std::cout << "User " << client.m_name << " is at " <<
        // client.m_position.x
        //           << ", " << client.m_position.y << std::endl;
    }

    for (auto& c : clients) {
        Client& client = *c.second;

        client.sendBytes();
    }
}