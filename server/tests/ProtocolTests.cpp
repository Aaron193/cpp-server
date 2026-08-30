#include "TestHarness.hpp"

#include <cstdint>
#include <fstream>
#include <limits>
#include <nlohmann/json.hpp>
#include <string>
#include <type_traits>
#include <variant>
#include <vector>

#include "protocol/generated.hpp"
#include "GameServer.hpp"
#include "network/ReplicationProtocol.hpp"

namespace {

std::vector<std::uint8_t> fromHex(const std::string& hex) {
    std::vector<std::uint8_t> bytes;
    bytes.reserve(hex.size() / 2U);
    for (std::size_t index = 0; index < hex.size(); index += 2U) {
        bytes.push_back(static_cast<std::uint8_t>(
            std::stoul(hex.substr(index, 2U), nullptr, 16)));
    }
    return bytes;
}

std::string toHex(const std::vector<std::uint8_t>& bytes) {
    static constexpr char digits[] = "0123456789abcdef";
    std::string result;
    result.reserve(bytes.size() * 2U);
    for (const auto byte : bytes) {
        result.push_back(digits[byte >> 4U]);
        result.push_back(digits[byte & 0x0FU]);
    }
    return result;
}

std::vector<std::uint8_t> reencode(const protocol::MessagePayload& message) {
    return std::visit(
        [](const auto& value) -> std::vector<std::uint8_t> {
            using T = std::decay_t<decltype(value)>;
            if constexpr (std::is_same_v<T, std::monostate>) {
                throw std::runtime_error("cannot encode unknown message");
            } else {
                return protocol::encode(value);
            }
        },
        message);
}

template <typename Function>
void expectProtocolError(Function&& function) {
    bool rejected = false;
    try {
        function();
    } catch (const protocol::ProtocolError&) {
        rejected = true;
    }
    EXPECT_TRUE(rejected);
}

}  // namespace

TEST_CASE(protocol_decodes_shared_vectors_and_reproduces_identical_bytes) {
    std::ifstream input(std::string(SERVER_SOURCE_DIR) +
                        "/../protocol/fixtures/golden-vectors.json");
    EXPECT_TRUE(input.is_open());
    nlohmann::json vectors;
    input >> vectors;
    for (const auto& fixture : vectors) {
        const auto expected = fixture.at("expectedHex").get<std::string>();
        const auto bytes = fromHex(expected);
        const auto decoded = protocol::decodeEnvelope(bytes);
        EXPECT_TRUE(decoded.known);
        EXPECT_EQ(decoded.nextOffset, bytes.size());
        EXPECT_EQ(toHex(reencode(decoded.message)), expected);

        const auto name = fixture.at("name").get<std::string>();
        if (name == "input-wrap-values") {
            const auto& batch = std::get<protocol::InputBatch>(decoded.message);
            EXPECT_EQ(batch.commands.at(0).sequence, 0xFFFFFFFFU);
            EXPECT_EQ(batch.commands.at(0).clientTick, 0xFFFFFFFEU);
        } else if (name == "version-mismatch-reject") {
            const auto& reject = std::get<protocol::Reject>(decoded.message);
            EXPECT_EQ(reject.reason, protocol::RejectReason::VersionMismatch);
            EXPECT_EQ(reject.expectedProtocolVersion,
                      SessionConfiguration::ProtocolVersion);
            EXPECT_EQ(reject.expectedMapFormat, 2U);
        } else if (name == "snapshot-entity") {
            const auto& snapshot =
                std::get<protocol::Snapshot>(decoded.message);
            EXPECT_EQ(snapshot.entities.at(0).equippedWeapon,
                      protocol::Weapon::Rifle);
        } else if (name == "authoritative-score-row") {
            const auto& score =
                std::get<protocol::ScoreChange>(decoded.message);
            EXPECT_EQ(score.score, 9);
            EXPECT_EQ(score.delta, -1);
            EXPECT_EQ(score.kills, 9U);
            EXPECT_EQ(score.deaths, 4U);
        } else if (name == "shot-confirmed-shotgun") {
            const auto& confirmation =
                std::get<protocol::ShotConfirmed>(decoded.message);
            EXPECT_EQ(confirmation.weapon, protocol::Weapon::Shotgun);
            EXPECT_NEAR(confirmation.origin.x, 1.25F, 0.0001F);
            EXPECT_EQ(confirmation.pelletEndPositions.size(), 2U);
            EXPECT_NEAR(confirmation.pelletEndPositions.at(0).z, -23.75F,
                        0.0001F);
        } else if (name == "clock-ping-wrap") {
            EXPECT_EQ(std::get<protocol::Ping>(decoded.message).pingId,
                      0xFFFFFFFFU);
        } else if (name == "clock-pong-anchor-wrap") {
            const auto& pong = std::get<protocol::Pong>(decoded.message);
            EXPECT_EQ(pong.pingId, 0xFFFFFFFFU);
            EXPECT_EQ(pong.serverTick, 0xFFFFFFFEU);
            EXPECT_EQ(pong.serverMonotonicMs, 0xFFFFFFF0U);
        } else if (name == "snapshot-delta-all-update-bits") {
            const auto& snapshot = std::get<protocol::SnapshotDelta>(decoded.message);
            EXPECT_EQ(snapshot.baselineSequence, 1U);
            EXPECT_EQ(snapshot.updated.at(0).changeMask, replication::All);
            EXPECT_TRUE(replication::validUpdatedEntity(snapshot.updated.at(0)));
        }
    }
}

