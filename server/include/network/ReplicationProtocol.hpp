#pragma once

#include <cstdint>
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
constexpr std::uint16_t All = (1U << 7U) - 1U;

inline bool validUpdatedEntity(const protocol::UpdatedEntity& value) {
    if (value.changeMask == 0U || (value.changeMask & ~All) != 0U) return false;
    return static_cast<bool>(value.changeMask & Position) == value.position.has_value() &&
           static_cast<bool>(value.changeMask & Velocity) == value.velocity.has_value() &&
           static_cast<bool>(value.changeMask & BodyYaw) == value.bodyYaw.has_value() &&
           static_cast<bool>(value.changeMask & AimPitch) == value.aimPitch.has_value() &&
           static_cast<bool>(value.changeMask & Grounded) == value.grounded.has_value() &&
           static_cast<bool>(value.changeMask & StateFlags) == value.stateFlags.has_value() &&
           static_cast<bool>(value.changeMask & EquippedWeapon) == value.equippedWeapon.has_value();
}

inline void validateSnapshotDelta(const protocol::SnapshotDelta& value) {
    if (value.baselineReset && value.baselineSequence != 0U)
        throw protocol::ProtocolError("invalid SnapshotDelta reset baseline");
    for (const auto& update : value.updated)
        if (!validUpdatedEntity(update))
            throw protocol::ProtocolError("SnapshotDelta field mask mismatch");
}
}  // namespace replication
