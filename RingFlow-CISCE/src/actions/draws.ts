"use server";

import { audit } from "@/lib/audit";
import { db } from "@/db";
import { assembleCategoryDraw, type BracketMatchView } from "@/lib/draws/assembleDraw";
import {
  athletes,
  categories,
  categoryAssignments,
  categoryEntries,
  draws,
  drawVersions,
  matches,
  matchSlots,
  matchEvents,
  kataScores,
} from "@/db/schema";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { tournaments } from "@/db/schema";
import { requireTournamentAdmin } from "@/lib/auth/guards";
import {
  loadCategoryRoster,
  performCategoryDraw,
  performGenerateAllTournamentDraws,
  performGetTournamentDrawPreflight,
} from "@/lib/draws/generateDraws";
import { asDrawProfile, resolveDrawRules } from "@/lib/draws/drawRules";
import { performDrawSwap } from "@/lib/draws/manualSwap";
import { resolveViewerPart } from "@/lib/draws/partAccess";
import { loadCategoryPools } from "@/lib/draws/poolRosters";
import type { DrawGraph } from "@/engine/draw-engine/types";
import { computeDrawParts } from "@/engine/draw-engine/parts";
import { describePart } from "@/lib/draws/partFilter";
import { getTournamentStaff } from "@/lib/auth/guards";
import { tournamentIdForCategory } from "@/lib/auth/scope";
import { isValidUuid } from "@/lib/utils";
import { broadcastLiveEvent } from "@/lib/realtime/bus";

/**
 * Staff of this category's event may always open a full bracket. The public
 * may only open one when the admin enabled public draws — or when they reached
 * it through their own athlete's search result, which is scoped to a single
 * name they already know.
 */
async function isStaffViewer(categoryId: string): Promise<boolean> {
  try {
    return Boolean(await getTournamentStaff(await tournamentIdForCategory(categoryId)));
  } catch {
    return false;
  }
}

async function publicDrawsEnabledForCategory(categoryId: string): Promise<boolean> {
  const [row] = await db
    .select({ showPublicDraws: tournaments.showPublicDraws })
    .from(categories)
    .innerJoin(tournaments, eq(tournaments.id, categories.tournamentId))
    .where(eq(categories.id, categoryId));

  return row?.showPublicDraws !== false;
}



/**
 * Regenerates one category's bracket. Admin only: this deletes and rebuilds
 * the category's matches, and resolving the tournament from the category is
 * the only way to check ownership.
 */
export async function generateCategoryDraw(
  categoryId: string,
  options?: { bronzeMedals?: 0 | 1 | 2 | 3; separateByClub?: boolean }
) {
  const [cat] = await db
    .select({ tournamentId: categories.tournamentId })
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!cat) return { success: false, error: "Category not found" };

  const admin = await requireTournamentAdmin(cat.tournamentId);
  const result = await performCategoryDraw(categoryId, options);
  await audit({
    tournamentId: cat.tournamentId,
    categoryId,
    actor: admin,
    action: "DRAW_GENERATED",
    targetType: "category",
    targetId: categoryId,
    after: {
      options: options ?? null,
      success: result.success,
      ...("version" in result ? { version: result.version } : { refused: result.error }),
    },
  });
  return result;
}
export async function setCategoryDrawOption(
  categoryId: string,
  bronzeMedals: 0 | 1 | 2 | 3 | null
) {
  const [cat] = await db
    .select({ tournamentId: categories.tournamentId, drawProfile: categories.drawProfile })
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!cat) return { success: false, error: "Category not found" };

  const admin = await requireTournamentAdmin(cat.tournamentId);

  if (bronzeMedals !== null && ![0, 1, 2, 3].includes(bronzeMedals)) {
    return { success: false, error: "Bronze medals must be 0, 1, 2, 3 or null" };
  }

  await db.update(categories).set({ bronzeMedals }).where(eq(categories.id, categoryId));

  // The setting only shapes a draw when it is generated, so say so when the
  // existing bracket was built with something else.
  const [existing] = await db
    .select({ bronzeMedals: draws.bronzeMedals })
    .from(draws)
    .where(eq(draws.categoryId, categoryId));
  const [tournament] = await db
    .select({ defaultBronzeMedals: tournaments.defaultBronzeMedals, drawProfile: tournaments.drawProfile })
    .from(tournaments)
    .where(eq(tournaments.id, cat.tournamentId));
  // What the next draw would use, profile included: an official event ignores this setting.
  const effective = resolveDrawRules({
    tournamentProfile: tournament?.drawProfile,
    categoryProfile: cat.drawProfile,
    categoryBronze: bronzeMedals,
    tournamentBronze: tournament?.defaultBronzeMedals,
  }).bronzeMedals;
  const drawOutdated = existing !== undefined && existing.bronzeMedals !== effective;

  await audit({
    tournamentId: cat.tournamentId,
    categoryId,
    actor: admin,
    action: "DRAW_OPTION_CHANGED",
    targetType: "category",
    targetId: categoryId,
    after: { bronzeMedals, drawOutdated },
  });

  try {
    revalidatePath(`/admin/event/${cat.tournamentId}/categories`);
  } catch {}

  return { success: true, drawOutdated, drawBronzeMedals: existing?.bronzeMedals ?? null };
}

