"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  adjustMatchCount,
  finishCategory,
  setRingStatus,
  returnCategoryToQueue,
  logRingEvent,
  logoutModerator,
  getModeratorRingAssignments,
} from "@/actions/moderator";
import { getRingActiveBout, setActiveBout } from "@/actions/matches";
import { getRingClock, setRingSidesSwapped } from "@/actions/clock";
import { normalizeClock, type RingClock } from "@/lib/matchClock";
import { getCategoryDraw } from "@/actions/draws";
import { useLiveEvents } from "@/hooks/useLiveEvents";
import { BoutScoringPad } from "@/components/moderator/BoutScoringPad";
import { KataScoringPad } from "@/components/moderator/KataScoringPad";
import { KataPoolTableDraw } from "@/components/draw/KataPoolTableDraw";
import { BoutPickerModal } from "@/components/moderator/BoutPickerModal";
import { DrawBracketModal } from "@/components/draw/DrawBracketModal";
import MatchTimer from "@/components/moderator/MatchTimer";

export default function ModeratorCurrentClient({ ringId, initialAssignments, allAthletes }: { ringId: string, initialAssignments: any[], allAthletes: any[] }) {
  const [assignments, setAssignments] = useState(initialAssignments);
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAssistanceModal, setShowAssistanceModal] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [returnConfirmText, setReturnConfirmText] = useState("");
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [syncErrorModal, setSyncErrorModal] = useState<{ title: string; message: string; isUnauthorized: boolean } | null>(null);
  const [showAdvancedModalOptions, setShowAdvancedModalOptions] = useState(false);
  const [isUpdatingMatch, setIsUpdatingMatch] = useState(false);
  const [activeDelta, setActiveDelta] = useState<number | null>(null);
  const [clickTimestamps, setClickTimestamps] = useState<number[]>([]);
  const [spamNotice, setSpamNotice] = useState<string | null>(null);
  const [boutData, setBoutData] = useState<any>(null);
  const [drawData, setDrawData] = useState<any>(null);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  // The bout list is a tool, not the desk: it opens as a full-view picker so the
  // clock and the point buttons stay in reach on a phone.
  const [showBoutSelector, setShowBoutSelector] = useState(false);
  const [activeMode, setActiveMode] = useState<"digital" | "counter">("digital");
  const [kataViewTab, setKataViewTab] = useState<"pad" | "table">("pad");
  const [showBracketModal, setShowBracketModal] = useState(false);
  const [showDisplayPanel, setShowDisplayPanel] = useState(false);
  const [deskSidesSwapped, setDeskSidesSwapped] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      try {
        return localStorage.getItem("ringflow_desk_sides_swapped") === "true";
      } catch {}
    }
    return false;
  });
  const toggleDeskSides = () => {
    setDeskSidesSwapped((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("ringflow_desk_sides_swapped", String(next));
      } catch {}
      return next;
    });
  };
  const [tvScale, setTvScale] = useState<number>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("ringflow_tv_scale");
        if (saved) {
          const val = parseFloat(saved);
          if (!isNaN(val) && val >= 0.5 && val <= 2) return val;
        }
      } catch {}
    }
    return 1;
  });
  const handleSetTvScale = (newScale: number) => {
    setTvScale(newScale);
    try {
      localStorage.setItem("ringflow_tv_scale", String(newScale));
    } catch {}
  };
  const [deskFontSize, setDeskFontSize] = useState<"compact" | "normal" | "large">(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("ringflow_desk_font_size");
        if (saved === "compact" || saved === "normal" || saved === "large") return saved;
      } catch {}
    }
    return "normal";
  });
  const handleSetDeskFontSize = (size: "compact" | "normal" | "large") => {
    setDeskFontSize(size);
    try {
      localStorage.setItem("ringflow_desk_font_size", size);
    } catch {}
  };
  const router = useRouter();

  const loadBoutData = React.useCallback(async (targetMatchId?: string) => {
    try {
      const targetId = targetMatchId !== undefined ? targetMatchId : selectedMatchId || undefined;
      const data = await getRingActiveBout(ringId, targetId);
      setBoutData(data);
      if (data?.currentMatch && !selectedMatchId) {
        setSelectedMatchId(data.currentMatch.id);
      }
      if (data?.category?.id) {
        const d = await getCategoryDraw(data.category.id);
        setDrawData(d);
      }
    } catch (err) {
      console.error("Failed to load active bout:", err);
    }
  }, [ringId, selectedMatchId]);

  const handleSelectBout = async (matchId: string) => {
    setSelectedMatchId(matchId);
    setShowBoutSelector(false);
    await setActiveBout(ringId, matchId);
    await loadBoutData(matchId);
  };

  /**
   * Mirror the arena screen. This is the action the scoreboard reads, so the
   * left-rail button and the pad's own swap control stay in lockstep; the value
   * is confirmed by the next refresh.
   */
  const handleSwapSides = async () => {
    const next = !sidesSwapped;
    setBoutData((prev: any) =>
      prev ? { ...prev, ring: { ...prev.ring, sidesSwapped: next } } : prev
    );
    try {
      const res = await setRingSidesSwapped(ringId, next);
      if (!res?.success) throw new Error(res?.error || "Swap rejected");
    } catch (err) {
      console.error("Could not swap the arena sides:", err);
      setBoutData((prev: any) =>
        prev ? { ...prev, ring: { ...prev.ring, sidesSwapped: !next } } : prev
      );
      alert("Could not swap the TV sides. Please try again.");
    }
  };

  useEffect(() => {
    loadBoutData();
  }, [loadBoutData]);

  const refreshAssignments = React.useCallback(async () => {
    try {
      const data = await getModeratorRingAssignments(ringId);
      if (data) {
        setAssignments(data);
      }
    } catch (err) {
      console.error("Failed to refresh assignments:", err);
    }
  }, [ringId]);

  // The desk follows every change on this mat immediately — bout swaps from the
  // picker, scores, clock, category reassignments, and the queue behind it.
  useLiveEvents({ ringId }, () => {
    loadBoutData();
    refreshAssignments();
  });

  useEffect(() => {
    // Adaptive cadence: a running clock re-anchors every second, otherwise the
    // desk barely needs to ask, and a hidden tab hardly at all.
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      const sentAt = Date.now();
      let running = false;
      try {
        const res = await getRingClock(ringId);
        const receivedAt = Date.now();
        if (res.success && res.clock) {
          running = res.clock.status === "running";
          setBoutData((prev: any) =>
            prev
              ? {
                  ...prev,
                  clock: res.clock,
                  serverNow: res.serverNow,
                  serverNowSentAt: sentAt,
                  serverNowReceivedAt: receivedAt,
                }
              : prev
          );
        }
      } catch {
        /* transient — the next tick retries */
      }

      if (cancelled) return;
      // The live feed carries changes instantly; this is the safety net when it
      // is unavailable, so an idle desk barely asks at all.
      const delay = document.hidden ? 45000 : running ? 1000 : 20000;
      pollTimer = setTimeout(poll, delay);
    };

    pollTimer = setTimeout(poll, 1000);

    return () => {
      cancelled = true;
      clearTimeout(pollTimer);
    };
  }, [ringId]);

  const activeAssignment = assignments.find(a => a.status === 'running' || a.status === 'paused');

  if (!activeAssignment) {
    return (
      <section className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-24 h-24 bg-surface-container rounded-full flex items-center justify-center mb-6">
          <span className="material-symbols-outlined text-4xl text-outline" style={{ fontVariationSettings: '"FILL" 1' }}>event_busy</span>
        </div>
        <h2 className="font-headline-sm text-headline-sm mb-2">No category running</h2>
        <p className="text-on-surface-variant mb-8 max-w-sm">Please initialize the next category from the Queue to begin.</p>
        <button
          onClick={() => router.push(`/moderator/ring/${ringId}/queue`)}
          className="bg-primary text-on-primary px-8 py-3 rounded-lg font-bold flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <span className="material-symbols-outlined" style={{ fontVariationSettings: '"FILL" 1' }}>queue</span>
          Go to Queue
        </button>
      </section>
    );
  }

  const handleAdjustMatch = async (delta: number) => {
    if (isUpdatingMatch || loading) return;

    const now = Date.now();
    const windowMs = 2500;
    const recent = clickTimestamps.filter(t => now - t < windowMs);

    // If 3 rapid clicks occur in short duration (2 existing + current 1), reject all!
    if (recent.length >= 2) {
      setClickTimestamps([]);
      setSpamNotice("One click = 😎 | 20 clicks = 🤡");
      setTimeout(() => setSpamNotice(null), 3500);
      return;
    }

    setClickTimestamps([...recent, now]);
    setIsUpdatingMatch(true);
    setActiveDelta(delta);

    try {
      const res = await adjustMatchCount(activeAssignment.id, ringId, delta);
      if (res && typeof res.matches_completed === 'number') {
        setAssignments(prev => {
          const idx = prev.findIndex(a => a.id === activeAssignment.id);
          if (idx > -1) {
            const copy = [...prev];
            copy[idx] = { ...copy[idx], matches_completed: res.matches_completed };
            return copy;
          }
          return prev;
        });
      }
    } catch (e: any) {
      console.error(e);
      if (e?.message?.includes("Too many rapid attempts")) {
        setSpamNotice("Too many rapid clicks. Action rejected.");
        setTimeout(() => setSpamNotice(null), 3500);
      } else if (e?.message?.includes("Unauthorized") || e?.message?.includes("Session")) {
        setSyncErrorModal({
          title: "Session Expired",
          message: "Your moderator session is no longer active. Please re-login with your access code or reload the page.",
          isUnauthorized: true
        });
      } else {
        setSyncErrorModal({
          title: "Failed to Update Score",
          message: "💀 Score update failed. The app and server might be out of sync (or your access changed). Refresh the page, check your match count, and try again.",
          isUnauthorized: false
        });
      }
    } finally {
      setIsUpdatingMatch(false);
      setActiveDelta(null);
    }
  };

  const handleTogglePause = async () => {
    setLoading(true);
    try {
      await setRingStatus(activeAssignment.id, ringId, activeAssignment.status === 'running');
    } catch (e) {
      console.error(e);
      alert("Failed to pause/resume ring");
    } finally {
      setLoading(false);
    }
  };

  const executeCompleteCategory = async (fillExpected: boolean) => {
    setLoading(true);
    try {
      if (fillExpected) {
        const totalMatches = activeAssignment.categories?.expected_matches || 0;
        const diff = totalMatches - activeAssignment.matches_completed;
        if (diff > 0) {
          await adjustMatchCount(activeAssignment.id, ringId, diff);
        }
      }
      await finishCategory(activeAssignment.id, ringId);
      router.push(`/moderator/ring/${ringId}/queue`);
    } catch (e) {
      console.error(e);
      alert("Failed to complete category");
    } finally {
      setLoading(false);
      setShowCompleteModal(false);
      setShowSettings(false);
    }
  };

  const executeReturnToQueue = async () => {
    setLoading(true);
    try {
      await returnCategoryToQueue(activeAssignment.id, ringId);
      router.push(`/moderator/ring/${ringId}/queue`);
    } catch (e) {
      console.error(e);
      alert("Failed to return to queue");
    } finally {
      setLoading(false);
      setShowReturnModal(false);
      setShowSettings(false);
    }
  };

  const handleRequestAssistance = async (type: string) => {
    setShowAssistanceModal(false);
    try {
      if (type === 'Doctor / Medical') {
        setLoading(true);
        try {
          await setRingStatus(activeAssignment.id, ringId, true); // true = isPaused
        } catch (e) {
          console.error("Failed to auto-pause for doctor", e);
        } finally {
          setLoading(false);
        }
      }
      await logRingEvent(ringId, "REQUEST_ASSISTANCE", { message: `Requested: ${type}`, type });
      alert(`Assistance requested: ${type}`);
    } catch (e) {
      console.error(e);
      alert("Failed to request assistance");
    }
  };

  const handleEmergency = async () => {
    try {
      await logRingEvent(ringId, "EMERGENCY_ALERT", { message: "Critical Emergency Triggered from UI" });
      alert("Emergency alert sent to admin.");
    } catch (e) {
      console.error(e);
      alert("Failed to send emergency alert");
    }
  };

  const totalMatches = activeAssignment.categories?.expected_matches || 0;
  const currentCompleted = activeAssignment.matches_completed;
  const percentage = totalMatches > 0 ? (currentCompleted / totalMatches) * 100 : 0;
  const isPaused = activeAssignment.status === 'paused';
  // Which corner the arena screen shows on the left.
  const sidesSwapped = Boolean(boutData?.ring?.sidesSwapped);

  return (
    <div className="space-y-0">
      {/* Compact header — status badge inline */}
      <div className="flex items-center justify-between gap-2 mb-4 sm:mb-6">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="font-headline-lg text-xl sm:text-2xl lg:text-headline-lg text-primary tracking-tight truncate">Tatami</h1>
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full shrink-0 text-[10px] sm:text-xs ${isPaused ? 'bg-error-container text-on-error-container border-error/20 border' : 'bg-emerald-50 text-emerald-700 border border-emerald-500/20'}`}>
            <span className="relative flex h-2 w-2">
              {!isPaused && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
              <span className={`relative inline-flex rounded-full h-2 w-2 ${isPaused ? 'bg-error' : 'bg-emerald-500'}`}></span>
            </span>
            <span className="font-label-caps">{isPaused ? 'PAUSED' : 'LIVE'}</span>
          </div>
        </div>
      </div>

      {/* One DOM order for phones; explicit columns from lg up (status rail · desk · queue rail) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-start lg:gap-8">

      {/*
        Laptop/desktop control cluster: everything the desk reaches for sits in
        the left column, above the category card, so nothing has to be scrolled
        for. Left changes the bout, the right rail shows who is next.
      */}
      {boutData?.hasDraw && (
        <div className="hidden lg:col-span-3 lg:col-start-1 lg:row-start-1 lg:mb-0 lg:flex lg:flex-col lg:gap-2">
          <div className="rounded-xl border border-[#E1DDCF] bg-white p-3 shadow-2xs">
            {/* Small, quiet mode toggle */}
            <div className="mb-2 flex items-center rounded-lg border border-[#E1DDCF] bg-[#F5F3EC] p-0.5">
              <button
                onClick={() => setActiveMode("digital")}
                aria-pressed={activeMode === "digital"}
                className={`flex min-h-[32px] flex-1 items-center justify-center gap-1 rounded-md px-2 text-[11px] font-bold transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] ${
                  activeMode === "digital"
                    ? "bg-[#0E9C7C] text-white shadow-xs"
                    : "text-[#68645A] hover:text-[#1B1815]"
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">edit_note</span>
                Runner
              </button>
              <button
                onClick={() => setActiveMode("counter")}
                aria-pressed={activeMode === "counter"}
                className={`flex min-h-[32px] flex-1 items-center justify-center gap-1 rounded-md px-2 text-[11px] font-bold transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] ${
                  activeMode === "counter"
                    ? "bg-[#0E9C7C] text-white shadow-xs"
                    : "text-[#68645A] hover:text-[#1B1815]"
                }`}
              >
                <span className="material-symbols-outlined text-[14px]">bolt</span>
                Counter
              </button>
            </div>

            {/* Change bout is the action this desk performs most */}
            <button
              onClick={() => setShowBoutSelector(true)}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-[#0E9C7C] px-3 text-sm font-black uppercase tracking-wide text-white shadow-sm transition-colors hover:bg-[#0B7C63] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C] focus-visible:ring-offset-2"
            >
              <span className="material-symbols-outlined text-[20px]">grid_view</span>
              Change bout
            </button>

          </div>
        </div>
      )}

      {/* Category card — compact on mobile, expanded on desktop */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-3 sm:p-card-padding shadow-sm relative mb-4 sm:mb-6 lg:col-span-3 lg:col-start-1 lg:row-start-2 lg:mb-0">
        <div className={`absolute top-0 left-0 w-1.5 h-full rounded-l-xl ${isPaused ? 'bg-error' : 'bg-secondary'}`}></div>
        {/* Mobile: compact single-line banner */}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="font-headline-sm text-sm sm:text-lg lg:text-headline-sm text-primary truncate font-bold">{activeAssignment.categories?.name}</h2>
              {(() => {
                const ver = drawData?.draw?.version ?? activeAssignment.categories?.draw_version ?? activeAssignment.categories?.drawVersion;
                if (!ver) return null;
                return (
                  <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold font-data-mono bg-blue-50 text-blue-800 border border-blue-200" title={`Draw Version v${ver}`}>
                    v{ver}
                  </span>
                );
              })()}
              <span className="shrink-0 font-data-mono text-xs font-bold text-secondary">{currentCompleted}/{totalMatches}</span>
              {isUpdatingMatch && <span className="inline-block w-3 h-3 border-2 border-secondary border-t-transparent rounded-full animate-spin"></span>}
            </div>
            {/* Progress bar — always visible, compact */}
            <div className={`mt-1.5 w-full bg-surface-container-high h-1.5 sm:h-2 rounded-full overflow-hidden ${isUpdatingMatch ? 'animate-pulse' : ''}`}>
              <div className={`${isPaused ? 'bg-error/40' : 'bg-secondary'} h-full transition-all duration-500 ease-out`} style={{ width: `${Math.min(100, percentage)}%` }}></div>
            </div>
          </div>
          <div className="relative shrink-0">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-surface-container hover:bg-surface-container-high flex items-center justify-center text-on-surface transition-colors cursor-pointer"
              title="Category Actions"
              aria-label="Category Actions"
            >
              <span className="material-symbols-outlined text-[20px]">settings</span>
            </button>
            {showSettings && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setShowSettings(false)} />
                <div className="absolute top-11 right-0 bg-white border border-outline-variant shadow-2xl rounded-xl w-52 z-30 overflow-hidden animate-in fade-in zoom-in-95">
                  <button
                    disabled={loading}
                    onClick={() => {
                      setShowSettings(false);
                      setShowCompleteModal(true);
                    }}
                    className="w-full text-left px-4 py-3 text-body-sm font-semibold hover:bg-[#F5F3EC] flex items-center gap-2.5 disabled:opacity-50 text-secondary cursor-pointer transition-colors"
                  >
                    <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: '"FILL" 1' }}>check_circle</span>
                    Complete Category
                  </button>
                  <button
                    disabled={loading}
                    onClick={() => {
                      setShowSettings(false);
                      setShowReturnModal(true);
                    }}
                    className="w-full text-left px-4 py-3 text-body-sm font-semibold hover:bg-red-50 flex items-center gap-2.5 disabled:opacity-50 border-t border-outline-variant text-error cursor-pointer transition-colors"
                  >
                    <span className="material-symbols-outlined text-xl">undo</span>
                    Return to Queue
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        {/* Desktop: show remaining count */}
        <div className="hidden sm:flex justify-between text-on-surface-variant font-label-caps text-label-caps pt-1.5">
          <span>{percentage > 100 ? 0 : Math.max(0, totalMatches - currentCompleted)} REMAINING</span>
          <span className="text-secondary font-bold">{percentage.toFixed(0)}%</span>
        </div>
      </div>

      <div className="lg:col-span-6 lg:col-start-4 lg:row-span-3 lg:row-start-1">
      {/* Phone/tablet controls. On a laptop these live in the left column, so the
          scoring pad starts at the top of the centre and needs no scrolling. */}
      {/* Mobile/tablet controls toolbar — compact row */}
      {boutData?.hasDraw && (
        <div className="mb-3 sm:mb-4 flex items-center gap-1.5 sm:gap-2 overflow-x-auto scrollbar-none lg:hidden">
          {/* Mode toggle */}
          <div className="flex shrink-0 items-center gap-0.5 bg-[#F5F3EC] p-0.5 rounded-lg border border-[#E1DDCF]">
            <button
              onClick={() => setActiveMode("digital")}
              className={`min-h-[36px] px-2.5 py-1.5 rounded-md text-[10px] sm:text-xs font-bold transition-all cursor-pointer ${activeMode === "digital" ? "bg-[#0E9C7C] text-white shadow-xs" : "text-[#68645A]"}`}
            >
              Runner
            </button>
            <button
              onClick={() => setActiveMode("counter")}
              className={`min-h-[36px] px-2.5 py-1.5 rounded-md text-[10px] sm:text-xs font-bold transition-all cursor-pointer ${activeMode === "counter" ? "bg-[#0E9C7C] text-white shadow-xs" : "text-[#68645A]"}`}
            >
              Counter
            </button>
          </div>

          <button
            onClick={() => setShowBoutSelector(true)}
            className="flex min-h-[36px] shrink-0 items-center gap-1 rounded-lg border border-[#E1DDCF] bg-white px-2.5 py-1.5 text-[10px] sm:text-xs font-bold text-[#1B1815] cursor-pointer hover:bg-[#FAF9F5]"
          >
            <span className="material-symbols-outlined text-[14px]">grid_view</span>
            Bout
          </button>

          {(() => {
            const nextReady = boutData.matches.find(
              (m: any) => m.isReady && m.id !== boutData.currentMatch?.id
            );
            if (!nextReady) return null;
            return (
              <button
                onClick={() => void handleSelectBout(nextReady.id)}
                className="flex min-h-[36px] shrink-0 items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[10px] sm:text-xs font-extrabold text-amber-900 cursor-pointer hover:bg-amber-100"
              >
                <span className="material-symbols-outlined text-[14px]">bolt</span>
                Next #{nextReady.matchNo}
              </button>
            );
          })()}

          <button
            onClick={() => setShowBracketModal(true)}
            className="flex min-h-[36px] shrink-0 items-center gap-1 rounded-lg border border-[#0E9C7C] bg-white px-2.5 py-1.5 text-[10px] sm:text-xs font-bold text-[#0E9C7C] cursor-pointer hover:bg-emerald-50"
          >
            <span className="material-symbols-outlined text-[14px]">account_tree</span>
            <span className="hidden sm:inline">Bracket</span>
          </button>
        </div>
      )}

      {/* Digital Bout Runner Mode */}
      {boutData?.hasDraw && activeMode === "digital" && (
        <div className="space-y-4 mb-8">

          {/* Active Bout Scoring Pad with unified clock */}
          {boutData.currentMatch ? (
            (() => {
              const isKataCategory =
                activeAssignment?.categories?.discipline === "KATA" ||
                activeAssignment?.categories?.event_type === "kata" ||
                activeAssignment?.categories?.eventType === "kata" ||
                activeAssignment?.categories?.name?.toLowerCase().includes("kata") ||
                Boolean(boutData.currentMatch.kata_scoring_mode || boutData.currentMatch.kataScoringMode);

              if (isKataCategory) {
                return (
                  <div className="space-y-4">
                    {/* View Switcher for Moderator */}
                    <div className="flex items-center justify-between bg-white border border-[#E1DDCF] p-1.5 rounded-xl shadow-xs">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setKataViewTab("pad")}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold font-data-mono transition-colors ${
                            kataViewTab === "pad"
                              ? "bg-[#0E9C7C] text-white shadow-xs"
                              : "text-[#68645A] hover:bg-[#FAF9F5]"
                          }`}
                        >
                          Tatami Scoring Console
                        </button>
                        <button
                          type="button"
                          onClick={() => setKataViewTab("table")}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold font-data-mono transition-colors ${
                            kataViewTab === "table"
                              ? "bg-[#0E9C7C] text-white shadow-xs"
                              : "text-[#68645A] hover:bg-[#FAF9F5]"
                          }`}
                        >
                          Pool Draw Tables
                        </button>
                      </div>

                      <span className="text-[11px] font-bold font-data-mono text-[#0E9C7C] px-2 hidden sm:inline">
                        Kata Competition Mode
                      </span>
                    </div>

                    {kataViewTab === "pad" ? (
                      <KataScoringPad
                        ringId={ringId}
                        activeMatch={boutData.currentMatch}
                        category={activeAssignment.categories}
                        scores={boutData.currentMatch.kataScores || []}
                        judgePin={boutData.ring?.judgePin || boutData.ring?.judge_pin || "1234"}
                        tunnelUrl={boutData.tournament?.tunnelUrl || boutData.tournament?.tunnel_url}
                        onRefresh={() => {
                          loadBoutData();
                          refreshAssignments();
                          router.refresh();
                        }}
                        onViewDrawTable={() => setKataViewTab("table")}
                      />
                    ) : (
                      <KataPoolTableDraw
                        drawData={drawData?.flightDraw}
                        categoryName={activeAssignment?.categories?.name || "Kata Category"}
                        matches={drawData?.matches || []}
                        allAthletes={allAthletes || []}
                        isModerator={true}
                        onRefresh={() => {
                          loadBoutData();
                          refreshAssignments();
                          router.refresh();
                        }}
                        onSelectMatch={(m) => handleSelectBout(m.id)}
                      />
                    )}
                  </div>
                );
              }

              return (
                <BoutScoringPad
                  match={boutData.currentMatch}
                  ringId={ringId}
                  categoryName={activeAssignment.categories?.name || "Category"}
                  clock={normalizeClock(boutData.clock ?? boutData.ring)}
                  serverNow={boutData.serverNow}
                  serverNowSentAt={boutData.serverNowSentAt}
                  serverNowReceivedAt={boutData.serverNowReceivedAt}
                  sidesSwapped={boutData.ring?.sidesSwapped ?? false}
                  nextBout={boutData.nextBout}
                  deskSidesSwapped={deskSidesSwapped}
                  onToggleDeskSides={toggleDeskSides}
                  deskFontSize={deskFontSize}
                  onBoutCompleted={() => {
                    const wasAlreadyConfirmed = boutData?.currentMatch?.status === "CONFIRMED";
                    if (!wasAlreadyConfirmed) {
                      // Instantly increment match count on client for immediate UI feedback
                      setAssignments((prev) =>
                        prev.map((a) =>
                          a.id === activeAssignment.id
                            ? { ...a, matches_completed: Math.min((activeAssignment.categories?.expected_matches || 99), (a.matches_completed || 0) + 1) }
                            : a
                        )
                      );
                    }
                    setSelectedMatchId(null);
                    loadBoutData();
                    refreshAssignments();
                    router.refresh();
                  }}
                />
              );
            })()
          ) : (
            <div className="p-8 bg-white rounded-2xl border border-[#E1DDCF] text-center">
              <span className="material-symbols-outlined text-4xl text-neutral-400 mb-2">sports_martial_arts</span>
              <p className="font-bold text-sm text-neutral-700">All bouts in this category are completed!</p>
            </div>
          )}
        </div>
      )}

      {/* Manual Counter Mode (only shown when user toggles to Quick Counter) */}
      {(!boutData?.hasDraw || activeMode === "counter") && (
        <>
          <MatchTimer
            ringId={ringId}
            clock={normalizeClock(boutData?.clock ?? boutData?.ring)}
            serverNow={boutData?.serverNow}
            isPaused={isPaused}
          />

      <section className="space-y-4 mb-10">
        <div className="flex items-center justify-between px-1">
          <h3 className="font-label-caps text-label-caps text-on-surface-variant">MATCH ADJUSTMENT</h3>
          {isUpdatingMatch && (
            <span className="text-xs text-secondary font-medium animate-pulse flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-secondary animate-ping"></span> Updating...
            </span>
          )}
        </div>

        {spamNotice && (
          <div className="bg-error-container/90 text-on-error-container border border-error/20 p-3 rounded-xl text-sm font-semibold flex items-center gap-2 animate-fadeIn">
            <span className="material-symbols-outlined text-base">block</span>
            <span>{spamNotice}</span>
          </div>
        )}

        <div className="space-y-3">
          {/* Prominent, highlighted +1 button */}
          <button
            onClick={() => handleAdjustMatch(1)}
            disabled={isPaused || loading || isUpdatingMatch}
            className="w-full bg-primary text-white border-2 border-primary h-20 rounded-xl flex items-center justify-center active:scale-[0.98] transition-all hover:bg-neutral-800 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer relative"
          >
            {activeDelta === 1 && isUpdatingMatch ? (
              <span className="w-7 h-7 border-3 border-white border-t-transparent rounded-full animate-spin"></span>
            ) : (
              <span className="font-headline-lg text-4xl font-black tracking-tight">+1</span>
            )}
          </button>

          {/* Secondary adjustments */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { delta: -1, label: "-1" },
              { delta: -5, label: "-5" },
              { delta: 5, label: "+5" },
            ].map(({ delta, label }) => {
              const isThisUpdating = activeDelta === delta && isUpdatingMatch;
              const isDisabled = isPaused || loading || isUpdatingMatch;
              return (
                <button
                  key={delta}
                  onClick={() => handleAdjustMatch(delta)}
                  disabled={isDisabled}
                  className="bg-surface-container-lowest border border-outline-variant h-14 rounded-xl flex items-center justify-center active:scale-95 transition-transform hover:bg-surface-container shadow-2xs disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isThisUpdating ? (
                    <span className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></span>
                  ) : (
                    <span className="font-headline-sm text-headline-sm text-on-surface-variant font-bold">{label}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </section>
      </>
      )}

      <div className="pt-3 mb-6 sm:pt-4 sm:mb-8">
        <button
          disabled={loading}
          onClick={handleTogglePause}
          className={`w-full bg-surface-container-lowest border min-h-[48px] sm:h-14 rounded-xl font-bold font-body-md text-sm flex items-center justify-center gap-2 transition-colors active:scale-[0.98] ${isPaused ? 'border-emerald-500 text-emerald-700 active:bg-emerald-50' : 'border-amber-500 text-amber-700 active:bg-amber-50'}`}
        >
          <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: '"FILL" 1' }}>{isPaused ? 'play_circle' : 'pause_circle'}</span>
          {isPaused ? 'Resume Tatami' : 'Pause Tatami'}
        </button>
      </div>
      </div>

      {/* Status + assistance — compact card */}
      <div className="mt-4 bg-surface-container-low p-3 sm:p-4 rounded-xl border border-outline-variant flex flex-col gap-3 lg:col-span-3 lg:col-start-1 lg:row-start-3 lg:mt-0">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-secondary opacity-50 text-[18px]">visibility</span>
          <p className="font-body-sm text-xs sm:text-body-sm text-on-surface flex-1 truncate">
            <span className={`${isPaused ? 'text-error' : 'text-emerald-600'} font-semibold`}>{isPaused ? '⏸ Paused' : '● Live'}</span>
            <span className="text-on-surface-variant"> · {activeAssignment.categories?.name}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 pt-2 border-t border-outline-variant">
          <button
            onClick={() => setShowAssistanceModal(true)}
            className="flex min-h-[40px] flex-1 items-center justify-center gap-1.5 text-primary font-bold text-[10px] sm:text-xs hover:bg-primary/10 rounded-lg transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">support_agent</span>
            <span>Assistance</span>
          </button>
          <button
            onClick={handleEmergency}
            className="flex min-h-[40px] items-center justify-center gap-1 text-error font-bold text-[10px] sm:text-xs hover:bg-error/10 px-3 rounded-lg transition-colors"
          >
            <span className="material-symbols-outlined text-[14px]">warning</span>
            <span className="hidden sm:inline">Emergency</span>
          </button>
        </div>
      </div>

      {/* Queue rail: what is coming on this tatami, and the arena screen link */}
      {/* Right sidebar — tighter cards */}
      <aside className="mt-4 space-y-3 lg:col-span-3 lg:col-start-10 lg:row-span-3 lg:row-start-1 lg:mt-0">
        {/* Next ready bout — prominent CTA */}
        {boutData?.hasDraw &&
          (() => {
            const nextReady = boutData.matches?.find(
              (m: any) => m.isReady && m.id !== boutData.currentMatch?.id
            );
            if (!nextReady) return null;
            return (
              <button
                onClick={() => void handleSelectBout(nextReady.id)}
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 text-xs sm:text-sm font-extrabold text-amber-900 transition-colors hover:bg-amber-100 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">bolt</span>
                Next · Bout #{nextReady.matchNo}
              </button>
            );
          })()}

        {/* Combined Up Next + On Deck */}
        <div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-3 shadow-sm">
          {/* On Deck (next bout) */}
          {boutData?.nextBout && (
            <div className="mb-3 pb-3 border-b border-outline-variant">
              <h3 className="font-label-caps text-[10px] tracking-widest text-on-surface-variant mb-1.5">ON DECK</h3>
              <div className="rounded-lg border border-[#E1DDCF] bg-[#FAF9F5] px-2.5 py-2">
                <p className="text-[10px] font-black uppercase tracking-wider text-[#8C877C]">
                  #{boutData.nextBout.matchNo} · {boutData.nextBout.roundName}
                </p>
                <p className="mt-0.5 truncate text-[11px] font-bold text-[#DC2626]">
                  {boutData.nextBout.aka?.name || "TBD"}
                </p>
                <p className="truncate text-[11px] font-bold text-[#2563EB]">
                  {boutData.nextBout.ao?.name || "TBD"}
                </p>
              </div>
            </div>
          )}

          {/* Queue preview */}
          <h3 className="font-label-caps text-[10px] tracking-widest text-on-surface-variant mb-1.5">UP NEXT</h3>
          <div className="space-y-1.5">
            {assignments
              .filter((a) => a.status === "pending")
              .slice(0, 3)
              .map((a) => (
                <div key={a.id} className="rounded-lg border border-outline-variant bg-[#FAF9F5] px-2.5 py-1.5">
                  <p className="truncate text-[11px] font-bold text-[#1B1815]">{a.categories?.name}</p>
                  <p className="text-[10px] text-[#68645A]">{a.categories?.expected_matches ?? 0} matches</p>
                </div>
              ))}
            {assignments.filter((a) => a.status === "pending").length === 0 && (
              <p className="text-[11px] text-[#68645A]">Queue empty.</p>
            )}
          </div>
        </div>

        {/* Arena screen link */}
        <a
          href={`/scoreboard/${ringId}`}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-[#0E9C7C] bg-[#E3F6F0] px-3 py-2 text-xs font-bold text-[#0B7C63] transition-colors hover:bg-[#d3f0e7]"
        >
          <span className="material-symbols-outlined text-[16px]">tv</span>
          Open TV scoreboard
        </a>

        {/* Corner & Display controls — collapsible accordion */}
        <div className="rounded-xl border border-[#E1DDCF] bg-white shadow-sm overflow-hidden">
          {/* Accordion header / toggle */}
          <button
            type="button"
            onClick={() => setShowDisplayPanel((p) => !p)}
            className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-[#FAF9F5] cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[17px] text-[#0E9C7C]">tune</span>
              <span className="text-[11px] font-black uppercase tracking-wider text-[#8C877C]">Corner &amp; Display</span>
            </span>
            <span className="material-symbols-outlined text-[16px] text-[#8C877C] transition-transform duration-200" style={{ transform: showDisplayPanel ? "rotate(180deg)" : "rotate(0deg)" }}>
              expand_more
            </span>
          </button>

          {/* Collapsible body */}
          {showDisplayPanel && (
            <div className="border-t border-[#F0EDE4] px-1 pb-2 pt-1">
              {/* TV screen side flip */}
              <button
                type="button"
                onClick={handleSwapSides}
                className="flex w-full items-center justify-between gap-2 rounded-lg p-2 text-left text-xs font-semibold text-[#1B1815] hover:bg-[#FAF9F5] transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px] text-[#0E9C7C]">tv</span>
                  <span>Arena TV Screen</span>
                </span>
                <span className="rounded bg-[#FAF9F5] border border-[#E1DDCF] px-1.5 py-0.5 text-[10px] font-black">
                  {sidesSwapped ? "AO Left" : "AKA Left"}
                </span>
              </button>

              {/* Desk scoring pad layout flip */}
              <button
                type="button"
                onClick={toggleDeskSides}
                className="flex w-full items-center justify-between gap-2 rounded-lg p-2 text-left text-xs font-semibold text-[#1B1815] hover:bg-[#FAF9F5] transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px] text-[#2563EB]">touch_app</span>
                  <span>Desk Layout</span>
                </span>
                <span className="rounded bg-[#FAF9F5] border border-[#E1DDCF] px-1.5 py-0.5 text-[10px] font-black">
                  {deskSidesSwapped ? "AO Left" : "AKA Left"}
                </span>
              </button>

              {/* Scoreboard Zoom */}
              <div className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5">
                <span className="flex items-center gap-2 text-xs font-semibold text-[#1B1815]">
                  <span className="material-symbols-outlined text-[18px] text-[#7C3AED]">fit_screen</span>
                  <span>Scoreboard Zoom</span>
                </span>
                <select
                  value={tvScale}
                  onChange={(e) => handleSetTvScale(parseFloat(e.target.value))}
                  className="rounded-lg border border-[#E1DDCF] bg-[#FAF9F5] px-2 py-0.5 text-[10px] font-black text-[#1B1815] cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#0E9C7C]"
                >
                  <option value="0.85">85% · Compact</option>
                  <option value="1">100% · Standard</option>
                  <option value="1.15">115% · Large TV</option>
                  <option value="1.3">130% · Arena Wall</option>
                </select>
              </div>

              {/* Desk font size */}
              <div className="mt-1 border-t border-[#F0EDE4] pt-2 px-1">
                <p className="mb-1.5 text-[10px] font-bold text-[#8C877C]">Desk Font</p>
                <div className="flex gap-1">
                  {(["compact", "normal", "large"] as const).map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => handleSetDeskFontSize(size)}
                      className={`flex-1 rounded-lg border py-1.5 text-[10px] font-bold capitalize transition-colors cursor-pointer ${
                        deskFontSize === size
                          ? "border-[#0E9C7C] bg-[#E3F6F0] text-[#0B7C63]"
                          : "border-[#E1DDCF] bg-white text-[#68645A] hover:bg-[#FAF9F5]"
                      }`}
                    >
                      {size === "compact" ? "S" : size === "normal" ? "M" : "L"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>
      </div>

      {/* Bout picker: full view on a laptop, full sheet on a phone */}
      {showBoutSelector && boutData?.matches && boutData.matches.length > 0 && (
        <BoutPickerModal
          isOpen={showBoutSelector}
          onClose={() => setShowBoutSelector(false)}
          categoryName={activeAssignment.categories?.name || "Tournament Category"}
          bouts={boutData.matches}
          drawMatches={drawData?.matches || []}
          tournamentSize={drawData?.draw?.tournamentSize}
          bronzeMedals={drawData?.bronzeMedals ?? 2}
          activeMatchId={boutData.currentMatch?.id}
          onSelect={(matchId) => void handleSelectBout(matchId)}
        />
      )}

      {/* Modals */}
      {showAssistanceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-surface-container-lowest p-6 rounded-xl max-w-sm w-full space-y-4">
            <h3 className="font-headline-sm text-primary font-bold">Request Assistance</h3>
            <p className="text-body-sm text-on-surface-variant">Select the type of assistance needed for this tatami. Admin will be notified softly.</p>
            <div className="grid grid-cols-1 gap-2">
              {['Doctor / Medical', 'Technical Support', 'Security', 'General Assistance'].map(type => (
                <button
                  key={type}
                  onClick={() => handleRequestAssistance(type)}
                  className="bg-surface-container hover:bg-surface-container-high py-3 rounded font-bold text-sm border border-outline-variant"
                >
                  {type}
                </button>
              ))}
            </div>
            <button onClick={() => setShowAssistanceModal(false)} className="w-full mt-2 py-2 text-on-surface-variant font-bold text-sm">Cancel</button>
          </div>
        </div>
      )}

      {showReturnModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-surface-container-lowest p-6 rounded-2xl max-w-sm w-full space-y-4 border border-outline-variant shadow-2xl">
            <h3 className="font-headline-sm text-error font-bold flex items-center gap-2">
              <span className="material-symbols-outlined text-2xl">undo</span>
              Return to Queue
            </h3>
            <p className="text-body-sm text-on-surface-variant leading-relaxed">
              Are you sure you want to remove <strong>{activeAssignment.categories?.name}</strong> from the live tatami? Recorded matches will be safely preserved in the queue.
            </p>
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowReturnModal(false)}
                disabled={loading}
                className="flex-1 py-3 bg-surface-container hover:bg-surface-container-high rounded-xl font-bold text-sm text-on-surface transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeReturnToQueue}
                disabled={loading}
                className="flex-1 py-3 bg-error hover:bg-error/90 text-white rounded-xl font-bold text-sm disabled:opacity-50 transition-colors shadow-sm cursor-pointer flex items-center justify-center gap-1.5"
              >
                {loading ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : null}
                <span>Return to Queue</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {showCompleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-surface-container-lowest p-6 rounded-xl max-w-sm w-full space-y-4">
            <h3 className="font-headline-sm text-secondary font-bold">Complete Category</h3>
            <p className="text-body-sm text-on-surface-variant">How would you like to record this category's completion?</p>
            <div className="space-y-3">
              <button
                onClick={() => executeCompleteCategory(false)}
                disabled={loading}
                className="w-full text-left p-4 bg-surface-container hover:bg-surface-container-high border border-outline-variant rounded-xl flex flex-col gap-1"
              >
                <span className="font-bold text-primary">Complete at Current State</span>
                <span className="text-xs text-on-surface-variant">Mark as finished with {currentCompleted} matches recorded.</span>
              </button>
              <button
                onClick={() => executeCompleteCategory(true)}
                disabled={loading}
                className="w-full text-left p-4 bg-surface-container hover:bg-surface-container-high border border-outline-variant rounded-xl flex flex-col gap-1"
              >
                <span className="font-bold text-secondary">Mark All Completed</span>
                <span className="text-xs text-on-surface-variant">Set matches to {totalMatches} expected matches and finish.</span>
              </button>
            </div>
            <button onClick={() => setShowCompleteModal(false)} className="w-full mt-2 py-2 text-on-surface-variant font-bold text-sm">Cancel</button>
          </div>
        </div>
      )}

      {syncErrorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-surface-container-lowest p-6 rounded-xl max-w-sm w-full space-y-4 shadow-xl border border-outline-variant">
            <div className="flex items-center gap-3 text-error">
              <span className="material-symbols-outlined text-3xl">warning</span>
              <h3 className="font-headline-sm text-headline-sm font-bold text-on-surface">{syncErrorModal.title}</h3>
            </div>
            <p className="text-body-sm text-on-surface-variant leading-relaxed">
              {syncErrorModal.message}
            </p>
            <div className="flex flex-col gap-3 pt-2">
              <button
                onClick={() => window.location.reload()}
                className="w-full py-3 bg-primary text-on-primary font-bold rounded-xl flex items-center justify-center gap-2 hover:opacity-90 transition-opacity shadow-sm"
              >
                <span className="material-symbols-outlined text-lg">refresh</span>
                Reload Page
              </button>

              <div className="pt-1 text-center">
                <button
                  type="button"
                  onClick={() => setShowAdvancedModalOptions(!showAdvancedModalOptions)}
                  className="text-xs text-on-surface-variant hover:text-on-surface flex items-center justify-center gap-1 mx-auto transition-colors font-medium py-1"
                >
                  <span>More Options</span>
                  <span className="material-symbols-outlined text-base">
                    {showAdvancedModalOptions ? 'expand_less' : 'expand_more'}
                  </span>
                </button>

                {showAdvancedModalOptions && (
                  <div className="mt-3 pt-3 border-t border-outline-variant animate-fadeIn">
                    <button
                      onClick={async () => {
                        try {
                          await logoutModerator();
                        } catch (err) {
                          console.error(err);
                        }
                        router.push("/login/mod");
                      }}
                      className="w-full py-2.5 bg-error/10 hover:bg-error/20 text-error font-semibold rounded-xl flex items-center justify-center gap-2 text-xs transition-colors border border-error/20"
                    >
                      <span className="material-symbols-outlined text-base">logout</span>
                      Logout & Re-login
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Bracket Tree Modal */}
      {showBracketModal && activeAssignment?.categoryId && (
        <DrawBracketModal
          categoryId={activeAssignment.categoryId}
          categoryName={activeAssignment.categories?.name || "Category"}
          isOpen={showBracketModal}
          onClose={() => setShowBracketModal(false)}
          onSelectMatch={(m) => handleSelectBout(m.matchId)}
        />
      )}
    </div>
  );
}
