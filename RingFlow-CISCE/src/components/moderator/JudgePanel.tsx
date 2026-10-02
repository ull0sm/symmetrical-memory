"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { ChevronDown, ChevronUp, Lock, Power, QrCode, RefreshCw, Smartphone, Unlock, X } from "lucide-react";
import { approveJudge, endJudgePanel, getJudgePanel, kickJudge, rejectJudge, rotateJudgePairing } from "@/actions/judgePanel";
import { closeKataVoting, openKataVoting, voidJudgeVote } from "@/actions/kata";
import { useLiveEvents } from "@/hooks/useLiveEvents";

type PanelSession = {
  id: string;
  seat: number;
  judgeName: string;
  status: "pending" | "approved";
  connected: boolean;
};

type Panel = {
  pin: string;
  pairingKey: string;
  seats: number;
  sessions: PanelSession[];
};

type ScoreRow = {
  judgeSeat?: number;
  judge_seat?: number;
  isOverridden?: boolean;
  is_overridden?: boolean;
  judgeName?: string | null;
};

interface Props {
  ringId: string;
  /** Bout on the desk; voting controls act on it. */
  matchId: string | null;
  matchStatus?: string | null;
  voting: "idle" | "open" | "closed";
  scores: ScoreRow[];
  /** Public base URL for the QR link (tunnel / hosted); defaults to this page's origin. */
  baseUrl?: string | null;
  onChanged: () => void;
}

const card = "rounded-2xl border border-[var(--line)] bg-white shadow-2xs";
const chipBase = "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold font-data-mono uppercase tracking-wider";
const smallBtn =
  "inline-flex cursor-pointer items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold font-data-mono transition-colors disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Judge phones for this tatami (docs/roles/judge.md): QR + PIN to pair,
 * approve / reject / kick per seat, open and close voting on the bout, void a
 * seat's vote. Small events can ignore it and enter marks at the desk.
 */
