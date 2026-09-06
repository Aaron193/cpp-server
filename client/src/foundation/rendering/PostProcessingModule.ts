import { loadSettings } from '../../settings/GameSettings'
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline.js'
import { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline.js'
import { SCENE } from '../services'
import { Constants } from '@babylonjs/core/Engines/constants.js'
import { FxaaPostProcess } from '@babylonjs/core/PostProcesses/fxaaPostProcess.js'
import type { ClientModule, ClientModuleContext } from '../lifecycle'
import { CAMERA, ENGINE, POST_PROCESSING, RENDER_QUALITY } from '../services'

export interface PostProcessingSnapshot {
    readonly postAA: 'fxaa' | 'none'
    readonly postProcessCount: number
    readonly finalGradePasses: 0
    readonly outputColorSpace: 'srgb-canvas'
}

/** AA fallback only. Tone mapping/grade stays fused into Babylon's PBR image processing path. */
export class PostProcessingModule implements ClientModule {
    readonly name = 'post-processing'
    private context?: ClientModuleContext
    private fxaa?: FxaaPostProcess
    private bloom?: DefaultRenderingPipeline
    private ao?: SSAO2RenderingPipeline

    initialize(context: ClientModuleContext): void {
        this.context = context
        context.services.provide(POST_PROCESSING, this)
    }

    start(): void {
        if (!this.context) return
        const profile = this.context.services.get(RENDER_QUALITY).profile,
            settings = loadSettings(),
            scene = this.context.services.get(SCENE),
            camera = this.context.services.get(CAMERA)
        if (profile.tier === 'high' || profile.tier === 'ultra') {
            if (
                settings.ambientOcclusion &&
                SSAO2RenderingPipeline.IsSupported
            ) {
                this.ao = new SSAO2RenderingPipeline(
                    'combat/contact-occlusion',
                    scene,
                    { ssaoRatio: 0.5, blurRatio: 0.5 },
                    [camera]
                )
                this.ao.totalStrength = 0.65
                this.ao.radius = 1.2
                this.ao.samples = profile.tier === 'ultra' ? 16 : 8
                this.ao.expensiveBlur = false
            }
            if (settings.bloom) {
                this.bloom = new DefaultRenderingPipeline(
                    'combat/optics',
                    false,
                    scene,
                    [camera]
                )
                this.bloom.imageProcessingEnabled = false
                this.bloom.bloomEnabled = true
                this.bloom.bloomWeight = 0.12
                this.bloom.bloomThreshold = 0.85
                this.bloom.bloomKernel = 32
            }
        }
        if (
            this.context.services.get(RENDER_QUALITY).snapshot.antialiasing !==
            'fxaa'
        )
            return
        this.fxaa = new FxaaPostProcess(
            'render-quality/fxaa',
            1,
            this.context.services.get(CAMERA),
            Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
            this.context.services.get(ENGINE),
            false
        )
    }

    get snapshot(): PostProcessingSnapshot {
        return {
            postAA: this.fxaa ? 'fxaa' : 'none',
            postProcessCount:
                (this.fxaa ? 1 : 0) + (this.bloom ? 4 : 0) + (this.ao ? 4 : 0),
            finalGradePasses: 0,
            outputColorSpace: 'srgb-canvas',
        }
    }

    dispose(): void {
        this.ao?.dispose()
        this.bloom?.dispose()
        this.fxaa?.dispose()
        this.fxaa = undefined
        this.context?.services.remove(POST_PROCESSING)
        this.context = undefined
    }
}
