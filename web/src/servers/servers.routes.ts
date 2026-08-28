import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import {
    registerGameServer,
    updateHeartbeat,
    getOnlineServers,
    getServerForJoin,
} from './servers.service'
import { authenticateGameServer, authenticateRequest } from '../middleware/auth'
import type { GameServerInfo } from '../types/shared'
import { serverRegistrationSchema } from './server-registration-validation'
import { env } from '../config/env'
import { evaluateJoinServer, issueJoinTicket } from './join-ticket'
import { getServerDiscoveryCutoff } from './server-discovery'
import { getUserById } from '../auth/auth.service'

const serversRoutes: FastifyPluginAsync = async (fastify) => {
    const allowLocalGuestJoins = env.ALLOW_GUEST_JOINS
    fastify.post(
        '/:id/join',
        {
            preHandler: allowLocalGuestJoins
                ? undefined
                : authenticateRequest,
            schema: {
                params: z.object({ id: z.string().min(1).max(128) }),
                body: z.object({
                    clientBuildId: z.string().min(1).max(64),
                    protocolVersion: z.number().int().positive(),
                    mapId: z.string().min(1).max(64),
                    mode: z.string().min(1).max(64),
                }),
            },
        },
        async (request, reply) => {
            const { id } = request.params as { id: string }
            const compatibility = request.body as {
                clientBuildId: string; protocolVersion: number
                mapId: string; mode: string
            }
            const subject = (request as any).userId as string | undefined
            const username = (request as any).username as string | undefined
            if (allowLocalGuestJoins && !subject) {
                const server = await getServerForJoin(id)
                if (!server)
                    return reply.code(404).send({ error: 'Game server not found', code: 'offline' })
                const denial = evaluateJoinServer(server, compatibility, getServerDiscoveryCutoff())
                if (denial) {
                    const status = denial === 'capacity' ? 409 : denial === 'incompatible' ? 412 : 503
                    return reply.code(status).send({ error: `Join denied: ${denial}`, code: denial })
                }
                const issued = issueJoinTicket('local-guest', server.id, env.JOIN_TICKET_SECRET,
                    env.JOIN_TICKET_AUDIENCE, env.JOIN_TICKET_TTL_SECONDS)
                request.log.info({ serverId: server.id }, 'Issued local development guest join ticket')
                return {
                    websocketUrl: server.websocketUrl,
                    ticket: issued.ticket,
                    expiresAt: new Date(issued.claims.exp * 1000).toISOString(),
                }
            }
            if (!subject || subject.length > 128 || !username || username.length > 64)
                return reply.code(403).send({ error: 'User is not eligible to join', code: 'ineligible' })
            if (!await getUserById(subject))
                return reply.code(403).send({ error: 'User is not eligible to join', code: 'ineligible' })
            const server = await getServerForJoin(id)
            if (!server)
                return reply.code(404).send({ error: 'Game server not found', code: 'offline' })
            const denial = evaluateJoinServer(server, compatibility, getServerDiscoveryCutoff())
            if (denial) {
                const status = denial === 'capacity' ? 409 : denial === 'incompatible' ? 412 : 503
                return reply.code(status).send({ error: `Join denied: ${denial}`, code: denial })
            }
            const issued = issueJoinTicket(subject, server.id, env.JOIN_TICKET_SECRET,
                env.JOIN_TICKET_AUDIENCE, env.JOIN_TICKET_TTL_SECONDS)
            request.log.info({ serverId: server.id, subject }, 'Issued short-lived game join ticket')
            return {
                websocketUrl: server.websocketUrl,
                ticket: issued.ticket,
                expiresAt: new Date(issued.claims.exp * 1000).toISOString(),
            }
        }
    )

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
                mapFormatVersion: number
                mapContentHash: string
                mode: string
                websocketUrl: string
            }
            const { id, host, port, region, maxPlayers, buildId,
                protocolVersion, mapId, mapFormatVersion, mapContentHash, mode, websocketUrl } = body

            try {
                await registerGameServer(id, host, port, region, maxPlayers,
                    buildId, protocolVersion, mapId, mapFormatVersion,
                    mapContentHash, mode, websocketUrl)

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
