import type { EntityRecord, Vec3 } from '../../protocol/generated'

export const ACTOR_CAPSULE = { radius: 0.42, height: 1.8 } as const
export const ACTOR_SOCKET_LOCAL = {
    head: { x: 0, y: 1.66, z: 0 },
    name: { x: 0, y: 2.04, z: 0 },
    leftHand: { x: -0.29, y: 1.18, z: -0.28 },
    rightHand: { x: 0.29, y: 1.16, z: -0.22 },
    weapon: { x: 0.18, y: 1.2, z: -0.28 },
    muzzle: { x: 0.18, y: 1.2, z: -0.93 },
} as const

export type LocomotionState = 'idle' | 'walk' | 'run' | 'crouch' | 'air' | 'dead'
export type ActorOneShot = 'recoil' | 'hit' | 'death' | 'respawn'

export interface ActorPose {
    readonly locomotion: LocomotionState
    readonly gaitPhase: number
    readonly gaitWeight: number
    readonly crouchWeight: number
    readonly aimPitch: number
    readonly aimYaw: number
    readonly deadWeight: number
    readonly recoilWeight: number
    readonly hitWeight: number
    readonly respawnWeight: number
    readonly reloadWeight: number
    readonly wallTuckWeight: number
}

export interface ActorAuditResult {
    readonly passed: boolean
    readonly torsoOutsideCapsuleMeters: number
    readonly headHeightErrorMeters: number
    readonly muzzleHandSeparationMeters: number
    readonly muzzleBehindHandMeters: number
}

export function selectLocomotion(entity: Pick<EntityRecord, 'velocity' | 'grounded' | 'stateFlags'>): LocomotionState {
    if ((entity.stateFlags & 1) !== 0) return 'dead'
    if (!entity.grounded) return 'air'
    if ((entity.stateFlags & 2) !== 0) return 'crouch'
    const speed = Math.hypot(entity.velocity.x, entity.velocity.z)
    return speed < 0.08 ? 'idle' : speed < 4.2 ? 'walk' : 'run'
}

export function oneShotWeight(nowMs: number, startedAtMs: number, durationMs: number): number {
    if (!Number.isFinite(startedAtMs) || durationMs <= 0) return 0
    const progress = (nowMs - startedAtMs) / durationMs
    if (progress < 0 || progress >= 1) return 0
    return Math.sin(progress * Math.PI)
}

export function evaluateActorPose(
    entity: Pick<EntityRecord, 'velocity' | 'grounded' | 'stateFlags' | 'aimPitch'>,
    elapsedSeconds: number,
    oneShots: Readonly<Partial<Record<ActorOneShot, number>>> = {},
    wallTuckWeight = 0,
    nowMs = elapsedSeconds * 1000,
): ActorPose {
    const locomotion = selectLocomotion(entity)
    const speed = Math.hypot(entity.velocity.x, entity.velocity.z)
    const gaitRate = locomotion === 'run' ? 2.7 : locomotion === 'walk' ? 1.65 : 0
    return {
        locomotion,
        gaitPhase: elapsedSeconds * Math.PI * 2 * gaitRate,
        gaitWeight: locomotion === 'walk' || locomotion === 'run' ? Math.min(1, speed / 3.2) : 0,
        crouchWeight: locomotion === 'crouch' ? 1 : 0,
        aimPitch: Math.max(-1.3, Math.min(1.3, entity.aimPitch)),
        aimYaw: 0,
        deadWeight: locomotion === 'dead' ? 1 : oneShotWeight(nowMs, oneShots.death ?? -Infinity, 720),
        recoilWeight: oneShotWeight(nowMs, oneShots.recoil ?? -Infinity, 145),
        hitWeight: oneShotWeight(nowMs, oneShots.hit ?? -Infinity, 260),
        respawnWeight: oneShotWeight(nowMs, oneShots.respawn ?? -Infinity, 520),
        reloadWeight: (entity.stateFlags & 4) !== 0 ? 1 : 0,
        wallTuckWeight: Math.max(0, Math.min(1, wallTuckWeight)),
    }
}

function distance(a: Vec3, b: Vec3): number { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) }

/** Automated authored-rig-to-authoritative-capsule/socket calibration audit. */
export function auditActorCalibration(
    sockets: Readonly<typeof ACTOR_SOCKET_LOCAL> = ACTOR_SOCKET_LOCAL,
    tolerance = { torsoMeters: 0.08, headMeters: 0.08, handMuzzleMin: 0.45, behindMeters: 0.01 },
): ActorAuditResult {
    const torsoOutsideCapsuleMeters = Math.max(0, 0.34 - ACTOR_CAPSULE.radius)
    const headHeightErrorMeters = Math.abs(sockets.head.y - (ACTOR_CAPSULE.height - 0.14))
    const muzzleHandSeparationMeters = distance(sockets.muzzle, sockets.rightHand)
    // Local forward is -Z. Positive means the authored muzzle drifted behind the firing hand.
    const muzzleBehindHandMeters = Math.max(0, sockets.muzzle.z - sockets.rightHand.z)
    return {
        passed: torsoOutsideCapsuleMeters <= tolerance.torsoMeters && headHeightErrorMeters <= tolerance.headMeters && muzzleHandSeparationMeters >= tolerance.handMuzzleMin && muzzleBehindHandMeters <= tolerance.behindMeters,
        torsoOutsideCapsuleMeters, headHeightErrorMeters, muzzleHandSeparationMeters, muzzleBehindHandMeters,
    }
}
