#include "RaycastSystem.hpp"

#include <box2d/box2d.h>

#include <cmath>

#include "common/enums.hpp"
#include "ecs/components.hpp"

RaycastSystem::RaycastSystem(entt::registry& registry, b2WorldId worldId)
    : m_registry(registry), m_worldId(worldId) {}

RayHit RaycastSystem::FireBullet(entt::entity shooter, glm::vec2 origin,
                                 glm::vec2 direction, float maxDistance) {
    // Normalize direction
    float len =
        std::sqrt(direction.x * direction.x + direction.y * direction.y);
    if (len > 0.0f) {
        direction.x /= len;
        direction.y /= len;
    }

    RayHit result;
    result.fraction = 1.0f;
    result.hit = false;

    b2Vec2 p1 = {origin.x, origin.y};
    b2Vec2 p2 = {origin.x + direction.x * maxDistance,
                 origin.y + direction.y * maxDistance};

    // Create AABB for ray line segment
    b2AABB rayAABB;
    rayAABB.lowerBound = {std::min(p1.x, p2.x), std::min(p1.y, p2.y)};
    rayAABB.upperBound = {std::max(p1.x, p2.x), std::max(p1.y, p2.y)};

    // Iterate through all entities and test ray intersection
    auto allShapesView = m_registry.view<Components::EntityBase>();
    for (auto entity : allShapesView) {
        auto& base = allShapesView.get<Components::EntityBase>(entity);
        if (B2_IS_NULL(base.bodyId)) continue;
        if (entity == shooter) continue;

        int shapeCount = b2Body_GetShapeCount(base.bodyId);
        b2ShapeId* shapes = new b2ShapeId[shapeCount];
        b2Body_GetShapes(base.bodyId, shapes, shapeCount);

        for (int i = 0; i < shapeCount; ++i) {
            b2ShapeId shapeId = shapes[i];
            b2Filter shapeFilter = b2Shape_GetFilter(shapeId);

            // Check if this shape is something bullets should collide with
            if (!(shapeFilter.categoryBits & MASK_BULLET)) {
                continue;
            }

            // Get shape AABB and check intersection with ray
            b2AABB shapeAABB = b2Shape_GetAABB(shapeId);
            if (shapeAABB.lowerBound.x <= rayAABB.upperBound.x &&
                shapeAABB.upperBound.x >= rayAABB.lowerBound.x &&
                shapeAABB.lowerBound.y <= rayAABB.upperBound.y &&
                shapeAABB.upperBound.y >= rayAABB.lowerBound.y) {
                // Simple distance check for closest hit
                b2Vec2 entityPos = b2Body_GetPosition(base.bodyId);
                float diffX = entityPos.x - p1.x;
                float diffY = entityPos.y - p1.y;
                float distSq = diffX * diffX + diffY * diffY;
                float maxDistSq = maxDistance * maxDistance;

                if (distSq < maxDistSq) {
                    float dist = std::sqrt(distSq);
                    float fraction = dist / maxDistance;

                    if (fraction < result.fraction) {
                        result.fraction = fraction;
                        result.point = {entityPos.x, entityPos.y};
                        result.normal = {diffX / dist, diffY / dist};
                        result.category = shapeFilter.categoryBits;
                        result.hit = true;
                        result.entity = entity;
                    }
                }
            }
        }
        delete[] shapes;
    }

    // Don't hit yourself
    if (result.entity == shooter) {
        result.hit = false;
        result.entity = entt::null;
    }

    return result;
}

bool RaycastSystem::HasLineOfSight(glm::vec2 from, glm::vec2 to) {
    b2Vec2 p1 = {from.x, from.y};
    b2Vec2 p2 = {to.x, to.y};

    // Check if there's a wall or cover between the two points
    auto baseView = m_registry.view<Components::EntityBase>();
    for (auto entity : baseView) {
        auto& base = baseView.get<Components::EntityBase>(entity);
        if (B2_IS_NULL(base.bodyId)) continue;

        int shapeCount = b2Body_GetShapeCount(base.bodyId);
        b2ShapeId* shapes = new b2ShapeId[shapeCount];
        b2Body_GetShapes(base.bodyId, shapes, shapeCount);

        for (int i = 0; i < shapeCount; ++i) {
            b2ShapeId shapeId = shapes[i];
            b2Filter filter = b2Shape_GetFilter(shapeId);

            // Only check walls and cover
            if (filter.categoryBits & (CAT_WALL | CAT_COVER)) {
                b2AABB shapeAABB = b2Shape_GetAABB(shapeId);

                // Simple AABB intersection with line segment
                b2AABB rayAABB;
                rayAABB.lowerBound = {std::min(p1.x, p2.x),
                                      std::min(p1.y, p2.y)};
                rayAABB.upperBound = {std::max(p1.x, p2.x),
                                      std::max(p1.y, p2.y)};

                if (shapeAABB.lowerBound.x <= rayAABB.upperBound.x &&
                    shapeAABB.upperBound.x >= rayAABB.lowerBound.x &&
                    shapeAABB.lowerBound.y <= rayAABB.upperBound.y &&
                    shapeAABB.upperBound.y >= rayAABB.lowerBound.y) {
                    delete[] shapes;
                    return false;
                }
            }
        }
        delete[] shapes;
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
        glm::vec2 endpoint = {position.x + direction.x * testDistance,
                              position.y + direction.y * testDistance};

        // Test if we can see the full distance or hit something
        if (HasLineOfSight(position, endpoint)) {
            maxDistance = std::max(maxDistance, testDistance);
        } else {
            // Binary search for closest obstacle
            float minDist = 0.0f;
            float maxDist = testDistance;
            for (int j = 0; j < 5; ++j) {
                float midDist = (minDist + maxDist) * 0.5f;
                glm::vec2 midPoint = {position.x + direction.x * midDist,
                                      position.y + direction.y * midDist};
                if (HasLineOfSight(position, midPoint)) {
                    minDist = midDist;
                } else {
                    maxDist = midDist;
                }
            }
            maxDistance = std::max(maxDistance, minDist);
        }
    }

    return maxDistance;
}
