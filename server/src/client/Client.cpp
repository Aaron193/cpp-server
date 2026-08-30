#include "client/Client.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>

#include "GameServer.hpp"
#include "ecs/components.hpp"
#include "util/Sha256.hpp"
#include "network/ReplicationProtocol.hpp"

namespace {
constexpr float kPi = 3.14159265358979323846F;
constexpr std::uint16_t kJump = 1U << 0U;
constexpr std::uint16_t kFire = 1U << 1U;
constexpr std::uint16_t kReload = 1U << 2U;
constexpr std::uint16_t kSprint = 1U << 3U;
constexpr std::uint16_t kCrouch = 1U << 4U;
constexpr std::uint16_t kProne = 1U << 5U;
constexpr std::uint16_t kDash = 1U << 6U;
constexpr std::uint16_t kKnownButtons = kJump | kFire | kReload | kSprint | kCrouch | kProne | kDash;
constexpr std::size_t kMaxPendingInputs = 128U;
// 20% burst headroom prevents legitimate 60 Hz timer jitter from grazing a
// rolling one-second boundary. Command rate and pending backlog stay bounded.
constexpr std::size_t kInputBatchesPerSecond = 72U;
constexpr std::size_t kInputCommandsPerSecond = 240U;
constexpr std::size_t kChatsPerWindow = 5U;
constexpr std::size_t kPingsPerSecond = 8U;
constexpr double kChatWindowSeconds = 10.0;
constexpr std::size_t kMaxOutgoingMessages = 1024U;
constexpr std::size_t kMaxOutgoingBytes = 256U * 1024U;
constexpr std::size_t kSoftBufferedBytes = 128U * 1024U;
constexpr float kSpatialEnterMeters = 50.0F;
constexpr float kSpatialLeaveMeters = 55.0F;

std::uint64_t handleKey(const protocol::EntityHandle& handle) {
    return (static_cast<std::uint64_t>(handle.slot) << 16U) |
           static_cast<std::uint64_t>(handle.generation);
}

bool sameVec(const protocol::Vec3& first, const protocol::Vec3& second) {
    return first.x == second.x && first.y == second.y && first.z == second.z;
}

bool sameMatch(const protocol::MatchState& first,
               const protocol::MatchState& second) {
    return first.phase == second.phase &&
           first.roundNumber == second.roundNumber &&
           first.phaseEndsAtTick == second.phaseEndsAtTick;
}

protocol::UpdatedEntity deltaFor(const protocol::PublicEntityState& previous,
                                 const protocol::PublicEntityState& current) {
    protocol::UpdatedEntity delta{};
    delta.handle = current.handle;
    if (!sameVec(previous.position, current.position)) {
        delta.changeMask |= 1U; delta.position = current.position;
    }
    if (!sameVec(previous.velocity, current.velocity)) {
        delta.changeMask |= 2U; delta.velocity = current.velocity;
    }
    if (previous.bodyYaw != current.bodyYaw) {
        delta.changeMask |= 4U; delta.bodyYaw = current.bodyYaw;
    }
    if (previous.aimPitch != current.aimPitch) {
        delta.changeMask |= 8U; delta.aimPitch = current.aimPitch;
    }
    if (previous.grounded != current.grounded) {
        delta.changeMask |= 16U; delta.grounded = current.grounded;
    }
    if (previous.stateFlags != current.stateFlags) {
        delta.changeMask |= 32U; delta.stateFlags = current.stateFlags;
    }
    if (previous.equippedWeapon != current.equippedWeapon) {
        delta.changeMask |= 64U; delta.equippedWeapon = current.equippedWeapon;
    }
    if (previous.stance != current.stance) {
        delta.changeMask |= 128U; delta.stance = current.stance;
    }
    if (previous.movementMode != current.movementMode) {
        delta.changeMask |= 256U; delta.movementMode = current.movementMode;
    }
    return delta;
}

template <typename Queue>
void prune(Queue& queue, double now, double window) {
    while (!queue.empty() && now - queue.front() >= window) queue.pop_front();
}

}  // namespace

Client::Client(GameServer& server, std::unique_ptr<PeerTransport> transport,
               std::uint32_t id)
    : m_id(id), m_entity(entt::null), m_gameServer(server),
      transport_(std::move(transport)) {
    if (!transport_) throw std::invalid_argument("client transport is required");
}

