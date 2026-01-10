import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import {
    getLeaderboard,
    updatePlayerStats,
    LeaderboardPeriod,
} from './leaderboard.service'
import { authenticateGameServer } from '../middleware/auth'

const leaderboardRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * GET /leaderboard
     * Get leaderboard entries (public endpoint)
     */
    fastify.get(
        '/',
        {
            schema: {
                querystring: z.object({
                    period: z
                        .enum(['all', 'weekly', 'daily'])
                        .optional()
                        .default('all'),
                    limit: z.coerce
                        .number()
                        .int()
                        .min(1)
                        .max(100)
                        .optional()
                        .default(50),
                }),
            },
        },
        async (request, reply) => {
            const query = request.query as {
                period?: LeaderboardPeriod
                limit?: number
            }
            const period = query.period || 'all'
            const limit = query.limit || 50

            try {
                const entries = await getLeaderboard(period, limit)
                return { leaderboard: entries }
            } catch (err) {
                const error = err as Error
                request.log.error(
                    { error: error.message },
                    'Failed to fetch leaderboard'
                )
                return reply.code(500).send({
                    error: 'Failed to fetch leaderboard',
                    code: '500',
                })
            }
        }
    )

    /**
     * POST /leaderboard/update
     * Update player stats after a game (requires server shared secret)
     */
    fastify.post(
        '/update',
        {
            preHandler: authenticateGameServer,
            schema: {
                body: z.object({
                    userId: z.string().uuid().nullable().optional(),
                    guestName: z.string().max(16).nullable().optional(),
                    score: z.number().int().min(0),
                    kills: z.number().int().min(0),
                    deaths: z.number().int().min(0),
                    won: z.boolean(),
                    playTimeSeconds: z.number().int().min(0),
                }),
            },
        },
        async (request, reply) => {
            const body = request.body as {
                userId?: string | null
                guestName?: string | null
                score: number
                kills: number
                deaths: number
                won: boolean
                playTimeSeconds: number
            }

            // Must have either userId or guestName
            if (!body.userId && !body.guestName) {
                return reply.code(400).send({
                    error: 'Either userId or guestName is required',
                    code: '400',
                })
            }

            try {
                await updatePlayerStats(
                    body.userId || null,
                    body.guestName || null,
                    body.score,
                    body.kills,
                    body.deaths,
                    body.won,
                    body.playTimeSeconds
                )

                return { message: 'Stats updated' }
            } catch (err) {
                const error = err as Error
                request.log.error(
                    { error: error.message },
                    'Failed to update player stats'
                )
                return reply.code(500).send({
                    error: 'Failed to update stats',
                    code: '500',
                })
            }
        }
    )
}

export default leaderboardRoutes
