import type { ClientModule, ClientModuleContext, FrameUpdate } from '../lifecycle'
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation.js'
import { ARENA, ASSETS, COMBAT_PRESENTATION, ENGINE, ENVIRONMENT, NETWORKING, PERFORMANCE, PHYSICS, POST_PROCESSING, RENDER_QUALITY, SCENE } from '../services'
import { ProfileStats } from './ProfileStats'

export interface PerformanceSnapshot {
    readonly fps: number; readonly frameP50Ms: number; readonly frameP95Ms: number
    readonly drawCalls: number | null; readonly activeMeshes: number; readonly shadersReady: boolean
    readonly predictionStepP95Ms: number; readonly snapshotBytes: number; readonly snapshotAgeMs: number
    readonly rttMs: number; readonly jitterMs: number; readonly mapLoadTotalMs: number
    readonly correctionMagnitude: number; readonly effectActive: number; readonly effectCapacity: number
    readonly droppedSimulationTimeMs: number; readonly replaySteps: number; readonly replayTimeMs: number
    readonly hardSyncCount: number; readonly hardSyncReason: string | null
    readonly clockConfidence: number; readonly clockAgeMs: number
    readonly interpolationDelayMs: number; readonly interpolationMode: string
    readonly interpolationUnderflows: number; readonly interpolationOverflows: number
    readonly backend: string; readonly renderTier: string; readonly devicePixelRatio: number
    readonly effectiveDpr: number; readonly resolutionScale: number; readonly hardwareScalingLevel: number
    readonly canvasWidth: number; readonly canvasHeight: number; readonly aspect: number
    readonly antialiasing: string; readonly aaSamples: number; readonly maxSupportedAaSamples: number; readonly alphaTest: string
    readonly shadowsEnabled: boolean; readonly shadowMapSize: number; readonly shadowCasters: number; readonly shadowDistance: number
    readonly triangles: number; readonly textures: number; readonly compressedTextures: number
    readonly anisotropicTextures: number; readonly anisotropy: number; readonly pbrMaterials: number
    readonly textureCompressionPolicy: string; readonly textureFilteringPolicy: string
    readonly postProcessCount: number; readonly finalGradePasses: number
    readonly mapContainerInstances: number; readonly decorativeInstances: number; readonly lodLevels: number
}

type MutablePerformanceSnapshot = { -readonly [Key in keyof PerformanceSnapshot]: PerformanceSnapshot[Key] }

/** Development-only sampling. Production instances do not collect or expose data. */
export class PerformanceModule implements ClientModule {
    readonly name = 'performance'
    private context?: ClientModuleContext
    private readonly frames = new ProfileStats(240)
    private instrumentation?: SceneInstrumentation
    private nextRefreshAt = 0
    private readonly state: MutablePerformanceSnapshot = {
        fps: 0, frameP50Ms: 0, frameP95Ms: 0, drawCalls: null, activeMeshes: 0, shadersReady: false,
        predictionStepP95Ms: 0, snapshotBytes: 0, snapshotAgeMs: 0, rttMs: 0, jitterMs: 0, mapLoadTotalMs: 0,
        correctionMagnitude: 0, effectActive: 0, effectCapacity: 0,
        droppedSimulationTimeMs: 0, replaySteps: 0, replayTimeMs: 0, hardSyncCount: 0, hardSyncReason: null,
        clockConfidence: 0, clockAgeMs: 0, interpolationDelayMs: 0, interpolationMode: 'none', interpolationUnderflows: 0, interpolationOverflows: 0,
        backend: 'unknown', renderTier: 'unknown', devicePixelRatio: 1, effectiveDpr: 1, resolutionScale: 1, hardwareScalingLevel: 1,
        canvasWidth: 0, canvasHeight: 0, aspect: 0, antialiasing: 'unknown', aaSamples: 1, maxSupportedAaSamples: 1, alphaTest: 'alpha-test',
        shadowsEnabled: false, shadowMapSize: 0, shadowCasters: 0, shadowDistance: 0, triangles: 0,
        textures: 0, compressedTextures: 0, anisotropicTextures: 0, anisotropy: 1, pbrMaterials: 0,
        textureCompressionPolicy: 'unknown', textureFilteringPolicy: 'unknown',
        postProcessCount: 0, finalGradePasses: 0, mapContainerInstances: 0, decorativeInstances: 0, lodLevels: 0,
    }

