"use client";

import React, { useMemo, useState } from "react";
import type { BracketMatchView } from "@/lib/draws/assembleDraw";

interface PodiumView {
  goldRegistrationId: string;
  silverRegistrationId: string | null;
  bronzeRegistrationIds: readonly string[];
}

interface Props {
  matches: BracketMatchView[];
  categoryName: string;
  tournamentSize?: number;
  onDownloadPdf?: () => void;
  isDownloadingPdf?: boolean;
  onSelectMatch?: (match: BracketMatchView) => void;
  activeMatchId?: string | null;
  compact?: boolean;
  /** When set (public athlete search), that athlete is emphasised and the rest dimmed. */
  highlightAthleteId?: string | null;
  /** When set, matching bouts are highlighted and non-matching dimmed */
  searchQuery?: string;
  /** Medalists, shown once the bracket is decided. */
  podium?: PodiumView | null;
  /** 0 = no bronze bout, 1 = single bronze, 2 = repechage with two bronzes. */
  bronzeMedals?: number;
  /** When true, omits the top header so the parent modal header can be unified */
  hideHeader?: boolean;
  /** Admin only: offers "Correct result" on confirmed bouts. */
  onCorrectMatch?: (match: BracketMatchView) => void;
}

/** The recorded score line for one side of a bout. */
function ScoreCell({
  match,
  side,
  won,
  dim,
}: {
  match: BracketMatchView;
  side: "AKA" | "AO";
  won: boolean;
  dim?: boolean;
}) {
  const score = side === "AKA" ? match.akaScore ?? 0 : match.aoScore ?? 0;
  const penalties = side === "AKA" ? match.akaPenalties ?? 0 : match.aoPenalties ?? 0;

  if (dim) return null;

  return (
    <span className="flex shrink-0 items-center gap-1">
      {penalties > 0 && (
        <span
          className="rounded bg-amber-100 px-1 text-[9px] font-black text-amber-800"
          title={`${penalties} warning${penalties === 1 ? "" : "s"}`}
        >
          {penalties}
        </span>
      )}
      {match.senshu === side && (
        <span className="rounded bg-amber-400 px-1 text-[9px] font-black text-amber-950" title="Senshu">
          S
        </span>
      )}
      <span
        className={`font-data-mono text-sm font-black tabular-nums ${won ? "text-emerald-700" : "text-[#3D3A33]"}`}
      >
        {score}
      </span>
    </span>
  );
}

