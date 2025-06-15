#include "ecs/EntityManager.hpp"

#include <box2d/b2_circle_shape.h>
#include <box2d/b2_fixture.h>
#include <box2d/b2_polygon_shape.h>

#include <entt/entt.hpp>

#include "GameServer.hpp"
#include "ecs/components.hpp"
#include "physics/PhysicsWorld.hpp"
#include "util/units.hpp"

using namespace Components;

EntityManager::EntityManager(GameServer& gameServer)
    : m_gameServer(gameServer) {}

entt::entity EntityManager::createSpectator(entt::entity followee) {
    entt::entity entity = m_registry.create();

    m_registry.emplace<EntityBase>(entity, EntityTypes::SPECTATOR);

    if (followee == entt::null) {
        followee = getFollowEntity();
    }

    m_registry.emplace<Camera>(entity, followee);

    return entity;
}

entt::entity EntityManager::createPlayer() {
    entt::entity entity = m_registry.create();

    auto& base = m_registry.emplace<EntityBase>(entity, EntityTypes::PLAYER);
    m_registry.emplace<Networked>(entity);
    m_registry.emplace<State>(entity, EntityStates::IDLE);
    m_registry.emplace<Camera>(entity, entity);
    m_registry.emplace<Input>(entity);
    m_registry.emplace<Health>(entity, 100, 100);
    m_registry.emplace<AttackCooldown>(entity,
                                       1.0f / 3.0f);  // 333ms attack cooldown

    b2World* world = m_gameServer.m_physicsWorld.m_world.get();

    // Define the body
    b2BodyDef bodyDef;
    bodyDef.type = b2_dynamicBody;

    float x = static_cast<float>(rand()) / RAND_MAX * 10.0f;
    float y = static_cast<float>(rand()) / RAND_MAX * 10.0f;
    bodyDef.position.Set(meters(x), meters(y));
    bodyDef.fixedRotation = true;

    // Assign User Data to point to our entity
    EntityBodyUserData* userData = new EntityBodyUserData{entity};
    bodyDef.userData.pointer = reinterpret_cast<uintptr_t>(userData);

    // Create the b2Body and assign it to our component's 'body' member
    base.body = world->CreateBody(&bodyDef);

    // Create circular shape
    b2CircleShape circle;
    circle.m_radius = meters(25.0f);

    // Add shape to a fixture
    b2FixtureDef fixtureDef;
    fixtureDef.shape = &circle;
    fixtureDef.density = 1.0f;
    fixtureDef.friction = 0.0f;
    fixtureDef.restitution = 0.0f;
    fixtureDef.isSensor = false;

    // TODO: setup filter collision bitmasks

    base.body->CreateFixture(&fixtureDef);

    return entity;
}

entt::entity EntityManager::createCrate() {
    entt::entity entity = m_registry.create();

    auto& base = m_registry.emplace<EntityBase>(entity, EntityTypes::CRATE);
    m_registry.emplace<Networked>(entity);

    b2World* world = m_gameServer.m_physicsWorld.m_world.get();

    // Define the body
    b2BodyDef bodyDef;
    bodyDef.type = b2_staticBody;

    float x = static_cast<float>(rand()) / RAND_MAX * 1500.0f;
    float y = static_cast<float>(rand()) / RAND_MAX * 1500.0f;
    bodyDef.position.Set(meters(x), meters(y));
    bodyDef.fixedRotation = true;

    // Assign User Data to point to our entity
    EntityBodyUserData* userData = new EntityBodyUserData{entity};
    bodyDef.userData.pointer = reinterpret_cast<uintptr_t>(userData);

    // Create the b2Body and assign it to our component's 'body' member
    base.body = world->CreateBody(&bodyDef);

    // Create box shape
    b2PolygonShape box;
    float halfWidth = meters(50.0f);
    float halfHeight = meters(50.0f);
    box.SetAsBox(halfWidth, halfHeight);

    // Add shape to a fixture
    b2FixtureDef fixtureDef;
    fixtureDef.shape = &box;
    fixtureDef.density = 1.0f;
    fixtureDef.friction = 0.0f;
    fixtureDef.restitution = 0.0f;
    fixtureDef.isSensor = false;

    base.body->CreateFixture(&fixtureDef);

    return entity;
}

entt::entity EntityManager::createBush() {
    entt::entity entity = m_registry.create();

    auto& base = m_registry.emplace<EntityBase>(entity, EntityTypes::BUSH);
    m_registry.emplace<Networked>(entity);

    b2World* world = m_gameServer.m_physicsWorld.m_world.get();

    // Define the body
    b2BodyDef bodyDef;
    bodyDef.type = b2_staticBody;

    float x = static_cast<float>(rand()) / RAND_MAX * 1500.0f;
    float y = static_cast<float>(rand()) / RAND_MAX * 1500.0f;
    bodyDef.position.Set(meters(x), meters(y));
    bodyDef.fixedRotation = true;

    // Assign User Data to point to our entity
    EntityBodyUserData* userData = new EntityBodyUserData{entity};
    bodyDef.userData.pointer = reinterpret_cast<uintptr_t>(userData);

    // Create the b2Body and assign it to our component's 'body' member
    base.body = world->CreateBody(&bodyDef);

    // Create box shape
    b2CircleShape circle;
    circle.m_radius = meters(50.0f);

    // Add shape to a fixture
    b2FixtureDef fixtureDef;
    fixtureDef.shape = &circle;
    fixtureDef.density = 1.0f;
    fixtureDef.friction = 0.0f;
    fixtureDef.restitution = 0.0f;
    fixtureDef.isSensor = false;

    base.body->CreateFixture(&fixtureDef);

    return entity;
}

void EntityManager::scheduleForRemoval(entt::entity entity) {
    m_registry.emplace<Removal>(entity);
}

void EntityManager::removeEntities() {
    m_registry.view<Removal>().each([this](entt::entity entity) {
        if (auto* base = m_registry.try_get<Components::EntityBase>(entity)) {
            if (base->body) {
                if (base->body->GetUserData().pointer) {
                    delete reinterpret_cast<EntityBodyUserData*>(
                        base->body->GetUserData().pointer);
                    base->body->GetUserData().pointer = 0;
                }
                m_gameServer.m_physicsWorld.m_world->DestroyBody(base->body);
                base->body = nullptr;
            }
        }
    });

    auto view = m_registry.view<Removal>();
    m_registry.destroy(view.begin(), view.end());
}

// Right now this returns a player entity
// in future, maybe return any dynamic entity
entt::entity EntityManager::getFollowEntity() {
    auto view = m_registry.view<EntityBase, Networked>();

    for (auto entity : view) {
        auto& base = view.get<EntityBase>(entity);
        if (base.type == EntityTypes::PLAYER) {
            return entity;
        }
    }

    return entt::null;
}