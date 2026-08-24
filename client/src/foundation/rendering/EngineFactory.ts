import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine.js'
import { Engine } from '@babylonjs/core/Engines/engine.js'
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine.js'

export type RenderingBackend = 'webgpu' | 'webgl2'

export interface EngineSelection {
    readonly backend: RenderingBackend
    readonly engine: AbstractEngine
}

export interface EngineFactoryOptions {
    readonly antialias?: boolean
    readonly adaptToDeviceRatio?: boolean
}

/** Selects WebGPU when it initializes successfully, otherwise requires WebGL2. */
export class EngineFactory {
    static async create(
        canvas: HTMLCanvasElement,
        options: EngineFactoryOptions = {}
    ): Promise<EngineSelection> {
        const antialias = options.antialias ?? true

        try {
            if (await WebGPUEngine.IsSupportedAsync) {
                const engine = await WebGPUEngine.CreateAsync(canvas, {
                    antialias,
                    adaptToDeviceRatio: options.adaptToDeviceRatio ?? true,
                })
                return { backend: 'webgpu', engine }
            }
        } catch (error) {
            console.warn(
                '[EngineFactory] WebGPU detection or initialization failed; trying WebGL2.',
                error
            )
        }

        const engine = new Engine(
            canvas,
            antialias,
            { disableWebGL2Support: false },
            options.adaptToDeviceRatio ?? true
        )
        if (engine.webGLVersion !== 2) {
            engine.dispose()
            throw new Error('This client requires WebGPU or WebGL2 support')
        }
        return { backend: 'webgl2', engine }
    }
}
