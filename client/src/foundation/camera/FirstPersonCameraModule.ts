import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js'
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js'
import type { ClientModule, ClientModuleContext, FrameUpdate } from '../lifecycle'
import { CAMERA, INPUT, PHYSICS, SCENE } from '../services'

export interface FirstPersonCameraOptions { readonly fieldOfViewRadians?: number }

export class FirstPersonCameraModule implements ClientModule {
    readonly name = 'first-person-camera'
    private context?: ClientModuleContext
    private camera?: FreeCamera
    private readonly target = new Vector3()

    constructor(private readonly options: FirstPersonCameraOptions = {}) {}

    initialize(context: ClientModuleContext): void {
        this.context = context
        const camera = new FreeCamera('offline-player-camera', Vector3.Zero(), context.services.get(SCENE))
        camera.minZ = 0.05
        camera.maxZ = 500
        camera.fov = this.options.fieldOfViewRadians ?? Math.PI * 0.48
        camera.inputs.clear()
        context.services.get(SCENE).activeCamera = camera
        context.services.provide(CAMERA, camera)
        this.camera = camera
    }

    update(_frame: FrameUpdate): void {
        if (!this.context || !this.camera) return
        const physics = this.context.services.get(PHYSICS)
        const angles = this.context.services.get(INPUT).angles
        const position = physics.position
        const eyeHeight = physics.tuning.eyeHeight
        this.camera.position.set(position.x, position.y + eyeHeight, position.z)
        const cosPitch = Math.cos(angles.pitch)
        this.target.set(
            this.camera.position.x + Math.sin(angles.yaw) * cosPitch,
            this.camera.position.y + Math.sin(angles.pitch),
            this.camera.position.z - Math.cos(angles.yaw) * cosPitch
        )
        this.camera.setTarget(this.target)
    }

    dispose(): void {
        this.camera?.dispose()
        this.context?.services.remove(CAMERA)
        this.camera = undefined
        this.context = undefined
    }
}
