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
import type { MapModule } from './gameplay/MapModule'
import type { CombatPresentationModule } from './combat/CombatPresentationModule'
import type { PerformanceModule } from './performance/PerformanceModule'
import type { RenderingInfo } from './rendering/RenderingModule'
import type { RenderQualityModule } from './rendering/RenderQualityModule'
import type { EnvironmentLightingModule } from './rendering/EnvironmentLightingModule'
import type { PostProcessingModule } from './rendering/PostProcessingModule'
import type { CameraRigController } from './camera/CameraRig'
import type { SimulationAim } from './camera/SimulationAim'
import type { KillcamModule } from './replay/KillcamModule'
import type { AimingModule } from './aiming/AimingModule'
import { createServiceToken } from './lifecycle'

export const ENGINE = createServiceToken<AbstractEngine>('rendering.engine')
export const SCENE = createServiceToken<Scene>('rendering.scene')
export const RENDERING_INFO = createServiceToken<RenderingInfo>('rendering.info')
export const RENDER_QUALITY = createServiceToken<RenderQualityModule>('rendering.quality')
export const ENVIRONMENT = createServiceToken<EnvironmentLightingModule>('rendering.environment')
export const POST_PROCESSING = createServiceToken<PostProcessingModule>('rendering.post-processing')
export const CAMERA = createServiceToken<Camera>('rendering.camera')
export const CAMERA_RIG = createServiceToken<CameraRigController>('rendering.camera-rig')
export const SIMULATION_AIM = createServiceToken<SimulationAim>('simulation.aim')
export const ASSETS = createServiceToken<GltfAssetRegistry>('assets.registry')
export const INPUT = createServiceToken<InputModule>('input')
export const PHYSICS =
    createServiceToken<PhysicsPredictionModule>('physics.prediction')
export const ARENA = createServiceToken<MapModule>('gameplay.map')
export const NETWORKING = createServiceToken<NetworkingModule>('networking')
export const AUDIO = createServiceToken<AudioModule>('audio')
export const HUD = createServiceToken<HudModule>('hud')
export const ENTITY_VIEWS =
    createServiceToken<EntityViewsModule>('entity.views')
export const COMBAT_PRESENTATION = createServiceToken<CombatPresentationModule>('combat.presentation')
export const PERFORMANCE = createServiceToken<PerformanceModule>('performance')
export const KILLCAM = createServiceToken<KillcamModule>('presentation.killcam')
export const AIMING = createServiceToken<AimingModule>('gameplay.aiming')
