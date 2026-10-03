/**
 * The admin's hand on a Local group after it was locked. Before the group's first
 * bout the admin can unlock it (back to a draft) or add, remove and move athletes:
 * the draw is rebuilt with everyone else pinned where they were, so nobody else's
 * bout changes unless the bracket has to grow or shrink. Once bouts have been
 * fought, only what leaves every result standing is allowed: a late kumite athlete
 * takes a first-round bye whose holder hasn't fought on yet, a late kata athlete
 * performs at the end. A finished group never changes. Every change is a new draw
 * version; the actions audit it with the admin's reason.
 * No authorization here: the staging actions check the caller is the tournament's admin.
 */
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  athletes,
  categories,
  categoryAssignments,
  categoryEntries,
  divisionEvents,
  divisions,
  draws,
  drawVersions,
  groupDrafts,
  matches,
  matchSlots,
  rings,
  tournamentRegistrations,
} from "@/db/schema";
import { resolveDraw } from "@/engine/draw-engine";
import { DrawInputError, GroupChangeError } from "@/engine/draw-engine/errors";
import { fillByeWithEntrant } from "@/engine/draw-engine/fillBye";
import { placesOf } from "@/engine/draw-engine/groupDraw";
import { appendRankedPerformer, performanceOrder } from "@/engine/draw-engine/rankedKataDraw";
import type { DrawGraph } from "@/engine/draw-engine/types";
import { foughtBoutCount } from "@/lib/draws/boutCount";
import { deleteCategoryBouts, writeDrawGraph, type DbExecutor } from "@/lib/draws/generateDraws";
import { LocalSetupError } from "./divisions";
import { buildGroupGraph, loadGroupState, type GroupMember, type GroupState } from "./groupBuild";
import { describeChange, kumitePinCandidates, openByes, orderPins } from "./lateChangePlan";
import { refreshGroupCounts } from "./startingGroups";

export type LateChange =
  | { kind: "add"; athleteId: string; place?: number }
  | { kind: "remove"; athleteId: string }
  | { kind: "move"; athleteId: string; toGroupId: string; place?: number };

/** Where a locked group stands: ready (no bout live or fought yet), under way, or finished. */
export type LockedStage = "ready" | "started" | "completed";

interface LockedGroup {
  state: GroupState;
  graph: DrawGraph;
  draw: typeof draws.$inferSelect;
  /** The highest stored version: a new one is always above it. */
  latestVersion: number;
  /** Bouts live or decided. */
  started: Set<string>;
  stage: LockedStage;
  card: { ringId: string; ringName: string | null; status: string } | null;
  divisionId: string;
  tournamentId: string;
}

const STARTED = ["LIVE", "CONFIRMED", "COMPLETED"];

async function loadLockedGroup(tx: DbExecutor, groupId: string, lockRow: boolean): Promise<LockedGroup> {
  if (lockRow) await tx.select({ id: categories.id }).from(categories).where(eq(categories.id, groupId)).for("update");
  const state = await loadGroupState(tx, groupId);
  if (!state) throw new LocalSetupError("Group not found.");
  if (!state.locked) throw new LocalSetupError(`${state.name} hasn't been locked: whoever holds its category changes it.`);

  const [draw] = await tx.select().from(draws).where(eq(draws.categoryId, groupId));
  const [latest] = draw
    ? await tx.select().from(drawVersions).where(eq(drawVersions.drawId, draw.id)).orderBy(sql`${drawVersions.version} desc`).limit(1)
    : [];
  if (!draw || !latest) throw new LocalSetupError(`${state.name} has no stored draw.`);

  const bouts = await tx.select({ id: matches.id, status: matches.status }).from(matches).where(eq(matches.categoryId, groupId));
  const started = new Set(bouts.filter((b) => STARTED.includes(b.status)).map((b) => b.id));
  const [card] = await tx
    .select({ ringId: categoryAssignments.ringId, status: categoryAssignments.status, ringName: rings.name })
    .from(categoryAssignments)
    .innerJoin(rings, eq(rings.id, categoryAssignments.ringId))
    .where(eq(categoryAssignments.categoryId, groupId))
    .limit(1);
  const [event] = await tx
    .select({ divisionId: divisionEvents.divisionId, tournamentId: divisions.tournamentId })
    .from(divisionEvents)
    .innerJoin(divisions, eq(divisions.id, divisionEvents.divisionId))
    .where(eq(divisionEvents.id, state.divisionEventId));
  if (!event) throw new LocalSetupError("Group not found.");

  const stage: LockedStage = card?.status === "completed" ? "completed" : started.size > 0 ? "started" : "ready";
  return {
    state,
    graph: latest.graph as unknown as DrawGraph,
    draw,
    latestVersion: Math.max(draw.version, latest.version),
    started,
    stage,
    card: card ?? null,
    divisionId: event.divisionId,
    tournamentId: event.tournamentId,
  };
}

