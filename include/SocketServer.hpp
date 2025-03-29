#pragma once

#include <cstdint>
#include <string_view>
#include <vector>

class SocketServer {
   public:
    uint16_t m_port;
    std::vector<std::pair<uint32_t, std::string>> m_messages;

    SocketServer(uint16_t port);
};
