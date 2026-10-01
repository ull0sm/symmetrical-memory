"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import Link from "next/link";
import { formatDisplayDateWithWeekday } from "@/lib/utils";
import { matchesCategorySearch } from "@/lib/searchUtils";
import { getTournamentActiveBouts } from "@/actions/matches";
import { searchTournamentAthletes } from "@/actions/athletes";
import { getPublicFloorData } from "@/actions/public";
import { DrawBracketModal } from "@/components/draw/DrawBracketModal";
import { useLiveEvents } from "@/hooks/useLiveEvents";
import "./public-spectator.css";

interface Tournament {
  id: string;
  name: string;
  event_date?: string;
  venue?: string;
  city?: string;
  status?: string;
  show_public_draws?: boolean;
  show_public_scoreboard?: boolean;
}

interface Ring {
  id: string;
  name: string;
  ring_order: number;
  mat_name?: string;
  access_code?: string;
  tournament_id: string;
}

interface CategoryAssignment {
  id: string;
  ring_id: string;
  category_id: string;
  queue_order: number;
  status: "pending" | "running" | "paused" | "completed";
  matches_completed: number;
  completed_at?: string;
  categories?: {
    name: string;
    athletes_count: number;
    expected_matches: number;
  };
}

interface AthleteSearchResult {
  id: string;
  name: string;
  chest_number?: string;
  category_id?: string;
  categories?: any;
}

const statusMeta = {
  run: { cls: "spectator-status-run", label: "LIVE" },
  pause: { cls: "spectator-status-pause", label: "PAUSED" },
  idle: { cls: "spectator-status-idle", label: "IDLE" },
  queued: { cls: "spectator-status-queued", label: "QUEUED" },
  unscheduled: { cls: "spectator-status-unscheduled", label: "UNSCHEDULED" },
};

function tileMarkup(completed: number, total: number) {
  const safeTotal = Math.max(1, total);
  const safeCompleted = Math.min(safeTotal, Math.max(0, completed));
  const pct = Math.round((safeCompleted / safeTotal) * 100);
  const filled = Math.min(10, Math.round((safeCompleted / safeTotal) * 10));
  return { pct, filled };
}

const SEARCH_PHRASES = [
  "Search by athlete name...",
  "Search by category (e.g. U14_30-35kg)...",
  "Search by chest #, weight, or division...",
];

