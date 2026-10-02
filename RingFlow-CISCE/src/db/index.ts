import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// No fallback: silently connecting to a default local database is how a script
// ends up writing to the wrong one. Next loads .env files for the app; scripts
// load them through scripts/loadEnv.ts.
// `next build` imports this module without a database: give it an address that
// fails fast if anything actually queries during the build.
const connectionString =
  process.env.DATABASE_URL ||
  (process.env.NEXT_PHASE === 'phase-production-build' ? 'postgres://build@127.0.0.1:1/unused' : undefined);
if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Add it to .env.local (see .env.example) or pass it on the command line.');
}

const globalForDb = globalThis as unknown as {
  conn: postgres.Sql | undefined;
};

export const client = globalForDb.conn ?? postgres(connectionString, { max: 10 });
if (process.env.NODE_ENV !== 'production') globalForDb.conn = client;

export const db = drizzle(client, { schema });
export { schema };
