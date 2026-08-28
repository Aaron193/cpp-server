import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine.js'
import type { ClientModule, ClientModuleContext } from '../lifecycle'
import { ENGINE, RENDERING_INFO, RENDER_QUALITY } from '../services'
import type { RenderingBackend } from './EngineFactory'

export type RenderTier = 'high' | 'medium' | 'low' | 'software'
export type AntialiasingMode = 'msaa' | 'fxaa'
export type AlphaTestMode = 'alpha-to-coverage' | 'alpha-test'

export interface RenderQualityOverride {
    readonly tier?: RenderTier
    /** Deterministic test/capture override; runtime normally reads window.devicePixelRatio. */
    readonly devicePixelRatio?: number
    readonly hardware?: Partial<Omit<RenderHardwareFacts, 'backend'>>
}

export interface RenderHardwareFacts {
    readonly backend: RenderingBackend
    readonly renderer: string
    readonly logicalCores: number
    readonly deviceMemoryGB: number | null
    readonly maxTextureSize: number
    readonly maxAnisotropy: number
    readonly maxMSAASamples: number
    readonly currentSamples: number
    readonly softwareRenderer: boolean
}

export interface RenderTierProfile {
    readonly tier: RenderTier
    readonly dprCap: number
    readonly resolutionScale: number
    readonly shadowMapSize: number
    readonly shadowCasterBudget: number
    readonly anisotropyCap: number
    readonly contrast: number
    readonly decorationBudget: number
}

export interface ResolutionPolicy {
    readonly devicePixelRatio: number
    readonly effectiveDpr: number
    readonly resolutionScale: number
    readonly hardwareScalingLevel: number
}

export interface RenderQualitySnapshot extends ResolutionPolicy {
    readonly backend: RenderingBackend
    readonly tier: RenderTier
    readonly renderer: string
    readonly antialiasing: AntialiasingMode
    readonly samples: number
    readonly maxSupportedSamples: number
    readonly alphaTest: AlphaTestMode
    readonly maxAnisotropy: number
    readonly maxTextureSize: number
    readonly canvasWidth: number
    readonly canvasHeight: number
    readonly aspect: number
}

const PROFILES: Readonly<Record<RenderTier, RenderTierProfile>> = {
    high: { tier: 'high', dprCap: 2, resolutionScale: 1, shadowMapSize: 2048, shadowCasterBudget: 64, anisotropyCap: 16, contrast: 1.08, decorationBudget: 32 },
    medium: { tier: 'medium', dprCap: 1.5, resolutionScale: 1, shadowMapSize: 1024, shadowCasterBudget: 32, anisotropyCap: 8, contrast: 1.06, decorationBudget: 20 },
    low: { tier: 'low', dprCap: 1, resolutionScale: 0.8, shadowMapSize: 0, shadowCasterBudget: 0, anisotropyCap: 4, contrast: 1.03, decorationBudget: 8 },
    software: { tier: 'software', dprCap: 0.75, resolutionScale: 0.65, shadowMapSize: 0, shadowCasterBudget: 0, anisotropyCap: 1, contrast: 1, decorationBudget: 2 },
}

function positive(value: number | undefined, fallback: number): number {
    return Number.isFinite(value) && (value ?? 0) > 0 ? value! : fallback
}

export function isSoftwareRenderer(renderer: string): boolean {
    return /swiftshader|llvmpipe|softpipe|software|lavapipe|warp/i.test(renderer)
}

/** Selection happens only after the backend exists and its actual limits can be measured. */
export function selectRenderTier(facts: RenderHardwareFacts, override?: RenderTier): RenderTier {
    if (override) return override
    if (facts.softwareRenderer) return 'software'
    if (facts.logicalCores <= 4 || (facts.deviceMemoryGB !== null && facts.deviceMemoryGB <= 4) || facts.maxTextureSize < 8192) return 'low'
    if (facts.backend === 'webgpu' && facts.logicalCores >= 8 && (facts.deviceMemoryGB === null || facts.deviceMemoryGB >= 8)) return 'high'
    return 'medium'
}

export function renderTierProfile(tier: RenderTier): RenderTierProfile {
    return PROFILES[tier]
}

export function resolutionPolicy(devicePixelRatio: number, profile: RenderTierProfile): ResolutionPolicy {
    const dpr = positive(devicePixelRatio, 1)
    const effectiveDpr = Math.min(dpr, 2, profile.dprCap)
    return {
        devicePixelRatio: dpr,
        effectiveDpr,
        resolutionScale: profile.resolutionScale,
        hardwareScalingLevel: 1 / Math.max(0.25, effectiveDpr * profile.resolutionScale),
    }
}

export function antialiasingPolicy(currentSamples: number): { mode: AntialiasingMode; samples: number; alphaTest: AlphaTestMode } {
    const samples = Math.max(1, Math.floor(positive(currentSamples, 1)))
    return samples > 1
        ? { mode: 'msaa', samples, alphaTest: 'alpha-to-coverage' }
        : { mode: 'fxaa', samples: 1, alphaTest: 'alpha-test' }
}

