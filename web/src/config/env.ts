import { z } from 'zod'

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'production']).default('development'),
    PORT: z.string().default('3000'),
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z.string().min(1),
    JWT_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
    SERVER_SHARED_SECRET: z.string().min(1),
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
