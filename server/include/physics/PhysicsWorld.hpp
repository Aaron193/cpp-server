#pragma once

#include <box2d/b2_world.h>

#include <entt/entity/fwd.hpp>
#include <memory>
#include <optional>
#include <vector>
#include <unordered_set>

#include "ecs/EntityManager.hpp"
#include "ecs/components.hpp"

class QueryBodies;
class QueryNetworkedEntities;
class QueryTerrainMeshes;
class ContactListener;

// User data for terrain fixtures to identify which mesh they belong to
struct TerrainFixtureUserData {
    size_t meshIndex;
};

class PhysicsWorld {
   public:
    PhysicsWorld(GameServer& gameServer);

    void tick(double delta);

    std::unique_ptr<b2World> m_world;

    ContactListener* m_contactListener;
    QueryBodies* m_queryBodies;
    QueryNetworkedEntities* m_QueryNetworkedEntities;
    QueryTerrainMeshes* m_queryTerrainMeshes;

    GameServer& m_gameServer;

   private:
};

class QueryTerrainMeshes : public b2QueryCallback {
   public:
    QueryTerrainMeshes(GameServer& gameServer);
    std::unordered_set<size_t> meshIndices;
    void Clear();
    bool ReportFixture(b2Fixture* fixture) override;

    GameServer& m_gameServer;
};
class QueryNetworkedEntities : public b2QueryCallback {
   public:
    QueryNetworkedEntities(GameServer& gameServer);
    std::vector<entt::entity> entities;
    void Clear();
    bool ReportFixture(b2Fixture* fixture) override;

    GameServer& m_gameServer;
};

class QueryBodies : public b2QueryCallback {
   public:
    QueryBodies(GameServer& gameServer);
    std::vector<entt::entity> entities;
    void Clear();
    bool ReportFixture(b2Fixture* fixture) override;

    GameServer& m_gameServer;
};

class ContactListener : public b2ContactListener {
   public:
    ContactListener(GameServer& gameServer);

    void BeginContact(b2Contact* contact) override;
    void EndContact(b2Contact* contact) override;
    void PreSolve(b2Contact* contact, const b2Manifold* oldManifold) override;

    GameServer& m_gameServer;

    std::optional<std::pair<entt::entity, entt::entity>> matchEntities(
        entt::entity entityA, entt::entity entityB, EntityTypes expectedA,
        EntityTypes expectedB);
};