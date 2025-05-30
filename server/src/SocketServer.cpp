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
                     mutex_lock_t lock(m_gameServer.m_clientsMutex);

                     Client* client = new Client(m_gameServer, ws, id++, lock);
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

                     mutex_lock_t lock(m_gameServer.m_clientsMutex);

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

                     mutex_lock_t lock(m_gameServer.m_clientsMutex);

                     auto it = m_gameServer.m_clients.find(id);
                     if (it != m_gameServer.m_clients.end()) {
                         Client* client = it->second;
                         m_gameServer.m_entityManager.scheduleForRemoval(
                             client->m_entity);

                         // remove this client's messages
                         m_gameServer.m_messages.erase(
                             std::remove_if(m_gameServer.m_messages.begin(),
                                            m_gameServer.m_messages.end(),
                                            [id](const auto& message) {
                                                return message.first == id;
                                            }),
                             m_gameServer.m_messages.end());

                         // todo: setup all client logic on disconnect to be in
                         // this method.. also do same with onopen, etc (if
                         // needed).
                         client->onClose(lock);
                         delete client;
                         m_gameServer.m_clients.erase(it);
                     }

                     std::cout << "WebSocket closed, client deleted"
                               << std::endl;
                 }})
        .get("/",
             [](auto* res, auto* req) {
                 // hello
                 res->end("Welcome to the homepage!");
             })
        .listen(this->m_port,
                [this](auto* socket) {
                    if (socket) {
                        m_gameServer.m_socketLoop = uWS::Loop::get();
                    } else {
                        std::cerr << "Failed to listen on port " << this->m_port
                                  << std::endl;
                    }
                })
        .run();
}