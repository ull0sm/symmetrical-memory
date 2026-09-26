"use client";

import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { getRingActiveBout } from "@/actions/matches";
import { useMatchClock, type ClockSyncSample } from "@/hooks/useMatchClock";
import { useLiveEvents } from "@/hooks/useLiveEvents";
import { normalizeClock } from "@/lib/matchClock";
import { BoutHeader } from "@/components/scoreboard/BoutHeader";
import { ClockStage } from "@/components/scoreboard/ClockStage";
import { FighterPanel } from "@/components/scoreboard/FighterPanel";
import { NextBoutStrip } from "@/components/scoreboard/NextBoutStrip";
import { KataScoreboardStage } from "@/components/scoreboard/KataScoreboardStage";

interface Props {
  ringId: string;
  initialData: any;
}

// Poll only as often as the screen actually needs: a running clock re-anchors
// every second, an idle one rarely changes, and a hidden tab barely at all.
// The live feed below carries every change instantly; these cadences are the
// safety net for a dropped stream.
const RUNNING_POLL_MS = 4000;
const IDLE_POLL_MS = 25000;
const HIDDEN_POLL_MS = 45000;
const CHROME_HIDE_MS = 4000;
const STALE_MS = 6000;

/**
 * The arena screen. It shows the bout, the fighters, the scores and the one
 * clock everyone shares — and nothing else. Every number here comes from the
 * same server state the moderator desk writes.
 */
