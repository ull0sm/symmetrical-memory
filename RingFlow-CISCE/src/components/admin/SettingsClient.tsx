"use client";

import React, { useState, useEffect, useCallback } from "react";
import { updateTournamentSettings, deleteTournament } from "@/actions/settings";
import { 
  approveOrganiserRequest, 
  rejectOrganiserRequest, 
  revokeOrganiserSession, 
  regenerateOrganiserCode,
  getOrganiserRequests,
} from "@/actions/organiser";
import { useLiveEvents } from "@/hooks/useLiveEvents";
import { useRouter } from "next/navigation";

export interface OrganiserRequest {
  id: string;
  tournament_id: string;
  access_code_used: string;
  status: "pending" | "approved" | "rejected" | "revoked";
  session_token?: string | null;
  device_info?: any;
  organiser_name?: string | null;
  created_at: string;
  expires_at: string;
}

interface Tournament {
  id: string;
  name: string;
  event_date: string | null;
  status: string;
  venue: string | null;
  city: string | null;
  organiser_code?: string | null;
  show_public_draws?: boolean;
  show_public_scoreboard?: boolean;
  default_bronze_medals?: number | null;
  tunnel_url?: string | null;
  tunnelUrl?: string | null;
}

interface Props {
  tournament: Tournament;
  initialOrganiserRequests?: OrganiserRequest[];
}

