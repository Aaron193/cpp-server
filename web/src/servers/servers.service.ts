import { eq, and, gt, sql } from 'drizzle-orm'
import { getDb } from '../db/client'
import { gameServers, NewGameServer } from '../db/schema'
import { CONSTANTS } from '../config/constants'
import type { GameServerInfo } from '../types/shared'

/**
 * Register a new game server or update existing one
 */
export async function registerGameServer(
    id: string,
    host: string,
    port: number,
    region: string,
    maxPlayers: number
): Promise<void> {
    const db = getDb()

    const serverData: NewGameServer = {
        id,
        host,
        port,
        region,
        maxPlayers,
        currentPlayers: 0,
        isOnline: true,
        lastHeartbeat: new Date(),
    }

    // Upsert: insert or update if exists
    await db
        .insert(gameServers)
        .values(serverData)
        .onConflictDoUpdate({
            target: gameServers.id,
            set: {
                host: serverData.host,
                port: serverData.port,
                region: serverData.region,
                maxPlayers: serverData.maxPlayers,
                isOnline: true,
                lastHeartbeat: serverData.lastHeartbeat,
            },
        })
}

/**
 * Update server heartbeat and player count
 */
export async function updateHeartbeat(
    id: string,
    currentPlayers: number
): Promise<void> {
    const db = getDb()

    await db
        .update(gameServers)
        .set({
            lastHeartbeat: new Date(),
            currentPlayers,
            isOnline: true,
        })
        .where(eq(gameServers.id, id))
}

/**
 * Get list of online game servers
 * Excludes servers that haven't sent heartbeat recently
 */
export async function getOnlineServers(): Promise<GameServerInfo[]> {
    const db = getDb()

    const cutoffTime = new Date(
        Date.now() - CONSTANTS.HEARTBEAT_TIMEOUT_SECONDS * 1000
    )

    const servers = await db
        .select({
            id: gameServers.id,
            host: gameServers.host,
            port: gameServers.port,
            region: gameServers.region,
            currentPlayers: gameServers.currentPlayers,
            maxPlayers: gameServers.maxPlayers,
            lastHeartbeat: gameServers.lastHeartbeat,
            isOnline: gameServers.isOnline,
        })
        .from(gameServers)
        .where(
            and(
                eq(gameServers.isOnline, true),
                gt(gameServers.lastHeartbeat, cutoffTime)
            )
        )
        .orderBy(gameServers.region, gameServers.currentPlayers)

    return servers.map((s) => ({
        ...s,
        lastHeartbeat: s.lastHeartbeat.toISOString(),
    }))
}

/**
 * Mark servers as offline if they haven't sent heartbeat recently
 * This should be called periodically
 */
export async function markExpiredServersOffline(): Promise<number> {
    const db = getDb()

    const cutoffTime = new Date(
        Date.now() - CONSTANTS.HEARTBEAT_TIMEOUT_SECONDS * 1000
    )

    const result = await db
        .update(gameServers)
        .set({ isOnline: false })
        .where(
            and(
                eq(gameServers.isOnline, true),
                sql`${gameServers.lastHeartbeat} < ${cutoffTime}`
            )
        )

    return result.rowCount || 0
}

let cleanupJobInterval: NodeJS.Timeout | null = null

/**
 * Start periodic cleanup job to mark expired servers as offline
 */
export function startCleanupJob(): void {
    if (cleanupJobInterval) {
        return // Already running
    }

    console.log('Starting server cleanup job')

    cleanupJobInterval = setInterval(async () => {
        try {
            const count = await markExpiredServersOffline()
            if (count > 0) {
                console.log(
                    `Marked ${count} server(s) as offline due to heartbeat timeout`
                )
            }
        } catch (err) {
            console.error('Error in cleanup job:', err)
        }
    }, CONSTANTS.CLEANUP_INTERVAL_MS)
}

/**
 * Stop cleanup job (for graceful shutdown)
 */
export function stopCleanupJob(): void {
    if (cleanupJobInterval) {
        clearInterval(cleanupJobInterval)
        cleanupJobInterval = null
        console.log('Stopped server cleanup job')
    }
}