/** Overrides the tournament's draw profile for one category (null = inherit). Admin only. */
export async function setCategoryDrawProfile(categoryId: string, profile: "OFFICIAL" | "LOCAL" | null) {
  const [cat] = await db
    .select({ tournamentId: categories.tournamentId, drawProfile: categories.drawProfile })
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!cat) return { success: false, error: "Category not found" };
  const admin = await requireTournamentAdmin(cat.tournamentId);

  if (profile !== null && asDrawProfile(profile) === null) {
    return { success: false, error: "Profile must be OFFICIAL, LOCAL or null" };
  }

  await db.update(categories).set({ drawProfile: profile }).where(eq(categories.id, categoryId));
  await audit({
    tournamentId: cat.tournamentId,
    categoryId,
    actor: admin,
    action: "DRAW_OPTION_CHANGED",
    targetType: "category",
    targetId: categoryId,
    before: { drawProfile: cat.drawProfile },
    after: { drawProfile: profile },
  });

  try {
    revalidatePath(`/admin/event/${cat.tournamentId}/categories`);
  } catch {}

  return { success: true };
}

/**
 * What the draw panel needs for one category: the rules that apply to it, the
 * roster with any seeds, and how the current draw came about (its seed and
 * version), so the admin can explain a bracket. Admin only.
 */
