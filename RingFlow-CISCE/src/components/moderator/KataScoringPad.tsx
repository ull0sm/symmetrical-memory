"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  submitModeratorManualKataMarks,
  getMatchKataScores,
} from "@/actions/kata";
import { useLiveEvents } from "@/hooks/useLiveEvents";
import { calculateKataScoreDeducing } from "@/lib/kata/scoringEngine";
import {
  Trophy,
  Table,
  Check,
  Plus,
  Minus,
  RotateCcw,
  Sparkles,
  ArrowRight,
  Flag,
  Flame,
} from "lucide-react";

interface KataScoringPadProps {
  ringId: string;
  activeMatch: any;
  category: any;
  scores: any[];
  judgePin?: string;
  tunnelUrl?: string | null;
  onRefresh: () => void;
  onViewDrawTable?: () => void;
}

export function KataScoringPad({
  ringId,
  activeMatch,
  category,
  scores,
  onRefresh,
  onViewDrawTable,
}: KataScoringPadProps) {
  const [submittingAction, setSubmittingAction] = useState(false);

  // Judge marks for AKA and AO (strictly null initially - ZERO auto-points)
  const [akaJudgeMarks, setAkaJudgeMarks] = useState<(number | null)[]>([
    null,
    null,
    null,
    null,
    null,
  ]);
  const [aoJudgeMarks, setAoJudgeMarks] = useState<(number | null)[]>([
    null,
    null,
    null,
    null,
    null,
  ]);

  // Raw text inputs for fast decimal auto-typing (e.g. typing "76" turns into "7.6")
  const [akaTexts, setAkaTexts] = useState<string[]>(["", "", "", "", ""]);
  const [aoTexts, setAoTexts] = useState<string[]>(["", "", "", "", ""]);

  // Declared Kata names
  const [akaKataName, setAkaKataName] = useState<string>("");
  const [aoKataName, setAoKataName] = useState<string>("");

  // Flag decisions for 5 judges (if in Flag scoring mode)
  const [judgeFlags, setJudgeFlags] = useState<("AKA" | "AO" | null)[]>([
    null,
    null,
    null,
    null,
    null,
  ]);

  // Input refs for automatic focus advancing: AKA (0-4) -> AO (0-4)
  const akaRefs = useRef<(HTMLInputElement | null)[]>([]);
  const aoRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Synchronize state with match prop
  useEffect(() => {
    if (activeMatch) {
      setAkaKataName(activeMatch.akaKataName || activeMatch.aka_kata_name || "");
      setAoKataName(activeMatch.aoKataName || activeMatch.ao_kata_name || "");
    }
  }, [activeMatch?.id]);

  // Populate incoming scores from database
  const syncScoresToState = useCallback((incomingScores: any[]) => {
    const newAkaMarks: (number | null)[] = [null, null, null, null, null];
    const newAoMarks: (number | null)[] = [null, null, null, null, null];
    const newAkaText = ["", "", "", "", ""];
    const newAoText = ["", "", "", "", ""];
    const newFlags: ("AKA" | "AO" | null)[] = [null, null, null, null, null];

    if (incomingScores && incomingScores.length > 0) {
      incomingScores.forEach((s) => {
        const seat = (s.judge_seat || s.judgeSeat) - 1;
        const side = s.target_side || s.targetSide || "AKA";
        const scoreVal = parseFloat(s.numeric_score || s.numericScore);
        const flag = s.flag_vote || s.flagVote;

        if (seat >= 0 && seat < 5) {
          if (!isNaN(scoreVal) && scoreVal > 0) {
            if (side === "AKA") {
              newAkaMarks[seat] = scoreVal;
              newAkaText[seat] = scoreVal.toFixed(1);
            } else if (side === "AO") {
              newAoMarks[seat] = scoreVal;
              newAoText[seat] = scoreVal.toFixed(1);
            }
          }
          if (flag === "AKA" || flag === "AO") {
            newFlags[seat] = flag;
          }
        }
      });
    }

    setAkaJudgeMarks(newAkaMarks);
    setAoJudgeMarks(newAoMarks);
    setAkaTexts(newAkaText);
    setAoTexts(newAoText);
    setJudgeFlags(newFlags);
  }, []);

  useEffect(() => {
    syncScoresToState(scores || []);
  }, [scores, syncScoresToState]);

  // Direct fetcher for real-time scores
  const loadMatchScores = useCallback(async () => {
    if (!activeMatch?.id) return;
    try {
      const res = await getMatchKataScores(activeMatch.id);
      if (res?.success && res.scores) {
        syncScoresToState(res.scores);
      }
    } catch (err) {
      console.error("Failed to load match scores:", err);
    }
  }, [activeMatch?.id, syncScoresToState]);

  // Live SSE listener
  useLiveEvents({ ringId }, (event) => {
    if (event?.table === "kata_scores" || event?.table === "matches") {
      loadMatchScores();
      onRefresh();
    }
  });

  const isPointsMode =
    category?.kata_scoring_mode === "POINTS" ||
    activeMatch?.kata_scoring_mode === "POINTS" ||
    category?.kataScoringMode === "POINTS";

  // Score deductions (Olympic drop min & max)
  const akaDeducing = useMemo(
    () => calculateKataScoreDeducing(akaJudgeMarks),
    [akaJudgeMarks]
  );
  const aoDeducing = useMemo(
    () => calculateKataScoreDeducing(aoJudgeMarks),
    [aoJudgeMarks]
  );

  // Flag counts
  const akaFlagsCount = useMemo(
    () => judgeFlags.filter((f) => f === "AKA").length,
    [judgeFlags]
  );
  const aoFlagsCount = useMemo(
    () => judgeFlags.filter((f) => f === "AO").length,
    [judgeFlags]
  );

  // Projected winner determination
  const verdict = useMemo(() => {
    if (isPointsMode) {
      if (akaDeducing.hasSufficientMarks && aoDeducing.hasSufficientMarks) {
        if (akaDeducing.total > aoDeducing.total) {
          const diff = (akaDeducing.total - aoDeducing.total).toFixed(2);
          return { winner: "AKA" as const, label: `AKA wins by +${diff}`, diff };
        } else if (aoDeducing.total > akaDeducing.total) {
          const diff = (aoDeducing.total - akaDeducing.total).toFixed(2);
          return { winner: "AO" as const, label: `AO wins by +${diff}`, diff };
        } else {
          return { winner: "TIE" as const, label: "Tie score (Hantei / Tiebreak needed)", diff: "0.00" };
        }
      }
      return null;
    } else {
      const totalFlags = akaFlagsCount + aoFlagsCount;
      if (totalFlags >= 3) {
        if (akaFlagsCount > aoFlagsCount) {
          return { winner: "AKA" as const, label: `AKA wins (${akaFlagsCount}-${aoFlagsCount} Flags)` };
        } else if (aoFlagsCount > akaFlagsCount) {
          return { winner: "AO" as const, label: `AO wins (${aoFlagsCount}-${akaFlagsCount} Flags)` };
        }
      }
      return null;
    }
  }, [isPointsMode, akaDeducing, aoDeducing, akaFlagsCount, aoFlagsCount]);

  // Fast typing auto-advance:
  // e.g. User types "7" -> becomes "7."
  // User types "76" -> becomes "7.6" and auto-advances to next judge input!
  const handleFastInputChange = (
    side: "AKA" | "AO",
    seatIndex: number,
    rawVal: string
  ) => {
    const isAka = side === "AKA";
    const currentTexts = isAka ? [...akaTexts] : [...aoTexts];
    const currentMarks = isAka ? [...akaJudgeMarks] : [...aoJudgeMarks];

    const digitsOnly = rawVal.replace(/[^\d.]/g, "");

    // Clear
    if (digitsOnly === "") {
      currentTexts[seatIndex] = "";
      currentMarks[seatIndex] = null;
      if (isAka) {
        setAkaTexts(currentTexts);
        setAkaJudgeMarks(currentMarks);
      } else {
        setAoTexts(currentTexts);
        setAoJudgeMarks(currentMarks);
      }
      return;
    }

    let parsedScore: number | null = null;
    let formattedText = digitsOnly;
    let shouldAdvance = false;

    if (/^[5-9]$/.test(digitsOnly)) {
      formattedText = `${digitsOnly}.`;
    } else if (/^[5-9]\d$/.test(digitsOnly)) {
      const val = parseFloat(`${digitsOnly[0]}.${digitsOnly[1]}`);
      formattedText = val.toFixed(1);
      parsedScore = val;
      shouldAdvance = true;
    } else if (/^\d+(\.\d{0,2})?$/.test(digitsOnly)) {
      const val = parseFloat(digitsOnly);
      if (!isNaN(val)) {
        parsedScore = Math.max(5.0, Math.min(10.0, val));
        if (digitsOnly.includes(".") && digitsOnly.split(".")[1].length >= 1) {
          shouldAdvance = true;
        }
      }
    }

    currentTexts[seatIndex] = formattedText;
    currentMarks[seatIndex] = parsedScore;

    if (isAka) {
      setAkaTexts(currentTexts);
      setAkaJudgeMarks(currentMarks);
    } else {
      setAoTexts(currentTexts);
      setAoJudgeMarks(currentMarks);
    }

    // Auto advance focus
    if (shouldAdvance) {
      if (seatIndex < 4) {
        if (isAka) {
          akaRefs.current[seatIndex + 1]?.focus();
        } else {
          aoRefs.current[seatIndex + 1]?.focus();
        }
      } else if (isAka && seatIndex === 4) {
        // Jump from AKA J5 to AO J1
        aoRefs.current[0]?.focus();
      }
    }
  };

  const handleKeyDown = (
    side: "AKA" | "AO",
    seatIndex: number,
    e: React.KeyboardEvent<HTMLInputElement>
  ) => {
    const isAka = side === "AKA";
    const currentTexts = isAka ? akaTexts : aoTexts;

    if (e.key === "Backspace" && currentTexts[seatIndex] === "" && seatIndex > 0) {
      if (isAka) {
        akaRefs.current[seatIndex - 1]?.focus();
      } else {
        aoRefs.current[seatIndex - 1]?.focus();
      }
    } else if (e.key === "Enter" || e.key === "ArrowRight") {
      if (seatIndex < 4) {
        if (isAka) akaRefs.current[seatIndex + 1]?.focus();
        else aoRefs.current[seatIndex + 1]?.focus();
      } else if (isAka && seatIndex === 4) {
        aoRefs.current[0]?.focus();
      }
    } else if (e.key === "ArrowLeft" && seatIndex > 0) {
      if (isAka) akaRefs.current[seatIndex - 1]?.focus();
      else aoRefs.current[seatIndex - 1]?.focus();
    }
  };

  const handleStepMark = (side: "AKA" | "AO", seatIndex: number, delta: number) => {
    const isAka = side === "AKA";
    const currentMarks = isAka ? [...akaJudgeMarks] : [...aoJudgeMarks];
    const currentTexts = isAka ? [...akaTexts] : [...aoTexts];

    const currentVal = currentMarks[seatIndex] ?? 7.5;
    const newVal = Math.max(5.0, Math.min(10.0, Number((currentVal + delta).toFixed(1))));

    currentMarks[seatIndex] = newVal;
    currentTexts[seatIndex] = newVal.toFixed(1);

    if (isAka) {
      setAkaJudgeMarks(currentMarks);
      setAkaTexts(currentTexts);
    } else {
      setAoJudgeMarks(currentMarks);
      setAoTexts(currentTexts);
    }
  };

  const handleQuickPreset = (side: "AKA" | "AO", presetVal: number) => {
    const isAka = side === "AKA";
    const currentMarks = isAka ? [...akaJudgeMarks] : [...aoJudgeMarks];
    const currentTexts = isAka ? [...akaTexts] : [...aoTexts];

    // Find first empty seat, or fill J1
    const targetIdx = currentMarks.findIndex((m) => m === null);
    const idxToFill = targetIdx !== -1 ? targetIdx : 0;

    currentMarks[idxToFill] = presetVal;
    currentTexts[idxToFill] = presetVal.toFixed(1);

    if (isAka) {
      setAkaJudgeMarks(currentMarks);
      setAkaTexts(currentTexts);
      if (idxToFill < 4) akaRefs.current[idxToFill + 1]?.focus();
      else aoRefs.current[0]?.focus();
    } else {
      setAoJudgeMarks(currentMarks);
      setAoTexts(currentTexts);
      if (idxToFill < 4) aoRefs.current[idxToFill + 1]?.focus();
    }
  };

  const handleClearSide = (side: "AKA" | "AO") => {
    if (side === "AKA") {
      setAkaJudgeMarks([null, null, null, null, null]);
      setAkaTexts(["", "", "", "", ""]);
      akaRefs.current[0]?.focus();
    } else {
      setAoJudgeMarks([null, null, null, null, null]);
      setAoTexts(["", "", "", "", ""]);
      aoRefs.current[0]?.focus();
    }
  };

  const handleToggleJudgeFlag = (seatIndex: number, flag: "AKA" | "AO") => {
    const updated = [...judgeFlags];
    updated[seatIndex] = updated[seatIndex] === flag ? null : flag;
    setJudgeFlags(updated);
  };

  const handleSaveMarks = async (finalize: boolean = false) => {
    setSubmittingAction(true);
    try {
      let resolvedWinnerSide: "AKA" | "AO" | undefined = undefined;
      if (verdict && verdict.winner !== "TIE") {
        resolvedWinnerSide = verdict.winner;
      }

      const cleanAkaMarks = akaJudgeMarks.map((m) => (m !== null ? m : 0));
      const cleanAoMarks = aoJudgeMarks.map((m) => (m !== null ? m : 0));

      const judgeScoresPayload = [0, 1, 2, 3, 4].map((i) => ({
        seat: i + 1,
        akaScore: cleanAkaMarks[i] || 0,
        aoScore: cleanAoMarks[i] || 0,
      }));

      const res = await submitModeratorManualKataMarks({
        matchId: activeMatch.id,
        akaKataName: akaKataName.trim() || undefined,
        aoKataName: aoKataName.trim() || undefined,
        akaJudgeMarks: cleanAkaMarks,
        aoJudgeMarks: cleanAoMarks,
        judgeScores: judgeScoresPayload,
        winnerSide: resolvedWinnerSide,
        finalize,
      });

      if (res.success) {
        onRefresh();
      } else {
        alert(res.error || "Failed to record score");
      }
    } catch (err: any) {
      alert(err.message || "Failed to save marks");
    } finally {
      setSubmittingAction(false);
    }
  };

  if (!activeMatch) {
    return (
      <div className="bg-white border border-[#E1DDCF] rounded-2xl p-10 text-center text-[#68645A] space-y-4 shadow-xs">
        <Trophy className="w-12 h-12 text-[#8C877C] mx-auto animate-pulse" />
        <h3 className="text-base font-bold text-[#1B1815]">No Active Kata Bout</h3>
        <p className="text-xs text-[#68645A] max-w-sm mx-auto">
          Choose a scheduled bout from the pool tables to begin desk scoring.
        </p>
        {onViewDrawTable && (
          <button
            type="button"
            onClick={onViewDrawTable}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#FAF9F5] border border-[#E1DDCF] hover:bg-[#F0ECE1] text-xs font-bold font-data-mono text-[#1B1815] transition-colors cursor-pointer"
          >
            <Table className="w-4 h-4 text-[#0E9C7C]" />
            <span>Open Pool Tables</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 font-sans select-none">
      {/* ─── Top Control Strip: Minimal, High-Signal ─── */}
      <div className="bg-white border border-[#E1DDCF] rounded-2xl px-5 py-3.5 shadow-2xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-[#0E9C7C] shrink-0">
            <Trophy className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-[#1B1815]">
                Bout #{activeMatch.matchNo || activeMatch.match_no}
              </span>
              <span className="text-[11px] font-bold font-data-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                {isPointsMode ? "5-Judge Olympic (Drop Min & Max)" : "Hantei Flags (Majority)"}
              </span>
              {activeMatch.poolGroup && (
                <span className="text-[11px] font-bold font-data-mono px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                  {activeMatch.poolGroup}
                </span>
              )}
            </div>
            <p className="text-xs text-[#68645A] font-data-mono mt-0.5">
              {activeMatch.aka?.name || "AKA"} (Red) vs {activeMatch.ao?.name || "AO"} (Blue)
            </p>
          </div>
        </div>

        {onViewDrawTable && (
          <button
            type="button"
            onClick={onViewDrawTable}
            className="flex items-center gap-1.5 text-xs font-bold font-data-mono px-3.5 py-2 rounded-xl bg-[#FAF9F5] hover:bg-[#F0ECE1] text-[#1B1815] border border-[#E1DDCF] transition-colors cursor-pointer"
          >
            <Table className="w-4 h-4 text-[#0E9C7C]" />
            <span>Pool Tables</span>
          </button>
        )}
      </div>

      {/* ─── Side-by-Side Arena: Red (AKA) on Left, Blue (AO) on Right ─── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* ══════════ LEFT COLUMN: AKA (RED) ══════════ */}
        <div
          className={`bg-white rounded-2xl border-2 p-4 sm:p-5 flex flex-col justify-between transition-all ${
            verdict?.winner === "AKA"
              ? "border-[#DC2626] ring-3 ring-[#DC2626]/20 shadow-md"
              : "border-[#E1DDCF]"
          }`}
        >
          <div className="space-y-3.5">
            {/* Fighter Header */}
            <div className="flex items-start justify-between gap-2 pb-3 border-b border-[#F0ECE1]">
              <div className="min-w-0">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black font-data-mono bg-red-100 text-[#DC2626] border border-red-200 mb-1">
                  AKA (RED)
                </span>
                <h3 className="font-black text-xl text-[#1B1815] truncate">
                  {activeMatch.aka?.name || "AKA"}
                </h3>
                <p className="text-xs text-[#68645A] truncate font-data-mono">
                  {activeMatch.aka?.school || activeMatch.aka?.dojo || "Dojo / Academy"}
                  {activeMatch.aka?.chestNumber ? ` • #${activeMatch.aka?.chestNumber}` : ""}
                </p>
              </div>

              {/* Declared Kata Input */}
              <div className="w-40 shrink-0">
                <label className="text-[10px] font-bold font-data-mono uppercase tracking-wider text-[#8C877C] block mb-1">
                  Kata Name
                </label>
                <input
                  type="text"
                  value={akaKataName}
                  onChange={(e) => setAkaKataName(e.target.value)}
                  placeholder="e.g. Chatanyara"
                  className="w-full bg-[#FAF9F5] border border-[#E1DDCF] rounded-lg px-2.5 py-1 text-xs font-bold focus:border-[#DC2626] outline-none transition-colors"
                />
              </div>
            </div>

            {/* Official Score Box */}
            <div className="bg-[#FAF9F5] border-2 border-red-200 rounded-xl p-3 flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold font-data-mono text-[#68645A] uppercase tracking-wider block">
                  Official Total
                </span>
                <span className="text-[10px] text-[#8C877C]">
                  {isPointsMode
                    ? akaDeducing.hasSufficientMarks
                      ? "Middle 3 Sum (Min & Max dropped)"
                      : "Awaiting 3+ judge marks"
                    : "Hantei Votes"}
                </span>
              </div>
              <div className="font-data-mono text-3xl font-black text-[#DC2626]">
                {isPointsMode
                  ? akaDeducing.hasSufficientMarks
                    ? akaDeducing.total.toFixed(2)
                    : "—"
                  : `${akaFlagsCount} Flags`}
              </div>
            </div>

            {/* 5 Judge Scores / Flags */}
            {isPointsMode ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold font-data-mono text-[#68645A] uppercase tracking-wider">
                    Judge Marks (J1 - J5)
                  </span>
                  <button
                    type="button"
                    onClick={() => handleClearSide("AKA")}
                    className="text-[10px] font-bold font-data-mono text-[#8C877C] hover:text-red-600 transition-colors cursor-pointer"
                  >
                    Clear AKA
                  </button>
                </div>

                {/* 5 Judge Input Cards */}
                <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
                  {[0, 1, 2, 3, 4].map((i) => {
                    const mark = akaJudgeMarks[i];
                    const textVal = akaTexts[i];
                    const hasMark = typeof mark === "number" && !isNaN(mark);
                    const isDropped =
                      hasMark &&
                      akaDeducing.hasSufficientMarks &&
                      akaDeducing.droppedIndices.includes(i);
                    const isKept =
                      hasMark &&
                      akaDeducing.hasSufficientMarks &&
                      !isDropped;

                    return (
                      <div
                        key={i}
                        className={`rounded-xl p-1.5 border flex flex-col items-center justify-between transition-all ${
                          isDropped
                            ? "bg-red-50/40 border-red-300"
                            : isKept
                            ? "bg-emerald-50/30 border-emerald-400 shadow-2xs"
                            : hasMark
                            ? "bg-white border-[#DC2626]"
                            : "bg-[#FAF9F5] border-[#E1DDCF]"
                        }`}
                      >
                        <div className="flex items-center justify-between w-full text-[10px] font-bold font-data-mono mb-1">
                          <span className="text-[#68645A]">J{i + 1}</span>
                          {isDropped ? (
                            <span className="text-[8px] font-black text-red-600 bg-red-100 px-1 rounded">
                              DROP
                            </span>
                          ) : isKept ? (
                            <span className="text-[8px] font-black text-emerald-800 bg-emerald-100 px-1 rounded">
                              ✓
                            </span>
                          ) : null}
                        </div>

                        {/* Input with Fast Typing */}
                        <input
                          ref={(el) => {
                            akaRefs.current[i] = el;
                          }}
                          type="text"
                          inputMode="decimal"
                          value={textVal}
                          onChange={(e) => handleFastInputChange("AKA", i, e.target.value)}
                          onKeyDown={(e) => handleKeyDown("AKA", i, e)}
                          placeholder="—"
                          className={`w-full text-center font-data-mono text-xl sm:text-2xl font-black bg-transparent outline-none py-1 transition-colors ${
                            isDropped
                              ? "line-through text-red-500"
                              : hasMark
                              ? "text-[#1B1815]"
                              : "text-[#8C877C]"
                          }`}
                        />

                        {/* Stepper Buttons */}
                        <div className="flex items-center gap-1 w-full pt-1 border-t border-[#E1DDCF]/60">
                          <button
                            type="button"
                            onClick={() => handleStepMark("AKA", i, -0.1)}
                            className="flex-1 py-0.5 rounded bg-white hover:bg-[#ECE8DD] border border-[#E1DDCF] flex items-center justify-center text-[#1B1815] transition-colors cursor-pointer text-[10px]"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleStepMark("AKA", i, 0.1)}
                            className="flex-1 py-0.5 rounded bg-white hover:bg-[#ECE8DD] border border-[#E1DDCF] flex items-center justify-center text-[#1B1815] transition-colors cursor-pointer text-[10px]"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Quick Presets */}
                <div className="flex items-center gap-1 pt-1">
                  <span className="text-[10px] font-bold font-data-mono text-[#8C877C]">Quick:</span>
                  {[7.0, 7.5, 7.8, 8.0, 8.2, 8.5].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => handleQuickPreset("AKA", val)}
                      className="px-2 py-0.5 rounded bg-[#FAF9F5] hover:bg-red-50 hover:text-red-700 hover:border-red-300 border border-[#E1DDCF] text-[11px] font-data-mono font-bold text-[#68645A] transition-colors cursor-pointer"
                    >
                      {val.toFixed(1)}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* Flag Mode Selector */
              <div className="space-y-2">
                <span className="text-[11px] font-bold font-data-mono text-[#68645A] uppercase tracking-wider block">
                  Judge Flag Ballots (Click to vote)
                </span>
                <div className="grid grid-cols-5 gap-2">
                  {[0, 1, 2, 3, 4].map((i) => {
                    const isVoted = judgeFlags[i] === "AKA";
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => handleToggleJudgeFlag(i, "AKA")}
                        className={`py-3 rounded-xl border flex flex-col items-center justify-center transition-all cursor-pointer ${
                          isVoted
                            ? "bg-red-600 text-white border-red-700 shadow-sm"
                            : "bg-[#FAF9F5] hover:bg-red-50 text-[#68645A] border-[#E1DDCF]"
                        }`}
                      >
                        <span className="text-[10px] font-data-mono font-bold">J{i + 1}</span>
                        <Flag className={`w-4 h-4 mt-1 ${isVoted ? "fill-white" : ""}`} />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ══════════ RIGHT COLUMN: AO (BLUE) ══════════ */}
        <div
          className={`bg-white rounded-2xl border-2 p-4 sm:p-5 flex flex-col justify-between transition-all ${
            verdict?.winner === "AO"
              ? "border-[#2563EB] ring-3 ring-[#2563EB]/20 shadow-md"
              : "border-[#E1DDCF]"
          }`}
        >
          <div className="space-y-3.5">
            {/* Fighter Header */}
            <div className="flex items-start justify-between gap-2 pb-3 border-b border-[#F0ECE1]">
              <div className="min-w-0">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black font-data-mono bg-blue-100 text-[#2563EB] border border-blue-200 mb-1">
                  AO (BLUE)
                </span>
                <h3 className="font-black text-xl text-[#1B1815] truncate">
                  {activeMatch.ao?.name || "AO"}
                </h3>
                <p className="text-xs text-[#68645A] truncate font-data-mono">
                  {activeMatch.ao?.school || activeMatch.ao?.dojo || "Dojo / Academy"}
                  {activeMatch.ao?.chestNumber ? ` • #${activeMatch.ao?.chestNumber}` : ""}
                </p>
              </div>

              {/* Declared Kata Input */}
              <div className="w-40 shrink-0">
                <label className="text-[10px] font-bold font-data-mono uppercase tracking-wider text-[#8C877C] block mb-1">
                  Kata Name
                </label>
                <input
                  type="text"
                  value={aoKataName}
                  onChange={(e) => setAoKataName(e.target.value)}
                  placeholder="e.g. Anan Dai"
                  className="w-full bg-[#FAF9F5] border border-[#E1DDCF] rounded-lg px-2.5 py-1 text-xs font-bold focus:border-[#2563EB] outline-none transition-colors"
                />
              </div>
            </div>

            {/* Official Score Box */}
            <div className="bg-[#FAF9F5] border-2 border-blue-200 rounded-xl p-3 flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold font-data-mono text-[#68645A] uppercase tracking-wider block">
                  Official Total
                </span>
                <span className="text-[10px] text-[#8C877C]">
                  {isPointsMode
                    ? aoDeducing.hasSufficientMarks
                      ? "Middle 3 Sum (Min & Max dropped)"
                      : "Awaiting 3+ judge marks"
                    : "Hantei Votes"}
                </span>
              </div>
              <div className="font-data-mono text-3xl font-black text-[#2563EB]">
                {isPointsMode
                  ? aoDeducing.hasSufficientMarks
                    ? aoDeducing.total.toFixed(2)
                    : "—"
                  : `${aoFlagsCount} Flags`}
              </div>
            </div>

            {/* 5 Judge Scores / Flags */}
            {isPointsMode ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold font-data-mono text-[#68645A] uppercase tracking-wider">
                    Judge Marks (J1 - J5)
                  </span>
                  <button
                    type="button"
                    onClick={() => handleClearSide("AO")}
                    className="text-[10px] font-bold font-data-mono text-[#8C877C] hover:text-blue-600 transition-colors cursor-pointer"
                  >
                    Clear AO
                  </button>
                </div>

                {/* 5 Judge Input Cards */}
                <div className="grid grid-cols-5 gap-1.5 sm:gap-2">
                  {[0, 1, 2, 3, 4].map((i) => {
                    const mark = aoJudgeMarks[i];
                    const textVal = aoTexts[i];
                    const hasMark = typeof mark === "number" && !isNaN(mark);
                    const isDropped =
                      hasMark &&
                      aoDeducing.hasSufficientMarks &&
                      aoDeducing.droppedIndices.includes(i);
                    const isKept =
                      hasMark &&
                      aoDeducing.hasSufficientMarks &&
                      !isDropped;

                    return (
                      <div
                        key={i}
                        className={`rounded-xl p-1.5 border flex flex-col items-center justify-between transition-all ${
                          isDropped
                            ? "bg-red-50/40 border-red-300"
                            : isKept
                            ? "bg-emerald-50/30 border-emerald-400 shadow-2xs"
                            : hasMark
                            ? "bg-white border-[#2563EB]"
                            : "bg-[#FAF9F5] border-[#E1DDCF]"
                        }`}
                      >
                        <div className="flex items-center justify-between w-full text-[10px] font-bold font-data-mono mb-1">
                          <span className="text-[#68645A]">J{i + 1}</span>
                          {isDropped ? (
                            <span className="text-[8px] font-black text-red-600 bg-red-100 px-1 rounded">
                              DROP
                            </span>
                          ) : isKept ? (
                            <span className="text-[8px] font-black text-emerald-800 bg-emerald-100 px-1 rounded">
                              ✓
                            </span>
                          ) : null}
                        </div>

                        {/* Input with Fast Typing */}
                        <input
                          ref={(el) => {
                            aoRefs.current[i] = el;
                          }}
                          type="text"
                          inputMode="decimal"
                          value={textVal}
                          onChange={(e) => handleFastInputChange("AO", i, e.target.value)}
                          onKeyDown={(e) => handleKeyDown("AO", i, e)}
                          placeholder="—"
                          className={`w-full text-center font-data-mono text-xl sm:text-2xl font-black bg-transparent outline-none py-1 transition-colors ${
                            isDropped
                              ? "line-through text-red-500"
                              : hasMark
                              ? "text-[#1B1815]"
                              : "text-[#8C877C]"
                          }`}
                        />

                        {/* Stepper Buttons */}
                        <div className="flex items-center gap-1 w-full pt-1 border-t border-[#E1DDCF]/60">
                          <button
                            type="button"
                            onClick={() => handleStepMark("AO", i, -0.1)}
                            className="flex-1 py-0.5 rounded bg-white hover:bg-[#ECE8DD] border border-[#E1DDCF] flex items-center justify-center text-[#1B1815] transition-colors cursor-pointer text-[10px]"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleStepMark("AO", i, 0.1)}
                            className="flex-1 py-0.5 rounded bg-white hover:bg-[#ECE8DD] border border-[#E1DDCF] flex items-center justify-center text-[#1B1815] transition-colors cursor-pointer text-[10px]"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Quick Presets */}
                <div className="flex items-center gap-1 pt-1">
                  <span className="text-[10px] font-bold font-data-mono text-[#8C877C]">Quick:</span>
                  {[7.0, 7.5, 7.8, 8.0, 8.2, 8.5].map((val) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => handleQuickPreset("AO", val)}
                      className="px-2 py-0.5 rounded bg-[#FAF9F5] hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 border border-[#E1DDCF] text-[11px] font-data-mono font-bold text-[#68645A] transition-colors cursor-pointer"
                    >
                      {val.toFixed(1)}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* Flag Mode Selector */
              <div className="space-y-2">
                <span className="text-[11px] font-bold font-data-mono text-[#68645A] uppercase tracking-wider block">
                  Judge Flag Ballots (Click to vote)
                </span>
                <div className="grid grid-cols-5 gap-2">
                  {[0, 1, 2, 3, 4].map((i) => {
                    const isVoted = judgeFlags[i] === "AO";
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => handleToggleJudgeFlag(i, "AO")}
                        className={`py-3 rounded-xl border flex flex-col items-center justify-center transition-all cursor-pointer ${
                          isVoted
                            ? "bg-blue-600 text-white border-blue-700 shadow-sm"
                            : "bg-[#FAF9F5] hover:bg-blue-50 text-[#68645A] border-[#E1DDCF]"
                        }`}
                      >
                        <span className="text-[10px] font-data-mono font-bold">J{i + 1}</span>
                        <Flag className={`w-4 h-4 mt-1 ${isVoted ? "fill-white" : ""}`} />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ─── Bottom Action Dock & Winner Verdict Banner ─── */}
      <div className="bg-white border border-[#E1DDCF] rounded-2xl p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* Left: Verdict or status */}
        <div className="flex items-center gap-3">
          {verdict ? (
            <div
              className={`px-4 py-2.5 rounded-xl border flex items-center gap-2.5 font-bold text-sm ${
                verdict.winner === "AKA"
                  ? "bg-red-50 border-red-200 text-red-900"
                  : verdict.winner === "AO"
                  ? "bg-blue-50 border-blue-200 text-blue-900"
                  : "bg-amber-50 border-amber-200 text-amber-900"
              }`}
            >
              <Trophy
                className={`w-5 h-5 ${
                  verdict.winner === "AKA"
                    ? "text-[#DC2626]"
                    : verdict.winner === "AO"
                    ? "text-[#2563EB]"
                    : "text-amber-600"
                }`}
              />
              <span>{verdict.label}</span>
            </div>
          ) : (
            <div className="text-xs text-[#8C877C] font-data-mono flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#8C877C] animate-pulse"></span>
              <span>Awaiting full scoring from both competitors...</span>
            </div>
          )}
        </div>

        {/* Right: Primary action buttons */}
        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <button
            type="button"
            onClick={() => handleSaveMarks(false)}
            disabled={submittingAction}
            className="flex-1 sm:flex-initial px-4 py-2.5 rounded-xl bg-[#FAF9F5] hover:bg-[#F0ECE1] text-[#1B1815] border border-[#E1DDCF] text-xs font-bold font-data-mono transition-colors disabled:opacity-50 cursor-pointer"
          >
            Save Draft
          </button>

          <button
            type="button"
            onClick={() => handleSaveMarks(true)}
            disabled={submittingAction || !verdict || verdict.winner === "TIE"}
            className="flex-1 sm:flex-initial px-5 py-2.5 rounded-xl bg-[#0E9C7C] hover:bg-[#0B8569] text-white shadow-xs text-xs font-black font-data-mono transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer active:scale-98"
          >
            {submittingAction ? (
              <span>Finalizing...</span>
            ) : (
              <>
                <Check className="w-4 h-4" />
                <span>Finalize Bout & Award Win</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
