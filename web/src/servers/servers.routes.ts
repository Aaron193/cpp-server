import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { registerGameServer, updateHeartbeat, getOnlineServers } from './servers.service';
import { authenticateGameServer } from '../middleware/auth';
import type { GameServerInfo } from '../types/shared';

const serversRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /servers/register
   * Register a game server (requires server shared secret)
   */
  fastify.post('/register', {
    preHandler: authenticateGameServer,
    schema: {
      body: z.object({
        id: z.string(),
        host: z.string(),
        port: z.number().int().positive(),
        region: z.string(),
        maxPlayers: z.number().int().positive(),
      }),
    },
  }, async (request, reply) => {
    const { id, host, port, region, maxPlayers } = request.body;

    try {
      await registerGameServer(id, host, port, region, maxPlayers);

      // Log server registration
      request.log.info({ serverId: id, host, port, region }, 'Game server registered');

      return { message: 'Server registered', serverId: id };
    } catch (err) {
      const error = err as Error;
      reply.code(500).send({
        error: error.message,
        code: '500',
      });
    }
  });

  /**
   * POST /servers/heartbeat
   * Update server heartbeat (requires server shared secret)
   */
  fastify.post('/heartbeat', {
    preHandler: authenticateGameServer,
    schema: {
      body: z.object({
        id: z.string(),
        currentPlayers: z.number().int().min(0),
      }),
    },
  }, async (request, reply) => {
    const { id, currentPlayers } = request.body;

    try {
      await updateHeartbeat(id, currentPlayers);

      return { message: 'Heartbeat updated' };
    } catch (err) {
      const error = err as Error;
      reply.code(500).send({
        error: error.message,
        code: '500',
      });
    }
  });

  /**
   * GET /servers
   * Get list of online game servers (public endpoint)
   */
  fastify.get('/', async (request, reply) => {
    try {
      const servers = await getOnlineServers();

      const response: GameServerInfo[] = servers;

      return { servers: response };
    } catch (err) {
      const error = err as Error;
      reply.code(500).send({
        error: error.message,
        code: '500',
      });
    }
  });
};

export default serversRoutes;
