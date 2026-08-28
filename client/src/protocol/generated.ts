// Generated from protocol/schema.json by protocol/generate.mjs. DO NOT EDIT.
export const PROTOCOL_VERSION = 6 as const

export const LIMITS = {
    "maxEnvelopeBytes": 61443,
    "maxPayloadBytes": 61440,
    "maxStringBytes": 16384,
    "maxBuildIdBytes": 64,
    "maxMapIdBytes": 64,
    "maxHashBytes": 128,
    "maxAccessTokenBytes": 512,
    "maxRejectDetailBytes": 256,
    "maxChatBytes": 512,
    "maxConfigurationBytes": 16384,
    "maxInputCommands": 64,
    "maxSnapshotEntities": 512,
    "maxSnapshotCreated": 512,
    "maxSnapshotUpdated": 512,
    "maxSnapshotRemoved": 512
} as const

export enum MessageType {
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
}

export enum RejectReason {
    VersionMismatch = 1,
    BuildMismatch = 2,
    MapMismatch = 3,
    ServerFull = 4,
    Unauthorized = 5,
    InvalidHello = 6,
    InternalError = 7,
}

export enum EntityKind {
    Player = 1,
    Spectator = 2,
    Prop = 3,
}

export enum MatchPhase {
    Waiting = 1,
    Active = 2,
    Intermission = 3,
    Ended = 4,
}

export enum Weapon {
    None = 0,
    Rifle = 1,
    Shotgun = 2,
}

export enum RemoveReason {
    Disconnected = 1,
    Destroyed = 2,
    OutOfScope = 3,
}

export enum ImpactMaterial {
    World = 1,
    Player = 2,
}

export enum RoundTransitionKind {
    Started = 1,
    Ended = 2,
    Intermission = 3,
    Reset = 4,
}

export enum ChatChannel {
    Global = 1,
    System = 2,
}

export enum ActionKind {
    Fire = 1,
    Reload = 2,
}

export enum ActionRejectReason {
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
}

export interface Vec3 {
    readonly x: number
    readonly y: number
    readonly z: number
}

export interface MapDescriptor {
    readonly mapId: string
    readonly formatVersion: number
    readonly contentHash: string
}

export interface MatchState {
    readonly phase: MatchPhase
    readonly roundNumber: number
    readonly phaseEndsAtTick: number
}

export interface WeaponState {
    readonly selected: Weapon
    readonly magazineAmmo: number
    readonly reserveAmmo: number
    readonly stateFlags: number
}

export interface InputCommand {
    readonly sequence: number
    readonly clientTick: number
    readonly moveX: number
    readonly moveY: number
    readonly buttonFlags: number
    readonly fireActionId: number
    readonly reloadActionId: number
    readonly yaw: number
    readonly pitch: number
    readonly selectedWeapon: Weapon
}

export interface EntityHandle {
    readonly slot: number
    readonly generation: number
}

export interface PublicEntityState {
    readonly handle: EntityHandle
    readonly kind: EntityKind
    readonly position: Vec3
    readonly velocity: Vec3
    readonly bodyYaw: number
    readonly aimPitch: number
    readonly grounded: boolean
    readonly stateFlags: number
    readonly equippedWeapon: Weapon
}

export interface CreatedEntity {
    readonly state: PublicEntityState
}

export interface UpdatedEntity {
    readonly handle: EntityHandle
    readonly changeMask: number
    readonly position: Vec3 | null
    readonly velocity: Vec3 | null
    readonly bodyYaw: number | null
    readonly aimPitch: number | null
    readonly grounded: boolean | null
    readonly stateFlags: number | null
    readonly equippedWeapon: Weapon | null
}

export interface RemovedEntity {
    readonly handle: EntityHandle
    readonly reason: RemoveReason
}

export interface LocalAuthoritativeState {
    readonly handle: EntityHandle
    readonly position: Vec3
    readonly velocity: Vec3
    readonly bodyYaw: number
    readonly aimPitch: number
    readonly grounded: boolean
    readonly stateFlags: number
    readonly health: number
    readonly weaponState: WeaponState
}

export interface EntityRecord {
    readonly entityId: number
    readonly kind: EntityKind
    readonly position: Vec3
    readonly velocity: Vec3
    readonly bodyYaw: number
    readonly aimPitch: number
    readonly grounded: boolean
    readonly stateFlags: number
    readonly equippedWeapon: Weapon
}

export interface Hello {
    readonly protocolVersion: number
    readonly clientBuildId: string
    readonly supportedMapFormat: number
    readonly accessToken: string | null
}

export interface Welcome {
    readonly protocolVersion: number
    readonly serverBuildId: string
    readonly playerId: number
    readonly playerHandle: EntityHandle
    readonly tickRate: number
    readonly snapshotRate: number
    readonly map: MapDescriptor
    readonly configurationHash: string
}

export interface Reject {
    readonly serverBuildId: string
    readonly reason: RejectReason
    readonly detail: string
    readonly expectedProtocolVersion: number
    readonly expectedMapFormat: number
}

export interface InputBatch {
    readonly commands: ReadonlyArray<InputCommand>
}

export interface Snapshot {
    readonly serverTick: number
    readonly lastProcessedInputSequence: number
    readonly match: MatchState
    readonly entities: ReadonlyArray<EntityRecord>
}

export interface Spawn {
    readonly serverTick: number
    readonly entity: PublicEntityState
}

