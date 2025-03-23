#pragma once

#include <atomic>
#include <thread>

#include "ecs/EntityManager.hpp"
#include "physics/PhysicsWorld.hpp"

class GameServer {
   public:
    GameServer() noexcept;
    ~GameServer();

    void start();
    void stop();

   private:
    EntityManager m_entityManager;
    PhysicsWorld m_physicsWorld;

    std::thread m_serverThread;
    std::atomic<bool> m_running;

    void run();
    void tick(double delta);
};