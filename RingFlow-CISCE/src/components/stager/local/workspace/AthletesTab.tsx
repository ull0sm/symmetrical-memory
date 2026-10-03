"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  moveAthleteIntoDivision,
  registerWalkIn,
  searchAthletesForDivision,
  setAttendanceLocal,
  setParticipationLocal,
} from "@/actions/staging";
import type { WorkspaceAthlete } from "@/lib/local/stagingView";
import type { DivisionEventType } from "@/lib/statuses";
import type { WorkspaceApi } from "./useWorkspace";

/**
 * The held category's athletes: the roll call (here or absent), who does kumite
 * and kata, and adding someone: an athlete of the tournament moved here with a
 * reason, or a walk-in registered on the spot.
 */

const away = (a: WorkspaceAthlete) => a.attendance === "absent" || a.attendance === "withdrawn";

export default function AthletesTab({ api, editable }: { api: WorkspaceApi; editable: boolean }) {
  const { ws, run, pending } = api;
  const divisionId = ws.division.id;
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const events = ws.events.map((e) => e.eventType);

  const counts = useMemo(() => {
    const here = ws.athletes.filter((a) => a.attendance === "present").length;
    const out = ws.athletes.filter(away).length;
    return { here, out, unmarked: ws.athletes.length - here - out };
  }, [ws.athletes]);

  const q = filter.trim().toLowerCase();
  const shown = q
    ? ws.athletes.filter((a) => a.name.toLowerCase().includes(q) || (a.club ?? "").toLowerCase().includes(q) || a.chestNumber === q)
    : ws.athletes;

  const setAttendance = (a: WorkspaceAthlete, status: "present" | "absent") => {
    const next = a.attendance === status ? null : status;
    void run(next === "absent" ? `Mark ${a.name} absent` : `Mark ${a.name}`, () => setAttendanceLocal(divisionId, a.id, next));
  };
  const toggleEvent = (a: WorkspaceAthlete, event: DivisionEventType) => {
    const value = !(event === "kata" ? a.kata : a.kumite);
    void run(`${value ? "Add" : "Take"} ${a.name} ${value ? "to" : "out of"} ${event}`, () => setParticipationLocal(divisionId, a.id, event, value));
  };

  return (
    <div className="space-y-3 pb-24">
      <section className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--line)] bg-white p-3">
        <p className="mr-auto text-[13px] text-[var(--ink-700)]">
          <span className="font-bold text-emerald-700">{counts.here} here</span> · <span className="font-bold text-red-700">{counts.out} absent</span> ·{" "}
          {counts.unmarked} not marked
        </p>
        {editable && (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            aria-expanded={adding}
            className="flex h-11 items-center gap-1.5 rounded-xl bg-[var(--ink-900)] px-4 text-[14px] font-bold text-white hover:opacity-90"
          >
            <span className="material-symbols-outlined text-[20px]">{adding ? "close" : "person_add"}</span>
            {adding ? "Close" : "Add athlete"}
          </button>
        )}
      </section>

      {adding && editable && <AddAthletePanel api={api} onDone={() => setAdding(false)} />}

      {ws.athletes.length > 8 && (
        <label className="flex h-11 items-center gap-2 rounded-xl border border-[var(--line)] bg-white px-3">
          <span className="material-symbols-outlined text-[20px] text-[var(--ink-400)]">filter_list</span>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter this category"
            aria-label="Filter this category"
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none"
          />
        </label>
      )}

      {ws.athletes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--line-strong)] p-6 text-center text-[13px] text-[var(--ink-500)]">Nobody in this category yet.</p>
      ) : (
        <ul className="divide-y divide-[var(--line)] overflow-hidden rounded-xl border border-[var(--line)] bg-white">
          {shown.map((a) => (
            <li key={a.id} className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 ${away(a) ? "bg-red-50/50" : ""}`}>
              <div className="min-w-[150px] flex-1">
                <p className={`text-[14.5px] font-semibold leading-snug ${away(a) ? "text-[var(--ink-500)] line-through" : "text-[var(--ink-900)]"}`}>
                  {a.name}
                  {a.walkIn && <span className="ml-1.5 rounded bg-amber-100 px-1 py-px align-middle text-[10px] font-bold uppercase text-amber-800">walk-in</span>}
                </p>
                <p className="text-[12px] text-[var(--ink-500)]">
                  {[a.club, a.chestNumber ? `#${a.chestNumber}` : null, a.attendance === "withdrawn" ? "withdrawn" : null].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {events.includes("kumite") && (
                  <Toggle on={a.kumite} disabled={!editable || !!pending} onClick={() => toggleEvent(a, "kumite")} label="Kumite">
                    K
                  </Toggle>
                )}
                {events.includes("kata") && (
                  <Toggle on={a.kata} disabled={!editable || !!pending} onClick={() => toggleEvent(a, "kata")} label="Kata">
                    Ka
                  </Toggle>
                )}
                <span className="mx-0.5 h-7 w-px bg-[var(--line)]" />
                <Toggle on={a.attendance === "present"} tone="here" disabled={!editable || !!pending} onClick={() => setAttendance(a, "present")} label="Here">
                  Here
                </Toggle>
                <Toggle on={a.attendance === "absent"} tone="absent" disabled={!editable || !!pending} onClick={() => setAttendance(a, "absent")} label="Absent">
                  Absent
                </Toggle>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Toggle({
  on,
  tone = "event",
  disabled,
  onClick,
  label,
  children,
}: {
  on: boolean;
  tone?: "event" | "here" | "absent";
  disabled: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  const active =
    tone === "here" ? "border-emerald-600 bg-emerald-600 text-white" : tone === "absent" ? "border-red-600 bg-red-600 text-white" : "border-[var(--ink-900)] bg-[var(--ink-900)] text-white";
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`h-11 min-w-[44px] rounded-lg border px-2.5 text-[13px] font-bold disabled:cursor-default ${
        on ? active : "border-[var(--line)] bg-white text-[var(--ink-500)]"
      } ${disabled && !on ? "opacity-60" : ""}`}
    >
      {children}
    </button>
  );
}

type Hit = Awaited<ReturnType<typeof searchAthletesForDivision>>[number];
type Duplicate = { id: string; name: string; club: string | null; divisionName: string | null };

/** Find someone of this tournament, or register a walk-in. */
function AddAthletePanel({ api, onDone }: { api: WorkspaceApi; onDone: () => void }) {
  const { ws, run, pending, setNotice } = api;
  const division = ws.division;
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [moving, setMoving] = useState<{ id: string; name: string } | null>(null);
  const [reason, setReason] = useState("");
  const [walkIn, setWalkIn] = useState<null | { name: string; club: string; age: string; belt: string; sex: string; kumite: boolean; kata: boolean }>(null);
  const [duplicates, setDuplicates] = useState<Duplicate[] | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits(null);
      return;
    }
    const n = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const found = await searchAthletesForDivision(division.id, q);
        if (n === seq.current) setHits(found);
      } catch (err) {
        console.error("Search failed:", err);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, division.id]);

  const startWalkIn = () =>
    setWalkIn({
      name: query.trim(),
      club: "",
      age: division.ageMin === division.ageMax ? String(division.ageMin) : "",
      belt: division.belts.length === 1 ? (division.belts[0] ?? "") : "",
      sex: division.sex === "any" ? "" : division.sex,
      kumite: ws.events.some((e) => e.eventType === "kumite"),
      kata: ws.events.some((e) => e.eventType === "kata"),
    });

  const moveHere = async () => {
    if (!moving) return;
    const res = await run(`Move ${moving.name} here`, () => moveAthleteIntoDivision(division.id, moving.id, reason));
    if (res?.success) {
      setNotice({ tone: "info", text: `${moving.name} is in ${division.name} now.` });
      onDone();
    }
  };

  const register = async (confirmNew: boolean) => {
    if (!walkIn) return;
    const res = await run(`Register ${walkIn.name || "walk-in"}`, () =>
      registerWalkIn(
        division.id,
        {
          name: walkIn.name,
          club: walkIn.club,
          age: walkIn.age || null,
          belt: walkIn.belt || null,
          sex: walkIn.sex || null,
          kumite: walkIn.kumite,
          kata: walkIn.kata,
        },
        confirmNew
      )
    );
    if (!res?.success) return;
    if (res.duplicates.length > 0 && !res.athleteId) {
      setDuplicates(res.duplicates);
      return;
    }
    setNotice({ tone: "info", text: `${res.name ?? walkIn.name} is registered${res.chestNumber ? ` as #${res.chestNumber}` : ""}. They're unplaced: put them in a group.` });
    onDone();
  };

  const input = "h-11 w-full rounded-lg border border-[var(--line)] bg-white px-3 text-[14px] outline-none focus:border-[var(--accent)]";
  const ageRange = division.ageMin === division.ageMax ? null : `${division.ageMin}–${division.ageMax}`;

  if (moving) {
    return (
      <section className="space-y-2.5 rounded-xl border-2 border-[var(--accent)] bg-white p-3">
        <p className="text-[14px] font-bold text-[var(--ink-900)]">Move {moving.name} into {division.name}?</p>
        <p className="text-[12.5px] text-[var(--ink-500)]">They leave their old category and its groups. Say why, for the record.</p>
        <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, e.g. wrong belt on the entry form" className={input} />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void moveHere()}
            disabled={reason.trim().length < 3 || !!pending}
            className="h-11 flex-1 rounded-xl bg-[var(--accent)] text-[14px] font-bold text-white disabled:opacity-50"
          >
            Move here
          </button>
          <button type="button" onClick={() => setMoving(null)} className="h-11 rounded-xl border border-[var(--line)] px-4 text-[14px] font-bold">
            Back
          </button>
        </div>
      </section>
    );
  }

  if (walkIn) {
    return (
      <section className="space-y-2.5 rounded-xl border-2 border-[var(--accent)] bg-white p-3">
        <p className="text-[14px] font-bold text-[var(--ink-900)]">Register a walk-in in {division.name}</p>
        {duplicates ? (
          <div className="space-y-2">
            <p className="text-[13px] text-[var(--ink-700)]">Is this someone already entered?</p>
            {duplicates.map((d) => (
              <div key={d.id} className="flex items-center gap-2 rounded-lg border border-[var(--line)] p-2">
                <p className="min-w-0 flex-1 text-[13px]">
                  <span className="font-semibold">{d.name}</span>
                  <span className="text-[var(--ink-500)]">{[d.club, d.divisionName ?? "no category"].filter(Boolean).map((x) => ` · ${x}`).join("")}</span>
                </p>
                {d.divisionName === division.name ? (
                  <span className="text-[12px] font-semibold text-[var(--ink-500)]">Already here</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setReason("Walk-in at the desk");
                      setMoving({ id: d.id, name: d.name });
                    }}
                    className="h-10 rounded-lg bg-[var(--ink-900)] px-3 text-[12.5px] font-bold text-white"
                  >
                    Yes, move here
                  </button>
                )}
              </div>
            ))}
            <button type="button" onClick={() => void register(true)} disabled={!!pending} className="h-11 w-full rounded-xl border border-[var(--line)] text-[14px] font-bold">
              No, register a new athlete
            </button>
          </div>
        ) : (
          <>
            <input autoFocus value={walkIn.name} onChange={(e) => setWalkIn({ ...walkIn, name: e.target.value })} placeholder="Full name" className={input} />
            <input value={walkIn.club} onChange={(e) => setWalkIn({ ...walkIn, club: e.target.value })} placeholder="Club" className={input} />
            <div className="flex flex-wrap gap-2">
              {ageRange && (
                <input
                  value={walkIn.age}
                  onChange={(e) => setWalkIn({ ...walkIn, age: e.target.value.replace(/[^0-9]/g, "") })}
                  inputMode="numeric"
                  placeholder={`Age (${ageRange})`}
                  className={`${input} w-32 flex-none`}
                />
              )}
              {division.belts.length > 1 && (
                <select value={walkIn.belt} onChange={(e) => setWalkIn({ ...walkIn, belt: e.target.value })} className={`${input} w-40 flex-none`} aria-label="Belt">
                  <option value="">Belt</option>
                  {division.belts.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              )}
              {division.sex === "any" && (
                <select value={walkIn.sex} onChange={(e) => setWalkIn({ ...walkIn, sex: e.target.value })} className={`${input} w-32 flex-none`} aria-label="Sex">
                  <option value="">Sex</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                </select>
              )}
            </div>
            <div className="flex gap-2">
              {ws.events.map((e) => (
                <Toggle
                  key={e.eventType}
                  on={e.eventType === "kata" ? walkIn.kata : walkIn.kumite}
                  disabled={false}
                  onClick={() => setWalkIn(e.eventType === "kata" ? { ...walkIn, kata: !walkIn.kata } : { ...walkIn, kumite: !walkIn.kumite })}
                  label={e.eventType === "kata" ? "Kata" : "Kumite"}
                >
                  {e.eventType === "kata" ? "Kata" : "Kumite"}
                </Toggle>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void register(false)}
                disabled={!walkIn.name.trim() || !walkIn.club.trim() || !!pending}
                className="h-11 flex-1 rounded-xl bg-[var(--accent)] text-[14px] font-bold text-white disabled:opacity-50"
              >
                Register
              </button>
              <button type="button" onClick={() => setWalkIn(null)} className="h-11 rounded-xl border border-[var(--line)] px-4 text-[14px] font-bold">
                Back
              </button>
            </div>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-2 rounded-xl border-2 border-[var(--accent)] bg-white p-3">
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Name, chest number or club"
        aria-label="Find an athlete"
        className={input}
      />
      {hits && (
        <ul className="divide-y divide-[var(--line)]">
          {hits.map((h) => (
            <li key={h.id} className="flex items-center gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold text-[var(--ink-900)]">{h.name}</p>
                <p className="truncate text-[12px] text-[var(--ink-500)]">
                  {[h.chestNumber ? `#${h.chestNumber}` : null, h.club, h.divisionName ?? "No category"].filter(Boolean).join(" · ")}
                </p>
              </div>
              {h.divisionId === division.id ? (
                <span className="text-[12px] font-semibold text-[var(--ink-500)]">In this category</span>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setReason("");
                    setMoving({ id: h.id, name: h.name });
                  }}
                  className="h-10 shrink-0 rounded-lg bg-[var(--ink-900)] px-3 text-[12.5px] font-bold text-white"
                >
                  Move here
                </button>
              )}
            </li>
          ))}
          {hits.length === 0 && <li className="py-2 text-[13px] text-[var(--ink-500)]">Nobody by that name in this tournament.</li>}
        </ul>
      )}
      <button
        type="button"
        onClick={startWalkIn}
        className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--line-strong)] text-[14px] font-bold text-[var(--ink-700)]"
      >
        <span className="material-symbols-outlined text-[20px]">person_add</span>
        Register a walk-in{query.trim() ? `: ${query.trim()}` : ""}
      </button>
    </section>
  );
}