// ── Unlock ─────────────────────────────────────────────────────────────────

/**
 * Sends a locked group back to Draft: its bouts are deleted (none has been fought), the draw is
 * hidden, and its draft is as it was, so whoever takes the category next sees the same layout.
 */
export async function unlockGroupCore(groupId: string) {
  return db.transaction(async (tx) => {
    const g = await loadLockedGroup(tx, groupId, true);
    const name = g.state.name;
    if (g.stage === "completed") throw new LocalSetupError(`${name} has finished, so it can't be unlocked.`);
    if (g.stage === "started") throw new LocalSetupError(`${name} has bouts fought or on the mat, so it can't be unlocked. A late change can still add an athlete.`);
    if (g.card && (g.card.status === "running" || g.card.status === "paused")) {
      throw new LocalSetupError(`${name} is on the mat${g.card.ringName ? ` on ${g.card.ringName}` : ""}. The moderator can return it to the queue first.`);
    }
    const guest = g.state.members.find((m) => m.guest);
    if (guest) throw new LocalSetupError(`${guest.name} is a guest in ${name}. Take them out first (a late change), then unlock it.`);

    const removed = await deleteCategoryBouts(tx, groupId);
    if (g.card) await clearCurrentBout(tx, g.card.ringId, removed);
    await tx.update(draws).set({ state: "DRAFT", lockedAt: null }).where(eq(draws.id, g.draw.id));
    await refreshGroupCounts(tx, groupId);
    return {
      group: { id: groupId, name, divisionId: g.divisionId, tournamentId: g.tournamentId, ringId: g.card?.ringId ?? null },
      before: { checksum: g.draw.checksum, version: g.draw.version, members: g.state.members.map((m) => m.athleteId) },
    };
  });
}

async function clearCurrentBout(tx: DbExecutor, ringId: string, matchIds: readonly string[]) {
  if (matchIds.length === 0) return;
  await tx.update(rings).set({ currentMatchId: null }).where(and(eq(rings.id, ringId), inArray(rings.currentMatchId, [...matchIds])));
}

// ── Planning a change ──────────────────────────────────────────────────────

interface Newcomer {
  athleteId: string;
  registrationId: string;
  name: string;
  guest: boolean;
  guestFrom: string | null;
  /** Marked absent or withdrawn until now: the admin adding them means they are here. */
  wasAway: string | null;
}

interface GroupPlan {
  group: LockedGroup;
  mode: "rebuild" | "fill-bye" | "append";
  graph: DrawGraph;
  added: Newcomer | null;
  removed: GroupMember | null;
  lines: string[];
}

const away = (attendance: string | null) => attendance === "absent" || attendance === "withdrawn";

