/**
 * The podium of a category or Local group, read from what was fought or performed.
 * No authorization here: callers check who may see it (staff always, the public only
 * when public results are on, and a draft group never).
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { athletes, categories, categoryEntries, draws } from "@/db/schema";
import { assembleCategoryDraw } from "@/lib/draws/assembleDraw";
import { loadRankedStandings } from "@/lib/kata/rankedGroup";
import type { Medal } from "@/lib/kata/ranking";

export interface PodiumPlace {
  athleteId: string;
  name: string;
  club: string | null;
  chestNumber: string | null;
  medal: Medal;
  /** An admin's late placement from another category (Local). */
  guest: boolean;
}

export interface GroupPodium {
  categoryId: string;
  name: string;
  eventType: string;
  /** The medals stand; until then the group is "In progress". */
  final: boolean;
  places: PodiumPlace[];
}

/** Gold, silver and bronze for each id, in medal order; athletes unknown to the tournament are dropped. */
async function placesFor(
  categoryId: string,
  medals: { athleteId: string; medal: Medal }[]
): Promise<PodiumPlace[]> {
  if (medals.length === 0) return [];
  const ids = medals.map((m) => m.athleteId);
  const [people, entries] = await Promise.all([
    db
      .select({ id: athletes.id, name: athletes.name, school: athletes.school, dojo: athletes.dojo, chestNumber: athletes.chestNumber })
      .from(athletes)
      .where(inArray(athletes.id, ids)),
    db
      .select({ athleteId: categoryEntries.athleteId, guest: categoryEntries.guest })
      .from(categoryEntries)
      .where(and(eq(categoryEntries.categoryId, categoryId), inArray(categoryEntries.athleteId, ids))),
  ]);
  const person = new Map(people.map((p) => [p.id, p]));
  const guest = new Map(entries.map((e) => [e.athleteId, e.guest]));
  return medals.flatMap((m) => {
    const p = person.get(m.athleteId);
    if (!p) return [];
    return [
      {
        athleteId: p.id,
        name: p.name,
        club: p.school || p.dojo || null,
        chestNumber: p.chestNumber ?? null,
        medal: m.medal,
        guest: guest.get(p.id) === true,
      },
    ];
  });
}

/** The podium of one category (or group), or null if it doesn't exist. */
export async function podiumFor(categoryId: string): Promise<GroupPodium | null> {
  const [cat] = await db
    .select({ id: categories.id, name: categories.name, eventType: categories.eventType, format: categories.kataFormat })
    .from(categories)
    .where(eq(categories.id, categoryId));
  if (!cat) return null;
  const base = { categoryId, name: cat.name, eventType: cat.eventType };

  if (cat.format === "RANKED") {
    const standings = await loadRankedStandings(categoryId);
    // Medals are shown only once the whole podium stands, so an open tie never reads as a result.
    if (!standings || !standings.final) return { ...base, final: false, places: [] };
    const medals = standings.standings.flatMap((s) => (s.medal ? [{ athleteId: s.athleteId, medal: s.medal }] : []));
    return { ...base, final: true, places: await placesFor(categoryId, medals) };
  }

  const [draw] = await db.select({ id: draws.id }).from(draws).where(eq(draws.categoryId, categoryId));
  if (!draw) return { ...base, final: false, places: [] };
  const view = await assembleCategoryDraw(categoryId);
  const podium = view?.podium;
  if (!podium) return { ...base, final: false, places: [] };
  const medals: { athleteId: string; medal: Medal }[] = [
    { athleteId: podium.goldRegistrationId, medal: "gold" },
    ...(podium.silverRegistrationId ? [{ athleteId: podium.silverRegistrationId, medal: "silver" as const }] : []),
    ...podium.bronzeRegistrationIds.map((athleteId) => ({ athleteId, medal: "bronze" as const })),
  ];
  return { ...base, final: true, places: await placesFor(categoryId, medals) };
}

/**
 * Every category's podium for a tournament, in name order. A Local group still being prepared
 * (its draw is a draft, or it has none) is left out: it has nothing to show.
 */
export async function tournamentPodiums(tournamentId: string): Promise<GroupPodium[]> {
  const rows = await db
    .select({ id: categories.id, name: categories.name, drawState: draws.state, groupNo: categories.groupNo })
    .from(categories)
    .leftJoin(draws, eq(draws.categoryId, categories.id))
    .where(eq(categories.tournamentId, tournamentId));
  const ordered = [...rows].sort((a, b) => a.name.localeCompare(b.name));
  const out: GroupPodium[] = [];
  for (const row of ordered) {
    // A Local group counts only once the stager has locked it; an Official category once it is drawn.
    if (!row.drawState || (row.groupNo !== null && row.drawState !== "LOCKED")) continue;
    try {
      const p = await podiumFor(row.id);
      if (p) out.push(p);
    } catch (err) {
      console.error(`[results] could not read the podium for ${row.name}:`, err);
    }
  }
  return out;
}
