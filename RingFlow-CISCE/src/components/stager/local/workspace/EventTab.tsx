"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  addGroup,
  autoFillEvent,
  getDivisionWorkspace,
  lockGroup,
  moveAthlete,
  placeAthlete,
  rebalanceEvent,
  removeGroup,
  shuffleGroup,
  swapAthletes,
  unlockGroup,
  unpinAthletes,
} from "@/actions/staging";
import type { WorkspaceAthlete, WorkspaceEvent, WorkspaceGroup } from "@/lib/local/stagingView";
import GroupDraw, { type DrawTarget } from "./GroupDraw";
import LateChangeSheet from "./LateChangeSheet";
import LockSheet from "./LockSheet";
import type { WorkspaceApi } from "./useWorkspace";
import { EVENT_LABEL } from "../format";

/**
 * One event of the held category: its groups, the athletes in none of them, and
 * the draw of each group. Tap an athlete, then tap where they go: another
 * athlete of the group (swap), a bye (move there), another group, a new group or
 * Unplaced. On a phone one group shows at a time; wider screens show them side
 * by side, with drag and drop as well. The admin also changes locked groups
 * here: unlock one that hasn't started, or add, take out and move athletes.
 */

interface Selection {
  athleteId: string;
  groupId: string | null;
  place: number | null;
}

const shortName = (g: WorkspaceGroup) => `G${g.groupNo}`;

