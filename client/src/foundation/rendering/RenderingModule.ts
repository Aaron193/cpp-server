import { Scene } from '@babylonjs/core/scene.js'
import type { ClientModule, ClientModuleContext } from '../lifecycle'
import { ENGINE, SCENE } from '../services'
import { EngineFactory, type RenderingBackend } from './EngineFactory'

export class RenderingModule implements ClientModule {
    readonly name = 'rendering'
    private context?: ClientModuleContext
    private backend?: RenderingBackend

    async initialize(context: ClientModuleContext): Promise<void> {
        this.context = context
        const selection = await EngineFactory.create(context.canvas)
        const scene = new Scene(selection.engine)
        scene.useRightHandedSystem = true
        this.backend = selection.backend
        context.services.provide(ENGINE, selection.engine)
        context.services.provide(SCENE, scene)
        window.addEventListener('resize', this.resize)
    }

    dispose(): void {
        if (!this.context) return
        window.removeEventListener('resize', this.resize)
        this.context.services.optional(SCENE)?.dispose()
        this.context.services.optional(ENGINE)?.dispose()
        this.context.services.remove(SCENE)
        this.context.services.remove(ENGINE)
        this.context = undefined
        this.backend = undefined
    }

    get selectedBackend(): RenderingBackend | undefined {
        return this.backend
    }

    private readonly resize = (): void => {
        this.context?.services.optional(ENGINE)?.resize()
    }
}
