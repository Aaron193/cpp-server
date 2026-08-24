import WebSocket from 'ws'
import { MessageType, PROTOCOL_VERSION, Weapon, decodeEnvelope, encodeMessage } from '../src/protocol/generated.ts'

const websocketUrl = process.env.BOT_WEBSOCKET_URL || 'ws://localhost:9001'
const buildId = process.env.BOT_BUILD_ID || 'dev'
const mapFormat = Number(process.env.BOT_MAP_FORMAT || 1)
const count = Number(process.env.BOT_COUNT || 2)

for (let index = 0; index < count; index++) {
    const ws = new WebSocket(websocketUrl)
    let sequence = 0, tick = 0, movement
    ws.on('open', () => ws.send(encodeMessage({ type: MessageType.Hello, payload: { protocolVersion: PROTOCOL_VERSION, clientBuildId: buildId, supportedMapFormat: mapFormat, accessToken: null } })))
    ws.on('message', (data) => {
        const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        let offset = 0
        while (offset < bytes.length) {
            const envelope = decodeEnvelope(bytes, offset); offset = envelope.nextOffset
            if (!envelope.known) continue
            if (envelope.message.type === MessageType.Reject) { console.error(`[Bot ${index}] rejected: ${envelope.message.payload.detail}`); ws.close(); return }
            if (envelope.message.type === MessageType.Configuration && !movement) {
                console.log(`[Bot ${index}] connected via ${websocketUrl}`)
                movement = setInterval(() => {
                    const angle = tick / 120
                    tick = (tick + 1) >>> 0
                    const selectedWeapon = Math.floor(tick / 240) % 2 ? Weapon.Shotgun : Weapon.Rifle
                    const command = { sequence: sequence = (sequence + 1) >>> 0, clientTick: tick, moveX: Math.sin(angle), moveY: -Math.cos(angle), buttonFlags: 2 | (tick % 180 === 0 ? 1 : 0) | (tick % 300 === 0 ? 4 : 0), yaw: angle % (Math.PI * 2) - Math.PI, pitch: 0, selectedWeapon }
                    if (ws.readyState === WebSocket.OPEN) ws.send(encodeMessage({ type: MessageType.InputBatch, payload: { commands: [command] } }))
                }, 1000 / 60)
            }
        }
    })
    ws.on('close', () => { if (movement) clearInterval(movement) })
    ws.on('error', (error) => console.error(`[Bot ${index}] ${error.message}`))
}