export function ScoreboardClient({ ringId, initialData }: Props) {
  const [data, setData] = useState<any>(initialData);
  const [sync, setSync] = useState<ClockSyncSample | null>(() =>
    initialData?.serverNow
      ? { serverNow: initialData.serverNow, sentAt: Date.now(), receivedAt: Date.now() }
      : null
  );
  const [lastSyncAt, setLastSyncAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [chromeVisible, setChromeVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [scale, setScale] = useState<number>(1);

  // Read on mount + react instantly when another tab (the moderator desk) changes it
  useEffect(() => {
    const applyScale = (raw: string | null) => {
      if (!raw) return;
      const val = parseFloat(raw);
      if (!isNaN(val) && val >= 0.5 && val <= 2) setScale(val);
    };

    applyScale(localStorage.getItem("ringflow_tv_scale"));

    const onStorage = (e: StorageEvent) => {
      if (e.key === "ringflow_tv_scale") applyScale(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const handleSetScale = (newScale: number) => {
    setScale(newScale);
    if (typeof window !== "undefined") {
      localStorage.setItem("ringflow_tv_scale", String(newScale));
    }
  };

  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentAtRef = useRef(Date.now());
  const clockStatusRef = useRef<string>("idle");

  const fetchBout = useCallback(async () => {
    sentAtRef.current = Date.now();
    try {
      const res = await getRingActiveBout(ringId);
      const receivedAt = Date.now();
      if (res) {
        setData(res);
        // Drives the poll cadence: is the clock running right now?
        clockStatusRef.current = normalizeClock(res.clock ?? res.ring).status;
        if (typeof res.serverNow === "number") {
          setSync({ serverNow: res.serverNow, sentAt: sentAtRef.current, receivedAt });
        }
        setLastSyncAt(receivedAt);
      }
    } catch (err) {
      console.error("Scoreboard fetch error:", err);
    }
  }, [ringId]);

  // Poll on a cadence the screen earns: fast only while a clock runs.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const schedule = () => {
      if (cancelled) return;
      const delay = document.hidden
        ? HIDDEN_POLL_MS
        : clockStatusRef.current === "running"
          ? RUNNING_POLL_MS
          : IDLE_POLL_MS;
      timer = setTimeout(async () => {
        await fetchBout();
        schedule();
      }, delay);
    };

    void fetchBout().then(schedule);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fetchBout]);

  // The arena screen follows the desk the moment anything changes: a score, a
  // bout swap, the clock, the next-fight strip.
  const handleLiveEvent = useCallback(
    (event?: any) => {
      // Direct zero-latency score & penalty mutation (<10ms)
      if (
        event?.table === "matches" &&
        (typeof event.akaScore === "number" || typeof event.aoScore === "number")
      ) {
        setData((prev: any) => {
          if (!prev?.currentMatch) return prev;
          return {
            ...prev,
            currentMatch: {
              ...prev.currentMatch,
              akaScore: event.akaScore ?? prev.currentMatch.akaScore,
              aoScore: event.aoScore ?? prev.currentMatch.aoScore,
              akaPenalties: event.akaPenalties ?? prev.currentMatch.akaPenalties,
              aoPenalties: event.aoPenalties ?? prev.currentMatch.aoPenalties,
              senshu: event.senshu !== undefined ? event.senshu : prev.currentMatch.senshu,
            },
          };
        });
        setLastSyncAt(Date.now());
        return;
      }

      if (event?.table === "rings" && event.data?.sidesSwapped !== undefined) {
        setData((prev: any) => {
          if (!prev?.ring) return prev;
          return {
            ...prev,
            ring: {
              ...prev.ring,
              sidesSwapped: event.data.sidesSwapped,
            },
          };
        });
        setLastSyncAt(Date.now());
        return;
      }

      void fetchBout();
    },
    [fetchBout]
  );

  useLiveEvents({ ringId }, handleLiveEvent, { debounceMs: 0 });

  // Chrome (fullscreen button, status) fades out so the screen stays clean.
  const revealChrome = useCallback(() => {
    setChromeVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setChromeVisible(false), CHROME_HIDE_MS);
  }, []);

  useEffect(() => {
    revealChrome();
    const onActivity = () => revealChrome();
    window.addEventListener("pointermove", onActivity);
    window.addEventListener("pointerdown", onActivity);
    window.addEventListener("keydown", onActivity);
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      window.removeEventListener("pointermove", onActivity);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
    };
  }, [revealChrome]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (err) {
      console.warn("Full screen is not available on this device", err);
    }
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreenChange);

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "f" || e.key === "F") {
        void toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [toggleFullscreen]);

  // Keep the arena TV awake for the length of the session.
  useEffect(() => {
    let sentinel: any = null;

    const request = async () => {
      try {
        const wakeLock = (navigator as any).wakeLock;
        if (wakeLock?.request) {
          sentinel = await wakeLock.request("screen");
        }
      } catch {
        /* not supported or denied — not a failure */
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void request();
    };

    void request();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      try {
        sentinel?.release?.();
      } catch {}
    };
  }, []);

  // Drives the "reconnecting" pill without touching the clock.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const clock = useMemo(() => normalizeClock(data?.clock ?? data?.ring), [data?.clock, data?.ring]);
  const { remainingMs, offsetMs } = useMatchClock(clock, sync);

  const currentMatch = data?.currentMatch;
  const category = data?.category;
  const ring = data?.ring;

  const isKata =
    category?.discipline === "KATA" ||
    category?.event_type === "kata" ||
    category?.eventType === "kata" ||
    category?.name?.toLowerCase().includes("kata") ||
    Boolean(currentMatch?.kataScoringMode || currentMatch?.kata_scoring_mode);

  const isPointsMode =
    category?.kata_scoring_mode === "POINTS" ||
    currentMatch?.kata_scoring_mode === "POINTS";

  const akaDisplayScore = isKata
    ? (isPointsMode ? Number(currentMatch?.aka_score_total || currentMatch?.akaScoreTotal || 0) : (currentMatch?.aka_flags ?? currentMatch?.akaFlags ?? 0))
    : (currentMatch?.akaScore ?? 0);

  const aoDisplayScore = isKata
    ? (isPointsMode ? Number(currentMatch?.ao_score_total || currentMatch?.aoScoreTotal || 0) : (currentMatch?.ao_flags ?? currentMatch?.aoFlags ?? 0))
    : (currentMatch?.aoScore ?? 0);

  const isDecided = currentMatch?.status === "CONFIRMED" || currentMatch?.status === "COMPLETED";
  const akaWon = isDecided && (currentMatch?.winnerSide === "AKA" || (currentMatch?.winnerId && currentMatch.winnerId === currentMatch.aka?.id));
  const aoWon = isDecided && (currentMatch?.winnerSide === "AO" || (currentMatch?.winnerId && currentMatch.winnerId === currentMatch.ao?.id));
  const swapped = Boolean(ring?.sidesSwapped);

  const aka = {
    side: "AKA" as const,
    fighter: currentMatch?.aka ?? { name: "TBD" },
    score: akaDisplayScore,
    penalties: isKata ? 0 : (currentMatch?.akaPenalties ?? 0),
    hasSenshu: isKata ? false : (currentMatch?.senshu === "AKA"),
    isWinner: Boolean(akaWon),
  };

  const ao = {
    side: "AO" as const,
    fighter: currentMatch?.ao ?? { name: "TBD" },
    score: aoDisplayScore,
    penalties: isKata ? 0 : (currentMatch?.aoPenalties ?? 0),
    hasSenshu: isKata ? false : (currentMatch?.senshu === "AO"),
    isWinner: Boolean(aoWon),
  };

  const left = swapped ? ao : aka;
  const right = swapped ? aka : ao;

  const connection = now - lastSyncAt > STALE_MS ? "reconnecting" : "live";

  const nextCategoryName =
    !data?.nextBout && data?.assignment?.status !== "running" ? category?.name ?? null : null;

  return (
    <div
      className={`flex h-[100dvh] w-screen flex-col overflow-hidden bg-[#100E0D] text-[#F7F5F0] select-none ${
        chromeVisible ? "" : "cursor-none"
      }`}
    >
      <BoutHeader
        tatamiName={ring?.name ?? "Tatami"}
        categoryName={category?.name ?? "No category running"}
        boutNo={currentMatch?.matchNo}
        roundName={currentMatch?.roundName}
        tournamentName={data?.tournament?.name ?? null}
        connection={connection}
        chromeVisible={chromeVisible}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        scale={scale}
        onSetScale={handleSetScale}
      />

      <main
        className={`min-h-0 flex-1 transition-transform origin-center ${
          isKata ? "flex flex-col" : "grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"
        }`}
        style={{ zoom: scale }}
      >
        {isKata ? (
          <KataScoreboardStage
            aka={aka}
            ao={ao}
            currentMatch={currentMatch}
            kataScores={data?.kataScores || []}
            isPointsMode={isPointsMode}
          />
        ) : (
          <>
            <FighterPanel {...left} mirrored={false} />
            <ClockStage
              remainingMs={remainingMs}
              status={clock.status}
              boutDecided={Boolean(isDecided)}
              offsetMs={offsetMs}
            />
            <FighterPanel {...right} mirrored />
          </>
        )}
      </main>

      <NextBoutStrip nextBout={data?.nextBout ?? null} nextCategoryName={nextCategoryName} />
    </div>
  );
}
