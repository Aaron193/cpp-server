#include "TestHarness.hpp"

#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "GameServer.hpp"
#include "client/Client.hpp"
#include "network/PeerTransport.hpp"
#include "protocol/generated.hpp"
#include "util/Sha256.hpp"

namespace {
struct FakeState {
    std::vector<std::vector<std::uint8_t>> sent;
    bool closed = false;
    std::uint16_t closeCode = 0;
    std::size_t closeCount = 0U;
};

class FakeTransport final : public PeerTransport {
   public:
    explicit FakeTransport(std::shared_ptr<FakeState> state)
        : state_(std::move(state)) {}
    void sendBinary(const std::vector<std::uint8_t>& bytes) override {
        state_->sent.push_back(bytes);
    }
    void close(std::uint16_t code, std::string_view) override {
        state_->closed = true;
        state_->closeCode = code;
        ++state_->closeCount;
    }
   private:
    std::shared_ptr<FakeState> state_;
};

struct Session {
    GameServer& server;
    std::uint32_t id;
    std::shared_ptr<FakeState> wire = std::make_shared<FakeState>();
    std::unique_ptr<Client> client;

    Session(GameServer& serverValue, std::uint32_t idValue)
        : server(serverValue), id(idValue),
          client(std::make_unique<Client>(
              server, std::make_unique<FakeTransport>(wire), id)) {
        server.m_clients.emplace(id, client.get());
    }
    ~Session() { server.m_clients.erase(id); }
};

std::string bytes(const std::vector<std::uint8_t>& value) {
    return {reinterpret_cast<const char*>(value.data()), value.size()};
}

protocol::Hello validHello(const GameServer& server) {
    return {SessionConfiguration::ProtocolVersion,
            server.m_sessionConfiguration.buildId,
            static_cast<std::uint16_t>(server.m_mapPackage.manifest.formatVersion),
            std::nullopt};
}

protocol::DecodedEnvelope decoded(const std::vector<std::uint8_t>& value) {
    return protocol::decodeEnvelope(value);
}

void welcome(Session& session) {
    const auto encoded = protocol::encode(validHello(session.server));
    session.client->onMessageAt(bytes(encoded), 1.0);
}

protocol::InputCommand command(std::uint32_t sequence, std::uint32_t tick,
                               float x = 0.0F, float y = 0.0F) {
    return {sequence, tick, x, y, 0U, 0.0F, 0.0F,
            protocol::Weapon::Rifle};
}
}  // namespace

TEST_CASE(session_welcomes_valid_hello_with_configuration) {
    GameServer server;
    Session session(server, 7U);
    welcome(session);
    EXPECT_TRUE(session.client->welcomed());
    EXPECT_TRUE(!session.wire->closed);
    EXPECT_EQ(session.wire->sent.size(), 4U);
    const auto welcomeMessage = decoded(session.wire->sent[0]);
    EXPECT_EQ(welcomeMessage.messageType,
              static_cast<std::uint8_t>(protocol::MessageType::Welcome));
    const auto& payload = std::get<protocol::Welcome>(welcomeMessage.message);
    EXPECT_EQ(payload.map.mapId, server.m_mapPackage.manifest.mapId);
    EXPECT_EQ(payload.snapshotRate, 20U);
    const auto configurationMessage = decoded(session.wire->sent[1]);
    EXPECT_EQ(configurationMessage.messageType,
              static_cast<std::uint8_t>(protocol::MessageType::Configuration));
    const auto& configuration =
        std::get<protocol::Configuration>(configurationMessage.message);
    EXPECT_EQ(payload.configurationHash, configuration.configurationHash);
    EXPECT_EQ(configuration.configurationHash,
              util::sha256Identifier(configuration.configurationJson));
    EXPECT_EQ(configuration.configurationJson,
              server.m_gameConfig.toJsonString());
    const auto spawnMessage = decoded(session.wire->sent[2]);
    EXPECT_EQ(spawnMessage.messageType,
              static_cast<std::uint8_t>(protocol::MessageType::Spawn));
    const auto& spawn = std::get<protocol::Spawn>(spawnMessage.message);
    EXPECT_EQ(spawn.entity.entityId,
              static_cast<std::uint32_t>(session.client->m_entity));
    EXPECT_TRUE(spawn.entity.health.has_value());
    EXPECT_TRUE(spawn.entity.weaponState.has_value());
    EXPECT_EQ(spawn.entity.equippedWeapon, protocol::Weapon::Rifle);
    const auto& score = std::get<protocol::ScoreChange>(
        decoded(session.wire->sent[3]).message);
    EXPECT_EQ(score.playerId,
              static_cast<std::uint32_t>(session.client->m_entity));
    EXPECT_EQ(score.score, 0);
    EXPECT_EQ(score.kills, 0U);
    EXPECT_EQ(score.deaths, 0U);
}

