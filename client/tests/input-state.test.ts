import { describe, expect, it } from 'vitest'
import { InputState, isGameplayInputAllowed } from '../src/foundation/input/InputState'

describe('offline gameplay input gating', () => {
    const movementButtons = { sprint: false, crouch: false, prone: false, dash: false }
    it('tracks normalized movement and consumes jump once', () => {
        const state = new InputState()
        state.keyDown('KeyW', true)
        state.keyDown('KeyD', true)
        state.keyDown('Space', true)
        expect(state.snapshot(true)).toEqual({ forward: 1, right: 1, jump: true, fire: false, reload: false, selectedWeapon: 1, scoreboard: false, ...movementButtons })
        expect(state.snapshot(true)).toEqual({ forward: 1, right: 1, jump: false, fire: false, reload: false, selectedWeapon: 1, scoreboard: false, ...movementButtons })
    })

    it('clears held input as soon as focus gating blocks gameplay', () => {
        const state = new InputState()
        state.keyDown('KeyW', true)
        expect(state.snapshot(false)).toEqual({ forward: 0, right: 0, jump: false, fire: false, reload: false, selectedWeapon: 1, scoreboard: false, ...movementButtons })
        expect(state.snapshot(true)).toEqual({ forward: 0, right: 0, jump: false, fire: false, reload: false, selectedWeapon: 1, scoreboard: false, ...movementButtons })
    })

    it('requires page focus, pointer lock, no form focus, and no active menu', () => {
        const canvas = {} as HTMLCanvasElement
        const makeDocument = (values: { focus?: boolean; lock?: unknown; editable?: boolean; menu?: boolean }) => ({
            hasFocus: () => values.focus ?? true,
            pointerLockElement: values.lock ?? canvas,
            activeElement: values.editable ? { matches: () => true } : { matches: () => false },
            querySelector: () => values.menu ? {} : null,
        }) as unknown as Document
        expect(isGameplayInputAllowed(makeDocument({}), canvas)).toBe(true)
        expect(isGameplayInputAllowed(makeDocument({ focus: false }), canvas)).toBe(false)
        expect(isGameplayInputAllowed(makeDocument({ lock: {} }), canvas)).toBe(false)
        expect(isGameplayInputAllowed(makeDocument({ editable: true }), canvas)).toBe(false)
        expect(isGameplayInputAllowed(makeDocument({ menu: true }), canvas)).toBe(false)
    })

    it('holds fire and scoreboard while consuming reload and weapon edges', () => {
        const state = new InputState()
        state.pointerButton(true, true)
        state.keyDown('KeyR', true)
        state.keyDown('Digit2', true)
        state.keyDown('Tab', true)
        expect(state.snapshot(true)).toMatchObject({ fire: true, reload: true, selectedWeapon: 2, scoreboard: true })
        expect(state.snapshot(true)).toMatchObject({ fire: true, reload: false, selectedWeapon: 2, scoreboard: true })
        state.keyUp('Tab'); state.pointerButton(false, true)
        expect(state.snapshot(true)).toMatchObject({ fire: false, scoreboard: false })
        state.pointerButton(true, false)
        expect(state.snapshot(true).fire).toBe(false)
    })

    it('holds sprint/crouch and consumes prone/dash edges once', () => {
        const state = new InputState()
        for (const code of ['ShiftLeft', 'ControlLeft', 'KeyZ', 'KeyQ']) state.keyDown(code, true)
        expect(state.snapshot(true)).toMatchObject({ sprint: true, crouch: true, prone: true, dash: true })
        expect(state.snapshot(true)).toMatchObject({ sprint: true, crouch: true, prone: false, dash: false })
    })
})