export interface Remove {
    readonly serverTick: number
    readonly handle: EntityHandle
    readonly reason: RemoveReason
}

export interface ShotConfirmed {
    readonly serverTick: number
    readonly shooterId: number
    readonly inputSequence: number
    readonly actionId: number
    readonly shotId: number
    readonly weapon: Weapon
}

export interface Impact {
    readonly serverTick: number
    readonly shotId: number
    readonly position: Vec3
    readonly normal: Vec3
    readonly material: ImpactMaterial
}

export interface Damage {
    readonly serverTick: number
    readonly sourceId: number | null
    readonly targetId: number
    readonly amount: number
    readonly remainingHealth: number
}

export interface Death {
    readonly serverTick: number
    readonly victimId: number
    readonly killerId: number | null
    readonly weapon: Weapon
}

export interface Respawn {
    readonly serverTick: number
    readonly playerId: number
    readonly position: Vec3
    readonly bodyYaw: number
}

export interface ScoreChange {
    readonly serverTick: number
    readonly playerId: number
    readonly score: number
    readonly delta: number
    readonly kills: number
    readonly deaths: number
}

export interface RoundTransition {
    readonly serverTick: number
    readonly transition: RoundTransitionKind
    readonly match: MatchState
}

export interface Chat {
    readonly senderId: number | null
    readonly channel: ChatChannel
    readonly text: string
}

export interface Configuration {
    readonly protocolVersion: number
    readonly serverBuildId: string
    readonly map: MapDescriptor
    readonly configurationHash: string
    readonly configurationJson: string
}

export interface Ping {
    readonly pingId: number
}

export interface Pong {
    readonly pingId: number
    readonly serverTick: number
    readonly serverMonotonicMs: number
}

export interface SnapshotDelta {
    readonly snapshotSequence: number
    readonly baselineSequence: number
    readonly baselineRevision: number
    readonly baselineReset: boolean
    readonly serverTick: number
    readonly lastProcessedInputSequence: number
    readonly matchRevision: number
    readonly match: MatchState | null
    readonly local: LocalAuthoritativeState
    readonly created: ReadonlyArray<CreatedEntity>
    readonly updated: ReadonlyArray<UpdatedEntity>
    readonly removed: ReadonlyArray<RemovedEntity>
}

export interface ActionResult {
    readonly serverTick: number
    readonly actionId: number
    readonly kind: ActionKind
    readonly accepted: boolean
    readonly reason: ActionRejectReason
    readonly weapon: Weapon
    readonly authoritativeMagazineAmmo: number
    readonly authoritativeReserveAmmo: number
}

export type Message =
    | { readonly type: MessageType.Hello; readonly payload: Hello }
    | { readonly type: MessageType.Welcome; readonly payload: Welcome }
    | { readonly type: MessageType.Reject; readonly payload: Reject }
    | { readonly type: MessageType.InputBatch; readonly payload: InputBatch }
    | { readonly type: MessageType.Snapshot; readonly payload: Snapshot }
    | { readonly type: MessageType.Spawn; readonly payload: Spawn }
    | { readonly type: MessageType.Remove; readonly payload: Remove }
    | { readonly type: MessageType.ShotConfirmed; readonly payload: ShotConfirmed }
    | { readonly type: MessageType.Impact; readonly payload: Impact }
    | { readonly type: MessageType.Damage; readonly payload: Damage }
    | { readonly type: MessageType.Death; readonly payload: Death }
    | { readonly type: MessageType.Respawn; readonly payload: Respawn }
    | { readonly type: MessageType.ScoreChange; readonly payload: ScoreChange }
    | { readonly type: MessageType.RoundTransition; readonly payload: RoundTransition }
    | { readonly type: MessageType.Chat; readonly payload: Chat }
    | { readonly type: MessageType.Configuration; readonly payload: Configuration }
    | { readonly type: MessageType.Ping; readonly payload: Ping }
    | { readonly type: MessageType.Pong; readonly payload: Pong }
    | { readonly type: MessageType.SnapshotDelta; readonly payload: SnapshotDelta }
    | { readonly type: MessageType.ActionResult; readonly payload: ActionResult }

export type DecodedEnvelope =
    | { readonly known: true; readonly messageType: MessageType; readonly payloadLength: number; readonly message: Message; readonly nextOffset: number }
    | { readonly known: false; readonly messageType: number; readonly payloadLength: number; readonly nextOffset: number }

export class ProtocolError extends Error {
    constructor(message: string) { super(message); this.name = 'ProtocolError' }
}

function validString(value: string): boolean {
    for (let index = 0; index < value.length; ++index) {
        const code = value.charCodeAt(index)
        if (code >= 0xd800 && code <= 0xdbff) {
            if (++index >= value.length) return false
            const next = value.charCodeAt(index)
            if (next < 0xdc00 || next > 0xdfff) return false
        } else if (code >= 0xdc00 && code <= 0xdfff) return false
    }
    return true
}

