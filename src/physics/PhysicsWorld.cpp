#include "physics/PhysicsWorld.hpp"

PhysicsWorld::PhysicsWorld() noexcept {
    m_world = new b2World(b2Vec2(0.0f, 0.0f));
}

PhysicsWorld::~PhysicsWorld() { delete m_world; }

void PhysicsWorld::tick(double delta) { m_world->Step(delta, 8, 3); }