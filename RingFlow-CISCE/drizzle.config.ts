import { defineConfig } from 'drizzle-kit';
import fs from 'fs';
import path from 'path';

function loadEnv(file: string) {
  try {
    const p = path.resolve(process.cwd(), file);
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
}

loadEnv('.env.local');
loadEnv('.env');

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (.env.local, .env, or the command line).');
  return url;
}

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: requireDatabaseUrl(),
  },
});
