#pragma once

#include <box2d/box2d.h>

#include <entt/entity/fwd.hpp>

#include "ecs/EntityManager.hpp"

// User data for terrain shapes to identify which mesh they belong to
struct TerrainShapeUserData {
    size_t meshIndex;
};

class PhysicsWorld {
   public:
    PhysicsWorld(GameServer& gameServer);
    ~PhysicsWorld();

    void tick(double delta);

    b2WorldId m_worldId;

    GameServer& m_gameServer;

   private:
};