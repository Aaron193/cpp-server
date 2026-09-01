import { MovementMode, Weapon, type WeaponState } from '../../protocol/generated'
import type { ClientModule, ClientModuleContext, FrameUpdate } from '../lifecycle'
import { AIMING, INPUT, KILLCAM, NETWORKING, PHYSICS } from '../services'
import { DEFAULT_AIM_PROFILES, acceptedShot, createAimState, mix, profileFor, stepAimState, type AimProfiles, type MutableAimState } from './AimModel'

export type AimEligibilityReason = 'eligible' | 'no-intent' | 'dead' | 'reload' | 'traversal' | 'killcam' | 'no-weapon'
export interface AimingSnapshot {
    readonly intent: boolean; readonly eligible: boolean; readonly eligibilityReason: AimEligibilityReason
    readonly aimProgress: number; readonly effectiveAds: boolean; readonly currentFovRadians: number
    readonly sensitivityScale: number; readonly spreadRadians: number; readonly bloomRadians: number
    readonly recoilPitch: number; readonly recoilYaw: number; readonly recoilSequence: number
    readonly weapon: Weapon; readonly adsMoveMultiplier: number; readonly reticleArmLengthPx: number; readonly reticleMinGapPx: number
}
interface SavedShot { readonly state: MutableAimState }

export class AimingModule implements ClientModule {
    readonly name = 'aiming'
    private context?: ClientModuleContext
    private profiles: AimProfiles = DEFAULT_AIM_PROFILES
    private state = createAimState()
    private playerId = 0
    private hipFovRadians = Math.PI * .48
    private readonly pendingShots = new Map<number, SavedShot>()
    private intent = false
    private eligible = false
    private reason: AimEligibilityReason = 'no-intent'
    private correctionTarget?: MutableAimState
    private correctionRemaining = 0
    private authoritativeSpreadFloor = 0
    private authoritativeSpreadHoldFrames = 0

    initialize(context: ClientModuleContext): void { this.context = context; context.services.provide(AIMING, this) }
    configure(profiles: AimProfiles): void { this.profiles = profiles }
    setPlayerId(playerId: number): void { this.playerId = playerId >>> 0 }
    setHipFov(radians: number): void { if (Number.isFinite(radians)) this.hipFovRadians = radians }

    update(frame: FrameUpdate): void {
        if (!this.context) return
        const input = this.context.services.get(INPUT), physics = this.context.services.get(PHYSICS)
        const combat = this.context.services.get(NETWORKING).combat.localPlayer
        // Weapon selection is locally predicted, so switching lowers the old sight
        // immediately rather than waiting for the next authoritative snapshot.
        const selected = input.selectedWeapon === Weapon.Shotgun ? Weapon.Shotgun : Weapon.Rifle
        if (selected !== this.state.weapon) {
            const sequence = this.state.recoilSequence
            this.state = createAimState(selected); this.state.recoilSequence = sequence; this.pendingShots.clear()
        }
        this.intent = input.aiming
        const replay = this.context.services.optional(KILLCAM)?.state
        const traversal = physics.movementState.mode === MovementMode.Sliding || physics.movementState.mode === MovementMode.Dashing || physics.movementState.mode === MovementMode.Mantling
        this.reason = !this.intent ? 'no-intent' : combat.dead ? 'dead' : combat.reloading ? 'reload' : replay === 'killcam' || replay === 'spectator' ? 'killcam' : traversal ? 'traversal' : 'eligible'
        this.eligible = this.reason === 'eligible'
        const profile = profileFor(this.profiles, selected)
        stepAimState(this.state, profile, this.intent, this.eligible, Math.hypot(physics.velocity.x, physics.velocity.z) / Math.max(.001, physics.tuning.groundSpeed), physics.grounded, physics.movementState.stance, frame.deltaSeconds)
        // Networking reconciliation runs before this module. Preserve an
        // authoritative accuracy reduction through this prediction step so the
        // HUD sees it immediately; its own 80 ms contraction then eases inward.
        if (this.authoritativeSpreadHoldFrames > 0) {
            this.state.spreadRadians = Math.max(this.state.spreadRadians, this.authoritativeSpreadFloor)
            this.authoritativeSpreadHoldFrames--
        }
        if (this.correctionTarget) {
            const dt = Math.max(0, frame.deltaSeconds), amount = this.correctionRemaining > 0 ? Math.min(1, dt / this.correctionRemaining) : 1
            this.state.bloomRadians = mix(this.state.bloomRadians, this.correctionTarget.bloomRadians, amount)
            this.state.recoilPitch = mix(this.state.recoilPitch, this.correctionTarget.recoilPitch, amount)
            this.state.recoilYaw = mix(this.state.recoilYaw, this.correctionTarget.recoilYaw, amount)
            this.correctionRemaining = Math.max(0, this.correctionRemaining - dt)
            if (this.correctionRemaining === 0) {
                this.state.recoilSequence = this.correctionTarget.recoilSequence; this.state.patternIndex = this.correctionTarget.patternIndex
                this.correctionTarget = undefined
            }
        }
        const fov = mix(this.hipFovRadians, profile.adsFovRadians, this.state.aimProgress)
        input.angles.setSensitivityScale(Math.tan(fov / 2) / Math.tan(this.hipFovRadians / 2))
    }

