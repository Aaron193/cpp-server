import assert from 'node:assert/strict'
import test from 'node:test'

import {
    getServerDiscoveryCutoff,
    toGameServerInfo,
} from '../src/servers/server-discovery'
import { serverRegistrationSchema } from '../src/servers/server-registration-validation'

const validRegistration = {
    id: 'server-1',
    host: 'games.example.test',
    port: 9001,
    region: 'us-central',
    maxPlayers: 12,
    buildId: 'web-3d-a1',
    protocolVersion: 1,
    mapId: 'graybox-arena',
    mapFormatVersion: 2,
    mapContentHash: 'sha256:3984a02b8a6ce8abaebddacb010273285fbb666cb4f973f5eb7e251e3fb9b477',
    mode: 'deathmatch',
    websocketUrl: 'wss://games.example.test/arena',
}

test('registration accepts complete compatible discovery metadata', () => {
    assert.deepEqual(serverRegistrationSchema.parse(validRegistration), validRegistration)
})

test('registration rejects non-websocket URLs and invalid protocol metadata', () => {
    assert.equal(serverRegistrationSchema.safeParse({
        ...validRegistration,
        websocketUrl: 'https://games.example.test/arena',
    }).success, false)
    assert.equal(serverRegistrationSchema.safeParse({
        ...validRegistration,
        protocolVersion: 0,
    }).success, false)
})

test('discovery excludes heartbeats older than the current ten-second window', () => {
    const now = new Date('2026-08-23T18:30:45.250Z')

    assert.equal(
        getServerDiscoveryCutoff(now).toISOString(),
        '2026-08-23T18:30:35.250Z'
    )
})

test('discovery preserves connection and capacity fields and emits an ISO heartbeat', () => {
    const result = toGameServerInfo({
        id: 'server-1',
        host: 'games.example.test',
        port: 9001,
        region: 'us-central',
        buildId: 'web-3d-a1',
        protocolVersion: 1,
        mapId: 'graybox-arena',
        mapFormatVersion: 2,
        mapContentHash: 'sha256:3984a02b8a6ce8abaebddacb010273285fbb666cb4f973f5eb7e251e3fb9b477',
        mode: 'deathmatch',
        websocketUrl: 'wss://games.example.test/arena',
        currentPlayers: 3,
        maxPlayers: 12,
        lastHeartbeat: new Date('2026-08-23T18:30:42.000Z'),
        isOnline: true,
    })

    assert.deepEqual(result, {
        id: 'server-1',
        host: 'games.example.test',
        port: 9001,
        region: 'us-central',
        buildId: 'web-3d-a1',
        protocolVersion: 1,
        mapId: 'graybox-arena',
        mapFormatVersion: 2,
        mapContentHash: 'sha256:3984a02b8a6ce8abaebddacb010273285fbb666cb4f973f5eb7e251e3fb9b477',
        mode: 'deathmatch',
        websocketUrl: 'wss://games.example.test/arena',
        currentPlayers: 3,
        maxPlayers: 12,
        lastHeartbeat: '2026-08-23T18:30:42.000Z',
        isOnline: true,
    })
})
