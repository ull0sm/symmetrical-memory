import { db } from "@/db";
import {
  athletes,
  categories,
  categoryEntries,
  draws,
  drawVersions,
  matches,
  matchSlots,
  matchEvents,
  kataScores,
  tournaments,
} from "@/db/schema";
import { generateDraw, generateKataDraw } from "@/engine/draw-engine";
import { DrawInputError } from "@/engine/draw-engine/errors";
import { resolveDrawRules } from "@/lib/draws/drawRules";
import type { DrawGraph, Participant, SeedAssignment } from "@/engine/draw-engine/types";
import { foughtBoutCount } from "@/lib/draws/boutCount";
import { reapplyRoutingAfterRedraw } from "@/lib/draws/partRouting";
import { WKF_KATA_2026, WKF_KUMITE_2026 } from "@/engine/rules-engine";
import { eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { syncTournamentCategoryCounts, getActiveAthleteCounts } from "@/lib/categories/syncCounts";
import { isKataCategory } from "@/lib/categories/eventType";

export type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Bouts fought or running, per category: what a redraw would destroy. One query, for one category or many. */
export async function readBoutStats(executor: DbExecutor, categoryIds: readonly string[]) {
  const stats = new Map<string, { confirmed: number; live: number; total: number }>();
  if (categoryIds.length === 0) return stats;

  const rows = await executor
    .select({
      categoryId: matches.categoryId,
      confirmed: sql<number>`count(*) filter (where ${matches.status} in ('CONFIRMED', 'COMPLETED'))`,
      live: sql<number>`count(*) filter (where ${matches.status} = 'LIVE')`,
      total: sql<number>`count(*)`,
    })
    .from(matches)
    .where(inArray(matches.categoryId, [...categoryIds]))
    .groupBy(matches.categoryId);

  for (const row of rows) {
    stats.set(row.categoryId, {
      confirmed: Number(row.confirmed ?? 0),
      live: Number(row.live ?? 0),
      total: Number(row.total ?? 0),
    });
  }
  return stats;
}

/** What stands between a category and a redraw: a lock, or bouts already fought. */
export async function readProtection(executor: DbExecutor, categoryId: string) {
  const [existingDraw] = await executor.select().from(draws).where(eq(draws.categoryId, categoryId));
  const { confirmed, live } = (await readBoutStats(executor, [categoryId])).get(categoryId) ?? { confirmed: 0, live: 0 };

  return {
    isLocked: existingDraw?.state === "LOCKED",
    confirmedCount: confirmed,
    liveCount: live,
    activeBoutCount: confirmed + live,
  };
}

export function refusalFor(catName: string, protection: Awaited<ReturnType<typeof readProtection>>) {
  const { isLocked, confirmedCount, liveCount, activeBoutCount } = protection;

  // Fought bouts win over the lock: unlocking cannot make a redraw safe.
  if (activeBoutCount > 0) {
    return {
      success: false as const,
      error: `Cannot regenerate "${catName}": it already has ${confirmedCount} confirmed and ${liveCount} live bout(s), and a redraw would erase those results. Use "Flush category draw" (with a reason) if you really must start over.`,
      isLocked,
      activeBoutCount,
    };
  }

  if (isLocked) {
    return {
      success: false as const,
      error: `Draw for "${catName}" is LOCKED. Unlock it first if you wish to regenerate.`,
      isLocked,
      activeBoutCount,
    };
  }

  return null;
}

/** Thrown inside the generation transaction when the protection check fails. */
class DrawRefusedError extends Error {
  constructor(readonly refusal: NonNullable<ReturnType<typeof refusalFor>>) {
    super(refusal.error);
  }
}

/** Code-unit order: the same on every machine, unlike localeCompare, so a draw reproduces from its seed anywhere. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A fresh 32-bit seed, stored with the draw; deterministic from there, but not guessable from the clock. */
function newRandomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? Date.now() >>> 0;
}

/** Club key for separation; an athlete with no club never shares one. */
export function clubKey(athleteId: string, school: string | null, dojo: string | null): string {
  const name = (school || dojo || "").trim();
  return name === "" ? `independent:${athleteId}` : name;
}

export interface RosterEntry {
  athleteId: string;
  name: string;
  school: string | null;
  dojo: string | null;
  seed: number | null;
}

