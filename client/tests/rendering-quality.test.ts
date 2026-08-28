import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js'
import { Scene } from '@babylonjs/core/scene.js'
import { describe, expect, it, vi } from 'vitest'
import { applyImportedTexturePolicy, type MutableAssetTextureFacts } from '../src/foundation/assets/GltfAssetRegistry'
import type { ClientMapGameplay } from '../src/foundation/assets/MapManifest'
import { configureImageProcessing, shadowPolicy } from '../src/foundation/rendering/EnvironmentLightingModule'
import {
    antialiasingPolicy, isSoftwareRenderer, renderTierProfile, resolutionPolicy,
    selectRenderTier, type RenderHardwareFacts,
} from '../src/foundation/rendering/RenderQualityModule'
import { WorldPresentation, decorationMarkers } from '../src/foundation/rendering/WorldPresentation'

function hardware(overrides: Partial<RenderHardwareFacts> = {}): RenderHardwareFacts {
    return {
        backend: 'webgl2', renderer: 'Test GPU', logicalCores: 8, deviceMemoryGB: 8,
        maxTextureSize: 16384, maxAnisotropy: 16, maxMSAASamples: 4,
        currentSamples: 4, softwareRenderer: false, ...overrides,
    }
}

const gameplay: ClientMapGameplay = {
    spawnPoints: [], zones: [], markers: [
        { id: 'north', type: 'landmark', position: [0, 0, 0] },
        { id: 'pickup', type: 'pickup', position: [2, 0, 0] },
        { id: 'south', type: 'landmark', position: [4, 0, 0] },
        { id: 'east', type: 'landmark', position: [8, 0, 0] },
    ],
}

describe('render quality policy', () => {
    it('selects measured backend-aware tiers and honors deterministic overrides', () => {
        expect(selectRenderTier(hardware({ backend: 'webgpu' }))).toBe('high')
        expect(selectRenderTier(hardware({ logicalCores: 4 }))).toBe('low')
        expect(selectRenderTier(hardware({ softwareRenderer: true }))).toBe('software')
        expect(selectRenderTier(hardware({ backend: 'webgpu' }), 'low')).toBe('low')
        expect(isSoftwareRenderer('ANGLE (Google, Vulkan SwiftShader device)')).toBe(true)
    })

    it('caps DPR at two and recomputes tier scaling deterministically', () => {
        expect(resolutionPolicy(3, renderTierProfile('high'))).toEqual({
            devicePixelRatio: 3, effectiveDpr: 2, resolutionScale: 1, hardwareScalingLevel: 0.5,
        })
        expect(resolutionPolicy(1.5, renderTierProfile('software'))).toEqual({
            devicePixelRatio: 1.5, effectiveDpr: 0.75, resolutionScale: 0.65,
            hardwareScalingLevel: 1 / (0.75 * 0.65),
        })
    })

    it('uses actual sample support for AA and alpha-tested policy', () => {
        expect(antialiasingPolicy(4)).toEqual({ mode: 'msaa', samples: 4, alphaTest: 'alpha-to-coverage' })
        expect(antialiasingPolicy(1)).toEqual({ mode: 'fxaa', samples: 1, alphaTest: 'alpha-test' })
    })

    it('bounds shadows by tier, distance, and caster budget', () => {
        expect(shadowPolicy(renderTierProfile('high'), 72, 100)).toEqual({ enabled: true, mapSize: 2048, casterCount: 64, casterBudget: 64, distance: 72 })
        expect(shadowPolicy(renderTierProfile('low'), 72, 100)).toEqual({ enabled: false, mapSize: 0, casterCount: 0, casterBudget: 0, distance: 72 })
        expect(shadowPolicy(renderTierProfile('high'), 0, 5).enabled).toBe(false)
    })

    it('configures linear PBR image processing with integrated ACES and no final grade pass', () => {
        const target = { isEnabled: false, applyByPostProcess: true, toneMappingEnabled: false, toneMappingType: 0, exposure: 0, contrast: 0, colorCurvesEnabled: true, colorGradingEnabled: true, vignetteEnabled: true }
        configureImageProcessing(target, 1.15, 1.08)
        expect(target).toEqual({ isEnabled: true, applyByPostProcess: false, toneMappingEnabled: true, toneMappingType: 1, exposure: 1.15, contrast: 1.08, colorCurvesEnabled: false, colorGradingEnabled: false, vignetteEnabled: false })
    })
})

describe('render asset and world presentation policy', () => {
    it('changes only texture sampling and preserves authored PBR material identity and values', () => {
        const material = { getClassName: () => 'PBRMaterial', metallic: 0.73, roughness: 0.31 }
        const updateSamplingMode = vi.fn()
        const texture = { name: 'wall.ktx2', url: '/wall.ktx2', anisotropicFilteringLevel: 1, updateSamplingMode }
        const facts: MutableAssetTextureFacts = { compressionPolicy: 'ktx2-basis-preferred-with-source-fallback', filteringPolicy: 'trilinear-mipmapped', importedContainers: 0, materials: 0, pbrMaterials: 0, textures: 0, compressedTextures: 0, trilinearTextures: 0, anisotropicTextures: 0, anisotropy: 1 }
        const container = { materials: [material], textures: [texture] }

        applyImportedTexturePolicy(container, 8, facts)

        expect(container.materials[0]).toBe(material)
        expect(material).toMatchObject({ metallic: 0.73, roughness: 0.31 })
        expect(texture.anisotropicFilteringLevel).toBe(8)
        expect(updateSamplingMode).toHaveBeenCalledOnce()
        expect(facts).toMatchObject({ pbrMaterials: 1, textures: 1, compressedTextures: 1, anisotropy: 8 })
    })

    it('uses bounded landmark decoration instances and LOD without collision data', () => {
        expect(decorationMarkers(gameplay, 2).map((marker) => marker.id)).toEqual(['north', 'south'])
        const engine = new NullEngine(), scene = new Scene(engine)
        const world = new WorldPresentation(scene, gameplay, renderTierProfile('medium'), [])
        expect(world.snapshot).toMatchObject({ decorativeSources: 1, decorativeInstances: 2, lodLevels: 1, decorationBudget: 20 })
        expect(scene.meshes.filter((mesh) => mesh.name.startsWith('map-decoration/')).every((mesh) => !mesh.isPickable)).toBe(true)
        world.dispose(); scene.dispose(); engine.dispose()
    })

    it('keeps the software fallback deliberately small and shadow-free', () => {
        const engine = new NullEngine(), scene = new Scene(engine)
        const world = new WorldPresentation(scene, gameplay, renderTierProfile('software'), [])
        expect(world.snapshot).toMatchObject({ decorativeInstances: 1, lodLevels: 0, decorationBudget: 2 })
        world.dispose(); scene.dispose(); engine.dispose()
    })
})