    initialize(context: ClientModuleContext): void {
        this.context = context; context.services.provide(PERFORMANCE, this)
        context.services.get(PHYSICS).setProfilingEnabled(true)
        this.instrumentation = new SceneInstrumentation(context.services.get(SCENE))
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
        this.state.drawCalls = this.instrumentation?.drawCallsCounter.current ?? null
        this.state.activeMeshes = scene.getActiveMeshes().length
        this.state.triangles = Math.floor(scene.getActiveIndices() / 3)
        let ready = true; for (const mesh of scene.meshes) if (!mesh.isReady(false)) { ready = false; break }
        this.state.shadersReady = ready; this.state.predictionStepP95Ms = context.services.get(PHYSICS).predictionStepP95Ms
        this.state.snapshotBytes = network.snapshotBytes; this.state.snapshotAgeMs = network.snapshotAgeMs
        this.state.rttMs = network.rttMs; this.state.jitterMs = network.jitterMs
        this.state.mapLoadTotalMs = context.services.get(ARENA).loadMetrics.totalMs
        this.state.correctionMagnitude = network.correctionMagnitude
        this.state.droppedSimulationTimeMs = network.droppedSimulationTimeMs
        this.state.replaySteps = network.replaySteps; this.state.replayTimeMs = network.replayTimeMs
        this.state.hardSyncCount = network.hardSyncCount; this.state.hardSyncReason = network.hardSyncReason
        this.state.clockConfidence = network.clockConfidence; this.state.clockAgeMs = network.clockAgeMs
        this.state.interpolationDelayMs = network.interpolationDelayMs; this.state.interpolationMode = network.interpolationMode
        this.state.interpolationUnderflows = network.interpolationUnderflows; this.state.interpolationOverflows = network.interpolationOverflows
        this.state.effectActive = effects.active; this.state.effectCapacity = effects.capacity
        const quality = context.services.get(RENDER_QUALITY).snapshot
        this.state.backend = quality.backend; this.state.renderTier = quality.tier
        this.state.devicePixelRatio = quality.devicePixelRatio; this.state.effectiveDpr = quality.effectiveDpr
        this.state.resolutionScale = quality.resolutionScale; this.state.hardwareScalingLevel = quality.hardwareScalingLevel
        this.state.canvasWidth = quality.canvasWidth; this.state.canvasHeight = quality.canvasHeight; this.state.aspect = quality.aspect
        this.state.antialiasing = quality.antialiasing; this.state.aaSamples = quality.samples
        this.state.maxSupportedAaSamples = quality.maxSupportedSamples; this.state.alphaTest = quality.alphaTest
        const environment = context.services.get(ENVIRONMENT).snapshot
        this.state.shadowsEnabled = environment.shadowsEnabled; this.state.shadowMapSize = environment.shadowMapSize
        this.state.shadowCasters = environment.shadowCasters; this.state.shadowDistance = environment.shadowDistance
        const textures = context.services.get(ASSETS).textureFacts
        this.state.textures = textures.textures; this.state.compressedTextures = textures.compressedTextures
        this.state.anisotropicTextures = textures.anisotropicTextures; this.state.anisotropy = textures.anisotropy
        this.state.pbrMaterials = textures.pbrMaterials
        this.state.textureCompressionPolicy = textures.compressionPolicy; this.state.textureFilteringPolicy = textures.filteringPolicy
        const post = context.services.get(POST_PROCESSING).snapshot
        this.state.postProcessCount = post.postProcessCount; this.state.finalGradePasses = post.finalGradePasses
        const world = context.services.get(ARENA).presentationMetrics
        this.state.mapContainerInstances = world.containerInstances; this.state.decorativeInstances = world.decorativeInstances
        this.state.lodLevels = world.lodLevels
    }
    get snapshot(): PerformanceSnapshot { return this.state }
    dispose(): void {
        if (this.context) this.context.services.get(PHYSICS).setProfilingEnabled(false)
        const target = window as Window & { __arenaProfile?: () => PerformanceSnapshot }; delete target.__arenaProfile
        this.instrumentation?.dispose(); this.instrumentation = undefined
        this.context?.services.remove(PERFORMANCE); this.context = undefined; this.frames.clear()
    }
}
