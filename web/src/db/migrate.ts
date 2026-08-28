import 'dotenv/config'
import { existsSync } from 'node:fs'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

async function runMigrations() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
    })

    const db = drizzle(pool)

    console.log('Running migrations...')

    // Containers run compiled code even when configured for local-development
    // behavior, so select source migrations only when that directory exists.
    const migrationsFolder = existsSync('./src/db/migrations')
        ? './src/db/migrations'
        : './dist/db/migrations'

    await migrate(db, { migrationsFolder })

    console.log('Migrations complete')

    await pool.end()
}

runMigrations().catch((err) => {
    console.error('Migration failed:', err)
    process.exit(1)
})