export default function EventTab({
  api,
  event,
  athletes,
  editable,
  viewer,
  stickyTop,
  onLocked,
}: {
  api: WorkspaceApi;
  event: WorkspaceEvent;
  athletes: Map<string, WorkspaceAthlete>;
  editable: boolean;
  /** The admin changes locked groups whether or not they hold the category. */
  viewer: "stager" | "admin";
  /** Where the group chips stick: under the page header and the tabs. */
  stickyTop: number;
  /** After a lock: whether that ended the hold (every group sent). */
  onLocked: (released: boolean) => void;
}) {
  const { run, pending, forgetUndo, expectLeaving, setNotice } = api;
  const divisionId = api.ws.division.id;
  const eventType = event.eventType;
  const athleteOf = (id: string) => athletes.get(id);
  const nameOf = (id: string) => athletes.get(id)?.name ?? "Athlete";

  const firstDraft = event.groups.find((g) => !g.locked) ?? event.groups[0] ?? null;
  const [shown, setShown] = useState<string | null>(firstDraft?.id ?? null);
  const [sel, setSel] = useState<Selection | null>(null);
  const [locking, setLocking] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [changing, setChanging] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState<string | null>(null);

  // Keep the shown group valid as groups come and go.
  useEffect(() => {
    if (!event.groups.some((g) => g.id === shown)) setShown(firstDraft?.id ?? null);
  }, [event.groups, shown, firstDraft]);
  // A selection that no longer matches the draft is dropped.
  useEffect(() => {
    if (!sel) return;
    const where = event.groups.find((g) => g.members.includes(sel.athleteId))?.id ?? null;
    if (where !== sel.groupId || (where === null && !event.unplaced.includes(sel.athleteId))) setSel(null);
  }, [event, sel]);

  const groupById = useMemo(() => new Map(event.groups.map((g) => [g.id, g])), [event.groups]);
  const drafts = event.groups.filter((g) => !g.locked);
  const shownGroup = shown ? (groupById.get(shown) ?? null) : null;
  const selectedPinned = sel?.groupId ? groupById.get(sel.groupId)?.pins[sel.athleteId] !== undefined : false;

  // ── Changes ──
  const move = (athleteId: string, to: string | "new" | null) =>
    run(
      to === null ? `Take ${nameOf(athleteId)} out` : `Move ${nameOf(athleteId)}`,
      () => moveAthlete(divisionId, { athleteId, eventType, to }),
      eventType
    ).then((res) => {
      if (res?.success && res.groupId) setShown(res.groupId);
    });

  /** Into another group at a chosen place; the place is kept only if the draw keeps its shape. */
  const moveAndPlace = (athleteId: string, groupId: string, place: number) => {
    const before = groupById.get(groupId)?.places.length ?? 0;
    return run(
      `Move ${nameOf(athleteId)}`,
      async () => {
        const moved = await moveAthlete(divisionId, { athleteId, eventType, to: groupId });
        if (!moved.success) return moved;
        const fresh = await getDivisionWorkspace(divisionId);
        const g = fresh?.events.find((e) => e.eventType === eventType)?.groups.find((x) => x.id === groupId);
        if (!g || place > g.places.length || (eventType === "kumite" && g.places.length !== before)) return moved;
        return placeAthlete(groupId, { athleteId, place, expectedVersion: g.version });
      },
      eventType
    ).then(() => setShown(groupId));
  };

  const tapPlace = (t: DrawTarget) => {
    if (!editable) return;
    const group = groupById.get(t.groupId);
    if (!group || group.locked) return;
    if (!sel) {
      if (t.athleteId) setSel({ athleteId: t.athleteId, groupId: t.groupId, place: t.place });
      return;
    }
    if (sel.athleteId === t.athleteId) {
      setSel(null);
      return;
    }
    const a = sel.athleteId;
    setSel(null);
    if (sel.groupId === t.groupId) {
      if (t.athleteId) {
        const b = t.athleteId;
        void run(`Swap ${nameOf(a)} and ${nameOf(b)}`, () => swapAthletes(group.id, { a, b, expectedVersion: group.version }), eventType);
      } else {
        void run(`Place ${nameOf(a)}`, () => placeAthlete(group.id, { athleteId: a, place: t.place, expectedVersion: group.version }), eventType);
      }
    } else {
      void moveAndPlace(a, group.id, t.place);
    }
  };

  const tapUnplaced = (athleteId: string) => {
    if (!editable) return;
    setSel(sel?.athleteId === athleteId ? null : { athleteId, groupId: null, place: null });
  };

  const tapGroupChip = (g: WorkspaceGroup) => {
    if (sel && editable && !g.locked && sel.groupId !== g.id) {
      const a = sel.athleteId;
      setSel(null);
      void move(a, g.id);
      return;
    }
    setShown(g.id);
  };

  const sendOut = () => {
    if (!sel?.groupId) return;
    const a = sel.athleteId;
    setSel(null);
    void move(a, null);
  };

  const lock = async (group: WorkspaceGroup) => {
    let released = false;
    const res = await run(`Lock ${shortName(group)}`, async () => {
      const out = await lockGroup(group.id, group.checksum ?? undefined);
      if (out.success && out.released) {
        released = true;
        expectLeaving("sent");
      }
      return out;
    });
    if (res?.success) {
      setLocking(null);
      forgetUndo(eventType);
      setNotice({ tone: "info", text: `Group ${group.groupNo} is locked${group.ringName ? ` and sent to ${group.ringName}` : ""}.` });
      onLocked(released);
      const next = drafts.find((g) => g.id !== group.id);
      if (next) setShown(next.id);
    }
  };

  const unlock = async (group: WorkspaceGroup, reason: string) => {
    const res = await run(`Unlock ${shortName(group)}`, () => unlockGroup(group.id, reason));
    if (res?.success) {
      setUnlocking(null);
      setNotice({ tone: "info", text: `Group ${group.groupNo} is a draft again. Whoever takes the category can change it and lock it again.` });
    }
  };

  const lockTarget = locking ? groupById.get(locking) : undefined;
  const changeTarget = changing ? groupById.get(changing) : undefined;
  const dragProps = (athleteId: string) => ({
    draggable: editable,
    onDragStart: () => setSel({ athleteId, groupId: null, place: null }),
  });

  return (
    <div className="space-y-3 pb-28 lg:pb-6">
      {/* Event summary and its tools */}
      <section className="rounded-xl border border-[var(--line)] bg-white p-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="text-[16px] font-extrabold text-[var(--ink-900)]">{EVENT_LABEL[eventType]}</h2>
          <p className="text-[12.5px] text-[var(--ink-500)]">
            {event.groups.length} group{event.groups.length === 1 ? "" : "s"} · {event.groups.filter((g) => g.locked).length} sent · plan {event.planSize} a group ·{" "}
            {event.bronzeMedals === 2 ? "two bronzes" : "one bronze"}
          </p>
        </div>
        {event.warnings.length > 0 && (
          <ul className="mt-2 space-y-1">
            {event.warnings.map((w) => (
              <li key={w} className="flex gap-1.5 text-[12.5px] text-amber-800">
                <span className="material-symbols-outlined text-[16px]">warning</span>
                {w}
              </li>
            ))}
          </ul>
        )}
        {editable && (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {event.unplaced.length > 0 && drafts.length > 0 && (
              <ToolButton icon="playlist_add" onClick={() => void run(`Fill ${event.unplaced.length} into groups`, () => autoFillEvent(divisionId, eventType), eventType)} disabled={!!pending}>
                Fill {event.unplaced.length} into groups
              </ToolButton>
            )}
            {drafts.length > 1 && (
              <ToolButton icon="balance" onClick={() => void run("Rebalance", () => rebalanceEvent(divisionId, eventType), eventType)} disabled={!!pending}>
                Rebalance
              </ToolButton>
            )}
          </div>
        )}
      </section>

      {/* Group chips: switch group, or the target of a move */}
      <div className="sticky z-20 -mx-4 bg-[var(--canvas)] px-4 py-1 sm:mx-0 sm:px-0" style={{ top: stickyTop }}>
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Groups">
          {event.groups.map((g) => {
            const target = sel && editable && !g.locked && sel.groupId !== g.id;
            const active = g.id === shown;
            return (
              <button
                key={g.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => tapGroupChip(g)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  tapGroupChip(g);
                }}
                className={`flex h-11 shrink-0 items-center gap-1 rounded-[999px] border px-4 text-[13.5px] font-bold ${
                  target
                    ? "border-dashed border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent-dark)]"
                    : active
                      ? "border-[var(--ink-900)] bg-[var(--ink-900)] text-white"
                      : "border-[var(--line)] bg-white text-[var(--ink-700)]"
                }`}
              >
                {g.locked && (
                  <span className="material-symbols-outlined text-[16px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                    lock
                  </span>
                )}
                {target ? `→ ${shortName(g)}` : shortName(g)} · {g.members.length}
                {g.blockers.length > 0 && !target && <span className="ml-0.5 h-2 w-2 rounded-[999px] bg-red-500" aria-label="needs attention" />}
              </button>
            );
          })}
          {editable && (
            <button
              type="button"
              onClick={() => {
                if (sel) {
                  const a = sel.athleteId;
                  setSel(null);
                  void move(a, "new");
                } else {
                  void run("Add a group", () => addGroup(divisionId, eventType), eventType).then((res) => {
                    if (res?.success && "groupId" in res) setShown(res.groupId);
                  });
                }
              }}
              disabled={!!pending}
              className={`flex h-11 shrink-0 items-center gap-1 rounded-[999px] border border-dashed px-4 text-[13.5px] font-bold ${
                sel ? "border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent-dark)]" : "border-[var(--line-strong)] text-[var(--ink-700)]"
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              {sel ? "New group" : "Group"}
            </button>
          )}
        </div>
      </div>

      {/* Present athletes in no group */}
      {(event.unplaced.length > 0 || (sel?.groupId && editable)) && (
        <section
          aria-label="Unplaced"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            sendOut();
          }}
          className={`rounded-xl border p-2.5 ${sel?.groupId ? "border-dashed border-amber-400 bg-amber-50" : "border-amber-200 bg-amber-50/70"}`}
        >
          <div className="flex items-center justify-between gap-2 px-0.5 pb-1.5">
            <p className="text-[11px] font-black uppercase tracking-wider text-amber-900">Unplaced · {event.unplaced.length}</p>
            {sel?.groupId && editable && (
              <button type="button" onClick={sendOut} className="h-9 rounded-lg bg-amber-200 px-3 text-[12.5px] font-bold text-amber-950">
                Take {nameOf(sel.athleteId)} out
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {event.unplaced.map((id) => {
              const a = athletes.get(id);
              const active = sel?.athleteId === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => tapUnplaced(id)}
                  {...dragProps(id)}
                  aria-pressed={active}
                  className={`flex min-h-[44px] items-center gap-1.5 rounded-lg border px-2.5 py-1 text-left ${
                    active ? "border-[var(--accent)] bg-[var(--accent-tint)] ring-2 ring-[var(--accent)]/40" : "border-amber-200 bg-white"
                  }`}
                >
                  <span>
                    <span className="block text-[13.5px] font-semibold leading-tight text-[var(--ink-900)]">{a?.name ?? "Athlete"}</span>
                    <span className="block text-[11px] leading-tight text-[var(--ink-500)]">{a?.club ?? ""}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {editable && !sel && drafts.length > 0 && (
        <p className="px-1 text-[12px] text-[var(--ink-500)]">
          {eventType === "kata"
            ? "Tap an athlete, then tap where they go: another athlete swaps their places, a group chip moves them to that group."
            : "Tap an athlete, then tap where they go: another athlete swaps them, a bye moves them there, a group chip moves them to that group."}
        </p>
      )}

      {/* The groups: one at a time on a phone, side by side on a wide screen */}
      {event.groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--line-strong)] p-6 text-center text-[13px] text-[var(--ink-500)]">
          No groups yet.{editable ? " Add one with + Group." : ""}
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {event.groups.map((g) => (
            <GroupPanel
              key={g.id}
              group={g}
              hiddenOnPhone={g.id !== shown}
              eventType={eventType}
              athleteOf={athleteOf}
              editable={editable && !g.locked}
              busy={!!pending}
              selection={sel}
              selectionName={sel ? nameOf(sel.athleteId) : null}
              onTap={tapPlace}
              onDragStart={(t) => t.athleteId && setSel({ athleteId: t.athleteId, groupId: t.groupId, place: t.place })}
              onPutHere={() => {
                if (!sel) return;
                const a = sel.athleteId;
                setSel(null);
                void move(a, g.id);
              }}
              onShuffle={() => void run(`Shuffle ${shortName(g)}`, () => shuffleGroup(g.id), eventType)}
              onClearPins={() => void run(`Clear pins in ${shortName(g)}`, () => unpinAthletes(g.id), eventType)}
              confirmingRemove={confirmRemove === g.id}
              onRemove={() => {
                if (g.members.length > 0 && confirmRemove !== g.id) {
                  setConfirmRemove(g.id);
                  return;
                }
                setConfirmRemove(null);
                void run(`Remove ${shortName(g)}`, () => removeGroup(g.id)).then((res) => {
                  if (res?.success) forgetUndo(eventType);
                });
              }}
              onCancelRemove={() => setConfirmRemove(null)}
              onLock={() => setLocking(g.id)}
              admin={
                viewer === "admin" && g.locked
                  ? {
                      unlocking: unlocking === g.id,
                      onChange: () => setChanging(g.id),
                      onUnlock: () => setUnlocking(g.id),
                      onCancelUnlock: () => setUnlocking(null),
                      onConfirmUnlock: (reason: string) => void unlock(g, reason),
                    }
                  : null
              }
            />
          ))}
        </div>
      )}

      {/* Phone action bar: what to do with the selected athlete, or lock the group on show */}
      {editable && (sel || (shownGroup && !shownGroup.locked)) && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--line)] bg-[var(--surface)]/95 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur lg:hidden">
          {sel ? (
            <div className="flex items-center gap-2 overflow-x-auto">
              <p className="min-w-0 shrink truncate text-[13px] font-bold text-[var(--ink-900)]">{nameOf(sel.athleteId)}</p>
              {selectedPinned && sel.groupId && (
                <BarButton
                  onClick={() => {
                    const a = sel.athleteId;
                    const gid = sel.groupId as string;
                    setSel(null);
                    void run(`Unpin ${nameOf(a)}`, () => unpinAthletes(gid, a), eventType);
                  }}
                >
                  Unpin
                </BarButton>
              )}
              {sel.groupId && <BarButton onClick={sendOut}>Unplaced</BarButton>}
              <BarButton
                onClick={() => {
                  const a = sel.athleteId;
                  setSel(null);
                  void move(a, "new");
                }}
              >
                New group
              </BarButton>
              <BarButton onClick={() => setSel(null)}>Cancel</BarButton>
            </div>
          ) : shownGroup ? (
            <button
              type="button"
              onClick={() => setLocking(shownGroup.id)}
              disabled={!!pending || shownGroup.members.length === 0}
              className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-bold ${
                shownGroup.blockers.length > 0 ? "bg-[var(--line)] text-[var(--ink-500)]" : "bg-[var(--accent)] text-white"
              } disabled:opacity-50`}
            >
              <span className="material-symbols-outlined text-[20px]">lock</span>
              {shownGroup.blockers.length > 0 ? `${shortName(shownGroup)} can't be locked yet` : `Lock and send ${shortName(shownGroup)}`}
            </button>
          ) : null}
        </div>
      )}

      {changeTarget && (
        <LateChangeSheet
          group={changeTarget}
          event={event}
          divisionId={divisionId}
          tournamentId={api.ws.division.tournamentId}
          athletes={api.ws.athletes}
          athleteOf={athleteOf}
          onClose={() => setChanging(null)}
          onDone={(text) => {
            setChanging(null);
            setNotice({ tone: "info", text });
            void api.refresh();
          }}
        />
      )}

      {lockTarget && (
        <LockSheet
          group={lockTarget}
          eventType={eventType}
          athleteOf={athleteOf}
          ringName={lockTarget.ringName}
          busy={!!pending}
          onClose={() => setLocking(null)}
          onConfirm={() => void lock(lockTarget)}
        />
      )}
    </div>
  );
}

