#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <optional>

#include <glm/geometric.hpp>
#include <glm/vec3.hpp>

namespace CombatGeometry {

struct RayHit {
    float distance = 0.0F;
    glm::vec3 position{0.0F};
    glm::vec3 normal{0.0F};
};

struct Capsule {
    glm::vec3 a{0.0F};
    glm::vec3 b{0.0F};
    float radius = 0.0F;
};

inline std::optional<float> raySphere(const glm::vec3& origin,
                                      const glm::vec3& direction,
                                      const glm::vec3& center, float radius,
                                      float maxDistance) {
    const glm::vec3 offset = origin - center;
    const float b = glm::dot(offset, direction);
    const float c = glm::dot(offset, offset) - radius * radius;
    const float discriminant = b * b - c;
    if (discriminant < 0.0F) return std::nullopt;
    const float root = std::sqrt(discriminant);
    float distance = -b - root;
    if (distance < 0.0F) distance = -b + root;
    if (distance < 0.0F || distance > maxDistance) return std::nullopt;
    return distance;
}

// Analytic ray/capsule intersection. Direction must be normalized.
inline std::optional<RayHit> rayCapsule(const glm::vec3& origin,
                                        const glm::vec3& direction,
                                        const Capsule& capsule,
                                        float maxDistance) {
    if (!(capsule.radius > 0.0F) || !(maxDistance >= 0.0F) ||
        std::abs(glm::length(direction) - 1.0F) > 1.0e-3F)
        return std::nullopt;
    const glm::vec3 axis = capsule.b - capsule.a;
    const glm::vec3 offset = origin - capsule.a;
    const float axisLength2 = glm::dot(axis, axis);
    if (axisLength2 < 1.0e-8F) {
        const auto distance = raySphere(origin, direction, capsule.a,
                                        capsule.radius, maxDistance);
        if (!distance) return std::nullopt;
        const glm::vec3 point = origin + direction * *distance;
        return RayHit{*distance, point,
                      glm::normalize(point - capsule.a)};
    }

    const float axisRay = glm::dot(axis, direction);
    const float axisOffset = glm::dot(axis, offset);
    const float rayOffset = glm::dot(direction, offset);
    const float offset2 = glm::dot(offset, offset);
    const float a = axisLength2 - axisRay * axisRay;
    const float b = axisLength2 * rayOffset - axisOffset * axisRay;
    const float c = axisLength2 * offset2 - axisOffset * axisOffset -
                    capsule.radius * capsule.radius * axisLength2;
    if (std::abs(a) > 1.0e-8F) {
        const float discriminant = b * b - a * c;
        if (discriminant >= 0.0F) {
            const float distance = (-b - std::sqrt(discriminant)) / a;
            const float axial = axisOffset + distance * axisRay;
            if (distance >= 0.0F && distance <= maxDistance && axial > 0.0F &&
                axial < axisLength2) {
                const glm::vec3 point = origin + direction * distance;
                const glm::vec3 closest =
                    capsule.a + axis * (axial / axisLength2);
                return RayHit{distance, point,
                              glm::normalize(point - closest)};
            }
        }
    }

    std::optional<float> best;
    for (const glm::vec3 center : {capsule.a, capsule.b}) {
        const auto distance = raySphere(origin, direction, center,
                                        capsule.radius, maxDistance);
        if (distance && (!best || *distance < *best)) best = distance;
    }
    if (!best) return std::nullopt;
    const glm::vec3 point = origin + direction * *best;
    const float projection = std::clamp(
        glm::dot(point - capsule.a, axis) / axisLength2, 0.0F, 1.0F);
    const glm::vec3 closest = capsule.a + axis * projection;
    return RayHit{*best, point, glm::normalize(point - closest)};
}

inline std::uint32_t mix(std::uint32_t value) {
    value ^= value >> 16U;
    value *= 0x7feb352dU;
    value ^= value >> 15U;
    value *= 0x846ca68bU;
    return value ^ (value >> 16U);
}

inline float unitFloat(std::uint32_t value) {
    return static_cast<float>(mix(value) >> 8U) * (1.0F / 16777216.0F);
}

inline glm::vec3 spreadDirection(const glm::vec3& forward, float spreadRadians,
                                 std::uint32_t serverSeed,
                                 std::uint32_t shooterId,
                                 std::uint32_t shotId,
                                 std::uint32_t pellet) {
    const glm::vec3 normalized = glm::normalize(forward);
    if (!(spreadRadians > 0.0F)) return normalized;
    const std::uint32_t key = mix(serverSeed ^ mix(shooterId) ^
                                  mix(shotId * 0x9e3779b9U) ^ mix(pellet));
    const float radius = std::sqrt(unitFloat(key)) * std::tan(spreadRadians);
    constexpr float twoPi = 6.28318530717958647692F;
    const float angle = twoPi * unitFloat(key ^ 0xa511e9b3U);
    const glm::vec3 reference = std::abs(normalized.y) < 0.99F
                                    ? glm::vec3{0.0F, 1.0F, 0.0F}
                                    : glm::vec3{1.0F, 0.0F, 0.0F};
    const glm::vec3 right = glm::normalize(glm::cross(normalized, reference));
    const glm::vec3 up = glm::cross(right, normalized);
    return glm::normalize(normalized +
                          right * (radius * std::cos(angle)) +
                          up * (radius * std::sin(angle)));
}

inline bool tickBefore(std::uint32_t first, std::uint32_t second) {
    return first != second &&
           static_cast<std::int32_t>(first - second) < 0;
}

inline std::uint32_t clampHistoryTick(std::uint32_t requested,
                                      std::uint32_t oldest,
                                      std::uint32_t newest) {
    if (tickBefore(requested, oldest)) return oldest;
    if (tickBefore(newest, requested)) return newest;
    return requested;
}

}  // namespace CombatGeometry