TEST_CASE(spawn_is_ordered_and_matches_snapshot_with_per_recipient_privacy) {
    GameServer server;
    Session first(server, 1U); welcome(first);
    first.wire->sent.clear();

    Session second(server, 2U); welcome(second);
    EXPECT_EQ(second.wire->sent.size(), 5U);
    EXPECT_EQ(decoded(second.wire->sent[0]).messageType,
              static_cast<std::uint8_t>(protocol::MessageType::Welcome));
    EXPECT_EQ(decoded(second.wire->sent[1]).messageType,
              static_cast<std::uint8_t>(protocol::MessageType::Configuration));
    const auto ownerEnvelope = decoded(second.wire->sent[2]);
    const auto& ownerSpawn = std::get<protocol::Spawn>(ownerEnvelope.message);
    EXPECT_TRUE(ownerSpawn.entity.health.has_value());
    EXPECT_TRUE(ownerSpawn.entity.weaponState.has_value());
    EXPECT_EQ(ownerSpawn.entity.equippedWeapon, protocol::Weapon::Rifle);

    first.client->sendBytes();
    EXPECT_EQ(first.wire->sent.size(), 1U);
    const auto publicEnvelope = decoded(first.wire->sent[0]);
    const auto& publicSpawn = std::get<protocol::Spawn>(publicEnvelope.message);
    EXPECT_EQ(publicSpawn.entity.entityId, ownerSpawn.entity.entityId);
    EXPECT_TRUE(!publicSpawn.entity.health.has_value());
    EXPECT_TRUE(!publicSpawn.entity.weaponState.has_value());
    EXPECT_EQ(publicSpawn.entity.equippedWeapon, protocol::Weapon::Rifle);
    EXPECT_NEAR(publicSpawn.entity.position.x,
                ownerSpawn.entity.position.x, 0.0001F);
    EXPECT_NEAR(publicSpawn.entity.position.y,
                ownerSpawn.entity.position.y, 0.0001F);
    EXPECT_NEAR(publicSpawn.entity.position.z,
                ownerSpawn.entity.position.z, 0.0001F);
    const auto initialAuthoritative = server.makeEntityRecord(
        second.client->m_entity, first.client->m_entity);
    EXPECT_NEAR(publicSpawn.entity.position.x,
                initialAuthoritative.position.x, 0.0001F);
    EXPECT_NEAR(publicSpawn.entity.position.y,
                initialAuthoritative.position.y, 0.0001F);
    EXPECT_NEAR(publicSpawn.entity.position.z,
                initialAuthoritative.position.z, 0.0001F);

    first.wire->sent.clear();
    for (int tick = 0; tick < 3; ++tick) server.simulateOneTick();
    first.client->sendBytes();
    const auto snapshotEnvelope = decoded(first.wire->sent.back());
    const auto& snapshot =
        std::get<protocol::Snapshot>(snapshotEnvelope.message);
    const auto currentAuthoritative = server.makeEntityRecord(
        second.client->m_entity, first.client->m_entity);
    bool matched = false;
    for (const auto& record : snapshot.entities) {
        if (record.entityId != publicSpawn.entity.entityId) continue;
        matched = true;
        EXPECT_NEAR(record.position.x, currentAuthoritative.position.x, 0.0001F);
        EXPECT_NEAR(record.position.y, currentAuthoritative.position.y, 0.0001F);
        EXPECT_NEAR(record.position.z, currentAuthoritative.position.z, 0.0001F);
        EXPECT_EQ(record.kind, publicSpawn.entity.kind);
        EXPECT_EQ(record.equippedWeapon, publicSpawn.entity.equippedWeapon);
        EXPECT_TRUE(!record.health.has_value());
        EXPECT_TRUE(!record.weaponState.has_value());
    }
    EXPECT_TRUE(matched);
}

