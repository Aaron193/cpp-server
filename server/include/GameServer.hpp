#pragma once

#include <cstdint>
#include <functional>
#include <limits>
#include <mutex>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>
#include <optional>
#include <deque>
#include <variant>

#include "combat/CombatGeometry.hpp"

#include "GameConfig.hpp"
#include "ServerRegistration.hpp"
#include "ecs/EntityManager.hpp"
#include "ecs/components.hpp"
#include "maps/MapPackage.hpp"
#include "observability/ServerMetrics.hpp"
#include "physics/PhysicsWorld.hpp"
#include "protocol/generated.hpp"
#include "simulation/FixedStepAccumulator.hpp"

class Client;

using ReliableGameEvent = std::variant<
    protocol::ShotConfirmed, protocol::Impact, protocol::Damage,
    protocol::Death, protocol::Respawn, protocol::ScoreChange,
    protocol::RoundTransition, protocol::ActionResult>;

struct CombatMetrics {
    std::uint64_t shotsFired = 0;
    std::uint64_t pelletHits = 0;
    std::uint64_t rejectedFireAttempts = 0;
    std::uint64_t historyClamps = 0;
    std::uint64_t sprintActivations = 0;
    std::uint64_t slideActivations = 0;
    std::uint64_t dashActivations = 0;
    std::uint64_t mantleActivations = 0;
    std::uint64_t proneActivations = 0;
    std::uint64_t blockedStandAttempts = 0;
    std::uint64_t mantleFailures = 0;
    std::uint64_t cooldownRejections = 0;
};

struct SessionConfiguration {
    static constexpr std::uint16_t ProtocolVersion = 10;
    std::string buildId = "dev";
    std::string mode = "ffa";
    std::size_t maxPlayers = 12;
    bool requireExactBuild = true;
    std::function<bool(const std::optional<std::string>&)> authenticate =
        [](const std::optional<std::string>& token) { return !token.has_value(); };
};

class GameServer {
   public:
    GameServer();
    explicit GameServer(const std::string& gameConfigPath);
    ~GameServer() = default;

    static std::string resolveGameConfigPath(const char* environmentValue);

    std::mutex m_gameMutex;
    static constexpr std::uint8_t kTicksPerSecond = 60;
    static constexpr std::uint8_t kSnapshotsPerSecond = 20;
    static_assert(kTicksPerSecond % kSnapshotsPerSecond == 0,
                  "snapshot cadence must divide the fixed tick rate");
    const std::uint8_t m_tps = kTicksPerSecond;
    std::uint64_t m_currentTick = 0;
    GameConfig m_gameConfig;
    EntityManager m_entityManager;
    PhysicsWorld m_physicsWorld;
    MapPackage m_mapPackage;
    std::unordered_map<std::uint32_t, Client*> m_clients;
    SessionConfiguration m_sessionConfiguration;
    ServerRegistration* m_serverRegistration = nullptr;
    double m_heartbeatTimer = 0.0;
    const double m_heartbeatInterval = 5.0;

