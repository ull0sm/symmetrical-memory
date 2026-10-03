/**
 * Walk-ins a stager registered at the venue, waiting for the admin: confirming
 * (and correcting) their details, or merging one into the athlete it turns out
 * to be, as long as neither has fought a bout yet.
 * No authorization here: the roster actions check the caller is the tournament's admin.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  athletes,
  categories,
  categoryEntries,
  divisions,
  draws,
  drawVersions,
  groupDrafts,
  kataScores,
  matches,
  matchSlots,
  tournamentRegistrations,
} from "@/db/schema";
import { checksumOf } from "@/engine/draw-engine/canonical";
import type { DrawGraph } from "@/engine/draw-engine/types";
import type { DbExecutor } from "@/lib/draws/generateDraws";
import { LocalSetupError, readLocalSettings } from "./divisions";
import { renameInGraph } from "./lateChangePlan";
import { canonicalBelt, normalizeAge, normalizeSex } from "./rules";

export interface WalkInToReview {
  id: string;
  name: string;
  chestNumber: string | null;
  club: string | null;
  age: string | null;
  belt: string | null;
  sex: string | null;
  divisionName: string | null;
  groups: string[];
  /** Athletes of the tournament who may be the same person, likeliest first. */
  maybe: { id: string; name: string; chestNumber: string | null; club: string | null; divisionName: string | null }[];
}

const words = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);

/** How alike two athletes look, 0 for not at all: the same name, or a shared first name with a shared club or surname. */
function likeness(a: { name: string; club: string | null }, b: { name: string; club: string | null }): number {
  const wa = words(a.name);
  const wb = words(b.name);
  if (wa.length === 0 || wb.length === 0) return 0;
  if (wa.join(" ") === wb.join(" ")) return 3;
  const sameClub = Boolean(a.club && b.club && a.club.trim().toLowerCase() === b.club.trim().toLowerCase());
  const sharedOther = wa.slice(1).some((w) => wb.slice(1).includes(w));
  if (wa[0] === wb[0] && (sameClub || sharedOther)) return sameClub && sharedOther ? 2.5 : 2;
  if (wa[0] === wb[0] || (sharedOther && sameClub)) return 1;
  return 0;
}

/** Walk-ins the admin hasn't reviewed, with the athletes each may duplicate. */
export async function listWalkInsToReview(tournamentId: string): Promise<WalkInToReview[]> {
  const everyone = await db
    .select({
      id: athletes.id,
      name: athletes.name,
      chestNumber: athletes.chestNumber,
      club: athletes.school,
      dojo: athletes.dojo,
      age: athletes.age,
      belt: athletes.belt,
      sex: athletes.sex,
      needsReview: athletes.needsReview,
      divisionName: divisions.name,
    })
    .from(athletes)
    .leftJoin(tournamentRegistrations, eq(tournamentRegistrations.athleteId, athletes.id))
    .leftJoin(divisions, eq(divisions.id, tournamentRegistrations.divisionId))
    .where(eq(athletes.tournamentId, tournamentId));
  const pending = everyone.filter((a) => a.needsReview);
  if (pending.length === 0) return [];

  const entries = await db
    .select({ athleteId: categoryEntries.athleteId, name: categories.name })
    .from(categoryEntries)
    .innerJoin(categories, eq(categories.id, categoryEntries.categoryId))
    .where(inArray(categoryEntries.athleteId, pending.map((p) => p.id)));

  return pending
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((w) => {
      const club = w.club ?? w.dojo;
      const scored = everyone
        .filter((o) => o.id !== w.id)
        .map((o) => ({ o, score: likeness({ name: w.name, club }, { name: o.name, club: o.club ?? o.dojo }) }))
        .filter((x) => x.score > 0);
      // A shared first name alone is a weak hint: shown only when nothing better turns up.
      const best = Math.max(0, ...scored.map((x) => x.score));
      const maybe = scored
        .filter((x) => best < 2 || x.score >= 2)
        .sort((x, y) => y.score - x.score || x.o.name.localeCompare(y.o.name))
        .slice(0, 5)
        .map(({ o }) => ({ id: o.id, name: o.name, chestNumber: o.chestNumber, club: o.club ?? o.dojo, divisionName: o.divisionName }));
      return {
        id: w.id,
        name: w.name,
        chestNumber: w.chestNumber,
        club,
        age: w.age,
        belt: w.belt,
        sex: w.sex,
        divisionName: w.divisionName,
        groups: entries.filter((e) => e.athleteId === w.id).map((e) => e.name),
        maybe,
      };
    });
}

