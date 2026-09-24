import postgres from "postgres";
import fs from "fs";
import path from "path";

function loadEnv(file: string) {
  try {
    const p = path.resolve(process.cwd(), file);
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
}

loadEnv(".env.local");
loadEnv(".env");

const dbUrl =
  process.env.DATABASE_URL ||
  "postgres://event_suite:event_suite@127.0.0.1:5432/ringflow";

console.log("Connecting to PostgreSQL at:", dbUrl.replace(/:[^:@]+@/, ":***@"));

const sql = postgres(dbUrl, { max: 1, connect_timeout: 10 });

async function run() {
  console.log("Applying Kata & Judge schema migrations to database...");

  // 1. Rings: Add judge_pin
  await sql`
    ALTER TABLE rings
    ADD COLUMN IF NOT EXISTS judge_pin TEXT NOT NULL DEFAULT '1234';
  `;
  console.log("✓ rings.judge_pin ensured.");

  // 2. Categories: Add event_type, kata_format, kata_scoring_mode, pool_size, advance_per_pool
  await sql`
    ALTER TABLE categories
    ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'kumite',
    ADD COLUMN IF NOT EXISTS kata_format TEXT NOT NULL DEFAULT 'GROUP_POOLS',
    ADD COLUMN IF NOT EXISTS kata_scoring_mode TEXT NOT NULL DEFAULT 'FLAG',
    ADD COLUMN IF NOT EXISTS pool_size INTEGER NOT NULL DEFAULT 8,
    ADD COLUMN IF NOT EXISTS advance_per_pool INTEGER NOT NULL DEFAULT 2;
  `;
  console.log("✓ categories Kata columns ensured.");

  // 3. Matches: Add kata columns
  await sql`
    ALTER TABLE matches
    ADD COLUMN IF NOT EXISTS kata_scoring_mode TEXT DEFAULT 'FLAG',
    ADD COLUMN IF NOT EXISTS pool_group TEXT,
    ADD COLUMN IF NOT EXISTS aka_kata_name TEXT,
    ADD COLUMN IF NOT EXISTS ao_kata_name TEXT,
    ADD COLUMN IF NOT EXISTS aka_flags INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS ao_flags INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS aka_score_total NUMERIC(5, 2),
    ADD COLUMN IF NOT EXISTS ao_score_total NUMERIC(5, 2);
  `;
  console.log("✓ matches Kata columns ensured.");

  // 4. Create kata_scores table if not exists
  await sql`
    CREATE TABLE IF NOT EXISTS kata_scores (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      athlete_id UUID REFERENCES athletes(id) ON DELETE SET NULL,
      target_side TEXT NOT NULL DEFAULT 'AKA',
      judge_seat INTEGER NOT NULL,
      judge_device_token TEXT,
      score_type TEXT NOT NULL DEFAULT 'FLAG',
      flag_vote TEXT,
      numeric_score NUMERIC(4, 2),
      is_dropped BOOLEAN NOT NULL DEFAULT false,
      is_overridden BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT kata_scores_match_seat_side_unique UNIQUE (match_id, judge_seat, target_side)
    );
  `;
  console.log("✓ kata_scores table ensured.");

  console.log("\n All Kata schema migrations applied successfully!");
  await sql.end();
  process.exit(0);
}

run().catch(async (err) => {
  console.error("Migration error:", err);
  await sql.end().catch(() => {});
  process.exit(1);
});
