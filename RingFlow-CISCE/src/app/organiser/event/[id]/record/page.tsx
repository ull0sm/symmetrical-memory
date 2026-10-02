import React from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import OrganiserHeader from "@/components/layout/OrganiserHeader";
import OfficialRecordPage from "@/components/record/OfficialRecordPage";
import { db } from "@/db";
import { tournaments } from "@/db/schema";
import { getTournamentStaff } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function OrganiserRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: tournamentId } = await params;
  if (!(await getTournamentStaff(tournamentId, ["organiser", "admin"]))) redirect("/");

  const [tournament] = await db.select({ name: tournaments.name }).from(tournaments).where(eq(tournaments.id, tournamentId));
  if (!tournament) redirect("/");

  return (
    <>
      <OrganiserHeader title="Official Record" eventName={tournament.name} />
      <OfficialRecordPage tournamentId={tournamentId} />
    </>
  );
}
