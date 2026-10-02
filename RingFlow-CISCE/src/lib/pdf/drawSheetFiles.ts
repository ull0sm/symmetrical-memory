import { db } from "@/db";
import { athletes, categories, tournaments } from "@/db/schema";
import { assembleCategoryDraw } from "@/lib/draws/assembleDraw";
import { resolveDrawRules } from "@/lib/draws/drawRules";
import { generateCategoryDrawPdfBytes } from "@/lib/pdf/drawPdfGenerator";
import { eq } from "drizzle-orm";
import JSZip from "jszip";

/**
 * The database work behind the draw-sheet downloads, with no request context:
 * the admin/organiser/stager actions guard it, and scripts (seeding,
 * verification) can call it directly. Never expose these to the client.
 */

function profileOf(
  cat: { drawProfile: string | null },
  tournament: { drawProfile: string } | undefined
) {
  return resolveDrawRules({ tournamentProfile: tournament?.drawProfile, categoryProfile: cat.drawProfile }).profile;
}

/** One category's draw sheet (draw only, no results), base64-encoded for download. */
export async function buildCategoryDrawPdf(categoryId: string) {
  const [cat] = await db
    .select()
    .from(categories)
    .where(eq(categories.id, categoryId));

  if (!cat) throw new Error("Category not found");

  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, cat.tournamentId));

  const drawData = await assembleCategoryDraw(categoryId, { ignoreResults: true });
  if (!drawData || !drawData.draw) {
    throw new Error("No draw has been generated for this category yet.");
  }

  const pdfBytes = await generateCategoryDrawPdfBytes({
    tournamentName: tournament?.name || "Tournament Championship",
    categoryName: cat.name,
    eventDate: tournament?.eventDate,
    venue: tournament?.venue,
    tournamentSize: drawData.draw.tournamentSize,
    byeCount: drawData.draw.byeCount,
    bronzeMedals: drawData.bronzeMedals,
    drawState: drawData.drawState,
    profile: profileOf(cat, tournament),
    podium: drawData.podium,
    athletes: drawData.athletes,
    matches: drawData.matches,
  });

  return {
    success: true as const,
    filename: `${cat.name.replace(/[^a-zA-Z0-9_\-]/g, "_")}_Draw.pdf`,
    base64: Buffer.from(pdfBytes).toString("base64"),
  };
}

/** Every category's draw sheet in the tournament, zipped. */
export async function buildAllCategoryDrawPdfs(tournamentId: string) {
  const [tournament] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId));

  if (!tournament) throw new Error("Tournament not found");

  const allCats = await db
    .select()
    .from(categories)
    .where(eq(categories.tournamentId, tournamentId));

  // One read of the tournament's athletes for every sheet, not one per category.
  const tournamentAthletes = await db.select().from(athletes).where(eq(athletes.tournamentId, tournamentId));

  const zip = new JSZip();
  let includedCount = 0;

  for (const cat of allCats) {
    try {
      const drawData = await assembleCategoryDraw(cat.id, { ignoreResults: true, athletes: tournamentAthletes });
      if (!drawData || !drawData.draw || drawData.matches.length === 0) continue;

      const pdfBytes = await generateCategoryDrawPdfBytes({
        tournamentName: tournament.name,
        categoryName: cat.name,
        eventDate: tournament.eventDate,
        venue: tournament.venue,
        tournamentSize: drawData.draw.tournamentSize,
        byeCount: drawData.draw.byeCount,
        bronzeMedals: drawData.bronzeMedals,
        drawState: drawData.drawState,
        profile: profileOf(cat, tournament),
        podium: drawData.podium,
        athletes: drawData.athletes,
        matches: drawData.matches,
      });

      zip.file(`${cat.name.replace(/[^a-zA-Z0-9_\-]/g, "_")}_Draw.pdf`, pdfBytes);
      includedCount++;
    } catch (err) {
      console.error(`Error generating PDF for category ${cat.name}:`, err);
    }
  }

  if (includedCount === 0) {
    return {
      success: false as const,
      error: "No generated draws found in this tournament. Please generate draws first.",
    };
  }

  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

  return {
    success: true as const,
    filename: `${tournament.name.replace(/[^a-zA-Z0-9_\-]/g, "_")}_All_Draws.zip`,
    base64: zipBuffer.toString("base64"),
    includedCount,
  };
}
