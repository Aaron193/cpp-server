import { Weapon } from '../../protocol/generated'

export const TRACER_LENGTH_METERS = 3.6
export const TRACER_FADE_MS = 85

const RIFLE_VISUAL_SPEED_METERS_PER_SECOND = 1000
const SHOTGUN_VISUAL_SPEED_METERS_PER_SECOND = 450
const MINIMUM_TRAVEL_MS = 24
const MAXIMUM_TRAVEL_MS = 120

export interface TracerMotionSample {
    readonly headDistance: number
    readonly tailDistance: number
    readonly centerDistance: number
    readonly streakLength: number
    readonly opacity: number
    readonly coreOpacity: number
    readonly bloomOpacity: number
    readonly headOpacity: number
    readonly complete: boolean
}

/**
 * Gameplay remains hitscan. This duration deliberately slows only the cosmetic
 * streak enough to read over several rendered frames, as modern shooters do.
 */
export function tracerTravelDurationMs(
    distanceMeters: number,
    weapon: Weapon
): number {
    const speed =
        weapon === Weapon.Shotgun
            ? SHOTGUN_VISUAL_SPEED_METERS_PER_SECOND
            : RIFLE_VISUAL_SPEED_METERS_PER_SECOND
    return Math.max(
        MINIMUM_TRAVEL_MS,
        Math.min(MAXIMUM_TRAVEL_MS, (distanceMeters / speed) * 1000)
    )
}

export function sampleTracerMotion(
    distanceMeters: number,
    elapsedMs: number,
    travelMs: number
): TracerMotionSample {
    const distance = Math.max(0, distanceMeters)
    const elapsed = Math.max(0, elapsedMs)
    const travel = Math.max(1, travelMs)
    const headDistance = distance * Math.min(1, elapsed / travel)
    // A short bright core with a longer, softer envelope reads as a luminous
    // projectile instead of a laser line. Ramp the streak in over one frame.
    const grownLength = TRACER_LENGTH_METERS * Math.min(1, elapsed / 12)
    const streakLength = Math.min(grownLength, headDistance, distance)
    const tailDistance = Math.max(0, headDistance - streakLength)
    const fadeProgress =
        elapsed <= travel ? 0 : Math.min(1, (elapsed - travel) / TRACER_FADE_MS)
    const launchOpacity = Math.min(1, 0.15 + elapsed / 10)
    const opacity = launchOpacity * (1 - fadeProgress)
    return {
        headDistance,
        tailDistance,
        centerDistance: (headDistance + tailDistance) * 0.5,
        streakLength,
        opacity,
        coreOpacity: Math.min(1, opacity * 1.3),
        bloomOpacity: opacity * 0.34,
        headOpacity: opacity * 0.82,
        complete: elapsed >= travel + TRACER_FADE_MS,
    }
}