/**
 * Everyone drawn in a category. Athletes reach a category two ways: official
 * import entries and the athlete's own category (manual add / move). Both are
 * used, once each, the same way the category counts do, so a manually added
 * athlete is never left out of a category that also has imported entries.
 */
export async function loadCategoryRoster(executor: DbExecutor, categoryId: string): Promise<RosterEntry[]> {
  const entries = await executor
    .select({
      athleteId: athletes.id,
      name: athletes.name,
      school: athletes.school,
      dojo: athletes.dojo,
      seed: categoryEntries.seed,
    })
    .from(categoryEntries)
    .innerJoin(athletes, eq(categoryEntries.athleteId, athletes.id))
    .where(eq(categoryEntries.categoryId, categoryId));

  const direct = await executor
    .select({ athleteId: athletes.id, name: athletes.name, school: athletes.school, dojo: athletes.dojo })
    .from(athletes)
    .where(eq(athletes.categoryId, categoryId));

  const seen = new Set(entries.map((e) => e.athleteId));
  return [...entries, ...direct.filter((a) => !seen.has(a.athleteId)).map((a) => ({ ...a, seed: null }))];
}

/**
 * Deletes a category's bouts with their slots, scores and events, in reverse
 * dependency order. The draw row and its version history stay. Callers check
 * first that nothing has been fought.
 */
export async function deleteCategoryBouts(tx: DbExecutor, categoryId: string) {
  const catMatches = await tx.select({ id: matches.id }).from(matches).where(eq(matches.categoryId, categoryId));
  const matchIds = catMatches.map((m) => m.id);
  if (matchIds.length > 0) {
    await tx.delete(kataScores).where(inArray(kataScores.matchId, matchIds));
    await tx.delete(matchEvents).where(inArray(matchEvents.matchId, matchIds));
    await tx.delete(matchSlots).where(inArray(matchSlots.matchId, matchIds));
    await tx.delete(matches).where(eq(matches.categoryId, categoryId));
  }
  return matchIds;
}

/**
 * Writes a category's draw from an engine graph, replacing any previous bouts:
 * the draw row (next version), the version history, the bouts and their slots,
 * and the category's expected bout count. Generated Official draws and locked
 * Local groups share it. Call it inside a transaction that has already checked
 * nothing has been fought; it does no checks of its own.
 */
export async function writeDrawGraph(
  tx: DbExecutor,
  categoryId: string,
  graph: DrawGraph,
  options: { format: string; state: "DRAFT" | "LOCKED"; bronzeMedals: number; reason: string }
) {
  await deleteCategoryBouts(tx, categoryId);

  // Upsert draw record. A version number is never reused, even if the row has fallen behind its history.
  const [existingDraw] = await tx.select().from(draws).where(eq(draws.categoryId, categoryId));
  const [latest] = existingDraw
    ? await tx
        .select({ v: sql<number>`max(${drawVersions.version})` })
        .from(drawVersions)
        .where(eq(drawVersions.drawId, existingDraw.id))
    : [];
  const version = existingDraw ? Math.max(existingDraw.version, Number(latest?.v ?? 0)) + 1 : 1;
  const drawId = existingDraw?.id ?? crypto.randomUUID();
  const row = {
    version,
    format: options.format,
    rulesetId: graph.rulesetId,
    tournamentSize: graph.tournamentSize,
    byeCount: graph.byeCount,
    checksum: graph.checksum,
    state: options.state,
    bronzeMedals: options.bronzeMedals,
    ...(options.state === "LOCKED" ? { lockedAt: new Date() } : {}),
  };
  if (existingDraw) await tx.update(draws).set(row).where(eq(draws.id, drawId));
  else await tx.insert(draws).values({ id: drawId, categoryId, ...row });

  // Version history: the whole graph, so the draw can be re-read and verified later.
  await tx.insert(drawVersions).values({ drawId, version, graph, checksum: graph.checksum, reason: options.reason });

  // The bouts and their slots, from the graph, for kumite brackets and kata pools alike.
  if (graph.matches.length > 0) {
    await tx.insert(matches).values(
      graph.matches.map((m) => ({
        id: m.id,
        categoryId,
        matchNo: m.matchNo,
        roundNo: m.roundNo,
        roundName: m.roundName,
        bracketType: m.bracketType,
        status: m.startStatus ?? "SCHEDULED",
        poolGroup: m.poolGroup ?? null,
        kataScoringMode: m.kataScoringMode ?? null,
      }))
    );
  }
  if (graph.slots.length > 0) {
    await tx.insert(matchSlots).values(
      graph.slots.map((s) => ({
        id: s.id,
        matchId: s.matchId,
        position: s.position,
        slotType: s.slotType,
        athleteId: s.registrationId ?? null,
        sourceMatchId: s.sourceMatchId ?? null,
      }))
    );
  }

  // Walkovers and empty bye matches are never fought; a kata flight or ranked group has none.
  const foughtBouts = foughtBoutCount(graph);
  await tx.update(categories).set({ expectedMatches: foughtBouts }).where(eq(categories.id, categoryId));
  return { drawId, version, foughtBouts };
}