export async function getCategoryDrawSetup(categoryId: string) {
  const [cat] = await db.select().from(categories).where(eq(categories.id, categoryId));
  if (!cat) return null;
  await requireTournamentAdmin(cat.tournamentId);

  const [tournament] = await db
    .select({
      defaultBronzeMedals: tournaments.defaultBronzeMedals,
      drawProfile: tournaments.drawProfile,
      drawSeparation: tournaments.drawSeparation,
    })
    .from(tournaments)
    .where(eq(tournaments.id, cat.tournamentId));

  const rules = resolveDrawRules({
    tournamentProfile: tournament?.drawProfile,
    categoryProfile: cat.drawProfile,
    tournamentSeparation: tournament?.drawSeparation,
    categoryBronze: cat.bronzeMedals,
    tournamentBronze: tournament?.defaultBronzeMedals,
  });

  const roster = (await loadCategoryRoster(db, categoryId))
    .map((a) => ({ athleteId: a.athleteId, name: a.name, club: a.school || a.dojo || null, seed: a.seed }))
    .sort((a, b) => (a.seed ?? Infinity) - (b.seed ?? Infinity) || a.name.localeCompare(b.name));

  const [draw] = await db.select().from(draws).where(eq(draws.categoryId, categoryId));

  // The first round as drawn, for the hand-adjust view (elimination brackets only).
  let firstRound: {
    matchNo: number;
    /** "Pool 2" for a draw with pools, so a bout can be placed. */
    pool: string | null;
    slots: { slotId: string; kind: "ATHLETE" | "BYE"; athleteId: string | null; name: string | null; club: string | null }[];
  }[] = [];
  let drawInfo: {
    version: number;
    state: string;
    seed: number | null;
    checksum: string;
    bronzeMedals: number;
    note: string | null;
  } | null = null;

  if (draw) {
    const [latest] = await db
      .select({ graph: drawVersions.graph, reason: drawVersions.reason })
      .from(drawVersions)
      .where(eq(drawVersions.drawId, draw.id))
      .orderBy(sql`${drawVersions.version} desc`)
      .limit(1);
    const graph = latest?.graph as unknown as DrawGraph | undefined;

    if (graph && graph.pools.length === 0) {
      const byId = new Map(roster.map((a) => [a.athleteId, a]));
      const drawParts = computeDrawParts(graph);
      firstRound = graph.matches
        .filter((m) => m.roundNo === 0 && m.bracketType === "MAIN")
        .sort((a, b) => a.matchNo - b.matchNo)
        .map((m) => ({
          matchNo: m.matchNo,
          pool: describePart(drawParts?.byMatch.get(m.id)),
          slots: graph.slots
            .filter((sl) => sl.matchId === m.id)
            .sort((a, b) => a.position - b.position)
            .map((sl) => ({
              slotId: sl.id,
              kind: sl.slotType === "ATHLETE" ? ("ATHLETE" as const) : ("BYE" as const),
              athleteId: sl.registrationId,
              name: sl.registrationId ? (byId.get(sl.registrationId)?.name ?? null) : null,
              club: sl.registrationId ? (byId.get(sl.registrationId)?.club ?? null) : null,
            })),
        }));
    }
    drawInfo = {
      version: draw.version,
      state: draw.state,
      seed: graph?.randomSeed ?? null,
      checksum: draw.checksum,
      bronzeMedals: draw.bronzeMedals,
      note: latest?.reason ?? null,
    };
  }

  return {
    rules,
    categoryProfile: asDrawProfile(cat.drawProfile),
    tournamentProfile: asDrawProfile(tournament?.drawProfile) ?? "LOCAL",
    roster,
    draw: drawInfo,
    firstRound,
    /** Who is in each pool of a draw with pools (and where it runs, once split); null otherwise. */
    pools: await loadCategoryPools(categoryId),
  };
}

/**
 * Trades two athletes' places in the first round of a draft bracket. Only under
 * organiser's rules, only before the draw is locked or any bout is
 * fought, and never for a kata pool flight. The result is stored as the next
 * draw version (so the history shows what the draw was before) and audited.
 * Admin only.
 */
export async function swapDrawAthletes(categoryId: string, slotIdA: string, slotIdB: string, reason?: string) {
  const [cat] = await db
    .select({ tournamentId: categories.tournamentId })
    .from(categories)
    .where(eq(categories.id, categoryId));
  if (!cat) return { success: false, error: "Category not found" };
  const admin = await requireTournamentAdmin(cat.tournamentId);

  const outcome = await performDrawSwap(categoryId, slotIdA, slotIdB, reason);
  if ("error" in outcome) return { success: false, error: outcome.error };

  await audit({
    tournamentId: cat.tournamentId,
    categoryId,
    actor: admin,
    action: "DRAW_ATHLETES_SWAPPED",
    targetType: "category",
    targetId: categoryId,
    before: { [slotIdA]: outcome.a, [slotIdB]: outcome.b },
    after: { [slotIdA]: outcome.b, [slotIdB]: outcome.a, version: outcome.version },
    reason: reason?.trim() || null,
  });

  try {
    revalidatePath(`/admin/event/${cat.tournamentId}/categories`);
  } catch {}

  // Open brackets (admin, stager, public) re-read the draw.
  broadcastLiveEvent({ table: "draws", op: "UPDATE", id: categoryId, tournamentId: cat.tournamentId });

  return { success: true, version: outcome.version };
}

