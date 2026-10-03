import React from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { tournaments } from "@/db/schema";
import { requireTournamentAdmin } from "@/lib/auth/guards";
import { getWalkInsToReview } from "@/actions/localAthletes";
import { getStagerDesk, listStagersForHolds } from "@/actions/staging";
import AdminHeader from "@/components/layout/AdminHeader";
import StagingOverviewClient from "@/components/admin/local/StagingOverviewClient";

export const dynamic = "force-dynamic";

/** A Local tournament's staging: which stager is preparing which category, the admin's hand on holds, and walk-ins to review. */
export default async function AdminStagingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: tournamentId } = await params;
  try {
    await requireTournamentAdmin(tournamentId);
  } catch {
    redirect("/admin");
  }
  const [t] = await db.select({ name: tournaments.name, type: tournaments.tournamentType }).from(tournaments).where(eq(tournaments.id, tournamentId)).limit(1);
  if (!t || t.type !== "LOCAL") redirect(`/admin/event/${tournamentId}/categories`);

  const [desk, stagers, walkIns] = await Promise.all([getStagerDesk(tournamentId), listStagersForHolds(tournamentId), getWalkInsToReview(tournamentId)]);
  return (
    <>
      <AdminHeader title="Staging" eventName={t.name} />
      <StagingOverviewClient tournamentId={tournamentId} initialDesk={desk} initialStagers={stagers} initialWalkIns={walkIns} />
    </>
  );
}
