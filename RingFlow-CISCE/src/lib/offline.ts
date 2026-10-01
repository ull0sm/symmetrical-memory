/**
 * Detects whether RingFlow is running in offline / air-gapped LAN mode.
 * Supports various common environment variable names and truthy values,
 * including common typos like "ture".
 */
export function isOfflineMode(): boolean {
  const envVal =
    process.env.NEXT_PUBLIC_OFFLINE_MODE ??
    process.env.OFFLINE_MODE ??
    process.env.offline_mode ??
    "";

  const val = String(envVal).trim().toLowerCase();
  return val === "true" || val === "1" || val === "yes" || val === "ture";
}

/**
 * Checks if Cloudflare Turnstile should be rendered and validated.
 * Returns false if offline mode is active, or if site key is absent / set to "disabled".
 */
export function isTurnstileEnabled(): boolean {
  if (isOfflineMode()) {
    return false;
  }
  const siteKey = (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "").trim();
  if (!siteKey || siteKey === "disabled") {
    return false;
  }
  return true;
}
