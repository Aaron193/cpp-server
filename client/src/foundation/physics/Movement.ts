import { MovementMode, Stance, Weapon, type MovementState, type Vec3 } from '../../protocol/generated'

export interface MovementTuning {
    readonly capsuleRadius: number
    readonly capsuleHalfHeight: number
    readonly eyeHeight: number
    readonly groundSpeed: number
    readonly sprintSpeed: number
    readonly crouchSpeed: number
    readonly proneSpeed: number
    readonly groundAcceleration: number
    readonly airAcceleration: number
    readonly airControl: number
    readonly jumpSpeed: number
    readonly gravity: number
    readonly terminalVelocity: number
    readonly maxSlopeRadians: number
    readonly stepUpHeight: number
    readonly stickToFloorDistance: number
    readonly crouchCapsuleRadius: number
    readonly crouchCapsuleHalfHeight: number
    readonly crouchEyeHeight: number
    readonly proneCapsuleRadius: number
    readonly proneCapsuleHalfHeight: number
    readonly proneEyeHeight: number
    readonly slideDuration: number
    readonly slideStartSpeed: number
    readonly slideEndSpeed: number
    readonly slideSteerRadiansPerSecond: number
    readonly slideCooldown: number
    readonly slideJumpCommitment: number
    readonly dashSpeed: number
    readonly dashDuration: number
    readonly dashCooldown: number
    readonly mantleMinHeight: number
    readonly mantleMaxHeight: number
    readonly mantleReach: number
    readonly mantleDuration: number
    readonly sprintToFireDelay: number
    readonly slideSpreadMultiplier: number
    readonly sprintEnabled: boolean
    readonly crouchEnabled: boolean
    readonly proneEnabled: boolean
    readonly slideEnabled: boolean
    readonly dashEnabled: boolean
    readonly mantleEnabled: boolean
}

export const DEFAULT_MOVEMENT_TUNING: MovementTuning = Object.freeze({
    capsuleRadius: 0.42,
    capsuleHalfHeight: 0.48,
    eyeHeight: 1.62,
    groundSpeed: 5.5,
    sprintSpeed: 7.5,
    crouchSpeed: 3.1,
    proneSpeed: 1.35,
    groundAcceleration: 42,
    airAcceleration: 12,
    airControl: 0.45,
    jumpSpeed: 6.4,
    gravity: 20,
    terminalVelocity: 35,
    maxSlopeRadians: Math.PI / 4,
    stepUpHeight: 0.42,
    stickToFloorDistance: 0.5,
    crouchCapsuleRadius: .36,
    crouchCapsuleHalfHeight: .24,
    crouchEyeHeight: 1.02,
    proneCapsuleRadius: .3,
    proneCapsuleHalfHeight: .06,
    proneEyeHeight: .48,
    slideDuration: .65,
    slideStartSpeed: 8,
    slideEndSpeed: 3.1,
    slideSteerRadiansPerSecond: Math.PI / 6,
    slideCooldown: 1,
    slideJumpCommitment: .12,
    dashSpeed: 13,
    dashDuration: .18,
    dashCooldown: 2.5,
    mantleMinHeight: .45,
    mantleMaxHeight: 1.25,
    mantleReach: .7,
    mantleDuration: .38,
    sprintToFireDelay: .12,
    slideSpreadMultiplier: 1.6,
    sprintEnabled: true,
    crouchEnabled: true,
    proneEnabled: true,
    slideEnabled: true,
    dashEnabled: true,
    mantleEnabled: true,
})

export interface MovementVelocity { readonly x: number; readonly y: number; readonly z: number }
export interface MovementCommand {
    readonly forward: number
    readonly right: number
    readonly jump: boolean
    readonly yaw: number
    readonly sprint?: boolean
    readonly crouch?: boolean
    readonly prone?: boolean
    readonly dash?: boolean
    readonly ads?: boolean
    readonly selectedWeapon?: Weapon
    readonly aimProgress?: number
    readonly adsMoveMultiplier?: number
    /** A bounded Jolt probe may attach a valid target to an airborne jump edge. */
    readonly mantleTarget?: Vec3
}

export const createMovementState = (): MovementState => ({
    stance: Stance.Standing,
    mode: MovementMode.Normal,
    modeTimeRemaining: 0,
    dashCooldownRemaining: 0,
    slideCooldownRemaining: 0,
    weaponLockRemaining: 0,
    stanceExpansionPending: false,
    dashDirection: { x: 0, y: 0, z: -1 },
    mantleStart: { x: 0, y: 0, z: 0 },
    mantleTarget: { x: 0, y: 0, z: 0 },
})

