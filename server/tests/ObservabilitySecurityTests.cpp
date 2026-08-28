#include "TestHarness.hpp"

#include <memory>
#include <nlohmann/json.hpp>
#include <string>
#include <utility>
#include <vector>

#include "GameServer.hpp"
#include "client/Client.hpp"
#include "network/PeerTransport.hpp"
#include "protocol/generated.hpp"

namespace {

struct ObservedWire {
    std::size_t sentBytes = 0U;
    std::size_t sends = 0U;
    std::size_t closes = 0U;
    std::vector<std::vector<std::uint8_t>> packets;
};

class ObservedTransport final : public PeerTransport {
   public:
    explicit ObservedTransport(std::shared_ptr<ObservedWire> wire)
        : wire_(std::move(wire)) {}
    void sendBinary(const std::vector<std::uint8_t>& bytes) override {
        wire_->sentBytes += bytes.size();
        ++wire_->sends;
        wire_->packets.push_back(bytes);
    }
    void close(std::uint16_t, std::string_view) override { ++wire_->closes; }

   private:
    std::shared_ptr<ObservedWire> wire_;
};

std::string packet(const std::vector<std::uint8_t>& bytes) {
    return {reinterpret_cast<const char*>(bytes.data()), bytes.size()};
}

protocol::Hello hello(const GameServer& server) {
    return {SessionConfiguration::ProtocolVersion,
            server.m_sessionConfiguration.buildId,
            static_cast<std::uint16_t>(
                server.m_mapPackage.manifest.formatVersion),
            std::nullopt};
}

void welcome(Client& client, const GameServer& server) {
    const auto encoded = protocol::encode(hello(server));
    client.onMessageAt(packet(encoded), 1.0);
}

}  // namespace

TEST_CASE(observability_reports_stable_json_timings_catchup_and_io) {
    GameServer server;
    std::vector<std::string> logs;
    server.setMetricsSink(
        [&](const std::string& line) { logs.push_back(line); });
    auto wire = std::make_shared<ObservedWire>();
    Client client(server, std::make_unique<ObservedTransport>(wire), 1U);
    server.m_clients.emplace(1U, &client);
    welcome(client, server);

    EXPECT_EQ(server.advanceSimulation(1.0),
              FixedStepAccumulator::kDefaultMaxCatchUpSteps);
    for (std::uint64_t tick = server.m_currentTick; tick < 300U; ++tick)
        server.simulateOneTick();
    client.sendBytes();

    const auto metrics = server.observabilityMetrics();
    EXPECT_EQ(metrics.playerCount, 1U);
    EXPECT_TRUE(metrics.tickMilliseconds.count >= 300U);
    EXPECT_TRUE(metrics.joltMilliseconds.count >= 300U);
    EXPECT_TRUE(metrics.snapshotMilliseconds.count >= 100U);
    EXPECT_EQ(metrics.maxStepsPerAdvance,
              FixedStepAccumulator::kDefaultMaxCatchUpSteps);
    EXPECT_TRUE(metrics.catchUpSteps >= 4U);
    EXPECT_TRUE(metrics.droppedTimeSeconds > 0.8);
    EXPECT_TRUE(metrics.inboundBytes > 0U);
    EXPECT_TRUE(metrics.outboundBytes > 0U);
    EXPECT_EQ(logs.size(), 1U);
    const auto json = nlohmann::json::parse(logs.front());
    EXPECT_EQ(json.at("event"), "server_metrics");
    EXPECT_TRUE(json.contains("tickMilliseconds"));
    EXPECT_TRUE(json.contains("snapshotBytes"));
    EXPECT_TRUE(json.contains("rateLimitedMessages"));
    server.m_clients.clear();
}

