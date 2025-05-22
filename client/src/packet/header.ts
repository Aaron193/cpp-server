export const enum ClientHeader {
    SPAWN,
    MOUSE,
    MOVEMENT,
}

export const enum ServerHeader {
    SPAWN_SUCCESS,
    CLIENT_CONNECT,
    CLIENT_DISCONNECT,
    SET_CAMERA,
    ENTITY_CREATE,
    ENTITY_UPDATE,
    ENTITY_REMOVE,
}
