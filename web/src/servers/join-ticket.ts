import { randomUUID } from 'node:crypto'
import jwt from 'jsonwebtoken'

export interface JoinCompatibility {
    readonly clientBuildId: string
    readonly protocolVersion: number
    readonly mapId: string
    readonly mode: string
}

export interface JoinServerRecord {
    readonly id: string
    readonly buildId: string
    readonly protocolVersion: number
    readonly mapId: string
    readonly mode: string
    readonly websocketUrl: string
    readonly currentPlayers: number
    readonly maxPlayers: number
    readonly isOnline: boolean
    readonly lastHeartbeat: Date
}

export type JoinDenial = 'offline' | 'capacity' | 'incompatible' | 'ineligible'

export function evaluateJoinServer(
    server: JoinServerRecord,
    compatibility: JoinCompatibility,
    cutoff: Date
): JoinDenial | null {
    if (!server.isOnline || server.lastHeartbeat <= cutoff) return 'offline'
    if (server.currentPlayers >= server.maxPlayers) return 'capacity'
    if (server.buildId !== compatibility.clientBuildId ||
        server.protocolVersion !== compatibility.protocolVersion ||
        server.mapId !== compatibility.mapId || server.mode !== compatibility.mode)
        return 'incompatible'
    if (!/^wss?:\/\//.test(server.websocketUrl)) return 'offline'
    return null
}

export interface JoinTicketClaims {
    readonly sub: string
    readonly sessionId: string
    readonly gameServerId: string
    readonly aud: string
    readonly iat: number
    readonly exp: number
    readonly nonce: string
}

export function issueJoinTicket(
    subject: string,
    gameServerId: string,
    secret: string,
    audience: string,
    ttlSeconds: number,
    nowSeconds = Math.floor(Date.now() / 1000),
    idFactory: () => string = randomUUID
): { ticket: string; claims: JoinTicketClaims } {
    if (!subject || subject.length > 128 || !gameServerId || gameServerId.length > 128)
        throw new Error('join identity is outside bounded claim limits')
    if (secret.length < 32 || audience.length < 1 || audience.length > 64 ||
        !Number.isInteger(ttlSeconds) || ttlSeconds < 15 || ttlSeconds > 30)
        throw new Error('join ticket configuration is invalid')
    const claims: JoinTicketClaims = {
        sub: subject,
        sessionId: idFactory(),
        gameServerId,
        aud: audience,
        iat: nowSeconds,
        exp: nowSeconds + ttlSeconds,
        nonce: idFactory(),
    }
    return {
        claims,
        ticket: jwt.sign(claims, secret, {
            algorithm: 'HS256',
        }),
    }
}
