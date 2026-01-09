#pragma once

#include <uwebsockets/WebSocket.h>
#include <uwebsockets/WebSocketData.h>

#include <cstdint>
#include <entt/entt.hpp>
#include <unordered_set>

#include "common/enums.hpp"
#include "packet/buffer/PacketReader.hpp"
#include "packet/buffer/PacketWriter.hpp"

// forward declaration
class GameServer;

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
    bool m_sentTerrainMeshes = false;
    std::unordered_set<entt::entity> m_previousVisibleEntities;
    std::unordered_set<size_t> m_previousVisibleBiomes;

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
    void onChat();

    void updateCamera();

    void writeGameState();
    void sendBytes();

   private:
    void sendTerrainMeshes();

   private:
    GameServer& m_gameServer;
};