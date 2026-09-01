import { Stance, Weapon, type WeaponState } from '../../protocol/generated'

export interface AimProfile {
    readonly aimInSeconds: number
    readonly aimOutSeconds: number
    readonly adsFovRadians: number
    readonly adsMoveMultiplier: number
    readonly hipSpreadRadians: number
    readonly adsSpreadRadians: number
    readonly hipMoveSpreadRadians: number
    readonly adsMoveSpreadRadians: number
    readonly airborneSpreadRadians: number
    readonly crouchMultiplier: number
    readonly proneMultiplier: number
    readonly bloomPerShotRadians: number
    readonly bloomMaxRadians: number
    readonly bloomDelaySeconds: number
    readonly bloomRecoveryRadiansPerSecond: number
    readonly recoilResetSeconds: number
    readonly recoilRecoveryDelaySeconds: number
    readonly recoilRecoveryRate: number
    readonly adsRecoilMultiplier: number
    readonly recoilPitchDegrees: readonly number[]
    readonly recoilYawDegrees: readonly number[]
    readonly recoilVariationPitchDegrees: number
    readonly recoilVariationYawDegrees: number
    readonly reticleArmLengthPx: number
    readonly reticleMinGapPx: number
}

export interface AimProfiles { readonly rifle: AimProfile; readonly shotgun: AimProfile; readonly serverSeed: number }
export interface MutableAimState {
    weapon: Weapon
    aimProgress: number
    bloomRadians: number
    spreadRadians: number
    recoilPitch: number
    recoilYaw: number
    secondsSinceShot: number
    recoilSequence: number
    patternIndex: number
}

const rifle: AimProfile = Object.freeze({
    aimInSeconds: .165, aimOutSeconds: .13, adsFovRadians: Math.PI / 3, adsMoveMultiplier: .78,
    hipSpreadRadians: .012, adsSpreadRadians: .0025, hipMoveSpreadRadians: .014, adsMoveSpreadRadians: .005,
    airborneSpreadRadians: .035, crouchMultiplier: .8, proneMultiplier: .65,
    bloomPerShotRadians: .0022, bloomMaxRadians: .018, bloomDelaySeconds: .08, bloomRecoveryRadiansPerSecond: .035,
    recoilResetSeconds: .35, recoilRecoveryDelaySeconds: .08, recoilRecoveryRate: 9, adsRecoilMultiplier: .82,
    recoilPitchDegrees: Object.freeze([.68, .75, .82, .9, .98, 1.06, 1.12, 1.15]),
    recoilYawDegrees: Object.freeze([-.1, .08, -.14, .16, -.18, .2, -.14, .1]),
    recoilVariationPitchDegrees: .02, recoilVariationYawDegrees: .035, reticleArmLengthPx: 6, reticleMinGapPx: 4,
})
const shotgun: AimProfile = Object.freeze({
    aimInSeconds: .22, aimOutSeconds: .17, adsFovRadians: 68 * Math.PI / 180, adsMoveMultiplier: .86,
    hipSpreadRadians: .055, adsSpreadRadians: .045, hipMoveSpreadRadians: .012, adsMoveSpreadRadians: .007,
    airborneSpreadRadians: .025, crouchMultiplier: .85, proneMultiplier: .75,
    bloomPerShotRadians: .008, bloomMaxRadians: .016, bloomDelaySeconds: .18, bloomRecoveryRadiansPerSecond: .04,
    recoilResetSeconds: .35, recoilRecoveryDelaySeconds: .12, recoilRecoveryRate: 7, adsRecoilMultiplier: .88,
    recoilPitchDegrees: Object.freeze([3.2]), recoilYawDegrees: Object.freeze([0]),
    recoilVariationPitchDegrees: 0, recoilVariationYawDegrees: .3, reticleArmLengthPx: 8, reticleMinGapPx: 8,
})
export const DEFAULT_AIM_PROFILES: AimProfiles = Object.freeze({ rifle, shotgun, serverSeed: 12648430 })

export const createAimState = (weapon = Weapon.Rifle): MutableAimState => ({
    weapon, aimProgress: 0, bloomRadians: 0, spreadRadians: profileFor(DEFAULT_AIM_PROFILES, weapon).hipSpreadRadians,
    recoilPitch: 0, recoilYaw: 0, secondsSinceShot: 1000, recoilSequence: 0, patternIndex: 0,
})
export const profileFor = (profiles: AimProfiles, weapon: Weapon): AimProfile => weapon === Weapon.Shotgun ? profiles.shotgun : profiles.rifle
export const mix = (a: number, b: number, amount: number): number => a + (b - a) * Math.max(0, Math.min(1, amount))

