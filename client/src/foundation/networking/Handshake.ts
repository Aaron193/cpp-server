import { PROTOCOL_VERSION, type Configuration, type MapDescriptor, type Welcome } from '../../protocol/generated'
import type { ClientMapManifest } from '../assets/MapManifest'
import type { MovementTuning } from '../physics/Movement'

export interface ServerDiscoveryDescriptor {
    readonly websocketUrl: string
    readonly buildId: string
    readonly protocolVersion: number
    readonly mapId: string
    readonly mode: string
    readonly mapFormatVersion?: number
    readonly contentHash?: string
}

export interface HandshakeExpectations {
    readonly clientBuildId: string
    readonly discovery: ServerDiscoveryDescriptor
    readonly manifest: ClientMapManifest
}

function sameMap(actual: MapDescriptor, expected: MapDescriptor): boolean {
    return actual.mapId === expected.mapId && actual.formatVersion === expected.formatVersion && actual.contentHash === expected.contentHash
}

export function validateWelcome(welcome: Welcome, expected: HandshakeExpectations): void {
    const discovery = expected.discovery
    const manifest = expected.manifest
    if (discovery.protocolVersion !== PROTOCOL_VERSION || welcome.protocolVersion !== PROTOCOL_VERSION) throw new Error(`Protocol mismatch (client ${PROTOCOL_VERSION}, server ${welcome.protocolVersion})`)
    if (welcome.serverBuildId !== expected.clientBuildId || discovery.buildId !== welcome.serverBuildId) throw new Error(`Build mismatch (client ${expected.clientBuildId}, server ${welcome.serverBuildId})`)
    if (welcome.map.mapId !== manifest.mapId || welcome.map.mapId !== discovery.mapId) throw new Error(`Map mismatch (loaded ${manifest.mapId}, server ${welcome.map.mapId})`)
    if (welcome.map.formatVersion !== manifest.formatVersion || (discovery.mapFormatVersion !== undefined && welcome.map.formatVersion !== discovery.mapFormatVersion)) throw new Error(`Map format mismatch (loaded ${manifest.formatVersion}, server ${welcome.map.formatVersion})`)
    if (welcome.map.contentHash !== manifest.contentHash || (discovery.contentHash !== undefined && welcome.map.contentHash !== discovery.contentHash)) throw new Error('Map content hash mismatch')
    if (!Number.isInteger(welcome.tickRate) || welcome.tickRate <= 0 || !Number.isInteger(welcome.snapshotRate) || welcome.snapshotRate <= 0 || welcome.snapshotRate > welcome.tickRate) throw new Error('Server supplied invalid simulation rates')
    if (!/^sha256:[a-f0-9]{64}$/.test(welcome.configurationHash)) throw new Error('Server supplied an invalid configuration hash')
}

