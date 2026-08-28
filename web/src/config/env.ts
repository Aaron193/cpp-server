import { z } from 'zod'

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'production']).default('development'),
    PORT: z.string().default('3000'),
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z.string().min(1),
    JWT_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
    SERVER_SHARED_SECRET: z.string().min(1),
    JOIN_TICKET_SECRET: z.string().min(32),
    JOIN_TICKET_AUDIENCE: z.string().min(1).max(64).default('arena-game-server'),
    JOIN_TICKET_TTL_SECONDS: z.coerce.number().int().min(15).max(30).default(20),
    // Local browser demos can opt in to a non-persistent guest identity. The
    // route additionally requires NODE_ENV=development, so this cannot weaken
    // an authenticated production deployment by accident.
    ALLOW_GUEST_JOINS: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
})

export type Env = z.infer<typeof envSchema>

export function parseEnv(): Env {
    const result = envSchema.safeParse(process.env)

    if (!result.success) {
        console.error('Environment variable validation failed:')
        console.error(result.error.format())
        process.exit(1)
    }

    return result.data
}

export const env = parseEnv()
