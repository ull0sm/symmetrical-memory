"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { confirmBoutResult, updateLiveMatchState } from "@/actions/matches";
import { MatchClock } from "@/components/match/MatchClock";
import { useRingClockController } from "@/hooks/useRingClockController";
import type { RingClock } from "@/lib/matchClock";

interface Competitor {
  id?: string | null;
  name: string;
  school?: string;
  chestNumber?: string | null;
}

interface Props {
  match: {
    id: string;
    matchNo: number;
    roundName: string;
    aka: Competitor;
    ao: Competitor;
    akaScore?: number;
    aoScore?: number;
    akaPenalties?: number;
    aoPenalties?: number;
    senshu?: "AKA" | "AO" | null;
    status?: string;
    winnerId?: string | null;
  };
  ringId?: string;
  categoryName: string;
  clock: RingClock;
  serverNow?: number;
  serverNowSentAt?: number;
  serverNowReceivedAt?: number;
  sidesSwapped?: boolean;
  nextBout?: {
    matchNo: number;
    roundName: string;
    aka: Competitor;
    ao: Competitor;
  } | null;
  onBoutCompleted: () => void;
  onClose?: () => void;
  /** When provided by a parent sidebar, desk-side swap is controlled externally */
  deskSidesSwapped?: boolean;
  onToggleDeskSides?: () => void;
  /** Controls the display size of names and scores on the scoring pad */
  deskFontSize?: "compact" | "normal" | "large";
}

const PRESETS = [
  { sec: 90, label: "1:30" },
  { sec: 120, label: "2:00" },
  { sec: 180, label: "3:00" },
];

const PENALTY_LEVELS = [
  { level: 1, label: "1" },
  { level: 2, label: "2" },
  { level: 3, label: "3" },
  { level: 4, label: "HC" },
  { level: 5, label: "H" },
];

// Referee double-blast whistle, synthesised so the desk needs no audio asset.
const playBuzzerSound = () => {
  if (typeof window === "undefined") return;
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const playBlast = (startTime: number, duration: number) => {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc1.type = "sine";
      osc1.frequency.setValueAtTime(1800, ctx.currentTime + startTime);
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(1845, ctx.currentTime + startTime);

      gainNode.gain.setValueAtTime(0, ctx.currentTime + startTime);
      gainNode.gain.linearRampToValueAtTime(0.3, ctx.currentTime + startTime + 0.05);
      gainNode.gain.setValueAtTime(0.3, ctx.currentTime + startTime + duration - 0.1);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startTime + duration);

      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc1.start(ctx.currentTime + startTime);
      osc2.start(ctx.currentTime + startTime);
      osc1.stop(ctx.currentTime + startTime + duration);
      osc2.stop(ctx.currentTime + startTime + duration);
    };

    playBlast(0, 0.4);
    playBlast(0.5, 0.7);
  } catch (e) {
    console.error("Audio buzzer error:", e);
  }
};

