import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import path from 'path'
import { env } from './config/env'
import { CONSTANTS } from './config/constants'
import type { ErrorResponse } from './types/shared'
import {
    serializerCompiler,
    validatorCompiler,
    type ZodTypeProvider,
} from 'fastify-type-provider-zod'

export async function createServer() {
    const fastify = Fastify({
        logger: {
            level: env.NODE_ENV === 'production' ? 'info' : 'debug',
            redact: ['req.headers.authorization', 'req.headers.cookie'],
        },
    }).withTypeProvider<ZodTypeProvider>()

    // Set validation and serialization
    fastify.setValidatorCompiler(validatorCompiler)
    fastify.setSerializerCompiler(serializerCompiler)

    // Register plugins
    await fastify.register(cookie)

    await fastify.register(cors, {
        origin:
            env.NODE_ENV === 'production'
                ? [
                      'http://localhost',
                      'http://localhost:80',
                      process.env.CLIENT_ORIGIN || 'http://localhost',
                  ]
                : true,
        credentials: true,
    })

    await fastify.register(rateLimit, {
        max: CONSTANTS.RATE_LIMIT_MAX,
        timeWindow: CONSTANTS.RATE_LIMIT_WINDOW_MS,
    })

    // Serve static client files
    await fastify.register(fastifyStatic, {
        root: path.join(__dirname, 'static', 'client'),
        prefix: '/',
    })

    // Global error handler
    fastify.setErrorHandler((error, request, reply) => {
        const errorResponse: ErrorResponse = {
            error: error.message || 'Internal server error',
            code: error.statusCode?.toString() || '500',
        }

        // Log error without sensitive data
        request.log.error({
            statusCode: error.statusCode || 500,
            message: error.message,
            path: request.url,
        })

        // Don't send stack traces in production
        if (env.NODE_ENV === 'development') {
            request.log.error(error.stack)
        }

        reply.status(error.statusCode || 500).send(errorResponse)
    })

    // Health check
    fastify.get('/health', async () => {
        return { status: 'ok' }
    })

    return fastify
}
