export interface ErrorResponse {
    error: string
    code: string
}

export interface JWTPayload {
    sub: string // userId
    username: string
    iat: number
    exp: number
}

export interface User {
    id: string
    username: string
    email: string | null
    createdAt: Date
}

export interface GameServerInfo {
    id: string
    host: string
    port: number
    region: string
    buildId: string
    protocolVersion: number
    mapId: string
    mapFormatVersion: number
    mapContentHash: string
    mode: string
    websocketUrl: string
    currentPlayers: number
    maxPlayers: number
    isOnline: boolean
    lastHeartbeat: string
}

export interface LeaderboardEntry {
    rank: number
    name: string
    score: number
    kills: number
    wins: number
    gamesPlayed: number
}

export interface ChangelogEntryInfo {
    id: string
    version: string
    date: string
    tag: 'new' | 'fix' | 'update'
    changes: string[]
}
