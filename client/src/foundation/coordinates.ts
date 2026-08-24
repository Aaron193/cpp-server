/** The only spatial conventions accepted by the 3D client boundary. */
export const WORLD_CONVENTIONS = Object.freeze({
    handedness: 'right' as const,
    upAxis: 'y' as const,
    groundPlane: 'xz' as const,
    distanceUnit: 'meter' as const,
    angleUnit: 'radian' as const,
    rotationRepresentation: 'quaternion' as const,
    unitsPerMeter: 1 as const,
})

export interface GroundPosition {
    readonly x: number
    readonly z: number
}

export interface WorldPosition extends GroundPosition {
    readonly y: number
}

export interface QuaternionRotation {
    readonly x: number
    readonly y: number
    readonly z: number
    readonly w: number
}

function requireFinite(label: string, ...values: number[]): void {
    if (!values.every(Number.isFinite)) {
        throw new TypeError(`${label} must contain only finite values`)
    }
}

export function groundToWorld(
    position: GroundPosition,
    elevationMeters = 0
): WorldPosition {
    requireFinite('Ground position', position.x, position.z, elevationMeters)
    return { x: position.x, y: elevationMeters, z: position.z }
}

export function worldToGround(position: WorldPosition): GroundPosition {
    requireFinite('World position', position.x, position.y, position.z)
    return { x: position.x, z: position.z }
}

/**
 * Boundary adapter for the old 2D protocol: its y ground coordinate becomes z.
 * Values remain meters; no pixel or arbitrary world scaling is permitted.
 */
export function legacyGroundToWorld(
    position: Readonly<{ x: number; y: number }>,
    elevationMeters = 0
): WorldPosition {
    return groundToWorld({ x: position.x, z: position.y }, elevationMeters)
}

export function yawToQuaternion(yawRadians: number): QuaternionRotation {
    requireFinite('Yaw', yawRadians)
    const halfYaw = yawRadians / 2
    return {
        x: 0,
        y: Math.sin(halfYaw),
        z: 0,
        w: Math.cos(halfYaw),
    }
}

export function normalizeQuaternion(
    rotation: QuaternionRotation
): QuaternionRotation {
    requireFinite(
        'Quaternion',
        rotation.x,
        rotation.y,
        rotation.z,
        rotation.w
    )
    const magnitude = Math.hypot(
        rotation.x,
        rotation.y,
        rotation.z,
        rotation.w
    )
    if (magnitude === 0) {
        throw new RangeError('Quaternion must have non-zero magnitude')
    }
    return {
        x: rotation.x / magnitude,
        y: rotation.y / magnitude,
        z: rotation.z / magnitude,
        w: rotation.w / magnitude,
    }
}