/** The athlete a change adds, checked against the group: in the tournament, taking part in the event, in no group of it yet. */
async function newcomerFor(tx: DbExecutor, g: LockedGroup, athleteId: string, movingFrom: string | null): Promise<Newcomer> {
  const [row] = await tx
    .select({ registration: tournamentRegistrations, name: athletes.name, divisionName: divisions.name })
    .from(tournamentRegistrations)
    .innerJoin(athletes, eq(athletes.id, tournamentRegistrations.athleteId))
    .leftJoin(divisions, eq(divisions.id, tournamentRegistrations.divisionId))
    .where(and(eq(tournamentRegistrations.athleteId, athleteId), eq(tournamentRegistrations.tournamentId, g.tournamentId)));
  if (!row) throw new LocalSetupError("That athlete isn't in this tournament.");
  const { registration, name } = row;
  if (!registration.divisionId) throw new LocalSetupError(`${name} isn't in any category yet. Put them in one first.`);
  const event = g.state.eventType;
  if (!(event === "kata" ? registration.kata : registration.kumite)) {
    throw new LocalSetupError(`${name} doesn't take part in ${event}. Switch it on for them first.`);
  }
  if (g.state.members.some((m) => m.athleteId === athleteId)) throw new LocalSetupError(`${name} is already in ${g.state.name}.`);

  // One group per athlete and event type, across the whole tournament (home or guest).
  const elsewhere = await tx
    .select({ categoryId: categories.id, name: categories.name, drawState: draws.state, divisionEventId: categories.divisionEventId })
    .from(categoryEntries)
    .innerJoin(categories, eq(categories.id, categoryEntries.categoryId))
    .leftJoin(draws, eq(draws.categoryId, categories.id))
    .where(and(eq(categoryEntries.athleteId, athleteId), eq(categories.eventType, event), isNotNull(categories.divisionEventId)));
  const other = elsewhere.find((e) => e.categoryId !== movingFrom);
  if (other) {
    throw new LocalSetupError(
      other.drawState !== "LOCKED"
        ? `${name} is in ${other.name}, which is still being prepared. Take them out of it first.`
        : other.divisionEventId === g.state.divisionEventId
          ? `${name} is already in ${other.name}. Move them from there instead.`
          : `${name} already competes in ${event} in ${other.name}.`
    );
  }

  const guest = registration.divisionId !== g.divisionId;
  return {
    athleteId,
    registrationId: registration.id,
    name,
    guest,
    guestFrom: guest ? (row.divisionName ?? null) : null,
    wasAway: away(registration.attendance) ? registration.attendance : null,
  };
}

function nameLookup(g: LockedGroup, extra: Newcomer | null) {
  const names = new Map(g.state.members.map((m) => [m.athleteId, m.name]));
  if (extra) names.set(extra.athleteId, extra.name);
  return (id: string) => names.get(id) ?? "Athlete";
}

/** Rebuilds a not-yet-started group around a new member list, keeping everyone else where they were. */
function rebuild(g: LockedGroup, members: GroupMember[], newcomer?: { athleteId: string; place?: number }): DrawGraph {
  const state: GroupState = { ...g.state, members };
  if (g.state.eventType === "kata") {
    const order = performanceOrder(g.graph).filter((id) => members.some((m) => m.athleteId === id));
    if (newcomer) order.push(newcomer.athleteId);
    return buildGroupGraph(state, orderPins(order));
  }
  const ids = members.map((m) => m.athleteId);
  for (const pins of kumitePinCandidates(placesOf(g.graph), ids, g.graph.tournamentSize, newcomer)) {
    try {
      return buildGroupGraph(state, pins);
    } catch (err) {
      if (!(err instanceof DrawInputError)) throw err;
    }
  }
  throw new LocalSetupError(`${g.state.name} can't be drawn with these athletes.`);
}

function asMember(n: Newcomer): GroupMember {
  return { athleteId: n.athleteId, registrationId: n.registrationId, name: n.name, club: null, chestNumber: null, attendance: "present", walkIn: false, needsReview: false, guest: n.guest };
}

