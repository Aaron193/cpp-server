#pragma once

#include <uwebsockets/WebSocket.h>
#include <uwebsockets/WebSocketData.h>

#include <cstdint>
#include <unordered_map>

#include "packet/buffer/PacketReader.hpp"
#include "packet/buffer/PacketWriter.hpp"
#include "util/Vec2.hpp"

struct WebSocketData {
    uint32_t id;
};

class Client {
   public:
    uint32_t m_id;
    uWS::WebSocket<false, true, WebSocketData>* m_ws;
    PacketReader m_reader;
    PacketWriter m_writer;

    std::string m_name;
    bool m_active = false;
    float m_angle;
    Vec2<uint32_t> m_position = Vec2<uint32_t>(0, 0);
    Vec2<uint32_t> m_velocity = Vec2<uint32_t>(0, 0);

    Client(uWS::WebSocket<false, true, WebSocketData>* ws, uint32_t id);
    ~Client();

    void onMessage(const std::string_view& message);

    void onSpawn();
    void onMovement();
    void onMouse();

    void sendBytes();

   private:
};

extern std::unordered_map<uint32_t, Client*> clients;
extern std::mutex clientsMutex;

enum ClientHeader { SPAWN, MOUSE, MOVEMENT };
enum ServerHeader { SPAWN_SUCCESS, CLIENT_CONNECT, CLIENT_DISCONNECT };
