import { getDb } from '../db/client'
import { playerStats, users } from '../db/schema'
import { desc, sql, gte } from 'drizzle-orm'
import type { LeaderboardEntry } from '../types/shared'

export type LeaderboardPeriod = 'all' | 'weekly' | 'daily'

/**
 * Get leaderboard entries for a given time period
 */
export async function getLeaderboard(
    period: LeaderboardPeriod = 'all',
    limit: number = 100
): Promise<LeaderboardEntry[]> {
    const db = getDb()
    let dateFilter = undefined

    if (period === 'daily') {
        dateFilter = gte(
            playerStats.lastPlayedAt,
            sql`now() - interval '1 day'`
        )
    } else if (period === 'weekly') {
        dateFilter = gte(
            playerStats.lastPlayedAt,
            sql`now() - interval '7 days'`
        )
    }

    const results = await db
        .select({
            name: sql<string>`COALESCE(${users.username}, ${playerStats.guestName}, 'Unknown')`,
            score: playerStats.score,
            kills: playerStats.kills,
            wins: playerStats.wins,
            gamesPlayed: playerStats.gamesPlayed,
        })
        .from(playerStats)
        .leftJoin(users, sql`${playerStats.userId} = ${users.id}`)
        .where(dateFilter)
        .orderBy(desc(playerStats.score))
        .limit(limit)

    return results.map(
        (
            row: {
                name: string
                score: number | bigint
                kills: number
                wins: number
                gamesPlayed: number
            },
            index: number
        ) => ({
            rank: index + 1,
            name: row.name,
            score: Number(row.score),
            kills: row.kills,
            wins: row.wins,
            gamesPlayed: row.gamesPlayed,
        })
    )
}

/**
 * Update or create player stats (called from game server)
 */
export async function updatePlayerStats(
    userId: string | null,
    guestName: string | null,
    scoreIncrement: number,
    killsIncrement: number,
    deathsIncrement: number,
    won: boolean,
    playTimeSeconds: number
): Promise<void> {
    const db = getDb()

    // Find existing stats by userId or guestName
    const existing = await db
        .select()
        .from(playerStats)
        .where(
            userId
                ? sql`${playerStats.userId} = ${userId}`
                : sql`${playerStats.guestName} = ${guestName}`
        )
        .limit(1)

    if (existing.length > 0) {
        // Update existing stats
        await db
            .update(playerStats)
            .set({
                score: sql`${playerStats.score} + ${scoreIncrement}`,
                kills: sql`${playerStats.kills} + ${killsIncrement}`,
                deaths: sql`${playerStats.deaths} + ${deathsIncrement}`,
                wins: sql`${playerStats.wins} + ${won ? 1 : 0}`,
                gamesPlayed: sql`${playerStats.gamesPlayed} + 1`,
                playTimeSeconds: sql`${playerStats.playTimeSeconds} + ${playTimeSeconds}`,
                lastPlayedAt: sql`now()`,
            })
            .where(sql`${playerStats.id} = ${existing[0].id}`)
    } else {
        // Create new stats entry
        await db.insert(playerStats).values({
            userId: userId,
            guestName: guestName,
            score: scoreIncrement,
            kills: killsIncrement,
            deaths: deathsIncrement,
            wins: won ? 1 : 0,
            gamesPlayed: 1,
            playTimeSeconds: playTimeSeconds,
        })
    }
}
