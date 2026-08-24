#pragma once

#include <cstdint>
#include <string_view>
#include <vector>

// Socket-independent output boundary for one reliable, ordered peer.  Native
// session tests use a fake implementation; SocketServer is the only uWS user.
class PeerTransport {
   public:
    virtual ~PeerTransport() = default;
    virtual void sendBinary(const std::vector<std::uint8_t>& bytes) = 0;
    virtual void close(std::uint16_t code, std::string_view reason) = 0;
};
