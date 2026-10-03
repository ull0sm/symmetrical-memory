import React from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tournaments } from "@/db/schema";
import { describePrincipal, getTournamentStaff } from "@/lib/auth/guards";
import { getStagerDesk } from "@/actions/staging";
import BackNavigationGuard from "@/components/common/BackNavigationGuard";
import StagerTopBar from "@/components/stager/local/StagerTopBar";
import StagerDeskClient from "@/components/stager/local/StagerDeskClient";

export const dynamic = "force-dynamic";

/** The stager's home: the Local stager desk, or today's tatami board for an Official tournament. */
export default async function StagerEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; category?: string }>;
}) {
  const { id: tournamentId } = await params;
  const { notice, category } = await searchParams;

  const staff = await getTournamentStaff(tournamentId, ["stager", "admin"]);
  if (!staff) redirect("/login/stager");
  const [tournament] = await db
    .select({ name: tournaments.name, type: tournaments.tournamentType })
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);
  if (!tournament) redirect("/login/stager");
  if (tournament.type !== "LOCAL") redirect(`/stager/event/${tournamentId}/balance`);

  const desk = await getStagerDesk(tournamentId);
  // Only known messages, so a link can't put words on the desk.
  const name = desk.items.find((i) => i.divisionId === category)?.name ?? "That category";
  const message =
    notice === "sent"
      ? { tone: "ok" as const, text: `Every group of ${name} is sent. It has left your hands.` }
      : notice === "handed-back"
        ? { tone: "ok" as const, text: `${name} is handed back. Its groups stay as you left them.` }
        : notice === "lost"
          ? { tone: "warn" as const, text: `${name} isn't in your hands any more. The admin may have released it or handed it on.` }
          : null;

  return (
    <div className="min-h-screen bg-[var(--canvas)]">
      <BackNavigationGuard />
      <StagerTopBar tournamentName={tournament.name} title="Stager desk" stagerName={describePrincipal(staff).name || "Stager"} />
      <StagerDeskClient tournamentId={tournamentId} initialDesk={desk} notice={message} />
    </div>
  );
}
