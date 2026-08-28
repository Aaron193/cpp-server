export interface MovementTuning {
    readonly capsuleRadius: number
    readonly capsuleHalfHeight: number
    readonly eyeHeight: number
    readonly groundSpeed: number
    readonly groundAcceleration: number
    readonly airAcceleration: number
    readonly airControl: number
    readonly jumpSpeed: number
    readonly gravity: number
    readonly terminalVelocity: number
    readonly maxSlopeRadians: number
    readonly stepUpHeight: number
    readonly stickToFloorDistance: number
}

export const DEFAULT_MOVEMENT_TUNING: MovementTuning = Object.freeze({
    capsuleRadius: 0.42,
    capsuleHalfHeight: 0.48,
    eyeHeight: 1.62,
    groundSpeed: 7.5,
    groundAcceleration: 42,
    airAcceleration: 12,
    airControl: 0.45,
    jumpSpeed: 6.4,
    gravity: 20,
    terminalVelocity: 35,
    maxSlopeRadians: Math.PI / 4,
    stepUpHeight: 0.42,
    stickToFloorDistance: 0.5,
})

export interface MovementVelocity { readonly x: number; readonly y: number; readonly z: number }
export interface MovementCommand { readonly forward: number; readonly right: number; readonly jump: boolean; readonly yaw: number }

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
