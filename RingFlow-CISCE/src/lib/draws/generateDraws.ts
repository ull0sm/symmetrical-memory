import { db } from "@/db";
import {
  athletes,
  categories,
  categoryEntries,
  draws,
  drawVersions,
  matches,
  matchSlots,
  tournaments,
} from "@/db/schema";
import { generateDraw } from "@/engine/draw-engine";
import type { DrawGraph, Participant } from "@/engine/draw-engine/types";
import { foughtBoutCount } from "@/lib/draws/boutCount";
import { WKF_KATA_2026, WKF_KUMITE_2026 } from "@/engine/rules-engine";
import { eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { syncTournamentCategoryCounts, getActiveAthleteCounts } from "@/lib/categories/syncCounts";

/**
 * The unimplemented-by-design core of draw generation: pure database work with
 * no request context, so the admin actions can guard it and scripts (seeding,
 * verification) can call it directly. Never expose these to the client.
 */
export async function performCategoryDraw(
  categoryId: string,
  options?: {
    bronzeMedals?: 0 | 1 | 2 | 3;
    separateByClub?: boolean;
    forceRegenerate?: boolean;
  }
) {
  // 1. Fetch category
  const [cat] = await db
    .select()
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!cat) throw new Error("Category not found");

  // Safety protection: check existing draw lock and completed/live matches
  const [existingDraw] = await db
    .select()
    .from(draws)
    .where(eq(draws.categoryId, categoryId));

  const [matchStats] = await db
    .select({
      confirmed: sql<number>`count(*) filter (where ${matches.status} = 'CONFIRMED')`,
      live: sql<number>`count(*) filter (where ${matches.status} = 'LIVE')`,
    })
    .from(matches)
    .where(eq(matches.categoryId, categoryId));

  const confirmedCount = Number(matchStats?.confirmed ?? 0);
  const liveCount = Number(matchStats?.live ?? 0);
  const activeBoutCount = confirmedCount + liveCount;

  if (existingDraw?.state === "LOCKED" && !options?.forceRegenerate) {
    return {
      success: false,
      error: `Draw for "${cat.name}" is LOCKED. Unlock it first if you wish to regenerate.`,
      isLocked: true,
      activeBoutCount,
    };
  }

  if (activeBoutCount > 0 && !options?.forceRegenerate) {
    return {
      success: false,
      error: `Cannot regenerate: Category "${cat.name}" already has ${confirmedCount} confirmed and ${liveCount} live bout(s). Regenerating would erase all tournament results.`,
      isLocked: existingDraw?.state === "LOCKED",
      activeBoutCount,
    };
  }

  // The bronze choice resolves in order: explicit override → this category's
  // setting → the tournament default → WKF's two.
  const [tournament] = await db
    .select({ defaultBronzeMedals: tournaments.defaultBronzeMedals })
    .from(tournaments)
    .where(eq(tournaments.id, cat.tournamentId));

  const bronzeMedals: 0 | 1 | 2 | 3 =
    options?.bronzeMedals ??
    (cat.bronzeMedals === 0 || cat.bronzeMedals === 1 || cat.bronzeMedals === 2 || cat.bronzeMedals === 3
      ? (cat.bronzeMedals as 0 | 1 | 2 | 3)
      : undefined) ??
    (tournament?.defaultBronzeMedals === 0 ||
    tournament?.defaultBronzeMedals === 1 ||
    tournament?.defaultBronzeMedals === 2 ||
    tournament?.defaultBronzeMedals === 3
      ? (tournament.defaultBronzeMedals as 0 | 1 | 2 | 3)
      : 2);

  // 2. Fetch category entries with athlete details
  const entries = await db
    .select({
      entryId: categoryEntries.id,
      athleteId: athletes.id,
      name: athletes.name,
      school: athletes.school,
      dojo: athletes.dojo,
      seed: categoryEntries.seed,
    })
    .from(categoryEntries)
    .innerJoin(athletes, eq(categoryEntries.athleteId, athletes.id))
    .where(eq(categoryEntries.categoryId, categoryId));

  // Fallback: if category_entries is empty, check legacy athletes.category_id
  let participantList = entries;
  if (participantList.length === 0) {
    const legacyAthletes = await db
      .select({
        entryId: athletes.id,
        athleteId: athletes.id,
        name: athletes.name,
        school: athletes.school,
        dojo: athletes.dojo,
        seed: sql<number | null>`null`,
      })
      .from(athletes)
      .where(eq(athletes.categoryId, categoryId));
    participantList = legacyAthletes;
  }

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
    clubId: p.school || p.dojo || "Independent",
    districtId: null,
  }));

  // Synchronize category table with verified participant count
  await db
    .update(categories)
    .set({
      athletesCount: participantList.length,
      expectedMatches: Math.max(0, participantList.length - 1),
    })
    .where(eq(categories.id, categoryId));

  // 4. Select ruleset
  const isKata = cat.name.toLowerCase().includes("kata");
  const ruleset = isKata ? WKF_KATA_2026 : WKF_KUMITE_2026;

  // 5. Run draw engine
  const graph: DrawGraph = generateDraw(
    {
      categoryId,
      format: "SINGLE_ELIM_REPECHAGE",
      participants,
      seeding: {
        mode: "RANDOM_SEEDED",
        randomSeed: Date.now(),
      },
      separation: {
        by: "CLUB",
        rule: "FIRST_ROUND",
      },
      options: {
        bronzeMedals,
      },
    },
    ruleset
  );

  // 6. Save draw into database atomically
  const result = await db.transaction(async (tx) => {
    // Delete existing matches and slots (cascade deletes slots)
    await tx.delete(matches).where(eq(matches.categoryId, categoryId));

    // Upsert draw record
    const [existingDraw] = await tx
      .select()
      .from(draws)
      .where(eq(draws.categoryId, categoryId));

    const version = existingDraw ? existingDraw.version + 1 : 1;
    const drawId = existingDraw?.id ?? crypto.randomUUID();

    const drawFormat = isKata && cat.kataFormat === "GROUP_POOLS" ? "KATA_GROUP_POOLS" : graph.format;

    if (existingDraw) {
      await tx
        .update(draws)
        .set({
          version,
          format: drawFormat,
          rulesetId: graph.rulesetId,
          tournamentSize: graph.tournamentSize,
          byeCount: graph.byeCount,
          checksum: graph.checksum,
          state: "DRAFT",
          bronzeMedals,
        })
        .where(eq(draws.id, drawId));
    } else {
      await tx.insert(draws).values({
        id: drawId,
        categoryId,
        version,
        format: drawFormat,
        rulesetId: graph.rulesetId,
        tournamentSize: graph.tournamentSize,
        byeCount: graph.byeCount,
        checksum: graph.checksum,
        state: "DRAFT",
        bronzeMedals,
      });
    }

    // Insert version history snapshot
    await tx.insert(drawVersions).values({
      drawId,
      version,
      graph: graph as any,
      checksum: graph.checksum,
      reason: "Generated by organizer",
    });

    // Insert exploded matches with pool group tags for Kata
    if (graph.matches.length > 0) {
      const round1Matches = graph.matches.filter((x) => x.roundNo === 1);
      const halfRound1 = Math.ceil(round1Matches.length / 2);

      await tx.insert(matches).values(
        graph.matches.map((m) => {
          let poolGroup: string | null = null;
          if (isKata && cat.kataFormat === "GROUP_POOLS") {
            if (m.roundNo === 1) {
              poolGroup = m.matchNo <= halfRound1 ? "Pool A" : "Pool B";
            } else {
              poolGroup = "Final Flight";
            }
          }
          return {
            id: m.id,
            categoryId,
            matchNo: m.matchNo,
            roundNo: m.roundNo,
            roundName: poolGroup && poolGroup.startsWith("Pool")
              ? `${poolGroup} - Bout #${m.matchNo}`
              : m.roundName,
            bracketType: m.bracketType,
            status: "SCHEDULED",
            poolGroup,
            kataScoringMode: isKata ? cat.kataScoringMode || "FLAG" : null,
          };
        })
      );
    }

    // Insert match slots
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

    // The category's bout count is now a fact rather than the athletes-minus-one
    // estimate: every progress bar reads "Match X of Y" straight from this
    // column. `foughtBoutCount` excludes byes and empty matches, so 100% stays
    // reachable once every real bout is confirmed.
    const foughtBouts = foughtBoutCount(graph);

    await tx
      .update(categories)
      .set({ expectedMatches: foughtBouts })
      .where(eq(categories.id, categoryId));

    return { drawId, matchCount: graph.matches.length, foughtBouts, version };
  });

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

  const matchCounts = await db
    .select({
      categoryId: matches.categoryId,
      confirmed: sql<number>`count(*) filter (where ${matches.status} = 'CONFIRMED')`,
      live: sql<number>`count(*) filter (where ${matches.status} = 'LIVE')`,
    })
    .from(matches)
    .where(inArray(matches.categoryId, catIds))
    .groupBy(matches.categoryId);

  const matchStatsByCat = new Map(
    matchCounts.map((m) => [
      m.categoryId,
      { confirmed: Number(m.confirmed ?? 0), live: Number(m.live ?? 0) },
    ])
  );

  let generatedCount = 0;
  let protectedCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];
  const protectedCategories: string[] = [];

  for (const cat of allCats) {
    const existingDraw = drawByCat.get(cat.id);
    const stats = matchStatsByCat.get(cat.id) || { confirmed: 0, live: 0 };
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
    } catch (err: any) {
      skippedCount++;
      errors.push(`Category "${cat.name}": ${err.message}`);
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

  const matchCounts = await db
    .select({
      categoryId: matches.categoryId,
      confirmed: sql<number>`count(*) filter (where ${matches.status} = 'CONFIRMED')`,
      live: sql<number>`count(*) filter (where ${matches.status} = 'LIVE')`,
      total: sql<number>`count(*)`,
    })
    .from(matches)
    .where(inArray(matches.categoryId, catIds))
    .groupBy(matches.categoryId);

  const matchStatsByCat = new Map(
    matchCounts.map((m) => [
      m.categoryId,
      {
        confirmed: Number(m.confirmed ?? 0),
        live: Number(m.live ?? 0),
        total: Number(m.total ?? 0),
      },
    ])
  );

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
