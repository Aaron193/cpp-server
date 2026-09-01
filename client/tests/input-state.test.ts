import { describe, expect, it, vi } from 'vitest'
import { ServiceRegistry } from '../src/foundation/lifecycle'
import { InputModule } from '../src/foundation/input/InputModule'
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
        state.pointerButton(0, true, true)
        state.keyDown('KeyR', true)
        state.keyDown('Digit2', true)
        state.keyDown('Tab', true)
        expect(state.snapshot(true)).toMatchObject({ fire: true, reload: true, selectedWeapon: 2, scoreboard: true })
        expect(state.snapshot(true)).toMatchObject({ fire: true, reload: false, selectedWeapon: 2, scoreboard: true })
        state.keyUp('Tab'); state.pointerButton(0, false, true)
        expect(state.snapshot(true)).toMatchObject({ fire: false, scoreboard: false })
        state.pointerButton(0, true, false)
        expect(state.snapshot(true).fire).toBe(false)
    })

    it('tracks held RMB independently and clears it when gameplay is gated', () => {
        const state = new InputState()
        state.pointerButton(2, true, true)
        expect(state.aiming).toBe(true)
        expect(state.snapshot(true).fire).toBe(false)
        state.pointerButton(2, false, true)
        expect(state.aiming).toBe(false)
        state.pointerButton(2, true, true); state.snapshot(false)
        expect(state.aiming).toBe(false)
    })

    it('derives both mouse buttons from the Pointer Events buttons bitmask', () => {
        const state = new InputState()
        state.pointerButtons(2, true)
        expect(state.aiming).toBe(true); expect(state.firingHeld).toBe(false)
        state.pointerButtons(3, true)
        expect(state.aiming).toBe(true); expect(state.firingHeld).toBe(true)
        state.pointerButtons(2, true)
        expect(state.aiming).toBe(true); expect(state.firingHeld).toBe(false)
        state.pointerButtons(0, true)
        expect(state.aiming).toBe(false)
    })

    it('holds sprint/crouch and consumes prone/dash edges once', () => {
        const state = new InputState()
        for (const code of ['ShiftLeft', 'ControlLeft', 'KeyZ', 'KeyQ']) state.keyDown(code, true)
        expect(state.snapshot(true)).toMatchObject({ sprint: true, crouch: true, prone: true, dash: true })
        expect(state.snapshot(true)).toMatchObject({ sprint: true, crouch: true, prone: false, dash: false })
    })

    it('tracks RMB + LMB chords without treating button transitions as camera movement', () => {
        const windowTarget = new EventTarget()
        const canvas = new EventTarget() as HTMLCanvasElement
        const documentTarget = new EventTarget() as EventTarget & {
            pointerLockElement: Element | null
            activeElement: Element | null
            hasFocus: () => boolean
            querySelector: () => Element | null
            getElementById: () => HTMLElement | null
        }
        documentTarget.pointerLockElement = canvas
        documentTarget.activeElement = { matches: () => false } as unknown as Element
        documentTarget.hasFocus = () => true
        documentTarget.querySelector = () => null
        documentTarget.getElementById = () => null
        vi.stubGlobal('window', windowTarget)
        vi.stubGlobal('document', documentTarget)

        const pointerEvent = (type: string, values: { button?: number; buttons?: number; movementX?: number; movementY?: number }): Event => {
            const event = new Event(type)
            Object.defineProperties(event, {
                button: { value: values.button ?? -1 },
                buttons: { value: values.buttons ?? 0 },
                movementX: { value: values.movementX ?? 0 },
                movementY: { value: values.movementY ?? 0 },
            })
            return event
        }

        const input = new InputModule()
        try {
            input.initialize({ canvas, hudRoot: {} as HTMLElement, services: new ServiceRegistry() })
            input.start()
            documentTarget.dispatchEvent(pointerEvent('pointerdown', { button: 2, buttons: 2, movementX: 900, movementY: -700 }))
            documentTarget.dispatchEvent(pointerEvent('pointermove', { button: 0, buttons: 3, movementX: -800, movementY: 600 }))
            expect(input.aiming).toBe(true)
            expect(input.snapshot().fire).toBe(true)
            expect(input.angles.yaw).toBe(0)
            expect(input.angles.pitch).toBe(0)

            // A Pointer Events button transition must never become camera input.
            documentTarget.dispatchEvent(pointerEvent('pointermove', { button: 0, buttons: 3, movementX: -600, movementY: 400 }))
            expect(input.angles.yaw).toBe(0)
            expect(input.angles.pitch).toBe(0)

            // Genuine pointer motion continues while RMB and LMB are both held.
            documentTarget.dispatchEvent(pointerEvent('pointermove', { button: -1, buttons: 3, movementX: 100, movementY: -50 }))
            expect(input.angles.yaw).toBeCloseTo(.2)
            expect(input.angles.pitch).toBeCloseTo(.1)

            // Some browsers report buttons=0 for ordinary pointer-lock motion.
            // Motion must not clear either held button in that case.
            documentTarget.dispatchEvent(pointerEvent('pointermove', { button: -1, buttons: 0, movementX: 10, movementY: 5 }))
            expect(input.aiming).toBe(true)
            expect(input.snapshot().fire).toBe(true)
            expect(input.angles.yaw).toBeCloseTo(.22)
            expect(input.angles.pitch).toBeCloseTo(.09)

            const menu = new Event('contextmenu', { cancelable: true })
            canvas.dispatchEvent(menu)
            expect(menu.defaultPrevented).toBe(true)

            documentTarget.dispatchEvent(pointerEvent('pointermove', { button: 0, buttons: 2, movementX: 700, movementY: 500 }))
            expect(input.snapshot().fire).toBe(false)
            expect(input.aiming).toBe(true)
            expect(input.angles.yaw).toBeCloseTo(.22)
            expect(input.angles.pitch).toBeCloseTo(.09)
            documentTarget.dispatchEvent(pointerEvent('pointerup', { button: 2, buttons: 0 }))
            expect(input.aiming).toBe(false)
        } finally {
            input.stop()
            input.dispose()
            vi.unstubAllGlobals()
        }
    })
})
