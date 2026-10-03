import { db } from "@/db";
import { athletes, categories, categoryEntries, draws, drawVersions, matches, matchSlots } from "@/db/schema";
import { resolveDraw, type Podium } from "@/engine/draw-engine/resolution";
import { computeDrawParts, poolNumber, rosterByPart, type DrawPart } from "@/engine/draw-engine/parts";
import type { DrawGraph } from "@/engine/draw-engine/types";
import { describePart } from "@/lib/draws/partFilter";
import { and, eq, inArray, sql } from "drizzle-orm";

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
  poolGroup?: string | null;
  /** Which pool (or the finals) of a draw with pools this bout belongs to; null when the draw has none. */
  part?: string | null;
  kataScoringMode?: string | null;
  status: string;
  slots?: BracketSlotView[];
  aka: {
    displayName: string;
    name?: string;
    school?: string;
    id?: string;
    chestNumber?: string | null;
    isBye?: boolean;
    isPending?: boolean;
    /** A Local admin's late placement from another category: marked "(guest)" in the display name. */
    guest?: boolean;
    sourceMatchNo?: number | null;
    /** For a place filled by another pool's winner: "Pool 2 winner". */
    sourceLabel?: string | null;
  };
  ao: {
    displayName: string;
    name?: string;
    school?: string;
    id?: string;
    chestNumber?: string | null;
    isBye?: boolean;
    isPending?: boolean;
    guest?: boolean;
    sourceMatchNo?: number | null;
    sourceLabel?: string | null;
  };
  winnerId?: string | null;
  /** The recorded result of the bout, so the draw can show the score line. */
  akaScore?: number;
  aoScore?: number;
  akaScoreTotal?: string | null;
  aoScoreTotal?: string | null;
  akaKataName?: string | null;
  aoKataName?: string | null;
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

/**
 * Podium for a kata pool flight, read from its confirmed medal bouts: the
 * final's winner and loser take gold and silver, bronze bout winners take bronze.
 */
function kataPoolPodium(
  dbMatches: (typeof matches.$inferSelect)[],
  dbSlots: (typeof matchSlots.$inferSelect)[]
): Podium | null {
  const decided = (m: typeof matches.$inferSelect) => m.status === "CONFIRMED" && Boolean(m.winnerId);
  const medal = dbMatches.filter((m) => m.poolGroup === "Final Flight" || m.bracketType === "BRONZE");
  const final = medal.find((m) => m.bracketType === "MAIN");
  if (!final || !decided(final)) return null;

  const finalSlots = dbSlots.filter((s) => s.matchId === final.id);
  const silver = finalSlots.map((s) => s.athleteId).find((id) => id && id !== final.winnerId) ?? null;
  const bronzes = medal
    .filter((m) => m.bracketType === "BRONZE" && decided(m))
    .map((m) => m.winnerId as string);

  return { goldRegistrationId: final.winnerId as string, silverRegistrationId: silver, bronzeRegistrationIds: bronzes };
}

/** A kata flight's pool tables, narrowed to one pool when a single pool is being shown. */
function flightDrawFor(graph: DrawGraph, part: string | null) {
  const flight = graph.flightDraw ?? null;
  const number = part ? poolNumber(part) : null;
  if (!flight || number === null) return flight;
  const named = [...flight.pools].sort((a, b) => (a.poolName < b.poolName ? -1 : a.poolName > b.poolName ? 1 : 0));
  const pool = named[number - 1];
  return pool ? { ...flight, pools: [pool] } : flight;
}