type HardwareEngine = AbstractEngine & {
    readonly currentSampleCount?: number
    getInfo?: () => { readonly renderer?: string }
    getGlInfo?: () => { readonly renderer?: string }
    setAlphaToCoverage?: (enabled: boolean) => void
}

type NavigatorHardware = Navigator & { readonly deviceMemory?: number }

export class RenderQualityModule implements ClientModule {
    readonly name = 'render-quality'
    private context?: ClientModuleContext
    private profileValue!: RenderTierProfile
    private factsValue!: RenderHardwareFacts
    private state!: RenderQualitySnapshot
    private dprMedia?: MediaQueryList

    constructor(private readonly override: RenderQualityOverride = {}) {}

    initialize(context: ClientModuleContext): void {
        this.context = context
        const engine = context.services.get(ENGINE) as HardwareEngine
        const backend = context.services.get(RENDERING_INFO).backend
        const caps = engine.getCaps()
        const renderer = this.override.hardware?.renderer ?? engine.getInfo?.().renderer ?? engine.getGlInfo?.().renderer ?? 'unreported'
        const navigatorFacts = navigator as NavigatorHardware
        const measured: RenderHardwareFacts = {
            backend,
            renderer,
            logicalCores: this.override.hardware?.logicalCores ?? positive(navigator.hardwareConcurrency, 4),
            deviceMemoryGB: this.override.hardware?.deviceMemoryGB ?? navigatorFacts.deviceMemory ?? null,
            maxTextureSize: this.override.hardware?.maxTextureSize ?? positive(caps.maxTextureSize, 1),
            maxAnisotropy: this.override.hardware?.maxAnisotropy ?? positive(caps.maxAnisotropy, 1),
            maxMSAASamples: this.override.hardware?.maxMSAASamples ?? positive(caps.maxMSAASamples, 1),
            currentSamples: this.override.hardware?.currentSamples ?? positive(engine.currentSampleCount, 1),
            softwareRenderer: this.override.hardware?.softwareRenderer ?? isSoftwareRenderer(renderer),
        }
        this.factsValue = measured
        this.profileValue = renderTierProfile(selectRenderTier(measured, this.override.tier))
        this.state = this.buildSnapshot()
        context.services.provide(RENDER_QUALITY, this)
        window.addEventListener('resize', this.resize)
        window.visualViewport?.addEventListener('resize', this.resize)
        this.watchDpr()
        this.applyResolution()
    }

    private currentDpr(): number {
        return this.override.devicePixelRatio ?? window.devicePixelRatio ?? 1
    }

    private buildSnapshot(): RenderQualitySnapshot {
        const resolution = resolutionPolicy(this.currentDpr(), this.profileValue)
        const aa = antialiasingPolicy(this.factsValue.currentSamples)
        const canvas = this.context?.canvas
        const width = canvas?.clientWidth ?? 0, height = canvas?.clientHeight ?? 0
        return {
            ...resolution,
            backend: this.factsValue.backend,
            tier: this.profileValue.tier,
            renderer: this.factsValue.renderer,
            antialiasing: aa.mode,
            samples: aa.samples,
            maxSupportedSamples: this.factsValue.maxMSAASamples,
            alphaTest: aa.alphaTest,
            maxAnisotropy: Math.max(1, Math.min(this.factsValue.maxAnisotropy, this.profileValue.anisotropyCap)),
            maxTextureSize: this.factsValue.maxTextureSize,
            canvasWidth: width,
            canvasHeight: height,
            aspect: height > 0 ? width / height : 0,
        }
    }

    private applyResolution(): void {
        if (!this.context) return
        this.state = this.buildSnapshot()
        const engine = this.context.services.get(ENGINE) as HardwareEngine
        engine.setHardwareScalingLevel(this.state.hardwareScalingLevel)
        engine.setAlphaToCoverage?.(this.state.alphaTest === 'alpha-to-coverage')
    }

    private watchDpr(): void {
        this.dprMedia?.removeEventListener('change', this.dprChanged)
        if (typeof window.matchMedia !== 'function') return
        this.dprMedia = window.matchMedia(`(resolution: ${this.currentDpr()}dppx)`)
        this.dprMedia.addEventListener('change', this.dprChanged, { once: true })
    }

    private readonly dprChanged = (): void => {
        this.watchDpr()
        this.applyResolution()
    }
    private readonly resize = (): void => this.applyResolution()

    get profile(): RenderTierProfile { return this.profileValue }
    get facts(): RenderHardwareFacts { return this.factsValue }
    get snapshot(): RenderQualitySnapshot { return this.state }

    dispose(): void {
        window.removeEventListener('resize', this.resize)
        window.visualViewport?.removeEventListener('resize', this.resize)
        this.dprMedia?.removeEventListener('change', this.dprChanged)
        this.dprMedia = undefined
        this.context?.services.remove(RENDER_QUALITY)
        this.context = undefined
    }
}
