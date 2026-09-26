"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DrawBracket } from "@/components/draw/DrawBracket";
import type { BracketMatchView } from "@/lib/draws/assembleDraw";
import { ArrowRight } from "lucide-react";

export interface PickableBout {
  id: string;
  matchNo: number;
  roundName: string;
  status: string;
  isReady: boolean;
  isFinished: boolean;
  aka: { name?: string; school?: string; chestNumber?: string | null };
  ao: { name?: string; school?: string; chestNumber?: string | null };
  akaScore?: number;
  aoScore?: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  categoryName: string;
  bouts: PickableBout[];
  drawMatches: BracketMatchView[];
  tournamentSize?: number;
  activeMatchId?: string | null;
  bronzeMedals?: number;
  onSelect: (matchId: string) => void;
}

type StatusFilter = "ready" | "live" | "done" | "all";

/**
 * Names imported from spreadsheets often carry non-breaking spaces, which look
 * identical to a normal space but never match one. Everything is flattened to
 * single ordinary spaces before comparing.
 */
function normalizeText(value: string): string {
  return value.replace(/[\s\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000]+/g, " ").trim().toLowerCase();
}

/** Everything a moderator might type: names, chest numbers, clubs, bout or round. */
function haystack(bout: PickableBout): string {
  return normalizeText(
    [
      bout.matchNo,
      `bout ${bout.matchNo}`,
      bout.roundName,
      bout.aka?.name,
      bout.aka?.chestNumber,
      bout.aka?.school,
      bout.ao?.name,
      bout.ao?.chestNumber,
      bout.ao?.school,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

/**
 * Choosing a bout is a deliberate act, so it gets the whole screen on a laptop
 * and a full-height sheet on a phone. The list answers one question fast:
 * "which bout am I running next?"
 */
export function BoutPickerModal({
  isOpen,
  onClose,
  categoryName,
  bouts,
  drawMatches,
  tournamentSize,
  activeMatchId,
  bronzeMedals = 2,
  onSelect,
}: Props) {
  const isKata = categoryName?.toLowerCase().includes("kata");
  const [view, setView] = useState<"list" | "tree" | "pools">(isKata ? "pools" : "tree");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ready");
  const [roundFilter, setRoundFilter] = useState<string>("all");
  const [activeIndex, setActiveIndex] = useState(0);

  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "/" && document.activeElement !== searchRef.current) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  const rounds = useMemo(
    () => Array.from(new Set(bouts.map((b) => b.roundName))).sort(),
    [bouts]
  );

  const counts = useMemo(
    () => ({
      ready: bouts.filter((b) => b.isReady && b.status !== "LIVE").length,
      live: bouts.filter((b) => b.status === "LIVE").length,
      done: bouts.filter((b) => b.isFinished).length,
      all: bouts.length,
    }),
    [bouts]
  );

  const filtered = useMemo(() => {
    const needle = normalizeText(query);

    // Typing a search means "find this bout", so it looks across every state
    // rather than hiding a decided bout behind the Ready filter.
    const matches = bouts.filter((bout) => {
      if (needle) return haystack(bout).includes(needle);

      if (statusFilter === "ready" && !(bout.isReady && bout.status !== "LIVE")) return false;
      if (statusFilter === "live" && bout.status !== "LIVE") return false;
      if (statusFilter === "done" && !bout.isFinished) return false;
      if (roundFilter !== "all" && bout.roundName !== roundFilter) return false;
      return true;
    });

    // Active/Live first, then Ready to run, then Waiting/Scheduled, and Finished at the very bottom.
    return matches.sort((a, b) => {
      const rank = (bout: PickableBout) => {
        if (bout.id === activeMatchId) return 0;
        if (bout.status === "LIVE") return 1;
        if (bout.isReady && !bout.isFinished) return 2;
        if (!bout.isFinished) return 3;
        return 4; // Finished bouts at the bottom
      };
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return a.matchNo - b.matchNo;
    });
  }, [bouts, query, statusFilter, roundFilter]);

  // Reset the keyboard highlight when the filters change. Done during render —
  // the pattern React documents for "adjust state when something changes" —
  // rather than in an effect, which would cost an extra render pass.
  const filterKey = `${query}|${statusFilter}|${roundFilter}|${view}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setActiveIndex(0);
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const bout = filtered[activeIndex];
      if (bout) onSelect(bout.id);
    }
  };

  const handleSelect = useCallback(
    (matchId: string) => {
      onSelect(matchId);
    },
    [onSelect]
  );

  if (!isOpen) return null;

  const statusChip = (value: StatusFilter, label: string) => (
    <button
      key={value}
      type="button"
      onClick={() => setStatusFilter(value)}
      aria-pressed={statusFilter === value}
      className={`flex min-h-[40px] items-center gap-1.5 rounded-lg border px-3 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] ${
        statusFilter === value
          ? "border-[#0E9C7C] bg-[#E3F6F0] text-[#0B7C63]"
          : "border-[#E1DDCF] bg-white text-[#68645A] hover:bg-[#FAF9F5]"
      }`}
    >
      {label}
      <span
        className={`rounded px-1.5 py-0.5 text-[10px] font-black ${
          statusFilter === value ? "bg-[#0E9C7C] text-white" : "bg-[#F5F3EC] text-[#8C877C]"
        }`}
      >
        {counts[value]}
      </span>
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/60 p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a bout"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="flex h-full w-full flex-col overflow-hidden border border-[#E1DDCF] bg-[#FAF9F5] shadow-2xl outline-none sm:h-[92vh] sm:w-[95vw] sm:max-w-[1600px] sm:rounded-2xl"
      >
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E1DDCF] bg-white px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-black uppercase tracking-wider text-[#1B1815] sm:text-base">
              Choose a bout
            </h2>
            <p className="truncate text-[11px] text-[#68645A] sm:text-xs">
              {categoryName} · {bouts.length} bouts · ↑↓ then Enter, or tap a card
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-xl border border-[#E1DDCF] bg-[#F5F3EC] p-1">
              {isKata && (
                <button
                  type="button"
                  onClick={() => setView("pools")}
                  aria-pressed={view === "pools"}
                  className={`flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] ${
                    view === "pools" ? "bg-[#0E9C7C] text-white shadow-xs" : "text-[#68645A] hover:text-[#1B1815]"
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">table_chart</span>
                  Pool Bouts
                </button>
              )}
              <button
                type="button"
                onClick={() => setView("list")}
                aria-pressed={view === "list"}
                className={`flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] ${
                  view === "list" ? "bg-[#0E9C7C] text-white shadow-xs" : "text-[#68645A] hover:text-[#1B1815]"
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">format_list_bulleted</span>
                List
              </button>
              {!isKata && (
                <button
                  type="button"
                  onClick={() => setView("tree")}
                  aria-pressed={view === "tree"}
                  className={`flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] ${
                    view === "tree" ? "bg-[#0E9C7C] text-white shadow-xs" : "text-[#68645A] hover:text-[#1B1815]"
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">account_tree</span>
                  Bracket
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-[#E1DDCF] bg-white text-[#68645A] transition-colors hover:bg-[#F5F3EC] hover:text-[#1B1815] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C]"
              aria-label="Close bout picker"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </header>

        {/* Filter / Search Toolbar across both views */}
        <div className="flex flex-wrap items-center gap-2.5 border-b border-[#E1DDCF] bg-white px-4 py-2.5 sm:px-6">
          <div className="relative min-w-[200px] flex-1">
            <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-[#8C877C]">
              search
            </span>
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                view === "tree"
                  ? "Highlight athlete, school, chest #, or bout # in bracket…"
                  : "Athlete, chest number, club, or bout number…"
              }
              aria-label="Search bouts"
              className="w-full rounded-lg border border-[#E1DDCF] bg-[#FAF9F5] py-2 pl-9 pr-8 text-sm text-[#1B1815] outline-none transition-all focus:border-[#0E9C7C] focus:ring-2 focus:ring-[#0E9C7C]/20 placeholder:text-[#8C877C]"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8C877C] hover:text-[#1B1815] transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            )}
          </div>

          {view === "list" ? (
            <div className="flex flex-wrap items-center gap-2">
              {statusChip("ready", "Ready")}
              {statusChip("live", "Live")}
              {statusChip("done", "Done")}
              {statusChip("all", "All")}

              {rounds.length > 1 && (
                <select
                  value={roundFilter}
                  onChange={(e) => setRoundFilter(e.target.value)}
                  aria-label="Filter by round"
                  className="min-h-[38px] cursor-pointer rounded-lg border border-[#E1DDCF] bg-white px-2.5 text-xs font-bold text-[#3D3A33] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C]"
                >
                  <option value="all">All rounds</option>
                  {rounds.map((round) => (
                    <option key={round} value={round}>
                      {round}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] font-bold text-[#0E9C7C] border border-emerald-200/60">
                <span className="material-symbols-outlined text-[14px]">touch_app</span>
                Tap any bout to load on desk
              </span>
              <div className="hidden sm:flex items-center gap-2 text-[#68645A]">
                {counts.live > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 border border-amber-200/60 animate-pulse">
                    {counts.live} Live
                  </span>
                )}
                <span className="text-[#8C877C]">
                  {counts.ready} Ready · {counts.done}/{counts.all} Done
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden p-2.5 sm:p-4 md:p-5">
          {view === "pools" ? (
            <div className="h-full overflow-y-auto pr-1 space-y-6">
              {(() => {
                const poolABouts = bouts.filter(
                  (b) =>
                    b.roundName.includes("Pool A") ||
                    (drawMatches.find((dm) => dm.matchId === b.id) as any)?.poolGroup === "Pool A"
                );
                const poolBBouts = bouts.filter(
                  (b) =>
                    b.roundName.includes("Pool B") ||
                    (drawMatches.find((dm) => dm.matchId === b.id) as any)?.poolGroup === "Pool B"
                );
                const finalBouts = bouts.filter(
                  (b) =>
                    b.roundName.includes("Final") ||
                    b.roundName.includes("Championship") ||
                    b.roundName.includes("Bronze") ||
                    (drawMatches.find((dm) => dm.matchId === b.id) as any)?.poolGroup === "Final Flight"
                );

                const sections = [
                  { title: "Pool A (Group 1) Bouts", bouts: poolABouts, color: "text-[#0E9C7C]" },
                  { title: "Pool B (Group 2) Bouts", bouts: poolBBouts, color: "text-[#2563EB]" },
                  { title: "Championship & Medal Flight Bouts", bouts: finalBouts, color: "text-[#D97706]" },
                ].filter((s) => s.bouts.length > 0);

                if (sections.length === 0) {
                  return (
                    <div className="p-8 text-center text-[#68645A] text-sm">
                      No pool bouts found for this category.
                    </div>
                  );
                }

                return (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                    {sections.map((sec) => (
                      <div
                        key={sec.title}
                        className="bg-white border border-[#E1DDCF] rounded-2xl p-4 shadow-xs space-y-3"
                      >
                        <div className="flex items-center justify-between border-b border-[#E1DDCF] pb-2.5">
                          <h3 className={`text-xs font-bold font-data-mono uppercase tracking-wider ${sec.color}`}>
                            {sec.title}
                          </h3>
                          <span className="text-[11px] font-bold font-data-mono px-2 py-0.5 rounded bg-[#FAF9F5] border border-[#E1DDCF] text-[#504C42]">
                            {sec.bouts.length} bouts
                          </span>
                        </div>

                        <div className="space-y-2">
                          {sec.bouts.map((b) => {
                            const isCurrent = b.id === activeMatchId;
                            const isLive = b.status === "LIVE";
                            return (
                              <button
                                key={b.id}
                                type="button"
                                onClick={() => handleSelect(b.id)}
                                className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer ${
                                  isCurrent
                                    ? "border-[#0E9C7C] bg-emerald-50/60 shadow-xs ring-1 ring-[#0E9C7C]"
                                    : isLive
                                    ? "border-amber-400 bg-amber-50/50 shadow-xs"
                                    : b.isFinished
                                    ? "border-[#E1DDCF]/70 bg-[#FAF9F5]/40 hover:bg-white"
                                    : "border-[#E1DDCF] bg-white hover:border-[#0E9C7C] hover:shadow-xs"
                                }`}
                              >
                                <div className="flex items-center justify-between mb-2">
                                  <span className="font-data-mono font-bold text-xs text-[#8C877C]">
                                    Bout #{b.matchNo}
                                  </span>
                                  {isCurrent ? (
                                    <span className="text-[10px] font-bold font-data-mono text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                                      CURRENT ON MAT
                                    </span>
                                  ) : isLive ? (
                                    <span className="text-[10px] font-bold font-data-mono text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full animate-pulse">
                                      LIVE
                                    </span>
                                  ) : b.isFinished ? (
                                    <span className="text-[10px] font-bold font-data-mono text-[#8C877C] bg-[#FAF9F5] border border-[#E1DDCF] px-1.5 py-0.5 rounded">
                                      FINISHED
                                    </span>
                                  ) : (
                                    <span className="text-[10px] font-bold font-data-mono text-[#0E9C7C] bg-emerald-50 px-2 py-0.5 rounded-full">
                                      READY
                                    </span>
                                  )}
                                </div>

                                {/* AKA Fighter */}
                                <div className="flex items-center justify-between gap-2 py-1">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold font-data-mono bg-red-100 text-[#DC2626]">
                                      AKA
                                    </span>
                                    <span className="text-xs font-bold text-[#1B1815] truncate">
                                      {b.aka?.name || "TBD"}
                                    </span>
                                  </div>
                                  {b.isFinished && typeof b.akaScore === "number" && (
                                    <span className="font-data-mono text-xs font-bold text-[#DC2626]">
                                      {b.akaScore.toFixed(2)}
                                    </span>
                                  )}
                                </div>

                                {/* AO Fighter */}
                                <div className="flex items-center justify-between gap-2 py-1 border-t border-[#E1DDCF]/40">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold font-data-mono bg-blue-100 text-[#2563EB]">
                                      AO
                                    </span>
                                    <span className="text-xs font-bold text-[#1B1815] truncate">
                                      {b.ao?.name || "TBD"}
                                    </span>
                                  </div>
                                  {b.isFinished && typeof b.aoScore === "number" && (
                                    <span className="font-data-mono text-xs font-bold text-[#2563EB]">
                                      {b.aoScore.toFixed(2)}
                                    </span>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          ) : view === "tree" ? (
            <div className="h-full overflow-hidden rounded-xl border border-[#E1DDCF] bg-white shadow-xs">
              {drawMatches.length > 0 ? (
                <DrawBracket
                  matches={drawMatches}
                  categoryName={categoryName}
                  tournamentSize={tournamentSize}
                  bronzeMedals={bronzeMedals}
                  onSelectMatch={(m) => handleSelect(m.matchId)}
                  activeMatchId={activeMatchId}
                  searchQuery={query}
                />
              ) : (
                <div className="flex h-full items-center justify-center p-6 text-center text-sm text-[#68645A]">
                  This category has no generated bracket yet. Switch to the list to pick by bout number.
                </div>
              )}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <span className="material-symbols-outlined text-3xl text-[#8C877C]">search_off</span>
              <p className="text-sm font-bold text-[#1B1815]">
                {query
                  ? `Nothing matches “${query.trim()}”`
                  : `No ${statusFilter === "all" ? "" : statusFilter} bouts`}
              </p>
              <p className="max-w-sm text-xs text-[#68645A]">
                {query
                  ? "Try a surname, a chest number, a club, or the bout number."
                  : "Every bout in this category is in another state. Show all bouts to pick one anyway."}
              </p>
              <div className="mt-2 flex gap-2">
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="min-h-[40px] rounded-lg border border-[#E1DDCF] bg-white px-3 text-xs font-bold text-[#3D3A33]"
                  >
                    Clear search
                  </button>
                )}
                {statusFilter !== "all" && (
                  <button
                    type="button"
                    onClick={() => setStatusFilter("all")}
                    className="min-h-[40px] rounded-lg bg-[#0E9C7C] px-3 text-xs font-bold text-white"
                  >
                    Show all bouts
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="h-full overflow-y-auto">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filtered.map((m, index) => {
                  const isCurrent = m.id === activeMatchId;
                  const isActive = index === activeIndex;
                  const showScore = m.isFinished || m.status === "LIVE";

                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleSelect(m.id)}
                      onMouseEnter={() => setActiveIndex(index)}
                      className={`group relative flex flex-col justify-between rounded-xl p-3.5 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] focus-visible:ring-offset-2 cursor-pointer ${
                        isCurrent
                          ? "border-2 border-[#0E9C7C] bg-emerald-50/60 shadow-md ring-2 ring-[#0E9C7C]/25"
                          : isActive
                            ? "border-2 border-[#0E9C7C]/70 bg-white shadow-md"
                            : m.isFinished
                              ? "border border-dashed border-[#DDD9CD] bg-[#F9F8F5] opacity-55 hover:opacity-100 hover:border-[#8C877C] shadow-none"
                              : m.status === "LIVE"
                                ? "border-2 border-amber-400 bg-amber-50/40 shadow-sm hover:shadow-md ring-1 ring-amber-400/30"
                                : m.isReady
                                  ? "border-2 border-emerald-500/80 bg-white shadow-xs hover:border-emerald-600 hover:shadow-md ring-1 ring-emerald-500/20"
                                  : "border border-[#E1DDCF] bg-white opacity-85 hover:opacity-100 hover:border-[#8C877C]"
                      }`}
                    >
                      {/* Top Row: Bout # and Status Badge */}
                      <div>
                        <div className="mb-2.5 flex items-center justify-between gap-2">
                          <span className={`text-[11px] font-black uppercase tracking-wider ${
                            m.isFinished ? "text-[#78746A]" : "text-[#1B1815]"
                          }`}>
                            Bout #{m.matchNo}
                          </span>
                          <span
                            className={`flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${
                              isCurrent
                                ? "bg-[#0E9C7C] text-white shadow-2xs"
                                : m.isFinished
                                  ? "bg-[#ECE9DF] text-[#78746A]"
                                  : m.status === "LIVE"
                                    ? "bg-amber-500 text-white animate-pulse"
                                    : m.isReady
                                      ? "bg-emerald-600 text-white"
                                      : "bg-[#F0EEE6] text-[#78746A]"
                            }`}
                          >
                            {isCurrent && <span className="h-1.5 w-1.5 rounded-full bg-white animate-ping" />}
                            {isCurrent
                              ? "ON DESK"
                              : m.isFinished
                                ? "DONE"
                                : m.status === "LIVE"
                                  ? "LIVE"
                                  : m.isReady
                                    ? "READY"
                                    : "WAITING"}
                          </span>
                        </div>

                        {/* Fighters */}
                        <div className="space-y-1">
                          {/* AKA */}
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                                m.isFinished ? "bg-red-400/60" : "bg-[#C0392B]"
                              }`} />
                              <span className={`truncate text-sm ${
                                m.isFinished ? "font-semibold text-[#68645A]" : "font-bold text-[#1B1815]"
                              }`}>
                                {m.aka?.name || "TBD"}
                              </span>
                            </span>
                            {showScore && (
                              <span className={`shrink-0 font-data-mono text-base tabular-nums ${
                                m.isFinished ? "font-bold text-slate-500" : "font-black text-[#C0392B]"
                              }`}>
                                {m.akaScore ?? 0}
                              </span>
                            )}
                          </div>

                          {/* AO */}
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                                m.isFinished ? "bg-blue-400/60" : "bg-[#1D4ED8]"
                              }`} />
                              <span className={`truncate text-sm ${
                                m.isFinished ? "font-semibold text-[#68645A]" : "font-bold text-[#1B1815]"
                              }`}>
                                {m.ao?.name || "TBD"}
                              </span>
                            </span>
                            {showScore && (
                              <span className={`shrink-0 font-data-mono text-base tabular-nums ${
                                m.isFinished ? "font-bold text-slate-500" : "font-black text-[#1D4ED8]"
                              }`}>
                                {m.aoScore ?? 0}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Card Footer */}
                      <div className="mt-3 flex items-center justify-between gap-1 border-t border-[#E1DDCF]/60 pt-2 text-[11px]">
                        <span className="truncate font-semibold text-[#78746A]">
                          {m.roundName}
                          {m.aka?.chestNumber || m.ao?.chestNumber
                            ? ` · #${m.aka?.chestNumber ?? "—"} vs #${m.ao?.chestNumber ?? "—"}`
                            : ""}
                        </span>

                        {isCurrent ? (
                          <span className="shrink-0 font-black uppercase text-[#0E9C7C] text-[10px]">
                            Current
                          </span>
                        ) : m.isReady ? (
                          <span className="flex shrink-0 items-center gap-1 font-black uppercase text-emerald-700 text-[10px] group-hover:translate-x-0.5 transition-transform">
                            Load <ArrowRight className="w-3 h-3" />
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-[#E1DDCF] bg-white px-4 py-2.5 text-[11px] text-[#68645A] sm:px-6">
          <span>
            Showing {view === "list" ? filtered.length : bouts.length} of {bouts.length} bouts · ↑↓ to move, Enter to
            load, / to search, Esc to close
          </span>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] rounded-lg px-3 text-xs font-bold text-[#68645A] transition-colors hover:text-[#1B1815] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C]"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
