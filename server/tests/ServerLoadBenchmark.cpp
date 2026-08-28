#include <cmath>
#include <cstdint>
#include <iostream>
#include <memory>
#include <nlohmann/json.hpp>
#include <string>
#include <vector>

#include "GameServer.hpp"
#include "client/Client.hpp"
#include "network/PeerTransport.hpp"
#include "protocol/generated.hpp"

namespace {
constexpr std::size_t kPlayers = 12U;
constexpr std::uint32_t kTicks = 1800U;

struct WireTotals {
    std::uint64_t bytes = 0U;
    std::uint64_t messages = 0U;
    std::uint64_t closes = 0U;
    std::size_t buffered = 0U;
    std::vector<std::string> reliableChatOrder;
};

class CountingTransport final : public PeerTransport {
   public:
    explicit CountingTransport(std::shared_ptr<WireTotals> totals)
        : totals_(std::move(totals)) {}
    void sendBinary(const std::vector<std::uint8_t>& bytes) override {
        totals_->bytes += bytes.size();
        ++totals_->messages;
        const auto envelope = protocol::decodeEnvelope(bytes);
        if (envelope.known && envelope.messageType ==
                                  static_cast<std::uint8_t>(protocol::MessageType::Chat))
            totals_->reliableChatOrder.push_back(
                std::get<protocol::Chat>(envelope.message).text);
    }
    void close(std::uint16_t, std::string_view) override { ++totals_->closes; }
    std::size_t bufferedBytes() const override { return totals_->buffered; }

   private:
    std::shared_ptr<WireTotals> totals_;
};

std::string bytes(const std::vector<std::uint8_t>& value) {
    return {reinterpret_cast<const char*>(value.data()), value.size()};
}
}  // namespace

