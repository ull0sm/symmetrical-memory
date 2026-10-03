"use client";

import React, { useEffect, useMemo, useState } from "react";
import { changeLockedGroup, previewLateChange, searchDeskAthletes } from "@/actions/staging";
import type { WorkspaceAthlete, WorkspaceEvent, WorkspaceGroup } from "@/lib/local/stagingView";
import GroupDraw from "./GroupDraw";

/**
 * The admin's change to a locked group: add an athlete (from this category, or as a
 * guest from another), take one out, or move one to another locked group of the
 * event. The admin sees each new draw and what it changes, then confirms with a
 * reason. Once the group is under way only an add is possible: a kumite athlete
 * takes an open bye, a kata athlete performs at the end.
 */

type Kind = "add" | "remove" | "move";
type Preview = Extract<Awaited<ReturnType<typeof previewLateChange>>, { success: true }>;
type Found = Awaited<ReturnType<typeof searchDeskAthletes>>[number];

const MIN_REASON = 5;

export default function LateChangeSheet({
  group,
  event,
  divisionId,
  tournamentId,
  athletes,
  athleteOf,
  onClose,
  onDone,
}: {
  group: WorkspaceGroup;
  event: WorkspaceEvent;
  divisionId: string;
  tournamentId: string;
  /** This category's athletes, for "from this category". */
  athletes: WorkspaceAthlete[];
  athleteOf: (id: string) => WorkspaceAthlete | undefined;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const started = group.stage === "started";
  const eventType = event.eventType;
  const [kind, setKind] = useState<Kind>("add");
  const [athleteId, setAthleteId] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ name: string; from: string | null } | null>(null);
  const [place, setPlace] = useState<number | undefined>(undefined);
  const [toGroupId, setToGroupId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  // Any change to the choice makes the preview stale.
  const reset = () => {
    setPreview(null);
    setError(null);
  };

  // Guests: athletes of other categories, by name, chest number or club.
  useEffect(() => {
    if (kind !== "add" || query.trim().length < 2) {
      setFound([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      searchDeskAthletes(tournamentId, query)
        .then((rows) => {
          if (live) setFound(rows.filter((r) => r.divisionId !== divisionId));
        })
        .catch((err) => console.error("Athlete search failed:", err));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [kind, query, tournamentId, divisionId]);

  const takesPart = (a: WorkspaceAthlete) => (eventType === "kata" ? a.kata : a.kumite);
  const placedHere = useMemo(() => new Set(event.groups.flatMap((g) => g.members)), [event.groups]);
  const fromHere = athletes.filter((a) => takesPart(a) && !placedHere.has(a.id) && (event.unplaced.includes(a.id) || a.attendance === "absent" || a.attendance === "withdrawn"));
  const targets = event.groups.filter((g) => g.id !== group.id && g.locked && g.stage !== "completed");
  const target = kind === "move" ? (targets.find((g) => g.id === toGroupId) ?? null) : group;

  // Byes the athlete can take in the group they join.
  const byes =
    eventType !== "kumite" || !target
      ? []
      : target.stage === "started"
        ? target.openByes.map((b) => ({ place: b.place, label: `Bout ${b.bout}: against ${athleteOf(b.athleteId)?.name ?? "the athlete with the bye"}` }))
        : target.places
            .filter((p) => p.athleteId === null)
            .map((p) => {
              const partner = target.places.find((q) => Math.ceil(q.place / 2) === Math.ceil(p.place / 2) && q.place !== p.place)?.athleteId;
              return { place: p.place, label: `Bout ${Math.ceil(p.place / 2)}: against ${partner ? (athleteOf(partner)?.name ?? "Athlete") : "nobody"}` };
            });

  const choose = (id: string, label: { name: string; from: string | null }) => {
    setAthleteId(id);
    setPicked(label);
    reset();
  };

  const change = () => {
    if (!athleteId) return null;
    if (kind === "remove") return { kind, athleteId } as const;
    if (kind === "move") return toGroupId ? ({ kind, athleteId, toGroupId, place } as const) : null;
    return { kind, athleteId, place } as const;
  };

  const show = async () => {
    const c = change();
    if (!c) return;
    setBusy(true);
    setError(null);
    try {
      const res = await previewLateChange(group.id, c);
      if (res.success) setPreview(res);
      else setError(res.error);
    } catch (err) {
      console.error("Preview failed:", err);
      setError("Couldn't work out the change. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    const c = change();
    if (!c || !preview) return;
    setBusy(true);
    setError(null);
    try {
      const res = await changeLockedGroup(group.id, c, reason, preview.fingerprint);
      if (res.success) {
        const who = picked?.name ?? "The athlete";
        onDone(
          kind === "remove"
            ? `${who} is out of Group ${group.groupNo}.`
            : kind === "move"
              ? `${who} moved to ${res.groups[0]?.name ?? "the other group"}.`
              : `${who} is in Group ${group.groupNo}.`
        );
      } else {
        setError(res.error);
        if (/changed since/i.test(res.error)) setPreview(null);
      }
    } catch (err) {
      console.error("Late change failed:", err);
      setError("The change wasn't saved. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const lookup = (id: string): WorkspaceAthlete | undefined => {
    const known = athleteOf(id);
    if (known) return known;
    const p = preview?.people.find((x) => x.id === id);
    return p
      ? { id: p.id, name: p.name, club: p.club, chestNumber: p.chestNumber, age: null, belt: null, kumite: true, kata: true, attendance: null, walkIn: false, guestFrom: id === athleteId && picked?.from ? picked.from : null }
      : undefined;
  };

  const ready = Boolean(change()) && (kind !== "add" || !started || eventType === "kata" || byes.length > 0);
  const stageNote = started
    ? eventType === "kumite"
      ? "Under way: a late athlete can only take a first-round bye whose holder hasn't fought on yet. No one can leave; record kiken on the tatami instead."
      : "Under way: a late athlete performs at the end of the order. No one can leave; confirm “didn't perform” on the tatami instead."
    : "Not started yet: the draw is rebuilt with everyone else where they are.";

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="late-title">
      <div className="flex max-h-[92vh] w-full max-w-xl flex-col rounded-t-2xl bg-[var(--canvas)] shadow-xl sm:rounded-2xl">
        <div className="flex items-start gap-3 border-b border-[var(--line)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-black uppercase tracking-wider text-[var(--ink-400)]">Change after lock</p>
            <h2 id="late-title" className="text-[17px] font-extrabold leading-snug text-[var(--ink-900)]">{group.name}</h2>
            <p className="text-[12.5px] text-[var(--ink-500)]">{stageNote}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-[var(--line)]">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {/* What to do */}
          <div className="flex gap-1.5" role="radiogroup" aria-label="Change">
            {(["add", "remove", "move"] as const).map((k) => {
              const off = k !== "add" && started;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={kind === k}
                  disabled={off || busy}
                  onClick={() => {
                    setKind(k);
                    setAthleteId(null);
                    setPicked(null);
                    setPlace(undefined);
                    setToGroupId(null);
                    reset();
                  }}
                  className={`h-11 flex-1 rounded-xl border text-[13.5px] font-bold disabled:opacity-40 ${
                    kind === k ? "border-[var(--ink-900)] bg-[var(--ink-900)] text-white" : "border-[var(--line)] bg-white text-[var(--ink-700)]"
                  }`}
                >
                  {k === "add" ? "Add" : k === "remove" ? "Take out" : "Move"}
                </button>
              );
            })}
          </div>

          {/* Who */}
          {kind === "add" ? (
            <div className="space-y-2">
              <p className="text-[11px] font-black uppercase tracking-wider text-[var(--ink-400)]">From this category</p>
              {fromHere.length === 0 ? (
                <p className="text-[12.5px] text-[var(--ink-500)]">Everyone taking part is already in a group.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {fromHere.map((a) => {
                    const awayNow = a.attendance === "absent" || a.attendance === "withdrawn";
                    return (
                      <Chip key={a.id} active={athleteId === a.id} onClick={() => choose(a.id, { name: a.name, from: null })}>
                        <span className="block text-[13.5px] font-semibold leading-tight">{a.name}</span>
                        <span className="block text-[11px] leading-tight text-[var(--ink-500)]">{[a.club, awayNow ? `marked ${a.attendance}` : null].filter(Boolean).join(" · ")}</span>
                      </Chip>
                    );
                  })}
                </div>
              )}
              <p className="pt-1 text-[11px] font-black uppercase tracking-wider text-[var(--ink-400)]">A guest from another category</p>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name, chest number or club"
                className="h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3 text-[14px]"
              />
              {found.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {found.map((a) => (
                    <Chip key={a.id} active={athleteId === a.id} onClick={() => choose(a.id, { name: a.name, from: a.divisionName ?? "no category" })}>
                      <span className="block text-[13.5px] font-semibold leading-tight">{a.name}</span>
                      <span className="block text-[11px] leading-tight text-[var(--ink-500)]">{[a.club, a.divisionName ?? "no category"].filter(Boolean).join(" · ")}</span>
                    </Chip>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] font-black uppercase tracking-wider text-[var(--ink-400)]">{kind === "remove" ? "Who leaves the group" : "Who moves"}</p>
              <div className="flex flex-wrap gap-1.5">
                {group.members.map((id) => {
                  const a = athleteOf(id);
                  return (
                    <Chip key={id} active={athleteId === id} onClick={() => choose(id, { name: a?.name ?? "Athlete", from: a?.guestFrom ?? null })}>
                      <span className="block text-[13.5px] font-semibold leading-tight">{a?.name ?? "Athlete"}</span>
                      <span className="block text-[11px] leading-tight text-[var(--ink-500)]">{a?.club ?? ""}</span>
                    </Chip>
                  );
                })}
              </div>
              {kind === "move" && (
                <>
                  <p className="pt-1 text-[11px] font-black uppercase tracking-wider text-[var(--ink-400)]">To</p>
                  {targets.length === 0 ? (
                    <p className="text-[12.5px] text-[var(--ink-500)]">No other locked group of this event can take them.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {targets.map((g) => (
                        <Chip
                          key={g.id}
                          active={toGroupId === g.id}
                          onClick={() => {
                            setToGroupId(g.id);
                            setPlace(undefined);
                            reset();
                          }}
                        >
                          <span className="block text-[13.5px] font-semibold leading-tight">Group {g.groupNo}</span>
                          <span className="block text-[11px] leading-tight text-[var(--ink-500)]">
                            {g.members.length} athletes{g.stage === "started" ? " · under way" : ""}
                          </span>
                        </Chip>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Which bye (kumite) */}
          {kind !== "remove" && eventType === "kumite" && target && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-black uppercase tracking-wider text-[var(--ink-400)]">Where they fight</p>
              {byes.length === 0 ? (
                <p className="text-[12.5px] text-[var(--ink-500)]">
                  {target.stage === "started"
                    ? "No bye can take a late athlete any more. Use a group that hasn't started, or a new group."
                    : "No bye is free: the bracket grows to the next size and every bout is drawn again."}
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {target.stage !== "started" && (
                    <Option active={place === undefined} onClick={() => (setPlace(undefined), reset())}>
                      Let the draw choose a bye
                    </Option>
                  )}
                  {byes.map((b, i) => (
                    <Option
                      key={b.place}
                      active={place === b.place || (target.stage === "started" && place === undefined && i === 0)}
                      onClick={() => (setPlace(b.place), reset())}
                    >
                      {b.label}
                    </Option>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-900">{error}</p>}

          {/* The new draw */}
          {preview && (
            <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
              {preview.newcomer?.guest && (
                <p className="text-[12.5px] text-sky-900">
                  {preview.newcomer.name} joins as a guest from {preview.newcomer.guestFrom ?? "another category"}. Their own category doesn&apos;t change.
                </p>
              )}
              {preview.newcomer?.wasAway && (
                <p className="text-[12.5px] text-amber-900">
                  {preview.newcomer.name} is marked {preview.newcomer.wasAway}; adding them marks them present.
                </p>
              )}
              {preview.groups.map((g) => (
                <div key={g.id} className="space-y-1.5">
                  <p className="text-[13px] font-extrabold text-[var(--ink-900)]">{g.name}</p>
                  {g.lines.length > 0 ? (
                    <ul className="space-y-0.5">
                      {g.lines.slice(0, 8).map((l) => (
                        <li key={l} className="text-[12.5px] text-[var(--ink-700)]">
                          {l}
                        </li>
                      ))}
                      {g.lines.length > 8 && <li className="text-[12.5px] text-[var(--ink-500)]">and {g.lines.length - 8} more.</li>}
                    </ul>
                  ) : (
                    <p className="text-[12.5px] text-[var(--ink-500)]">No other athlete&apos;s bout changes.</p>
                  )}
                  <GroupDraw
                    group={{ ...(event.groups.find((x) => x.id === g.id) ?? group), places: g.places, members: g.places.map((p) => p.athleteId).filter((id): id is string => id !== null) }}
                    eventType={eventType}
                    athleteOf={lookup}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2 border-t border-[var(--line)] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {preview ? (
            <>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why? e.g. arrived late, missed their own category"
                aria-label="Reason"
                className="h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3 text-[14px]"
              />
              <button
                type="button"
                onClick={() => void confirm()}
                disabled={busy || reason.trim().length < MIN_REASON}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] text-[15px] font-bold text-white hover:bg-[var(--accent-dark)] disabled:opacity-50"
              >
                {busy ? "Saving…" : reason.trim().length < MIN_REASON ? "Give a reason to confirm" : "Confirm the change"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void show()}
              disabled={busy || !ready}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--ink-900)] text-[15px] font-bold text-white disabled:opacity-40"
            >
              {busy ? "Working it out…" : "Show the new draw"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-[44px] rounded-lg border px-2.5 py-1 text-left ${
        active ? "border-[var(--accent)] bg-[var(--accent-tint)] ring-2 ring-[var(--accent)]/40" : "border-[var(--line)] bg-white"
      }`}
    >
      {children}
    </button>
  );
}

function Option({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`flex min-h-[44px] items-center gap-2 rounded-lg border px-3 text-left text-[13.5px] ${
        active ? "border-[var(--accent)] bg-[var(--accent-tint)] font-semibold text-[var(--accent-dark)]" : "border-[var(--line)] bg-white text-[var(--ink-700)]"
      }`}
    >
      <span className="material-symbols-outlined text-[18px]">{active ? "radio_button_checked" : "radio_button_unchecked"}</span>
      {children}
    </button>
  );
}
