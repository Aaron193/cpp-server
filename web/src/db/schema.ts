import { pgTable, uuid, text, timestamp, integer, boolean, index, bigint } from 'drizzle-orm/pg-core';
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

/**
 * Player stats table - tracks player performance for leaderboard
 */
export const playerStats = pgTable('player_stats', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  guestName: text('guest_name'), // For non-logged-in players
  score: bigint('score', { mode: 'number' }).notNull().default(0),
  kills: integer('kills').notNull().default(0),
  deaths: integer('deaths').notNull().default(0),
  wins: integer('wins').notNull().default(0),
  gamesPlayed: integer('games_played').notNull().default(0),
  playTimeSeconds: integer('play_time_seconds').notNull().default(0),
  lastPlayedAt: timestamp('last_played_at').notNull().default(sql`now()`),
  createdAt: timestamp('created_at').notNull().default(sql`now()`),
}, (table) => ({
  scoreIdx: index('player_stats_score_idx').on(table.score),
  userIdIdx: index('player_stats_user_id_idx').on(table.userId),
  lastPlayedAtIdx: index('player_stats_last_played_at_idx').on(table.lastPlayedAt),
}));

/**
 * Changelog entries table - stores game update notes
 */
export const changelogEntries = pgTable('changelog_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  version: text('version').notNull(),
  tag: text('tag').notNull(), // 'new', 'fix', 'update'
  changes: text('changes').array().notNull(), // Array of change descriptions
  publishedAt: timestamp('published_at').notNull().default(sql`now()`),
  createdAt: timestamp('created_at').notNull().default(sql`now()`),
}, (table) => ({
  publishedAtIdx: index('changelog_entries_published_at_idx').on(table.publishedAt),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type GameServer = typeof gameServers.$inferSelect;
export type NewGameServer = typeof gameServers.$inferInsert;

export type PlayerStats = typeof playerStats.$inferSelect;
export type NewPlayerStats = typeof playerStats.$inferInsert;

export type ChangelogEntry = typeof changelogEntries.$inferSelect;
export type NewChangelogEntry = typeof changelogEntries.$inferInsert;
