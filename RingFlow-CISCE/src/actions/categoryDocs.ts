"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { categories, categoryDocuments } from "@/db/schema";
import { requireTournamentAdmin } from "@/lib/auth/guards";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Lowercase, trim, collapse spaces, strip dots — for matching file names to categories. */
function normalize(str: string): string {
  return str.toLowerCase().trim().replace(/\s+/g, " ").replace(/\./g, "");
}

/** "U19_F_40 - 44 Kgs.pdf" → "U19_F_40 - 44 Kgs" */
function filenameToName(filename: string): string {
  return filename.replace(/\.pdf$/i, "").trim();
}

/** Exact normalized match first, then a contains match. */
function findMatch(
  candidateName: string,
  list: { id: string; name: string }[]
): { id: string; name: string } | null {
  const norm = normalize(candidateName);
  const exact = list.find((c) => normalize(c.name) === norm);
  if (exact) return exact;
  return list.find((c) => normalize(c.name).includes(norm) || norm.includes(normalize(c.name))) ?? null;
}

/** Stays under the server-action body limit in next.config.ts. */
const MAX_PDF_BYTES = 8 * 1024 * 1024;

export type PDFUploadResult = {
  matched: { filename: string; categoryName: string; categoryId: string; docUrl: string }[];
  unmatched: string[];
  errors: { filename: string; error: string }[];
};

function documentUrl(categoryId: string, version: number) {
  return `/api/category-docs/${categoryId}?v=${version}`;
}

// ─── Actions ────────────────────────────────────────────────────────────────

/**
 * Upload category athlete-list PDFs. Each file is named after its category
 * (e.g. "U19_F_40 - 44 Kgs.pdf") and matched by normalized name. Files are
 * stored in Postgres and served to staff only; re-uploading replaces the old one.
 */
export async function uploadCategoryPDFs(tournamentId: string, formData: FormData): Promise<PDFUploadResult> {
  await requireTournamentAdmin(tournamentId);

  const tournamentCategories = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.tournamentId, tournamentId));

  const files = formData.getAll("pdfs").filter((f): f is File => f instanceof File);
  const result: PDFUploadResult = { matched: [], unmatched: [], errors: [] };

  for (const file of files) {
    if (file.size === 0) continue;

    const matchedCategory = findMatch(filenameToName(file.name), tournamentCategories);
    if (!matchedCategory) {
      result.unmatched.push(file.name);
      continue;
    }
    if (file.size > MAX_PDF_BYTES) {
      result.errors.push({ filename: file.name, error: "File is larger than 8 MB." });
      continue;
    }

    try {
      const bytes = Buffer.from(await file.arrayBuffer());
      // Only real PDFs: they start with "%PDF-".
      if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
        result.errors.push({ filename: file.name, error: "Not a PDF file." });
        continue;
      }

      const row = {
        filename: file.name.slice(0, 200),
        contentType: "application/pdf",
        sizeBytes: bytes.length,
        content: bytes,
        uploadedAt: new Date(),
      };
      await db
        .insert(categoryDocuments)
        .values({ categoryId: matchedCategory.id, ...row })
        .onConflictDoUpdate({ target: categoryDocuments.categoryId, set: row });

      const docUrl = documentUrl(matchedCategory.id, Date.now());
      await db
        .update(categories)
        .set({ docUrl })
        .where(and(eq(categories.id, matchedCategory.id), eq(categories.tournamentId, tournamentId)));

      result.matched.push({
        filename: file.name,
        categoryName: matchedCategory.name,
        categoryId: matchedCategory.id,
        docUrl,
      });
    } catch (err) {
      result.errors.push({ filename: file.name, error: err instanceof Error ? err.message : "Upload failed" });
    }
  }

  revalidatePath(`/admin/event/${tournamentId}/categories`);
  return result;
}

/** Remove a category's PDF. */
export async function removeCategoryPDF(tournamentId: string, categoryId: string): Promise<void> {
  await requireTournamentAdmin(tournamentId);

  const [cat] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.tournamentId, tournamentId)))
    .limit(1);
  if (!cat) throw new Error("Category not found in this tournament");

  await db.delete(categoryDocuments).where(eq(categoryDocuments.categoryId, categoryId));
  await db.update(categories).set({ docUrl: null }).where(eq(categories.id, categoryId));

  revalidatePath(`/admin/event/${tournamentId}/categories`);
}
