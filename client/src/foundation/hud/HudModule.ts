import type { ClientModule, ClientModuleContext, FrameUpdate } from '../lifecycle'
import { isDevelopment } from '../../utils/environment'
import { ARENA, ENTITY_VIEWS, HUD, INPUT, KILLCAM, NETWORKING, PERFORMANCE, PHYSICS } from '../services'
import type { CombatEvent, ChatRow, KillFeedRow, ScoreRow } from '../combat/CombatState'
import { setTextIfChanged } from './DomDiff'
import { MatchFeelClock } from './MatchFeel'
import { MinimapPrivacyModel, projectRadar, radarAspectRatio } from './MinimapModel'

/** DOM HUD with cached references and revision-driven list updates. */
export class HudModule implements ClientModule {
    readonly name = 'hud'
    private context?: ClientModuleContext
    private readonly refs = new Map<string, HTMLElement>()
    private graph?: SVGPolylineElement
    private combatCursor = 0
    private hitMarkerUntil = 0
    private damageUntil = 0
    private scoreRevision = -1
    private feedRevision = -1
    private chatRevision = -1
    private correctionRevision = -1
    private nextDebugUpdateAt = 0
    private readonly feel = new MatchFeelClock()
    private minimap?: MinimapPrivacyModel
    private nextRadarUpdateAt = 0
    private previousAmmo = -1
    private damageDirection = 0
    private actionRejectUntil = 0

    initialize(context: ClientModuleContext): void {
        this.context = context; context.services.provide(HUD, this)
        context.hudRoot.innerHTML = `
            <div class="fps-crosshair" aria-hidden="true"><span id="fps-hitmarker">×</span></div><div id="fps-damage" class="fps-damage" aria-hidden="true"></div>
            <div id="fps-vitals" class="fps-vitals" aria-label="Player status"><div><span class="fps-label">HEALTH</span><strong id="fps-health">—</strong></div><div id="fps-ammo-panel"><span class="fps-label">AMMO</span><strong id="fps-ammo">—</strong><span id="fps-reload"></span></div></div>
            <div id="fps-scoreboard" class="fps-scoreboard hidden"><h2>SCOREBOARD</h2><div id="fps-score-rows"></div></div><div id="fps-kill-feed" class="fps-kill-feed"></div><div id="fps-round" class="fps-round hidden"></div><div id="fps-chat-log" class="fps-chat-log"></div>
            <div id="fps-radar" class="fps-radar" aria-label="North-up radar"><img id="fps-radar-map" alt=""><span class="fps-radar-north">N</span><span id="fps-radar-local" class="fps-radar-local"></span><div id="fps-radar-rumors"></div></div>
            <div id="fps-connection-quality" class="fps-connection-quality"></div><div id="fps-presentation-state" class="fps-presentation-state hidden"></div><div id="fps-action-rejection" class="fps-action-rejection hidden"></div>
            <div id="fps-debug" class="fps-debug hidden"><div id="fps-status">Loading offline arena…</div><div id="fps-motion"></div><div id="fps-network"></div><div id="fps-performance"></div><svg id="fps-correction-graph" class="fps-correction-graph" viewBox="0 0 180 32" aria-label="Prediction correction history"></svg>
            ${isDevelopment() ? `<div class="fps-net-controls"><label>Latency <input id="net-latency" type="number" min="0" max="2000" value="0"> ms</label><label>Jitter <input id="net-jitter" type="number" min="0" max="1000" value="0"> ms</label><label><input id="net-stall" type="checkbox"> Stall</label></div>` : ''}
            <div>WASD move · LMB fire · R reload · 1/2 weapons · Tab scoreboard · Enter chat · F3 network/collision</div></div><div id="fps-pointer-prompt" class="fps-pointer-prompt">Click to enter the arena</div>`
        for (const id of ['fps-hitmarker', 'fps-damage', 'fps-vitals', 'fps-health', 'fps-ammo-panel', 'fps-ammo', 'fps-reload', 'fps-scoreboard', 'fps-score-rows', 'fps-kill-feed', 'fps-round', 'fps-chat-log', 'fps-radar', 'fps-radar-map', 'fps-radar-local', 'fps-radar-rumors', 'fps-connection-quality', 'fps-presentation-state', 'fps-action-rejection', 'fps-debug', 'fps-status', 'fps-motion', 'fps-network', 'fps-performance', 'fps-pointer-prompt', 'net-latency', 'net-jitter', 'net-stall']) {
            const node = context.hudRoot.querySelector<HTMLElement>(`#${id}`); if (node) this.refs.set(id, node)
        }
        const svg = context.hudRoot.querySelector<SVGSVGElement>('#fps-correction-graph')
        if (svg) { this.graph = document.createElementNS('http://www.w3.org/2000/svg', 'polyline'); this.graph.setAttribute('fill', 'none'); this.graph.setAttribute('stroke', 'currentColor'); this.graph.setAttribute('stroke-width', '1.5'); svg.append(this.graph) }
        if (isDevelopment()) for (const id of ['net-latency', 'net-jitter', 'net-stall']) this.refs.get(id)?.addEventListener('input', this.updateImpairment)
        const manifest = context.services.get(ARENA).mapManifest
        if (manifest) {
            const projection = { minX: manifest.worldBounds.min[0], maxX: manifest.worldBounds.max[0], minZ: manifest.worldBounds.min[2], maxZ: manifest.worldBounds.max[2], northYaw: manifest.policy.radarNorthYaw }
            this.minimap = new MinimapPrivacyModel(projection)
            const radar = this.refs.get('fps-radar'); if (radar) radar.style.aspectRatio = String(radarAspectRatio(projection))
            const image = this.refs.get('fps-radar-map') as HTMLImageElement | undefined; if (image && manifest.assets.radar) image.src = `/maps/${encodeURIComponent(manifest.mapId)}/${encodeURIComponent(manifest.assets.radar)}`
        }
    }

