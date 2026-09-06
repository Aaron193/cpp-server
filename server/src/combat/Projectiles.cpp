#include <algorithm>
#include <cmath>

#include "GameServer.hpp"
#include "client/Client.hpp"
#include "ecs/components.hpp"

void GameServer::updateProjectiles(float delta) {
    if (matchPhase_ != protocol::MatchPhase::Active) {
        for (auto& p : projectiles_) p.active = false;
        return;
    }
    for (auto& p : projectiles_) {
        if (!p.active) continue;
        const glm::vec3 step =
            p.velocity * delta +
            glm::vec3{0, -.5F * p.gravity * delta * delta, 0};
        const float length = glm::length(step);
        if (length < .0001F) {
            p.active = false;
            continue;
        }
        const glm::vec3 direction = step / length;
        const float distance = std::min(length, p.range - p.traveled);
        const auto world =
            m_physicsWorld.castStaticRay(p.position, direction, distance);
        float nearest = world ? world->distance : distance;
        entt::entity target = entt::null;
        glm::vec3 hitPosition = world ? world->position : glm::vec3{},
                  normal = world ? world->normal : glm::vec3{};
        if (!history_.empty())
            for (const auto& player : history_.back().players) {
                if (player.entity == p.shooter || player.dead) continue;
                const auto hit = CombatGeometry::rayCapsule(
                    p.position, direction, player.capsule, nearest);
                if (hit && hit->distance < nearest) {
                    nearest = hit->distance;
                    target = player.entity;
                    hitPosition = hit->position;
                    normal = hit->normal;
                }
            }
        if (world || target != entt::null) {
            emitReliable(
                std::nullopt,
                protocol::Impact{static_cast<std::uint32_t>(m_currentTick),
                                 p.shotId,
                                 p.pellet,
                                 {hitPosition.x, hitPosition.y, hitPosition.z},
                                 {normal.x, normal.y, normal.z},
                                 target == entt::null
                                     ? protocol::ImpactMaterial::World
                                     : protocol::ImpactMaterial::Player});
            if (target != entt::null) {
                const float falloff = std::clamp(
                    1.F - (p.traveled + nearest - 25.F) / 300.F, .6F, 1.F);
                pendingDamage_.push_back(
                    {p.shooter, target, p.damage * falloff, p.weapon});
                ++combatMetrics_.pelletHits;
            }
            p.active = false;
            continue;
        }
        p.position += direction * distance;
        p.velocity.y -= p.gravity * delta;
        p.traveled += distance;
        if (p.traveled >= p.range) p.active = false;
    }
}
