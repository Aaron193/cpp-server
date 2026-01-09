#include "ecs/EntityManager.hpp"

#include <box2d/box2d.h>

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

    // Define the body
    b2BodyDef bodyDef = b2DefaultBodyDef();
    bodyDef.type = b2_dynamicBody;

    // Spawn at center of island
    // World is 512x512 heightmap pixels, each = 1 tile (64px)
    // Center of island is typically around (256, 256) in heightmap coords
    // In game coords that's (256*64, 256*64) = (16384, 16384)
    constexpr float TILE_SIZE = 64.0f;
    constexpr float WORLD_SIZE_HEIGHTMAP = 512.0f;  // Heightmap is 512x512
    float spawnX =
        (WORLD_SIZE_HEIGHTMAP / 2.0f) * TILE_SIZE;  // Center of island
    float spawnY = (WORLD_SIZE_HEIGHTMAP / 2.0f) * TILE_SIZE;

    // float spawnX = 0.0f;
    // float spawnY = 0.0f;
    bodyDef.position = {meters(spawnX), meters(spawnY)};
    bodyDef.fixedRotation = true;

    // Assign User Data to point to our entity
    EntityBodyUserData* userData = new EntityBodyUserData{entity};
    bodyDef.userData = reinterpret_cast<void*>(userData);

    // Create the b2Body and assign it to our component's 'bodyId' member
    base.bodyId = b2CreateBody(m_gameServer.m_physicsWorld.m_worldId, &bodyDef);

    // Create circular shape
    b2ShapeDef shapeDef = b2DefaultShapeDef();
    shapeDef.density = 1.0f;
    shapeDef.isSensor = false;
    shapeDef.filter.categoryBits = CAT_PLAYER;
    shapeDef.filter.maskBits = MASK_PLAYER_MOVE | CAT_PLAYER;

    b2Circle circle = {{0.0f, 0.0f}, meters(25.0f)};
    b2CreateCircleShape(base.bodyId, &shapeDef, &circle);

    return entity;
}

entt::entity EntityManager::createCrate() {
    entt::entity entity = m_registry.create();

    auto& base = m_registry.emplace<EntityBase>(entity, EntityTypes::CRATE);
    m_registry.emplace<Networked>(entity);

    // Define the body
    b2BodyDef bodyDef = b2DefaultBodyDef();
    bodyDef.type = b2_staticBody;

    float x = static_cast<float>(rand()) / (float)RAND_MAX * 1500.0f;
    float y = static_cast<float>(rand()) / (float)RAND_MAX * 1500.0f;
    bodyDef.position = {meters(x), meters(y)};
    bodyDef.fixedRotation = true;

    // Assign User Data to point to our entity
    EntityBodyUserData* userData = new EntityBodyUserData{entity};
    bodyDef.userData = reinterpret_cast<void*>(userData);

    // Create the b2Body and assign it to our component's 'bodyId' member
    base.bodyId = b2CreateBody(m_gameServer.m_physicsWorld.m_worldId, &bodyDef);

    // Create box shape
    b2ShapeDef shapeDef = b2DefaultShapeDef();
    shapeDef.density = 1.0f;
    shapeDef.isSensor = false;

    float halfWidth = meters(50.0f);
    float halfHeight = meters(50.0f);
    b2Polygon box = b2MakeBox(halfWidth, halfHeight);
    b2CreatePolygonShape(base.bodyId, &shapeDef, &box);

    return entity;
}

entt::entity EntityManager::createBush() {
    entt::entity entity = m_registry.create();

    auto& base = m_registry.emplace<EntityBase>(entity, EntityTypes::BUSH);
    m_registry.emplace<Networked>(entity);
    base.variant = getRandomVariant(EntityTypes::BUSH);

    // Define the body
    b2BodyDef bodyDef = b2DefaultBodyDef();
    bodyDef.type = b2_staticBody;

    float x = static_cast<float>(rand()) / (float)RAND_MAX * 1500.0f;
    float y = static_cast<float>(rand()) / (float)RAND_MAX * 1500.0f;
    bodyDef.position = {meters(x), meters(y)};
    bodyDef.fixedRotation = true;

    // Assign User Data to point to our entity
    EntityBodyUserData* userData = new EntityBodyUserData{entity};
    bodyDef.userData = reinterpret_cast<void*>(userData);

    // Create the b2Body and assign it to our component's 'bodyId' member
    base.bodyId = b2CreateBody(m_gameServer.m_physicsWorld.m_worldId, &bodyDef);

    // Create circle shape
    b2ShapeDef shapeDef = b2DefaultShapeDef();
    shapeDef.density = 1.0f;
    shapeDef.isSensor = false;

    b2Circle circle = {{0.0f, 0.0f}, meters(50.0f)};
    b2CreateCircleShape(base.bodyId, &shapeDef, &circle);

    return entity;
}

