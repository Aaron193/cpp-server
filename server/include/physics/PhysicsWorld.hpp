#pragma once

#include <box2d/b2_world.h>

#include <entt/entity/fwd.hpp>
#include <memory>
#include <vector>

#include "ecs/EntityManager.hpp"

class QueryBodies;
class QueryNetworkedBodies;

class PhysicsWorld {
   public:
    PhysicsWorld(GameServer& gameServer);

    void tick(double delta);

    std::unique_ptr<b2World> m_world;

    QueryBodies* m_queryBodies;
    QueryNetworkedBodies* m_queryNetworkedBodies;

    GameServer& m_gameServer;

   private:
};
class QueryNetworkedBodies : public b2QueryCallback {
   public:
    QueryNetworkedBodies(GameServer& gameServer);
    std::vector<entt::entity> entities;
    void Clear();
    bool ReportFixture(b2Fixture* fixture) override;

    GameServer& m_gameServer;
};
