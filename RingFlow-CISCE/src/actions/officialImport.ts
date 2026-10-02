"use server";

import { revalidatePath } from "next/cache";
import { requireTournamentAdmin } from "@/lib/auth/guards";
import { officialRosterSchema, parseInput } from "@/lib/validation";
import {
  importOfficialRosterCore,
  type ImportResult,
  type RawImportAthlete,
} from "@/lib/roster/officialImport";

/** Admin imports the official roster (athletes + the events they entered). */
export async function importOfficialRoster(
  tournamentId: string,
  rawAthletes: RawImportAthlete[]
): Promise<ImportResult> {
  await requireTournamentAdmin(tournamentId);
  const result = await importOfficialRosterCore(tournamentId, parseInput(officialRosterSchema, rawAthletes, "roster"));
  try {
    revalidatePath(`/admin/event/${tournamentId}/athletes`);
    revalidatePath(`/admin/event/${tournamentId}/categories`);
  } catch {
    // Outside a revalidatable context.
  }
  return result;
}
