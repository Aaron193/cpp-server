#include "Systems.hpp"

#include "GameServer.hpp"
#include "SocketServer.hpp"
#include "ecs/EntityManager.hpp"
#include "physics/PhysicsWorld.hpp"

/**
 Service Locator Pattern
*/

std::unique_ptr<EntityManager> Systems::s_entityManager = nullptr;
std::unique_ptr<GameServer> Systems::s_gameServer = nullptr;
std::unique_ptr<PhysicsWorld> Systems::s_physicsWorld = nullptr;
std::unique_ptr<SocketServer> Systems::s_socketServer = nullptr;

void Systems::initialize(uint16_t port) {
    s_socketServer = std::make_unique<SocketServer>(port);
    s_gameServer = std::make_unique<GameServer>();
    s_physicsWorld = std::make_unique<PhysicsWorld>();
    s_entityManager = std::make_unique<EntityManager>();
}

EntityManager& Systems::entityManager() {
    if (!s_entityManager) {
        throw std::runtime_error("EntityManager not initialized");
    }
    return *s_entityManager;
}

GameServer& Systems::gameServer() {
    if (!s_gameServer) {
        throw std::runtime_error("GameServer not initialized");
    }
    return *s_gameServer;
}

PhysicsWorld& Systems::physicsWorld() {
    if (!s_physicsWorld) {
        throw std::runtime_error("PhysicsWorld not initialized");
    }
    return *s_physicsWorld;
}

SocketServer& Systems::socketServer() {
    if (!s_socketServer) {
        throw std::runtime_error("SocketServer not initialized");
    }
    return *s_socketServer;
}

void Systems::shutdown() {
    s_socketServer.reset();
    s_gameServer.reset();
    s_physicsWorld.reset();
    s_entityManager.reset();
}