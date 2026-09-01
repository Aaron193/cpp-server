import type { ClientModule, ClientModuleContext } from '../lifecycle'
import { INPUT } from '../services'
import { CameraAngles, type CameraAngleOptions, DEFAULT_CAMERA_ANGLES } from '../camera/CameraAngles'
import { InputState, isGameplayInputAllowed, type InputSnapshot } from './InputState'

export class InputModule implements ClientModule {
    readonly name = 'input'
    readonly angles: CameraAngles
    readonly state = new InputState()
    private context?: ClientModuleContext
    private active = false
    private collisionDebugRequested = false
    private readonly chatMessages: string[] = []

    constructor(cameraOptions: CameraAngleOptions = DEFAULT_CAMERA_ANGLES) {
        this.angles = new CameraAngles(cameraOptions)
    }

    initialize(context: ClientModuleContext): void {
        this.context = context
        context.services.provide(INPUT, this)
    }

    start(): void {
        this.active = true
        window.addEventListener('keydown', this.onKeyDown)
        window.addEventListener('keyup', this.onKeyUp)
        window.addEventListener('blur', this.clear)
        document.addEventListener('pointermove', this.onPointerMove, true)
        document.addEventListener('pointerdown', this.onPointerButtonsChanged, true)
        document.addEventListener('pointerup', this.onPointerButtonsChanged, true)
        document.addEventListener('pointerlockchange', this.onPointerLockChange)
        this.context?.canvas.addEventListener('click', this.requestPointerLock)
        this.context?.canvas.addEventListener('contextmenu', this.onContextMenu)
        document.getElementById('chat_input')?.addEventListener('keydown', this.onChatKeyDown)
    }

    stop(): void {
        this.active = false
        window.removeEventListener('keydown', this.onKeyDown)
        window.removeEventListener('keyup', this.onKeyUp)
        window.removeEventListener('blur', this.clear)
        document.removeEventListener('pointermove', this.onPointerMove, true)
        document.removeEventListener('pointerdown', this.onPointerButtonsChanged, true)
        document.removeEventListener('pointerup', this.onPointerButtonsChanged, true)
        document.removeEventListener('pointerlockchange', this.onPointerLockChange)
        this.context?.canvas.removeEventListener('click', this.requestPointerLock)
        this.context?.canvas.removeEventListener('contextmenu', this.onContextMenu)
        document.getElementById('chat_input')?.removeEventListener('keydown', this.onChatKeyDown)
        this.state.clear()
    }

    dispose(): void {
        this.context?.services.remove(INPUT)
        this.context = undefined
    }

    get isActive(): boolean {
        return this.active
    }

    get hasPointerLock(): boolean {
        return this.context !== undefined && document.pointerLockElement === this.context.canvas
    }

    snapshot(): InputSnapshot {
        return this.state.snapshot(this.isAllowed())
    }

    consumeChatMessages(): readonly string[] { return this.chatMessages.splice(0) }
    get showScoreboard(): boolean { return this.state.scoreboardVisible }
    get firing(): boolean { return this.isAllowed() && this.state.firingHeld }
    get aiming(): boolean { return this.isAllowed() && this.state.aiming }
    get selectedWeapon(): 1 | 2 { return this.state.selectedWeapon }

    consumeCollisionDebugToggle(): boolean {
        const value = this.collisionDebugRequested
        this.collisionDebugRequested = false
        return value
    }

    private isAllowed(): boolean {
        return this.active && this.context !== undefined && isGameplayInputAllowed(document, this.context.canvas)
    }

    private readonly requestPointerLock = (): void => {
        if (!this.active || !this.context || document.pointerLockElement === this.context.canvas) return
        if (document.querySelector('.modal-overlay:not(.hidden), [data-gameplay-input-blocking="true"]:not(.hidden)')) return
        void this.context.canvas.requestPointerLock()
    }

    private readonly onPointerMove = (event: PointerEvent): void => {
        // Pointer Events keep delivering relative motion while multiple mouse
        // buttons are held. A button transition is also represented as a
        // pointermove and has button !== -1; only those transition records may
        // update held state. Some pointer-lock implementations report buttons=0
        // on ordinary motion even while RMB is physically held.
        if (event.button !== -1) {
            this.state.pointerButtons(event.buttons, this.isAllowed())
            return
        }
        if (this.isAllowed()) this.angles.applyMouseDelta(event.movementX, event.movementY)
    }
    private readonly onPointerButtonsChanged = (event: PointerEvent): void => {
        this.state.pointerButtons(event.buttons, this.isAllowed())
    }

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        if (event.code === 'F3' && this.isAllowed() && !event.repeat) {
            event.preventDefault()
            this.collisionDebugRequested = true
            return
        }
        if (event.code === 'Enter' && this.hasPointerLock && !event.repeat) {
            const chat = document.getElementById('chat_input') as HTMLInputElement | null
            if (chat) {
                event.preventDefault()
                this.state.clear()
                chat.classList.remove('hidden')
                chat.focus()
                void document.exitPointerLock()
            }
            return
        }
        if (this.state.keyDown(event.code, this.isAllowed(), event.repeat)) event.preventDefault()
    }

    private readonly onKeyUp = (event: KeyboardEvent): void => {
        if (this.state.keyUp(event.code) && this.hasPointerLock) event.preventDefault()
    }

    private readonly onPointerLockChange = (): void => {
        if (!this.hasPointerLock) this.state.clear()
    }

    private readonly onContextMenu = (event: Event): void => { if (this.hasPointerLock) event.preventDefault() }

    private readonly onChatKeyDown = (event: Event): void => {
        const keyboardEvent = event as KeyboardEvent
        if (keyboardEvent.code !== 'Enter' && keyboardEvent.code !== 'Escape') return
        const chat = keyboardEvent.currentTarget as HTMLInputElement
        keyboardEvent.preventDefault()
        const message = chat.value
        chat.value = ''
        chat.classList.add('hidden')
        chat.blur()
        if (keyboardEvent.code === 'Enter') {
            if (message.trim()) this.chatMessages.push(message)
            this.requestPointerLock()
        }
    }

    private readonly clear = (): void => this.state.clear()
}
