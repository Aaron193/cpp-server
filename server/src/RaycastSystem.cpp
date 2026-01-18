#include "RaycastSystem.hpp"

#include <box2d/box2d.h>

#include <cmath>

#include "common/enums.hpp"
#include "ecs/EntityManager.hpp"

namespace {
struct RaycastContext {
    entt::entity shooter = entt::null;
    RayHit result;
};

float RaycastCallback(b2ShapeId shapeId, b2Vec2 point, b2Vec2 normal,
                      float fraction, void* context) {
    auto* ctx = reinterpret_cast<RaycastContext*>(context);

    b2BodyId bodyId = b2Shape_GetBody(shapeId);
    void* userData = b2Body_GetUserData(bodyId);
    if (userData) {
        auto* entityData = reinterpret_cast<EntityBodyUserData*>(userData);
        if (entityData->entity == ctx->shooter) {
            return -1.0f;
        }
    }

    b2Filter filter = b2Shape_GetFilter(shapeId);

    if (fraction < ctx->result.fraction) {
        ctx->result.fraction = fraction;
        ctx->result.point = {point.x, point.y};
        ctx->result.normal = {normal.x, normal.y};
        ctx->result.category = filter.categoryBits;
        ctx->result.hit = true;
        ctx->result.entity = entt::null;

        if (userData) {
            auto* entityData = reinterpret_cast<EntityBodyUserData*>(userData);
            ctx->result.entity = entityData->entity;
        }
    }

    return fraction;
}
}  // namespace

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

    RaycastContext ctx;
    ctx.shooter = shooter;
    ctx.result.fraction = 1.0f;
    ctx.result.hit = false;

    b2Vec2 p1 = {origin.x, origin.y};
    b2Vec2 translation = {direction.x * maxDistance, direction.y * maxDistance};

    b2QueryFilter filter = b2DefaultQueryFilter();
    filter.categoryBits = CAT_BULLET;
    filter.maskBits = MASK_BULLET;

    b2World_CastRay(m_worldId, p1, translation, filter, RaycastCallback, &ctx);

    return ctx.result;
}

bool RaycastSystem::HasLineOfSight(glm::vec2 from, glm::vec2 to) {
    b2Vec2 p1 = {from.x, from.y};
    b2Vec2 p2 = {to.x, to.y};

    b2Vec2 translation = {p2.x - p1.x, p2.y - p1.y};

    b2QueryFilter filter = b2DefaultQueryFilter();
    filter.categoryBits = CAT_BULLET;
    filter.maskBits = (CAT_WALL | CAT_COVER);

    b2RayResult result =
        b2World_CastRayClosest(m_worldId, p1, translation, filter);
    return !result.hit;
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