/**
 * Sets (or clears) the seeds for a category's athletes. A seed is the athlete's
 * place in the bracket order: 1 is strongest. Athletes with no seed are drawn at
 * random around the seeded ones. Takes effect at the next draw. Admin only.
 */
export async function setCategorySeeds(
  categoryId: string,
  seeds: { athleteId: string; seed: number | null }[]
) {
  const [cat] = await db
    .select({ tournamentId: categories.tournamentId, name: categories.name })
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!cat) return { success: false, error: "Category not found" };
  const admin = await requireTournamentAdmin(cat.tournamentId);

  const roster = await loadCategoryRoster(db, categoryId);
  const inRoster = new Set(roster.map((a) => a.athleteId));
  const wanted = new Map<string, number>();
  const used = new Set<number>();

  for (const { athleteId, seed } of seeds) {
    if (seed === null) continue;
    if (!inRoster.has(athleteId)) return { success: false, error: "A seeded athlete is not in this category." };
    if (!Number.isInteger(seed) || seed < 1 || seed > roster.length) {
      return { success: false, error: `Seeds must be whole numbers from 1 to ${roster.length}.` };
    }
    if (used.has(seed)) return { success: false, error: `Seed ${seed} is given to more than one athlete.` };
    used.add(seed);
    wanted.set(athleteId, seed);
  }

  const before = Object.fromEntries(roster.filter((a) => a.seed !== null).map((a) => [a.athleteId, a.seed]));

  await db.transaction(async (tx) => {
    for (const athlete of roster) {
      const seed = wanted.get(athlete.athleteId) ?? null;
      if (seed === null && athlete.seed === null) continue;

      await tx
        .insert(categoryEntries)
        .values({ categoryId, athleteId: athlete.athleteId, seed })
        .onConflictDoUpdate({ target: [categoryEntries.categoryId, categoryEntries.athleteId], set: { seed } });
    }
  });

  await audit({
    tournamentId: cat.tournamentId,
    categoryId,
    actor: admin,
    action: "DRAW_SEEDS_SET",
    targetType: "category",
    targetId: categoryId,
    before,
    after: Object.fromEntries(wanted),
  });

  broadcastLiveEvent({ table: "draws", op: "UPDATE", id: categoryId, tournamentId: cat.tournamentId });

  return { success: true, seeded: wanted.size };
}

/**
 * Bulk generate draws for every category in a tournament. Admin only.
 */
export async function generateAllTournamentDraws(
  tournamentId: string,
  options?: { bronzeMedals?: 0 | 1 | 2 | 3; separateByClub?: boolean }
) {
  const admin = await requireTournamentAdmin(tournamentId);
  const result = await performGenerateAllTournamentDraws(tournamentId, options);
  await audit({ tournamentId, actor: admin, action: "DRAWS_GENERATED", after: { options: options ?? null } });
  return result;
}

/**
 * Pre-flight preview report of what "Generate All Draws" will do. Admin only.
 */
export async function getTournamentDrawPreflight(tournamentId: string) {
  await requireTournamentAdmin(tournamentId);
  return performGetTournamentDrawPreflight(tournamentId);
}

/**
 * Fetches and resolves the full digital draw tree for a category with live match states and athlete names
 */
export async function getCategoryDraw(
  categoryId: string,
  options?: { athleteId?: string | null; part?: string | null }
) {
  if (!categoryId || !isValidUuid(categoryId)) return null;

  const staff = await isStaffViewer(categoryId);
  if (!staff) {
    const allowed = options?.athleteId ? true : await publicDrawsEnabledForCategory(categoryId);
    if (!allowed) {
      return {
        locked: true,
        draw: null,
        categoryName: null,
        matches: [] as BracketMatchView[],
        podium: [],
        highlightAthleteId: null as string | null,
      };
    }
  }

  // A tatami's moderator sees only the pools or finals that run on their own tatami.
  const view = await resolveViewerPart(categoryId, options?.part ?? null);
  if (!view.allowed) {
    return {
      locked: true,
      draw: null,
      categoryName: null,
      matches: [] as BracketMatchView[],
      podium: [],
      highlightAthleteId: null as string | null,
    };
  }

  // The draw itself is request-free; the gates above are all this action adds,
  // so the same assembly serves the export.
  return assembleCategoryDraw(categoryId, { ...options, part: view.part });
}

