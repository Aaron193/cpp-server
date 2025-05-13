#include "ecs/EntityManager.hpp"

#include <box2d/b2_circle_shape.h>
#include <box2d/b2_fixture.h>

#include <entt/entt.hpp>

#include "Systems.hpp"
#include "ecs/components.hpp"
#include "physics/PhysicsWorld.hpp"
#include "util/units.hpp"

using namespace Components;

entt::entity EntityManager::createSpectator(entt::entity followee) {
    entt::entity entity = m_registry.create();

    m_registry.emplace<Type>(entity, EntityTypes::SPECTATOR);

    if (followee == entt::null) {
        followee = getFollowEntity();
    }

    m_registry.emplace<Camera>(entity, followee);

    return entity;
}

entt::entity EntityManager::createPlayer() {
    entt::entity entity = m_registry.create();

    m_registry.emplace<Type>(entity, EntityTypes::PLAYER);
    auto& bodyComponent = m_registry.emplace<Body>(entity);
    m_registry.emplace<Dynamic>(entity);
    m_registry.emplace<Networked>(entity);
    m_registry.emplace<Camera>(entity, entity);
    m_registry.emplace<Input>(entity);

    b2World* world = Systems::physicsWorld().m_world.get();

    // Define the body
    b2BodyDef bodyDef;
    bodyDef.type = b2_dynamicBody;
    bodyDef.position.Set(meters(0.0), meters(0.0));
    bodyDef.fixedRotation = true;

    // Assign User Data to point to our entity
    EntityBodyUserData* userData = new EntityBodyUserData{entity};
    bodyDef.userData.pointer = reinterpret_cast<uintptr_t>(userData);

    // Create the b2Body and assign it to our component's 'body' member
    bodyComponent.body = world->CreateBody(&bodyDef);

    // Create circular shape
    b2CircleShape circle;
    circle.m_radius = meters(25.0 / 2.0);

    // Add shape to a fixture
    b2FixtureDef fixtureDef;
    fixtureDef.shape = &circle;
    fixtureDef.density = 1.0f;
    fixtureDef.friction = 0.0f;
    fixtureDef.restitution = 0.0f;
    fixtureDef.isSensor = false;

    // TODO: setup filter collision bitmasks

    bodyComponent.body->CreateFixture(&fixtureDef);

    return entity;
}

void EntityManager::scheduleForRemoval(entt::entity entity) {
    m_registry.emplace<Removal>(entity);
}

void EntityManager::removeEntities() {
    m_registry.view<Removal>().each([this](auto entity) {
        Components::Body& bodyComponent = m_registry.get<Body>(entity);
        if (bodyComponent.body) {
            EntityBodyUserData* userData =
                reinterpret_cast<EntityBodyUserData*>(
                    bodyComponent.body->GetUserData().pointer);
            delete userData;
            bodyComponent.body->SetUserData(nullptr);
            Systems::physicsWorld().m_world->DestroyBody(bodyComponent.body);
        }
        bodyComponent.body = nullptr;

        m_registry.destroy(entity);
    });
}

entt::entity EntityManager::getFollowEntity() {
    auto view = m_registry.view<Body, Dynamic, Networked>();

    // "random" entity for now
    for (auto entity : view) {
        return entity;
    }

    return entt::null;
}