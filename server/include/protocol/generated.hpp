// Generated from protocol/schema.json by protocol/generate.mjs. DO NOT EDIT.
#pragma once

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>
#include <optional>
#include <stdexcept>
#include <string>
#include <utility>
#include <variant>
#include <vector>

namespace protocol {

struct Limits {
    static constexpr std::size_t MaxEnvelopeBytes = 61443U;
    static constexpr std::size_t MaxPayloadBytes = 61440U;
    static constexpr std::size_t MaxStringBytes = 16384U;
    static constexpr std::size_t MaxBuildIdBytes = 64U;
    static constexpr std::size_t MaxMapIdBytes = 64U;
    static constexpr std::size_t MaxHashBytes = 128U;
    static constexpr std::size_t MaxAccessTokenBytes = 512U;
    static constexpr std::size_t MaxRejectDetailBytes = 256U;
    static constexpr std::size_t MaxChatBytes = 512U;
    static constexpr std::size_t MaxConfigurationBytes = 16384U;
    static constexpr std::size_t MaxInputCommands = 64U;
    static constexpr std::size_t MaxPelletsPerShot = 32U;
    static constexpr std::size_t MaxSnapshotEntities = 512U;
    static constexpr std::size_t MaxSnapshotCreated = 512U;
    static constexpr std::size_t MaxSnapshotUpdated = 512U;
    static constexpr std::size_t MaxSnapshotRemoved = 512U;
};

class ProtocolError : public std::runtime_error {
   public:
    explicit ProtocolError(const std::string& message) : std::runtime_error(message) {}
};

enum class MessageType : std::uint8_t {
    Hello = 1,
    Welcome = 2,
    Reject = 3,
    InputBatch = 4,
    Snapshot = 5,
    Spawn = 6,
    Remove = 7,
    ShotConfirmed = 8,
    Impact = 9,
    Damage = 10,
    Death = 11,
    Respawn = 12,
    ScoreChange = 13,
    RoundTransition = 14,
    Chat = 15,
    Configuration = 16,
    Ping = 17,
    Pong = 18,
    SnapshotDelta = 19,
    ActionResult = 20,
};

enum class RejectReason : std::uint8_t {
    VersionMismatch = 1,
    BuildMismatch = 2,
    MapMismatch = 3,
    ServerFull = 4,
    Unauthorized = 5,
    InvalidHello = 6,
    InternalError = 7,
};

enum class EntityKind : std::uint8_t {
    Player = 1,
    Spectator = 2,
    Prop = 3,
};

enum class MatchPhase : std::uint8_t {
    Waiting = 1,
    Active = 2,
    Intermission = 3,
    Ended = 4,
};

enum class Weapon : std::uint8_t {
    None = 0,
    Rifle = 1,
    Shotgun = 2,
};

enum class RemoveReason : std::uint8_t {
    Disconnected = 1,
    Destroyed = 2,
    OutOfScope = 3,
};

enum class ImpactMaterial : std::uint8_t {
    World = 1,
    Player = 2,
};

enum class RoundTransitionKind : std::uint8_t {
    Started = 1,
    Ended = 2,
    Intermission = 3,
    Reset = 4,
};

enum class ChatChannel : std::uint8_t {
    Global = 1,
    System = 2,
};

enum class ActionKind : std::uint8_t {
    Fire = 1,
    Reload = 2,
};

enum class ActionRejectReason : std::uint8_t {
    None = 0,
    Cadence = 1,
    NoAmmo = 2,
    Dead = 3,
    MatchInactive = 4,
    WeaponMismatch = 5,
    AlreadyReloading = 6,
    MagazineFull = 7,
    NoReserve = 8,
    Duplicate = 9,
    Invalid = 10,
    MovementLocked = 11,
};

enum class Stance : std::uint8_t {
    Standing = 0,
    Crouched = 1,
    Prone = 2,
};

enum class MovementMode : std::uint8_t {
    Normal = 0,
    Sprinting = 1,
    Sliding = 2,
    Dashing = 3,
    Mantling = 4,
};

struct Vec3 {
    float x{};
    float y{};
    float z{};
};

struct MapDescriptor {
    std::string mapId{};
    std::uint16_t formatVersion{};
    std::string contentHash{};
};

struct MatchState {
    MatchPhase phase{};
    std::uint16_t roundNumber{};
    std::uint32_t phaseEndsAtTick{};
};

struct WeaponState {
    Weapon selected{};
    std::uint16_t magazineAmmo{};
    std::uint16_t reserveAmmo{};
    std::uint8_t stateFlags{};
};

struct MovementState {
    Stance stance{};
    MovementMode mode{};
    float modeTimeRemaining{};
    float dashCooldownRemaining{};
    float slideCooldownRemaining{};
    float weaponLockRemaining{};
    bool stanceExpansionPending{};
    Vec3 dashDirection{};
    Vec3 mantleStart{};
    Vec3 mantleTarget{};
};

struct InputCommand {
    std::uint32_t sequence{};
    std::uint32_t clientTick{};
    float moveX{};
    float moveY{};
    std::uint16_t buttonFlags{};
    std::uint32_t fireActionId{};
    std::uint32_t reloadActionId{};
    float yaw{};
    float pitch{};
    Weapon selectedWeapon{};
};

struct EntityHandle {
    std::uint32_t slot{};
    std::uint16_t generation{};
};

struct PublicEntityState {
    EntityHandle handle{};
    EntityKind kind{};
    Vec3 position{};
    Vec3 velocity{};
    float bodyYaw{};
    float aimPitch{};
    bool grounded{};
    std::uint16_t stateFlags{};
    Stance stance{};
    MovementMode movementMode{};
    Weapon equippedWeapon{};
};

struct CreatedEntity {
    PublicEntityState state{};
};

struct UpdatedEntity {
    EntityHandle handle{};
    std::uint16_t changeMask{};
    std::optional<Vec3> position{};
    std::optional<Vec3> velocity{};
    std::optional<float> bodyYaw{};
    std::optional<float> aimPitch{};
    std::optional<bool> grounded{};
    std::optional<std::uint16_t> stateFlags{};
    std::optional<Weapon> equippedWeapon{};
    std::optional<Stance> stance{};
    std::optional<MovementMode> movementMode{};
};

struct RemovedEntity {
    EntityHandle handle{};
    RemoveReason reason{};
};

struct LocalAuthoritativeState {
    EntityHandle handle{};
    Vec3 position{};
    Vec3 velocity{};
    float bodyYaw{};
    float aimPitch{};
    bool grounded{};
    std::uint16_t stateFlags{};
    std::uint16_t health{};
    MovementState movementState{};
    WeaponState weaponState{};
};

struct EntityRecord {
    std::uint32_t entityId{};
    EntityKind kind{};
    Vec3 position{};
    Vec3 velocity{};
    float bodyYaw{};
    float aimPitch{};
    bool grounded{};
    std::uint16_t stateFlags{};
    Stance stance{};
    MovementMode movementMode{};
    Weapon equippedWeapon{};
};

struct Hello {
    std::uint16_t protocolVersion{};
    std::string clientBuildId{};
    std::uint16_t supportedMapFormat{};
    std::optional<std::string> accessToken{};
};

struct Welcome {
    std::uint16_t protocolVersion{};
    std::string serverBuildId{};
    std::uint32_t playerId{};
    EntityHandle playerHandle{};
    std::uint16_t tickRate{};
    std::uint16_t snapshotRate{};
    MapDescriptor map{};
    std::string configurationHash{};
};

struct Reject {
    std::string serverBuildId{};
    RejectReason reason{};
    std::string detail{};
    std::uint16_t expectedProtocolVersion{};
    std::uint16_t expectedMapFormat{};
};

struct InputBatch {
    std::vector<InputCommand> commands{};
};

struct Snapshot {
    std::uint32_t serverTick{};
    std::uint32_t lastProcessedInputSequence{};
    MatchState match{};
    std::vector<EntityRecord> entities{};
};

struct Spawn {
    std::uint32_t serverTick{};
    PublicEntityState entity{};
};

struct Remove {
    std::uint32_t serverTick{};
    EntityHandle handle{};
    RemoveReason reason{};
};

struct ShotConfirmed {
    std::uint32_t serverTick{};
    std::uint32_t shooterId{};
    std::uint32_t inputSequence{};
    std::uint32_t actionId{};
    std::uint32_t shotId{};
    Weapon weapon{};
    Vec3 origin{};
    std::vector<Vec3> pelletEndPositions{};
};

struct Impact {
    std::uint32_t serverTick{};
    std::uint32_t shotId{};
    std::uint8_t pelletIndex{};
    Vec3 position{};
    Vec3 normal{};
    ImpactMaterial material{};
};

struct Damage {
    std::uint32_t serverTick{};
    std::optional<std::uint32_t> sourceId{};
    std::uint32_t targetId{};
    std::uint16_t amount{};
    std::uint16_t remainingHealth{};
};

struct Death {
    std::uint32_t serverTick{};
    std::uint32_t victimId{};
    std::optional<std::uint32_t> killerId{};
    Weapon weapon{};
};

struct Respawn {
    std::uint32_t serverTick{};
    std::uint32_t playerId{};
    Vec3 position{};
    float bodyYaw{};
};

struct ScoreChange {
    std::uint32_t serverTick{};
    std::uint32_t playerId{};
    std::int32_t score{};
    std::int16_t delta{};
    std::uint32_t kills{};
    std::uint32_t deaths{};
};

struct RoundTransition {
    std::uint32_t serverTick{};
    RoundTransitionKind transition{};
    MatchState match{};
};

struct Chat {
    std::optional<std::uint32_t> senderId{};
    ChatChannel channel{};
    std::string text{};
};

struct Configuration {
    std::uint16_t protocolVersion{};
    std::string serverBuildId{};
    MapDescriptor map{};
    std::string configurationHash{};
    std::string configurationJson{};
};

struct Ping {
    std::uint32_t pingId{};
};

struct Pong {
    std::uint32_t pingId{};
    std::uint32_t serverTick{};
    std::uint32_t serverMonotonicMs{};
};

struct SnapshotDelta {
    std::uint32_t snapshotSequence{};
    std::uint32_t baselineSequence{};
    std::uint32_t baselineRevision{};
    bool baselineReset{};
    std::uint32_t serverTick{};
    std::uint32_t lastProcessedInputSequence{};
    std::uint32_t matchRevision{};
    std::optional<MatchState> match{};
    LocalAuthoritativeState local{};
    std::vector<CreatedEntity> created{};
    std::vector<UpdatedEntity> updated{};
    std::vector<RemovedEntity> removed{};
};

struct ActionResult {
    std::uint32_t serverTick{};
    std::uint32_t actionId{};
    ActionKind kind{};
    bool accepted{};
    ActionRejectReason reason{};
    Weapon weapon{};
    std::uint16_t authoritativeMagazineAmmo{};
    std::uint16_t authoritativeReserveAmmo{};
};

namespace detail {

inline bool validUtf8(const std::uint8_t* bytes, std::size_t size) {
    std::size_t index = 0;
    while (index < size) {
        const std::uint8_t first = bytes[index++];
        if (first <= 0x7FU) continue;
        std::size_t continuation = 0;
        std::uint32_t codepoint = 0;
        if (first >= 0xC2U && first <= 0xDFU) { continuation = 1; codepoint = first & 0x1FU; }
        else if (first >= 0xE0U && first <= 0xEFU) { continuation = 2; codepoint = first & 0x0FU; }
        else if (first >= 0xF0U && first <= 0xF4U) { continuation = 3; codepoint = first & 0x07U; }
        else return false;
        if (index + continuation > size) return false;
        for (std::size_t offset = 0; offset < continuation; ++offset) {
            const std::uint8_t next = bytes[index++];
            if ((next & 0xC0U) != 0x80U) return false;
            codepoint = (codepoint << 6U) | (next & 0x3FU);
        }
        if ((continuation == 2 && codepoint < 0x800U) ||
            (continuation == 3 && codepoint < 0x10000U) ||
            (codepoint >= 0xD800U && codepoint <= 0xDFFFU) || codepoint > 0x10FFFFU) return false;
    }
    return true;
}

class Writer {
   public:
    const std::vector<std::uint8_t>& bytes() const { return bytes_; }
    void writeU8(std::uint8_t value) { bytes_.push_back(value); }
    void writeU16(std::uint16_t value) { writeU8(static_cast<std::uint8_t>(value)); writeU8(static_cast<std::uint8_t>(value >> 8U)); }
    void writeU32(std::uint32_t value) { writeU16(static_cast<std::uint16_t>(value)); writeU16(static_cast<std::uint16_t>(value >> 16U)); }
    void writeI16(std::int16_t value) { std::uint16_t raw; std::memcpy(&raw, &value, sizeof(raw)); writeU16(raw); }
    void writeI32(std::int32_t value) { std::uint32_t raw; std::memcpy(&raw, &value, sizeof(raw)); writeU32(raw); }
    void writeF32(float value) {
        if (!std::isfinite(value)) throw ProtocolError("non-finite float");
        std::uint32_t raw; std::memcpy(&raw, &value, sizeof(raw)); writeU32(raw);
    }
    void writeBool(bool value) { writeU8(value ? 1U : 0U); }
    void writeLength(std::size_t value, std::size_t minimum, std::size_t maximum) {
        if (value < minimum || value > maximum || value > std::numeric_limits<std::uint16_t>::max()) throw ProtocolError("bounded length out of range");
        writeU16(static_cast<std::uint16_t>(value));
    }
    void writeString(const std::string& value, std::size_t maximum) {
        const auto* bytes = reinterpret_cast<const std::uint8_t*>(value.data());
        if (value.size() > Limits::MaxStringBytes) throw ProtocolError("string exceeds global limit");
        if (value.size() > maximum || value.size() > std::numeric_limits<std::uint16_t>::max()) throw ProtocolError("string exceeds field limit");
        if (!validUtf8(bytes, value.size())) throw ProtocolError("invalid UTF-8 string");
        writeU16(static_cast<std::uint16_t>(value.size()));
        bytes_.insert(bytes_.end(), bytes, bytes + value.size());
    }
   private:
    std::vector<std::uint8_t> bytes_;
};

class Reader {
   public:
    Reader(const std::uint8_t* data, std::size_t size) : data_(data), size_(size) {}
    std::size_t remaining() const { return size_ - offset_; }
    std::uint8_t readU8() { require(1); return data_[offset_++]; }
    std::uint16_t readU16() { const auto low = readU8(); const auto high = readU8(); return static_cast<std::uint16_t>(low | (static_cast<std::uint16_t>(high) << 8U)); }
    std::uint32_t readU32() { const auto low = readU16(); const auto high = readU16(); return static_cast<std::uint32_t>(low) | (static_cast<std::uint32_t>(high) << 16U); }
    std::int16_t readI16() { const auto raw = readU16(); std::int16_t value; std::memcpy(&value, &raw, sizeof(value)); return value; }
    std::int32_t readI32() { const auto raw = readU32(); std::int32_t value; std::memcpy(&value, &raw, sizeof(value)); return value; }
    float readF32() { const auto raw = readU32(); float value; std::memcpy(&value, &raw, sizeof(value)); if (!std::isfinite(value)) throw ProtocolError("non-finite float"); return value; }
    bool readBool() { const auto value = readU8(); if (value > 1U) throw ProtocolError("invalid boolean"); return value != 0U; }
    std::size_t readLength(std::size_t minimum, std::size_t maximum) { const auto value = readU16(); if (value < minimum || value > maximum) throw ProtocolError("bounded length out of range"); return value; }
    std::string readString(std::size_t maximum) {
        const auto length = readLength(0, maximum);
        require(length);
        if (!validUtf8(data_ + offset_, length)) throw ProtocolError("invalid UTF-8 string");
        std::string value(reinterpret_cast<const char*>(data_ + offset_), length); offset_ += length; return value;
    }
   private:
    void require(std::size_t count) const { if (count > remaining()) throw ProtocolError("truncated payload"); }
    const std::uint8_t* data_; std::size_t size_; std::size_t offset_ = 0;
};

inline void writeRejectReason(Writer& writer, RejectReason value) {
    const auto raw = static_cast<std::uint8_t>(value);
    if (!(raw == 1U || raw == 2U || raw == 3U || raw == 4U || raw == 5U || raw == 6U || raw == 7U)) throw ProtocolError("invalid RejectReason");
    writer.writeU8(raw);
}
inline RejectReason readRejectReason(Reader& reader) {
    const auto raw = reader.readU8();
    if (!(raw == 1U || raw == 2U || raw == 3U || raw == 4U || raw == 5U || raw == 6U || raw == 7U)) throw ProtocolError("invalid RejectReason");
    return static_cast<RejectReason>(raw);
}

inline void writeEntityKind(Writer& writer, EntityKind value) {
    const auto raw = static_cast<std::uint8_t>(value);
    if (!(raw == 1U || raw == 2U || raw == 3U)) throw ProtocolError("invalid EntityKind");
    writer.writeU8(raw);
}
inline EntityKind readEntityKind(Reader& reader) {
    const auto raw = reader.readU8();
    if (!(raw == 1U || raw == 2U || raw == 3U)) throw ProtocolError("invalid EntityKind");
    return static_cast<EntityKind>(raw);
}

inline void writeMatchPhase(Writer& writer, MatchPhase value) {
    const auto raw = static_cast<std::uint8_t>(value);
    if (!(raw == 1U || raw == 2U || raw == 3U || raw == 4U)) throw ProtocolError("invalid MatchPhase");
    writer.writeU8(raw);
}
inline MatchPhase readMatchPhase(Reader& reader) {
    const auto raw = reader.readU8();
    if (!(raw == 1U || raw == 2U || raw == 3U || raw == 4U)) throw ProtocolError("invalid MatchPhase");
    return static_cast<MatchPhase>(raw);
}

inline void writeWeapon(Writer& writer, Weapon value) {
    const auto raw = static_cast<std::uint8_t>(value);
    if (!(raw == 0U || raw == 1U || raw == 2U)) throw ProtocolError("invalid Weapon");
    writer.writeU8(raw);
}
inline Weapon readWeapon(Reader& reader) {
    const auto raw = reader.readU8();
    if (!(raw == 0U || raw == 1U || raw == 2U)) throw ProtocolError("invalid Weapon");
    return static_cast<Weapon>(raw);
}

inline void writeRemoveReason(Writer& writer, RemoveReason value) {
    const auto raw = static_cast<std::uint8_t>(value);
    if (!(raw == 1U || raw == 2U || raw == 3U)) throw ProtocolError("invalid RemoveReason");
    writer.writeU8(raw);
}
inline RemoveReason readRemoveReason(Reader& reader) {
    const auto raw = reader.readU8();
    if (!(raw == 1U || raw == 2U || raw == 3U)) throw ProtocolError("invalid RemoveReason");
    return static_cast<RemoveReason>(raw);
}

inline void writeImpactMaterial(Writer& writer, ImpactMaterial value) {
    const auto raw = static_cast<std::uint8_t>(value);
    if (!(raw == 1U || raw == 2U)) throw ProtocolError("invalid ImpactMaterial");
    writer.writeU8(raw);
}
inline ImpactMaterial readImpactMaterial(Reader& reader) {
    const auto raw = reader.readU8();
    if (!(raw == 1U || raw == 2U)) throw ProtocolError("invalid ImpactMaterial");
    return static_cast<ImpactMaterial>(raw);
}

inline void writeRoundTransitionKind(Writer& writer, RoundTransitionKind value) {
    const auto raw = static_cast<std::uint8_t>(value);
    if (!(raw == 1U || raw == 2U || raw == 3U || raw == 4U)) throw ProtocolError("invalid RoundTransitionKind");
    writer.writeU8(raw);
}
inline RoundTransitionKind readRoundTransitionKind(Reader& reader) {
    const auto raw = reader.readU8();
    if (!(raw == 1U || raw == 2U || raw == 3U || raw == 4U)) throw ProtocolError("invalid RoundTransitionKind");
    return static_cast<RoundTransitionKind>(raw);
}

inline void writeChatChannel(Writer& writer, ChatChannel value) {
    const auto raw = static_cast<std::uint8_t>(value);
    if (!(raw == 1U || raw == 2U)) throw ProtocolError("invalid ChatChannel");
    writer.writeU8(raw);
}
inline ChatChannel readChatChannel(Reader& reader) {
    const auto raw = reader.readU8();
    if (!(raw == 1U || raw == 2U)) throw ProtocolError("invalid ChatChannel");
    return static_cast<ChatChannel>(raw);
}

inline void writeActionKind(Writer& writer, ActionKind value) {
    const auto raw = static_cast<std::uint8_t>(value);
    if (!(raw == 1U || raw == 2U)) throw ProtocolError("invalid ActionKind");
    writer.writeU8(raw);
}
inline ActionKind readActionKind(Reader& reader) {
    const auto raw = reader.readU8();
    if (!(raw == 1U || raw == 2U)) throw ProtocolError("invalid ActionKind");
    return static_cast<ActionKind>(raw);
}

inline void writeActionRejectReason(Writer& writer, ActionRejectReason value) {
    const auto raw = static_cast<std::uint8_t>(value);
    if (!(raw == 0U || raw == 1U || raw == 2U || raw == 3U || raw == 4U || raw == 5U || raw == 6U || raw == 7U || raw == 8U || raw == 9U || raw == 10U || raw == 11U)) throw ProtocolError("invalid ActionRejectReason");
    writer.writeU8(raw);
}
inline ActionRejectReason readActionRejectReason(Reader& reader) {
    const auto raw = reader.readU8();
    if (!(raw == 0U || raw == 1U || raw == 2U || raw == 3U || raw == 4U || raw == 5U || raw == 6U || raw == 7U || raw == 8U || raw == 9U || raw == 10U || raw == 11U)) throw ProtocolError("invalid ActionRejectReason");
    return static_cast<ActionRejectReason>(raw);
}

inline void writeStance(Writer& writer, Stance value) {
    const auto raw = static_cast<std::uint8_t>(value);
    if (!(raw == 0U || raw == 1U || raw == 2U)) throw ProtocolError("invalid Stance");
    writer.writeU8(raw);
}
inline Stance readStance(Reader& reader) {
    const auto raw = reader.readU8();
    if (!(raw == 0U || raw == 1U || raw == 2U)) throw ProtocolError("invalid Stance");
    return static_cast<Stance>(raw);
}

inline void writeMovementMode(Writer& writer, MovementMode value) {
    const auto raw = static_cast<std::uint8_t>(value);
    if (!(raw == 0U || raw == 1U || raw == 2U || raw == 3U || raw == 4U)) throw ProtocolError("invalid MovementMode");
    writer.writeU8(raw);
}
inline MovementMode readMovementMode(Reader& reader) {
    const auto raw = reader.readU8();
    if (!(raw == 0U || raw == 1U || raw == 2U || raw == 3U || raw == 4U)) throw ProtocolError("invalid MovementMode");
    return static_cast<MovementMode>(raw);
}

inline void writeVec3(Writer& writer, const Vec3& value) {
    writer.writeF32(value.x);
    writer.writeF32(value.y);
    writer.writeF32(value.z);
}
inline Vec3 readVec3(Reader& reader) {
    Vec3 value{};
    value.x = reader.readF32();
    value.y = reader.readF32();
    value.z = reader.readF32();
    return value;
}

inline void writeMapDescriptor(Writer& writer, const MapDescriptor& value) {
    writer.writeString(value.mapId, Limits::MaxMapIdBytes);
    writer.writeU16(value.formatVersion);
    writer.writeString(value.contentHash, Limits::MaxHashBytes);
}
inline MapDescriptor readMapDescriptor(Reader& reader) {
    MapDescriptor value{};
    value.mapId = reader.readString(Limits::MaxMapIdBytes);
    value.formatVersion = reader.readU16();
    value.contentHash = reader.readString(Limits::MaxHashBytes);
    return value;
}

inline void writeMatchState(Writer& writer, const MatchState& value) {
    writeMatchPhase(writer, value.phase);
    writer.writeU16(value.roundNumber);
    writer.writeU32(value.phaseEndsAtTick);
}
inline MatchState readMatchState(Reader& reader) {
    MatchState value{};
    value.phase = readMatchPhase(reader);
    value.roundNumber = reader.readU16();
    value.phaseEndsAtTick = reader.readU32();
    return value;
}

inline void writeWeaponState(Writer& writer, const WeaponState& value) {
    writeWeapon(writer, value.selected);
    writer.writeU16(value.magazineAmmo);
    writer.writeU16(value.reserveAmmo);
    writer.writeU8(value.stateFlags);
}
inline WeaponState readWeaponState(Reader& reader) {
    WeaponState value{};
    value.selected = readWeapon(reader);
    value.magazineAmmo = reader.readU16();
    value.reserveAmmo = reader.readU16();
    value.stateFlags = reader.readU8();
    return value;
}

inline void writeMovementState(Writer& writer, const MovementState& value) {
    writeStance(writer, value.stance);
    writeMovementMode(writer, value.mode);
    writer.writeF32(value.modeTimeRemaining);
    writer.writeF32(value.dashCooldownRemaining);
    writer.writeF32(value.slideCooldownRemaining);
    writer.writeF32(value.weaponLockRemaining);
    writer.writeBool(value.stanceExpansionPending);
    writeVec3(writer, value.dashDirection);
    writeVec3(writer, value.mantleStart);
    writeVec3(writer, value.mantleTarget);
}
inline MovementState readMovementState(Reader& reader) {
    MovementState value{};
    value.stance = readStance(reader);
    value.mode = readMovementMode(reader);
    value.modeTimeRemaining = reader.readF32();
    value.dashCooldownRemaining = reader.readF32();
    value.slideCooldownRemaining = reader.readF32();
    value.weaponLockRemaining = reader.readF32();
    value.stanceExpansionPending = reader.readBool();
    value.dashDirection = readVec3(reader);
    value.mantleStart = readVec3(reader);
    value.mantleTarget = readVec3(reader);
    return value;
}

inline void writeInputCommand(Writer& writer, const InputCommand& value) {
    writer.writeU32(value.sequence);
    writer.writeU32(value.clientTick);
    writer.writeF32(value.moveX);
    writer.writeF32(value.moveY);
    writer.writeU16(value.buttonFlags);
    writer.writeU32(value.fireActionId);
    writer.writeU32(value.reloadActionId);
    writer.writeF32(value.yaw);
    writer.writeF32(value.pitch);
    writeWeapon(writer, value.selectedWeapon);
}
inline InputCommand readInputCommand(Reader& reader) {
    InputCommand value{};
    value.sequence = reader.readU32();
    value.clientTick = reader.readU32();
    value.moveX = reader.readF32();
    value.moveY = reader.readF32();
    value.buttonFlags = reader.readU16();
    value.fireActionId = reader.readU32();
    value.reloadActionId = reader.readU32();
    value.yaw = reader.readF32();
    value.pitch = reader.readF32();
    value.selectedWeapon = readWeapon(reader);
    return value;
}

inline void writeEntityHandle(Writer& writer, const EntityHandle& value) {
    writer.writeU32(value.slot);
    writer.writeU16(value.generation);
}
inline EntityHandle readEntityHandle(Reader& reader) {
    EntityHandle value{};
    value.slot = reader.readU32();
    value.generation = reader.readU16();
    return value;
}

inline void writePublicEntityState(Writer& writer, const PublicEntityState& value) {
    writeEntityHandle(writer, value.handle);
    writeEntityKind(writer, value.kind);
    writeVec3(writer, value.position);
    writeVec3(writer, value.velocity);
    writer.writeF32(value.bodyYaw);
    writer.writeF32(value.aimPitch);
    writer.writeBool(value.grounded);
    writer.writeU16(value.stateFlags);
    writeStance(writer, value.stance);
    writeMovementMode(writer, value.movementMode);
    writeWeapon(writer, value.equippedWeapon);
}
inline PublicEntityState readPublicEntityState(Reader& reader) {
    PublicEntityState value{};
    value.handle = readEntityHandle(reader);
    value.kind = readEntityKind(reader);
    value.position = readVec3(reader);
    value.velocity = readVec3(reader);
    value.bodyYaw = reader.readF32();
    value.aimPitch = reader.readF32();
    value.grounded = reader.readBool();
    value.stateFlags = reader.readU16();
    value.stance = readStance(reader);
    value.movementMode = readMovementMode(reader);
    value.equippedWeapon = readWeapon(reader);
    return value;
}

inline void writeCreatedEntity(Writer& writer, const CreatedEntity& value) {
    writePublicEntityState(writer, value.state);
}
inline CreatedEntity readCreatedEntity(Reader& reader) {
    CreatedEntity value{};
    value.state = readPublicEntityState(reader);
    return value;
}

inline void writeUpdatedEntity(Writer& writer, const UpdatedEntity& value) {
    writeEntityHandle(writer, value.handle);
    writer.writeU16(value.changeMask);
    writer.writeBool(value.position.has_value());
    if (value.position.has_value()) {
        writeVec3(writer, *value.position);
    }
    writer.writeBool(value.velocity.has_value());
    if (value.velocity.has_value()) {
        writeVec3(writer, *value.velocity);
    }
    writer.writeBool(value.bodyYaw.has_value());
    if (value.bodyYaw.has_value()) {
        writer.writeF32(*value.bodyYaw);
    }
    writer.writeBool(value.aimPitch.has_value());
    if (value.aimPitch.has_value()) {
        writer.writeF32(*value.aimPitch);
    }
    writer.writeBool(value.grounded.has_value());
    if (value.grounded.has_value()) {
        writer.writeBool(*value.grounded);
    }
    writer.writeBool(value.stateFlags.has_value());
    if (value.stateFlags.has_value()) {
        writer.writeU16(*value.stateFlags);
    }
    writer.writeBool(value.equippedWeapon.has_value());
    if (value.equippedWeapon.has_value()) {
        writeWeapon(writer, *value.equippedWeapon);
    }
    writer.writeBool(value.stance.has_value());
    if (value.stance.has_value()) {
        writeStance(writer, *value.stance);
    }
    writer.writeBool(value.movementMode.has_value());
    if (value.movementMode.has_value()) {
        writeMovementMode(writer, *value.movementMode);
    }
}
inline UpdatedEntity readUpdatedEntity(Reader& reader) {
    UpdatedEntity value{};
    value.handle = readEntityHandle(reader);
    value.changeMask = reader.readU16();
    if (reader.readBool()) {
        Vec3 decodedValue{};
        decodedValue = readVec3(reader);
        value.position = std::move(decodedValue);
    } else {
        value.position.reset();
    }
    if (reader.readBool()) {
        Vec3 decodedValue{};
        decodedValue = readVec3(reader);
        value.velocity = std::move(decodedValue);
    } else {
        value.velocity.reset();
    }
    if (reader.readBool()) {
        float decodedValue{};
        decodedValue = reader.readF32();
        value.bodyYaw = std::move(decodedValue);
    } else {
        value.bodyYaw.reset();
    }
    if (reader.readBool()) {
        float decodedValue{};
        decodedValue = reader.readF32();
        value.aimPitch = std::move(decodedValue);
    } else {
        value.aimPitch.reset();
    }
    if (reader.readBool()) {
        bool decodedValue{};
        decodedValue = reader.readBool();
        value.grounded = std::move(decodedValue);
    } else {
        value.grounded.reset();
    }
    if (reader.readBool()) {
        std::uint16_t decodedValue{};
        decodedValue = reader.readU16();
        value.stateFlags = std::move(decodedValue);
    } else {
        value.stateFlags.reset();
    }
    if (reader.readBool()) {
        Weapon decodedValue{};
        decodedValue = readWeapon(reader);
        value.equippedWeapon = std::move(decodedValue);
    } else {
        value.equippedWeapon.reset();
    }
    if (reader.readBool()) {
        Stance decodedValue{};
        decodedValue = readStance(reader);
        value.stance = std::move(decodedValue);
    } else {
        value.stance.reset();
    }
    if (reader.readBool()) {
        MovementMode decodedValue{};
        decodedValue = readMovementMode(reader);
        value.movementMode = std::move(decodedValue);
    } else {
        value.movementMode.reset();
    }
    return value;
}

inline void writeRemovedEntity(Writer& writer, const RemovedEntity& value) {
    writeEntityHandle(writer, value.handle);
    writeRemoveReason(writer, value.reason);
}
inline RemovedEntity readRemovedEntity(Reader& reader) {
    RemovedEntity value{};
    value.handle = readEntityHandle(reader);
    value.reason = readRemoveReason(reader);
    return value;
}

inline void writeLocalAuthoritativeState(Writer& writer, const LocalAuthoritativeState& value) {
    writeEntityHandle(writer, value.handle);
    writeVec3(writer, value.position);
    writeVec3(writer, value.velocity);
    writer.writeF32(value.bodyYaw);
    writer.writeF32(value.aimPitch);
    writer.writeBool(value.grounded);
    writer.writeU16(value.stateFlags);
    writer.writeU16(value.health);
    writeMovementState(writer, value.movementState);
    writeWeaponState(writer, value.weaponState);
}
inline LocalAuthoritativeState readLocalAuthoritativeState(Reader& reader) {
    LocalAuthoritativeState value{};
    value.handle = readEntityHandle(reader);
    value.position = readVec3(reader);
    value.velocity = readVec3(reader);
    value.bodyYaw = reader.readF32();
    value.aimPitch = reader.readF32();
    value.grounded = reader.readBool();
    value.stateFlags = reader.readU16();
    value.health = reader.readU16();
    value.movementState = readMovementState(reader);
    value.weaponState = readWeaponState(reader);
    return value;
}

inline void writeEntityRecord(Writer& writer, const EntityRecord& value) {
    writer.writeU32(value.entityId);
    writeEntityKind(writer, value.kind);
    writeVec3(writer, value.position);
    writeVec3(writer, value.velocity);
    writer.writeF32(value.bodyYaw);
    writer.writeF32(value.aimPitch);
    writer.writeBool(value.grounded);
    writer.writeU16(value.stateFlags);
    writeStance(writer, value.stance);
    writeMovementMode(writer, value.movementMode);
    writeWeapon(writer, value.equippedWeapon);
}
inline EntityRecord readEntityRecord(Reader& reader) {
    EntityRecord value{};
    value.entityId = reader.readU32();
    value.kind = readEntityKind(reader);
    value.position = readVec3(reader);
    value.velocity = readVec3(reader);
    value.bodyYaw = reader.readF32();
    value.aimPitch = reader.readF32();
    value.grounded = reader.readBool();
    value.stateFlags = reader.readU16();
    value.stance = readStance(reader);
    value.movementMode = readMovementMode(reader);
    value.equippedWeapon = readWeapon(reader);
    return value;
}

inline void writeHello(Writer& writer, const Hello& value) {
    writer.writeU16(value.protocolVersion);
    writer.writeString(value.clientBuildId, Limits::MaxBuildIdBytes);
    writer.writeU16(value.supportedMapFormat);
    writer.writeBool(value.accessToken.has_value());
    if (value.accessToken.has_value()) {
        writer.writeString(*value.accessToken, Limits::MaxAccessTokenBytes);
    }
}
inline Hello readHello(Reader& reader) {
    Hello value{};
    value.protocolVersion = reader.readU16();
    value.clientBuildId = reader.readString(Limits::MaxBuildIdBytes);
    value.supportedMapFormat = reader.readU16();
    if (reader.readBool()) {
        std::string decodedValue{};
        decodedValue = reader.readString(Limits::MaxAccessTokenBytes);
        value.accessToken = std::move(decodedValue);
    } else {
        value.accessToken.reset();
    }
    return value;
}

inline void writeWelcome(Writer& writer, const Welcome& value) {
    writer.writeU16(value.protocolVersion);
    writer.writeString(value.serverBuildId, Limits::MaxBuildIdBytes);
    writer.writeU32(value.playerId);
    writeEntityHandle(writer, value.playerHandle);
    writer.writeU16(value.tickRate);
    writer.writeU16(value.snapshotRate);
    writeMapDescriptor(writer, value.map);
    writer.writeString(value.configurationHash, Limits::MaxHashBytes);
}
inline Welcome readWelcome(Reader& reader) {
    Welcome value{};
    value.protocolVersion = reader.readU16();
    value.serverBuildId = reader.readString(Limits::MaxBuildIdBytes);
    value.playerId = reader.readU32();
    value.playerHandle = readEntityHandle(reader);
    value.tickRate = reader.readU16();
    value.snapshotRate = reader.readU16();
    value.map = readMapDescriptor(reader);
    value.configurationHash = reader.readString(Limits::MaxHashBytes);
    return value;
}

inline void writeReject(Writer& writer, const Reject& value) {
    writer.writeString(value.serverBuildId, Limits::MaxBuildIdBytes);
    writeRejectReason(writer, value.reason);
    writer.writeString(value.detail, Limits::MaxRejectDetailBytes);
    writer.writeU16(value.expectedProtocolVersion);
    writer.writeU16(value.expectedMapFormat);
}
inline Reject readReject(Reader& reader) {
    Reject value{};
    value.serverBuildId = reader.readString(Limits::MaxBuildIdBytes);
    value.reason = readRejectReason(reader);
    value.detail = reader.readString(Limits::MaxRejectDetailBytes);
    value.expectedProtocolVersion = reader.readU16();
    value.expectedMapFormat = reader.readU16();
    return value;
}

inline void writeInputBatch(Writer& writer, const InputBatch& value) {
    writer.writeLength(value.commands.size(), 1, Limits::MaxInputCommands);
    for (const auto& item : value.commands) {
        writeInputCommand(writer, item);
    }
}
inline InputBatch readInputBatch(Reader& reader) {
    InputBatch value{};
    {
        const auto count = reader.readLength(1, Limits::MaxInputCommands);
        value.commands.clear();
        value.commands.reserve(count);
        for (std::size_t index = 0; index < count; ++index) {
            InputCommand decodedValue{};
            decodedValue = readInputCommand(reader);
            value.commands.push_back(std::move(decodedValue));
        }
    }
    return value;
}

inline void writeSnapshot(Writer& writer, const Snapshot& value) {
    writer.writeU32(value.serverTick);
    writer.writeU32(value.lastProcessedInputSequence);
    writeMatchState(writer, value.match);
    writer.writeLength(value.entities.size(), 0, Limits::MaxSnapshotEntities);
    for (const auto& item : value.entities) {
        writeEntityRecord(writer, item);
    }
}
inline Snapshot readSnapshot(Reader& reader) {
    Snapshot value{};
    value.serverTick = reader.readU32();
    value.lastProcessedInputSequence = reader.readU32();
    value.match = readMatchState(reader);
    {
        const auto count = reader.readLength(0, Limits::MaxSnapshotEntities);
        value.entities.clear();
        value.entities.reserve(count);
        for (std::size_t index = 0; index < count; ++index) {
            EntityRecord decodedValue{};
            decodedValue = readEntityRecord(reader);
            value.entities.push_back(std::move(decodedValue));
        }
    }
    return value;
}

inline void writeSpawn(Writer& writer, const Spawn& value) {
    writer.writeU32(value.serverTick);
    writePublicEntityState(writer, value.entity);
}
inline Spawn readSpawn(Reader& reader) {
    Spawn value{};
    value.serverTick = reader.readU32();
    value.entity = readPublicEntityState(reader);
    return value;
}

inline void writeRemove(Writer& writer, const Remove& value) {
    writer.writeU32(value.serverTick);
    writeEntityHandle(writer, value.handle);
    writeRemoveReason(writer, value.reason);
}
inline Remove readRemove(Reader& reader) {
    Remove value{};
    value.serverTick = reader.readU32();
    value.handle = readEntityHandle(reader);
    value.reason = readRemoveReason(reader);
    return value;
}

inline void writeShotConfirmed(Writer& writer, const ShotConfirmed& value) {
    writer.writeU32(value.serverTick);
    writer.writeU32(value.shooterId);
    writer.writeU32(value.inputSequence);
    writer.writeU32(value.actionId);
    writer.writeU32(value.shotId);
    writeWeapon(writer, value.weapon);
    writeVec3(writer, value.origin);
    writer.writeLength(value.pelletEndPositions.size(), 1, Limits::MaxPelletsPerShot);
    for (const auto& item : value.pelletEndPositions) {
        writeVec3(writer, item);
    }
}
inline ShotConfirmed readShotConfirmed(Reader& reader) {
    ShotConfirmed value{};
    value.serverTick = reader.readU32();
    value.shooterId = reader.readU32();
    value.inputSequence = reader.readU32();
    value.actionId = reader.readU32();
    value.shotId = reader.readU32();
    value.weapon = readWeapon(reader);
    value.origin = readVec3(reader);
    {
        const auto count = reader.readLength(1, Limits::MaxPelletsPerShot);
        value.pelletEndPositions.clear();
        value.pelletEndPositions.reserve(count);
        for (std::size_t index = 0; index < count; ++index) {
            Vec3 decodedValue{};
            decodedValue = readVec3(reader);
            value.pelletEndPositions.push_back(std::move(decodedValue));
        }
    }
    return value;
}

inline void writeImpact(Writer& writer, const Impact& value) {
    writer.writeU32(value.serverTick);
    writer.writeU32(value.shotId);
    writer.writeU8(value.pelletIndex);
    writeVec3(writer, value.position);
    writeVec3(writer, value.normal);
    writeImpactMaterial(writer, value.material);
}
inline Impact readImpact(Reader& reader) {
    Impact value{};
    value.serverTick = reader.readU32();
    value.shotId = reader.readU32();
    value.pelletIndex = reader.readU8();
    value.position = readVec3(reader);
    value.normal = readVec3(reader);
    value.material = readImpactMaterial(reader);
    return value;
}

inline void writeDamage(Writer& writer, const Damage& value) {
    writer.writeU32(value.serverTick);
    writer.writeBool(value.sourceId.has_value());
    if (value.sourceId.has_value()) {
        writer.writeU32(*value.sourceId);
    }
    writer.writeU32(value.targetId);
    writer.writeU16(value.amount);
    writer.writeU16(value.remainingHealth);
}
inline Damage readDamage(Reader& reader) {
    Damage value{};
    value.serverTick = reader.readU32();
    if (reader.readBool()) {
        std::uint32_t decodedValue{};
        decodedValue = reader.readU32();
        value.sourceId = std::move(decodedValue);
    } else {
        value.sourceId.reset();
    }
    value.targetId = reader.readU32();
    value.amount = reader.readU16();
    value.remainingHealth = reader.readU16();
    return value;
}

inline void writeDeath(Writer& writer, const Death& value) {
    writer.writeU32(value.serverTick);
    writer.writeU32(value.victimId);
    writer.writeBool(value.killerId.has_value());
    if (value.killerId.has_value()) {
        writer.writeU32(*value.killerId);
    }
    writeWeapon(writer, value.weapon);
}
inline Death readDeath(Reader& reader) {
    Death value{};
    value.serverTick = reader.readU32();
    value.victimId = reader.readU32();
    if (reader.readBool()) {
        std::uint32_t decodedValue{};
        decodedValue = reader.readU32();
        value.killerId = std::move(decodedValue);
    } else {
        value.killerId.reset();
    }
    value.weapon = readWeapon(reader);
    return value;
}

inline void writeRespawn(Writer& writer, const Respawn& value) {
    writer.writeU32(value.serverTick);
    writer.writeU32(value.playerId);
    writeVec3(writer, value.position);
    writer.writeF32(value.bodyYaw);
}
inline Respawn readRespawn(Reader& reader) {
    Respawn value{};
    value.serverTick = reader.readU32();
    value.playerId = reader.readU32();
    value.position = readVec3(reader);
    value.bodyYaw = reader.readF32();
    return value;
}

inline void writeScoreChange(Writer& writer, const ScoreChange& value) {
    writer.writeU32(value.serverTick);
    writer.writeU32(value.playerId);
    writer.writeI32(value.score);
    writer.writeI16(value.delta);
    writer.writeU32(value.kills);
    writer.writeU32(value.deaths);
}
inline ScoreChange readScoreChange(Reader& reader) {
    ScoreChange value{};
    value.serverTick = reader.readU32();
    value.playerId = reader.readU32();
    value.score = reader.readI32();
    value.delta = reader.readI16();
    value.kills = reader.readU32();
    value.deaths = reader.readU32();
    return value;
}

inline void writeRoundTransition(Writer& writer, const RoundTransition& value) {
    writer.writeU32(value.serverTick);
    writeRoundTransitionKind(writer, value.transition);
    writeMatchState(writer, value.match);
}
inline RoundTransition readRoundTransition(Reader& reader) {
    RoundTransition value{};
    value.serverTick = reader.readU32();
    value.transition = readRoundTransitionKind(reader);
    value.match = readMatchState(reader);
    return value;
}

inline void writeChat(Writer& writer, const Chat& value) {
    writer.writeBool(value.senderId.has_value());
    if (value.senderId.has_value()) {
        writer.writeU32(*value.senderId);
    }
    writeChatChannel(writer, value.channel);
    writer.writeString(value.text, Limits::MaxChatBytes);
}
inline Chat readChat(Reader& reader) {
    Chat value{};
    if (reader.readBool()) {
        std::uint32_t decodedValue{};
        decodedValue = reader.readU32();
        value.senderId = std::move(decodedValue);
    } else {
        value.senderId.reset();
    }
    value.channel = readChatChannel(reader);
    value.text = reader.readString(Limits::MaxChatBytes);
    return value;
}

inline void writeConfiguration(Writer& writer, const Configuration& value) {
    writer.writeU16(value.protocolVersion);
    writer.writeString(value.serverBuildId, Limits::MaxBuildIdBytes);
    writeMapDescriptor(writer, value.map);
    writer.writeString(value.configurationHash, Limits::MaxHashBytes);
    writer.writeString(value.configurationJson, Limits::MaxConfigurationBytes);
}
inline Configuration readConfiguration(Reader& reader) {
    Configuration value{};
    value.protocolVersion = reader.readU16();
    value.serverBuildId = reader.readString(Limits::MaxBuildIdBytes);
    value.map = readMapDescriptor(reader);
    value.configurationHash = reader.readString(Limits::MaxHashBytes);
    value.configurationJson = reader.readString(Limits::MaxConfigurationBytes);
    return value;
}

inline void writePing(Writer& writer, const Ping& value) {
    writer.writeU32(value.pingId);
}
inline Ping readPing(Reader& reader) {
    Ping value{};
    value.pingId = reader.readU32();
    return value;
}

inline void writePong(Writer& writer, const Pong& value) {
    writer.writeU32(value.pingId);
    writer.writeU32(value.serverTick);
    writer.writeU32(value.serverMonotonicMs);
}
inline Pong readPong(Reader& reader) {
    Pong value{};
    value.pingId = reader.readU32();
    value.serverTick = reader.readU32();
    value.serverMonotonicMs = reader.readU32();
    return value;
}

inline void writeSnapshotDelta(Writer& writer, const SnapshotDelta& value) {
    writer.writeU32(value.snapshotSequence);
    writer.writeU32(value.baselineSequence);
    writer.writeU32(value.baselineRevision);
    writer.writeBool(value.baselineReset);
    writer.writeU32(value.serverTick);
    writer.writeU32(value.lastProcessedInputSequence);
    writer.writeU32(value.matchRevision);
    writer.writeBool(value.match.has_value());
    if (value.match.has_value()) {
        writeMatchState(writer, *value.match);
    }
    writeLocalAuthoritativeState(writer, value.local);
    writer.writeLength(value.created.size(), 0, Limits::MaxSnapshotCreated);
    for (const auto& item : value.created) {
        writeCreatedEntity(writer, item);
    }
    writer.writeLength(value.updated.size(), 0, Limits::MaxSnapshotUpdated);
    for (const auto& item : value.updated) {
        writeUpdatedEntity(writer, item);
    }
    writer.writeLength(value.removed.size(), 0, Limits::MaxSnapshotRemoved);
    for (const auto& item : value.removed) {
        writeRemovedEntity(writer, item);
    }
}
inline SnapshotDelta readSnapshotDelta(Reader& reader) {
    SnapshotDelta value{};
    value.snapshotSequence = reader.readU32();
    value.baselineSequence = reader.readU32();
    value.baselineRevision = reader.readU32();
    value.baselineReset = reader.readBool();
    value.serverTick = reader.readU32();
    value.lastProcessedInputSequence = reader.readU32();
    value.matchRevision = reader.readU32();
    if (reader.readBool()) {
        MatchState decodedValue{};
        decodedValue = readMatchState(reader);
        value.match = std::move(decodedValue);
    } else {
        value.match.reset();
    }
    value.local = readLocalAuthoritativeState(reader);
    {
        const auto count = reader.readLength(0, Limits::MaxSnapshotCreated);
        value.created.clear();
        value.created.reserve(count);
        for (std::size_t index = 0; index < count; ++index) {
            CreatedEntity decodedValue{};
            decodedValue = readCreatedEntity(reader);
            value.created.push_back(std::move(decodedValue));
        }
    }
    {
        const auto count = reader.readLength(0, Limits::MaxSnapshotUpdated);
        value.updated.clear();
        value.updated.reserve(count);
        for (std::size_t index = 0; index < count; ++index) {
            UpdatedEntity decodedValue{};
            decodedValue = readUpdatedEntity(reader);
            value.updated.push_back(std::move(decodedValue));
        }
    }
    {
        const auto count = reader.readLength(0, Limits::MaxSnapshotRemoved);
        value.removed.clear();
        value.removed.reserve(count);
        for (std::size_t index = 0; index < count; ++index) {
            RemovedEntity decodedValue{};
            decodedValue = readRemovedEntity(reader);
            value.removed.push_back(std::move(decodedValue));
        }
    }
    return value;
}

inline void writeActionResult(Writer& writer, const ActionResult& value) {
    writer.writeU32(value.serverTick);
    writer.writeU32(value.actionId);
    writeActionKind(writer, value.kind);
    writer.writeBool(value.accepted);
    writeActionRejectReason(writer, value.reason);
    writeWeapon(writer, value.weapon);
    writer.writeU16(value.authoritativeMagazineAmmo);
    writer.writeU16(value.authoritativeReserveAmmo);
}
inline ActionResult readActionResult(Reader& reader) {
    ActionResult value{};
    value.serverTick = reader.readU32();
    value.actionId = reader.readU32();
    value.kind = readActionKind(reader);
    value.accepted = reader.readBool();
    value.reason = readActionRejectReason(reader);
    value.weapon = readWeapon(reader);
    value.authoritativeMagazineAmmo = reader.readU16();
    value.authoritativeReserveAmmo = reader.readU16();
    return value;
}

}  // namespace detail

using MessagePayload = std::variant<std::monostate, Hello, Welcome, Reject, InputBatch, Snapshot, Spawn, Remove, ShotConfirmed, Impact, Damage, Death, Respawn, ScoreChange, RoundTransition, Chat, Configuration, Ping, Pong, SnapshotDelta, ActionResult>;

struct DecodedEnvelope {
    std::uint8_t messageType{};
    std::uint16_t payloadLength{};
    bool known{};
    MessagePayload message{};
    std::size_t nextOffset{};
};

inline std::vector<std::uint8_t> encode(const Hello& message) {
    detail::Writer payload; detail::writeHello(payload, message);
    if (payload.bytes().size() > Limits::MaxPayloadBytes) throw ProtocolError("payload exceeds maximum");
    detail::Writer envelope; envelope.writeU8(static_cast<std::uint8_t>(MessageType::Hello)); envelope.writeU16(static_cast<std::uint16_t>(payload.bytes().size()));
    std::vector<std::uint8_t> result = envelope.bytes(); result.insert(result.end(), payload.bytes().begin(), payload.bytes().end()); return result;
}
inline std::vector<std::uint8_t> encode(const Welcome& message) {
    detail::Writer payload; detail::writeWelcome(payload, message);
    if (payload.bytes().size() > Limits::MaxPayloadBytes) throw ProtocolError("payload exceeds maximum");
    detail::Writer envelope; envelope.writeU8(static_cast<std::uint8_t>(MessageType::Welcome)); envelope.writeU16(static_cast<std::uint16_t>(payload.bytes().size()));
    std::vector<std::uint8_t> result = envelope.bytes(); result.insert(result.end(), payload.bytes().begin(), payload.bytes().end()); return result;
}
inline std::vector<std::uint8_t> encode(const Reject& message) {
    detail::Writer payload; detail::writeReject(payload, message);
    if (payload.bytes().size() > Limits::MaxPayloadBytes) throw ProtocolError("payload exceeds maximum");
    detail::Writer envelope; envelope.writeU8(static_cast<std::uint8_t>(MessageType::Reject)); envelope.writeU16(static_cast<std::uint16_t>(payload.bytes().size()));
    std::vector<std::uint8_t> result = envelope.bytes(); result.insert(result.end(), payload.bytes().begin(), payload.bytes().end()); return result;
}
inline std::vector<std::uint8_t> encode(const InputBatch& message) {
    detail::Writer payload; detail::writeInputBatch(payload, message);
    if (payload.bytes().size() > Limits::MaxPayloadBytes) throw ProtocolError("payload exceeds maximum");
    detail::Writer envelope; envelope.writeU8(static_cast<std::uint8_t>(MessageType::InputBatch)); envelope.writeU16(static_cast<std::uint16_t>(payload.bytes().size()));
    std::vector<std::uint8_t> result = envelope.bytes(); result.insert(result.end(), payload.bytes().begin(), payload.bytes().end()); return result;
}
inline std::vector<std::uint8_t> encode(const Snapshot& message) {
    detail::Writer payload; detail::writeSnapshot(payload, message);
    if (payload.bytes().size() > Limits::MaxPayloadBytes) throw ProtocolError("payload exceeds maximum");
    detail::Writer envelope; envelope.writeU8(static_cast<std::uint8_t>(MessageType::Snapshot)); envelope.writeU16(static_cast<std::uint16_t>(payload.bytes().size()));
    std::vector<std::uint8_t> result = envelope.bytes(); result.insert(result.end(), payload.bytes().begin(), payload.bytes().end()); return result;
}
inline std::vector<std::uint8_t> encode(const Spawn& message) {
    detail::Writer payload; detail::writeSpawn(payload, message);
    if (payload.bytes().size() > Limits::MaxPayloadBytes) throw ProtocolError("payload exceeds maximum");
    detail::Writer envelope; envelope.writeU8(static_cast<std::uint8_t>(MessageType::Spawn)); envelope.writeU16(static_cast<std::uint16_t>(payload.bytes().size()));
    std::vector<std::uint8_t> result = envelope.bytes(); result.insert(result.end(), payload.bytes().begin(), payload.bytes().end()); return result;
}
inline std::vector<std::uint8_t> encode(const Remove& message) {
    detail::Writer payload; detail::writeRemove(payload, message);
    if (payload.bytes().size() > Limits::MaxPayloadBytes) throw ProtocolError("payload exceeds maximum");
    detail::Writer envelope; envelope.writeU8(static_cast<std::uint8_t>(MessageType::Remove)); envelope.writeU16(static_cast<std::uint16_t>(payload.bytes().size()));
    std::vector<std::uint8_t> result = envelope.bytes(); result.insert(result.end(), payload.bytes().begin(), payload.bytes().end()); return result;
}
inline std::vector<std::uint8_t> encode(const ShotConfirmed& message) {
    detail::Writer payload; detail::writeShotConfirmed(payload, message);
    if (payload.bytes().size() > Limits::MaxPayloadBytes) throw ProtocolError("payload exceeds maximum");
    detail::Writer envelope; envelope.writeU8(static_cast<std::uint8_t>(MessageType::ShotConfirmed)); envelope.writeU16(static_cast<std::uint16_t>(payload.bytes().size()));
    std::vector<std::uint8_t> result = envelope.bytes(); result.insert(result.end(), payload.bytes().begin(), payload.bytes().end()); return result;
}
inline std::vector<std::uint8_t> encode(const Impact& message) {
    detail::Writer payload; detail::writeImpact(payload, message);
    if (payload.bytes().size() > Limits::MaxPayloadBytes) throw ProtocolError("payload exceeds maximum");
    detail::Writer envelope; envelope.writeU8(static_cast<std::uint8_t>(MessageType::Impact)); envelope.writeU16(static_cast<std::uint16_t>(payload.bytes().size()));
    std::vector<std::uint8_t> result = envelope.bytes(); result.insert(result.end(), payload.bytes().begin(), payload.bytes().end()); return result;
}
inline std::vector<std::uint8_t> encode(const Damage& message) {
    detail::Writer payload; detail::writeDamage(payload, message);
    if (payload.bytes().size() > Limits::MaxPayloadBytes) throw ProtocolError("payload exceeds maximum");
    detail::Writer envelope; envelope.writeU8(static_cast<std::uint8_t>(MessageType::Damage)); envelope.writeU16(static_cast<std::uint16_t>(payload.bytes().size()));
    std::vector<std::uint8_t> result = envelope.bytes(); result.insert(result.end(), payload.bytes().begin(), payload.bytes().end()); return result;
}
inline std::vector<std::uint8_t> encode(const Death& message) {
    detail::Writer payload; detail::writeDeath(payload, message);
    if (payload.bytes().size() > Limits::MaxPayloadBytes) throw ProtocolError("payload exceeds maximum");
    detail::Writer envelope; envelope.writeU8(static_cast<std::uint8_t>(MessageType::Death)); envelope.writeU16(static_cast<std::uint16_t>(payload.bytes().size()));
    std::vector<std::uint8_t> result = envelope.bytes(); result.insert(result.end(), payload.bytes().begin(), payload.bytes().end()); return result;
}
inline std::vector<std::uint8_t> encode(const Respawn& message) {
    detail::Writer payload; detail::writeRespawn(payload, message);
    if (payload.bytes().size() > Limits::MaxPayloadBytes) throw ProtocolError("payload exceeds maximum");
    detail::Writer envelope; envelope.writeU8(static_cast<std::uint8_t>(MessageType::Respawn)); envelope.writeU16(static_cast<std::uint16_t>(payload.bytes().size()));
    std::vector<std::uint8_t> result = envelope.bytes(); result.insert(result.end(), payload.bytes().begin(), payload.bytes().end()); return result;
}
inline std::vector<std::uint8_t> encode(const ScoreChange& message) {
    detail::Writer payload; detail::writeScoreChange(payload, message);
    if (payload.bytes().size() > Limits::MaxPayloadBytes) throw ProtocolError("payload exceeds maximum");
    detail::Writer envelope; envelope.writeU8(static_cast<std::uint8_t>(MessageType::ScoreChange)); envelope.writeU16(static_cast<std::uint16_t>(payload.bytes().size()));
    std::vector<std::uint8_t> result = envelope.bytes(); result.insert(result.end(), payload.bytes().begin(), payload.bytes().end()); return result;
}
inline std::vector<std::uint8_t> encode(const RoundTransition& message) {
    detail::Writer payload; detail::writeRoundTransition(payload, message);
    if (payload.bytes().size() > Limits::MaxPayloadBytes) throw ProtocolError("payload exceeds maximum");
    detail::Writer envelope; envelope.writeU8(static_cast<std::uint8_t>(MessageType::RoundTransition)); envelope.writeU16(static_cast<std::uint16_t>(payload.bytes().size()));
    std::vector<std::uint8_t> result = envelope.bytes(); result.insert(result.end(), payload.bytes().begin(), payload.bytes().end()); return result;
}
inline std::vector<std::uint8_t> encode(const Chat& message) {
    detail::Writer payload; detail::writeChat(payload, message);
    if (payload.bytes().size() > Limits::MaxPayloadBytes) throw ProtocolError("payload exceeds maximum");
    detail::Writer envelope; envelope.writeU8(static_cast<std::uint8_t>(MessageType::Chat)); envelope.writeU16(static_cast<std::uint16_t>(payload.bytes().size()));
    std::vector<std::uint8_t> result = envelope.bytes(); result.insert(result.end(), payload.bytes().begin(), payload.bytes().end()); return result;
}
inline std::vector<std::uint8_t> encode(const Configuration& message) {
    detail::Writer payload; detail::writeConfiguration(payload, message);
    if (payload.bytes().size() > Limits::MaxPayloadBytes) throw ProtocolError("payload exceeds maximum");
    detail::Writer envelope; envelope.writeU8(static_cast<std::uint8_t>(MessageType::Configuration)); envelope.writeU16(static_cast<std::uint16_t>(payload.bytes().size()));
    std::vector<std::uint8_t> result = envelope.bytes(); result.insert(result.end(), payload.bytes().begin(), payload.bytes().end()); return result;
}
inline std::vector<std::uint8_t> encode(const Ping& message) {
    detail::Writer payload; detail::writePing(payload, message);
    if (payload.bytes().size() > Limits::MaxPayloadBytes) throw ProtocolError("payload exceeds maximum");
    detail::Writer envelope; envelope.writeU8(static_cast<std::uint8_t>(MessageType::Ping)); envelope.writeU16(static_cast<std::uint16_t>(payload.bytes().size()));
    std::vector<std::uint8_t> result = envelope.bytes(); result.insert(result.end(), payload.bytes().begin(), payload.bytes().end()); return result;
}
inline std::vector<std::uint8_t> encode(const Pong& message) {
    detail::Writer payload; detail::writePong(payload, message);
    if (payload.bytes().size() > Limits::MaxPayloadBytes) throw ProtocolError("payload exceeds maximum");
    detail::Writer envelope; envelope.writeU8(static_cast<std::uint8_t>(MessageType::Pong)); envelope.writeU16(static_cast<std::uint16_t>(payload.bytes().size()));
    std::vector<std::uint8_t> result = envelope.bytes(); result.insert(result.end(), payload.bytes().begin(), payload.bytes().end()); return result;
}
inline std::vector<std::uint8_t> encode(const SnapshotDelta& message) {
    detail::Writer payload; detail::writeSnapshotDelta(payload, message);
    if (payload.bytes().size() > Limits::MaxPayloadBytes) throw ProtocolError("payload exceeds maximum");
    detail::Writer envelope; envelope.writeU8(static_cast<std::uint8_t>(MessageType::SnapshotDelta)); envelope.writeU16(static_cast<std::uint16_t>(payload.bytes().size()));
    std::vector<std::uint8_t> result = envelope.bytes(); result.insert(result.end(), payload.bytes().begin(), payload.bytes().end()); return result;
}
inline std::vector<std::uint8_t> encode(const ActionResult& message) {
    detail::Writer payload; detail::writeActionResult(payload, message);
    if (payload.bytes().size() > Limits::MaxPayloadBytes) throw ProtocolError("payload exceeds maximum");
    detail::Writer envelope; envelope.writeU8(static_cast<std::uint8_t>(MessageType::ActionResult)); envelope.writeU16(static_cast<std::uint16_t>(payload.bytes().size()));
    std::vector<std::uint8_t> result = envelope.bytes(); result.insert(result.end(), payload.bytes().begin(), payload.bytes().end()); return result;
}

inline DecodedEnvelope decodeEnvelope(const std::uint8_t* data, std::size_t size, std::size_t offset = 0) {
    if (offset > size || size - offset < 3U) throw ProtocolError("truncated envelope");
    const std::uint8_t messageType = data[offset];
    const std::uint16_t payloadLength = static_cast<std::uint16_t>(data[offset + 1U] | (static_cast<std::uint16_t>(data[offset + 2U]) << 8U));
    if (payloadLength > Limits::MaxPayloadBytes) throw ProtocolError("oversized payload");
    const std::size_t payloadStart = offset + 3U;
    if (payloadLength > size - payloadStart) throw ProtocolError("truncated payload");
    const std::size_t nextOffset = payloadStart + payloadLength;
    detail::Reader reader(data + payloadStart, payloadLength);
    MessagePayload payload{};
    bool known = true;
    switch (messageType) {
        case 1: payload = detail::readHello(reader); break;
        case 2: payload = detail::readWelcome(reader); break;
        case 3: payload = detail::readReject(reader); break;
        case 4: payload = detail::readInputBatch(reader); break;
        case 5: payload = detail::readSnapshot(reader); break;
        case 6: payload = detail::readSpawn(reader); break;
        case 7: payload = detail::readRemove(reader); break;
        case 8: payload = detail::readShotConfirmed(reader); break;
        case 9: payload = detail::readImpact(reader); break;
        case 10: payload = detail::readDamage(reader); break;
        case 11: payload = detail::readDeath(reader); break;
        case 12: payload = detail::readRespawn(reader); break;
        case 13: payload = detail::readScoreChange(reader); break;
        case 14: payload = detail::readRoundTransition(reader); break;
        case 15: payload = detail::readChat(reader); break;
        case 16: payload = detail::readConfiguration(reader); break;
        case 17: payload = detail::readPing(reader); break;
        case 18: payload = detail::readPong(reader); break;
        case 19: payload = detail::readSnapshotDelta(reader); break;
        case 20: payload = detail::readActionResult(reader); break;
        default: known = false; break;
    }
    if (known && reader.remaining() != 0U) throw ProtocolError("payload has trailing bytes");
    return {messageType, payloadLength, known, std::move(payload), nextOffset};
}

inline DecodedEnvelope decodeEnvelope(const std::vector<std::uint8_t>& bytes, std::size_t offset = 0) {
    return decodeEnvelope(bytes.data(), bytes.size(), offset);
}

}  // namespace protocol