    update(_frame: FrameUpdate): void {
        if (!this.context) return
        const networking = this.context.services.get(NETWORKING), combat = networking.combat, now = performance.now()
        const online = networking.status !== 'offline'
        if (this.combatCursor > combat.lastEventId) this.combatCursor = 0
        combat.forEachEventAfter(this.combatCursor, this.processCombatEvent)
        const local = combat.localPlayer
        setTextIfChanged(this.refs.get('fps-health'), local.health === null ? '—' : String(local.health))
        setTextIfChanged(this.refs.get('fps-ammo'), local.weapon === 0 ? '—' : `${local.magazineAmmo} / ${local.reserveAmmo}`)
        setTextIfChanged(this.refs.get('fps-reload'), local.reloading ? 'RELOADING' : '')
        if (this.previousAmmo >= 0 && local.magazineAmmo !== this.previousAmmo) this.feel.resource(now); this.previousAmmo = local.magazineAmmo
        this.refs.get('fps-hitmarker')?.classList.toggle('active', now < this.hitMarkerUntil); this.refs.get('fps-damage')?.classList.toggle('active', now < this.damageUntil)
        this.refs.get('fps-action-rejection')?.classList.toggle('hidden', now >= this.actionRejectUntil)
        this.refs.get('fps-damage')?.style.setProperty('--damage-angle', `${this.damageDirection}rad`)
        this.refs.get('fps-scoreboard')?.classList.toggle('hidden', !this.context.services.get(INPUT).showScoreboard)
        if (this.scoreRevision !== combat.scoreRevision) { this.scoreRevision = combat.scoreRevision; this.renderScores(combat.scores) }
        if (this.feedRevision !== combat.feedRevision) { this.feedRevision = combat.feedRevision; this.renderFeed(combat.killFeed) }
        if (this.chatRevision !== combat.chatRevision) { this.chatRevision = combat.chatRevision; this.renderChat(combat.chatMessages) }
        this.refs.get('fps-vitals')?.classList.toggle('hidden', !online)
        const countdown = networking.matchCountdownSeconds(combat.match.phaseEndsAtTick)
        const awaitingSnapshot = networking.status !== 'connected' || networking.latestTick === undefined
        const showRound = online && (awaitingSnapshot || combat.match.phase !== 2 || (countdown > 0 && countdown <= 5))
        const roundText = awaitingSnapshot ? this.connectionName(networking.status) : `${this.phaseName(combat.match.phase)}${countdown ? ` · ${countdown}` : ''}`
        this.refs.get('fps-round')?.classList.toggle('hidden', !showRound); setTextIfChanged(this.refs.get('fps-round'), roundText)
        const feel = this.feel.sample(now, countdown); this.refs.get('fps-round')?.style.setProperty('--countdown-scale', String(feel.countdownScale)); this.refs.get('fps-ammo-panel')?.style.setProperty('--resource-flash', String(feel.resourceFlash))
        const quality = networking.status !== 'connected' ? networking.status.toUpperCase() : networking.metrics.rttMs > 180 || networking.metrics.jitterMs > 45 ? 'POOR CONNECTION' : networking.metrics.rttMs > 90 || networking.metrics.jitterMs > 20 ? 'FAIR CONNECTION' : 'GOOD CONNECTION'
        setTextIfChanged(this.refs.get('fps-connection-quality'), quality); this.refs.get('fps-connection-quality')?.setAttribute('data-quality', quality.startsWith('GOOD') ? 'good' : quality.startsWith('FAIR') ? 'fair' : 'poor')
        const replay = this.context.services.get(KILLCAM), presentation = replay.state === 'killcam' ? `KILLCAM · #${replay.killer ?? 'WORLD'}` : replay.state === 'spectator' ? `SPECTATING · #${replay.killer ?? 'FREE CAMERA'}` : local.dead ? 'WAITING TO RESPAWN' : ''
        setTextIfChanged(this.refs.get('fps-presentation-state'), presentation); this.refs.get('fps-presentation-state')?.classList.toggle('hidden', !presentation)
        if (now >= this.nextRadarUpdateAt) { this.nextRadarUpdateAt = now + 100; this.renderRadar(now) }
        this.refs.get('fps-pointer-prompt')?.classList.toggle('hidden', this.context.services.get(INPUT).hasPointerLock)
        this.refs.get('fps-debug')?.classList.toggle('hidden', !this.context.services.get(ARENA).isDebugVisible)
        if (now >= this.nextDebugUpdateAt) { this.nextDebugUpdateAt = now + 250; this.refreshDebug() }
    }