export interface MovementStepContext {
    readonly grounded: boolean
    readonly position: Vec3
    readonly horizontalSpeed: number
    readonly canAdoptStance?: (stance: Stance) => boolean
}

export interface MovementStepResult {
    readonly state: MovementState
    readonly desiredHorizontal: Vec3
    readonly jump: boolean
    readonly authoredPosition?: Vec3
}
type MutableMovementState = { -readonly [Key in keyof MovementState]: MovementState[Key] }

const decrease = (value: number, dt: number): number => Math.max(0, value - dt)
const normalizedPlanarInput = (command: MovementCommand): { forward: number; right: number; x: number; z: number } => {
    const length = Math.hypot(command.forward, command.right)
    const scale = length > 1 ? 1 / length : 1
    const forward = command.forward * scale, right = command.right * scale
    const sin = Math.sin(command.yaw), cos = Math.cos(command.yaw)
    return { forward, right, x: sin * forward + cos * right, z: -cos * forward + sin * right }
}

/** Pure authoritative/predicted movement state transition shared by Jolt and tests. */
export function stepMovementState(
    previous: MovementState,
    command: MovementCommand,
    context: MovementStepContext,
    dt: number,
    tuning: MovementTuning = DEFAULT_MOVEMENT_TUNING
): MovementStepResult {
    const state: MutableMovementState = {
        ...previous,
        modeTimeRemaining: decrease(previous.modeTimeRemaining, dt),
        dashCooldownRemaining: decrease(previous.dashCooldownRemaining, dt),
        slideCooldownRemaining: decrease(previous.slideCooldownRemaining, dt),
        weaponLockRemaining: decrease(previous.weaponLockRemaining, dt),
        dashDirection: { ...previous.dashDirection }, mantleStart: { ...previous.mantleStart }, mantleTarget: { ...previous.mantleTarget },
    }
    const input = normalizedPlanarInput(command)
    const canAdopt = context.canAdoptStance ?? (() => true)
    let jump = false

    // Authored modes own movement until their timer expires.
    if (state.mode === MovementMode.Mantling) {
        if (state.modeTimeRemaining > 0) {
            const progress = 1 - state.modeTimeRemaining / tuning.mantleDuration
            const smooth = progress * progress * (3 - 2 * progress)
            const lift = Math.sin(progress * Math.PI) * .12
            return { state, desiredHorizontal: { x: 0, y: 0, z: 0 }, jump: false, authoredPosition: {
                x: state.mantleStart.x + (state.mantleTarget.x - state.mantleStart.x) * smooth,
                y: state.mantleStart.y + (state.mantleTarget.y - state.mantleStart.y) * smooth + lift,
                z: state.mantleStart.z + (state.mantleTarget.z - state.mantleStart.z) * smooth,
            } }
        }
        state.mode = MovementMode.Normal
        state.stance = Stance.Standing
    }
    if (state.mode === MovementMode.Dashing) {
        if (state.modeTimeRemaining > 0) return { state, desiredHorizontal: { x: state.dashDirection.x * tuning.dashSpeed, y: 0, z: state.dashDirection.z * tuning.dashSpeed }, jump: false }
        state.mode = MovementMode.Normal
    }
    if (state.mode === MovementMode.Sliding) {
        const committed = tuning.slideDuration - state.modeTimeRemaining < tuning.slideJumpCommitment
        if (command.jump && !committed) { state.mode = MovementMode.Normal; jump = context.grounded }
        else if (state.modeTimeRemaining > 0 && context.grounded) {
            const progress = 1 - state.modeTimeRemaining / tuning.slideDuration
            const speed = tuning.slideStartSpeed + (tuning.slideEndSpeed - tuning.slideStartSpeed) * progress
            const currentYaw = Math.atan2(state.dashDirection.x, -state.dashDirection.z)
            const inputYaw = Math.atan2(input.x, -input.z)
            const delta = Math.atan2(Math.sin(inputYaw - currentYaw), Math.cos(inputYaw - currentYaw))
            const steer = Math.max(-tuning.slideSteerRadiansPerSecond * dt, Math.min(tuning.slideSteerRadiansPerSecond * dt, delta))
            const yaw = input.forward === 0 && input.right === 0 ? currentYaw : currentYaw + steer
            state.dashDirection = { x: Math.sin(yaw), y: 0, z: -Math.cos(yaw) }
            return { state, desiredHorizontal: { x: state.dashDirection.x * speed, y: 0, z: state.dashDirection.z * speed }, jump: false }
        } else state.mode = MovementMode.Normal
    }

    // Priority after higher authored modes: mantle, dash, slide, stance, jump, sprint.
    if (tuning.mantleEnabled && !context.grounded && command.jump && command.mantleTarget && canAdopt(Stance.Standing)) {
        state.mode = MovementMode.Mantling; state.modeTimeRemaining = tuning.mantleDuration; state.weaponLockRemaining = tuning.mantleDuration
        state.stance = Stance.Standing; state.mantleStart = { ...context.position }; state.mantleTarget = { ...command.mantleTarget }
        return { state, desiredHorizontal: { x: 0, y: 0, z: 0 }, jump: false, authoredPosition: context.position }
    }
    if (tuning.dashEnabled && command.dash && context.grounded && state.dashCooldownRemaining <= 0 && state.stance !== Stance.Prone) {
        const hasInput = input.forward !== 0 || input.right !== 0
        state.dashDirection = hasInput ? { x: input.x, y: 0, z: input.z } : { x: Math.sin(command.yaw), y: 0, z: -Math.cos(command.yaw) }
        state.mode = MovementMode.Dashing; state.modeTimeRemaining = tuning.dashDuration; state.dashCooldownRemaining = tuning.dashCooldown; state.weaponLockRemaining = tuning.dashDuration
        return { state, desiredHorizontal: { x: state.dashDirection.x * tuning.dashSpeed, y: 0, z: state.dashDirection.z * tuning.dashSpeed }, jump: false }
    }
    if (tuning.slideEnabled && command.crouch && context.grounded && state.slideCooldownRemaining <= 0 && previous.mode === MovementMode.Sprinting && context.horizontalSpeed >= tuning.groundSpeed) {
        const speed = context.horizontalSpeed > .01 ? context.horizontalSpeed : tuning.slideStartSpeed
        state.dashDirection = speed > .01 ? { x: input.x, y: 0, z: input.z } : { x: Math.sin(command.yaw), y: 0, z: -Math.cos(command.yaw) }
        if (Math.hypot(state.dashDirection.x, state.dashDirection.z) < .01) state.dashDirection = { x: Math.sin(command.yaw), y: 0, z: -Math.cos(command.yaw) }
        state.stance = Stance.Crouched; state.mode = MovementMode.Sliding; state.modeTimeRemaining = tuning.slideDuration; state.slideCooldownRemaining = tuning.slideCooldown
        return { state, desiredHorizontal: { x: state.dashDirection.x * tuning.slideStartSpeed, y: 0, z: state.dashDirection.z * tuning.slideStartSpeed }, jump: false }
    }

    if (state.stance !== Stance.Standing && state.stanceExpansionPending && canAdopt(Stance.Standing)) {
        state.stance = Stance.Standing; state.stanceExpansionPending = false
    }
    // Sprint intent has stance priority even when there is not enough forward
    // input to enter the actual sprinting movement mode.
    if (command.sprint && state.stance !== Stance.Standing) {
        if (canAdopt(Stance.Standing)) { state.stance = Stance.Standing; state.stanceExpansionPending = false }
        else state.stanceExpansionPending = true
    } else if (tuning.proneEnabled && command.prone) {
        // Retain the protocol's legacy direct-prone action for old command traces.
        if (state.stance === Stance.Prone) {
            if (canAdopt(Stance.Standing)) { state.stance = Stance.Standing; state.stanceExpansionPending = false }
            else state.stanceExpansionPending = true
        }
        else { state.stance = Stance.Prone; state.stanceExpansionPending = false; state.mode = MovementMode.Normal }
    } else if (command.crouch) {
        if (state.stance === Stance.Standing && tuning.crouchEnabled) {
            state.stance = Stance.Crouched; state.stanceExpansionPending = false
        } else if (state.stance === Stance.Crouched && tuning.proneEnabled) {
            state.stance = Stance.Prone; state.stanceExpansionPending = false
            state.mode = MovementMode.Normal
        } else if (state.stance === Stance.Prone) {
            if (canAdopt(Stance.Standing)) { state.stance = Stance.Standing; state.stanceExpansionPending = false }
            else state.stanceExpansionPending = true
        }
    }
    if (command.jump && context.grounded && state.stance !== Stance.Prone) { jump = true; state.mode = MovementMode.Normal }
    const sprint = tuning.sprintEnabled && !jump && state.stance === Stance.Standing && context.grounded && command.sprint && !command.ads && input.forward > .1
    if (sprint) state.mode = MovementMode.Sprinting
    else if (state.mode === MovementMode.Sprinting) { state.mode = MovementMode.Normal; state.weaponLockRemaining = Math.max(state.weaponLockRemaining, tuning.sprintToFireDelay) }

    let speed = state.stance === Stance.Prone ? tuning.proneSpeed : state.stance === Stance.Crouched ? tuning.crouchSpeed : state.mode === MovementMode.Sprinting ? tuning.sprintSpeed : tuning.groundSpeed
    if (state.mode !== MovementMode.Sprinting && command.selectedWeapon !== Weapon.None)
        speed *= mix(1, command.adsMoveMultiplier ?? 1, command.aimProgress ?? 0)
    return { state, desiredHorizontal: { x: input.x * speed, y: 0, z: input.z * speed }, jump }
}