Client::~Client() = default;

bool Client::isNewer(std::uint32_t value, std::uint32_t previous) {
    return value != previous && static_cast<std::int32_t>(value - previous) > 0;
}

void Client::queue(std::vector<std::uint8_t> bytes) {
    if (closing_) return;
    if (outgoing_.size() + (latestState_ ? 1U : 0U) >= kMaxOutgoingMessages ||
        transport_->bufferedBytes() >= kMaxOutgoingBytes ||
        bytes.size() > kMaxOutgoingBytes -
                           std::min(outgoingBytes_, kMaxOutgoingBytes)) {
        closing_ = true;
        outgoing_.clear();
        latestState_.reset();
        outgoingBytes_ = 0U;
        m_gameServer.recordClientMessageMetric(
            ClientMessageMetric::Backpressure);
        transport_->close(1008U, "outbound queue limit exceeded");
        return;
    }
    outgoingBytes_ += bytes.size();
    outgoing_.push_back(std::move(bytes));
    m_gameServer.observeOutboundQueue(outgoing_.size(), outgoingBytes_);
}

void Client::queueState(std::vector<std::uint8_t> bytes) {
    if (closing_) return;
    if (latestState_) {
        outgoingBytes_ -= latestState_->size();
        ++coalescedSnapshots_;
        m_gameServer.recordCoalescedSnapshot();
    }
    if (bytes.size() > kMaxOutgoingBytes -
                           std::min(outgoingBytes_, kMaxOutgoingBytes)) {
        ++coalescedSnapshots_;
        m_gameServer.recordCoalescedSnapshot();
        return;
    }
    outgoingBytes_ += bytes.size();
    latestState_ = std::move(bytes);
    m_gameServer.observeOutboundQueue(
        outgoing_.size() + 1U, outgoingBytes_ + transport_->bufferedBytes());
}

void Client::sendBytes() {
    m_gameServer.observeTransportBuffered(transport_->bufferedBytes());
    while (!outgoing_.empty()) {
        auto bytes = std::move(outgoing_.front());
        outgoing_.pop_front();
        outgoingBytes_ -= bytes.size();
        transport_->sendBinary(bytes);
        m_gameServer.recordOutboundMessage(bytes.size());
    }
    if (latestState_ && transport_->bufferedBytes() < kSoftBufferedBytes) {
        auto bytes = std::move(*latestState_);
        latestState_.reset();
        outgoingBytes_ -= bytes.size();
        transport_->sendBinary(bytes);
        m_gameServer.recordOutboundMessage(bytes.size());
    }
}

void Client::reject(protocol::RejectReason reason, std::string detail) {
    if (closing_) return;
    m_gameServer.recordClientMessageMetric(ClientMessageMetric::Rejected);
    protocol::Reject rejection{};
    rejection.serverBuildId = m_gameServer.m_sessionConfiguration.buildId;
    rejection.reason = reason;
    rejection.detail = std::move(detail);
    rejection.expectedProtocolVersion = SessionConfiguration::ProtocolVersion;
    rejection.expectedMapFormat = static_cast<std::uint16_t>(
        m_gameServer.m_mapPackage.manifest.formatVersion);
    queue(protocol::encode(rejection));
    sendBytes();
    closing_ = true;
    transport_->close(1008U, "handshake rejected");
}

void Client::failProtocol(std::string_view reason, std::uint16_t code,
                          ClientMessageMetric metric) {
    if (closing_) return;
    m_gameServer.recordClientMessageMetric(metric);
    closing_ = true;
    outgoing_.clear();
    latestState_.reset();
    outgoingBytes_ = 0U;
    transport_->close(code, reason);
}

void Client::onMessage(std::string_view message) {
    const auto now = std::chrono::duration<double>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
    onMessageAt(message, now);
}

