#pragma once

#include <memory>

#include "GameServer.hpp"

// Forward declarations
class EntityManager;
class GameServer;
class PhysicsWorld;
class SocketServer;

class Systems {
   private:
    static std::unique_ptr<EntityManager> s_entityManager;
    static std::unique_ptr<GameServer> s_gameServer;
    static std::unique_ptr<PhysicsWorld> s_physicsWorld;
    static std::unique_ptr<SocketServer> s_socketServer;

   public:
    static void initialize(uint16_t port);

    static EntityManager& entityManager();
    static GameServer& gameServer();
    static PhysicsWorld& physicsWorld();
    static SocketServer& socketServer();

    static void shutdown();
};