"use client";

import React, { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getStagerDesk, listStagersForHolds, reassignHold, releaseHold, takeDivision } from "@/actions/staging";
import { useLiveEvents } from "@/hooks/useLiveEvents";
import { useFallbackPoll } from "@/hooks/useFallbackPoll";
import type { DeskItem } from "@/lib/local/stagingView";
import { EVENT_LABEL, sinceLabel, statusPill, tatamiLine } from "@/components/stager/local/format";

/**
 * The admin's view of the stager desk: who is preparing which category, how far
 * each one is, and the admin's hand on holds (release one, or hand it to another
 * signed-in stager, with a reason). Opening a category shows its groups; the
 * admin changes them only after taking it.
 */

type Desk = Awaited<ReturnType<typeof getStagerDesk>>;
type Stager = Awaited<ReturnType<typeof listStagersForHolds>>[number];
type Form = { divisionId: string; kind: "release" | "reassign" } | null;

const btn = "h-10 px-3 border border-outline-variant rounded text-sm font-semibold hover:bg-surface-container-low disabled:opacity-50 flex items-center gap-1.5";

export default function StagingOverviewClient({ tournamentId, initialDesk, initialStagers }: { tournamentId: string; initialDesk: Desk; initialStagers: Stager[] }) {
  const router = useRouter();
  const [desk, setDesk] = useState(initialDesk);
  const [stagers, setStagers] = useState(initialStagers);
  const [form, setForm] = useState<Form>(null);
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ divisionId: string; text: string } | null>(null);

  const seq = useRef(0);
  const refresh = useCallback(async () => {
    const n = ++seq.current;
    try {
      const [nextDesk, nextStagers] = await Promise.all([getStagerDesk(tournamentId), listStagersForHolds(tournamentId)]);
      if (n !== seq.current) return;
      setDesk(nextDesk);
      setStagers(nextStagers);
    } catch (err) {
      console.error("Couldn't refresh staging:", err);
    }
  }, [tournamentId]);
  const { connected } = useLiveEvents({ tournamentId }, () => void refresh(), { feed: "staff", debounceMs: 400 });
  useFallbackPoll(refresh, connected);

  const open = (divisionId: string) => `/admin/event/${tournamentId}/staging/${divisionId}`;
  const count = (s: DeskItem["status"]) => desk.items.filter((i) => i.status === s && (i.athletes > 0 || s === "held")).length;

  const act = async (divisionId: string, fn: () => Promise<{ success: boolean; error?: string }>, after?: () => void) => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fn();
      if (!res.success) setProblem({ divisionId, text: res.error ?? "That didn't work." });
      else {
        setForm(null);
        setReason("");
        setTarget("");
        after?.();
      }
      await refresh();
    } catch (err) {
      console.error("Staging change failed:", err);
      setProblem({ divisionId, text: "That didn't work. Try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full space-y-5 bg-surface p-4 pb-24 sm:p-6 md:p-margin-desktop">
      <div>
        <h2 className="font-headline-sm text-headline-sm text-primary">Staging</h2>
        <p className="text-body-sm text-on-surface-variant">
          {count("held")} being prepared · {count("waiting") + count("partly")} still to prepare · {count("sent")} sent · {count("done")} finished ·{" "}
          {stagers.length} stager{stagers.length === 1 ? "" : "s"} signed in
        </p>
      </div>

      {desk.items.length === 0 ? (
        <p className="rounded border border-dashed border-outline-variant p-6 text-center text-sm text-on-surface-variant">
          No categories yet. <Link className="text-secondary underline" href={`/admin/event/${tournamentId}/categories`}>Set them up</Link> first.
        </p>
      ) : (
        <ul className="divide-y divide-outline-variant overflow-hidden rounded border border-outline-variant bg-white">
          {desk.items.map((item) => {
            const pill = statusPill(item);
            const formOpen = form?.divisionId === item.divisionId ? form.kind : null;
            const quiet = sinceLabel(item.holderActiveAt);
            return (
              <li key={item.divisionId} className="p-3 sm:p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-[200px] flex-1">
                    <Link href={open(item.divisionId)} className="text-[15px] font-bold text-primary hover:underline">
                      {item.name}
                    </Link>
                    <p className="text-[12.5px] text-on-surface-variant">
                      {tatamiLine(item.tatami)} ·{" "}
                      {item.events.map((e) => `${EVENT_LABEL[e.eventType]} ${e.participants} (${e.locked}/${e.groups} sent)`).join(" · ") || "no events"}
                    </p>
                    {item.holderName && (
                      <p className="mt-0.5 text-[12.5px] text-on-surface">
                        Held by <span className="font-semibold">{item.isMine ? "you" : item.holderName}</span>
                        {item.holderLabel ? ` (${item.holderLabel})` : ""}
                        {quiet ? ` · last change ${quiet}` : ""}
                      </p>
                    )}
                  </div>
                  <span className={`shrink-0 rounded-[999px] border px-2.5 py-1 text-[11px] font-bold ${pill.tone}`}>{pill.label}</span>
                  <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                    <Link href={open(item.divisionId)} className={btn}>
                      <span className="material-symbols-outlined text-[18px]">visibility</span> Open
                    </Link>
                    {!item.holderName && !desk.mine && item.athletes > 0 && (item.status === "waiting" || item.status === "partly") && (
                      <button className={btn} disabled={busy} onClick={() => void act(item.divisionId, () => takeDivision(item.divisionId), () => router.push(open(item.divisionId)))}>
                        <span className="material-symbols-outlined text-[18px]">front_hand</span> Take
                      </button>
                    )}
                    {item.holderName && (
                      <button className={btn} disabled={busy} onClick={() => setForm({ divisionId: item.divisionId, kind: "release" })}>
                        <span className="material-symbols-outlined text-[18px]">lock_open</span> Release
                      </button>
                    )}
                    {item.athletes > 0 && item.status !== "sent" && item.status !== "done" && stagers.length > 0 && (
                      <button className={btn} disabled={busy} onClick={() => setForm({ divisionId: item.divisionId, kind: "reassign" })}>
                        <span className="material-symbols-outlined text-[18px]">swap_horiz</span> Hand to…
                      </button>
                    )}
                  </div>
                </div>

                {formOpen && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded bg-surface-container-low p-3">
                    {formOpen === "reassign" && (
                      <select value={target} onChange={(e) => setTarget(e.target.value)} className="h-10 rounded border border-outline-variant bg-white px-2 text-sm" aria-label="Stager">
                        <option value="">Choose a stager</option>
                        {stagers.map((s) => (
                          <option key={s.requestId} value={s.requestId}>
                            {s.name}
                            {s.label ? ` (${s.label})` : ""}
                          </option>
                        ))}
                      </select>
                    )}
                    <input
                      autoFocus
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder={formOpen === "release" ? "Why release it? e.g. stager left the hall" : "Why hand it on?"}
                      className="h-10 min-w-[220px] flex-1 rounded border border-outline-variant bg-white px-3 text-sm"
                    />
                    <button
                      className="h-10 rounded bg-primary px-4 text-sm font-semibold text-on-primary disabled:opacity-50"
                      disabled={busy || reason.trim().length < 3 || (formOpen === "reassign" && !target)}
                      onClick={() =>
                        void act(item.divisionId, () => (formOpen === "release" ? releaseHold(item.divisionId, reason) : reassignHold(item.divisionId, target, reason)))
                      }
                    >
                      {formOpen === "release" ? "Release" : "Hand it on"}
                    </button>
                    <button className="h-10 px-3 text-sm font-semibold" onClick={() => setForm(null)}>
                      Cancel
                    </button>
                    <p className="w-full text-[12px] text-on-surface-variant">
                      {formOpen === "release"
                        ? "The groups stay as they are; anyone can take the category next."
                        : "The chosen stager holds it at once. If they already hold another category, hand that one back first."}
                    </p>
                  </div>
                )}
                {problem?.divisionId === item.divisionId && <p className="mt-2 rounded bg-error-container px-3 py-2 text-sm text-on-error-container">{problem.text}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
