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

    initialize(context: ClientModuleContext): void {
        this.context = context
        context.services.provide(POST_PROCESSING, this)
    }

    start(): void {
        if (!this.context || this.context.services.get(RENDER_QUALITY).snapshot.antialiasing !== 'fxaa') return
        this.fxaa = new FxaaPostProcess(
            'render-quality/fxaa', 1, this.context.services.get(CAMERA),
            Constants.TEXTURE_BILINEAR_SAMPLINGMODE, this.context.services.get(ENGINE), false
        )
    }

    get snapshot(): PostProcessingSnapshot {
        return { postAA: this.fxaa ? 'fxaa' : 'none', postProcessCount: this.fxaa ? 1 : 0, finalGradePasses: 0, outputColorSpace: 'srgb-canvas' }
    }

    dispose(): void {
        this.fxaa?.dispose(); this.fxaa = undefined
        this.context?.services.remove(POST_PROCESSING)
        this.context = undefined
    }
}