class Writer {
    private readonly output: number[] = []
    bytes(): Uint8Array { return Uint8Array.from(this.output) }
    u8(value: number): void { this.integer(value, 0, 0xff); this.output.push(value) }
    u16(value: number): void { this.integer(value, 0, 0xffff); this.u8(value & 0xff); this.u8(value >>> 8) }
    u32(value: number): void { this.integer(value, 0, 0xffffffff); this.u16(value & 0xffff); this.u16(Math.floor(value / 0x10000)) }
    i16(value: number): void { this.integer(value, -0x8000, 0x7fff); this.u16(value & 0xffff) }
    i32(value: number): void { this.integer(value, -0x80000000, 0x7fffffff); this.u32(value >>> 0) }
    f32(value: number): void {
        if (!Number.isFinite(value)) throw new ProtocolError('non-finite float')
        const bytes = new Uint8Array(4); new DataView(bytes.buffer).setFloat32(0, value, true); this.output.push(...bytes)
    }
    bool(value: boolean): void { if (typeof value !== 'boolean') throw new ProtocolError('invalid boolean'); this.u8(value ? 1 : 0) }
    length(value: number, minimum: number, maximum: number): void { this.integer(value, minimum, maximum); this.u16(value) }
    string(value: string, maximum: number): void {
        if (typeof value !== 'string' || !validString(value)) throw new ProtocolError('invalid Unicode string')
        const bytes = new TextEncoder().encode(value)
        if (bytes.length > LIMITS.maxStringBytes) throw new ProtocolError('string exceeds global limit')
        if (bytes.length > maximum || bytes.length > 0xffff) throw new ProtocolError('string exceeds field limit')
        this.u16(bytes.length); this.output.push(...bytes)
    }
    private integer(value: number, minimum: number, maximum: number): void {
        if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new ProtocolError('integer out of range')
    }
}

class Reader {
    private offset = 0
    constructor(private readonly input: Uint8Array) {}
    remaining(): number { return this.input.length - this.offset }
    u8(): number { this.require(1); return this.input[this.offset++]! }
    u16(): number { return this.u8() | (this.u8() << 8) }
    u32(): number { return (this.u16() + this.u16() * 0x10000) >>> 0 }
    i16(): number { const value = this.u16(); return value >= 0x8000 ? value - 0x10000 : value }
    i32(): number { const value = this.u32(); return value >= 0x80000000 ? value - 0x100000000 : value }
    f32(): number { this.require(4); const value = new DataView(this.input.buffer, this.input.byteOffset + this.offset, 4).getFloat32(0, true); this.offset += 4; if (!Number.isFinite(value)) throw new ProtocolError('non-finite float'); return value }
    bool(): boolean { const value = this.u8(); if (value > 1) throw new ProtocolError('invalid boolean'); return value === 1 }
    length(minimum: number, maximum: number): number { const value = this.u16(); if (value < minimum || value > maximum) throw new ProtocolError('bounded length out of range'); return value }
    string(maximum: number): string {
        const length = this.length(0, maximum); this.require(length)
        const bytes = this.input.subarray(this.offset, this.offset + length); this.offset += length
        try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new ProtocolError('invalid UTF-8 string') }
    }
    private require(count: number): void { if (count > this.remaining()) throw new ProtocolError('truncated payload') }
}

function writeRejectReason(writer: Writer, value: RejectReason): void { if (!(value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 6 || value === 7)) throw new ProtocolError('invalid RejectReason'); writer.u8(value) }
function readRejectReason(reader: Reader): RejectReason { const value = reader.u8(); if (!(value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 6 || value === 7)) throw new ProtocolError('invalid RejectReason'); return value as RejectReason }

function writeEntityKind(writer: Writer, value: EntityKind): void { if (!(value === 1 || value === 2 || value === 3)) throw new ProtocolError('invalid EntityKind'); writer.u8(value) }
function readEntityKind(reader: Reader): EntityKind { const value = reader.u8(); if (!(value === 1 || value === 2 || value === 3)) throw new ProtocolError('invalid EntityKind'); return value as EntityKind }

function writeMatchPhase(writer: Writer, value: MatchPhase): void { if (!(value === 1 || value === 2 || value === 3 || value === 4)) throw new ProtocolError('invalid MatchPhase'); writer.u8(value) }
function readMatchPhase(reader: Reader): MatchPhase { const value = reader.u8(); if (!(value === 1 || value === 2 || value === 3 || value === 4)) throw new ProtocolError('invalid MatchPhase'); return value as MatchPhase }

function writeWeapon(writer: Writer, value: Weapon): void { if (!(value === 0 || value === 1 || value === 2)) throw new ProtocolError('invalid Weapon'); writer.u8(value) }
function readWeapon(reader: Reader): Weapon { const value = reader.u8(); if (!(value === 0 || value === 1 || value === 2)) throw new ProtocolError('invalid Weapon'); return value as Weapon }

function writeRemoveReason(writer: Writer, value: RemoveReason): void { if (!(value === 1 || value === 2 || value === 3)) throw new ProtocolError('invalid RemoveReason'); writer.u8(value) }
function readRemoveReason(reader: Reader): RemoveReason { const value = reader.u8(); if (!(value === 1 || value === 2 || value === 3)) throw new ProtocolError('invalid RemoveReason'); return value as RemoveReason }

function writeImpactMaterial(writer: Writer, value: ImpactMaterial): void { if (!(value === 1 || value === 2)) throw new ProtocolError('invalid ImpactMaterial'); writer.u8(value) }
function readImpactMaterial(reader: Reader): ImpactMaterial { const value = reader.u8(); if (!(value === 1 || value === 2)) throw new ProtocolError('invalid ImpactMaterial'); return value as ImpactMaterial }

function writeRoundTransitionKind(writer: Writer, value: RoundTransitionKind): void { if (!(value === 1 || value === 2 || value === 3 || value === 4)) throw new ProtocolError('invalid RoundTransitionKind'); writer.u8(value) }
function readRoundTransitionKind(reader: Reader): RoundTransitionKind { const value = reader.u8(); if (!(value === 1 || value === 2 || value === 3 || value === 4)) throw new ProtocolError('invalid RoundTransitionKind'); return value as RoundTransitionKind }

