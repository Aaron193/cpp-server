#include "SocketServer.hpp"

#include <uwebsockets/App.h>

#include <algorithm>
#include <cstdint>
#include <iostream>
#include <memory>
#include <optional>
#include <string>
#include <unordered_map>
#include <deque>

#include "client/Client.hpp"
#include "network/PeerTransport.hpp"
#include "protocol/generated.hpp"

namespace {
struct WebSocketData {
    std::uint32_t id = 0U;
    struct PendingClose {
        std::uint16_t code;
        std::string reason;
    };
    std::deque<std::vector<std::uint8_t>> pendingSends;
    std::size_t pendingSendBytes = 0U;
    std::optional<PendingClose> pendingClose;
};
using WebSocket = uWS::WebSocket<false, true, WebSocketData>;

class UwsPeerTransport final : public PeerTransport {
   public:
    explicit UwsPeerTransport(WebSocket* socket)
        : socket_(socket), data_(socket->getUserData()) {}

    void sendBinary(const std::vector<std::uint8_t>& bytes) override {
        data_->pendingSends.push_back(bytes);
        data_->pendingSendBytes += bytes.size();
    }

    std::size_t bufferedBytes() const override {
        return data_->pendingSendBytes + socket_->getBufferedAmount();
    }

    void close(std::uint16_t code, std::string_view reason) override {
        // Client protocol handling runs under GameServer::m_gameMutex. Calling
        // end() here can synchronously enter the uWS close callback and
        // deadlock (or delete Client while onMessage is still on its stack).
        // Record the request; the message callback applies it after unlocking.
        if (!data_->pendingClose)
            data_->pendingClose = WebSocketData::PendingClose{
                code, std::string(reason.substr(0U, 123U))};
    }

   private:
    WebSocket* socket_;
    WebSocketData* data_;
};

void flushPending(WebSocket* socket) {
    auto* data = socket->getUserData();
    auto sends = std::move(data->pendingSends);
    data->pendingSends.clear();
    data->pendingSendBytes = 0U;
    auto close = std::move(data->pendingClose);
    data->pendingClose.reset();
    for (const auto& bytes : sends)
        if (socket->send(
                {reinterpret_cast<const char*>(bytes.data()), bytes.size()},
                uWS::OpCode::BINARY) == WebSocket::DROPPED)
            break;
    if (close) socket->end(close->code, close->reason);
}
}  // namespace

SocketServer::SocketServer(GameServer& gameServer, uint16_t port)
    : m_port(port), m_gameServer(gameServer) {
    m_socketThread = std::thread(&SocketServer::run, this);
}

void SocketServer::run() {
    std::cout << "Starting socket server on port " << m_port << std::endl;
    static std::uint32_t nextId = 1U;
    std::unordered_map<std::uint32_t, WebSocket*> sockets;
    uWS::App()
        .ws<WebSocketData>(
            "/*",
            {.compression = uWS::DISABLED,
             .maxPayloadLength = static_cast<unsigned int>(
                 protocol::Limits::MaxEnvelopeBytes),
             .idleTimeout = 30,
             .maxBackpressure = 256U * 1024U,
             .closeOnBackpressureLimit = true,
             .resetIdleTimeoutOnSend = true,
             .sendPingsAutomatically = true,
             .maxLifetime = 0,
             .open =
                 [&](auto* ws) {
                     std::lock_guard<std::mutex> lock(m_gameServer.m_gameMutex);
                     while (m_gameServer.m_clients.count(nextId) != 0U) ++nextId;
                     const auto clientId = nextId++;
                     auto client = std::make_unique<Client>(
                         m_gameServer, std::make_unique<UwsPeerTransport>(ws),
                         clientId);
                     ws->getUserData()->id = clientId;
                     m_gameServer.m_clients.emplace(clientId, client.release());
                     sockets.emplace(clientId, ws);
                 },
             .message =
                 [&](auto* ws, std::string_view message, uWS::OpCode opCode) {
                     if (opCode != uWS::OpCode::BINARY) {
                         {
                             std::lock_guard<std::mutex> lock(
                                 m_gameServer.m_gameMutex);
                             m_gameServer.recordInboundMessage(message.size());
                             m_gameServer.recordClientMessageMetric(
                                 ClientMessageMetric::Rejected);
                         }
                         ws->end(1003, "binary messages required");
                         return;
                     }
                     bool knownSession = false;
                     Client* session = nullptr;
                     {
                         std::lock_guard<std::mutex> lock(
                             m_gameServer.m_gameMutex);
                         const auto found = m_gameServer.m_clients.find(
                             ws->getUserData()->id);
                         if (found != m_gameServer.m_clients.end()) {
                             knownSession = true;
                             session = found->second;
                             session->onMessage(message);
                             session->sendBytes();
                         }
                     }
                     if (!knownSession) {
                         ws->end(1002, "unknown session");
                         return;
                     }
                     flushPending(ws);
                 },
             .dropped =
                 [&](auto* ws, std::string_view, uWS::OpCode) {
                     {
                         std::lock_guard<std::mutex> lock(
                             m_gameServer.m_gameMutex);
                         m_gameServer.recordClientMessageMetric(
                             ClientMessageMetric::Backpressure);
                     }
                 },
             .close =
                 [&](auto* ws, int, std::string_view) {
                     ws->getUserData()->pendingClose.reset();
                     std::lock_guard<std::mutex> lock(m_gameServer.m_gameMutex);
                     const auto id = ws->getUserData()->id;
                     sockets.erase(id);
                     const auto found = m_gameServer.m_clients.find(id);
                     if (found == m_gameServer.m_clients.end()) return;
                     found->second->onClose();
                     delete found->second;
                     m_gameServer.m_clients.erase(found);
                 }})
        .get("/",
             [](auto* res, auto*) { res->end("multiplayer websocket endpoint"); })
        .listen(m_port,
                [this, &sockets](auto* socket) {
                    if (socket) {
                        m_loop = uWS::Loop::get();
                        std::lock_guard<std::mutex> lock(
                            m_gameServer.m_gameMutex);
                        m_gameServer.setNetworkFlushHook([this, &sockets] {
                            m_loop->defer([this, &sockets] {
                                std::vector<WebSocket*> peers;
                                {
                                    std::lock_guard<std::mutex> lock(
                                        m_gameServer.m_gameMutex);
                                    peers.reserve(m_gameServer.m_clients.size());
                                    for (const auto& entry :
                                         m_gameServer.m_clients) {
                                        entry.second->sendBytes();
                                        const auto socket = sockets.find(entry.first);
                                        if (socket != sockets.end())
                                            peers.push_back(socket->second);
                                    }
                                }
                                for (WebSocket* peer : peers)
                                    flushPending(peer);
                            });
                        });
                    }
                    else std::cerr << "Failed to listen on port " << m_port << '\n';
                })
        .run();
}
