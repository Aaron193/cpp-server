import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js'
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js'
import type { ClientModule, ClientModuleContext, FrameUpdate } from '../lifecycle'
import { CAMERA, CAMERA_RIG, INPUT, NETWORKING, PHYSICS, SCENE, SIMULATION_AIM } from '../services'
import { CameraRigController } from './CameraRig'
import { SimulationAim } from './SimulationAim'

export interface FirstPersonCameraOptions { readonly fieldOfViewRadians?: number }

/** Composes predicted eye and render-only feel while keeping SimulationAim isolated. */
export class FirstPersonCameraModule implements ClientModule {
    readonly name = 'first-person-camera'
    readonly simulationAim = new SimulationAim()
    readonly rig: CameraRigController
    private context?: ClientModuleContext
    private camera?: FreeCamera
    private readonly target = new Vector3()
    constructor(options: FirstPersonCameraOptions = {}) { this.rig = new CameraRigController(options.fieldOfViewRadians ?? Math.PI * .48) }
    initialize(context: ClientModuleContext): void {
        this.context = context
        const camera = new FreeCamera('player-camera-rig', Vector3.Zero(), context.services.get(SCENE))
        camera.minZ = .05; camera.maxZ = 500; camera.fov = this.rig.baseFov; camera.inputs.clear()
        context.services.get(SCENE).activeCamera = camera
        context.services.provide(CAMERA, camera); context.services.provide(CAMERA_RIG, this.rig); context.services.provide(SIMULATION_AIM, this.simulationAim)
        this.camera = camera
    }
    update(frame: FrameUpdate): void {
        if (!this.context || !this.camera) return
        const physics = this.context.services.get(PHYSICS), angles = this.context.services.get(INPUT).angles
        this.simulationAim.set(angles.yaw, angles.pitch)
        const position = physics.position, velocity = physics.velocity
        const correction = this.context.services.optional(NETWORKING)?.visualCorrection ?? { x: 0, y: 0, z: 0 }
        const pose = this.rig.update({ predictedFeet: position, correctionResidual: correction, eyeHeight: physics.tuning.eyeHeight, velocity, grounded: physics.grounded, simulationYaw: angles.yaw, simulationPitch: angles.pitch }, frame.deltaSeconds)
        this.camera.position.copyFromFloats(pose.position.x, pose.position.y, pose.position.z); this.camera.fov = pose.fov
        const cosine = Math.cos(pose.pitch)
        this.target.set(pose.position.x + Math.sin(pose.yaw) * cosine, pose.position.y + Math.sin(pose.pitch), pose.position.z - Math.cos(pose.yaw) * cosine)
        this.camera.setTarget(this.target)
    }
    dispose(): void {
        this.camera?.dispose(); this.context?.services.remove(CAMERA); this.context?.services.remove(CAMERA_RIG); this.context?.services.remove(SIMULATION_AIM)
        this.camera = undefined; this.context = undefined; this.rig.hardReset()
    }
}