export interface WalkInDetails {
  name?: string;
  club?: string | null;
  age?: number | string | null;
  belt?: string | null;
  sex?: string | null;
}

async function walkInOf(executor: DbExecutor, tournamentId: string, athleteId: string) {
  const [row] = await executor.select().from(athletes).where(and(eq(athletes.id, athleteId), eq(athletes.tournamentId, tournamentId)));
  if (!row) throw new LocalSetupError("Athlete not found in this tournament.");
  if (!row.walkIn) throw new LocalSetupError(`${row.name} wasn't registered as a walk-in.`);
  return row;
}

/** Confirms a walk-in's details, correcting any the admin changed. Their category stays as it is. */
export async function reviewWalkInCore(tournamentId: string, athleteId: string, details: WalkInDetails) {
  const walkIn = await walkInOf(db, tournamentId, athleteId);
  const { beltLevels } = await readLocalSettings(tournamentId);
  const patch: Partial<typeof athletes.$inferInsert> = { needsReview: false };
  if (details.name !== undefined) {
    const name = details.name.trim().slice(0, 200);
    if (!name) throw new LocalSetupError("The athlete needs a name.");
    patch.name = name;
  }
  if (details.club !== undefined) {
    const club = (details.club ?? "").trim().slice(0, 200) || null;
    patch.school = club;
    patch.dojo = club;
  }
  if (details.age !== undefined) {
    const age = normalizeAge(details.age);
    patch.age = age === null ? null : String(age);
  }
  if (details.belt !== undefined) patch.belt = canonicalBelt(details.belt, beltLevels) ?? ((details.belt ?? "").trim().slice(0, 50) || null);
  if (details.sex !== undefined) patch.sex = normalizeSex(details.sex);

  const before = { name: walkIn.name, club: walkIn.school ?? walkIn.dojo, age: walkIn.age, belt: walkIn.belt, sex: walkIn.sex };
  const [after] = await db.update(athletes).set(patch).where(eq(athletes.id, athleteId)).returning();
  return { before, after: { name: after.name, club: after.school ?? after.dojo, age: after.age, belt: after.belt, sex: after.sex }, wasPending: walkIn.needsReview };
}

const FOUGHT = ["LIVE", "CONFIRMED", "COMPLETED"];

/** A bout either athlete has fought or is fighting, if any. */
async function foughtBout(tx: DbExecutor, athleteIds: string[]) {
  const [slot] = await tx
    .select({ athleteId: matchSlots.athleteId, matchNo: matches.matchNo, group: categories.name })
    .from(matchSlots)
    .innerJoin(matches, eq(matches.id, matchSlots.matchId))
    .innerJoin(categories, eq(categories.id, matches.categoryId))
    .where(and(inArray(matchSlots.athleteId, athleteIds), inArray(matches.status, FOUGHT)))
    .limit(1);
  if (slot) return slot;
  const [score] = await tx
    .select({ athleteId: kataScores.athleteId, matchNo: matches.matchNo, group: categories.name })
    .from(kataScores)
    .innerJoin(matches, eq(matches.id, kataScores.matchId))
    .innerJoin(categories, eq(categories.id, matches.categoryId))
    .where(inArray(kataScores.athleteId, athleteIds))
    .limit(1);
  return score ?? null;
}

/**
 * Merges a walk-in into the athlete it really is. The athlete keeps their own record (name,
 * chest number); where they compete comes from whichever of the two is already in a group, or,
 * when neither is, from the walk-in, the desk's latest word. Then the walk-in is deleted.
 * Refused once either has fought a bout, and when both are in groups.
 */
