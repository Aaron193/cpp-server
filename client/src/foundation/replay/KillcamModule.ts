import { Vector3 } from '@babylonjs/core/Maths/math.vector.js'
import type { ClientModule, ClientModuleContext, FrameUpdate } from '../lifecycle'
import { ARENA, CAMERA, ENTITY_VIEWS, KILLCAM, NETWORKING } from '../services'
import { frameKillcamCamera, KillcamBuffer } from './KillcamBuffer'

export type KillcamState = 'live' | 'killcam' | 'spectator'
export class KillcamModule implements ClientModule {
    readonly name = 'killcam'
    readonly tape = new KillcamBuffer()
    private context?: ClientModuleContext
    private cursor = 0
    private stateValue: KillcamState = 'live'
    private killedAtMs = 0
    private killerId: number | null = null
    initialize(context: ClientModuleContext): void { this.context = context; context.services.provide(KILLCAM, this) }
    update(frame: FrameUpdate): void {
        if (!this.context) return
        const now = performance.now(), networking = this.context.services.get(NETWORKING), local = networking.combat.localPlayer, camera = this.context.services.get(CAMERA)
        if (this.cursor > networking.combat.lastEventId) this.cursor = 0
        if (this.stateValue === 'live') this.tape.recordPose({ atMs: now, entityId: local.playerId ?? 0, position: camera.globalPosition, yaw: 0, pitch: 0 })
        this.context.services.get(ENTITY_VIEWS).forEachPresentationPose((entityId, position, yaw) => this.tape.recordPose({ atMs: now, entityId, position, yaw, pitch: 0 }))
        networking.combat.forEachEventAfter(this.cursor, (event) => { this.cursor = event.id; if (event.kind === 'shot') this.tape.recordEvent({ atMs: now, kind: 'shot', sourceId: event.value.shooterId, targetId: null, position: null }); else if (event.kind === 'impact') this.tape.recordEvent({ atMs: now, kind: 'impact', sourceId: null, targetId: null, position: event.value.position }); else if (event.kind === 'death') { this.tape.recordEvent({ atMs: now, kind: 'death', sourceId: event.value.killerId, targetId: event.value.victimId, position: null }); if (event.value.victimId === local.playerId) { this.stateValue = 'killcam'; this.killedAtMs = now; this.killerId = event.value.killerId; this.tape.beginPlayback(now, now) } } else if (event.kind === 'respawn' && event.value.playerId === local.playerId) { this.stateValue = 'live'; this.tape.clearPlayback(); this.killerId = null } })
        if (this.stateValue === 'killcam') {
            const sample = this.tape.samplePlayback(now), attacker = sample?.poses.find((pose) => pose.entityId === this.killerId), victim = sample?.poses.find((pose) => pose.entityId === local.playerId)
            if (attacker && victim) { const framePose = frameKillcamCamera(attacker.position, victim.position, (_from, to) => { const bounds = this.context?.services.get(ARENA).mapManifest?.worldBounds; return Boolean(bounds && (to.x < bounds.min[0] || to.x > bounds.max[0] || to.y < bounds.min[1] || to.y > bounds.max[1] || to.z < bounds.min[2] || to.z > bounds.max[2])) }); camera.position.copyFromFloats(framePose.position.x, framePose.position.y, framePose.position.z); if ('setTarget' in camera) (camera as any).setTarget(new Vector3(framePose.target.x, framePose.target.y, framePose.target.z)) }
            if (now - this.killedAtMs >= 3600) this.stateValue = 'spectator'
        }
        void frame
    }
    get state(): KillcamState { return this.stateValue }
    get killer(): number | null { return this.killerId }
    dispose(): void { this.tape.clear(); this.context?.services.remove(KILLCAM); this.context = undefined }
}
