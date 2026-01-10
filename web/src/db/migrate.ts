import 'dotenv/config'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

async function runMigrations() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
    })

    const db = drizzle(pool)

    console.log('Running migrations...')

    // Use different path for production (compiled) vs development
    const migrationsFolder =
        process.env.NODE_ENV === 'production'
            ? './dist/db/migrations'
            : './src/db/migrations'

    await migrate(db, { migrationsFolder })

    console.log('Migrations complete')

    await pool.end()
}

runMigrations().catch((err) => {
    console.error('Migration failed:', err)
    process.exit(1)
})