    private readonly processCombatEvent = (event: CombatEvent): void => { const now = performance.now(); this.combatCursor = event.id; if (event.kind === 'damage' && event.localHit) { this.hitMarkerUntil = now + 140; this.feel.hit(now) } if (event.kind === 'damage' && event.localDamage) this.damageUntil = now + 320; if (event.kind === 'death' && event.value.killerId === this.context?.services.get(NETWORKING).combat.localPlayer.playerId) this.feel.kill(now); if (event.kind === 'shot' && event.value.shooterId !== this.context?.services.get(NETWORKING).combat.localPlayer.playerId) { const position = this.context?.services.get(ENTITY_VIEWS).get(event.value.shooterId)?.position; if (position) this.minimap?.observeGunfire(event.value.shooterId, position, now) } if (event.kind === 'action-result' && !event.value.accepted) { setTextIfChanged(this.refs.get('fps-action-rejection'), `${event.value.kind === 1 ? 'SHOT' : 'RELOAD'} REJECTED · ${event.value.reason}`); this.actionRejectUntil = now + 900 } if (event.kind === 'action-timeout') { setTextIfChanged(this.refs.get('fps-action-rejection'), 'ACTION TIMED OUT · PRESENTATION REPAIRED'); this.actionRejectUntil = now + 900 } }
    private renderRadar(now: number): void { if (!this.context || !this.minimap) return; const physics = this.context.services.get(PHYSICS), local = projectRadar(physics.position, this.minimap.projection), marker = this.refs.get('fps-radar-local'); if (marker) { marker.style.left = `${local.xPercent}%`; marker.style.top = `${local.yPercent}%`; marker.style.transform = `translate(-50%, -50%) rotate(${this.context.services.get(INPUT).angles.yaw - this.minimap.projection.northYaw}rad)` } const root = this.refs.get('fps-radar-rumors'); if (!root) return; root.replaceChildren(...this.minimap.visibleEnemies([], now).map((rumor) => { const node = document.createElement('span'); node.className = 'fps-radar-rumor'; node.style.left = `${rumor.xPercent}%`; node.style.top = `${rumor.yPercent}%`; node.style.opacity = String(rumor.opacity); node.setAttribute('aria-label', `Gunfire rumor from player ${rumor.entityId}`); return node })) }
    showDirectionalDamage(relativeYaw: number, amount: number): void { this.damageDirection = relativeYaw; this.damageUntil = performance.now() + Math.min(650, 260 + amount * 5) }
    private refreshDebug(): void {
        if (!this.context) return
        const physics = this.context.services.get(PHYSICS), position = physics.position, velocity = physics.velocity, networking = this.context.services.get(NETWORKING), metrics = networking.metrics
        setTextIfChanged(this.refs.get('fps-status'), `${this.context.services.get(ARENA).status} · collision ${this.context.services.get(ARENA).isDebugVisible ? 'on' : 'off'}`)
        setTextIfChanged(this.refs.get('fps-motion'), `pos ${position.x.toFixed(2)} ${position.y.toFixed(2)} ${position.z.toFixed(2)} · vel ${velocity.x.toFixed(1)} ${velocity.y.toFixed(1)} ${velocity.z.toFixed(1)} · ${physics.grounded ? 'grounded' : 'airborne'} · tick ${physics.stepCount}`)
        setTextIfChanged(this.refs.get('fps-network'), `${networking.status}${networking.detail ? ` · ${networking.detail}` : ''} · RTT ${metrics.rttMs.toFixed(0)} ms · jitter ${metrics.jitterMs.toFixed(1)} ms · clock ${(metrics.clockConfidence * 100).toFixed(0)}%/${metrics.clockAgeMs.toFixed(0)} ms · snapshot ${metrics.snapshotAgeMs.toFixed(0)} ms/${metrics.snapshotBytes} B · interpolation ${metrics.interpolationMode}/${metrics.interpolationDelayMs.toFixed(0)} ms u${metrics.interpolationUnderflows}/o${metrics.interpolationOverflows} · correction ${metrics.correctionMagnitude.toFixed(3)} m · replay ${metrics.replaySteps}/${metrics.replayTimeMs.toFixed(2)} ms · dropped ${metrics.droppedSimulationTimeMs.toFixed(1)} ms · hard ${metrics.hardSyncCount}${metrics.hardSyncReason ? `/${metrics.hardSyncReason}` : ''} · pending ${metrics.pendingInputs} · remote ${metrics.remotePlayers}`)
        const profile = this.context.services.optional(PERFORMANCE)?.snapshot
        setTextIfChanged(this.refs.get('fps-performance'), profile ? `${profile.backend}/${profile.renderTier} · DPR ${profile.devicePixelRatio.toFixed(2)}→${profile.effectiveDpr.toFixed(2)} ×${profile.resolutionScale.toFixed(2)} · ${profile.antialiasing}${profile.aaSamples > 1 ? ` ${profile.aaSamples}x` : ''}/${profile.alphaTest} · shadows ${profile.shadowsEnabled ? `${profile.shadowMapSize}/${profile.shadowCasters}` : 'off'} · FPS ${profile.fps.toFixed(0)} · frame ${profile.frameP50Ms.toFixed(1)}/${profile.frameP95Ms.toFixed(1)} ms p50/p95 · draws ${profile.drawCalls ?? 'n/a'} · active ${profile.activeMeshes}/${profile.triangles} tri · shaders ${profile.shadersReady ? 'ready' : 'compiling'} · textures ${profile.textures}/${profile.compressedTextures} compressed @${profile.anisotropy}x · PBR ${profile.pbrMaterials} · instances ${profile.mapContainerInstances + profile.decorativeInstances}/LOD ${profile.lodLevels} · Jolt p95 ${profile.predictionStepP95Ms.toFixed(2)} ms · effects ${profile.effectActive}/${profile.effectCapacity}` : '')
        if (this.graph && this.correctionRevision !== metrics.correctionRevision) {
            this.correctionRevision = metrics.correctionRevision; let peak = .05, count = 0
            networking.forEachCorrection((value) => { peak = Math.max(peak, value); count++ })
            let points = ''; networking.forEachCorrection((value, index) => { const x = count <= 1 ? 0 : index * 180 / (count - 1), y = 31 - Math.min(31, value / peak * 31); points += `${x.toFixed(1)},${y.toFixed(1)} ` })
            this.graph.setAttribute('points', points)
        }
    }
    private renderScores(rows: readonly ScoreRow[]): void { const root = this.refs.get('fps-score-rows'); if (!root) return; root.replaceChildren(...(rows.length ? rows.map((row) => this.row([`#${row.playerId}`, String(row.score), `${row.kills} K`, `${row.deaths} D`])) : [this.row(['No scores yet'])])) }
    private renderFeed(rows: readonly KillFeedRow[]): void { this.refs.get('fps-kill-feed')?.replaceChildren(...rows.map((row) => this.row([`${row.killerId === null ? 'WORLD' : `#${row.killerId}`} → #${row.victimId}`]))) }
    private renderChat(rows: readonly ChatRow[]): void { this.refs.get('fps-chat-log')?.replaceChildren(...rows.slice(-8).map((row) => { const line = this.row([]), who = document.createElement('strong'); who.textContent = row.senderId === null ? 'SYSTEM' : `#${row.senderId}`; line.append(who, ` ${row.text}`); return line })) }
    private row(values: readonly string[]): HTMLDivElement { const row = document.createElement('div'); for (const value of values) { const span = document.createElement('span'); span.textContent = value; row.append(span) } return row }
    private phaseName(phase: number): string { return phase === 1 ? 'WAITING' : phase === 2 ? 'ROUND ACTIVE' : phase === 3 ? 'INTERMISSION' : 'ROUND ENDED' }
    private connectionName(status: string): string { return status === 'rejected' ? 'CONNECTION REJECTED' : status === 'disconnected' ? 'DISCONNECTED' : status === 'reconnecting' ? 'RECONNECTING…' : 'CONNECTING…' }
    private readonly updateImpairment = (): void => { if (!this.context) return; const latency = this.refs.get('net-latency') as HTMLInputElement | undefined, jitter = this.refs.get('net-jitter') as HTMLInputElement | undefined, stall = this.refs.get('net-stall') as HTMLInputElement | undefined; this.context.services.get(NETWORKING).setSyntheticImpairment({ latencyMs: Number(latency?.value ?? 0), jitterMs: Number(jitter?.value ?? 0), stalled: stall?.checked ?? false }) }
    get root(): HTMLElement { if (!this.context) throw new Error('HUD is not initialized'); return this.context.hudRoot }
    dispose(): void { if (this.context) this.context.hudRoot.replaceChildren(); this.context?.services.remove(HUD); this.context = undefined; this.refs.clear(); this.graph = undefined; this.combatCursor = 0; this.minimap?.clear(); this.minimap = undefined; this.feel.reset() }
}
