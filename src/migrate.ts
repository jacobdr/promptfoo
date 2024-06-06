import * as path from 'path';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import logger from './logger';
import { getDb } from './database';
import { getDirectory } from './esm';

function isMain(): boolean {
  if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    // CommonJS environment
    return true;
  } else if (
    // @ts-expect-error in a CJS setting this will fail
    typeof global['import'] !== 'undefined' &&
    // @ts-ignore in a CJS setting this will fail
    typeof import.meta !== 'undefined' &&
    // @ts-ignore in a CJS setting this will fail
    import.meta.url === `file://${process.argv[1]}`
  ) {
    // ESM environment
    return true;
  }
  return false;
}

async function getMigrationDirectory(): Promise<string> {
  return path.join(getDirectory(), '..', 'drizzle');
}

/**
 * Run migrations on the database, skipping the ones already applied. Also creates the sqlite db if it doesn't exist.
 */
export async function runDbMigrations() {
  try {
    const db = getDb();
    const migrationsFolder = await getMigrationDirectory();
    logger.debug(`Running migrations from ${migrationsFolder}...`);
    await migrate(db, { migrationsFolder });
  } catch (error) {
    logger.error('Error running database migrations:', error);
  }
}

if (isMain()) {
  runDbMigrations();
}
