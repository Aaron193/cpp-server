import WebSocket from 'ws'
import { validateConfiguration } from '../src/foundation/networking/Handshake.ts'
import { MatchPhase, MessageType, PROTOCOL_VERSION, RoundTransitionKind, Weapon, decodeEnvelope, encodeMessage } from '../src/protocol/generated.ts'
import { aimAtCapsule, alignHarnessTick, chooseAliveTarget, nextHarnessTick, shouldRequireActivity, shouldRequireIndividualMovement } from './harness-helpers.ts'

const websocketUrl = process.env.BOT_WEBSOCKET_URL || 'ws://localhost:9001'
const buildId = process.env.BOT_BUILD_ID || 'dev'
const durationMs = Math.max(2000, Number(process.env.HARNESS_DURATION_MS || 6000))
const handshakeTimeoutMs = Math.max(1000, Number(process.env.HARNESS_HANDSHAKE_TIMEOUT_MS || 10000))
const enabled = (name) => /^(1|true|yes)$/i.test(process.env[name] || '')
const requireCombat = enabled('HARNESS_REQUIRE_COMBAT')
const requireRound = enabled('HARNESS_REQUIRE_ROUND')
const connectedActors = new Set()

function connectActor(label, ordinal) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(websocketUrl)
        const actor = {
            label, ordinal, ws, playerId: 0, sequence: 0, tick: 0,
            configured: false, aligned: false, settled: false, poses: new Map(), seen: new Set(),
            firstPosition: undefined, lastPosition: undefined, interval: undefined, handshakeTimer: undefined,
            activeSnapshots: 0,
            shots: 0, impacts: 0, damage: 0, deaths: 0, respawns: 0,
            rounds: { started: 0, intermission: 0, reset: 0 },
        }
        connectedActors.add(actor)
        let welcome
        actor.handshakeTimer = setTimeout(() => reject(new Error(`${label} handshake/snapshot timed out`)), handshakeTimeoutMs)
        const ready = () => {
            if (!actor.configured || !actor.aligned) return
            if (!actor.interval) actor.interval = setInterval(() => sendInput(actor), 1000 / 60)
            if (!actor.settled) { actor.settled = true; clearTimeout(actor.handshakeTimer); actor.handshakeTimer = undefined; resolve(actor) }
        }
        ws.on('open', () => ws.send(encodeMessage({ type: MessageType.Hello, payload: { protocolVersion: PROTOCOL_VERSION, clientBuildId: buildId, supportedMapFormat: 1, accessToken: null } })))
        ws.on('message', async (raw) => {
            try {
                const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
                let offset = 0
                while (offset < bytes.length) {
                    const envelope = decodeEnvelope(bytes, offset); offset = envelope.nextOffset
                    if (!envelope.known) continue
                    const message = envelope.message
                    if (message.type === MessageType.Reject) throw new Error(`${label} rejected: ${message.payload.detail}`)
                    if (message.type === MessageType.Welcome) { welcome = message.payload; actor.playerId = welcome.playerId }
                    if (message.type === MessageType.Configuration) {
                        if (!welcome) throw new Error(`${label} received Configuration before Welcome`)
                        await validateConfiguration(message.payload, welcome)
                        actor.configured = true; ready()
                    }
                    if (message.type === MessageType.Snapshot) {
                        if (message.payload.match.phase === MatchPhase.Active) actor.activeSnapshots++
                        actor.poses.clear()
                        for (const entity of message.payload.entities) {
                            actor.seen.add(entity.entityId)
                            actor.poses.set(entity.entityId, { entityId: entity.entityId, x: entity.position.x, y: entity.position.y, z: entity.position.z, dead: Boolean(entity.stateFlags & 1) })
                        }
                        const own = actor.poses.get(actor.playerId)
                        if (own) {
                            actor.firstPosition ||= { x: own.x, y: own.y, z: own.z }
                            actor.lastPosition = { x: own.x, y: own.y, z: own.z }
                        }
                        if (!actor.aligned && own) { actor.tick = alignHarnessTick(message.payload.serverTick); actor.aligned = true }
                        ready()
                    }
                    if (message.type === MessageType.ShotConfirmed && message.payload.shooterId === actor.playerId) actor.shots++
                    if (message.type === MessageType.Impact) actor.impacts++
                    if (message.type === MessageType.Damage) actor.damage++
                    if (message.type === MessageType.Death) actor.deaths++
                    if (message.type === MessageType.Respawn) actor.respawns++
                    if (message.type === MessageType.RoundTransition) {
                        if (message.payload.transition === RoundTransitionKind.Started) actor.rounds.started++
                        if (message.payload.transition === RoundTransitionKind.Intermission) actor.rounds.intermission++
                        if (message.payload.transition === RoundTransitionKind.Reset) actor.rounds.reset++
                    }
                }
            } catch (error) { clearTimeout(actor.handshakeTimer); actor.handshakeTimer = undefined; reject(error) }
        })
        ws.on('error', reject)
    })
}

