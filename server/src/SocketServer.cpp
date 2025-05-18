#include "SocketServer.hpp"

#include <uwebsockets/App.h>

#include <cstdint>

#include "client/Client.hpp"

uint32_t id = 0;

SocketServer::SocketServer(GameServer& gameServer, uint16_t port)
    : m_port(port), m_gameServer(gameServer) {
    m_socketThread = std::thread(&SocketServer::run, this);
}

void SocketServer::run() {
    std::cout << "Starting socket server on port " << m_port << std::endl;
    uWS::App()
        .ws<WebSocketData>(
            "/*",
            {.open =
                 [&](auto* ws) {
                     std::lock_guard<std::mutex> lock(
                         m_gameServer.m_clientsMutex);

                     //  std::lock_guard<std::mutex> lock(clientsMutex);
                     Client* client = new Client(m_gameServer, ws, id++);
                     m_gameServer.m_clients.emplace(client->m_id, client);

                     auto* data = (WebSocketData*)ws->getUserData();
                     data->id = client->m_id;

                     std::cout << "Connection opened" << std::endl;
                 },
             .message =
                 [&](auto* ws, std::string_view message, uWS::OpCode opCode) {
                     if (opCode != uWS::OpCode::BINARY) return;

                     auto* data = (WebSocketData*)ws->getUserData();
                     uint32_t id = data->id;

                     std::lock_guard<std::mutex> lock(
                         m_gameServer.m_clientsMutex);

                     auto it = m_gameServer.m_clients.find(id);

                     if (it != m_gameServer.m_clients.end()) {
                         m_gameServer.m_messages.emplace_back(id, message);
                     } else {
                         std::cout << "Client with ID " << id << " not found"
                                   << std::endl;
                     }
                 },
             .close =
                 [&](auto* ws, int code, std::string_view message) {
                     auto* data = (WebSocketData*)ws->getUserData();
                     uint32_t id = data->id;

                     std::lock_guard<std::mutex> lock(
                         m_gameServer.m_clientsMutex);

                     auto it = m_gameServer.m_clients.find(id);
                     if (it != m_gameServer.m_clients.end()) {
                         delete it->second;
                         m_gameServer.m_clients.erase(it);
                     }

                     std::cout << "WebSocket closed, client deleted"
                               << std::endl;
                 }})
        .get("/",
             [](auto* res, auto* req) {
                 res->end("Welcome to the homepage!");
                 // hello
             })
        .listen(this->m_port, [](auto* socket) { /* your existing callback */ })
        .run();
}