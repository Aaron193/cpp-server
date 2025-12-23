#pragma once

#include <box2d/b2_world_callbacks.h>

#include <entt/entt.hpp>
#include <glm/glm.hpp>

class b2World;

// Result of a raycast
struct RayHit {
    entt::entity entity = entt::null;
    glm::vec2 point = {0.0f, 0.0f};
    glm::vec2 normal = {0.0f, 0.0f};
    float fraction = 1.0f;
    uint16_t category = 0;
    bool hit = false;
};

// Raycast callback for bullets
class BulletRaycastCallback : public b2RayCastCallback {
   public:
    BulletRaycastCallback(entt::registry& registry);

    float ReportFixture(b2Fixture* fixture, const b2Vec2& point,
                        const b2Vec2& normal, float fraction) override;

    RayHit GetResult() const { return m_result; }
    bool HasHit() const { return m_result.hit; }

   private:
    entt::registry& m_registry;
    RayHit m_result;
};

// Raycast system for Line of Sight and bullets
class RaycastSystem {
   public:
    RaycastSystem(entt::registry& registry, b2World& physicsWorld);

    // Fire a bullet raycast
    RayHit FireBullet(entt::entity shooter, glm::vec2 origin,
                      glm::vec2 direction, float maxDistance);

    // Check if there is line of sight between two points
    bool HasLineOfSight(glm::vec2 from, glm::vec2 to);

    // Compute longest sightline from a point
    float ComputeLongestSightline(glm::vec2 position, int numAngles = 8);

   private:
    entt::registry& m_registry;
    b2World& m_physicsWorld;
};
