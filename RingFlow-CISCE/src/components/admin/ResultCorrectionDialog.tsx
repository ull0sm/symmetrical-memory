"use client";

import { useState } from "react";
import { correctBoutResult } from "@/actions/matches";
import type { BracketMatchView } from "@/lib/draws/assembleDraw";

const METHODS = [
  ["POINTS", "Points difference"],
  ["SENSHU", "Senshu (first point)"],
  ["8_POINT_LEAD", "8-point lead"],
  ["HANTEI", "Hantei (judges)"],
  ["KIKEN", "Kiken (injury / forfeit)"],
  ["HANSOKU", "Hansoku (disqualification)"],
  ["SHIKKAKU", "Shikkaku (severe misconduct)"],
] as const;

type ConflictMatch = { matchNo: number; roundName: string; status: string };

interface Props {
  match: BracketMatchView;
  onClose: () => void;
  onCorrected: () => void;
}

const inputClass =
  "w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm font-semibold text-[var(--ink-900)] focus:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";
const labelClass = "mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--ink-700)]";

/**
 * Admin-only correction of a CONFIRMED kumite bout. The reason is
 * mandatory and lands in the official record; reversing a winner whose later
 * bouts are already fought needs an explicit rollback confirmation.
 */
export function ResultCorrectionDialog({ match, onClose, onCorrected }: Props) {
  const initialSide: "AKA" | "AO" = match.winnerId && match.winnerId === match.ao.id ? "AO" : "AKA";
  const [side, setSide] = useState<"AKA" | "AO">(initialSide);
  const [akaPoints, setAkaPoints] = useState(match.akaScore ?? 0);
  const [aoPoints, setAoPoints] = useState(match.aoScore ?? 0);
  const [akaPenalties, setAkaPenalties] = useState(match.akaPenalties ?? 0);
  const [aoPenalties, setAoPenalties] = useState(match.aoPenalties ?? 0);
  const [method, setMethod] = useState(match.decisionMethod || "POINTS");
  const [reason, setReason] = useState("");
  const [conflicts, setConflicts] = useState<ConflictMatch[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const winnerId = side === "AKA" ? match.aka.id : match.ao.id;
  const canSubmit = Boolean(winnerId) && reason.trim().length >= 5 && !saving;

  const submit = async (allowRollback: boolean) => {
    if (!winnerId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await correctBoutResult(match.matchId, winnerId, reason.trim(), {
        side,
        akaPoints,
        aoPoints,
        akaPenalties,
        aoPenalties,
        senshu: match.senshu === "AKA" || match.senshu === "AO" ? match.senshu : null,
        method,
        allowRollback,
      });
      if (res.success) {
        onCorrected();
        return;
      }
      if ("requiresRollbackConfirmation" in res && res.requiresRollbackConfirmation) {
        setConflicts((res.conflictMatches as ConflictMatch[] | undefined) ?? []);
        return;
      }
      setError(res.error || "The correction was not saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The correction was not saved.");
    } finally {
      setSaving(false);
    }
  };

  const numberField = (label: string, value: number, set: (n: number) => void, id: string) => (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={0}
        max={99}
        value={value}
        onChange={(e) => set(Math.max(0, Math.trunc(Number(e.target.value) || 0)))}
        className={`${inputClass} font-data-mono tabular-nums`}
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--line)] bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
          <div>
            <h3 className="text-base font-bold text-[var(--ink-900)]">Correct result: Bout #{match.matchNo}</h3>
            <p className="text-xs text-[var(--ink-500)]">
              {match.roundName}. The correction and its reason go into the official record.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded-lg p-1.5 text-[var(--ink-500)] hover:bg-[var(--canvas)] hover:text-[var(--ink-900)]"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {conflicts ? (
          <div className="space-y-4 px-5 py-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-bold">Later bouts are affected</p>
              <p className="mt-1 text-xs">
                Changing the winner rolls these bouts back to ready, so the new winner can compete:
              </p>
              <ul className="mt-2 space-y-0.5 text-xs font-semibold">
                {conflicts.map((c) => (
                  <li key={c.matchNo}>
                    Bout #{c.matchNo} ({c.roundName}), {c.status.toLowerCase()}
                  </li>
                ))}
              </ul>
            </div>
            {error && <p className="text-sm font-semibold text-red-700">{error}</p>}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConflicts(null)}
                className="cursor-pointer rounded-xl border border-[var(--line)] px-4 py-2 text-sm font-bold text-[var(--ink-700)] hover:bg-[var(--canvas)]"
              >
                Back
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => submit(true)}
                className="cursor-pointer rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-60"
              >
                {saving ? "Saving..." : "Roll back and correct"}
              </button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-4 px-5 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) submit(false);
            }}
          >
            <fieldset>
              <legend className={labelClass}>Winner</legend>
              <div className="grid grid-cols-2 gap-2">
                {(["AKA", "AO"] as const).map((s) => {
                  const athlete = s === "AKA" ? match.aka : match.ao;
                  const active = side === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSide(s)}
                      aria-pressed={active}
                      className={`cursor-pointer rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                        active
                          ? "border-[var(--accent)] bg-[var(--accent-tint)] font-bold text-[var(--ink-900)]"
                          : "border-[var(--line)] text-[var(--ink-700)] hover:bg-[var(--canvas)]"
                      }`}
                    >
                      <span className={`mr-1.5 inline-block h-2.5 w-2.5 rounded-full ${s === "AKA" ? "bg-red-600" : "bg-blue-700"}`} />
                      {athlete.displayName}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {numberField("Aka pts", akaPoints, setAkaPoints, "corr-aka-pts")}
              {numberField("Ao pts", aoPoints, setAoPoints, "corr-ao-pts")}
              {numberField("Aka warn", akaPenalties, setAkaPenalties, "corr-aka-pen")}
              {numberField("Ao warn", aoPenalties, setAoPenalties, "corr-ao-pen")}
            </div>

            <div>
              <label htmlFor="corr-method" className={labelClass}>
                Decision method
              </label>
              <select id="corr-method" value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
                {METHODS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="corr-reason" className={labelClass}>
                Reason (required)
              </label>
              <textarea
                id="corr-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="e.g. Scoring desk recorded the wrong winner; confirmed with the referee panel."
                className={inputClass}
              />
              <p className="mt-1 text-[11px] text-[var(--ink-400)]">At least 5 characters.</p>
            </div>

            {error && <p className="text-sm font-semibold text-red-700">{error}</p>}

            <div className="flex justify-end gap-2 border-t border-[var(--line)] pt-4">
              <button
                type="button"
                onClick={onClose}
                className="cursor-pointer rounded-xl border border-[var(--line)] px-4 py-2 text-sm font-bold text-[var(--ink-700)] hover:bg-[var(--canvas)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="cursor-pointer rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-bold text-white hover:bg-[var(--accent-dark)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save correction"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
