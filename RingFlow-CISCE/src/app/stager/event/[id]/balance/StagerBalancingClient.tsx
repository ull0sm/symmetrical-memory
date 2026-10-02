"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { updateCategoryStagerStatus, logoutStager } from "@/actions/stager";
import { getBalancingAssignments } from "@/actions/balancing";
import StagerStatusIndicator from "@/components/ui/StagerStatusIndicator";
import { PdfViewerModal } from "@/components/ui/PdfViewerModal";
import { DrawBracketModal } from "@/components/draw/DrawBracketModal";
import { AttendanceModal } from "@/components/stager/AttendanceModal";
import { SegmentedProgressBar } from "@/components/ui/SegmentedProgressBar";
import BuiltByCrux from "@/components/layout/BuiltByCrux";
import HeaderSearchBar from "@/components/layout/HeaderSearchBar";
import BackNavigationGuard from "@/components/common/BackNavigationGuard";
import LogoutConfirmModal from "@/components/ui/LogoutConfirmModal";
import { useLiveEvents } from "@/hooks/useLiveEvents";

// ─── Types ────────────────────────────────────────────────────────────────────

type Category = {
  id: string;
  name: string;
  age_bracket: string | null;
  weight_class: string | null;
  athletes_count: number;
  expected_matches: number;
  belt?: string | null;
  age_min?: number | null;
  age_max?: number | null;
  sex?: string | null;
  day?: string | null;
  doc_url?: string | null;
};

type Ring = {
  id: string;
  name: string;
  ring_order: number;
};

type Assignment = {
  category_id: string;
  ring_id: string;
  queue_order: number;
  status?: string;
  matches_completed?: number;
  stager_status?: string | null;
  stager_name?: string | null;
};

