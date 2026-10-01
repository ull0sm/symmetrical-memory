import React from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { rings, tournaments } from "@/db/schema";
import { getRingModerator, getTournamentStaff } from "@/lib/auth/guards";
import { isValidUuid } from "@/lib/utils";

/**
 * Who may open the arena screen:
 *  1. the moderator who holds this tatami,
 *  2. staff of this event (its admin, organisers),
 *  3. anyone, if the admin explicitly enabled the public TV screen for this event.
 * The data actions behind the screen apply the same rule.
 */
export default async function ScoreboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ ringId: string }>;
}) {
  const { ringId } = await params;
  if (!isValidUuid(ringId)) redirect("/login/mod");

  if (await getRingModerator(ringId)) return <>{children}</>;

  const [row] = await db
    .select({ tournamentId: rings.tournamentId, showPublicScoreboard: tournaments.showPublicScoreboard })
    .from(rings)
    .innerJoin(tournaments, eq(tournaments.id, rings.tournamentId))
    .where(eq(rings.id, ringId));

  if (!row) redirect("/login/mod");
  if (row.showPublicScoreboard) return <>{children}</>;
  if (await getTournamentStaff(row.tournamentId, ["admin", "organiser"])) return <>{children}</>;

  redirect("/login/mod");
}