export async function mergeWalkInCore(tournamentId: string, walkInId: string, intoId: string) {
  if (walkInId === intoId) throw new LocalSetupError("Choose another athlete to merge into.");
  return db.transaction(async (tx) => {
    const walkIn = await walkInOf(tx, tournamentId, walkInId);
    const [into] = await tx.select().from(athletes).where(and(eq(athletes.id, intoId), eq(athletes.tournamentId, tournamentId)));
    if (!into) throw new LocalSetupError("Athlete not found in this tournament.");

    const fought = await foughtBout(tx, [walkInId, intoId]);
    if (fought) {
      const who = fought.athleteId === walkInId ? walkIn.name : into.name;
      throw new LocalSetupError(`${who} has already competed (bout ${fought.matchNo} of ${fought.group}), so the two can't be merged any more.`);
    }

    const entriesOf = (id: string) =>
      tx
        .select({ categoryId: categoryEntries.categoryId, name: categories.name, drawState: draws.state })
        .from(categoryEntries)
        .innerJoin(categories, eq(categories.id, categoryEntries.categoryId))
        .leftJoin(draws, eq(draws.categoryId, categories.id))
        .where(eq(categoryEntries.athleteId, id));
    const [walkInGroups, intoGroups] = await Promise.all([entriesOf(walkInId), entriesOf(intoId)]);
    if (walkInGroups.length > 0 && intoGroups.length > 0) {
      throw new LocalSetupError(
        `Both are in groups (${walkInGroups[0].name}, ${intoGroups[0].name}). Take one of them out first.`
      );
    }

    const [regW] = await tx.select().from(tournamentRegistrations).where(eq(tournamentRegistrations.athleteId, walkInId));
    const [regI] = await tx.select().from(tournamentRegistrations).where(eq(tournamentRegistrations.athleteId, intoId));
    const divisionBefore = regI?.divisionId ?? null;
    const takesWalkInsPlace = intoGroups.length === 0;

    let registrationId = regI?.id ?? null;
    if (takesWalkInsPlace && regW) {
      const place = { divisionId: regW.divisionId, kumite: regW.kumite, kata: regW.kata, attendance: regW.attendance, attendanceSetBy: regW.attendanceSetBy, attendanceSetAt: regW.attendanceSetAt };
      if (regI) await tx.update(tournamentRegistrations).set(place).where(eq(tournamentRegistrations.id, regI.id));
      else registrationId = (await tx.insert(tournamentRegistrations).values({ tournamentId, athleteId: intoId, ...place }).returning({ id: tournamentRegistrations.id }))[0].id;

      for (const g of walkInGroups) {
        await tx.update(categoryEntries).set({ athleteId: intoId, registrationId }).where(and(eq(categoryEntries.categoryId, g.categoryId), eq(categoryEntries.athleteId, walkInId)));
        await renameInGroup(tx, g.categoryId, walkInId, intoId, g.drawState === "LOCKED");
      }
    }
    const [divisionAfter] = await tx.select({ id: tournamentRegistrations.divisionId }).from(tournamentRegistrations).where(eq(tournamentRegistrations.athleteId, intoId));

    await tx.delete(athletes).where(eq(athletes.id, walkInId));
    return {
      walkIn: { id: walkInId, name: walkIn.name, chestNumber: walkIn.chestNumber },
      into: { id: intoId, name: into.name, chestNumber: into.chestNumber },
      divisionBefore,
      divisionAfter: divisionAfter?.id ?? null,
      groups: (takesWalkInsPlace ? walkInGroups : intoGroups).map((g) => g.name),
    };
  });
}

/** Puts the real athlete in the walk-in's place in a group: its draft pins and, once locked, its bouts and stored draw. */
async function renameInGroup(tx: DbExecutor, groupId: string, from: string, to: string, locked: boolean) {
  const [draft] = await tx.select().from(groupDrafts).where(eq(groupDrafts.categoryId, groupId));
  if (draft) {
    const pins = Object.fromEntries(Object.entries(draft.pins).map(([id, place]) => [id === from ? to : id, place]));
    await tx.update(groupDrafts).set({ pins, version: draft.version + 1, updatedAt: new Date() }).where(eq(groupDrafts.categoryId, groupId));
  }
  if (!locked) return;

  const ids = (await tx.select({ id: matches.id }).from(matches).where(eq(matches.categoryId, groupId))).map((m) => m.id);
  if (ids.length > 0) {
    await tx.update(matchSlots).set({ athleteId: to }).where(and(inArray(matchSlots.matchId, ids), eq(matchSlots.athleteId, from)));
    await tx.update(matches).set({ winnerId: to }).where(and(eq(matches.categoryId, groupId), eq(matches.winnerId, from)));
  }
  const [draw] = await tx.select().from(draws).where(eq(draws.categoryId, groupId));
  if (!draw) return;
  const [latest] = await tx.select().from(drawVersions).where(eq(drawVersions.drawId, draw.id)).orderBy(sql`${drawVersions.version} desc`).limit(1);
  if (!latest) return;
  const body = renameInGraph(latest.graph as unknown as DrawGraph, from, to);
  const graph = { ...body, checksum: checksumOf(body) };
  const version = Math.max(draw.version, latest.version) + 1;
  await tx.insert(drawVersions).values({ drawId: draw.id, version, graph, checksum: graph.checksum, reason: "Walk-in merged into the registered athlete" });
  await tx.update(draws).set({ version, checksum: graph.checksum }).where(eq(draws.id, draw.id));
}