/** The plan for adding an athlete to a locked group, by the group's stage. */
async function planAdd(tx: DbExecutor, g: LockedGroup, athleteId: string, place: number | undefined, movingFrom: string | null): Promise<GroupPlan> {
  const name = g.state.name;
  if (g.stage === "completed") throw new LocalSetupError(`${name} has finished. Put the athlete in another group.`);
  const added = await newcomerFor(tx, g, athleteId, movingFrom);
  const lookup = nameLookup(g, added);

  if (g.stage === "ready") {
    if (place !== undefined && g.state.eventType === "kumite") {
      const taken = new Set(placesOf(g.graph).values());
      if (place < 1 || place > g.graph.tournamentSize || taken.has(place)) throw new LocalSetupError("Choose a bye for the new athlete.");
    }
    const loaded = await fullMember(tx, added);
    const graph = rebuild(g, [...g.state.members, loaded], { athleteId, place: g.state.eventType === "kumite" ? place : undefined });
    return { group: g, mode: "rebuild", graph, added, removed: null, lines: describeChange(g.state.eventType, g.graph, graph, lookup, { added: athleteId }) };
  }

  // Under way: nothing that has been fought may change.
  let graph: DrawGraph;
  let mode: GroupPlan["mode"];
  try {
    if (g.state.eventType === "kata") {
      graph = appendRankedPerformer(g.graph, athleteId, g.started);
      mode = "append";
    } else {
      const byes = openByes(g.graph, g.started);
      const bye = place === undefined ? byes[0] : byes.find((b) => b.place === place);
      if (!bye) {
        throw new LocalSetupError(
          byes.length === 0
            ? `No bye in ${name} can take a late athlete any more: everyone with a bye has fought on, or there is none. Use a group that hasn't started, or a new group.`
            : "That bye can't take a late athlete any more. Choose another."
        );
      }
      graph = fillByeWithEntrant(g.graph, bye.slotId, athleteId, g.started);
      mode = "fill-bye";
    }
  } catch (err) {
    if (err instanceof GroupChangeError) throw new LocalSetupError(err.message.charAt(0).toUpperCase() + err.message.slice(1) + ".");
    throw err;
  }
  return { group: g, mode, graph, added, removed: null, lines: describeChange(g.state.eventType, g.graph, graph, lookup, { added: athleteId }) };
}

/** The plan for taking an athlete out of a group that hasn't started. */
function planRemove(g: LockedGroup, athleteId: string): GroupPlan {
  const name = g.state.name;
  const member = g.state.members.find((m) => m.athleteId === athleteId);
  if (!member) throw new LocalSetupError(`That athlete isn't in ${name}.`);
  if (g.stage === "completed") throw new LocalSetupError(`${name} has finished, so nobody can leave it.`);
  if (g.stage === "started") {
    throw new LocalSetupError(
      g.state.eventType === "kata"
        ? `${name} has started. An athlete who can't perform is confirmed as "didn't perform" on the tatami.`
        : `${name} has started. An athlete who can't fight on gets kiken in their bout on the tatami.`
    );
  }
  if (g.state.members.length === 1) throw new LocalSetupError(`${member.name} is the only athlete in ${name}. Unlock the group to remove it instead.`);
  const graph = rebuild(g, g.state.members.filter((m) => m.athleteId !== athleteId));
  return { group: g, mode: "rebuild", graph, added: null, removed: member, lines: describeChange(g.state.eventType, g.graph, graph, nameLookup(g, null), { removed: athleteId }) };
}

/** A newcomer with the details the draw uses (club for separation). */
async function fullMember(tx: DbExecutor, n: Newcomer): Promise<GroupMember> {
  const [a] = await tx.select({ school: athletes.school, dojo: athletes.dojo, chestNumber: athletes.chestNumber }).from(athletes).where(eq(athletes.id, n.athleteId));
  return { ...asMember(n), club: a?.school ?? a?.dojo ?? null, chestNumber: a?.chestNumber ?? null };
}

export interface LateChangePreview {
  /** One per group the change touches: the group changed, and for a move the group left. */
  groups: { id: string; name: string; mode: GroupPlan["mode"]; graph: DrawGraph; lines: string[] }[];
  newcomer: { name: string; guest: boolean; guestFrom: string | null; wasAway: string | null } | null;
  /** What the admin confirms: the resulting draws. A change in between makes the confirm stale. */
  fingerprint: string;
}