export async function sha256Identifier(exactText: string): Promise<string> {
    const bytes = new TextEncoder().encode(exactText)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return `sha256:${[...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

function positive(record: Record<string, unknown>, name: keyof MovementTuning): number {
    const value = record[name]
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`Configuration movement.${name} must be a positive finite number`)
    return value
}
function enabled(record: Record<string, unknown>, name: keyof MovementTuning): boolean {
    const value = record[name]
    if (typeof value !== 'boolean') throw new Error(`Configuration movement.${name} must be boolean`)
    return value
}

export function parseMovementTuning(configurationJson: string): MovementTuning {
    let parsed: unknown
    try { parsed = JSON.parse(configurationJson) } catch { throw new Error('Configuration JSON is malformed') }
    if (!parsed || typeof parsed !== 'object') throw new Error('Configuration JSON must contain an object')
    const movement = (parsed as Record<string, unknown>).movement
    if (!movement || typeof movement !== 'object') throw new Error('Configuration JSON is missing movement tuning')
    const values = movement as Record<string, unknown>
    const tuning: MovementTuning = {
        capsuleRadius: positive(values, 'capsuleRadius'),
        capsuleHalfHeight: positive(values, 'capsuleHalfHeight'),
        eyeHeight: positive(values, 'eyeHeight'),
        groundSpeed: positive(values, 'groundSpeed'),
        sprintSpeed: positive(values, 'sprintSpeed'),
        crouchSpeed: positive(values, 'crouchSpeed'),
        proneSpeed: positive(values, 'proneSpeed'),
        groundAcceleration: positive(values, 'groundAcceleration'),
        airAcceleration: positive(values, 'airAcceleration'),
        airControl: positive(values, 'airControl'),
        jumpSpeed: positive(values, 'jumpSpeed'),
        gravity: positive(values, 'gravity'),
        terminalVelocity: positive(values, 'terminalVelocity'),
        maxSlopeRadians: positive(values, 'maxSlopeRadians'),
        stepUpHeight: positive(values, 'stepUpHeight'),
        stickToFloorDistance: positive(values, 'stickToFloorDistance'),
        crouchCapsuleRadius: positive(values, 'crouchCapsuleRadius'),
        crouchCapsuleHalfHeight: positive(values, 'crouchCapsuleHalfHeight'),
        crouchEyeHeight: positive(values, 'crouchEyeHeight'),
        proneCapsuleRadius: positive(values, 'proneCapsuleRadius'),
        proneCapsuleHalfHeight: positive(values, 'proneCapsuleHalfHeight'),
        proneEyeHeight: positive(values, 'proneEyeHeight'),
        slideDuration: positive(values, 'slideDuration'),
        slideStartSpeed: positive(values, 'slideStartSpeed'),
        slideEndSpeed: positive(values, 'slideEndSpeed'),
        slideSteerRadiansPerSecond: positive(values, 'slideSteerRadiansPerSecond'),
        slideCooldown: positive(values, 'slideCooldown'),
        slideJumpCommitment: positive(values, 'slideJumpCommitment'),
        dashSpeed: positive(values, 'dashSpeed'),
        dashDuration: positive(values, 'dashDuration'),
        dashCooldown: positive(values, 'dashCooldown'),
        mantleMinHeight: positive(values, 'mantleMinHeight'),
        mantleMaxHeight: positive(values, 'mantleMaxHeight'),
        mantleReach: positive(values, 'mantleReach'),
        mantleDuration: positive(values, 'mantleDuration'),
        sprintToFireDelay: positive(values, 'sprintToFireDelay'),
        slideSpreadMultiplier: positive(values, 'slideSpreadMultiplier'),
        sprintEnabled: enabled(values, 'sprintEnabled'), crouchEnabled: enabled(values, 'crouchEnabled'), proneEnabled: enabled(values, 'proneEnabled'),
        slideEnabled: enabled(values, 'slideEnabled'), dashEnabled: enabled(values, 'dashEnabled'), mantleEnabled: enabled(values, 'mantleEnabled'),
    }
    if (tuning.airControl > 1 || tuning.maxSlopeRadians >= Math.PI / 2 || tuning.mantleMinHeight >= tuning.mantleMaxHeight || tuning.slideJumpCommitment >= tuning.slideDuration || tuning.groundSpeed > tuning.sprintSpeed) throw new Error('Configuration movement tuning is outside supported bounds')
    return tuning
}

export async function validateConfiguration(configuration: Configuration, welcome: Welcome): Promise<MovementTuning> {
    if (configuration.protocolVersion !== welcome.protocolVersion || configuration.serverBuildId !== welcome.serverBuildId || !sameMap(configuration.map, welcome.map) || configuration.configurationHash !== welcome.configurationHash) throw new Error('Configuration metadata does not match Welcome')
    const actualHash = await sha256Identifier(configuration.configurationJson)
    if (actualHash !== configuration.configurationHash) throw new Error('Configuration SHA-256 verification failed')
    return parseMovementTuning(configuration.configurationJson)
}
