"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveEvents } from "@/hooks/useLiveEvents";

export type AccessRequestResult = {
  status: string;
  [key: string]: unknown;
};

export type WaitingState = "pending" | "approved" | "rejected";

const ENDED_MESSAGES: Record<string, string> = {
  rejected: "The administrator declined your request.",
  revoked: "This access was revoked by the administrator.",
  expired: "This request has expired. Please request access again.",
  not_found: "This request no longer exists. Please request access again.",
  approved_elsewhere:
    "This request was approved, but it was made from a different device or browser. Request access again from this device.",
};

/**
 * Waiting-room state machine shared by the moderator, stager and organiser
 * screens. The server sets the httpOnly session cookie inside `check()` when it
 * reports "approved"; this hook never touches the session itself.
 */
export function useAccessRequestStatus(
  requestId: string,
  check: (requestId: string) => Promise<AccessRequestResult>,
  onApproved: (result: AccessRequestResult) => void,
  pollMs = 5000
) {
  const [state, setState] = useState<WaitingState>("pending");
  const [message, setMessage] = useState<string>("");
  const done = useRef(false);
  const onApprovedRef = useRef(onApproved);
  useEffect(() => {
    onApprovedRef.current = onApproved;
  }, [onApproved]);

  const run = useCallback(async () => {
    if (done.current) return;
    try {
      const res = await check(requestId);
      if (done.current) return;
      if (res.status === "approved") {
        done.current = true;
        setState("approved");
        onApprovedRef.current(res);
      } else if (res.status !== "pending") {
        done.current = true;
        setState("rejected");
        setMessage(ENDED_MESSAGES[res.status] ?? ENDED_MESSAGES.rejected);
      }
    } catch (err) {
      console.error("[waiting-room] status check failed:", err);
    }
  }, [check, requestId]);

  useLiveEvents({ requestId }, () => void run());

  useEffect(() => {
    void run();
    const timer = setInterval(() => void run(), pollMs);
    return () => clearInterval(timer);
  }, [run, pollMs]);

  return { state, message };
}
