export const enum ClientHeader {
    SPAWN,
    MOUSE,
    MOVEMENT,
    MOUSE_DOWN,
    MOUSE_UP,
}

export const enum ServerHeader {
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
}