/**
 * The draw as one athlete's family sees it: the same bracket, with that
 * athlete highlighted and everyone else dimmed. Available to the public even
 * when general draw viewing is switched off, because it only reveals a name
 * the searcher already typed.
 */
export async function getAthleteDraw(athleteId: string) {
  if (!athleteId) return null;

  const [athlete] = await db
    .select({ id: athletes.id, name: athletes.name, categoryId: athletes.categoryId })
    .from(athletes)
    .where(eq(athletes.id, athleteId));

  if (!athlete?.categoryId) return null;

  const draw = await getCategoryDraw(athlete.categoryId, { athleteId });
  if (!draw) return null;

  return { ...draw, athleteName: athlete.name, highlightAthleteId: athleteId };
}

export async function lockCategoryDraw(categoryId: string) {
  const [cat] = await db
    .select({ tournamentId: categories.tournamentId })
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!cat) return { success: false, error: "Category not found" };
  const admin = await requireTournamentAdmin(cat.tournamentId);

  await db
    .update(draws)
    .set({ state: "LOCKED", lockedAt: new Date() })
    .where(eq(draws.categoryId, categoryId));

  try {
    revalidatePath(`/admin/event/${cat.tournamentId}/categories`);
  } catch {}

  await audit({
    tournamentId: cat.tournamentId,
    categoryId,
    actor: admin,
    action: "DRAW_LOCKED",
    targetType: "category",
    targetId: categoryId,
  });

  return { success: true };
}

export async function unlockCategoryDraw(categoryId: string) {
  const [cat] = await db
    .select({ tournamentId: categories.tournamentId })
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!cat) return { success: false, error: "Category not found" };
  const admin = await requireTournamentAdmin(cat.tournamentId);

  await db
    .update(draws)
    .set({ state: "DRAFT", lockedAt: null })
    .where(eq(draws.categoryId, categoryId));

  try {
    revalidatePath(`/admin/event/${cat.tournamentId}/categories`);
  } catch {}

  await audit({
    tournamentId: cat.tournamentId,
    categoryId,
    actor: admin,
    action: "DRAW_UNLOCKED",
    targetType: "category",
    targetId: categoryId,
  });

  return { success: true };
}

export async function toggleCategoryDrawLock(categoryId: string) {
  const [cat] = await db
    .select({ tournamentId: categories.tournamentId })
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!cat) return { success: false, error: "Category not found" };
  const admin = await requireTournamentAdmin(cat.tournamentId);

  const [draw] = await db
    .select()
    .from(draws)
    .where(eq(draws.categoryId, categoryId));

  if (!draw) return { success: false, error: "No draw generated yet for this category" };

  const isLocked = draw.state === "LOCKED";
  const nextState = isLocked ? "DRAFT" : "LOCKED";
  const lockedAt = isLocked ? null : new Date();

  await db
    .update(draws)
    .set({ state: nextState, lockedAt })
    .where(eq(draws.id, draw.id));

  try {
    revalidatePath(`/admin/event/${cat.tournamentId}/categories`);
  } catch {}

  await audit({
    tournamentId: cat.tournamentId,
    categoryId,
    actor: admin,
    action: isLocked ? "DRAW_UNLOCKED" : "DRAW_LOCKED",
    targetType: "category",
    targetId: categoryId,
  });

  return { success: true, isLocked: !isLocked, state: nextState };
}

/** The word an admin must type to flush a category's draw. (A "use server" file cannot export a constant.) */
const FLUSH_CONFIRMATION = "FLUSH";
const MIN_FLUSH_REASON_LENGTH = 5;

