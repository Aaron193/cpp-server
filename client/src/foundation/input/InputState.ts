export interface InputSnapshot {
    readonly forward: number
    readonly right: number
    readonly jump: boolean
    readonly fire: boolean
    readonly reload: boolean
    readonly selectedWeapon: 1 | 2
    readonly scoreboard: boolean
    readonly sprint: boolean
    readonly crouch: boolean
    readonly prone: boolean
    readonly dash: boolean
}

const GAMEPLAY_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space', 'KeyR', 'Digit1', 'Digit2', 'Tab', 'ShiftLeft', 'ShiftRight', 'KeyC', 'KeyQ'])

export function isEditableElement(element: Element | null): boolean {
    if (!element || typeof (element as Element).matches !== 'function') return false
    const htmlElement = element as HTMLElement
    return Boolean(htmlElement.isContentEditable) || element.matches('input, textarea, select, button, [role="textbox"], [data-gameplay-input-blocking="true"]')
}

export function isGameplayInputAllowed(documentRef: Document, canvas: HTMLCanvasElement): boolean {
    if (!documentRef.hasFocus() || documentRef.pointerLockElement !== canvas) return false
    if (isEditableElement(documentRef.activeElement)) return false
    const modal = documentRef.querySelector('.modal-overlay:not(.hidden), [data-gameplay-input-blocking="true"]:not(.hidden)')
    return modal === null
}

export class InputState {
    private readonly pressed = new Set<string>()
    private jumpQueued = false
    private reloadQueued = false
    private firing = false
    private aimingHeld = false
    private crouchQueued = false
    private dashQueued = false
    private weapon: 1 | 2 = 1

    keyDown(code: string, allowed: boolean, repeat = false): boolean {
        if (!GAMEPLAY_CODES.has(code)) return false
        if (!allowed) {
            this.clear()
            return false
        }
        this.pressed.add(code)
        if (code === 'Space' && !repeat) this.jumpQueued = true
        if (code === 'KeyR' && !repeat) this.reloadQueued = true
        if (code === 'KeyC' && !repeat) this.crouchQueued = true
        if (code === 'KeyQ' && !repeat) this.dashQueued = true
        if (code === 'Digit1' && !repeat) this.weapon = 1
        if (code === 'Digit2' && !repeat) this.weapon = 2
        return true
    }

    keyUp(code: string): boolean {
        if (!GAMEPLAY_CODES.has(code)) return false
        this.pressed.delete(code)
        return true
    }

    snapshot(allowed: boolean): InputSnapshot {
        if (!allowed) {
            this.clear()
            return { forward: 0, right: 0, jump: false, fire: false, reload: false, selectedWeapon: this.weapon, scoreboard: false, sprint: false, crouch: false, prone: false, dash: false }
        }
        const forward = Number(this.pressed.has('KeyW') || this.pressed.has('ArrowUp')) - Number(this.pressed.has('KeyS') || this.pressed.has('ArrowDown'))
        const right = Number(this.pressed.has('KeyD') || this.pressed.has('ArrowRight')) - Number(this.pressed.has('KeyA') || this.pressed.has('ArrowLeft'))
        const jump = this.jumpQueued
        const reload = this.reloadQueued
        const crouch = this.crouchQueued
        const dash = this.dashQueued
        this.jumpQueued = false
        this.reloadQueued = false
        this.crouchQueued = false
        this.dashQueued = false
        return { forward, right, jump, fire: this.firing, reload, selectedWeapon: this.weapon, scoreboard: this.pressed.has('Tab'), sprint: this.pressed.has('ShiftLeft') || this.pressed.has('ShiftRight'), crouch, prone: false, dash }
    }

    pointerButton(button: number, down: boolean, allowed: boolean): void {
        if (button === 0) this.firing = allowed && down
        if (button === 2) this.aimingHeld = allowed && down
    }
    pointerButtons(buttons: number, allowed: boolean): void {
        this.firing = allowed && Boolean(buttons & 1)
        this.aimingHeld = allowed && Boolean(buttons & 2)
    }
    get scoreboardVisible(): boolean { return this.pressed.has('Tab') }
    get firingHeld(): boolean { return this.firing }
    get aiming(): boolean { return this.aimingHeld }
    get selectedWeapon(): 1 | 2 { return this.weapon }

    clear(): void {
        this.pressed.clear()
        this.jumpQueued = false
        this.reloadQueued = false
        this.crouchQueued = false
        this.dashQueued = false
        this.firing = false
        this.aimingHeld = false
    }
}
