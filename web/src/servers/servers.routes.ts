import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import {
    registerGameServer,
    updateHeartbeat,
    getOnlineServers,
} from './servers.service'
import { authenticateGameServer } from '../middleware/auth'
import type { GameServerInfo } from '../types/shared'
import { serverRegistrationSchema } from './server-registration-validation'

const serversRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * POST /servers/register
     * Register a game server (requires server shared secret)
     */
    fastify.post(
        '/register',
        {
            preHandler: authenticateGameServer,
            schema: {
                body: serverRegistrationSchema,
            },
        },
        async (request, reply) => {
            const body = request.body as unknown as {
                id: string
                host: string
                port: number
                region: string
                maxPlayers: number
                buildId: string
                protocolVersion: number
                mapId: string
                mode: string
                websocketUrl: string
            }
            const { id, host, port, region, maxPlayers, buildId,
                protocolVersion, mapId, mode, websocketUrl } = body

            try {
                await registerGameServer(id, host, port, region, maxPlayers,
                    buildId, protocolVersion, mapId, mode, websocketUrl)

                // Log server registration
                request.log.info(
                    { serverId: id, host, port, region },
                    'Game server registered'
                )

                return { message: 'Server registered', serverId: id }
            } catch (err) {
                const error = err as Error
                return reply.code(500).send({
                    error: error.message,
                    code: '500',
                })
            }
        }
    )

    /**
     * POST /servers/heartbeat
     * Update server heartbeat (requires server shared secret)
     */
    fastify.post(
        '/heartbeat',
        {
            preHandler: authenticateGameServer,
            schema: {
                body: z.object({
                    id: z.string(),
                    currentPlayers: z.number().int().min(0),
                }),
            },
        },
        async (request, reply) => {
            const body = request.body as unknown as {
                id: string
                currentPlayers: number
            }
            const { id, currentPlayers } = body

            try {
                await updateHeartbeat(id, currentPlayers)

                return { message: 'Heartbeat updated' }
            } catch (err) {
                const error = err as Error
                return reply.code(500).send({
                    error: error.message,
                    code: '500',
                })
            }
        }
    )

    /**
     * GET /servers
     * Get list of online game servers (public endpoint)
     */
    fastify.get('/', async (_request, reply) => {
        try {
            const servers = await getOnlineServers()

            const response: GameServerInfo[] = servers

            return { servers: response }
        } catch (err) {
            const error = err as Error
            return reply.code(500).send({
                error: error.message,
                code: '500',
            })
        }
    })
}

export default serversRoutes
