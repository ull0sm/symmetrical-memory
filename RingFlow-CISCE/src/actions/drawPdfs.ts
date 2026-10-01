"use server";

import { db } from "@/db";
import { categories } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireTournamentAdmin } from "@/lib/auth/guards";
import { buildAllCategoryDrawPdfs, buildCategoryDrawPdf } from "@/lib/pdf/drawSheetFiles";

/**
 * Draw sheets are confidential official tournament documents.
 * Per strict tournament security rules, ONLY the tournament Admin is allowed to download them.
 */
async function assertAdminForCategory(categoryId: string) {
  const [cat] = await db
    .select({ tournamentId: categories.tournamentId })
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!cat) throw new Error("Category not found");

  await requireTournamentAdmin(cat.tournamentId);
}

/** One category's official draw sheet, base64-encoded. STRICTLY ADMIN ONLY. */
export async function downloadCategoryDrawPdf(categoryId: string) {
  await assertAdminForCategory(categoryId);
  return buildCategoryDrawPdf(categoryId);
}

/** Every category's draw sheet in the tournament, zipped. STRICTLY ADMIN ONLY. */
export async function downloadAllCategoryDrawPdfs(tournamentId: string) {
  await requireTournamentAdmin(tournamentId);

  return buildAllCategoryDrawPdfs(tournamentId);
}
