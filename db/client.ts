import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';
import * as schema from './schema';

export const DATABASE_NAME = 'job_hunt.db';

const sqlite = openDatabaseSync(DATABASE_NAME, { enableChangeListener: true });

/** WAL keeps background sync writes from blocking list reads on the UI thread. */
sqlite.execSync('PRAGMA journal_mode = WAL;');
sqlite.execSync('PRAGMA foreign_keys = ON;');

export const db = drizzle(sqlite, { schema });

export type Database = typeof db;