async function planChange(tx: DbExecutor, groupId: string, change: LateChange, lockRows: boolean): Promise<GroupPlan[]> {
  const g = await loadLockedGroup(tx, groupId, lockRows);
  if (change.kind === "add") return [await planAdd(tx, g, change.athleteId, change.place, null)];
  if (change.kind === "remove") return [planRemove(g, change.athleteId)];

  if (change.toGroupId === groupId) throw new LocalSetupError("Choose another group to move them to.");
  const target = await loadLockedGroup(tx, change.toGroupId, lockRows);
  if (target.state.divisionEventId !== g.state.divisionEventId) throw new LocalSetupError("An athlete can only move to another group of the same event.");
  const out = planRemove(g, change.athleteId);
  const into = await planAdd(tx, target, change.athleteId, change.place, groupId);
  return [into, out];
}

const fingerprintOf = (plans: GroupPlan[]) => plans.map((p) => p.graph.checksum).join(":");

function previewOf(plans: GroupPlan[]): LateChangePreview {
  const added = plans.find((p) => p.added)?.added ?? null;
  return {
    groups: plans.map((p) => ({ id: p.group.state.id, name: p.group.state.name, mode: p.mode, graph: p.graph, lines: p.lines })),
    newcomer: added ? { name: added.name, guest: added.guest, guestFrom: added.guestFrom, wasAway: added.wasAway } : null,
    fingerprint: fingerprintOf(plans),
  };
}

/** What a change would do, for the admin to see before confirming. Changes nothing. */
export async function previewLateChangeCore(groupId: string, change: LateChange): Promise<LateChangePreview> {
  return previewOf(await planChange(db, groupId, change, false));
}

// ── Applying a change ──────────────────────────────────────────────────────

/** Writes the change. Refused when the draws differ from the preview the admin confirmed (`expectedFingerprint`). */
export async function changeLockedGroupCore(groupId: string, change: LateChange, by: string, reason: string, expectedFingerprint?: string) {
  return db.transaction(async (tx) => {
    // Lock both rows of a move in a fixed order, so two moves the other way never deadlock.
    if (change.kind === "move") {
      for (const id of [groupId, change.toGroupId].sort()) await tx.select({ id: categories.id }).from(categories).where(eq(categories.id, id)).for("update");
    }
    const plans = await planChange(tx, groupId, change, change.kind !== "move");
    if (expectedFingerprint && expectedFingerprint !== fingerprintOf(plans)) {
      throw new LocalSetupError("The group changed since you looked at it. Check the change again.");
    }

    // A move takes the athlete out of the old group before they join the new one.
    const versions = new Map<string, number>();
    for (const plan of [...plans].reverse()) versions.set(plan.group.state.id, await writePlan(tx, plan, by, reason));
    return {
      tournamentId: plans[0].group.tournamentId,
      groups: plans.map((p) => ({
        id: p.group.state.id,
        name: p.group.state.name,
        ringId: p.group.card?.ringId ?? null,
        mode: p.mode,
        stage: p.group.stage,
        added: p.added ? { athleteId: p.added.athleteId, name: p.added.name, guest: p.added.guest, wasAway: p.added.wasAway } : null,
        removed: p.removed ? { athleteId: p.removed.athleteId, name: p.removed.name } : null,
        membersBefore: p.group.state.members.map((m) => m.athleteId),
        drawVersionBefore: p.group.draw.version,
        checksumBefore: p.group.draw.checksum,
        checksumAfter: p.graph.checksum,
        drawVersionAfter: versions.get(p.group.state.id) ?? null,
        lines: p.lines,
      })),
    };
  });
}

