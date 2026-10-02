"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, Clock, Lock, LogOut, Maximize2, Minimize2, RefreshCw, ShieldAlert, Smartphone } from "lucide-react";
import { getJudgeBout, getJudgeStatus, leaveJudgePanel, requestJudgeSeat, submitJudgeVote, type JudgeStatus } from "@/actions/judge";
import { KataScoreWheelPicker } from "@/components/judge/KataScoreWheelPicker";
import { useFallbackPoll } from "@/hooks/useFallbackPoll";
import { useLiveEvents } from "@/hooks/useLiveEvents";
import { JUDGE_PANEL_SEATS } from "@/lib/constants";

type BoutView = Extract<Awaited<ReturnType<typeof getJudgeBout>>, { success: true }>;

interface Props {
  ringId: string;
  /** From the desk's QR code. Without it the judge enters the tatami PIN. */
  pairingKey: string;
}

const NAME_KEY = "ringflow_judge_name";

const END_REASONS: Record<string, string> = {
  kicked: "The desk removed this phone from the panel.",
  replaced: "Another phone was approved for your seat.",
  panel_ended: "The desk ended the judge panel.",
  rotated: "The desk changed the QR code before approving you. Scan the new one.",
  left: "You left the panel.",
  expired: "Your judge session expired.",
  withdrawn: "This request was replaced by a newer one.",
};

const screen = "min-h-dvh bg-[var(--surface)] text-[var(--ink-900)] flex flex-col items-center justify-center p-4 select-none";
const panel = "w-full max-w-sm rounded-3xl border border-[var(--line)] bg-white p-6 shadow-xl";
const label = "mb-1 block text-[11px] font-bold font-data-mono uppercase tracking-wider text-[var(--ink-500)]";
const primaryBtn =
  "flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-[var(--accent)] px-4 py-4 text-sm font-bold text-white transition-colors hover:bg-[var(--accent-dark)] disabled:cursor-not-allowed disabled:opacity-50";

