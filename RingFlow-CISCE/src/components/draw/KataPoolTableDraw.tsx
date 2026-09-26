"use client";

import React, { useState } from "react";
import {
  Trophy,
  Award,
  Users,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Edit3,
  X,
  Hourglass,
} from "lucide-react";
import type { KataPool, KataFlightDrawResult } from "@/engine/draw-engine/kataFlightDraw";
import { OFFICIAL_WKF_KATAS } from "@/lib/kata/officialKataList";
import { submitModeratorManualKataMarks } from "@/actions/kata";

interface KataPoolTableDrawProps {
  drawData?: KataFlightDrawResult | null;
  categoryName?: string;
  matches?: any[];
  allAthletes?: any[];
  isModerator?: boolean;
  onRefresh?: () => void;
  onSelectMatch?: (match: any) => void;
}

export function KataPoolTableDraw({
  drawData,
  categoryName = "Kata Category",
  matches = [],
  allAthletes = [],
  isModerator = false,
  onRefresh,
  onSelectMatch,
}: KataPoolTableDrawProps) {
  // Modal state for Moderator Manual Marks Entry
  const [scoringMatch, setScoringMatch] = useState<any | null>(null);
  const [akaKataNum, setAkaKataNum] = useState<number | "">("");
  const [akaKataName, setAkaKataName] = useState<string>("");
  const [aoKataNum, setAoKataNum] = useState<number | "">("");
  const [aoKataName, setAoKataName] = useState<string>("");
  const [akaScoreInput, setAkaScoreInput] = useState<string>("7.5");
  const [aoScoreInput, setAoScoreInput] = useState<string>("7.0");
  const [selectedWinner, setSelectedWinner] = useState<"AKA" | "AO">("AKA");
  const [isSubmittingMarks, setIsSubmittingMarks] = useState(false);
  const [expandedPools, setExpandedPools] = useState<Record<string, boolean>>({
    "pool-a": true,
    "pool-b": true,
  });

  const togglePoolExpand = (poolId: string) => {
    setExpandedPools((prev) => ({ ...prev, [poolId]: !prev[poolId] }));
  };

  // Athlete lookup and extraction: gather from allAthletes prop AND any athletes appearing in matches
  const athletesById = new Map<string, any>();
  allAthletes.forEach((a) => {
    if (a?.id) athletesById.set(a.id, a);
    else if (a?.name) athletesById.set(a.name, a);
  });

  matches.forEach((m) => {
    if (m.aka && m.aka.displayName && m.aka.displayName !== "TBD") {
      const id = m.aka.id || m.aka.registrationId || m.aka.displayName;
      if (!athletesById.has(id)) {
        athletesById.set(id, {
          id,
          name: m.aka.displayName,
          school: m.aka.school,
          chestNumber: m.aka.chestNumber,
        });
      }
    }
    if (m.ao && m.ao.displayName && m.ao.displayName !== "TBD") {
      const id = m.ao.id || m.ao.registrationId || m.ao.displayName;
      if (!athletesById.has(id)) {
        athletesById.set(id, {
          id,
          name: m.ao.displayName,
          school: m.ao.school,
          chestNumber: m.ao.chestNumber,
        });
      }
    }
  });

  const effectiveAthletes = Array.from(athletesById.values());

  // Determine pools from drawData or partition effectiveAthletes across balanced pools
  const numPools = effectiveAthletes.length > 4 ? 2 : 1;
  const half = Math.ceil(effectiveAthletes.length / 2);
  const poolAAthletes = effectiveAthletes.slice(0, half);
  const poolBAthletes = effectiveAthletes.slice(half);

  // Match partitioning
  const poolAMatches = matches.filter(
    (m, i) => m.poolGroup === "Pool A" || m.roundName?.includes("Pool A") || (!m.poolGroup && i < Math.ceil(matches.length / 2))
  );
  const poolBMatches = matches.filter(
    (m, i) => m.poolGroup === "Pool B" || m.roundName?.includes("Pool B") || (!m.poolGroup && i >= Math.ceil(matches.length / 2))
  );

  const calculateAthleteStats = (ath: any, poolMatchesList: any[], orderNo: number) => {
    let wins = 0;
    let losses = 0;
    let totalScore = 0;
    let hasScoredBouts = false;

    poolMatchesList.forEach((m) => {
      const isAka = m.aka?.id === ath.id || m.aka?.displayName === ath.name;
      const isAo = m.ao?.id === ath.id || m.ao?.displayName === ath.name;
      if (!isAka && !isAo) return;

      if (m.status === "COMPLETED" || m.winnerSide) {
        const isWinner =
          (isAka && (m.winnerSide === "AKA" || m.winner_side === "AKA")) ||
          (isAo && (m.winnerSide === "AO" || m.winner_side === "AO")) ||
          m.winnerId === ath.id;
        if (isWinner) wins++;
        else losses++;
      }

      const akaScoreVal = parseFloat(m.akaScoreTotal || m.aka_score_total || m.akaScore);
      const aoScoreVal = parseFloat(m.aoScoreTotal || m.ao_score_total || m.aoScore);

      if (isAka && !isNaN(akaScoreVal) && akaScoreVal > 0) {
        totalScore += akaScoreVal;
        hasScoredBouts = true;
      } else if (isAo && !isNaN(aoScoreVal) && aoScoreVal > 0) {
        totalScore += aoScoreVal;
        hasScoredBouts = true;
      }
    });

    return {
      orderNo,
      athleteId: ath.id || ath.name,
      name: ath.name || ath.displayName,
      chestNumber: ath.chestNumber,
      school: ath.school || ath.dojo,
      wins,
      losses,
      hasScoredBouts,
      totalScore: hasScoredBouts ? Number(totalScore.toFixed(2)) : null,
      victoryPoints: wins * 3,
    };
  };

  const hasPoolACompleted = poolAMatches.some(
    (m) => m.status === "COMPLETED" || Boolean(m.winnerSide)
  );
  const poolAComputed = poolAAthletes
    .map((a, i) => calculateAthleteStats(a, poolAMatches, i + 1))
    .sort((a, b) => {
      if (!hasPoolACompleted) return a.orderNo - b.orderNo;
      return b.victoryPoints - a.victoryPoints || (b.totalScore ?? 0) - (a.totalScore ?? 0);
    })
    .map((a, i) => ({
      ...a,
      rank: hasPoolACompleted && (a.wins > 0 || a.hasScoredBouts) ? i + 1 : null,
      isQualified: hasPoolACompleted && i < 2 && a.wins > 0,
    }));

  const hasPoolBCompleted = poolBMatches.some(
    (m) => m.status === "COMPLETED" || Boolean(m.winnerSide)
  );
  const poolBComputed = poolBAthletes
    .map((a, i) => calculateAthleteStats(a, poolBMatches, i + 1))
    .sort((a, b) => {
      if (!hasPoolBCompleted) return a.orderNo - b.orderNo;
      return b.victoryPoints - a.victoryPoints || (b.totalScore ?? 0) - (a.totalScore ?? 0);
    })
    .map((a, i) => ({
      ...a,
      rank: hasPoolBCompleted && (a.wins > 0 || a.hasScoredBouts) ? i + 1 : null,
      isQualified: hasPoolBCompleted && i < 2 && a.wins > 0,
    }));

  const pools: KataPool[] = drawData?.pools && drawData.pools.length > 0 && drawData.pools[0].athletes.length > 0
    ? drawData.pools
    : [
        {
          poolId: "pool-a",
          poolName: "Pool A (Group 1)",
          athletes: poolAComputed,
          matches: poolAMatches,
        },
        ...(numPools > 1
          ? [
              {
                poolId: "pool-b",
                poolName: "Pool B (Group 2)",
                athletes: poolBComputed,
                matches: poolBMatches,
              },
            ]
          : []),
      ];

  // Finalists - only athletes who have actually qualified through completed pool bouts
  const finalists: any[] = [];
  pools.forEach((p) => {
    p.athletes.filter((a) => a.isQualified).forEach((a) => finalists.push(a));
  });

  const handleOpenEnterMarks = (match: any) => {
    setScoringMatch(match);
    setAkaScoreInput(match.akaScoreTotal || match.aka_score_total || "7.5");
    setAoScoreInput(match.aoScoreTotal || match.ao_score_total || "7.0");
    setAkaKataName(match.akaKataName || match.aka_kata_name || "");
    setAoKataName(match.aoKataName || match.ao_kata_name || "");
    setSelectedWinner(
      (match.winnerSide || match.winner_side || "AKA").toUpperCase() as "AKA" | "AO"
    );
  };

  const handleSaveMarks = async (finalize: boolean = true) => {
    if (!scoringMatch) return;
    setIsSubmittingMarks(true);
    try {
      const res = await submitModeratorManualKataMarks({
        matchId: scoringMatch.id,
        akaKataNumber: typeof akaKataNum === "number" ? akaKataNum : undefined,
        akaKataName: akaKataName || undefined,
        aoKataNumber: typeof aoKataNum === "number" ? aoKataNum : undefined,
        aoKataName: aoKataName || undefined,
        akaScore: parseFloat(akaScoreInput) || 7.5,
        aoScore: parseFloat(aoScoreInput) || 7.0,
        winnerSide: selectedWinner,
        finalize,
      });

      if (res.success) {
        setScoringMatch(null);
        if (onRefresh) onRefresh();
      } else {
        alert(res.error || "Failed to save marks");
      }
    } catch (err: any) {
      alert(err.message || "Failed to submit marks");
    } finally {
      setIsSubmittingMarks(false);
    }
  };

  return (
    <div className="space-y-6 select-none font-sans text-[#1B1815]">
      {/* ─── Category Overview Banner (RingFlow Clean Paper Style) ─── */}
      <div className="bg-white border border-[#E1DDCF] rounded-2xl p-5 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-amber-50 text-[#D97706] border border-amber-200 flex items-center justify-center shrink-0">
            <Trophy className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-[#1B1815] tracking-tight">
                {categoryName}
              </h2>
              <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-900 font-data-mono font-bold border border-emerald-200">
                Groups & Elimination Flight
              </span>
            </div>
            <p className="text-xs text-[#68645A] mt-0.5">
              Preliminary flight scoring sheet with Top 2 advancing to the Final Championship Flight
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-[#68645A] font-data-mono">
          <div className="flex items-center gap-1.5 bg-[#FAF9F5] border border-[#E1DDCF] px-3 py-1.5 rounded-lg">
            <Users className="w-3.5 h-3.5 text-[#8C877C]" />
            <span className="font-bold text-[#1B1815]">{effectiveAthletes.length}</span>
            <span>Athletes</span>
          </div>
          <div className="bg-[#FAF9F5] border border-[#E1DDCF] px-3 py-1.5 rounded-lg font-bold text-[#1B1815]">
            {pools.length} Pools
          </div>
        </div>
      </div>

      {/* ─── Preliminary Flight Scoring Sheet Tables ─── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#68645A] font-data-mono flex items-center gap-2">
            <span>Preliminary Flight Scoring-Sheet Tables</span>
          </h3>
          <span className="text-xs text-[#8C877C] font-data-mono">
            WKF Criteria: Wins (3 VP) • Total Scores • Head-to-Head
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {pools.map((pool) => {
            const isExpanded = expandedPools[pool.poolId] ?? true;
            return (
              <div
                key={pool.poolId}
                className="bg-white border border-[#E1DDCF] rounded-2xl shadow-xs overflow-hidden flex flex-col transition-all"
              >
                {/* Pool Header */}
                <div className="bg-[#FAF9F5] px-5 py-3.5 border-b border-[#E1DDCF] flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs font-bold font-data-mono text-[#0E9C7C] bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-md uppercase tracking-wider">
                      {pool.poolName}
                    </span>
                    <span className="text-xs text-[#68645A] font-data-mono">
                      {pool.athletes.length} Athletes
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold font-data-mono text-emerald-800 bg-emerald-100/60 border border-emerald-300 px-2.5 py-0.5 rounded-md">
                      Top 2 Advance (Q)
                    </span>
                    <button
                      onClick={() => togglePoolExpand(pool.poolId)}
                      className="p-1 text-[#68645A] hover:text-[#1B1815] rounded hover:bg-[#F0ECE1] transition-colors"
                      title={isExpanded ? "Collapse" : "Expand"}
                    >
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Pool Athletes Standings Table */}
                <div className="overflow-x-auto flex-1">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-[#FAF9F5] text-[#68645A] font-data-mono text-[10px] uppercase tracking-wider border-b border-[#E1DDCF]">
                      <tr>
                        <th className="py-2.5 px-3 w-10 text-center">#</th>
                        <th className="py-2.5 px-3">Athlete / School</th>
                        <th className="py-2.5 px-2 text-center">Score</th>
                        <th className="py-2.5 px-2 text-center">Rank</th>
                        <th className="py-2.5 px-3 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E1DDCF]/60">
                      {pool.athletes.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-6 text-center text-xs text-[#8C877C]">
                            No athletes seeded into this pool yet.
                          </td>
                        </tr>
                      ) : (
                        pool.athletes.map((ath) => (
                          <tr
                            key={ath.athleteId}
                            className={`hover:bg-[#FAF9F5] transition-colors ${
                              ath.isQualified ? "bg-emerald-50/40" : ""
                            }`}
                          >
                            <td className="py-2.5 px-3 font-data-mono text-center text-[#8C877C] font-semibold">
                              {ath.orderNo}
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="font-bold text-[#1B1815] text-xs">
                                {ath.name}
                              </div>
                              <div className="text-[11px] text-[#68645A] flex items-center gap-1.5">
                                <span>{ath.school || ath.dojo || "Dojo"}</span>
                                {ath.chestNumber && (
                                  <span className="font-data-mono text-[10px] bg-[#FAF9F5] border border-[#E1DDCF] px-1 rounded text-[#504C42]">
                                    #{ath.chestNumber}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-2 text-center font-data-mono font-bold text-[#B45309]">
                              {ath.totalScore !== null && ath.totalScore !== undefined ? ath.totalScore.toFixed(2) : "—"}
                            </td>
                            <td className="py-2.5 px-2 text-center font-data-mono font-bold text-[#1B1815]">
                              {ath.rank ? `${ath.rank}` : "—"}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              {ath.isQualified ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold font-data-mono text-emerald-800 bg-emerald-50 border border-emerald-300 px-2 py-0.5 rounded-full">
                                  <CheckCircle2 className="w-3 h-3 text-[#0E9C7C]" /> Qualified (Q)
                                </span>
                              ) : (
                                <span className="text-[10px] font-data-mono text-[#8C877C]">
                                  {ath.rank ? `Ranked #${ath.rank}` : "Scheduled"}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pool Scheduled Bouts (Visible when expanded) */}
                {isExpanded && pool.matches && pool.matches.length > 0 && (
                  <div className="border-t border-[#E1DDCF] bg-[#FAF9F5]/50 p-3 space-y-2">
                    <span className="text-[10px] font-bold font-data-mono uppercase tracking-wider text-[#8C877C] block">
                      Scheduled Pool Bouts ({pool.matches.length})
                    </span>
                    <div className="space-y-1.5">
                      {pool.matches.map((m: any) => {
                        const akaAth = m.akaAthlete || m.aka || athletesById.get(m.akaAthleteId) || athletesById.get(m.aka?.id);
                        const aoAth = m.aoAthlete || m.ao || athletesById.get(m.aoAthleteId) || athletesById.get(m.ao?.id);
                        const isCompleted = m.status === "COMPLETED";

                        return (
                          <div
                            key={m.id}
                            className="bg-white border border-[#E1DDCF] rounded-lg p-2 flex items-center justify-between text-xs"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-data-mono text-[10px] font-bold text-[#8C877C] w-6">
                                #{m.matchNo || m.match_no}
                              </span>
                              <div className="flex items-center gap-1.5 font-bold">
                                <span className="text-[#DC2626] font-data-mono">AKA</span>
                                <span className="text-[#1B1815] truncate max-w-[100px]">
                                  {akaAth?.name || "AKA"}
                                </span>
                                <span className="text-[#8C877C] text-[10px]">vs</span>
                                <span className="text-[#2563EB] font-data-mono">AO</span>
                                <span className="text-[#1B1815] truncate max-w-[100px]">
                                  {aoAth?.name || "AO"}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              {isCompleted ? (
                                <span className="text-[10px] font-bold font-data-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
                                  {m.winnerSide || m.winner_side} WIN
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold font-data-mono text-[#8C877C]">
                                  {m.status}
                                </span>
                              )}

                              {isModerator && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenEnterMarks(m)}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#FAF9F5] hover:bg-emerald-50 text-[#1B1815] hover:text-[#0E9C7C] border border-[#E1DDCF] text-[10px] font-bold font-data-mono transition-colors"
                                >
                                  <Edit3 className="w-3 h-3" />
                                  <span>Marks</span>
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Final Championship Flight Table (Medal Standings) ─── */}
      <div className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[#B45309] font-data-mono flex items-center gap-2">
          <Trophy className="w-4 h-4 text-[#D97706]" />
          <span>Final Championship Flight (Medal Standings)</span>
          <span className="h-px bg-amber-200 flex-1" />
        </h3>

        <div className="bg-white border-2 border-amber-300/80 rounded-2xl shadow-xs overflow-hidden">
          <div className="bg-gradient-to-r from-amber-50 to-orange-50 px-6 py-4 border-b border-amber-200 flex items-center justify-between">
            <div>
              <h4 className="text-sm font-bold text-[#1B1815] flex items-center gap-2">
                <span>Championship Flight Table</span>
                <span className="text-[11px] bg-amber-100 text-amber-900 border border-amber-300 font-data-mono px-2 py-0.5 rounded-full font-bold">
                  Finalists from Preliminary Pools
                </span>
              </h4>
              <p className="text-xs text-[#68645A] mt-0.5">
                Competitors perform their final kata to determine 1st (Gold), 2nd (Silver), and 3rd (Bronze)
              </p>
            </div>
            <Award className="w-6 h-6 text-[#D97706]" />
          </div>

          <div className="overflow-x-auto">
            {finalists.length === 0 ? (
              <div className="py-8 text-center px-4 space-y-1">
                <Hourglass className="w-8 h-8 text-amber-400 mx-auto" />
                <p className="text-xs font-data-mono font-medium text-[#68645A]">
                  No finalists determined yet.
                </p>
                <p className="text-[11px] text-[#8C877C]">
                  Finalists will appear here automatically as preliminary pool bouts are completed and scored.
                </p>
              </div>
            ) : (
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-amber-50/50 text-[#68645A] font-data-mono text-[10px] uppercase tracking-wider border-b border-amber-200">
                  <tr>
                    <th className="py-3 px-5 w-16 text-center">Bout</th>
                    <th className="py-3 px-5">Finalist / Dojo</th>
                    <th className="py-3 px-4 text-center">Kata Performed</th>
                    <th className="py-3 px-4 text-center">Final Score</th>
                    <th className="py-3 px-5 text-right">Podium Finish</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E1DDCF]/60">
                  {finalists.map((f, index) => {
                    const medalPlacement =
                      index === 0
                        ? {
                            label: "1st Place - Gold",
                            badgeClass: "bg-amber-100 text-amber-950 border-amber-300 font-black",
                            icon: "🥇",
                          }
                        : index === 1
                        ? {
                            label: "2nd Place - Silver",
                            badgeClass: "bg-slate-100 text-slate-800 border-slate-300 font-black",
                            icon: "🥈",
                          }
                        : index === 2
                        ? {
                            label: "3rd Place - Bronze",
                            badgeClass: "bg-amber-50 text-amber-900 border-amber-200 font-black",
                            icon: "🥉",
                          }
                        : {
                            label: "Finalist",
                            badgeClass: "bg-stone-100 text-stone-700 border-stone-200 font-semibold",
                            icon: "🏅",
                          };

                    return (
                      <tr
                        key={f.athleteId || index}
                        className={`hover:bg-[#FAF9F5] transition-colors ${
                          index === 0 ? "bg-amber-50/20" : ""
                        }`}
                      >
                        <td className="py-3.5 px-5 text-center font-data-mono font-bold text-[#8C877C]">
                          F-{index + 1}
                        </td>
                        <td className="py-3.5 px-5">
                          <div className="font-bold text-[#1B1815] text-sm">
                            {f.name}
                          </div>
                          <div className="text-[11px] text-[#68645A]">
                            {f.school || f.dojo || "Dojo"}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-center text-[#504C42] italic font-medium">
                          {f.kataName || "—"}
                        </td>
                        <td className="py-3.5 px-4 text-center font-data-mono font-bold text-sm text-[#B45309]">
                          {f.totalScore !== null && f.totalScore !== undefined ? f.totalScore.toFixed(2) : "—"}
                        </td>
                        <td className="py-3.5 px-5 text-right">
                          <span
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border font-data-mono ${medalPlacement.badgeClass}`}
                          >
                            <span>{medalPlacement.icon}</span>
                            <span>{medalPlacement.label}</span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* ─── Moderator Manual Marks Modal ─── */}
      {scoringMatch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-[#FAF9F5] w-full max-w-lg rounded-2xl shadow-2xl border border-[#E1DDCF] overflow-hidden flex flex-col animate-in fade-in">
            {/* Modal Header */}
            <div className="bg-white px-5 py-4 border-b border-[#E1DDCF] flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold font-data-mono uppercase tracking-wider text-[#0E9C7C]">
                  Moderator Score Override
                </span>
                <h3 className="font-bold text-base text-[#1B1815]">
                  Enter Manual Marks • Match #{scoringMatch.matchNo || scoringMatch.match_no}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setScoringMatch(null)}
                className="p-1.5 text-[#68645A] hover:text-[#1B1815] rounded-lg hover:bg-[#FAF9F5]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 overflow-y-auto max-h-[75vh]">
              {/* AKA (Red) Performer */}
              <div className="bg-white border border-[#DC2626]/30 rounded-xl p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold font-data-mono text-[#DC2626] bg-red-50 border border-red-200 px-2 py-0.5 rounded">
                    AKA (Red Side)
                  </span>
                  <span className="font-bold text-xs text-[#1B1815]">
                    {scoringMatch.akaAthlete?.name || scoringMatch.aka_name || "AKA Competitor"}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-[#68645A] block mb-1">
                      Kata # (1-102)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={102}
                      value={akaKataNum}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setAkaKataNum(isNaN(val) ? "" : val);
                        const k = OFFICIAL_WKF_KATAS.find((x) => x.number === val);
                        if (k) setAkaKataName(k.name);
                      }}
                      placeholder="e.g. 2"
                      className="w-full bg-[#FAF9F5] border border-[#E1DDCF] rounded-lg px-2.5 py-1.5 text-xs font-data-mono font-bold focus:border-[#0E9C7C] outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-[#68645A] block mb-1">
                      Score Mark (5.0 - 10.0)
                    </label>
                    <input
                      type="number"
                      step={0.1}
                      min={5.0}
                      max={10.0}
                      value={akaScoreInput}
                      onChange={(e) => setAkaScoreInput(e.target.value)}
                      className="w-full bg-[#FAF9F5] border border-[#E1DDCF] rounded-lg px-2.5 py-1.5 text-xs font-data-mono font-bold text-[#DC2626] focus:border-[#0E9C7C] outline-none"
                    />
                  </div>
                </div>
                {akaKataName && (
                  <p className="text-[11px] text-[#504C42] italic">Kata: {akaKataName}</p>
                )}
              </div>

              {/* AO (Blue) Performer */}
              <div className="bg-white border border-[#2563EB]/30 rounded-xl p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold font-data-mono text-[#2563EB] bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">
                    AO (Blue Side)
                  </span>
                  <span className="font-bold text-xs text-[#1B1815]">
                    {scoringMatch.aoAthlete?.name || scoringMatch.ao_name || "AO Competitor"}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-[#68645A] block mb-1">
                      Kata # (1-102)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={102}
                      value={aoKataNum}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setAoKataNum(isNaN(val) ? "" : val);
                        const k = OFFICIAL_WKF_KATAS.find((x) => x.number === val);
                        if (k) setAoKataName(k.name);
                      }}
                      placeholder="e.g. 8"
                      className="w-full bg-[#FAF9F5] border border-[#E1DDCF] rounded-lg px-2.5 py-1.5 text-xs font-data-mono font-bold focus:border-[#0E9C7C] outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-[#68645A] block mb-1">
                      Score Mark (5.0 - 10.0)
                    </label>
                    <input
                      type="number"
                      step={0.1}
                      min={5.0}
                      max={10.0}
                      value={aoScoreInput}
                      onChange={(e) => setAoScoreInput(e.target.value)}
                      className="w-full bg-[#FAF9F5] border border-[#E1DDCF] rounded-lg px-2.5 py-1.5 text-xs font-data-mono font-bold text-[#2563EB] focus:border-[#0E9C7C] outline-none"
                    />
                  </div>
                </div>
                {aoKataName && (
                  <p className="text-[11px] text-[#504C42] italic">Kata: {aoKataName}</p>
                )}
              </div>

              {/* Majority Winner Selector */}
              <div>
                <label className="text-xs font-bold text-[#1B1815] uppercase tracking-wider font-data-mono block mb-1.5">
                  Declare Bout Winner
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedWinner("AKA")}
                    className={`py-2 px-3 rounded-lg font-data-mono font-bold text-xs border transition-all ${
                      selectedWinner === "AKA"
                        ? "bg-red-50 text-[#DC2626] border-[#DC2626] shadow-xs"
                        : "bg-white text-[#68645A] border-[#E1DDCF] hover:bg-[#FAF9F5]"
                    }`}
                  >
                    AKA (Red) Wins
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedWinner("AO")}
                    className={`py-2 px-3 rounded-lg font-data-mono font-bold text-xs border transition-all ${
                      selectedWinner === "AO"
                        ? "bg-blue-50 text-[#2563EB] border-[#2563EB] shadow-xs"
                        : "bg-white text-[#68645A] border-[#E1DDCF] hover:bg-[#FAF9F5]"
                    }`}
                  >
                    AO (Blue) Wins
                  </button>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-white px-5 py-3.5 border-t border-[#E1DDCF] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setScoringMatch(null)}
                className="px-3.5 py-2 rounded-lg text-xs font-bold text-[#68645A] hover:bg-[#FAF9F5]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmittingMarks}
                onClick={() => handleSaveMarks(false)}
                className="px-3.5 py-2 rounded-lg text-xs font-bold font-data-mono bg-white border border-[#E1DDCF] text-[#1B1815] hover:bg-[#FAF9F5]"
              >
                Save Draft Marks
              </button>
              <button
                type="button"
                disabled={isSubmittingMarks}
                onClick={() => handleSaveMarks(true)}
                className="px-4 py-2 rounded-lg text-xs font-bold font-data-mono bg-[#0E9C7C] hover:bg-[#0c8569] text-white shadow-xs"
              >
                {isSubmittingMarks ? "Saving..." : "Confirm & Advance Bout"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