async function writePlan(tx: DbExecutor, plan: GroupPlan, by: string, reason: string) {
  const g = plan.group;
  const groupId = g.state.id;
  const why = `Changed after lock by ${by}: ${reason}`;

  if (plan.removed) {
    await tx.delete(categoryEntries).where(and(eq(categoryEntries.categoryId, groupId), eq(categoryEntries.athleteId, plan.removed.athleteId)));
  }
  if (plan.added) {
    // A move's athlete left their old group a moment ago; anyone else is in no group of this event.
    await tx.insert(categoryEntries).values({
      categoryId: groupId,
      athleteId: plan.added.athleteId,
      registrationId: plan.added.registrationId,
      divisionEventId: g.state.divisionEventId,
      guest: plan.added.guest,
    });
    if (plan.added.wasAway) {
      await tx
        .update(tournamentRegistrations)
        .set({ attendance: "present", attendanceSetBy: by, attendanceSetAt: new Date() })
        .where(eq(tournamentRegistrations.id, plan.added.registrationId));
    }
  }

  let version: number;
  if (plan.mode === "rebuild") {
    // Nothing has been fought: the bouts are written again. Bout ids follow their numbers, so a
    // bout picked on the tatami may now hold other athletes; the moderator picks again.
    const old = await tx.select({ id: matches.id }).from(matches).where(eq(matches.categoryId, groupId));
    if (g.card) await clearCurrentBout(tx, g.card.ringId, old.map((m) => m.id));
    ({ version } = await writeDrawGraph(tx, groupId, plan.graph, { format: g.draw.format, state: "LOCKED", bronzeMedals: g.draw.bronzeMedals, reason: why }));
  } else {
    version = await writeIncrementally(tx, g, plan.graph, why);
  }

  // The draft follows the draw, so an unlock later shows exactly this layout.
  const pins =
    g.state.eventType === "kata"
      ? orderPins(performanceOrder(plan.graph))
      : Object.fromEntries(placesOf(plan.graph));
  await tx.update(groupDrafts).set({ pins, version: sql`${groupDrafts.version} + 1`, updatedBy: by, updatedAt: new Date() }).where(eq(groupDrafts.categoryId, groupId));
  const [members] = await tx.select({ n: sql<number>`count(*)` }).from(categoryEntries).where(eq(categoryEntries.categoryId, groupId));
  await tx.update(categories).set({ athletesCount: Number(members?.n ?? 0), expectedMatches: foughtBoutCount(plan.graph) }).where(eq(categories.id, groupId));
  return version;
}

/**
 * Writes a change to a group that is under way without touching a fought bout: new bouts and
 * places are added, a filled bye becomes a real bout, and the bouts that depend on it are
 * resolved again (the bye-holder's walkover is undone). Then the next draw version.
 */
async function writeIncrementally(tx: DbExecutor, g: LockedGroup, next: DrawGraph, why: string): Promise<number> {
  const groupId = g.state.id;
  const dbMatches = await tx.select().from(matches).where(eq(matches.categoryId, groupId));
  const known = new Set(dbMatches.map((m) => m.id));
  const fresh = next.matches.filter((m) => !known.has(m.id));
  if (fresh.length > 0) {
    await tx.insert(matches).values(
      fresh.map((m) => ({
        id: m.id,
        categoryId: groupId,
        matchNo: m.matchNo,
        roundNo: m.roundNo,
        roundName: m.roundName,
        bracketType: m.bracketType,
        status: "SCHEDULED",
        poolGroup: m.poolGroup ?? null,
        kataScoringMode: m.kataScoringMode ?? null,
      }))
    );
  }

  const before = new Map(g.graph.slots.map((s) => [s.id, s]));
  const filled = new Set<string>();
  for (const slot of next.slots) {
    const was = before.get(slot.id);
    if (!was) {
      await tx.insert(matchSlots).values({ id: slot.id, matchId: slot.matchId, position: slot.position, slotType: slot.slotType, athleteId: slot.registrationId ?? null, sourceMatchId: slot.sourceMatchId ?? null });
    } else if (was.slotType !== slot.slotType || was.registrationId !== slot.registrationId) {
      await tx.update(matchSlots).set({ slotType: slot.slotType, athleteId: slot.registrationId ?? null }).where(eq(matchSlots.id, slot.id));
      filled.add(slot.matchId);
    }
  }
  // A first-round bout that had a bye now has two athletes.
  for (const matchId of filled) {
    await tx.update(matches).set({ status: "READY", winnerId: null, winnerSide: null }).where(eq(matches.id, matchId));
  }
  if (next.format !== "KATA_RANKED") await resyncBracket(tx, g, next, filled);

  const version = g.latestVersion + 1;
  await tx.insert(drawVersions).values({ drawId: g.draw.id, version, graph: next, checksum: next.checksum, reason: why });
  await tx
    .update(draws)
    .set({ version, checksum: next.checksum, byeCount: next.byeCount, tournamentSize: next.tournamentSize })
    .where(eq(draws.id, g.draw.id));
  return version;
}

