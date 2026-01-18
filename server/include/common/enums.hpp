#pragma once

#include <cstdint>

enum ClientHeader : uint8_t {
    SPAWN,
    MOUSE,
    MOVEMENT,
    MOUSE_DOWN,
    MOUSE_UP,
    CLIENT_CHAT,
};

enum ServerHeader : uint8_t {
    SPAWN_SUCCESS,
    SET_CAMERA,
    ENTITY_CREATE,
    ENTITY_UPDATE,
    ENTITY_REMOVE,
    PLAYER_JOIN,
    PLAYER_LEAVE,
    ENTITY_STATE,
    HEALTH,
    DIED,
    TPS,
    NEWS,
    SERVER_CHAT,
    MAP_INIT,
    BIOME_CREATE,
};

enum NewsType : uint8_t {
    TEXT,
    KILL,
};

enum AmmoType : uint8_t {
    AMMO_LIGHT,
    AMMO_HEAVY,
    AMMO_SHELL,
    AMMO_ROCKET,
    AMMO_COUNT,
};

enum GunFireMode : uint8_t {
    FIRE_HITSCAN,
    FIRE_PROJECTILE,
};

// Collision system for Box2D filtering
enum CollisionCategory : uint16_t {
    CAT_PLAYER = 1 << 0,
    CAT_WALL = 1 << 1,
    CAT_COVER = 1 << 2,
    CAT_WATER = 1 << 3,
    CAT_BULLET = 1 << 4,
};

enum CollisionMask : uint16_t {
    MASK_PLAYER_MOVE = CAT_WALL,
    MASK_BULLET = CAT_WALL | CAT_COVER | CAT_PLAYER,
};