export async function assembleCategoryDraw(
  categoryId: string,
  options?: {
    athleteId?: string | null;
    /** The draw as drawn: no scores, winners or advancement from fought bouts. For the printed draw sheet. */
    ignoreResults?: boolean;
    /** The tournament's athletes, when the caller already has them (avoids a read per category). */
    athletes?: (typeof athletes.$inferSelect)[];
    /**
     * Show one part of a draw with pools: 'POOL:n' (that pool's bouts only) or 'FINALS' (the bouts
     * after the pools, with each pool winner named as "Pool n winner"). Ignored for a draw
     * without pools. Omitted: the whole draw.
     */
    part?: string | null;
  }
) {
  const useResults = !options?.ignoreResults;
  const [category] = await db
    .select({ name: categories.name, tournamentId: categories.tournamentId })
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
  const drawParts = computeDrawParts(graph);
  const partOfMatch = (matchId: string): DrawPart | null => drawParts?.byMatch.get(matchId) ?? null;
  const labelForSource = (sourceMatchId: string | null | undefined, matchId: string): string | null => {
    if (!sourceMatchId) return null;
    const sourcePart = partOfMatch(sourceMatchId);
    if (sourcePart === null || sourcePart === partOfMatch(matchId)) return null;
    const label = describePart(sourcePart);
    return label ? `${label} winner` : null;
  };

  // Fetch all db matches, slots, and events to resolve current state
  const storedMatches = await db
    .select()
    .from(matches)
    .where(eq(matches.categoryId, categoryId));

  // A draw-only view shows every bout as it stood before anyone fought.
  const dbMatches = useResults
    ? storedMatches
    : storedMatches.map((m) => ({
        ...m,
        status: "SCHEDULED",
        winnerId: null,
        winnerSide: null,
        akaScore: 0,
        aoScore: 0,
        akaScoreTotal: null,
        aoScoreTotal: null,
        akaPenalties: 0,
        aoPenalties: 0,
        senshu: null,
        decisionMethod: null,
        akaKataName: null,
        aoKataName: null,
      }));

  const storedSlots = await db
    .select()
    .from(matchSlots)
    .where(
      inArray(
        matchSlots.matchId,
        dbMatches.map((m) => m.id)
      )
    );

  // Later-round slots only hold athletes because earlier bouts were fought. That includes a kata
  // flight's medal bouts: their ENTRY slots are written from the pool standings.
  const medalMatchIds = new Set(dbMatches.filter((m) => m.poolGroup === "Final Flight").map((m) => m.id));
  const dbSlots = useResults
    ? storedSlots
    : storedSlots.map((s) =>
        (s.slotType === "ATHLETE" || s.slotType === "ENTRY") && !medalMatchIds.has(s.matchId) ? s : { ...s, athleteId: null }
      );

  // Athletes of this tournament only, for name mapping.
  const athleteList =
    options?.athletes ??
    (category ? await db.select().from(athletes).where(eq(athletes.tournamentId, category.tournamentId)) : []);
  const athleteMap = new Map(athleteList.map((a) => [a.id, a]));
  // Guests (Local) are marked wherever the draw is shown: bracket, moderator, public page and PDFs.
  const guestIds = new Set(
    (
      await db
        .select({ athleteId: categoryEntries.athleteId })
        .from(categoryEntries)
        .where(and(eq(categoryEntries.categoryId, categoryId), eq(categoryEntries.guest, true)))
    ).map((g) => g.athleteId)
  );
  const shown = (a: { id: string; name: string } | null | undefined, fallback: string) =>
    a ? (guestIds.has(a.id) ? `${a.name} (guest)` : a.name) : fallback;

  // Map outcomes if matches were completed
  const outcomes = new Map<string, { kind: 'WINNER'; side: 'AKA' | 'AO' }>();
  for (const m of dbMatches) {
    // Only a confirmed bout advances anyone; this matches what confirmation itself writes.
    if (m.winnerId && m.status === "CONFIRMED") {
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

  // The recorded rows carry the scores the draw sheet should display.
  const matchRowById = new Map(dbMatches.map((row) => [row.id, row]));

  // Build client-ready BracketMatch array
  const matchesMap: Record<string, BracketMatchView> = {};

  const isKataPools =
    draw.format === "KATA_GROUP_POOLS" ||
    Boolean(graph.flightDraw) ||
    dbMatches.some((m) => m.poolGroup);

  // A kata pool flight is not an elimination tree: its stored graph does not
  // describe the pool bouts, so it is never run through the bracket resolver.
  const resolved = isKataPools ? null : resolveDraw(graph, outcomes);
  const resolvedMatchMap = new Map((resolved?.matches ?? []).map((rm) => [rm.matchId, rm]));

  if (isKataPools && dbMatches.length > 0) {
    const sortedDbMatches = [...dbMatches].sort((a, b) => a.matchNo - b.matchNo);
    for (const m of sortedDbMatches) {
      const matchSlotsList = dbSlots.filter((s) => s.matchId === m.id);
      const akaSlot = matchSlotsList.find((s) => s.position === 1);
      const aoSlot = matchSlotsList.find((s) => s.position === 2);
      const akaAthlete = akaSlot?.athleteId ? athleteMap.get(akaSlot.athleteId) : null;
      const aoAthlete = aoSlot?.athleteId ? athleteMap.get(aoSlot.athleteId) : null;

      matchesMap[m.id] = {
        matchId: m.id,
        matchNo: m.matchNo,
        roundNo: m.roundNo,
        roundName: m.roundName,
        bracketType: m.bracketType || (m.poolGroup === "Final Flight" ? "MAIN" : "POOL"),
        poolGroup: m.poolGroup ?? undefined,
        kataScoringMode: m.kataScoringMode ?? undefined,
        status: m.status ?? "SCHEDULED",
        slots: matchSlotsList.map((s) => ({
          position: s.position,
          registrationId: s.athleteId,
          sourceMatchId: s.sourceMatchId,
        })),
        aka: {
          id: akaAthlete?.id,
          name: akaAthlete?.name ?? "TBD",
          displayName: shown(akaAthlete, "TBD"),
          guest: akaAthlete ? guestIds.has(akaAthlete.id) : false,
          school: akaAthlete?.school || akaAthlete?.dojo || undefined,
          chestNumber: akaAthlete?.chestNumber ?? null,
        },
        ao: {
          id: aoAthlete?.id,
          name: aoAthlete?.name ?? "TBD",
          displayName: shown(aoAthlete, "TBD"),
          guest: aoAthlete ? guestIds.has(aoAthlete.id) : false,
          school: aoAthlete?.school || aoAthlete?.dojo || undefined,
          chestNumber: aoAthlete?.chestNumber ?? null,
        },
        akaScore: m.akaScore ?? 0,
        aoScore: m.aoScore ?? 0,
        akaScoreTotal: m.akaScoreTotal ? String(m.akaScoreTotal) : null,
        aoScoreTotal: m.aoScoreTotal ? String(m.aoScoreTotal) : null,
        akaKataName: m.akaKataName ?? undefined,
        aoKataName: m.aoKataName ?? undefined,
        akaPenalties: m.akaPenalties ?? 0,
        aoPenalties: m.aoPenalties ?? 0,
        senshu: m.senshu ?? null,
        winnerSide: (m.winnerSide as 'AKA' | 'AO') ?? null,
        decisionMethod: m.decisionMethod ?? null,
        winnerId: m.winnerId ?? null,
        state: m.winnerId
          ? {
              points: { aka: m.akaScore ?? 0, ao: m.aoScore ?? 0 },
              winner: {
                side: (m.winnerSide as 'AKA' | 'AO') || 'AKA',
                method: m.decisionMethod || 'CONFIRMED',
              },
            }
          : null,
      };
    }
  } else {
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
      const akaSlot = resolvedMatch?.slots[0];
      const aoSlot = resolvedMatch?.slots[1];
      const akaDbSlot = matchSlotsList.find((s) => s.position === 1);
      const aoDbSlot = matchSlotsList.find((s) => s.position === 2);

      const akaRegId = akaSlot?.registrationId || akaDbSlot?.athleteId;
      const aoRegId = aoSlot?.registrationId || aoDbSlot?.athleteId;

      const akaAthlete = akaRegId ? athleteMap.get(akaRegId) : null;
      const aoAthlete = aoRegId ? athleteMap.get(aoRegId) : null;

      const isAkaBye =
        akaSlot?.source === "BYE" ||
        (!akaAthlete && m.roundNo === 0 && !akaDbSlot?.sourceMatchId && (resolvedMatch?.status === "WALKOVER" || !akaDbSlot?.athleteId));

      const isAoBye =
        aoSlot?.source === "BYE" ||
        (!aoAthlete && m.roundNo === 0 && !aoDbSlot?.sourceMatchId && (resolvedMatch?.status === "WALKOVER" || !aoDbSlot?.athleteId));

      const akaSourceId = akaSlot?.sourceMatchId || akaDbSlot?.sourceMatchId;
      const aoSourceId = aoSlot?.sourceMatchId || aoDbSlot?.sourceMatchId;

      const akaSourceMatchNo = akaSourceId ? graph.matches.find((gm) => gm.id === akaSourceId)?.matchNo ?? null : null;
      const aoSourceMatchNo = aoSourceId ? graph.matches.find((gm) => gm.id === aoSourceId)?.matchNo ?? null : null;

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
          name: akaAthlete?.name ?? (isAkaBye ? "BYE" : "TBD"),
          displayName: shown(akaAthlete, isAkaBye ? "BYE" : "TBD"),
          guest: akaAthlete ? guestIds.has(akaAthlete.id) : false,
          school: akaAthlete?.school || akaAthlete?.dojo || undefined,
          chestNumber: akaAthlete?.chestNumber ?? null,
          isBye: isAkaBye,
          isPending: !akaAthlete && !isAkaBye,
          sourceMatchNo: akaSourceMatchNo,
          sourceLabel: labelForSource(akaSourceId, m.id),
        },
        ao: {
          id: aoAthlete?.id,
          name: aoAthlete?.name ?? (isAoBye ? "BYE" : "TBD"),
          displayName: shown(aoAthlete, isAoBye ? "BYE" : "TBD"),
          guest: aoAthlete ? guestIds.has(aoAthlete.id) : false,
          school: aoAthlete?.school || aoAthlete?.dojo || undefined,
          chestNumber: aoAthlete?.chestNumber ?? null,
          isBye: isAoBye,
          isPending: !aoAthlete && !isAoBye,
          sourceMatchNo: aoSourceMatchNo,
          sourceLabel: labelForSource(aoSourceId, m.id),
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
  }

  // Category athletes for Kata pool and flight rendering
  let catAthletes = athleteList.filter((a) => a.categoryId === categoryId);

  // Every bout says which pool it belongs to, whether or not the admin has split the category.
  let viewMatches = Object.values(matchesMap).map((m) => ({ ...m, part: partOfMatch(m.matchId) }));

  // One pool, or the finals: only those bouts, and only the athletes in them.
  const wantedPart = drawParts && options?.part ? options.part : null;
  if (drawParts && wantedPart) {
    viewMatches = viewMatches.filter((m) => m.part === wantedPart);
    const present = new Set<string>();
    for (const m of viewMatches) {
      if (m.aka.id) present.add(m.aka.id);
      if (m.ao.id) present.add(m.ao.id);
    }
    for (const id of rosterByPart(graph, drawParts).get(wantedPart as DrawPart) ?? []) present.add(id);
    catAthletes = catAthletes.filter((a) => present.has(a.id));
  }

  // What the admin and the pool pages need: each pool, how many athletes it holds, and the finals.
  const roster = drawParts ? rosterByPart(graph, drawParts) : null;
  const partSummary = drawParts
    ? [
        ...Array.from({ length: drawParts.poolCount }, (_, i) => {
          const part = `POOL:${i + 1}` as DrawPart;
          return { part: part as string, label: describePart(part) ?? part, athletes: roster?.get(part)?.length ?? 0 };
        }),
        { part: "FINALS", label: "Finals", athletes: 0 },
      ]
    : [];

  return {
    locked: false,
    isDrawLocked: draw.state === "LOCKED",
    drawState: draw.state,
    draw,
    categoryName: category?.name ?? graph.categoryId,
    /** How this bracket was built: 0, 1 or 2 bronze medals. */
    bronzeMedals: draw.bronzeMedals ?? 2,
    matches: viewMatches,
    athletes: catAthletes,
    /** The part shown (null = the whole draw) and the parts that exist. */
    part: wantedPart,
    partSummary,
    // A pool's own view has no podium: medals are decided in the finals.
    podium:
      !useResults || (wantedPart !== null && wantedPart !== "FINALS")
        ? null
        : resolved
          ? resolved.podium
          : kataPoolPodium(dbMatches, dbSlots),
    highlightAthleteId: options?.athleteId ?? null,
    flightDraw: flightDrawFor(graph, wantedPart),
  };
}