function writeChatChannel(writer: Writer, value: ChatChannel): void { if (!(value === 1 || value === 2)) throw new ProtocolError('invalid ChatChannel'); writer.u8(value) }
function readChatChannel(reader: Reader): ChatChannel { const value = reader.u8(); if (!(value === 1 || value === 2)) throw new ProtocolError('invalid ChatChannel'); return value as ChatChannel }

function writeActionKind(writer: Writer, value: ActionKind): void { if (!(value === 1 || value === 2)) throw new ProtocolError('invalid ActionKind'); writer.u8(value) }
function readActionKind(reader: Reader): ActionKind { const value = reader.u8(); if (!(value === 1 || value === 2)) throw new ProtocolError('invalid ActionKind'); return value as ActionKind }

function writeActionRejectReason(writer: Writer, value: ActionRejectReason): void { if (!(value === 0 || value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 6 || value === 7 || value === 8 || value === 9 || value === 10)) throw new ProtocolError('invalid ActionRejectReason'); writer.u8(value) }
function readActionRejectReason(reader: Reader): ActionRejectReason { const value = reader.u8(); if (!(value === 0 || value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 6 || value === 7 || value === 8 || value === 9 || value === 10)) throw new ProtocolError('invalid ActionRejectReason'); return value as ActionRejectReason }

function writeVec3(writer: Writer, value: Vec3): void {
    writer.f32(value.x)
    writer.f32(value.y)
    writer.f32(value.z)
}
function readVec3(reader: Reader): Vec3 {
    return {
        x: reader.f32(),
        y: reader.f32(),
        z: reader.f32(),
    }
}

function writeMapDescriptor(writer: Writer, value: MapDescriptor): void {
    writer.string(value.mapId, LIMITS.maxMapIdBytes)
    writer.u16(value.formatVersion)
    writer.string(value.contentHash, LIMITS.maxHashBytes)
}
function readMapDescriptor(reader: Reader): MapDescriptor {
    return {
        mapId: reader.string(LIMITS.maxMapIdBytes),
        formatVersion: reader.u16(),
        contentHash: reader.string(LIMITS.maxHashBytes),
    }
}

function writeMatchState(writer: Writer, value: MatchState): void {
    writeMatchPhase(writer, value.phase)
    writer.u16(value.roundNumber)
    writer.u32(value.phaseEndsAtTick)
}
function readMatchState(reader: Reader): MatchState {
    return {
        phase: readMatchPhase(reader),
        roundNumber: reader.u16(),
        phaseEndsAtTick: reader.u32(),
    }
}

function writeWeaponState(writer: Writer, value: WeaponState): void {
    writeWeapon(writer, value.selected)
    writer.u16(value.magazineAmmo)
    writer.u16(value.reserveAmmo)
    writer.u8(value.stateFlags)
}
function readWeaponState(reader: Reader): WeaponState {
    return {
        selected: readWeapon(reader),
        magazineAmmo: reader.u16(),
        reserveAmmo: reader.u16(),
        stateFlags: reader.u8(),
    }
}

function writeInputCommand(writer: Writer, value: InputCommand): void {
    writer.u32(value.sequence)
    writer.u32(value.clientTick)
    writer.f32(value.moveX)
    writer.f32(value.moveY)
    writer.u16(value.buttonFlags)
    writer.u32(value.fireActionId)
    writer.u32(value.reloadActionId)
    writer.f32(value.yaw)
    writer.f32(value.pitch)
    writeWeapon(writer, value.selectedWeapon)
}
function readInputCommand(reader: Reader): InputCommand {
    return {
        sequence: reader.u32(),
        clientTick: reader.u32(),
        moveX: reader.f32(),
        moveY: reader.f32(),
        buttonFlags: reader.u16(),
        fireActionId: reader.u32(),
        reloadActionId: reader.u32(),
        yaw: reader.f32(),
        pitch: reader.f32(),
        selectedWeapon: readWeapon(reader),
    }
}

function writeEntityHandle(writer: Writer, value: EntityHandle): void {
    writer.u32(value.slot)
    writer.u16(value.generation)
}
function readEntityHandle(reader: Reader): EntityHandle {
    return {
        slot: reader.u32(),
        generation: reader.u16(),
    }
}

function writePublicEntityState(writer: Writer, value: PublicEntityState): void {
    writeEntityHandle(writer, value.handle)
    writeEntityKind(writer, value.kind)
    writeVec3(writer, value.position)
    writeVec3(writer, value.velocity)
    writer.f32(value.bodyYaw)
    writer.f32(value.aimPitch)
    writer.bool(value.grounded)
    writer.u16(value.stateFlags)
    writeWeapon(writer, value.equippedWeapon)
}
function readPublicEntityState(reader: Reader): PublicEntityState {
    return {
        handle: readEntityHandle(reader),
        kind: readEntityKind(reader),
        position: readVec3(reader),
        velocity: readVec3(reader),
        bodyYaw: reader.f32(),
        aimPitch: reader.f32(),
        grounded: reader.bool(),
        stateFlags: reader.u16(),
        equippedWeapon: readWeapon(reader),
    }
}

