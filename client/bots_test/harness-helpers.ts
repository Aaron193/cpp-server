export interface HarnessPose {
    readonly entityId: number
    readonly x: number
    readonly y: number
    readonly z: number
    readonly dead: boolean
}

export interface AimSolution {
    readonly yaw: number
    readonly pitch: number
    readonly distance: number
    readonly moveX: number
    readonly moveY: number
}

/** First input is withheld until this authoritative alignment is available. */
export function alignHarnessTick(serverTick: number): number { return serverTick >>> 0 }
export function nextHarnessTick(tick: number): number { return (tick + 1) >>> 0 }
export function shouldRequireActivity(activeSnapshotCount: number): boolean { return activeSnapshotCount > 0 }
export function shouldRequireIndividualMovement(activeSnapshotCount: number, strictRoundMode: boolean): boolean {
    return activeSnapshotCount > 0 && !strictRoundMode
}
export function isHarnessTickNewer(candidate: number, reference: number): boolean {
    const distance = (candidate - reference) >>> 0
    return distance !== 0 && distance < 0x80000000
}

export function chooseAliveTarget(poses: ReadonlyMap<number, HarnessPose>, own: HarnessPose): HarnessPose | undefined {
    let selected: HarnessPose | undefined, selectedDistance = Infinity
    for (const pose of poses.values()) {
        if (pose.entityId === own.entityId || pose.dead) continue
        const distance = Math.hypot(pose.x - own.x, pose.y - own.y, pose.z - own.z)
        if (distance < selectedDistance) { selected = pose; selectedDistance = distance }
    }
    return selected
}

export function aimAtCapsule(own: HarnessPose, target: HarnessPose): AimSolution {
    const dx = target.x - own.x, dz = target.z - own.z
    const horizontal = Math.hypot(dx, dz)
    const dy = (target.y + .9) - (own.y + 1.62)
    const yaw = Math.atan2(dx, -dz)
    const pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, Math.atan2(dy, horizontal)))
    const distance = Math.hypot(horizontal, dy)
    return { yaw, pitch, distance, moveX: 0, moveY: distance > 4 ? -1 : 0 }
}
