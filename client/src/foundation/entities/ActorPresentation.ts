import { MovementMode, Stance, type EntityRecord, type Vec3 } from '../../protocol/generated'

export const ACTOR_CAPSULE = { radius: 0.42, height: 1.8 } as const
export const ACTOR_SOCKET_LOCAL = {
    head: { x: 0, y: 1.66, z: 0 },
    name: { x: 0, y: 2.04, z: 0 },
    leftHand: { x: -0.29, y: 1.18, z: -0.28 },
    rightHand: { x: 0.29, y: 1.16, z: -0.22 },
    weapon: { x: 0.18, y: 1.2, z: -0.28 },
    muzzle: { x: 0.18, y: 1.2, z: -0.93 },
} as const

export type LocomotionState = 'idle' | 'walk' | 'sprint' | 'crouch-idle' | 'crouch-walk' | 'slide' | 'prone-idle' | 'prone-crawl' | 'dash' | 'mantle' | 'air' | 'dead'
export type ActorOneShot = 'recoil' | 'hit' | 'death' | 'respawn'

export interface ActorPose {
    readonly locomotion: LocomotionState
    readonly gaitPhase: number
    readonly gaitWeight: number
    readonly crouchWeight: number
    readonly proneWeight: number
    readonly slideWeight: number
    readonly dashWeight: number
    readonly mantleWeight: number
    readonly aimPitch: number
    readonly aimYaw: number
    readonly deadWeight: number
    readonly recoilWeight: number
    readonly hitWeight: number
    readonly respawnWeight: number
    readonly reloadWeight: number
    readonly adsWeight: number
    readonly wallTuckWeight: number
}

export interface ActorAuditResult {
    readonly passed: boolean
    readonly torsoOutsideCapsuleMeters: number
    readonly headHeightErrorMeters: number
    readonly muzzleHandSeparationMeters: number
    readonly muzzleBehindHandMeters: number
}

export function selectLocomotion(entity: Pick<EntityRecord, 'velocity' | 'grounded' | 'stateFlags' | 'stance' | 'movementMode'>): LocomotionState {
    if ((entity.stateFlags & 1) !== 0) return 'dead'
    if (entity.movementMode === MovementMode.Mantling) return 'mantle'
    if (entity.movementMode === MovementMode.Dashing) return 'dash'
    if (entity.movementMode === MovementMode.Sliding) return 'slide'
    if (!entity.grounded) return 'air'
    const speed = Math.hypot(entity.velocity.x, entity.velocity.z)
    if (entity.stance === Stance.Prone) return speed < .08 ? 'prone-idle' : 'prone-crawl'
    if (entity.stance === Stance.Crouched) return speed < .08 ? 'crouch-idle' : 'crouch-walk'
    if (entity.movementMode === MovementMode.Sprinting) return 'sprint'
    return speed < 0.08 ? 'idle' : 'walk'
}

export function oneShotWeight(nowMs: number, startedAtMs: number, durationMs: number): number {
    if (!Number.isFinite(startedAtMs) || durationMs <= 0) return 0
    const progress = (nowMs - startedAtMs) / durationMs
    if (progress < 0 || progress >= 1) return 0
    return Math.sin(progress * Math.PI)
}

export function evaluateActorPose(
    entity: Pick<EntityRecord, 'velocity' | 'grounded' | 'stateFlags' | 'aimPitch' | 'stance' | 'movementMode'>,
    elapsedSeconds: number,
    oneShots: Readonly<Partial<Record<ActorOneShot, number>>> = {},
    wallTuckWeight = 0,
    nowMs = elapsedSeconds * 1000,
): ActorPose {
    const locomotion = selectLocomotion(entity)
    const speed = Math.hypot(entity.velocity.x, entity.velocity.z)
    const gaitRate = locomotion === 'sprint' ? 2.7 : locomotion === 'walk' || locomotion === 'crouch-walk' ? 1.65 : locomotion === 'prone-crawl' ? .9 : 0
    return {
        locomotion,
        gaitPhase: elapsedSeconds * Math.PI * 2 * gaitRate,
        gaitWeight: gaitRate > 0 ? Math.min(1, speed / 3.2) : 0,
        crouchWeight: entity.stance === Stance.Crouched ? 1 : 0,
        proneWeight: entity.stance === Stance.Prone ? 1 : 0,
        slideWeight: locomotion === 'slide' ? 1 : 0,
        dashWeight: locomotion === 'dash' ? 1 : 0,
        mantleWeight: locomotion === 'mantle' ? 1 : 0,
        aimPitch: Math.max(-1.3, Math.min(1.3, entity.aimPitch)),
        aimYaw: 0,
        deadWeight: locomotion === 'dead' ? 1 : oneShotWeight(nowMs, oneShots.death ?? -Infinity, 720),
        recoilWeight: oneShotWeight(nowMs, oneShots.recoil ?? -Infinity, 145),
        hitWeight: oneShotWeight(nowMs, oneShots.hit ?? -Infinity, 260),
        respawnWeight: oneShotWeight(nowMs, oneShots.respawn ?? -Infinity, 520),
        reloadWeight: (entity.stateFlags & 4) !== 0 ? 1 : 0,
        adsWeight: (entity.stateFlags & 2) !== 0 ? 1 : 0,
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
