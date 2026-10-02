"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { saveAssignments, getBalancingAssignments } from "@/actions/balancing";
import { useLiveEvents } from "@/hooks/useLiveEvents";
import { DrawBracketModal } from "@/components/draw/DrawBracketModal";
import StagerStatusIndicator from "@/components/ui/StagerStatusIndicator";
import { PdfViewerModal } from "@/components/ui/PdfViewerModal";
import { SegmentedProgressBar } from "@/components/ui/SegmentedProgressBar";
import HeaderSearchBar from "@/components/layout/HeaderSearchBar";
import BuiltByCrux from "@/components/layout/BuiltByCrux";
import { matchesCategorySearch } from "@/lib/searchUtils";

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
  created_at?: string;
  completed_at?: string | null;
  stager_status?: string | null;
  stager_name?: string | null;
};

interface Props {
  tournamentId: string;
  tournamentName: string;
  initialCategories: Category[];
  initialRings: Ring[];
  initialAssignments: Assignment[];
  completedTimes: Record<string, string>;
  readOnly?: boolean;
}

export default function RingBalancingClient({
  tournamentId,
  tournamentName,
  initialCategories,
  initialRings,
  initialAssignments,
  completedTimes,
  readOnly = false,
}: Props) {
  const router = useRouter();
  // State structure:
  // We need a list for "unassigned" and a list for each ring.
  const [unassigned, setUnassigned] = useState<Category[]>([]);
  const [ringQueues, setRingQueues] = useState<Record<string, Category[]>>({});
  const [ringCompletedQueues, setRingCompletedQueues] = useState<Record<string, Category[]>>({});
  // Save & Auto-save state
  const [isSaving, setIsSaving] = useState(false);
  const [autoSave, setAutoSave] = useState(true);
  const [saveStatusText, setSaveStatusText] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Drag confirmation state
  const [pendingDragResult, setPendingDragResult] = useState<DropResult | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [viewingPdf, setViewingPdf] = useState<{ url: string; title: string } | null>(null);
  // Which category's live draw is open on top of the board.
  const [bracketCategory, setBracketCategory] = useState<{ id: string; name: string } | null>(null);

  /**
   * One small draw button, used on every card in this screen (idle pool, queue
   * rail, ring queue, history). It opens the live bracket — current scores,
   * winners and repechage — not a static sheet.
   */
  const renderDrawButton = (cat: Category, size: "xs" | "sm" = "xs") => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setBracketCategory({ id: cat.id, name: cat.name });
      }}
      title="View live draw"
      aria-label={`View live draw for ${cat.name}`}
      className={`material-symbols-outlined text-outline hover:text-[#0E9C7C] transition-colors shrink-0 cursor-pointer ${
        size === "xs" ? "text-[13px]" : "text-[15px]"
      }`}
      style={{ fontVariationSettings: "'FILL' 0" }}
    >
      account_tree
    </button>
  );

  // History popover state
  const [historyOpenForRing, setHistoryOpenForRing] = useState<string | null>(null);

  // Revert category confirmation state
  const [pendingRevertCategory, setPendingRevertCategory] = useState<{ ringId: string; ringName: string; category: Category } | null>(null);

  // Filter & Sort State with reload persistence
  const [search, setSearch] = useState("");
  const [beltFilter, setBeltFilter] = useState("");
  const [ageFilter, setAgeFilter] = useState("");
  const [sexFilter, setSexFilter] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "athletes" | "weight">("athletes");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [statusFilter, setStatusFilter] = useState<"idle" | "queue" | "completed">("idle");
  const [mobileShowPool, setMobileShowPool] = useState(false);
  const [isOrgPoolExpanded, setIsOrgPoolExpanded] = useState(false);
  const [isBalanceFilterLoaded, setIsBalanceFilterLoaded] = useState(false);

  // Restore filter & sort state across reloads
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = sessionStorage.getItem(`ringflow_balance_filters_${tournamentId}`);
      if (saved) {
        const p = JSON.parse(saved);
        if (p.search !== undefined) setSearch(p.search);
        if (p.beltFilter !== undefined) setBeltFilter(p.beltFilter);
        if (p.ageFilter !== undefined) setAgeFilter(p.ageFilter);
        if (p.sexFilter !== undefined) setSexFilter(p.sexFilter);
        if (p.sortBy !== undefined) setSortBy(p.sortBy);
        if (p.sortOrder !== undefined) setSortOrder(p.sortOrder);
        if (p.statusFilter !== undefined) setStatusFilter(p.statusFilter);
      }
    } catch (e) {
      console.error("Failed to restore balance filters", e);
    }
    setIsBalanceFilterLoaded(true);
  }, [tournamentId]);

  // Persist filter changes across reloads
  useEffect(() => {
    if (!isBalanceFilterLoaded || typeof window === "undefined") return;
    try {
      const filters = { search, beltFilter, ageFilter, sexFilter, sortBy, sortOrder, statusFilter };
      sessionStorage.setItem(`ringflow_balance_filters_${tournamentId}`, JSON.stringify(filters));
    } catch (e) {
      console.error("Failed to persist balance filters", e);
    }
  }, [search, beltFilter, ageFilter, sexFilter, sortBy, sortOrder, statusFilter, isBalanceFilterLoaded, tournamentId]);

  // Close desktop organiser pool dropdown on Escape
  useEffect(() => {
    if (!isOrgPoolExpanded) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOrgPoolExpanded(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOrgPoolExpanded]);

  // Toggle pool with mobile back button / history integration
  const togglePool = useCallback(() => {
    setMobileShowPool((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        if (next) {
          window.history.pushState({ poolOpen: true }, "");
        } else if (window.history.state?.poolOpen) {
          window.history.back();
          return prev;
        }
      }
      return next;
    });
  }, []);

  // Shrink unassigned pool when mobile back button is pressed
  useEffect(() => {
    const handlePopState = () => {
      setMobileShowPool(false);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Realtime assignments map for live match count, status, queue_order and stager status tracking
  const [assignmentsMap, setAssignmentsMap] = useState<Record<string, { matches_completed: number; status: string; ring_id: string; queue_order: number; stager_status: string | null; stager_name: string | null }>>({});

  useEffect(() => {
    const map: Record<string, { matches_completed: number; status: string; ring_id: string; queue_order: number; stager_status: string | null; stager_name: string | null }> = {};
    initialAssignments.forEach(a => {
      map[a.category_id] = {
        matches_completed: (a as any).matches_completed || 0,
        status: a.status || "pending",
        ring_id: a.ring_id,
        queue_order: a.queue_order ?? 0,
        stager_status: (a as any).stager_status ?? null,
        stager_name: (a as any).stager_name ?? null,
      };
    });
    setAssignmentsMap(map);
  }, [initialAssignments]);

  // Live progress for the whole board: match counts, statuses and stager
  // hand-offs land the moment they happen, without disturbing a drag in flight.
  const refreshAssignments = useCallback(async () => {
    const ringIds = initialRings.map((r) => r.id);
    if (ringIds.length === 0) return;
    try {
      const data = await getBalancingAssignments(ringIds);
      const map: Record<string, { matches_completed: number; status: string; ring_id: string; queue_order: number; stager_status: string | null; stager_name: string | null }> = {};
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
      console.error("[balancing] live refresh failed:", err);
    }
  }, [initialRings]);

  useLiveEvents({ tournamentId }, refreshAssignments, { feed: "staff" });

  useEffect(() => {
    const poll = setInterval(refreshAssignments, 15000);
    return () => clearInterval(poll);
  }, [refreshAssignments]);

  // Initialize state from props (once on mount)
  useEffect(() => {
    if (isInitialized) return;
    setIsInitialized(true);
    setIsMounted(true);
    setLastSaved(new Date());

    const ringMap: Record<string, Category[]> = {};
    const ringMapHistory: Record<string, Category[]> = {};
    initialRings.forEach(r => {
      ringMap[r.id] = [];
      ringMapHistory[r.id] = [];
    });

    const unassignedList: Category[] = [];

    initialCategories.forEach(cat => {
      const assignment = initialAssignments.find(a => a.category_id === cat.id);
      if (assignment && ringMap[assignment.ring_id]) {
        if (assignment.status === "completed") {
          ringMapHistory[assignment.ring_id].push(cat);
        } else {
          ringMap[assignment.ring_id].push(cat);
        }
      } else {
        unassignedList.push(cat);
      }
    });

    // Sort ring queues by original queue_order
    Object.keys(ringMap).forEach(ringId => {
      ringMap[ringId].sort((a, b) => {
        const orderA = initialAssignments.find(as => as.category_id === a.id)?.queue_order || 0;
        const orderB = initialAssignments.find(as => as.category_id === b.id)?.queue_order || 0;
        return orderA - orderB;
      });
    });

    setUnassigned(unassignedList);
    setRingQueues(ringMap);
    setRingCompletedQueues(ringMapHistory);
  }, [initialCategories, initialRings, initialAssignments, isInitialized]);

  const executeDrag = (result: DropResult) => {
    if (readOnly) return;
    const { source, destination, draggableId } = result;
    if (!destination) return;

    const sourceDroppableId = source.droppableId.startsWith("header_")
      ? source.droppableId.replace("header_", "")
      : source.droppableId;

    const destDroppableId = destination.droppableId.startsWith("header_")
      ? destination.droppableId.replace("header_", "")
      : destination.droppableId;

    if (sourceDroppableId === destDroppableId && source.index === destination.index && !destination.droppableId.startsWith("header_")) return;

    // 1. Create shallow copies of active queues
    let nextUnassigned = [...unassigned];
    const nextRingQueues: Record<string, Category[]> = {};
    Object.keys(ringQueues).forEach(key => {
      nextRingQueues[key] = [...ringQueues[key]];
    });

    // 2. Find and extract the category from wherever it currently resides
    let movedItem: Category | undefined = nextUnassigned.find(c => c.id === draggableId);
    if (!movedItem) {
      for (const rId of Object.keys(nextRingQueues)) {
        const found = nextRingQueues[rId].find(c => c.id === draggableId);
        if (found) {
          movedItem = found;
          break;
        }
      }
    }
    if (!movedItem) {
      movedItem = initialCategories.find(c => c.id === draggableId);
    }

    if (!movedItem) return;

    // Purge moved category completely from all queues to guarantee zero duplicates
    nextUnassigned = nextUnassigned.filter(c => c.id !== draggableId);
    Object.keys(nextRingQueues).forEach(key => {
      nextRingQueues[key] = nextRingQueues[key].filter(c => c.id !== draggableId);
    });

    // Frontend Safety Guard: Check if destination or source displacement interrupts an active running/paused category
    const prevUnassigned = [...unassigned];
    const prevRingQueues = { ...ringQueues };

    if (destDroppableId !== "unassigned") {
      const targetQueue = ringQueues[destDroppableId] || [];
      const topCat = targetQueue[0];
      const topStatus = topCat ? assignmentsMap[topCat.id]?.status : null;

      if (topCat && (topStatus === "running" || topStatus === "paused")) {
        // If moving item to position 0 (above running category)
        const isHeaderDrop = destination.droppableId.startsWith("header_");
        if (!isHeaderDrop && destination.index === 0 && movedItem.id !== topCat.id) {
          alert(`Cannot place above "${topCat.name}": it is currently live/running on this Tatami!`);
          return;
        }
      }
    }

    // Also check if trying to drag away or displace a running category itself from index 0
    if (sourceDroppableId !== "unassigned") {
      const sourceQueue = ringQueues[sourceDroppableId] || [];
      const sourceTop = sourceQueue[0];
      const sourceTopStatus = sourceTop ? assignmentsMap[sourceTop.id]?.status : null;
      if (sourceTop && (sourceTopStatus === "running" || sourceTopStatus === "paused")) {
        if (movedItem.id === sourceTop.id && destDroppableId !== sourceDroppableId) {
          alert(`Cannot move "${sourceTop.name}": it is currently live/running on Tatami!`);
          return;
        }
      }
    }

    // 3. Insert category into destination position
    if (destDroppableId === "unassigned") {
      const visibleAtDest = nextUnassigned
        .filter(cat => {
          if (search && !matchesCategorySearch(cat, search)) return false;
          if (beltFilter && cat.belt !== beltFilter) return false;
          if (ageFilter && cat.age_bracket !== ageFilter) return false;
          if (sexFilter && cat.sex !== sexFilter) return false;
          return true;
        });
      const anchorItem = visibleAtDest[destination.index];
      if (anchorItem) {
        const anchorIndex = nextUnassigned.findIndex(c => c.id === anchorItem.id);
        nextUnassigned.splice(anchorIndex >= 0 ? anchorIndex : nextUnassigned.length, 0, movedItem);
      } else {
        nextUnassigned.push(movedItem);
      }
    } else {
      const destQueue = nextRingQueues[destDroppableId] || [];
      // Dropping on header automatically appends category to bottom of queue!
      const insertIndex = destination.droppableId.startsWith("header_")
        ? destQueue.length
        : Math.min(destination.index, destQueue.length);

      destQueue.splice(insertIndex, 0, movedItem);
      nextRingQueues[destDroppableId] = destQueue;
    }

    // Deduplicate queues to safeguard against any stray duplicate keys
    const seenCatIds = new Set<string>();
    nextUnassigned = nextUnassigned.filter(c => {
      if (seenCatIds.has(c.id)) return false;
      seenCatIds.add(c.id);
      return true;
    });
    Object.keys(nextRingQueues).forEach(key => {
      nextRingQueues[key] = nextRingQueues[key].filter(c => {
        if (seenCatIds.has(c.id)) return false;
        seenCatIds.add(c.id);
        return true;
      });
    });

    // 4. Update state atomically
    setUnassigned(nextUnassigned);
    setRingQueues(nextRingQueues);

    setAssignmentsMap(prev => {
      const nextMap = { ...prev };
      Object.keys(nextRingQueues).forEach(rId => {
        nextRingQueues[rId].forEach((cat, idx) => {
          nextMap[cat.id] = {
            ...nextMap[cat.id],
            ring_id: rId,
            queue_order: idx,
            status: nextMap[cat.id]?.status || "pending",
            matches_completed: nextMap[cat.id]?.matches_completed || 0,
            stager_status: nextMap[cat.id]?.stager_status ?? null,
            stager_name: nextMap[cat.id]?.stager_name ?? null,
          };
        });
      });
      return nextMap;
    });

    // 5. Trigger auto-save if enabled, passing previous state for rollback
    triggerAutoSaveIfNeeded(nextUnassigned, nextRingQueues, prevUnassigned, prevRingQueues);
  };

  const onDragEnd = (result: DropResult) => {
    const { source, destination } = result;
    if (!destination) return;

    const sourceDroppableId = source.droppableId.startsWith("header_")
      ? source.droppableId.replace("header_", "")
      : source.droppableId;

    const destDroppableId = destination.droppableId.startsWith("header_")
      ? destination.droppableId.replace("header_", "")
      : destination.droppableId;

    // Check if moving from one ring to another ring, or from a ring to unassigned
    if (sourceDroppableId !== "unassigned" && sourceDroppableId !== destDroppableId) {
      setPendingDragResult(result);
      setConfirmText("");
      return;
    }

    executeDrag(result);
  };

  const calculateRingMatchStats = (ringId: string) => {
    const activeCats = ringQueues[ringId] || [];
    const completedCats = ringCompletedQueues[ringId] || [];
    const allCats = [...activeCats, ...completedCats];

    let totalExpected = 0;
    let totalCompleted = 0;

    allCats.forEach(cat => {
      totalExpected += (cat.expected_matches || 0);
      const assignment = assignmentsMap[cat.id];
      if (assignment?.status === 'completed') {
        totalCompleted += (cat.expected_matches || 0);
      } else if (assignment) {
        totalCompleted += Math.min(cat.expected_matches || 0, assignment.matches_completed || 0);
      }
    });

    const percentage = totalExpected > 0 ? (totalCompleted / totalExpected) * 100 : 0;

    return { totalCompleted, totalExpected, percentage };
  };

  const handleSave = async () => {
    setIsSaving(true);
    const payloadMap = new Map<string, { category_id: string; ring_id: string | null; queue_order: number; status?: string; completed_at?: string | null }>();

    // Process unassigned
    unassigned.forEach((cat, idx) => {
      payloadMap.set(cat.id, { category_id: cat.id, ring_id: null, queue_order: idx });
    });

    // Process rings - active ring assignments take precedence
    Object.keys(ringQueues).forEach(ringId => {
      ringQueues[ringId].forEach((cat, idx) => {
        const liveStatus = assignmentsMap[cat.id]?.status;
        const effectiveStatus = (liveStatus === "running" || liveStatus === "paused") ? liveStatus : "pending";
        payloadMap.set(cat.id, {
          category_id: cat.id,
          ring_id: ringId,
          queue_order: idx,
          status: effectiveStatus,
          completed_at: null,
        });
      });
    });

    // Process completed categories (keep them assigned and completed if not currently in active queue)
    Object.keys(ringCompletedQueues).forEach(ringId => {
      ringCompletedQueues[ringId].forEach((cat, idx) => {
        if (!ringQueues[ringId]?.some(c => c.id === cat.id)) {
          const originalAssignment = initialAssignments.find(a => a.category_id === cat.id);
          payloadMap.set(cat.id, {
            category_id: cat.id,
            ring_id: ringId,
            queue_order: (ringQueues[ringId]?.length || 0) + idx,
            status: "completed",
            completed_at: originalAssignment?.completed_at || new Date().toISOString()
          });
        }
      });
    });

    const payload = Array.from(payloadMap.values());

    try {
      const res = await saveAssignments(tournamentId, payload);
      if (!res.success) {
        const msg = res.error || "";
        if (msg.startsWith("RUNNING_CATEGORY_DISPLACED:")) {
          const catId = msg.replace("RUNNING_CATEGORY_DISPLACED:", "");
          const catName = initialCategories.find(c => c.id === catId)?.name || "A category";
          alert(`Cannot save: "${catName}" is currently running on a Tatami.\n\nA running category must stay at the top of its queue. Move it to the first position or wait for the moderator to finish it before saving.`);
        } else {
          alert(`Failed to save assignments: ${msg || "Please try again."}`);
          console.error("Save error:", msg);
        }
        return;
      }
      setLastSaved(new Date());
      setSaveStatusText("Saved!");
      setTimeout(() => setSaveStatusText(null), 2500);
    } catch (err: any) {
      alert(`Failed to save assignments: ${err?.message || "Please try again."}`);
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  const triggerAutoSaveIfNeeded = (
    updatedUnassigned?: Category[],
    updatedRingQueues?: Record<string, Category[]>,
    prevUnassigned?: Category[],
    prevRingQueues?: Record<string, Category[]>,
    updatedCompletedQueues?: Record<string, Category[]>,
    prevCompletedQueues?: Record<string, Category[]>,
    updatedAssignmentsMap?: Record<string, { matches_completed: number; status: string; ring_id: string; queue_order: number; stager_status: string | null; stager_name: string | null }>,
    prevAssignmentsMap?: Record<string, { matches_completed: number; status: string; ring_id: string; queue_order: number; stager_status: string | null; stager_name: string | null }>
  ) => {
    if (!autoSave) return;

    // Perform save with latest state snapshot
    const targetUnassigned = updatedUnassigned || unassigned;
    const targetRingQueues = updatedRingQueues || ringQueues;
    const targetCompletedQueues = updatedCompletedQueues || ringCompletedQueues;
    const targetAssignmentsMap = updatedAssignmentsMap || assignmentsMap;

    setIsSaving(true);
    setSaveStatusText("Auto-saving...");
    const payloadMap = new Map<string, { category_id: string; ring_id: string | null; queue_order: number; status?: string; completed_at?: string | null }>();

    // Process unassigned
    targetUnassigned.forEach((cat, idx) => {
      payloadMap.set(cat.id, { category_id: cat.id, ring_id: null, queue_order: idx });
    });

    // Process rings
    Object.keys(targetRingQueues).forEach(ringId => {
      targetRingQueues[ringId].forEach((cat, idx) => {
        const liveInfo = targetAssignmentsMap[cat.id];
        const rawStatus = liveInfo?.status;
        const effectiveStatus = (rawStatus === "running" || rawStatus === "paused") ? rawStatus : "pending";
        payloadMap.set(cat.id, {
          category_id: cat.id,
          ring_id: ringId,
          queue_order: idx,
          status: effectiveStatus,
          completed_at: null,
        });
      });
    });

    // Process completed categories
    Object.keys(targetCompletedQueues).forEach(ringId => {
      targetCompletedQueues[ringId].forEach((cat, idx) => {
        if (!targetRingQueues[ringId]?.some(c => c.id === cat.id)) {
          const originalAssignment = initialAssignments.find(a => a.category_id === cat.id);
          payloadMap.set(cat.id, {
            category_id: cat.id,
            ring_id: ringId,
            queue_order: (targetRingQueues[ringId]?.length || 0) + idx,
            status: "completed",
            completed_at: originalAssignment?.completed_at || new Date().toISOString()
          });
        }
      });
    });

    const payload = Array.from(payloadMap.values());

    const handleAutoSaveError = (msg: string) => {
      // Rollback UI state if save failed
      if (prevUnassigned && prevRingQueues) {
        setUnassigned(prevUnassigned);
        setRingQueues(prevRingQueues);
      }
      if (prevCompletedQueues) {
        setRingCompletedQueues(prevCompletedQueues);
      }
      if (prevAssignmentsMap) {
        setAssignmentsMap(prevAssignmentsMap);
      }
      setSaveStatusText(null);

      if (msg.startsWith("RUNNING_CATEGORY_DISPLACED:")) {
        const catId = msg.replace("RUNNING_CATEGORY_DISPLACED:", "");
        const catName = initialCategories.find(c => c.id === catId)?.name || "A category";
        alert(`Auto-save blocked & reverted: "${catName}" is currently running on a Tatami.\n\nA running category must stay at the top of its queue.`);
      } else {
        alert(`Failed to save: ${msg || "Unknown error"}`);
        console.error("Auto-save error:", msg);
      }
    };

    saveAssignments(tournamentId, payload)
      .then((res) => {
        if (!res.success) {
          handleAutoSaveError(res.error || "Save operation failed");
          return;
        }
        setLastSaved(new Date());
        setSaveStatusText("Auto-saved");
        setTimeout(() => setSaveStatusText(null), 2500);
      })
      .catch((err: any) => {
        handleAutoSaveError(err?.message || "Unknown error");
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  const handleConfirmRevert = () => {
    if (!pendingRevertCategory || readOnly) return;
    const { ringId, category } = pendingRevertCategory;

    const prevUnassigned = unassigned;
    const prevRingQueues = ringQueues;
    const prevCompletedQueues = ringCompletedQueues;
    const prevAssignmentsMap = assignmentsMap;

    // 1. Remove from completed queue
    const updatedCompletedList = (ringCompletedQueues[ringId] || []).filter(c => c.id !== category.id);
    const nextCompletedQueues = {
      ...ringCompletedQueues,
      [ringId]: updatedCompletedList,
    };

    // 2. Append to active tatami queue (restored to bottom of queue)
    const currentActiveQueue = ringQueues[ringId] || [];
    const isAlreadyInActive = currentActiveQueue.some(c => c.id === category.id);
    const nextActiveQueue = isAlreadyInActive ? currentActiveQueue : [...currentActiveQueue, category];
    const nextRingQueues = {
      ...ringQueues,
      [ringId]: nextActiveQueue,
    };

    // 3. New assignments map with status explicitly 'pending'
    const nextAssignmentsMap = {
      ...assignmentsMap,
      [category.id]: {
        matches_completed: 0,
        status: "pending",
        ring_id: ringId,
        queue_order: nextActiveQueue.length - 1,
        stager_status: null,
        stager_name: null,
      },
    };

    // 4. Update component state
    setAssignmentsMap(nextAssignmentsMap);
    setRingCompletedQueues(nextCompletedQueues);
    setRingQueues(nextRingQueues);
    setPendingRevertCategory(null);
    // Close the history view so user is back on active Tatami queue view!
    setHistoryOpenForRing(null);

    // 5. Trigger auto-save with nextAssignmentsMap
    triggerAutoSaveIfNeeded(
      unassigned,
      nextRingQueues,
      prevUnassigned,
      prevRingQueues,
      nextCompletedQueues,
      prevCompletedQueues,
      nextAssignmentsMap,
      prevAssignmentsMap
    );
  };

  const calculateRingWorkload = (ringId: string) => {
    const categories = ringQueues[ringId] || [];
    const totalMatches = categories.reduce((sum, cat) => sum + cat.expected_matches, 0);
    // 109 seconds per match (1 min 49 secs)
    const totalSeconds = totalMatches * 109;
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  };

  const calculateRingAthletes = (ringId: string) => {
    const categories = ringQueues[ringId] || [];
    return categories.reduce((sum, cat) => sum + cat.athletes_count, 0);
  };

  const isOverloaded = (ringId: string) => {
    const categories = ringQueues[ringId] || [];
    const totalMatches = categories.reduce((sum, cat) => sum + cat.expected_matches, 0);
    const totalSeconds = totalMatches * 109;
    return totalSeconds > 360 * 60; // > 6 hours
  };

  // Derive all queued categories (assigned to any ring, not completed)
  const queuedCategories = initialCategories.filter(cat => {
    const a = assignmentsMap[cat.id];
    return a && a.status !== 'completed' && !unassigned.some(u => u.id === cat.id);
  });

  // Derive all completed categories
  const allCompletedCategories = initialCategories.filter(cat => {
    const a = assignmentsMap[cat.id];
    return a && a.status === 'completed';
  });

  // Derive visible unassigned (only "idle" - not in any ring)
  const visibleUnassigned = unassigned
    .filter(cat => {
      if (search && !matchesCategorySearch(cat, search)) return false;
      if (beltFilter && cat.belt !== beltFilter) return false;
      if (ageFilter && cat.age_bracket !== ageFilter) return false;
      if (sexFilter && cat.sex !== sexFilter) return false;
      return true;
    })
    .sort((a, b) => {
      let result = 0;
      if (sortBy === "athletes") {
        result = a.athletes_count - b.athletes_count;
      } else if (sortBy === "weight") {
        const getMinWeight = (w: string | null) => {
          if (!w) return 0;
          const match = w.match(/(\d+)/);
          return match ? parseInt(match[1]) : 0;
        };
        const weightA = getMinWeight(a.weight_class);
        const weightB = getMinWeight(b.weight_class);
        if (weightA !== weightB) {
          result = weightA - weightB;
        } else {
          result = (a.weight_class || "").localeCompare(b.weight_class || "");
        }
      } else {
        result = a.name.localeCompare(b.name);
      }
      return sortOrder === "asc" ? result : -result;
    });

  // Derive the sidebar panel list based on statusFilter
  const sidebarCategoriesToShow = statusFilter === "idle"
    ? visibleUnassigned
    : statusFilter === "queue"
      ? queuedCategories.filter(cat => search ? matchesCategorySearch(cat, search) : true)
      : allCompletedCategories.filter(cat => search ? matchesCategorySearch(cat, search) : true);

  const uniqueBelts = Array.from(new Set(initialCategories.map(c => c.belt).filter(Boolean)));
  const uniqueAges = Array.from(new Set(initialCategories.map(c => c.age_bracket).filter(Boolean)));
  const uniqueSexes = Array.from(new Set(initialCategories.map(c => c.sex).filter(Boolean)));

  // ── Overall Tournament Stats for Black Overview Strip ───────────────────────
  const totalCategoriesCount = initialCategories.length;
  
  // Track all completed categories across completed queues and live assignments
  const completedCategoryIds = new Set<string>();
  Object.values(ringCompletedQueues).forEach(queue => {
    queue.forEach(c => completedCategoryIds.add(c.id));
  });
  Object.entries(assignmentsMap).forEach(([catId, info]) => {
    if (info.status === "completed") completedCategoryIds.add(catId);
  });
  const completedCategoriesCount = completedCategoryIds.size;

  // Total Athletes across all categories
  const totalAthletesCount = initialCategories.reduce(
    (sum, cat) => sum + (cat.athletes_count || 0),
    0
  );

  // Match / Overall Progress
  let overallTotalExpectedMatches = 0;
  let overallCompletedMatches = 0;

  initialCategories.forEach(cat => {
    overallTotalExpectedMatches += (cat.expected_matches || 0);
    const assignment = assignmentsMap[cat.id];
    if (completedCategoryIds.has(cat.id) || assignment?.status === "completed") {
      overallCompletedMatches += (cat.expected_matches || assignment?.matches_completed || 0);
    } else if (assignment) {
      overallCompletedMatches += Math.min(cat.expected_matches || 0, assignment.matches_completed || 0);
    }
  });

  const overallProgressPct = overallTotalExpectedMatches > 0
    ? Math.round((overallCompletedMatches / overallTotalExpectedMatches) * 100)
    : (totalCategoriesCount > 0 ? Math.round((completedCategoriesCount / totalCategoriesCount) * 100) : 0);

  const renderCategoryCard = (cat: Category, isDrag: boolean, provided?: any, snapshot?: any) => (
    <div
      ref={provided?.innerRef}
      {...(provided?.draggableProps || {})}
      {...(provided?.dragHandleProps || {})}
      className={`p-2.5 bg-white border ${snapshot?.isDragging ? 'border-secondary shadow-lg' : 'border-outline-variant/70 shadow-2xs hover:border-[#A19C90]'} rounded-lg ${!readOnly && isDrag ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <div className="flex justify-between items-start mb-1.5">
        <div className="flex gap-1 flex-wrap">
          {cat.belt && <span className="px-1.5 py-0.5 bg-surface-container-high text-on-surface rounded text-[8.5px] font-bold uppercase">{cat.belt}</span>}
          {cat.sex && <span className="px-1.5 py-0.5 bg-surface-container-high text-on-surface rounded text-[8.5px] font-bold uppercase">{cat.sex}</span>}
          {cat.age_bracket ? (
            <span className="px-1.5 py-0.5 bg-surface-container-high text-on-surface rounded text-[8.5px] font-bold uppercase">{cat.age_bracket}</span>
          ) : (cat.age_min != null || cat.age_max != null) && (
            <span className="px-1.5 py-0.5 bg-surface-container-high text-on-surface rounded text-[8.5px] font-bold uppercase">
              {cat.age_min}-{cat.age_max}
            </span>
          )}
          {cat.weight_class && <span className="px-1.5 py-0.5 bg-surface-container-high text-on-surface rounded text-[8.5px] font-bold uppercase">{cat.weight_class}</span>}
          {cat.day && <span className="px-1.5 py-0.5 bg-surface-container-high text-on-surface rounded text-[8.5px] font-bold uppercase">{cat.day}</span>}
        </div>
        {!readOnly && isDrag && <span className="material-symbols-outlined text-outline-variant text-xs">drag_indicator</span>}
      </div>
      <h4 className="text-[12.5px] font-bold text-primary mb-1.5 leading-snug">
        <span className="flex items-center gap-1.5 flex-wrap">
          {cat.name}
          {renderDrawButton(cat)}
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
        </span>
      </h4>
      <div className="flex items-center justify-between pt-1.5 border-t border-outline-variant/30">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 font-data-mono text-[10.5px] text-[#64748B]">
            <span className="material-symbols-outlined text-[13px] text-outline">group</span> {cat.athletes_count}
          </span>
        </div>
        <span className="font-data-mono text-[10.5px] font-bold px-1.5 py-0.5 bg-primary text-on-primary rounded">
          {Math.ceil((cat.expected_matches * 109) / 60)}m
        </span>
      </div>
    </div>
  );

  const renderIdleEmptyState = () => (
    Boolean(search.trim() || beltFilter || ageFilter || sexFilter) ? (
      <div className="flex flex-col items-center justify-center text-center py-5 px-3 bg-rose-50/75 border border-rose-200/80 rounded-xl my-2 mx-1 shadow-2xs">
        <div className="w-8 h-8 rounded-lg bg-rose-100/90 border border-rose-200 flex items-center justify-center mb-2 text-rose-600">
          <span className="material-symbols-outlined text-[18px]">filter_alt_off</span>
        </div>
        <div className="text-[12.5px] font-bold text-rose-950 mb-0.5">
          No matching categories
        </div>
        <div className="text-[11px] font-medium text-rose-700 max-w-[210px] leading-snug mb-2.5">
          Filters or search are hiding categories from this list.
        </div>
        <button
          type="button"
          onClick={() => {
            setSearch(""); setBeltFilter(""); setAgeFilter(""); setSexFilter("");
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-bold text-[11px] shadow-xs hover:shadow transition-all cursor-pointer"
        >
          <span className="material-symbols-outlined text-[13px]">filter_alt_off</span>
          <span>Clear Filters &amp; Search</span>
        </button>
      </div>
    ) : (
      <div className="flex flex-col items-center justify-center text-center py-6 px-4 text-[#94A3B8]">
        <div className="w-8 h-8 rounded-[9px] bg-[#F1F3F5] flex items-center justify-center mb-2 text-[#94A3B8]">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 13v6a1 1 0 001 1h14a1 1 0 001-1v-6M4 13l2.5-7h11l2.5 7M4 13h5.5a.5.5 0 01.5.5v0a2 2 0 002 2h0a2 2 0 002-2v0a.5.5 0 01.5-.5H20"/>
          </svg>
        </div>
        <div className="text-[12px] font-semibold text-[#334155] mb-0.5">
          Nothing unassigned
        </div>
        <div className="text-[11px] text-[#94A3B8] max-w-[200px] leading-snug">
          Every category is currently on a tatami or completed.
        </div>
      </div>
    )
  );

  const renderQueueEmptyState = () => (
    Boolean(search.trim()) ? (
      <div className="flex flex-col items-center justify-center text-center py-5 px-3 bg-rose-50/75 border border-rose-200/80 rounded-xl my-2 mx-1 shadow-2xs">
        <div className="w-8 h-8 rounded-lg bg-rose-100/90 border border-rose-200 flex items-center justify-center mb-2 text-rose-600">
          <span className="material-symbols-outlined text-[18px]">search_off</span>
        </div>
        <div className="text-[12.5px] font-bold text-rose-950 mb-0.5">
          No matching categories
        </div>
        <div className="text-[11px] font-medium text-rose-700 max-w-[210px] leading-snug mb-2.5">
          No categories match &ldquo;{search}&rdquo;.
        </div>
        <button
          type="button"
          onClick={() => setSearch("")}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-bold text-[11px] shadow-xs hover:shadow transition-all cursor-pointer"
        >
          <span className="material-symbols-outlined text-[13px]">refresh</span>
          <span>Clear Search</span>
        </button>
      </div>
    ) : (
      <div className="flex flex-col items-center justify-center text-center py-6 px-4 text-[#94A3B8]">
        <div className="w-8 h-8 rounded-[9px] bg-[#F1F3F5] flex items-center justify-center mb-2 text-[#94A3B8]">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 13v6a1 1 0 001 1h14a1 1 0 001-1v-6M4 13l2.5-7h11l2.5 7M4 13h5.5a.5.5 0 01.5.5v0a2 2 0 002 2h0a2 2 0 002-2v0a.5.5 0 01.5-.5H20"/>
          </svg>
        </div>
        <div className="text-[12px] font-semibold text-[#334155] mb-0.5">
          {statusFilter === "queue" ? "Nothing in queue" : "No completed categories"}
        </div>
        <div className="text-[11px] text-[#94A3B8] max-w-[200px] leading-snug">
          {statusFilter === "queue"
            ? readOnly
              ? "No categories currently assigned to any tatami."
              : "Drag categories into a tatami ring to queue them up."
            : "Finished categories will appear here once marked completed."}
        </div>
      </div>
    )
  );

  const renderQueueOrCompletedCards = () => (
    <div className="flex-1 overflow-y-auto p-2.5 space-y-2 bg-white">
      {sidebarCategoriesToShow.length === 0 && renderQueueEmptyState()}
      {sidebarCategoriesToShow.map(cat => {
        const assignment = assignmentsMap[cat.id];
        const ringName = initialRings.find(r => r.id === assignment?.ring_id)?.name?.replace(/Ring/i, 'Tatami') || "";
        const status = assignment?.status;
        const isCompleted = status === 'completed';
        const isRunning = status === 'running';
        const isPaused = status === 'paused';
        const hasLeftAccent = isRunning || isPaused || isCompleted;
        const matchesDone = assignment?.matches_completed || 0;
        const matchesTotal = cat.expected_matches || 0;
        const pct = matchesTotal > 0 ? (matchesDone / matchesTotal) * 100 : 0;

        return (
          <div
            key={cat.id}
            className={`p-2.5 border rounded-lg relative overflow-hidden ${isPaused
                ? 'bg-amber-500/5 border-amber-300 shadow-2xs'
                : isRunning
                  ? 'bg-secondary/5 border-secondary/30 shadow-2xs'
                  : isCompleted
                    ? 'bg-surface-container border-outline-variant/50 opacity-60'
                    : 'bg-surface-container border-outline-variant/50 opacity-70'
              }`}
          >
            {isPaused && (
              <div className="absolute top-0 left-0 w-1 h-full bg-amber-500"></div>
            )}
            {isRunning && (
              <div className="absolute top-0 left-0 w-1 h-full bg-secondary"></div>
            )}
            {isCompleted && (
              <div className="absolute top-0 left-0 w-1 h-full bg-blue-600"></div>
            )}
            <div className={`flex gap-1 flex-wrap mb-1 ${hasLeftAccent ? 'ml-1.5' : ''}`}>
              {cat.belt && <span className="px-1.5 py-0.5 bg-surface-container-high text-on-surface rounded text-[8.5px] font-bold uppercase">{cat.belt}</span>}
              {cat.sex && <span className="px-1.5 py-0.5 bg-surface-container-high text-on-surface rounded text-[8.5px] font-bold uppercase">{cat.sex}</span>}
              {cat.age_bracket && <span className="px-1.5 py-0.5 bg-surface-container-high text-on-surface rounded text-[8.5px] font-bold uppercase">{cat.age_bracket}</span>}
              {cat.weight_class && <span className="px-1.5 py-0.5 bg-surface-container-high text-on-surface rounded text-[8.5px] font-bold uppercase">{cat.weight_class}</span>}
            </div>
            <h4 className={`text-[12px] font-bold text-on-surface mb-1 ${hasLeftAccent ? 'ml-1.5' : ''}`}>{cat.name}</h4>
            <div className={`flex justify-between items-center text-[9.5px] text-on-surface-variant mb-0.5 ${hasLeftAccent ? 'ml-1.5' : ''}`}>
              <span className="flex items-center gap-1 font-bold">
                <span className="material-symbols-outlined text-[11px]">{isCompleted ? 'done_all' : isPaused ? 'pause_circle' : 'schedule'}</span>
                {ringName}
              </span>
              <div className="flex items-center gap-1.5">
                {renderDrawButton(cat)}
                {cat.doc_url && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setViewingPdf({ url: cat.doc_url!, title: cat.name });
                    }}
                    title="View athlete list PDF"
                    className="material-symbols-outlined text-[11px] text-outline hover:text-primary transition-colors shrink-0 cursor-pointer"
                    style={{ fontVariationSettings: "'FILL' 0" }}
                  >
                    article
                  </button>
                )}
                {assignment?.stager_status && (
                  <StagerStatusIndicator stagerStatus={assignment.stager_status} stagerActorName={assignment.stager_name} />
                )}
                {isPaused && (
                  <span className="inline-flex items-center gap-1 text-[8.5px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded uppercase tracking-wider shadow-2xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-600 animate-pulse" />
                    PAUSED
                  </span>
                )}
                {isRunning && (
                  <span className="inline-flex items-center gap-1 text-[8.5px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded uppercase tracking-wider shadow-2xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                    LIVE
                  </span>
                )}
                {isCompleted && (
                  <span className="inline-flex items-center gap-1 text-[8.5px] font-bold text-blue-800 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded uppercase tracking-wider shadow-2xs">
                    <span className="material-symbols-outlined text-[9.5px] text-blue-600">done_all</span>
                    DONE
                  </span>
                )}
              </div>
            </div>
            {(isRunning || isPaused || isCompleted) && (
              <div className={`mt-1.5 ${hasLeftAccent ? 'ml-1.5' : ''}`}>
                <div className="flex justify-between text-[9px] font-bold text-on-surface-variant mb-0.5">
                  <span>{matchesDone} / {matchesTotal} matches</span>
                  <span>{pct.toFixed(0)}%</span>
                </div>
                <div className="w-full bg-surface-container-high h-1 rounded-full overflow-hidden">
                  <div className={`h-full transition-all duration-500 ${isCompleted ? 'bg-blue-600' : isPaused ? 'bg-amber-500' : 'bg-secondary'}`} style={{ width: `${Math.min(100, pct)}%` }}></div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  const renderPoolContent = (isDropdown = false) => (
    <>
      {/* Panel Head - Fixed Height & Sleek */}
      <div className={`flex items-center justify-between px-3 ${isDropdown ? "h-[42px]" : "h-[38px]"} border-b border-[#E1DDCF] bg-[#FAF9F5] shrink-0`}>
        <div className="flex items-center gap-1.5 min-w-0">
          {isDropdown && (
            <span className="material-symbols-outlined text-[17px] text-blue-600 shrink-0 select-none">
              category
            </span>
          )}
          <h3 className="text-[13px] font-bold text-[#1B1815] tracking-tight leading-none">
            {statusFilter === "idle" ? "Unassigned" : statusFilter === "queue" ? "In Queue" : "Completed"}
          </h3>
          <span className="bg-[#ECE9DF] text-[#68645A] text-[10px] font-bold px-1.5 py-0.5 rounded-full font-mono leading-none">
            {statusFilter === "idle" ? visibleUnassigned.length : statusFilter === "queue" ? queuedCategories.length : allCompletedCategories.length}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Glowing emerald Clear Filters button */}
          {Boolean(search.trim() || beltFilter || ageFilter || sexFilter) && (
            <button
              type="button"
              onClick={() => {
                setSearch(""); setBeltFilter(""); setAgeFilter(""); setSexFilter("");
              }}
              className="inline-flex items-center gap-1 px-2 h-[22px] rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-[10px] leading-none shadow-[0_0_8px_rgba(5,150,105,0.35)] transition-all cursor-pointer"
              title="Clear active filters"
            >
              <span className="material-symbols-outlined text-[12px] leading-none">filter_alt_off</span>
              <span className="leading-none whitespace-nowrap">Clear filters</span>
            </button>
          )}

          {/* Collapse button: Up arrow to furl up on desktop dropdown; chevron_left for mobile drawer */}
          {isDropdown ? (
            <button
              onClick={() => setIsOrgPoolExpanded(false)}
              type="button"
              className="p-1 rounded-md text-[#68645A] hover:bg-[#ECE9DF] transition-colors cursor-pointer flex items-center justify-center"
              title="Furl up / Send up"
              aria-label="Furl up"
            >
              <span className="material-symbols-outlined text-[18px] leading-none">keyboard_arrow_up</span>
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                togglePool();
              }}
              type="button"
              className="md:hidden p-1 rounded-md text-[#68645A] hover:bg-[#ECE9DF] transition-colors cursor-pointer"
              title="Shrink sidebar"
            >
              <span className="material-symbols-outlined text-[16px] leading-none">chevron_left</span>
            </button>
          )}
        </div>
      </div>

      {/* Panel Body: Thinned Search, Segmented Tabs, Filter & Sort Rows */}
      <div className="px-3 py-2 bg-[#FAF9F5] border-b border-[#E1DDCF] flex flex-col shrink-0">
        {/* Search Bar - Sleek & Compact */}
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 border border-[#E1DDCF] rounded-[7px] bg-white mb-1.5 focus-within:border-[#0E9C7C] focus-within:ring-1 focus-within:ring-[#0E9C7C]/20 transition-all relative">
          <svg className="w-3.5 h-3.5 text-[#8C877C] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7"/>
            <path d="M21 21l-4.3-4.3"/>
          </svg>
          <input
            type="text"
            placeholder="Search categories…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border-none outline-none bg-transparent text-[12px] text-[#1B1815] placeholder-[#8C877C] w-full font-inherit"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="text-[#8C877C] hover:text-[#1B1815] cursor-pointer text-xs p-0.5"
              title="Clear search"
            >
              ×
            </button>
          )}
        </div>

        {/* Segmented Control - Thin */}
        <div className="flex bg-[#ECE9DF] rounded-[7px] p-[2px] mb-1.5">
          {(["idle", "queue", "completed"] as const).map(tab => (
            <button
              key={tab}
              type="button"
              onClick={() => setStatusFilter(tab)}
              className={`flex-1 border-none py-1 rounded-[5px] text-[11.5px] font-semibold transition-all cursor-pointer capitalize ${
                statusFilter === tab
                  ? 'bg-white text-[#1B1815] shadow-[0_1px_3px_rgba(27,24,21,0.1)] font-bold'
                  : 'text-[#68645A] hover:text-[#1B1815]'
              }`}
            >
              {tab === "idle" ? "Idle" : tab === "queue" ? "Queue" : "Completed"}
            </button>
          ))}
        </div>

        {/* Filters & Sort (Active on Idle tab) */}
        {statusFilter === "idle" && (
          <div className="space-y-1.5 animate-in fade-in duration-150">
            {/* Filter Row: Age and Sex (and Belt if available) */}
            <div className={`grid ${uniqueBelts.length > 0 ? "grid-cols-3" : "grid-cols-2"} gap-1.5`}>
              {/* Age Column */}
              <div className="min-w-0">
                <label className="text-[9px] font-bold text-[#8C877C] tracking-[0.3px] mb-0.5 block uppercase leading-none">
                  Age
                </label>
                <div className="relative">
                  <select
                    value={ageFilter}
                    onChange={e => setAgeFilter(e.target.value)}
                    className="appearance-none w-full border border-[#E1DDCF] hover:border-[#8C877C] rounded-[7px] bg-white py-1 pl-2 pr-5 text-[11.5px] font-medium text-[#1B1815] outline-none transition-colors cursor-pointer truncate"
                  >
                    <option value="">All ages</option>
                    {uniqueAges.map(a => <option key={a as string} value={a as string}>{a}</option>)}
                  </select>
                  <svg className="w-2.5 h-2.5 text-[#8C877C] absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                </div>
              </div>

              {/* Belt Column (if applicable) */}
              {uniqueBelts.length > 0 && (
                <div className="min-w-0">
                  <label className="text-[9px] font-bold text-[#8C877C] tracking-[0.3px] mb-0.5 block uppercase leading-none">
                    Belt
                  </label>
                  <div className="relative">
                    <select
                      value={beltFilter}
                      onChange={e => setBeltFilter(e.target.value)}
                      className="appearance-none w-full border border-[#E1DDCF] hover:border-[#8C877C] rounded-[7px] bg-white py-1 pl-2 pr-5 text-[11.5px] font-medium text-[#1B1815] outline-none transition-colors cursor-pointer truncate"
                    >
                      <option value="">All Belts</option>
                      {uniqueBelts.map(b => <option key={b as string} value={b as string}>{b}</option>)}
                    </select>
                    <svg className="w-2.5 h-2.5 text-[#8C877C] absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M6 9l6 6 6-6"/>
                    </svg>
                  </div>
                </div>
              )}

              {/* Sex Column */}
              <div className="min-w-0">
                <label className="text-[9px] font-bold text-[#8C877C] tracking-[0.3px] mb-0.5 block uppercase leading-none">
                  Sex
                </label>
                <div className="relative">
                  <select
                    value={sexFilter}
                    onChange={e => setSexFilter(e.target.value)}
                    className="appearance-none w-full border border-[#E1DDCF] hover:border-[#8C877C] rounded-[7px] bg-white py-1 pl-2 pr-5 text-[11.5px] font-medium text-[#1B1815] outline-none transition-colors cursor-pointer truncate"
                  >
                    <option value="">All</option>
                    {uniqueSexes.map(s => <option key={s as string} value={s as string}>{s}</option>)}
                  </select>
                  <svg className="w-2.5 h-2.5 text-[#8C877C] absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 9l6 6 6-6"/>
                  </svg>
                </div>
              </div>
            </div>

            {/* Sort Dropdown */}
            <div className="flex items-center gap-1.5 pt-0.5">
              <span className="text-[9px] font-bold text-[#8C877C] tracking-[0.3px] uppercase leading-none shrink-0">
                Sort:
              </span>
              <div className="relative flex-1 min-w-0">
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as any)}
                  className="appearance-none w-full border border-[#E1DDCF] hover:border-[#8C877C] rounded-[7px] bg-white py-0.5 pl-2 pr-5 text-[11px] font-medium text-[#1B1815] outline-none transition-colors cursor-pointer truncate"
                >
                  <option value="athletes">Athletes count</option>
                  <option value="name">Category name</option>
                  <option value="weight">Weight class</option>
                </select>
                <svg className="w-2.5 h-2.5 text-[#8C877C] absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </div>
              <button
                type="button"
                onClick={() => setSortOrder(prev => prev === "asc" ? "desc" : "asc")}
                className="p-1 rounded-[7px] border border-[#E1DDCF] bg-white hover:bg-[#FAF9F5] text-[#1B1815] transition-colors cursor-pointer shrink-0"
                title={`Sort ${sortOrder === "asc" ? "Ascending" : "Descending"}`}
              >
                <svg className={`w-3 h-3 transition-transform ${sortOrder === "desc" ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M19 12l-7 7-7-7"/>
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Categories List */}
      {statusFilter === "idle" ? (
        isDropdown ? (
          <div className="flex-1 overflow-y-auto p-2.5 space-y-2 bg-white">
            {visibleUnassigned.map((cat) => (
              <div key={cat.id}>
                {renderCategoryCard(cat, false)}
              </div>
            ))}
            {visibleUnassigned.length === 0 && renderIdleEmptyState()}
          </div>
        ) : (
          <Droppable droppableId="unassigned">
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className={`flex-1 overflow-y-auto p-2.5 space-y-2 bg-white ${snapshot.isDraggingOver ? 'bg-secondary/5' : ''}`}
              >
                {visibleUnassigned.map((cat, index) => (
                  <Draggable key={cat.id} draggableId={cat.id} index={index} isDragDisabled={readOnly}>
                    {(provided, snapshot) => renderCategoryCard(cat, true, provided, snapshot)}
                  </Draggable>
                ))}
                {visibleUnassigned.length === 0 && renderIdleEmptyState()}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        )
      ) : (
        renderQueueOrCompletedCards()
      )}
    </>
  );

  return (
    <div className="flex flex-col overflow-hidden w-full h-[calc(100dvh-4rem)] md:h-screen">
      {/* TopNavBar - Shell v2 Header */}
      <header className="flex justify-between items-center w-full px-4 sm:px-6 h-[60px] bg-[#FAF9F5] border-b border-[#E1DDCF] shrink-0 z-50 gap-3 sm:gap-6">
        {/* Left: Breadcrumb */}
        <div className="flex items-center gap-1.5 sm:gap-2 text-[13px] sm:text-[13.5px] min-w-0">
          <span
            title={tournamentName}
            className="text-[#8C877C] font-medium truncate max-w-[60px] min-[360px]:max-w-[85px] min-[380px]:max-w-[105px] sm:max-w-[200px] md:max-w-[260px]"
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
            <span className="hidden min-[400px]:inline">Tatami </span>Balancing
          </span>
        </div>

        {/* Center: Live Interactive Search Bar */}
        {!readOnly && (
          <HeaderSearchBar tournamentId={tournamentId} role="admin" className="hidden md:flex" />
        )}

        {/* Right: Built by Crux Studios Badge */}
        <div className="flex items-center shrink-0 ml-auto self-stretch">
          <BuiltByCrux />
        </div>
      </header>

      <DragDropContext onDragEnd={onDragEnd}>
        {/* Main Content Area */}
        <div className="flex-1 flex overflow-hidden w-full relative">

          {/* Left Sidebar: Category Pool (Full vertical height directly below header on admin, collapsible drawer on mobile) */}
          <section
            className={`h-full flex flex-col bg-surface-container-low shrink-0 relative transition-[width] duration-300 ease-in-out z-20 ${readOnly ? "md:hidden" : ""} ${
              mobileShowPool
                ? "w-[85vw] max-w-[340px] md:w-80 shadow-lg md:shadow-none p-2 sm:p-4 sm:pr-0"
                : "w-[44px] min-w-[44px] md:w-80 overflow-visible cursor-pointer select-none p-1.5 pr-0 md:p-4 md:pr-0"
            }`}
            onClick={!mobileShowPool ? togglePool : undefined}
            title={!mobileShowPool ? "Tap or drag to expand categories" : undefined}
          >
            {/* Pop-out black button with white arrow */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                togglePool();
              }}
              type="button"
              title={mobileShowPool ? "Shrink sidebar" : "Expand categories pool"}
              className="md:hidden absolute top-1/2 left-full -translate-x-1/2 -translate-y-1/2 w-8 h-8 sm:w-9 sm:h-9 bg-black text-white rounded-full shadow-xl hover:scale-110 active:scale-95 transition-all cursor-pointer z-50 flex items-center justify-center border-2 border-white/90"
            >
              <span className="material-symbols-outlined text-[20px] sm:text-[22px] select-none leading-none text-white">
                {mobileShowPool ? "chevron_left" : "chevron_right"}
              </span>
            </button>

            {/* Mobile Collapsed Peek Tab (Visible only on mobile when collapsed) */}
            {!mobileShowPool && (
              <div className="md:hidden w-full h-full flex flex-col items-center justify-between py-5 bg-white border border-[#E1DDCF] rounded-l-none rounded-r-xl shadow-xs animate-in fade-in duration-200">
                {/* Top: Category Icon + Count Badge */}
                <div className="flex flex-col items-center gap-1">
                  <span className="material-symbols-outlined text-[16px] text-secondary">
                    category
                  </span>
                  <span className="bg-[#ECE9DF] text-[#1B1815] text-[10px] font-bold px-1.5 py-0.5 rounded-full font-mono leading-none">
                    {visibleUnassigned.length}
                  </span>
                </div>

                {/* Center: Vertical Rotated Label "POOL" + Dots */}
                <div className="flex flex-col items-center gap-2">
                  <div className="flex flex-col gap-0.5">
                    <span className="w-1 h-1 rounded-full bg-[#8C877C]/60" />
                    <span className="w-1 h-1 rounded-full bg-[#8C877C]/60" />
                    <span className="w-1 h-1 rounded-full bg-[#8C877C]/60" />
                  </div>
                  <span
                    className="text-[9.5px] font-black tracking-widest text-[#68645A] uppercase select-none"
                    style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
                  >
                    POOL
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <span className="w-1 h-1 rounded-full bg-[#8C877C]/60" />
                    <span className="w-1 h-1 rounded-full bg-[#8C877C]/60" />
                    <span className="w-1 h-1 rounded-full bg-[#8C877C]/60" />
                  </div>
                </div>

                {/* Bottom: Subtle Drag Cue Icon */}
                <span className="material-symbols-outlined text-[15px] text-[#A19C90]">
                  drag_indicator
                </span>
              </div>
            )}

            {/* Inner Content Container - Distinct Bordered Card (Expanded / Desktop) */}
            <div
              className={`w-full flex-col h-full bg-white border border-[#E1DDCF] rounded-xl overflow-hidden shadow-xs transition-opacity duration-200 ${
                mobileShowPool
                  ? "flex opacity-100"
                  : "hidden md:flex opacity-100"
              }`}
            >
              {renderPoolContent(false)}
            </div>
          </section>

          {/* Right Workspace: Shrunken & Centered Overview Bar + Ring Grid */}
          <div className="flex-1 flex flex-col overflow-hidden min-w-0 h-full">
            {/* Tournament Overview Bar - Shrunken, Centered in Remaining Space with Border Start & End */}
            <div className="w-full flex items-stretch justify-center shrink-0 z-30 bg-surface-container-low px-2 sm:px-4 gap-2 sm:gap-3">
              {/* Hanging Organiser Unassigned Categories Tab (Visible only on desktop in readOnly mode) */}
              {readOnly && (
                <div className="relative hidden md:flex items-stretch">
                  <button
                    type="button"
                    onClick={() => setIsOrgPoolExpanded((prev) => !prev)}
                    className={`h-full bg-white border-s border-e border-b border-outline-variant rounded-b-xl shadow-xs px-3.5 sm:px-5 py-1.5 sm:py-2 flex items-center gap-2.5 sm:gap-3 transition-all cursor-pointer select-none ${
                      isOrgPoolExpanded
                        ? "bg-[#FAF9F5] border-[#0E9C7C] text-[#0B7C63]"
                        : "hover:bg-[#FAF9F5] hover:border-[#0E9C7C] text-on-surface"
                    }`}
                    title={isOrgPoolExpanded ? "Furl categories up" : "Unfurl categories down"}
                    aria-label={isOrgPoolExpanded ? "Furl categories up" : "Unfurl categories down"}
                  >
                    <span className="material-symbols-outlined text-[18px] sm:text-[20px] text-blue-600 shrink-0 select-none">
                      category
                    </span>
                    <span className="text-[10px] sm:text-[11px] font-extrabold tracking-wider uppercase text-on-surface select-none whitespace-nowrap">
                      Unassigned
                    </span>
                    <span className="bg-[#ECE9DF] text-[#1B1815] text-[11px] sm:text-[12px] font-bold px-2 py-0.5 rounded-full font-mono leading-none shrink-0 select-none">
                      {visibleUnassigned.length}
                    </span>
                    <span className="material-symbols-outlined text-[18px] sm:text-[20px] text-outline shrink-0 select-none">
                      {isOrgPoolExpanded ? "keyboard_arrow_up" : "keyboard_arrow_down"}
                    </span>
                  </button>

                  {/* Unfurling Category Pool Dropdown Panel */}
                  {isOrgPoolExpanded && (
                    <>
                      {/* Backdrop to close on outside click */}
                      <div
                        className="fixed inset-0 z-40 bg-black/15 backdrop-blur-[0.5px]"
                        onClick={() => setIsOrgPoolExpanded(false)}
                      />
                      <div className="absolute left-0 top-full mt-1.5 w-[380px] lg:w-[420px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-140px)] bg-white border border-[#E1DDCF] rounded-2xl shadow-2xl overflow-hidden flex flex-col z-50 animate-in slide-in-from-top-2 duration-200">
                        {renderPoolContent(true)}
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="bg-white border-s border-e border-b border-outline-variant rounded-b-xl shadow-xs px-3 sm:px-6 py-1.5 sm:py-2 w-full max-w-xl sm:max-w-2xl lg:max-w-3xl flex items-center justify-between gap-2 sm:gap-4">
                {/* 3 Stats: Centered Telemetry */}
                <div className="flex-1 max-w-xl sm:max-w-2xl lg:max-w-3xl mx-auto grid grid-cols-3 divide-x divide-outline-variant">
                  {/* Stat 1: Completed Categories */}
                  <div className="flex flex-col items-center justify-center text-center px-1.5 sm:px-2 min-w-0">
                    <span className="text-[8.5px] sm:text-[9.5px] font-bold tracking-widest uppercase text-on-surface-variant whitespace-nowrap">Categories</span>
                    <div className="flex items-baseline justify-center gap-1 mt-0.5">
                      <span className="font-data-mono text-[13px] sm:text-sm font-black text-on-surface whitespace-nowrap">{completedCategoriesCount}</span>
                      <span className="text-[11px] font-bold text-outline-variant">/</span>
                      <span className="font-data-mono text-[12px] sm:text-[13px] font-bold text-on-surface-variant whitespace-nowrap">{totalCategoriesCount}</span>
                      {completedCategoriesCount === totalCategoriesCount && totalCategoriesCount > 0 && (
                        <span className="text-[7.5px] font-extrabold uppercase px-1 py-0.2 bg-emerald-50 text-emerald-700 rounded border border-emerald-200 ml-0.5 hidden sm:inline">DONE</span>
                      )}
                    </div>
                  </div>

                  {/* Stat 2: Completed Matches */}
                  <div className="flex flex-col items-center justify-center text-center px-1.5 sm:px-2 min-w-0">
                    <span className="text-[8.5px] sm:text-[9.5px] font-bold tracking-widest uppercase text-on-surface-variant whitespace-nowrap">Matches</span>
                    <div className="flex items-baseline justify-center gap-1 mt-0.5">
                      <span className="font-data-mono text-[13px] sm:text-sm font-black text-on-surface whitespace-nowrap">{overallCompletedMatches}</span>
                      <span className="text-[11px] font-bold text-outline-variant">/</span>
                      <span className="font-data-mono text-[12px] sm:text-[13px] font-bold text-on-surface-variant whitespace-nowrap">{overallTotalExpectedMatches}</span>
                    </div>
                  </div>

                  {/* Stat 3: Overall Progress */}
                  <div className="flex flex-col items-center justify-center text-center px-1.5 sm:px-2 min-w-0">
                    <div className="w-full max-w-[120px] sm:max-w-[150px] flex flex-col items-center">
                      <div className="w-full flex items-center justify-between gap-1.5">
                        <span className="text-[8.5px] sm:text-[9.5px] font-bold tracking-widest uppercase text-on-surface-variant whitespace-nowrap">Progress</span>
                        <span className="font-data-mono text-[11px] sm:text-xs font-black text-secondary whitespace-nowrap">
                          {overallProgressPct}%
                        </span>
                      </div>
                      <div className="w-full bg-surface-container-highest border border-outline-variant/60 h-1.5 rounded-full overflow-hidden mt-1">
                        <div
                          className="h-full bg-secondary rounded-full transition-all duration-700 ease-out"
                          style={{
                            width: `${Math.min(100, Math.max(0, overallProgressPct))}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {!readOnly && (
                  <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                    <div className="flex flex-col items-start gap-0.5">
                      <span className="text-[7.5px] sm:text-[8px] font-semibold tracking-widest uppercase text-on-surface-variant">Sync</span>
                      <button
                        onClick={() => setAutoSave(!autoSave)}
                        className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold transition-all border ${autoSave
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:bg-emerald-100'
                            : 'bg-surface-container-lowest border-outline-variant text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
                          }`}
                        title="Toggle Auto Sync after drag and drop"
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${autoSave ? 'bg-emerald-500' : 'bg-outline'}`}></span>
                        <span className="text-[9px] sm:text-[10px] whitespace-nowrap font-bold tracking-wide">{autoSave ? "AUTO" : "MANUAL"}</span>
                      </button>
                    </div>

                    {/* Save button only when Auto-Save is OFF */}
                    {!autoSave && (
                      <div className="flex flex-col items-start gap-0.5">
                        <span className="text-[7.5px] sm:text-[8px] font-semibold tracking-widest uppercase text-on-surface-variant">Actions</span>
                        <button
                          onClick={handleSave}
                          disabled={isSaving}
                          className="bg-secondary hover:bg-secondary/90 text-white px-2.5 py-0.5 rounded-md text-[10px] sm:text-[11px] font-bold disabled:opacity-50 flex items-center gap-1 cursor-pointer whitespace-nowrap transition-colors"
                        >
                          {isSaving && <span className="w-2.5 h-2.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>}
                          {isSaving ? "Save" : "Save"}
                        </button>
                      </div>
                    )}

                    {/* Save status cue */}
                    {saveStatusText && (
                      <div className="flex items-center gap-1 px-2 py-0.5 bg-secondary/10 border border-secondary/30 text-secondary text-[11px] font-bold rounded-md shadow-xs shrink-0">
                        <span className="material-symbols-outlined text-[13px]">sync</span>
                        <span className="text-[9px] sm:text-[10px] tracking-wider whitespace-nowrap font-bold">{saveStatusText}</span>
                      </div>
                    )}
                    {!saveStatusText && lastSaved && (
                      <span className="text-[9px] sm:text-[10px] text-on-surface-variant font-data-mono hidden xl:inline whitespace-nowrap">
                        Synced {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Horizontal Scrollable Ring Grid */}
            <section className="flex-1 overflow-x-auto bg-surface-container-low flex p-3 sm:p-5 sm:pb-3 gap-3 sm:gap-5 items-start">
            {initialRings.map(ring => {
              const overloaded = isOverloaded(ring.id);
              const isHistoryView = historyOpenForRing === ring.id;

              // Derive live status of this Tatami
              const ringCats = ringQueues[ring.id] || [];
              const completedCats = ringCompletedQueues[ring.id] || [];
              const runningCat = ringCats.find(c => assignmentsMap[c.id]?.status === 'running');
              const pausedCat = !runningCat ? ringCats.find(c => assignmentsMap[c.id]?.status === 'paused') : null;
              const isRingRunning = Boolean(runningCat);
              const isRingPaused = Boolean(pausedCat);
              const isRingCompleted = ringCats.length === 0 && (ringCompletedQueues[ring.id]?.length || 0) > 0;
              const ringStatusText = isRingRunning ? "RUNNING" : isRingPaused ? "PAUSED" : isRingCompleted ? "COMPLETED" : "IDLE";
              const ringHeaderBg = isRingRunning
                ? "bg-[#1F5C3B] animate-band-pulse"
                : isRingPaused
                ? "bg-[#8E2E27]"
                : isRingCompleted
                ? "bg-[#1E3A8A]"
                : "bg-[#59564C]";

              const matNumberMatch = ring.name.match(/\d+/);
              const matNumber = matNumberMatch ? matNumberMatch[0].padStart(2, "0") : String(ring.ring_order || 1).padStart(2, "0");
              const formattedRingName = ring.name.replace(/Ring/i, "Tatami");

              if (isHistoryView) {
                const totalHistoryAthletes = ringCompletedQueues[ring.id]?.reduce((sum, cat) => sum + cat.athletes_count, 0) || 0;
                return (
                  <div key={ring.id} className="w-[85vw] max-w-[360px] md:w-80 lg:w-[330px] xl:w-[350px] 2xl:w-[380px] shrink-0 flex flex-col bg-white border border-outline-variant rounded-xl overflow-hidden shadow-sm h-full">
                    {/* Scoreboard History Header */}
                    <div className="sticky top-0 z-10 px-3.5 h-[46px] flex items-center justify-between shrink-0 relative transition-all text-white bg-[#1E293B] overflow-visible">
                      {/* Left: Scoreboard Mat Number & Label */}
                      <div className="flex items-center gap-2 relative z-10 min-w-0">
                        <span className="font-scoreboard text-[26px] sm:text-[28px] font-normal leading-none tracking-wide text-white shrink-0">
                          {matNumber}
                        </span>
                        <div className="min-w-0 flex flex-col justify-center">
                          <h4 className="font-bold text-[13px] sm:text-[13.5px] tracking-tight leading-tight text-white truncate">
                            {formattedRingName}
                          </h4>
                          <span className="text-[8.5px] font-bold tracking-wider uppercase leading-none mt-0.5 text-amber-300">
                            HISTORY ARCHIVE
                          </span>
                        </div>
                      </div>

                      {/* Right: Back to Queue Button */}
                      <div className="flex items-center gap-1.5 relative z-10 shrink-0">
                        <button
                          type="button"
                          className="flex items-center gap-1 text-[9.5px] font-bold tracking-wider uppercase text-white bg-white/15 hover:bg-white/25 px-2 py-1 rounded-md transition-all cursor-pointer border border-white/10 shadow-xs"
                          onClick={() => setHistoryOpenForRing(null)}
                          title="Back to Current Queue"
                        >
                          <span className="material-symbols-outlined text-[13px]">arrow_back</span>
                          <span>QUEUE</span>
                        </button>
                      </div>

                      {/* Ticket Perforation Notches - centered exactly at bottom seam */}
                      <div className="spectator-notch left -bottom-[7px]" />
                      <div className="spectator-notch right -bottom-[7px]" />
                    </div>

                    {/* History Stats Summary Bar (matches EST TIME / ATHLETES height & seam) */}
                    <div className="py-1.5 px-3 border-b border-outline-variant flex items-center justify-around bg-slate-50">
                      <div className="flex flex-col items-center">
                        <span className="text-[8.5px] font-label-caps font-bold text-on-surface-variant leading-tight">COMPLETED</span>
                        <span className="font-data-mono text-[15px] font-black text-slate-800 leading-tight">
                          {ringCompletedQueues[ring.id]?.length || 0}
                        </span>
                      </div>
                      <div className="h-4 w-[1px] bg-outline-variant/50"></div>
                      <div className="flex flex-col items-center">
                        <span className="text-[8.5px] font-label-caps font-bold text-on-surface-variant leading-tight">ATHLETES</span>
                        <span className="flex items-center gap-1 font-data-mono text-[15px] font-black text-slate-800 leading-tight">
                          <span className="material-symbols-outlined text-[13px]">group</span> {totalHistoryAthletes}
                        </span>
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-3">
                      {ringCompletedQueues[ring.id]?.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-outline opacity-70">
                          <span className="material-symbols-outlined text-4xl mb-2">inbox</span>
                          <span className="text-sm">No completed categories</span>
                        </div>
                      ) : (
                        ringCompletedQueues[ring.id]?.map(cat => {
                          const assignment = initialAssignments.find(a => a.category_id === cat.id);
                          const rawTime = completedTimes[cat.id] || (assignment as any)?.completed_at || (assignment as any)?.created_at;
                          const timeStr = rawTime ? new Date(rawTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Completed';
                          return (
                            <div key={cat.id} className="p-3 bg-surface-container-lowest border border-outline-variant rounded-lg flex flex-col gap-1 shadow-sm relative overflow-hidden">
                              <div className="flex justify-between items-center">
                                <span className="text-[10px] font-bold text-secondary uppercase tracking-wider">
                                  {(cat.age_bracket || (cat.age_min != null && cat.age_max != null ? `${cat.age_min}-${cat.age_max}` : ""))} | {cat.weight_class || cat.belt || "-"}
                                </span>
                                <span suppressHydrationWarning className="text-[10px] font-bold text-green-600 bg-green-500/10 px-1.5 py-0.5 rounded flex items-center gap-1">
                                  <span className="material-symbols-outlined text-[12px]">done_all</span>
                                  {timeStr}
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <h5 className="text-xs font-bold text-primary flex items-center gap-1">
                                  {cat.name}
                                  {renderDrawButton(cat)}
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
                                <div className="flex items-center gap-1">
                                  {!readOnly && (
                                    <button
                                      type="button"
                                      onClick={() => setPendingRevertCategory({ ringId: ring.id, ringName: ring.name, category: cat })}
                                      className="px-2 py-0.5 text-[10px] font-bold text-amber-700 bg-amber-500/10 hover:bg-amber-500/20 rounded transition-colors flex items-center gap-1"
                                      title="Revert category to live queue"
                                    >
                                      <span className="material-symbols-outlined text-[12px]">undo</span>
                                      Revert
                                    </button>
                                  )}
                                </div>
                              </div>
                              <div className="flex gap-4 text-[10px] font-data-mono text-outline">
                                <span className="flex items-center gap-1"><span className="material-symbols-outlined text-[12px]">group</span> {cat.athletes_count}</span>
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
                <div key={ring.id} className="w-[85vw] max-w-[360px] md:w-80 lg:w-[330px] xl:w-[350px] 2xl:w-[380px] shrink-0 flex flex-col bg-white border border-outline-variant rounded-xl overflow-hidden shadow-sm h-full">
                  {/* Header Droppable Shortcut Target - Spectator Scoreboard Style */}
                  <Droppable droppableId={`header_${ring.id}`} isDropDisabled={readOnly}>
                    {(providedHeader, snapshotHeader) => (
                      <div
                        ref={providedHeader.innerRef}
                        {...providedHeader.droppableProps}
                        className={`sticky top-0 z-10 px-3.5 h-[46px] flex items-center justify-between shrink-0 relative transition-all text-white overflow-visible ${
                          snapshotHeader.isDraggingOver
                            ? 'bg-emerald-600 ring-4 ring-emerald-400/50 shadow-xl'
                            : overloaded
                            ? 'bg-red-800'
                            : ringHeaderBg
                        }`}
                      >
                        {/* Left: Mat Number & 2-Line Label */}
                        <div className="flex items-center gap-2 relative z-10 min-w-0">
                          <span className="font-scoreboard text-[26px] sm:text-[28px] font-normal leading-none tracking-wide text-white shrink-0">
                            {matNumber}
                          </span>
                          <div className="min-w-0 flex flex-col justify-center">
                            <h4 className="font-bold text-[13px] sm:text-[13.5px] tracking-tight leading-tight text-white truncate">
                              {formattedRingName}
                            </h4>
                            <span className={`text-[8.5px] font-bold tracking-wider uppercase leading-none mt-0.5 ${
                              isRingRunning 
                                ? 'text-emerald-200/90' 
                                : isRingPaused 
                                ? 'text-rose-200/80' 
                                : 'text-white/70'
                            }`}>
                              {ringCats.length} QUEUED · {completedCats.length} DONE
                            </span>
                          </div>
                        </div>

                        {/* Right: Dot Status Capsule Pill + History Button */}
                        <div className="flex items-center gap-1.5 relative z-10 shrink-0">
                          <span className="flex items-center gap-1 text-[9px] sm:text-[9.5px] font-bold tracking-wider uppercase text-white bg-black/25 px-2 py-0.5 rounded-full border border-white/10 shadow-xs">
                            <span className="relative flex h-1.5 w-1.5 shrink-0">
                              {isRingRunning && (
                                <span className="animate-pulse-ring absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-80" />
                              )}
                              <span
                                className={`relative inline-flex rounded-full h-1.5 w-1.5 ${
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
                            className="w-7 h-7 rounded-md bg-black/25 hover:bg-white/20 text-white border border-white/10 flex items-center justify-center transition-all cursor-pointer shadow-xs"
                            onClick={() => setHistoryOpenForRing(ring.id)}
                            title="View Completed Categories"
                          >
                            <span className="material-symbols-outlined text-[15px]">history</span>
                          </button>
                        </div>

                        {/* Ticket Perforation Notches - centered exactly at bottom seam */}
                        <div className="spectator-notch left -bottom-[7px]" />
                        <div className="spectator-notch right -bottom-[7px]" />

                        <div className="hidden">{providedHeader.placeholder}</div>
                      </div>
                    )}
                  </Droppable>

                  {/* Workload Info */}
                  <div className={`py-1.5 px-3 border-b border-outline-variant flex items-center justify-around ${overloaded ? 'bg-error/5' : 'bg-secondary/5'}`}>
                    <div className="flex flex-col items-center">
                      <span className={`text-[8.5px] font-label-caps font-bold leading-tight ${overloaded ? 'text-error' : 'text-on-surface-variant'}`}>EST TIME</span>
                      <span className={`font-data-mono text-[15px] font-black leading-tight ${overloaded ? 'text-error' : 'text-secondary'}`}>{calculateRingWorkload(ring.id)}</span>
                    </div>
                    <div className="h-4 w-[1px] bg-outline-variant/50"></div>
                    <div className="flex flex-col items-center">
                      <span className="text-[8.5px] font-label-caps font-bold text-on-surface-variant leading-tight">ATHLETES</span>
                      <span className={`flex items-center gap-1 font-data-mono text-[15px] font-black leading-tight ${overloaded ? 'text-error' : 'text-secondary'}`}>
                        <span className="material-symbols-outlined text-[13px]">group</span> {calculateRingAthletes(ring.id)}
                      </span>
                    </div>
                  </div>

                  {/* Queue Droppable */}
                  <Droppable droppableId={ring.id} isDropDisabled={readOnly}>
                    {(provided, snapshot) => (
                      <div
                        className={`flex-1 overflow-y-auto p-3 space-y-3 ${snapshot.isDraggingOver ? 'bg-secondary/5' : ''}`}
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                      >
                        {ringQueues[ring.id]?.map((cat, index) => (
                          <Draggable key={cat.id} draggableId={cat.id} index={index} isDragDisabled={readOnly}>
                            {(provided, snapshot) => {
                              const catAssignment = assignmentsMap[cat.id];
                              const status = catAssignment?.status;
                              const isRunning = status === 'running';
                              const isPaused = status === 'paused';
                              const isCompleted = status === 'completed';
                              const hasLeftAccent = isRunning || isPaused || isCompleted;
                              const matchesDone = catAssignment?.matches_completed || 0;
                              const matchesTotal = cat.expected_matches || 0;
                              const pct = matchesTotal > 0 ? (matchesDone / matchesTotal) * 100 : 0;
                              const stagerStatus = catAssignment?.stager_status ?? null;
                              const stagerActorName = catAssignment?.stager_name ?? null;

                              if (hasLeftAccent) {
                                return (
                                  <div
                                    ref={provided.innerRef}
                                    {...provided.draggableProps}
                                    {...provided.dragHandleProps}
                                    className={`border rounded-xl relative overflow-hidden transition-all bg-white ${
                                      isPaused
                                        ? 'border-amber-400/80 shadow-xs'
                                        : isRunning
                                        ? 'border-emerald-400/80 shadow-sm'
                                        : 'border-blue-400/60 shadow-xs opacity-90'
                                    } ${!readOnly ? 'cursor-grab active:cursor-grabbing' : ''}`}
                                  >
                                    {/* Clean Distinct Top Bar for Category Card */}
                                    <div className="px-3 py-2 border-b border-[#E1DDCF]/60 flex items-center justify-between bg-[#ECE9DF]/60">
                                      <span className="text-[10px] font-bold tracking-wider uppercase text-[#68645A] truncate">
                                        {(cat.age_bracket || (cat.age_min != null && cat.age_max != null ? `${cat.age_min}-${cat.age_max}` : ""))} | {cat.weight_class || cat.belt || "-"}
                                      </span>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        {stagerStatus && (
                                          <StagerStatusIndicator stagerStatus={stagerStatus} stagerActorName={stagerActorName} />
                                        )}
                                        <span
                                          className={`px-2 py-0.5 rounded-full text-[9.5px] font-bold flex items-center gap-1.5 border ${
                                            isPaused
                                              ? 'bg-amber-50 text-amber-800 border-amber-200'
                                              : isRunning
                                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                              : 'bg-blue-50 text-blue-800 border-blue-200'
                                          }`}
                                        >
                                          <span
                                            className={`w-1.5 h-1.5 rounded-full ${
                                              isPaused
                                                ? 'bg-amber-600'
                                                : isRunning
                                                ? 'bg-emerald-600 animate-pulse'
                                                : 'bg-blue-600'
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
                                          {renderDrawButton(cat)}
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

                                      <div className="flex items-center gap-1 text-[10px] font-data-mono text-[#68645A] mb-1.5">
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
                                    </div>
                                  </div>
                                );
                              }

                              // Pending / Queued Category Card
                              return (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  {...provided.dragHandleProps}
                                  className={`p-3 border rounded-xl relative overflow-hidden bg-white border-outline-variant hover:border-[#A19C90] transition-all ${
                                    snapshot.isDragging ? 'border-secondary shadow-lg' : 'shadow-xs'
                                  } ${!readOnly ? 'cursor-grab active:cursor-grabbing' : ''}`}
                                >
                                  <div className="flex justify-between items-center mb-1.5">
                                    <span className="text-[9.5px] font-bold uppercase tracking-wider text-[#68645A]">
                                      {(cat.age_bracket || (cat.age_min != null && cat.age_max != null ? `${cat.age_min}-${cat.age_max}` : ""))} | {cat.weight_class || cat.belt || "-"}
                                    </span>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      {renderDrawButton(cat)}
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
                                  <div className="flex justify-between items-center text-[10px] font-data-mono text-[#68645A]">
                                    <span className="flex items-center gap-1">
                                      <span className="material-symbols-outlined text-[12px]">group</span> {cat.athletes_count}
                                    </span>
                                    <span>{cat.expected_matches} matches</span>
                                  </div>
                                </div>
                              );
                            }}
                          </Draggable>
                        ))}
                        {(!ringQueues[ring.id] || ringQueues[ring.id].length === 0) && (
                          <div className="flex-1 flex flex-col items-center justify-center py-8 px-4 text-center border-2 border-dashed border-outline-variant/60 rounded-xl my-2 text-outline/60">
                            <span className="material-symbols-outlined text-3xl mb-1 text-outline/40">
                              {readOnly ? "hourglass_empty" : "low_priority"}
                            </span>
                            <span className="text-[12px] font-semibold text-[#8C877C]">Tatami Idle</span>
                            <span className="text-[10px] text-[#A19C90] mt-0.5">
                              {readOnly ? "No categories assigned" : "Drag categories here to assign"}
                            </span>
                          </div>
                        )}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </div>
              );
            })}
          </section>
        </div>
      </div>
      </DragDropContext>



      {/* Confirmation Modal */}
      {pendingDragResult && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setPendingDragResult(null);
            }
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (confirmText.trim().toLowerCase() === "confirm" && pendingDragResult) {
                executeDrag(pendingDragResult);
                setPendingDragResult(null);
              }
            }}
            className="bg-surface-container-lowest rounded-xl max-w-md w-full shadow-2xl overflow-hidden flex flex-col border border-outline-variant"
          >
            <div className="p-6 bg-surface-container-low border-b border-outline-variant">
              <h3 className="font-headline-sm text-xl font-bold text-error flex items-center gap-2">
                <span className="material-symbols-outlined">warning</span>
                Confirm Move
              </h3>
            </div>
            <div className="p-6 flex flex-col gap-4">
              <p className="text-sm text-on-surface-variant">
                You are about to move a category that was already assigned to a tatami. Are you sure you want to proceed?
              </p>
              <div className="bg-error/10 p-4 rounded-lg border border-error/20">
                <label className="text-xs font-bold text-error block mb-2">Type "confirm" to proceed</label>
                <input
                  type="text"
                  autoFocus
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="confirm"
                  className="w-full bg-white border border-error/30 rounded p-2 text-sm outline-none focus:border-error focus:ring-1 focus:ring-error text-slate-900"
                />
              </div>
            </div>
            <div className="p-4 bg-surface-container flex justify-end gap-3 border-t border-outline-variant">
              <button
                type="button"
                onClick={() => setPendingDragResult(null)}
                className="px-4 py-2 text-sm font-bold text-on-surface-variant hover:bg-surface-container-high rounded transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={confirmText.trim().toLowerCase() !== "confirm"}
                className="px-4 py-2 bg-error text-white text-sm font-bold rounded hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Proceed with Move
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Revert Category Confirmation Modal */}
      {pendingRevertCategory && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setPendingRevertCategory(null);
            }
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleConfirmRevert();
            }}
            className="bg-surface-container-lowest rounded-xl max-w-md w-full shadow-2xl overflow-hidden flex flex-col border border-outline-variant"
          >
            <div className="p-6 bg-surface-container-low border-b border-outline-variant flex items-center justify-between">
              <h3 className="font-headline-sm text-xl font-bold text-amber-700 flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-600">undo</span>
                Confirm Revert to Queue
              </h3>
              <button
                type="button"
                onClick={() => setPendingRevertCategory(null)}
                className="p-1 rounded text-outline hover:text-on-surface hover:bg-surface-container-high transition-colors"
                title="Cancel (Esc)"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            <div className="p-6 flex flex-col gap-4">
              <p className="text-sm text-on-surface leading-relaxed">
                Are you sure you want to pull <strong className="text-primary font-bold">{pendingRevertCategory.category.name}</strong> back to <strong className="text-primary font-bold">{pendingRevertCategory.ringName.replace(/Ring/i, "Tatami")}</strong>'s active queue?
              </p>
              <div className="bg-amber-500/10 p-3.5 rounded-lg border border-amber-500/20 text-xs text-amber-900 space-y-1.5">
                <div className="font-bold flex items-center gap-1 text-amber-800">
                  <span className="material-symbols-outlined text-[16px]">info</span>
                  What will happen:
                </div>
                <ul className="list-disc list-inside text-[11px] text-amber-900/80 space-y-0.5 ml-1">
                  <li>Completion status will be cleared and reset back to <strong>pending</strong>.</li>
                  <li>Category will be restored to the bottom of the active tatami stack.</li>
                  <li>Tatami moderator will see it back in their active queue.</li>
                </ul>
              </div>
            </div>
            <div className="p-4 bg-surface-container flex justify-end items-center gap-3 border-t border-outline-variant">
              <button
                type="button"
                onClick={() => setPendingRevertCategory(null)}
                className="px-4 py-2 text-sm font-bold text-on-surface-variant hover:bg-surface-container-high rounded transition-colors"
              >
                Cancel <span className="text-xs opacity-60">(Esc)</span>
              </button>
              <button
                type="submit"
                autoFocus
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white text-sm font-bold rounded shadow transition-colors flex items-center gap-1.5 focus:ring-2 focus:ring-amber-500 focus:outline-none cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">undo</span>
                Revert to Queue <span className="text-xs opacity-80">(Enter)</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 80% Floating PDF Viewer Modal with blurred background */}
      <PdfViewerModal
        url={viewingPdf?.url || null}
        title={viewingPdf?.title}
        onClose={() => setViewingPdf(null)}
      />

      {/* Live draw for whichever category the board asked for */}
      {bracketCategory && (
        <DrawBracketModal
          categoryId={bracketCategory.id}
          categoryName={bracketCategory.name}
          isOpen={Boolean(bracketCategory)}
          onClose={() => setBracketCategory(null)}
        />
      )}
    </div>
  );
}
