#pragma once

#include <chrono>
#include <cstdint>
#include <entt/entt.hpp>
#include <deque>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "network/PeerTransport.hpp"
#include "observability/ServerMetrics.hpp"
#include "protocol/generated.hpp"

// forward declaration
class GameServer;

class Client {
   public:
    // unique id for each client
    uint32_t m_id;
    // entity may change throughout the lifetime of the client
    entt::entity m_entity;

    bool m_active = false;  // true only after Hello has been accepted

    Client(GameServer& gameServer, std::unique_ptr<PeerTransport> transport,
           uint32_t id);
    ~Client();

    void changeBody(entt::entity entity);

    void onMessage(std::string_view message);
    void onMessageAt(std::string_view message, double monotonicSeconds);
    void onClose();

    void writeGameState();
    void sendBytes();
    void queueSpawn(const protocol::Spawn& message);
    void queueRemove(const protocol::Remove& message);
    void queueChat(const protocol::Chat& message);
    void queueShotConfirmed(const protocol::ShotConfirmed& message);
    void queueImpact(const protocol::Impact& message);
    void queueDamage(const protocol::Damage& message);
    void queueDeath(const protocol::Death& message);
    void queueRespawn(const protocol::Respawn& message);
    void queueScoreChange(const protocol::ScoreChange& message);
    void queueRoundTransition(const protocol::RoundTransition& message);
    void markInputProcessed(std::uint32_t sequence);
    void markInputDequeued();

    bool welcomed() const { return m_active; }
    bool closing() const { return closing_; }
    bool closeHandled() const { return closeHandled_; }
    std::size_t pendingInputCount() const { return pendingInputs_; }
    std::size_t outgoingBytes() const { return outgoingBytes_; }
    std::size_t outgoingMessageCount() const { return outgoing_.size(); }
    std::optional<std::uint32_t> lastProcessedInputSequence() const {
        return lastProcessedInputSequence_;
    }

   private:
    GameServer& m_gameServer;
    std::unique_ptr<PeerTransport> transport_;
    std::vector<std::vector<std::uint8_t>> outgoing_;
    std::size_t outgoingBytes_ = 0U;
    bool closing_ = false;
    bool closeHandled_ = false;
    std::optional<std::uint32_t> lastReceivedSequence_;
    std::optional<std::uint32_t> lastReceivedClientTick_;
    std::optional<std::uint32_t> lastProcessedInputSequence_;
    std::size_t pendingInputs_ = 0;
    std::deque<double> inputBatchTimes_;
    std::deque<double> inputCommandTimes_;
    std::deque<double> chatTimes_;

    void handleHello(const protocol::Hello& hello);
    void handleInputBatch(const protocol::InputBatch& batch,
                          double monotonicSeconds);
    void handleChat(const protocol::Chat& chat, double monotonicSeconds);
    void reject(protocol::RejectReason reason, std::string detail);
    void failProtocol(
        std::string_view reason, std::uint16_t code = 1002U,
        ClientMessageMetric metric = ClientMessageMetric::Rejected);
    void queue(std::vector<std::uint8_t> bytes);
    static bool isNewer(std::uint32_t value, std::uint32_t previous);
};
