"use client";

import React, { useEffect, useState } from "react";
import { getWalkInsToReview, mergeWalkIn, reviewWalkIn } from "@/actions/localAthletes";
import { searchDeskAthletes } from "@/actions/staging";

/**
 * Walk-ins the stagers registered at the venue, waiting for the admin: confirm
 * their details (correcting any), or merge one into the registered athlete it
 * turns out to be, which works only before either has fought a bout.
 */

type WalkIn = Awaited<ReturnType<typeof getWalkInsToReview>>[number];
type Candidate = { id: string; name: string; chestNumber: string | null; club: string | null; divisionName: string | null };
type Mode = { id: string; kind: "edit" | "merge" } | null;

const btn = "h-10 px-3 border border-outline-variant rounded text-sm font-semibold hover:bg-surface-container-low disabled:opacity-50 flex items-center gap-1.5";
const field = "h-10 rounded border border-outline-variant bg-white px-2 text-sm";

export default function WalkInReview({ tournamentId, walkIns, onChanged }: { tournamentId: string; walkIns: WalkIn[]; onChanged: () => Promise<void> }) {
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (walkIns.length === 0 && !done) return null;

  const act = async (id: string, fn: () => Promise<{ success: boolean; error?: string }>, ok: string) => {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fn();
      if (!res.success) setProblem({ id, text: res.error ?? "That didn't work." });
      else {
        setMode(null);
        setDone(ok);
        await onChanged();
      }
    } catch (err) {
      console.error("Walk-in review failed:", err);
      setProblem({ id, text: "That didn't work. Try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h3 className="text-[15px] font-bold text-primary">Walk-ins to review · {walkIns.length}</h3>
        <p className="text-[12.5px] text-on-surface-variant">Registered by a stager at the venue. Confirm their details, or merge one into the athlete it really is.</p>
      </div>
      {done && (
        <p role="status" className="rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {done}
        </p>
      )}
      {walkIns.length > 0 && (
        <ul className="divide-y divide-outline-variant overflow-hidden rounded border border-outline-variant bg-white">
          {walkIns.map((w) => (
            <li key={w.id} className="p-3 sm:p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-[200px] flex-1">
                  <p className="text-[15px] font-bold text-on-surface">
                    {w.name}
                    {w.chestNumber && <span className="ml-1.5 text-[12.5px] font-normal text-on-surface-variant">#{w.chestNumber}</span>}
                  </p>
                  <p className="text-[12.5px] text-on-surface-variant">
                    {[w.club, w.age ? `age ${w.age}` : null, w.belt, w.sex, w.divisionName ?? "no category"].filter(Boolean).join(" · ")}
                    {w.groups.length > 0 ? ` · in ${w.groups.join(", ")}` : ""}
                  </p>
                  {w.maybe.length > 0 && <p className="mt-0.5 text-[12.5px] text-amber-800">Maybe the same as {w.maybe.slice(0, 2).map((m) => m.name).join(" or ")}?</p>}
                </div>
                <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                  <button className={btn} disabled={busy} onClick={() => void act(w.id, () => reviewWalkIn(tournamentId, w.id), `${w.name}'s details are confirmed.`)}>
                    <span className="material-symbols-outlined text-[18px]">check</span> Details are right
                  </button>
                  <button className={btn} disabled={busy} onClick={() => setMode({ id: w.id, kind: "edit" })}>
                    <span className="material-symbols-outlined text-[18px]">edit</span> Correct
                  </button>
                  <button className={btn} disabled={busy} onClick={() => setMode({ id: w.id, kind: "merge" })}>
                    <span className="material-symbols-outlined text-[18px]">merge</span> Same person as…
                  </button>
                </div>
              </div>
              {mode?.id === w.id && mode.kind === "edit" && (
                <EditForm walkIn={w} busy={busy} onCancel={() => setMode(null)} onSave={(details) => void act(w.id, () => reviewWalkIn(tournamentId, w.id, details), `${details.name ?? w.name}'s details are corrected and confirmed.`)} />
              )}
              {mode?.id === w.id && mode.kind === "merge" && (
                <MergeForm
                  tournamentId={tournamentId}
                  walkIn={w}
                  busy={busy}
                  onCancel={() => setMode(null)}
                  onMerge={(into) => void act(w.id, () => mergeWalkIn(tournamentId, w.id, into.id), `${w.name} is merged into ${into.name}.`)}
                />
              )}
              {problem?.id === w.id && <p className="mt-2 rounded bg-error-container px-3 py-2 text-sm text-on-error-container">{problem.text}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EditForm({
  walkIn,
  busy,
  onCancel,
  onSave,
}: {
  walkIn: WalkIn;
  busy: boolean;
  onCancel: () => void;
  onSave: (details: { name: string; club: string; age: string; belt: string; sex: string }) => void;
}) {
  const [d, setD] = useState({ name: walkIn.name, club: walkIn.club ?? "", age: walkIn.age ?? "", belt: walkIn.belt ?? "", sex: walkIn.sex ?? "" });
  const set = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD({ ...d, [k]: e.target.value });
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded bg-surface-container-low p-3">
      <input className={`${field} min-w-[180px] flex-1`} value={d.name} onChange={set("name")} aria-label="Name" placeholder="Name" />
      <input className={`${field} min-w-[160px] flex-1`} value={d.club} onChange={set("club")} aria-label="Club" placeholder="Club" />
      <input className={`${field} w-20`} value={d.age} onChange={set("age")} aria-label="Age" placeholder="Age" inputMode="numeric" />
      <input className={`${field} w-28`} value={d.belt} onChange={set("belt")} aria-label="Belt" placeholder="Belt" />
      <select className={`${field} w-24`} value={d.sex} onChange={set("sex")} aria-label="Sex">
        <option value="">Sex</option>
        <option value="M">M</option>
        <option value="F">F</option>
      </select>
      <button className="h-10 rounded bg-primary px-4 text-sm font-semibold text-on-primary disabled:opacity-50" disabled={busy || !d.name.trim()} onClick={() => onSave(d)}>
        Save and confirm
      </button>
      <button className="h-10 px-3 text-sm font-semibold" onClick={onCancel}>
        Cancel
      </button>
      <p className="w-full text-[12px] text-on-surface-variant">Their category stays as it is; move them from Athletes if it should change.</p>
    </div>
  );
}

function MergeForm({
  tournamentId,
  walkIn,
  busy,
  onCancel,
  onMerge,
}: {
  tournamentId: string;
  walkIn: WalkIn;
  busy: boolean;
  onCancel: () => void;
  onMerge: (into: Candidate) => void;
}) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Candidate[]>([]);
  const [chosen, setChosen] = useState<Candidate | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setFound([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      searchDeskAthletes(tournamentId, query)
        .then((rows) => {
          if (live) setFound(rows.filter((r) => r.id !== walkIn.id).map((r) => ({ id: r.id, name: r.name, chestNumber: r.chestNumber, club: r.club, divisionName: r.divisionName })));
        })
        .catch((err) => console.error("Athlete search failed:", err));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query, tournamentId, walkIn.id]);

  const list = query.trim().length >= 2 ? found : walkIn.maybe;
  return (
    <div className="mt-3 space-y-2 rounded bg-surface-container-low p-3">
      <input className={`${field} w-full`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find the registered athlete: name, chest number or club" />
      {list.length === 0 ? (
        <p className="text-[12.5px] text-on-surface-variant">{query.trim().length >= 2 ? "Nobody found." : "No likely match. Search above."}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {list.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={chosen?.id === c.id}
              onClick={() => setChosen(c)}
              className={`min-h-[44px] rounded border px-2.5 py-1 text-left ${chosen?.id === c.id ? "border-primary bg-primary/10" : "border-outline-variant bg-white"}`}
            >
              <span className="block text-[13.5px] font-semibold leading-tight">
                {c.name}
                {c.chestNumber ? ` #${c.chestNumber}` : ""}
              </span>
              <span className="block text-[11px] leading-tight text-on-surface-variant">{[c.club, c.divisionName ?? "no category"].filter(Boolean).join(" · ")}</span>
            </button>
          ))}
        </div>
      )}
      {chosen && (
        <p className="text-[12.5px] text-on-surface">
          {chosen.name} keeps their name and chest number, and the walk-in record of {walkIn.name} is deleted.{" "}
          {walkIn.groups.length > 0
            ? `${chosen.name} takes ${walkIn.name}'s place in ${walkIn.groups.join(", ")}.`
            : `${chosen.name} competes where ${walkIn.name} was registered, unless they are already in a group.`}{" "}
          Not possible once either has fought a bout.
        </p>
      )}
      <div className="flex gap-2">
        <button className="h-10 rounded bg-primary px-4 text-sm font-semibold text-on-primary disabled:opacity-50" disabled={busy || !chosen} onClick={() => chosen && onMerge(chosen)}>
          Merge
        </button>
        <button className="h-10 px-3 text-sm font-semibold" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
