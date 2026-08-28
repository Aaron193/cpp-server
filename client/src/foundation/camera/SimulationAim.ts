import type { Vec3 } from '../../protocol/generated'

export interface AimAngles { readonly yaw: number; readonly pitch: number }
export interface AimRay { readonly origin: Vec3; readonly direction: Vec3 }

/** The only aim used for commands/shot rays. Camera feel can never write here. */
export class SimulationAim {
    private yawValue = 0
    private pitchValue = 0
    set(yaw: number, pitch: number): void {
        if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) throw new TypeError('Simulation aim must be finite')
        this.yawValue = yaw; this.pitchValue = pitch
    }
    get angles(): AimAngles { return { yaw: this.yawValue, pitch: this.pitchValue } }
    direction(): Vec3 {
        const cosine = Math.cos(this.pitchValue)
        return { x: Math.sin(this.yawValue) * cosine, y: Math.sin(this.pitchValue), z: -Math.cos(this.yawValue) * cosine }
    }
    ray(origin: Vec3): AimRay { return { origin: { ...origin }, direction: this.direction() } }
}
