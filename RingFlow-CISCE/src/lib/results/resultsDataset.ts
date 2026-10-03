import { db } from "@/db";
import { athletes, categories, matchSlots, matches, tournaments } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import type { ResultRow } from "@/lib/pdf/resultsPdfGenerator";
import { getBoutOfficials } from "@/lib/results/officials";
import { buildMedalTally, type TallyRow } from "@/lib/results/medalTally";
import type { GroupPodium } from "@/lib/results/podium";

export interface TournamentResults {
  tournamentId: string;
  tournamentName: string;
  eventDate: string | null;
  venue: string | null;
  city: string | null;
  rows: ResultRow[];
  /** Every athlete who stepped on the mat, with the bouts they fought. */
  athleteTotals: {
    name: string;
    chestNumber: string | null;
    school: string | null;
    categoryName: string;
    bouts: number;
    wins: number;
    pointsFor: number;
    pointsAgainst: number;
  }[];
}

/**
 * Everything a governing body needs about what was conducted: one row per bout,
 * in draw order, with both athletes, the score line, the decision and the winner.
 *
 * Exported without an auth check so it can be exercised directly (see
 * scripts/verify-results-export.ts); the server actions below are the guarded
 * entry points.
 */
export async function buildTournamentResults(tournamentId: string): Promise<TournamentResults | null> {
  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId));

  if (!tournament) return null;

  const cats = await db
    .select()
    .from(categories)
    .where(eq(categories.tournamentId, tournamentId));

  if (cats.length === 0) {
    return {
      tournamentId,
      tournamentName: tournament.name,
      eventDate: tournament.eventDate,
      venue: tournament.venue,
      city: tournament.city,
      rows: [],
      athleteTotals: [],
    };
  }

  const categoryById = new Map(cats.map((c) => [c.id, c]));
  const categoryIds = cats.map((c) => c.id);

  const matchRows = await db
    .select()
    .from(matches)
    .where(inArray(matches.categoryId, categoryIds))
    .orderBy(matches.categoryId, matches.matchNo);

  const slots = matchRows.length
    ? await db
        .select()
        .from(matchSlots)
        .where(inArray(matchSlots.matchId, matchRows.map((m) => m.id)))
    : [];

  const athleteIds = Array.from(
    new Set(slots.map((s) => s.athleteId).filter((id): id is string => Boolean(id)))
  );
  const athleteRows = athleteIds.length
    ? await db.select().from(athletes).where(inArray(athletes.id, athleteIds))
    : [];
  const athleteById = new Map(athleteRows.map((a) => [a.id, a]));
  const officials = await getBoutOfficials(tournamentId);

  const slotsByMatch = new Map<string, typeof slots>();
  for (const slot of slots) {
    const list = slotsByMatch.get(slot.matchId) ?? [];
    list.push(slot);
    slotsByMatch.set(slot.matchId, list);
  }

  const rows: ResultRow[] = [];
  const totals = new Map<
    string,
    {
      name: string;
      chestNumber: string | null;
      school: string | null;
      categoryName: string;
      bouts: number;
      wins: number;
      pointsFor: number;
      pointsAgainst: number;
    }
  >();

  for (const match of matchRows) {
    const category = categoryById.get(match.categoryId);
    const matchSlotsForBout = slotsByMatch.get(match.id) ?? [];
    const aka = athleteById.get(
      matchSlotsForBout.find((s) => s.position === 1)?.athleteId ?? ""
    );
    const ao = athleteById.get(
      matchSlotsForBout.find((s) => s.position === 2)?.athleteId ?? ""
    );

    const winnerName =
      match.winnerId && match.winnerId === aka?.id
        ? aka?.name ?? null
        : match.winnerId && match.winnerId === ao?.id
          ? ao?.name ?? null
          : null;

    // Kata bouts carry their score in the judge totals, kumite in points.
    const isKataScore = match.akaScoreTotal !== null || match.aoScoreTotal !== null;
    const akaScore = isKataScore ? Number(match.akaScoreTotal ?? 0) : match.akaScore;
    const aoScore = isKataScore ? Number(match.aoScoreTotal ?? 0) : match.aoScore;
    const official = officials.get(match.id);

    rows.push({
      categoryName: category?.name ?? "Unknown category",
      roundName: match.roundName,
      matchNo: match.matchNo,
      bracketType: match.bracketType,
      status: match.status,
      akaName: aka?.name ?? "TBD",
      akaChest: aka?.chestNumber ?? null,
      akaSchool: aka?.school || aka?.dojo || null,
      akaScore,
      akaPenalties: match.akaPenalties,
      aoName: ao?.name ?? "TBD",
      aoChest: ao?.chestNumber ?? null,
      aoSchool: ao?.school || ao?.dojo || null,
      aoScore,
      aoPenalties: match.aoPenalties,
      senshu: match.senshu,
      winnerName,
      decisionMethod: match.decisionMethod,
      confirmedBy: official?.confirmedBy ?? null,
      corrections: official?.corrections ?? 0,
      correctionReason: official?.lastCorrectionReason ?? null,
    });

    // "Bouts played" means bouts actually contested and decided. A bracket slot
    // waiting on a winner is not a bout anyone has fought yet.
    const isPlayed = match.status === "CONFIRMED" && Boolean(aka && ao);

    if (isPlayed) {
      for (const side of ["AKA", "AO"] as const) {
        const fighter = side === "AKA" ? aka : ao;
        if (!fighter) continue;

        const entry = totals.get(fighter.id) ?? {
          name: fighter.name,
          chestNumber: fighter.chestNumber ?? null,
          school: fighter.school || fighter.dojo || null,
          categoryName: category?.name ?? "Unknown category",
          bouts: 0,
          wins: 0,
          pointsFor: 0,
          pointsAgainst: 0,
        };

        entry.bouts += 1;
        if (match.winnerId === fighter.id) entry.wins += 1;
        entry.pointsFor += side === "AKA" ? akaScore : aoScore;
        entry.pointsAgainst += side === "AKA" ? aoScore : akaScore;
        totals.set(fighter.id, entry);
      }
    }
  }

  return {
    tournamentId,
    tournamentName: tournament.name,
    eventDate: tournament.eventDate,
    venue: tournament.venue,
    city: tournament.city,
    rows,
    athleteTotals: Array.from(totals.values()).sort((a, b) =>
      a.categoryName === b.categoryName
        ? b.wins - a.wins || a.name.localeCompare(b.name)
        : a.categoryName.localeCompare(b.categoryName)
    ),
  };
}

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function safeFilename(input: string): string {
  return input.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 80);
}

