"use server";

import { requireTournamentStaff } from "@/lib/auth/guards";
import { generateDrawStatePdfBytes } from "@/lib/pdf/drawStatePdfGenerator";
import { buildTournamentDrawStates } from "@/lib/results/drawStates";
import {
  buildTournamentResults,
  rowsToCsv,
  safeFilename,
} from "@/lib/results/resultsDataset";

/**
 * CSV of every bout plus the per-athlete totals. The BOM is what makes Excel
 * read the file as UTF-8 instead of mangling names.
 */
export async function exportTournamentResultsCsv(tournamentId: string) {
  await requireTournamentStaff(tournamentId, ["admin", "organiser"]);

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
  await requireTournamentStaff(tournamentId, ["admin", "organiser"]);

  const results = await buildTournamentResults(tournamentId);
  if (!results) return { success: false as const, error: "Tournament not found" };

  const categories = await buildTournamentDrawStates(tournamentId);
  if (categories.length === 0) {
    return { success: false as const, error: "No draws have been generated for this event yet." };
  }

  const boutCount = categories.reduce((total, category) => total + category.matches.length, 0);

  const bytes = await generateDrawStatePdfBytes({
    tournamentName: results.tournamentName,
    eventDate: results.eventDate,
    venue: results.venue,
    city: results.city,
    categories,
    generatedAt: new Date(),
  });

  return {
    success: true as const,
    filename: `${safeFilename(results.tournamentName)}_Draw_State.pdf`,
    base64: Buffer.from(bytes).toString("base64"),
    boutCount,
  };
}
