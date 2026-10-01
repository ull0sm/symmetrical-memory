import React from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import AdminHeader from "@/components/layout/AdminHeader";
import OfficialRecordPage from "@/components/record/OfficialRecordPage";
import { db } from "@/db";
import { tournaments } from "@/db/schema";
import { getTournamentAdmin } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function AdminRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: tournamentId } = await params;
  if (!(await getTournamentAdmin(tournamentId))) redirect("/admin");

  const [tournament] = await db.select({ name: tournaments.name }).from(tournaments).where(eq(tournaments.id, tournamentId));
  if (!tournament) redirect("/admin");

  return (
    <>
      <AdminHeader title="Official Record" eventName={tournament.name} />
      <OfficialRecordPage tournamentId={tournamentId} />
    </>
  );
}
