"use client";

import React from "react";
import type { WorkspaceAthlete, WorkspaceGroup } from "@/lib/local/stagingView";
import type { DivisionEventType } from "@/lib/statuses";

/**
 * A group's draw as it stands: first-round bouts with red and blue sides and
 * byes (kumite), or the performance order called in pairs (kata). The same
 * picture is the stager's working surface (tap or drag an athlete, then tap
 * or drop where they go) and the read-only lock sheet.
 */

export interface DrawTarget {
  groupId: string;
  place: number;
  athleteId: string | null;
}

export interface DrawInteraction {
  selectedId: string | null;
  onTap: (target: DrawTarget) => void;
  /** Drag and drop on a mouse: the drag selects, the drop taps. */
  onDragStart: (target: DrawTarget) => void;
}

export default function GroupDraw({
  group,
  eventType,
  athleteOf,
  interaction,
}: {
  group: WorkspaceGroup;
  eventType: DivisionEventType;
  athleteOf: (id: string) => WorkspaceAthlete | undefined;
  interaction?: DrawInteraction;
}) {
  if (group.places.length === 0) {
    return group.members.length === 0 ? (
      <p className="rounded-xl border border-dashed border-[var(--line-strong)] px-3 py-5 text-center text-[13px] text-[var(--ink-500)]">
        No athletes yet. {interaction ? "Tap an unplaced athlete, then this group." : ""}
      </p>
    ) : (
      <ul className="space-y-1.5">
        {group.members.map((id, i) => (
          <li key={id}>
            <Slot target={{ groupId: group.id, place: i + 1, athleteId: id }} athlete={athleteOf(id)} pinned={false} interaction={interaction} />
          </li>
        ))}
      </ul>
    );
  }

  if (eventType === "kata") {
    // A locked group's order can hold an empty side: a solo that started before a late performer was added after it.
    const pairs: (typeof group.places)[] = [];
    for (let i = 0; i < group.places.length; i += 2) pairs.push(group.places.slice(i, i + 2).filter((p) => p.athleteId !== null || interaction));
    let performer = 0;
    return (
      <ol className="space-y-2.5">
        {pairs.map((pair, i) => (
          <li key={i} className="rounded-xl border border-[var(--line)] bg-white p-2">
            <p className="px-1 pb-1 text-[10.5px] font-black uppercase tracking-wider text-[var(--ink-400)]">
              {pair.length === 1 ? "Solo" : `Pair ${i + 1}`}
            </p>
            <div className="space-y-1.5">
              {pair.map((p) => (
                <Slot
                  key={p.place}
                  target={{ groupId: group.id, place: p.place, athleteId: p.athleteId }}
                  athlete={p.athleteId ? athleteOf(p.athleteId) : undefined}
                  pinned={p.pinned}
                  number={(performer += 1)}
                  interaction={interaction}
                />
              ))}
            </div>
          </li>
        ))}
      </ol>
    );
  }

  const bouts: (typeof group.places)[] = [];
  for (let i = 0; i < group.places.length; i += 2) bouts.push(group.places.slice(i, i + 2));
  return (
    <ol className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
      {bouts.map((bout, i) => {
        const bye = bout.some((p) => p.athleteId === null);
        return (
          <li key={i} className="rounded-xl border border-[var(--line)] bg-white p-2">
            <p className="flex items-center justify-between px-1 pb-1 text-[10.5px] font-black uppercase tracking-wider text-[var(--ink-400)]">
              <span>Bout {i + 1}</span>
              {bye && <span className="normal-case tracking-normal">bye: goes through</span>}
            </p>
            <div className="space-y-1.5">
              {bout.map((p, side) => (
                <Slot
                  key={p.place}
                  target={{ groupId: group.id, place: p.place, athleteId: p.athleteId }}
                  athlete={p.athleteId ? athleteOf(p.athleteId) : undefined}
                  pinned={p.pinned}
                  side={side === 0 ? "red" : "blue"}
                  interaction={interaction}
                />
              ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Slot({
  target,
  athlete,
  pinned,
  side,
  number,
  interaction,
}: {
  target: DrawTarget;
  athlete: WorkspaceAthlete | undefined;
  pinned: boolean;
  side?: "red" | "blue";
  number?: number;
  interaction?: DrawInteraction;
}) {
  const selected = interaction?.selectedId !== null && interaction?.selectedId === target.athleteId;
  const empty = target.athleteId === null;
  const away = athlete?.attendance === "absent" || athlete?.attendance === "withdrawn";
  const edge = side === "red" ? "border-l-red-500" : side === "blue" ? "border-l-blue-600" : "border-l-transparent";
  const tone = selected
    ? "border-[var(--accent)] bg-[var(--accent-tint)] ring-2 ring-[var(--accent)]/40"
    : empty
      ? "border-dashed border-[var(--line-strong)] bg-[var(--surface)]"
      : "border-[var(--line)] bg-white";

  const body = (
    <>
      {number !== undefined && <span className="w-6 shrink-0 text-center text-[14px] font-black text-[var(--ink-400)]">{number}</span>}
      {empty ? (
        <span className="flex-1 text-[13px] italic text-[var(--ink-400)]">{interaction?.selectedId ? "Bye · tap to put them here" : "Bye"}</span>
      ) : (
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[14.5px] font-semibold ${away ? "text-red-700 line-through" : "text-[var(--ink-900)]"}`}>
            {athlete?.name ?? "Unknown athlete"}
            {athlete?.walkIn && <span className="ml-1.5 rounded bg-amber-100 px-1 py-px align-middle text-[10px] font-bold uppercase text-amber-800 no-underline">walk-in</span>}
            {athlete?.guestFrom && (
              <span title={`Guest from ${athlete.guestFrom}`} className="ml-1.5 rounded bg-sky-100 px-1 py-px align-middle text-[10px] font-bold uppercase text-sky-800 no-underline">
                guest
              </span>
            )}
          </span>
          <span className="block truncate text-[11.5px] text-[var(--ink-500)]">
            {[athlete?.club, athlete?.chestNumber ? `#${athlete.chestNumber}` : null, away ? athlete?.attendance : null, athlete?.guestFrom ? `from ${athlete.guestFrom}` : null]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
      )}
      {pinned && (
        <span className="material-symbols-outlined shrink-0 text-[18px] text-[var(--accent-dark)]" style={{ fontVariationSettings: "'FILL' 1" }} title="Placed by hand">
          push_pin
        </span>
      )}
    </>
  );

  const cls = `flex min-h-[48px] w-full items-center gap-2 rounded-lg border border-l-4 px-2.5 py-1.5 text-left ${edge} ${tone}`;
  if (!interaction) return <div className={cls}>{body}</div>;
  return (
    <button
      type="button"
      className={`${cls} touch-manipulation hover:border-[var(--ink-400)]`}
      aria-pressed={selected}
      draggable={!empty}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        interaction.onDragStart(target);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        interaction.onTap(target);
      }}
      onClick={() => interaction.onTap(target)}
    >
      {body}
    </button>
  );
}
