"use client";

import React, { useCallback, useState } from "react";
import { getLiveLogs } from "@/actions/admin";
import { useLiveEvents } from "@/hooks/useLiveEvents";

interface LogEvent {
  id: string;
  ring_id: string | null;
  category_id: string | null;
  action: string;
  metadata: any;
  created_at: string;
}

export default function LiveActivityFeed({
  tournamentId,
  initialLogs,
  rings,
}: {
  tournamentId: string;
  initialLogs: LogEvent[];
  rings: any[];
}) {
  const [logs, setLogs] = useState<LogEvent[]>(initialLogs);
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  // The feed should show what just happened, the moment it happened.
  const refreshLogs = useCallback(async () => {
    try {
      const data = await getLiveLogs(tournamentId);
      if (data) {
        setLogs(data as LogEvent[]);
        setIsExpanded(true);
      }
    } catch (err) {
      console.error("[activity] live refresh failed:", err);
    }
  }, [tournamentId]);

  useLiveEvents({ tournamentId }, (event) => {
    if (event?.table === "event_log" && event?.op === "INSERT" && event.data) {
      setLogs((current) => [event.data as LogEvent, ...current]);
      setIsExpanded(true);
    } else {
      refreshLogs();
    }
  }, { feed: "staff" });

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-2xs transition-all duration-200 overflow-hidden">
      {/* ─── Header ─── */}
      <div
        role="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3.5 py-2.5 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors select-none"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
          <span className="text-[13px] font-semibold text-[#1B1815] whitespace-nowrap">
            Live Activity Feed
          </span>
          {logs.length > 0 && (
            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full border border-emerald-200/60 shrink-0">
              {logs.length}
            </span>
          )}
        </div>

        <div className="flex items-center text-[#8C877C] hover:text-[#1B1815] p-0.5 rounded transition-colors shrink-0">
          <svg
            className={`w-3.5 h-3.5 transition-transform duration-200 ${
              isExpanded ? "rotate-180" : ""
            }`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </div>

      {/* ─── Expandable Content ─── */}
      {isExpanded && (
        <div className="p-3.5 border-t border-[#E1DDCF] max-h-[340px] overflow-y-auto space-y-3 bg-white animate-in fade-in duration-150">
          {logs.map((log) => {
            let color = "text-primary";
            let bg = "";
            let icon = "info";

            if (log.action === "EMERGENCY_ALERT") {
              color = "text-error font-extrabold";
              bg = "bg-error-container border border-error p-2 rounded";
              icon = "emergency";
            } else if (log.action === "START_CATEGORY" || log.action === "RESUME_RING") {
              color = "text-[#2e7d32]";
              icon = "play_circle";
            } else if (log.action === "FINISH_CATEGORY") {
              color = "text-secondary";
              icon = "check_circle";
            } else if (log.action === "PAUSE_RING") {
              color = "text-amber-600";
              icon = "pause_circle";
            }

            const ringName = rings.find((r) => r.id === log.ring_id)?.name || "Unknown Tatami";

            return (
              <div key={log.id} className={`flex flex-col gap-1 text-sm ${bg}`}>
                <div className="flex items-center gap-2">
                  <span
                    className={`material-symbols-outlined text-[14px] ${color}`}
                    style={{ fontVariationSettings: '"FILL" 1' }}
                  >
                    {icon}
                  </span>
                  <span
                    className="font-data-mono text-[10px] text-on-surface-variant font-medium"
                    suppressHydrationWarning
                  >
                    {new Date(log.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                </div>
                <p className="text-on-surface text-body-sm leading-snug">
                  <span className={`font-bold mr-1 ${color}`}>
                    [{ringName}] {log.action.replace(/_/g, " ").replace("RING", "TATAMI")}:
                  </span>
                  {log.metadata?.message
                    ? log.metadata.message
                    : log.metadata?.delta
                    ? `Match updated by ${log.metadata.delta}`
                    : "Event logged"}
                </p>
              </div>
            );
          })}
          {logs.length === 0 && (
            <div className="py-3 text-center text-[12px] text-[#94A3B8] italic">
              No activity yet. Logs will appear here in real-time.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
