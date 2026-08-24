import type { InstantiatedEntries } from '@babylonjs/core/assetContainer.js'
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader.js'
import type { Scene } from '@babylonjs/core/scene.js'
import '@babylonjs/loaders/glTF/index.js'
import {
    AssetRegistry,
    type AssetDefinition,
    type AssetSourceLoader,
    type LoadedAsset,
} from './AssetRegistry'

class BabylonGltfLoader implements AssetSourceLoader<InstantiatedEntries> {
    constructor(private readonly scene: Scene) {}

    async load(source: string): Promise<LoadedAsset<InstantiatedEntries>> {
        const container = await LoadAssetContainerAsync(source, this.scene)
        return {
            instantiate: ({ namePrefix, cloneMaterials }) => {
                let instanceNumber = 0
                return container.instantiateModelsToScene(
                    (sourceName) =>
                        `${namePrefix}/${instanceNumber++}/${sourceName}`,
                    cloneMaterials
                )
            },
            dispose: () => container.dispose(),
        }
    }
}

export class GltfAssetRegistry extends AssetRegistry<InstantiatedEntries> {
    constructor(scene: Scene, definitions: readonly AssetDefinition[]) {
        super(definitions, new BabylonGltfLoader(scene))
    }
}
