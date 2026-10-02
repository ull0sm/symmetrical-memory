"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { getCategoryRouting, setCategoryRouting } from "@/actions/categoryRouting";
import PoolRosterList from "@/components/admin/PoolRosterList";

interface Props {
  categoryId: string;
  categoryName: string;
  rings: { id: string; name: string; ring_order: number }[];
  onClose: () => void;
  /** Called after a change so the board reloads its queues. */
  onChanged: () => void;
}

type Info = Awaited<ReturnType<typeof getCategoryRouting>>;
type Card = Extract<Info, { success: true }>["cards"][number];
type Mode = "WHOLE" | "SPLIT";

/**
 * Where a category runs, whenever the admin wants to change it: the whole category on one tatami, or each pool
 * on its own tatami with the finals on another. Moving a pool, moving the finals, splitting and putting the
 * category back together are all edits of this one picture. Fought bouts do not get in the way; a pool with a
 * bout live right now, or one that has finished, is shown locked and says why.
 */
export default function CategoryRoutingDialog({ categoryId, categoryName, rings, onClose, onChanged }: Props) {
  const sortedRings = useMemo(() => [...rings].sort((a, b) => a.ring_order - b.ring_order), [rings]);
  const [info, setInfo] = useState<Info | null>(null);
  const [mode, setMode] = useState<Mode>("WHOLE");
  const [wholeRing, setWholeRing] = useState("");
  const [poolRings, setPoolRings] = useState<string[]>([]);
  const [finalsRing, setFinalsRing] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await getCategoryRouting(categoryId);
    setInfo(result);
    if (!result.success) return;

    const first = sortedRings[0]?.id ?? "";
    const cardFor = (part: string) => result.cards.find((c) => c.part === part);
    if (result.isSplit) {
      setMode("SPLIT");
      setPoolRings(Array.from({ length: result.poolCount ?? 0 }, (_, i) => cardFor(`POOL:${i + 1}`)?.ringId ?? first));
      setFinalsRing(cardFor("FINALS")?.ringId ?? first);
      setWholeRing(cardFor("FINALS")?.ringId ?? first);
    } else {
      setMode("WHOLE");
      const current = cardFor("ALL")?.ringId ?? first;
      setWholeRing(current);
      // A starting point if the admin chooses to split: spread the pools over the tatamis in turn.
      setPoolRings(Array.from({ length: result.poolCount ?? 0 }, (_, i) => sortedRings[i % Math.max(sortedRings.length, 1)]?.id ?? first));
      setFinalsRing(current);
    }
  }, [categoryId, sortedRings]);

  useEffect(() => {
    load().catch((err) => {
      console.error("[routing] could not load", err);
      setError("Could not load where this category runs.");
    });
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const ringName = (id: string) => rings.find((r) => r.id === id)?.name ?? "Tatami";
  const ready = info?.success === true;
  const cards: Card[] = ready ? info.cards : [];
  const card = (part: string) => cards.find((c) => c.part === part);
  const canSplit = ready && info.poolCount !== null;
  const isSplit = ready && info.isSplit;

  // What will change, in words, so the admin sees the effect before applying it.
  const changes = useMemo(() => {
    if (!ready) return [] as string[];
    const out: string[] = [];
    if (mode === "WHOLE") {
      if (isSplit) out.push(`Put the pools back together on ${ringName(wholeRing)}`);
      else if (card("ALL") && card("ALL")!.ringId !== wholeRing) out.push(`Move the category to ${ringName(wholeRing)}`);
      else if (!card("ALL")) out.push(`Assign the category to ${ringName(wholeRing)}`);
      return out;
    }
    if (!isSplit) {
      out.push("Split into pools on different tatamis");
      return out;
    }
    poolRings.forEach((ringId, i) => {
      const current = card(`POOL:${i + 1}`);
      if (current && current.ringId !== ringId) out.push(`Pool ${i + 1}: ${current.ringName} → ${ringName(ringId)}`);
    });
    const finals = card("FINALS");
    if (finals && finals.ringId !== finalsRing) out.push(`Finals: ${finals.ringName} → ${ringName(finalsRing)}`);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, mode, isSplit, wholeRing, poolRings, finalsRing, info]);

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await setCategoryRouting(
        categoryId,
        mode === "WHOLE" ? { kind: "WHOLE", ringId: wholeRing } : { kind: "SPLIT", poolRingIds: poolRings, finalsRingId: finalsRing }
      );
      if (!result.success) {
        setError(result.error ?? "That did not work.");
        return;
      }
      onChanged();
      onClose();
    } catch (err) {
      console.error("[routing] failed", err);
      setError("That did not work. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const select = (value: string, onChange: (v: string) => void, disabled = false) => (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="border border-outline-variant rounded-lg px-2 py-1.5 bg-white min-w-40 disabled:opacity-60 disabled:bg-surface-container-low"
    >
      {sortedRings.map((ring) => (
        <option key={ring.id} value={ring.id}>
          {ring.name}
        </option>
      ))}
    </select>
  );

  const progress = (c: Card | undefined) =>
    c && c.total > 0 ? `${c.fought}/${c.total} bouts` : c ? `${c.total} bouts` : "";

  const modeButton = (value: Mode, title: string, hint: string, disabled = false) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setMode(value)}
      aria-pressed={mode === value}
      className={`flex-1 text-left rounded-lg border px-3 py-2 transition-colors disabled:opacity-50 ${
        mode === value ? "border-[#0E9C7C] bg-[#E3F6F0]" : "border-outline-variant bg-white hover:bg-surface-container-low"
      }`}
    >
      <span className="block text-sm font-bold">{title}</span>
      <span className="block text-[11px] text-on-surface-variant leading-snug">{hint}</span>
    </button>
  );

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Where ${categoryName} runs`}>
      <div className="bg-surface-container-lowest rounded-xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col border border-outline-variant max-h-[90vh]">
        <div className="p-5 bg-surface-container-low border-b border-outline-variant">
          <h3 className="font-headline-sm text-lg font-bold flex items-center gap-2">
            <span className="material-symbols-outlined">call_split</span>
            Where this category runs
          </h3>
          <p className="text-xs text-on-surface-variant mt-1">{categoryName}</p>
        </div>

        <div className="p-5 flex flex-col gap-4 overflow-y-auto">
          {info === null && !error && <p className="text-sm text-on-surface-variant">Loading…</p>}
          {info && !info.success && <p className="text-sm text-error">{info.error}</p>}

          {ready && (
            <>
              <div className="flex gap-2">
                {modeButton("WHOLE", "One tatami", "The whole category runs on a single tatami.")}
                {modeButton(
                  "SPLIT",
                  "Pools on different tatamis",
                  canSplit ? `${info.poolCount} pools; the finals start once every pool is done.` : "Needs a draw with 32+ places or two kata pools.",
                  !canSplit
                )}
              </div>

              {mode === "WHOLE" && (
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-bold">Tatami</span>
                  {select(wholeRing, setWholeRing, Boolean(card("ALL")?.lockReason && card("ALL")?.live))}
                </label>
              )}

              {mode === "SPLIT" && (
                <div className="flex flex-col gap-2">
                  {poolRings.map((ringId, index) => {
                    const c = card(`POOL:${index + 1}`);
                    const pool = info.pools?.[index];
                    return (
                      <div key={index} className="flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0">
                          <span className="font-bold">Pool {index + 1}</span>
                          <span className="block text-[11px] text-on-surface-variant truncate">
                            {pool ? `${pool.athletes.length} athletes` : ""}
                            {c ? ` · ${progress(c)} · ${c.status}` : ""}
                          </span>
                          {c?.lockReason && (
                            <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold">
                              {c.lockReason}
                            </span>
                          )}
                        </span>
                        {select(ringId, (v) => setPoolRings((cur) => cur.map((r, i) => (i === index ? v : r))), Boolean(c?.lockReason))}
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-between gap-3 text-sm border-t border-outline-variant/60 pt-2 mt-1">
                    <span className="min-w-0">
                      <span className="font-bold">Finals</span>
                      <span className="block text-[11px] text-on-surface-variant">
                        Semi-finals, final, repechage and bronze
                        {card("FINALS") ? ` · ${progress(card("FINALS"))}` : ""}
                      </span>
                      {card("FINALS")?.lockReason && (
                        <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold">
                          {card("FINALS")!.lockReason}
                        </span>
                      )}
                    </span>
                    {select(finalsRing, setFinalsRing, Boolean(card("FINALS")?.lockReason))}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setPoolRings((cur) => cur.map((r, i) => (card(`POOL:${i + 1}`)?.lockReason ? r : (sortedRings[i % sortedRings.length]?.id ?? r))))}
                      className="text-xs font-bold text-primary hover:underline"
                    >
                      Spread over the tatamis
                    </button>
                    <button
                      type="button"
                      onClick={() => setPoolRings((cur) => cur.map((r, i) => (card(`POOL:${i + 1}`)?.lockReason ? r : finalsRing)))}
                      className="text-xs font-bold text-primary hover:underline"
                    >
                      All on the finals tatami
                    </button>
                  </div>
                </div>
              )}

              {info.pools && (
                <details className="border border-outline-variant/60 rounded-lg bg-white">
                  <summary className="px-3 py-2 text-sm font-bold cursor-pointer select-none">Who is in each pool</summary>
                  <div className="px-3 pb-3">
                    <PoolRosterList pools={info.pools} />
                  </div>
                </details>
              )}

              <p className="text-xs text-on-surface-variant leading-snug">
                You can change this at any time. Bouts already fought keep their results when a pool moves; only a bout that is live
                right now, or a pool that has finished, cannot be moved. A pool that is on a mat between bouts goes back to the queue of
                its new tatami.
              </p>

              {changes.length > 0 && (
                <ul className="text-xs bg-surface-container-low border border-outline-variant/60 rounded-lg px-3 py-2 list-disc list-inside">
                  {changes.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
            </>
          )}

          {error && (
            <p role="alert" className="text-sm text-error bg-error/10 border border-error/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <div className="p-4 bg-surface-container flex justify-end items-center gap-3 border-t border-outline-variant">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-bold text-on-surface-variant hover:bg-surface-container-high rounded transition-colors">
            Close <span className="text-xs opacity-60">(Esc)</span>
          </button>
          {ready && (
            <button
              type="button"
              disabled={busy || changes.length === 0 || (mode === "WHOLE" ? !wholeRing : poolRings.some((id) => !id) || !finalsRing)}
              onClick={apply}
              className="px-4 py-2 bg-primary hover:opacity-90 text-white text-sm font-bold rounded shadow transition-opacity disabled:opacity-50"
            >
              {busy ? "Working…" : "Apply"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