const mix = (first: number, second: number, amount: number): number => first + (second - first) * Math.max(0, Math.min(1, amount))

export function eyeHeightForStance(stance: Stance, tuning: MovementTuning = DEFAULT_MOVEMENT_TUNING): number {
    return stance === Stance.Prone ? tuning.proneEyeHeight : stance === Stance.Crouched ? tuning.crouchEyeHeight : tuning.eyeHeight
}

function approach(current: number, target: number, maxDelta: number): number {
    return current < target ? Math.min(current + maxDelta, target) : Math.max(current - maxDelta, target)
}

/** Deterministic velocity motor shared by tests and the Jolt CharacterVirtual adapter. */
export function stepMovementVelocity(
    velocity: MovementVelocity,
    command: MovementCommand,
    grounded: boolean,
    dt: number,
    tuning: MovementTuning = DEFAULT_MOVEMENT_TUNING,
    groundVelocityY = 0
): MovementVelocity {
    const inputLength = Math.hypot(command.forward, command.right)
    const scale = inputLength > 1 ? 1 / inputLength : 1
    const forward = command.forward * scale
    const right = command.right * scale
    const sin = Math.sin(command.yaw), cos = Math.cos(command.yaw)
    const targetX = (sin * forward + cos * right) * tuning.groundSpeed
    const targetZ = (-cos * forward + sin * right) * tuning.groundSpeed
    const acceleration = grounded ? tuning.groundAcceleration : tuning.airAcceleration * tuning.airControl
    const horizontalDelta = acceleration * dt
    let y = velocity.y
    const movingTowardGround = velocity.y - groundVelocityY < 0.1
    if (grounded && movingTowardGround) {
        y = groundVelocityY
        if (command.jump) y += tuning.jumpSpeed
    }
    y = Math.max(y - tuning.gravity * dt, -tuning.terminalVelocity)
    return {
        x: approach(velocity.x, targetX, horizontalDelta),
        y,
        z: approach(velocity.z, targetZ, horizontalDelta),
    }
}

