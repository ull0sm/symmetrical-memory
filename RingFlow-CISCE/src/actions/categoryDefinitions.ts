"use server";

import { revalidatePath } from "next/cache";
import { requireTournamentAdmin, requireTournamentStaff } from "@/lib/auth/guards";
import type { CategoryDefinitionInput } from "@/lib/constants/categoryPresets";
import {
  readCategoryDefinitions,
  syncCategoriesFromDefinitionsCore,
  writeCategoryDefinitions,
  writePresetCategoryDefinitions,
} from "@/lib/roster/categoryDefinitions";

function revalidateCategories(tournamentId: string) {
  try {
    revalidatePath(`/admin/event/${tournamentId}/categories`);
  } catch {
    // Outside a revalidatable context.
  }
}

export async function getTournamentCategoryDefinitions(tournamentId: string) {
  await requireTournamentStaff(tournamentId, ["admin", "organiser"]);
  return readCategoryDefinitions(tournamentId);
}

export async function saveCategoryDefinitions(tournamentId: string, defs: CategoryDefinitionInput[]) {
  await requireTournamentAdmin(tournamentId);
  const res = await writeCategoryDefinitions(tournamentId, defs);
  revalidateCategories(tournamentId);
  return res;
}

export async function loadPresetCategoryDefinitions(tournamentId: string, presetKey: string) {
  await requireTournamentAdmin(tournamentId);
  const res = await writePresetCategoryDefinitions(tournamentId, presetKey);
  revalidateCategories(tournamentId);
  return res;
}

export async function syncCategoriesFromDefinitions(tournamentId: string) {
  await requireTournamentAdmin(tournamentId);
  await syncCategoriesFromDefinitionsCore(tournamentId);
  revalidateCategories(tournamentId);
  return { success: true };
}