interface Props {
  tournamentId: string;
  tournamentName: string;
  stagerName: string;
  initialCategories: Category[];
  initialRings: Ring[];
  initialAssignments: Assignment[];
  completedTimes: Record<string, string>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StagerBalancingClient({
  tournamentId,
  tournamentName,
  stagerName,
  initialCategories,
  initialRings,
  initialAssignments,
  completedTimes,
}: Props) {
  const router = useRouter();
  const [currentStagerName, setCurrentStagerName] = useState(stagerName);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [viewingPdf, setViewingPdf] = useState<{ url: string; title: string } | null>(null);
  const [historyOpenForRing, setHistoryOpenForRing] = useState<string | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Draw sheets: what the stager reads out when calling athletes in.
  const [isDrawsOpen, setIsDrawsOpen] = useState(false);
  const [drawsQuery, setDrawsQuery] = useState("");
  // The queue is the job: show the categories this board is actually running
  // first, with the whole tournament one tap away.
  const [drawsScope, setDrawsScope] = useState<"queue" | "all">("queue");
  const [bracketCategory, setBracketCategory] = useState<{ id: string; name: string } | null>(null);
  const [attendanceCategory, setAttendanceCategory] = useState<{ id: string; name: string } | null>(null);

  /** Blob URLs we created must be released, or the tab leaks a file each time. */
  const closePdfViewer = () => {
    if (viewingPdf?.url?.startsWith("blob:")) {
      URL.revokeObjectURL(viewingPdf.url);
    }
    setViewingPdf(null);
  };

  useEffect(() => {
    if ((!currentStagerName || currentStagerName === "Stager") && typeof window !== "undefined") {
      const stored = localStorage.getItem("ringflow_stager_name");
      if (stored) {
        setCurrentStagerName(stored);
      }
    }
  }, [currentStagerName]);

  // Assignments map: categoryId → assignment data incl. stager status
  const [assignmentsMap, setAssignmentsMap] = useState<
    Record<
      string,
      {
        matches_completed: number;
        status: string;
        ring_id: string;
        queue_order: number;
        stager_status: string | null;
        stager_name: string | null;
      }
    >
  >({});

  // Ordered queues per ring (active only)
  const [ringQueues, setRingQueues] = useState<Record<string, Category[]>>({});
  const [ringCompletedQueues, setRingCompletedQueues] = useState<Record<string, Category[]>>({});

  const [isInitialized, setIsInitialized] = useState(false);

  // Action loading state: key is categoryId + action
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  // Minimal Confirmation Modal State
  const [confirmModal, setConfirmModal] = useState<{
    categoryId: string;
    categoryName: string;
    requestedStatus: "calling" | "ready";
    isClearing: boolean;
  } | null>(null);

  // Close confirmation modal on Escape key
  useEffect(() => {
    if (!confirmModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmModal(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirmModal]);

  // ── Initialize from props ──────────────────────────────────────────────────
  useEffect(() => {
    if (isInitialized) return;
    setIsInitialized(true);

    const map: Record<string, any> = {};
    initialAssignments.forEach((a) => {
      map[a.category_id] = {
        matches_completed: (a as any).matches_completed || 0,
        status: a.status || "pending",
        ring_id: a.ring_id,
        queue_order: a.queue_order ?? 0,
        stager_status: a.stager_status ?? null,
        stager_name: a.stager_name ?? null,
      };
    });
    setAssignmentsMap(map);

    const ringMap: Record<string, Category[]> = {};
    const ringMapHistory: Record<string, Category[]> = {};
    initialRings.forEach((r) => {
      ringMap[r.id] = [];
      ringMapHistory[r.id] = [];
    });

    initialCategories.forEach((cat) => {
      const assignment = initialAssignments.find((a) => a.category_id === cat.id);
      if (assignment && ringMap[assignment.ring_id]) {
        if (assignment.status === "completed") {
          ringMapHistory[assignment.ring_id].push(cat);
        } else {
          ringMap[assignment.ring_id].push(cat);
        }
      }
    });

    Object.keys(ringMap).forEach((ringId) => {
      ringMap[ringId].sort((a, b) => {
        const orderA = initialAssignments.find((as) => as.category_id === a.id)?.queue_order || 0;
        const orderB = initialAssignments.find((as) => as.category_id === b.id)?.queue_order || 0;
        return orderA - orderB;
      });
    });

    setRingQueues(ringMap);
    setRingCompletedQueues(ringMapHistory);
  }, [initialCategories, initialRings, initialAssignments, isInitialized]);

  // Live board: a category starting, finishing, pausing or moving between mats
  // shows up here the moment it happens.
  const refreshAssignments = useCallback(async () => {
    const ringIds = initialRings.map((r) => r.id);
    if (ringIds.length === 0) return;
    try {
      const data = await getBalancingAssignments(ringIds);
      const map: Record<string, any> = {};
      for (const row of data ?? []) {
        map[row.category_id] = {
          matches_completed: row.matches_completed || 0,
          status: row.status || "pending",
          ring_id: row.ring_id,
          queue_order: row.queue_order ?? 0,
          stager_status: row.stager_status ?? null,
          stager_name: row.stager_name ?? null,
        };
      }
      setAssignmentsMap(map);
    } catch (err) {
      console.error("[stager] live refresh failed:", err);
    }
  }, [initialRings]);

  useLiveEvents({ tournamentId }, refreshAssignments, { feed: "staff" });

  useEffect(() => {
    const poll = setInterval(refreshAssignments, 15000);
    return () => clearInterval(poll);
  }, [refreshAssignments]);

  // ── Stager action handler ──────────────────────────────────────────────────
  const handleStagerAction = useCallback(
    async (categoryId: string, requestedStatus: "calling" | "ready") => {
      const current = assignmentsMap[categoryId];
      const isSameStatus = current?.stager_status === requestedStatus;
      const newStatus: "calling" | "ready" | null = isSameStatus ? null : requestedStatus;

      const actionKey = `${categoryId}-${requestedStatus}`;
      setLoadingAction(actionKey);

      // Optimistic update
      setAssignmentsMap((prev) => ({
        ...prev,
        [categoryId]: {
          ...prev[categoryId],
          stager_status: newStatus,
          stager_name: newStatus ? currentStagerName : null,
        },
      }));

      try {
        const res = await updateCategoryStagerStatus(categoryId, tournamentId, newStatus);
        if (!res.success) {
          // Rollback on failure
          setAssignmentsMap((prev) => ({
            ...prev,
            [categoryId]: {
              ...prev[categoryId],
              stager_status: current?.stager_status ?? null,
              stager_name: current?.stager_name ?? null,
            },
          }));
          alert(res.error || "Failed to update status.");
        }
      } catch (err: any) {
        // Rollback on failure
        setAssignmentsMap((prev) => ({
          ...prev,
          [categoryId]: {
            ...prev[categoryId],
            stager_status: current?.stager_status ?? null,
            stager_name: current?.stager_name ?? null,
          },
        }));
        alert(err?.message || "Failed to update status.");
      } finally {
        setLoadingAction(null);
      }
    },
    [assignmentsMap, currentStagerName, tournamentId]
  );

  // ── Render category card (within a ring queue) ─────────────────────────────
  const queuedDrawCategories = initialCategories.filter((cat) => {
    const assignment = assignmentsMap[cat.id];
    return Boolean(assignment) && assignment.status !== "completed";
  });

  const renderCategoryCard = (cat: Category, ringId: string) => {
    const catAssignment = assignmentsMap[cat.id];
    const status = catAssignment?.status;
    const isRunning = status === "running";
    const isPaused = status === "paused";
    const isCompleted = status === "completed";
    const hasLeftAccent = isRunning || isPaused || isCompleted;
    const matchesDone = catAssignment?.matches_completed || 0;
    const matchesTotal = cat.expected_matches || 0;
    const pct = matchesTotal > 0 ? (matchesDone / matchesTotal) * 100 : 0;
    const stagerStatus = catAssignment?.stager_status ?? null;
    const stagerActorName = catAssignment?.stager_name ?? null;

    const isCallingLoading = loadingAction === `${cat.id}-calling`;
    const isReadyLoading = loadingAction === `${cat.id}-ready`;

    if (hasLeftAccent) {
      return (
        <div
          key={cat.id}
          className={`border rounded-xl relative overflow-hidden transition-all bg-white ${
            isPaused
              ? "border-amber-400/80 shadow-xs"
              : isRunning
              ? "border-emerald-400/80 shadow-sm"
              : "border-blue-400/60 shadow-xs opacity-90"
          }`}
        >
          {/* Clean Distinct Top Bar for Category Card */}
          <div className="px-3 py-2 border-b border-[#E1DDCF]/60 flex items-center justify-between bg-[#ECE9DF]/60">
            <span className="text-[10px] font-bold tracking-wider uppercase text-[#68645A] truncate">
              {cat.age_bracket ||
                (cat.age_min != null && cat.age_max != null
                  ? `${cat.age_min}-${cat.age_max}`
                  : "")}{" "}
              | {cat.weight_class || cat.belt || "–"}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              {stagerStatus && (
                <StagerStatusIndicator stagerStatus={stagerStatus} stagerActorName={stagerActorName} />
              )}
              <span
                className={`px-2 py-0.5 rounded-full text-[9.5px] font-bold flex items-center gap-1.5 border ${
                  isPaused
                    ? "bg-amber-50 text-amber-800 border-amber-200"
                    : isRunning
                    ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                    : "bg-blue-50 text-blue-800 border-blue-200"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isPaused
                      ? "bg-amber-600"
                      : isRunning
                      ? "bg-emerald-600 animate-pulse"
                      : "bg-blue-600"
                  }`}
                />
                <span>{isPaused ? "PAUSED" : isRunning ? "LIVE" : "DONE"}</span>
              </span>
            </div>
          </div>

          {/* Card Body */}
          <div className="p-3">
            <div className="flex justify-between items-start gap-1.5 mb-1.5">
              <h5 className="text-xs font-bold text-[#1B1815] leading-snug line-clamp-1">{cat.name}</h5>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setBracketCategory({ id: cat.id, name: cat.name });
                  }}
                  title="View live draw"
                  aria-label={`View live draw for ${cat.name}`}
                  className="material-symbols-outlined text-[15px] text-[#0E9C7C] hover:text-[#0B7C63] transition-colors shrink-0 cursor-pointer"
                  style={{ fontVariationSettings: "'FILL' 0" }}
                >
                  account_tree
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAttendanceCategory({ id: cat.id, name: cat.name });
                  }}
                  title="Attendance (optional)"
                  aria-label={`Attendance for ${cat.name}`}
                  className="material-symbols-outlined text-[15px] text-[var(--ink-500)] hover:text-[var(--ink-900)] transition-colors shrink-0 cursor-pointer"
                  style={{ fontVariationSettings: "'FILL' 0" }}
                >
                  how_to_reg
                </button>
                {cat.doc_url && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setViewingPdf({ url: cat.doc_url!, title: cat.name });
                    }}
                    title="View athlete list PDF"
                    className="material-symbols-outlined text-[13px] text-outline hover:text-primary transition-colors shrink-0 cursor-pointer"
                    style={{ fontVariationSettings: "'FILL' 0" }}
                  >
                    article
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 text-[10px] font-data-mono text-[#68645A] mb-2">
              <span className="material-symbols-outlined text-[12px]">group</span>
              <span>{cat.athletes_count} athletes</span>
            </div>

            {/* Exact 10-Segment Hatched Diagonal Progress Bar */}
            <SegmentedProgressBar
              completed={matchesDone}
              total={matchesTotal || 1}
              status={status}
              compact
              showLabel
            />

            {/* Stager Action Buttons */}
            <div className="mt-2.5 pt-2.5 border-t border-[#E1DDCF]/60 flex gap-2">
              <button
                onClick={() => {
                  setConfirmModal({
                    categoryId: cat.id,
                    categoryName: cat.name,
                    requestedStatus: "calling",
                    isClearing: stagerStatus === "calling",
                  });
                }}
                disabled={!!loadingAction}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded text-[10px] font-bold transition-all border whitespace-nowrap select-none cursor-pointer ${
                  stagerStatus === "calling"
                    ? "bg-amber-500 text-white border-amber-500 shadow-sm"
                    : stagerStatus === "ready"
                ? "bg-white text-[#8C877C] border-[#E1DDCF] opacity-60 hover:opacity-80"
                : "bg-white text-[#68645A] border-[#E1DDCF] hover:border-amber-400 hover:text-amber-700 hover:bg-amber-50/60"
                } disabled:opacity-50`}
                title={stagerStatus === "calling" ? "Currently marked In Progress — tap to clear" : "Mark as In Progress"}
              >
                {isCallingLoading ? (
                  <span className="w-3 h-3 border-2 border-amber-600 border-t-transparent rounded-full animate-spin shrink-0" />
                ) : (
                  <span className="material-symbols-outlined text-[13px] shrink-0" style={{ fontVariationSettings: stagerStatus === "calling" ? "'FILL' 1" : "'FILL' 0" }}>notifications</span>
                )}
                <span className="whitespace-nowrap">{stagerStatus === "calling" ? "In Progress ✓" : "In Progress"}</span>
              </button>

              <button
                onClick={() => {
                  setConfirmModal({
                    categoryId: cat.id,
                    categoryName: cat.name,
                    requestedStatus: "ready",
                    isClearing: stagerStatus === "ready",
                  });
                }}
                disabled={!!loadingAction}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded text-[10px] font-bold transition-all border whitespace-nowrap select-none cursor-pointer ${
                  stagerStatus === "ready"
                    ? "bg-green-600 text-white border-green-600 shadow-sm"
                : stagerStatus === "calling"
                ? "bg-white text-[#8C877C] border-[#E1DDCF] opacity-60 hover:opacity-80"
                : "bg-white text-[#68645A] border-[#E1DDCF] hover:border-green-500 hover:text-green-700 hover:bg-green-50/60"
                } disabled:opacity-50`}
                title={stagerStatus === "ready" ? "Currently marked Called — tap to clear" : "Mark as Called"}
              >
                {isReadyLoading ? (
                  <span className="w-3 h-3 border-2 border-green-600 border-t-transparent rounded-full animate-spin shrink-0" />
                ) : (
                  <span className="material-symbols-outlined text-[13px] shrink-0" style={{ fontVariationSettings: stagerStatus === "ready" ? "'FILL' 1" : "'FILL' 0" }}>check_circle</span>
                )}
                <span className="whitespace-nowrap">{stagerStatus === "ready" ? "Called ✓" : "Called"}</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Pending / Queued Category Card
    return (
      <div
        key={cat.id}
        className="p-3 border rounded-xl relative overflow-hidden bg-white border-outline-variant hover:border-[#A19C90] transition-all shadow-xs"
      >
        <div className="flex justify-between items-center mb-1.5">
          <span className="text-[9.5px] font-bold uppercase tracking-wider text-[#68645A]">
            {cat.age_bracket ||
              (cat.age_min != null && cat.age_max != null
                ? `${cat.age_min}-${cat.age_max}`
                : "")}{" "}
            | {cat.weight_class || cat.belt || "–"}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setBracketCategory({ id: cat.id, name: cat.name });
              }}
              title="View live draw"
              aria-label={`View live draw for ${cat.name}`}
              className="material-symbols-outlined text-[15px] text-[#0E9C7C] hover:text-[#0B7C63] transition-colors shrink-0 cursor-pointer"
              style={{ fontVariationSettings: "'FILL' 0" }}
            >
              account_tree
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setAttendanceCategory({ id: cat.id, name: cat.name });
              }}
              title="Attendance (optional)"
              aria-label={`Attendance for ${cat.name}`}
              className="material-symbols-outlined text-[15px] text-[var(--ink-500)] hover:text-[var(--ink-900)] transition-colors shrink-0 cursor-pointer"
              style={{ fontVariationSettings: "'FILL' 0" }}
            >
              how_to_reg
            </button>
            {cat.doc_url && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setViewingPdf({ url: cat.doc_url!, title: cat.name });
                }}
                title="View athlete list PDF"
                className="material-symbols-outlined text-[13px] text-outline hover:text-primary transition-colors shrink-0 cursor-pointer"
                style={{ fontVariationSettings: "'FILL' 0" }}
              >
                article
              </button>
            )}
            {stagerStatus && (
              <StagerStatusIndicator stagerStatus={stagerStatus} stagerActorName={stagerActorName} />
            )}
            <span className="font-data-mono text-[9.5px] font-bold text-[#68645A] bg-[#ECE9DF] px-1.5 py-0.5 rounded">
              {Math.ceil((cat.expected_matches * 109) / 60)}m
            </span>
          </div>
        </div>

        <h5 className="text-xs font-bold text-[#1B1815] mb-1.5 leading-snug">{cat.name}</h5>

        <div className="flex justify-between items-center text-[10px] font-data-mono text-[#68645A] mb-2.5">
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-[12px]">group</span>
            {cat.athletes_count}
          </span>
          <span>{cat.expected_matches} matches</span>
        </div>

        {/* Stager Action Buttons */}
        <div className="pt-2 border-t border-[#E1DDCF]/60 flex gap-2">
          <button
            onClick={() => {
              setConfirmModal({
                categoryId: cat.id,
                categoryName: cat.name,
                requestedStatus: "calling",
                isClearing: stagerStatus === "calling",
              });
            }}
            disabled={!!loadingAction}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded text-[10px] font-bold transition-all border whitespace-nowrap select-none cursor-pointer ${
              stagerStatus === "calling"
                ? "bg-amber-500 text-white border-amber-500 shadow-sm"
                : stagerStatus === "ready"
                ? "bg-[#FAF9F5] text-[#8C877C] border-[#E1DDCF] opacity-60 hover:opacity-80"
                : "bg-[#FAF9F5] text-[#68645A] border-[#E1DDCF] hover:border-amber-400 hover:text-amber-700 hover:bg-amber-50/60"
            } disabled:opacity-50`}
            title={stagerStatus === "calling" ? "Currently marked In Progress — tap to clear" : "Mark as In Progress"}
          >
            {isCallingLoading ? (
              <span className="w-3 h-3 border-2 border-amber-600 border-t-transparent rounded-full animate-spin shrink-0" />
            ) : (
              <span className="material-symbols-outlined text-[13px] shrink-0" style={{ fontVariationSettings: stagerStatus === "calling" ? "'FILL' 1" : "'FILL' 0" }}>notifications</span>
            )}
            <span className="whitespace-nowrap">{stagerStatus === "calling" ? "In Progress ✓" : "In Progress"}</span>
          </button>

          <button
            onClick={() => {
              setConfirmModal({
                categoryId: cat.id,
                categoryName: cat.name,
                requestedStatus: "ready",
                isClearing: stagerStatus === "ready",
              });
            }}
            disabled={!!loadingAction}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded text-[10px] font-bold transition-all border whitespace-nowrap select-none cursor-pointer ${
              stagerStatus === "ready"
                ? "bg-green-600 text-white border-green-600 shadow-sm"
                : stagerStatus === "calling"
                ? "bg-[#FAF9F5] text-[#8C877C] border-[#E1DDCF] opacity-60 hover:opacity-80"
                : "bg-[#FAF9F5] text-[#68645A] border-[#E1DDCF] hover:border-green-500 hover:text-green-700 hover:bg-green-50/60"
            } disabled:opacity-50`}
            title={stagerStatus === "ready" ? "Currently marked Called — tap to clear" : "Mark as Called"}
          >
            {isReadyLoading ? (
              <span className="w-3 h-3 border-2 border-green-600 border-t-transparent rounded-full animate-spin shrink-0" />
            ) : (
              <span className="material-symbols-outlined text-[13px] shrink-0" style={{ fontVariationSettings: stagerStatus === "ready" ? "'FILL' 1" : "'FILL' 0" }}>check_circle</span>
            )}
            <span className="whitespace-nowrap">{stagerStatus === "ready" ? "Called ✓" : "Called"}</span>
          </button>
        </div>
      </div>
    );
  };

  // ── Main Render ────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen overflow-hidden w-full bg-surface">
      <BackNavigationGuard />
      {/* TopNavBar - Stager Side Header matching Admin/Org Style */}
      <header className="flex-shrink-0 bg-[#FAF9F5] border-b border-[#E1DDCF] sticky top-0 z-50">
        <div className="h-[60px] flex justify-between items-center w-full px-3.5 sm:px-6 gap-2 sm:gap-4">
          {/* ─── Left: Breadcrumb ─── */}
          <div className="flex items-center gap-1 sm:gap-2 text-[12.5px] sm:text-[13.5px] min-w-0">
            <span
              title={tournamentName}
              className="text-[#8C877C] font-medium truncate max-w-[55px] min-[360px]:max-w-[80px] min-[420px]:max-w-[130px] sm:max-w-[200px] md:max-w-[260px]"
            >
              {tournamentName}
            </span>
            <svg
              className="w-3.5 h-3.5 text-[#8C877C] shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M9 18l6-6-6-6" />
            </svg>
            <span className="text-[#1B1815] font-semibold truncate shrink-0">
              <span className="hidden min-[390px]:inline">Tatami </span>Board
            </span>
          </div>

          {/* ─── Center / Action: Draw sheets + Small Search Button ─── */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsDrawsOpen((open) => !open)}
              aria-expanded={isDrawsOpen}
              className={`flex items-center gap-1.5 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg text-[12px] sm:text-[12.5px] font-semibold border shadow-2xs transition-all cursor-pointer shrink-0 select-none ${
                isDrawsOpen
                  ? "bg-[#E3F6F0] border-[#0E9C7C] text-[#0B7C63]"
                  : "bg-[#ECE9DF] hover:bg-[#E2DFD4] border-[#E1DDCF] text-[#68645A] hover:text-[#1B1815]"
              }`}
              title="Draw sheets — read out who is called where"
            >
              <span className="material-symbols-outlined text-[16px]">account_tree</span>
              <span className="hidden min-[420px]:inline">Draw sheets</span>
            </button>

            {!isSearchOpen && (
              <button
                type="button"
                onClick={() => setIsSearchOpen(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-lg text-[12px] sm:text-[12.5px] font-semibold text-[#68645A] hover:text-[#1B1815] bg-[#ECE9DF] hover:bg-[#E2DFD4] border border-[#E1DDCF] shadow-2xs transition-all cursor-pointer shrink-0 select-none"
              title="Search athletes & categories"
            >
              <svg
                className="w-3.5 h-3.5 text-[#68645A] shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
                <span>Search</span>
              </button>
            )}
          </div>

          {/* ─── Right: Stager Role Pill + CruxStudios Badge ─── */}
          <div className="flex items-center gap-1.5 sm:gap-4 shrink-0 self-stretch">
            {/* Stager Identity Unified Pill */}
            <button
              type="button"
              onClick={() => setShowLogoutConfirm(true)}
              title={`${currentStagerName} (Stager) · Click to sign out`}
              className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1 rounded-full bg-[#ECE9DF] hover:bg-red-50 border border-[#E1DDCF] hover:border-red-200 shadow-2xs shrink-0 select-none cursor-pointer transition-colors group"
            >
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-600" />
              </span>
              <span className="text-[9px] sm:text-[10px] font-black tracking-wider uppercase text-[#68645A] group-hover:text-red-600 shrink-0 hidden min-[360px]:inline transition-colors">
                STAGER
              </span>
              <span className="h-3 w-[1px] bg-[#D5D0C0] group-hover:bg-red-200 shrink-0 hidden min-[360px]:inline transition-colors" />
              <span className="text-[11.5px] sm:text-[12px] font-bold text-[#1B1815] group-hover:text-red-700 capitalize truncate max-w-[50px] min-[360px]:max-w-[75px] sm:max-w-[150px] leading-none transition-colors">
                {currentStagerName}
              </span>
            </button>

            {/* CruxStudios Badge — matches admin/org style */}
            <BuiltByCrux imageHeightClass="h-[14px] sm:h-[17px]" className="ml-auto shrink-0" />
          </div>
        </div>

        {/* ─── Pop-down Search Box Below Navbar ─── */}
        {isSearchOpen && (
          <div className="border-t border-[#E1DDCF] bg-[#FAF9F5] px-3.5 sm:px-6 py-2 sm:py-2.5 flex items-center shadow-xs animate-in fade-in slide-in-from-top-1 duration-150 relative z-[100]">
            <div className="flex-1 max-w-xl mx-auto flex items-center gap-2">
              <HeaderSearchBar
                tournamentId={tournamentId}
                role="stager"
                autoFocus={true}
                className="w-full max-w-none"
              />
              <button
                type="button"
                onClick={() => setIsSearchOpen(false)}
                className="w-9 h-9 rounded-lg border border-[#E1DDCF] bg-white hover:bg-[#ECE9DF] text-[#68645A] hover:text-[#1B1815] flex items-center justify-center shrink-0 transition-colors shadow-2xs cursor-pointer"
                title="Close search"
                aria-label="Close search"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="w-4 h-4">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* ─── Pop-down Draw sheets: who to call, and where they sit in the draw ─── */}
        {isDrawsOpen && (
          <div className="border-t border-[#E1DDCF] bg-[#FAF9F5] shadow-xs animate-in fade-in slide-in-from-top-1 duration-150 relative z-[90]">
            <div className="px-3.5 sm:px-6 py-2.5 flex flex-wrap items-center gap-2 sm:gap-3 border-b border-[#E1DDCF]/70">
              <span className="material-symbols-outlined text-[18px] text-[#0E9C7C]">account_tree</span>
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-wider text-[#1B1815]">Draw sheets</p>
                <p className="text-[11px] text-[#68645A]">
                  {queuedDrawCategories.length} in the queue
                  {drawsScope === "all" ? ` of ${initialCategories.length} categories` : ""} · open a bracket to see who
                  is next
                </p>
              </div>

              {/* The queue is the job; the rest of the tournament is one tap away. */}
              <div className="flex items-center gap-1 rounded-lg border border-[#E1DDCF] bg-white p-0.5">
                <button
                  type="button"
                  onClick={() => setDrawsScope("queue")}
                  aria-pressed={drawsScope === "queue"}
                  className={`min-h-[30px] rounded-md px-2.5 text-[11px] font-bold transition-colors cursor-pointer ${
                    drawsScope === "queue" ? "bg-[#0E9C7C] text-white" : "text-[#68645A] hover:text-[#1B1815]"
                  }`}
                >
                  Queue
                </button>
                <button
                  type="button"
                  onClick={() => setDrawsScope("all")}
                  aria-pressed={drawsScope === "all"}
                  className={`min-h-[30px] rounded-md px-2.5 text-[11px] font-bold transition-colors cursor-pointer ${
                    drawsScope === "all" ? "bg-[#0E9C7C] text-white" : "text-[#68645A] hover:text-[#1B1815]"
                  }`}
                >
                  All
                </button>
              </div>

              <div className="relative flex-1 min-w-[180px] max-w-xs ml-auto">
                <span className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-[#8C877C]">
                  search
                </span>
                <input
                  type="text"
                  value={drawsQuery}
                  onChange={(e) => setDrawsQuery(e.target.value)}
                  placeholder="Find a category…"
                  aria-label="Find a category in the draw sheets"
                  className="w-full rounded-lg border border-[#E1DDCF] bg-white py-1.5 pl-8 pr-2 text-base text-[#1B1815] outline-none focus:border-[#0E9C7C] focus:ring-2 focus:ring-[#0E9C7C]/20 sm:text-sm"
                />
              </div>

              <button
                type="button"
                onClick={() => setIsDrawsOpen(false)}
                className="w-9 h-9 rounded-lg border border-[#E1DDCF] bg-white hover:bg-[#ECE9DF] text-[#68645A] hover:text-[#1B1815] flex items-center justify-center shrink-0 transition-colors shadow-2xs cursor-pointer"
                title="Close draw sheets"
                aria-label="Close draw sheets"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="w-4 h-4">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="max-h-[46vh] overflow-y-auto px-3.5 sm:px-6 py-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
                {initialCategories
                  .filter((cat) => {
                    if (drawsScope === "queue") {
                      const assignment = assignmentsMap[cat.id];
                      if (!assignment || assignment.status === "completed") return false;
                    }
                    const q = drawsQuery.trim().toLowerCase().replace(/[\s\u00A0]+/g, " ");
                    if (!q) return true;
                    const hay = [cat.name, cat.age_bracket, cat.weight_class, cat.belt, cat.sex, cat.day]
                      .filter(Boolean)
                      .join(" ")
                      .toLowerCase()
                      .replace(/[\s\u00A0]+/g, " ");
                    return hay.includes(q);
                  })
                  .map((cat) => {
                    const ringId = assignmentsMap[cat.id]?.ring_id;
                    const ring = initialRings.find((r) => r.id === ringId);
                    return (
                      <div
                        key={cat.id}
                        className="flex flex-col gap-2 rounded-xl border border-[#E1DDCF] bg-white p-3 shadow-xs"
                      >
                        <div className="min-w-0">
                          <h5 className="text-xs font-bold leading-snug text-[#1B1815] line-clamp-1" title={cat.name}>
                            {cat.name}
                          </h5>
                          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#8C877C]">
                            {ring ? ring.name.replace(/Ring/i, "Tatami") : "Not on a mat"} · {cat.athletes_count} athletes
                          </p>
                        </div>

                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setBracketCategory({ id: cat.id, name: cat.name })}
                            className="flex min-h-[36px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-[#0E9C7C] bg-[#E3F6F0] px-2 text-[11px] font-bold text-[#0B7C63] transition-colors hover:bg-[#d3f0e7] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E9C7C]"
                          >
                            <span className="material-symbols-outlined text-[15px]">account_tree</span>
                            Bracket
                          </button>
                          <button
                            type="button"
                            onClick={() => setAttendanceCategory({ id: cat.id, name: cat.name })}
                            className="flex min-h-[36px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--line)] bg-white px-2 text-[11px] font-bold text-[var(--ink-700)] transition-colors hover:bg-[var(--canvas)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                          >
                            <span className="material-symbols-outlined text-[15px]">how_to_reg</span>
                            Attendance
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Ring Grid */}
      <div className="flex-1 overflow-x-auto bg-surface-container-low flex p-3 sm:p-5 sm:pb-3 gap-3 sm:gap-5 items-start">
        {initialRings.map((ring) => {
          const activeQueue = ringQueues[ring.id] || [];
          const completedQueue = ringCompletedQueues[ring.id] || [];
          const isHistoryView = historyOpenForRing === ring.id;

          const runningCat = activeQueue.find((c) => {
            const assignment = initialAssignments.find((a) => a.category_id === c.id);
            return assignment?.status === "running";
          });
          const pausedCat = !runningCat
            ? activeQueue.find((c) => {
                const assignment = initialAssignments.find((a) => a.category_id === c.id);
                return assignment?.status === "paused";
              })
            : null;
          const isRingRunning = Boolean(runningCat);
          const isRingPaused = Boolean(pausedCat);
          const isRingCompleted = activeQueue.length === 0 && completedQueue.length > 0;
          const ringStatusText = isRingRunning
            ? "RUNNING"
            : isRingPaused
            ? "PAUSED"
            : isRingCompleted
            ? "COMPLETED"
            : "IDLE";
          const ringHeaderBg = isRingRunning
            ? "bg-[#1F5C3B] animate-band-pulse"
            : isRingPaused
            ? "bg-[#8E2E27]"
            : isRingCompleted
            ? "bg-[#1E3A8A]"
            : "bg-[#59564C]";

          const matNumberMatch = ring.name.match(/\d+/);
          const matNumber = matNumberMatch
            ? matNumberMatch[0].padStart(2, "0")
            : String(ring.ring_order || 1).padStart(2, "0");
          const formattedRingName = ring.name.replace(/Ring/i, "Tatami");

          if (isHistoryView) {
            const totalHistoryAthletes = completedQueue.reduce((sum, cat) => sum + cat.athletes_count, 0);
            return (
              <div
                key={ring.id}
                id={`ring-card-${ring.id}`}
                className="w-[85vw] max-w-[360px] sm:w-80 lg:w-[330px] xl:w-[350px] 2xl:w-[380px] shrink-0 flex flex-col bg-white border border-outline-variant rounded-xl overflow-hidden shadow-sm h-full transition-all duration-300"
              >
                {/* Scoreboard History Header */}
                <div className="sticky top-0 z-10 px-4 h-[60px] flex items-center justify-between shrink-0 relative transition-all text-white bg-[#1E293B] overflow-visible">
                  {/* Left: Scoreboard Mat Number & Label */}
                  <div className="flex items-center gap-2.5 relative z-10 min-w-0">
                    <span className="font-scoreboard text-[32px] sm:text-[34px] font-normal leading-none tracking-wide text-white shrink-0">
                      {matNumber}
                    </span>
                    <div className="min-w-0 flex flex-col justify-center">
                      <h4 className="font-bold text-[14px] sm:text-[15px] tracking-tight leading-tight text-white truncate">
                        {formattedRingName}
                      </h4>
                      <span className="text-[9.5px] font-bold tracking-wider uppercase leading-none mt-0.5 text-amber-300">
                        HISTORY ARCHIVE
                      </span>
                    </div>
                  </div>

                  {/* Right: Back to Queue Button */}
                  <div className="flex items-center gap-2 relative z-10 shrink-0">
                    <button
                      type="button"
                      className="flex items-center gap-1.5 text-[10.5px] font-bold tracking-wider uppercase text-white bg-white/15 hover:bg-white/25 px-2.5 py-1.5 rounded-lg transition-all cursor-pointer border border-white/10 shadow-xs"
                      onClick={() => setHistoryOpenForRing(null)}
                      title="Back to Current Queue"
                    >
                      <span className="material-symbols-outlined text-[15px]">arrow_back</span>
                      <span>QUEUE</span>
                    </button>
                  </div>

                  {/* Ticket Perforation Notches - centered exactly at bottom seam */}
                  <div className="spectator-notch left -bottom-[7px]" />
                  <div className="spectator-notch right -bottom-[7px]" />
                </div>

                {/* History Stats Summary Bar (matches EST TIME / ATHLETES height & seam) */}
                <div className="p-3 border-b border-outline-variant flex items-center justify-around bg-slate-50">
                  <div className="flex flex-col items-center">
                    <span className="text-[9px] font-label-caps font-bold text-on-surface-variant">COMPLETED</span>
                    <span className="font-data-mono text-lg font-black text-slate-800">
                      {completedQueue.length}
                    </span>
                  </div>
                  <div className="h-6 w-[1px] bg-outline-variant/50"></div>
                  <div className="flex flex-col items-center">
                    <span className="text-[9px] font-label-caps font-bold text-on-surface-variant">ATHLETES</span>
                    <span className="flex items-center gap-1 font-data-mono text-lg font-black text-slate-800">
                      <span className="material-symbols-outlined text-[15px]">group</span> {totalHistoryAthletes}
                    </span>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {completedQueue.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-outline opacity-70">
                      <span className="material-symbols-outlined text-4xl mb-2">inbox</span>
                      <span className="text-sm">No completed categories</span>
                    </div>
                  ) : (
                    completedQueue.map((cat) => {
                      const assignment = initialAssignments.find((a) => a.category_id === cat.id);
                      const rawTime =
                        completedTimes[cat.id] ||
                        (assignment as any)?.completed_at ||
                        (assignment as any)?.created_at;
                      const timeStr = rawTime
                        ? new Date(rawTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                        : "Completed";
                      return (
                        <div
                          key={cat.id}
                          className="p-3 bg-white border border-outline-variant rounded-lg flex flex-col gap-1 shadow-sm relative overflow-hidden"
                        >
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] font-bold text-secondary uppercase tracking-wider">
                              {cat.age_bracket ||
                                (cat.age_min != null && cat.age_max != null
                                  ? `${cat.age_min}-${cat.age_max}`
                                  : "")}{" "}
                              | {cat.weight_class || cat.belt || "-"}
                            </span>
                            <span
                              suppressHydrationWarning
                              className="text-[10px] font-bold text-green-600 bg-green-500/10 px-1.5 py-0.5 rounded flex items-center gap-1"
                            >
                              <span className="material-symbols-outlined text-[12px]">done_all</span>
                              {timeStr}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <h5 className="text-xs font-bold text-primary flex items-center gap-1">
                              {cat.name}
                              {cat.doc_url && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setViewingPdf({ url: cat.doc_url!, title: cat.name });
                                  }}
                                  title="View athlete list PDF"
                                  className="material-symbols-outlined text-[13px] text-outline hover:text-primary transition-colors shrink-0 cursor-pointer"
                                  style={{ fontVariationSettings: "'FILL' 0" }}
                                >
                                  article
                                </button>
                              )}
                            </h5>
                          </div>
                          <div className="flex gap-4 text-[10px] font-data-mono text-outline">
                            <span className="flex items-center gap-1">
                              <span className="material-symbols-outlined text-[12px]">group</span>
                              {cat.athletes_count}
                            </span>
                            <span>{cat.expected_matches} Matches</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          }

          return (
            <div
              key={ring.id}
              id={`ring-card-${ring.id}`}
              className="w-[85vw] max-w-[360px] sm:w-80 lg:w-[330px] xl:w-[350px] 2xl:w-[380px] shrink-0 flex flex-col bg-white border border-outline-variant rounded-xl overflow-hidden shadow-sm h-full transition-all duration-300"
            >
              {/* Ring Header - Spectator Scoreboard Style */}
              <div className={`px-4 h-[60px] flex items-center justify-between shrink-0 relative transition-all text-white overflow-visible ${ringHeaderBg}`}>
                {/* Left: Mat Number & 2-Line Label */}
                <div className="flex items-center gap-2.5 relative z-10 min-w-0">
                  <span className="font-scoreboard text-[32px] sm:text-[34px] font-normal leading-none tracking-wide text-white shrink-0">
                    {matNumber}
                  </span>
                  <div className="min-w-0 flex flex-col justify-center">
                    <h4 className="font-bold text-[14px] sm:text-[15px] tracking-tight leading-tight text-white truncate">
                      {formattedRingName}
                    </h4>
                    <span className={`text-[9.5px] font-bold tracking-wider uppercase leading-none mt-0.5 ${
                      isRingRunning 
                        ? 'text-emerald-200/90' 
                        : isRingPaused 
                        ? 'text-rose-200/80' 
                        : 'text-white/70'
                    }`}>
                      {activeQueue.length} QUEUED · {completedQueue.length} DONE
                    </span>
                  </div>
                </div>

                {/* Right: Dot Status Capsule Pill + History Button */}
                <div className="flex items-center gap-2 relative z-10 shrink-0">
                  <span className="flex items-center gap-1.5 text-[10px] sm:text-[10.5px] font-bold tracking-wider uppercase text-white bg-black/25 px-2.5 py-1 rounded-full border border-white/10 shadow-xs">
                    <span className="relative flex h-2 w-2 shrink-0">
                      {isRingRunning && (
                        <span className="animate-pulse-ring absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-80" />
                      )}
                      <span
                        className={`relative inline-flex rounded-full h-2 w-2 ${
                          isRingRunning
                            ? "bg-emerald-400"
                            : isRingPaused
                            ? "bg-rose-400"
                            : isRingCompleted
                            ? "bg-blue-400"
                            : "bg-stone-300"
                        }`}
                      />
                    </span>
                    <span>{ringStatusText}</span>
                  </span>

                  <button
                    type="button"
                    className="w-8 h-8 rounded-lg bg-black/25 hover:bg-white/20 text-white border border-white/10 flex items-center justify-center transition-all cursor-pointer shadow-xs"
                    onClick={() => setHistoryOpenForRing(ring.id)}
                    title="View Completed Categories"
                  >
                    <span className="material-symbols-outlined text-[17px]">history</span>
                  </button>
                </div>

                {/* Ticket Perforation Notches - centered exactly at bottom seam */}
                <div className="spectator-notch left -bottom-[7px]" />
                <div className="spectator-notch right -bottom-[7px]" />
              </div>

              {/* Active Queue */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {activeQueue.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-32 text-outline opacity-50">
                    <span className="material-symbols-outlined text-3xl mb-1">inbox</span>
                    <span className="text-xs">No active categories</span>
                  </div>
                )}

                {activeQueue.map((cat) => renderCategoryCard(cat, ring.id))}
              </div>
            </div>
          );
        })}

        {initialRings.length === 0 && (
          <div className="flex-1 flex items-center justify-center text-on-surface-variant opacity-50">
            <div className="text-center">
              <span className="material-symbols-outlined text-5xl mb-3 block">view_column</span>
              <p className="text-sm">No tatamis configured for this tournament.</p>
            </div>
          </div>
        )}
      </div>

      {/* Minimal Confirmation Modal */}
      {confirmModal && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setConfirmModal(null)}
        >
          <div
            className="bg-[#FAF9F5] border border-outline-variant/80 rounded-2xl p-5 w-full max-w-[320px] shadow-2xl space-y-3.5 animate-in zoom-in-95 duration-150 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Minimal Icon */}
            <div
              className={`w-11 h-11 rounded-full flex items-center justify-center mx-auto ${confirmModal.isClearing
                  ? "bg-surface-container-high text-on-surface-variant"
                  : confirmModal.requestedStatus === "calling"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-green-100 text-green-700"
                }`}
            >
              <span className="material-symbols-outlined text-2xl">
                {confirmModal.isClearing
                  ? "restart_alt"
                  : confirmModal.requestedStatus === "calling"
                    ? "notifications_active"
                    : "check_circle"}
              </span>
            </div>

            {/* Title & Body */}
            <div>
              <h3 className="font-headline-sm text-base text-primary font-bold">
                {confirmModal.isClearing
                  ? `Clear ${confirmModal.requestedStatus === "calling" ? "In Progress" : "Called"}?`
                  : `Mark as ${confirmModal.requestedStatus === "calling" ? "In Progress" : "Called"}?`}
              </h3>
              <p className="text-xs text-on-surface-variant mt-1.5 leading-relaxed">
                {confirmModal.isClearing ? (
                  <>
                    Are you sure you want to clear this status for{" "}
                    <span className="font-semibold text-primary">{confirmModal.categoryName}</span>?
                  </>
                ) : confirmModal.requestedStatus === "calling" ? (
                  <>
                    Are you sure you want to alert the team that{" "}
                    <span className="font-semibold text-primary">{confirmModal.categoryName}</span> is{" "}
                    <span className="text-amber-700 font-bold">In Progress</span>?
                  </>
                ) : (
                  <>
                    Are you sure you want to alert the team that{" "}
                    <span className="font-semibold text-primary">{confirmModal.categoryName}</span> is{" "}
                    <span className="text-green-700 font-bold">Called &amp; Ready</span>?
                  </>
                )}
              </p>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="flex-1 py-2 px-3 rounded-xl border border-outline-variant text-xs font-bold text-on-surface hover:bg-surface-container transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const { categoryId, requestedStatus } = confirmModal;
                  setConfirmModal(null);
                  handleStagerAction(categoryId, requestedStatus);
                }}
                className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold text-white shadow-sm transition-colors cursor-pointer ${confirmModal.isClearing
                    ? "bg-neutral-800 hover:bg-neutral-900"
                    : confirmModal.requestedStatus === "calling"
                      ? "bg-amber-600 hover:bg-amber-700"
                      : "bg-green-600 hover:bg-green-700"
                  }`}
              >
                Yes, Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 80% Floating PDF Viewer Modal with blurred background */}
      <PdfViewerModal
        url={viewingPdf?.url || null}
        title={viewingPdf?.title}
        onClose={closePdfViewer}
      />

      {/* Interactive bracket for a category: who is fighting, and who is next */}
      {bracketCategory && (
        <DrawBracketModal
          categoryId={bracketCategory.id}
          categoryName={bracketCategory.name}
          isOpen={Boolean(bracketCategory)}
          onClose={() => setBracketCategory(null)}
        />
      )}

      {/* Optional call-area attendance for a category */}
      {attendanceCategory && (
        <AttendanceModal
          categoryId={attendanceCategory.id}
          categoryName={attendanceCategory.name}
          tournamentId={tournamentId}
          onClose={() => setAttendanceCategory(null)}
        />
      )}

      <LogoutConfirmModal
        isOpen={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        onConfirm={async () => {
          setIsLoggingOut(true);
          try {
            await logoutStager().catch(() => {});
            router.push("/login/stager");
          } catch (e) {
            router.push("/login/stager");
          }
        }}
        isLoggingOut={isLoggingOut}
        title="Sign Out of Stager Board"
        message="Are you sure you want to sign out? You will need your stager access code and director approval to regain access."
        confirmLabel="Sign Out"
      />
    </div>
  );
}
