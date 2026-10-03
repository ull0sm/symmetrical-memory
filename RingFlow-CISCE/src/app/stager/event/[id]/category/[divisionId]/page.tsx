import React from "react";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { divisions, tournaments } from "@/db/schema";
import { describePrincipal, getTournamentStaff } from "@/lib/auth/guards";
import { isValidUuid } from "@/lib/utils";
import { getDivisionWorkspace, getStagerDesk } from "@/actions/staging";
import StagerTopBar from "@/components/stager/local/StagerTopBar";
import CategoryNotHeld from "@/components/stager/local/CategoryNotHeld";
import DivisionWorkspace from "@/components/stager/local/workspace/DivisionWorkspace";

export const dynamic = "force-dynamic";

/** A Local category's workspace on the stager desk: build and lock its groups while you hold it. */
export default async function StagerCategoryPage({ params }: { params: Promise<{ id: string; divisionId: string }> }) {
  const { id: tournamentId, divisionId } = await params;
  const staff = await getTournamentStaff(tournamentId, ["stager", "admin"]);
  if (!staff) redirect("/login/stager");
  if (!isValidUuid(divisionId)) notFound();

  const [division] = await db.select({ tournamentId: divisions.tournamentId }).from(divisions).where(eq(divisions.id, divisionId));
  if (!division || division.tournamentId !== tournamentId) notFound();
  const [tournament] = await db
    .select({ name: tournaments.name, type: tournaments.tournamentType })
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);
  if (!tournament || tournament.type !== "LOCAL") redirect(`/stager/event/${tournamentId}`);

  const deskHref = `/stager/event/${tournamentId}`;
  const workspace = await getDivisionWorkspace(divisionId);
  const shell = (title: string, body: React.ReactNode) => (
    <div className="min-h-screen bg-[var(--canvas)]">
      <StagerTopBar tournamentName={tournament.name} title={title} stagerName={describePrincipal(staff).name || "Stager"} back={{ href: deskHref, label: "Back to the desk" }} />
      {body}
    </div>
  );

  if (!workspace) {
    const desk = await getStagerDesk(tournamentId);
    const item = desk.items.find((i) => i.divisionId === divisionId);
    if (!item) notFound();
    return shell(item.name, <CategoryNotHeld item={item} deskHref={deskHref} canTake={desk.mine === null} />);
  }
  return shell(workspace.division.name, <DivisionWorkspace initial={workspace} homeHref={deskHref} viewer={staff.role === "admin" ? "admin" : "stager"} headerHeight={57} showName={false} />);
}
