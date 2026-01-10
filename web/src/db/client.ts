import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { env } from '../config/env'
import * as schema from './schema'

export let db: ReturnType<typeof drizzle<typeof schema>> | null = null
let pool: Pool | null = null

export async function initDatabase() {
    if (db) {
        return db
    }

    pool = new Pool({
        connectionString: env.DATABASE_URL,
    })

    // Test connection
    try {
        await pool.query('SELECT NOW()')
        console.log('Database connection established')
    } catch (err) {
        console.error('Failed to connect to database:', err)
        throw err
    }

    db = drizzle(pool, { schema })
    return db
}

export function getDb() {
    if (!db) {
        throw new Error('Database not initialized. Call initDatabase() first.')
    }
    return db
}

export async function closeDatabase() {
    if (pool) {
        await pool.end()
        pool = null
        db = null
    }
}
