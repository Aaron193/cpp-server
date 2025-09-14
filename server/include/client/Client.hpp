#pragma once

#include <uwebsockets/WebSocket.h>
#include <uwebsockets/WebSocketData.h>

#include <cstdint>
#include <entt/entt.hpp>
#include <unordered_set>

#include "GameServer.hpp"
#include "packet/buffer/PacketReader.hpp"
#include "packet/buffer/PacketWriter.hpp"

struct WebSocketData {
    uint32_t id;
};

class Client {
   public:
    // unique id for each client
    uint32_t m_id;
    // entity may change throughout the lifetime of the client
    entt::entity m_entity;

    uWS::WebSocket<false, true, WebSocketData>* m_ws;
    PacketReader m_reader;
    PacketWriter m_writer;

    std::string m_name;
    // we are actively playing inside the game world, spectators are inactive
    bool m_active = false;
    std::unordered_set<entt::entity> m_previousVisibleEntities;

    Client(GameServer& gameServer,
           uWS::WebSocket<false, true, WebSocketData>* ws, uint32_t id);
    ~Client();

    void changeBody(entt::entity entity);

    void onMessage(const std::string_view& message);

    void onSpawn();
    void onClose();
    void onMovement();
    void onMouse();
    void onMouseClick(bool isDown);

    void updateCamera();

    void writeGameState();
    void sendBytes();

   private:
    GameServer& m_gameServer;
};

// TODO: put this somewhere else
enum ClientHeader {
    SPAWN,
    MOUSE,
    MOVEMENT,
    MOUSE_DOWN,
    MOUSE_UP,
};

enum ServerHeader {
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
};

enum NewsType {
    TEXT,
};