function sendInput(actor) {
    if (actor.ws.readyState !== WebSocket.OPEN || !actor.aligned) return
    const own = actor.poses.get(actor.playerId)
    const canAct = Boolean(own && !own.dead)
    const target = own && canAct ? chooseAliveTarget(actor.poses, own) : undefined
    const aim = own && target ? aimAtCapsule(own, target) : { yaw: 0, pitch: 0, moveX: 0, moveY: 0 }
    actor.tick = nextHarnessTick(actor.tick)
    const selectedWeapon = Math.floor((actor.tick + actor.ordinal * 60) / 240) % 2 ? Weapon.Shotgun : Weapon.Rifle
    const buttonFlags = canAct ? (target ? 2 : 0) | (actor.tick % 300 === 0 ? 4 : 0) | (actor.tick % 240 === 30 ? 1 : 0) : 0
    const command = { sequence: actor.sequence = (actor.sequence + 1) >>> 0, clientTick: actor.tick, moveX: aim.moveX, moveY: aim.moveY, buttonFlags, yaw: aim.yaw, pitch: aim.pitch, selectedWeapon }
    actor.ws.send(encodeMessage({ type: MessageType.InputBatch, payload: { commands: [command] } }))
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const stopActorTimers = (actor) => {
    if (actor.interval) clearInterval(actor.interval)
    actor.interval = undefined
    if (actor.handshakeTimer) clearTimeout(actor.handshakeTimer)
    actor.handshakeTimer = undefined
}
const gracefullyCloseActor = async (actor) => {
    stopActorTimers(actor)
    if (actor.ws.readyState === WebSocket.CLOSED) { connectedActors.delete(actor); return }
    await new Promise((resolve) => {
        let settled = false
        const finish = () => { if (settled) return; settled = true; clearTimeout(timeout); resolve() }
        const timeout = setTimeout(finish, 750)
        actor.ws.once('close', finish)
        if (actor.ws.readyState < WebSocket.CLOSING) actor.ws.close(1000, 'harness participant reconnect')
    })
    connectedActors.delete(actor)
}
const shutdownActors = async (actors) => {
    const unique = [...new Set(actors)]
    for (const actor of unique) {
        stopActorTimers(actor)
        if (actor.ws.readyState < WebSocket.CLOSING) actor.ws.close(1000, 'harness complete')
    }
    await wait(100)
    for (const actor of unique) {
        actor.ws.removeAllListeners()
        if (actor.ws.readyState !== WebSocket.CLOSED) actor.ws.terminate()
        connectedActors.delete(actor)
    }
}
const moved = (actor) => actor.firstPosition && actor.lastPosition && Math.hypot(actor.lastPosition.x - actor.firstPosition.x, actor.lastPosition.y - actor.firstPosition.y, actor.lastPosition.z - actor.firstPosition.z) >= .1
const total = (actors, field) => actors.reduce((sum, actor) => sum + actor[field], 0)

const participants = []
try {
    const actors = await Promise.all([connectActor('browser-a', 0), connectActor('browser-b', 1), connectActor('headless-bot', 2)])
    participants.push(...actors)
    await wait(Math.floor(durationMs / 2))
    for (const actor of actors) {
        if (!shouldRequireActivity(actor.activeSnapshots)) continue
        if (shouldRequireIndividualMovement(actor.activeSnapshots, requireRound) && !moved(actor)) throw new Error(`${actor.label} did not move authoritatively during the original Active participant window`)
        if (actor.shots < 1) throw new Error(`${actor.label} received no authoritative shot confirmation during the original Active participant window`)
    }
    const retired = actors[0], originalId = retired.playerId
    await gracefullyCloseActor(retired)
    await wait(250)
    const replacement = await connectActor('browser-a-reconnected', 0)
    participants.push(replacement); actors[0] = replacement
    await wait(Math.ceil(durationMs / 2))

    if (replacement.playerId === originalId) throw new Error('Reconnect reused the old authoritative entity id')
    for (const actor of actors) {
        if (actor.seen.size < 3) throw new Error(`${actor.label} never observed all three participants`)
        if (shouldRequireActivity(actor.activeSnapshots)) {
            if (shouldRequireIndividualMovement(actor.activeSnapshots, requireRound) && !moved(actor)) throw new Error(`${actor.label} observed Active play but did not move authoritatively`)
            if (actor.shots < 1) throw new Error(`${actor.label} observed Active play but received no authoritative shot confirmation`)
        }
    }
    if (total(participants, 'shots') < 1) throw new Error('Harness received no authoritative shot confirmations')
    if (requireCombat) {
        for (const field of ['damage', 'deaths', 'respawns']) if (total(participants, field) < 1) throw new Error(`HARNESS_REQUIRE_COMBAT expected nonzero ${field}`)
    }
    if (requireRound) {
        for (const field of ['started', 'intermission', 'reset']) {
            const count = participants.reduce((sum, actor) => sum + actor.rounds[field], 0)
            if (count < 1) throw new Error(`HARNESS_REQUIRE_ROUND expected nonzero ${field} transitions`)
        }
    }
    console.log(`Phase 5 harness passed ${websocketUrl}; participants=${participants.length} shots=${total(participants, 'shots')} impacts=${total(participants, 'impacts')} damage=${total(participants, 'damage')} deaths=${total(participants, 'deaths')} respawns=${total(participants, 'respawns')}`)
} finally {
    await shutdownActors([...participants, ...connectedActors])
}

// The ws/tsx combination can retain an internal handle briefly even after all
// sockets and timers are gone. A successful standalone harness has no further
// work, so terminate deterministically. Thrown assertions bypass this line and
// retain their non-zero exit status.
process.exit(0)
