import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine.js'
import type { Scene } from '@babylonjs/core/scene.js'
import type { Camera } from '@babylonjs/core/Cameras/camera.js'
import type { GltfAssetRegistry } from './assets/GltfAssetRegistry'
import type { AudioModule } from './audio/AudioModule'
import type { EntityViewsModule } from './entities/EntityViewsModule'
import type { HudModule } from './hud/HudModule'
import type { InputModule } from './input/InputModule'
import type { NetworkingModule } from './networking/NetworkingModule'
import type { PhysicsPredictionModule } from './physics/PhysicsPredictionModule'
import type { OfflineArenaModule } from './gameplay/OfflineArenaModule'
import type { CombatPresentationModule } from './combat/CombatPresentationModule'
import type { PerformanceModule } from './performance/PerformanceModule'
import { createServiceToken } from './lifecycle'

export const ENGINE = createServiceToken<AbstractEngine>('rendering.engine')
export const SCENE = createServiceToken<Scene>('rendering.scene')
export const CAMERA = createServiceToken<Camera>('rendering.camera')
export const ASSETS = createServiceToken<GltfAssetRegistry>('assets.registry')
export const INPUT = createServiceToken<InputModule>('input')
export const PHYSICS =
    createServiceToken<PhysicsPredictionModule>('physics.prediction')
export const ARENA = createServiceToken<OfflineArenaModule>('gameplay.offline-arena')
export const NETWORKING = createServiceToken<NetworkingModule>('networking')
export const AUDIO = createServiceToken<AudioModule>('audio')
export const HUD = createServiceToken<HudModule>('hud')
export const ENTITY_VIEWS =
    createServiceToken<EntityViewsModule>('entity.views')
export const COMBAT_PRESENTATION = createServiceToken<CombatPresentationModule>('combat.presentation')
export const PERFORMANCE = createServiceToken<PerformanceModule>('performance')
