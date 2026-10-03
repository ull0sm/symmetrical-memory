"use server";

import { audit } from "@/lib/audit";
import { requireTournamentStaff } from "@/lib/auth/guards";
import { generateDrawStatePdfBytes } from "@/lib/pdf/drawStatePdfGenerator";
import { buildTournamentDrawStates } from "@/lib/results/drawStates";
import {
  buildTournamentResults,
  medalTallyToCsv,
  podiumsToCsv,
  rowsToCsv,
  safeFilename,
  tallyFromPodiums,
} from "@/lib/results/resultsDataset";
import { tournamentPodiums } from "@/lib/results/podium";

/**
 * CSV of every bout plus the per-athlete totals. The BOM is what makes Excel
 * read the file as UTF-8 instead of mangling names.
 */
export async function exportTournamentResultsCsv(tournamentId: string) {
  const actor = await requireTournamentStaff(tournamentId, ["admin", "organiser"]);
  await audit({ tournamentId, actor, action: "RESULTS_EXPORTED", after: { format: "csv" } });

  const results = await buildTournamentResults(tournamentId);
  if (!results) return { success: false as const, error: "Tournament not found" };
  if (results.rows.length === 0) {
    return { success: false as const, error: "No draws have been generated for this event yet." };
  }

  const csv = rowsToCsv(results);

  return {
    success: true as const,
    filename: `${safeFilename(results.tournamentName)}_Results.csv`,
    base64: Buffer.from(csv, "utf-8").toString("base64"),
    boutCount: results.rows.length,
  };
}

/** Printable draw state per category: every bout, its points, and the winner. */
export async function exportTournamentResultsPdf(tournamentId: string) {
  const actor = await requireTournamentStaff(tournamentId, ["admin", "organiser"]);
  await audit({ tournamentId, actor, action: "RESULTS_EXPORTED", after: { format: "pdf" } });

  const results = await buildTournamentResults(tournamentId);
  if (!results) return { success: false as const, error: "Tournament not found" };

  const categories = await buildTournamentDrawStates(tournamentId);
  if (categories.length === 0) {
    return { success: false as const, error: "No draws have been generated for this event yet." };
  }

  const podiums = await tournamentPodiums(tournamentId);
  const boutCount = categories.reduce((total, category) => total + category.matches.length, 0);

  const bytes = await generateDrawStatePdfBytes({
    tournamentName: results.tournamentName,
    eventDate: results.eventDate,
    venue: results.venue,
    city: results.city,
    categories,
    podiums,
    tally: tallyFromPodiums(podiums),
    generatedAt: new Date(),
  });

  return {
    success: true as const,
    filename: `${safeFilename(results.tournamentName)}_Draw_State.pdf`,
    base64: Buffer.from(bytes).toString("base64"),
    boutCount,
  };
}

/** Medal winners per category or group (podiums.csv). Staff only; a group in progress shows as such. */
export async function exportTournamentPodiumsCsv(tournamentId: string) {
  const actor = await requireTournamentStaff(tournamentId, ["admin", "organiser"]);
  await audit({ tournamentId, actor, action: "RESULTS_EXPORTED", after: { format: "podiums-csv" } });

  const results = await buildTournamentResults(tournamentId);
  if (!results) return { success: false as const, error: "Tournament not found" };
  const podiums = await tournamentPodiums(tournamentId);
  if (podiums.length === 0) return { success: false as const, error: "No draws have been generated for this event yet." };

  return {
    success: true as const,
    filename: `${safeFilename(results.tournamentName)}_podiums.csv`,
    base64: Buffer.from(podiumsToCsv(podiums), "utf-8").toString("base64"),
  };
}

/** Medals per club (medal-tally.csv). Staff only. */
export async function exportTournamentMedalTallyCsv(tournamentId: string) {
  const actor = await requireTournamentStaff(tournamentId, ["admin", "organiser"]);
  await audit({ tournamentId, actor, action: "RESULTS_EXPORTED", after: { format: "medal-tally-csv" } });

  const results = await buildTournamentResults(tournamentId);
  if (!results) return { success: false as const, error: "Tournament not found" };
  const tally = tallyFromPodiums(await tournamentPodiums(tournamentId));

  return {
    success: true as const,
    filename: `${safeFilename(results.tournamentName)}_medal-tally.csv`,
    base64: Buffer.from(medalTallyToCsv(tally), "utf-8").toString("base64"),
  };
}