TEST_CASE(session_rejects_version_map_build_and_capacity_mismatches) {
    GameServer server;
    {
        Session session(server, 1U);
        auto hello = validHello(server); ++hello.protocolVersion;
        const auto encoded = protocol::encode(hello);
        session.client->onMessageAt(bytes(encoded), 1.0);
        EXPECT_EQ(std::get<protocol::Reject>(decoded(session.wire->sent[0]).message).reason,
                  protocol::RejectReason::VersionMismatch);
    }
    {
        Session session(server, 2U);
        auto hello = validHello(server); ++hello.supportedMapFormat;
        const auto encoded = protocol::encode(hello);
        session.client->onMessageAt(bytes(encoded), 1.0);
        EXPECT_EQ(std::get<protocol::Reject>(decoded(session.wire->sent[0]).message).reason,
                  protocol::RejectReason::MapMismatch);
    }
    {
        Session session(server, 3U);
        auto hello = validHello(server); hello.clientBuildId = "other";
        const auto encoded = protocol::encode(hello);
        session.client->onMessageAt(bytes(encoded), 1.0);
        EXPECT_EQ(std::get<protocol::Reject>(decoded(session.wire->sent[0]).message).reason,
                  protocol::RejectReason::BuildMismatch);
    }
    server.m_sessionConfiguration.maxPlayers = 1U;
    Session accepted(server, 4U); welcome(accepted);
    Session full(server, 5U); welcome(full);
    EXPECT_EQ(std::get<protocol::Reject>(decoded(full.wire->sent[0]).message).reason,
              protocol::RejectReason::ServerFull);
}

TEST_CASE(session_requires_hello_skips_unknown_and_closes_malformed_packets) {
    GameServer server;
    Session first(server, 1U);
    const auto input = protocol::encode(protocol::InputBatch{{command(1, 1)}});
    first.client->onMessageAt(bytes(input), 1.0);
    EXPECT_EQ(std::get<protocol::Reject>(decoded(first.wire->sent[0]).message).reason,
              protocol::RejectReason::InvalidHello);

    Session malformed(server, 2U);
    malformed.client->onMessageAt(std::string("\x01\x04", 2), 1.0);
    EXPECT_TRUE(malformed.wire->closed);
    EXPECT_EQ(malformed.wire->closeCode, 1002U);

    Session unknownBeforeHello(server, 3U);
    unknownBeforeHello.client->onMessageAt(
        std::string("\xfa\x02\x00\xaa\xbb", 5), 1.0);
    EXPECT_TRUE(!unknownBeforeHello.wire->closed);
    EXPECT_TRUE(!unknownBeforeHello.client->welcomed());
    welcome(unknownBeforeHello);
    EXPECT_TRUE(unknownBeforeHello.client->welcomed());

    unknownBeforeHello.client->onMessageAt(
        std::string("\xfb\x01\x00\xcc", 4), 2.0);
    EXPECT_TRUE(!unknownBeforeHello.wire->closed);

    Session truncatedUnknown(server, 4U);
    truncatedUnknown.client->onMessageAt(
        std::string("\xfc\x02\x00\xaa", 4), 1.0);
    EXPECT_TRUE(truncatedUnknown.wire->closed);
    EXPECT_EQ(truncatedUnknown.wire->closeCode, 1002U);
}

TEST_CASE(session_passes_bounded_tokens_to_the_authentication_seam) {
    GameServer server;
    std::optional<std::string> observed;
    server.m_sessionConfiguration.authenticate =
        [&](const std::optional<std::string>& token) {
            observed = token;
            return token == std::optional<std::string>("signed-token");
        };
    Session session(server, 1U);
    auto hello = validHello(server);
    hello.accessToken = "signed-token";
    const auto packet = protocol::encode(hello);
    session.client->onMessageAt(bytes(packet), 1.0);
    EXPECT_TRUE(session.client->welcomed());
    EXPECT_EQ(observed.value(), std::string("signed-token"));
}

