import React from "react";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { divisions, tournaments } from "@/db/schema";
import { requireTournamentAdmin } from "@/lib/auth/guards";
import { isValidUuid } from "@/lib/utils";
import { getDivisionWorkspace } from "@/actions/staging";
import AdminHeader from "@/components/layout/AdminHeader";
import DivisionWorkspace from "@/components/stager/local/workspace/DivisionWorkspace";

export const dynamic = "force-dynamic";

/** One Local category's groups for the admin: read only, unless the admin takes the category. */
export default async function AdminStagingCategoryPage({ params }: { params: Promise<{ id: string; divisionId: string }> }) {
  const { id: tournamentId, divisionId } = await params;
  try {
    await requireTournamentAdmin(tournamentId);
  } catch {
    redirect("/admin");
  }
  if (!isValidUuid(divisionId)) notFound();
  const [division] = await db.select({ tournamentId: divisions.tournamentId }).from(divisions).where(eq(divisions.id, divisionId));
  if (!division || division.tournamentId !== tournamentId) notFound();
  const [t] = await db.select({ name: tournaments.name, type: tournaments.tournamentType }).from(tournaments).where(eq(tournaments.id, tournamentId)).limit(1);
  if (!t || t.type !== "LOCAL") redirect(`/admin/event/${tournamentId}/categories`);

  const workspace = await getDivisionWorkspace(divisionId);  if (!workspace) notFound();
  return (
    <>
      <AdminHeader title="Staging" eventName={t.name} />
      <div className="min-h-screen bg-[var(--canvas)] pb-10">
        <DivisionWorkspace initial={workspace} homeHref={`/admin/event/${tournamentId}/staging`} viewer="admin" headerHeight={61} />
      </div>
    </>
  );
}
