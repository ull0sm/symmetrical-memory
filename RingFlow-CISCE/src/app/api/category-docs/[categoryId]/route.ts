import { eq } from "drizzle-orm";
import { db } from "@/db";
import { categoryDocuments } from "@/db/schema";
import { getTournamentStaff } from "@/lib/auth/guards";
import { tournamentIdForCategory } from "@/lib/auth/scope";
import { isValidUuid } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A category's athlete-list PDF. Internal staff document: only staff of the
 * category's own tournament can open it, and it is never cached by proxies.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ categoryId: string }> }) {
  const { categoryId } = await params;
  if (!isValidUuid(categoryId)) return new Response("Not found", { status: 404 });

  let tournamentId: string;
  try {
    tournamentId = await tournamentIdForCategory(categoryId);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!(await getTournamentStaff(tournamentId))) {
    return new Response("Forbidden", { status: 403 });
  }

  const [doc] = await db
    .select()
    .from(categoryDocuments)
    .where(eq(categoryDocuments.categoryId, categoryId))
    .limit(1);
  if (!doc) return new Response("Not found", { status: 404 });

  const safeName = doc.filename.replace(/[^\w.\- ]+/g, "_");
  return new Response(new Uint8Array(doc.content), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(doc.sizeBytes),
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