/**
 * The core of draw generation: pure database work with no request context, so
 * the admin actions can guard it and scripts (seeding, verification) can call
 * it directly. Never expose these to the client.
 *
 * A category that is locked or already has fought bouts is never redrawn here;
 * the only way to discard results is `flushCategoryDraw`, which demands a reason
 * and is audited. The check is repeated inside the write transaction, under a
 * row lock, so a bout confirmed mid-generation cannot slip past it.
 */
export async function performCategoryDraw(
  categoryId: string,
  options?: {
    bronzeMedals?: 0 | 1 | 2 | 3;
    separateByClub?: boolean;
    /** Reproduce a draw: the same seed and roster give the same bracket. Default: a fresh random seed. */
    randomSeed?: number;
  }
) {
  // 1. Fetch category
  const [cat] = await db
    .select()
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!cat) throw new Error("Category not found");

  // Fail fast; the authoritative check is repeated inside the transaction.
  const early = refusalFor(cat.name, await readProtection(db, categoryId));
  if (early) return early;

  // Profile, bronze format and separation resolve in one place: see drawRules.ts.
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
    bronzeOverride: options?.bronzeMedals,
    categoryBronze: cat.bronzeMedals,
    tournamentBronze: tournament?.defaultBronzeMedals,
  });
  const bronzeMedals = rules.bronzeMedals;
  // A one-off "no separation" request only counts where the profile permits tweaks.
  const separate = rules.separation === "CLUB" && !(rules.profile === "LOCAL" && options?.separateByClub === false);

  // 2. The category's roster, with any seeds the admin set
  // A stable order, so the same seed and roster always give the same draw whatever order the database answers in.
  const participantList = (await loadCategoryRoster(db, categoryId)).sort(
    (a, b) => compareText(a.name, b.name) || compareText(a.athleteId, b.athleteId)
  );

  if (participantList.length < 2) {
    return {
      success: false,
      error: `Category "${cat.name}" has ${participantList.length} competitor(s). Minimum 2 competitors required to generate a bracket.`,
    };
  }

  // 3. Build participants array
  const participants: Participant[] = participantList.map((p) => ({
    registrationId: p.athleteId,
    displayName: p.name,
    // An athlete with no club is their own club, so they are never "separated" from each other.
    clubId: clubKey(p.athleteId, p.school, p.dojo),
    districtId: null,
  }));

  const seeds: SeedAssignment[] = participantList
    .filter((p) => p.seed !== null)
    .map((p) => ({ registrationId: p.athleteId, seed: p.seed as number }));

  // 4. Select ruleset
  const isKata = isKataCategory(cat);
  const ruleset = isKata ? WKF_KATA_2026 : WKF_KUMITE_2026;

  // 5. Run draw engine. The seed is stored with the draw so it can be explained and reproduced.
  const randomSeed = options?.randomSeed !== undefined ? options.randomSeed >>> 0 : newRandomSeed();
  const isKataPools = isKata && cat.kataFormat === "GROUP_POOLS";
  let graph: DrawGraph;
  try {
    graph = isKataPools
      ? generateKataDraw(
          {
            categoryId,
            participants: participantList.map((p) => ({ id: p.athleteId, name: p.name, school: p.school, dojo: p.dojo })),
            poolSize: cat.poolSize || 8,
            advancePerPool: cat.advancePerPool || 2,
            scoringMode: (cat.kataScoringMode as "FLAG" | "POINTS") || "POINTS",
            bronzeMedals: bronzeMedals === 1 ? 1 : bronzeMedals === 0 ? 0 : 2,
            randomSeed,
            separateClubs: separate,
          },
          ruleset
        )
      : generateDraw(
          {
            categoryId,
            format: "SINGLE_ELIM_REPECHAGE",
            participants,
            seeding: seeds.length > 0 ? { mode: "MANUAL", seeds, randomSeed } : { mode: "RANDOM_SEEDED", randomSeed },
            separation: separate ? { by: "CLUB", rule: "FIRST_ROUND" } : undefined,
            options: {
              bronzeMedals,
            },
          },
          ruleset
        );
  } catch (err) {
    if (err instanceof DrawInputError) {
      return {
        success: false as const,
        error: `Could not draw "${cat.name}": ${err.issues.map((issue) => issue.message).join("; ")}`,
      };
    }
    throw err;
  }

  // 6. Save draw into database atomically
  let result;
  try {
    result = await db.transaction(async (tx) => {
      // Serialise concurrent generate/confirm on this category, then re-check.
      await tx.select({ id: categories.id }).from(categories).where(eq(categories.id, categoryId)).for("update");
      const refusal = refusalFor(cat.name, await readProtection(tx, categoryId));
      if (refusal) throw new DrawRefusedError(refusal);

      // Roster size is recorded with the draw, so a refused or failed draw leaves the counts alone.
      await tx.update(categories).set({ athletesCount: participantList.length }).where(eq(categories.id, categoryId));

      const { drawId, version, foughtBouts } = await writeDrawGraph(tx, categoryId, graph, {
        format: isKataPools ? "KATA_GROUP_POOLS" : graph.format,
        state: "DRAFT",
        bronzeMedals,
        reason: `Generated by admin (seed ${randomSeed}, ${rules.profile.toLowerCase()} profile, ${
          isKataPools ? "kata pools" : `${seeds.length} seeded`
        }, club separation ${separate ? "on" : "off"})`,
      });

      // A category whose pools run on different tatamis keeps that routing across a redraw when the
      // new draw has the same number of pools; otherwise it goes back to one card.
      await reapplyRoutingAfterRedraw(tx, categoryId, graph);

      return { drawId, matchCount: graph.matches.length, foughtBouts, version };
    });
  } catch (err) {
    if (err instanceof DrawRefusedError) return err.refusal;
    throw err;
  }

  try {
    revalidatePath(`/admin/event/${cat.tournamentId}/categories`);
  } catch {}
  return { success: true, ...result };
}

