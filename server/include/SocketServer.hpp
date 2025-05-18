#pragma once

#include <cstdint>
#include <string_view>
#include <thread>
#include <vector>

#include "GameServer.hpp"

class SocketServer {
   public:
    SocketServer(GameServer& gameServer, uint16_t port);

   private:
    uint16_t m_port;
    GameServer& m_gameServer;
    std::thread m_socketThread;

    void run();
};
