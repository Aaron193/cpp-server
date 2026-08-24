import type { ClientModule, ClientModuleContext, FrameUpdate } from '../lifecycle'
import { COMBAT_PRESENTATION, ENGINE, NETWORKING, PERFORMANCE, PHYSICS, SCENE } from '../services'
import { ProfileStats } from './ProfileStats'

export interface PerformanceSnapshot {
    readonly fps: number; readonly frameP50Ms: number; readonly frameP95Ms: number
    readonly drawCalls: number | null; readonly activeMeshes: number; readonly shadersReady: boolean
    readonly predictionStepP95Ms: number; readonly snapshotBytes: number; readonly snapshotAgeMs: number
    readonly correctionMagnitude: number; readonly effectActive: number; readonly effectCapacity: number
}

type DrawCallEngine = { readonly _drawCalls?: { readonly current: number } }
type MutablePerformanceSnapshot = { -readonly [Key in keyof PerformanceSnapshot]: PerformanceSnapshot[Key] }

/** Development-only sampling. Production instances do not collect or expose data. */
export class PerformanceModule implements ClientModule {
    readonly name = 'performance'
    private context?: ClientModuleContext
    private readonly frames = new ProfileStats(240)
    private nextRefreshAt = 0
    private readonly state: MutablePerformanceSnapshot = {
        fps: 0, frameP50Ms: 0, frameP95Ms: 0, drawCalls: null, activeMeshes: 0, shadersReady: false,
        predictionStepP95Ms: 0, snapshotBytes: 0, snapshotAgeMs: 0, correctionMagnitude: 0, effectActive: 0, effectCapacity: 0,
    }

    initialize(context: ClientModuleContext): void {
        this.context = context; context.services.provide(PERFORMANCE, this)
        context.services.get(PHYSICS).setProfilingEnabled(true)
        ;(window as Window & { __arenaProfile?: () => PerformanceSnapshot }).__arenaProfile = () => this.snapshot
    }
    update(frame: FrameUpdate): void {
        this.frames.add(frame.deltaSeconds * 1000)
        const now = performance.now(); if (now < this.nextRefreshAt || !this.context) return
        this.nextRefreshAt = now + 250
        const context = this.context, engine = context.services.get(ENGINE), scene = context.services.get(SCENE)
        const frameStats = this.frames.snapshot(), network = context.services.get(NETWORKING).metrics
        const effects = context.services.get(COMBAT_PRESENTATION).effectPoolUtilization
        this.state.fps = engine.getFps(); this.state.frameP50Ms = frameStats.p50; this.state.frameP95Ms = frameStats.p95
        this.state.drawCalls = (engine as unknown as DrawCallEngine)._drawCalls?.current ?? null
        this.state.activeMeshes = scene.getActiveMeshes().length
        let ready = true; for (const mesh of scene.meshes) if (!mesh.isReady(false)) { ready = false; break }
        this.state.shadersReady = ready; this.state.predictionStepP95Ms = context.services.get(PHYSICS).predictionStepP95Ms
        this.state.snapshotBytes = network.snapshotBytes; this.state.snapshotAgeMs = network.snapshotAgeMs; this.state.correctionMagnitude = network.correctionMagnitude
        this.state.effectActive = effects.active; this.state.effectCapacity = effects.capacity
    }
    get snapshot(): PerformanceSnapshot { return this.state }
    dispose(): void {
        if (this.context) this.context.services.get(PHYSICS).setProfilingEnabled(false)
        const target = window as Window & { __arenaProfile?: () => PerformanceSnapshot }; delete target.__arenaProfile
        this.context?.services.remove(PERFORMANCE); this.context = undefined; this.frames.clear()
    }
}