export async function performGenerateAllTournamentDraws(
  tournamentId: string,
  options?: { bronzeMedals?: 0 | 1 | 2 | 3; separateByClub?: boolean }
) {
  const allCats = await db
    .select()
    .from(categories)
    .where(eq(categories.tournamentId, tournamentId));

  if (allCats.length === 0) {
    return {
      success: true,
      totalCategories: 0,
      generatedCount: 0,
      protectedCount: 0,
      skippedCount: 0,
      errors: [],
      protectedCategories: [],
    };
  }

  const catIds = allCats.map((c) => c.id);

  // Fetch all existing draws and match stats for this tournament's categories
  const allDraws = await db
    .select()
    .from(draws)
    .where(inArray(draws.categoryId, catIds));

  const drawByCat = new Map(allDraws.map((d) => [d.categoryId, d]));

  const matchStatsByCat = await readBoutStats(db, catIds);

  let generatedCount = 0;
  let protectedCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];
  const protectedCategories: string[] = [];

  for (const cat of allCats) {
    const existingDraw = drawByCat.get(cat.id);
    const stats = matchStatsByCat.get(cat.id) ?? { confirmed: 0, live: 0, total: 0 };
    const hasActiveMatches = stats.confirmed > 0 || stats.live > 0;
    const isLocked = existingDraw?.state === "LOCKED";

    // CRITICAL PROTECTION: Skip and preserve categories that are locked or have live/confirmed bouts!
    if (isLocked || hasActiveMatches) {
      protectedCount++;
      const reason = hasActiveMatches
        ? `${stats.confirmed} bouts completed`
        : "draw locked";
      protectedCategories.push(`"${cat.name}" (${reason})`);
      continue;
    }

    try {
      const res = await performCategoryDraw(cat.id, options);
      if (res.success) {
        generatedCount++;
      } else {
        skippedCount++;
        if (res.error) errors.push(res.error);
      }
    } catch (err: unknown) {
      skippedCount++;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Category "${cat.name}": ${msg}`);
    }
  }

  try {
    revalidatePath(`/admin/event/${tournamentId}/categories`);
  } catch {}

  return {
    success: true,
    totalCategories: allCats.length,
    generatedCount,
    protectedCount,
    skippedCount,
    errors,
    protectedCategories,
  };
}

export type DrawPreflightItem = {
  id: string;
  name: string;
  athletesCount: number;
  drawState: "NO_DRAW" | "DRAFT" | "LOCKED" | "IN_PROGRESS" | "COMPLETED";
  confirmedMatches: number;
  liveMatches: number;
  totalMatches: number;
  action: "GENERATE" | "PROTECT" | "SKIP";
  reason: string;
};

export type DrawPreflightReport = {
  total: number;
  toGenerate: DrawPreflightItem[];
  protected: DrawPreflightItem[];
  skipped: DrawPreflightItem[];
};

export async function performGetTournamentDrawPreflight(
  tournamentId: string
): Promise<DrawPreflightReport> {
  const allCats = await db
    .select()
    .from(categories)
    .where(eq(categories.tournamentId, tournamentId));

  if (allCats.length === 0) {
    return {
      total: 0,
      toGenerate: [],
      protected: [],
      skipped: [],
    };
  }

  // Ensure DB counts are synchronized and query real active counts per category
  await syncTournamentCategoryCounts(tournamentId);
  const activeCountMap = await getActiveAthleteCounts(tournamentId);

  const catIds = allCats.map((c) => c.id);

  const allDraws = await db
    .select()
    .from(draws)
    .where(inArray(draws.categoryId, catIds));

  const drawByCat = new Map(allDraws.map((d) => [d.categoryId, d]));

  const matchStatsByCat = await readBoutStats(db, catIds);

  const toGenerate: DrawPreflightItem[] = [];
  const protectedItems: DrawPreflightItem[] = [];
  const skipped: DrawPreflightItem[] = [];

  for (const cat of allCats) {
    const existingDraw = drawByCat.get(cat.id);
    const stats = matchStatsByCat.get(cat.id) || { confirmed: 0, live: 0, total: 0 };
    const athletesCount = activeCountMap.get(cat.id) ?? cat.athletesCount ?? 0;

    let lifecycleState: "NO_DRAW" | "DRAFT" | "LOCKED" | "IN_PROGRESS" | "COMPLETED" = "NO_DRAW";
    if (existingDraw) {
      if (stats.total > 0 && stats.confirmed === stats.total) {
        lifecycleState = "COMPLETED";
      } else if (stats.confirmed > 0 || stats.live > 0) {
        lifecycleState = "IN_PROGRESS";
      } else if (existingDraw.state === "LOCKED") {
        lifecycleState = "LOCKED";
      } else {
        lifecycleState = "DRAFT";
      }
    }

    if (athletesCount < 2) {
      skipped.push({
        id: cat.id,
        name: cat.name,
        athletesCount,
        drawState: lifecycleState,
        confirmedMatches: stats.confirmed,
        liveMatches: stats.live,
        totalMatches: stats.total,
        action: "SKIP",
        reason: "Fewer than 2 athletes registered",
      });
    } else if (lifecycleState === "IN_PROGRESS" || lifecycleState === "COMPLETED") {
      protectedItems.push({
        id: cat.id,
        name: cat.name,
        athletesCount,
        drawState: lifecycleState,
        confirmedMatches: stats.confirmed,
        liveMatches: stats.live,
        totalMatches: stats.total,
        action: "PROTECT",
        reason: `${stats.confirmed}/${stats.total} matches completed`,
      });
    } else if (lifecycleState === "LOCKED") {
      protectedItems.push({
        id: cat.id,
        name: cat.name,
        athletesCount,
        drawState: lifecycleState,
        confirmedMatches: stats.confirmed,
        liveMatches: stats.live,
        totalMatches: stats.total,
        action: "PROTECT",
        reason: "Official draw is locked",
      });
    } else {
      toGenerate.push({
        id: cat.id,
        name: cat.name,
        athletesCount,
        drawState: lifecycleState,
        confirmedMatches: stats.confirmed,
        liveMatches: stats.live,
        totalMatches: stats.total,
        action: "GENERATE",
        reason: existingDraw ? "Draft bracket will be updated" : "Initial bracket will be generated",
      });
    }
  }

  return {
    total: allCats.length,
    toGenerate,
    protected: protectedItems,
    skipped,
  };
}
