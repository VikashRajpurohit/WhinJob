import { useMigrations } from 'drizzle-orm/expo-sqlite/migrator';
import { db } from './client';
import migrations from './migrations/migrations';

/**
 * Runs pending local migrations at startup. Every read resolves from SQLite
 * (hard rule 3), so nothing may render before this resolves.
 */
export function useLocalMigrations() {
  return useMigrations(db, migrations);
}