TEST_CASE(session_allows_60hz_jitter_headroom_but_bounds_input_bursts) {
    GameServer server;
    Session inputSession(server, 1U); welcome(inputSession);
    for (std::uint32_t index = 1; index <= 72U && !inputSession.wire->closed; ++index) {
        const auto packet = protocol::encode(
            protocol::InputBatch{{command(index, index)}});
        inputSession.client->onMessageAt(bytes(packet), 2.0);
    }
    EXPECT_TRUE(!inputSession.wire->closed);
    const auto excess = protocol::encode(
        protocol::InputBatch{{command(73U, 73U)}});
    inputSession.client->onMessageAt(bytes(excess), 2.999);
    EXPECT_TRUE(inputSession.wire->closed);
    EXPECT_EQ(inputSession.wire->closeCode, 1008U);
    EXPECT_EQ(inputSession.wire->closeCount, 1U);

    Session boundary(server, 2U); welcome(boundary);
    for (std::uint32_t index = 1; index <= 60U; ++index) {
        const auto packet = protocol::encode(
            protocol::InputBatch{{command(index, index)}});
        boundary.client->onMessageAt(
            bytes(packet), 10.0 + static_cast<double>(index - 1U) / 60.0);
    }
    for (std::uint32_t index = 61U; index <= 66U; ++index) {
        const auto packet = protocol::encode(
            protocol::InputBatch{{command(index, index)}});
        boundary.client->onMessageAt(
            bytes(packet), 11.0 + static_cast<double>(index - 61U) / 120.0);
    }
    EXPECT_TRUE(!boundary.wire->closed);
}

TEST_CASE(session_keeps_input_backlog_and_chat_limits_bounded) {
    GameServer server;
    Session backlog(server, 1U); welcome(backlog);
    std::uint32_t sequence = 1U;
    for (int batchIndex = 0; batchIndex < 2; ++batchIndex) {
        protocol::InputBatch batch{};
        for (std::size_t index = 0;
             index < protocol::Limits::MaxInputCommands; ++index)
            batch.commands.push_back(command(sequence, sequence++));
        const auto packet = protocol::encode(batch);
        backlog.client->onMessageAt(bytes(packet), 2.0);
    }
    EXPECT_TRUE(!backlog.wire->closed);
    const auto overBacklog = protocol::encode(
        protocol::InputBatch{{command(sequence, sequence)}});
    backlog.client->onMessageAt(bytes(overBacklog), 2.0);
    EXPECT_TRUE(backlog.wire->closed);

    Session chatSession(server, 2U); welcome(chatSession);
    const auto chat = protocol::encode(protocol::Chat{
        999U, protocol::ChatChannel::Global, "hello"});
    for (int index = 0; index < 6; ++index)
        chatSession.client->onMessageAt(bytes(chat), 3.0);
    EXPECT_TRUE(chatSession.wire->closed);
}

TEST_CASE(session_accepts_wraparound_sequences_and_preserves_input_order) {
    GameServer server;
    Session session(server, 1U); welcome(session);
    protocol::InputBatch batch{{
        command(0xFFFFFFFEU, 0xFFFFFFFEU, 0.1F, 0.0F),
        command(0xFFFFFFFFU, 0xFFFFFFFFU, 0.2F, 0.0F),
        command(0U, 0U, 0.3F, 0.0F)}};
    const auto packet = protocol::encode(batch);
    session.client->onMessageAt(bytes(packet), 2.0);
    EXPECT_TRUE(!session.wire->closed);
    EXPECT_TRUE(!session.client->lastProcessedInputSequence().has_value());

    auto& registry = server.m_entityManager.getRegistry();
    const float initialX = registry.get<Components::Transform3D>(
        session.client->m_entity).position.x;
    server.simulateOneTick();
    EXPECT_EQ(server.m_currentTick, 1U);
    EXPECT_EQ(session.client->lastProcessedInputSequence().value_or(0U),
              0xFFFFFFFEU);
    EXPECT_NEAR(registry.get<Components::PlayerInput>(
                    session.client->m_entity).movement.x,
                0.1F, 0.0001F);
    const float firstX = registry.get<Components::Transform3D>(
        session.client->m_entity).position.x;
    EXPECT_TRUE(firstX > initialX);

    server.simulateOneTick();
    EXPECT_EQ(server.m_currentTick, 2U);
    EXPECT_EQ(session.client->lastProcessedInputSequence().value_or(0U),
              0xFFFFFFFFU);
    EXPECT_NEAR(registry.get<Components::PlayerInput>(
                    session.client->m_entity).movement.x,
                0.2F, 0.0001F);
    const float secondX = registry.get<Components::Transform3D>(
        session.client->m_entity).position.x;
    EXPECT_TRUE(secondX > firstX);

    server.simulateOneTick();
    EXPECT_EQ(server.m_currentTick, 3U);
    EXPECT_EQ(session.client->lastProcessedInputSequence().value_or(1U), 0U);
    EXPECT_NEAR(registry.get<Components::PlayerInput>(
                    session.client->m_entity).movement.x,
                0.3F, 0.0001F);
    EXPECT_TRUE(registry.get<Components::Transform3D>(
                    session.client->m_entity).position.x > secondX);
}