void Client::onMessageAt(std::string_view message, double monotonicSeconds) {
    m_gameServer.recordInboundMessage(message.size());
    if (closing_) return;
    if (message.empty() || message.size() > protocol::Limits::MaxEnvelopeBytes) {
        failProtocol("invalid message size", 1009U,
                     ClientMessageMetric::Malformed);
        return;
    }
    try {
        const auto* bytes = reinterpret_cast<const std::uint8_t*>(message.data());
        const auto decoded = protocol::decodeEnvelope(bytes, message.size());
        if (decoded.nextOffset != message.size()) {
            failProtocol("one protocol envelope is required per message", 1002U,
                         ClientMessageMetric::Malformed);
            return;
        }
        // Unknown message types are forward-compatible. decodeEnvelope has
        // already validated and skipped their declared payload length.
        if (!decoded.known) {
            m_gameServer.recordClientMessageMetric(ClientMessageMetric::Unknown);
            return;
        }
        if (!m_active) {
            if (!std::holds_alternative<protocol::Hello>(decoded.message)) {
                reject(protocol::RejectReason::InvalidHello,
                       "Hello must be the first message");
                return;
            }
            handleHello(std::get<protocol::Hello>(decoded.message));
            return;
        }
        if (const auto* batch = std::get_if<protocol::InputBatch>(&decoded.message)) {
            handleInputBatch(*batch, monotonicSeconds);
        } else if (const auto* chat = std::get_if<protocol::Chat>(&decoded.message)) {
            handleChat(*chat, monotonicSeconds);
        } else if (const auto* ping = std::get_if<protocol::Ping>(&decoded.message)) {
            handlePing(*ping, monotonicSeconds);
        } else {
            failProtocol("message is not valid from a welcomed client", 1002U,
                         ClientMessageMetric::Rejected);
        }
    } catch (const protocol::ProtocolError&) {
        failProtocol("malformed protocol message", 1002U,
                     ClientMessageMetric::Malformed);
    } catch (const std::exception&) {
        failProtocol("invalid protocol message", 1002U,
                     ClientMessageMetric::Malformed);
    }
}

void Client::handleHello(const protocol::Hello& hello) {
    const auto& config = m_gameServer.m_sessionConfiguration;
    if (hello.protocolVersion != SessionConfiguration::ProtocolVersion) {
        reject(protocol::RejectReason::VersionMismatch, "unsupported protocol version");
        return;
    }
    if (hello.supportedMapFormat != m_gameServer.m_mapPackage.manifest.formatVersion) {
        reject(protocol::RejectReason::MapMismatch, "unsupported map package format");
        return;
    }
    if (hello.clientBuildId.empty()) {
        reject(protocol::RejectReason::InvalidHello, "client build id is required");
        return;
    }
    if (config.requireExactBuild && hello.clientBuildId != config.buildId) {
        reject(protocol::RejectReason::BuildMismatch,
               "client and server builds are incompatible");
        return;
    }
    if (m_gameServer.welcomedClientCount() >= config.maxPlayers) {
        reject(protocol::RejectReason::ServerFull, "server is full");
        return;
    }
    if (!config.authenticate || !config.authenticate(hello.accessToken)) {
        reject(protocol::RejectReason::Unauthorized, "credentials were not accepted");
        return;
    }

    // The authoritative id is allocated by the server. Peer-provided identity
    // and Chat.senderId values never establish entity ownership.
    m_entity = m_gameServer.m_entityManager.createPlayer();
    m_gameServer.m_entityManager.getRegistry().emplace<Components::Client>(
        m_entity, m_id);
    m_active = true;

    const protocol::MapDescriptor map{
        m_gameServer.m_mapPackage.manifest.mapId,
        static_cast<std::uint16_t>(m_gameServer.m_mapPackage.manifest.formatVersion),
        m_gameServer.m_mapPackage.manifest.contentHash};
    const std::string configurationJson =
        m_gameServer.m_gameConfig.toJsonString();
    const std::string configurationHash =
        util::sha256Identifier(configurationJson);
    queue(protocol::encode(protocol::Welcome{
        SessionConfiguration::ProtocolVersion, config.buildId,
        static_cast<std::uint32_t>(m_entity),
        m_gameServer.makeEntityHandle(m_entity), GameServer::kTicksPerSecond,
        GameServer::kSnapshotsPerSecond, map, configurationHash}));
    queue(protocol::encode(protocol::Configuration{
        SessionConfiguration::ProtocolVersion, config.buildId, map,
        configurationHash, configurationJson}));
    // Queue after Welcome and Configuration. The record is constructed per
    // recipient so only this entity's owner sees health and weapon state.
    m_gameServer.broadcastPlayerSpawn(m_entity);
    // ScoreChange is the authoritative scoreboard row. Send every current row
    // after this client's ordered Welcome/Configuration/Spawn sequence so a
    // mid-round join never needs to infer prior kills or deaths.
    m_gameServer.queueCurrentScoreboard(*this);
    sendBytes();
}

