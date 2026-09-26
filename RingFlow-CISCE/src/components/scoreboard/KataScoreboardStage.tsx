"use client";

import React, { useMemo } from "react";
import { calculateKataScoreDeducing } from "@/lib/kata/scoringEngine";
import { Trophy, Check, Award } from "lucide-react";

interface KataScoreboardStageProps {
  aka: {
    fighter: any;
    score: number;
    kataName?: string;
    isWinner: boolean;
  };
  ao: {
    fighter: any;
    score: number;
    kataName?: string;
    isWinner: boolean;
  };
  currentMatch: any;
  kataScores?: any[];
  isPointsMode?: boolean;
}

export function KataScoreboardStage({
  aka,
  ao,
  currentMatch,
  kataScores = [],
  isPointsMode = true,
}: KataScoreboardStageProps) {
  const akaScoresList = useMemo(() => {
    return [1, 2, 3, 4, 5].map((seat) => {
      const matchScore = kataScores.find(
        (s) =>
          (s.judge_seat || s.judgeSeat) === seat &&
          (s.target_side || s.targetSide || "AKA") === "AKA"
      );
      const val = parseFloat(matchScore?.numeric_score || matchScore?.numericScore);
      return !isNaN(val) && val > 0 ? val : 0;
    });
  }, [kataScores]);

  const aoScoresList = useMemo(() => {
    return [1, 2, 3, 4, 5].map((seat) => {
      const matchScore = kataScores.find(
        (s) =>
          (s.judge_seat || s.judgeSeat) === seat &&
          (s.target_side || s.targetSide || "AO") === "AO"
      );
      const val = parseFloat(matchScore?.numeric_score || matchScore?.numericScore);
      return !isNaN(val) && val > 0 ? val : 0;
    });
  }, [kataScores]);

  const akaDeducing = useMemo(
    () => calculateKataScoreDeducing(akaScoresList.filter((s) => s > 0)),
    [akaScoresList]
  );
  const aoDeducing = useMemo(
    () => calculateKataScoreDeducing(aoScoresList.filter((s) => s > 0)),
    [aoScoresList]
  );

  const akaFinalScore = aka.score || akaDeducing.total;
  const aoFinalScore = ao.score || aoDeducing.total;

  return (
    <div className="flex-1 flex flex-col justify-between p-4 sm:p-8 max-w-7xl mx-auto w-full">
      {/* ─── Top Center Flight / Pool Badge ─── */}
      <div className="flex items-center justify-center gap-3 mb-6">
        <span className="px-4 py-1.5 rounded-full bg-[#1F1D1B] border border-[#33302C] text-xs sm:text-sm font-bold font-data-mono text-[#D4D0C5] tracking-widest uppercase flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-500" />
          <span>{currentMatch?.poolGroup || currentMatch?.roundName || "Kata Flight"}</span>
        </span>
      </div>

      {/* ─── Split Performers: AKA (Red) vs AO (Blue) ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-10 flex-1 items-center">
        {/* AKA Performer Stage */}
        <div
          className={`flex flex-col justify-between rounded-3xl p-6 sm:p-8 border-2 transition-all relative overflow-hidden ${
            aka.isWinner
              ? "bg-red-950/40 border-[#DC2626] shadow-2xl shadow-red-950/60 ring-4 ring-red-600/30"
              : "bg-[#161413] border-[#2E2A27]"
          }`}
        >
          {aka.isWinner && (
            <div className="absolute top-4 right-4 bg-[#DC2626] text-white px-3 py-1 rounded-full text-xs font-bold font-data-mono flex items-center gap-1 shadow-lg">
              <Award className="w-3.5 h-3.5" />
              <span>WINNER</span>
            </div>
          )}

          <div>
            <div className="flex items-center gap-2.5 mb-3">
              <span className="px-3 py-1 rounded-lg text-xs font-black font-data-mono bg-[#DC2626] text-white tracking-widest">
                AKA (RED)
              </span>
              {currentMatch?.aka?.chestNumber && (
                <span className="font-data-mono text-xs text-[#9E988A]">
                  #{currentMatch.aka.chestNumber}
                </span>
              )}
            </div>

            <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-none mb-2">
              {aka.fighter?.name || aka.fighter?.displayName || "AKA"}
            </h2>
            <p className="text-sm sm:text-base font-data-mono text-[#9E988A] truncate">
              {aka.fighter?.school || aka.fighter?.dojo || "Dojo"}
            </p>

            {/* Declared Kata */}
            <div className="mt-4 pt-3 border-t border-[#2E2A27]">
              <span className="text-[10px] uppercase tracking-wider font-data-mono font-bold text-[#7A7468] block">
                Declared Kata
              </span>
              <p className="text-sm sm:text-base font-bold text-red-200 font-data-mono truncate">
                {currentMatch?.akaKataName || currentMatch?.aka_kata_name || "—"}
              </p>
            </div>
          </div>

          {/* 5 Judge Marks Strip (if available) */}
          {akaScoresList.some((s) => s > 0) && isPointsMode && (
            <div className="mt-6 pt-4 border-t border-[#2E2A27]">
              <div className="flex items-center justify-between text-[11px] font-data-mono font-bold text-[#7A7468] mb-2">
                <span>Judge Scores (J1 - J5)</span>
                <span>Olympic Middle 3 Sum</span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {akaScoresList.map((scoreVal, idx) => {
                  const isDropped = akaDeducing.droppedIndices.includes(idx);
                  return (
                    <div
                      key={idx}
                      className={`text-center py-2 px-1 rounded-xl border font-data-mono text-xs sm:text-sm font-bold transition-all ${
                        isDropped
                          ? "border-red-900/60 bg-red-950/20 text-red-400 line-through opacity-60"
                          : "border-red-500/40 bg-red-950/40 text-red-100"
                      }`}
                    >
                      {scoreVal > 0 ? scoreVal.toFixed(1) : "—"}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Massive Official Score */}
          <div className="mt-6 pt-4 border-t border-[#2E2A27] flex items-baseline justify-between">
            <span className="text-xs uppercase tracking-wider font-data-mono font-bold text-[#9E988A]">
              Official Score
            </span>
            <div className="font-scoreboard text-5xl sm:text-7xl font-black text-[#DC2626] tabular-nums">
              {isPointsMode ? (akaFinalScore > 0 ? akaFinalScore.toFixed(2) : "—") : `${currentMatch?.akaFlags ?? 0} Flags`}
            </div>
          </div>
        </div>

        {/* AO Performer Stage */}
        <div
          className={`flex flex-col justify-between rounded-3xl p-6 sm:p-8 border-2 transition-all relative overflow-hidden ${
            ao.isWinner
              ? "bg-blue-950/40 border-[#2563EB] shadow-2xl shadow-blue-950/60 ring-4 ring-blue-600/30"
              : "bg-[#161413] border-[#2E2A27]"
          }`}
        >
          {ao.isWinner && (
            <div className="absolute top-4 right-4 bg-[#2563EB] text-white px-3 py-1 rounded-full text-xs font-bold font-data-mono flex items-center gap-1 shadow-lg">
              <Award className="w-3.5 h-3.5" />
              <span>WINNER</span>
            </div>
          )}

          <div>
            <div className="flex items-center gap-2.5 mb-3">
              <span className="px-3 py-1 rounded-lg text-xs font-black font-data-mono bg-[#2563EB] text-white tracking-widest">
                AO (BLUE)
              </span>
              {currentMatch?.ao?.chestNumber && (
                <span className="font-data-mono text-xs text-[#9E988A]">
                  #{currentMatch.ao.chestNumber}
                </span>
              )}
            </div>

            <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight leading-none mb-2">
              {ao.fighter?.name || ao.fighter?.displayName || "AO"}
            </h2>
            <p className="text-sm sm:text-base font-data-mono text-[#9E988A] truncate">
              {ao.fighter?.school || ao.fighter?.dojo || "Dojo"}
            </p>

            {/* Declared Kata */}
            <div className="mt-4 pt-3 border-t border-[#2E2A27]">
              <span className="text-[10px] uppercase tracking-wider font-data-mono font-bold text-[#7A7468] block">
                Declared Kata
              </span>
              <p className="text-sm sm:text-base font-bold text-blue-200 font-data-mono truncate">
                {currentMatch?.aoKataName || currentMatch?.ao_kata_name || "—"}
              </p>
            </div>
          </div>

          {/* 5 Judge Marks Strip (if available) */}
          {aoScoresList.some((s) => s > 0) && isPointsMode && (
            <div className="mt-6 pt-4 border-t border-[#2E2A27]">
              <div className="flex items-center justify-between text-[11px] font-data-mono font-bold text-[#7A7468] mb-2">
                <span>Judge Scores (J1 - J5)</span>
                <span>Olympic Middle 3 Sum</span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {aoScoresList.map((scoreVal, idx) => {
                  const isDropped = aoDeducing.droppedIndices.includes(idx);
                  return (
                    <div
                      key={idx}
                      className={`text-center py-2 px-1 rounded-xl border font-data-mono text-xs sm:text-sm font-bold transition-all ${
                        isDropped
                          ? "border-blue-900/60 bg-blue-950/20 text-blue-400 line-through opacity-60"
                          : "border-blue-500/40 bg-blue-950/40 text-blue-100"
                      }`}
                    >
                      {scoreVal > 0 ? scoreVal.toFixed(1) : "—"}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Massive Official Score */}
          <div className="mt-6 pt-4 border-t border-[#2E2A27] flex items-baseline justify-between">
            <span className="text-xs uppercase tracking-wider font-data-mono font-bold text-[#9E988A]">
              Official Score
            </span>
            <div className="font-scoreboard text-5xl sm:text-7xl font-black text-[#2563EB] tabular-nums">
              {isPointsMode ? (aoFinalScore > 0 ? aoFinalScore.toFixed(2) : "—") : `${currentMatch?.aoFlags ?? 0} Flags`}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Bottom Footer: WKF Criteria ─── */}
      <div className="text-center pt-6 text-[11px] text-[#7A7468] font-data-mono uppercase tracking-widest">
        Official WKF Kata System • Top 2 per Pool Advance to Championship Flight
      </div>
    </div>
  );
}
