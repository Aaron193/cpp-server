#pragma once

#include <uwebsockets/Loop.h>

#include <memory>
#include <mutex>

#include "RaycastSystem.hpp"
#include "World.hpp"
#include "client/Client.hpp"
#include "ecs/EntityManager.hpp"
#include "physics/PhysicsWorld.hpp"

class Client;
class GameServer {
   public:
    GameServer();
    ~GameServer() = default;

    uWS::Loop* m_socketLoop = nullptr;

    std::mutex m_gameMutex;

    const uint8_t m_tps = 10;

    EntityManager m_entityManager;
    PhysicsWorld m_physicsWorld;
    std::unique_ptr<World> m_worldGenerator;
    std::unique_ptr<RaycastSystem> m_raycastSystem;
    std::unordered_map<uint32_t, Client*> m_clients;
    std::vector<TerrainMesh> m_terrainMeshes;

    // incoming network messages
    std::vector<std::pair<uint32_t, std::string>> m_messages;

    void run();

   private:
    void processClientMessages();
    void tick(double delta);
    void prePhysicsSystemUpdate(double delta);
    void biomeSystem();
    void stateSystem();
    void inputSystem(double delta);
    void meleeSystem(double delta);
    void cameraSystem();
    void healthSystem(double delta);

    void Hit(entt::entity entity, b2Vec2& meleePos, int radius);
    void Die(entt::entity entity);

    void broadcastKill(entt::entity subject);
    void broadcastMessage(const std::string& message);

    void processJobs();
};