/**
 * Brings the bouts after a filled bye in line with the new draw, the way a confirmed result does:
 * each bout that hasn't been fought gets the athletes the draw now resolves to.
 */
async function resyncBracket(tx: DbExecutor, g: LockedGroup, graph: DrawGraph, filled: ReadonlySet<string>) {
  const groupId = g.state.id;
  const rows = await tx.select().from(matches).where(eq(matches.categoryId, groupId));
  const slots = rows.length ? await tx.select().from(matchSlots).where(inArray(matchSlots.matchId, rows.map((m) => m.id))) : [];
  const outcomes = new Map<string, { kind: "WINNER"; side: "AKA" | "AO" }>();
  for (const m of rows) {
    if (m.status !== "CONFIRMED" || !m.winnerId) continue;
    const aka = slots.find((s) => s.matchId === m.id && s.position === 1);
    outcomes.set(m.id, { kind: "WINNER", side: (m.winnerSide as "AKA" | "AO") ?? (m.winnerId === aka?.athleteId ? "AKA" : "AO") });
  }
  const resolved = resolveDraw(graph, outcomes);
  const changed: string[] = [];
  for (const rm of resolved.matches) {
    const row = rows.find((m) => m.id === rm.matchId);
    if (!row || filled.has(rm.matchId) || STARTED.includes(row.status)) continue;
    const aka = rm.slots[0]?.registrationId ?? null;
    const ao = rm.slots[1]?.registrationId ?? null;
    const dbAka = slots.find((s) => s.matchId === rm.matchId && s.position === 1)?.athleteId ?? null;
    const dbAo = slots.find((s) => s.matchId === rm.matchId && s.position === 2)?.athleteId ?? null;
    if (aka === dbAka && ao === dbAo) continue;
    if (aka !== dbAka) await tx.update(matchSlots).set({ athleteId: aka }).where(and(eq(matchSlots.matchId, rm.matchId), eq(matchSlots.position, 1)));
    if (ao !== dbAo) await tx.update(matchSlots).set({ athleteId: ao }).where(and(eq(matchSlots.matchId, rm.matchId), eq(matchSlots.position, 2)));
    const status = aka && ao ? "READY" : rm.status === "WALKOVER" ? "WALKOVER" : "PENDING";
    await tx
      .update(matches)
      .set({ status, winnerId: status === "WALKOVER" ? (aka ?? ao) : null, winnerSide: null, akaScore: 0, aoScore: 0 })
      .where(eq(matches.id, rm.matchId));
    changed.push(rm.matchId);
  }
  if (g.card) await clearCurrentBout(tx, g.card.ringId, changed);
}

// ── Reading for the screens ────────────────────────────────────────────────

/** The latest stored draw of a group, or null before its first lock. */
export async function storedGraphOf(executor: DbExecutor, groupId: string): Promise<DrawGraph | null> {
  const [row] = await executor
    .select({ graph: drawVersions.graph })
    .from(drawVersions)
    .innerJoin(draws, eq(draws.id, drawVersions.drawId))
    .where(eq(draws.categoryId, groupId))
    .orderBy(sql`${drawVersions.version} desc`)
    .limit(1);
  return row ? (row.graph as unknown as DrawGraph) : null;
}

/** Bouts live or decided, per group: what makes a locked group "under way". */
export async function startedBouts(executor: DbExecutor, groupIds: readonly string[]) {
  const out = new Map<string, Set<string>>(groupIds.map((id) => [id, new Set<string>()]));
  if (groupIds.length === 0) return out;
  const rows = await executor
    .select({ id: matches.id, categoryId: matches.categoryId })
    .from(matches)
    .where(and(inArray(matches.categoryId, [...groupIds]), inArray(matches.status, STARTED)));
  for (const r of rows) out.get(r.categoryId)?.add(r.id);
  return out;
}
