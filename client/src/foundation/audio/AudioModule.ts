import type { ClientModule, ClientModuleContext, FrameUpdate } from '../lifecycle'
import { AUDIO, CAMERA } from '../services'
import { Weapon, type Vec3 } from '../../protocol/generated'

/** Audio ownership boundary; activation remains gated on a future user gesture. */
export class AudioModule implements ClientModule {
    readonly name = 'audio'
    private context?: ClientModuleContext
    private audioContext?: AudioContext
    private muted = false

    initialize(context: ClientModuleContext): void {
        this.context = context
        context.services.provide(AUDIO, this)
        context.canvas.addEventListener('pointerdown', this.unlock, { passive: true })
    }

    private readonly unlock = (): void => {
        if (this.muted) return
        try {
            this.audioContext ??= new AudioContext()
            void this.audioContext.resume().catch(() => { this.muted = true })
        } catch { this.muted = true }
    }

    playWeapon(weapon: Weapon, position?: Vec3): void { this.tone(weapon === Weapon.Shotgun ? 90 : 150, weapon === Weapon.Shotgun ? .11 : .045, .07, position) }
    playImpact(position?: Vec3): void { this.tone(480, .025, .025, position) }
    playUi(kind: 'hit' | 'damage' | 'round'): void { this.tone(kind === 'hit' ? 880 : kind === 'damage' ? 180 : 620, .05, .035) }
    update(_frame: FrameUpdate): void {
        const listener = this.audioContext?.listener, camera = this.context?.services.optional(CAMERA)
        if (!listener || !camera || !('positionX' in listener)) return
        listener.positionX.value = camera.globalPosition.x; listener.positionY.value = camera.globalPosition.y; listener.positionZ.value = camera.globalPosition.z
    }

    private tone(frequency: number, duration: number, volume: number, position?: Vec3): void {
        const audio = this.audioContext
        if (!audio || audio.state !== 'running' || this.muted) return
        try {
            const oscillator = audio.createOscillator(), gain = audio.createGain()
            oscillator.frequency.value = frequency
            gain.gain.setValueAtTime(volume, audio.currentTime)
            gain.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + duration)
            if (position && typeof audio.createPanner === 'function') {
                const panner = audio.createPanner()
                panner.distanceModel = 'inverse'; panner.refDistance = 2; panner.maxDistance = 80
                panner.positionX.value = position.x; panner.positionY.value = position.y; panner.positionZ.value = position.z
                oscillator.connect(gain).connect(panner).connect(audio.destination)
            } else oscillator.connect(gain).connect(audio.destination)
            oscillator.start(); oscillator.stop(audio.currentTime + duration)
        } catch { this.muted = true }
    }

    dispose(): void {
        this.context?.canvas.removeEventListener('pointerdown', this.unlock)
        void this.audioContext?.close().catch(() => {})
        this.audioContext = undefined
        this.context?.services.remove(AUDIO)
        this.context = undefined
    }
}