TEST_CASE(client_tick_uses_first_snapshot_server_tick_domain_and_clamps_safely) {
    GameServer server;
    Session session(server, 1U); welcome(session);
    session.wire->sent.clear();
    for (int tick = 0; tick < 3; ++tick) server.simulateOneTick();
    session.client->sendBytes();
    const auto& snapshot = std::get<protocol::Snapshot>(
        decoded(session.wire->sent.back()).message);
    EXPECT_EQ(snapshot.serverTick, 3U);
    EXPECT_EQ(server.acceptedHistoryTick(snapshot.serverTick), 3U);
    EXPECT_EQ(server.acceptedHistoryTick(0U), 1U);
    EXPECT_EQ(server.acceptedHistoryTick(1000U), 3U);

    const auto packet = protocol::encode(protocol::InputBatch{{
        command(1U, snapshot.serverTick, 0.25F, 0.0F)}});
    session.client->onMessageAt(bytes(packet), 2.0);
    server.simulateOneTick();
    EXPECT_EQ(server.m_entityManager.getRegistry()
                  .get<Components::PlayerInput>(session.client->m_entity)
                  .clientTick,
              snapshot.serverTick);
}

TEST_CASE(simulation_discards_disconnected_and_invalid_entity_inputs) {
    GameServer server;
    Session session(server, 1U); welcome(session);
    const auto packet = protocol::encode(
        protocol::InputBatch{{command(1U, 1U, 0.5F, 0.0F)}});
    session.client->onMessageAt(bytes(packet), 2.0);
    session.client->onClose();

    Components::PlayerInput invalidEntityInput{};
    invalidEntityInput.movement = {0.25F, 0.0F};
    server.queueValidatedInput(entt::null, invalidEntityInput);
    server.simulateOneTick();

    EXPECT_TRUE(!session.client->lastProcessedInputSequence().has_value());
    EXPECT_TRUE(!server.m_entityManager.getRegistry().valid(
        session.client->m_entity));
}

TEST_CASE(session_rejects_invalid_axes_angles_buttons_and_nonmonotonic_input) {
    GameServer server;
    Session session(server, 1U); welcome(session);
    auto invalid = command(1U, 1U, 1.0F, 1.0F);
    invalid.pitch = 2.0F;
    invalid.buttonFlags = 0x8000U;
    const auto packet = protocol::encode(protocol::InputBatch{{invalid}});
    session.client->onMessageAt(bytes(packet), 2.0);
    EXPECT_TRUE(session.wire->closed);
    EXPECT_EQ(session.wire->closeCode, 1008U);
}

TEST_CASE(session_rejects_client_authored_damage_messages) {
    GameServer server;
    Session session(server, 1U); welcome(session);
    const auto spoof = protocol::encode(protocol::Damage{
        1U, 99U, static_cast<std::uint32_t>(session.client->m_entity),
        100U, 0U});
    session.client->onMessageAt(bytes(spoof), 2.0);
    EXPECT_TRUE(session.wire->closed);
    EXPECT_EQ(session.wire->closeCode, 1002U);
}