/** RFC-4180 CSV for the same data, with a BOM so Excel opens it as UTF-8. */
export function rowsToCsv(results: TournamentResults): string {
  const header = [
    "Category",
    "Round",
    "Bout #",
    "Bracket",
    "Status",
    "AKA name",
    "AKA chest",
    "AKA school",
    "AKA score",
    "AKA warnings",
    "AO name",
    "AO chest",
    "AO school",
    "AO score",
    "AO warnings",
    "Senshu",
    "Winner",
    "Decision",
    "Confirmed by",
    "Corrections",
    "Correction reason",
  ];

  const lines = [header.join(",")];
  for (const row of results.rows) {
    lines.push(
      [
        row.categoryName,
        row.roundName,
        row.matchNo,
        row.bracketType,
        row.status,
        row.akaName,
        row.akaChest,
        row.akaSchool,
        row.akaScore,
        row.akaPenalties,
        row.aoName,
        row.aoChest,
        row.aoSchool,
        row.aoScore,
        row.aoPenalties,
        row.senshu,
        row.winnerName,
        row.decisionMethod,
        row.confirmedBy,
        row.corrections,
        row.correctionReason,
      ]
        .map(csvCell)
        .join(",")
    );
  }

  lines.push("");
  lines.push("Bouts fought per athlete");
  lines.push(["Athlete", "Chest", "School", "Category", "Bouts", "Wins", "Points for", "Points against"].join(","));
  for (const total of results.athleteTotals) {
    lines.push(
      [
        total.name,
        total.chestNumber,
        total.school,
        total.categoryName,
        total.bouts,
        total.wins,
        total.pointsFor,
        total.pointsAgainst,
      ]
        .map(csvCell)
        .join(",")
    );
  }

  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** The club medal tally of the podiums that stand; groups still in progress award nothing. */
export function tallyFromPodiums(podiums: readonly GroupPodium[]): TallyRow[] {
  return buildMedalTally(
    podiums
      .filter((p) => p.final)
      .flatMap((p) => p.places.map((x) => ({ athleteId: x.athleteId, name: x.name, club: x.club, medal: x.medal })))
  );
}

const MEDAL_NAME = { gold: "Gold", silver: "Silver", bronze: "Bronze" } as const;

/** One line per medal winner; a group still in progress has one line saying so. */
export function podiumsToCsv(podiums: readonly GroupPodium[]): string {
  const lines = [["Category", "Event", "Status", "Medal", "Athlete", "Chest", "Club", "Guest"].join(",")];
  for (const p of podiums) {
    const event = p.eventType === "kata" ? "Kata" : "Kumite";
    if (!p.final || p.places.length === 0) {
      lines.push([p.name, event, "In progress", "", "", "", "", ""].map(csvCell).join(","));
      continue;
    }
    for (const x of p.places) {
      lines.push(
        [p.name, event, "Final", MEDAL_NAME[x.medal], x.name, x.chestNumber, x.club ?? "Independent", x.guest ? "Yes" : ""]
          .map(csvCell)
          .join(",")
      );
    }
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function medalTallyToCsv(rows: readonly TallyRow[]): string {
  const lines = [["Rank", "Club", "Gold", "Silver", "Bronze", "Total"].join(",")];
  for (const r of rows) {
    lines.push(
      [r.rank, r.independent ? `${r.label} (Independent)` : r.label, r.gold, r.silver, r.bronze, r.total].map(csvCell).join(",")
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
