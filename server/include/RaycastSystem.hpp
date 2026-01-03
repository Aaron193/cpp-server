#pragma once

#include <box2d/box2d.h>

#include <entt/entt.hpp>
#include <glm/glm.hpp>

class b2WorldId;

// Result of a raycast
struct RayHit {
    entt::entity entity = entt::null;
    glm::vec2 point = {0.0f, 0.0f};
    glm::vec2 normal = {0.0f, 0.0f};
    float fraction = 1.0f;
    uint16_t category = 0;
    bool hit = false;
};

// Raycast system for Line of Sight and bullets
class RaycastSystem {
   public:
    RaycastSystem(entt::registry& registry, b2WorldId worldId);

    // Fire a bullet raycast
    RayHit FireBullet(entt::entity shooter, glm::vec2 origin,
                      glm::vec2 direction, float maxDistance);

    // Check if there is line of sight between two points
    bool HasLineOfSight(glm::vec2 from, glm::vec2 to);

    // Compute longest sightline from a point
    float ComputeLongestSightline(glm::vec2 position, int numAngles = 8);

   private:
    entt::registry& m_registry;
    b2WorldId m_worldId;
};
