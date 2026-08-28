import type { AssetContainer, InstantiatedEntries } from '@babylonjs/core/assetContainer.js'
import { Constants } from '@babylonjs/core/Engines/constants.js'
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader.js'
import type { Scene } from '@babylonjs/core/scene.js'
import '@babylonjs/loaders/glTF/index.js'
import {
    AssetRegistry,
    type AssetDefinition,
    type AssetSourceLoader,
    type LoadedAsset,
} from './AssetRegistry'
import type { RenderQualityModule } from '../rendering/RenderQualityModule'

export interface AssetTextureFacts {
    readonly compressionPolicy: 'ktx2-basis-preferred-with-source-fallback'
    readonly filteringPolicy: 'trilinear-mipmapped'
    readonly importedContainers: number
    readonly materials: number
    readonly pbrMaterials: number
    readonly textures: number
    readonly compressedTextures: number
    readonly trilinearTextures: number
    readonly anisotropicTextures: number
    readonly anisotropy: number
}

interface ImportedTexturePolicyTarget {
    readonly materials: readonly { getClassName(): string }[]
    readonly textures: readonly {
        name: string
        url?: string
        anisotropicFilteringLevel: number
        updateSamplingMode(mode: number): void
    }[]
}

export type MutableAssetTextureFacts = { -readonly [Key in keyof AssetTextureFacts]: AssetTextureFacts[Key] }

function isCompressedTexture(name: string): boolean {
    return /\.(?:ktx2?|basis)(?:$|[?#])/i.test(name)
}

/** Applies sampling only; authored PBR materials, UVs, tangents, factors, and textures remain intact. */
export function applyImportedTexturePolicy(
    container: ImportedTexturePolicyTarget,
    anisotropy: number,
    facts: MutableAssetTextureFacts
): void {
    facts.importedContainers++
    facts.materials += container.materials.length
    facts.pbrMaterials += container.materials.filter((material) => /PBR/i.test(material.getClassName())).length
    for (const texture of container.textures) {
        texture.anisotropicFilteringLevel = anisotropy
        texture.updateSamplingMode(Constants.TEXTURE_TRILINEAR_SAMPLINGMODE)
        facts.textures++
        facts.trilinearTextures++
        if (anisotropy > 1) facts.anisotropicTextures++
        if (isCompressedTexture(`${texture.name} ${(texture as { url?: string }).url ?? ''}`)) facts.compressedTextures++
    }
    facts.anisotropy = anisotropy
}

class BabylonGltfLoader implements AssetSourceLoader<InstantiatedEntries> {
    constructor(
        private readonly scene: Scene,
        private readonly loaded: (container: AssetContainer) => void
    ) {}

    async load(source: string): Promise<LoadedAsset<InstantiatedEntries>> {
        const container = await LoadAssetContainerAsync(source, this.scene)
        this.loaded(container)
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
    private readonly factsValue: MutableAssetTextureFacts

    constructor(
        private readonly scene: Scene,
        definitions: readonly AssetDefinition[],
        private readonly quality: RenderQualityModule
    ) {
        const facts: MutableAssetTextureFacts = {
            compressionPolicy: 'ktx2-basis-preferred-with-source-fallback', filteringPolicy: 'trilinear-mipmapped',
            importedContainers: 0, materials: 0, pbrMaterials: 0, textures: 0,
            compressedTextures: 0, trilinearTextures: 0, anisotropicTextures: 0, anisotropy: 1,
        }
        super(definitions, new BabylonGltfLoader(scene, (container) =>
            applyImportedTexturePolicy(container, quality.snapshot.maxAnisotropy, facts)))
        this.factsValue = facts
    }

    /** Map render packages share the exact registry import and texture policy used by catalog assets. */
    async importContainer(source: string): Promise<AssetContainer> {
        const container = await LoadAssetContainerAsync(source, this.scene)
        applyImportedTexturePolicy(container, this.quality.snapshot.maxAnisotropy, this.factsValue)
        return container
    }

    get textureFacts(): AssetTextureFacts { return this.factsValue }
}