void Client::handlePing(const protocol::Ping& ping, double now) {
    prune(pingTimes_, now, 1.0);
    if (!std::isfinite(now) || now < 0.0 ||
        pingTimes_.size() >= kPingsPerSecond) {
        failProtocol("ping rate exceeded", 1008U,
                     ClientMessageMetric::RateLimited);
        return;
    }
    pingTimes_.push_back(now);
    const auto monotonicMilliseconds =
        static_cast<std::uint64_t>(std::floor(now * 1000.0));
    queue(protocol::encode(protocol::Pong{
        ping.pingId,
        static_cast<std::uint32_t>(m_gameServer.m_currentTick),
        static_cast<std::uint32_t>(monotonicMilliseconds & 0xFFFFFFFFULL)}));
}

void Client::handleInputBatch(const protocol::InputBatch& batch, double now) {
    prune(inputBatchTimes_, now, 1.0);
    prune(inputCommandTimes_, now, 1.0);
    if (inputBatchTimes_.size() >= kInputBatchesPerSecond ||
        inputCommandTimes_.size() + batch.commands.size() > kInputCommandsPerSecond ||
        pendingInputs_ + batch.commands.size() > kMaxPendingInputs) {
        failProtocol("input rate or backlog exceeded", 1008U,
                     ClientMessageMetric::RateLimited);
        return;
    }

    auto previousSequence = lastReceivedSequence_;
    auto previousTick = lastReceivedClientTick_;
    auto previousAction = lastReceivedActionId_;
    for (const auto& command : batch.commands) {
        const float magnitudeSquared = command.moveX * command.moveX +
                                       command.moveY * command.moveY;
        if (!std::isfinite(command.moveX) || !std::isfinite(command.moveY) ||
            !std::isfinite(command.yaw) || !std::isfinite(command.pitch) ||
            std::abs(command.moveX) > 1.0F || std::abs(command.moveY) > 1.0F ||
            magnitudeSquared > 1.0002F || command.yaw < -kPi ||
            command.yaw > kPi || command.pitch < -kPi / 2.0F ||
            command.pitch > kPi / 2.0F ||
            (command.buttonFlags & ~kKnownButtons) != 0U ||
            (command.fireActionId != 0U &&
             (command.buttonFlags & kFire) == 0U) ||
            (command.reloadActionId != 0U &&
             (command.buttonFlags & kReload) == 0U) ||
            ((command.buttonFlags & kFire) != 0U &&
             command.fireActionId == 0U) ||
            ((command.buttonFlags & kReload) != 0U &&
             command.reloadActionId == 0U) ||
            (command.fireActionId != 0U && previousAction &&
             !isNewer(command.fireActionId, *previousAction)) ||
            (command.reloadActionId != 0U &&
             ((command.fireActionId != 0U &&
               !isNewer(command.reloadActionId, command.fireActionId)) ||
              (command.fireActionId == 0U && previousAction &&
               !isNewer(command.reloadActionId, *previousAction)))) ||
            (previousSequence && !isNewer(command.sequence, *previousSequence)) ||
            (previousTick && !isNewer(command.clientTick, *previousTick))) {
            failProtocol("invalid or non-monotonic input command", 1008U,
                         ClientMessageMetric::Rejected);
            return;
        }
        previousSequence = command.sequence;
        previousTick = command.clientTick;
        if (command.fireActionId != 0U) previousAction = command.fireActionId;
        if (command.reloadActionId != 0U) previousAction = command.reloadActionId;
    }

    inputBatchTimes_.push_back(now);
    for (const auto& command : batch.commands) {
        inputCommandTimes_.push_back(now);
        Components::PlayerInput input{};
        input.movement = {command.moveX, command.moveY};
        input.yaw = command.yaw;
        input.angle = command.yaw;
        input.pitch = command.pitch;
        input.jump = (command.buttonFlags & kJump) != 0U;
        input.mouseIsDown = (command.buttonFlags & kFire) != 0U;
        input.dirtyClick = input.mouseIsDown;
        input.reloadRequested = (command.buttonFlags & kReload) != 0U;
        input.sprintHeld = (command.buttonFlags & kSprint) != 0U;
        input.crouchHeld = (command.buttonFlags & kCrouch) != 0U;
        input.pronePressed = (command.buttonFlags & kProne) != 0U;
        input.dashPressed = (command.buttonFlags & kDash) != 0U;
        input.fireActionId = command.fireActionId;
        input.reloadActionId = command.reloadActionId;
        input.clientTick = command.clientTick;
        input.inputSequence = command.sequence;
        if (command.selectedWeapon == protocol::Weapon::Rifle) input.switchSlot = 0;
        else if (command.selectedWeapon == protocol::Weapon::Shotgun) input.switchSlot = 1;
        m_gameServer.queueValidatedInput(m_id, m_entity, input, command.sequence);
        ++pendingInputs_;
        m_gameServer.observePendingClientInputs(pendingInputs_);
    }
    lastReceivedSequence_ = previousSequence;
    lastReceivedClientTick_ = previousTick;
    lastReceivedActionId_ = previousAction;
}