TEST_CASE(protocol_close_is_requested_once_and_subsequent_hello_still_works) {
    GameServer server;
    Session failing(server, 1U); welcome(failing);
    auto invalid = command(1U, 1U);
    invalid.moveX = 1.0F;
    invalid.moveY = 1.0F;
    const auto packet = protocol::encode(protocol::InputBatch{{invalid}});
    failing.client->onMessageAt(bytes(packet), 2.0);
    failing.client->onMessageAt(bytes(packet), 2.0);
    EXPECT_TRUE(failing.client->closing());
    EXPECT_EQ(failing.wire->closeCount, 1U);
    failing.client->onClose();

    Session later(server, 2U); welcome(later);
    EXPECT_TRUE(later.client->welcomed());
    EXPECT_TRUE(!later.wire->closed);
    EXPECT_EQ(decoded(later.wire->sent[0]).messageType,
              static_cast<std::uint8_t>(protocol::MessageType::Welcome));
}

TEST_CASE(snapshots_include_all_players_but_only_local_private_state) {
    GameServer server;
    Session first(server, 1U); welcome(first);
    Session second(server, 2U); welcome(second);
    server.m_entityManager.getRegistry()
        .get<Components::WeaponInventory>(second.client->m_entity)
        .activeSlot = 1U;
    first.client->sendBytes();
    first.wire->sent.clear();
    for (int tick = 0; tick < 3; ++tick) server.simulateOneTick();
    first.client->sendBytes();
    EXPECT_EQ(first.wire->sent.size(), 1U);
    const auto snapshotEnvelope = decoded(first.wire->sent[0]);
    const auto& snapshot =
        std::get<protocol::Snapshot>(snapshotEnvelope.message);
    EXPECT_EQ(snapshot.entities.size(), 2U);
    std::size_t privateRecords = 0U;
    for (const auto& entity : snapshot.entities) {
        if (entity.entityId == static_cast<std::uint32_t>(first.client->m_entity)) {
            EXPECT_EQ(entity.equippedWeapon, protocol::Weapon::Rifle);
            EXPECT_TRUE(entity.health.has_value());
            EXPECT_TRUE(entity.weaponState.has_value());
            ++privateRecords;
        } else {
            EXPECT_EQ(entity.equippedWeapon, protocol::Weapon::Shotgun);
            EXPECT_TRUE(!entity.health.has_value());
            EXPECT_TRUE(!entity.weaponState.has_value());
        }
    }
    EXPECT_EQ(privateRecords, 1U);
}

TEST_CASE(disconnect_and_reconnect_remove_session_owned_entity_state) {
    GameServer server;
    Session observer(server, 99U); welcome(observer);
    observer.wire->sent.clear();
    entt::entity disconnected = entt::null;
    {
        Session session(server, 1U); welcome(session);
        observer.client->sendBytes();
        observer.wire->sent.clear();
        disconnected = session.client->m_entity;
        session.client->onClose();
        session.client->onClose();
        EXPECT_TRUE(server.m_entityManager.getRegistry().valid(disconnected));
        EXPECT_TRUE(server.m_entityManager.getRegistry().all_of<Components::Removal>(
            disconnected));
        observer.client->sendBytes();
        EXPECT_EQ(observer.wire->sent.size(), 1U);
        const auto removeEnvelope = decoded(observer.wire->sent[0]);
        const auto& remove =
            std::get<protocol::Remove>(removeEnvelope.message);
        EXPECT_EQ(remove.entityId, static_cast<std::uint32_t>(disconnected));
        EXPECT_EQ(remove.reason, protocol::RemoveReason::Disconnected);
        server.simulateOneTick();
        EXPECT_TRUE(!server.m_entityManager.getRegistry().valid(disconnected));
    }
    Session reconnect(server, 2U); welcome(reconnect);
    EXPECT_TRUE(reconnect.client->welcomed());
    EXPECT_TRUE(server.m_entityManager.getRegistry().valid(reconnect.client->m_entity));
    EXPECT_TRUE(reconnect.client->m_entity != disconnected);
}

TEST_CASE(prehello_rejected_and_duplicate_closes_do_not_broadcast_remove) {
    GameServer server;
    Session observer(server, 1U); welcome(observer);
    observer.wire->sent.clear();

    Session preHello(server, 2U);
    preHello.client->onClose();
    preHello.client->onClose();

    Session rejected(server, 3U);
    auto invalid = validHello(server);
    ++invalid.protocolVersion;
    const auto packet = protocol::encode(invalid);
    rejected.client->onMessageAt(bytes(packet), 2.0);
    EXPECT_EQ(rejected.wire->closeCount, 1U);
    rejected.client->onClose();
    rejected.client->onClose();

    observer.client->sendBytes();
    EXPECT_TRUE(observer.wire->sent.empty());
}

