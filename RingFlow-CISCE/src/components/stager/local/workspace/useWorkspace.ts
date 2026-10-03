"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getDivisionWorkspace, restoreEventDraft } from "@/actions/staging";
import { useLiveEvents } from "@/hooks/useLiveEvents";
import { useFallbackPoll } from "@/hooks/useFallbackPoll";
import type { EventDraftSnapshot } from "@/lib/local/groupDraft";
import type { DivisionEventType } from "@/lib/statuses";

/**
 * The workspace's state and how it changes: every change is one server action,
 * then a fresh read, so the server stays the single truth. A change that fails
 * says so with a retry; a refusal (stale view, a rule) shows its reason. Draft
 * changes keep an undo point (the event's groups as they were), last 20 only.
 */

export type WorkspaceData = NonNullable<Awaited<ReturnType<typeof getDivisionWorkspace>>>;
export type Notice = { tone: "error" | "info"; text: string; retry?: () => void } | null;
export type Leaving = "lost" | "sent" | "handed-back";

type Outcome = { success: boolean; error?: string };
type Run = <T extends Outcome>(label: string, fn: () => Promise<T>, undoEvent?: DivisionEventType) => Promise<T | null>;

interface UndoEntry {
  label: string;
  eventType: DivisionEventType;
  snapshot: EventDraftSnapshot;
}

const UNDO_DEPTH = 20;

function draftGroupsOf(ws: WorkspaceData, eventType: DivisionEventType) {
  return ws.events.find((e) => e.eventType === eventType)?.groups.filter((g) => !g.locked) ?? [];
}

const snapshotOf = (ws: WorkspaceData, eventType: DivisionEventType): EventDraftSnapshot => ({
  groups: draftGroupsOf(ws, eventType).map((g) => ({ id: g.id, members: g.members, pins: g.pins, seed: g.seed })),
});

const versionsOf = (ws: WorkspaceData, eventType: DivisionEventType) =>
  Object.fromEntries(draftGroupsOf(ws, eventType).map((g) => [g.id, g.version]));

export function useWorkspace(divisionId: string, initial: WorkspaceData, onLeave: (why: Leaving) => void) {
  const [ws, setWs] = useState(initial);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);

  const wsRef = useRef(initial);
  const seq = useRef(0);
  const busy = useRef(false);
  const leaving = useRef<Leaving | null>(null);
  const onLeaveRef = useRef(onLeave);
  useEffect(() => {
    onLeaveRef.current = onLeave;
  });
  const runRef = useRef<Run | null>(null);

  /** Marks that the next "not yours any more" is expected (the last lock, or a hand-back). */
  const expectLeaving = useCallback((why: Leaving | null) => {
    leaving.current = why;
  }, []);

  const refresh = useCallback(async (): Promise<WorkspaceData | null> => {
    const n = ++seq.current;
    try {
      const next = await getDivisionWorkspace(divisionId);
      if (n !== seq.current) return wsRef.current;
      if (!next) {
        onLeaveRef.current(leaving.current ?? "lost");
        return null;
      }
      wsRef.current = next;
      setWs(next);
      if (!next.youHold && leaving.current) onLeaveRef.current(leaving.current);
      return next;
    } catch (err) {
      console.error("Couldn't refresh the category:", err);
      return null;
    }
  }, [divisionId]);

  const { connected } = useLiveEvents({ tournamentId: initial.division.tournamentId }, () => void refresh(), {
    feed: "staff",
    debounceMs: 300,
  });
  useFallbackPoll(refresh, connected);

  /** Runs one change. `undoEvent` keeps an undo point for that event's groups. */
  const run: Run = useCallback(
    async <T extends Outcome>(label: string, fn: () => Promise<T>, undoEvent?: DivisionEventType): Promise<T | null> => {
      if (busy.current) return null;
      busy.current = true;
      setPending(label);
      setNotice(null);
      const snapshot = undoEvent ? snapshotOf(wsRef.current, undoEvent) : null;
      try {
        const res = await fn();
        if (!res.success) {
          setNotice({ tone: "error", text: res.error ?? "That didn't work." });
        } else if (snapshot && undoEvent) {
          setUndoStack((s) => [...s.slice(-(UNDO_DEPTH - 1)), { label, eventType: undoEvent, snapshot }]);
        }
        await refresh();
        return res;
      } catch (err) {
        console.error(`${label} failed:`, err);
        const fresh = await refresh();
        if (fresh) {
          setNotice({
            tone: "error",
            text: `${label}: not saved.`,
            retry: () => void runRef.current?.(label, fn, undoEvent),
          });
        }
        return null;
      } finally {
        busy.current = false;
        setPending(null);
      }
    },
    [refresh]
  );
  useEffect(() => {
    runRef.current = run;
  }, [run]);

  const undo = useCallback(async () => {
    const entry = undoStack.at(-1);
    if (!entry || busy.current) return;
    setUndoStack((s) => s.slice(0, -1));
    const res = await run(`Undo ${entry.label.toLowerCase()}`, () =>
      restoreEventDraft(divisionId, entry.eventType, entry.snapshot, versionsOf(wsRef.current, entry.eventType))
    );
    if (res && !res.success) setUndoStack([]);
    else if (res?.success && res.skipped > 0) {
      setNotice({ tone: "info", text: `Undone. ${res.skipped} athlete${res.skipped === 1 ? " who can't be placed now stays" : "s who can't be placed now stay"} out.` });
    }
  }, [divisionId, run, undoStack]);

  /** Undo points of an event stop making sense once a group is removed or locked. */
  const forgetUndo = useCallback((eventType: DivisionEventType) => {
    setUndoStack((s) => s.filter((e) => e.eventType !== eventType));
  }, []);

  return {
    ws,
    pending,
    notice,
    setNotice,
    refresh,
    run,
    undo,
    canUndo: undoStack.length > 0,
    undoLabel: undoStack.at(-1)?.label ?? null,
    forgetUndo,
    expectLeaving,
  };
}

export type WorkspaceApi = ReturnType<typeof useWorkspace>;