function writeCreatedEntity(writer: Writer, value: CreatedEntity): void {
    writePublicEntityState(writer, value.state)
}
function readCreatedEntity(reader: Reader): CreatedEntity {
    return {
        state: readPublicEntityState(reader),
    }
}

function writeUpdatedEntity(writer: Writer, value: UpdatedEntity): void {
    writeEntityHandle(writer, value.handle)
    writer.u16(value.changeMask)
    writer.bool(value.position !== null)
    if (value.position !== null) {
        writeVec3(writer, value.position)
    }
    writer.bool(value.velocity !== null)
    if (value.velocity !== null) {
        writeVec3(writer, value.velocity)
    }
    writer.bool(value.bodyYaw !== null)
    if (value.bodyYaw !== null) {
        writer.f32(value.bodyYaw)
    }
    writer.bool(value.aimPitch !== null)
    if (value.aimPitch !== null) {
        writer.f32(value.aimPitch)
    }
    writer.bool(value.grounded !== null)
    if (value.grounded !== null) {
        writer.bool(value.grounded)
    }
    writer.bool(value.stateFlags !== null)
    if (value.stateFlags !== null) {
        writer.u16(value.stateFlags)
    }
    writer.bool(value.equippedWeapon !== null)
    if (value.equippedWeapon !== null) {
        writeWeapon(writer, value.equippedWeapon)
    }
}
function readUpdatedEntity(reader: Reader): UpdatedEntity {
    return {
        handle: readEntityHandle(reader),
        changeMask: reader.u16(),
        position: reader.bool() ? readVec3(reader) : null,
        velocity: reader.bool() ? readVec3(reader) : null,
        bodyYaw: reader.bool() ? reader.f32() : null,
        aimPitch: reader.bool() ? reader.f32() : null,
        grounded: reader.bool() ? reader.bool() : null,
        stateFlags: reader.bool() ? reader.u16() : null,
        equippedWeapon: reader.bool() ? readWeapon(reader) : null,
    }
}

function writeRemovedEntity(writer: Writer, value: RemovedEntity): void {
    writeEntityHandle(writer, value.handle)
    writeRemoveReason(writer, value.reason)
}
function readRemovedEntity(reader: Reader): RemovedEntity {
    return {
        handle: readEntityHandle(reader),
        reason: readRemoveReason(reader),
    }
}

function writeLocalAuthoritativeState(writer: Writer, value: LocalAuthoritativeState): void {
    writeEntityHandle(writer, value.handle)
    writeVec3(writer, value.position)
    writeVec3(writer, value.velocity)
    writer.f32(value.bodyYaw)
    writer.f32(value.aimPitch)
    writer.bool(value.grounded)
    writer.u16(value.stateFlags)
    writer.u16(value.health)
    writeWeaponState(writer, value.weaponState)
}
function readLocalAuthoritativeState(reader: Reader): LocalAuthoritativeState {
    return {
        handle: readEntityHandle(reader),
        position: readVec3(reader),
        velocity: readVec3(reader),
        bodyYaw: reader.f32(),
        aimPitch: reader.f32(),
        grounded: reader.bool(),
        stateFlags: reader.u16(),
        health: reader.u16(),
        weaponState: readWeaponState(reader),
    }
}

function writeEntityRecord(writer: Writer, value: EntityRecord): void {
    writer.u32(value.entityId)
    writeEntityKind(writer, value.kind)
    writeVec3(writer, value.position)
    writeVec3(writer, value.velocity)
    writer.f32(value.bodyYaw)
    writer.f32(value.aimPitch)
    writer.bool(value.grounded)
    writer.u16(value.stateFlags)
    writeWeapon(writer, value.equippedWeapon)
}
function readEntityRecord(reader: Reader): EntityRecord {
    return {
        entityId: reader.u32(),
        kind: readEntityKind(reader),
        position: readVec3(reader),
        velocity: readVec3(reader),
        bodyYaw: reader.f32(),
        aimPitch: reader.f32(),
        grounded: reader.bool(),
        stateFlags: reader.u16(),
        equippedWeapon: readWeapon(reader),
    }
}

function writeHello(writer: Writer, value: Hello): void {
    writer.u16(value.protocolVersion)
    writer.string(value.clientBuildId, LIMITS.maxBuildIdBytes)
    writer.u16(value.supportedMapFormat)
    writer.bool(value.accessToken !== null)
    if (value.accessToken !== null) {
        writer.string(value.accessToken, LIMITS.maxAccessTokenBytes)
    }
}
function readHello(reader: Reader): Hello {
    return {
        protocolVersion: reader.u16(),
        clientBuildId: reader.string(LIMITS.maxBuildIdBytes),
        supportedMapFormat: reader.u16(),
        accessToken: reader.bool() ? reader.string(LIMITS.maxAccessTokenBytes) : null,
    }
}

function writeWelcome(writer: Writer, value: Welcome): void {
    writer.u16(value.protocolVersion)
    writer.string(value.serverBuildId, LIMITS.maxBuildIdBytes)
    writer.u32(value.playerId)
    writeEntityHandle(writer, value.playerHandle)
    writer.u16(value.tickRate)
    writer.u16(value.snapshotRate)
    writeMapDescriptor(writer, value.map)
    writer.string(value.configurationHash, LIMITS.maxHashBytes)
}
function readWelcome(reader: Reader): Welcome {
    return {
        protocolVersion: reader.u16(),
        serverBuildId: reader.string(LIMITS.maxBuildIdBytes),
        playerId: reader.u32(),
        playerHandle: readEntityHandle(reader),
        tickRate: reader.u16(),
        snapshotRate: reader.u16(),
        map: readMapDescriptor(reader),
        configurationHash: reader.string(LIMITS.maxHashBytes),
    }
}