TEST_CASE(malformed_security_corpus_is_bounded_and_server_remains_responsive) {
    GameServer server;
    const std::vector<std::string> corpus{
        std::string(),
        std::string("\x01\x04", 2),
        std::string("\xfc\x02\x00\xaa", 4),
        std::string(protocol::Limits::MaxEnvelopeBytes + 1U, 'x')};
    std::uint32_t id = 1U;
    for (const auto& malformed : corpus) {
        auto wire = std::make_shared<ObservedWire>();
        Client client(server, std::make_unique<ObservedTransport>(wire), id);
        server.m_clients.emplace(id, &client);
        client.onMessageAt(malformed, 2.0);
        EXPECT_TRUE(client.closing());
        EXPECT_EQ(wire->closes, 1U);
        client.onClose();
        server.m_clients.erase(id++);
    }

    auto healthyWire = std::make_shared<ObservedWire>();
    Client healthy(server, std::make_unique<ObservedTransport>(healthyWire), id);
    server.m_clients.emplace(id, &healthy);
    welcome(healthy, server);
    EXPECT_TRUE(healthy.welcomed());
    EXPECT_TRUE(healthyWire->sends > 0U);
    EXPECT_EQ(server.observabilityMetrics().malformedMessages, corpus.size());
    server.m_clients.clear();
}

TEST_CASE(spoofed_identity_is_rewritten_and_outbound_queue_is_bounded) {
    GameServer server;
    auto senderWire = std::make_shared<ObservedWire>();
    auto observerWire = std::make_shared<ObservedWire>();
    Client sender(server, std::make_unique<ObservedTransport>(senderWire), 1U);
    Client observer(server, std::make_unique<ObservedTransport>(observerWire),
                    2U);
    server.m_clients.emplace(1U, &sender);
    server.m_clients.emplace(2U, &observer);
    welcome(sender, server);
    welcome(observer, server);
    const auto spoof = protocol::encode(protocol::Chat{
        999999U, protocol::ChatChannel::Global, "identity is server-owned"});
    sender.onMessageAt(packet(spoof), 2.0);
    EXPECT_TRUE(!sender.closing());
    observer.sendBytes();
    const auto envelope = protocol::decodeEnvelope(observerWire->packets.back());
    const auto& chat = std::get<protocol::Chat>(envelope.message);
    EXPECT_EQ(chat.senderId.value_or(0U),
              static_cast<std::uint32_t>(sender.m_entity));

    protocol::Chat large{std::nullopt, protocol::ChatChannel::System,
                         std::string(protocol::Limits::MaxChatBytes, 'x')};
    for (std::size_t index = 0U; index < 600U && !observer.closing(); ++index)
        observer.queueChat(large);
    EXPECT_TRUE(observer.closing());
    EXPECT_EQ(observerWire->closes, 1U);
    const auto metrics = server.observabilityMetrics();
    EXPECT_EQ(metrics.backpressureCloses, 1U);
    EXPECT_TRUE(metrics.outboundQueueBytesHighWater <= 256U * 1024U);
    server.m_clients.clear();
}

TEST_CASE(security_metrics_classify_unknown_authority_spoof_and_rate_limit) {
    GameServer server;
    auto makeClient = [&](std::uint32_t id) {
        auto wire = std::make_shared<ObservedWire>();
        auto client = std::make_unique<Client>(
            server, std::make_unique<ObservedTransport>(wire), id);
        server.m_clients.emplace(id, client.get());
        welcome(*client, server);
        return std::pair{std::move(client), std::move(wire)};
    };

    auto unknown = makeClient(1U);
    unknown.first->onMessageAt(std::string("\xfa\x00\x00", 3), 2.0);
    EXPECT_TRUE(!unknown.first->closing());

    auto authority = makeClient(2U);
    const auto damage = protocol::encode(protocol::Damage{
        1U, static_cast<std::uint32_t>(authority.first->m_entity),
        static_cast<std::uint32_t>(unknown.first->m_entity), 100U, 0U});
    authority.first->onMessageAt(packet(damage), 2.0);
    EXPECT_TRUE(authority.first->closing());

    auto rate = makeClient(3U);
    for (std::uint32_t sequence = 1U;
         sequence <= 73U && !rate.first->closing(); ++sequence) {
        const protocol::InputCommand command{
            sequence, sequence, 0.0F, 0.0F, 0U, 0U, 0U, 0.0F, 0.0F,
            protocol::Weapon::Rifle};
        const auto input = protocol::encode(protocol::InputBatch{{command}});
        rate.first->onMessageAt(packet(input), 3.0);
    }
    EXPECT_TRUE(rate.first->closing());

    const auto metrics = server.observabilityMetrics();
    EXPECT_EQ(metrics.unknownMessages, 1U);
    EXPECT_EQ(metrics.rejectedMessages, 1U);
    EXPECT_EQ(metrics.rateLimitedMessages, 1U);
    server.m_clients.clear();
}
