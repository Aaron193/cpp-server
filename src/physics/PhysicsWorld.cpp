#include "physics/PhysicsWorld.hpp"

#include <box2d/b2_world.h>

PhysicsWorld::PhysicsWorld() noexcept
    : m_world(std::make_unique<b2World>(b2Vec2(0.0f, 0.0f))) {}

void PhysicsWorld::tick(double delta) { m_world->Step(delta, 8, 3); }