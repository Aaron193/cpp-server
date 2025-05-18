#pragma once

#include <mutex>

#include "ecs/EntityManager.hpp"
#include "physics/PhysicsWorld.hpp"

class Client;
class GameServer {
   public:
    GameServer();
    ~GameServer() = default;

    EntityManager m_entityManager;
    PhysicsWorld m_physicsWorld;
    std::unordered_map<uint32_t, Client*> m_clients;
    std::mutex m_clientsMutex;

    // incoming network messages
    std::vector<std::pair<uint32_t, std::string>> m_messages;

    void run();

   private:
    void processClientMessages();
    void tick(double delta);
    void prePhysicsSystemUpdate();
    void inputSystem();
    void cameraSystem();
};