export default function PublicEventClient({
  tournament,
  initialRings,
  initialAssignments,
  categories,
}: {
  tournament: Tournament;
  initialRings: Ring[];
  initialAssignments: CategoryAssignment[];
  categories: any[];
}) {
  const [rings, setRings] = useState<Ring[]>(initialRings);
  const [assignments, setAssignments] = useState<CategoryAssignment[]>(initialAssignments);
  const [flashingMatId, setFlashingMatId] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [viewingBracket, setViewingBracket] = useState<{
    categoryId: string;
    categoryName: string;
    activeMatchId?: string;
  } | null>(null);
  const [activeBouts, setActiveBouts] = useState<Record<string, any>>({});
  const [viewingAthleteDraw, setViewingAthleteDraw] = useState<{
    athleteId: string;
    categoryId: string;
    athleteName: string;
    categoryName: string;
  } | null>(null);
  const isPublicDrawsEnabled = tournament.show_public_draws === true;
  const isPublicScoreboardEnabled = tournament.show_public_scoreboard === true;

  // Poll active bouts across all tournament tatamis. The live feed below is the
  // fast path; this is the safety net, so it runs on a relaxed cadence and
  // reports a failure once instead of every tick.
  const fetchActiveBouts = React.useCallback(async () => {
    try {
      const bouts = await getTournamentActiveBouts(tournament.id);
      setActiveBouts(bouts);
    } catch (e) {
      console.error("Live bout data is unavailable; retrying quietly in the background.", e);
    }
  }, [tournament.id]);

  useLiveEvents({ tournamentId: tournament.id }, fetchActiveBouts);

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;
    let reportedFailure = false;

    const fetchBouts = async () => {
      try {
        const bouts = await getTournamentActiveBouts(tournament.id);
        if (mounted) setActiveBouts(bouts);
        reportedFailure = false;
      } catch (e) {
        if (!reportedFailure) {
          reportedFailure = true;
          console.error("Live bout data is unavailable; retrying quietly in the background.", e);
        }
      }
    };

    const schedule = async () => {
      if (!mounted) return;
      await fetchBouts();
      if (!mounted) return;
      timer = setTimeout(schedule, document.hidden ? 60000 : 20000);
    };

    void schedule();

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [tournament.id]);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AthleteSearchResult[]>([]);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isSearching, setIsSearching] = useState(false);

  // Animated typewriter placeholder with blinking cursor
  const [typedPlaceholder, setTypedPlaceholder] = useState("");
  const [isCursorBlinking, setIsCursorBlinking] = useState(true);

  // Realtime sync timer
  const [secondsAgo, setSecondsAgo] = useState(0);

  const searchWrapRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const matCardsRef = useRef<{ [key: string]: HTMLDivElement | null }>({});

  // Blinking cursor
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    const cursorInterval = setInterval(() => {
      setIsCursorBlinking((prev) => !prev);
    }, 530);
    return () => clearInterval(cursorInterval);
  }, []);

  // Typewriter effect
  useEffect(() => {
    let phraseIdx = 0;
    let charIdx = 0;
    let isDeleting = false;
    let timer: NodeJS.Timeout;

    const tick = () => {
      const fullPhrase = SEARCH_PHRASES[phraseIdx];

      if (!isDeleting) {
        charIdx++;
        setTypedPlaceholder(fullPhrase.substring(0, charIdx));

        if (charIdx >= fullPhrase.length) {
          isDeleting = true;
          timer = setTimeout(tick, 1800);
          return;
        }
        timer = setTimeout(tick, 70);
      } else {
        charIdx--;
        setTypedPlaceholder(fullPhrase.substring(0, charIdx));

        if (charIdx <= 0) {
          isDeleting = false;
          phraseIdx = (phraseIdx + 1) % SEARCH_PHRASES.length;
          timer = setTimeout(tick, 350);
          return;
        }
        timer = setTimeout(tick, 35);
      }
    };

    timer = setTimeout(tick, 200);
    return () => clearTimeout(timer);
  }, []);

  // Sync Timer
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsAgo((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const syncTimeText = useMemo(() => {
    if (secondsAgo <= 2) return "just now";
    return `${secondsAgo}s ago`;
  }, [secondsAgo]);

  // Flash card trigger
  const triggerFlash = (matId: string, duration = 1200) => {
    setFlashingMatId(matId);
    setTimeout(() => {
      setFlashingMatId((prev) => (prev === matId ? null : prev));
    }, duration);
  };

  // Live sync of floor data (rings, assignments, bouts)
  const syncFloorData = useCallback(async () => {
    try {
      const data = await getPublicFloorData(tournament.id);
      if (data) {
        if (data.rings) setRings(data.rings as Ring[]);
        if (data.assignments) setAssignments(data.assignments as CategoryAssignment[]);
        setSecondsAgo(0);
      }
      const bouts = await getTournamentActiveBouts(tournament.id);
      if (bouts) setActiveBouts(bouts);
    } catch (err) {
      console.error("[public] syncFloorData error:", err);
    }
  }, [tournament.id]);

  // Realtime Subscriptions via SSE
  useLiveEvents({ tournamentId: tournament.id }, (event) => {
    if (event?.ringId) {
      triggerFlash(event.ringId);
    }
    syncFloorData();
  });

  // Athlete & Category Search Query
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setIsSearchOpen(false);
      return;
    }

    setIsSearching(true);
    setSearchError(null);
    const cleanQ = q.replace(/^#/, "").trim();

    const fetchAthletes = async () => {
      try {
        const athletes = await searchTournamentAthletes(tournament.id, cleanQ);
        setSearchResults(athletes as AthleteSearchResult[]);
      } catch (err) {
        console.error("Public search error:", err);
        setSearchError("Search is temporarily unavailable. Please try again in a moment.");
        setSearchResults([]);
      } finally {
        setIsSearching(false);
        setIsSearchOpen(true);
        setActiveIndex(-1);
      }
    };

    setSearchResults([]);
    setActiveIndex(-1);

    const debounce = setTimeout(fetchAthletes, 200);
    return () => clearTimeout(debounce);
  }, [searchQuery, tournament.id]);

  // Outside click listener for search
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) {
        setIsSearchOpen(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  // Compute ring assignment for athlete
  const getAthleteRingStatus = (categoryId?: string) => {
    if (!categoryId) {
      return { status: "unscheduled" as const, matLabel: "Not yet allocated", ringId: null };
    }
    const assignment = assignments.find((a) => a.category_id === categoryId);
    if (!assignment) {
      return { status: "unscheduled" as const, matLabel: "Not yet allocated", ringId: null };
    }
    const ring = rings.find((r) => r.id === assignment.ring_id);
    if (!ring) {
      return { status: "unscheduled" as const, matLabel: "Not yet allocated", ringId: null };
    }

    const ringOrderNum = String(ring.ring_order || 1).padStart(2, "0");
    const matLabel = ring.mat_name
      ? `Tatami ${ringOrderNum} · ${ring.mat_name}`
      : `Tatami ${ringOrderNum}`;

    if (assignment.status === "running") {
      return { status: "run" as const, matLabel, ringId: ring.id };
    }
    if (assignment.status === "paused") {
      return { status: "pause" as const, matLabel, ringId: ring.id };
    }
    if (assignment.status === "pending") {
      return { status: "queued" as const, matLabel, ringId: ring.id };
    }
    return { status: "idle" as const, matLabel, ringId: ring.id };
  };

  const getCategoryName = (categoryId?: string, athleteCategory?: any) => {
    if (athleteCategory) {
      const catObj = Array.isArray(athleteCategory) ? athleteCategory[0] : athleteCategory;
      if (catObj?.name) return catObj.name as string;
    }
    if (categoryId && categories) {
      const match = categories.find((c) => c.id === categoryId);
      if (match?.name) return match.name as string;
    }
    return null;
  };

  const handleAthleteClick = (
    athlete: AthleteSearchResult,
    ringId: string | null,
    categoryName: string
  ) => {
    setIsSearchOpen(false);

    // Their own path through the draw answers "where am I?" better than anything else.
    if (athlete.category_id) {
      setViewingAthleteDraw({
        athleteId: athlete.id,
        categoryId: athlete.category_id,
        athleteName: athlete.name,
        categoryName: categoryName || "Category",
      });
      return;
    }

    if (ringId) {
      const card = matCardsRef.current[ringId];
      if (card) {
        card.scrollIntoView({ behavior: "smooth", block: "center" });
        triggerFlash(ringId, 1600);
      }
    }
  };

  /** Wrap the part of the text the spectator actually typed. */
  const renderHighlighted = (text: string, query: string) => {
    const needle = query.trim().replace(/^#/, "");
    if (!text || needle.length < 1) return text;

    const index = text.toLowerCase().indexOf(needle.toLowerCase());
    if (index === -1) return text;

    return (
      <>
        {text.slice(0, index)}
        <mark className="rounded bg-[#FDE68A] px-0.5 text-[#1B1815]">
          {text.slice(index, index + needle.length)}
        </mark>
        {text.slice(index + needle.length)}
      </>
    );
  };

  const selectMatch = (matId: string | null) => {
    setIsSearchOpen(false);
    if (!matId) return;
    const card = matCardsRef.current[matId];
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      triggerFlash(matId, 1600);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isSearchOpen || searchResults.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, searchResults.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && searchResults[activeIndex]) {
        const athlete = searchResults[activeIndex];
        const { ringId } = getAthleteRingStatus(athlete.category_id);
        const categoryName = getCategoryName(athlete.category_id, athlete.categories);
        handleAthleteClick(athlete, ringId, categoryName || "Category");
      }
    } else if (e.key === "Escape") {
      setIsSearchOpen(false);
    }
  };

  const runningCount = useMemo(() => {
    return rings.filter((ring) => {
      const active = assignments.find((a) => a.ring_id === ring.id && a.status === "running");
      return !!active;
    }).length;
  }, [rings, assignments]);

  /**
   * Live/past depends on today's date in the *viewer's* timezone, which the
   * server cannot know. Computing it during render made the server and the
   * browser disagree (React hydration error), so it is settled after mount and
   * the first paint shows a neutral state on both sides.
   */
  const [eventPhase, setEventPhase] = useState<"live" | "past" | "upcoming" | null>(null);

  useEffect(() => {
    if (tournament.status === "completed" || tournament.status === "archived") {
      setEventPhase("past");
      return;
    }
    if (tournament.status === "live") {
      setEventPhase("live");
      return;
    }

    if (tournament.event_date) {
      const now = new Date();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
        now.getDate()
      ).padStart(2, "0")}`;

      // Compare the calendar day as written, not a parsed instant.
      const rawKey = String(tournament.event_date).split("T")[0];

      if (rawKey === todayStr) {
        setEventPhase("live");
      } else if (rawKey > todayStr) {
        setEventPhase("upcoming");
      } else {
        setEventPhase("past");
      }
      return;
    }

    setEventPhase(runningCount > 0 ? "live" : "upcoming");
  }, [tournament.status, tournament.event_date, runningCount]);

  // Eyebrow text
  const eyebrowText = useMemo(() => {
    if (tournament.venue && tournament.city) {
      return `${tournament.venue}, ${tournament.city}`;
    }
    if (tournament.event_date) {
      return formatDisplayDateWithWeekday(tournament.event_date);
    }
    return "TOURNAMENT FLOOR";
  }, [tournament]);

  return (
    <div className="spectator-root">
      <div className="spectator-page">
        {/* ---------- Header ---------- */}
        <header className="spectator-header">
          <div className="spectator-header__top">
            <Link href="/" className="spectator-back-link">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6" />
              </svg>
              All events
            </Link>
            {eventPhase === "live" ? (
              <span className="spectator-live-chip">
                <span className="spectator-beacon"></span>LIVE
              </span>
            ) : eventPhase === "past" ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#ECE9DF] text-[#7A756B] border border-[#E1DDCF] text-[11px] font-bold tracking-wider uppercase font-['Inter',sans-serif]">
                <span className="w-2 h-2 rounded-full bg-[#8C877C]"></span>OVER
              </span>
            ) : eventPhase === null ? (
              <span className="spectator-status spectator-status-idle" aria-hidden="true">
                <span className="dot"></span>
                …
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#2563EB]/10 text-[#1D4ED8] border border-[#2563EB]/20 text-[11px] font-extrabold tracking-wider uppercase font-['Inter',sans-serif]">
                <span className="w-2 h-2 rounded-full bg-[#2563EB]"></span>UPCOMING
              </span>
            )}
          </div>
          <p className="spectator-eyebrow" suppressHydrationWarning>{eyebrowText}</p>
          <h1 className="spectator-header__title">{tournament.name}</h1>
        </header>

        {/* ---------- Search Box ---------- */}
        <div className="spectator-search-wrap" ref={searchWrapRef}>
          <div className="spectator-search-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              id="search-input"
              placeholder={typedPlaceholder ? `${typedPlaceholder}${isCursorBlinking ? "|" : " "}` : "Search..."}
              autoComplete="off"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => {
                if (searchQuery.trim().length > 0 && searchResults.length > 0) {
                  setIsSearchOpen(true);
                }
              }}
            />
            {searchQuery.length > 0 && (
              <button
                className="spectator-search-clear"
                id="search-clear"
                aria-label="Clear search"
                onClick={() => {
                  setSearchQuery("");
                  setSearchResults([]);
                  setIsSearchOpen(false);
                  searchInputRef.current?.focus();
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Search Dropdown Results */}
          <div
            className={`spectator-search-results ${isSearchOpen ? "open" : ""}`}
            id="search-results"
            role="listbox"
          >
            {isSearching ? (
              <div className="spectator-no-results">Searching athletes…</div>
            ) : searchError ? (
              <div className="spectator-no-results">{searchError}</div>
            ) : searchResults.length === 0 ? (
              <div className="spectator-no-results">
                No athletes match “{searchQuery.trim()}”. Try a full name, chest number, or division.
              </div>
            ) : (
              searchResults.map((a, i) => {
                const { status, matLabel, ringId } = getAthleteRingStatus(a.category_id);
                const meta = statusMeta[status];
                const parts = matLabel.match(/(Tatami \d+)(.*)/);
                const displayCategoryName = getCategoryName(a.category_id, a.categories) || "Uncategorized";

                return (
                  <div
                    key={a.id}
                    className={`spectator-result-row ${activeIndex === i ? "active" : ""}`}
                    role="option"
                    aria-selected={activeIndex === i}
                    data-index={i}
                    data-mat-id={ringId || ""}
                    onClick={() => handleAthleteClick(a, ringId, displayCategoryName)}
                  >
                    {/* Top Row: Chest & Athlete Name on Left, Status Badge on Right */}
                    <div className="spectator-result-top">
                      <div className="spectator-result-name-group">
                        <span className="spectator-result-chest mono">
                          #{renderHighlighted(a.chest_number || "-", searchQuery)}
                        </span>
                        <span className="spectator-result-name">
                          {renderHighlighted(a.name, searchQuery)}
                        </span>
                      </div>
                      <span className={`spectator-status ${meta.cls}`}>
                        <span className="dot"></span>
                        {meta.label}
                      </span>
                    </div>

                    {/* Bottom Row: Category & View Draws on Left, Tatami Mat Info on Right */}
                    <div className="spectator-result-bottom">
                      <div className="spectator-result-category-wrap">
                        <span className="spectator-result-division">
                          {displayCategoryName}
                        </span>
                        {a.category_id && (
                          <button
                            type="button"
                            className="spectator-pdf-chip"
                            onClick={(e) => {
                              e.stopPropagation();
                              setIsSearchOpen(false);
                              setViewingAthleteDraw({
                                athleteId: a.id,
                                categoryId: a.category_id!,
                                athleteName: a.name,
                                categoryName: displayCategoryName,
                              });
                            }}
                            title={`View bracket for ${displayCategoryName} with ${a.name} highlighted`}
                          >
                            <span className="material-symbols-outlined text-[14px] text-[#0E9C7C]">account_tree</span>
                            <span className="spectator-draws-link font-bold">View Draw</span>
                          </button>
                        )}
                      </div>

                      <div className="spectator-result-mat">
                        {parts ? (
                          <>
                            <strong>{parts[1]}</strong>
                            {parts[2]}
                          </>
                        ) : (
                          matLabel
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ---------- Section Head ---------- */}
        <div className="spectator-section-head">
          <span className="spectator-section-title">Tournament floor</span>
          <div className="spectator-legend">
            <span className="spectator-legend-item">
              <span className="spectator-legend-dot run"></span>Running
            </span>
            <span className="spectator-legend-item">
              <span className="spectator-legend-dot pause"></span>Paused
            </span>
            <span className="spectator-legend-item">
              <span className="spectator-legend-dot idle"></span>Idle
            </span>
          </div>
        </div>

        {/* ---------- Mat Grid ---------- */}
        <div className="spectator-mat-grid" id="mat-grid">
          {rings.map((ring) => {
            const activeAssignment = assignments.find(
              (a) => a.ring_id === ring.id && (a.status === "running" || a.status === "paused")
            );
            const nextAssignment = assignments.find(
              (a) => a.ring_id === ring.id && a.status === "pending"
            );

            const state: "run" | "pause" | "idle" =
              activeAssignment?.status === "running"
                ? "run"
                : activeAssignment?.status === "paused"
                  ? "pause"
                  : "idle";

            const statusLabel =
              state === "run" ? "RUNNING" : state === "pause" ? "PAUSED" : "IDLE";

            const matNum = ring.ring_order
              ? String(ring.ring_order).padStart(2, "0")
              : ring.name.replace(/[^0-9]/g, "").padStart(2, "0") || "01";

            const subLabel = ring.mat_name || (ring.name.toLowerCase().includes("ring") ? `Mat ${ring.name.replace(/[^0-9]/g, "")}` : ring.name);

            const completed = activeAssignment?.matches_completed || 0;
            const total = activeAssignment?.categories?.expected_matches || 1;
            const { pct, filled } = tileMarkup(completed, total);

            const isFlashing = flashingMatId === ring.id;

            return (
              <div
                key={ring.id}
                ref={(el) => {
                  matCardsRef.current[ring.id] = el;
                }}
                className={`spectator-mat-card spectator-state-${state} ${isFlashing ? "flash" : ""
                  }`}
                data-mat-id={ring.id}
              >
                {/* Scoreboard Band */}
                <div className="spectator-mat-card__band">
                  <div className="spectator-mat-id">
                    <span className="spectator-mat-num scoreboard">{matNum}</span>
                    {subLabel && <span className="spectator-mat-sub">{subLabel}</span>}
                  </div>
                  <span className="spectator-band-status">
                    <span className="dot"></span>
                    {statusLabel}
                  </span>
                </div>

                {/* Perforation Notches */}
                <div className="spectator-notch left"></div>
                <div className="spectator-notch right"></div>

                {/* Card Inner */}
                <div className="spectator-mat-card__inner">
                  <div className="spectator-mat-card__body">
                    {state === "run" && activeAssignment && (
                      <>
                        <p className="spectator-division">
                          {activeAssignment.categories?.name}
                        </p>
                        <div className="spectator-progress-block">
                          <div className="spectator-tiles">
                            {Array.from({ length: 10 }).map((_, i) => (
                              <div
                                key={i}
                                className={`spectator-tile ${i < filled ? "filled" : ""}`}
                              />
                            ))}
                          </div>
                          <div className="spectator-progress-label">
                            <span>
                              Match <span className="mono">{completed}</span> of{" "}
                              <span className="mono">{total}</span>
                            </span>
                            <span className="spectator-progress-pct mono">{pct}%</span>
                          </div>
                        </div>
                      </>
                    )}

                    {state === "pause" && activeAssignment && (
                      <>
                        <div className="spectator-alert-row">
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <circle cx="12" cy="12" r="9" />
                            <path d="M12 8v4M12 16h.01" />
                          </svg>
                          Ring paused / Timeout
                        </div>
                        <p className="spectator-division">
                          {activeAssignment.categories?.name}
                        </p>
                        <div className="spectator-progress-block">
                          <div className="spectator-tiles">
                            {Array.from({ length: 10 }).map((_, i) => (
                              <div
                                key={i}
                                className={`spectator-tile ${i < filled ? "filled" : ""}`}
                              />
                            ))}
                          </div>
                          <div className="spectator-progress-label">
                            <span>
                              Match <span className="mono">{completed}</span> of{" "}
                              <span className="mono">{total}</span>
                            </span>
                            <span className="spectator-progress-pct mono">{pct}%</span>
                          </div>
                        </div>
                      </>
                    )}

                    {/* Live Bout Preview & Quick Actions */}
                    {(state === "run" || state === "pause") && activeAssignment && (() => {
                      const ringBout = activeBouts[ring.id];
                      const curMatch = ringBout?.currentMatch;
                      return (
                        <div className="mt-3.5 space-y-2.5 pt-2.5 border-t border-[#E1DDCF]/40">
                          {curMatch ? (
                            <div className="spectator-bout">
                              <div className="spectator-bout__head">
                                <span className="spectator-bout__label">
                                  <span className="spectator-bout__pip" />
                                  Bout {curMatch.matchNo} · {curMatch.roundName || "Match"}
                                </span>
                                <span
                                  className={`spectator-status ${
                                    curMatch.status === "LIVE"
                                      ? "spectator-status-run"
                                      : curMatch.status === "CONFIRMED"
                                        ? "spectator-status-idle"
                                        : "spectator-status-queued"
                                  }`}
                                >
                                  <span className="dot"></span>
                                  {curMatch.status}
                                </span>
                              </div>

                              <div className="spectator-bout__sides">
                                <div className="spectator-bout__side spectator-bout__side--aka">
                                  <div className="min-w-0">
                                    <span className="spectator-bout__corner">AKA</span>
                                    <p className="spectator-bout__name">{curMatch.aka?.name || "TBD"}</p>
                                    {curMatch.aka?.school && (
                                      <p className="spectator-bout__club">{curMatch.aka.school}</p>
                                    )}
                                  </div>
                                  <span className="spectator-bout__score mono">{curMatch.akaScore ?? 0}</span>
                                </div>

                                <div className="spectator-bout__side spectator-bout__side--ao">
                                  <div className="min-w-0">
                                    <span className="spectator-bout__corner">AO</span>
                                    <p className="spectator-bout__name">{curMatch.ao?.name || "TBD"}</p>
                                    {curMatch.ao?.school && (
                                      <p className="spectator-bout__club">{curMatch.ao.school}</p>
                                    )}
                                  </div>
                                  <span className="spectator-bout__score mono">{curMatch.aoScore ?? 0}</span>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="spectator-alert-row">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="12" cy="12" r="9" />
                                <path d="M12 8v4M12 16h.01" />
                              </svg>
                              Preparing the next bout on this mat
                            </div>
                          )}

                          <div className="flex items-center gap-2 pt-1">
                            {isPublicDrawsEnabled && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setViewingBracket({
                                    categoryId: activeAssignment.category_id,
                                    categoryName: activeAssignment.categories?.name || "Division",
                                    activeMatchId: curMatch?.id || activeBouts[ring.id]?.currentMatch?.id || activeBouts[ring.id]?.nextBout?.id,
                                  });
                                }}
                                className="flex-1 py-1.5 px-2.5 rounded-lg bg-[#0E9C7C]/10 hover:bg-[#0E9C7C]/20 text-[#0E9C7C] border border-[#0E9C7C]/30 font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer"
                                title="View interactive category elimination bracket tree with live match focus"
                              >
                                <span className="material-symbols-outlined text-[15px]">account_tree</span>
                                <span>View Draw</span>
                              </button>
                            )}

                            {isPublicScoreboardEnabled && (
                              <Link
                                href={`/scoreboard/${ring.id}`}
                                target="_blank"
                                className="py-1.5 px-3 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 font-bold text-xs flex items-center justify-center gap-1.5 transition"
                                title="Open the arena scoreboard"
                              >
                                <span className="material-symbols-outlined text-[15px]">tv</span>
                                <span>Scoreboard</span>
                              </Link>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {state === "idle" && (
                      <div className="space-y-3">
                        <p className="spectator-standby-msg">
                          Mat is clear. Ready for the next scheduled division.
                        </p>
                        {isPublicScoreboardEnabled && (
                          <div className="flex justify-end">
                            <Link
                              href={`/scoreboard/${ring.id}`}
                              target="_blank"
                              className="py-1 px-2.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 font-bold text-xs flex items-center gap-1 transition"
                            >
                              <span className="material-symbols-outlined text-[14px]">tv</span>
                              <span>Scoreboard</span>
                            </Link>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Foot / Next Queue — the next bout, and the division after it */}
                  <div className="spectator-mat-card__foot">
                    {activeBouts[ring.id]?.nextBout ? (
                      <div className="flex flex-col gap-1 min-w-0">
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span className="spectator-next-label">NEXT</span>
                          <span className="spectator-next-value truncate">
                            <span className="text-[#DC2626] font-black">AKA</span>{" "}
                            {activeBouts[ring.id].nextBout.aka?.name || "TBD"}{" "}
                            <span className="text-[#68645A]">vs</span>{" "}
                            <span className="text-[#2563EB] font-black">AO</span>{" "}
                            {activeBouts[ring.id].nextBout.ao?.name || "TBD"}
                          </span>
                        </div>
                        {nextAssignment?.categories?.name && (
                          <div className="flex items-baseline gap-2 min-w-0">
                            <span className="spectator-next-label">Then</span>
                            <span className="spectator-next-value muted truncate">
                              {nextAssignment.categories.name}
                            </span>
                          </div>
                        )}
                      </div>
                    ) : nextAssignment?.categories?.name ? (
                      <>
                        <span className="spectator-next-label">NEXT</span>
                        <span className="spectator-next-value">
                          {nextAssignment.categories.name}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="spectator-next-label">NEXT</span>
                        <span className="spectator-next-value muted">
                          No upcoming division queued
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ---------- Empty State ---------- */}
        <div
          className={`spectator-empty-state ${rings.length === 0 ? "open" : ""
            }`}
          id="empty-state"
        >
          <div className="spectator-empty-icon">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            >
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </div>
          <p className="spectator-empty-title">No tatamis configured</p>
          <p className="spectator-empty-body">
            Once mats are added to this tournament, live status and match progress
            will appear here automatically.
          </p>
        </div>
      </div>


      {/* Floating Interactive Bracket Tree Modal */}
      {viewingBracket && (
        <DrawBracketModal
          categoryId={viewingBracket.categoryId}
          categoryName={viewingBracket.categoryName}
          activeMatchId={viewingBracket.activeMatchId}
          allowPdf={false}
          isOpen={Boolean(viewingBracket)}
          onClose={() => setViewingBracket(null)}
        />
      )}

      {/* One athlete's path through the draw, reached from search */}
      {viewingAthleteDraw && (
        <DrawBracketModal
          categoryId={viewingAthleteDraw.categoryId}
          categoryName={viewingAthleteDraw.categoryName}
          athleteId={viewingAthleteDraw.athleteId}
          subtitle={`Showing ${viewingAthleteDraw.athleteName} in ${viewingAthleteDraw.categoryName}`}
          allowPdf={false}
          isOpen={Boolean(viewingAthleteDraw)}
          onClose={() => setViewingAthleteDraw(null)}
        />
      )}
    </div>
  );
}
