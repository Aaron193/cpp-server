import { Weapon } from '../../protocol/generated'

export const TRACER_LENGTH_METERS = 3.6
// Maximum shutter interval, not time spent parked at the end of a flight.
export const TRACER_FADE_MS = 32

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

/** Fallback for legacy hitscan servers; ballistic weapons use their configured velocity. */
export function tracerTravelDurationMs(
    distanceMeters: number,
    weapon: Weapon
): number {
    return Math.max(
        1,
        (distanceMeters / (weapon === Weapon.Shotgun ? 380 : 620)) * 1000
    )
}

/** A moving exposure interval. At collision the head clips and the tail catches up;
 * neither the projectile nor its glow sits suspended in space after arrival. */
export function sampleTracerMotion(
    distanceMeters: number,
    elapsedMs: number,
    travelMs: number,
    frameMs = 1000 / 60
): TracerMotionSample {
    const distance = Math.max(0, distanceMeters)
    const travel = Math.max(0.001, travelMs)
    const speed = distance / travel
    const elapsed = Math.max(0, elapsedMs)
    const length = Math.max(
        TRACER_LENGTH_METERS,
        Math.min(
            12,
            speed * Math.min(TRACER_FADE_MS, Math.max(8, frameMs)) * 0.7
        )
    )
    const headDistance = Math.min(distance, elapsed * speed)
    const tailDistance = Math.min(
        distance,
        Math.max(0, elapsed * speed - length)
    )
    const streakLength = Math.max(0, headDistance - tailDistance)
    const complete =
        distance === 0 || elapsed >= travel + length / Math.max(speed, 0.001)
    const opacity = complete
        ? 0
        : Math.min(
              1,
              streakLength / Math.min(length, Math.max(0.001, distance))
          )
    return {
        headDistance,
        tailDistance,
        centerDistance: (headDistance + tailDistance) * 0.5,
        streakLength,
        opacity,
        coreOpacity: opacity,
        bloomOpacity: opacity * 0.28,
        headOpacity: elapsed < travel ? opacity : 0,
        complete,
    }
}

/** Wrapped tick subtraction prevents a uint32 rollover from aging a fresh shot by years. */
export function shotAgeMs(
    serverTick: number,
    currentTick: number | undefined,
    tickRate: number
): number {
    if (currentTick === undefined) return 0
    return Math.max(
        0,
        (((currentTick - serverTick) | 0) * 1000) / Math.max(1, tickRate)
    )
}

/** Solve projected ballistic displacement for flight time, including an impact in the
 * launch tick. Tick differences alone round those close impacts down to zero. */
export function impactTravelDurationMs(
    projectedMeters: number,
    speedMetersPerSecond: number,
    gravity: number,
    directionY: number
): number {
    const distance = Math.max(0, projectedMeters),
        speed = Math.max(0.001, speedMetersPerSecond)
    const discriminant = Math.max(
        0,
        speed * speed - 2 * gravity * directionY * distance
    )
    return (2000 * distance) / (speed + Math.sqrt(discriminant))
}

/** Keep the bright texture core about one physical render pixel wide, including
 * reduced-resolution tiers. World-space width alone vanishes against a bright sky. */
export function tracerRibbonWidth(
    distance: number,
    verticalFov: number,
    renderHeight: number
): number {
    return Math.max(
        0.04,
        (2 * Math.max(0, distance) * Math.tan(verticalFov / 2) * 6) /
            Math.max(1, renderHeight)
    )
}

/** A late event still needs visible travel. This is cosmetic presentation delay;
 * authoritative impacts continue to clip the flight at their actual position. */
export function tracerInitialAgeMs(ageMs: number, travelMs: number): number {
    return Math.min(Math.max(0, ageMs), 20, Math.max(0, travelMs) * 0.15)
}