function GroupPanel({
  group,
  hiddenOnPhone,
  eventType,
  athleteOf,
  editable,
  busy,
  selection,
  selectionName,
  onTap,
  onDragStart,
  onPutHere,
  onShuffle,
  onClearPins,
  confirmingRemove,
  onRemove,
  onCancelRemove,
  onLock,
  admin,
}: {
  group: WorkspaceGroup;
  hiddenOnPhone: boolean;
  eventType: WorkspaceEvent["eventType"];
  athleteOf: (id: string) => WorkspaceAthlete | undefined;
  editable: boolean;
  busy: boolean;
  selection: Selection | null;
  selectionName: string | null;
  onTap: (t: DrawTarget) => void;
  onDragStart: (t: DrawTarget) => void;
  onPutHere: () => void;
  onShuffle: () => void;
  onClearPins: () => void;
  confirmingRemove: boolean;
  onRemove: () => void;
  onCancelRemove: () => void;
  onLock: () => void;
  /** The admin's hand on a locked group, or null. */
  admin: {
    unlocking: boolean;
    onChange: () => void;
    onUnlock: () => void;
    onCancelUnlock: () => void;
    onConfirmUnlock: (reason: string) => void;
  } | null;
}) {
  const pins = Object.keys(group.pins).length;
  const onMat = group.status === "running" || group.status === "paused";
  const status = group.locked
    ? group.stage === "completed"
      ? "Finished"
      : onMat
        ? "On the mat"
        : group.stage === "started"
          ? "Under way"
          : "Locked"
    : "Draft";
  return (
    <section className={`${hiddenOnPhone ? "hidden lg:block" : ""} rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3`} aria-label={group.name}>
      <header className="mb-2.5 flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-extrabold text-[var(--ink-900)]">Group {group.groupNo}</h3>
        <span className="text-[12.5px] text-[var(--ink-500)]">
          {group.members.length} athlete{group.members.length === 1 ? "" : "s"}
          {pins > 0 ? ` · ${pins} placed by hand` : ""}
        </span>
        <span
          className={`ml-auto rounded-[999px] border px-2 py-0.5 text-[11px] font-bold ${
            group.locked ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-[var(--line-strong)] bg-white text-[var(--ink-700)]"
          }`}
        >
          {status}
          {group.ringName ? ` · ${group.ringName}` : ""}
        </span>
      </header>

      {!group.locked &&
        group.blockers.map((b) => (
          <p key={b} className="mb-1.5 flex gap-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-[12.5px] text-red-900">
            <span className="material-symbols-outlined text-[16px]">block</span>
            {b}
          </p>
        ))}
      {!group.locked &&
        group.warnings.map((w) => (
          <p key={w} className="mb-1.5 flex gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[12.5px] text-amber-900">
            <span className="material-symbols-outlined text-[16px]">warning</span>
            {w}
          </p>
        ))}

      {editable && selection && selection.groupId !== group.id && (
        <button
          type="button"
          onClick={onPutHere}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onPutHere();
          }}
          className="mb-2 flex h-12 w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-[var(--accent)] bg-[var(--accent-tint)] text-[14px] font-bold text-[var(--accent-dark)]"
        >
          <span className="material-symbols-outlined text-[20px]">south</span>
          Put {selectionName} in Group {group.groupNo}
        </button>
      )}

      <GroupDraw
        group={group}
        eventType={eventType}
        athleteOf={athleteOf}
        interaction={editable ? { selectedId: selection?.athleteId ?? null, onTap, onDragStart } : undefined}
      />

      {admin && <AdminLockedTools group={group} onMat={onMat} busy={busy} {...admin} />}

      {editable && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <ToolButton icon="shuffle" onClick={onShuffle} disabled={busy || group.members.length < 2}>
            Shuffle{pins > 0 ? " unpinned" : ""}
          </ToolButton>
          {pins > 0 && (
            <ToolButton icon="push_pin" onClick={onClearPins} disabled={busy}>
              Clear pins
            </ToolButton>
          )}
          {confirmingRemove ? (
            <span className="flex items-center gap-1.5 rounded-lg bg-red-50 px-2 py-1 text-[12.5px] text-red-900">
              Its {group.members.length} go to Unplaced.
              <button type="button" onClick={onRemove} className="h-9 rounded-lg bg-red-600 px-3 font-bold text-white">
                Remove
              </button>
              <button type="button" onClick={onCancelRemove} className="h-9 rounded-lg px-2 font-bold">
                Keep
              </button>
            </span>
          ) : (
            <ToolButton icon="delete" onClick={onRemove} disabled={busy}>
              Remove group
            </ToolButton>
          )}
          <button
            type="button"
            onClick={onLock}
            disabled={busy || group.members.length === 0}
            className="ml-auto hidden h-11 items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 text-[14px] font-bold text-white hover:bg-[var(--accent-dark)] disabled:opacity-50 lg:flex"
          >
            <span className="material-symbols-outlined text-[18px]">lock</span>
            Lock and send
          </button>
        </div>
      )}
    </section>
  );
}

