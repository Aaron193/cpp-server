#include "physics/PhysicsWorld.hpp"

#include <box2d/box2d.h>

#include "GameServer.hpp"
#include "ecs/EntityManager.hpp"
#include "ecs/components.hpp"

PhysicsWorld::PhysicsWorld(GameServer& gameServer) : m_gameServer(gameServer) {
    b2WorldDef worldDef = b2DefaultWorldDef();
    worldDef.gravity = {0.0f, 0.0f};
    m_worldId = b2CreateWorld(&worldDef);
}

PhysicsWorld::~PhysicsWorld() {
    if (B2_IS_NON_NULL(m_worldId)) {
        b2DestroyWorld(m_worldId);
        m_worldId = b2_nullWorldId;
    }
}

void PhysicsWorld::tick(double delta) { b2World_Step(m_worldId, delta, 4); }
