import { Color3 } from '@babylonjs/core/Maths/math.color.js'
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js'
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js'
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration.js'
import type { ClientMapManifest } from '../assets/MapManifest'
import type { ClientModule, ClientModuleContext } from '../lifecycle'
import { ENVIRONMENT, RENDER_QUALITY, SCENE } from '../services'

type MapEnvironment = ClientMapManifest['environment']

export interface ShadowPolicy {
    readonly enabled: boolean
    readonly mapSize: number
    readonly casterCount: number
    readonly casterBudget: number
    readonly distance: number
}

interface ImageProcessingTarget {
    isEnabled: boolean
    applyByPostProcess: boolean
    toneMappingEnabled: boolean
    toneMappingType: number
    exposure: number
    contrast: number
    colorCurvesEnabled: boolean
    colorGradingEnabled: boolean
    vignetteEnabled: boolean
}

export function configureImageProcessing(target: ImageProcessingTarget, exposure: number, contrast: number): void {
    target.isEnabled = true
    target.applyByPostProcess = false
    target.toneMappingEnabled = true
    target.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES
    target.exposure = exposure
    target.contrast = contrast
    target.colorCurvesEnabled = false
    target.colorGradingEnabled = false
    target.vignetteEnabled = false
}

export function shadowPolicy(
    profile: Pick<import('./RenderQualityModule').RenderTierProfile, 'shadowMapSize' | 'shadowCasterBudget'>,
    shadowDistance: number,
    eligibleCasters: number
): ShadowPolicy {
    const distance = Math.max(0, Number.isFinite(shadowDistance) ? shadowDistance : 0)
    const casterCount = Math.min(Math.max(0, eligibleCasters), profile.shadowCasterBudget)
    const enabled = profile.shadowMapSize > 0 && distance > 0 && casterCount > 0
    return { enabled, mapSize: enabled ? profile.shadowMapSize : 0, casterCount: enabled ? casterCount : 0, casterBudget: profile.shadowCasterBudget, distance }
}

export interface EnvironmentSnapshot {
    readonly applied: boolean
    readonly clearColor: readonly [number, number, number]
    readonly sunDirection: readonly [number, number, number]
    readonly exposure: number
    readonly contrast: number
    readonly toneMapping: 'aces'
    readonly imageProcessing: 'linear-pbr-forward'
    readonly shadowDistance: number
    readonly shadowsEnabled: boolean
    readonly shadowMapSize: number
    readonly shadowCasters: number
    readonly shadowCasterBudget: number
}

const DEFAULT_ENVIRONMENT: MapEnvironment = {
    clearColor: [0.055, 0.075, 0.11], exposure: 1,
    sunDirection: [-0.4, -1, 0.3], shadowDistance: 80,
}

/** Owns only map environment, sun/ambient light, image processing, and bounded shadows. */
export class EnvironmentLightingModule implements ClientModule {
    readonly name = 'environment-lighting'
    private context?: ClientModuleContext
    private ambient?: HemisphericLight
    private sun?: DirectionalLight
    private shadow?: ShadowGenerator
    private state: EnvironmentSnapshot = {
        applied: false, clearColor: DEFAULT_ENVIRONMENT.clearColor, sunDirection: DEFAULT_ENVIRONMENT.sunDirection,
        exposure: 1, contrast: 1, toneMapping: 'aces', imageProcessing: 'linear-pbr-forward', shadowDistance: 0,
        shadowsEnabled: false, shadowMapSize: 0, shadowCasters: 0, shadowCasterBudget: 0,
    }

    initialize(context: ClientModuleContext): void {
        this.context = context
        context.services.provide(ENVIRONMENT, this)
        const scene = context.services.get(SCENE)
        const quality = context.services.get(RENDER_QUALITY)
        const image = scene.imageProcessingConfiguration
        configureImageProcessing(image, 1, quality.profile.contrast)
    }

    apply(environment: MapEnvironment, meshes: readonly AbstractMesh[]): void {
        if (!this.context) throw new Error('Environment service is not initialized')
        this.disposeLights()
        const scene = this.context.services.get(SCENE)
        const quality = this.context.services.get(RENDER_QUALITY)
        scene.clearColor.set(...environment.clearColor, 1)
        configureImageProcessing(scene.imageProcessingConfiguration, environment.exposure, quality.profile.contrast)

        this.ambient = new HemisphericLight('map-environment/ambient', new Vector3(0, 1, 0), scene)
        this.ambient.intensity = quality.profile.tier === 'software' ? 1 : 0.72
        this.ambient.groundColor = new Color3(0.12, 0.15, 0.2)
        this.sun = new DirectionalLight('map-environment/sun', new Vector3(...environment.sunDirection), scene)
        this.sun.intensity = quality.profile.tier === 'software' ? 0.7 : 1.15

        const distance = Math.max(0, environment.shadowDistance)
        this.sun.position.copyFrom(this.sun.direction.scale(-Math.max(20, distance * 0.75)))
        this.sun.shadowMinZ = 0.1
        this.sun.shadowMaxZ = Math.max(1, distance * 2)
        this.sun.autoUpdateExtends = false
        this.sun.orthoLeft = -distance
        this.sun.orthoRight = distance
        this.sun.orthoTop = distance
        this.sun.orthoBottom = -distance

        const eligible = meshes.filter((mesh) => mesh.getTotalIndices() > 0)
        const policy = shadowPolicy(quality.profile, distance, eligible.length)
        const candidates = eligible.slice(0, policy.casterCount)
        if (policy.enabled) {
            this.shadow = new ShadowGenerator(policy.mapSize, this.sun)
            this.shadow.filter = ShadowGenerator.FILTER_PCF
            this.shadow.filteringQuality = quality.profile.tier === 'high' ? ShadowGenerator.QUALITY_MEDIUM : ShadowGenerator.QUALITY_LOW
            this.shadow.bias = 0.0005
            this.shadow.normalBias = 0.02
            const shadowMap = this.shadow.getShadowMap()
            if (shadowMap) shadowMap.renderList = [...candidates]
            for (const mesh of meshes) mesh.receiveShadows = true
        }

        this.state = {
            applied: true,
            clearColor: [...environment.clearColor],
            sunDirection: [...environment.sunDirection],
            exposure: environment.exposure,
            contrast: quality.profile.contrast,
            toneMapping: 'aces',
            imageProcessing: 'linear-pbr-forward',
            shadowDistance: distance,
            shadowsEnabled: this.shadow !== undefined,
            shadowMapSize: policy.mapSize,
            shadowCasters: this.shadow ? candidates.length : 0,
            shadowCasterBudget: policy.casterBudget,
        }
    }

    private disposeLights(): void {
        this.shadow?.dispose(); this.shadow = undefined
        this.sun?.dispose(); this.sun = undefined
        this.ambient?.dispose(); this.ambient = undefined
    }

    get snapshot(): EnvironmentSnapshot { return this.state }

    dispose(): void {
        this.disposeLights()
        this.context?.services.remove(ENVIRONMENT)
        this.context = undefined
    }
}