function readStoredName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export default function JudgeMobileClient({ ringId, pairingKey }: Props) {
  const [status, setStatus] = useState<JudgeStatus | null>(null);
  const [bout, setBout] = useState<BoutView | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Pairing form
  const [name, setName] = useState("");
  const [seat, setSeat] = useState(1);
  const [pin, setPin] = useState("");
  const [sending, setSending] = useState(false);

  // Voting
  const [flag, setFlag] = useState<"AKA" | "AO" | null>(null);
  const [side, setSide] = useState<"AKA" | "AO">("AKA");
  const [mark, setMark] = useState(7.0);
  const [voting, setVoting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const lastMatch = useRef<string | null>(null);

  useEffect(() => setName(readStoredName()), []);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await getJudgeStatus(ringId);
      setStatus(s);
      if (s.seat) setSeat(s.seat);
      return s;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cannot reach the tatami desk.");
      return null;
    }
  }, [ringId]);

  const refreshBout = useCallback(async () => {
    try {
      const b = await getJudgeBout(ringId);
      setBout(b);
      // New bout on the mat: reset the local picks to this judge's stored vote.
      const id = b.bout?.matchId ?? null;
      if (id !== lastMatch.current) {
        lastMatch.current = id;
        setFlag(b.myVote?.flag ?? null);
        setSide("AKA");
        setMark(b.myVote?.aka ?? 7.0);
      }
    } catch {
      // Session gone (kicked, panel ended, expired): fall back to the status screen.
      setBout(null);
      await refreshStatus();
    }
  }, [ringId, refreshStatus]);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (status?.status === "approved") refreshBout();
  }, [status?.status, refreshBout]);

  const { connected } = useLiveEvents({ ringId }, (event) => {
    if (event?.table === "judge_sessions") refreshStatus();
    else if (status?.status === "approved") refreshBout();
  });

  // Polling only while the live feed is down (phones on flaky guest Wi-Fi).
  const s = status?.status;
  useFallbackPoll(
    () => (s === "pending" ? refreshStatus() : s === "approved" ? refreshBout() : undefined),
    connected,
    s === "pending" ? 4000 : 10000
  );

  // Keep the screen on while judging.
  useEffect(() => {
    if (status?.status !== "approved") return;
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock
      ?.request("screen")
      .then((l) => (lock = l))
      .catch((err) => console.warn("Wake lock unavailable:", err));
    return () => {
      lock?.release().catch(() => undefined);
    };
  }, [status?.status]);

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggleFullscreen = () => {
    const done = document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.();
    done?.catch((err) => console.warn("Fullscreen not available:", err));
  };

  const sendRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError(null);
    try {
      try {
        localStorage.setItem(NAME_KEY, name.trim());
      } catch {
        // Private mode: the name just isn't remembered.
      }
      const res = await requestJudgeSeat({ ringId, name, seat, key: pairingKey || undefined, pin: pairingKey ? undefined : pin });
      if (!res.success) setError(res.error);
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setSending(false);
    }
  };

  const castVote = async () => {
    if (!bout?.bout) return;
    setVoting(true);
    setError(null);
    try {
      const b = bout.bout;
      const res =
        b.mode === "FLAG"
          ? await submitJudgeVote({ matchId: b.matchId, flag: flag ?? undefined })
          : await submitJudgeVote({ matchId: b.matchId, [side === "AKA" ? "aka" : "ao"]: Number(mark.toFixed(1)) });
      if (!res.success) setError(res.error);
      await refreshBout();
      // POINTS: after AKA's mark, move on to AO.
      if (res.success && b.mode === "POINTS" && side === "AKA" && b.ao) {
        setSide("AO");
        setMark(bout.myVote?.ao ?? 7.0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Vote not sent.");
    } finally {
      setVoting(false);
    }
  };

  const leave = async () => {
    if (!window.confirm("Leave the judge panel on this tatami?")) return;
    await leaveJudgePanel(ringId);
    setBout(null);
    await refreshStatus();
  };

  // ── Loading ──
  if (!status) {
    return (
      <div className={screen}>
        <RefreshCw className="h-8 w-8 animate-spin text-[var(--accent)]" />
        <p className="mt-3 text-xs font-bold font-data-mono text-[var(--ink-500)]">Connecting to the tatami desk…</p>
      </div>
    );
  }

  // ── Pair: name, seat, PIN (or QR key) ──
  if (status.status === "none" || status.status === "rejected" || status.status === "ended") {
    const notice =
      status.status === "rejected"
        ? "The desk did not approve your request."
        : status.status === "ended"
          ? END_REASONS[status.endReason ?? ""] ?? "Your judge session ended."
          : null;
    return (
      <div className={screen}>
        <div className={`${panel} space-y-5`}>
          <div className="text-center">
            <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--accent-tint)] text-[var(--accent)]">
              <Smartphone className="h-7 w-7" />
            </span>
            {status.ringName && (
              <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-2.5 py-0.5 text-[11px] font-bold font-data-mono text-[var(--ink-700)]">
                {status.ringName}
              </span>
            )}
            <h1 className="mt-2 text-xl font-bold">Join the kata panel</h1>
            <p className="mt-1 text-xs text-[var(--ink-500)]">The desk approves each phone before it can vote.</p>
          </div>

          {notice && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{notice}</span>
            </div>
          )}

          {!status.ringName ? (
            <p className="text-center text-sm text-[var(--ink-500)]">This tatami link is not valid. Scan the QR code at the desk again.</p>
          ) : (
            <form onSubmit={sendRequest} className="space-y-4">
              {!pairingKey && (
                <div>
                  <label htmlFor="judge-pin" className={label}>
                    Tatami PIN
                  </label>
                  <input
                    id="judge-pin"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={8}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                    className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-4 py-2.5 text-center font-data-mono text-3xl font-black tracking-[0.4em] outline-none focus:border-[var(--accent)]"
                  />
                </div>
              )}
              <div>
                <label htmlFor="judge-name" className={label}>
                  Your name
                </label>
                <input
                  id="judge-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                  required
                  autoComplete="name"
                  className="w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 py-2.5 text-base outline-none focus:border-[var(--accent)]"
                />
              </div>
              <fieldset>
                <legend className={label}>Seat</legend>
                <div className="grid grid-cols-5 gap-1.5">
                  {Array.from({ length: JUDGE_PANEL_SEATS }, (_, i) => i + 1).map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={seat === s}
                      onClick={() => setSeat(s)}
                      className={`cursor-pointer rounded-lg border py-2.5 text-sm font-bold font-data-mono ${
                        seat === s
                          ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                          : "border-[var(--line)] bg-[var(--surface)] text-[var(--ink-900)]"
                      }`}
                    >
                      J{s}
                    </button>
                  ))}
                </div>
              </fieldset>
              {error && <p className="text-sm font-semibold text-red-700">{error}</p>}
              <button type="submit" disabled={sending || !name.trim() || (!pairingKey && pin.length < 4)} className={primaryBtn}>
                {sending ? <RefreshCw className="h-4 w-4 animate-spin" /> : "Ask the desk for this seat"}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  // ── Waiting for the desk ──
  if (status.status === "pending") {
    return (
      <div className={screen}>
        <div className={`${panel} space-y-5 text-center`}>
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border-2 border-amber-300 bg-amber-50 text-amber-600">
            <Clock className="h-8 w-8 animate-pulse" />
          </span>
          <div>
            <h2 className="text-xl font-bold">Waiting for the desk</h2>
            <p className="mt-1 text-xs text-[var(--ink-500)]">
              {status.judgeName}, seat J{status.seat} on {status.ringName}. This screen opens by itself once the moderator approves you.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setStatus({ ...status, status: "none" })}
            className="mx-auto flex cursor-pointer items-center gap-1 text-xs text-[var(--ink-500)] hover:text-[var(--ink-900)]"
          >
            Change name or seat
          </button>
        </div>
      </div>
    );
  }

  // ── Judging ──
  const b = bout?.bout ?? null;
  const open = b?.voting === "open";
  const my = bout?.myVote;
  const sideName = (s: "AKA" | "AO") => (s === "AKA" ? b?.aka.name : b?.ao?.name) ?? s;

  return (
    <div className="flex min-h-dvh select-none flex-col bg-[var(--surface)] p-4 text-[var(--ink-900)] touch-manipulation">
      <header className="flex items-center justify-between rounded-2xl border border-[var(--line)] bg-white px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          <span className="truncate text-xs font-bold font-data-mono uppercase">{status.ringName}</span>
          <span className="rounded-md bg-[var(--accent-tint)] px-2 py-0.5 text-[11px] font-bold font-data-mono text-[var(--accent-dark)]">
            J{status.seat} · {status.judgeName}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
            className="cursor-pointer rounded-lg border border-[var(--line)] p-1.5 text-[var(--ink-500)]"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={leave}
            aria-label="Leave the panel"
            className="cursor-pointer rounded-lg border border-[var(--line)] p-1.5 text-[var(--ink-500)]"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="mx-auto my-4 flex w-full max-w-md flex-1 flex-col justify-center gap-4">
        <section className="rounded-2xl border border-[var(--line)] bg-white p-4 text-center">
          <p className="text-[11px] font-bold font-data-mono uppercase tracking-wider text-[var(--ink-400)]">
            {bout?.category ?? "Kata"}
            {b?.poolGroup ? ` · ${b.poolGroup}` : ""}
          </p>
          <h2 className="mt-1 text-base font-bold">{b
              ? b.roundName?.includes(`#${b.matchNo}`)
                ? b.roundName
                : `${b.roundName || "Bout"} · #${b.matchNo}`
              : "Waiting for the next bout"}</h2>
          {b ? (
            <div className={`mt-3 grid gap-2 ${b.ao ? "grid-cols-2" : "grid-cols-1"}`}>
              {(["AKA", "AO"] as const)
                .filter((s) => s === "AKA" || b.ao)
                .map((s) => {
                  const a = s === "AKA" ? b.aka : b.ao!;
                  return (
                    <div key={s} className={`rounded-xl border p-2.5 text-left ${s === "AKA" ? "border-red-200 bg-red-50" : "border-blue-200 bg-blue-50"}`}>
                      <p className={`text-[10px] font-black font-data-mono ${s === "AKA" ? "text-red-700" : "text-blue-700"}`}>{s}</p>
                      <p className="truncate text-sm font-bold">{a.name}</p>
                      {a.kata && <p className="truncate text-[11px] text-[var(--ink-700)]">{a.kata}</p>}
                    </div>
                  );
                })}
            </div>
          ) : (
            <p className="mt-2 text-xs text-[var(--ink-500)]">The desk will put the next kata bout on the mat.</p>
          )}
        </section>

        {b && (
          <section className="rounded-3xl border border-[var(--line)] bg-white p-5 text-center">
            <p
              className={`mb-3 inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold font-data-mono uppercase ${
                open ? "bg-emerald-100 text-emerald-800" : "bg-[var(--canvas)] text-[var(--ink-500)]"
              }`}
            >
              {open ? "Voting open" : <><Lock className="h-3 w-3" /> {b.finished ? "Bout finished" : b.voting === "closed" ? "Voting closed" : "Wait for the desk to open voting"}</>}
            </p>

            {my?.enteredByDesk && (
              <p className="mb-3 rounded-lg bg-[var(--canvas)] px-3 py-2 text-xs text-[var(--ink-700)]">The desk entered the mark for your seat.</p>
            )}

            {b.mode === "FLAG" ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {(["AKA", "AO"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={!open || voting}
                      aria-pressed={flag === s}
                      onClick={() => setFlag(s)}
                      className={`cursor-pointer rounded-2xl border-2 py-10 text-lg font-black font-data-mono transition-colors disabled:cursor-not-allowed ${
                        flag === s
                          ? s === "AKA"
                            ? "border-red-600 bg-red-600 text-white"
                            : "border-blue-700 bg-blue-700 text-white"
                          : s === "AKA"
                            ? "border-red-200 bg-red-50 text-red-700"
                            : "border-blue-200 bg-blue-50 text-blue-700"
                      } ${!open ? "opacity-60" : ""}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <p className="mt-3 text-xs text-[var(--ink-500)]">
                  Your flag: <strong className="text-[var(--ink-900)]">{my?.flag ?? "not sent"}</strong>
                </p>
                {open && (
                  <button type="button" disabled={!flag || voting || flag === my?.flag} onClick={castVote} className={`${primaryBtn} mt-3`}>
                    {voting ? <RefreshCw className="h-5 w-5 animate-spin" /> : flag && flag === my?.flag ? <><Check className="h-5 w-5" /> Flag sent</> : `Send ${flag ?? ""} flag`}
                  </button>
                )}
              </>
            ) : (
              <>
                {b.ao && (
                  <div className="mb-3 grid grid-cols-2 gap-2">
                    {(["AKA", "AO"] as const).map((s) => (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={side === s}
                        onClick={() => {
                          setSide(s);
                          setMark((s === "AKA" ? my?.aka : my?.ao) ?? 7.0);
                        }}
                        className={`cursor-pointer rounded-xl border py-2 text-xs font-bold font-data-mono ${
                          side === s ? (s === "AKA" ? "border-red-600 bg-red-50 text-red-800" : "border-blue-700 bg-blue-50 text-blue-800") : "border-[var(--line)] text-[var(--ink-500)]"
                        }`}
                      >
                        {s}: {(s === "AKA" ? my?.aka : my?.ao)?.toFixed(1) ?? "—"}
                      </button>
                    ))}
                  </div>
                )}
                <p className="mb-2 text-xs text-[var(--ink-500)]">
                  Mark for <strong className={side === "AKA" ? "text-red-700" : "text-blue-700"}>{sideName(side)}</strong> (5.0 – 10.0)
                </p>
                {open ? (
                  <>
                    <KataScoreWheelPicker value={mark} onChange={setMark} minWhole={5} maxWhole={10} />
                    <button type="button" disabled={voting} onClick={castVote} className={`${primaryBtn} mt-3`}>
                      {voting ? <RefreshCw className="h-5 w-5 animate-spin" /> : `Send ${mark.toFixed(1)} for ${side}`}
                    </button>
                  </>
                ) : (
                  <p className="font-data-mono text-4xl font-black">{(side === "AKA" ? my?.aka : my?.ao)?.toFixed(1) ?? "—"}</p>
                )}
              </>
            )}
            {error && <p className="mt-3 text-sm font-semibold text-red-700">{error}</p>}
          </section>
        )}
      </main>
    </div>
  );
}
