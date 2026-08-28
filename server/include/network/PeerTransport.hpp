#pragma once

#include <cstdint>
#include <cstddef>
#include <string_view>
#include <vector>

// Socket-independent output boundary for one reliable, ordered peer.  Native
// session tests use a fake implementation; SocketServer is the only uWS user.
class PeerTransport {
   public:
    virtual ~PeerTransport() = default;
    virtual void sendBinary(const std::vector<std::uint8_t>& bytes) = 0;
    virtual void close(std::uint16_t code, std::string_view reason) = 0;
    // Includes bytes accepted by the application but not yet drained by the
    // kernel/WebSocket implementation. Test transports may retain the zero
    // default; the uWebSockets adapter reports its actual buffered amount.
    virtual std::size_t bufferedBytes() const { return 0U; }
};
