"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { addRing, regenerateRingCode } from "@/actions/rings";
import { approveModeratorRequest, rejectModeratorRequest, revokeActiveModeratorSession } from "@/actions/moderator";
import {
  approveStagerRequest,
  rejectStagerRequest,
  revokeStagerSession,
  generateStagerCodes,
  removeStagerCode,
  getStagerRequests,
  getStagerCodes,
} from "@/actions/stager";
import { getPendingModeratorRequests } from "@/actions/admin";
import { useLiveEvents } from "@/hooks/useLiveEvents";
import { normalizeAccessCode } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type Ring = {
  id: string;
  name: string;
  ring_order: number;
  access_code: string;
};

type ModRequest = {
  id: string;
  ring_id: string;
  moderator_name: string;
  status: string;
  device_info?: any;
  created_at: string;
};

type StagerRequest = {
  id: string;
  tournament_id: string;
  access_code_used: string;
  stager_name: string;
  status: string;
  device_info?: any;
  created_at: string;
};

type StagerCode = {
  code: string;
  label: string;
};

interface Props {
  tournamentId: string;
  initialRings: Ring[];
  initialModRequests?: ModRequest[];
  initialStagerRequests?: StagerRequest[];
  initialStagerCodes?: StagerCode[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RingsClient({
  tournamentId,
  initialRings,
  initialModRequests = [],
  initialStagerRequests = [],
  initialStagerCodes = [],
}: Props) {
  const router = useRouter();

  // Tab state: "tatamis" | "stagers"
  const [activeTab, setActiveTab] = useState<"tatamis" | "stagers">("tatamis");

  // Rings / Mod state
  const [rings, setRings] = useState<Ring[]>(initialRings);
  const [modRequests, setModRequests] = useState<ModRequest[]>(initialModRequests);
  const [isAdding, setIsAdding] = useState(false);

  // Stager state
  const [stagerRequests, setStagerRequests] = useState<StagerRequest[]>(initialStagerRequests);
  const [stagerCodes, setStagerCodes] = useState<StagerCode[]>(initialStagerCodes);
  const [stagerCountInput, setStagerCountInput] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);

  // Shared loading state
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  // Sync props → state.
  //
  // Stager codes and requests are adopted only when the server actually sent
  // something: an empty refresh must never wipe what the admin just created
  // (that is what made a new code flash and disappear).
  useEffect(() => { setRings(initialRings); }, [initialRings]);
  useEffect(() => { setModRequests(initialModRequests); }, [initialModRequests]);
  useEffect(() => {
    if (initialStagerRequests && initialStagerRequests.length > 0) {
      setStagerRequests(initialStagerRequests);
    }
  }, [initialStagerRequests]);
  useEffect(() => {
    if (initialStagerCodes && initialStagerCodes.length > 0) {
      setStagerCodes(initialStagerCodes);
    }
  }, [initialStagerCodes]);

  // ── Live real-time SSE listener and periodic sync ─────────────────────────
  const refreshRingsData = React.useCallback(async () => {
    try {
      const [sReqs, sCodes, mReqs] = await Promise.all([
        getStagerRequests(tournamentId),
        getStagerCodes(tournamentId),
        getPendingModeratorRequests(tournamentId),
      ]);
      if (sReqs) setStagerRequests(sReqs as StagerRequest[]);
      if (sCodes) setStagerCodes(sCodes as StagerCode[]);
      if (mReqs) setModRequests(mReqs as ModRequest[]);
    } catch (err) {
      console.error("Failed to refresh rings data:", err);
    }
  }, [tournamentId]);

  useLiveEvents({ tournamentId }, refreshRingsData, { feed: "staff" });

  useEffect(() => {
    const poll = setInterval(refreshRingsData, 15000);
    return () => clearInterval(poll);
  }, [refreshRingsData]);

  // ── Moderator actions ──────────────────────────────────────────────────────
  const handleAddRing = async () => {
    setIsAdding(true);
    try {
      const newRing = await addRing(tournamentId);
      if (newRing) setRings((prev) => [...prev, newRing]);
      router.refresh();
    } catch (err: any) {
      alert(err?.message || "Failed to add tatami.");
    } finally {
      setIsAdding(false);
    }
  };

  const handleRegenerate = async (ringId: string) => {
    setLoadingAction(`${ringId}-regen`);
    try {
      const res = await regenerateRingCode(ringId, tournamentId);
      if (res?.access_code) {
        setRings((prev) => prev.map((r) => (r.id === ringId ? { ...r, access_code: res.access_code } : r)));
      }
      router.refresh();
    } catch (err: any) {
      alert(err?.message || "Failed to regenerate code.");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleApproveModRequest = async (requestId: string, ringId: string) => {
    setLoadingAction(`approve-${requestId}`);
    try {
      await approveModeratorRequest(requestId, ringId, tournamentId);
      setModRequests((prev) =>
        prev.map((r) => {
          if (r.id === requestId) return { ...r, status: "approved" };
          if (r.ring_id === ringId && r.status === "approved") return { ...r, status: "revoked" };
          return r;
        })
      );
      router.refresh();
    } catch (err: any) {
      alert(err?.message || "Failed to approve moderator.");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleRejectModRequest = async (requestId: string) => {
    setLoadingAction(`reject-${requestId}`);
    try {
      await rejectModeratorRequest(requestId, tournamentId);
      setModRequests((prev) => prev.map((r) => (r.id === requestId ? { ...r, status: "rejected" } : r)));
      router.refresh();
    } catch (err: any) {
      alert(err?.message || "Failed to reject request.");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleRevokeModSession = async (ringId: string) => {
    if (!confirm("Are you sure you want to log out the active moderator on this Tatami?")) return;
    setLoadingAction(`revoke-${ringId}`);
    try {
      await revokeActiveModeratorSession(ringId, tournamentId);
      setModRequests((prev) =>
        prev.map((r) => (r.ring_id === ringId && r.status === "approved" ? { ...r, status: "revoked" } : r))
      );
      router.refresh();
    } catch (err: any) {
      alert(err?.message || "Failed to revoke moderator session.");
    } finally {
      setLoadingAction(null);
    }
  };

  // ── Stager actions ─────────────────────────────────────────────────────────
  const handleGenerateCodes = async () => {
    setIsGenerating(true);
    try {
      const res = await generateStagerCodes(tournamentId, stagerCountInput);

      if (!res?.success || !res.stager_codes) {
        alert(("error" in res && res.error) || "Could not generate stager codes.");
        return;
      }

      setStagerCodes(res.stager_codes);
      router.refresh();
    } catch (err: any) {
      alert(err?.message || "Failed to generate stager codes.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRemoveCode = async (code: string) => {
    if (!confirm(`Remove stager code ${code}? Any active session using this code will still work until it expires.`)) return;
    setLoadingAction(`remove-${code}`);
    try {
      const res = await removeStagerCode(tournamentId, code);
      if (res?.stager_codes) setStagerCodes(res.stager_codes);
      router.refresh();
    } catch (err: any) {
      alert(err?.message || "Failed to remove code.");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleApproveStager = async (requestId: string) => {
    setLoadingAction(`approve-stager-${requestId}`);
    try {
      await approveStagerRequest(requestId, tournamentId);
      setStagerRequests((prev) => prev.map((r) => (r.id === requestId ? { ...r, status: "approved" } : r)));
      router.refresh();
    } catch (err: any) {
      alert(err?.message || "Failed to approve stager.");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleRejectStager = async (requestId: string) => {
    setLoadingAction(`reject-stager-${requestId}`);
    try {
      await rejectStagerRequest(requestId, tournamentId);
      setStagerRequests((prev) => prev.map((r) => (r.id === requestId ? { ...r, status: "rejected" } : r)));
      router.refresh();
    } catch (err: any) {
      alert(err?.message || "Failed to reject stager.");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleRevokeStager = async (requestId: string) => {
    if (!confirm("Are you sure you want to revoke this stager's session?")) return;
    setLoadingAction(`revoke-stager-${requestId}`);
    try {
      await revokeStagerSession(requestId, tournamentId);
      setStagerRequests((prev) => prev.map((r) => (r.id === requestId ? { ...r, status: "revoked" } : r)));
      router.refresh();
    } catch (err: any) {
      alert(err?.message || "Failed to revoke stager.");
    } finally {
      setLoadingAction(null);
    }
  };

  // ── Derived data ───────────────────────────────────────────────────────────
  const pendingStagers = stagerRequests.filter((r) => r.status === "pending");
  const approvedStagers = stagerRequests.filter((r) => r.status === "approved");

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-margin-desktop space-y-8 bg-surface pb-24 w-full">

      {/* Page Title & Tab Switcher */}
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="font-headline-sm text-headline-sm text-primary">Access Management</h2>
          <p className="text-body-sm text-on-surface-variant">
            Manage Tatami Moderators and Stager access codes for this tournament.
          </p>
        </div>

        {/* Tab Bar */}
        <div className="flex gap-1 p-1 bg-surface-container-low border border-outline-variant rounded-xl w-fit">
          <button
            onClick={() => setActiveTab("tatamis")}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg font-label-caps text-label-caps transition-all ${
              activeTab === "tatamis"
                ? "bg-primary text-on-primary shadow-sm"
                : "text-on-surface-variant hover:bg-surface-container-high"
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">grid_view</span>
            Tatamis
          </button>
          <button
            onClick={() => setActiveTab("stagers")}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg font-label-caps text-label-caps transition-all relative ${
              activeTab === "stagers"
                ? "bg-primary text-on-primary shadow-sm"
                : "text-on-surface-variant hover:bg-surface-container-high"
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">sports_kabaddi</span>
            Stagers
            {pendingStagers.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-error text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                {pendingStagers.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ── TAB: TATAMIS ── */}
      {activeTab === "tatamis" && (
        <>
          <div className="flex justify-between items-center">
            <div>
              <h3 className="font-headline-sm text-lg text-primary font-bold">Tatami Moderators</h3>
              <p className="text-body-sm text-on-surface-variant">Approve incoming moderator logins and manage access codes per Tatami.</p>
            </div>
            <button
              onClick={handleAddRing}
              disabled={isAdding}
              className="px-4 py-2 bg-primary text-white font-label-caps text-label-caps rounded flex items-center gap-2 hover:opacity-90 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              {isAdding ? "ADDING..." : "ADD TATAMI"}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-start">
            {rings.map((ring) => {
              const ringPendingReqs = modRequests.filter((r) => r.ring_id === ring.id && r.status === "pending");
              const activeApprovedReq = modRequests.find((r) => r.ring_id === ring.id && r.status === "approved");

              return (
                <div key={ring.id} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm flex flex-col space-y-5">
                  <div>
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="font-headline-sm text-lg text-primary font-bold">{ring.name.replace(/Ring/i, "Tatami")}</h3>
                        <span className="px-2 py-0.5 bg-surface-container text-on-surface-variant rounded text-[10px] font-label-caps">
                          Tatami {ring.ring_order}
                        </span>
                      </div>
                      {activeApprovedReq ? (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-500/10 border border-green-500/30 rounded-md text-green-700 text-[10px] font-bold">
                          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                          ACTIVE: {activeApprovedReq.moderator_name}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 px-2 py-0.5 bg-surface-container text-on-surface-variant opacity-60 rounded text-[10px] font-label-caps">
                          NO MODERATOR
                        </div>
                      )}
                    </div>

                    <div className="p-4 bg-surface-container-low border border-outline-variant rounded-lg flex flex-col items-center">
                      <span className="text-[10px] font-label-caps text-on-surface-variant mb-1">MODERATOR ACCESS CODE</span>
                      <span className="font-data-mono text-3xl font-black text-secondary tracking-widest">{ring.access_code}</span>
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2 border-t border-outline-variant/40">
                    <button
                      onClick={() => handleRegenerate(ring.id)}
                      disabled={loadingAction === `${ring.id}-regen`}
                      className="flex-1 py-1.5 bg-surface-container hover:bg-surface-container-high border border-outline-variant rounded font-label-caps text-[10px] text-primary transition-colors flex justify-center items-center gap-1.5 disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-[14px]">refresh</span>
                      {loadingAction === `${ring.id}-regen` ? "..." : "REGEN CODE"}
                    </button>
                    {activeApprovedReq && (
                      <button
                        onClick={() => handleRevokeModSession(ring.id)}
                        disabled={loadingAction === `revoke-${ring.id}`}
                        className="flex-1 py-1.5 bg-error/10 hover:bg-error/20 text-error border border-error/30 rounded font-label-caps text-[10px] font-bold transition-colors flex justify-center items-center gap-1.5 disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-[14px]">logout</span>
                        {loadingAction === `revoke-${ring.id}` ? "..." : "LOG OUT MOD"}
                      </button>
                    )}
                  </div>

                  {ringPendingReqs.length > 0 && (
                    <div className="pt-3 border-t border-amber-300/40">
                      <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg space-y-2">
                        <div className="flex justify-between items-center text-amber-900 font-label-caps text-[10px] font-bold">
                          <span className="flex items-center gap-1">
                            <span className="material-symbols-outlined text-[14px]">lock_open</span>
                            PENDING REQUEST ({ringPendingReqs.length})
                          </span>
                        </div>
                        {ringPendingReqs.map((req) => (
                          <div key={req.id} className="bg-[#FAF9F5] p-2.5 rounded border border-amber-300/50 flex items-center justify-between shadow-xs">
                            <div className="flex flex-col">
                              <span className="text-xs font-bold text-primary">{req.moderator_name}</span>
                              <span className="text-[9px] font-data-mono text-on-surface-variant opacity-70" suppressHydrationWarning>
                                {req.device_info?.browser || "Device"} · {new Date(req.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </div>
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => handleApproveModRequest(req.id, ring.id)}
                                disabled={loadingAction === `approve-${req.id}`}
                                className="px-2.5 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-[10px] font-bold disabled:opacity-50"
                              >
                                {loadingAction === `approve-${req.id}` ? "..." : "APPROVE"}
                              </button>
                              <button
                                onClick={() => handleRejectModRequest(req.id)}
                                disabled={loadingAction === `reject-${req.id}`}
                                className="px-2 py-1 bg-surface-container hover:bg-error/20 text-error rounded text-[10px] font-bold border border-outline-variant disabled:opacity-50"
                              >
                                REJECT
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {rings.length === 0 && (
              <div className="col-span-full p-8 text-center text-on-surface-variant italic border border-dashed border-outline-variant rounded-xl">
                No tatamis found for this tournament.
              </div>
            )}
          </div>
        </>
      )}

      {/* ── TAB: STAGERS ── */}
      {activeTab === "stagers" && (
        <div className="space-y-8">
          {/* Code Generation */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm">
            <div className="flex items-start justify-between mb-5">
              <div>
                <h3 className="font-headline-sm text-lg text-primary font-bold">Stager Access Codes</h3>
                <p className="text-body-sm text-on-surface-variant mt-0.5">
                  Generate unique 6-character codes. Each code is for one stager (one active session per code).
                  You can add more codes at any time during the tournament.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-4">
                <div className="flex items-center border border-outline-variant rounded-lg overflow-hidden">
                  <button
                    onClick={() => setStagerCountInput((v) => Math.max(1, v - 1))}
                    className="px-3 py-2 text-on-surface-variant hover:bg-surface-container-high font-bold text-sm"
                  >
                    −
                  </button>
                  <span className="px-4 py-2 font-data-mono font-bold text-sm text-primary border-x border-outline-variant min-w-[40px] text-center">
                    {stagerCountInput}
                  </span>
                  <button
                    onClick={() => setStagerCountInput((v) => Math.min(50, v + 1))}
                    className="px-3 py-2 text-on-surface-variant hover:bg-surface-container-high font-bold text-sm"
                  >
                    +
                  </button>
                </div>
                <button
                  onClick={handleGenerateCodes}
                  disabled={isGenerating}
                  className="px-4 py-2 bg-primary text-white font-label-caps text-label-caps rounded-lg flex items-center gap-2 hover:opacity-90 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-[16px]">add</span>
                  {isGenerating ? "GENERATING..." : `ADD ${stagerCountInput} CODE${stagerCountInput > 1 ? "S" : ""}`}
                </button>
              </div>
            </div>

            {stagerCodes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 border border-dashed border-outline-variant rounded-xl text-on-surface-variant opacity-60">
                <span className="material-symbols-outlined text-4xl mb-2">key_off</span>
                <p className="text-sm">No stager codes generated yet.</p>
                <p className="text-xs mt-1">Use the button above to generate access codes.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {stagerCodes.map((sc) => {
                  const associatedReq = stagerRequests.find(
                    (r) => r.status === "approved" && normalizeAccessCode(r.access_code_used) === normalizeAccessCode(sc.code)
                  );
                  return (
                    <div
                      key={sc.code}
                      className={`p-4 rounded-xl border flex flex-col gap-2 relative ${
                        associatedReq
                          ? "bg-green-50 border-green-300"
                          : "bg-surface-container-low border-outline-variant"
                      }`}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-[10px] font-label-caps text-on-surface-variant">{sc.label}</p>
                          <p className="font-data-mono text-2xl font-black text-secondary tracking-widest mt-0.5">
                            {sc.code}
                          </p>
                        </div>
                        {associatedReq ? (
                          <div className="flex items-center gap-1 px-2 py-0.5 bg-green-500/10 border border-green-400/30 rounded text-[9px] font-bold text-green-700">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                            IN USE
                          </div>
                        ) : (
                          <button
                            onClick={() => handleRemoveCode(sc.code)}
                            disabled={loadingAction === `remove-${sc.code}`}
                            className="p-1 rounded hover:bg-error/10 text-error/60 hover:text-error transition-colors disabled:opacity-50"
                            title="Remove this stager code"
                          >
                            <span className="material-symbols-outlined text-[16px]">delete</span>
                          </button>
                        )}
                      </div>
                      {associatedReq && (
                        <p className="text-[10px] text-green-700 font-bold flex items-center gap-1">
                          <span className="material-symbols-outlined text-[13px]">person</span>
                          {associatedReq.stager_name}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Pending Stager Approval Queue */}
          {pendingStagers.length > 0 && (
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <span className="material-symbols-outlined text-amber-600">pending</span>
                <h3 className="font-headline-sm text-lg text-primary font-bold">
                  Pending Approval ({pendingStagers.length})
                </h3>
              </div>
              <div className="space-y-2">
                {pendingStagers.map((req) => (
                  <div key={req.id} className="p-3 bg-amber-50 border border-amber-300/50 rounded-lg flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-primary">{req.stager_name}</span>
                      <span className="text-[10px] font-data-mono text-on-surface-variant opacity-70 flex items-center gap-1">
                        Code: {req.access_code_used}
                        <span className="mx-1 opacity-40">·</span>
                        {req.device_info?.browser || "Device"}
                        <span className="mx-1 opacity-40" suppressHydrationWarning>·</span>
                        <span suppressHydrationWarning>{new Date(req.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      </span>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleApproveStager(req.id)}
                        disabled={loadingAction === `approve-stager-${req.id}`}
                        className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded text-[10px] font-bold disabled:opacity-50"
                      >
                        {loadingAction === `approve-stager-${req.id}` ? "..." : "APPROVE"}
                      </button>
                      <button
                        onClick={() => handleRejectStager(req.id)}
                        disabled={loadingAction === `reject-stager-${req.id}`}
                        className="px-2.5 py-1.5 bg-surface-container hover:bg-error/20 text-error border border-outline-variant rounded text-[10px] font-bold disabled:opacity-50"
                      >
                        REJECT
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Approved Stagers */}
          {approvedStagers.length > 0 && (
            <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <span className="material-symbols-outlined text-green-600">verified</span>
                <h3 className="font-headline-sm text-lg text-primary font-bold">
                  Approved Stagers ({approvedStagers.length})
                </h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {approvedStagers.map((req) => (
                  <div key={req.id} className="p-4 bg-green-50 border border-green-200 rounded-xl flex flex-col gap-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-bold text-sm text-primary">{req.stager_name}</p>
                        <p className="text-[10px] font-data-mono text-on-surface-variant mt-0.5">
                          Code: {req.access_code_used}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 px-2 py-0.5 bg-green-500/10 border border-green-400/30 rounded text-[9px] font-bold text-green-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                        ACTIVE
                      </div>
                    </div>
                    <button
                      onClick={() => handleRevokeStager(req.id)}
                      disabled={loadingAction === `revoke-stager-${req.id}`}
                      className="flex items-center justify-center gap-1.5 py-1 bg-error/10 hover:bg-error/20 text-error border border-error/20 rounded text-[10px] font-bold transition-colors disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-[13px]">logout</span>
                      {loadingAction === `revoke-stager-${req.id}` ? "..." : "REVOKE SESSION"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {stagerCodes.length > 0 && stagerRequests.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 border border-dashed border-outline-variant rounded-xl text-on-surface-variant opacity-50">
              <span className="material-symbols-outlined text-4xl mb-2">hourglass_empty</span>
              <p className="text-sm">No stager requests yet. Share the codes above with your stagers.</p>
              <p className="text-xs mt-1 opacity-70">Login URL: <code className="bg-surface-container px-1.5 py-0.5 rounded">/login/stager</code></p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
