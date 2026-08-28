#pragma once

#include <cstdint>
#include <deque>
#include <string>
#include <string_view>
#include <unordered_map>

struct JoinTicketIdentity {
    std::string subject;
    std::string sessionId;
    std::string gameServerId;
    std::string nonce;
    std::int64_t issuedAt = 0;
    std::int64_t expiresAt = 0;
};

// Validates control-plane HS256 tickets. Accepted nonces are one-time per
// native server process and retained only until expiry in a bounded cache.
class JoinTicketValidator {
   public:
    JoinTicketValidator(std::string secret, std::string audience,
                        std::string serverId,
                        std::size_t maxReplayEntries = 4096U);

    bool validate(std::string_view ticket);
    bool validateAt(std::string_view ticket, std::int64_t unixSeconds);
    const JoinTicketIdentity& lastIdentity() const { return lastIdentity_; }
    std::size_t replayEntryCount() const { return replayExpirations_.size(); }

   private:
    struct ReplayEntry { std::string nonce; std::int64_t expiresAt; };
    std::string secret_;
    std::string audience_;
    std::string serverId_;
    std::size_t maxReplayEntries_;
    std::deque<ReplayEntry> replayOrder_;
    std::unordered_map<std::string, std::int64_t> replayExpirations_;
    JoinTicketIdentity lastIdentity_{};

    void prune(std::int64_t now);
};
