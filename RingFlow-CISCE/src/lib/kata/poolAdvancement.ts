import { db } from "@/db";
import { categories, categoryAssignments, matches, matchSlots } from "@/db/schema";
import { asc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { broadcastLiveEvent } from "@/lib/realtime/bus";

/**
 * No authorization here: called from the guarded kata/bout actions after a
 * result is committed.
 *
 * Calculates pool standings and advances top athletes into the Final Flight (Medal Matches).
 * Called automatically when Kata pool bouts are completed or scored.
 */
export async function advanceKataPoolFinalists(categoryId: string) {
  try {
    // 1. Fetch category and draw info
    const [cat] = await db
      .select()
      .from(categories)
      .where(eq(categories.id, categoryId))
      .limit(1);

    if (!cat) return { success: false, error: "Category not found" };

    // The number of bronze bouts is whatever the generated draw contains.
    // 2. Fetch all matches and match slots for this category
    const allMatches = await db
      .select()
      .from(matches)
      .where(eq(matches.categoryId, categoryId))
      .orderBy(asc(matches.matchNo));

    if (allMatches.length === 0) return { success: false, error: "No matches found" };

    const allSlots = await db
      .select()
      .from(matchSlots)
      .where(
        inArray(
          matchSlots.matchId,
          allMatches.map((m) => m.id)
        )
      );

    // 3. Separate pool matches from medal matches
    const isMedalMatch = (m: typeof allMatches[0]) => {
      if (
        m.poolGroup === "Pool A" ||
        m.poolGroup === "Pool B" ||
        m.bracketType === "POOL" ||
        Boolean(m.roundName?.startsWith("Pool A")) ||
        Boolean(m.roundName?.startsWith("Pool B"))
      ) {
        return false;
      }
      return (
        m.poolGroup === "Final Flight" ||
        m.bracketType === "BRONZE" ||
        Boolean(m.roundName?.toLowerCase().includes("bronze")) ||
        Boolean(m.roundName?.toLowerCase().includes("gold")) ||
        Boolean(m.roundName?.toLowerCase().includes("championship")) ||
        (m.bracketType === "MAIN" && Boolean(m.roundName?.toLowerCase().includes("final")))
      );
    };

    const poolMatches = allMatches.filter((m) => !isMedalMatch(m));
    const medalMatches = allMatches.filter((m) => isMedalMatch(m));

    if (poolMatches.length === 0 || medalMatches.length === 0) {
      return { success: false, error: "Pool or medal matches not configured" };
    }

    // 4. Calculate athlete scores across each pool
    const poolNames = Array.from(new Set(poolMatches.map((m) => m.poolGroup || "Pool A"))).sort();

    interface AthletePoolStat {
      athleteId: string;
      poolName: string;
      totalScore: number;
      hasScore: boolean;
      wins: number;
      flags: number;
    }

    const poolStandings: Record<string, AthletePoolStat[]> = {};

    poolNames.forEach((pName) => {
      poolStandings[pName] = [];
      const matchesInPool = poolMatches.filter((m) => (m.poolGroup || "Pool A") === pName);

      const athleteMap = new Map<string, AthletePoolStat>();

      matchesInPool.forEach((m) => {
        const slots = allSlots.filter((s) => s.matchId === m.id);
        const akaSlot = slots.find((s) => s.position === 1);
        const aoSlot = slots.find((s) => s.position === 2);

        const akaScore = parseFloat(m.akaScoreTotal || "0") || 0;
        const aoScore = parseFloat(m.aoScoreTotal || "0") || 0;
        // Only a confirmed bout counts; saved-but-unconfirmed marks are still a draft.
        const isCompleted = m.status === "CONFIRMED" || m.status === "COMPLETED";

        if (akaSlot?.athleteId) {
          if (!athleteMap.has(akaSlot.athleteId)) {
            athleteMap.set(akaSlot.athleteId, {
              athleteId: akaSlot.athleteId,
              poolName: pName,
              totalScore: 0,
              hasScore: false,
              wins: 0,
              flags: 0,
            });
          }
          const stat = athleteMap.get(akaSlot.athleteId)!;
          if (akaScore > 0) {
            stat.totalScore += akaScore;
            stat.hasScore = true;
          }
          if (m.akaFlags) stat.flags += m.akaFlags;
          if (isCompleted && (m.winnerSide === "AKA" || m.winnerId === akaSlot.athleteId)) {
            stat.wins += 1;
          }
        }

        if (aoSlot?.athleteId) {
          if (!athleteMap.has(aoSlot.athleteId)) {
            athleteMap.set(aoSlot.athleteId, {
              athleteId: aoSlot.athleteId,
              poolName: pName,
              totalScore: 0,
              hasScore: false,
              wins: 0,
              flags: 0,
            });
          }
          const stat = athleteMap.get(aoSlot.athleteId)!;
          if (aoScore > 0) {
            stat.totalScore += aoScore;
            stat.hasScore = true;
          }
          if (m.aoFlags) stat.flags += m.aoFlags;
          if (isCompleted && (m.winnerSide === "AO" || m.winnerId === aoSlot.athleteId)) {
            stat.wins += 1;
          }
        }
      });

      // Sort athletes in this pool:
      // In points mode: by totalScore desc, then wins desc
      // In flags mode: by wins desc, then flags desc, then totalScore desc
      const isPointsMode = cat.kataScoringMode === "POINTS" || matchesInPool[0]?.kataScoringMode === "POINTS";

      const sorted = Array.from(athleteMap.values()).sort((a, b) => {
        if (isPointsMode) {
          if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
          return b.wins - a.wins;
        } else {
          if (b.wins !== a.wins) return b.wins - a.wins;
          if (b.flags !== a.flags) return b.flags - a.flags;
          return b.totalScore - a.totalScore;
        }
      });

      poolStandings[pName] = sorted;
    });

    // Helper to check whether ALL matches in a pool are finished
    const isPoolComplete = (pName: string) => {
      const matchesInPool = poolMatches.filter((m) => (m.poolGroup || "Pool A") === pName);
      return (
        matchesInPool.length > 0 &&
        matchesInPool.every((m) => m.status === "CONFIRMED" || m.status === "COMPLETED")
      );
    };

    const isPoolAComplete = isPoolComplete("Pool A");
    const isPoolBComplete = poolNames.length > 1 ? isPoolComplete("Pool B") : true;

    // Only athletes from completed pools who actually have scored or won can advance
    const poolAQualified = isPoolAComplete
      ? (poolStandings["Pool A"] || []).filter((a) => a.hasScore || a.wins > 0)
      : [];
    const poolBQualified = isPoolBComplete
      ? (poolStandings["Pool B"] || []).filter((a) => a.hasScore || a.wins > 0)
      : [];

    // Helper to assign athlete to a match slot
    const assignSlot = async (matchId: string, position: number, athleteId: string | null): Promise<boolean> => {
      const existingSlot = allSlots.find((s) => s.matchId === matchId && s.position === position);
      if (existingSlot) {
        if (existingSlot.athleteId !== athleteId) {
          await db
            .update(matchSlots)
            .set({ athleteId })
            .where(eq(matchSlots.id, existingSlot.id));
          return true;
        }
        return false;
      } else {
        await db.insert(matchSlots).values({
          id: `${matchId}-s${position}`,
          matchId,
          position,
          slotType: "ENTRY",
          athleteId,
          sourceMatchId: null,
        });
        return true;
      }
    };

    // 5. Populate Medal Matches
    const goldMatch = medalMatches.find(
      (m) =>
        m.bracketType === "MAIN" ||
        m.roundName.includes("Final") ||
        m.roundName.includes("Gold") ||
        m.roundName.includes("Championship")
    );

    const bronzeMatches = medalMatches.filter(
      (m) =>
        m.bracketType === "BRONZE" ||
        (m.id !== goldMatch?.id && m.roundName.includes("Bronze"))
    );

    const updatedMatchIds: string[] = [];

    if (poolNames.length >= 2) {
      const a1 = poolAQualified[0]?.athleteId || null;
      const a2 = poolAQualified[1]?.athleteId || null;
      const a3 = poolAQualified[2]?.athleteId || null;

      const b1 = poolBQualified[0]?.athleteId || null;
      const b2 = poolBQualified[1]?.athleteId || null;
      const b3 = poolBQualified[2]?.athleteId || null;

      // 5a. Gold Match: Pool A #1 vs Pool B #1
      if (goldMatch) {
        const c1 = await assignSlot(goldMatch.id, 1, a1);
        const c2 = await assignSlot(goldMatch.id, 2, b1);
        let sc = false;
        if (a1 && b1) {
          if (goldMatch.status === "SCHEDULED") {
            await db.update(matches).set({ status: "READY" }).where(eq(matches.id, goldMatch.id));
            sc = true;
          }
        } else {
          if (goldMatch.status === "READY") {
            await db.update(matches).set({ status: "SCHEDULED" }).where(eq(matches.id, goldMatch.id));
            sc = true;
          }
        }
        if (c1 || c2 || sc) updatedMatchIds.push(goldMatch.id);
      }

      // 5b. Bronze Matches
      if (bronzeMatches.length === 1) {
        // Single Bronze: Pool A #2 vs Pool B #2
        const bm = bronzeMatches[0];
        if (bm) {
          const c1 = await assignSlot(bm.id, 1, a2);
          const c2 = await assignSlot(bm.id, 2, b2);
          let sc = false;
          if (a2 && b2) {
            if (bm.status === "SCHEDULED") {
              await db.update(matches).set({ status: "READY" }).where(eq(matches.id, bm.id));
              sc = true;
            }
          } else {
            if (bm.status === "READY") {
              await db.update(matches).set({ status: "SCHEDULED" }).where(eq(matches.id, bm.id));
              sc = true;
            }
          }
          if (c1 || c2 || sc) updatedMatchIds.push(bm.id);
        }
      } else if (bronzeMatches.length >= 2) {
        // Two Bronzes:
        // Bout 1: Pool A #2 vs Pool B #3
        // Bout 2: Pool B #2 vs Pool A #3
        const bm1 =
          bronzeMatches.find(
            (m) => m.roundName.includes("Pool A #2") || m.roundName.includes("Bout 1")
          ) || bronzeMatches[0];

        const bm2 =
          bronzeMatches.find(
            (m) => (m.roundName.includes("Pool B #2") || m.roundName.includes("Bout 2")) && m.id !== bm1?.id
          ) || bronzeMatches[1];

        if (bm1) {
          const c1 = await assignSlot(bm1.id, 1, a2);
          const c2 = await assignSlot(bm1.id, 2, b3);
          let sc = false;
          if (a2 && b3) {
            if (bm1.status === "SCHEDULED") {
              await db.update(matches).set({ status: "READY" }).where(eq(matches.id, bm1.id));
              sc = true;
            }
          } else {
            if (bm1.status === "READY") {
              await db.update(matches).set({ status: "SCHEDULED" }).where(eq(matches.id, bm1.id));
              sc = true;
            }
          }
          if (c1 || c2 || sc) updatedMatchIds.push(bm1.id);
        }

        if (bm2) {
          const c1 = await assignSlot(bm2.id, 1, b2);
          const c2 = await assignSlot(bm2.id, 2, a3);
          let sc = false;
          if (b2 && a3) {
            if (bm2.status === "SCHEDULED") {
              await db.update(matches).set({ status: "READY" }).where(eq(matches.id, bm2.id));
              sc = true;
            }
          } else {
            if (bm2.status === "READY") {
              await db.update(matches).set({ status: "SCHEDULED" }).where(eq(matches.id, bm2.id));
              sc = true;
            }
          }
          if (c1 || c2 || sc) updatedMatchIds.push(bm2.id);
        }
      }
    } else {
      // Single pool case
      const isSinglePoolComplete = isPoolComplete(poolNames[0]);
      const allSorted = isSinglePoolComplete
        ? (poolStandings[poolNames[0]] || []).filter((a) => a.hasScore || a.wins > 0)
        : [];
      const rank1 = allSorted[0]?.athleteId || null;
      const rank2 = allSorted[1]?.athleteId || null;
      const rank3 = allSorted[2]?.athleteId || null;
      const rank4 = allSorted[3]?.athleteId || null;

      if (goldMatch) {
        const c1 = await assignSlot(goldMatch.id, 1, rank1);
        const c2 = await assignSlot(goldMatch.id, 2, rank2);
        let sc = false;
        if (rank1 && rank2) {
          if (goldMatch.status === "SCHEDULED") {
            await db.update(matches).set({ status: "READY" }).where(eq(matches.id, goldMatch.id));
            sc = true;
          }
        } else {
          if (goldMatch.status === "READY") {
            await db.update(matches).set({ status: "SCHEDULED" }).where(eq(matches.id, goldMatch.id));
            sc = true;
          }
        }
        if (c1 || c2 || sc) updatedMatchIds.push(goldMatch.id);
      }

      if (bronzeMatches.length > 0) {
        const bm = bronzeMatches[0];
        const c1 = await assignSlot(bm.id, 1, rank3);
        const c2 = await assignSlot(bm.id, 2, rank4);
        let sc = false;
        if (rank3 && rank4) {
          if (bm.status === "SCHEDULED") {
            await db.update(matches).set({ status: "READY" }).where(eq(matches.id, bm.id));
            sc = true;
          }
        } else {
          if (bm.status === "READY") {
            await db.update(matches).set({ status: "SCHEDULED" }).where(eq(matches.id, bm.id));
            sc = true;
          }
        }
        if (c1 || c2 || sc) updatedMatchIds.push(bm.id);
      }
    }

    // 6. Broadcast SSE updates
    // The medal flight runs on the primary assignment's tatami (the finals tatami when the pools
    // are split); every tatami of the category refreshes its desk.
    const assignments = await db
      .select({ ringId: categoryAssignments.ringId, part: categoryAssignments.part })
      .from(categoryAssignments)
      .where(eq(categoryAssignments.categoryId, categoryId));

    const ringId = (assignments.find((a) => a.part === "ALL" || a.part === "FINALS") ?? assignments[0])?.ringId;

    for (const mId of updatedMatchIds) {
      broadcastLiveEvent({
        table: "matches",
        op: "UPDATE",
        id: mId,
        matchId: mId,
        ringId,
      });
    }

    for (const rId of new Set(assignments.map((a) => a.ringId))) {
      try {
        revalidatePath(`/moderator/ring/${rId}/current`);
        revalidatePath(`/scoreboard/${rId}`);
      } catch {}
    }

    return { success: true, updatedMatchIds, poolStandings };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error in advanceKataPoolFinalists";
    console.error("Error in advanceKataPoolFinalists:", err);
    return { success: false, error: errorMessage };
  }
}
