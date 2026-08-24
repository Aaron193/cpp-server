export interface CameraAngleOptions {
    readonly sensitivity: number
    readonly minPitch: number
    readonly maxPitch: number
}

export const DEFAULT_CAMERA_ANGLES: CameraAngleOptions = Object.freeze({
    sensitivity: 0.002,
    minPitch: -Math.PI / 2 + 0.01,
    maxPitch: Math.PI / 2 - 0.01,
})

export function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value))
}

export function wrapAngle(angle: number): number {
    return Math.atan2(Math.sin(angle), Math.cos(angle))
}

export class CameraAngles {
    yaw = 0
    pitch = 0

    constructor(private readonly options: CameraAngleOptions = DEFAULT_CAMERA_ANGLES) {
        if (!(options.sensitivity > 0) || options.minPitch >= options.maxPitch) throw new TypeError('Invalid camera angle configuration')
    }

    set(yaw: number, pitch: number): void {
        if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) throw new TypeError('Camera angles must be finite')
        this.yaw = wrapAngle(yaw)
        this.pitch = clamp(pitch, this.options.minPitch, this.options.maxPitch)
    }

    applyMouseDelta(movementX: number, movementY: number): void {
        if (!Number.isFinite(movementX) || !Number.isFinite(movementY)) return
        this.set(
            this.yaw + movementX * this.options.sensitivity,
            this.pitch - movementY * this.options.sensitivity
        )
    }
}