entt::entity EntityManager::createRock() {
    entt::entity entity = m_registry.create();

    auto& base = m_registry.emplace<EntityBase>(entity, EntityTypes::ROCK);
    m_registry.emplace<Networked>(entity);
    base.variant = getRandomVariant(EntityTypes::ROCK);

    // Define the body
    b2BodyDef bodyDef = b2DefaultBodyDef();
    bodyDef.type = b2_staticBody;

    float x = static_cast<float>(rand()) / (float)RAND_MAX * 1500.0f;
    float y = static_cast<float>(rand()) / (float)RAND_MAX * 1500.0f;
    bodyDef.position = {meters(x), meters(y)};
    bodyDef.fixedRotation = true;

    // Assign User Data to point to our entity
    EntityBodyUserData* userData = new EntityBodyUserData{entity};
    bodyDef.userData = reinterpret_cast<void*>(userData);

    // Create the b2Body and assign it to our component's 'bodyId' member
    base.bodyId = b2CreateBody(m_gameServer.m_physicsWorld.m_worldId, &bodyDef);

    // Create circle shape
    b2ShapeDef shapeDef = b2DefaultShapeDef();
    shapeDef.density = 1.0f;
    shapeDef.isSensor = false;

    b2Circle circle = {{0.0f, 0.0f}, meters(50.0f)};
    b2CreateCircleShape(base.bodyId, &shapeDef, &circle);

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
    b2BodyDef bodyDef = b2DefaultBodyDef();
    bodyDef.type = destructible ? b2_dynamicBody : b2_staticBody;
    bodyDef.position = {meters(x), meters(y)};
    bodyDef.fixedRotation = true;

    base.bodyId = b2CreateBody(m_gameServer.m_physicsWorld.m_worldId, &bodyDef);

    EntityBodyUserData* userData = new EntityBodyUserData();
    userData->entity = entity;
    b2Body_SetUserData(base.bodyId, reinterpret_cast<void*>(userData));

    // Create box collider
    b2ShapeDef shapeDef = b2DefaultShapeDef();
    shapeDef.density = 1.0f;
    shapeDef.filter.categoryBits = CAT_WALL;
    shapeDef.filter.maskBits = MASK_PLAYER_MOVE | MASK_BULLET;

    b2Polygon boxShape = b2MakeBox(meters(50.0f), meters(50.0f));
    b2CreatePolygonShape(base.bodyId, &shapeDef, &boxShape);

    return entity;
}

entt::entity EntityManager::createFence(float x, float y) {
    entt::entity entity = m_registry.create();

    auto& base = m_registry.emplace<EntityBase>(entity, EntityTypes::FENCE);
    m_registry.emplace<Networked>(entity);

    // Create Box2D body (static)
    b2BodyDef bodyDef = b2DefaultBodyDef();
    bodyDef.type = b2_staticBody;
    bodyDef.position = {meters(x), meters(y)};

    base.bodyId = b2CreateBody(m_gameServer.m_physicsWorld.m_worldId, &bodyDef);

    EntityBodyUserData* userData = new EntityBodyUserData();
    userData->entity = entity;
    b2Body_SetUserData(base.bodyId, reinterpret_cast<void*>(userData));

    // Create box collider (blocks bullets, not players)
    b2ShapeDef shapeDef = b2DefaultShapeDef();
    shapeDef.density = 0.0f;
    shapeDef.isSensor = false;
    shapeDef.filter.categoryBits = CAT_COVER;
    shapeDef.filter.maskBits = MASK_BULLET;  // Only blocks bullets

    b2Polygon boxShape = b2MakeBox(meters(40.0f), meters(10.0f));
    b2CreatePolygonShape(base.bodyId, &shapeDef, &boxShape);

    return entity;
}

entt::entity EntityManager::createTree(float x, float y) {
    entt::entity entity = m_registry.create();

    auto& base = m_registry.emplace<EntityBase>(entity, EntityTypes::TREE);
    base.variant = getRandomVariant(EntityTypes::TREE);
    m_registry.emplace<Networked>(entity);

    // Create Box2D body (static)
    b2BodyDef bodyDef = b2DefaultBodyDef();
    bodyDef.type = b2_staticBody;
    bodyDef.position = {meters(x), meters(y)};

    base.bodyId = b2CreateBody(m_gameServer.m_physicsWorld.m_worldId, &bodyDef);

    EntityBodyUserData* userData = new EntityBodyUserData();
    userData->entity = entity;
    b2Body_SetUserData(base.bodyId, reinterpret_cast<void*>(userData));

    // Create circle collider
    b2ShapeDef shapeDef = b2DefaultShapeDef();
    shapeDef.density = 0.0f;
    shapeDef.isSensor = false;
    shapeDef.filter.categoryBits = CAT_WALL;
    shapeDef.filter.maskBits = MASK_PLAYER_MOVE | MASK_BULLET;

    b2Circle circleShape = {{0.0f, 0.0f}, meters(30.0f)};
    b2CreateCircleShape(base.bodyId, &shapeDef, &circleShape);

    return entity;
}

void EntityManager::scheduleForRemoval(entt::entity entity) {
    m_registry.emplace<Removal>(entity);
}

void EntityManager::removeEntities() {
    m_registry.view<Removal>().each([this](entt::entity entity) {
        if (auto* base = m_registry.try_get<Components::EntityBase>(entity)) {
            if (B2_IS_NON_NULL(base->bodyId)) {
                void* userData = b2Body_GetUserData(base->bodyId);
                if (userData) {
                    delete reinterpret_cast<EntityBodyUserData*>(userData);
                }
                b2DestroyBody(base->bodyId);
                base->bodyId = b2_nullBodyId;
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
