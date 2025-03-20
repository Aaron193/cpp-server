#pragma once

#include <cstdint>

class SocketServer {
   public:
    uint16_t m_port;

    SocketServer(uint16_t port);
};