TEST_CASE(snapshot_delta_validates_every_field_mask_combination) {
    for (std::uint16_t mask = 1U; mask <= replication::All; ++mask) {
        protocol::UpdatedEntity update{};
        update.handle = {2U, 1U}; update.changeMask = mask;
        if (mask & replication::Position) update.position = protocol::Vec3{};
        if (mask & replication::Velocity) update.velocity = protocol::Vec3{};
        if (mask & replication::BodyYaw) update.bodyYaw = 0.0F;
        if (mask & replication::AimPitch) update.aimPitch = 0.0F;
        if (mask & replication::Grounded) update.grounded = true;
        if (mask & replication::StateFlags) update.stateFlags = 0U;
        if (mask & replication::EquippedWeapon)
            update.equippedWeapon = protocol::Weapon::Rifle;
        if (mask & replication::Stance)
            update.stance = protocol::Stance::Crouched;
        if (mask & replication::MovementMode)
            update.movementMode = protocol::MovementMode::Sliding;
        EXPECT_TRUE(replication::validUpdatedEntity(update));
    }
    protocol::UpdatedEntity malformed{};
    malformed.handle = {2U, 1U}; malformed.changeMask = replication::Position;
    EXPECT_TRUE(!replication::validUpdatedEntity(malformed));
    malformed.changeMask = 0U;
    EXPECT_TRUE(!replication::validUpdatedEntity(malformed));
    malformed.changeMask = 1U << 9U;
    EXPECT_TRUE(!replication::validUpdatedEntity(malformed));
}

TEST_CASE(authoritative_movement_state_rejects_invalid_timers_and_vectors) {
    protocol::MovementState movement{};
    movement.stance = protocol::Stance::Standing;
    movement.mode = protocol::MovementMode::Normal;
    movement.dashDirection = {0.0F, 0.0F, -1.0F};
    EXPECT_TRUE(replication::validMovementState(movement));

    movement.modeTimeRemaining = -0.01F;
    EXPECT_TRUE(!replication::validMovementState(movement));
    movement.modeTimeRemaining = 0.0F;
    movement.dashCooldownRemaining = 61.0F;
    EXPECT_TRUE(!replication::validMovementState(movement));
    movement.dashCooldownRemaining = 0.0F;
    movement.mantleTarget.x = std::numeric_limits<float>::quiet_NaN();
    EXPECT_TRUE(!replication::validMovementState(movement));
}

TEST_CASE(protocol_skips_well_formed_unknown_message_by_length) {
    const std::vector<std::uint8_t> bytes{250U, 2U, 0U, 0xAAU, 0xBBU,
                                          15U, 5U, 0U, 0U, 1U, 1U, 0U, 'x'};
    const auto unknown = protocol::decodeEnvelope(bytes);
    EXPECT_TRUE(!unknown.known);
    EXPECT_EQ(unknown.messageType, 250U);
    EXPECT_EQ(unknown.nextOffset, 5U);
    const auto chat = protocol::decodeEnvelope(bytes, unknown.nextOffset);
    EXPECT_TRUE(chat.known);
    EXPECT_EQ(std::get<protocol::Chat>(chat.message).text, std::string("x"));
}

TEST_CASE(protocol_rejects_invalid_strings_floats_enums_and_lengths) {
    protocol::Chat chat{};
    chat.channel = protocol::ChatChannel::Global;
    chat.text.assign(1U, static_cast<char>(0xFF));
    expectProtocolError([&] { (void)protocol::encode(chat); });
    chat.text.assign(protocol::Limits::MaxChatBytes + 1U, 'x');
    expectProtocolError([&] { (void)protocol::encode(chat); });

    auto invalidUtf8 = fromHex("0f050000010100ff");
    expectProtocolError([&] { (void)protocol::decodeEnvelope(invalidUtf8); });

    protocol::InputCommand command{};
    command.sequence = 0xFFFFFFFFU;
    command.clientTick = 0xFFFFFFFEU;
    command.selectedWeapon = protocol::Weapon::Rifle;
    protocol::InputBatch batch{{command}};
    auto nonFinite = protocol::encode(batch);
    nonFinite[13] = 0U; nonFinite[14] = 0U; nonFinite[15] = 0xC0U;
    nonFinite[16] = 0x7FU;
    expectProtocolError([&] { (void)protocol::decodeEnvelope(nonFinite); });
    auto invalidEnum = protocol::encode(batch);
    invalidEnum.back() = 99U;
    expectProtocolError([&] { (void)protocol::decodeEnvelope(invalidEnum); });

    batch.commands.clear();
    expectProtocolError([&] { (void)protocol::encode(batch); });
    batch.commands.resize(protocol::Limits::MaxInputCommands + 1U);
    expectProtocolError([&] { (void)protocol::encode(batch); });
}

TEST_CASE(protocol_rejects_malformed_envelopes) {
    expectProtocolError(
        [] { (void)protocol::decodeEnvelope(std::vector<std::uint8_t>{}); });
    expectProtocolError([] {
        (void)protocol::decodeEnvelope(
            std::vector<std::uint8_t>{1U, 4U, 0U, 1U});
    });
    expectProtocolError([] {
        (void)protocol::decodeEnvelope(
            std::vector<std::uint8_t>{250U, 0xFFU, 0xFFU});
    });

    protocol::Hello hello{1U, "build", 1U, std::nullopt};
    auto trailing = protocol::encode(hello);
    ++trailing[1];
    trailing.push_back(0U);
    expectProtocolError([&] { (void)protocol::decodeEnvelope(trailing); });

    hello.clientBuildId = "ok";
    hello.accessToken.reset();
    const auto encoded = protocol::encode(hello);
    EXPECT_EQ(encoded.size(), static_cast<std::size_t>(3U + encoded[1]));

    auto truncatedPong = protocol::encode(protocol::Pong{1U, 2U, 3U});
    truncatedPong.pop_back();
    expectProtocolError(
        [&] { (void)protocol::decodeEnvelope(truncatedPong); });
}