TEST_CASE(reliable_spawn_remove_and_chat_apis_use_generated_messages) {
    GameServer server;
    Session session(server, 1U); welcome(session);
    session.wire->sent.clear();
    protocol::EntityRecord entity{};
    entity.entityId = 42U;
    entity.kind = protocol::EntityKind::Prop;
    server.broadcastSpawn({1U, entity});
    server.broadcastRemove({2U, 42U, protocol::RemoveReason::Destroyed});
    server.broadcastChat({std::nullopt, protocol::ChatChannel::System, "ready"});
    session.client->sendBytes();
    EXPECT_EQ(session.wire->sent.size(), 3U);
    EXPECT_EQ(decoded(session.wire->sent[0]).messageType,
              static_cast<std::uint8_t>(protocol::MessageType::Spawn));
    EXPECT_EQ(decoded(session.wire->sent[1]).messageType,
              static_cast<std::uint8_t>(protocol::MessageType::Remove));
    EXPECT_EQ(decoded(session.wire->sent[2]).messageType,
              static_cast<std::uint8_t>(protocol::MessageType::Chat));
}

TEST_CASE(combat_events_are_reliable_private_and_deterministically_ordered) {
    GameServer server;
    Session killer(server, 1U); welcome(killer);
    Session victim(server, 2U); welcome(victim);
    killer.client->sendBytes();
    victim.client->sendBytes();
    killer.wire->sent.clear();
    victim.wire->sent.clear();
    auto& registry = server.m_entityManager.getRegistry();
    registry.get<Components::PlayerLife>(victim.client->m_entity)
        .spawnProtectionRemaining = 0.0F;
    server.applyDamage(killer.client->m_entity, victim.client->m_entity,
                       100.0F, ItemType::GUN_RIFLE);
    server.simulateOneTick();
    killer.client->sendBytes();
    victim.client->sendBytes();
    EXPECT_EQ(killer.wire->sent.size(), 4U);
    EXPECT_EQ(victim.wire->sent.size(), 4U);
    for (const auto* wire : {killer.wire.get(), victim.wire.get()}) {
        EXPECT_EQ(decoded(wire->sent[0]).messageType,
                  static_cast<std::uint8_t>(protocol::MessageType::Damage));
        EXPECT_EQ(decoded(wire->sent[1]).messageType,
                  static_cast<std::uint8_t>(protocol::MessageType::Death));
        EXPECT_EQ(decoded(wire->sent[2]).messageType,
                  static_cast<std::uint8_t>(protocol::MessageType::ScoreChange));
        EXPECT_EQ(decoded(wire->sent[3]).messageType,
                  static_cast<std::uint8_t>(protocol::MessageType::ScoreChange));
        const auto& victimRow = std::get<protocol::ScoreChange>(
            decoded(wire->sent[2]).message);
        const auto& killerRow = std::get<protocol::ScoreChange>(
            decoded(wire->sent[3]).message);
        EXPECT_EQ(victimRow.deaths, 1U);
        EXPECT_EQ(killerRow.kills, 1U);
    }
}

