#include "physics/PhysicsWorld.hpp"

#include <box2d/b2_body.h>
#include <box2d/b2_fixture.h>
#include <box2d/b2_world.h>

#include "GameServer.hpp"
#include "ecs/EntityManager.hpp"
#include "ecs/components.hpp"

PhysicsWorld::PhysicsWorld(GameServer& gameServer)
    : m_world(std::make_unique<b2World>(b2Vec2(0.0f, 0.0f))),
      m_gameServer(gameServer),
      m_queryCallback(new QueryNetworkedEntities(gameServer)) {}

void PhysicsWorld::tick(double delta) { m_world->Step(delta, 8, 3); }

QueryNetworkedEntities::QueryNetworkedEntities(GameServer& gameServer)
    : m_gameServer(gameServer) {}

void QueryNetworkedEntities::Clear() { entities.clear(); }

bool QueryNetworkedEntities::ReportFixture(b2Fixture* fixture) {
    b2Body* body = fixture->GetBody();

    if (body && body->GetUserData().pointer) {
        EntityBodyUserData* userData =
            reinterpret_cast<EntityBodyUserData*>(body->GetUserData().pointer);
        // Ensure the entity is networked before adding
        entt::registry& reg = m_gameServer.m_entityManager.getRegistry();
        if (reg.valid(userData->entity) &&
            reg.all_of<Components::Networked>(userData->entity)) {
            entities.push_back(userData->entity);
        }
    }

    return true;
}