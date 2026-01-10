import { FastifyPluginAsync } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { CONSTANTS } from '../config/constants'

/**
 * Create rate limiter for auth routes
 * Higher rate limit for auth routes to prevent brute force
 */
export const authRateLimiter: FastifyPluginAsync = async (fastify) => {
    await fastify.register(rateLimit, {
        max: CONSTANTS.RATE_LIMIT_MAX,
        timeWindow: CONSTANTS.RATE_LIMIT_WINDOW_MS,
    })
}
