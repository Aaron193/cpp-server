import type { ClientModule, ClientModuleContext, FrameUpdate } from '../lifecycle'
import { ARENA, AUDIO, CAMERA } from '../services'
import { Weapon, type Vec3 } from '../../protocol/generated'

export type AudioBus = 'weapons' | 'impacts' | 'ui'
export type AudioCue = 'rifle-fire' | 'shotgun-fire' | 'impact' | 'ui-hit' | 'ui-damage' | 'ui-round' | 'ui-reload' | 'ui-reject'
export interface AudioAssetDefinition { readonly url: string; readonly bus: AudioBus; readonly volume: number; readonly priority: number; readonly maxVoices: number; readonly spatial: boolean }
export const AUDIO_ASSETS: Readonly<Record<AudioCue, AudioAssetDefinition>> = Object.freeze({
    'rifle-fire': { url: '/audio/rifle-fire.wav', bus: 'weapons', volume: .55, priority: 3, maxVoices: 8, spatial: true },
    'shotgun-fire': { url: '/audio/shotgun-fire.wav', bus: 'weapons', volume: .62, priority: 4, maxVoices: 5, spatial: true },
    impact: { url: '/audio/impact.wav', bus: 'impacts', volume: .3, priority: 1, maxVoices: 8, spatial: true },
    'ui-hit': { url: '/audio/ui-hit.wav', bus: 'ui', volume: .4, priority: 5, maxVoices: 2, spatial: false },
    'ui-damage': { url: '/audio/ui-damage.wav', bus: 'ui', volume: .48, priority: 5, maxVoices: 2, spatial: false },
    'ui-round': { url: '/audio/ui-round.wav', bus: 'ui', volume: .42, priority: 6, maxVoices: 1, spatial: false },
    'ui-reload': { url: '/audio/ui-reload.wav', bus: 'ui', volume: .28, priority: 2, maxVoices: 2, spatial: false },
    'ui-reject': { url: '/audio/ui-reject.wav', bus: 'ui', volume: .32, priority: 4, maxVoices: 2, spatial: false },
})

interface ActiveVoice { readonly cue: AudioCue; readonly source: AudioBufferSourceNode; readonly startedAt: number; readonly priority: number }
export interface AudioTelemetry { readonly activeVoices: number; readonly capacity: number; readonly stolenVoices: number; readonly failedAssets: number; readonly unlocked: boolean; readonly muted: boolean }

export function selectVoiceToSteal(voices: readonly Pick<ActiveVoice, 'priority' | 'startedAt'>[], incomingPriority: number): number {
    let selected = -1
    for (let index = 0; index < voices.length; index++) if (voices[index]!.priority <= incomingPriority && (selected < 0 || voices[index]!.priority < voices[selected]!.priority || voices[index]!.priority === voices[selected]!.priority && voices[index]!.startedAt < voices[selected]!.startedAt)) selected = index
    return selected
}

