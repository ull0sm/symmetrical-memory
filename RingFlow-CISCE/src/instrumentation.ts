/**
 * Runs once when the server starts. Validates the environment so a misconfigured
 * deployment stops immediately with a readable message.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validateEnv } = await import("@/lib/env");
  try {
    validateEnv();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    throw err;
  }
}
