"use client";

import React, { useEffect } from "react";
import type { WorkspaceAthlete, WorkspaceGroup } from "@/lib/local/stagingView";
import type { DivisionEventType } from "@/lib/statuses";
import GroupDraw from "./GroupDraw";

/**
 * The one confirmation before a group goes to its tatami: the group exactly as it
 * will be drawn, where it goes, and anything worth a second look. Nothing here
 * can change the draw; closing the sheet goes back to editing.
 */
export default function LockSheet({
  group,
  eventType,
  athleteOf,
  ringName,
  busy,
  onConfirm,
  onClose,
}: {
  group: WorkspaceGroup;
  eventType: DivisionEventType;
  athleteOf: (id: string) => WorkspaceAthlete | undefined;
  ringName: string | null;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const blocked = group.blockers.length > 0;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="lock-title">
      <div className="flex max-h-[92vh] w-full max-w-xl flex-col rounded-t-2xl bg-[var(--canvas)] shadow-xl sm:rounded-2xl">
        <div className="flex items-start gap-3 border-b border-[var(--line)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-black uppercase tracking-wider text-[var(--ink-400)]">Lock and send</p>
            <h2 id="lock-title" className="text-[17px] font-extrabold leading-snug text-[var(--ink-900)]">{group.name}</h2>
            <p className="text-[12.5px] text-[var(--ink-500)]">
              {group.members.length} athlete{group.members.length === 1 ? "" : "s"} · {ringName ? `goes to ${ringName}` : "no tatami yet: the admin assigns one"}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-[var(--line)]">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {group.blockers.map((b) => (
            <p key={b} className="flex gap-2 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-900">
              <span className="material-symbols-outlined text-[18px]">block</span>
              {b}
            </p>
          ))}
          {group.warnings.map((w) => (
            <p key={w} className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
              <span className="material-symbols-outlined text-[18px]">warning</span>
              {w}
            </p>
          ))}
          <GroupDraw group={group} eventType={eventType} athleteOf={athleteOf} />
          <p className="text-[12px] text-[var(--ink-500)]">
            Once locked, only the admin can change this group. The moderator can start it when its turn comes.
          </p>
        </div>

        <div className="border-t border-[var(--line)] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || blocked}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] text-[15px] font-bold text-white hover:bg-[var(--accent-dark)] disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[20px]">lock</span>
            {busy ? "Locking…" : blocked ? "Fix the problems above first" : ringName ? `Lock and send to ${ringName}` : "Lock"}
          </button>
        </div>
      </div>
    </div>
  );
}
