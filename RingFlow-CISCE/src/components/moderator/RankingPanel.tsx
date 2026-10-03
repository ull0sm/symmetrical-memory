"use client";

import React, { useCallback, useEffect, useState } from "react";
import { getRankedStandings, resolveKataTie } from "@/actions/kata";
import { useLiveEvents } from "@/hooks/useLiveEvents";
import type { KataTieMethod } from "@/lib/statuses";

/**
 * A Local ranked kata group at the desk: the standings as performances come in,
 * the performance order (tap a pair to score it), and, once everyone has
 * performed, the decision on any tie that decides a medal.
 */

type Standings = NonNullable<Awaited<ReturnType<typeof getRankedStandings>>>;
type MedalTie = Standings["medalTies"][number];

const MEDAL_STYLE: Record<string, string> = {
  gold: "bg-amber-100 text-amber-900 border-amber-300",
  silver: "bg-slate-100 text-slate-800 border-slate-300",
  bronze: "bg-orange-100 text-orange-900 border-orange-300",
};
const MEDAL_WORD: Record<string, string> = { gold: "Gold", silver: "Silver", bronze: "Bronze" };

export function RankingPanel({
  categoryId,
  ringId,
  currentMatchId,
  onSelectBout,
}: {
  categoryId: string;
  ringId: string;
  currentMatchId: string | null;
  onSelectBout: (matchId: string) => void;
}) {
  const [data, setData] = useState<Standings | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await getRankedStandings(categoryId));
      setFailed(false);
    } catch (err) {
      console.error("Couldn't load the ranking:", err);
      setFailed(true);
    }
  }, [categoryId]);

  useEffect(() => {
    void load();
  }, [load]);
  useLiveEvents<{ table?: string }>(
    { ringId },
    (event) => {
      if (!event?.table || ["matches", "kata_scores", "kata_tie_decisions", "draws"].includes(event.table)) void load();
    },
    { feed: "staff", debounceMs: 300 }
  );

  if (!data) {
    return (
      <div className="rounded-2xl border border-[var(--line)] bg-white p-8 text-center text-sm text-[var(--ink-500)]">
        {failed ? "Couldn't load the ranking. It retries on the next change." : "Loading the ranking…"}
      </div>
    );
  }

  const nameOf = (id: string) => data.performers.find((p) => p.athleteId === id)?.name ?? "Athlete";
  const bouts = [...new Set(data.performers.map((p) => p.matchId))].map((matchId) => data.performers.filter((p) => p.matchId === matchId));
  const scored = data.performers.filter((p) => p.done).length;
  const firstBoutId = data.performers[0]?.matchId ?? null;

  return (
    <div className="space-y-4">
      <div
        className={`flex flex-wrap items-center gap-2 rounded-2xl border px-4 py-3 text-sm ${
          data.final ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-[var(--line)] bg-white text-[var(--ink-700)]"
        }`}
      >
        <span className="material-symbols-outlined text-[20px]">{data.final ? "emoji_events" : "leaderboard"}</span>
        <span className="font-bold">{data.final ? "Podium final" : data.complete ? "Every performance is in" : `${scored} of ${data.performers.length} performed`}</span>
        <span className="text-[var(--ink-500)]">
          · ranked by total, then the lowest dropped mark, then the highest · {data.bronzeMedals === 2 ? "two bronzes" : "one bronze"}
        </span>
      </div>

      {data.medalTies.map((tie) => (
        <TieDecision key={tie.athleteIds.slice().sort().join(",")} tie={tie} complete={data.complete} nameOf={nameOf} matchId={firstBoutId} onDone={load} />
      ))}

      <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        <h3 className="border-b border-[var(--line)] px-4 py-2.5 text-[11px] font-black uppercase tracking-wider text-[var(--ink-500)]">Standings</h3>
        <ol className="divide-y divide-[var(--line)]">
          {data.standings.map((s) => {
            const p = data.performers.find((x) => x.athleteId === s.athleteId);
            return (
              <li key={s.athleteId} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-9 shrink-0 text-center text-[15px] font-black text-[var(--ink-900)]">{s.label || "·"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-[var(--ink-900)]">{p?.name}</span>
                  <span className="block truncate text-[11.5px] text-[var(--ink-500)]">
                    {[p?.club, s.status === "waiting" ? "to perform" : s.status === "did-not-perform" ? "didn't perform" : null, s.separatedBy === "desk decision" ? "placed by the desk" : s.separatedBy ? `split on the ${s.separatedBy}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {s.medal && <span className={`rounded-md border px-2 py-0.5 text-[11px] font-bold ${MEDAL_STYLE[s.medal]}`}>{MEDAL_WORD[s.medal]}</span>}
                <span className="w-16 shrink-0 text-right font-mono text-[15px] font-bold text-[var(--ink-900)]">{s.total === null ? "–" : s.total.toFixed(2)}</span>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        <h3 className="border-b border-[var(--line)] px-4 py-2.5 text-[11px] font-black uppercase tracking-wider text-[var(--ink-500)]">Performance order</h3>
        <ol className="divide-y divide-[var(--line)]">
          {bouts.map((pair) => {
            const first = pair[0];
            if (!first) return null;
            const done = pair.every((p) => p.done);
            const current = first.matchId === currentMatchId && !done;
            return (
              <li key={first.matchId} className={`flex items-center gap-3 px-4 py-2.5 ${current ? "bg-[var(--accent-tint)]" : ""}`}>
                <span className="w-14 shrink-0 text-[11px] font-black uppercase text-[var(--ink-400)]">{pair.length === 1 ? "Solo" : `Pair ${first.matchNo}`}</span>
                <span className="min-w-0 flex-1 space-y-0.5">
                  {pair.map((p) => (
                    <span key={p.athleteId} className="flex items-center gap-2 text-[13px]">
                      <span className={`h-3 w-1 rounded-sm ${p.side === "AKA" ? "bg-red-500" : "bg-blue-600"}`} />
                      <span className="truncate text-[var(--ink-900)]">{p.name}</span>
                      <span className="ml-auto font-mono text-[var(--ink-700)]">{p.total === null ? (p.done ? "DNP" : "") : p.total.toFixed(2)}</span>
                    </span>
                  ))}
                </span>
                {done ? (
                  <span className="w-16 shrink-0 text-right text-[11px] font-bold text-emerald-700">Done</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelectBout(first.matchId)}
                    className={`h-10 w-16 shrink-0 rounded-lg text-[12px] font-bold ${current ? "bg-[var(--accent)] text-white" : "border border-[var(--line)] text-[var(--ink-900)]"}`}
                  >
                    {current ? "On mat" : "Score"}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}

/** One tie that decides a medal: the order, how it was settled, and a note. */
function TieDecision({
  tie,
  complete,
  nameOf,
  matchId,
  onDone,
}: {
  tie: MedalTie;
  complete: boolean;
  nameOf: (id: string) => string;
  matchId: string | null;
  onDone: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(!tie.decided);
  const [order, setOrder] = useState<string[]>(tie.athleteIds);
  const [method, setMethod] = useState<KataTieMethod>("REPERFORMANCE");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stake = tie.medals.map((m) => (m ? MEDAL_WORD[m] : "no medal")).join(" / ");

  const move = (i: number, by: -1 | 1) =>
    setOrder((prev) => {
      const next = [...prev];
      const j = i + by;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j] as string, next[i] as string];
      return next;
    });

  const save = async () => {
    if (!matchId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await resolveKataTie({ matchId, athleteIds: order, method, note });
      if (!res.success) setError(res.error);
      else {
        setEditing(false);
        setNote("");
        await onDone();
      }
    } catch (err) {
      console.error("Tie decision failed:", err);
      setError("Not saved. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`rounded-2xl border-2 p-4 ${tie.decided ? "border-emerald-200 bg-white" : "border-amber-300 bg-amber-50"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="material-symbols-outlined text-[20px] text-amber-700">balance</span>
        <p className="flex-1 text-[14px] font-bold text-[var(--ink-900)]">
          {tie.athleteIds.map(nameOf).join(" and ")} {tie.decided ? "were" : "are"} level for {stake.toLowerCase()}
        </p>
        {tie.decided && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="h-9 rounded-lg border border-[var(--line)] px-3 text-[12px] font-bold">
            Change
          </button>
        )}
      </div>

      {tie.decided && !editing ? (
        <p className="mt-1 text-[13px] text-[var(--ink-700)]">Decided at the desk: {tie.athleteIds.map((id, i) => `${i + 1}. ${nameOf(id)}`).join("  ")}</p>
      ) : !complete ? (
        <p className="mt-1 text-[13px] text-amber-900">The marks can&apos;t separate them. Decide once everyone has performed: a re-performance or a flag vote between them.</p>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-[13px] text-amber-900">The marks can&apos;t separate them. After a re-performance or a flag vote between them, put them in order:</p>
          <ol className="space-y-1.5">
            {order.map((id, i) => (
              <li key={id} className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-white px-3 py-1.5">
                <span className="w-6 text-[14px] font-black">{i + 1}</span>
                <span className="flex-1 text-[14px] font-semibold">{nameOf(id)}</span>
                <span className="text-[11px] font-bold text-[var(--ink-500)]">{tie.medals[i] ? MEDAL_WORD[tie.medals[i] as string] : "no medal"}</span>
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${nameOf(id)} up`} className="h-9 w-9 rounded-lg hover:bg-[var(--canvas)] disabled:opacity-30">
                  <span className="material-symbols-outlined text-[18px]">arrow_upward</span>
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label={`Move ${nameOf(id)} down`} className="h-9 w-9 rounded-lg hover:bg-[var(--canvas)] disabled:opacity-30">
                  <span className="material-symbols-outlined text-[18px]">arrow_downward</span>
                </button>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            {(["REPERFORMANCE", "FLAG_VOTE"] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={method === m}
                onClick={() => setMethod(m)}
                className={`h-10 rounded-lg border px-3 text-[13px] font-bold ${method === m ? "border-[var(--ink-900)] bg-[var(--ink-900)] text-white" : "border-[var(--line)] bg-white"}`}
              >
                {m === "REPERFORMANCE" ? "Re-performance" : "Flag vote"}
              </button>
            ))}
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note for the record, e.g. re-performed Heian Nidan, 3 flags to 2"
            className="h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3 text-[14px]"
          />
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-900">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || note.trim().length < 3}
              className="h-11 flex-1 rounded-xl bg-[var(--accent)] text-[14px] font-bold text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Record decision"}
            </button>
            {tie.decided && (
              <button type="button" onClick={() => setEditing(false)} className="h-11 rounded-xl border border-[var(--line)] px-4 text-[14px] font-bold">
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
