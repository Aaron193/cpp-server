import { describe, expect, it } from 'vitest'
import { serverPitchToBabylonVisualPitch, serverYawToBabylonVisualYaw } from '../src/foundation/entities/EntityViewsModule'

describe('remote player presentation', () => {
    it('converts authoritative right-handed yaw to Babylon visual yaw', () => {
        expect(serverYawToBabylonVisualYaw(0)).toBeCloseTo(0)
        expect(serverYawToBabylonVisualYaw(Math.PI / 2)).toBeCloseTo(-Math.PI / 2)
        expect(serverYawToBabylonVisualYaw(-Math.PI / 2)).toBeCloseTo(Math.PI / 2)
    })

    it('preserves positive-up authoritative pitch for the right-handed actor rig', () => {
        expect(serverPitchToBabylonVisualPitch(Math.PI / 4)).toBeCloseTo(Math.PI / 4)
        expect(serverPitchToBabylonVisualPitch(-Math.PI / 4)).toBeCloseTo(-Math.PI / 4)
    })
})