export class FixedStepAccumulator {
    private accumulator = 0
    private droppedSeconds = 0
    private lastDropped = 0

    constructor(
        readonly stepSeconds = 1 / 60,
        readonly maxFrameSeconds = 0.25,
        readonly maxStepsPerFrame = 5
    ) {
        if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) throw new RangeError('Fixed step must be positive')
        if (!Number.isFinite(maxFrameSeconds) || maxFrameSeconds <= 0) throw new RangeError('Maximum frame time must be positive')
        if (!Number.isSafeInteger(maxStepsPerFrame) || maxStepsPerFrame < 1) throw new RangeError('Maximum steps per frame must be positive')
    }

    consume(deltaSeconds: number, step: (dt: number) => void): number {
        this.lastDropped = 0
        if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) return 0
        const acceptedSeconds = Math.min(deltaSeconds, this.maxFrameSeconds)
        this.lastDropped = deltaSeconds - acceptedSeconds
        this.accumulator += acceptedSeconds
        let count = 0
        while (this.accumulator >= this.stepSeconds && count < this.maxStepsPerFrame) {
            step(this.stepSeconds)
            this.accumulator -= this.stepSeconds
            count++
        }
        // Keep only the fractional remainder. Whole ticks beyond the per-frame
        // budget are intentionally discarded rather than leaking a stall into
        // several later render frames.
        if (this.accumulator >= this.stepSeconds) {
            const droppedSteps = Math.floor(this.accumulator / this.stepSeconds)
            const droppedCatchUp = droppedSteps * this.stepSeconds
            this.accumulator -= droppedCatchUp
            this.lastDropped += droppedCatchUp
        }
        this.droppedSeconds += this.lastDropped
        return count
    }

    reset(): void { this.accumulator = 0; this.lastDropped = 0 }
    get lastDroppedSeconds(): number { return this.lastDropped }
    get totalDroppedSeconds(): number { return this.droppedSeconds }
}
