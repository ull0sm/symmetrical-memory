import React from "react";
import OrganiserHeader from "@/components/layout/OrganiserHeader";
import { redirect } from "next/navigation";
import CategoriesClient from "@/components/admin/CategoriesClient";
import { getTournamentStaff } from "@/lib/auth/guards";
import { db } from "@/db";
import { tournaments as tournamentsTable, categories as categoriesTable } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { serializeCategory } from "@/lib/serializers";
import { syncTournamentCategoryCounts, getActiveAthleteCounts } from "@/lib/categories/syncCounts";
import { tournamentTypeOf } from "@/lib/auth/localScope";
import { loadLocalSetup } from "@/lib/local/setupView";
import LocalCategoriesClient from "@/components/admin/local/LocalCategoriesClient";

export default async function OrganiserCategoriesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: tournamentId } = await params;

  // Organisers of this event, or its own admin previewing the organiser view.
  if (!(await getTournamentStaff(tournamentId, ["organiser", "admin"]))) {
    redirect("/");
  }

  // A Local tournament's categories, read only.
  if ((await tournamentTypeOf(tournamentId)) === "LOCAL") {
    const [setup, [t]] = await Promise.all([
      loadLocalSetup(tournamentId),
      db.select({ name: tournamentsTable.name }).from(tournamentsTable).where(eq(tournamentsTable.id, tournamentId)).limit(1),
    ]);
    return (
      <>
        <OrganiserHeader title="Categories" eventName={t?.name ?? ""} />
        <LocalCategoriesClient tournamentId={tournamentId} setup={setup} readOnly />
      </>
    );
  }

  // Ensure DB athletes_count is synchronized with active athletes
  await syncTournamentCategoryCounts(tournamentId);

  const [tournamentRows, catRows, activeCounts] = await Promise.all([
    db
      .select({ name: tournamentsTable.name })
      .from(tournamentsTable)
      .where(eq(tournamentsTable.id, tournamentId))
      .limit(1),
    db
      .select()
      .from(categoriesTable)
      .where(eq(categoriesTable.tournamentId, tournamentId))
      .orderBy(desc(categoriesTable.createdAt)),
    getActiveAthleteCounts(tournamentId),
  ]);

  const tournament = tournamentRows[0];
  if (!tournament) redirect("/");

  const categories = catRows.map((c) => {
    const realAthleteCount = activeCounts.get(c.id) ?? c.athletesCount ?? 0;
    return serializeCategory({
      ...c,
      athletesCount: realAthleteCount,
      expectedMatches: Math.max(0, realAthleteCount - 1),
    });
  });

  return (
    <>
      <OrganiserHeader title="Categories" eventName={tournament.name} />
      <CategoriesClient 
        tournamentId={tournamentId} 
        initialCategories={categories} 
        readOnly={true} 
      />
    </>
  );
}