function writeReject(writer: Writer, value: Reject): void {
    writer.string(value.serverBuildId, LIMITS.maxBuildIdBytes)
    writeRejectReason(writer, value.reason)
    writer.string(value.detail, LIMITS.maxRejectDetailBytes)
    writer.u16(value.expectedProtocolVersion)
    writer.u16(value.expectedMapFormat)
}
function readReject(reader: Reader): Reject {
    return {
        serverBuildId: reader.string(LIMITS.maxBuildIdBytes),
        reason: readRejectReason(reader),
        detail: reader.string(LIMITS.maxRejectDetailBytes),
        expectedProtocolVersion: reader.u16(),
        expectedMapFormat: reader.u16(),
    }
}

function writeInputBatch(writer: Writer, value: InputBatch): void {
    writer.length(value.commands.length, 1, LIMITS.maxInputCommands)
    for (const item of value.commands) {
        writeInputCommand(writer, item)
    }
}
function readInputBatch(reader: Reader): InputBatch {
    return {
        commands: Array.from({ length: reader.length(1, LIMITS.maxInputCommands) }, () => readInputCommand(reader)),
    }
}

function writeSnapshot(writer: Writer, value: Snapshot): void {
    writer.u32(value.serverTick)
    writer.u32(value.lastProcessedInputSequence)
    writeMatchState(writer, value.match)
    writer.length(value.entities.length, 0, LIMITS.maxSnapshotEntities)
    for (const item of value.entities) {
        writeEntityRecord(writer, item)
    }
}
function readSnapshot(reader: Reader): Snapshot {
    return {
        serverTick: reader.u32(),
        lastProcessedInputSequence: reader.u32(),
        match: readMatchState(reader),
        entities: Array.from({ length: reader.length(0, LIMITS.maxSnapshotEntities) }, () => readEntityRecord(reader)),
    }
}

function writeSpawn(writer: Writer, value: Spawn): void {
    writer.u32(value.serverTick)
    writePublicEntityState(writer, value.entity)
}
function readSpawn(reader: Reader): Spawn {
    return {
        serverTick: reader.u32(),
        entity: readPublicEntityState(reader),
    }
}

function writeRemove(writer: Writer, value: Remove): void {
    writer.u32(value.serverTick)
    writeEntityHandle(writer, value.handle)
    writeRemoveReason(writer, value.reason)
}
function readRemove(reader: Reader): Remove {
    return {
        serverTick: reader.u32(),
        handle: readEntityHandle(reader),
        reason: readRemoveReason(reader),
    }
}

function writeShotConfirmed(writer: Writer, value: ShotConfirmed): void {
    writer.u32(value.serverTick)
    writer.u32(value.shooterId)
    writer.u32(value.inputSequence)
    writer.u32(value.actionId)
    writer.u32(value.shotId)
    writeWeapon(writer, value.weapon)
}
function readShotConfirmed(reader: Reader): ShotConfirmed {
    return {
        serverTick: reader.u32(),
        shooterId: reader.u32(),
        inputSequence: reader.u32(),
        actionId: reader.u32(),
        shotId: reader.u32(),
        weapon: readWeapon(reader),
    }
}

function writeImpact(writer: Writer, value: Impact): void {
    writer.u32(value.serverTick)
    writer.u32(value.shotId)
    writeVec3(writer, value.position)
    writeVec3(writer, value.normal)
    writeImpactMaterial(writer, value.material)
}
function readImpact(reader: Reader): Impact {
    return {
        serverTick: reader.u32(),
        shotId: reader.u32(),
        position: readVec3(reader),
        normal: readVec3(reader),
        material: readImpactMaterial(reader),
    }
}

function writeDamage(writer: Writer, value: Damage): void {
    writer.u32(value.serverTick)
    writer.bool(value.sourceId !== null)
    if (value.sourceId !== null) {
        writer.u32(value.sourceId)
    }
    writer.u32(value.targetId)
    writer.u16(value.amount)
    writer.u16(value.remainingHealth)
}
function readDamage(reader: Reader): Damage {
    return {
        serverTick: reader.u32(),
        sourceId: reader.bool() ? reader.u32() : null,
        targetId: reader.u32(),
        amount: reader.u16(),
        remainingHealth: reader.u16(),
    }
}

function writeDeath(writer: Writer, value: Death): void {
    writer.u32(value.serverTick)
    writer.u32(value.victimId)
    writer.bool(value.killerId !== null)
    if (value.killerId !== null) {
        writer.u32(value.killerId)
    }
    writeWeapon(writer, value.weapon)
}
function readDeath(reader: Reader): Death {
    return {
        serverTick: reader.u32(),
        victimId: reader.u32(),
        killerId: reader.bool() ? reader.u32() : null,
        weapon: readWeapon(reader),
    }
}

function writeRespawn(writer: Writer, value: Respawn): void {
    writer.u32(value.serverTick)
    writer.u32(value.playerId)
    writeVec3(writer, value.position)
    writer.f32(value.bodyYaw)
}
function readRespawn(reader: Reader): Respawn {
    return {
        serverTick: reader.u32(),
        playerId: reader.u32(),
        position: readVec3(reader),
        bodyYaw: reader.f32(),
    }
}

