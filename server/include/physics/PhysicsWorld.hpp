#pragma once

#include <box2d/b2_world.h>

#include <entt/entity/fwd.hpp>
#include <memory>
#include <optional>
#include <vector>

#include "ecs/EntityManager.hpp"
#include "ecs/components.hpp"

class QueryBodies;
class QueryNetworkedEntities;
class ContactListener;

class PhysicsWorld {
   public:
    PhysicsWorld(GameServer& gameServer);

    void tick(double delta);

    std::unique_ptr<b2World> m_world;

    ContactListener* m_contactListener;
    QueryBodies* m_queryBodies;
    QueryNetworkedEntities* m_QueryNetworkedEntities;

    GameServer& m_gameServer;

   private:
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