export function BoutScoringPad({
  match,
  ringId,
  categoryName,
  clock: initialClock,
  serverNow,
  serverNowSentAt,
  serverNowReceivedAt,
  sidesSwapped: initialSidesSwapped,
  nextBout,
  onBoutCompleted,
  deskSidesSwapped: externalDeskSidesSwapped,
  onToggleDeskSides,
  deskFontSize = "normal",
}: Props) {
  const [akaPoints, setAkaPoints] = useState(match.akaScore ?? 0);
  const [aoPoints, setAoPoints] = useState(match.aoScore ?? 0);
  const [akaPenalties, setAkaPenalties] = useState(match.akaPenalties ?? 0);
  const [aoPenalties, setAoPenalties] = useState(match.aoPenalties ?? 0);
  const [senshu, setSenshu] = useState<"AKA" | "AO" | null>(match.senshu ?? null);

  const [confirming, setConfirming] = useState(false);
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [showHanteiModal, setShowHanteiModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCorrections, setShowCorrections] = useState(false);
  const [selectedWinnerSide, setSelectedWinnerSide] = useState<"AKA" | "AO" | null>(null);
  const [finishMethod, setFinishMethod] = useState<string>("POINTS");
  const [history, setHistory] = useState<any[]>([]);

  const [editMinutes, setEditMinutes] = useState("3");
  const [editSeconds, setEditSeconds] = useState("00");
  const [editMilliseconds, setEditMilliseconds] = useState("000");

  const padRef = useRef<HTMLDivElement>(null);

  const clock = useRingClockController({
    ringId: ringId ?? "",
    initialClock,
    initialServerNow: serverNow,
    initialServerNowSentAt: serverNowSentAt,
    initialServerNowReceivedAt: serverNowReceivedAt,
    initialSidesSwapped,
    onElapsed: playBuzzerSound,
  });

  const { remainingMs, running, pending, isLow, isExpired, sidesSwapped } = clock;

  // A brand new bout starts from the configured duration on every screen.
  useEffect(() => {
    setAkaPoints(match.akaScore ?? 0);
    setAoPoints(match.aoScore ?? 0);
    setAkaPenalties(match.akaPenalties ?? 0);
    setAoPenalties(match.aoPenalties ?? 0);
    setSenshu(match.senshu ?? null);
    setHistory([]);
    setShowFinishModal(false);
    if (ringId) {
      void clock.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match.id]);

  useEffect(() => {
    const total = clock.clock.durationMs;
    setEditMinutes(String(Math.floor(total / 60000)));
    setEditSeconds(String(Math.floor((total % 60000) / 1000)).padStart(2, "0"));
    setEditMilliseconds(String(total % 1000).padStart(3, "0"));
  }, [clock.clock.durationMs]);



  const openClockSettings = () => {
    if (clock.running) {
      void clock.pause();
    }
    const current = clock.remainingMs;
    setEditMinutes(String(Math.floor(current / 60000)));
    setEditSeconds(String(Math.floor((current % 60000) / 1000)).padStart(2, "0"));
    setEditMilliseconds(String(current % 1000).padStart(3, "0"));
    setShowSettings(true);
  };

  const [localDeskSidesSwapped, setLocalDeskSidesSwapped] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      try {
        return localStorage.getItem("ringflow_desk_sides_swapped") === "true";
      } catch {}
    }
    return false;
  });

  // Prefer externally-controlled state (from sidebar) over local state
  const deskSidesSwapped = externalDeskSidesSwapped ?? localDeskSidesSwapped;

  const toggleDeskSides = onToggleDeskSides ?? (() => {
    setLocalDeskSidesSwapped((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("ringflow_desk_sides_swapped", String(next));
      } catch {}
      return next;
    });
  });

  const syncLiveState = useCallback(
    (aP: number, oP: number, aPen: number, oPen: number, sen: "AKA" | "AO" | null) => {
      if (!ringId) return;
      // Immediate push to server with zero artificial debounce delay (<5ms)
      updateLiveMatchState(match.id, ringId, {
        akaScore: aP,
        aoScore: oP,
        akaPenalties: aPen,
        aoPenalties: oPen,
        senshu: sen,
      }).catch((err) => console.error("Live state sync error:", err));
    },
    [match.id, ringId]
  );

  // Space / F1 control the clock from anywhere on the desk.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "Space" || e.key === "F1") {
        e.preventDefault();
        void clock.toggle();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clock]);

  // Tap the clock to start/pause, hold to reset.
  const longPressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasLongPressedRef = useRef(false);
  const [isPressing, setIsPressing] = useState(false);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    hasLongPressedRef.current = false;
    setIsPressing(true);
    if (longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current);

    longPressTimeoutRef.current = setTimeout(() => {
      hasLongPressedRef.current = true;
      setIsPressing(false);
      if (typeof window !== "undefined" && window.navigator?.vibrate) {
        window.navigator.vibrate(60);
      }
      void clock.reset();
    }, 850);
  };

  const handlePointerUp = () => {
    if (longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current);
    setIsPressing(false);
    if (!hasLongPressedRef.current) {
      void clock.toggle();
    }
    hasLongPressedRef.current = false;
  };

  const handlePointerLeave = () => {
    if (longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current);
    setIsPressing(false);
  };

  const saveClockSettings = () => {
    const mins = parseInt(editMinutes, 10) || 0;
    const secs = parseInt(editSeconds, 10) || 0;
    const ms = parseInt(editMilliseconds, 10) || 0;
    const targetMs = Math.max(0, mins * 60000 + secs * 1000 + ms);
    const deltaMs = clock.remainingMs - targetMs;
    void clock.adjust(deltaMs);
    setShowSettings(false);
  };

  const recordState = () => {
    setHistory((prev) => [
      ...prev,
      { akaPoints, aoPoints, akaPenalties, aoPenalties, senshu },
    ]);
  };

  const handleScore = (side: "AKA" | "AO", delta: number) => {
    recordState();
    if (side === "AKA") {
      const next = Math.max(0, akaPoints + delta);
      setAkaPoints(next);
      let nextSenshu = senshu;
      if (!senshu && aoPoints === 0 && delta > 0) {
        nextSenshu = "AKA";
        setSenshu("AKA");
      }
      syncLiveState(next, aoPoints, akaPenalties, aoPenalties, nextSenshu);
    } else {
      const next = Math.max(0, aoPoints + delta);
      setAoPoints(next);
      let nextSenshu = senshu;
      if (!senshu && akaPoints === 0 && delta > 0) {
        nextSenshu = "AO";
        setSenshu("AO");
      }
      syncLiveState(akaPoints, next, akaPenalties, aoPenalties, nextSenshu);
    }
  };

  const handleToggleSenshu = (side: "AKA" | "AO") => {
    recordState();
    const nextSenshu = senshu === side ? null : side;
    setSenshu(nextSenshu);
    syncLiveState(akaPoints, aoPoints, akaPenalties, aoPenalties, nextSenshu);
  };

  const handleSetPenalty = (side: "AKA" | "AO", level: number) => {
    recordState();
    if (side === "AKA") {
      const next = akaPenalties === level ? level - 1 : level;
      setAkaPenalties(next);
      syncLiveState(akaPoints, aoPoints, next, aoPenalties, senshu);
      if (next === 5) {
        setSelectedWinnerSide("AO");
        setFinishMethod("HANSOKU");
        setShowFinishModal(true);
      }
    } else {
      const next = aoPenalties === level ? level - 1 : level;
      setAoPenalties(next);
      syncLiveState(akaPoints, aoPoints, akaPenalties, next, senshu);
      if (next === 5) {
        setSelectedWinnerSide("AKA");
        setFinishMethod("HANSOKU");
        setShowFinishModal(true);
      }
    }
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const last = history[history.length - 1];
    setAkaPoints(last.akaPoints);
    setAoPoints(last.aoPoints);
    setAkaPenalties(last.akaPenalties);
    setAoPenalties(last.aoPenalties);
    setSenshu(last.senshu);
    setHistory((prev) => prev.slice(0, prev.length - 1));
    syncLiveState(last.akaPoints, last.aoPoints, last.akaPenalties, last.aoPenalties, last.senshu);
  };

  const handleResetAll = () => {
    if (window.confirm("Reset all points, warnings, and clock for this bout?")) {
      recordState();
      setAkaPoints(0);
      setAoPoints(0);
      setAkaPenalties(0);
      setAoPenalties(0);
      setSenshu(null);
      syncLiveState(0, 0, 0, 0, null);
      void clock.reset();
    }
  };

  const pointDiff = Math.abs(akaPoints - aoPoints);
  const hasEightPointLead = pointDiff >= 8;
  const eightPointLeader = akaPoints > aoPoints ? "AKA" : "AO";

  const handleConfirmWinner = async (winnerSide: "AKA" | "AO", method = finishMethod) => {
    const winnerId = winnerSide === "AKA" ? match.aka.id : match.ao.id;
    if (!winnerId) {
      alert("Cannot confirm: winner athlete ID is missing from slot.");
      return;
    }

    if (match.status === "CONFIRMED" && match.winnerId && winnerId !== match.winnerId) {
      const confirmed = window.confirm(
        "Notice: You are changing the winner of this previously confirmed bout.\n\nDownstream matches will be updated to advance the new winner. Proceed?"
      );
      if (!confirmed) return;
    }

    try {
      setConfirming(true);
      const res = await confirmBoutResult(match.id, winnerId, {
        side: winnerSide,
        akaPoints,
        aoPoints,
        akaPenalties,
        aoPenalties,
        senshu,
        method,
      });

      if (res && !res.success && (res as any).requiresRollbackConfirmation) {
        const conflictMatches = (res as any).conflictMatches || [];
        const matchNames = conflictMatches.map((m: any) => `• Bout #${m.matchNo} (${m.roundName}) [${m.status}]`).join("\n");
        const proceedRollback = window.confirm(
          `CRITICAL CASCADE CONFLICT:\n\nReversing this bout affects ${conflictMatches.length} downstream match(es) that have ALREADY BEEN FOUGHT or are currently live:\n\n${matchNames}\n\nProceeding will ROLL BACK these matches and reset them to Ready so the new winner can compete.\n\nDo you confirm this official match rollback?`
        );
        if (!proceedRollback) {
          setConfirming(false);
          return;
        }

        // Re-run with allowRollback: true
        const retryRes = await confirmBoutResult(match.id, winnerId, {
          side: winnerSide,
          akaPoints,
          aoPoints,
          akaPenalties,
          aoPenalties,
          senshu,
          method,
          allowRollback: true,
        });

        if (!retryRes.success) {
          alert((retryRes as any).error || "Failed to execute rollback.");
          setConfirming(false);
          return;
        }
      } else if (res && !res.success) {
        alert((res as any).error || "Failed to confirm match.");
        setConfirming(false);
        return;
      }

      setShowFinishModal(false);
      onBoutCompleted();
    } catch (err) {
      alert(`Failed to confirm match: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setConfirming(false);
    }
  };

  const statusLabel =
    clock.clock.status === "running"
      ? "Running"
      : clock.clock.status === "paused"
        ? "Paused"
        : clock.clock.status === "finished"
          ? "Time up"
          : "Ready";

  /* ─────── Font size maps driven by deskFontSize prop ─────── */
  const compactNameSize = deskFontSize === "compact" ? "text-[10px]" : deskFontSize === "large" ? "text-[13px]" : "text-[11px]";
  const compactScoreSize = deskFontSize === "compact" ? "text-3xl" : deskFontSize === "large" ? "text-5xl" : "text-4xl";
  const fullNameSize = deskFontSize === "compact" ? "text-lg sm:text-xl" : deskFontSize === "large" ? "text-2xl sm:text-3xl" : "text-xl sm:text-2xl";
  const fullScoreSize = deskFontSize === "compact" ? "text-5xl sm:text-6xl" : deskFontSize === "large" ? "text-7xl sm:text-8xl" : "text-6xl sm:text-7xl";

  /* ─────── Compact mobile competitor card (side-by-side layout) ─────── */
  const renderCompactCompetitor = (side: "AKA" | "AO") => {
    const isAka = side === "AKA";
    const ath = isAka ? match.aka : match.ao;
    const points = isAka ? akaPoints : aoPoints;
    const penalties = isAka ? akaPenalties : aoPenalties;
    const hasSenshu = senshu === side;

    const accentText = isAka ? "text-[#DC2626]" : "text-[#2563EB]";
    const accentBorder = isAka ? "border-[#DC2626]" : "border-[#2563EB]";
    const accentBg = isAka ? "bg-[#DC2626]" : "bg-[#2563EB]";
    const scoreButton = isAka
      ? "bg-[#DC2626] hover:bg-[#B91C1C] active:bg-[#991B1B]"
      : "bg-[#2563EB] hover:bg-[#1D4ED8] active:bg-[#1E40AF]";

    return (
      <section
        aria-label={`${isAka ? "Aka, red" : "Ao, blue"} competitor`}
        className={`flex flex-col rounded-xl border-2 bg-white p-2 ${accentBorder}`}
      >
        {/* Header: badge + senshu */}
        <div className="mb-1.5 flex items-center justify-between gap-1">
          <span className={`rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-white ${accentBg}`}>
            {isAka ? "AKA" : "AO"}
          </span>
          <button
            type="button"
            onClick={() => handleToggleSenshu(side)}
            aria-pressed={hasSenshu}
            className={`rounded px-1.5 py-0.5 text-[9px] font-extrabold transition-colors ${
              hasSenshu
                ? "bg-amber-400 text-amber-950"
                : "bg-[#F5F3EC] text-[#8C877C]"
            }`}
          >
            ★
          </button>
        </div>

        {/* Name */}
        <p className={`truncate font-bold text-[#1B1815] leading-tight mb-1 ${compactNameSize}`}>
          {ath.name || "TBD"}
        </p>

        {/* Score */}
        <div className={`flex items-center justify-center rounded-lg border bg-[#FAF9F5] py-1.5 mb-1.5 ${accentBorder}`}>
          <span className={`font-data-mono font-black tabular-nums ${accentText} ${compactScoreSize}`}>
            {points}
          </span>
        </div>

        {/* +1 / +2 / +3 */}
        <div className="grid grid-cols-3 gap-1 mb-1">
          {[
            { delta: 1, label: "+1" },
            { delta: 2, label: "+2" },
            { delta: 3, label: "+3" },
          ].map(({ delta, label }) => (
            <button
              key={delta}
              type="button"
              onClick={() => handleScore(side, delta)}
              className={`min-h-[48px] rounded-lg font-black text-white shadow-2xs transition-transform active:scale-90 ${scoreButton}`}
            >
              <span className="block text-sm leading-none">{label}</span>
            </button>
          ))}
        </div>

        {/* Penalties compact */}
        <div className="grid grid-cols-5 gap-0.5">
          {PENALTY_LEVELS.map(({ level, label }) => {
            const isActive = penalties >= level;
            return (
              <button
                key={level}
                type="button"
                onClick={() => handleSetPenalty(side, level)}
                aria-pressed={isActive}
                className={`min-h-[32px] rounded text-[9px] font-black transition-colors ${
                  isActive
                    ? level === 5
                      ? "bg-red-600 text-white"
                      : "bg-amber-500 text-white"
                    : "bg-[#F5F3EC] text-[#8C877C]"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </section>
    );
  };

  /* ─────── Full-size desktop competitor card ─────── */
  const renderCompetitor = (side: "AKA" | "AO") => {
    const isAka = side === "AKA";
    const ath = isAka ? match.aka : match.ao;
    const points = isAka ? akaPoints : aoPoints;
    const penalties = isAka ? akaPenalties : aoPenalties;
    const hasSenshu = senshu === side;

    const accentText = isAka ? "text-[#DC2626]" : "text-[#2563EB]";
    const accentBorder = isAka ? "border-[#DC2626]" : "border-[#2563EB]";
    const accentBadge = isAka ? "bg-[#DC2626] text-white" : "bg-[#2563EB] text-white";
    const scoreButton = isAka
      ? "bg-[#DC2626] hover:bg-[#B91C1C] active:bg-[#991B1B]"
      : "bg-[#2563EB] hover:bg-[#1D4ED8] active:bg-[#1E40AF]";

    return (
      <section
        aria-label={`${isAka ? "Aka, red" : "Ao, blue"} competitor`}
        className={`flex flex-col rounded-2xl border-2 bg-white p-3 shadow-sm sm:p-4 ${accentBorder}`}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={`rounded-md px-3 py-1 text-xs font-black uppercase tracking-wider ${accentBadge}`}>
              {isAka ? "AKA (RED)" : "AO (BLUE)"}
            </span>
            {ath.chestNumber && (
              <span className="rounded bg-[#F5F3EC] px-2 py-0.5 font-data-mono text-[11px] font-bold text-[#3D3A33]">
                #{ath.chestNumber}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={() => handleToggleSenshu(side)}
            aria-pressed={hasSenshu}
            className={`min-h-[36px] rounded-md border px-3 py-1 text-xs font-extrabold uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] focus-visible:ring-offset-2 ${
              hasSenshu
                ? "border-amber-500 bg-amber-400 text-amber-950"
                : "border-[#E1DDCF] bg-white text-[#8C877C] hover:text-[#1B1815]"
            }`}
            title="First uncontested point advantage"
          >
            ★ Senshu
          </button>
        </div>

        <div className="mb-4 min-w-0">
          <h3 className={`truncate font-black tracking-tight text-[#1B1815] ${fullNameSize}`}>
            {ath.name || "Competitor TBD"}
          </h3>
          <p className="truncate text-xs font-semibold uppercase text-[#68645A]">
            {ath.school || "Club / Academy"}
          </p>
        </div>

        <div className={`mb-4 flex w-full items-center justify-center rounded-xl border-2 bg-[#FAF9F5] py-3 sm:py-4 ${accentBorder}`}>
          <span className={`font-data-mono font-black tabular-nums ${accentText} ${fullScoreSize}`}>
            {points}
          </span>
        </div>

        <div className="mb-2 grid grid-cols-3 gap-2">
          {[
            { delta: 1, label: "+1", sub: "Yuko" },
            { delta: 2, label: "+2", sub: "Waza-ari" },
            { delta: 3, label: "+3", sub: "Ippon" },
          ].map(({ delta, label, sub }) => (
            <button
              key={delta}
              type="button"
              onClick={() => handleScore(side, delta)}
              className={`min-h-[64px] rounded-xl px-1 py-2 font-black text-white shadow-xs transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] cursor-pointer ${scoreButton}`}
            >
              <span className="block text-2xl font-black leading-none">{label}</span>
              <span className="mt-1 block text-[10px] font-bold uppercase tracking-wider opacity-85">
                {sub}
              </span>
            </button>
          ))}
        </div>

        {/* Subtle Correction Row */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { delta: -1, label: "−1" },
            { delta: -2, label: "−2" },
            { delta: -3, label: "−3" },
          ].map(({ delta, label }) => (
            <button
              key={delta}
              type="button"
              onClick={() => handleScore(side, delta)}
              disabled={points + delta < 0}
              className="min-h-[34px] rounded-lg border border-[#E1DDCF] bg-[#FAF9F5] text-xs font-bold text-[#8C877C] hover:text-[#1B1815] hover:bg-[#F0ECE1] transition-colors disabled:cursor-not-allowed disabled:opacity-30 cursor-pointer"
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-3.5 border-t border-[#E1DDCF] pt-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-black font-data-mono uppercase tracking-wider text-[#8C877C]">
              Penalties (1 → H)
            </span>
            {penalties > 0 && (
              <button
                type="button"
                onClick={() => handleSetPenalty(side, 0)}
                className="text-[10px] font-bold font-data-mono text-[#8C877C] hover:text-red-600 transition-colors cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {PENALTY_LEVELS.map(({ level, label }) => {
              const isActive = penalties >= level;
              return (
                <button
                  key={level}
                  type="button"
                  onClick={() => handleSetPenalty(side, level)}
                  aria-pressed={isActive}
                  className={`min-h-[40px] rounded-lg border text-xs font-black transition-all cursor-pointer ${
                    isActive
                      ? level === 5
                        ? "border-red-700 bg-red-600 text-white shadow-xs"
                        : "border-amber-600 bg-amber-500 text-white shadow-xs"
                      : "border-[#E1DDCF] bg-[#FAF9F5] text-[#68645A] hover:bg-[#F0ECE1]"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </section>
    );
  };

  // No overflow clipping on the container below: it would create a scroll
  // context and break the sticky clock bar.
  return (
    <div ref={padRef} className="rounded-2xl border border-[#E1DDCF] bg-[#FAF9F5] shadow-sm">
      {/* Clock bar — sticky so the time is never scrolled away from the operator */}
      <div className="sticky top-16 z-30 rounded-t-2xl border-b border-[#2A2622] bg-[#1B1815] px-3 py-2.5 text-white sm:px-5 sm:py-3">
        {/* Row 1: bout info + clock + start/pause */}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 shrink">
            <div className="flex items-center gap-1.5">
              <span className="rounded-full bg-[#0E9C7C] px-2 py-0.5 text-[9px] font-black uppercase tracking-wider sm:px-2.5 sm:text-[10px]">
                #{match.matchNo}
              </span>
              <span className="truncate text-[10px] font-bold uppercase text-neutral-400 sm:text-xs">
                {match.roundName}
              </span>
              {match.status === "CONFIRMED" && (
                <span className="rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider flex items-center gap-1">
                  <span className="material-symbols-outlined text-[12px]">edit_note</span>
                  Correction Mode
                </span>
              )}
            </div>
            <h2 className="mt-0.5 truncate text-xs font-bold text-white sm:text-sm md:text-base">
              {categoryName}
            </h2>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2.5">
            {/* Tappable clock display */}
            <div
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerLeave}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter") void clock.toggle();
              }}
              className={`cursor-pointer rounded-lg border px-2 py-1.5 transition-all select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] sm:rounded-xl sm:px-3 sm:py-2 ${
                isPressing ? "scale-95 border-neutral-500 bg-neutral-900" : "border-neutral-700 bg-black/60 hover:border-neutral-500"
              } ${isLow ? "border-amber-500/80" : ""} ${isExpired ? "border-red-600/80 bg-red-950/20" : ""}`}
              title="Tap to start or pause · hold to reset"
            >
              <MatchClock
                remainingMs={remainingMs}
                status={clock.clock.status}
                size="mod"
                tone="dark"
                offsetMs={clock.offsetMs}
              />
            </div>

            {/* Start / Pause button */}
            <button
              type="button"
              onClick={() => void clock.toggle()}
              disabled={pending}
              className={`flex min-h-[40px] items-center gap-1 rounded-lg px-3 py-2 text-[11px] font-black uppercase shadow-sm transition-transform active:scale-95 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] sm:min-h-[44px] sm:gap-1.5 sm:rounded-xl sm:px-4 sm:py-2.5 sm:text-xs ${
                running ? "bg-amber-500 text-black hover:bg-amber-600" : "bg-[#0E9C7C] text-white hover:bg-[#0B7C63]"
              }`}
            >
              <span className="material-symbols-outlined text-[16px] sm:text-[18px]">
                {running ? "pause" : "play_arrow"}
              </span>
              <span className="hidden xs:inline">{running ? "Pause" : "Start"}</span>
            </button>

            {/* Clock tools button — shows settings modal on mobile, inline on desktop */}
            <button
              type="button"
              onClick={openClockSettings}
              className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-neutral-700 bg-neutral-800/90 text-neutral-400 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] md:hidden cursor-pointer"
              title="Edit bout clock"
              aria-label="Edit bout clock"
            >
              <span className="material-symbols-outlined text-[18px]">tune</span>
            </button>
          </div>
        </div>

        {/* Row 2 (md+ only): fine adjust buttons + presets + status */}
        <div className="mt-2 hidden items-center justify-between gap-2 md:flex">
          <div className="flex items-center gap-1 rounded-xl border border-neutral-700 bg-neutral-800/90 p-1">
            {[
              { delta: 1000, label: "+1s" },
              { delta: -1000, label: "-1s" },
              { delta: 100, label: "+.1" },
              { delta: -100, label: "-.1" },
            ].map(({ delta, label }) => (
              <button
                key={label}
                type="button"
                onClick={() => void clock.adjust(delta)}
                disabled={pending}
                className="min-h-[36px] min-w-[36px] rounded-lg px-2 py-1.5 font-data-mono text-[11px] font-bold text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C]"
                title={`${delta > 0 ? "Add" : "Deduct"} ${Math.abs(delta)} milliseconds`}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={openClockSettings}
              className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] cursor-pointer"
              title="Edit bout clock time"
              aria-label="Edit bout clock time"
            >
              <span className="material-symbols-outlined text-[18px]">tune</span>
            </button>
          </div>

          <div className="flex items-center gap-1 rounded-xl border border-neutral-700 bg-neutral-800/90 p-1">
            {PRESETS.map(({ sec, label }) => (
              <button
                key={sec}
                type="button"
                onClick={() => void clock.applyDuration(sec * 1000)}
                disabled={pending}
                className={`min-h-[36px] rounded-lg px-2.5 py-1 text-xs font-bold transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] ${
                  clock.clock.durationMs === sec * 1000
                    ? "bg-[#0E9C7C] text-white"
                    : "text-neutral-400 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <span
            className="text-[11px] font-bold uppercase tracking-wider text-neutral-400"
            aria-live="polite"
          >
            {statusLabel}
          </span>
        </div>

        {clock.error && (
          <p role="alert" className="mt-2 rounded-lg bg-red-950/60 px-3 py-1.5 text-xs font-semibold text-red-200">
            {clock.error}
          </p>
        )}

        {hasEightPointLead && (
          <div className="mt-2 flex items-center justify-between rounded-xl border border-amber-500/50 bg-amber-500/20 px-3 py-2 sm:mt-3 sm:px-4">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-amber-300 sm:text-xs">
              <span className="material-symbols-outlined text-[16px] sm:text-[18px]">gavel</span>
              <span>
                8pt lead · {eightPointLeader} +{pointDiff}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedWinnerSide(eightPointLeader);
                setFinishMethod("8_POINT_LEAD");
                setShowFinishModal(true);
              }}
              className="min-h-[32px] rounded-lg bg-amber-500 px-2.5 py-1 text-[10px] font-black uppercase text-black transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 sm:min-h-[36px] sm:px-3 sm:text-xs"
            >
              End bout
            </button>
          </div>
        )}
      </div>

      {/* ── Competitor grid ────────────────────────────────────── */}
      {/* Mobile: compact side-by-side panels. Tablet+: full cards. */}
      <div className="grid grid-cols-2 gap-2 p-2 md:hidden">
        {deskSidesSwapped ? renderCompactCompetitor("AO") : renderCompactCompetitor("AKA")}
        {deskSidesSwapped ? renderCompactCompetitor("AKA") : renderCompactCompetitor("AO")}
      </div>
      <div className="hidden gap-3 p-3 md:grid md:grid-cols-2 sm:p-4">
        {deskSidesSwapped ? renderCompetitor("AO") : renderCompetitor("AKA")}
        {deskSidesSwapped ? renderCompetitor("AKA") : renderCompetitor("AO")}
      </div>

      {/* Corrections drawer — minus buttons accessible but not cluttering the main view on mobile */}
      <div className="border-t border-[#E1DDCF] px-2 py-1.5 md:hidden">
        <button
          type="button"
          onClick={() => setShowCorrections(!showCorrections)}
          className="flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#8C877C] transition-colors hover:bg-[#ECE9DF]"
        >
          <span className="material-symbols-outlined text-[14px]">{showCorrections ? "expand_less" : "expand_more"}</span>
          Score corrections
        </button>
        {showCorrections && (
          <div className="mt-1 grid grid-cols-2 gap-2 pb-1">
            {(["AKA", "AO"] as const).map((side) => {
              const isAka = side === "AKA";
              const points = isAka ? akaPoints : aoPoints;
              return (
                <div key={side} className="space-y-1">
                  <span className={`text-[9px] font-black uppercase ${isAka ? "text-[#DC2626]" : "text-[#2563EB]"}`}>
                    {side}
                  </span>
                  <div className="grid grid-cols-3 gap-1">
                    {[-1, -2, -3].map((delta) => (
                      <button
                        key={delta}
                        type="button"
                        onClick={() => handleScore(side, delta)}
                        disabled={points + delta < 0}
                        className="min-h-[36px] rounded-lg border border-[#E1DDCF] bg-white text-[10px] font-bold text-[#68645A] disabled:opacity-30"
                      >
                        {delta}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Next fighters, so the desk knows what is coming */}
      {nextBout && (
        <div className="mx-2 mb-2 flex items-center gap-2 rounded-lg border border-[#E1DDCF] bg-white px-3 py-2 text-[10px] sm:mx-6 sm:mb-4 sm:rounded-xl sm:px-4 sm:py-2.5 sm:text-xs">
          <span className="font-black uppercase tracking-wider text-[#8C877C]">On deck</span>
          <span className="truncate font-bold text-[#1B1815]">
            #{nextBout.matchNo} · {nextBout.aka.name || "TBD"} vs {nextBout.ao.name || "TBD"}
          </span>
        </div>
      )}

      {/* ── Action bar ────────────────────────────────────────── */}
      {/* Pinned to bottom, scrollable row on mobile, full labels on tablet+ */}
      <div className="sticky bottom-0 z-30 rounded-b-2xl border-t border-[#E1DDCF] bg-[#F5F3EC]/95 px-2 py-2 backdrop-blur sm:px-4">
        <div className="flex items-center gap-2">
          {/* Tools row — scrollable on mobile */}
          <div className="flex flex-1 items-center gap-1.5 overflow-x-auto scrollbar-none sm:gap-2">

            {/* Hantei */}
            <button
              type="button"
              onClick={() => setShowHanteiModal(true)}
              className="flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg border border-[#E1DDCF] bg-white px-2.5 py-1.5 text-xs font-bold text-[#1B1815] transition-colors hover:bg-[#FAF9F5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] sm:min-h-[44px] sm:rounded-xl sm:px-3 sm:py-2 cursor-pointer"
              title="Hantei (Judges' Decision)"
            >
              <span className="material-symbols-outlined text-[17px] text-amber-600">gavel</span>
              <span>Hantei</span>
            </button>

            {/* Undo */}
            <button
              type="button"
              onClick={handleUndo}
              disabled={history.length === 0}
              className="flex min-h-[40px] shrink-0 items-center gap-1 rounded-lg border border-[#E1DDCF] bg-white px-2 py-1.5 text-xs font-bold text-[#1B1815] transition-colors hover:bg-[#FAF9F5] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] sm:min-h-[44px] sm:rounded-xl sm:px-3 sm:py-2 cursor-pointer"
              title="Undo last score or warning"
            >
              <span className="material-symbols-outlined text-[17px]">undo</span>
              <span className="hidden xs:inline">Undo</span>
            </button>

            {/* Reset */}
            <button
              type="button"
              onClick={handleResetAll}
              className="flex min-h-[40px] shrink-0 items-center gap-1 rounded-lg border border-red-200 bg-white px-2 py-1.5 text-xs font-bold text-red-600 transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 sm:min-h-[44px] sm:rounded-xl sm:px-3 sm:py-2 cursor-pointer"
              title="Reset bout score & penalties"
            >
              <span className="material-symbols-outlined text-[17px]">restart_alt</span>
              <span className="hidden xs:inline">Reset Score</span>
            </button>
          </div>

          {/* Confirm — always visible, full width on small screens */}
          <button
            type="button"
            onClick={() => {
              let defaultSide: "AKA" | "AO" = "AKA";
              if (akaPoints > aoPoints) defaultSide = "AKA";
              else if (aoPoints > akaPoints) defaultSide = "AO";
              else if (senshu) defaultSide = senshu;

              setSelectedWinnerSide(defaultSide);
              setFinishMethod(akaPoints !== aoPoints ? "POINTS" : senshu ? "SENSHU" : "HANTEI");
              setShowFinishModal(true);
            }}
            disabled={confirming}
            className={`flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-extrabold uppercase text-white shadow-sm transition-transform active:scale-95 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 sm:px-6 sm:text-sm ${
              match.status === "CONFIRMED"
                ? "bg-amber-600 hover:bg-amber-700 focus-visible:ring-amber-500"
                : "bg-[#0E9C7C] hover:bg-[#0B7C63] focus-visible:ring-[#0E9C7C]"
            }`}
          >
            <span className="material-symbols-outlined text-[16px] sm:text-[18px]">
              {match.status === "CONFIRMED" ? "edit" : "verified"}
            </span>
            <span className="hidden sm:inline">
              {match.status === "CONFIRMED" ? "Update Result" : "Confirm result"}
            </span>
            <span className="sm:hidden">
              {match.status === "CONFIRMED" ? "Update" : "Confirm"}
            </span>
          </button>
        </div>
      </div>

      {/* ── Modals ────────────────────────────────────────────── */}

      {/* Exact duration / remaining time modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-[#E1DDCF] bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-2 mb-1">
              <h3 className="text-lg font-extrabold text-[#1B1815]">Edit Bout Clock</h3>
              <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-black uppercase text-amber-800">
                Clock Paused
              </span>
            </div>
            <p className="mb-4 text-xs text-[#68645A]">
              Adjust the remaining time on the clock or set a new bout duration. Syncs instantly with the arena TV.
            </p>

            {/* Quick Presets */}
            <div className="mb-4">
              <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-[#8C877C]">
                Duration Presets
              </span>
              <div className="flex items-center gap-1 rounded-xl border border-[#E1DDCF] bg-[#F5F3EC] p-1">
                {PRESETS.map(({ sec, label }) => (
                  <button
                    key={sec}
                    type="button"
                    onClick={() => {
                      setEditMinutes(String(Math.floor(sec / 60)));
                      setEditSeconds(String(sec % 60).padStart(2, "0"));
                      setEditMilliseconds("000");
                      void clock.applyDuration(sec * 1000);
                    }}
                    className={`flex-1 min-h-[38px] rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                      clock.clock.durationMs === sec * 1000
                        ? "bg-[#0E9C7C] text-white shadow-sm"
                        : "text-[#68645A] hover:text-[#1B1815] hover:bg-white"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Quick Adjust Buttons */}
            <div className="mb-4">
              <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-[#8C877C]">
                Quick Adjust Remaining Time
              </span>
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { delta: 5000, label: "+5s" },
                  { delta: -5000, label: "-5s" },
                  { delta: 1000, label: "+1s" },
                  { delta: -1000, label: "-1s" },
                ].map(({ delta, label }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => {
                      // Adjust local edit inputs directly as well as applying to clock
                      void clock.adjust(delta);
                      const currentTotalMs =
                        parseInt(editMinutes || "0", 10) * 60000 +
                        parseInt(editSeconds || "0", 10) * 1000 +
                        parseInt(editMilliseconds || "0", 10);
                      const newTotalMs = Math.max(0, currentTotalMs + delta);
                      setEditMinutes(String(Math.floor(newTotalMs / 60000)));
                      setEditSeconds(String(Math.floor((newTotalMs % 60000) / 1000)).padStart(2, "0"));
                      setEditMilliseconds(String(newTotalMs % 1000).padStart(3, "0"));
                    }}
                    disabled={pending}
                    className="min-h-[38px] rounded-lg border border-[#E1DDCF] bg-[#FAF9F5] font-data-mono text-xs font-bold text-[#3D3A33] transition-colors hover:bg-[#ECE9DF] disabled:opacity-50 cursor-pointer"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Manual mm:ss input */}
            <div className="mb-5">
              <span className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-[#8C877C]">
                Manual Remaining Time
              </span>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Minutes", value: editMinutes, set: setEditMinutes, max: 59 },
                  { label: "Seconds", value: editSeconds, set: setEditSeconds, max: 59 },
                  { label: "Millis", value: editMilliseconds, set: setEditMilliseconds, max: 999 },
                ].map(({ label, value, set, max }) => (
                  <div key={label}>
                    <label className="mb-1 block text-[10px] font-black uppercase text-[#68645A]">
                      {label}
                    </label>
                    <input
                      type="number"
                      min="0"
                      max={max}
                      value={value}
                      onChange={(e) => set(e.target.value)}
                      className="w-full rounded-xl border border-[#E1DDCF] px-3 py-2 text-center font-data-mono text-base font-bold text-[#1B1815] focus:border-[#0E9C7C] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C]"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[#E1DDCF] pt-4">
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="min-h-[44px] rounded-xl border border-[#E1DDCF] px-4 py-2 text-xs font-bold text-[#68645A] hover:bg-[#F5F3EC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveClockSettings}
                className="min-h-[44px] rounded-xl bg-[#0E9C7C] px-5 py-2 text-xs font-black uppercase text-white hover:bg-[#0B7C63] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] focus-visible:ring-offset-2 cursor-pointer"
              >
                Apply Time
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm result */}
      {showFinishModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[#E1DDCF] bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-extrabold text-[#1B1815]">
              {match.status === "CONFIRMED" ? `Update Bout #${match.matchNo} Result` : `Confirm bout #${match.matchNo}`}
            </h3>
            <p className="mb-4 text-xs text-[#68645A]">
              {match.status === "CONFIRMED"
                ? "This bout was already confirmed. Updating the winner will recalculate advancement and replace the athlete downstream."
                : "Pick the winner and the decision method to advance the bracket."}
            </p>

            <div className="mb-4 grid grid-cols-2 gap-3">
              {(["AKA", "AO"] as const).map((side) => {
                const isAka = side === "AKA";
                const ath = isAka ? match.aka : match.ao;
                const selected = selectedWinnerSide === side;
                return (
                  <button
                    key={side}
                    type="button"
                    onClick={() => setSelectedWinnerSide(side)}
                    className={`rounded-xl border-2 p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] ${
                      selected
                        ? isAka
                          ? "border-[#DC2626] bg-red-50"
                          : "border-[#2563EB] bg-blue-50"
                        : "border-[#E1DDCF] bg-white hover:border-[#8C877C]"
                    }`}
                  >
                    <span
                      className={`mb-1.5 block w-max rounded px-2 py-0.5 text-[10px] font-black uppercase text-white ${
                        isAka ? "bg-[#DC2626]" : "bg-[#2563EB]"
                      }`}
                    >
                      {isAka ? "Aka (red)" : "Ao (blue)"}
                    </span>
                    <p className="truncate text-sm font-extrabold text-[#1B1815]">{ath.name}</p>
                    <p className={`mt-1 font-data-mono text-xs font-bold ${isAka ? "text-[#DC2626]" : "text-[#2563EB]"}`}>
                      {isAka ? akaPoints : aoPoints} points
                    </p>
                  </button>
                );
              })}
            </div>

            <div className="mb-5">
              <label htmlFor="decision-method" className="mb-1 block text-xs font-bold uppercase tracking-wider text-[#3D3A33]">
                Decision method
              </label>
              <select
                id="decision-method"
                value={finishMethod}
                onChange={(e) => setFinishMethod(e.target.value)}
                className="w-full rounded-xl border border-[#E1DDCF] bg-white px-3 py-2 text-base font-semibold text-[#1B1815] focus:border-[#0E9C7C] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] sm:text-sm"
              >
                <option value="POINTS">Points difference</option>
                <option value="SENSHU">Senshu (first point)</option>
                <option value="8_POINT_LEAD">8-point lead</option>
                <option value="HANTEI">Hantei (judges)</option>
                <option value="KIKEN">Kiken (injury / forfeit)</option>
                <option value="HANSOKU">Hansoku (disqualification)</option>
                <option value="SHIKKAKU">Shikkaku (severe misconduct)</option>
              </select>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[#E1DDCF] pt-4">
              <button
                type="button"
                onClick={() => setShowFinishModal(false)}
                disabled={confirming}
                className="min-h-[44px] rounded-xl border border-[#E1DDCF] px-4 py-2 text-xs font-bold text-[#68645A] hover:bg-[#F5F3EC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => selectedWinnerSide && handleConfirmWinner(selectedWinnerSide)}
                disabled={!selectedWinnerSide || confirming}
                className={`min-h-[44px] rounded-xl px-5 py-2 text-xs font-black uppercase text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
                  match.status === "CONFIRMED"
                    ? "bg-amber-600 hover:bg-amber-700 focus-visible:ring-amber-500"
                    : "bg-[#0E9C7C] hover:bg-[#0B7C63] focus-visible:ring-[#0E9C7C]"
                }`}
              >
                {confirming ? "Updating…" : match.status === "CONFIRMED" ? "Update & Re-Advance" : "Confirm & advance"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hantei */}
      {showHanteiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-[#E1DDCF] bg-white p-5 shadow-2xl">
            <h3 className="mb-1 text-base font-extrabold text-[#1B1815]">Hantei</h3>
            <p className="mb-4 text-xs text-[#68645A]">
              Tied bout without senshu: declare the majority flag winner.
            </p>

            <div className="mb-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setSelectedWinnerSide("AKA");
                  setFinishMethod("HANTEI");
                  setShowHanteiModal(false);
                  setShowFinishModal(true);
                }}
                className="min-h-[56px] rounded-xl border-2 border-[#DC2626] p-4 text-center text-sm font-black uppercase text-[#DC2626] transition-colors hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#DC2626]"
              >
                Aka flags
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelectedWinnerSide("AO");
                  setFinishMethod("HANTEI");
                  setShowHanteiModal(false);
                  setShowFinishModal(true);
                }}
                className="min-h-[56px] rounded-xl border-2 border-[#2563EB] p-4 text-center text-sm font-black uppercase text-[#2563EB] transition-colors hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]"
              >
                Ao flags
              </button>
            </div>

            <div className="text-right">
              <button
                type="button"
                onClick={() => setShowHanteiModal(false)}
                className="min-h-[44px] rounded-lg px-3 text-xs font-bold text-[#68645A] hover:text-[#1B1815] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
