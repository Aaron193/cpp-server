#include "SocketServer.hpp"

#include <uwebsockets/App.h>

#include "client/Client.hpp"

uint32_t id = 0;

SocketServer::SocketServer(uint16_t port) : m_port(port) {
    uWS::App()
        .ws<WebSocketData>(
            "/*",
            {.open =
                 [&](auto* ws) {
                     std::lock_guard<std::mutex> lock(clientsMutex);
                     Client* client = new Client(ws, id++);
                     clients.emplace(client->m_id, client);

                     auto* data = (WebSocketData*)ws->getUserData();
                     data->id = client->m_id;

                     std::cout << "Connection opened" << std::endl;
                 },
             .message =
                 [&](auto* ws, std::string_view message, uWS::OpCode opCode) {
                     if (opCode != uWS::OpCode::BINARY) return;

                     auto* data = (WebSocketData*)ws->getUserData();
                     uint32_t id = data->id;

                     std::lock_guard<std::mutex> lock(clientsMutex);
                     auto it = clients.find(id);

                     if (it != clients.end()) {
                         Client* client = it->second;
                         client->onMessage(message);
                     } else {
                         std::cout << "Client with ID " << id << " not found"
                                   << std::endl;
                     }
                 },
             .close =
                 [&](auto* ws, int code, std::string_view message) {
                     auto* data = (WebSocketData*)ws->getUserData();
                     uint32_t id = data->id;

                     std::lock_guard<std::mutex> lock(clientsMutex);
                     auto it = clients.find(id);
                     if (it != clients.end()) {
                         delete it->second;
                         clients.erase(it);
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