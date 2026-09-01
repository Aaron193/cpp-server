import type { Vec3 } from '../../protocol/generated'

export interface CameraRigInput {
    readonly predictedFeet: Vec3
    readonly correctionResidual: Vec3
    readonly eyeHeight: number
    readonly velocity: Vec3
    readonly grounded: boolean
    readonly simulationYaw: number
    readonly simulationPitch: number
    readonly movementTilt?: number
    readonly aimProgress?: number
}
export interface CameraRigPose { readonly position: Vec3; readonly yaw: number; readonly pitch: number; readonly roll: number; readonly fov: number }

/** Render-only feel state. Its output type is deliberately absent from input/protocol code. */
export class CameraRigController {
    private bobPhase = 0
    private stepOffset = 0
    private crouchOffset = 0
    private landingOffset = 0
    private damageYaw = 0
    private damagePitch = 0
    private recoilPitch = 0
    private recoilYaw = 0
    private previousFeetY?: number
    private previousGrounded = true
    private currentFov: number
    private targetFov: number
    private currentEyeHeight?: number
    private movementPitch = 0

    constructor(readonly baseFov = Math.PI * .48) { this.currentFov = this.targetFov = baseFov }
    setFovTarget(radians: number): void { if (Number.isFinite(radians)) this.targetFov = Math.max(.65, Math.min(1.8, radians)) }
    setCrouch(active: boolean): void { this.crouchOffset = active ? Math.min(this.crouchOffset, -.01) : Math.max(this.crouchOffset, -.31) }
    addRecoil(pitch = .035, yaw = 0): void { this.recoilPitch = Math.min(.22, this.recoilPitch + pitch); this.recoilYaw = Math.max(-.12, Math.min(.12, this.recoilYaw + yaw)) }
    addDamage(directionYaw = 0, magnitude = 1): void { this.damageYaw += Math.sin(directionYaw) * .035 * magnitude; this.damagePitch += Math.cos(directionYaw) * .024 * magnitude }
    addMovementImpulse(pitch: number): void { this.movementPitch = Math.max(-.16, Math.min(.16, this.movementPitch + pitch)) }
    hardReset(): void {
        this.bobPhase = 0; this.stepOffset = 0; this.crouchOffset = 0; this.landingOffset = 0
        this.damageYaw = 0; this.damagePitch = 0; this.recoilPitch = 0; this.recoilYaw = 0
        this.previousFeetY = undefined; this.previousGrounded = true; this.currentFov = this.targetFov = this.baseFov; this.currentEyeHeight = undefined; this.movementPitch = 0
    }
    update(input: CameraRigInput, dt: number): CameraRigPose {
        const safeDt = Math.max(0, Math.min(.1, dt))
        const horizontalSpeed = Math.hypot(input.velocity.x, input.velocity.z)
        this.bobPhase += safeDt * Math.min(13, 5 + horizontalSpeed * 1.35)
        if (this.previousFeetY !== undefined && input.grounded) {
            const verticalStep = input.predictedFeet.y - this.previousFeetY
            if (Math.abs(verticalStep) <= .5) this.stepOffset -= verticalStep
        }
        if (!this.previousGrounded && input.grounded) this.landingOffset = Math.max(-.11, Math.min(0, input.velocity.y * .012 - .055))
        this.previousFeetY = input.predictedFeet.y; this.previousGrounded = input.grounded
        const decay = (value: number, rate: number): number => value * Math.exp(-safeDt * rate)
        this.stepOffset = decay(this.stepOffset, 14); this.landingOffset = decay(this.landingOffset, 9)
        this.damageYaw = decay(this.damageYaw, 8); this.damagePitch = decay(this.damagePitch, 9)
        this.recoilPitch = decay(this.recoilPitch, 13); this.recoilYaw = decay(this.recoilYaw, 15)
        this.movementPitch = decay(this.movementPitch, 11)
        this.crouchOffset += ((this.crouchOffset < -.15 ? -.31 : 0) - this.crouchOffset) * (1 - Math.exp(-safeDt * 10))
        this.currentFov += (this.targetFov - this.currentFov) * (1 - Math.exp(-safeDt * 9))
        this.currentEyeHeight ??= input.eyeHeight
        this.currentEyeHeight += (input.eyeHeight - this.currentEyeHeight) * (1 - Math.exp(-safeDt * 12))
        const bobWeight = (input.grounded ? Math.min(1, horizontalSpeed / 3.4) : 0) * (1 - .82 * (input.aimProgress ?? 0))
        const bobY = Math.abs(Math.sin(this.bobPhase)) * .024 * bobWeight
        const bobX = Math.cos(this.bobPhase * .5) * .015 * bobWeight
        return {
            position: {
                x: input.predictedFeet.x + input.correctionResidual.x + Math.cos(input.simulationYaw) * bobX,
                y: input.predictedFeet.y + this.currentEyeHeight + input.correctionResidual.y + this.stepOffset + this.crouchOffset + this.landingOffset + bobY,
                z: input.predictedFeet.z + input.correctionResidual.z + Math.sin(input.simulationYaw) * bobX,
            },
            yaw: input.simulationYaw + this.damageYaw + this.recoilYaw,
            pitch: input.simulationPitch + this.damagePitch + this.recoilPitch + this.movementPitch,
            roll: input.movementTilt ?? 0,
            fov: this.currentFov,
        }
    }
}
