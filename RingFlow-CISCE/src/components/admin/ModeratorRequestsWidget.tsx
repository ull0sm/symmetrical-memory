"use client";

import React, { useCallback, useState } from "react";
import { approveModeratorRequest, rejectModeratorRequest } from "@/actions/moderator";
import { getPendingModeratorRequests } from "@/actions/admin";
import { useLiveEvents } from "@/hooks/useLiveEvents";

interface ModRequest {
  id: string;
  ring_id: string;
  status: string;
  created_at: string;
  device_info: any; // JSON
  moderator_name?: string;
  rings?: { name: string };
}

export default function ModeratorRequestsWidget({ 
  tournamentId, 
  initialRequests,
  readOnly = false,
}: { 
  tournamentId: string; 
  initialRequests: ModRequest[];
  readOnly?: boolean;
}) {
  const [requests, setRequests] = useState<ModRequest[]>(initialRequests);
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const pendingRequests = requests.filter((r) => r.status === "pending");

  /**
   * A moderator knocking on the door has to appear immediately, so the live
   * feed re-reads the list rather than waiting for the next refresh.
   */
  const refreshRequests = useCallback(async () => {
    try {
      const data = await getPendingModeratorRequests(tournamentId);
      if (data) {
        setRequests(data as ModRequest[]);
        if (data.some((r: any) => r.status === "pending")) setIsExpanded(true);
      }
    } catch (err) {
      console.error("[requests] live refresh failed:", err);
    }
  }, [tournamentId]);

  useLiveEvents({ tournamentId }, refreshRequests, { feed: "staff" });

  const handleApprove = async (id: string, ringId: string) => {
    setLoadingId(id);
    try {
      await approveModeratorRequest(id, ringId, tournamentId);
      setRequests((current) =>
        current.map((r) => (r.id === id ? { ...r, status: "approved" } : r))
      );
    } catch (e: any) {
      alert(e?.message || "Failed to approve request.");
    } finally {
      setLoadingId(null);
    }
  };

  const handleReject = async (id: string) => {
    setLoadingId(id);
    try {
      await rejectModeratorRequest(id, tournamentId);
      setRequests((current) =>
        current.map((r) => (r.id === id ? { ...r, status: "rejected" } : r))
      );
    } catch (e: any) {
      alert(e?.message || "Failed to reject request.");
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div
      className={`bg-white border rounded-xl shadow-2xs transition-all duration-200 overflow-hidden ${
        pendingRequests.length > 0
          ? "border-amber-400 ring-2 ring-amber-100 shadow-sm"
          : "border-slate-200"
      }`}
    >
      {/* ─── Header ─── */}
      <div
        role="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className={`w-full px-3.5 py-2.5 flex items-center justify-between cursor-pointer transition-colors select-none ${
          pendingRequests.length > 0 ? "bg-amber-50/60 hover:bg-amber-50" : "hover:bg-slate-50"
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${
              pendingRequests.length > 0
                ? "bg-amber-500 text-white shadow-xs animate-pulse"
                : "bg-slate-100 text-[#68645A]"
            }`}
          >
            <span className="material-symbols-outlined text-[15px]">shield_person</span>
          </div>
          <span className="text-[13px] font-semibold text-[#1B1815] whitespace-nowrap">
            Moderator Requests
          </span>
          {pendingRequests.length > 0 && (
            <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full animate-bounce shrink-0 shadow-xs">
              {pendingRequests.length} NEW
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
        <div className="p-3.5 border-t border-[#E1DDCF] max-h-[380px] overflow-y-auto space-y-3 bg-white animate-in fade-in duration-150">
          {pendingRequests.map((req) => (
            <div
              key={req.id}
              className="p-3 border border-amber-200/80 rounded-lg bg-white flex flex-col gap-2.5 shadow-2xs"
            >
              <div className="flex justify-between items-start w-full">
                <span className="font-semibold text-[11px] text-[#0B7C63] uppercase tracking-wider block">
                  {req.rings?.name ? req.rings.name.replace(/Ring/i, "Tatami") : "Unknown Tatami"}
                </span>
                <span
                  className="text-[10.5px] text-[#94A3B8] font-data-mono"
                  suppressHydrationWarning
                >
                  {new Date(req.created_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>

              {req.moderator_name && req.moderator_name !== "Unknown" && (
                <p className="text-[13px] font-semibold text-[#0F172A]">
                  {req.moderator_name}
                </p>
              )}

              {req.device_info && typeof req.device_info === "object" ? (
                <div className="text-[10.5px] text-[#64748B] font-data-mono space-y-0.5 bg-[#F8FAFC] p-2 rounded border border-[#E2E8F0]">
                  <p>
                    <span className="text-[#94A3B8]">Device:</span> {req.device_info.browser} on{" "}
                    {req.device_info.os} ({req.device_info.deviceType})
                  </p>
                  <p>
                    <span className="text-[#94A3B8]">Location:</span> {req.device_info.location}
                  </p>
                  <p>
                    <span className="text-[#94A3B8]">IP:</span> {req.device_info.ip}
                  </p>
                </div>
              ) : (
                <span className="text-[11px] text-[#94A3B8] font-data-mono">No details</span>
              )}

              {!readOnly ? (
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleApprove(req.id, req.ring_id)}
                    disabled={loadingId === req.id}
                    className="flex-1 bg-[#0E9C7C] hover:bg-[#0B7C63] text-white text-[11px] font-bold py-1.5 rounded-md hover:opacity-95 disabled:opacity-50 cursor-pointer transition-colors shadow-2xs"
                  >
                    APPROVE
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReject(req.id)}
                    disabled={loadingId === req.id}
                    className="flex-1 border border-red-200 text-red-600 hover:bg-red-50 text-[11px] font-bold py-1.5 rounded-md disabled:opacity-50 cursor-pointer transition-colors"
                  >
                    REJECT
                  </button>
                </div>
              ) : (
                <div className="text-[11px] text-[#94A3B8] font-medium py-1 px-2 bg-[#F1F5F9] rounded text-center">
                  Pending Admin Review
                </div>
              )}
            </div>
          ))}

          {pendingRequests.length === 0 && (
            <div className="py-4 flex flex-col items-center justify-center text-center text-[#94A3B8]">
              <span className="material-symbols-outlined text-3xl mb-1 text-emerald-500/70">
                check_circle
              </span>
              <span className="text-[12.5px] font-medium text-[#475569]">
                All moderator requests reviewed
              </span>
              <span className="text-[11px] text-[#94A3B8] mt-0.5">
                New access requests will auto-expand here in real-time
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
