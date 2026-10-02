"use client";

import { useEffect, useRef } from "react";
import { LIVE_FALLBACK_POLL_MS } from "@/lib/constants";

/**
 * Polling as a fallback only (PLAN 7.8). While the live stream is connected
 * nothing polls; when it drops, `refresh` runs every `intervalMs`; when it
 * comes back, `refresh` runs once to catch up on anything missed.
 *
 *   const { connected } = useLiveEvents(scope, refresh, { feed: "staff" });
 *   useFallbackPoll(refresh, connected);
 */
export function useFallbackPoll(refresh: () => unknown, connected: boolean, intervalMs = LIVE_FALLBACK_POLL_MS) {
  const fn = useRef(refresh);
  useEffect(() => {
    fn.current = refresh;
  });
  const wasConnected = useRef(connected);

  useEffect(() => {
    if (connected) {
      if (!wasConnected.current) void fn.current();
      wasConnected.current = true;
      return;
    }
    wasConnected.current = false;
    const timer = setInterval(() => void fn.current(), intervalMs);
    return () => clearInterval(timer);
  }, [connected, intervalMs]);
}
