import { Weapon } from '../../protocol/generated'

export const TRACER_LENGTH_METERS = 2.4
export const TRACER_FADE_MS = 55

const RIFLE_VISUAL_SPEED_METERS_PER_SECOND = 320
const SHOTGUN_VISUAL_SPEED_METERS_PER_SECOND = 180
const MINIMUM_TRAVEL_MS = 70
const MAXIMUM_TRAVEL_MS = 320

export interface TracerMotionSample {
    readonly headDistance: number
    readonly centerDistance: number
    readonly streakLength: number
    readonly opacity: number
    readonly complete: boolean
}

/**
 * Gameplay remains hitscan. This duration deliberately slows only the cosmetic
 * streak enough to read over several rendered frames, as modern shooters do.
 */
export function tracerTravelDurationMs(distanceMeters: number, weapon: Weapon): number {
    const speed = weapon === Weapon.Shotgun
        ? SHOTGUN_VISUAL_SPEED_METERS_PER_SECOND
        : RIFLE_VISUAL_SPEED_METERS_PER_SECOND
    return Math.max(MINIMUM_TRAVEL_MS, Math.min(MAXIMUM_TRAVEL_MS, distanceMeters / speed * 1000))
}

export function sampleTracerMotion(distanceMeters: number, elapsedMs: number, travelMs: number): TracerMotionSample {
    const distance = Math.max(0, distanceMeters)
    const elapsed = Math.max(0, elapsedMs)
    const travel = Math.max(1, travelMs)
    const headDistance = distance * Math.min(1, elapsed / travel)
    const streakLength = Math.min(TRACER_LENGTH_METERS, headDistance, distance)
    const tailDistance = Math.max(0, headDistance - streakLength)
    const fadeProgress = elapsed <= travel ? 0 : Math.min(1, (elapsed - travel) / TRACER_FADE_MS)
    const launchOpacity = Math.min(1, .25 + elapsed / 16)
    return {
        headDistance,
        centerDistance: (headDistance + tailDistance) * .5,
        streakLength,
        opacity: launchOpacity * (1 - fadeProgress),
        complete: elapsed >= travel + TRACER_FADE_MS,
    }
}
