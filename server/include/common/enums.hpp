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
};

enum NewsType : uint8_t {
    TEXT,
    KILL,
};