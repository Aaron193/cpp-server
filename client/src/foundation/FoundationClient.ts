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
import { FirstPersonCameraModule } from './camera/FirstPersonCameraModule'
import { OfflineArenaModule } from './gameplay/OfflineArenaModule'
import type { MovementTuning } from './physics/Movement'
import { SCENE } from './services'
import { CombatPresentationModule } from './combat/CombatPresentationModule'
import { PerformanceModule } from './performance/PerformanceModule'
import { isDevelopment } from '../utils/environment'

export interface FoundationClientOptions {
    readonly canvas: HTMLCanvasElement
    readonly hudRoot: HTMLElement
    readonly assetCatalog?: readonly AssetDefinition[]
    readonly mapRoot?: string
    readonly movementTuning?: Partial<MovementTuning>
    readonly camera?: { readonly sensitivity?: number; readonly fieldOfViewRadians?: number }
    readonly networking?: NetworkingOptions
}

/** Composition root for the future 3D client; the legacy home/game path stays live. */
export class FoundationClient {
    readonly services = new ServiceRegistry()
    private readonly lifecycle: ModuleLifecycle

    constructor(private readonly options: FoundationClientOptions) {
        const physics = new PhysicsPredictionModule(options.movementTuning)
        this.lifecycle = new ModuleLifecycle([
            new RenderingModule(),
            new AssetsModule(options.assetCatalog ?? []),
            new InputModule({
                sensitivity: options.camera?.sensitivity ?? 0.002,
                minPitch: -Math.PI / 2 + 0.01,
                maxPitch: Math.PI / 2 - 0.01,
            }),
            physics,
            new OfflineArenaModule(options.mapRoot),
            new EntityViewsModule(),
            new NetworkingModule(options.networking),
            new FirstPersonCameraModule({ fieldOfViewRadians: options.camera?.fieldOfViewRadians }),
            new AudioModule(),
            new CombatPresentationModule(),
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

    dispose(): Promise<void> {
        return this.lifecycle.dispose()
    }
}
