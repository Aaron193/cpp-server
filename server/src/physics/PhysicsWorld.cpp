#include "physics/PhysicsWorld.hpp"

#include <box2d/b2_body.h>
#include <box2d/b2_fixture.h>
#include <box2d/b2_world.h>

#include "Systems.hpp"
#include "ecs/EntityManager.hpp"
#include "ecs/components.hpp"

PhysicsWorld::PhysicsWorld() noexcept
    : m_world(std::make_unique<b2World>(b2Vec2(0.0f, 0.0f))),
      m_queryCallback(new QueryNetworkedEntities()) {}

void PhysicsWorld::tick(double delta) { m_world->Step(delta, 8, 3); }

bool QueryNetworkedEntities::ReportFixture(b2Fixture* fixture) {
    // if body is not networked, we skip it
    entt::entity entity = (reinterpret_cast<EntityBodyUserData*>(
                               fixture->GetBody()->GetUserData().pointer))
                              ->entity;
    entt::registry& reg = Systems::entityManager().getRegistry();

    // query networked entities
    if (reg.any_of<Components::Networked>(entity)) {
        bodies.push_back(fixture->GetBody());
    }

    return true;
}