TEST_CASE(mid_round_join_receives_complete_authoritative_scoreboard) {
    GameServer server;
    Session first(server, 1U); welcome(first);
    Session second(server, 2U); welcome(second);
    auto& registry = server.m_entityManager.getRegistry();
    registry.get<Components::Score>(first.client->m_entity) = {7U, 3U, 7};
    registry.get<Components::Score>(second.client->m_entity) = {2U, 9U, 2};

    Session joining(server, 3U); welcome(joining);
    EXPECT_EQ(joining.wire->sent.size(), 6U);
    EXPECT_EQ(decoded(joining.wire->sent[0]).messageType,
              static_cast<std::uint8_t>(protocol::MessageType::Welcome));
    EXPECT_EQ(decoded(joining.wire->sent[1]).messageType,
              static_cast<std::uint8_t>(protocol::MessageType::Configuration));
    EXPECT_EQ(decoded(joining.wire->sent[2]).messageType,
              static_cast<std::uint8_t>(protocol::MessageType::Spawn));
    std::uint32_t previousId = 0U;
    for (std::size_t index = 3U; index < joining.wire->sent.size(); ++index) {
        const auto& row = std::get<protocol::ScoreChange>(
            decoded(joining.wire->sent[index]).message);
        EXPECT_TRUE(index == 3U || row.playerId > previousId);
        previousId = row.playerId;
        if (row.playerId == static_cast<std::uint32_t>(first.client->m_entity)) {
            EXPECT_EQ(row.score, 7);
            EXPECT_EQ(row.kills, 7U);
            EXPECT_EQ(row.deaths, 3U);
        }
        if (row.playerId == static_cast<std::uint32_t>(second.client->m_entity)) {
            EXPECT_EQ(row.score, 2);
            EXPECT_EQ(row.kills, 2U);
            EXPECT_EQ(row.deaths, 9U);
        }
    }
}

TEST_CASE(accepted_shot_confirmation_is_broadcast_with_owner_correlation) {
    GameServer server;
    Session shooter(server, 1U); welcome(shooter);
    Session remote(server, 2U); welcome(remote);
    shooter.client->sendBytes();
    remote.client->sendBytes();
    shooter.wire->sent.clear();
    remote.wire->sent.clear();
    Components::PlayerInput input{};
    input.mouseIsDown = true;
    input.dirtyClick = true;
    input.clientTick = 1U;
    input.inputSequence = 123U;
    server.queueValidatedInput(shooter.client->m_entity, input);
    server.simulateOneTick();
    shooter.client->sendBytes();
    remote.client->sendBytes();
    EXPECT_TRUE(!shooter.wire->sent.empty());
    EXPECT_TRUE(!remote.wire->sent.empty());
    const auto& ownerConfirmation = std::get<protocol::ShotConfirmed>(
        decoded(shooter.wire->sent.front()).message);
    const auto& remoteConfirmation = std::get<protocol::ShotConfirmed>(
        decoded(remote.wire->sent.front()).message);
    EXPECT_EQ(ownerConfirmation.shooterId,
              static_cast<std::uint32_t>(shooter.client->m_entity));
    EXPECT_EQ(ownerConfirmation.inputSequence, 123U);
    EXPECT_EQ(remoteConfirmation.shooterId, ownerConfirmation.shooterId);
    EXPECT_EQ(remoteConfirmation.shotId, ownerConfirmation.shotId);
    EXPECT_EQ(remoteConfirmation.inputSequence, 123U);
    EXPECT_EQ(ownerConfirmation.weapon, protocol::Weapon::Rifle);
    EXPECT_EQ(remoteConfirmation.weapon, protocol::Weapon::Rifle);
}

TEST_CASE(round_reset_preserves_client_owned_entity_ids) {
    GameServer server;
    Session first(server, 1U); welcome(first);
    Session second(server, 2U); welcome(second);
    const entt::entity firstEntity = first.client->m_entity;
    const entt::entity secondEntity = second.client->m_entity;
    auto& registry = server.m_entityManager.getRegistry();
    registry.get<Components::PlayerLife>(secondEntity)
        .spawnProtectionRemaining = 0.0F;
    auto& score = registry.get<Components::Score>(firstEntity);
    score.kills = 24U;
    score.points = 24;
    server.applyDamage(firstEntity, secondEntity, 100.0F,
                       ItemType::GUN_RIFLE);
    server.simulateOneTick();
    EXPECT_EQ(server.matchState().phase, protocol::MatchPhase::Intermission);
    server.m_currentTick =
        static_cast<std::uint64_t>(server.matchState().phaseEndsAtTick) - 1U;
    server.simulateOneTick();
    EXPECT_EQ(first.client->m_entity, firstEntity);
    EXPECT_EQ(second.client->m_entity, secondEntity);
    EXPECT_TRUE(registry.valid(firstEntity));
    EXPECT_TRUE(registry.valid(secondEntity));
    EXPECT_TRUE(registry.all_of<Components::Client>(firstEntity));
    EXPECT_TRUE(registry.all_of<Components::Client>(secondEntity));
}
