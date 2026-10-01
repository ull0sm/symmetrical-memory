"use server";

import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";
import { requireTournamentAdmin } from "@/lib/auth/guards";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalize a string for fuzzy matching:
 * lowercase, trim, collapse multiple spaces, strip dots.
 */
function normalize(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\./g, "");
}

/**
 * Given a filename like "U19_F_40 - 44 Kgs.pdf", derive the candidate name:
 * strip the .pdf suffix, trim.
 */
function filenameToName(filename: string): string {
  return filename.replace(/\.pdf$/i, "").trim();
}

/**
 * Find the best matching category by name from a list.
 * First tries exact normalized match; falls back to includes.
 */
function findMatch(
  candidateName: string,
  categories: { id: string; name: string }[]
): { id: string; name: string } | null {
  const norm = normalize(candidateName);
  // Exact normalized match
  const exact = categories.find((c) => normalize(c.name) === norm);
  if (exact) return exact;
  // Contains match (less strict)
  const contains = categories.find(
    (c) => normalize(c.name).includes(norm) || norm.includes(normalize(c.name))
  );
  return contains ?? null;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type PDFUploadResult = {
  matched: {
    filename: string;
    categoryName: string;
    categoryId: string;
    docUrl: string;
  }[];
  unmatched: string[];
  errors: { filename: string; error: string }[];
};

// ─── Action ──────────────────────────────────────────────────────────────────

/**
 * Bulk-upload category athlete-list PDFs.
 *
 * Each file should be named exactly as the category name + ".pdf"
 * (e.g. "U19_F_40 - 44 Kgs.pdf"). We fuzzy-match by normalized name.
 *
 * - Files are uploaded to Supabase Storage bucket `category-docs`
 *   at path `{tournamentId}/{categoryId}.pdf`.
 * - The public URL is saved to `categories.doc_url`.
 * - Previously uploaded PDFs for the same category are silently replaced.
 */
export async function uploadCategoryPDFs(
  tournamentId: string,
  formData: FormData
): Promise<PDFUploadResult> {
  await requireTournamentAdmin(tournamentId);
  const supabase = await createClient();

  // 1. Verify tournament
  const { data: tournament } = await supabase
    .from("tournaments")
    .select("id")
    .eq("id", tournamentId)
    .single();
  if (!tournament) throw new Error("Tournament not found or unauthorized.");

  // 2. Fetch all categories for this tournament
  const { data: categories, error: catError } = await supabase
    .from("categories")
    .select("id, name")
    .eq("tournament_id", tournamentId);
  if (catError || !categories) throw new Error("Failed to fetch categories.");

  // 3. Process each uploaded PDF
  const files = formData.getAll("pdfs") as File[];
  const result: PDFUploadResult = { matched: [], unmatched: [], errors: [] };

  for (const file of files) {
    if (!file || file.size === 0) continue;

    const candidateName = filenameToName(file.name);
    const matchedCategory = findMatch(candidateName, categories);

    if (!matchedCategory) {
      result.unmatched.push(file.name);
      continue;
    }

    try {
      // Upload to Supabase Storage
      const storagePath = `${tournamentId}/${matchedCategory.id}.pdf`;
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      const { error: uploadError } = await supabase.storage
        .from("category-docs")
        .upload(storagePath, bytes, {
          contentType: "application/pdf",
          upsert: true, // Replace if exists
          cacheControl: "0",
        });

      if (uploadError) {
        result.errors.push({ filename: file.name, error: uploadError.message });
        continue;
      }

      // Get stable public URL with cache-busting timestamp
      const { data: urlData } = supabase.storage
        .from("category-docs")
        .getPublicUrl(storagePath);

      const docUrl = urlData?.publicUrl ? `${urlData.publicUrl}?t=${Date.now()}` : null;

      // Save URL back to categories row
      const { error: updateError } = await supabase
        .from("categories")
        .update({ doc_url: docUrl })
        .eq("id", matchedCategory.id);

      if (updateError) {
        result.errors.push({ filename: file.name, error: updateError.message });
        continue;
      }

      result.matched.push({
        filename: file.name,
        categoryName: matchedCategory.name,
        categoryId: matchedCategory.id,
        docUrl: docUrl ?? "",
      });
    } catch (err: any) {
      result.errors.push({
        filename: file.name,
        error: err?.message ?? "Unknown error",
      });
    }
  }

  revalidatePath(`/admin/event/${tournamentId}/categories`);
  return result;
}

/**
 * Remove a category's PDF (delete from storage + clear doc_url).
 */
export async function removeCategoryPDF(
  tournamentId: string,
  categoryId: string
): Promise<void> {
  await requireTournamentAdmin(tournamentId);
  const supabase = await createClient();

  const storagePath = `${tournamentId}/${categoryId}.pdf`;

  // Remove from storage (ignore error if not found)
  await supabase.storage.from("category-docs").remove([storagePath]);

  // Clear doc_url on category
  await supabase
    .from("categories")
    .update({ doc_url: null })
    .eq("id", categoryId);

  revalidatePath(`/admin/event/${tournamentId}/categories`);
}