export default function SettingsClient({ tournament, initialOrganiserRequests = [] }: Props) {
  const router = useRouter();

  const [form, setForm] = useState({
    name: tournament.name,
    event_date: tournament.event_date || "",
    status: tournament.status,
    venue: tournament.venue || "",
    city: tournament.city || "",
    show_public_draws: tournament.show_public_draws === true,
    show_public_scoreboard: tournament.show_public_scoreboard === true,
    default_bronze_medals: (tournament.default_bronze_medals ?? 2) as 0 | 1 | 2 | 3,
    tunnel_url: tournament.tunnel_url || tournament.tunnelUrl || "",
  });
  
  const [organiserCode, setOrganiserCode] = useState(tournament.organiser_code || "------");
  const [showOrganiserCode, setShowOrganiserCode] = useState(false);
  const [requests, setRequests] = useState<OrganiserRequest[]>(initialOrganiserRequests);
  const [copied, setCopied] = useState(false);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  
  // 0 = closed, 1 = typing "delete", 2 = typing "tournament name"
  const [deletePhase, setDeletePhase] = useState(0);
  const [deleteInput, setDeleteInput] = useState("");

  // Sync initial props
  useEffect(() => {
    setRequests(initialOrganiserRequests);
  }, [initialOrganiserRequests]);

  const refreshRequests = useCallback(async () => {
    try {
      const data = await getOrganiserRequests(tournament.id);
      if (data) setRequests(data as OrganiserRequest[]);
    } catch (err) {
      console.error("[settings] live refresh failed:", err);
    }
  }, [tournament.id]);

  // Live real-time SSE listener
  useLiveEvents({ tournamentId: tournament.id }, refreshRequests);

  // Polling fallback
  useEffect(() => {
    const poll = setInterval(refreshRequests, 15000);
    return () => clearInterval(poll);
  }, [refreshRequests]);

  const handleCopyCode = () => {
    if (!organiserCode || organiserCode === "------") return;
    navigator.clipboard.writeText(organiserCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRegenerateCode = async () => {
    if (!confirm("Regenerate organiser access code? Previous codes will no longer work for new logins.")) {
      return;
    }
    setLoadingAction("regen-code");
    try {
      const res = await regenerateOrganiserCode(tournament.id);
      if (res?.success && res.organiser_code) {
        setOrganiserCode(res.organiser_code);
        setShowOrganiserCode(true);
      } else {
        alert(res?.error || "Failed to regenerate code.");
      }
      router.refresh();
    } catch (err: any) {
      alert(err.message || "Failed to regenerate code.");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleApprove = async (requestId: string) => {
    setLoadingAction(`approve-${requestId}`);
    try {
      await approveOrganiserRequest(requestId, tournament.id);
      setRequests((prev) =>
        prev.map((r) => (r.id === requestId ? { ...r, status: "approved" } : r))
      );
      router.refresh();
    } catch (err: any) {
      alert(err.message || "Failed to approve organiser.");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleReject = async (requestId: string) => {
    setLoadingAction(`reject-${requestId}`);
    try {
      await rejectOrganiserRequest(requestId, tournament.id);
      setRequests((prev) =>
        prev.map((r) => (r.id === requestId ? { ...r, status: "rejected" } : r))
      );
      router.refresh();
    } catch (err: any) {
      alert(err.message || "Failed to reject request.");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleRevoke = async (requestId: string, organiserName?: string | null) => {
    const name = organiserName || "this organiser";
    if (!confirm(`Are you sure you want to log out and revoke access for ${name}? Their session will end immediately.`)) {
      return;
    }
    setLoadingAction(`revoke-${requestId}`);
    try {
      await revokeOrganiserSession(requestId, tournament.id);
      setRequests((prev) =>
        prev.map((r) => (r.id === requestId ? { ...r, status: "revoked", session_token: null } : r))
      );
      router.refresh();
    } catch (err: any) {
      alert(err.message || "Failed to revoke session.");
    } finally {
      setLoadingAction(null);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateTournamentSettings(tournament.id, form);
      alert("Settings saved successfully.");
    } catch (err) {
      alert("Failed to save settings.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleNextDeletePhase = () => {
    if (deletePhase === 1) {
      if (deleteInput.trim().toLowerCase() !== "delete") {
        alert("Please type exactly 'delete' to proceed.");
        return;
      }
      setDeletePhase(2);
      setDeleteInput("");
    } else if (deletePhase === 2) {
      if (deleteInput.trim() !== tournament.name) {
        alert("Tournament name did not match.");
        return;
      }
      executeDelete();
    }
  };

  const executeDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteTournament(tournament.id);
    } catch (err) {
      alert("Failed to delete tournament.");
      setIsDeleting(false);
    }
  };

  const pendingRequests = requests.filter((r) => r.status === "pending");
  const approvedOrganisers = requests.filter((r) => r.status === "approved");

  return (
    <div className="p-margin-desktop space-y-8 bg-surface pb-24 w-full">
      <div className="max-w-3xl">
        <div className="mb-8">
          <h2 className="font-headline-sm text-headline-sm text-primary">Tournament Configuration</h2>
          <p className="text-body-sm text-on-surface-variant">Update the core details of your event.</p>
        </div>

        <div className="space-y-8">
          {/* General Info */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-8 shadow-sm">
            <h3 className="font-label-caps text-label-caps text-secondary mb-6">General Information</h3>
            
            <div className="space-y-6">
              <div className="flex flex-col gap-2">
                <label className="font-label-caps text-[10px] text-on-surface-variant">TOURNAMENT NAME</label>
                <input 
                  type="text" 
                  value={form.name}
                  onChange={e => setForm({...form, name: e.target.value})}
                  className="w-full p-3 border border-outline-variant rounded focus:border-secondary focus:ring-1 focus:ring-secondary outline-none font-body-md" 
                />
              </div>
              
              <div className="grid grid-cols-2 gap-6">
                <div className="flex flex-col gap-2">
                  <label className="font-label-caps text-[10px] text-on-surface-variant">EVENT DATE</label>
                  <input 
                    type="date" 
                    value={form.event_date}
                    onChange={e => setForm({...form, event_date: e.target.value})}
                    className="w-full p-3 border border-outline-variant rounded focus:border-secondary focus:ring-1 focus:ring-secondary outline-none font-body-md" 
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="font-label-caps text-[10px] text-on-surface-variant">STATUS</label>
                  <select 
                    value={form.status}
                    onChange={e => setForm({...form, status: e.target.value})}
                    className="w-full p-3 border border-outline-variant rounded focus:border-secondary focus:ring-1 focus:ring-secondary outline-none font-body-md bg-transparent"
                  >
                    <option value="draft">Draft (Setup Phase)</option>
                    <option value="active">Active (Live Event)</option>
                    <option value="completed">Completed (Archived)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="flex flex-col gap-2">
                  <label className="font-label-caps text-[10px] text-on-surface-variant">VENUE NAME</label>
                  <input 
                    type="text" 
                    value={form.venue}
                    onChange={e => setForm({...form, venue: e.target.value})}
                    className="w-full p-3 border border-outline-variant rounded focus:border-secondary focus:ring-1 focus:ring-secondary outline-none font-body-md" 
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="font-label-caps text-[10px] text-on-surface-variant">CITY</label>
                  <input 
                    type="text" 
                    value={form.city}
                    onChange={e => setForm({...form, city: e.target.value})}
                    className="w-full p-3 border border-outline-variant rounded focus:border-secondary focus:ring-1 focus:ring-secondary outline-none font-body-md" 
                  />
                </div>
              </div>

              {/* Public Event Draws Visibility Toggle */}
              <div className="pt-6 border-t border-outline-variant/60 flex items-center justify-between gap-4">
                <div className="flex flex-col gap-1 pr-2">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px] text-red-500">description</span>
                    <label 
                      className="font-label-caps text-[11px] font-bold text-primary cursor-pointer select-none" 
                      onClick={() => setForm(f => ({ ...f, show_public_draws: !f.show_public_draws }))}
                    >
                      SHOW CATEGORY DRAWS ON PUBLIC FLOOR
                    </label>
                  </div>
                  <p className="text-body-xs text-on-surface-variant max-w-xl">
                    When enabled, spectators can open the full live bracket tree from the public floor.
                    When turned off, they can still see their own athlete&apos;s path by searching that athlete&apos;s name.
                  </p>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={form.show_public_draws}
                  onClick={() => setForm(f => ({ ...f, show_public_draws: !f.show_public_draws }))}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    form.show_public_draws ? "bg-primary" : "bg-outline-variant"
                  }`}
                  title={form.show_public_draws ? "Public draws enabled" : "Public draws disabled"}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      form.show_public_draws ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* Bronze medal default for every draw in this event */}
              <div className="pt-6 border-t border-outline-variant/60">
                <div className="flex items-start gap-2">
                  <span className="material-symbols-outlined text-[18px] text-[#C08A5A]">workspace_premium</span>
                  <div className="flex-1">
                    <label className="font-label-caps text-[11px] font-bold text-primary">
                      REPECHAGE & BRONZE FORMAT
                    </label>
                    <p className="text-body-xs text-on-surface-variant max-w-xl mt-1">
                      Event default for tournament categories. Choose between standard WKF repechage, local official express formats (only semifinal losers fight for bronze, or joint bronzes), or no bronze.
                    </p>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {[
                    {
                      value: 2,
                      title: "Official WKF (2 Bronzes)",
                      desc: "Full repechage ladders for everyone beaten by finalists.",
                    },
                    {
                      value: 1,
                      title: "Local Official (1 Bronze Playoff)",
                      desc: "Earlier losers eliminated; losing semi-finalists play a single bronze match.",
                    },
                    {
                      value: 3,
                      title: "Local Official (Joint 3rd · 2 Bronzes)",
                      desc: "Both semi-final losers awarded bronze directly (no extra bouts).",
                    },
                    {
                      value: 0,
                      title: "No Bronze",
                      desc: "Single elimination stopping at the final.",
                    },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={form.default_bronze_medals === option.value}
                      onClick={() => setForm((f) => ({ ...f, default_bronze_medals: option.value as 0 | 1 | 2 | 3 }))}
                      className={`min-h-[60px] rounded-xl border p-3 text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-2 ${
                        form.default_bronze_medals === option.value
                          ? "border-[#0E9C7C] bg-[#E3F6F0] text-[#0B7C63]"
                          : "border-outline-variant bg-white text-on-surface-variant hover:bg-surface-container-low"
                      }`}
                    >
                      <div className="font-bold text-xs text-primary">{option.title}</div>
                      <div className="text-[11px] text-on-surface-variant mt-0.5 leading-snug">{option.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Arena scoreboard access */}
              <div className="pt-6 border-t border-outline-variant/60 flex items-center justify-between gap-4">
                <div className="flex flex-col gap-1 pr-2">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[18px] text-secondary">tv</span>
                    <label
                      className="font-label-caps text-[11px] font-bold text-primary cursor-pointer select-none"
                      onClick={() => setForm(f => ({ ...f, show_public_scoreboard: !f.show_public_scoreboard }))}
                    >
                      ALLOW THE ARENA SCOREBOARD ON ANY SCREEN
                    </label>
                  </div>
                  <p className="text-body-xs text-on-surface-variant max-w-xl">
                    The TV scoreboard link is never linked from public pages. Off by default: a moderator or
                    admin session is required to open it. Turn this on to let a venue screen open the link
                    without signing in.
                  </p>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={form.show_public_scoreboard}
                  onClick={() => setForm(f => ({ ...f, show_public_scoreboard: !f.show_public_scoreboard }))}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    form.show_public_scoreboard ? "bg-primary" : "bg-outline-variant"
                  }`}
                  title={form.show_public_scoreboard ? "Open scoreboard enabled" : "Scoreboard requires a sign-in"}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      form.show_public_scoreboard ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {/* Public Tunnel / Internet Remote Access URL */}
              <div className="pt-6 border-t border-outline-variant/60 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[20px] text-[#0E9C7C]">router</span>
                  <label className="font-label-caps text-[11px] font-bold text-primary">
                    PUBLIC TUNNEL URL (FOR JUDGE PHONES & QR CODES)
                  </label>
                </div>
                <p className="text-body-xs text-on-surface-variant max-w-xl">
                  If running on a local LAN/computer with a tunnel (e.g. Cloudflare Tunnel, ngrok, Pinggy, Tailscale Funnel) so external judges can submit marks over the internet, paste the public tunnel base URL here. All Judge QR codes and mobile links will automatically use this URL.
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="url"
                    value={form.tunnel_url}
                    onChange={(e) => setForm({ ...form, tunnel_url: e.target.value })}
                    placeholder="e.g. https://karate-tourney.trycloudflare.com or https://xxxx.ngrok-free.app"
                    className="flex-1 p-3 border border-outline-variant rounded focus:border-secondary focus:ring-1 focus:ring-secondary outline-none font-data-mono text-xs bg-white"
                  />
                  {form.tunnel_url && (
                    <button
                      type="button"
                      onClick={() => window.open(form.tunnel_url, "_blank")}
                      className="px-3 py-3 border border-outline-variant hover:bg-[#F5F3EC] rounded text-xs font-bold font-data-mono text-primary flex items-center gap-1 cursor-pointer shrink-0"
                      title="Test URL in new tab"
                    >
                      <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                      Test
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-8 flex justify-end">
              <button 
                onClick={handleSave}
                disabled={isSaving}
                className="px-6 py-2.5 bg-primary text-white font-label-caps text-label-caps rounded hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
              >
                {isSaving ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    SAVING...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[16px]">save</span>
                    SAVE GENERAL SETTINGS
                  </>
                )}
              </button>
            </div>
          </section>

          {/* Organiser Access Control & Code Management */}
          <section className="bg-surface-container-lowest border border-outline-variant rounded-xl p-8 shadow-sm space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-label-caps text-label-caps text-secondary mb-1">Organiser Access Control</h3>
                <p className="text-body-sm text-on-surface-variant">
                  Multiple organisers can use the same access code to request access. All organisers must be approved by you below before entering the portal.
                </p>
              </div>
              <span className="material-symbols-outlined text-secondary text-2xl">group</span>
            </div>

            {/* Access Code Box (Styled matching Tatamis section for mods) */}
            <div className="p-6 bg-surface-container-low border border-outline-variant rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex flex-col items-center sm:items-start">
                <span className="text-[11px] font-label-caps text-on-surface-variant uppercase tracking-wider mb-1">
                  ORGANISER ACCESS CODE
                </span>
                <span className="font-data-mono text-3xl md:text-4xl font-black text-secondary tracking-widest select-all">
                  {showOrganiserCode ? organiserCode : "••••••"}
                </span>
                {organiserCode === "------" && (
                  <span className="mt-1 text-[11px] font-semibold text-amber-700">
                    No code saved for this event yet. Generate one so organisers can request access.
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto flex-wrap">
                <button
                  onClick={() => setShowOrganiserCode((prev) => !prev)}
                  className="flex-1 sm:flex-initial px-4 py-2.5 bg-surface-container hover:bg-surface-container-high border border-outline-variant rounded-lg font-label-caps text-xs text-primary transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  title={showOrganiserCode ? "Hide access code" : "Reveal access code"}
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {showOrganiserCode ? "visibility_off" : "visibility"}
                  </span>
                  {showOrganiserCode ? "HIDE CODE" : "REVEAL CODE"}
                </button>

                <button
                  onClick={handleCopyCode}
                  className="flex-1 sm:flex-initial px-4 py-2.5 bg-surface-container hover:bg-surface-container-high border border-outline-variant rounded-lg font-label-caps text-xs text-primary transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                  title="Copy access code"
                >
                  <span className="material-symbols-outlined text-[16px]">
                    {copied ? "check" : "content_copy"}
                  </span>
                  {copied ? "COPIED" : "COPY CODE"}
                </button>

                <button
                  onClick={handleRegenerateCode}
                  disabled={loadingAction === "regen-code"}
                  className="flex-1 sm:flex-initial px-4 py-2.5 bg-surface-container hover:bg-surface-container-high border border-outline-variant rounded-lg font-label-caps text-xs text-primary transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                  title="Generate a new 6-character code"
                >
                  <span className="material-symbols-outlined text-[16px]">refresh</span>
                  {loadingAction === "regen-code" ? "..." : "REGEN CODE"}
                </button>
              </div>
            </div>

            {/* PENDING APPROVAL REQUESTS */}
            {pendingRequests.length > 0 && (
              <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-amber-900 font-label-caps text-xs font-bold">
                    <span className="material-symbols-outlined text-[18px]">lock_clock</span>
                    <span>PENDING ORGANISER REQUESTS ({pendingRequests.length})</span>
                  </div>
                  <span className="text-[11px] text-amber-800 font-medium">Requires approval</span>
                </div>

                <div className="space-y-2">
                  {pendingRequests.map((req) => {
                    const dev = req.device_info || {};
                    const devString = [dev.browser, dev.os, dev.ip && `IP: ${dev.ip}`].filter(Boolean).join(" • ");

                    return (
                      <div
                        key={req.id}
                        className="bg-[#FAF9F5] p-3.5 rounded-lg border border-amber-300/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-headline-sm text-sm font-bold text-primary">
                              {req.organiser_name || "Organiser"}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">
                              PENDING
                            </span>
                          </div>
                          <div className="text-[11px] text-on-surface-variant opacity-80 mt-0.5">
                            {devString || "Device info unavailable"}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 w-full sm:w-auto">
                          <button
                            onClick={() => handleApprove(req.id)}
                            disabled={loadingAction === `approve-${req.id}`}
                            className="flex-1 sm:flex-initial px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded font-label-caps text-xs font-bold flex items-center justify-center gap-1 transition-colors disabled:opacity-50"
                          >
                            <span className="material-symbols-outlined text-[14px]">check</span>
                            {loadingAction === `approve-${req.id}` ? "..." : "APPROVE"}
                          </button>
                          <button
                            onClick={() => handleReject(req.id)}
                            disabled={loadingAction === `reject-${req.id}`}
                            className="flex-1 sm:flex-initial px-3 py-1.5 bg-error/10 hover:bg-error/20 text-error border border-error/30 rounded font-label-caps text-xs font-bold flex items-center justify-center gap-1 transition-colors disabled:opacity-50"
                          >
                            <span className="material-symbols-outlined text-[14px]">close</span>
                            {loadingAction === `reject-${req.id}` ? "..." : "REJECT"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* APPROVED ORGANISERS LIST ("show who and all have been approved below that") */}
            <div className="pt-4 border-t border-outline-variant/50 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="font-label-caps text-xs text-primary font-bold tracking-wider uppercase">
                    Approved Organisers ({approvedOrganisers.length})
                  </span>
                </div>
                <span className="text-[11px] text-on-surface-variant">Active access holders</span>
              </div>

              {approvedOrganisers.length === 0 ? (
                <div className="p-6 bg-surface-container-low border border-outline-variant/50 rounded-xl text-center">
                  <span className="material-symbols-outlined text-outline text-3xl mb-1">person_search</span>
                  <p className="text-body-sm text-on-surface-variant font-medium">No approved organisers yet</p>
                  <p className="text-xs text-on-surface-variant/70 mt-0.5">
                    Share the code <strong className="font-data-mono">{organiserCode}</strong> with your staff. Their requests will appear above for approval.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {approvedOrganisers.map((org) => {
                    const dev = org.device_info || {};
                    const devString = [dev.browser, dev.os, dev.ip && `IP: ${dev.ip}`].filter(Boolean).join(" • ");
                    const approvedDate = org.created_at
                      ? new Date(org.created_at).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "";

                    return (
                      <div
                        key={org.id}
                        className="bg-surface-container-low border border-outline-variant rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                      >
                        <div className="flex items-start gap-3">
                          <div className="w-9 h-9 rounded-full bg-green-500/10 text-green-700 flex items-center justify-center shrink-0 mt-0.5">
                            <span className="material-symbols-outlined text-[20px]">badge</span>
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-headline-sm text-sm font-bold text-primary">
                                {org.organiser_name || "Organiser"}
                              </span>
                              <span className="flex items-center gap-1 px-2 py-0.5 bg-green-500/10 border border-green-500/30 rounded text-green-700 text-[10px] font-bold">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                                ACTIVE
                              </span>
                            </div>
                            <div suppressHydrationWarning className="text-[11px] text-on-surface-variant mt-0.5">
                              {devString || "Web Client"} • Approved{" "}
                              <span suppressHydrationWarning>{approvedDate}</span>
                            </div>
                          </div>
                        </div>

                        <button
                          onClick={() => handleRevoke(org.id, org.organiser_name)}
                          disabled={loadingAction === `revoke-${org.id}`}
                          className="px-3 py-1.5 bg-error/10 hover:bg-error/20 text-error border border-error/30 rounded font-label-caps text-xs font-bold transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                          title="Revoke active organiser access"
                        >
                          <span className="material-symbols-outlined text-[14px]">logout</span>
                          {loadingAction === `revoke-${org.id}` ? "REVOKING..." : "REVOKE ACCESS"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* Danger Zone */}
          <section className="border border-outline-variant rounded-xl p-8 bg-surface-container-lowest">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="font-label-caps text-label-caps text-on-surface-variant mb-2">Advanced Settings</h3>
                <p className="text-body-sm text-on-surface-variant">Irreversible actions are hidden here.</p>
              </div>
              <button 
                onClick={() => { setDeletePhase(1); setDeleteInput(""); }}
                className="w-10 h-10 rounded-full border border-outline-variant flex items-center justify-center hover:bg-error/10 hover:text-error hover:border-error transition-colors"
                title="Delete Tournament"
              >
                <span className="material-symbols-outlined text-[20px]">settings</span>
              </button>
            </div>

            {deletePhase > 0 && (
              <div className="mt-6 p-6 border border-error/30 bg-error/5 rounded-lg animate-fade-in">
                <h4 className="font-bold text-error mb-2">Delete Tournament</h4>
                
                {deletePhase === 1 && (
                  <>
                    <p className="text-sm text-on-surface-variant mb-4">To proceed, please type <strong className="text-error">delete</strong> below.</p>
                    <div className="flex gap-4">
                      <input 
                        type="text" 
                        autoFocus
                        value={deleteInput}
                        onChange={e => setDeleteInput(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") handleNextDeletePhase(); }}
                        placeholder="delete"
                        className="flex-1 p-2 border border-error/30 rounded focus:border-error outline-none"
                      />
                      <button onClick={handleNextDeletePhase} className="px-4 py-2 bg-error text-white font-bold text-xs rounded hover:opacity-90">NEXT</button>
                      <button onClick={() => setDeletePhase(0)} className="px-4 py-2 border border-outline rounded text-xs">CANCEL</button>
                    </div>
                  </>
                )}

                {deletePhase === 2 && (
                  <>
                    <p className="text-sm text-on-surface-variant mb-4">Final step. Type the exact tournament name: <strong className="text-error font-data-mono">{tournament.name}</strong></p>
                    <div className="flex gap-4">
                      <input 
                        type="text" 
                        autoFocus
                        value={deleteInput}
                        onChange={e => setDeleteInput(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") handleNextDeletePhase(); }}
                        placeholder={tournament.name}
                        className="flex-1 p-2 border border-error/30 rounded focus:border-error outline-none"
                      />
                      <button 
                        onClick={handleNextDeletePhase} 
                        disabled={isDeleting}
                        className="px-4 py-2 bg-error text-white font-bold text-xs rounded hover:opacity-90 disabled:opacity-50"
                      >
                        {isDeleting ? "DELETING..." : "PERMANENTLY DELETE"}
                      </button>
                      <button onClick={() => setDeletePhase(0)} disabled={isDeleting} className="px-4 py-2 border border-outline rounded text-xs">CANCEL</button>
                    </div>
                  </>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
