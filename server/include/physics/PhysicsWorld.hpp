#pragma once

#include <box2d/b2_world.h>

#include <entt/entity/fwd.hpp>
#include <memory>
#include <vector>

#include "ecs/EntityManager.hpp"

class QueryNetworkedEntities : public b2QueryCallback {
   public:
    QueryNetworkedEntities(GameServer& gameServer);
    std::vector<entt::entity> entities;
    void Clear();
    bool ReportFixture(b2Fixture* fixture) override;

    GameServer& m_gameServer;
};

class PhysicsWorld {
   public:
    PhysicsWorld(GameServer& gameServer);

    void tick(double delta);

    std::unique_ptr<b2World> m_world;

    QueryNetworkedEntities* m_queryCallback;

    GameServer& m_gameServer;

   private:
};
