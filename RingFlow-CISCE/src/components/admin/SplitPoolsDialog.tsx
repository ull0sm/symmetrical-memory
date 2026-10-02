"use client";

import React, { useCallback, useEffect, useState } from "react";
import { getCategorySplitInfo, splitCategoryPools, unsplitCategoryPools } from "@/actions/poolSplit";
import { describePart } from "@/lib/draws/partFilter";

interface Props {
  categoryId: string;
  categoryName: string;
  rings: { id: string; name: string; ring_order: number }[];
  onClose: () => void;
  /** Called after a split or unsplit so the board reloads its queues. */
  onChanged: () => void;
}

type Info = Awaited<ReturnType<typeof getCategorySplitInfo>>;

/**
 * Run a category's pools on different tatamis: each pool on a tatami of the admin's choosing, and
 * the semi-finals, finals and medal bouts on one finals tatami that waits for every pool.
 */
export default function SplitPoolsDialog({ categoryId, categoryName, rings, onClose, onChanged }: Props) {
  const [info, setInfo] = useState<Info | null>(null);
  const [poolRings, setPoolRings] = useState<string[]>([]);
  const [finalsRing, setFinalsRing] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortedRings = [...rings].sort((a, b) => a.ring_order - b.ring_order);

  const load = useCallback(async () => {
    const result = await getCategorySplitInfo(categoryId);
    setInfo(result);
    if (result.success && result.poolCount) {
      // Spread the pools over the tatamis in turn; the finals go where the first pool runs.
      setPoolRings(Array.from({ length: result.poolCount }, (_, i) => sortedRings[i % sortedRings.length]?.id ?? ""));
      setFinalsRing(sortedRings[0]?.id ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  useEffect(() => {
    load().catch((err) => {
      console.error("[split] could not load", err);
      setError("Could not load this category's pools.");
    });
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = async (action: () => Promise<{ success: boolean; error?: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (!result.success) {
        setError(result.error ?? "That did not work.");
        return;
      }
      onChanged();
      onClose();
    } catch (err) {
      console.error("[split] failed", err);
      setError("That did not work. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Split ${categoryName} across tatamis`}>
      <div className="bg-surface-container-lowest rounded-xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col border border-outline-variant max-h-[90vh]">
        <div className="p-5 bg-surface-container-low border-b border-outline-variant">
          <h3 className="font-headline-sm text-lg font-bold flex items-center gap-2">
            <span className="material-symbols-outlined">call_split</span>
            Pools across tatamis
          </h3>
          <p className="text-xs text-on-surface-variant mt-1">{categoryName}</p>
        </div>

        <div className="p-5 flex flex-col gap-4 overflow-y-auto">
          {info === null && !error && <p className="text-sm text-on-surface-variant">Loading…</p>}

          {info && !info.success && <p className="text-sm text-error">{info.error}</p>}

          {info?.success && info.isSplit && (
            <>
              <p className="text-sm text-on-surface-variant">
                This category is split. Each part runs on its own tatami; the finals start once every pool has finished.
              </p>
              <ul className="flex flex-col gap-1.5">
                {[...info.cards]
                  .sort((a, b) => (a.part === "FINALS" ? 1 : b.part === "FINALS" ? -1 : a.part.localeCompare(b.part, undefined, { numeric: true })))
                  .map((card) => (
                    <li key={card.part} className="flex items-center justify-between text-sm border border-outline-variant/60 rounded-lg px-3 py-2">
                      <span className="font-bold">{describePart(card.part)}</span>
                      <span className="text-on-surface-variant">
                        {card.ringName} · {card.status}
                      </span>
                    </li>
                  ))}
              </ul>
              <p className="text-xs text-on-surface-variant">
                To change this, put the category back together first. That is only possible before any bout has been fought.
              </p>
            </>
          )}

          {info?.success && !info.isSplit && info.poolCount === null && (
            <p className="text-sm text-on-surface-variant">
              This category has no pools to split yet. Pools exist once the category is drawn with 32 or more bracket places (blocks
              of 16 places each), or as a kata pool flight with two pools.
            </p>
          )}

          {info?.success && !info.isSplit && info.poolCount !== null && (
            <>
              <p className="text-sm text-on-surface-variant">
                Choose where each pool runs. The semi-finals, finals, repechage and bronze bouts run on the finals tatami and start
                once every pool has finished.
              </p>
              <div className="flex flex-col gap-2">
                {poolRings.map((ringId, index) => (
                  <label key={index} className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-bold">Pool {index + 1}</span>
                    <select
                      value={ringId}
                      onChange={(e) => setPoolRings((current) => current.map((r, i) => (i === index ? e.target.value : r)))}
                      className="border border-outline-variant rounded-lg px-2 py-1.5 bg-white min-w-40"
                    >
                      {sortedRings.map((ring) => (
                        <option key={ring.id} value={ring.id}>
                          {ring.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <label className="flex items-center justify-between gap-3 text-sm border-t border-outline-variant/60 pt-2 mt-1">
                  <span className="font-bold">Finals</span>
                  <select
                    value={finalsRing}
                    onChange={(e) => setFinalsRing(e.target.value)}
                    className="border border-outline-variant rounded-lg px-2 py-1.5 bg-white min-w-40"
                  >
                    {sortedRings.map((ring) => (
                      <option key={ring.id} value={ring.id}>
                        {ring.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="text-xs text-on-surface-variant">
                Each part joins the end of its tatami&apos;s queue. Once split, the category cannot be redrawn until it is put back
                together.
              </p>
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
          {info?.success && info.isSplit && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => unsplitCategoryPools(categoryId))}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-bold rounded shadow transition-colors disabled:opacity-60"
            >
              {busy ? "Working…" : "Put back together"}
            </button>
          )}
          {info?.success && !info.isSplit && info.poolCount !== null && (
            <button
              type="button"
              disabled={busy || poolRings.some((id) => !id) || !finalsRing}
              onClick={() => run(() => splitCategoryPools(categoryId, { poolRingIds: poolRings, finalsRingId: finalsRing }))}
              className="px-4 py-2 bg-primary hover:opacity-90 text-white text-sm font-bold rounded shadow transition-opacity disabled:opacity-60"
            >
              {busy ? "Working…" : "Split across tatamis"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
