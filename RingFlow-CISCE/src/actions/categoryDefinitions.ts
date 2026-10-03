"use server";

import { audit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { requireTournamentAdmin, requireTournamentStaff, requireOfficialTournament } from "@/lib/auth/guards";
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
  const admin = await requireTournamentAdmin(tournamentId);
  await requireOfficialTournament(tournamentId);
  const res = await writeCategoryDefinitions(tournamentId, defs);
  await audit({ tournamentId, actor: admin, action: "CATEGORY_DEFINITIONS_SAVED", after: { count: defs.length } });
  revalidateCategories(tournamentId);
  return res;
}

export async function loadPresetCategoryDefinitions(tournamentId: string, presetKey: string) {
  const admin = await requireTournamentAdmin(tournamentId);
  await requireOfficialTournament(tournamentId);
  const res = await writePresetCategoryDefinitions(tournamentId, presetKey);
  await audit({ tournamentId, actor: admin, action: "CATEGORY_DEFINITIONS_SAVED", after: { preset: presetKey } });
  revalidateCategories(tournamentId);
  return res;
}

export async function syncCategoriesFromDefinitions(tournamentId: string) {
  await requireTournamentAdmin(tournamentId);
  await requireOfficialTournament(tournamentId);
  await syncCategoriesFromDefinitionsCore(tournamentId);
  revalidateCategories(tournamentId);
  return { success: true };
}
