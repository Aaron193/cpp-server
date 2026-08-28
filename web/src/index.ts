import 'dotenv/config'
import { createServer } from './server'
import { env } from './config/env'
import { initDatabase } from './db/client'
import { startCleanupJob } from './servers/servers.service'

async function main() {
    try {
        // Initialize database
        await initDatabase()

        // Create Fastify server
        const server = await createServer()

        // Register routes
        const { default: authRoutes } = await import('./auth/auth.routes')
        const { default: usersRoutes } = await import('./users/users.routes')
        const { default: serversRoutes } = await import(
            './servers/servers.routes'
        )
        const { default: leaderboardRoutes } = await import(
            './leaderboard/leaderboard.routes'
        )
        const { default: changelogRoutes } = await import(
            './changelog/changelog.routes'
        )

        await server.register(authRoutes, { prefix: '/auth' })
        await server.register(usersRoutes, { prefix: '/users' })
        await server.register(serversRoutes, { prefix: '/servers' })
        await server.register(leaderboardRoutes, { prefix: '/leaderboard' })
        await server.register(changelogRoutes, { prefix: '/changelog' })

        // Start cleanup job for expired servers
        startCleanupJob()

        // Start server
        const port = parseInt(env.PORT, 10)
        // The optional guest-ticket route is intentionally local-only. Keep
        // development listeners on loopback so it is never reachable from the
        // LAN; production containers still bind their internal interface.
        const host = env.NODE_ENV === 'development' ? '127.0.0.1' : '0.0.0.0'
        await server.listen({ port, host })

        console.log(`Server listening on port ${port}`)
    } catch (err) {
        console.error('Failed to start server:', err)
        process.exit(1)
    }
}

main()
