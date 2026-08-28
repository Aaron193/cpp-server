import assert from 'node:assert/strict'
import test from 'node:test'
import jwt from 'jsonwebtoken'

import { evaluateJoinServer, issueJoinTicket } from '../src/servers/join-ticket'

const server = {
    id: 'server-1', buildId: 'build-a', protocolVersion: 5,
    mapId: 'graybox-arena', mode: 'ffa',
    websocketUrl: 'wss://games.example.test/arena',
    currentPlayers: 3, maxPlayers: 12, isOnline: true,
    lastHeartbeat: new Date('2026-08-28T12:00:09Z'),
}
const compatibility = {
    clientBuildId: 'build-a', protocolVersion: 5,
    mapId: 'graybox-arena', mode: 'ffa',
}

test('join decision verifies online compatibility and capacity', () => {
    const cutoff = new Date('2026-08-28T12:00:00Z')
    assert.equal(evaluateJoinServer(server, compatibility, cutoff), null)
    assert.equal(evaluateJoinServer({ ...server, isOnline: false }, compatibility, cutoff), 'offline')
    assert.equal(evaluateJoinServer({ ...server, lastHeartbeat: cutoff }, compatibility, cutoff), 'offline')
    assert.equal(evaluateJoinServer({ ...server, currentPlayers: 12 }, compatibility, cutoff), 'capacity')
    assert.equal(evaluateJoinServer(server, { ...compatibility, protocolVersion: 4 }, cutoff), 'incompatible')
    assert.equal(evaluateJoinServer(server, { ...compatibility, mapId: 'other' }, cutoff), 'incompatible')
})

test('join ticket is short-lived, audience/server scoped, and has bounded identity claims', () => {
    const secret = '0123456789abcdef0123456789abcdef'
    let suffix = 0
    const issued = issueJoinTicket('user-1', 'server-1', secret,
        'arena-game-server', 20, 1_800_000_000, () => `id-${++suffix}`)
    const claims = jwt.verify(issued.ticket, secret, {
        algorithms: ['HS256'], audience: 'arena-game-server',
        clockTimestamp: 1_800_000_010,
    }) as jwt.JwtPayload & typeof issued.claims
    assert.equal(claims.sub, 'user-1')
    assert.equal(claims.gameServerId, 'server-1')
    assert.equal(claims.sessionId, 'id-1')
    assert.equal(claims.nonce, 'id-2')
    assert.equal(claims.exp - claims.iat, 20)
    assert.throws(() => jwt.verify(issued.ticket, secret, {
        algorithms: ['HS256'], audience: 'wrong', clockTimestamp: 1_800_000_010,
    }), /audience/)
    assert.throws(() => jwt.verify(issued.ticket, secret, {
        algorithms: ['HS256'], audience: 'arena-game-server', clockTimestamp: 1_800_000_021,
    }), /expired/)
})

test('join ticket configuration enforces 15-30 second lifetime', () => {
    const secret = '0123456789abcdef0123456789abcdef'
    assert.throws(() => issueJoinTicket('user', 'server', secret, 'aud', 14), /configuration/)
    assert.throws(() => issueJoinTicket('user', 'server', secret, 'aud', 31), /configuration/)
})
