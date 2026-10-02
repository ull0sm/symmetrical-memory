import React from "react";
import AdminHeader from "@/components/layout/AdminHeader";
import { redirect } from "next/navigation";
import { requireTournamentAdmin } from "@/lib/auth/guards";
import SettingsClient from "@/components/admin/SettingsClient";
import { db } from "@/db";
import { tournaments as tournamentsTable, organiserRequests as organiserRequestsTable } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { serializeTournamentForAdmin, serializeOrganiserRequest } from "@/lib/serializers";

export default async function AdminSettings({ params }: { params: Promise<{ id: string }> }) {
  const { id: tournamentId } = await params;
  try {
    await requireTournamentAdmin(tournamentId);
  } catch {
    redirect("/admin");
  }

  const [tournamentRows, requestRows] = await Promise.all([
    db
      .select()
      .from(tournamentsTable)
      .where(eq(tournamentsTable.id, tournamentId))
      .limit(1),
    db
      .select()
      .from(organiserRequestsTable)
      .where(eq(organiserRequestsTable.tournamentId, tournamentId))
      .orderBy(desc(organiserRequestsTable.createdAt)),
  ]);

  const tournament = tournamentRows[0];
  if (!tournament) redirect("/admin");

  return (
    <>
      <AdminHeader title="Settings" eventName={tournament.name} />
      <SettingsClient 
        tournament={serializeTournamentForAdmin(tournament)} 
        initialOrganiserRequests={requestRows.map((row) => serializeOrganiserRequest(row))} 
      />
    </>
  );
}