export function DrawBracket({
  matches,
  categoryName,
  tournamentSize,
  onDownloadPdf,
  isDownloadingPdf,
  onSelectMatch,
  activeMatchId,
  highlightAthleteId,
  searchQuery,
  podium,
  bronzeMedals = 2,
  hideHeader = false,
  onCorrectMatch,
}: Props) {
  const [zoom, setZoom] = useState(1);
  const [selectedMatch, setSelectedMatch] = useState<BracketMatchView | null>(null);
  const canvasContainerRef = React.useRef<HTMLDivElement>(null);

  const jumpToMatch = React.useCallback((targetId: string) => {
    const el = document.getElementById(`draw-match-${targetId}`);
    if (el && canvasContainerRef.current) {
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }
  }, []);

  // Auto-scroll to active match on load
  React.useEffect(() => {
    if (activeMatchId) {
      const timer = setTimeout(() => {
        jumpToMatch(activeMatchId);
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [activeMatchId, jumpToMatch]);

  const { mainRounds, repechageMatches, bronzeMatches } = useMemo(() => {
    const main = matches.filter((m) => m.bracketType === "MAIN");
    const roundsMap = new Map<number, BracketMatchView[]>();

    for (const m of main) {
      const list = roundsMap.get(m.roundNo) ?? [];
      list.push(m);
      roundsMap.set(m.roundNo, list);
    }

    const rounds = Array.from(roundsMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([roundNo, list]) => ({
        roundNo,
        roundName: list[0]?.roundName || `Round ${roundNo}`,
        matches: list.sort((a, b) => a.matchNo - b.matchNo),
      }));

    return {
      mainRounds: rounds,
      repechageMatches: matches
        .filter((m) => m.bracketType === "REPECHAGE")
        .sort((a, b) => a.matchNo - b.matchNo),
      bronzeMatches: matches
        .filter((m) => m.bracketType === "BRONZE")
        .sort((a, b) => a.matchNo - b.matchNo),
    };
  }, [matches]);

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of matches) {
      if (m.aka.id) map.set(m.aka.id, m.aka.displayName);
      if (m.ao.id) map.set(m.ao.id, m.ao.displayName);
    }
    return map;
  }, [matches]);

  const handleZoomIn = () => setZoom((z) => Math.min(1.6, z + 0.15));
  const handleZoomOut = () => setZoom((z) => Math.max(0.65, z - 0.15));
  const handleResetZoom = () => setZoom(1);

  const renderMatch = (match: BracketMatchView) => {
    const isDecided = match.status === "CONFIRMED" || match.winnerId != null;
    const akaWon = Boolean(match.winnerId && match.aka.id && match.winnerId === match.aka.id);
    const aoWon = Boolean(match.winnerId && match.ao.id && match.winnerId === match.ao.id);
    const isCurrentBout = activeMatchId === match.matchId;
    const akaHighlighted = Boolean(highlightAthleteId) && match.aka.id === highlightAthleteId;
    const aoHighlighted = Boolean(highlightAthleteId) && match.ao.id === highlightAthleteId;
    const containsHighlight = akaHighlighted || aoHighlighted;
    const showScore = isDecided || match.status === "LIVE";

    const cleanQuery = (searchQuery || "").trim().toLowerCase().replace(/^#/, "");
    const matchesSearch = Boolean(
      cleanQuery &&
        (match.matchNo.toString() === cleanQuery ||
          match.aka.displayName.toLowerCase().includes(cleanQuery) ||
          match.ao.displayName.toLowerCase().includes(cleanQuery) ||
          (match.aka.school && match.aka.school.toLowerCase().includes(cleanQuery)) ||
          (match.ao.school && match.ao.school.toLowerCase().includes(cleanQuery)) ||
          (match.roundName && match.roundName.toLowerCase().includes(cleanQuery)))
    );

    return (
      <div
        key={match.matchId}
        id={`draw-match-${match.matchId}`}
        onClick={() => {
          setSelectedMatch(match);
          if (onSelectMatch) onSelectMatch(match);
        }}
        className={`relative w-full rounded-xl border bg-white transition-all ${
          onSelectMatch ? "cursor-pointer hover:shadow-lg" : ""
        } ${
          matchesSearch
            ? "border-[#0E9C7C] ring-4 ring-[#0E9C7C]/40 shadow-xl bg-emerald-50/20 scale-[1.02]"
            : cleanQuery
              ? "border-[#E1DDCF] opacity-35 hover:opacity-80"
              : containsHighlight
                ? "border-[#DC2626] ring-2 ring-[#DC2626] shadow-md"
                : highlightAthleteId
                  ? "border-[#E1DDCF] opacity-45 hover:opacity-80"
                  : isCurrentBout
                    ? "border-[#0E9C7C] ring-4 ring-[#0E9C7C]/40 shadow-xl bg-emerald-50/25 scale-[1.02] z-10"
                    : isDecided
                      ? "border-[#E1DDCF] bg-[#FAF9F5]/70 opacity-80 hover:opacity-100"
                      : selectedMatch?.matchId === match.matchId
                        ? "border-[#0E9C7C] ring-2 ring-[#0E9C7C]/30 shadow-sm"
                        : "border-[#E1DDCF] hover:border-[#0E9C7C]"
        }`}
      >
        {/* Match # Pill */}
        <div
          className={`flex items-center justify-between gap-2 rounded-t-xl border-b border-[#E1DDCF] px-3 py-1.5 text-[10px] font-bold ${
            isCurrentBout
              ? "bg-[#0E9C7C] text-white"
              : isDecided
                ? "bg-[#F5F3EC] text-[#8C877C]"
                : "bg-[#FAF9F5] text-[#68645A]"
          }`}
        >
          <span className="flex items-center gap-1 whitespace-nowrap">
            {isCurrentBout && (
              <span className="material-symbols-outlined text-[13px] animate-pulse">sports_martial_arts</span>
            )}
            Bout #{match.matchNo}
          </span>
          <span
            className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${
              isCurrentBout
                ? "bg-white text-[#0E9C7C] shadow-xs"
                : isDecided
                  ? "bg-[#EAE7DC] text-[#78746B]"
                  : match.status === "LIVE"
                    ? "bg-amber-100 text-amber-800 animate-pulse font-bold"
                    : "bg-slate-100 text-slate-600"
            }`}
          >
            {isCurrentBout ? "LIVE ON DESK" : isDecided ? "DONE" : match.status}
          </span>
        </div>

        {/* AKA */}
        <div
          className={`flex items-center justify-between gap-2 border-b border-[#E1DDCF] p-2.5 ${
            akaWon ? "bg-emerald-50/60 font-bold" : ""
          } ${akaHighlighted ? "bg-red-50" : ""}`}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#E4483C]" title="AKA (Red)" />
            <div className="min-w-0">
              <p
                className={`truncate text-xs ${
                  akaHighlighted ? "font-black text-[#B91C1C]" : akaWon ? "font-bold text-[#1B1815]" : "font-semibold text-[#1B1815]"
                }`}
              >
                {akaHighlighted && (
                  <span className="mr-1.5 rounded bg-[#DC2626] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-white">
                    Searched
                  </span>
                )}
                {match.aka.isPending && match.aka.sourceLabel ? match.aka.sourceLabel : match.aka.displayName}
                {match.aka.chestNumber ? (
                  <span className="ml-1 font-data-mono text-[10px] font-bold text-[#8C877C]">
                    #{match.aka.chestNumber}
                  </span>
                ) : null}
              </p>
              {match.aka.school && (
                <p className="truncate text-[10px] text-[#68645A]">{match.aka.school}</p>
              )}
            </div>
          </div>
          <span className="flex shrink-0 items-center gap-1.5">
            {showScore && <ScoreCell match={match} side="AKA" won={akaWon} />}
            {akaWon && (
              <span className="material-symbols-outlined text-[18px] text-emerald-600">check_circle</span>
            )}
          </span>
        </div>

        {/* AO */}
        <div
          className={`flex items-center justify-between gap-2 rounded-b-xl p-2.5 ${
            aoWon ? "bg-emerald-50/60 font-bold" : ""
          } ${aoHighlighted ? "bg-blue-50" : ""}`}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#1D4ED8]" title="AO (Blue)" />
            <div className="min-w-0">
              <p
                className={`truncate text-xs ${
                  aoHighlighted ? "font-black text-[#1D4ED8]" : aoWon ? "font-bold text-[#1B1815]" : "font-semibold text-[#1B1815]"
                }`}
              >
                {aoHighlighted && (
                  <span className="mr-1.5 rounded bg-[#2563EB] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-white">
                    Searched
                  </span>
                )}
                {match.ao.isPending && match.ao.sourceLabel ? match.ao.sourceLabel : match.ao.displayName}
                {match.ao.chestNumber ? (
                  <span className="ml-1 font-data-mono text-[10px] font-bold text-[#8C877C]">
                    #{match.ao.chestNumber}
                  </span>
                ) : null}
              </p>
              {match.ao.school && (
                <p className="truncate text-[10px] text-[#68645A]">{match.ao.school}</p>
              )}
            </div>
          </div>
          <span className="flex shrink-0 items-center gap-1.5">
            {showScore && <ScoreCell match={match} side="AO" won={aoWon} />}
            {aoWon && (
              <span className="material-symbols-outlined text-[18px] text-emerald-600">check_circle</span>
            )}
          </span>
        </div>

        {/* Decision method, when the bout has one worth stating */}
        {isDecided && match.decisionMethod && match.decisionMethod !== "POINTS" && (
          <div className="rounded-b-xl border-t border-[#E1DDCF] bg-[#FAF9F5] px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-[#68645A]">
            {match.decisionMethod.replace(/_/g, " ").toLowerCase()}
          </div>
        )}

        {onCorrectMatch && !onSelectMatch && isDecided && match.winnerId && match.aka.id && match.ao.id && (
          <div className="flex justify-end rounded-b-xl border-t border-[var(--line)] bg-[var(--canvas)] p-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onCorrectMatch(match);
              }}
              className="flex min-h-[32px] cursor-pointer items-center gap-1 rounded px-2.5 py-1 text-[10px] font-bold text-[var(--ink-700)] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <span className="material-symbols-outlined text-[13px]">edit_note</span>
              Correct result
            </button>
          </div>
        )}

        {onSelectMatch && (
          <div className="flex items-center justify-between gap-2 rounded-b-xl border-t border-[#E1DDCF] bg-[#F5F3EC] p-1.5">
            <span className="pl-1 text-[9px] font-semibold text-[#68645A]">
              {isCurrentBout ? "Loaded in scoring desk" : "Click anywhere to select"}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelectMatch(match);
              }}
              className={`flex min-h-[36px] items-center gap-1 rounded px-2.5 py-1.5 text-[10px] font-bold shadow-2xs transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] ${
                isCurrentBout ? "bg-[#0E9C7C] text-white" : "bg-neutral-800 text-white hover:bg-neutral-900"
              }`}
            >
              <span className="material-symbols-outlined text-[13px]">sports_martial_arts</span>
              {isCurrentBout ? "Scoring now" : isDecided ? "Review" : "Select bout"}
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderColumn = (title: string, subtitle: string, list: BracketMatchView[]) => (
    <div key={title} className="flex min-w-[240px] flex-col">
      <div className="mb-4 flex items-center justify-between border-b-2 border-[#0E9C7C] pb-2">
        <span className="text-xs font-bold uppercase tracking-wider text-[#0E9C7C]">{title}</span>
        <span className="rounded border border-[#E1DDCF] bg-white px-2 py-0.5 text-[10px] font-bold text-[#8C877C]">
          {list.length} {list.length === 1 ? "Bout" : "Bouts"}
        </span>
      </div>
      <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-[#8C877C]">{subtitle}</p>
      <div className="flex flex-1 flex-col justify-around gap-6">
        {list.map((m) => renderMatch(m))}
      </div>
    </div>
  );

  const medals = podium
    ? [
        { label: "Gold", id: podium.goldRegistrationId, tone: "border-amber-400 bg-amber-50 text-amber-900" },
        { label: "Silver", id: podium.silverRegistrationId, tone: "border-[#D5D0C0] bg-[#F5F3EC] text-[#3D3A33]" },
        ...podium.bronzeRegistrationIds.map((id) => ({
          label: "Bronze",
          id,
          tone: "border-[#C08A5A] bg-[#FBF1E7] text-[#7A4A1E]",
        })),
      ].filter((m) => Boolean(m.id))
    : [];

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[#E1DDCF] bg-[#FAF9F5]">
      {/* Top Toolbar - only when not embedded in a modal that already provides a unified header */}
      {!hideHeader && (
        <div className="flex items-center justify-between gap-3 border-b border-[#E1DDCF] bg-white px-5 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#FAF9F5] border border-[#E1DDCF] px-2.5 py-1 text-xs font-bold text-[#1B1815]">
              <span className="material-symbols-outlined text-[15px] text-[#0E9C7C]">account_tree</span>
              {tournamentSize ? `${tournamentSize} Competitors` : "Bracket"}
            </span>
            <span className="truncate text-xs text-[#68645A] font-medium hidden sm:inline">
              {bronzeMedals === 0
                ? "Single elimination · no bronze"
                : bronzeMedals === 1
                  ? "Single bronze bout"
                  : "Repechage · two bronzes"}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {activeMatchId && (
              <button
                type="button"
                onClick={() => jumpToMatch(activeMatchId)}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-[#0E9C7C] border border-emerald-300 hover:bg-emerald-100 transition-colors cursor-pointer"
                title="Jump to current live match"
              >
                <span className="material-symbols-outlined text-[16px] animate-pulse">my_location</span>
                <span>Live Bout</span>
              </button>
            )}

            <div className="flex items-center rounded-lg border border-[#E1DDCF] bg-[#F5F3EC] p-1">
              <button
                onClick={handleZoomOut}
                className="flex h-8 w-8 items-center justify-center rounded text-[#68645A] transition-colors hover:bg-white hover:text-[#1B1815] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C]"
                title="Zoom out"
                aria-label="Zoom out"
              >
                <span className="material-symbols-outlined text-[16px]">zoom_out</span>
              </button>
              <span className="px-1 font-mono text-xs font-medium text-[#3D3A33]">{Math.round(zoom * 100)}%</span>
              <button
                onClick={handleZoomIn}
                className="flex h-8 w-8 items-center justify-center rounded text-[#68645A] transition-colors hover:bg-white hover:text-[#1B1815] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C]"
                title="Zoom in"
                aria-label="Zoom in"
              >
                <span className="material-symbols-outlined text-[16px]">zoom_in</span>
              </button>
              <button
                onClick={handleResetZoom}
                className="ml-1 flex h-8 w-8 items-center justify-center rounded text-[#68645A] transition-colors hover:bg-white hover:text-[#1B1815] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C]"
                title="Reset zoom"
                aria-label="Reset zoom"
              >
                <span className="material-symbols-outlined text-[16px]">restart_alt</span>
              </button>
            </div>

            {onDownloadPdf && (
              <button
                onClick={onDownloadPdf}
                disabled={isDownloadingPdf}
                className="flex items-center gap-1.5 rounded-lg bg-[#0E9C7C] px-3 py-1.5 text-xs font-bold text-white shadow-xs transition-all hover:bg-[#0B7C63] disabled:opacity-50 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">picture_as_pdf</span>
                {isDownloadingPdf ? "Generating…" : "PDF"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Medalists, once the bracket is decided */}
      {medals.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[#E1DDCF] bg-white px-5 py-2">
          <span className="text-[10px] font-black uppercase tracking-wider text-[#8C877C]">Medals</span>
          {medals.map((medal, index) => (
            <span
              key={`${medal.label}-${medal.id}-${index}`}
              className={`rounded-lg border px-2 py-1 text-[11px] font-bold ${medal.tone}`}
            >
              {medal.label} · {nameById.get(medal.id as string) ?? "—"}
            </span>
          ))}
        </div>
      )}

      {/* Bracket Canvas */}
      <div ref={canvasContainerRef} className="relative flex-1 overflow-auto p-6 scroll-smooth">
        <div
          style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
          className="flex min-w-max items-stretch gap-10 transition-transform duration-150 ease-out"
        >
          {mainRounds.map((round) =>
            renderColumn(
              round.roundName,
              round.roundNo === 0 ? "Opening round" : `Round ${round.roundNo + 1}`,
              round.matches
            )
          )}

          {repechageMatches.length > 0 &&
            renderColumn("Repechage", "Losers beaten by the finalists", repechageMatches)}

          {bronzeMatches.length > 0 && renderColumn("Bronze", "Medal bouts", bronzeMatches)}
        </div>
      </div>
    </div>
  );
}