export function computeSpread(state: MutableAimState, profile: AimProfile, horizontalSpeedRatio: number, grounded: boolean, stance: Stance): number {
    const base = mix(profile.hipSpreadRadians, profile.adsSpreadRadians, state.aimProgress)
    const moving = mix(profile.hipMoveSpreadRadians, profile.adsMoveSpreadRadians, state.aimProgress) * Math.min(1.5, Math.max(0, horizontalSpeedRatio)) ** 2
    let spread = base + moving + (grounded ? 0 : profile.airborneSpreadRadians)
    if (stance === Stance.Crouched) spread *= profile.crouchMultiplier
    else if (stance === Stance.Prone) spread *= profile.proneMultiplier
    return Math.max(0, spread + state.bloomRadians)
}

export function stepAimState(state: MutableAimState, profile: AimProfile, intent: boolean, eligible: boolean, speedRatio: number, grounded: boolean, stance: Stance, deltaSeconds: number): void {
    const dt = Math.max(0, Math.min(.1, deltaSeconds)), target = intent && eligible ? 1 : 0
    const duration = target > state.aimProgress ? profile.aimInSeconds : profile.aimOutSeconds
    const amount = duration > 0 ? dt / duration : 1
    state.aimProgress = target > state.aimProgress ? Math.min(target, state.aimProgress + amount) : Math.max(target, state.aimProgress - amount)
    state.secondsSinceShot = Math.min(1000, state.secondsSinceShot + dt)
    if (state.secondsSinceShot >= profile.bloomDelaySeconds) state.bloomRadians = Math.max(0, state.bloomRadians - profile.bloomRecoveryRadiansPerSecond * dt)
    if (state.secondsSinceShot >= profile.recoilRecoveryDelaySeconds) {
        const recovery = Math.exp(-profile.recoilRecoveryRate * dt)
        state.recoilPitch *= recovery; state.recoilYaw *= recovery
    }
    if (state.secondsSinceShot >= profile.recoilResetSeconds) state.patternIndex = 0
    state.spreadRadians = computeSpread(state, profile, speedRatio, grounded, stance)
}

const hash = (initial: number): number => { let value = initial >>> 0; value = (value ^ (value >>> 16)) >>> 0; value = Math.imul(value, 0x7feb352d) >>> 0; value = (value ^ (value >>> 15)) >>> 0; value = Math.imul(value, 0x846ca68b) >>> 0; return (value ^ (value >>> 16)) >>> 0 }
const signedUnit = (seed: number, player: number, sequence: number, salt: number): number => {
    const bits = hash((seed ^ hash((player + 0x9e3779b9) >>> 0) ^ hash((sequence + salt) >>> 0)) >>> 0)
    return (bits & 0x00ffffff) / 8388607.5 - 1
}

export function acceptedShot(state: MutableAimState, profile: AimProfile, seed: number, player: number): void {
    if (state.secondsSinceShot >= profile.recoilResetSeconds) state.patternIndex = 0
    const pitchIndex = Math.min(state.patternIndex, profile.recoilPitchDegrees.length - 1)
    const yawIndex = state.patternIndex % profile.recoilYawDegrees.length
    const sequence = (state.recoilSequence + 1) >>> 0
    const multiplier = mix(1, profile.adsRecoilMultiplier, state.aimProgress)
    const pitch = profile.recoilPitchDegrees[pitchIndex]! + signedUnit(seed, player, sequence, 0x68bc21eb) * profile.recoilVariationPitchDegrees
    const yaw = profile.recoilYawDegrees[yawIndex]! + signedUnit(seed, player, sequence, 0x02e5be93) * profile.recoilVariationYawDegrees
    state.recoilPitch += pitch * Math.PI / 180 * multiplier
    state.recoilYaw += yaw * Math.PI / 180 * multiplier
    state.bloomRadians = Math.min(profile.bloomMaxRadians, state.bloomRadians + profile.bloomPerShotRadians)
    state.secondsSinceShot = 0; state.recoilSequence = sequence; state.patternIndex++
}

export function applyAuthoritativeState(state: MutableAimState, value: WeaponState): void {
    state.weapon = value.selected
    state.aimProgress = Math.max(0, Math.min(1, value.aimProgress))
    state.spreadRadians = Math.max(0, value.spreadRadians)
    state.recoilPitch = value.recoilPitch; state.recoilYaw = value.recoilYaw
    state.recoilSequence = value.recoilSequence >>> 0
}
