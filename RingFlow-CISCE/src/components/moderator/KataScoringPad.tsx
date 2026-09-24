"use client";

import React, { useState, useEffect } from "react";
import {
  submitJudgeVote,
  voidJudgeVote,
  finalizeKataBout,
  updateRingJudgePin,
  submitModeratorManualKataMarks,
} from "@/actions/kata";
import {
  QrCode,
  Users,
  CheckCircle2,
  RotateCcw,
  Lock,
  Trophy,
  Eye,
  EyeOff,
  Edit2,
  Table,
} from "lucide-react";
import { OFFICIAL_WKF_KATAS } from "@/lib/kata/officialKataList";

interface KataScoringPadProps {
  ringId: string;
  activeMatch: any;
  category: any;
  scores: any[];
  judgePin?: string;
  onRefresh: () => void;
  onViewDrawTable?: () => void;
}

export function KataScoringPad({
  ringId,
  activeMatch,
  category,
  scores,
  judgePin = "1234",
  onRefresh,
  onViewDrawTable,
}: KataScoringPadProps) {
  const [showQrModal, setShowQrModal] = useState(false);
  const [currentPin, setCurrentPin] = useState(judgePin);
  const [newPinInput, setNewPinInput] = useState(judgePin);
  const [isEditingPin, setIsEditingPin] = useState(false);
  const [maskVotes, setMaskVotes] = useState(false);
  const [submittingAction, setSubmittingAction] = useState(false);

  // Manual Marks entry state
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualAkaScore, setManualAkaScore] = useState<string>("7.5");
  const [manualAoScore, setManualAoScore] = useState<string>("7.0");
  const [manualAkaKataNum, setManualAkaKataNum] = useState<number | "">("");
  const [manualAkaKataName, setManualAkaKataName] = useState<string>("");
  const [manualAoKataNum, setManualAoKataNum] = useState<number | "">("");
  const [manualAoKataName, setManualAoKataName] = useState<string>("");

  useEffect(() => {
    setCurrentPin(judgePin);
    setNewPinInput(judgePin);
  }, [judgePin]);

  if (!activeMatch) {
    return (
      <div className="bg-white border border-[#E1DDCF] rounded-2xl p-8 text-center text-[#68645A] space-y-3 shadow-xs">
        <Users className="w-10 h-10 text-[#8C877C] mx-auto animate-pulse" />
        <h3 className="text-base font-bold text-[#1B1815]">No Active Kata Bout</h3>
        <p className="text-xs text-[#68645A] max-w-md mx-auto">
          Select a scheduled Kata bout from the queue or pool tables to begin judging.
        </p>
        {onViewDrawTable && (
          <button
            type="button"
            onClick={onViewDrawTable}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#FAF9F5] border border-[#E1DDCF] hover:bg-[#F0ECE1] text-xs font-bold font-data-mono text-[#1B1815]"
          >
            <Table className="w-3.5 h-3.5 text-[#0E9C7C]" />
            <span>Open Pool Draw Tables</span>
          </button>
        )}
      </div>
    );
  }

  const isPointsMode =
    category?.kata_scoring_mode === "POINTS" ||
    activeMatch?.kata_scoring_mode === "POINTS";

  // Build 5-judge matrix
  const judgeSeats = [1, 2, 3, 4, 5];
  const seatMap = new Map<number, any>();
  scores.forEach((s) => seatMap.set(s.judge_seat || s.judgeSeat, s));

  // Count flags
  let akaCount = 0;
  let aoCount = 0;
  scores.forEach((s) => {
    const vote = s.flag_vote || s.flagVote;
    if (vote === "AKA") akaCount++;
    if (vote === "AO") aoCount++;
  });

  const totalSubmitted = scores.length;
  const majorityThreshold = 3;
  const hasMajorityWinner = akaCount >= majorityThreshold || aoCount >= majorityThreshold;
  const majorityWinnerSide: "AKA" | "AO" | null =
    akaCount >= majorityThreshold ? "AKA" : aoCount >= majorityThreshold ? "AO" : null;

  const handleVoidVote = async (seat: number) => {
    setSubmittingAction(true);
    try {
      await voidJudgeVote({ matchId: activeMatch.id, judgeSeat: seat });
      onRefresh();
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleManualOverride = async (seat: number, flag: "AKA" | "AO") => {
    setSubmittingAction(true);
    try {
      await submitJudgeVote({
        matchId: activeMatch.id,
        judgeSeat: seat,
        flagVote: flag,
        targetSide: flag,
        isOverridden: true,
      });
      onRefresh();
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleSaveManualMarks = async (finalize: boolean = false) => {
    setSubmittingAction(true);
    try {
      await submitModeratorManualKataMarks({
        matchId: activeMatch.id,
        akaKataNumber: typeof manualAkaKataNum === "number" ? manualAkaKataNum : undefined,
        akaKataName: manualAkaKataName || undefined,
        aoKataNumber: typeof manualAoKataNum === "number" ? manualAoKataNum : undefined,
        aoKataName: manualAoKataName || undefined,
        akaScore: parseFloat(manualAkaScore) || 7.5,
        aoScore: parseFloat(manualAoScore) || 7.0,
        finalize,
      });
      setShowManualModal(false);
      onRefresh();
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleLockDecision = async () => {
    if (!majorityWinnerSide && !isPointsMode) {
      if (!confirm("No clear majority flag winner (3+ votes). Do you still want to finalize?")) {
        return;
      }
    }

    setSubmittingAction(true);
    try {
      await finalizeKataBout({
        matchId: activeMatch.id,
        winnerSide: majorityWinnerSide || (akaCount >= aoCount ? "AKA" : "AO"),
        decisionMethod: isPointsMode ? "POINTS" : "FLAGS",
      });
      onRefresh();
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleSavePin = async () => {
    if (newPinInput.trim().length < 4) return;
    const res = await updateRingJudgePin(ringId, newPinInput.trim());
    if (res.success) {
      setCurrentPin(newPinInput.trim());
      setIsEditingPin(false);
    }
  };

  return (
    <div className="bg-white border border-[#E1DDCF] rounded-2xl p-5 shadow-xs space-y-5 font-sans">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#E1DDCF]">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-50 border border-emerald-200 text-[#0E9C7C] rounded-xl">
            <Trophy className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-[#1B1815]">Kata Tatami Console</h2>
              <span className="text-[11px] font-bold font-data-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-900 border border-emerald-200">
                {isPointsMode ? "Points Mode (10.0)" : "Flag Mode (Majority 3/5)"}
              </span>
              {activeMatch.pool_group && (
                <span className="text-[11px] font-bold font-data-mono px-2 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200">
                  {activeMatch.pool_group}
                </span>
              )}
            </div>
            <p className="text-xs text-[#68645A] font-data-mono">
              {activeMatch.round_name || "Preliminary Round"} • Match #{activeMatch.match_no || activeMatch.matchNo}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {onViewDrawTable && (
            <button
              type="button"
              onClick={onViewDrawTable}
              className="flex items-center gap-1.5 text-xs font-bold font-data-mono px-3 py-1.5 rounded-lg bg-[#FAF9F5] hover:bg-[#F0ECE1] text-[#1B1815] border border-[#E1DDCF] transition-all"
            >
              <Table className="w-3.5 h-3.5 text-[#0E9C7C]" />
              <span>Pool Tables</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowManualModal(true)}
            className="flex items-center gap-1.5 text-xs font-bold font-data-mono px-3 py-1.5 rounded-lg bg-[#FAF9F5] hover:bg-[#F0ECE1] text-[#1B1815] border border-[#E1DDCF] transition-all"
          >
            <Edit2 className="w-3.5 h-3.5 text-[#8C877C]" />
            <span>Direct Marks</span>
          </button>

          <button
            type="button"
            onClick={() => setMaskVotes(!maskVotes)}
            className="flex items-center gap-1.5 text-xs font-bold font-data-mono px-3 py-1.5 rounded-lg bg-[#FAF9F5] hover:bg-[#F0ECE1] text-[#68645A] border border-[#E1DDCF] transition-all"
          >
            {maskVotes ? <EyeOff className="w-3.5 h-3.5 text-amber-600" /> : <Eye className="w-3.5 h-3.5" />}
            <span>{maskVotes ? "Masked" : "HUD"}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowQrModal(true)}
            className="flex items-center gap-1.5 text-xs font-bold font-data-mono px-3 py-1.5 rounded-lg bg-[#0E9C7C] hover:bg-[#0c8569] text-white shadow-xs transition-all"
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>Judge PIN ({currentPin})</span>
          </button>
        </div>
      </div>

      {/* Competitors Display (RingFlow Light Card Style) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* AKA Performer */}
        <div className="bg-[#FAF9F5] border-2 border-[#DC2626]/30 rounded-xl p-4 flex items-center justify-between shadow-xs">
          <div className="space-y-1">
            <span className="text-[10px] font-bold font-data-mono text-[#DC2626] bg-red-50 border border-red-200 tracking-wider uppercase px-2 py-0.5 rounded">
              AKA (Red Side)
            </span>
            <h4 className="text-base font-bold text-[#1B1815]">
              {activeMatch.akaAthlete?.name || activeMatch.aka_athlete_name || "AKA Competitor"}
            </h4>
            <p className="text-xs text-[#68645A]">
              {activeMatch.akaAthlete?.school || activeMatch.akaAthlete?.dojo || "Dojo/School"}
            </p>
            {activeMatch.akaKataName && (
              <p className="text-[11px] font-medium text-[#504C42] italic">
                Kata: {activeMatch.akaKataName}
              </p>
            )}
          </div>
          <div className="text-right">
            <span className="text-4xl font-data-mono font-black text-[#DC2626]">
              {isPointsMode ? activeMatch.aka_score_total || activeMatch.akaScoreTotal || "0.0" : akaCount}
            </span>
            <div className="text-[10px] font-bold font-data-mono text-[#DC2626] uppercase mt-0.5">
              {isPointsMode ? "Score" : "Flags"}
            </div>
          </div>
        </div>

        {/* AO Performer */}
        <div className="bg-[#FAF9F5] border-2 border-[#2563EB]/30 rounded-xl p-4 flex items-center justify-between shadow-xs">
          <div className="space-y-1">
            <span className="text-[10px] font-bold font-data-mono text-[#2563EB] bg-blue-50 border border-blue-200 tracking-wider uppercase px-2 py-0.5 rounded">
              AO (Blue Side)
            </span>
            <h4 className="text-base font-bold text-[#1B1815]">
              {activeMatch.aoAthlete?.name || activeMatch.ao_athlete_name || "AO Competitor"}
            </h4>
            <p className="text-xs text-[#68645A]">
              {activeMatch.aoAthlete?.school || activeMatch.aoAthlete?.dojo || "Dojo/School"}
            </p>
            {activeMatch.aoKataName && (
              <p className="text-[11px] font-medium text-[#504C42] italic">
                Kata: {activeMatch.aoKataName}
              </p>
            )}
          </div>
          <div className="text-right">
            <span className="text-4xl font-data-mono font-black text-[#2563EB]">
              {isPointsMode ? activeMatch.ao_score_total || activeMatch.aoScoreTotal || "0.0" : aoCount}
            </span>
            <div className="text-[10px] font-bold font-data-mono text-[#2563EB] uppercase mt-0.5">
              {isPointsMode ? "Score" : "Flags"}
            </div>
          </div>
        </div>
      </div>

      {/* 5-Judge Status Matrix (Light UI) */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold font-data-mono uppercase tracking-wider text-[#68645A]">
            Referee Panel ({totalSubmitted}/5 Submitted)
          </span>
          <span className="text-xs font-data-mono font-bold text-[#0E9C7C]">
            {hasMajorityWinner ? "Majority Reached (3/5)" : "Awaiting Referee Submissions"}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
          {judgeSeats.map((seat) => {
            const score = seatMap.get(seat);
            const isVoted = Boolean(score);
            const voteVal = score?.flag_vote || score?.flagVote;

            return (
              <div
                key={seat}
                className={`rounded-xl p-3 border transition-all ${
                  isVoted
                    ? voteVal === "AKA"
                      ? "bg-red-50/60 border-red-300 text-[#DC2626]"
                      : voteVal === "AO"
                      ? "bg-blue-50/60 border-blue-300 text-[#2563EB]"
                      : "bg-amber-50/60 border-amber-300 text-amber-800"
                    : "bg-[#FAF9F5] border-[#E1DDCF] text-[#8C877C]"
                }`}
              >
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-bold font-data-mono text-[#1B1815]">Judge {seat}</span>
                  {isVoted ? (
                    <span className="flex items-center gap-0.5 text-[10px] text-[#0E9C7C] font-bold font-data-mono">
                      <CheckCircle2 className="w-3 h-3" />
                      {score.is_overridden || score.isOverridden ? "Manual" : "Live"}
                    </span>
                  ) : (
                    <span className="text-[10px] font-data-mono text-[#8C877C]">Waiting</span>
                  )}
                </div>

                {/* Vote Display Box */}
                <div className="my-1.5 text-center py-2 rounded-lg bg-white border border-[#E1DDCF]">
                  {isVoted ? (
                    maskVotes ? (
                      <span className="text-xs font-data-mono text-[#8C877C]">Vote Cast</span>
                    ) : voteVal === "AKA" ? (
                      <span className="text-sm font-black font-data-mono text-[#DC2626]">AKA</span>
                    ) : voteVal === "AO" ? (
                      <span className="text-sm font-black font-data-mono text-[#2563EB]">AO</span>
                    ) : (
                      <span className="text-sm font-black font-data-mono text-amber-700">
                        {score.numeric_score || score.numericScore || "—"}
                      </span>
                    )
                  ) : (
                    <span className="text-xs text-[#8C877C] font-data-mono">—</span>
                  )}
                </div>

                {/* Actions: Void or Moderator Manual Override */}
                <div className="flex items-center justify-between gap-1 pt-1 text-[11px]">
                  {isVoted ? (
                    <button
                      type="button"
                      onClick={() => handleVoidVote(seat)}
                      disabled={submittingAction}
                      className="text-[#8C877C] hover:text-[#DC2626] flex items-center gap-1 mx-auto text-[10px] font-data-mono"
                    >
                      <RotateCcw className="w-3 h-3" /> Void
                    </button>
                  ) : (
                    <div className="flex items-center justify-center gap-1.5 w-full">
                      <button
                        type="button"
                        onClick={() => handleManualOverride(seat, "AKA")}
                        disabled={submittingAction}
                        className="px-2 py-0.5 bg-red-100 hover:bg-[#DC2626] text-[#DC2626] hover:text-white rounded text-[10px] font-bold font-data-mono transition-colors"
                      >
                        AKA
                      </button>
                      <button
                        type="button"
                        onClick={() => handleManualOverride(seat, "AO")}
                        disabled={submittingAction}
                        className="px-2 py-0.5 bg-blue-100 hover:bg-[#2563EB] text-[#2563EB] hover:text-white rounded text-[10px] font-bold font-data-mono transition-colors"
                      >
                        AO
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Lock & Decision Confirmation Footer */}
      <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-[#E1DDCF]">
        <div className="text-xs text-[#68645A] font-data-mono">
          {hasMajorityWinner ? (
            <span className="text-[#0E9C7C] font-bold flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              Proposed Winner: {majorityWinnerSide} wins ({akaCount} - {aoCount})
            </span>
          ) : (
            <span>Awaiting referee panel majority. Moderator can manually score missing seats.</span>
          )}
        </div>

        <button
          type="button"
          onClick={handleLockDecision}
          disabled={submittingAction}
          className={`py-2.5 px-5 rounded-xl font-bold text-xs font-data-mono text-white transition-all shadow-xs flex items-center gap-2 cursor-pointer ${
            hasMajorityWinner
              ? "bg-[#0E9C7C] hover:bg-[#0c8569]"
              : "bg-[#504C42] hover:bg-[#3D3A33]"
          }`}
        >
          <Lock className="w-3.5 h-3.5" />
          <span>Confirm & Finalize Bout</span>
        </button>
      </div>

      {/* Direct Manual Marks Modal */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="bg-[#FAF9F5] w-full max-w-md rounded-2xl shadow-2xl border border-[#E1DDCF] overflow-hidden flex flex-col animate-in fade-in">
            <div className="bg-white px-5 py-4 border-b border-[#E1DDCF] flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold font-data-mono uppercase tracking-wider text-[#0E9C7C]">
                  Moderator Manual Scoring
                </span>
                <h3 className="font-bold text-sm text-[#1B1815]">
                  Enter Performance Marks • Match #{activeMatch.match_no || activeMatch.matchNo}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowManualModal(false)}
                className="text-[#68645A] hover:text-[#1B1815]"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* AKA Entry */}
              <div className="bg-white border border-[#DC2626]/30 rounded-xl p-3 space-y-2">
                <span className="text-[10px] font-bold font-data-mono text-[#DC2626] bg-red-50 border border-red-200 px-2 py-0.5 rounded">
                  AKA (Red)
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-[#68645A] block mb-1">Kata # (1-102)</label>
                    <input
                      type="number"
                      min={1}
                      max={102}
                      value={manualAkaKataNum}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setManualAkaKataNum(isNaN(val) ? "" : val);
                        const k = OFFICIAL_WKF_KATAS.find((x) => x.number === val);
                        if (k) setManualAkaKataName(k.name);
                      }}
                      className="w-full bg-[#FAF9F5] border border-[#E1DDCF] rounded-lg px-2 py-1 text-xs font-data-mono font-bold"
                      placeholder="e.g. 2"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-[#68645A] block mb-1">Score (5.0 - 10.0)</label>
                    <input
                      type="number"
                      step={0.1}
                      min={5.0}
                      max={10.0}
                      value={manualAkaScore}
                      onChange={(e) => setManualAkaScore(e.target.value)}
                      className="w-full bg-[#FAF9F5] border border-[#E1DDCF] rounded-lg px-2 py-1 text-xs font-data-mono font-bold text-[#DC2626]"
                    />
                  </div>
                </div>
                {manualAkaKataName && (
                  <p className="text-[11px] text-[#504C42] italic">{manualAkaKataName}</p>
                )}
              </div>

              {/* AO Entry */}
              <div className="bg-white border border-[#2563EB]/30 rounded-xl p-3 space-y-2">
                <span className="text-[10px] font-bold font-data-mono text-[#2563EB] bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">
                  AO (Blue)
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-[#68645A] block mb-1">Kata # (1-102)</label>
                    <input
                      type="number"
                      min={1}
                      max={102}
                      value={manualAoKataNum}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        setManualAoKataNum(isNaN(val) ? "" : val);
                        const k = OFFICIAL_WKF_KATAS.find((x) => x.number === val);
                        if (k) setManualAoKataName(k.name);
                      }}
                      className="w-full bg-[#FAF9F5] border border-[#E1DDCF] rounded-lg px-2 py-1 text-xs font-data-mono font-bold"
                      placeholder="e.g. 8"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-[#68645A] block mb-1">Score (5.0 - 10.0)</label>
                    <input
                      type="number"
                      step={0.1}
                      min={5.0}
                      max={10.0}
                      value={manualAoScore}
                      onChange={(e) => setManualAoScore(e.target.value)}
                      className="w-full bg-[#FAF9F5] border border-[#E1DDCF] rounded-lg px-2 py-1 text-xs font-data-mono font-bold text-[#2563EB]"
                    />
                  </div>
                </div>
                {manualAoKataName && (
                  <p className="text-[11px] text-[#504C42] italic">{manualAoKataName}</p>
                )}
              </div>
            </div>

            <div className="bg-white px-5 py-3 border-t border-[#E1DDCF] flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowManualModal(false)}
                className="px-3 py-1.5 text-xs font-bold text-[#68645A] hover:bg-[#FAF9F5] rounded-lg"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submittingAction}
                onClick={() => handleSaveManualMarks(false)}
                className="px-3 py-1.5 text-xs font-bold font-data-mono bg-white border border-[#E1DDCF] text-[#1B1815] rounded-lg hover:bg-[#FAF9F5]"
              >
                Save Draft
              </button>
              <button
                type="button"
                disabled={submittingAction}
                onClick={() => handleSaveManualMarks(true)}
                className="px-4 py-1.5 text-xs font-bold font-data-mono bg-[#0E9C7C] hover:bg-[#0c8569] text-white rounded-lg shadow-xs"
              >
                Confirm & Finalize
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tatami QR Code & PIN Modal (Light Theme) */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[#FAF9F5] border border-[#E1DDCF] rounded-2xl max-w-sm w-full p-6 text-center space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-[#1B1815]">Referee Mobile Pairing</h3>
              <button
                onClick={() => setShowQrModal(false)}
                className="text-[#68645A] hover:text-[#1B1815] text-sm"
              >
                ✕
              </button>
            </div>

            <div className="bg-white p-4 rounded-xl border border-[#E1DDCF] inline-block mx-auto shadow-xs">
              <div className="w-44 h-44 bg-[#FAF9F5] rounded-lg flex flex-col items-center justify-center p-2 text-[#1B1815] border border-dashed border-[#E1DDCF]">
                <QrCode className="w-24 h-24 text-[#1B1815] mb-2" />
                <span className="text-[10px] font-mono text-[#68645A]">
                  Scan to Judge Tatami
                </span>
              </div>
            </div>

            {/* PIN Display & Edit */}
            <div className="bg-white border border-[#E1DDCF] rounded-xl p-3 space-y-1.5">
              <div className="text-[11px] text-[#68645A] font-bold font-data-mono uppercase">
                Tatami Quick-Join PIN
              </div>
              {isEditingPin ? (
                <div className="flex items-center justify-center gap-2">
                  <input
                    type="text"
                    maxLength={6}
                    value={newPinInput}
                    onChange={(e) => setNewPinInput(e.target.value)}
                    className="w-24 text-center font-data-mono font-bold text-xl py-1 rounded bg-[#FAF9F5] border border-[#E1DDCF] text-[#1B1815]"
                  />
                  <button
                    onClick={handleSavePin}
                    className="px-3 py-1 bg-[#0E9C7C] text-white rounded font-bold text-xs"
                  >
                    Save
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-3">
                  <span className="text-3xl font-data-mono font-black tracking-widest text-[#0E9C7C]">
                    {currentPin}
                  </span>
                  <button
                    onClick={() => setIsEditingPin(true)}
                    className="text-[#8C877C] hover:text-[#1B1815]"
                    title="Change PIN"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            <p className="text-xs text-[#68645A]">
              Referees scan with their mobile camera on 4G/5G or guest Wi-Fi. No LAN access required.
            </p>

            <button
              onClick={() => setShowQrModal(false)}
              className="w-full py-2 bg-white hover:bg-[#FAF9F5] text-[#1B1815] border border-[#E1DDCF] font-bold font-data-mono rounded-xl text-xs"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
