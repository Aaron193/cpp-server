import { describe, expect, it } from 'vitest'
import { CameraAngles } from '../src/foundation/camera/CameraAngles'

describe('first-person camera angles', () => {
    it('applies sensitivity, wraps yaw, and clamps pitch', () => {
        const angles = new CameraAngles({ sensitivity: 0.01, minPitch: -1, maxPitch: 1 })
        angles.applyMouseDelta(1000, -1000)
        expect(angles.yaw).toBeGreaterThanOrEqual(-Math.PI)
        expect(angles.yaw).toBeLessThanOrEqual(Math.PI)
        expect(angles.pitch).toBe(1)
        angles.applyMouseDelta(0, 1000)
        expect(angles.pitch).toBe(-1)
    })
})
