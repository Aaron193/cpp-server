import 'dotenv/config';
import { initDatabase, getDb, closeDatabase } from './client';
import { changelogEntries, playerStats } from './schema';

/**
 * Seed script to populate initial data for development/testing
 * Run with: npx tsx src/db/seed.ts
 */

const sampleChangelog = [
  {
    version: 'v0.3.0',
    tag: 'new' as const,
    changes: [
      'Added new home screen UI with server browser',
      'Implemented leaderboard system',
      'Added player name customization',
      'New modal system for login, leaderboard, and changelog',
    ],
    publishedAt: new Date('2024-12-31'),
  },
  {
    version: 'v0.2.1',
    tag: 'fix' as const,
    changes: [
      'Fixed server connection stability issues',
      'Resolved chat message display bugs',
      'Performance improvements for large lobbies',
    ],
    publishedAt: new Date('2024-12-28'),
  },
  {
    version: 'v0.2.0',
    tag: 'update' as const,
    changes: [
      'New terrain rendering system',
      'Improved player interpolation',
      'Added chat bubbles above players',
    ],
    publishedAt: new Date('2024-12-20'),
  },
  {
    version: 'v0.1.0',
    tag: 'new' as const,
    changes: [
      'Initial game release',
      'Basic multiplayer functionality',
      'Simple combat system',
    ],
    publishedAt: new Date('2024-12-01'),
  },
];

const sampleLeaderboard = [
  { guestName: 'xXSlayerXx', score: 15420, kills: 892, deaths: 234, wins: 156, gamesPlayed: 412, playTimeSeconds: 86400 },
  { guestName: 'ProGamer99', score: 14200, kills: 756, deaths: 198, wins: 142, gamesPlayed: 380, playTimeSeconds: 72000 },
  { guestName: 'NightHawk', score: 13890, kills: 701, deaths: 210, wins: 138, gamesPlayed: 356, playTimeSeconds: 68000 },
  { guestName: 'ShadowBlade', score: 12450, kills: 623, deaths: 245, wins: 121, gamesPlayed: 340, playTimeSeconds: 54000 },
  { guestName: 'ThunderStrike', score: 11200, kills: 589, deaths: 267, wins: 108, gamesPlayed: 312, playTimeSeconds: 48000 },
  { guestName: 'IceQueen', score: 10800, kills: 534, deaths: 189, wins: 99, gamesPlayed: 289, playTimeSeconds: 42000 },
  { guestName: 'FireDemon', score: 9950, kills: 498, deaths: 201, wins: 91, gamesPlayed: 267, playTimeSeconds: 36000 },
  { guestName: 'StormChaser', score: 9200, kills: 456, deaths: 223, wins: 84, gamesPlayed: 245, playTimeSeconds: 32000 },
  { guestName: 'DarkKnight', score: 8700, kills: 423, deaths: 234, wins: 78, gamesPlayed: 223, playTimeSeconds: 28000 },
  { guestName: 'LightningBolt', score: 8100, kills: 398, deaths: 245, wins: 72, gamesPlayed: 201, playTimeSeconds: 24000 },
];

async function seed() {
  console.log('🌱 Starting database seed...');
  
  await initDatabase();
  const db = getDb();

  try {
    // Clear existing data
    console.log('Clearing existing changelog entries...');
    await db.delete(changelogEntries);
    
    console.log('Clearing existing player stats...');
    await db.delete(playerStats);

    // Insert changelog entries
    console.log('Inserting changelog entries...');
    await db.insert(changelogEntries).values(sampleChangelog);
    console.log(`✓ Inserted ${sampleChangelog.length} changelog entries`);

    // Insert player stats
    console.log('Inserting sample leaderboard data...');
    await db.insert(playerStats).values(sampleLeaderboard);
    console.log(`✓ Inserted ${sampleLeaderboard.length} player stats entries`);

    console.log('✅ Seed completed successfully!');
  } catch (error) {
    console.error('❌ Seed failed:', error);
    throw error;
  } finally {
    await closeDatabase();
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
