import type { Vec3 } from '../../protocol/generated'

export interface RadarProjection { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number; readonly northYaw: number }
export interface RadarPoint { readonly xPercent: number; readonly yPercent: number }
export interface RadarRumor extends RadarPoint { readonly entityId: number; readonly opacity: number }
interface Rumor { readonly entityId: number; readonly position: Vec3; readonly atMs: number }
export function projectRadar(position: Pick<Vec3, 'x' | 'z'>, projection: RadarProjection): RadarPoint { const width = projection.maxX - projection.minX, height = projection.maxZ - projection.minZ; if (!(width > 0 && height > 0)) throw new RangeError('Radar projection bounds are invalid'); return { xPercent: (position.x - projection.minX) / width * 100, yPercent: (position.z - projection.minZ) / height * 100 } }
export function radarAspectRatio(projection: RadarProjection): number { return (projection.maxX - projection.minX) / (projection.maxZ - projection.minZ) }

/** FFA privacy: only local pose and fading last-gunfire rumors are exposed. */
export class MinimapPrivacyModel {
    private readonly rumors = new Map<number, Rumor>()
    constructor(readonly projection: RadarProjection, readonly rumorLifetimeMs = 2400, readonly maxRumors = 16) {}
    observeGunfire(entityId: number, position: Vec3, nowMs: number): void { if (this.rumors.size >= this.maxRumors && !this.rumors.has(entityId)) this.rumors.delete(this.rumors.keys().next().value!); this.rumors.set(entityId, { entityId, position: { ...position }, atMs: nowMs }) }
    visibleEnemies(_liveEnemyPoses: readonly unknown[], nowMs: number): readonly RadarRumor[] { const result: RadarRumor[] = []; for (const [id, rumor] of this.rumors) { const age = nowMs - rumor.atMs; if (age >= this.rumorLifetimeMs) { this.rumors.delete(id); continue } const point = projectRadar(rumor.position, this.projection); result.push({ entityId: id, ...point, opacity: Math.max(0, 1 - age / this.rumorLifetimeMs) }) } return result }
    clear(): void { this.rumors.clear() }
}
