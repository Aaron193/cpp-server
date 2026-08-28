import type { AssetDefinition } from './assets/AssetRegistry'
import { AssetsModule } from './assets/AssetsModule'
import { AudioModule } from './audio/AudioModule'
import { EntityViewsModule } from './entities/EntityViewsModule'
import { HudModule } from './hud/HudModule'
import { InputModule } from './input/InputModule'
import {
    ModuleLifecycle,
    ServiceRegistry,
    type FrameUpdate,
} from './lifecycle'
import { NetworkingModule } from './networking/NetworkingModule'
import type { NetworkingOptions } from './networking/NetworkingModule'
import { PhysicsPredictionModule } from './physics/PhysicsPredictionModule'
import { RenderingModule } from './rendering/RenderingModule'
import type { EngineFactoryOptions } from './rendering/EngineFactory'
import { RenderQualityModule, type RenderQualityOverride } from './rendering/RenderQualityModule'
import { EnvironmentLightingModule } from './rendering/EnvironmentLightingModule'
import { PostProcessingModule } from './rendering/PostProcessingModule'
import { FirstPersonCameraModule } from './camera/FirstPersonCameraModule'
import { MapModule } from './gameplay/MapModule'
import type { MovementTuning } from './physics/Movement'
import { ARENA, ASSETS, ENVIRONMENT, NETWORKING, POST_PROCESSING, RENDER_QUALITY, SCENE } from './services'
import { CombatPresentationModule } from './combat/CombatPresentationModule'
import { PerformanceModule } from './performance/PerformanceModule'
import { isDevelopment } from '../utils/environment'
import { KillcamModule } from './replay/KillcamModule'

export interface FoundationClientOptions {
    readonly canvas: HTMLCanvasElement
    readonly hudRoot: HTMLElement
    readonly assetCatalog?: readonly AssetDefinition[]
    readonly mapRoot?: string
    readonly movementTuning?: Partial<MovementTuning>
    readonly camera?: { readonly sensitivity?: number; readonly fieldOfViewRadians?: number }
    readonly networking?: NetworkingOptions
    readonly rendering?: EngineFactoryOptions
    readonly renderQuality?: RenderQualityOverride
}

/** Composition root for the future 3D client; the legacy home/game path stays live. */
export class FoundationClient {
    readonly services = new ServiceRegistry()
    private readonly lifecycle: ModuleLifecycle

    constructor(private readonly options: FoundationClientOptions) {
        const physics = new PhysicsPredictionModule(options.movementTuning)
        const reducedTierRequested = options.renderQuality?.tier === 'low' || options.renderQuality?.tier === 'software'
        const renderingOptions: EngineFactoryOptions = {
            ...options.rendering,
            antialias: options.rendering?.antialias ?? (reducedTierRequested ? false : undefined),
        }
        this.lifecycle = new ModuleLifecycle([
            new RenderingModule(renderingOptions),
            new RenderQualityModule(options.renderQuality),
            new EnvironmentLightingModule(),
            new AssetsModule(options.assetCatalog ?? []),
            new InputModule({
                sensitivity: options.camera?.sensitivity ?? 0.002,
                minPitch: -Math.PI / 2 + 0.01,
                maxPitch: Math.PI / 2 - 0.01,
            }),
            physics,
            new MapModule(options.mapRoot),
            new EntityViewsModule(),
            new NetworkingModule(options.networking),
            new FirstPersonCameraModule({ fieldOfViewRadians: options.camera?.fieldOfViewRadians }),
            new PostProcessingModule(),
            new AudioModule(),
            new CombatPresentationModule(),
            new KillcamModule(),
            ...(isDevelopment() ? [new PerformanceModule()] : []),
            new HudModule(),
        ])
    }

    async initialize(): Promise<void> {
        await this.lifecycle.initialize({
            canvas: this.options.canvas,
            hudRoot: this.options.hudRoot,
            services: this.services,
        })
    }

    start(): Promise<void> {
        return this.lifecycle.start()
    }

    update(frame: FrameUpdate): void {
        this.lifecycle.update(frame)
        this.services.get(SCENE).render()
    }

    /** Development/E2E visibility snapshot; never mutates simulation state. */
    debugSnapshot(): {
        readonly networkStatus: string
        readonly remotePlayers: number
        readonly localWeapon: number
        readonly rendering: {
            readonly quality: ReturnType<FoundationClient['renderingSnapshot']>['quality']
            readonly environment: ReturnType<FoundationClient['renderingSnapshot']>['environment']
            readonly post: ReturnType<FoundationClient['renderingSnapshot']>['post']
            readonly assets: ReturnType<FoundationClient['renderingSnapshot']>['assets']
            readonly world: ReturnType<FoundationClient['renderingSnapshot']>['world']
        }
        readonly meshes: readonly { readonly name: string; readonly enabled: boolean; readonly inFrustum: boolean }[]
    } {
        const scene = this.services.get(SCENE)
        const camera = scene.activeCamera
        const networking = this.services.get(NETWORKING)
        return {
            networkStatus: networking.status,
            remotePlayers: networking.metrics.remotePlayers,
            localWeapon: networking.combat.localPlayer.weapon,
            rendering: this.renderingSnapshot(),
            meshes: scene.meshes
                .filter((mesh) => /^(remote-|viewmodel\/|tracer\/|muzzle\/)/.test(mesh.name))
                .map((mesh) => ({
                    name: mesh.name,
                    enabled: mesh.isEnabled(true) && mesh.isVisible,
                    inFrustum: Boolean(camera?.isInFrustum(mesh)),
                })),
        }
    }

    private renderingSnapshot() {
        return {
            quality: this.services.get(RENDER_QUALITY).snapshot,
            environment: this.services.get(ENVIRONMENT).snapshot,
            post: this.services.get(POST_PROCESSING).snapshot,
            assets: this.services.get(ASSETS).textureFacts,
            world: this.services.get(ARENA).presentationMetrics,
        }
    }

    dispose(): Promise<void> {
        return this.lifecycle.dispose()
    }
}
