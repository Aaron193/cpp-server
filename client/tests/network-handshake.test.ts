import manifestJson from '../public/maps/graybox-arena/manifest.json'
import { describe, expect, it } from 'vitest'
import { validateConfiguration, validateWelcome, sha256Identifier } from '../src/foundation/networking/Handshake'
import type { ClientMapManifest } from '../src/foundation/assets/MapManifest'
import { PROTOCOL_VERSION, type Configuration, type Welcome } from '../src/protocol/generated'

const manifest = manifestJson as unknown as ClientMapManifest
const movement = { capsuleRadius: .42, capsuleHalfHeight: .48, eyeHeight: 1.62, groundSpeed: 7.5, groundAcceleration: 42, airAcceleration: 12, airControl: .45, jumpSpeed: 6.4, gravity: 20, terminalVelocity: 35, maxSlopeRadians: .78, stepUpHeight: .42, stickToFloorDistance: .5 }

describe('network handshake validation', () => {
    it('validates discovery, welcome, map, and the exact configuration bytes', async () => {
        const configurationJson = JSON.stringify({ movement, arbitraryOrderingMatters: true })
        const configurationHash = await sha256Identifier(configurationJson)
        const welcome: Welcome = { protocolVersion: PROTOCOL_VERSION, serverBuildId: 'dev', playerId: 7, playerHandle: { slot: 7, generation: 0 }, tickRate: 60, snapshotRate: 20, map: { mapId: manifest.mapId, formatVersion: manifest.formatVersion, contentHash: manifest.contentHash }, configurationHash }
        validateWelcome(welcome, { clientBuildId: 'dev', discovery: { websocketUrl: 'wss://example.test/game/path?token=x', buildId: 'dev', protocolVersion: PROTOCOL_VERSION, mapId: manifest.mapId, mode: 'ffa' }, manifest })
        const configuration: Configuration = { protocolVersion: PROTOCOL_VERSION, serverBuildId: 'dev', map: welcome.map, configurationHash, configurationJson }
        expect((await validateConfiguration(configuration, welcome)).groundSpeed).toBe(7.5)
    })

    it('rejects metadata mismatch and reserialized/tampered configuration JSON', async () => {
        const exact = JSON.stringify({ movement })
        const hash = await sha256Identifier(exact)
        const welcome: Welcome = { protocolVersion: PROTOCOL_VERSION, serverBuildId: 'dev', playerId: 1, playerHandle: { slot: 1, generation: 0 }, tickRate: 60, snapshotRate: 20, map: { mapId: manifest.mapId, formatVersion: 1, contentHash: manifest.contentHash }, configurationHash: hash }
        expect(() => validateWelcome({ ...welcome, serverBuildId: 'other' }, { clientBuildId: 'dev', discovery: { websocketUrl: 'ws://x', buildId: 'dev', protocolVersion: PROTOCOL_VERSION, mapId: manifest.mapId, mode: 'ffa' }, manifest })).toThrow(/Build mismatch/)
        await expect(validateConfiguration({ protocolVersion: PROTOCOL_VERSION, serverBuildId: 'dev', map: welcome.map, configurationHash: hash, configurationJson: `${exact} ` }, welcome)).rejects.toThrow(/SHA-256/)
    })
})
