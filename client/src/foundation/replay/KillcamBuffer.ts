import type { Vec3 } from '../../protocol/generated'

export interface RenderPoseSample { readonly atMs: number; readonly entityId: number; readonly position: Vec3; readonly yaw: number; readonly pitch: number }
export interface ReplayEvent { readonly atMs: number; readonly kind: 'shot' | 'impact' | 'death'; readonly sourceId: number | null; readonly targetId: number | null; readonly position: Vec3 | null }
export interface PlaybackSample { readonly atMs: number; readonly poses: readonly RenderPoseSample[]; readonly events: readonly ReplayEvent[] }
export interface KillcamCameraFrame { readonly position: Vec3; readonly target: Vec3; readonly usedCollisionFallback: boolean }

/** Fixed-capacity rendered-pose/event tape; its memory is independent of match length. */
export class KillcamBuffer {
    private readonly poses: (RenderPoseSample | undefined)[]
    private readonly events: (ReplayEvent | undefined)[]
    private poseWrite = 0; private poseCount = 0; private eventWrite = 0; private eventCount = 0
    private playbackStartMs = 0; private playbackEndMs = 0; private playbackWallStartMs = 0
    private playbackCursorMs = 0
    constructor(readonly poseCapacity = 60 * 8 * 16, readonly eventCapacity = 256) { if (poseCapacity < 1 || eventCapacity < 1) throw new RangeError('Killcam capacities must be positive'); this.poses = new Array(poseCapacity); this.events = new Array(eventCapacity) }
    recordPose(sample: RenderPoseSample): void { this.poses[this.poseWrite] = { ...sample, position: { ...sample.position } }; this.poseWrite = (this.poseWrite + 1) % this.poseCapacity; this.poseCount = Math.min(this.poseCapacity, this.poseCount + 1) }
    recordEvent(event: ReplayEvent): void { this.events[this.eventWrite] = { ...event, position: event.position ? { ...event.position } : null }; this.eventWrite = (this.eventWrite + 1) % this.eventCapacity; this.eventCount = Math.min(this.eventCapacity, this.eventCount + 1) }
    beginPlayback(deathAtMs: number, wallNowMs: number, preDeathMs = 3000, postDeathMs = 350): void { this.playbackStartMs = Math.max(0, deathAtMs - preDeathMs); this.playbackEndMs = deathAtMs + postDeathMs; this.playbackWallStartMs = wallNowMs; this.playbackCursorMs = this.playbackStartMs }
    samplePlayback(wallNowMs: number): PlaybackSample | null { if (!this.playbackWallStartMs) return null; const atMs = this.playbackCursorMs = Math.min(this.playbackEndMs, this.playbackStartMs + Math.max(0, wallNowMs - this.playbackWallStartMs)); const posesByEntity = new Map<number, RenderPoseSample>(); this.forEachPose((pose) => { if (pose.atMs <= atMs) { const previous = posesByEntity.get(pose.entityId); if (!previous || pose.atMs > previous.atMs) posesByEntity.set(pose.entityId, pose) } }); const events: ReplayEvent[] = []; this.forEachEvent((event) => { if (event.atMs >= this.playbackStartMs && event.atMs <= atMs) events.push(event) }); return { atMs, poses: [...posesByEntity.values()], events } }
    get playbackFinished(): boolean { return Boolean(this.playbackWallStartMs) && this.playbackCursorMs >= this.playbackEndMs }
    clearPlayback(): void { this.playbackStartMs = this.playbackEndMs = this.playbackWallStartMs = this.playbackCursorMs = 0 }
    clear(): void { this.poses.fill(undefined); this.events.fill(undefined); this.poseWrite = this.poseCount = this.eventWrite = this.eventCount = 0; this.clearPlayback() }
    get size(): { readonly poses: number; readonly events: number } { return { poses: this.poseCount, events: this.eventCount } }
    private forEachPose(visitor: (pose: RenderPoseSample) => void): void { const start = (this.poseWrite - this.poseCount + this.poseCapacity) % this.poseCapacity; for (let i = 0; i < this.poseCount; i++) visitor(this.poses[(start + i) % this.poseCapacity]!) }
    private forEachEvent(visitor: (event: ReplayEvent) => void): void { const start = (this.eventWrite - this.eventCount + this.eventCapacity) % this.eventCapacity; for (let i = 0; i < this.eventCount; i++) visitor(this.events[(start + i) % this.eventCapacity]!) }
}

export function frameKillcamCamera(attacker: Vec3, victim: Vec3, collides: (from: Vec3, to: Vec3) => boolean): KillcamCameraFrame {
    const dx = victim.x - attacker.x, dz = victim.z - attacker.z, length = Math.max(.001, Math.hypot(dx, dz))
    const desired = { x: attacker.x - dx / length * 2.6, y: attacker.y + 1.65, z: attacker.z - dz / length * 2.6 }
    if (!collides(attacker, desired)) return { position: desired, target: { x: victim.x, y: victim.y + 1.2, z: victim.z }, usedCollisionFallback: false }
    return { position: { x: attacker.x, y: attacker.y + 1.55, z: attacker.z }, target: { x: victim.x, y: victim.y + 1.1, z: victim.z }, usedCollisionFallback: true }
}
