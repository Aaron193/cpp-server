import { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken } from '../auth/auth.service';
import { CONSTANTS } from '../config/constants';
import { env } from '../config/env';

/**
 * Middleware to authenticate requests using JWT from HTTP-only cookie
 */
export async function authenticateRequest(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const token = request.cookies[CONSTANTS.COOKIE_ACCESS_TOKEN];

    if (!token) {
      return reply.code(401).send({
        error: 'Authentication required',
        code: '401',
      });
    }

    const payload = verifyAccessToken(token);

    // Attach user ID to request object for use in route handlers
    (request as any).userId = payload.sub;
    (request as any).username = payload.username;
  } catch (err) {
    return reply.code(401).send({
      error: 'Invalid or expired token',
      code: '401',
    });
  }
}

/**
 * Middleware to authenticate game server requests using shared secret
 */
export async function authenticateGameServer(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader) {
    return reply.code(401).send({
      error: 'Authorization header required',
      code: '401',
    });
  }

  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || token !== env.SERVER_SHARED_SECRET) {
    // Log unauthorized server access attempt
    request.log.warn({ ip: request.ip }, 'Unauthorized game server access attempt');
    
    return reply.code(401).send({
      error: 'Invalid server credentials',
      code: '401',
    });
  }
}