function writeScoreChange(writer: Writer, value: ScoreChange): void {
    writer.u32(value.serverTick)
    writer.u32(value.playerId)
    writer.i32(value.score)
    writer.i16(value.delta)
    writer.u32(value.kills)
    writer.u32(value.deaths)
}
function readScoreChange(reader: Reader): ScoreChange {
    return {
        serverTick: reader.u32(),
        playerId: reader.u32(),
        score: reader.i32(),
        delta: reader.i16(),
        kills: reader.u32(),
        deaths: reader.u32(),
    }
}

function writeRoundTransition(writer: Writer, value: RoundTransition): void {
    writer.u32(value.serverTick)
    writeRoundTransitionKind(writer, value.transition)
    writeMatchState(writer, value.match)
}
function readRoundTransition(reader: Reader): RoundTransition {
    return {
        serverTick: reader.u32(),
        transition: readRoundTransitionKind(reader),
        match: readMatchState(reader),
    }
}

function writeChat(writer: Writer, value: Chat): void {
    writer.bool(value.senderId !== null)
    if (value.senderId !== null) {
        writer.u32(value.senderId)
    }
    writeChatChannel(writer, value.channel)
    writer.string(value.text, LIMITS.maxChatBytes)
}
function readChat(reader: Reader): Chat {
    return {
        senderId: reader.bool() ? reader.u32() : null,
        channel: readChatChannel(reader),
        text: reader.string(LIMITS.maxChatBytes),
    }
}

function writeConfiguration(writer: Writer, value: Configuration): void {
    writer.u16(value.protocolVersion)
    writer.string(value.serverBuildId, LIMITS.maxBuildIdBytes)
    writeMapDescriptor(writer, value.map)
    writer.string(value.configurationHash, LIMITS.maxHashBytes)
    writer.string(value.configurationJson, LIMITS.maxConfigurationBytes)
}
function readConfiguration(reader: Reader): Configuration {
    return {
        protocolVersion: reader.u16(),
        serverBuildId: reader.string(LIMITS.maxBuildIdBytes),
        map: readMapDescriptor(reader),
        configurationHash: reader.string(LIMITS.maxHashBytes),
        configurationJson: reader.string(LIMITS.maxConfigurationBytes),
    }
}

function writePing(writer: Writer, value: Ping): void {
    writer.u32(value.pingId)
}
function readPing(reader: Reader): Ping {
    return {
        pingId: reader.u32(),
    }
}

function writePong(writer: Writer, value: Pong): void {
    writer.u32(value.pingId)
    writer.u32(value.serverTick)
    writer.u32(value.serverMonotonicMs)
}
function readPong(reader: Reader): Pong {
    return {
        pingId: reader.u32(),
        serverTick: reader.u32(),
        serverMonotonicMs: reader.u32(),
    }
}

function writeSnapshotDelta(writer: Writer, value: SnapshotDelta): void {
    writer.u32(value.snapshotSequence)
    writer.u32(value.baselineSequence)
    writer.u32(value.baselineRevision)
    writer.bool(value.baselineReset)
    writer.u32(value.serverTick)
    writer.u32(value.lastProcessedInputSequence)
    writer.u32(value.matchRevision)
    writer.bool(value.match !== null)
    if (value.match !== null) {
        writeMatchState(writer, value.match)
    }
    writeLocalAuthoritativeState(writer, value.local)
    writer.length(value.created.length, 0, LIMITS.maxSnapshotCreated)
    for (const item of value.created) {
        writeCreatedEntity(writer, item)
    }
    writer.length(value.updated.length, 0, LIMITS.maxSnapshotUpdated)
    for (const item of value.updated) {
        writeUpdatedEntity(writer, item)
    }
    writer.length(value.removed.length, 0, LIMITS.maxSnapshotRemoved)
    for (const item of value.removed) {
        writeRemovedEntity(writer, item)
    }
}
function readSnapshotDelta(reader: Reader): SnapshotDelta {
    return {
        snapshotSequence: reader.u32(),
        baselineSequence: reader.u32(),
        baselineRevision: reader.u32(),
        baselineReset: reader.bool(),
        serverTick: reader.u32(),
        lastProcessedInputSequence: reader.u32(),
        matchRevision: reader.u32(),
        match: reader.bool() ? readMatchState(reader) : null,
        local: readLocalAuthoritativeState(reader),
        created: Array.from({ length: reader.length(0, LIMITS.maxSnapshotCreated) }, () => readCreatedEntity(reader)),
        updated: Array.from({ length: reader.length(0, LIMITS.maxSnapshotUpdated) }, () => readUpdatedEntity(reader)),
        removed: Array.from({ length: reader.length(0, LIMITS.maxSnapshotRemoved) }, () => readRemovedEntity(reader)),
    }
}

function writeActionResult(writer: Writer, value: ActionResult): void {
    writer.u32(value.serverTick)
    writer.u32(value.actionId)
    writeActionKind(writer, value.kind)
    writer.bool(value.accepted)
    writeActionRejectReason(writer, value.reason)
    writeWeapon(writer, value.weapon)
    writer.u16(value.authoritativeMagazineAmmo)
    writer.u16(value.authoritativeReserveAmmo)
}
function readActionResult(reader: Reader): ActionResult {
    return {
        serverTick: reader.u32(),
        actionId: reader.u32(),
        kind: readActionKind(reader),
        accepted: reader.bool(),
        reason: readActionRejectReason(reader),
        weapon: readWeapon(reader),
        authoritativeMagazineAmmo: reader.u16(),
        authoritativeReserveAmmo: reader.u16(),
    }
}

