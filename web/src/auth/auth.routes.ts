import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import {
    registerUser,
    authenticateUser,
    generateAccessToken,
    getUserById,
} from './auth.service'
import { CONSTANTS } from '../config/constants'
import { authenticateRequest } from '../middleware/auth'
import type { User } from '../types/shared'

const authRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * POST /auth/register
     * Creates a new user account
     */
    fastify.post(
        '/register',
        {
            schema: {
                body: z.object({
                    username: z
                        .string()
                        .min(CONSTANTS.MIN_USERNAME_LENGTH)
                        .max(CONSTANTS.MAX_USERNAME_LENGTH),
                    email: z.string().email().optional(),
                    password: z
                        .string()
                        .min(CONSTANTS.MIN_PASSWORD_LENGTH)
                        .max(CONSTANTS.MAX_PASSWORD_LENGTH),
                }),
            },
        },
        async (request, reply) => {
            const body = request.body as unknown as {
                username: string
                email?: string
                password: string
            }
            const { username, email, password } = body

            try {
                const user = await registerUser(username, password, email)

                // Generate access token
                const accessToken = generateAccessToken(user)

                // Set HTTP-only cookie
                reply.setCookie(CONSTANTS.COOKIE_ACCESS_TOKEN, accessToken, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'strict',
                    path: '/',
                    maxAge: 15 * 60, // 15 minutes in seconds
                })

                const userResponse: User = {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    createdAt: user.createdAt,
                }

                return { user: userResponse }
            } catch (err) {
                const error = err as Error
                return reply.code(400).send({
                    error: error.message,
                    code: '400',
                })
            }
        }
    )

    /**
     * POST /auth/login
     * Authenticates a user
     */
    fastify.post(
        '/login',
        {
            schema: {
                body: z.object({
                    usernameOrEmail: z.string(),
                    password: z.string(),
                }),
            },
        },
        async (request, reply) => {
            const body = request.body as unknown as {
                usernameOrEmail: string
                password: string
            }
            const { usernameOrEmail, password } = body

            try {
                const user = await authenticateUser(usernameOrEmail, password)

                // Generate access token
                const accessToken = generateAccessToken(user)

                // Set HTTP-only cookie
                reply.setCookie(CONSTANTS.COOKIE_ACCESS_TOKEN, accessToken, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'strict',
                    path: '/',
                    maxAge: 15 * 60, // 15 minutes in seconds
                })

                // Log successful login
                request.log.info(
                    { userId: user.id, username: user.username },
                    'User logged in'
                )

                const userResponse: User = {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    createdAt: user.createdAt,
                }

                return { user: userResponse }
            } catch (err) {
                const error = err as Error

                // Log auth failure (but not the password)
                request.log.warn({ usernameOrEmail }, 'Login failed')

                return reply.code(401).send({
                    error: error.message,
                    code: '401',
                })
            }
        }
    )

    /**
     * POST /auth/logout
     * Clears auth cookies
     */
    fastify.post('/logout', async (_request, reply) => {
        reply.clearCookie(CONSTANTS.COOKIE_ACCESS_TOKEN, {
            path: '/',
        })

        return { message: 'Logged out' }
    })

    /**
     * GET /auth/me
     * Returns current authenticated user
     */
    fastify.get(
        '/me',
        {
            preHandler: authenticateRequest,
        },
        async (request, reply) => {
            const userId = (request as any).userId as string

            const user = await getUserById(userId)

            if (!user) {
                return reply.code(404).send({
                    error: 'User not found',
                    code: '404',
                })
            }

            const userResponse: User = {
                id: user.id,
                username: user.username,
                email: user.email,
                createdAt: user.createdAt,
            }

            return { user: userResponse }
        }
    )
}

export default authRoutes
