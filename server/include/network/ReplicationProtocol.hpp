#pragma once

#include <cstdint>
#include <cmath>
#include <stdexcept>

#include "protocol/generated.hpp"

namespace replication {
constexpr std::uint16_t Position = 1U << 0U;
constexpr std::uint16_t Velocity = 1U << 1U;
constexpr std::uint16_t BodyYaw = 1U << 2U;
constexpr std::uint16_t AimPitch = 1U << 3U;
constexpr std::uint16_t Grounded = 1U << 4U;
constexpr std::uint16_t StateFlags = 1U << 5U;
constexpr std::uint16_t EquippedWeapon = 1U << 6U;
constexpr std::uint16_t Stance = 1U << 7U;
constexpr std::uint16_t MovementMode = 1U << 8U;
constexpr std::uint16_t All = (1U << 9U) - 1U;

inline bool validUpdatedEntity(const protocol::UpdatedEntity& value) {
    if (value.changeMask == 0U || (value.changeMask & ~All) != 0U) return false;
    return static_cast<bool>(value.changeMask & Position) == value.position.has_value() &&
           static_cast<bool>(value.changeMask & Velocity) == value.velocity.has_value() &&
           static_cast<bool>(value.changeMask & BodyYaw) == value.bodyYaw.has_value() &&
           static_cast<bool>(value.changeMask & AimPitch) == value.aimPitch.has_value() &&
           static_cast<bool>(value.changeMask & Grounded) == value.grounded.has_value() &&
           static_cast<bool>(value.changeMask & StateFlags) == value.stateFlags.has_value() &&
           static_cast<bool>(value.changeMask & EquippedWeapon) == value.equippedWeapon.has_value() &&
           static_cast<bool>(value.changeMask & Stance) == value.stance.has_value() &&
           static_cast<bool>(value.changeMask & MovementMode) == value.movementMode.has_value();
}

inline bool validMovementState(const protocol::MovementState& value) {
    const auto timer = [](float seconds, float maximum) {
        return std::isfinite(seconds) && seconds >= 0.0F && seconds <= maximum;
    };
    const auto vector = [](const protocol::Vec3& value) {
        return std::isfinite(value.x) && std::isfinite(value.y) && std::isfinite(value.z);
    };
    return timer(value.modeTimeRemaining, 10.0F) &&
           timer(value.dashCooldownRemaining, 60.0F) &&
           timer(value.slideCooldownRemaining, 60.0F) &&
           timer(value.weaponLockRemaining, 10.0F) &&
           vector(value.dashDirection) && vector(value.mantleStart) &&
           vector(value.mantleTarget);
}

inline void validateSnapshotDelta(const protocol::SnapshotDelta& value) {
    if (value.baselineReset && value.baselineSequence != 0U)
        throw protocol::ProtocolError("invalid SnapshotDelta reset baseline");
    if (!validMovementState(value.local.movementState))
        throw protocol::ProtocolError("invalid authoritative movement state");
    for (const auto& update : value.updated)
        if (!validUpdatedEntity(update))
            throw protocol::ProtocolError("SnapshotDelta field mask mismatch");
}
}  // namespace replication
