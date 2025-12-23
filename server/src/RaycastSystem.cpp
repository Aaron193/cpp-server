#include "RaycastSystem.hpp"

#include <box2d/b2_fixture.h>
#include <box2d/b2_world.h>

#include <cmath>

#include "common/enums.hpp"
#include "ecs/EntityManager.hpp"

BulletRaycastCallback::BulletRaycastCallback(entt::registry& registry)
    : m_registry(registry) {}

float BulletRaycastCallback::ReportFixture(b2Fixture* fixture,
                                           const b2Vec2& point,
                                           const b2Vec2& normal,
                                           float fraction) {
    const auto& filter = fixture->GetFilterData();

    // Check if this fixture is something bullets should collide with
    if (!(filter.categoryBits & MASK_BULLET)) {
        return -1.0f;  // Continue through this fixture
    }

    // Only record the closest hit
    if (fraction < m_result.fraction) {
        m_result.fraction = fraction;
        m_result.point = {point.x, point.y};
        m_result.normal = {normal.x, normal.y};
        m_result.category = filter.categoryBits;
        m_result.hit = true;

        // Try to get the entity from user data
        b2Body* body = fixture->GetBody();
        if (body->GetUserData().pointer != 0) {
            EntityBodyUserData* userData =
                reinterpret_cast<EntityBodyUserData*>(
                    body->GetUserData().pointer);
            m_result.entity = userData->entity;
        }
    }

    // Return fraction to continue checking for closer hits
    return fraction;
}

RaycastSystem::RaycastSystem(entt::registry& registry, b2World& physicsWorld)
    : m_registry(registry), m_physicsWorld(physicsWorld) {}

RayHit RaycastSystem::FireBullet(entt::entity shooter, glm::vec2 origin,
                                 glm::vec2 direction, float maxDistance) {
    // Normalize direction
    float len = std::sqrt(direction.x * direction.x + direction.y * direction.y);
    if (len > 0.0f) {
        direction.x /= len;
        direction.y /= len;
    }

    glm::vec2 end = origin + direction * maxDistance;

    BulletRaycastCallback callback(m_registry);

    b2Vec2 p1(origin.x, origin.y);
    b2Vec2 p2(end.x, end.y);

    m_physicsWorld.RayCast(&callback, p1, p2);

    RayHit result = callback.GetResult();

    // Don't hit yourself
    if (result.entity == shooter) {
        result.hit = false;
        result.entity = entt::null;
    }

    return result;
}

bool RaycastSystem::HasLineOfSight(glm::vec2 from, glm::vec2 to) {
    BulletRaycastCallback callback(m_registry);

    b2Vec2 p1(from.x, from.y);
    b2Vec2 p2(to.x, to.y);

    m_physicsWorld.RayCast(&callback, p1, p2);

    // If we hit a wall or cover, no LOS
    if (callback.HasHit()) {
        uint16_t category = callback.GetResult().category;
        if (category & (CAT_WALL | CAT_COVER)) {
            return false;
        }
    }

    return true;
}

float RaycastSystem::ComputeLongestSightline(glm::vec2 position,
                                             int numAngles) {
    float maxDistance = 0.0f;
    constexpr float testDistance = 50.0f;  // Test up to 50 tiles

    for (int i = 0; i < numAngles; i++) {
        float angle = (2.0f * M_PI * i) / numAngles;
        glm::vec2 direction(std::cos(angle), std::sin(angle));

        BulletRaycastCallback callback(m_registry);
        glm::vec2 end = position + direction * testDistance;

        b2Vec2 p1(position.x, position.y);
        b2Vec2 p2(end.x, end.y);

        m_physicsWorld.RayCast(&callback, p1, p2);

        float distance = callback.HasHit() ? callback.GetResult().fraction * testDistance
                                            : testDistance;
        maxDistance = std::max(maxDistance, distance);
    }

    return maxDistance;
}
