import { getDb } from '../db/client';
import { changelogEntries } from '../db/schema';
import { desc } from 'drizzle-orm';
import type { ChangelogEntryInfo } from '../types/shared';

/**
 * Get all changelog entries, sorted by publish date descending
 */
export async function getChangelog(limit: number = 20): Promise<ChangelogEntryInfo[]> {
  const results = await getDb()
    .select()
    .from(changelogEntries)
    .orderBy(desc(changelogEntries.publishedAt))
    .limit(limit);

  return results.map((entry) => ({
    id: entry.id,
    version: entry.version,
    date: entry.publishedAt.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }),
    tag: entry.tag as 'new' | 'fix' | 'update',
    changes: entry.changes,
  }));
}

/**
 * Create a new changelog entry
 */
export async function createChangelogEntry(
  version: string,
  tag: 'new' | 'fix' | 'update',
  changes: string[],
  publishedAt?: Date
): Promise<void> {
  await getDb().insert(changelogEntries).values({
    version,
    tag,
    changes,
    publishedAt: publishedAt || new Date(),
  });
}
