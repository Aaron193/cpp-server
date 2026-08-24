import WebSocket from 'ws'
import { MessageType, PROTOCOL_VERSION, Weapon, decodeEnvelope, encodeMessage } from '../src/protocol/generated.ts'

const websocketUrl = process.env.BOT_WEBSOCKET_URL || 'ws://localhost:9001'
const buildId = process.env.BOT_BUILD_ID || 'dev'
const maxConcurrentConnections = Number(process.env.BOT_COUNT || 100)
let activeConnections = 0, botCounter = 0

function createBot() {
    if (activeConnections >= maxConcurrentConnections) return
    const botId = ++botCounter, ws = new WebSocket(websocketUrl)
    let sequence = 0, tick = 0, movement
    activeConnections++
    ws.on('open', () => ws.send(encodeMessage({ type: MessageType.Hello, payload: { protocolVersion: PROTOCOL_VERSION, clientBuildId: buildId, supportedMapFormat: 1, accessToken: null } })))
    ws.on('message', (data) => {
        const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        let offset = 0
        while (offset < bytes.length) {
            const envelope = decodeEnvelope(bytes, offset); offset = envelope.nextOffset
            if (!envelope.known || movement) continue
            if (envelope.message.type === MessageType.Reject) { ws.close(); return }
            if (envelope.message.type === MessageType.Configuration) {
                movement = setInterval(() => {
                    const angle = (botId + tick / 60) % (Math.PI * 2)
                    tick = (tick + 1) >>> 0
                    const selectedWeapon = Math.floor((tick + botId) / 180) % 2 ? Weapon.Shotgun : Weapon.Rifle
                    const command = { sequence: sequence = (sequence + 1) >>> 0, clientTick: tick, moveX: Math.sin(angle), moveY: Math.cos(angle), buttonFlags: 2 | (tick % 240 === 0 ? 1 : 0) | (tick % 360 === 0 ? 4 : 0), yaw: angle - Math.PI, pitch: 0, selectedWeapon }
                    if (ws.readyState === WebSocket.OPEN) ws.send(encodeMessage({ type: MessageType.InputBatch, payload: { commands: [command] } }))
                }, 1000 / 60)
            }
        }
    })
    ws.once('close', () => { if (movement) clearInterval(movement); activeConnections = Math.max(0, activeConnections - 1) })
    ws.on('error', (error) => console.error(`[Bot ${botId}] ${error.message}`))
}

for (let index = 0; index < maxConcurrentConnections; index++) setTimeout(createBot, index * 10)
setInterval(() => { while (activeConnections < maxConcurrentConnections) createBot() }, 1000)
setInterval(() => console.log(`${activeConnections} active bots; ${botCounter} created; ${websocketUrl}`), 5000)
