import nextEnv from "@next/env";

/**
 * Load .env / .env.local the same way the Next app does, before anything opens
 * a database connection. Variables already set on the command line win.
 * Import this first in every script.
 */
nextEnv.loadEnvConfig(process.cwd());
