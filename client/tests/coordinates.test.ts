import { describe, expect, it } from 'vitest'
import {
    groundToWorld,
    legacyGroundToWorld,
    normalizeQuaternion,
    WORLD_CONVENTIONS,
    worldToGround,
    yawToQuaternion,
} from '../src/foundation/coordinates'

describe('3D world conventions', () => {
    it('uses a right-handed Y-up meter/radian/quaternion world', () => {
        expect(WORLD_CONVENTIONS).toEqual({
            handedness: 'right',
            upAxis: 'y',
            groundPlane: 'xz',
            distanceUnit: 'meter',
            angleUnit: 'radian',
            rotationRepresentation: 'quaternion',
            unitsPerMeter: 1,
        })
    })

    it('maps ground positions to X/Z without scaling', () => {
        expect(groundToWorld({ x: 12.5, z: -4 }, 2)).toEqual({
            x: 12.5,
            y: 2,
            z: -4,
        })
        expect(worldToGround({ x: 12.5, y: 99, z: -4 })).toEqual({
            x: 12.5,
            z: -4,
        })
        expect(legacyGroundToWorld({ x: 3, y: 7 })).toEqual({
            x: 3,
            y: 0,
            z: 7,
        })
    })

    it('represents yaw as a normalized Y-axis quaternion', () => {
        const rotation = yawToQuaternion(Math.PI)
        expect(rotation.x).toBe(0)
        expect(rotation.y).toBeCloseTo(1)
        expect(rotation.z).toBe(0)
        expect(rotation.w).toBeCloseTo(0)
        expect(Math.hypot(rotation.x, rotation.y, rotation.z, rotation.w)).toBeCloseTo(1)
        expect(normalizeQuaternion({ x: 0, y: 2, z: 0, w: 0 })).toEqual({
            x: 0,
            y: 1,
            z: 0,
            w: 0,
        })
    })

    it('rejects non-finite coordinates and invalid quaternions', () => {
        expect(() => groundToWorld({ x: Number.NaN, z: 0 })).toThrow(TypeError)
        expect(() => normalizeQuaternion({ x: 0, y: 0, z: 0, w: 0 })).toThrow(
            RangeError
        )
    })
})
