#include "ecs/EntityManager.hpp"

#include <box2d/b2_circle_shape.h>
#include <box2d/b2_fixture.h>
#include <box2d/b2_polygon_shape.h>

#include <entt/entt.hpp>

#include "GameServer.hpp"
#include "common/enums.hpp"
#include "ecs/components.hpp"
#include "physics/PhysicsWorld.hpp"
#include "util/units.hpp"

using namespace Components;

EntityManager::EntityManager(GameServer& gameServer)
    : m_gameServer(gameServer) {
    m_variants[EntityTypes::BUSH] = 2;
    m_variants[EntityTypes::ROCK] = 2;
    m_variants[EntityTypes::CRATE] = 0;
    m_variants[EntityTypes::PLAYER] = 0;
    m_variants[EntityTypes::SPECTATOR] = 0;
    m_variants[EntityTypes::WALL] = 0;
    m_variants[EntityTypes::FENCE] = 0;
    m_variants[EntityTypes::TREE] = 2;
}

uint8_t EntityManager::getVariantCount(EntityTypes type) {
    assert(m_variants.count(type));
    return m_variants[type];
}

uint8_t EntityManager::getRandomVariant(EntityTypes type) {
    uint8_t variants = getVariantCount(type);
    return (rand() % variants) + 1;
}

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

    // Spawn at center of island
    // World is 512x512 heightmap pixels, each = 1 tile (64px)
    // Center of island is typically around (256, 256) in heightmap coords
    // In game coords that's (256*64, 256*64) = (16384, 16384)
    constexpr float TILE_SIZE = 64.0f;
    constexpr float WORLD_SIZE_HEIGHTMAP = 512.0f;  // Heightmap is 512x512
    float spawnX = (WORLD_SIZE_HEIGHTMAP / 2.0f) * TILE_SIZE;  // Center of island
    float spawnY = (WORLD_SIZE_HEIGHTMAP / 2.0f) * TILE_SIZE;
    
    bodyDef.position.Set(meters(spawnX), meters(spawnY));
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
    fixtureDef.filter.categoryBits = CAT_PLAYER;
    fixtureDef.filter.maskBits = MASK_PLAYER_MOVE | CAT_PLAYER;

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

    float x = static_cast<float>(rand()) / (float)RAND_MAX * 1500.0f;
    float y = static_cast<float>(rand()) / (float)RAND_MAX * 1500.0f;
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
    base.variant = getRandomVariant(EntityTypes::BUSH);

    b2World* world = m_gameServer.m_physicsWorld.m_world.get();

    // Define the body
    b2BodyDef bodyDef;
    bodyDef.type = b2_staticBody;

    float x = static_cast<float>(rand()) / (float)RAND_MAX * 1500.0f;
    float y = static_cast<float>(rand()) / (float)RAND_MAX * 1500.0f;
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

