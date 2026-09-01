import { PROTOCOL_VERSION, type Configuration, type MapDescriptor, type Welcome } from '../../protocol/generated'
import type { ClientMapManifest } from '../assets/MapManifest'
import type { MovementTuning } from '../physics/Movement'
import { DEFAULT_AIM_PROFILES, type AimProfile, type AimProfiles } from '../aiming/AimModel'

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

const aimNumber = (record: Record<string, unknown>, name: keyof AimProfile, allowZero = false): number => {
    const value = record[name]
    if (typeof value !== 'number' || !Number.isFinite(value) || (allowZero ? value < 0 : value <= 0)) throw new Error(`Configuration weapon aim.${name} is invalid`)
    return value
}
const aimPattern = (record: Record<string, unknown>, name: 'recoilPitchDegrees' | 'recoilYawDegrees'): readonly number[] => {
    const value = record[name]
    if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'number' || !Number.isFinite(item) || Math.abs(item) > 10)) throw new Error(`Configuration weapon aim.${name} is invalid`)
    return Object.freeze([...value] as number[])
}
function parseAimProfile(value: unknown): AimProfile {
    if (!value || typeof value !== 'object') throw new Error('Configuration weapon is missing aim tuning')
    const record = value as Record<string, unknown>
    const profile: AimProfile = {
        aimInSeconds: aimNumber(record, 'aimInSeconds'), aimOutSeconds: aimNumber(record, 'aimOutSeconds'),
        adsFovRadians: aimNumber(record, 'adsFovRadians'), adsMoveMultiplier: aimNumber(record, 'adsMoveMultiplier'),
        hipSpreadRadians: aimNumber(record, 'hipSpreadRadians', true), adsSpreadRadians: aimNumber(record, 'adsSpreadRadians', true),
        hipMoveSpreadRadians: aimNumber(record, 'hipMoveSpreadRadians', true), adsMoveSpreadRadians: aimNumber(record, 'adsMoveSpreadRadians', true),
        airborneSpreadRadians: aimNumber(record, 'airborneSpreadRadians', true), crouchMultiplier: aimNumber(record, 'crouchMultiplier'), proneMultiplier: aimNumber(record, 'proneMultiplier'),
        bloomPerShotRadians: aimNumber(record, 'bloomPerShotRadians', true), bloomMaxRadians: aimNumber(record, 'bloomMaxRadians', true),
        bloomDelaySeconds: aimNumber(record, 'bloomDelaySeconds', true), bloomRecoveryRadiansPerSecond: aimNumber(record, 'bloomRecoveryRadiansPerSecond'),
        recoilResetSeconds: aimNumber(record, 'recoilResetSeconds'), recoilRecoveryDelaySeconds: aimNumber(record, 'recoilRecoveryDelaySeconds', true), recoilRecoveryRate: aimNumber(record, 'recoilRecoveryRate'),
        adsRecoilMultiplier: aimNumber(record, 'adsRecoilMultiplier'), recoilPitchDegrees: aimPattern(record, 'recoilPitchDegrees'), recoilYawDegrees: aimPattern(record, 'recoilYawDegrees'),
        recoilVariationPitchDegrees: aimNumber(record, 'recoilVariationPitchDegrees', true), recoilVariationYawDegrees: aimNumber(record, 'recoilVariationYawDegrees', true),
        reticleArmLengthPx: aimNumber(record, 'reticleArmLengthPx'), reticleMinGapPx: aimNumber(record, 'reticleMinGapPx'),
    }
    if (profile.aimInSeconds > 2 || profile.aimOutSeconds > 2 || profile.adsFovRadians < .4 || profile.adsFovRadians > 1.8 || profile.adsMoveMultiplier > 1 || profile.adsSpreadRadians > profile.hipSpreadRadians || profile.bloomPerShotRadians > profile.bloomMaxRadians || profile.crouchMultiplier > 1 || profile.proneMultiplier > 1 || profile.adsRecoilMultiplier > 1) throw new Error('Configuration weapon aim tuning is outside supported bounds')
    return Object.freeze(profile)
}

export function parseAimProfiles(configurationJson: string): AimProfiles {
    let parsed: unknown
    try { parsed = JSON.parse(configurationJson) } catch { throw new Error('Configuration JSON is malformed') }
    const root = parsed as Record<string, unknown>
    const weapons = root?.weapons as Record<string, unknown> | undefined
    // Test/offline movement-only configurations retain production defaults.
    if (!weapons) return DEFAULT_AIM_PROFILES
    const rifle = (weapons.rifle as Record<string, unknown> | undefined)?.aim
    const shotgun = (weapons.shotgun as Record<string, unknown> | undefined)?.aim
    const combat = root.combat as Record<string, unknown> | undefined
    const seed = combat?.serverSeed
    if (!Number.isSafeInteger(seed) || (seed as number) < 0 || (seed as number) > 0xffffffff) throw new Error('Configuration combat.serverSeed is invalid')
    return Object.freeze({ rifle: parseAimProfile(rifle), shotgun: parseAimProfile(shotgun), serverSeed: seed as number })
}

export type ValidatedGameConfiguration = MovementTuning & { readonly aiming: AimProfiles }

export async function validateConfiguration(configuration: Configuration, welcome: Welcome): Promise<ValidatedGameConfiguration> {
    if (configuration.protocolVersion !== welcome.protocolVersion || configuration.serverBuildId !== welcome.serverBuildId || !sameMap(configuration.map, welcome.map) || configuration.configurationHash !== welcome.configurationHash) throw new Error('Configuration metadata does not match Welcome')
    const actualHash = await sha256Identifier(configuration.configurationJson)
    if (actualHash !== configuration.configurationHash) throw new Error('Configuration SHA-256 verification failed')
    return Object.freeze({ ...parseMovementTuning(configuration.configurationJson), aiming: parseAimProfiles(configuration.configurationJson) })
}
