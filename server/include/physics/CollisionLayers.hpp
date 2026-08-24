#pragma once

#include <cstdint>

namespace CollisionLayers {

enum class Layer : std::uint8_t {
    StaticWorld = 0,
    Character,
    DynamicProp,
    Projectile,
    Trigger,
    QueryOnlyHitbox,
    Count,
};

constexpr bool isQueryOnly(Layer layer) {
    return layer == Layer::QueryOnlyHitbox;
}

constexpr bool shouldCollide(Layer first, Layer second) {
    if (first == Layer::QueryOnlyHitbox || second == Layer::QueryOnlyHitbox) {
        return false;
    }
    if (first == Layer::StaticWorld) {
        return second == Layer::Character || second == Layer::DynamicProp ||
               second == Layer::Projectile;
    }
    if (second == Layer::StaticWorld) {
        return shouldCollide(second, first);
    }
    if (first == Layer::Character) {
        return second == Layer::Character || second == Layer::DynamicProp ||
               second == Layer::Projectile || second == Layer::Trigger;
    }
    if (second == Layer::Character) {
        return shouldCollide(second, first);
    }
    if (first == Layer::DynamicProp) {
        return second == Layer::DynamicProp || second == Layer::Projectile ||
               second == Layer::Trigger;
    }
    if (second == Layer::DynamicProp) {
        return shouldCollide(second, first);
    }
    if (first == Layer::Projectile) {
        return second == Layer::Trigger;
    }
    if (second == Layer::Projectile) {
        return shouldCollide(second, first);
    }
    return false;
}

}  // namespace CollisionLayers
