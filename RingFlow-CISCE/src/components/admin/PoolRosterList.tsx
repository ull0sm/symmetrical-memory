"use client";

import React from "react";

export interface PoolRosterView {
  part: string;
  label: string;
  tatami: string | null;
  athletes: { athleteId: string; name: string; club: string | null }[];
}

/**
 * Who is in each pool of a category's draw, so an admin can tell the pools apart before deciding
 * where each one runs. One collapsible row per pool: its name, tatami (once split) and athletes.
 */
export default function PoolRosterList({ pools, defaultOpen = false }: { pools: PoolRosterView[]; defaultOpen?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      {pools.map((pool) => (
        <details key={pool.part} open={defaultOpen} className="border border-outline-variant/60 rounded-lg bg-white group">
          <summary className="flex items-center justify-between gap-3 px-3 py-2 cursor-pointer select-none text-sm list-none">
            <span className="font-bold flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-outline group-open:rotate-90 transition-transform">chevron_right</span>
              {pool.label}
            </span>
            <span className="text-xs text-on-surface-variant">
              {pool.athletes.length} athlete{pool.athletes.length === 1 ? "" : "s"}
              {pool.tatami ? ` · ${pool.tatami}` : ""}
            </span>
          </summary>
          <ol className="px-3 pb-2 pt-1 text-xs divide-y divide-outline-variant/40">
            {pool.athletes.map((athlete, index) => (
              <li key={athlete.athleteId} className="flex items-center justify-between gap-3 py-1">
                <span className="truncate">
                  <span className="font-data-mono text-outline mr-1.5">{index + 1}.</span>
                  {athlete.name}
                </span>
                <span className="text-on-surface-variant truncate shrink-0 max-w-40">{athlete.club ?? ""}</span>
              </li>
            ))}
          </ol>
        </details>
      ))}
    </div>
  );
}
