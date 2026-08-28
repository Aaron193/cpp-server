import { CONSTANTS } from '../config/constants'
import type { GameServerInfo } from '../types/shared'

export interface GameServerDiscoveryRecord {
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
    lastHeartbeat: Date
    isOnline: boolean
}

export function getServerDiscoveryCutoff(now: Date = new Date()): Date {
    return new Date(now.getTime() - CONSTANTS.HEARTBEAT_TIMEOUT_SECONDS * 1000)
}

export function toGameServerInfo(
    server: GameServerDiscoveryRecord
): GameServerInfo {
    return {
        ...server,
        lastHeartbeat: server.lastHeartbeat.toISOString(),
    }
}
