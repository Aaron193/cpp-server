import { Vector3 } from '@babylonjs/core/Maths/math.vector.js'
import { loadSettings } from '../../settings/GameSettings'
import { noiseBuffer } from './ProceduralAudio'
import { PHYSICS } from '../services'
import type {
    ClientModule,
    ClientModuleContext,
    FrameUpdate,
} from '../lifecycle'
import { ARENA, AUDIO, CAMERA } from '../services'
import { Weapon, type Vec3 } from '../../protocol/generated'

export type AudioBus = 'weapons' | 'impacts' | 'ui' | 'ambience'
export type AudioCue =
    | 'rifle-fire'
    | 'shotgun-fire'
    | 'impact'
    | 'ui-hit'
    | 'ui-damage'
    | 'ui-round'
    | 'ui-reload'
    | 'ui-reject'
    | 'footstep-concrete'
    | 'footstep-gravel'
    | 'footstep-metal'
export interface AudioAssetDefinition {
    readonly url: string
    readonly bus: AudioBus
    readonly volume: number
    readonly priority: number
    readonly maxVoices: number
    readonly spatial: boolean
}
export const AUDIO_ASSETS: Readonly<Record<AudioCue, AudioAssetDefinition>> =
    Object.freeze({
        'footstep-concrete': {
            url: '',
            bus: 'impacts',
            volume: 0.34,
            priority: 1,
            maxVoices: 2,
            spatial: false,
        },
        'footstep-gravel': {
            url: '',
            bus: 'impacts',
            volume: 0.38,
            priority: 1,
            maxVoices: 2,
            spatial: false,
        },
        'footstep-metal': {
            url: '',
            bus: 'impacts',
            volume: 0.28,
            priority: 1,
            maxVoices: 2,
            spatial: false,
        },
        'rifle-fire': {
            url: '/audio/rifle-fire.wav',
            bus: 'weapons',
            volume: 0.55,
            priority: 3,
            maxVoices: 8,
            spatial: true,
        },
        'shotgun-fire': {
            url: '/audio/shotgun-fire.wav',
            bus: 'weapons',
            volume: 0.62,
            priority: 4,
            maxVoices: 5,
            spatial: true,
        },
        impact: {
            url: '/audio/impact.wav',
            bus: 'impacts',
            volume: 0.3,
            priority: 1,
            maxVoices: 8,
            spatial: true,
        },
        'ui-hit': {
            url: '/audio/ui-hit.wav',
            bus: 'ui',
            volume: 0.4,
            priority: 5,
            maxVoices: 2,
            spatial: false,
        },
        'ui-damage': {
            url: '/audio/ui-damage.wav',
            bus: 'ui',
            volume: 0.48,
            priority: 5,
            maxVoices: 2,
            spatial: false,
        },
        'ui-round': {
            url: '/audio/ui-round.wav',
            bus: 'ui',
            volume: 0.42,
            priority: 6,
            maxVoices: 1,
            spatial: false,
        },
        'ui-reload': {
            url: '/audio/ui-reload.wav',
            bus: 'ui',
            volume: 0.28,
            priority: 2,
            maxVoices: 2,
            spatial: false,
        },
        'ui-reject': {
            url: '/audio/ui-reject.wav',
            bus: 'ui',
            volume: 0.32,
            priority: 4,
            maxVoices: 2,
            spatial: false,
        },
    })

interface ActiveVoice {
    readonly cue: AudioCue
    readonly source: AudioBufferSourceNode
    readonly startedAt: number
    readonly priority: number
    readonly nodes: readonly AudioNode[]
}
export interface AudioTelemetry {
    readonly activeVoices: number
    readonly capacity: number
    readonly stolenVoices: number
    readonly failedAssets: number
    readonly unlocked: boolean
    readonly muted: boolean
}

export function selectVoiceToSteal(
    voices: readonly Pick<ActiveVoice, 'priority' | 'startedAt'>[],
    incomingPriority: number
): number {
    let selected = -1
    for (let index = 0; index < voices.length; index++)
        if (
            voices[index]!.priority <= incomingPriority &&
            (selected < 0 ||
                voices[index]!.priority < voices[selected]!.priority ||
                (voices[index]!.priority === voices[selected]!.priority &&
                    voices[index]!.startedAt < voices[selected]!.startedAt))
        )
            selected = index
    return selected
}

