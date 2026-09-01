import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Stance, Weapon } from '../src/protocol/generated'
import { DEFAULT_AIM_PROFILES, acceptedShot, createAimState, profileFor, stepAimState } from '../src/foundation/aiming/AimModel'
import { reticleAimOpacity, spreadRadiusPixels } from '../src/foundation/hud/HudModule'

interface TraceStep { dt: number; intent: boolean; eligible: boolean; speedRatio: number; grounded: boolean; stance: Stance; shot: boolean }
interface Expected { aimProgress: number; bloomRadians: number; spreadRadians: number; recoilPitch: number; recoilYaw: number; recoilSequence: number; patternIndex: number }

describe('server-equivalent aiming model', () => {
    it('matches the shared C++/TypeScript trace fixture within 1e-5', () => {
        const fixture = JSON.parse(readFileSync(new URL('../../fixtures/aiming/trace.json', import.meta.url), 'utf8')) as { player: number; steps: TraceStep[]; expected: Expected[] }
        const state = createAimState(Weapon.Rifle), profile = profileFor(DEFAULT_AIM_PROFILES, Weapon.Rifle)
        fixture.steps.forEach((step, index) => {
            stepAimState(state, profile, step.intent, step.eligible, step.speedRatio, step.grounded, step.stance, step.dt)
            if (step.shot) acceptedShot(state, profile, DEFAULT_AIM_PROFILES.serverSeed, fixture.player)
            const expected = fixture.expected[index]!
            for (const key of ['aimProgress', 'bloomRadians', 'spreadRadians', 'recoilPitch', 'recoilYaw'] as const) expect(state[key]).toBeCloseTo(expected[key], 5)
            expect(state.recoilSequence).toBe(expected.recoilSequence); expect(state.patternIndex).toBe(expected.patternIndex)
        })
    })

    it('applies partial ADS, movement, air, stance, bloom recovery, and pattern reset', () => {
        const state = createAimState(), profile = profileFor(DEFAULT_AIM_PROFILES, Weapon.Rifle)
        stepAimState(state, profile, true, true, 0, true, Stance.Standing, profile.aimInSeconds / 2)
        expect(state.aimProgress).toBeCloseTo(.5); expect(state.spreadRadians).toBeGreaterThan(profile.adsSpreadRadians)
        const standing = state.spreadRadians
        stepAimState(state, profile, true, true, 1, false, Stance.Standing, 0)
        expect(state.spreadRadians).toBeGreaterThan(standing)
        acceptedShot(state, profile, DEFAULT_AIM_PROFILES.serverSeed, 1)
        expect(state.bloomRadians).toBe(profile.bloomPerShotRadians)
        for (let elapsed = 0; elapsed < profile.recoilResetSeconds; elapsed += .1) stepAimState(state, profile, true, true, 0, true, Stance.Crouched, .1)
        expect(state.patternIndex).toBe(0); expect(state.bloomRadians).toBe(0)
    })
})

describe('dispersion-derived reticle', () => {
    it.each([720, 1080, 1440, 2160])('matches the cone projection at %ip', (height) => {
        const spread = .012, fov = Math.PI / 3
        const expected = Math.tan(spread) / Math.tan(fov / 2) * height / 2
        expect(spreadRadiusPixels(spread, fov, height)).toBeCloseTo(expected, 10)
    })

    it('remains visible at full ADS while the fallback viewmodel has no authored optic', () => {
        expect(reticleAimOpacity(0)).toBe(1)
        expect(reticleAimOpacity(.55)).toBe(1)
        expect(reticleAimOpacity(1)).toBe(.65)
    })
})
