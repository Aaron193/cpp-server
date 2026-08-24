#pragma once

#include <cstdint>

enum NewsType : uint8_t {
    TEXT,
    KILL,
};

enum AmmoType : uint8_t {
    LIGHT,
    HEAVY,
    SHELL,
    ROCKET,
    COUNT,
};

enum GunFireMode : uint8_t {
    FIRE_HITSCAN,
    FIRE_PROJECTILE,
};

enum ItemType : uint8_t {
    ITEM_NONE,
    GUN_RIFLE,
    GUN_SHOTGUN,
};
