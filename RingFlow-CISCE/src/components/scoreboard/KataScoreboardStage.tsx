"use client";

import React, { useMemo } from "react";
import { calculateKataScoreDeducing } from "@/lib/kata/scoringEngine";
import { Trophy, Award } from "lucide-react";

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
          (s.judge_seat ?? s.judgeSeat) === seat &&
          (s.target_side ?? s.targetSide ?? "AKA") === "AKA"
      );
      const val = parseFloat(matchScore?.numeric_score ?? matchScore?.numericScore ?? "0");
      return !isNaN(val) && val > 0 ? val : 0;
    });
  }, [kataScores]);

  const aoScoresList = useMemo(() => {
    return [1, 2, 3, 4, 5].map((seat) => {
      const matchScore = kataScores.find(
        (s) =>
          (s.judge_seat ?? s.judgeSeat) === seat &&
          (s.target_side ?? s.targetSide ?? "AO") === "AO"
      );
      const val = parseFloat(matchScore?.numeric_score ?? matchScore?.numericScore ?? "0");
      return !isNaN(val) && val > 0 ? val : 0;
    });
  }, [kataScores]);

  const akaDeducing = useMemo(
    () => calculateKataScoreDeducing(akaScoresList),
    [akaScoresList]
  );
  const aoDeducing = useMemo(
    () => calculateKataScoreDeducing(aoScoresList),
    [aoScoresList]
  );

  const akaFinalScore = aka.score > 0 ? aka.score : akaDeducing.total;
  const aoFinalScore = ao.score > 0 ? ao.score : aoDeducing.total;

  const akaDeclaredKata = currentMatch?.akaKataName || currentMatch?.aka_kata_name || aka.kataName;
  const aoDeclaredKata = currentMatch?.aoKataName || currentMatch?.ao_kata_name || ao.kataName;

  const poolLabel = currentMatch?.poolGroup || currentMatch?.roundName;

  return (
    <div className="flex-1 flex flex-col justify-between p-4 sm:p-8 max-w-7xl mx-auto w-full">
      {/* ─── Top Center Pool / Round Badge ─── */}
      {poolLabel && (
        <div className="flex items-center justify-center mb-4">
          <span className="px-4 py-1.5 rounded-full bg-[#1A1816] border border-[#2E2A27] text-xs font-bold font-data-mono text-[#D4D0C5] tracking-widest uppercase flex items-center gap-2">
            <Trophy className="w-3.5 h-3.5 text-amber-500" />
            <span>{poolLabel}</span>
          </span>
        </div>
      )}

      {/* ─── Split Performers: AKA (Red) vs AO (Blue) ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-10 flex-1 items-stretch my-auto">
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
              <p className="text-base sm:text-xl font-bold text-white font-data-mono truncate mt-0.5">
                {akaDeclaredKata || "—"}
              </p>
            </div>
          </div>

          {/* 5 Judge Marks */}
          {isPointsMode && (
            <div className="mt-5 pt-3 border-t border-[#2E2A27]">
              <div className="text-[10px] font-data-mono font-bold text-[#7A7468] uppercase tracking-wider mb-2">
                Judges
              </div>
              <div className="grid grid-cols-5 gap-2">
                {akaScoresList.map((scoreVal, idx) => {
                  const isDropped = akaDeducing.droppedIndices.includes(idx);
                  const hasVal = scoreVal > 0;
                  return (
                    <div
                      key={idx}
                      className={`flex flex-col items-center justify-center py-2 px-1 rounded-xl border font-data-mono transition-all ${
                        hasVal
                          ? isDropped
                            ? "border-[#3A2222] bg-[#221515] text-[#7A5555]"
                            : "border-red-500/50 bg-red-950/40 text-white font-bold"
                          : "border-[#252220] bg-[#181614] text-[#44403C]"
                      }`}
                    >
                      <span className="text-[9px] uppercase font-bold text-[#6E685E]">J{idx + 1}</span>
                      <span className={`text-base sm:text-lg font-bold ${hasVal && isDropped ? "line-through" : ""}`}>
                        {hasVal ? scoreVal.toFixed(1) : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Official Score */}
          <div className="mt-5 pt-3 border-t border-[#2E2A27] flex items-baseline justify-between">
            <span className="text-xs uppercase tracking-wider font-data-mono font-bold text-[#8C877C]">
              Score
            </span>
            <div className="font-scoreboard text-5xl sm:text-7xl font-black text-[#DC2626] tabular-nums tracking-tight">
              {isPointsMode ? (
                akaFinalScore > 0 ? akaFinalScore.toFixed(2) : "—"
              ) : (
                currentMatch?.akaFlags ?? 0
              )}
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
              <p className="text-base sm:text-xl font-bold text-white font-data-mono truncate mt-0.5">
                {aoDeclaredKata || "—"}
              </p>
            </div>
          </div>

          {/* 5 Judge Marks */}
          {isPointsMode && (
            <div className="mt-5 pt-3 border-t border-[#2E2A27]">
              <div className="text-[10px] font-data-mono font-bold text-[#7A7468] uppercase tracking-wider mb-2">
                Judges
              </div>
              <div className="grid grid-cols-5 gap-2">
                {aoScoresList.map((scoreVal, idx) => {
                  const isDropped = aoDeducing.droppedIndices.includes(idx);
                  const hasVal = scoreVal > 0;
                  return (
                    <div
                      key={idx}
                      className={`flex flex-col items-center justify-center py-2 px-1 rounded-xl border font-data-mono transition-all ${
                        hasVal
                          ? isDropped
                            ? "border-[#20273A] bg-[#141824] text-[#55667A]"
                            : "border-blue-500/50 bg-blue-950/40 text-white font-bold"
                          : "border-[#252220] bg-[#181614] text-[#44403C]"
                      }`}
                    >
                      <span className="text-[9px] uppercase font-bold text-[#6E685E]">J{idx + 1}</span>
                      <span className={`text-base sm:text-lg font-bold ${hasVal && isDropped ? "line-through" : ""}`}>
                        {hasVal ? scoreVal.toFixed(1) : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Official Score */}
          <div className="mt-5 pt-3 border-t border-[#2E2A27] flex items-baseline justify-between">
            <span className="text-xs uppercase tracking-wider font-data-mono font-bold text-[#8C877C]">
              Score
            </span>
            <div className="font-scoreboard text-5xl sm:text-7xl font-black text-[#2563EB] tabular-nums tracking-tight">
              {isPointsMode ? (
                aoFinalScore > 0 ? aoFinalScore.toFixed(2) : "—"
              ) : (
                currentMatch?.aoFlags ?? 0
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