/**
 * Completely flushes and purges all draws, matches, slots, and scores for a specific category.
 * Strictly isolated: operates only on the specified categoryId with zero impact on other categories.
 *
 * This is the only way to discard fought bouts. It needs the typed confirmation,
 * and a reason once results exist; the reason, the counts and the draw
 * checksum it destroyed go into the audit log.
 */
export async function flushCategoryDraw(
  categoryId: string,
  confirmation?: { confirm: string; reason?: string }
) {
  const [cat] = await db
    .select({ tournamentId: categories.tournamentId, name: categories.name })
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!cat) return { success: false, error: "Category not found" };
  const admin = await requireTournamentAdmin(cat.tournamentId);

  if (confirmation?.confirm?.trim() !== FLUSH_CONFIRMATION) {
    return { success: false, error: `Type ${FLUSH_CONFIRMATION} to confirm.` };
  }

  const reason = confirmation.reason?.trim() ?? "";

  const before = await db.transaction(async (tx) => {
    // 1. Serialise against concurrent scoring/generation, then look at what is about to go.
    await tx.select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId)).for("update");

    const catMatches = await tx
      .select({ id: matches.id, status: matches.status })
      .from(matches)
      .where(eq(matches.categoryId, categoryId));
    const matchIds = catMatches.map((m) => m.id);
    const fought = catMatches.filter((m) => m.status === "CONFIRMED" || m.status === "COMPLETED" || m.status === "LIVE").length;

    const [draw] = await tx
      .select({ id: draws.id, version: draws.version, checksum: draws.checksum, state: draws.state })
      .from(draws)
      .where(eq(draws.categoryId, categoryId));

    if (fought > 0 && reason.length < MIN_FLUSH_REASON_LENGTH) {
      return { refused: `This category has ${fought} fought bout(s). Give a reason (at least ${MIN_FLUSH_REASON_LENGTH} characters) to flush it.` };
    }

    // A split category goes back to one card on its finals tatami: the pools it described are gone.
    await tx
      .delete(categoryAssignments)
      .where(and(eq(categoryAssignments.categoryId, categoryId), like(categoryAssignments.part, "POOL:%")));
    await tx
      .update(categoryAssignments)
      .set({ part: "ALL", partAthletes: null, partMatches: null })
      .where(and(eq(categoryAssignments.categoryId, categoryId), eq(categoryAssignments.part, "FINALS")));

    // 2. Delete kata_scores, matchEvents, slots, and matches for this category in clean FK order
    if (matchIds.length > 0) {
      await tx.delete(kataScores).where(inArray(kataScores.matchId, matchIds));
      await tx.delete(matchEvents).where(inArray(matchEvents.matchId, matchIds));
      await tx.delete(matchSlots).where(inArray(matchSlots.matchId, matchIds));
      await tx.delete(matches).where(eq(matches.categoryId, categoryId));
    }

    // 3. Delete draw record & version history
    if (draw) {
      await tx.delete(drawVersions).where(eq(drawVersions.drawId, draw.id));
      await tx.delete(draws).where(eq(draws.id, draw.id));
    }

    // 4. Reset expected matches on category
    await tx.update(categories).set({ expectedMatches: 0 }).where(eq(categories.id, categoryId));

    return { matches: matchIds.length, fought, draw: draw ?? null };
  });

  if ("refused" in before) return { success: false, error: before.refused };

  try {
    revalidatePath(`/admin/event/${cat.tournamentId}/categories`);
  } catch {}

  await audit({
    tournamentId: cat.tournamentId,
    categoryId,
    actor: admin,
    action: "DRAW_FLUSHED",
    targetType: "category",
    targetId: categoryId,
    before: { categoryName: cat.name, ...before },
    reason: reason || null,
  });

  broadcastLiveEvent({ table: "draws", op: "DELETE", id: categoryId, tournamentId: cat.tournamentId });

  return { success: true };
}