int main() {
    GameServer server;
    server.setMetricsSink({});
    std::vector<std::unique_ptr<Client>> clients;
    std::vector<std::shared_ptr<WireTotals>> wires;
    clients.reserve(kPlayers);
    wires.reserve(kPlayers);
    for (std::size_t index = 0; index < kPlayers; ++index) {
        auto wire = std::make_shared<WireTotals>();
        const auto id = static_cast<std::uint32_t>(index + 1U);
        auto client = std::make_unique<Client>(
            server, std::make_unique<CountingTransport>(wire), id);
        server.m_clients.emplace(id, client.get());
        const auto hello = protocol::encode(protocol::Hello{
            SessionConfiguration::ProtocolVersion,
            server.m_sessionConfiguration.buildId,
            static_cast<std::uint16_t>(
                server.m_mapPackage.manifest.formatVersion),
            std::nullopt});
        client->onMessageAt(bytes(hello), 0.0);
        clients.push_back(std::move(client));
        wires.push_back(std::move(wire));
    }
    for (auto& client : clients) client->sendBytes();
    for (auto& wire : wires) *wire = WireTotals{};
    server.resetObservabilityMetrics();
    server.setNetworkFlushHook([&] {
        for (auto& client : clients) client->sendBytes();
    });

    std::vector<std::uint32_t> sequences(kPlayers, 0U);
    for (std::uint32_t tick = 1U; tick <= kTicks; ++tick) {
        // Five seconds of synthetic socket pressure on one of the twelve
        // players. Reliable messages must remain ordered while 20 Hz state is
        // coalesced into an independently decodable baseline reset.
        if (tick == 600U) {
            wires.front()->buffered = 200U * 1024U;
            clients.front()->queueChat({std::nullopt,
                                        protocol::ChatChannel::System,
                                        "pressure-one"});
            clients.front()->queueChat({std::nullopt,
                                        protocol::ChatChannel::System,
                                        "pressure-two"});
            clients.front()->queueChat({std::nullopt,
                                        protocol::ChatChannel::System,
                                        "pressure-three"});
        }
        if (tick == 900U) wires.front()->buffered = 0U;
        const double now = 1.0 + static_cast<double>(tick) / 60.0;
        for (std::size_t index = 0; index < kPlayers; ++index) {
            const float phase = static_cast<float>((tick + index * 11U) % 240U) /
                                240.0F;
            const float moveX = std::sin(phase * 6.28318530718F) * 0.7F;
            const float moveY = std::cos(phase * 6.28318530718F) * 0.7F;
            protocol::InputCommand command{
                ++sequences[index], tick, moveX, moveY, 1U << 1U,
                sequences[index], 0U,
                static_cast<float>(index) * 0.35F - 1.9F, 0.0F,
                protocol::Weapon::Rifle};
            const auto encoded =
                protocol::encode(protocol::InputBatch{{command}});
            clients[index]->onMessageAt(bytes(encoded), now);
        }
        if (server.advanceSimulation(FixedStepAccumulator::kStepSeconds) != 1U) {
            std::cerr << "benchmark accumulator failed to advance one tick\n";
            return 1;
        }
    }
    for (auto& client : clients) client->sendBytes();

    const auto metrics = server.observabilityMetrics();
    std::uint64_t wireBytes = 0U;
    std::uint64_t wireMessages = 0U;
    std::uint64_t closes = 0U;
    for (const auto& wire : wires) {
        wireBytes += wire->bytes;
        wireMessages += wire->messages;
        closes += wire->closes;
    }
    constexpr double simulatedSeconds =
        static_cast<double>(kTicks) / GameServer::kTicksPerSecond;
    nlohmann::ordered_json report{
        {"event", "server_load_benchmark"},
        {"buildMode",
#ifdef NDEBUG
         "Release"
#else
         "Debug"
#endif
        },
        {"players", kPlayers},
        {"ticks", kTicks},
        {"simulatedSeconds", simulatedSeconds},
        {"tickP95Milliseconds", metrics.tickMilliseconds.p95},
        {"tickP99Milliseconds", metrics.tickMilliseconds.p99},
        {"tickMaxMilliseconds", metrics.tickMilliseconds.max},
        {"joltP95Milliseconds", metrics.joltMilliseconds.p95},
        {"snapshotP95Milliseconds", metrics.snapshotMilliseconds.p95},
        {"snapshotBytesP95", metrics.snapshotBytes.p95},
        {"maxCatchupSteps", metrics.maxStepsPerAdvance},
        {"droppedTimeSeconds", metrics.droppedTimeSeconds},
        {"inputBytesPerSecond", metrics.inboundBytes / simulatedSeconds},
        {"egressBytesPerSecond", metrics.outboundBytes / simulatedSeconds},
        {"egressBytesPerPlayerSecond",
         metrics.outboundBytes / simulatedSeconds / kPlayers},
        {"queuedInputHighWater", metrics.queuedInputHighWater},
        {"pendingInputHighWater", metrics.pendingClientInputHighWater},
        {"allocationProxyPeakQueuedBytes",
         metrics.outboundQueueBytesHighWater},
        {"transportBufferedBytesHighWater",
         metrics.transportBufferedBytesHighWater},
        {"coalescedSnapshots", metrics.coalescedSnapshots},
        {"reliableEvents", metrics.reliableEvents},
        {"reliablePressureOrder", wires.front()->reliableChatOrder},
        {"deltaPressureChangedFieldsPerSecond",
         (kPlayers - 1U) * 2U * GameServer::kSnapshotsPerSecond},
        {"wireBytes", wireBytes},
        {"wireMessages", wireMessages},
        {"shots", metrics.shotsFired},
        {"hits", metrics.pelletHits}};
    std::cout << report.dump() << '\n';

    const std::vector<std::string> expectedOrder{
        "pressure-one", "pressure-two", "pressure-three"};
    bool valid = closes == 0U && metrics.playerCount == kPlayers &&
                 metrics.maxStepsPerAdvance <= 1U &&
                 metrics.droppedTimeSeconds == 0.0 &&
                 metrics.queuedInputHighWater <= kPlayers &&
                 metrics.pendingClientInputHighWater <= 1U &&
                 metrics.outboundQueueBytesHighWater <= 256U * 1024U &&
                 metrics.transportBufferedBytesHighWater == 200U * 1024U &&
                 metrics.coalescedSnapshots > 0U &&
                 wires.front()->reliableChatOrder == expectedOrder &&
                 metrics.snapshotBytes.p95 <= 1024.0 &&
                 metrics.outboundBytes / simulatedSeconds / kPlayers <=
                     16U * 1024U &&
                 metrics.outboundBytes == wireBytes;
#ifdef NDEBUG
    valid = valid && metrics.tickMilliseconds.p95 < 10.0;
#endif
    server.m_clients.clear();
    return valid ? 0 : 1;
}
