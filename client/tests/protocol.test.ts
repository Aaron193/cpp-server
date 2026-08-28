import vectors from '../../protocol/fixtures/golden-vectors.json'
import { describe, expect, it } from 'vitest'
import {
    ChatChannel,
    decodeEnvelope,
    encodeMessage,
    ImpactMaterial,
    LIMITS,
    MatchPhase,
    MessageType,
    PROTOCOL_VERSION,
    ProtocolError,
    RejectReason,
    Weapon,
    type Message,
} from '../src/protocol/generated'

function fromHex(hex: string): Uint8Array {
    return Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16))
}

describe('generated cross-language protocol', () => {
    it('decodes every shared golden vector and reproduces identical bytes', () => {
        for (const vector of vectors) {
            const bytes = fromHex(vector.expectedHex)
            const decoded = decodeEnvelope(bytes)
            expect(decoded.known, vector.name).toBe(true)
            if (!decoded.known) throw new Error('expected a known fixture message')
            expect(decoded.nextOffset).toBe(bytes.length)
            expect(Buffer.from(encodeMessage(decoded.message)).toString('hex')).toBe(
                vector.expectedHex,
            )
        }
    })

    it('preserves wrap values and represents version mismatch metadata', () => {
        const batch = decodeEnvelope(fromHex(vectors[2]!.expectedHex))
        expect(batch.known && batch.message.type).toBe(MessageType.InputBatch)
        if (batch.known && batch.message.type === MessageType.InputBatch) {
            expect(batch.message.payload.commands[0]!.sequence).toBe(0xffffffff)
            expect(batch.message.payload.commands[0]!.clientTick).toBe(0xfffffffe)
        }
        const rejection = decodeEnvelope(fromHex(vectors[1]!.expectedHex))
        if (!rejection.known || rejection.message.type !== MessageType.Reject) throw new Error('wrong fixture')
        expect(rejection.message.payload).toMatchObject({
            reason: RejectReason.VersionMismatch,
            expectedProtocolVersion: PROTOCOL_VERSION,
            expectedMapFormat: 2,
        })
    })

    it('skips a well-formed unknown message using its declared length', () => {
        const known = fromHex(vectors[0]!.expectedHex)
        const bytes = new Uint8Array(5 + known.length)
        bytes.set([250, 2, 0, 0xaa, 0xbb])
        bytes.set(known, 5)
        const unknown = decodeEnvelope(bytes)
        expect(unknown).toEqual({ known: false, messageType: 250, payloadLength: 2, nextOffset: 5 })
        const hello = decodeEnvelope(bytes, unknown.nextOffset)
        expect(hello.known && hello.message.type).toBe(MessageType.Hello)
    })

    it('rejects invalid strings, floats, enums, and bounded collections', () => {
        const invalidUnicode: Message = {
            type: MessageType.Chat,
            payload: { senderId: null, channel: ChatChannel.Global, text: '\ud800' },
        }
        expect(() => encodeMessage(invalidUnicode)).toThrow(ProtocolError)
        expect(() => encodeMessage({
            type: MessageType.Chat,
            payload: { senderId: null, channel: ChatChannel.Global, text: 'x'.repeat(LIMITS.maxChatBytes + 1) },
        })).toThrow(ProtocolError)

        const invalidUtf8 = fromHex('0f050000010100ff')
        expect(() => decodeEnvelope(invalidUtf8)).toThrow(ProtocolError)

        const validBatch: Message = {
            type: MessageType.InputBatch,
            payload: { commands: [{ sequence: 1, clientTick: 2, moveX: 0, moveY: 0, buttonFlags: 0, fireActionId: 0, reloadActionId: 0, yaw: 0, pitch: 0, selectedWeapon: Weapon.Rifle }] },
        }
        const nonFinite = encodeMessage(validBatch).slice()
        nonFinite.set([0, 0, 0xc0, 0x7f], 13)
        expect(() => decodeEnvelope(nonFinite)).toThrow(ProtocolError)
        const invalidEnum = encodeMessage(validBatch).slice()
        invalidEnum[invalidEnum.length - 1] = 99
        expect(() => decodeEnvelope(invalidEnum)).toThrow(ProtocolError)
        expect(() => encodeMessage({ type: MessageType.InputBatch, payload: { commands: [] } })).toThrow(ProtocolError)
        expect(() => encodeMessage({ type: MessageType.InputBatch, payload: { commands: Array.from({ length: LIMITS.maxInputCommands + 1 }, () => validBatch.payload.commands[0]!) } })).toThrow(ProtocolError)
    })

    it('rejects truncated and malformed envelopes and known trailing payload bytes', () => {
        expect(() => decodeEnvelope(new Uint8Array())).toThrow(ProtocolError)
        expect(() => decodeEnvelope(Uint8Array.from([MessageType.Hello, 4, 0, 1]))).toThrow(ProtocolError)
        expect(() => decodeEnvelope(Uint8Array.from([250, 0xff, 0xff]))).toThrow(ProtocolError)
        const hello = fromHex(vectors[0]!.expectedHex)
        const trailing = new Uint8Array(hello.length + 1)
        trailing.set(hello)
        trailing[1] = hello[1]! + 1
        trailing[trailing.length - 1] = 0
        expect(() => decodeEnvelope(trailing)).toThrow(ProtocolError)
    })

    it('round trips all enum-bearing match fields strictly', () => {
        const message: Message = {
            type: MessageType.RoundTransition,
            payload: { serverTick: 0xffffffff, transition: 1, match: { phase: MatchPhase.Active, roundNumber: 1, phaseEndsAtTick: 0 } },
        }
        expect(decodeEnvelope(encodeMessage(message))).toMatchObject({ known: true, message })
    })

    it('round trips pellet-indexed impacts and bounds authoritative pellet paths', () => {
        const impact: Message = {
            type: MessageType.Impact,
            payload: { serverTick: 4, shotId: 9, pelletIndex: 7, position: { x: 1, y: 2, z: 3 }, normal: { x: 0, y: 1, z: 0 }, material: ImpactMaterial.World },
        }
        expect(decodeEnvelope(encodeMessage(impact))).toMatchObject({ known: true, message: impact })
        const endpoint = { x: 0, y: 0, z: 0 }
        expect(() => encodeMessage({
            type: MessageType.ShotConfirmed,
            payload: { serverTick: 4, shooterId: 1, inputSequence: 2, actionId: 3, shotId: 9, weapon: Weapon.Shotgun, origin: endpoint, pelletEndPositions: [] },
        })).toThrow(ProtocolError)
        expect(() => encodeMessage({
            type: MessageType.ShotConfirmed,
            payload: { serverTick: 4, shooterId: 1, inputSequence: 2, actionId: 3, shotId: 9, weapon: Weapon.Shotgun, origin: endpoint, pelletEndPositions: Array.from({ length: LIMITS.maxPelletsPerShot + 1 }, () => endpoint) },
        })).toThrow(ProtocolError)
    })

    it('carries an authoritative scoreboard row across golden vectors', () => {
        const score = decodeEnvelope(fromHex(vectors[5]!.expectedHex))
        expect(score.known && score.message.type).toBe(MessageType.ScoreChange)
        if (!score.known || score.message.type !== MessageType.ScoreChange) throw new Error('wrong fixture')
        expect(score.message.payload).toMatchObject({
            playerId: 42,
            score: 9,
            delta: -1,
            kills: 9,
            deaths: 4,
        })
    })

    it('carries public equipped and fired weapon metadata', () => {
        const snapshot = decodeEnvelope(fromHex(vectors[3]!.expectedHex))
        if (!snapshot.known || snapshot.message.type !== MessageType.Snapshot) throw new Error('wrong fixture')
        expect(snapshot.message.payload.entities[0]!.equippedWeapon).toBe(Weapon.Rifle)

        const shot = decodeEnvelope(fromHex(vectors[6]!.expectedHex))
        if (!shot.known || shot.message.type !== MessageType.ShotConfirmed) throw new Error('wrong fixture')
        expect(shot.message.payload).toMatchObject({
            shooterId: 42, shotId: 123, weapon: Weapon.Shotgun,
            origin: { x: 1.25, y: 2.5, z: -3.75 },
            pelletEndPositions: [
                { x: 1.25, y: 2.5, z: -23.75 },
                { x: 2, y: 2.25, z: -23.5 },
            ],
        })
        const action = decodeEnvelope(fromHex(vectors.find((fixture) => fixture.message === 'ActionResult')!.expectedHex))
        if (!action.known || action.message.type !== MessageType.ActionResult) throw new Error('wrong fixture')
        expect(action.message.payload).toMatchObject({ actionId: 78, accepted: false, reason: 1, authoritativeMagazineAmmo: 18 })
    })

    it('carries bounded wrapping ping/pong clock anchors', () => {
        const ping = decodeEnvelope(fromHex(vectors.find((fixture) => fixture.message === 'Ping')!.expectedHex))
        if (!ping.known || ping.message.type !== MessageType.Ping) throw new Error('wrong fixture')
        expect(ping.message.payload.pingId).toBe(0xffffffff)
        const pong = decodeEnvelope(fromHex(vectors.find((fixture) => fixture.message === 'Pong')!.expectedHex))
        if (!pong.known || pong.message.type !== MessageType.Pong) throw new Error('wrong fixture')
        expect(pong.message.payload).toEqual({ pingId: 0xffffffff, serverTick: 0xfffffffe, serverMonotonicMs: 0xfffffff0 })
        expect(() => decodeEnvelope(Uint8Array.from([MessageType.Pong, 11, 0, ...new Array(11).fill(0)]))).toThrow(ProtocolError)
    })
})
