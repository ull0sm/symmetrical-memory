"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useLiveEvents } from "@/hooks/useLiveEvents";
import { getRingKataState, submitJudgeVote } from "@/actions/kata";
import {
  requestJudgeAccess,
  checkJudgeAccessStatus,
} from "@/actions/judgeAuth";
import { KataScoreWheelPicker } from "@/components/judge/KataScoreWheelPicker";
import {
  ShieldAlert,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  Vote,
  RefreshCw,
  LogOut,
  Plus,
  Minus,
  Check,
  Clock,
  ShieldCheck,
  UserCheck,
  Users,
  Radio,
  Maximize2,
  Minimize2,
} from "lucide-react";

interface JudgeMobileClientProps {
  ringId: string;
  initialPin?: string;
}

export default function JudgeMobileClient({
  ringId,
  initialPin = "",
}: JudgeMobileClientProps) {
  // Authentication & Approval State
  const [pin, setPin] = useState(initialPin);
  const [judgeName, setJudgeName] = useState("Judge");
  const [selectedSeat, setSelectedSeat] = useState<number>(1);
  const [approvalStatus, setApprovalStatus] = useState<"loading" | "none" | "pending" | "approved" | "rejected">("loading");
  const [submittingRequest, setSubmittingRequest] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [judgeSeat, setJudgeSeat] = useState<number | null>(null);
  const [deviceToken, setDeviceToken] = useState<string>("");

  // Live Match State
  const [stateLoading, setStateLoading] = useState(false);
  const [ringName, setRingName] = useState(`Tatami Ring`);
  const [activeCategory, setActiveCategory] = useState<any>(null);
  const [activeMatch, setActiveMatch] = useState<any>(null);
  const [existingScores, setExistingScores] = useState<any[]>([]);

  // Voting State: which side the judge is currently scoring (AKA or AO)
  const [targetSide, setTargetSide] = useState<"AKA" | "AO">("AKA");
  const [selectedFlag, setSelectedFlag] = useState<"AKA" | "AO" | null>(null);
  const [pointScore, setPointScore] = useState<number>(7.6);
  const [submittingVote, setSubmittingVote] = useState(false);
  const [voteSubmitted, setVoteSubmitted] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Fullscreen event listener
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  // Match State Loader
  const loadMatchState = useCallback(async () => {
    setStateLoading(true);
    try {
      const res = await getRingKataState(ringId);
      if (res.success) {
        if (res.ringName) setRingName(res.ringName);
        setActiveCategory(res.activeCategory);
        setActiveMatch(res.activeMatch);
        setExistingScores(res.scores || []);

        if (judgeSeat) {
          const myVote = (res.scores || []).find(
            (s: any) =>
              (s.judge_seat || s.judgeSeat) === judgeSeat &&
              (s.target_side || s.targetSide || "AKA") === targetSide
          );
          if (myVote) {
            setSelectedFlag(myVote.flag_vote || myVote.flagVote);
            const num = parseFloat(myVote.numeric_score || myVote.numericScore);
            if (!isNaN(num) && num > 0) setPointScore(num);
            setVoteSubmitted(true);
          } else {
            setVoteSubmitted(false);
          }
        }
      }
    } finally {
      setStateLoading(false);
    }
  }, [ringId, judgeSeat, targetSide]);

  // Status check for this device
  const checkStatus = useCallback(
    async (token: string) => {
      try {
        const res = await checkJudgeAccessStatus(ringId, token);
        if (res.success) {
          if (res.ringName) setRingName(res.ringName);
          if (res.judgeName) setJudgeName(res.judgeName);
          if (res.seatNumber) {
            setJudgeSeat(res.seatNumber);
            setSelectedSeat(res.seatNumber);
          }
          setApprovalStatus(res.status);
          if (res.status === "approved") {
            loadMatchState();
          }
        } else {
          setApprovalStatus("none");
        }
      } catch {
        setApprovalStatus("none");
      }
    },
    [ringId, loadMatchState]
  );

  // Initialize device token and check status on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      let token = localStorage.getItem("ringflow_judge_token");
      if (!token) {
        token = "dev_" + Math.random().toString(36).substring(2, 10);
        localStorage.setItem("ringflow_judge_token", token);
      }
      setDeviceToken(token);

      const savedName = localStorage.getItem("ringflow_judge_name");
      if (savedName) setJudgeName(savedName);

      const savedSeat = localStorage.getItem(`ringflow_judge_seat_${ringId}`);
      if (savedSeat) setSelectedSeat(parseInt(savedSeat, 10));

      checkStatus(token);
    }
  }, [ringId, checkStatus]);

  // Request Wake Lock to prevent screen sleep when approved
  useEffect(() => {
    let wakeLock: any = null;
    const requestWakeLock = async () => {
      try {
        if ("wakeLock" in navigator) {
          wakeLock = await (navigator as any).wakeLock.request("screen");
          setWakeLockActive(true);
          wakeLock.addEventListener("release", () => setWakeLockActive(false));
        }
      } catch (err) {
        console.warn("Wake lock request failed:", err);
      }
    };

    if (approvalStatus === "approved" && judgeSeat) {
      requestWakeLock();
    }

    return () => {
      if (wakeLock) wakeLock.release().catch(() => {});
    };
  }, [approvalStatus, judgeSeat]);

  // Polling fallback when waiting for approval
  useEffect(() => {
    if (approvalStatus !== "pending" || !deviceToken) return;
    const interval = setInterval(() => {
      checkStatus(deviceToken);
    }, 2500);
    return () => clearInterval(interval);
  }, [approvalStatus, deviceToken, checkStatus]);

  // Subscribe to live events
  useLiveEvents({ ringId }, (event) => {
    if (event?.table === "judge_requests") {
      if (deviceToken) checkStatus(deviceToken);
    } else {
      if (approvalStatus === "approved") {
        loadMatchState();
      }
    }
  });

  const handleSendAccessRequest = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!pin || pin.trim().length < 4) {
      setRequestError("Please enter the 4-digit Tatami PIN");
      return;
    }
    setSubmittingRequest(true);
    setRequestError(null);

    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("ringflow_judge_name", judgeName.trim());
        localStorage.setItem(`ringflow_judge_seat_${ringId}`, String(selectedSeat));
      }

      const res = await requestJudgeAccess({
        ringId,
        deviceToken,
        judgeName: judgeName.trim() || "Judge",
        requestedSeat: selectedSeat,
        pin: pin.trim(),
      });

      if (res.success) {
        setApprovalStatus(res.status || "none");
        if (res.seatNumber) setJudgeSeat(res.seatNumber);
        if (res.ringName) setRingName(res.ringName);

        if (res.status === "approved") {
          loadMatchState();
        }
      } else {
        setRequestError(res.error || "Failed to request access");
      }
    } catch (err: any) {
      setRequestError(err.message || "Failed to transmit request");
    } finally {
      setSubmittingRequest(false);
    }
  };

  const handleSubmitScore = async () => {
    if (!activeMatch || !judgeSeat) return;
    setSubmittingVote(true);
    try {
      const res = await submitJudgeVote({
        matchId: activeMatch.id,
        ringId,
        judgeSeat,
        judgeDeviceToken: deviceToken,
        targetSide,
        numericScore: pointScore,
        flagVote: selectedFlag || undefined,
      });

      if (res.success) {
        setVoteSubmitted(true);
        loadMatchState();
      } else {
        alert(res.error || "Failed to submit score");
      }
    } catch (err: any) {
      alert(err.message || "Failed to transmit vote");
    } finally {
      setSubmittingVote(false);
    }
  };

  // ─── Step 0: Loading State ───
  if (approvalStatus === "loading") {
    return (
      <div className="min-h-screen bg-[#FAF9F5] text-[#1B1815] flex flex-col justify-center items-center p-6 select-none font-sans">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 text-[#0E9C7C] animate-spin" />
          <p className="text-xs font-bold font-data-mono text-[#68645A]">
            Connecting to Tatami Station...
          </p>
        </div>
      </div>
    );
  }

  // ─── Step 1: Request Access & PIN Authentication Form ───
  if (approvalStatus === "none") {
    return (
      <div className="min-h-screen bg-[#FAF9F5] text-[#1B1815] flex flex-col justify-center items-center p-4 sm:p-6 select-none font-sans">
        <div className="w-full max-w-sm bg-white border border-[#E1DDCF] rounded-3xl p-6 sm:p-8 shadow-xl space-y-5">
          <div className="w-14 h-14 bg-emerald-50 border border-emerald-200 text-[#0E9C7C] rounded-2xl flex items-center justify-center mx-auto">
            <Smartphone className="w-7 h-7" />
          </div>

          <div className="text-center">
            <span className="text-[11px] font-bold font-data-mono px-2.5 py-0.5 rounded-full bg-[#FAF9F5] text-[#504C42] border border-[#E1DDCF]">
              {ringName}
            </span>
            <h1 className="text-xl font-bold text-[#1B1815] mt-2">Judge Station Login</h1>
            <p className="text-xs text-[#68645A] mt-1 font-data-mono">
              Enter Tatami PIN & station seat. Desk approval is required.
            </p>
          </div>

          <form onSubmit={handleSendAccessRequest} className="space-y-4">
            {/* PIN input */}
            <div>
              <label className="text-[10px] font-bold font-data-mono uppercase tracking-wider text-[#8C877C] block mb-1">
                4-Digit Tatami PIN
              </label>
              <input
                type="text"
                pattern="[0-9]*"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="1234"
                className="w-full text-center text-3xl font-data-mono font-black tracking-widest py-2.5 px-4 rounded-xl bg-[#FAF9F5] border border-[#E1DDCF] text-[#1B1815] focus:border-[#0E9C7C] outline-none transition-all"
                autoFocus
              />
            </div>

            {/* Judge Name input */}
            <div>
              <label className="text-[10px] font-bold font-data-mono uppercase tracking-wider text-[#8C877C] block mb-1">
                Referee / Judge Name
              </label>
              <input
                type="text"
                value={judgeName}
                onChange={(e) => setJudgeName(e.target.value)}
                placeholder="e.g. Sensei Anil"
                className="w-full text-sm font-data-mono py-2 px-3 rounded-xl bg-[#FAF9F5] border border-[#E1DDCF] text-[#1B1815] focus:border-[#0E9C7C] outline-none transition-all"
                required
              />
            </div>

            {/* Seat Position Selector */}
            <div>
              <label className="text-[10px] font-bold font-data-mono uppercase tracking-wider text-[#8C877C] block mb-1">
                Requested Station Seat
              </label>
              <div className="grid grid-cols-5 gap-1.5">
                {[1, 2, 3, 4, 5].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSelectedSeat(s)}
                    className={`py-2 rounded-lg text-xs font-bold font-data-mono border transition-all cursor-pointer ${
                      selectedSeat === s
                        ? "bg-[#0E9C7C] text-white border-[#0E9C7C] shadow-xs"
                        : "bg-[#FAF9F5] text-[#1B1815] border-[#E1DDCF] hover:bg-emerald-50"
                    }`}
                  >
                    J{s}
                  </button>
                ))}
              </div>
              <p className="text-[10px] font-data-mono text-[#8C877C] mt-1 text-center">
                {selectedSeat === 1 ? "J1: Chief Referee / Head Judge" : `J${selectedSeat}: Corner Judge #${selectedSeat - 1}`}
              </p>
            </div>

            {requestError && (
              <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 border border-red-200 py-2 px-3 rounded-lg">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{requestError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submittingRequest || pin.length < 4}
              className="w-full py-3.5 px-4 bg-[#0E9C7C] hover:bg-[#0B7C63] disabled:opacity-50 text-white font-bold font-data-mono text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              {submittingRequest ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                "Request Access from Moderator"
              )}
            </button>
          </form>

          <p className="text-[11px] text-[#8C877C] font-data-mono text-center">
            Referee station will unlock once the Tatami desk approves.
          </p>
        </div>
      </div>
    );
  }

  // ─── Step 2: Waiting for Moderator Approval Screen ───
  if (approvalStatus === "pending") {
    return (
      <div className="min-h-screen bg-[#FAF9F5] text-[#1B1815] flex flex-col justify-center items-center p-4 sm:p-6 select-none font-sans">
        <div className="w-full max-w-sm bg-white border border-[#E1DDCF] rounded-3xl p-6 sm:p-8 shadow-xl space-y-6 text-center">
          {/* Animated Status Beacon */}
          <div className="relative w-20 h-20 mx-auto flex items-center justify-center">
            <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-25 animate-ping" />
            <div className="relative w-16 h-16 rounded-full bg-amber-50 border-2 border-amber-300 flex items-center justify-center text-amber-600 shadow-inner">
              <Clock className="w-8 h-8 animate-pulse" />
            </div>
          </div>

          <div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black font-data-mono uppercase tracking-wider bg-amber-50 text-amber-800 border border-amber-300">
              <Radio className="w-3 h-3 text-amber-600 animate-pulse" />
              Awaiting Desk Approval
            </span>
            <h2 className="text-xl font-bold text-[#1B1815] mt-3">
              Waiting for Moderator
            </h2>
            <p className="text-xs text-[#68645A] mt-1 leading-relaxed">
              Your request has been broadcasted to the Tatami desk. Once the moderator verifies your station, your scoring console will unlock automatically.
            </p>
          </div>

          {/* Requested Station Card */}
          <div className="bg-[#FAF9F5] border border-[#E1DDCF] rounded-2xl p-4 text-left space-y-2 text-xs font-data-mono">
            <div className="flex justify-between items-center border-b border-[#E1DDCF]/60 pb-1.5">
              <span className="text-[#8C877C]">Tatami Ring:</span>
              <strong className="text-[#1B1815]">{ringName}</strong>
            </div>
            <div className="flex justify-between items-center border-b border-[#E1DDCF]/60 pb-1.5">
              <span className="text-[#8C877C]">Judge Name:</span>
              <strong className="text-[#1B1815]">{judgeName}</strong>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[#8C877C]">Requested Seat:</span>
              <strong className="text-[#0E9C7C] bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                Seat J{judgeSeat || selectedSeat} ({selectedSeat === 1 ? "Chief" : `Corner #${selectedSeat - 1}`})
              </strong>
            </div>
          </div>

          <div className="space-y-2">
            <button
              onClick={() => checkStatus(deviceToken)}
              className="w-full py-2.5 px-4 bg-[#FAF9F5] hover:bg-[#F0ECE1] border border-[#E1DDCF] rounded-xl text-xs font-bold font-data-mono text-[#1B1815] transition-all cursor-pointer flex items-center justify-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5 text-[#0E9C7C]" />
              Check Approval Status
            </button>

            <button
              onClick={() => setApprovalStatus("none")}
              className="text-xs text-[#8C877C] hover:text-[#1B1815] font-data-mono flex items-center justify-center gap-1 mx-auto cursor-pointer pt-1"
            >
              <LogOut className="w-3.5 h-3.5" />
              Change Seat / Re-enter PIN
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Step 2.5: Rejected / Revoked Screen ───
  if (approvalStatus === "rejected") {
    return (
      <div className="min-h-screen bg-[#FAF9F5] text-[#1B1815] flex flex-col justify-center items-center p-4 sm:p-6 select-none font-sans">
        <div className="w-full max-w-sm bg-white border border-red-200 rounded-3xl p-6 sm:p-8 shadow-xl space-y-6 text-center">
          <div className="w-16 h-16 rounded-full bg-red-50 border border-red-200 flex items-center justify-center text-red-600 mx-auto">
            <ShieldAlert className="w-8 h-8" />
          </div>

          <div>
            <h2 className="text-xl font-bold text-[#1B1815]">Station Disconnected</h2>
            <p className="text-xs text-[#68645A] mt-1 leading-relaxed">
              Your judge station access was declined or revoked by the Tatami moderator desk.
            </p>
          </div>

          <button
            onClick={() => setApprovalStatus("none")}
            className="w-full py-3 px-4 bg-[#0E9C7C] hover:bg-[#0B7C63] text-white font-bold font-data-mono text-xs rounded-xl shadow-xs transition-all cursor-pointer"
          >
            Submit New Request
          </button>
        </div>
      </div>
    );
  }

  // ─── Step 3: Active Judging Screen ───
  const isPointsMode =
    activeCategory?.kata_scoring_mode === "POINTS" ||
    activeMatch?.kata_scoring_mode === "POINTS" ||
    activeCategory?.kataScoringMode === "POINTS";

  return (
    <div className="min-h-screen bg-[#FAF9F5] text-[#1B1815] flex flex-col justify-between p-4 select-none touch-manipulation font-sans">
      {/* Top Header */}
      <header className="flex items-center justify-between bg-white border border-[#E1DDCF] rounded-2xl px-4 py-3 shadow-xs">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-bold font-data-mono uppercase text-[#1B1815]">
            {ringName}
          </span>
          <span className="text-[11px] bg-emerald-50 text-[#0E9C7C] font-bold font-data-mono px-2 py-0.5 rounded border border-emerald-200">
            Seat J{judgeSeat}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {wakeLockActive && (
            <span className="text-[10px] bg-emerald-50 text-[#0E9C7C] border border-emerald-200 px-1.5 py-0.5 rounded font-data-mono font-bold">
              Awake
            </span>
          )}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="p-1.5 rounded-lg bg-[#FAF9F5] border border-[#E1DDCF] text-[#68645A] hover:text-[#1B1815] transition-colors cursor-pointer"
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen Referee Mode (⛶)"}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => setApprovalStatus("none")}
            className="text-xs text-[#68645A] hover:text-[#1B1815] px-2 py-1 rounded bg-[#FAF9F5] border border-[#E1DDCF] font-data-mono font-bold cursor-pointer"
          >
            Station
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col justify-center my-3 space-y-4 max-w-md mx-auto w-full">
        {/* Match Information Card */}
        <div className="bg-white border border-[#E1DDCF] rounded-2xl p-4 text-center space-y-2 shadow-xs">
          <div className="flex items-center justify-center gap-2 text-xs font-bold text-[#8C877C] font-data-mono uppercase tracking-wider">
            <span>{activeCategory?.name || "Kata Division"}</span>
            {activeMatch?.poolGroup && (
              <>
                <span>•</span>
                <span className="text-amber-700">{activeMatch.poolGroup}</span>
              </>
            )}
          </div>

          <h3 className="text-base font-bold text-[#1B1815]">
            {activeMatch ? activeMatch.roundName || `Bout #${activeMatch.matchNo}` : "Waiting for Next Bout..."}
          </h3>

          {/* Competitor Toggle (AKA vs AO) */}
          {activeMatch ? (
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#E1DDCF]">
              <button
                type="button"
                onClick={() => setTargetSide("AKA")}
                className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                  targetSide === "AKA"
                    ? "bg-red-50 border-[#DC2626] shadow-xs ring-2 ring-red-400/20"
                    : "bg-[#FAF9F5] border-[#E1DDCF] hover:bg-white"
                }`}
              >
                <div className="text-[10px] font-bold font-data-mono text-[#DC2626] uppercase">
                  AKA (RED)
                </div>
                <div className="text-xs font-bold text-[#1B1815] truncate">
                  {activeMatch.aka?.displayName || activeMatch.aka?.name || "AKA"}
                </div>
                <div className="text-[10px] text-[#68645A] truncate">
                  {activeMatch.aka?.school || "Dojo"}
                </div>
              </button>

              <button
                type="button"
                onClick={() => setTargetSide("AO")}
                className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                  targetSide === "AO"
                    ? "bg-blue-50 border-[#2563EB] shadow-xs ring-2 ring-blue-400/20"
                    : "bg-[#FAF9F5] border-[#E1DDCF] hover:bg-white"
                }`}
              >
                <div className="text-[10px] font-bold font-data-mono text-[#2563EB] uppercase">
                  AO (BLUE)
                </div>
                <div className="text-xs font-bold text-[#1B1815] truncate">
                  {activeMatch.ao?.displayName || activeMatch.ao?.name || "AO"}
                </div>
                <div className="text-[10px] text-[#68645A] truncate">
                  {activeMatch.ao?.school || "Dojo"}
                </div>
              </button>
            </div>
          ) : (
            <p className="text-xs text-[#8C877C] py-4">
              Table officials are currently readying the next contest.
            </p>
          )}
        </div>

        {/* Voting Interaction Panel */}
        {activeMatch && (
          isPointsMode ? (
            /* Points Entry Mode with Two-Way Wheel Number Picker */
            <div className="bg-white border border-[#E1DDCF] rounded-3xl p-5 space-y-4 shadow-sm text-center">
              <div className="flex items-center justify-between pb-1 border-b border-[#E1DDCF]/60">
                <span className="text-xs font-bold font-data-mono uppercase tracking-wider text-[#68645A]">
                  Mark for:{" "}
                  <strong className={targetSide === "AKA" ? "text-[#DC2626]" : "text-[#2563EB]"}>
                    {targetSide === "AKA" ? "AKA (Red)" : "AO (Blue)"}
                  </strong>
                </span>
                <span className="text-xs font-bold font-data-mono text-[#8C877C]">
                  Olympic Scale (5.0 – 10.0)
                </span>
              </div>

              {/* Two-Way Vertical Scroll Wheel Number Picker */}
              <KataScoreWheelPicker
                value={pointScore}
                onChange={(val) => {
                  setPointScore(val);
                  setVoteSubmitted(false);
                }}
                minWhole={5}
                maxWhole={10}
              />

              {/* Submit / Transmit Button */}
              <button
                type="button"
                disabled={submittingVote}
                onClick={handleSubmitScore}
                className={`w-full py-4 font-bold font-data-mono text-sm rounded-2xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer ${
                  voteSubmitted
                    ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                    : targetSide === "AKA"
                    ? "bg-[#DC2626] hover:bg-red-700 text-white"
                    : "bg-[#2563EB] hover:bg-blue-700 text-white"
                }`}
              >
                {submittingVote ? (
                  <RefreshCw className="w-5 h-5 animate-spin" />
                ) : voteSubmitted ? (
                  <>
                    <Check className="w-5 h-5" />
                    <span>Transmitted {pointScore.toFixed(1)} for {targetSide}</span>
                  </>
                ) : (
                  <span>Transmit {pointScore.toFixed(1)} for {targetSide}</span>
                )}
              </button>
            </div>
          ) : (
            /* Flags Entry Mode */
            <div className="bg-white border border-[#E1DDCF] rounded-3xl p-6 space-y-4 shadow-sm text-center">
              <span className="text-xs font-bold font-data-mono uppercase tracking-wider text-[#68645A]">
                Raise Flag Decision (Hantei)
              </span>

              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setSelectedFlag("AKA")}
                  className={`py-8 rounded-2xl border-2 font-bold font-data-mono text-lg transition-all cursor-pointer ${
                    selectedFlag === "AKA"
                      ? "bg-[#DC2626] text-white border-[#DC2626] shadow-lg shadow-red-500/20"
                      : "bg-red-50 text-[#DC2626] border-red-200 hover:bg-red-100"
                  }`}
                >
                  AKA (Red)
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedFlag("AO")}
                  className={`py-8 rounded-2xl border-2 font-bold font-data-mono text-lg transition-all cursor-pointer ${
                    selectedFlag === "AO"
                      ? "bg-[#2563EB] text-white border-[#2563EB] shadow-lg shadow-blue-500/20"
                      : "bg-blue-50 text-[#2563EB] border-blue-200 hover:bg-blue-100"
                  }`}
                >
                  AO (Blue)
                </button>
              </div>

              <button
                type="button"
                disabled={submittingVote || !selectedFlag}
                onClick={handleSubmitScore}
                className="w-full py-4 bg-[#0E9C7C] hover:bg-[#0B7C63] disabled:opacity-50 text-white font-bold font-data-mono text-sm rounded-2xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {submittingVote ? (
                  <RefreshCw className="w-5 h-5 animate-spin" />
                ) : (
                  <span>Submit {selectedFlag || ""} Flag</span>
                )}
              </button>
            </div>
          )
        )}
      </main>

      {/* Footer */}
      <footer className="text-center py-2 text-[10px] font-data-mono text-[#8C877C]">
        Official RingFlow Tatami Judge Pad • Seat J{judgeSeat}
      </footer>
    </div>
  );
}