/** Asset-backed WebAudio registry with fixed concurrency and deterministic voice stealing. */
export class AudioModule implements ClientModule {
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
    initialize(context: ClientModuleContext): void { this.context = context; context.services.provide(AUDIO, this); context.canvas.addEventListener('pointerdown', this.unlock, { passive: true }) }
    private readonly unlock = (): void => {
        if (this.muted) return
        try {
            this.audioContext ??= new AudioContext()
            if (!this.master) { this.master = this.audioContext.createGain(); this.master.connect(this.audioContext.destination); for (const name of ['weapons', 'impacts', 'ui'] as const) { const bus = this.audioContext.createGain(); bus.gain.value = name === 'ui' ? .9 : 1; bus.connect(this.master); this.buses.set(name, bus) } }
            void this.audioContext.resume().then(() => { this.loading ??= this.loadAssets() }).catch(() => { this.muted = true })
        } catch { this.muted = true }
    }
    private async loadAssets(): Promise<void> { const audio = this.audioContext; if (!audio) return; await Promise.all((Object.entries(AUDIO_ASSETS) as [AudioCue, AudioAssetDefinition][]).map(async ([cue, asset]) => { try { const response = await fetch(asset.url); if (!response.ok) throw new Error(String(response.status)); this.buffers.set(cue, await audio.decodeAudioData(await response.arrayBuffer())) } catch { this.failedAssets++ } })) }
    playWeapon(weapon: Weapon, position?: Vec3): void { this.play(weapon === Weapon.Shotgun ? 'shotgun-fire' : 'rifle-fire', position) }
    playImpact(position?: Vec3): void { this.play('impact', position) }
    playUi(kind: 'hit' | 'damage' | 'round' | 'reload' | 'reject'): void { this.play(`ui-${kind}` as AudioCue) }
    play(cue: AudioCue, position?: Vec3): boolean {
        const audio = this.audioContext, buffer = this.buffers.get(cue), asset = AUDIO_ASSETS[cue], bus = this.buses.get(asset.bus)
        if (!audio || audio.state !== 'running' || this.muted || !buffer || !bus) return false
        const sameCue = this.voices.filter((voice) => voice.cue === cue)
        if (sameCue.length >= asset.maxVoices) this.stopVoice(this.voices.indexOf(sameCue.reduce((oldest, voice) => voice.startedAt < oldest.startedAt ? voice : oldest)))
        if (this.voices.length >= this.voiceCapacity) { const index = selectVoiceToSteal(this.voices, asset.priority); if (index < 0) return false; this.stopVoice(index); this.stolenVoices++ }
        try {
            const source = audio.createBufferSource(), gain = audio.createGain(); source.buffer = buffer; gain.gain.value = asset.volume; source.connect(gain)
            if (position && asset.spatial && typeof audio.createPanner === 'function') { const panner = audio.createPanner(); const scale = this.context?.services.optional(ARENA)?.mapManifest?.policy.audioDistanceScale ?? 1; panner.distanceModel = 'inverse'; panner.refDistance = 2 * scale; panner.maxDistance = 85 * scale; panner.rolloffFactor = 1.25; panner.positionX.value = position.x; panner.positionY.value = position.y; panner.positionZ.value = position.z; gain.connect(panner).connect(bus) } else gain.connect(bus)
            const voice: ActiveVoice = { cue, source, startedAt: audio.currentTime, priority: asset.priority }; this.voices.push(voice); source.onended = () => { const index = this.voices.indexOf(voice); if (index >= 0) this.voices.splice(index, 1) }; source.start(); return true
        } catch { this.failedAssets++; return false }
    }
    private stopVoice(index: number): void { if (index < 0 || index >= this.voices.length) return; const [voice] = this.voices.splice(index, 1); try { voice?.source.stop() } catch {} }
    setMuted(value: boolean): void { this.muted = value; if (this.master) this.master.gain.value = value ? 0 : 1 }
    update(_frame: FrameUpdate): void { const listener = this.audioContext?.listener, camera = this.context?.services.optional(CAMERA); if (!listener || !camera || !('positionX' in listener)) return; listener.positionX.value = camera.globalPosition.x; listener.positionY.value = camera.globalPosition.y; listener.positionZ.value = camera.globalPosition.z }
    get telemetry(): AudioTelemetry { return { activeVoices: this.voices.length, capacity: this.voiceCapacity, stolenVoices: this.stolenVoices, failedAssets: this.failedAssets, unlocked: this.audioContext?.state === 'running', muted: this.muted } }
    dispose(): void { this.context?.canvas.removeEventListener('pointerdown', this.unlock); while (this.voices.length) this.stopVoice(this.voices.length - 1); void this.audioContext?.close().catch(() => {}); this.buffers.clear(); this.buses.clear(); this.audioContext = undefined; this.context?.services.remove(AUDIO); this.context = undefined }
}
