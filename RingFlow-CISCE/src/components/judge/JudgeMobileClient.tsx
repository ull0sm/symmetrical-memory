"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useLiveEvents } from "@/hooks/useLiveEvents";
import { getRingKataState, verifyJudgePin, submitJudgeVote } from "@/actions/kata";
import {
  ShieldAlert,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  Vote,
  RefreshCw,
  LogOut,
  Maximize2,
} from "lucide-react";

interface JudgeMobileClientProps {
  ringId: string;
  initialPin?: string;
}

export default function JudgeMobileClient({
  ringId,
  initialPin = "",
}: JudgeMobileClientProps) {
  // Authentication & Seat
  const [pin, setPin] = useState(initialPin);
  const [isPinVerified, setIsPinVerified] = useState(false);
  const [verifyingPin, setVerifyingPin] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [judgeSeat, setJudgeSeat] = useState<number | null>(null);
  const [deviceToken, setDeviceToken] = useState<string>("");

  // Live Match State
  const [stateLoading, setStateLoading] = useState(true);
  const [ringName, setRingName] = useState(`Ring ${ringId.slice(0, 4)}`);
  const [activeCategory, setActiveCategory] = useState<any>(null);
  const [activeMatch, setActiveMatch] = useState<any>(null);
  const [existingScores, setExistingScores] = useState<any[]>([]);

  // Voting State
  const [selectedFlag, setSelectedFlag] = useState<"AKA" | "AO" | null>(null);
  const [pointScore, setPointScore] = useState<number>(7.5);
  const [submittingVote, setSubmittingVote] = useState(false);
  const [voteSubmitted, setVoteSubmitted] = useState(false);
  const [wakeLockActive, setWakeLockActive] = useState(false);

  // Initialize device token and stored seat
  useEffect(() => {
    if (typeof window !== "undefined") {
      let token = localStorage.getItem("ringflow_judge_token");
      if (!token) {
        token = "dev_" + Math.random().toString(36).substring(2, 10);
        localStorage.setItem("ringflow_judge_token", token);
      }
      setDeviceToken(token);

      const savedSeat = localStorage.getItem(`ringflow_judge_seat_${ringId}`);
      if (savedSeat) {
        setJudgeSeat(parseInt(savedSeat, 10));
      }
    }
  }, [ringId]);

  // Request Wake Lock to prevent screen sleep
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

    if (isPinVerified && judgeSeat) {
      requestWakeLock();
    }

    return () => {
      if (wakeLock) wakeLock.release().catch(() => {});
    };
  }, [isPinVerified, judgeSeat]);

  // Auto-verify if initialPin is passed in query
  useEffect(() => {
    if (initialPin && initialPin.length >= 4 && !isPinVerified) {
      handleVerifyPin(initialPin);
    }
  }, [initialPin]);

  const handleVerifyPin = async (pinToTest: string) => {
    setVerifyingPin(true);
    setPinError(null);
    try {
      const res = await verifyJudgePin(ringId, pinToTest);
      if (res.valid) {
        setIsPinVerified(true);
        localStorage.setItem(`ringflow_judge_pin_${ringId}`, pinToTest);
      } else {
        setPinError("Invalid Tatami PIN. Check the moderator screen.");
      }
    } catch {
      setPinError("Could not reach tournament server.");
    } finally {
      setVerifyingPin(false);
    }
  };

  // Fetch Ring State
  const loadState = useCallback(async () => {
    try {
      const res = await getRingKataState(ringId);
      if (res.success) {
        if (res.ringName) setRingName(res.ringName);
        setActiveCategory(res.activeCategory || null);
        setActiveMatch(res.activeMatch || null);
        setExistingScores(res.scores || []);

        // Check if current seat already voted on this match
        if (judgeSeat && res.scores) {
          const myScore = res.scores.find((s: any) => s.judge_seat === judgeSeat);
          if (myScore) {
            setSelectedFlag(myScore.flag_vote || null);
            if (myScore.numeric_score) setPointScore(Number(myScore.numeric_score));
            setVoteSubmitted(true);
          } else {
            // New match or vote reset
            setSelectedFlag(null);
            setVoteSubmitted(false);
          }
        }
      }
    } catch (err) {
      console.error("Failed to load kata state:", err);
    } finally {
      setStateLoading(false);
    }
  }, [ringId, judgeSeat]);

  useEffect(() => {
    if (isPinVerified) {
      loadState();
    }
  }, [isPinVerified, loadState]);

  // Real-time synchronization
  useLiveEvents({ ringId }, (event) => {
    if (event?.table === "matches" || event?.table === "rings") {
      loadState();
    }
  });

  const handleSelectSeat = (seat: number) => {
    setJudgeSeat(seat);
    localStorage.setItem(`ringflow_judge_seat_${ringId}`, String(seat));
  };

  const handleCastVote = async (flag: "AKA" | "AO") => {
    if (!activeMatch || !judgeSeat) return;

    // Haptic buzz feedback
    if (typeof window !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate([60]);
    }

    setSelectedFlag(flag);
    setSubmittingVote(true);
    try {
      const res = await submitJudgeVote({
        matchId: activeMatch.id,
        judgeSeat,
        flagVote: flag,
        targetSide: flag,
        judgeDeviceToken: deviceToken,
      });

      if (res.success) {
        setVoteSubmitted(true);
      }
    } catch (err) {
      console.error("Error submitting vote:", err);
    } finally {
      setSubmittingVote(false);
    }
  };

  const handleCastPointScore = async () => {
    if (!activeMatch || !judgeSeat) return;

    if (typeof window !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate([60]);
    }

    setSubmittingVote(true);
    try {
      const res = await submitJudgeVote({
        matchId: activeMatch.id,
        judgeSeat,
        numericScore: pointScore,
        targetSide: "AKA",
        judgeDeviceToken: deviceToken,
      });

      if (res.success) {
        setVoteSubmitted(true);
      }
    } catch (err) {
      console.error("Error submitting points:", err);
    } finally {
      setSubmittingVote(false);
    }
  };

  // ─── Step 1: Enter PIN Screen ──────────────────────────────────────────────
  if (!isPinVerified) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-6 select-none">
        <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-6 text-center">
          <div className="w-16 h-16 bg-blue-500/10 border border-blue-500/30 text-blue-400 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
            <Smartphone className="w-8 h-8" />
          </div>

          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Tatami Referee Pad
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Enter the 4-digit PIN displayed on the moderator desk
            </p>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleVerifyPin(pin);
            }}
            className="space-y-4"
          >
            <div>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="4-digit PIN"
                className="w-full text-center text-3xl font-mono tracking-widest py-3 px-4 rounded-xl bg-slate-950 border border-slate-700 text-white focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30 transition-all"
                autoFocus
              />
            </div>

            {pinError && (
              <div className="flex items-center justify-center gap-2 text-rose-400 text-xs bg-rose-500/10 border border-rose-500/20 py-2 px-3 rounded-lg">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{pinError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={verifyingPin || pin.length < 4}
              className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold rounded-xl shadow-lg shadow-blue-900/30 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              {verifyingPin ? (
                <RefreshCw className="w-5 h-5 animate-spin" />
              ) : (
                "Connect to Tatami"
              )}
            </button>
          </form>

          <p className="text-xs text-slate-500">
            Connected via secure Cloudflare Tunnel • Zero staff LAN access required
          </p>
        </div>
      </div>
    );
  }

  // ─── Step 2: Select Judge Seat Screen ─────────────────────────────────────
  if (!judgeSeat) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center p-6 select-none">
        <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl space-y-6 text-center">
          <div className="w-14 h-14 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-2xl flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-7 h-7" />
          </div>

          <div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
              {ringName}
            </span>
            <h2 className="text-2xl font-bold text-white mt-3">Select Your Seat</h2>
            <p className="text-xs text-slate-400 mt-1">
              Choose the judge position you are occupying on the tatami
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2.5">
            {[1, 2, 3, 4, 5].map((seat) => (
              <button
                key={seat}
                onClick={() => handleSelectSeat(seat)}
                className="py-3.5 px-5 bg-slate-800/80 hover:bg-blue-600 hover:text-white border border-slate-700/60 rounded-xl font-semibold text-slate-200 transition-all active:scale-[0.98] flex items-center justify-between"
              >
                <span>Judge Seat {seat}</span>
                <span className="text-xs font-mono text-slate-400 group-hover:text-blue-200">
                  {seat === 1 ? "Chief / Referee" : `Corner #${seat - 1}`}
                </span>
              </button>
            ))}
          </div>

          <button
            onClick={() => setIsPinVerified(false)}
            className="text-xs text-slate-500 hover:text-slate-400 flex items-center justify-center gap-1 mx-auto"
          >
            <LogOut className="w-3.5 h-3.5" />
            Switch Tatami
          </button>
        </div>
      </div>
    );
  }

  // ─── Step 3: Active Judging Screen ─────────────────────────────────────────
  const isPointsMode =
    activeCategory?.kata_scoring_mode === "POINTS" ||
    activeMatch?.kata_scoring_mode === "POINTS";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 select-none touch-manipulation">
      {/* Top Header */}
      <header className="flex items-center justify-between bg-slate-900/90 border border-slate-800/80 rounded-2xl px-4 py-2.5 backdrop-blur-md shadow-md">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-bold tracking-wider text-slate-200 uppercase">
            {ringName}
          </span>
          <span className="text-[10px] bg-blue-500/20 text-blue-300 font-mono px-2 py-0.5 rounded border border-blue-500/30">
            J{judgeSeat}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {wakeLockActive && (
            <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded">
              Screen Awake
            </span>
          )}
          <button
            onClick={() => setJudgeSeat(null)}
            className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-800/60"
          >
            Switch Seat
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col justify-center my-3 space-y-3">
        {/* Match Information Card */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 text-center space-y-1 shadow-inner">
          <div className="flex items-center justify-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
            <span>{activeCategory?.name || "Kata Division"}</span>
            {activeMatch?.pool_group && (
              <>
                <span>•</span>
                <span className="text-amber-400">{activeMatch.pool_group}</span>
              </>
            )}
          </div>

          <h3 className="text-lg font-bold text-white tracking-tight">
            {activeMatch ? activeMatch.round_name : "Waiting for Next Bout..."}
          </h3>

          {/* Competitor Banner */}
          {activeMatch ? (
            <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-800/60">
              <div
                className={`p-2 rounded-xl transition-all ${
                  selectedFlag === "AKA"
                    ? "bg-rose-950/80 border-2 border-rose-500 text-rose-200 shadow-md shadow-rose-950/50"
                    : "bg-slate-950/60 border border-slate-800/80 text-slate-300"
                }`}
              >
                <div className="text-[10px] font-bold text-rose-400 uppercase">
                  AKA (Red)
                </div>
                <div className="text-sm font-bold truncate">
                  {activeMatch.akaAthlete?.name || "Performer 1"}
                </div>
                <div className="text-[11px] text-slate-400 truncate">
                  {activeMatch.akaAthlete?.school || "Dojo"}
                </div>
              </div>

              <div
                className={`p-2 rounded-xl transition-all ${
                  selectedFlag === "AO"
                    ? "bg-blue-950/80 border-2 border-blue-500 text-blue-200 shadow-md shadow-blue-950/50"
                    : "bg-slate-950/60 border border-slate-800/80 text-slate-300"
                }`}
              >
                <div className="text-[10px] font-bold text-blue-400 uppercase">
                  AO (Blue)
                </div>
                <div className="text-sm font-bold truncate">
                  {activeMatch.aoAthlete?.name || "Performer 2"}
                </div>
                <div className="text-[11px] text-slate-400 truncate">
                  {activeMatch.aoAthlete?.school || "Dojo"}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500 py-3">
              Table officials are currently readying the tatami.
            </p>
          )}
        </div>

        {/* Voting Interaction Panel */}
        {activeMatch ? (
          isPointsMode ? (
            /* Points Entry Mode */
            <div className="bg-slate-900/80 border border-slate-800 rounded-3xl p-5 space-y-4 shadow-xl">
              <div className="text-center">
                <span className="text-xs font-semibold text-slate-400 uppercase">
                  Score Mark (5.0 - 10.0)
                </span>
                <div className="text-5xl font-mono font-black text-amber-400 my-1">
                  {pointScore.toFixed(1)}
                </div>
              </div>

              {/* Quick Adjustment Controls */}
              <div className="grid grid-cols-4 gap-2">
                <button
                  onClick={() => setPointScore((p) => Math.max(5.0, Number((p - 0.5).toFixed(1))))}
                  className="py-2.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded-xl font-bold text-sm text-slate-200"
                >
                  -0.5
                </button>
                <button
                  onClick={() => setPointScore((p) => Math.max(5.0, Number((p - 0.1).toFixed(1))))}
                  className="py-2.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded-xl font-bold text-sm text-slate-200"
                >
                  -0.1
                </button>
                <button
                  onClick={() => setPointScore((p) => Math.min(10.0, Number((p + 0.1).toFixed(1))))}
                  className="py-2.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded-xl font-bold text-sm text-slate-200"
                >
                  +0.1
                </button>
                <button
                  onClick={() => setPointScore((p) => Math.min(10.0, Number((p + 0.5).toFixed(1))))}
                  className="py-2.5 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 rounded-xl font-bold text-sm text-slate-200"
                >
                  +0.5
                </button>
              </div>

              {/* Preset Buttons */}
              <div className="grid grid-cols-5 gap-1.5">
                {[7.0, 7.5, 8.0, 8.5, 9.0].map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setPointScore(preset)}
                    className={`py-1.5 rounded-lg text-xs font-semibold ${
                      pointScore === preset
                        ? "bg-amber-500 text-black font-bold"
                        : "bg-slate-800 text-slate-400 hover:text-white"
                    }`}
                  >
                    {preset.toFixed(1)}
                  </button>
                ))}
              </div>

              <button
                onClick={handleCastPointScore}
                disabled={submittingVote}
                className="w-full py-4 bg-amber-500 hover:bg-amber-400 active:scale-[0.98] text-black font-bold text-lg rounded-2xl shadow-lg shadow-amber-950/40 transition-all flex items-center justify-center gap-2"
              >
                {submittingVote ? (
                  <RefreshCw className="w-5 h-5 animate-spin" />
                ) : voteSubmitted ? (
                  "Update Score Mark"
                ) : (
                  "Submit Score Mark"
                )}
              </button>
            </div>
          ) : (
            /* Flag Majority Voting Mode */
            <div className="flex-1 flex flex-col justify-center space-y-3 min-h-[280px]">
              <div className="grid grid-cols-2 gap-3 h-full min-h-[240px]">
                {/* RED (AKA) BUTTON */}
                <button
                  onClick={() => handleCastVote("AKA")}
                  disabled={submittingVote}
                  className={`relative flex flex-col items-center justify-center rounded-3xl p-4 transition-all duration-150 active:scale-[0.96] shadow-xl ${
                    selectedFlag === "AKA"
                      ? "bg-gradient-to-b from-rose-600 to-rose-700 text-white ring-4 ring-rose-400 ring-offset-2 ring-offset-slate-950 shadow-rose-900/60"
                      : "bg-gradient-to-b from-rose-900/70 to-rose-950/80 text-rose-200 border-2 border-rose-800/60 hover:from-rose-800 hover:to-rose-900"
                  }`}
                >
                  <span className="text-3xl font-black tracking-wider uppercase mb-1">
                    AKA
                  </span>
                  <span className="text-xs uppercase font-bold tracking-widest text-rose-300">
                    Red Flag
                  </span>

                  {selectedFlag === "AKA" && (
                    <div className="absolute top-3 right-3 bg-white text-rose-600 rounded-full p-1 shadow">
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                  )}
                </button>

                {/* BLUE (AO) BUTTON */}
                <button
                  onClick={() => handleCastVote("AO")}
                  disabled={submittingVote}
                  className={`relative flex flex-col items-center justify-center rounded-3xl p-4 transition-all duration-150 active:scale-[0.96] shadow-xl ${
                    selectedFlag === "AO"
                      ? "bg-gradient-to-b from-blue-600 to-blue-700 text-white ring-4 ring-blue-400 ring-offset-2 ring-offset-slate-950 shadow-blue-900/60"
                      : "bg-gradient-to-b from-blue-900/70 to-blue-950/80 text-blue-200 border-2 border-blue-800/60 hover:from-blue-800 hover:to-blue-900"
                  }`}
                >
                  <span className="text-3xl font-black tracking-wider uppercase mb-1">
                    AO
                  </span>
                  <span className="text-xs uppercase font-bold tracking-widest text-blue-300">
                    Blue Flag
                  </span>

                  {selectedFlag === "AO" && (
                    <div className="absolute top-3 right-3 bg-white text-blue-600 rounded-full p-1 shadow">
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                  )}
                </button>
              </div>

              {/* Status Banner */}
              {voteSubmitted && (
                <div className="flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold text-center">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>
                    Vote Received: <strong>{selectedFlag}</strong>. You may tap the other flag to change vote before lock.
                  </span>
                </div>
              )}
            </div>
          )
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-slate-800 rounded-3xl p-8 text-center text-slate-500 space-y-2">
            <Vote className="w-12 h-12 text-slate-700 animate-pulse" />
            <p className="text-sm font-semibold">Tatami is on standby</p>
            <p className="text-xs">
              When the table moderator starts the next bout, your voting pad will activate automatically.
            </p>
          </div>
        )}
      </main>

      {/* Footer / Telemetry */}
      <footer className="text-center pt-2 border-t border-slate-900 text-[11px] text-slate-500 flex items-center justify-between">
        <span>RingFlow E-Judge • J{judgeSeat}</span>
        <button
          onClick={loadState}
          className="hover:text-slate-300 flex items-center gap-1 active:rotate-180 transition-transform"
        >
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
      </footer>
    </div>
  );
}