entt::entity EntityManager::createRock() {
    entt::entity entity = m_registry.create();

    auto& base = m_registry.emplace<EntityBase>(entity, EntityTypes::ROCK);
    m_registry.emplace<Networked>(entity);
    base.variant = getRandomVariant(EntityTypes::ROCK);

    b2World* world = m_gameServer.m_physicsWorld.m_world.get();

    // Define the body
    b2BodyDef bodyDef;
    bodyDef.type = b2_staticBody;

    float x = static_cast<float>(rand()) / (float)RAND_MAX * 1500.0f;
    float y = static_cast<float>(rand()) / (float)RAND_MAX * 1500.0f;
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

entt::entity EntityManager::createWall(float x, float y, bool destructible) {
    entt::entity entity = m_registry.create();

    auto& base = m_registry.emplace<EntityBase>(entity, EntityTypes::WALL);
    m_registry.emplace<Networked>(entity);

    if (destructible) {
        Components::Destructible dest;
        dest.maxHealth = 100.0f;
        dest.currentHealth = 100.0f;
        m_registry.emplace<Components::Destructible>(entity, dest);
    }

    // Create Box2D body
    b2BodyDef bodyDef;
    bodyDef.type = destructible ? b2_dynamicBody : b2_staticBody;
    bodyDef.position.Set(meters(x), meters(y));
    bodyDef.fixedRotation = true;

    base.body = m_gameServer.m_physicsWorld.m_world->CreateBody(&bodyDef);

    EntityBodyUserData* userData = new EntityBodyUserData();
    userData->entity = entity;
    base.body->GetUserData().pointer =
        reinterpret_cast<uintptr_t>(userData);

    // Create box collider
    b2PolygonShape boxShape;
    boxShape.SetAsBox(meters(50.0f), meters(50.0f));

    b2FixtureDef fixtureDef;
    fixtureDef.shape = &boxShape;
    fixtureDef.density = 1.0f;
    fixtureDef.friction = 0.0f;
    fixtureDef.restitution = 0.0f;
    fixtureDef.filter.categoryBits = CAT_WALL;
    fixtureDef.filter.maskBits = MASK_PLAYER_MOVE | MASK_BULLET;

    base.body->CreateFixture(&fixtureDef);

    return entity;
}

entt::entity EntityManager::createFence(float x, float y) {
    entt::entity entity = m_registry.create();

    auto& base = m_registry.emplace<EntityBase>(entity, EntityTypes::FENCE);
    m_registry.emplace<Networked>(entity);

    // Create Box2D body (static)
    b2BodyDef bodyDef;
    bodyDef.type = b2_staticBody;
    bodyDef.position.Set(meters(x), meters(y));

    base.body = m_gameServer.m_physicsWorld.m_world->CreateBody(&bodyDef);

    EntityBodyUserData* userData = new EntityBodyUserData();
    userData->entity = entity;
    base.body->GetUserData().pointer =
        reinterpret_cast<uintptr_t>(userData);

    // Create box collider (blocks bullets, not players)
    b2PolygonShape boxShape;
    boxShape.SetAsBox(meters(40.0f), meters(10.0f));

    b2FixtureDef fixtureDef;
    fixtureDef.shape = &boxShape;
    fixtureDef.density = 0.0f;
    fixtureDef.friction = 0.0f;
    fixtureDef.restitution = 0.0f;
    fixtureDef.isSensor = false;
    fixtureDef.filter.categoryBits = CAT_COVER;
    fixtureDef.filter.maskBits = MASK_BULLET;  // Only blocks bullets

    base.body->CreateFixture(&fixtureDef);

    return entity;
}

entt::entity EntityManager::createTree(float x, float y) {
    entt::entity entity = m_registry.create();

    auto& base = m_registry.emplace<EntityBase>(entity, EntityTypes::TREE);
    base.variant = getRandomVariant(EntityTypes::TREE);
    m_registry.emplace<Networked>(entity);

    // Create Box2D body (static)
    b2BodyDef bodyDef;
    bodyDef.type = b2_staticBody;
    bodyDef.position.Set(meters(x), meters(y));

    base.body = m_gameServer.m_physicsWorld.m_world->CreateBody(&bodyDef);

    EntityBodyUserData* userData = new EntityBodyUserData();
    userData->entity = entity;
    base.body->GetUserData().pointer =
        reinterpret_cast<uintptr_t>(userData);

    // Create circle collider
    b2CircleShape circleShape;
    circleShape.m_radius = meters(30.0f);

    b2FixtureDef fixtureDef;
    fixtureDef.shape = &circleShape;
    fixtureDef.density = 0.0f;
    fixtureDef.friction = 0.0f;
    fixtureDef.restitution = 0.0f;
    fixtureDef.isSensor = false;
    fixtureDef.filter.categoryBits = CAT_WALL;
    fixtureDef.filter.maskBits = MASK_PLAYER_MOVE | MASK_BULLET;

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