/** Asset-backed WebAudio registry with fixed concurrency and deterministic voice stealing. */
export class AudioModule implements ClientModule {
    private readonly localForward = new Vector3(0, 0, -1)
    private readonly listenerForward = new Vector3()
    readonly name = 'audio'
    readonly voiceCapacity = 24
    private context?: ClientModuleContext
    private audioContext?: AudioContext
    private master?: GainNode
    private readonly buses = new Map<AudioBus, GainNode>()
    private readonly buffers = new Map<AudioCue, AudioBuffer>()
    private readonly voices: ActiveVoice[] = []
    private loading?: Promise<void>
    private muted = false
    private failedAssets = 0
    private stolenVoices = 0
    private settings = loadSettings()
    private stepDistance = 0
    private previousGrounded = true
    private ambience?: AudioBufferSourceNode
    private reverb?: ConvolverNode
    private reverbGain?: GainNode
    private readonly refreshSettings = () => {
        this.settings = loadSettings()
        this.applyVolumes()
    }
    private applyVolumes(): void {
        if (this.master)
            this.master.gain.value = this.muted ? 0 : this.settings.master
        for (const [name, bus] of this.buses)
            bus.gain.value =
                name === 'ui'
                    ? this.settings.ui
                    : name === 'ambience'
                      ? this.settings.ambience
                      : this.settings.effects
    }
    private indoor(position: Vec3): boolean {
        return (
            this.context?.services
                .get(ARENA)
                .mapGameplay?.zones.some(
                    (z) =>
                        z.type === 'reverb' &&
                        position.x >= z.min[0] &&
                        position.x <= z.max[0] &&
                        position.y >= z.min[1] &&
                        position.y <= z.max[1] &&
                        position.z >= z.min[2] &&
                        position.z <= z.max[2]
                ) ?? false
        )
    }
    initialize(context: ClientModuleContext): void {
        this.context = context
        context.services.provide(AUDIO, this)
        window.addEventListener('game-settings-changed', this.refreshSettings)
        context.canvas.addEventListener('pointerdown', this.unlock, {
            passive: true,
        })
    }
    private readonly unlock = (): void => {
        if (this.muted) return
        try {
            this.audioContext ??= new AudioContext()
            if (!this.master) {
                this.master = this.audioContext.createGain()
                this.master.connect(this.audioContext.destination)
                for (const name of [
                    'weapons',
                    'impacts',
                    'ui',
                    'ambience',
                ] as const) {
                    const bus = this.audioContext.createGain()
                    bus.gain.value = name === 'ui' ? 0.9 : 1
                    bus.connect(this.master)
                    this.buses.set(name, bus)
                }
                this.applyVolumes()
                this.reverb = this.audioContext.createConvolver()
                this.reverb.buffer = noiseBuffer(this.audioContext, 1.4, 'tail')
                this.reverbGain = this.audioContext.createGain()
                this.reverbGain.gain.value = 0.2
                this.reverb
                    .connect(this.reverbGain)
                    .connect(this.buses.get('weapons')!)
                this.ambience = this.audioContext.createBufferSource()
                this.ambience.buffer = noiseBuffer(
                    this.audioContext,
                    12,
                    'wind'
                )
                this.ambience.loop = true
                this.ambience.connect(this.buses.get('ambience')!)
                this.ambience.start()
            }
            void this.audioContext
                .resume()
                .then(() => {
                    this.loading ??= this.loadAssets()
                })
                .catch(() => {
                    this.muted = true
                })
        } catch {
            this.muted = true
        }
    }
    private async loadAssets(): Promise<void> {
        const audio = this.audioContext
        if (!audio) return
        await Promise.all(
            (
                Object.entries(AUDIO_ASSETS) as [
                    AudioCue,
                    AudioAssetDefinition,
                ][]
            ).map(async ([cue, asset]) => {
                try {
                    if (cue.startsWith('footstep-')) {
                        this.buffers.set(
                            cue,
                            noiseBuffer(
                                audio,
                                0.3,
                                cue.slice(9) as 'concrete' | 'gravel' | 'metal'
                            )
                        )
                        return
                    }
                    const response = await fetch(asset.url)
                    if (!response.ok) throw new Error(String(response.status))
                    this.buffers.set(
                        cue,
                        await audio.decodeAudioData(
                            await response.arrayBuffer()
                        )
                    )
                } catch {
                    this.failedAssets++
                }
            })
        )
    }
    playWeapon(weapon: Weapon, position?: Vec3): void {
        this.play(
            weapon === Weapon.Shotgun ? 'shotgun-fire' : 'rifle-fire',
            position
        )
    }
    playImpact(position?: Vec3): void {
        this.play('impact', position)
    }
    playUi(kind: 'hit' | 'damage' | 'round' | 'reload' | 'reject'): void {
        this.play(`ui-${kind}` as AudioCue)
    }
    play(cue: AudioCue, position?: Vec3): boolean {
        const audio = this.audioContext,
            buffer = this.buffers.get(cue),
            asset = AUDIO_ASSETS[cue],
            bus = this.buses.get(asset.bus)
        if (
            !audio ||
            audio.state !== 'running' ||
            this.muted ||
            !buffer ||
            !bus
        )
            return false
        const sameCue = this.voices.filter((voice) => voice.cue === cue)
        if (sameCue.length >= asset.maxVoices)
            this.stopVoice(
                this.voices.indexOf(
                    sameCue.reduce((oldest, voice) =>
                        voice.startedAt < oldest.startedAt ? voice : oldest
                    )
                )
            )
        if (this.voices.length >= this.voiceCapacity) {
            const index = selectVoiceToSteal(this.voices, asset.priority)
            if (index < 0) return false
            this.stopVoice(index)
            this.stolenVoices++
        }
        try {
            const source = audio.createBufferSource(),
                gain = audio.createGain()
            source.buffer = buffer
            gain.gain.value = asset.volume
            source.connect(gain)
            const nodes: AudioNode[] = [gain]
            const camera = this.context?.services.optional(CAMERA)
            const listenerPosition = camera?.position
            const indoor = this.indoor(
                position ?? listenerPosition ?? { x: 0, y: 0, z: 0 }
            )
            if (asset.bus === 'weapons') {
                const filter = audio.createBiquadFilter()
                filter.type = 'lowpass'
                const distance =
                    position && listenerPosition
                        ? Math.hypot(
                              position.x - listenerPosition.x,
                              position.y - listenerPosition.y,
                              position.z - listenerPosition.z
                          )
                        : 0
                filter.frequency.value = Math.max(1200, 18000 - distance * 65)
                source.disconnect()
                source.connect(filter).connect(gain)
                nodes.push(filter)
                if (indoor && this.reverb) gain.connect(this.reverb)
            }
            if (
                position &&
                asset.spatial &&
                typeof audio.createPanner === 'function'
            ) {
                const panner = audio.createPanner()
                const scale =
                    this.context?.services.optional(ARENA)?.mapManifest?.policy
                        .audioDistanceScale ?? 1
                panner.distanceModel = 'inverse'
                panner.refDistance = 2 * scale
                panner.maxDistance = 300 * scale
                panner.panningModel = 'HRTF'
                nodes.push(panner)
                panner.rolloffFactor = 1.25
                panner.positionX.value = position.x
                panner.positionY.value = position.y
                panner.positionZ.value = position.z
                gain.connect(panner).connect(bus)
            } else gain.connect(bus)
            const voice: ActiveVoice = {
                cue,
                source,
                startedAt: audio.currentTime,
                priority: asset.priority,
                nodes,
            }
            this.voices.push(voice)
            source.onended = () => {
                const index = this.voices.indexOf(voice)
                if (index >= 0) this.voices.splice(index, 1)
                source.disconnect()
                for (const node of nodes) node.disconnect()
            }
            source.start()
            return true
        } catch {
            this.failedAssets++
            return false
        }
    }
    private stopVoice(index: number): void {
        if (index < 0 || index >= this.voices.length) return
        const [voice] = this.voices.splice(index, 1)
        try {
            voice?.source.stop()
        } catch {}
    }
    setMuted(value: boolean): void {
        this.muted = value
        if (this.master)
            this.master.gain.value = value ? 0 : this.settings.master
    }
    update(frame: FrameUpdate): void {
        const listener = this.audioContext?.listener,
            camera = this.context?.services.optional(CAMERA)
        if (!listener || !camera || !('positionX' in listener)) return
        listener.positionX.value = camera.globalPosition.x
        listener.positionY.value = camera.globalPosition.y
        listener.positionZ.value = camera.globalPosition.z
        const forward = this.listenerForward
        camera.getDirectionToRef(this.localForward, forward)
        listener.forwardX.value = forward.x
        listener.forwardY.value = forward.y
        listener.forwardZ.value = forward.z
        listener.upX.value = 0
        listener.upY.value = 1
        listener.upZ.value = 0
        const physics = this.context?.services.get(PHYSICS)
        if (!physics) return
        const speed = Math.hypot(physics.velocity.x, physics.velocity.z)
        if (physics.grounded) {
            this.stepDistance += speed * frame.deltaSeconds
            if (
                this.stepDistance > (speed > 5 ? 2.3 : 1.85) ||
                !this.previousGrounded
            ) {
                this.stepDistance = 0
                const surface = this.indoor(physics.position)
                    ? 'concrete'
                    : 'gravel'
                this.play(`footstep-${surface}`)
            }
        }
        this.previousGrounded = physics.grounded
    }
    get telemetry(): AudioTelemetry {
        return {
            activeVoices: this.voices.length,
            capacity: this.voiceCapacity,
            stolenVoices: this.stolenVoices,
            failedAssets: this.failedAssets,
            unlocked: this.audioContext?.state === 'running',
            muted: this.muted,
        }
    }
    dispose(): void {
        window.removeEventListener(
            'game-settings-changed',
            this.refreshSettings
        )
        this.ambience?.stop()
        this.ambience?.disconnect()
        this.reverb?.disconnect()
        this.reverbGain?.disconnect()
        this.context?.canvas.removeEventListener('pointerdown', this.unlock)
        while (this.voices.length) this.stopVoice(this.voices.length - 1)
        void this.audioContext?.close().catch(() => {})
        this.buffers.clear()
        this.buses.clear()
        this.audioContext = undefined
        this.context?.services.remove(AUDIO)
        this.context = undefined
    }
}
