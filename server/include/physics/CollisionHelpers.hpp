#pragma once

#include <box2d/box2d.h>

namespace AABBCollision {

inline bool pointInAABB(const b2Vec2& point, const b2AABB& aabb) {
    return point.x >= aabb.lowerBound.x && point.x <= aabb.upperBound.x &&
           point.y >= aabb.lowerBound.y && point.y <= aabb.upperBound.y;
}

inline bool circleAABBOverlap(const b2Vec2& circleCenter, float radius,
                              const b2AABB& aabb) {
    return aabb.lowerBound.x <= circleCenter.x + radius &&
           aabb.upperBound.x >= circleCenter.x - radius &&
           aabb.lowerBound.y <= circleCenter.y + radius &&
           aabb.upperBound.y >= circleCenter.y - radius;
}
}  // namespace AABBCollision
