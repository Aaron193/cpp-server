import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getChangelog, createChangelogEntry } from './changelog.service';
import { authenticateGameServer } from '../middleware/auth';

const changelogRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /changelog
   * Get changelog entries (public endpoint)
   */
  fastify.get('/', {
    schema: {
      querystring: z.object({
        limit: z.coerce.number().int().min(1).max(50).optional().default(20),
      }),
    },
  }, async (request, reply) => {
    const query = request.query as { limit?: number };
    const limit = query.limit || 20;

    try {
      const entries = await getChangelog(limit);
      return { changelog: entries };
    } catch (err) {
      const error = err as Error;
      request.log.error({ error: error.message }, 'Failed to fetch changelog');
      return reply.code(500).send({
        error: 'Failed to fetch changelog',
        code: '500',
      });
    }
  });

  /**
   * POST /changelog
   * Create a new changelog entry (requires server shared secret for admin)
   */
  fastify.post('/', {
    preHandler: authenticateGameServer,
    schema: {
      body: z.object({
        version: z.string().min(1).max(20),
        tag: z.enum(['new', 'fix', 'update']),
        changes: z.array(z.string().min(1).max(500)).min(1).max(20),
        publishedAt: z.string().datetime().optional(),
      }),
    },
  }, async (request, reply) => {
    const body = request.body as {
      version: string;
      tag: 'new' | 'fix' | 'update';
      changes: string[];
      publishedAt?: string;
    };

    try {
      await createChangelogEntry(
        body.version,
        body.tag,
        body.changes,
        body.publishedAt ? new Date(body.publishedAt) : undefined
      );

      request.log.info({ version: body.version }, 'Changelog entry created');
      return { message: 'Changelog entry created' };
    } catch (err) {
      const error = err as Error;
      request.log.error({ error: error.message }, 'Failed to create changelog entry');
      return reply.code(500).send({
        error: 'Failed to create changelog entry',
        code: '500',
      });
    }
  });
};

export default changelogRoutes;
