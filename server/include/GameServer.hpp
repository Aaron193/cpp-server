#pragma once

#include <uwebsockets/Loop.h>

#include <glm/glm.hpp>
#include <memory>
#include <mutex>

#include "RaycastSystem.hpp"
#include "ServerRegistration.hpp"
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

    // Server registration
    ServerRegistration* m_serverRegistration = nullptr;
    double m_heartbeatTimer = 0.0;
    const double m_heartbeatInterval = 5.0;  // seconds

    void run();
    void setServerRegistration(ServerRegistration* registration);

   private:
    void processClientMessages();
    void tick(double delta);
    void prePhysicsSystemUpdate(double delta);
    void postPhysicsSystemUpdate(double delta);
    void biomeSystem();
    void stateSystem();
    void inputSystem(double delta);
    void meleeSystem(double delta);
    void gunSystem(double delta);
    void projectileSystem(double delta);
    void projectileImpactSystem();
    void cameraSystem();
    void healthSystem(double delta);

    void Hit(entt::entity entity, b2Vec2& meleePos, int radius);
    void applyDamage(entt::entity attacker, entt::entity target, float damage);
    void Die(entt::entity entity);

    void broadcastKill(entt::entity subject);
    void broadcastMessage(const std::string& message);
    void broadcastBulletTrace(entt::entity shooter, glm::vec2 start,
                              glm::vec2 end);

    void processJobs();
    void updateHeartbeat(double delta);
};