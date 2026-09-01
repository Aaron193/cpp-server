#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>

#include "GameConfig.hpp"
#include "protocol/generated.hpp"

namespace Aiming {

constexpr float kDegreesToRadians = 0.01745329251994329577F;

struct State {
    protocol::Weapon weapon = protocol::Weapon::None;
    float aimProgress = 0.0F;
    float bloomRadians = 0.0F;
    float spreadRadians = 0.0F;
    float recoilPitch = 0.0F;
    float recoilYaw = 0.0F;
    float secondsSinceShot = 1000.0F;
    std::uint32_t recoilSequence = 0U;
    std::uint32_t patternIndex = 0U;
};

inline float mix(float first, float second, float amount) {
    return first + (second - first) * std::clamp(amount, 0.0F, 1.0F);
}

inline std::uint32_t hash(std::uint32_t value) {
    value ^= value >> 16U;
    value *= 0x7feb352dU;
    value ^= value >> 15U;
    value *= 0x846ca68bU;
    value ^= value >> 16U;
    return value;
}

inline float signedUnit(std::uint32_t seed, std::uint32_t player,
                        std::uint32_t sequence, std::uint32_t salt) {
    const auto bits = hash(seed ^ hash(player + 0x9e3779b9U) ^
                           hash(sequence + salt));
    return static_cast<float>(bits & 0x00ffffffU) / 8388607.5F - 1.0F;
}

inline float computeSpread(const State& state,
                           const WeaponConfig::AimProfile& profile,
                           float horizontalSpeedRatio, bool grounded,
                           protocol::Stance stance) {
    const float base = mix(profile.hipSpreadRadians,
                           profile.adsSpreadRadians, state.aimProgress);
    const float moving = mix(profile.hipMoveSpreadRadians,
                             profile.adsMoveSpreadRadians, state.aimProgress) *
                         std::pow(std::clamp(horizontalSpeedRatio, 0.0F, 1.5F), 2.0F);
    float result = base + moving + (grounded ? 0.0F : profile.airborneSpreadRadians);
    if (stance == protocol::Stance::Crouched) result *= profile.crouchMultiplier;
    else if (stance == protocol::Stance::Prone) result *= profile.proneMultiplier;
    return std::max(0.0F, result + state.bloomRadians);
}

inline void step(State& state, const WeaponConfig::AimProfile& profile,
                 bool intent, bool eligible, float horizontalSpeedRatio,
                 bool grounded, protocol::Stance stance, float deltaSeconds) {
    const float delta = std::clamp(deltaSeconds, 0.0F, 0.1F);
    const float target = intent && eligible ? 1.0F : 0.0F;
    const float duration = target > state.aimProgress
                               ? profile.aimInSeconds
                               : profile.aimOutSeconds;
    const float amount = duration > 0.0F ? delta / duration : 1.0F;
    state.aimProgress = target > state.aimProgress
                            ? std::min(target, state.aimProgress + amount)
                            : std::max(target, state.aimProgress - amount);
    state.secondsSinceShot = std::min(1000.0F, state.secondsSinceShot + delta);
    if (state.secondsSinceShot >= profile.bloomDelaySeconds)
        state.bloomRadians = std::max(
            0.0F, state.bloomRadians - profile.bloomRecoveryRadiansPerSecond * delta);
    if (state.secondsSinceShot >= profile.recoilRecoveryDelaySeconds) {
        const float recovery = std::exp(-profile.recoilRecoveryRate * delta);
        state.recoilPitch *= recovery;
        state.recoilYaw *= recovery;
    }
    if (state.secondsSinceShot >= profile.recoilResetSeconds)
        state.patternIndex = 0U;
    state.spreadRadians = computeSpread(state, profile, horizontalSpeedRatio,
                                        grounded, stance);
}

inline void acceptedShot(State& state,
                         const WeaponConfig::AimProfile& profile,
                         std::uint32_t seed, std::uint32_t player) {
    if (state.secondsSinceShot >= profile.recoilResetSeconds)
        state.patternIndex = 0U;
    const std::size_t pitchIndex = std::min<std::size_t>(
        state.patternIndex, profile.recoilPitchDegrees.size() - 1U);
    const std::size_t yawIndex = state.patternIndex % profile.recoilYawDegrees.size();
    const float multiplier = mix(1.0F, profile.adsRecoilMultiplier,
                                 state.aimProgress);
    const std::uint32_t sequence = state.recoilSequence + 1U;
    const float pitchDegrees = profile.recoilPitchDegrees[pitchIndex] +
        signedUnit(seed, player, sequence, 0x68bc21ebU) *
            profile.recoilVariationPitchDegrees;
    const float yawDegrees = profile.recoilYawDegrees[yawIndex] +
        signedUnit(seed, player, sequence, 0x02e5be93U) *
            profile.recoilVariationYawDegrees;
    state.recoilPitch += pitchDegrees * kDegreesToRadians * multiplier;
    state.recoilYaw += yawDegrees * kDegreesToRadians * multiplier;
    state.bloomRadians = std::min(profile.bloomMaxRadians,
                                  state.bloomRadians + profile.bloomPerShotRadians);
    state.secondsSinceShot = 0.0F;
    state.recoilSequence = sequence;
    ++state.patternIndex;
}

}  // namespace Aiming
