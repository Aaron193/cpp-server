import { describe, expect, it, vi } from 'vitest'
import { MovementMode, Stance, Weapon } from '../src/protocol/generated'
import { DEFAULT_MOVEMENT_TUNING, FixedStepAccumulator, createMovementState, stepMovementState, stepMovementVelocity } from '../src/foundation/physics/Movement'

describe('fixed-step local movement motor', () => {
    it('accelerates to configured ground speed in right-handed -Z forward', () => {
        let velocity = { x: 0, y: 0, z: 0 }
        for (let tick = 0; tick < 60; tick++) velocity = stepMovementVelocity(velocity, { forward: 1, right: 0, jump: false, yaw: 0 }, true, 1 / 60)
        expect(velocity.x).toBeCloseTo(0)
        expect(velocity.z).toBeCloseTo(-DEFAULT_MOVEMENT_TUNING.groundSpeed)
    })

    it('jumps only while grounded and clamps falling speed', () => {
        const jumped = stepMovementVelocity({ x: 0, y: 0, z: 0 }, { forward: 0, right: 0, jump: true, yaw: 0 }, true, 1 / 60)
        expect(jumped.y).toBeCloseTo(DEFAULT_MOVEMENT_TUNING.jumpSpeed - DEFAULT_MOVEMENT_TUNING.gravity / 60)
        let falling = jumped
        for (let tick = 0; tick < 600; tick++) falling = stepMovementVelocity(falling, { forward: 0, right: 0, jump: false, yaw: 0 }, false, 1 / 60)
        expect(falling.y).toBe(-DEFAULT_MOVEMENT_TUNING.terminalVelocity)
    })

    it('matches the authoritative grounded and moving-platform vertical rules', () => {
        const dt = 1 / 60
        const grounded = stepMovementVelocity(
            { x: 0, y: -0.05, z: 0 },
            { forward: 0, right: 0, jump: false, yaw: 0 },
            true, dt, DEFAULT_MOVEMENT_TUNING, 1.5
        )
        expect(grounded.y).toBeCloseTo(1.5 - DEFAULT_MOVEMENT_TUNING.gravity * dt)

        const separating = stepMovementVelocity(
            { x: 0, y: 2, z: 0 },
            { forward: 0, right: 0, jump: true, yaw: 0 },
            true, dt, DEFAULT_MOVEMENT_TUNING, 0
        )
        expect(separating.y).toBeCloseTo(2 - DEFAULT_MOVEMENT_TUNING.gravity * dt)
    })

    it('runs deterministic 60 Hz steps with bounded catch-up', () => {
        const accumulator = new FixedStepAccumulator()
        const step = vi.fn()
        expect(accumulator.consume(1 / 30, step)).toBe(2)
        expect(accumulator.consume(10, step)).toBe(5)
        expect(step).toHaveBeenCalledTimes(7)
        expect(accumulator.lastDroppedSeconds).toBeCloseTo(10 - 5 / 60)
        expect(accumulator.totalDroppedSeconds).toBeCloseTo(10 - 5 / 60)
    })

    it('honors sprint, slide, dash, stance, and mantle priority with authoritative timers', () => {
        const dt = 1 / 60, position = { x: 0, y: 0, z: 0 }
        let state = createMovementState()
        state = stepMovementState(state, { forward: 1, right: 0, jump: false, yaw: 0, sprint: true }, { grounded: true, position, horizontalSpeed: 5.5 }, dt).state
        expect(state.mode).toBe(MovementMode.Sprinting)
        let result = stepMovementState(state, { forward: 1, right: 0, jump: false, yaw: 0, sprint: true, crouch: true }, { grounded: true, position, horizontalSpeed: 7.5 }, dt)
        expect(result.state).toMatchObject({ stance: Stance.Crouched, mode: MovementMode.Sliding, slideCooldownRemaining: 1 })
        state = { ...createMovementState(), dashCooldownRemaining: 0 }
        result = stepMovementState(state, { forward: 0, right: 1, jump: false, yaw: 0, dash: true }, { grounded: true, position, horizontalSpeed: 0 }, dt)
        expect(result.state.mode).toBe(MovementMode.Dashing)
        expect(result.desiredHorizontal.x).toBeCloseTo(DEFAULT_MOVEMENT_TUNING.dashSpeed)
        const rejected = stepMovementState({ ...createMovementState(), dashCooldownRemaining: 1 }, { forward: 0, right: 1, jump: false, yaw: 0, dash: true }, { grounded: true, position, horizontalSpeed: 0 }, dt)
        expect(rejected.state.mode).toBe(MovementMode.Normal)
        result = stepMovementState(createMovementState(), { forward: 0, right: 0, jump: true, yaw: 0, dash: true, mantleTarget: { x: 0, y: 1, z: -.5 } }, { grounded: false, position, horizontalSpeed: 0 }, dt)
        expect(result.state.mode).toBe(MovementMode.Mantling)
    })

    it('gives ADS precedence over sprint and applies the predicted weapon speed scale', () => {
        const result = stepMovementState(createMovementState(), {
            forward: 1, right: 0, jump: false, yaw: 0, sprint: true, ads: true,
            selectedWeapon: Weapon.Rifle, aimProgress: .5, adsMoveMultiplier: .78,
        }, { grounded: true, position: { x: 0, y: 0, z: 0 }, horizontalSpeed: 5.5 }, 1 / 60)
        expect(result.state.mode).toBe(MovementMode.Normal)
        expect(Math.hypot(result.desiredHorizontal.x, result.desiredHorizontal.z)).toBeCloseTo(5.5 * .89)
    })

    it('cycles stance on C presses and stands on sprint intent', () => {
        const context = { grounded: true, position: { x: 0, y: 0, z: 0 }, horizontalSpeed: 0 }
        const idle = { forward: 0, right: 0, jump: false, yaw: 0 }
        let state = stepMovementState(createMovementState(), { ...idle, crouch: true }, context, 1 / 60).state
        expect(state.stance).toBe(Stance.Crouched)
        state = stepMovementState(state, idle, context, 1 / 60).state
        expect(state.stance).toBe(Stance.Crouched)
        state = stepMovementState(state, { ...idle, crouch: true }, context, 1 / 60).state
        expect(state.stance).toBe(Stance.Prone)
        state = stepMovementState(state, idle, context, 1 / 60).state
        state = stepMovementState(state, { ...idle, crouch: true }, context, 1 / 60).state
        expect(state.stance).toBe(Stance.Standing)
        state = stepMovementState(state, { ...idle, crouch: true }, context, 1 / 60).state
        state = stepMovementState(state, { ...idle, crouch: true }, context, 1 / 60).state
        expect(state.stance).toBe(Stance.Prone)
        state = stepMovementState(state, { ...idle, sprint: true }, context, 1 / 60).state
        expect(state.stance).toBe(Stance.Standing)
    })

    it('retries a sprint-requested expansion until standing clearance exists', () => {
        let clear = false
        const context = { grounded: true, position: { x: 0, y: 0, z: 0 }, horizontalSpeed: 0, canAdoptStance: () => clear }
        let state = { ...createMovementState(), stance: Stance.Prone }
        state = stepMovementState(state, { forward: 0, right: 0, jump: false, yaw: 0, sprint: true }, context, 1 / 60).state
        expect(state.stance).toBe(Stance.Prone)
        expect(state.stanceExpansionPending).toBe(true)
        clear = true
        state = stepMovementState(state, { forward: 0, right: 0, jump: false, yaw: 0 }, context, 1 / 60).state
        expect(state.stance).toBe(Stance.Standing)
    })

    it('ends slide crouched, respects jump commitment, and rejects airborne abilities', () => {
        const position = { x: 0, y: 0, z: 0 }, dt = 1 / 60
        const sliding = {
            ...createMovementState(), stance: Stance.Crouched, mode: MovementMode.Sliding,
            modeTimeRemaining: DEFAULT_MOVEMENT_TUNING.slideDuration,
            dashDirection: { x: 0, y: 0, z: -1 },
        }
        const committed = stepMovementState(sliding, { forward: 1, right: 0, jump: true, yaw: 0, crouch: true }, { grounded: true, position, horizontalSpeed: 8 }, dt)
        expect(committed.state.mode).toBe(MovementMode.Sliding)
        expect(committed.jump).toBe(false)

        const cancellable = { ...sliding, modeTimeRemaining: DEFAULT_MOVEMENT_TUNING.slideDuration - DEFAULT_MOVEMENT_TUNING.slideJumpCommitment - dt }
        const jumped = stepMovementState(cancellable, { forward: 1, right: 0, jump: true, yaw: 0, crouch: true }, { grounded: true, position, horizontalSpeed: 6 }, dt)
        expect(jumped.state.mode).toBe(MovementMode.Normal)
        expect(jumped.jump).toBe(true)

        const expired = stepMovementState({ ...sliding, modeTimeRemaining: dt / 2 }, { forward: 0, right: 0, jump: false, yaw: 0 }, { grounded: true, position, horizontalSpeed: 3.1 }, dt)
        expect(expired.state).toMatchObject({ mode: MovementMode.Normal, stance: Stance.Crouched })
        const airborne = stepMovementState(createMovementState(), { forward: 1, right: 0, jump: false, yaw: 0, sprint: true, dash: true }, { grounded: false, position, horizontalSpeed: 5.5 }, dt)
        expect(airborne.state.mode).toBe(MovementMode.Normal)
    })
})