void Client::handleChat(const protocol::Chat& chat, double now) {
    prune(chatTimes_, now, kChatWindowSeconds);
    if (chatTimes_.size() >= kChatsPerWindow) {
        failProtocol("chat rate exceeded", 1008U,
                     ClientMessageMetric::RateLimited);
        return;
    }
    if (chat.channel != protocol::ChatChannel::Global || chat.text.empty()) {
        failProtocol("invalid client chat", 1008U,
                     ClientMessageMetric::Rejected);
        return;
    }
    chatTimes_.push_back(now);
    m_gameServer.broadcastChat(protocol::Chat{
        static_cast<std::uint32_t>(m_entity), protocol::ChatChannel::Global,
        chat.text});
}

void Client::writeGameState() {
    if (!m_active || closing_) return;
    const auto started = std::chrono::steady_clock::now();
    // If an unsent state is being replaced, its baseline was never applied by
    // the peer. Encode the replacement as a reset/full create set. Likewise,
    // under socket backpressure retain only a latest independently decodable
    // state while reliable ordered events continue to drain first.
    if (latestState_ || transport_->bufferedBytes() >= kSoftBufferedBytes)
        resetReplicationBaseline();
    protocol::SnapshotDelta snapshot{};
    snapshot.snapshotSequence = ++snapshotSequence_;
    snapshot.baselineReset = !baselineInitialized_;
    if (snapshot.baselineReset) {
        ++baselineRevision_;
        if (baselineRevision_ == 0U) ++baselineRevision_;
    }
    snapshot.baselineSequence = snapshot.baselineReset
        ? 0U : snapshot.snapshotSequence - 1U;
    snapshot.baselineRevision = baselineRevision_;
    snapshot.serverTick = static_cast<std::uint32_t>(m_gameServer.m_currentTick);
    snapshot.lastProcessedInputSequence = lastProcessedInputSequence_.value_or(0U);
    const auto match = m_gameServer.matchState();
    if (!baselineMatch_ || !sameMatch(*baselineMatch_, match)) {
        ++matchRevision_;
        if (matchRevision_ == 0U) ++matchRevision_;
        snapshot.match = match;
        baselineMatch_ = match;
    }
    snapshot.matchRevision = matchRevision_;
    snapshot.local = m_gameServer.makeLocalAuthoritativeState(m_entity);
    const auto& registry = m_gameServer.m_entityManager.getRegistry();
    const auto players = registry.view<Components::EntityBase,
                                       Components::Transform3D,
                                       Components::Velocity3D,
                                       Components::CharacterController,
                                       Components::PlayerInput,
                                       Components::PlayerLife>();
    std::unordered_map<std::uint64_t, protocol::PublicEntityState> nextBaseline;
    nextBaseline.reserve(players.size_hint());
    for (const auto entity : players) {
        if (entity == m_entity ||
            players.get<Components::EntityBase>(entity).type != PLAYER) continue;
        auto state = m_gameServer.makePublicEntityState(entity);
        const auto key = handleKey(state.handle);
        nextBaseline.emplace(key, state);
        const auto previous = baseline_.find(key);
        if (snapshot.baselineReset || previous == baseline_.end()) {
            snapshot.created.push_back({state});
            continue;
        }
        auto update = deltaFor(previous->second, state);
        if (update.changeMask != 0U) snapshot.updated.push_back(std::move(update));
    }
    for (const auto& previous : baseline_) {
        if (nextBaseline.count(previous.first) != 0U) continue;
        snapshot.removed.push_back(
            {previous.second.handle,
             previous.second.kind == protocol::EntityKind::Player
                 ? protocol::RemoveReason::Destroyed
                 : protocol::RemoveReason::OutOfScope});
    }
    baseline_ = std::move(nextBaseline);
    baselineInitialized_ = true;
    replication::validateSnapshotDelta(snapshot);
    auto encoded = protocol::encode(snapshot);
    m_gameServer.observeSnapshot(
        std::chrono::duration<double, std::milli>(
            std::chrono::steady_clock::now() - started)
            .count(),
        encoded.size());
    queueState(std::move(encoded));
}

