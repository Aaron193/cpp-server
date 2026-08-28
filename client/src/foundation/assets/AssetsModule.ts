import type { AssetDefinition } from './AssetRegistry'
import { GltfAssetRegistry } from './GltfAssetRegistry'
import type { ClientModule, ClientModuleContext } from '../lifecycle'
import { ASSETS, RENDER_QUALITY, SCENE } from '../services'

export class AssetsModule implements ClientModule {
    readonly name = 'assets'
    private context?: ClientModuleContext

    constructor(private readonly catalog: readonly AssetDefinition[]) {}

    initialize(context: ClientModuleContext): void {
        this.context = context
        const registry = new GltfAssetRegistry(
            context.services.get(SCENE),
            this.catalog,
            context.services.get(RENDER_QUALITY)
        )
        context.services.provide(ASSETS, registry)
    }

    dispose(): void {
        if (!this.context) return
        this.context.services.optional(ASSETS)?.dispose()
        this.context.services.remove(ASSETS)
        this.context = undefined
    }
}