/** The admin's controls on a locked group: change it after lock, or unlock it before its first bout. */
function AdminLockedTools({
  group,
  onMat,
  busy,
  unlocking,
  onChange,
  onUnlock,
  onCancelUnlock,
  onConfirmUnlock,
}: {
  group: WorkspaceGroup;
  onMat: boolean;
  busy: boolean;
  unlocking: boolean;
  onChange: () => void;
  onUnlock: () => void;
  onCancelUnlock: () => void;
  onConfirmUnlock: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  if (group.stage === "completed") {
    return <p className="mt-3 text-[12.5px] text-[var(--ink-500)]">Finished: nothing in this group can change now.</p>;
  }
  const canUnlock = group.stage === "ready" && !onMat;
  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <ToolButton icon="edit_note" onClick={onChange} disabled={busy}>
          Change after lock
        </ToolButton>
        {canUnlock && !unlocking && (
          <ToolButton icon="lock_open" onClick={onUnlock} disabled={busy}>
            Unlock
          </ToolButton>
        )}
      </div>
      {unlocking && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--canvas)] p-2">
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why unlock it? e.g. wrong groups sent"
            aria-label="Reason to unlock"
            className="h-10 min-w-[200px] flex-1 rounded-lg border border-[var(--line)] bg-white px-3 text-[13.5px]"
          />
          <button
            type="button"
            onClick={() => onConfirmUnlock(reason)}
            disabled={busy || reason.trim().length < 5}
            className="h-10 rounded-lg bg-[var(--ink-900)] px-3 text-[13px] font-bold text-white disabled:opacity-50"
          >
            Unlock
          </button>
          <button type="button" onClick={onCancelUnlock} className="h-10 rounded-lg px-2 text-[13px] font-bold text-[var(--ink-700)]">
            Keep locked
          </button>
          <p className="w-full text-[12px] text-[var(--ink-500)]">Its bouts are taken off {group.ringName ?? "the tatami"} until it is locked again.</p>
        </div>
      )}
      {!canUnlock && group.stage === "ready" && onMat && (
        <p className="text-[12px] text-[var(--ink-500)]">It is on the mat, so it can&apos;t be unlocked. The moderator can return it to the queue first.</p>
      )}
    </div>
  );
}

function ToolButton({ icon, onClick, disabled, children }: { icon: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-10 items-center gap-1.5 rounded-lg border border-[var(--line)] bg-white px-3 text-[13px] font-semibold text-[var(--ink-700)] hover:bg-[var(--canvas)] disabled:opacity-50"
    >
      <span className="material-symbols-outlined text-[18px]">{icon}</span>
      {children}
    </button>
  );
}

function BarButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="h-11 shrink-0 rounded-xl border border-[var(--line)] bg-white px-3.5 text-[13px] font-bold text-[var(--ink-900)]">
      {children}
    </button>
  );
}
