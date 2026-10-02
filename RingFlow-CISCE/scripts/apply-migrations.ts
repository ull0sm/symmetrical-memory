import "./loadEnv";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

/**
 * Apply the hand-written SQL migrations (migration8 onward) in order. Each is
 * idempotent, so running this again is safe. Run after `npm run db:push`,
 * which creates the tables from the Drizzle schema; these add what Drizzle
 * can't express (triggers, backfills, data fixes).
 *
 *   npm run db:migrate
 */

const FIRST = 8;
const dir = path.resolve(process.cwd(), "supabase/migrations");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set (.env.local, .env, or the command line).");
    process.exit(1);
  }
  const files = fs
    .readdirSync(dir)
    .map((f) => ({ f, n: Number(/^migration(\d+)_.*\.sql$/.exec(f)?.[1]) }))
    .filter((m) => Number.isInteger(m.n) && m.n >= FIRST)
    .sort((a, b) => a.n - b.n);

  const host = url.replace(/^.*@/, "").replace(/\?.*$/, "");
  console.log(`Applying ${files.length} migrations to ${host}`);
  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    for (const { f } of files) {
      process.stdout.write(`  ${f} ... `);
      await sql.unsafe(fs.readFileSync(path.join(dir, f), "utf8"));
      console.log("ok");
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("\nMigration failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
