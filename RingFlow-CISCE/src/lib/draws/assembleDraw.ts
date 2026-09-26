import { db } from "@/db";
import { athletes, categories, draws, drawVersions, matches, matchSlots } from "@/db/schema";
import { resolveDraw } from "@/engine/draw-engine/resolution";
import type { DrawGraph } from "@/engine/draw-engine/types";
import { eq, inArray, sql } from "drizzle-orm";

/**
 * One category's draw, assembled for display: every bout with its slots, the
 * recorded points, the resolved status and the winner, plus the podium.
 *
 * Deliberately request-free: the staff/public gate lives in the action that
 * calls this, so scripts and the results export can read a bracket without a
 * browser session.
 */
export interface BracketSlotView {
  position: number;
  registrationId: string | null;
  sourceMatchId: string | null;
}

export interface BracketMatchView {
  matchId: string;
  matchNo: number;
  roundNo: number;
  roundName: string;
  bracketType: string;
  status: string;
  slots?: BracketSlotView[];
  aka: { displayName: string; school?: string; id?: string; chestNumber?: string | null };
  ao: { displayName: string; school?: string; id?: string; chestNumber?: string | null };
  winnerId?: string | null;
  /** The recorded result of the bout, so the draw can show the score line. */
  akaScore?: number;
  aoScore?: number;
  akaPenalties?: number;
  aoPenalties?: number;
  senshu?: string | null;
  winnerSide?: string | null;
  decisionMethod?: string | null;
  state?: {
    points?: { aka: number; ao: number };
    winner?: { side: string; method: string };
  } | null;
}

export async function assembleCategoryDraw(
  categoryId: string,
  options?: { athleteId?: string | null }
) {
  const [category] = await db
    .select({ name: categories.name })
    .from(categories)
    .where(eq(categories.id, categoryId));

  const [draw] = await db
    .select()
    .from(draws)
    .where(eq(draws.categoryId, categoryId));

  if (!draw) return null;

  const [latestVersion] = await db
    .select()
    .from(drawVersions)
    .where(eq(drawVersions.drawId, draw.id))
    .orderBy(sql`${drawVersions.version} desc`)
    .limit(1);

  if (!latestVersion) return null;

  const graph = latestVersion.graph as unknown as DrawGraph;

  // Fetch all db matches, slots, and events to resolve current state
  const dbMatches = await db
    .select()
    .from(matches)
    .where(eq(matches.categoryId, categoryId));

  const dbSlots = await db
    .select()
    .from(matchSlots)
    .where(
      inArray(
        matchSlots.matchId,
        dbMatches.map((m) => m.id)
      )
    );

  // Fetch all athletes in this tournament for name mapping
  const athleteList = await db.select().from(athletes);
  const athleteMap = new Map(athleteList.map((a) => [a.id, a]));

  // Map outcomes if matches were completed
  const outcomes = new Map<string, { kind: 'WINNER'; side: 'AKA' | 'AO' }>();
  for (const m of dbMatches) {
    if (m.winnerId) {
      let side: 'AKA' | 'AO' = (m.winnerSide as 'AKA' | 'AO') || 'AKA';
      if (!m.winnerSide) {
        const matchSlotsList = dbSlots.filter((s) => s.matchId === m.id);
        const aka = matchSlotsList.find((s) => s.position === 1);
        side = m.winnerId === aka?.athleteId ? 'AKA' : 'AO';
      }
      outcomes.set(m.id, {
        kind: 'WINNER',
        side,
      });
    }
  }

  const resolved = resolveDraw(graph, outcomes);
  const resolvedMatchMap = new Map(resolved.matches.map((rm) => [rm.matchId, rm]));
  // The recorded rows carry the scores the draw sheet should display.
  const matchRowById = new Map(dbMatches.map((row) => [row.id, row]));

  // Build client-ready BracketMatch array
  const matchesMap: Record<string, BracketMatchView> = {};

  for (const m of graph.matches) {
    const resolvedMatch = resolvedMatchMap.get(m.id);
    const slotsForMatch = dbSlots
      .filter((s) => s.matchId === m.id)
      .map((s) => ({
        position: s.position,
        registrationId: s.athleteId,
        sourceMatchId: s.sourceMatchId,
      }));

    const matchSlotsList = dbSlots.filter((s) => s.matchId === m.id);
    const akaRegId =
      resolvedMatch?.slots[0]?.registrationId ||
      matchSlotsList.find((s) => s.position === 1)?.athleteId;
    const aoRegId =
      resolvedMatch?.slots[1]?.registrationId ||
      matchSlotsList.find((s) => s.position === 2)?.athleteId;

    const akaAthlete = akaRegId ? athleteMap.get(akaRegId) : null;
    const aoAthlete = aoRegId ? athleteMap.get(aoRegId) : null;

    const recorded = matchRowById.get(m.id);

    matchesMap[m.id] = {
      matchId: m.id,
      matchNo: m.matchNo,
      roundNo: m.roundNo,
      roundName: m.roundName,
      bracketType: m.bracketType,
      status: resolvedMatch?.status ?? "SCHEDULED",
      slots: slotsForMatch,
      aka: {
        id: akaAthlete?.id,
        displayName: akaAthlete?.name ?? "TBD",
        school: akaAthlete?.school || akaAthlete?.dojo || undefined,
        chestNumber: akaAthlete?.chestNumber ?? null,
      },
      ao: {
        id: aoAthlete?.id,
        displayName: aoAthlete?.name ?? "TBD",
        school: aoAthlete?.school || aoAthlete?.dojo || undefined,
        chestNumber: aoAthlete?.chestNumber ?? null,
      },
      akaScore: recorded?.akaScore ?? 0,
      aoScore: recorded?.aoScore ?? 0,
      akaPenalties: recorded?.akaPenalties ?? 0,
      aoPenalties: recorded?.aoPenalties ?? 0,
      senshu: recorded?.senshu ?? null,
      winnerSide: recorded?.winnerSide ?? null,
      decisionMethod: recorded?.decisionMethod ?? null,
      winnerId: resolvedMatch?.winnerRegistrationId ?? null,
      state: resolvedMatch?.winnerRegistrationId
        ? {
            points: { aka: recorded?.akaScore ?? 0, ao: recorded?.aoScore ?? 0 },
            winner: {
              side: resolvedMatch.winnerRegistrationId === akaRegId ? 'AKA' : 'AO',
              method: recorded?.decisionMethod || 'CONFIRMED',
            },
          }
        : null,
    };
  }

  // Category athletes for Kata pool and flight rendering
  const catAthletes = athleteList.filter((a) => a.categoryId === categoryId);

  return {
    locked: false,
    isDrawLocked: draw.state === "LOCKED",
    drawState: draw.state,
    draw,
    categoryName: category?.name ?? graph.categoryId,
    /** How this bracket was built: 0, 1 or 2 bronze medals. */
    bronzeMedals: draw.bronzeMedals ?? 2,
    matches: Object.values(matchesMap),
    athletes: catAthletes,
    podium: resolved.podium,
    highlightAthleteId: options?.athleteId ?? null,
    flightDraw: (graph as any)?.flightDraw ?? null,
  };
}
