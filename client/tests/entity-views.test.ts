import { describe, expect, it } from 'vitest'
import { serverYawToBabylonVisualYaw } from '../src/foundation/entities/EntityViewsModule'

describe('remote player presentation', () => {
    it('converts authoritative right-handed yaw to Babylon visual yaw', () => {
        expect(serverYawToBabylonVisualYaw(0)).toBeCloseTo(0)
        expect(serverYawToBabylonVisualYaw(Math.PI / 2)).toBeCloseTo(-Math.PI / 2)
        expect(serverYawToBabylonVisualYaw(-Math.PI / 2)).toBeCloseTo(Math.PI / 2)
    })
})