    predictShot(actionId: number): void {
        this.pendingShots.set(actionId >>> 0, { state: { ...this.state } })
        acceptedShot(this.state, profileFor(this.profiles, this.state.weapon), this.profiles.serverSeed, this.playerId)
    }
    resolveShot(actionId: number, accepted: boolean): void {
        const pending = this.pendingShots.get(actionId >>> 0)
        this.pendingShots.delete(actionId >>> 0)
        if (!accepted && pending) this.startCorrection(pending.state)
    }
    reconcile(value: WeaponState): void {
        if (value.aimProgress < this.state.aimProgress) this.state.aimProgress = Math.max(0, value.aimProgress)
        if (value.spreadRadians > this.state.spreadRadians) {
            this.state.spreadRadians = value.spreadRadians
            this.authoritativeSpreadFloor = value.spreadRadians
            this.authoritativeSpreadHoldFrames = 1
        }
        if (value.recoilSequence !== this.state.recoilSequence) this.startCorrection({ ...this.state, weapon: value.selected, spreadRadians: Math.max(0, value.spreadRadians), recoilPitch: value.recoilPitch, recoilYaw: value.recoilYaw, recoilSequence: value.recoilSequence >>> 0, patternIndex: value.recoilSequence >>> 0 })
        for (const [id, pending] of this.pendingShots) if (pending.state.recoilSequence < value.recoilSequence) this.pendingShots.delete(id)
    }
    private startCorrection(target: MutableAimState): void { this.correctionTarget = { ...target }; this.correctionRemaining = .07 }
    get snapshot(): AimingSnapshot {
        const profile = profileFor(this.profiles, this.state.weapon)
        const fov = mix(this.hipFovRadians, profile.adsFovRadians, this.state.aimProgress)
        return { intent: this.intent, eligible: this.eligible, eligibilityReason: this.reason, aimProgress: this.state.aimProgress, effectiveAds: this.eligible && this.state.aimProgress >= .9,
            currentFovRadians: fov, sensitivityScale: Math.tan(fov / 2) / Math.tan(this.hipFovRadians / 2), spreadRadians: this.state.spreadRadians,
            bloomRadians: this.state.bloomRadians, recoilPitch: this.state.recoilPitch, recoilYaw: this.state.recoilYaw, recoilSequence: this.state.recoilSequence,
            weapon: this.state.weapon, adsMoveMultiplier: profile.adsMoveMultiplier, reticleArmLengthPx: profile.reticleArmLengthPx, reticleMinGapPx: profile.reticleMinGapPx }
    }
    dispose(): void { this.context?.services.remove(AIMING); this.context = undefined; this.pendingShots.clear(); this.correctionTarget = undefined; this.authoritativeSpreadHoldFrames = 0 }
}
