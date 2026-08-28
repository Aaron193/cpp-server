#include "security/JoinTicketValidator.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <cctype>
#include <nlohmann/json.hpp>
#include <vector>

#include "util/Sha256.hpp"

namespace {
std::vector<std::uint8_t> base64UrlDecode(std::string_view input) {
    static constexpr std::string_view alphabet =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    if (input.empty() || input.size() > 2048U) throw std::runtime_error("invalid base64url");
    std::vector<std::uint8_t> output;
    output.reserve(input.size() * 3U / 4U);
    std::uint32_t accumulator = 0U;
    unsigned bits = 0U;
    for (const char character : input) {
        const auto position = alphabet.find(character);
        if (position == std::string_view::npos) throw std::runtime_error("invalid base64url");
        accumulator = (accumulator << 6U) | static_cast<std::uint32_t>(position);
        bits += 6U;
        if (bits >= 8U) {
            bits -= 8U;
            output.push_back(static_cast<std::uint8_t>(accumulator >> bits));
            accumulator &= bits == 0U ? 0U : ((1U << bits) - 1U);
        }
    }
    if (bits >= 6U || accumulator != 0U) throw std::runtime_error("non-canonical base64url");
    return output;
}

std::array<std::uint8_t, 32> hmacSha256(std::string_view key,
                                       std::string_view message) {
    std::array<std::uint8_t, 64> normalized{};
    if (key.size() > normalized.size()) {
        util::Sha256 hash; hash.update(key);
        const auto digest = hash.finish();
        std::copy(digest.begin(), digest.end(), normalized.begin());
    } else {
        std::copy(key.begin(), key.end(), normalized.begin());
    }
    std::array<std::uint8_t, 64> innerPad{}, outerPad{};
    for (std::size_t index = 0; index < normalized.size(); ++index) {
        innerPad[index] = normalized[index] ^ 0x36U;
        outerPad[index] = normalized[index] ^ 0x5CU;
    }
    util::Sha256 inner;
    inner.update(innerPad.data(), innerPad.size()); inner.update(message);
    const auto innerDigest = inner.finish();
    util::Sha256 outer;
    outer.update(outerPad.data(), outerPad.size());
    outer.update(innerDigest.data(), innerDigest.size());
    return outer.finish();
}

bool constantEqual(const std::vector<std::uint8_t>& first,
                   const std::array<std::uint8_t, 32>& second) {
    std::uint32_t difference = first.size() == second.size() ? 0U : 1U;
    for (std::size_t index = 0; index < second.size(); ++index)
        difference |= second[index] ^ (index < first.size() ? first[index] : 0U);
    return difference == 0U;
}

bool boundedClaim(const std::string& value, std::size_t maximum) {
    if (value.empty() || value.size() > maximum) return false;
    return std::all_of(value.begin(), value.end(), [](unsigned char character) {
        return character >= 0x21U && character <= 0x7EU;
    });
}
}

JoinTicketValidator::JoinTicketValidator(std::string secret,
                                         std::string audience,
                                         std::string serverId,
                                         std::size_t maxReplayEntries)
    : secret_(std::move(secret)), audience_(std::move(audience)),
      serverId_(std::move(serverId)),
      maxReplayEntries_(std::max<std::size_t>(1U, maxReplayEntries)) {
    if (secret_.size() < 32U || !boundedClaim(audience_, 64U) ||
        !boundedClaim(serverId_, 128U))
        throw std::invalid_argument("invalid join ticket validator configuration");
}

bool JoinTicketValidator::validate(std::string_view ticket) {
    const auto now = std::chrono::duration_cast<std::chrono::seconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    return validateAt(ticket, now);
}

void JoinTicketValidator::prune(std::int64_t now) {
    while (!replayOrder_.empty() && replayOrder_.front().expiresAt <= now) {
        const auto entry = std::move(replayOrder_.front()); replayOrder_.pop_front();
        const auto found = replayExpirations_.find(entry.nonce);
        if (found != replayExpirations_.end() && found->second == entry.expiresAt)
            replayExpirations_.erase(found);
    }
}

bool JoinTicketValidator::validateAt(std::string_view ticket,
                                     std::int64_t now) {
    try {
        if (ticket.empty() || ticket.size() > 512U) return false;
        const auto first = ticket.find('.');
        const auto second = first == std::string_view::npos
            ? first : ticket.find('.', first + 1U);
        if (first == std::string_view::npos || second == std::string_view::npos ||
            ticket.find('.', second + 1U) != std::string_view::npos) return false;
        const auto encodedHeader = ticket.substr(0U, first);
        const auto encodedPayload = ticket.substr(first + 1U, second - first - 1U);
        const auto encodedSignature = ticket.substr(second + 1U);
        const auto headerBytes = base64UrlDecode(encodedHeader);
        const auto payloadBytes = base64UrlDecode(encodedPayload);
        const auto signature = base64UrlDecode(encodedSignature);
        const auto expected = hmacSha256(secret_, ticket.substr(0U, second));
        if (!constantEqual(signature, expected)) return false;
        const auto header = nlohmann::json::parse(headerBytes);
        if (!header.is_object() || header.value("alg", "") != "HS256" ||
            (header.contains("typ") && header.value("typ", "") != "JWT")) return false;
        const auto claims = nlohmann::json::parse(payloadBytes);
        if (!claims.is_object()) return false;
        JoinTicketIdentity identity{
            claims.at("sub").get<std::string>(),
            claims.at("sessionId").get<std::string>(),
            claims.at("gameServerId").get<std::string>(),
            claims.at("nonce").get<std::string>(),
            claims.at("iat").get<std::int64_t>(),
            claims.at("exp").get<std::int64_t>()};
        const auto audience = claims.at("aud").get<std::string>();
        if (!boundedClaim(identity.subject, 128U) ||
            !boundedClaim(identity.sessionId, 64U) ||
            !boundedClaim(identity.gameServerId, 128U) ||
            !boundedClaim(identity.nonce, 64U) || audience != audience_ ||
            identity.gameServerId != serverId_ || identity.issuedAt > now + 5 ||
            identity.expiresAt <= now || identity.expiresAt - identity.issuedAt < 15 ||
            identity.expiresAt - identity.issuedAt > 30) return false;
        prune(now);
        if (replayExpirations_.count(identity.nonce) != 0U) return false;
        while (replayExpirations_.size() >= maxReplayEntries_) {
            const auto oldest = std::move(replayOrder_.front()); replayOrder_.pop_front();
            replayExpirations_.erase(oldest.nonce);
        }
        replayExpirations_[identity.nonce] = identity.expiresAt;
        replayOrder_.push_back({identity.nonce, identity.expiresAt});
        lastIdentity_ = std::move(identity);
        return true;
    } catch (...) {
        return false;
    }
}