export function JudgePanel({ ringId, matchId, matchStatus, voting, scores, baseUrl, onChanged }: Props) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const [qr, setQr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await getJudgePanel(ringId);
      if (res.success) {
        setPanel({ pin: res.pin, pairingKey: res.pairingKey, seats: res.seats, sessions: res.sessions });
        setError(null);
      } else {
        setError(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the judge panel.");
    }
  }, [ringId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  useLiveEvents({ ringId }, (event) => {
    if (event?.table === "judge_sessions" || event?.table === "rings") load();
  });

  const pairingUrl = useMemo(() => {
    if (!panel) return null;
    const origin = (baseUrl || (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/+$/, "");
    return `${origin}/judge/ring/${ringId}?k=${encodeURIComponent(panel.pairingKey)}`;
  }, [panel, baseUrl, ringId]);

  useEffect(() => {
    if (!pairingUrl) return;
    let alive = true;
    QRCode.toDataURL(pairingUrl, { margin: 1, width: 220 })
      .then((url) => alive && setQr(url))
      .catch((err) => console.error("QR generation failed:", err));
    return () => {
      alive = false;
    };
  }, [pairingUrl]);

  const run = async (key: string, fn: () => Promise<{ success: boolean; error?: string }>) => {
    setBusy(key);
    setError(null);
    try {
      const res = await fn();
      if (!res.success) setError(res.error || "That did not work.");
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  };

  const voteBySeat = (seat: number) =>
    scores.find((s) => (s.judgeSeat ?? s.judge_seat) === seat);

  const approved = panel?.sessions.filter((s) => s.status === "approved") ?? [];
  const pending = panel?.sessions.filter((s) => s.status === "pending") ?? [];
  const finished = matchStatus === "CONFIRMED";
  const votesIn = panel ? Array.from({ length: panel.seats }, (_, i) => voteBySeat(i + 1)).filter(Boolean).length : 0;

  return (
    <div className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex cursor-pointer items-center gap-2 text-left">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-tint)] text-[var(--accent)]">
            <Smartphone className="h-4 w-4" />
          </span>
          <span>
            <span className="block text-sm font-bold text-[var(--ink-900)]">Judge phones</span>
            <span className="block text-[11px] font-data-mono text-[var(--ink-500)]">
              {approved.length} on panel{pending.length ? ` · ${pending.length} waiting` : ""}
              {matchId ? ` · ${votesIn} vote${votesIn === 1 ? "" : "s"} in` : ""}
            </span>
          </span>
          {open ? <ChevronUp className="h-4 w-4 text-[var(--ink-400)]" /> : <ChevronDown className="h-4 w-4 text-[var(--ink-400)]" />}
        </button>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`${chipBase} ${
              finished
                ? "bg-[var(--canvas)] text-[var(--ink-500)]"
                : voting === "open"
                  ? "bg-emerald-100 text-emerald-800"
                  : voting === "closed"
                    ? "bg-amber-100 text-amber-800"
                    : "bg-[var(--canvas)] text-[var(--ink-500)]"
            }`}
          >
            {finished ? "Bout confirmed" : voting === "open" ? "Voting open" : voting === "closed" ? "Voting closed" : "Voting not open"}
          </span>
          {voting === "open" && !finished ? (
            <button
              type="button"
              disabled={!matchId || busy !== null}
              onClick={() => matchId && run("close", () => closeKataVoting(matchId))}
              className={`${smallBtn} border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100`}
            >
              <Lock className="h-3.5 w-3.5" /> Close voting
            </button>
          ) : (
            <button
              type="button"
              disabled={!matchId || finished || busy !== null}
              onClick={() => matchId && run("open", () => openKataVoting(matchId))}
              className={`${smallBtn} border-[var(--accent)] bg-[var(--accent)] text-white hover:bg-[var(--accent-dark)]`}
            >
              <Unlock className="h-3.5 w-3.5" /> {voting === "closed" ? "Reopen voting" : "Open voting"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="mx-4 mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p>
      )}

      {open && panel && (
        <div className="grid gap-4 border-t border-[var(--line)] p-4 lg:grid-cols-[auto_1fr]">
          {/* Pairing */}
          <div className="flex flex-col items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 text-center">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt="QR code for judge phones to join this tatami" className="h-40 w-40 rounded-lg bg-white" />
            ) : (
              <div className="flex h-40 w-40 items-center justify-center rounded-lg bg-white text-[var(--ink-400)]">
                <QrCode className="h-10 w-10" />
              </div>
            )}
            <div>
              <span className="block text-[10px] font-bold font-data-mono uppercase tracking-wider text-[var(--ink-400)]">Tatami PIN</span>
              <span className="font-data-mono text-2xl font-black tracking-[0.3em] text-[var(--ink-900)]">{panel.pin}</span>
            </div>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => {
                if (window.confirm("Rotate the QR code and PIN? Phones still waiting for approval will have to scan again. Judges already on the panel stay."))
                  run("rotate", () => rotateJudgePairing(ringId));
              }}
              className={`${smallBtn} border-[var(--line)] bg-white text-[var(--ink-700)] hover:bg-[var(--canvas)]`}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Rotate
            </button>
          </div>

          {/* Seats */}
          <div className="space-y-2">
            {Array.from({ length: panel.seats }, (_, i) => i + 1).map((seat) => {
              const holder = approved.find((s) => s.seat === seat);
              const waiting = pending.filter((s) => s.seat === seat);
              const vote = voteBySeat(seat);
              const byDesk = Boolean(vote?.isOverridden ?? vote?.is_overridden);
              return (
                <div key={seat} className="rounded-xl border border-[var(--line)] px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="font-data-mono text-xs font-black text-[var(--ink-500)]">J{seat}</span>
                      {holder ? (
                        <>
                          <span className="truncate text-sm font-bold text-[var(--ink-900)]">{holder.judgeName}</span>
                          <span className={`${chipBase} ${holder.connected ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                            {holder.connected ? "Connected" : "Approved, joining"}
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-[var(--ink-400)]">Empty seat</span>
                      )}
                      {matchId && vote && (
                        <span className={`${chipBase} ${byDesk ? "bg-[var(--canvas)] text-[var(--ink-700)]" : "bg-[var(--accent-tint)] text-[var(--accent-dark)]"}`}>
                          {byDesk ? "Desk mark" : "Voted"}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {matchId && vote && !finished && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => {
                            if (window.confirm(`Void seat J${seat}'s vote on this bout? It is recorded in the official log.`))
                              run(`void-${seat}`, () => voidJudgeVote({ matchId, judgeSeat: seat }));
                          }}
                          className={`${smallBtn} border-[var(--line)] bg-white text-[var(--ink-700)] hover:bg-[var(--canvas)]`}
                        >
                          Void vote
                        </button>
                      )}
                      {holder && (
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => {
                            if (window.confirm(`Remove ${holder.judgeName} from seat J${seat}?`)) run(`kick-${holder.id}`, () => kickJudge(holder.id));
                          }}
                          className={`${smallBtn} border-red-200 bg-white text-red-700 hover:bg-red-50`}
                        >
                          <X className="h-3.5 w-3.5" /> Remove
                        </button>
                      )}
                    </div>
                  </div>
                  {waiting.map((w) => (
                    <div key={w.id} className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-2.5 py-1.5">
                      <span className="text-xs text-amber-900">
                        <strong>{w.judgeName}</strong> wants this seat{holder ? ` (replaces ${holder.judgeName})` : ""}
                      </span>
                      <span className="flex gap-1.5">
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => run(`approve-${w.id}`, () => approveJudge(w.id))}
                          className={`${smallBtn} border-[var(--accent)] bg-[var(--accent)] text-white hover:bg-[var(--accent-dark)]`}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => run(`reject-${w.id}`, () => rejectJudge(w.id))}
                          className={`${smallBtn} border-[var(--line)] bg-white text-[var(--ink-700)] hover:bg-[var(--canvas)]`}
                        >
                          Reject
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}

            {(approved.length > 0 || pending.length > 0) && (
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => {
                    if (window.confirm("End the judge panel? Every phone on this tatami is signed out.")) run("end", () => endJudgePanel(ringId));
                  }}
                  className={`${smallBtn} border-red-200 bg-white text-red-700 hover:bg-red-50`}
                >
                  <Power className="h-3.5 w-3.5" /> End panel
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