export function encodeMessage(message: Message): Uint8Array {
    const payloadWriter = new Writer()
    switch (message.type) {
        case MessageType.Hello: writeHello(payloadWriter, message.payload); break
        case MessageType.Welcome: writeWelcome(payloadWriter, message.payload); break
        case MessageType.Reject: writeReject(payloadWriter, message.payload); break
        case MessageType.InputBatch: writeInputBatch(payloadWriter, message.payload); break
        case MessageType.Snapshot: writeSnapshot(payloadWriter, message.payload); break
        case MessageType.Spawn: writeSpawn(payloadWriter, message.payload); break
        case MessageType.Remove: writeRemove(payloadWriter, message.payload); break
        case MessageType.ShotConfirmed: writeShotConfirmed(payloadWriter, message.payload); break
        case MessageType.Impact: writeImpact(payloadWriter, message.payload); break
        case MessageType.Damage: writeDamage(payloadWriter, message.payload); break
        case MessageType.Death: writeDeath(payloadWriter, message.payload); break
        case MessageType.Respawn: writeRespawn(payloadWriter, message.payload); break
        case MessageType.ScoreChange: writeScoreChange(payloadWriter, message.payload); break
        case MessageType.RoundTransition: writeRoundTransition(payloadWriter, message.payload); break
        case MessageType.Chat: writeChat(payloadWriter, message.payload); break
        case MessageType.Configuration: writeConfiguration(payloadWriter, message.payload); break
        case MessageType.Ping: writePing(payloadWriter, message.payload); break
        case MessageType.Pong: writePong(payloadWriter, message.payload); break
        case MessageType.SnapshotDelta: writeSnapshotDelta(payloadWriter, message.payload); break
        case MessageType.ActionResult: writeActionResult(payloadWriter, message.payload); break
        default: throw new ProtocolError('unknown message type')
    }
    const payload = payloadWriter.bytes()
    if (payload.length > LIMITS.maxPayloadBytes) throw new ProtocolError('payload exceeds maximum')
    const envelope = new Writer(); envelope.u8(message.type); envelope.u16(payload.length)
    const result = new Uint8Array(3 + payload.length); result.set(envelope.bytes()); result.set(payload, 3); return result
}

export function decodeEnvelope(data: Uint8Array, offset = 0): DecodedEnvelope {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > data.length || data.length - offset < 3) throw new ProtocolError('truncated envelope')
    const messageType = data[offset]!
    const payloadLength = data[offset + 1]! | (data[offset + 2]! << 8)
    if (payloadLength > LIMITS.maxPayloadBytes) throw new ProtocolError('oversized payload')
    const payloadStart = offset + 3; const nextOffset = payloadStart + payloadLength
    if (nextOffset > data.length) throw new ProtocolError('truncated payload')
    const reader = new Reader(data.subarray(payloadStart, nextOffset))
    let message: Message
    switch (messageType) {
        case MessageType.Hello: message = { type: MessageType.Hello, payload: readHello(reader) }; break
        case MessageType.Welcome: message = { type: MessageType.Welcome, payload: readWelcome(reader) }; break
        case MessageType.Reject: message = { type: MessageType.Reject, payload: readReject(reader) }; break
        case MessageType.InputBatch: message = { type: MessageType.InputBatch, payload: readInputBatch(reader) }; break
        case MessageType.Snapshot: message = { type: MessageType.Snapshot, payload: readSnapshot(reader) }; break
        case MessageType.Spawn: message = { type: MessageType.Spawn, payload: readSpawn(reader) }; break
        case MessageType.Remove: message = { type: MessageType.Remove, payload: readRemove(reader) }; break
        case MessageType.ShotConfirmed: message = { type: MessageType.ShotConfirmed, payload: readShotConfirmed(reader) }; break
        case MessageType.Impact: message = { type: MessageType.Impact, payload: readImpact(reader) }; break
        case MessageType.Damage: message = { type: MessageType.Damage, payload: readDamage(reader) }; break
        case MessageType.Death: message = { type: MessageType.Death, payload: readDeath(reader) }; break
        case MessageType.Respawn: message = { type: MessageType.Respawn, payload: readRespawn(reader) }; break
        case MessageType.ScoreChange: message = { type: MessageType.ScoreChange, payload: readScoreChange(reader) }; break
        case MessageType.RoundTransition: message = { type: MessageType.RoundTransition, payload: readRoundTransition(reader) }; break
        case MessageType.Chat: message = { type: MessageType.Chat, payload: readChat(reader) }; break
        case MessageType.Configuration: message = { type: MessageType.Configuration, payload: readConfiguration(reader) }; break
        case MessageType.Ping: message = { type: MessageType.Ping, payload: readPing(reader) }; break
        case MessageType.Pong: message = { type: MessageType.Pong, payload: readPong(reader) }; break
        case MessageType.SnapshotDelta: message = { type: MessageType.SnapshotDelta, payload: readSnapshotDelta(reader) }; break
        case MessageType.ActionResult: message = { type: MessageType.ActionResult, payload: readActionResult(reader) }; break
        default: return { known: false, messageType, payloadLength, nextOffset }
    }
    if (reader.remaining() !== 0) throw new ProtocolError('payload has trailing bytes')
    return { known: true, messageType: message.type, payloadLength, message, nextOffset }
}