void Client::resetReplicationBaseline() {
    baseline_.clear();
    baselineInitialized_ = false;
    baselineMatch_.reset();
}

bool Client::spatiallyRelevant(protocol::EntityKind kind,
                               float distanceSquared,
                               bool previouslyRelevant) {
    // Players remain global for the current bounded twelve-player mode. The
    // same contract supports spatial props/spectators with leave hysteresis.
    if (kind == protocol::EntityKind::Player) return true;
    const float radius = previouslyRelevant ? kSpatialLeaveMeters
                                            : kSpatialEnterMeters;
    return std::isfinite(distanceSquared) && distanceSquared <= radius * radius;
}

bool Client::relevanceRefreshDue(std::uint32_t clientId,
                                 std::uint32_t snapshotSequence,
                                 std::uint32_t period) {
    if (period == 0U) return true;
    return (snapshotSequence + clientId) % period == 0U;
}

void Client::queueSpawn(const protocol::Spawn& message) {
    if (m_active && !closing_) queue(protocol::encode(message));
}
void Client::queueRemove(const protocol::Remove& message) {
    if (m_active && !closing_) queue(protocol::encode(message));
}
void Client::queueChat(const protocol::Chat& message) {
    if (m_active && !closing_) queue(protocol::encode(message));
}
void Client::queueShotConfirmed(const protocol::ShotConfirmed& message) {
    if (m_active && !closing_) queue(protocol::encode(message));
}
void Client::queueImpact(const protocol::Impact& message) {
    if (m_active && !closing_) queue(protocol::encode(message));
}
void Client::queueDamage(const protocol::Damage& message) {
    if (m_active && !closing_) queue(protocol::encode(message));
}
void Client::queueDeath(const protocol::Death& message) {
    if (m_active && !closing_) queue(protocol::encode(message));
}
void Client::queueRespawn(const protocol::Respawn& message) {
    if (m_active && !closing_) queue(protocol::encode(message));
}
void Client::queueScoreChange(const protocol::ScoreChange& message) {
    if (m_active && !closing_) queue(protocol::encode(message));
}
void Client::queueRoundTransition(const protocol::RoundTransition& message) {
    if (m_active && !closing_) queue(protocol::encode(message));
}
void Client::queueActionResult(const protocol::ActionResult& message) {
    if (m_active && !closing_) queue(protocol::encode(message));
}

void Client::markInputProcessed(std::uint32_t sequence) {
    lastProcessedInputSequence_ = sequence;
}
void Client::markInputDequeued() {
    if (pendingInputs_ > 0U) --pendingInputs_;
}

void Client::onClose() {
    if (closeHandled_) return;
    closeHandled_ = true;
    if (m_active && m_entity != entt::null) {
        m_gameServer.broadcastRemove(protocol::Remove{
            static_cast<std::uint32_t>(m_gameServer.m_currentTick),
            m_gameServer.makeEntityHandle(m_entity),
            protocol::RemoveReason::Disconnected});
        m_gameServer.m_entityManager.scheduleForRemoval(m_entity);
    }
    m_active = false;
    closing_ = true;
    outgoing_.clear();
    latestState_.reset();
    baseline_.clear();
    baselineInitialized_ = false;
    outgoingBytes_ = 0U;
}

void Client::changeBody(entt::entity entity) { m_entity = entity; }