    void run();
    std::size_t advanceSimulation(double elapsedSeconds);
    void simulateOneTick();
    void setServerRegistration(ServerRegistration* registration);
    const MapSpawnPoint& selectSpawnPoint(
        entt::entity spawningPlayer = entt::null) const;
    void queueValidatedInput(entt::entity player,
                             const Components::PlayerInput& input);
    void queueValidatedInput(std::uint32_t clientId, entt::entity player,
                             const Components::PlayerInput& input,
                             std::uint32_t sequence);
    std::size_t welcomedClientCount() const;
    protocol::EntityRecord makeEntityRecord(
        entt::entity entity, entt::entity recipient) const;
    protocol::EntityHandle makeEntityHandle(entt::entity entity) const;
    protocol::PublicEntityState makePublicEntityState(entt::entity entity) const;
    protocol::LocalAuthoritativeState makeLocalAuthoritativeState(
        entt::entity entity) const;
    void broadcastPlayerSpawn(entt::entity entity);
    void broadcastSpawn(const protocol::Spawn& message);
    void broadcastRemove(const protocol::Remove& message);
    void broadcastChat(const protocol::Chat& message);
    void queueCurrentScoreboard(Client& recipient) const;
    void triggerDeath(entt::entity player);
    bool applyDamage(entt::entity attacker, entt::entity target, float damage,
                     ItemType weapon);
    protocol::MatchState matchState() const;
    // InputCommand.clientTick is in the Snapshot.serverTick domain after the
    // client has received its first snapshot. Pre-snapshot and out-of-window
    // values are safe: they clamp to the retained history endpoints.
    std::uint32_t acceptedHistoryTick(std::uint32_t requested) const;
    void setSnapshotHook(std::function<void(std::uint64_t)> hook);
    void setNetworkFlushHook(std::function<void()> hook);
    void setReliableEventHook(std::function<void(
        std::optional<entt::entity>, const ReliableGameEvent&)> hook);
    const CombatMetrics& combatMetrics() const { return combatMetrics_; }
    ServerMetricsSnapshot observabilityMetrics() const;
    std::string observabilityJson() const;
    void resetObservabilityMetrics();
    void setMetricsSink(std::function<void(const std::string&)> sink);
    void recordInboundMessage(std::size_t bytes);
    void recordOutboundMessage(std::size_t bytes);
    void recordClientMessageMetric(ClientMessageMetric metric);
    void observePendingClientInputs(std::size_t count);
    void observeOutboundQueue(std::size_t messages, std::size_t bytes);
    void observeSnapshot(double milliseconds, std::size_t bytes);
    void observeTransportBuffered(std::size_t bytes);
    void recordCoalescedSnapshot();

   private:
    PhysicsWorld::BodyId mapBody_ = 0;
    FixedStepAccumulator accumulator_;
    struct QueuedInput {
        std::optional<std::uint32_t> clientId;
        entt::entity player;
        Components::PlayerInput input;
        std::optional<std::uint32_t> sequence;
    };
    std::deque<QueuedInput> queuedInputs_;
    std::function<void(std::uint64_t)> snapshotHook_;
    std::function<void()> networkFlushHook_;
    std::function<void(std::optional<entt::entity>,
                       const ReliableGameEvent&)> reliableEventHook_;
    struct HistoricalPlayer {
        entt::entity entity = entt::null;
        glm::vec3 position{0.0F};
        glm::vec3 eyePosition{0.0F};
        float bodyYaw = 0.0F;
        protocol::Stance stance = protocol::Stance::Standing;
        CombatGeometry::Capsule capsule{};
        bool dead = false;
    };
    struct HistoryFrame {
        std::uint32_t tick = 0;
        std::vector<HistoricalPlayer> players;
    };
    std::deque<HistoryFrame> history_;
    struct PendingDamage {
        entt::entity attacker = entt::null;
        entt::entity target = entt::null;
        float amount = 0.0F;
        ItemType weapon = ItemType::ITEM_NONE;
    };
    std::vector<PendingDamage> pendingDamage_;
    std::uint32_t nextShotId_ = 1;
    CombatMetrics combatMetrics_{};
    ServerMetrics observability_{};
    std::function<void(const std::string&)> metricsSink_;
    protocol::MatchPhase matchPhase_ = protocol::MatchPhase::Active;
    std::uint16_t roundNumber_ = 1;
    std::uint64_t phaseEndsAtTick_ = 0;

    void consumeQueuedValidatedInput();
    void updateMatchAndPlayerState(float delta);
    void updateCharacterMotors(float delta);
    void updateAiming(float delta);
    void recordPlayerHistory();
    void updateWeaponsAndFire();
    void resolvePendingDamage();
    void resolveHealthAndDeaths();
    void advanceRespawns(float delta);
    void publishEventsAndSnapshots();
    void updateHeartbeat(double delta);
    protocol::ActionRejectReason startReload(Components::Gun& gun,
                                             Components::Ammo& ammo);
    void completeReloads(entt::entity player);
    void fireWeapon(entt::entity shooter, Components::Gun& gun,
                    const Components::PlayerInput& input);
    const HistoryFrame* findHistoryFrame(std::uint32_t requested,
                                         std::uint32_t& accepted) const;
    void transitionToIntermission();
    void resetRound();
    void resetPlayerForRound(entt::entity player, const MapSpawnPoint& spawn);
    void emitReliable(std::optional<entt::entity> recipient,
                      ReliableGameEvent event);
    std::size_t replicatedPlayerCount() const;
};
