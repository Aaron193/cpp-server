import { pgTable, uuid, text, timestamp, integer, boolean, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Users table - represents player accounts
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull().unique(),
  email: text('email').unique(),
  passwordHash: text('password_hash').notNull(),
  emailVerifiedAt: timestamp('email_verified_at'),
  createdAt: timestamp('created_at').notNull().default(sql`now()`),
});

/**
 * Sessions table - for refresh tokens (optional, not using initially)
 */
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().default(sql`now()`),
});

/**
 * Game servers table - registered C++ game servers
 */
export const gameServers = pgTable('game_servers', {
  id: text('id').primaryKey(),
  host: text('host').notNull(),
  port: integer('port').notNull(),
  region: text('region').notNull(),
  maxPlayers: integer('max_players').notNull(),
  currentPlayers: integer('current_players').notNull().default(0),
  lastHeartbeat: timestamp('last_heartbeat').notNull().default(sql`now()`),
  isOnline: boolean('is_online').notNull().default(true),
}, (table) => ({
  regionIdx: index('game_servers_region_idx').on(table.region),
  isOnlineIdx: index('game_servers_is_online_idx').on(table.isOnline),
  lastHeartbeatIdx: index('game_servers_last_heartbeat_idx').on(table.lastHeartbeat),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type GameServer = typeof gameServers.$inferSelect;
export type NewGameServer = typeof gameServers.$inferInsert;
