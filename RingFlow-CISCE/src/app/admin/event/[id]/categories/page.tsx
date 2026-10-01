import React from "react";
import AdminHeader from "@/components/layout/AdminHeader";
import { redirect } from "next/navigation";
import { ensureAdminOwnsTournament } from "@/actions/admin";
import CategoriesClient from "@/components/admin/CategoriesClient";
import { db } from "@/db";
import {
  tournaments as tournamentsTable,
  categories as categoriesTable,
  draws as drawsTable,
  matches as matchesTable,
} from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { serializeCategory } from "@/lib/serializers";
import { syncTournamentCategoryCounts, getActiveAthleteCounts } from "@/lib/categories/syncCounts";

export default async function AdminCategories({ params }: { params: Promise<{ id: string }> }) {
  const { id: tournamentId } = await params;
  try {
    await ensureAdminOwnsTournament(tournamentId);
  } catch {
    redirect("/admin");
  }

  // Ensure DB athletes_count and expected_matches are synchronized with active athletes
  await syncTournamentCategoryCounts(tournamentId);

  const [tournamentRows, catRows, drawRows, matchCounts, activeCounts] = await Promise.all([
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
    db
      .select({
        categoryId: drawsTable.categoryId,
        state: drawsTable.state,
        lockedAt: drawsTable.lockedAt,
        version: drawsTable.version,
      })
      .from(drawsTable)
      .innerJoin(categoriesTable, eq(drawsTable.categoryId, categoriesTable.id))
      .where(eq(categoriesTable.tournamentId, tournamentId)),
    db
      .select({
        categoryId: matchesTable.categoryId,
        confirmed: sql<number>`count(*) filter (where ${matchesTable.status} = 'CONFIRMED')`,
        live: sql<number>`count(*) filter (where ${matchesTable.status} = 'LIVE')`,
        total: sql<number>`count(*)`,
      })
      .from(matchesTable)
      .innerJoin(categoriesTable, eq(matchesTable.categoryId, categoriesTable.id))
      .where(eq(categoriesTable.tournamentId, tournamentId))
      .groupBy(matchesTable.categoryId),
    getActiveAthleteCounts(tournamentId),
  ]);

  const tournament = tournamentRows[0];
  if (!tournament) redirect("/admin");

  const drawMap = new Map(drawRows.map((d) => [d.categoryId, d]));
  const matchMap = new Map(matchCounts.map((m) => [m.categoryId, m]));

  const categories = catRows.map((c) => {
    const draw = drawMap.get(c.id);
    const matchStat = matchMap.get(c.id);
    const realAthleteCount = activeCounts.get(c.id) ?? c.athletesCount ?? 0;
    return serializeCategory({
      ...c,
      athletesCount: realAthleteCount,
      expectedMatches: Math.max(0, realAthleteCount - 1),
      hasDraw: Boolean(draw),
      drawState: draw?.state ?? null,
      drawVersion: draw?.version ?? null,
      confirmedMatches: Number(matchStat?.confirmed ?? 0),
      liveMatches: Number(matchStat?.live ?? 0),
      totalMatches: Number(matchStat?.total ?? 0),
    });
  });

  return (
    <>
      <AdminHeader title="Categories" eventName={tournament.name} />
      <CategoriesClient tournamentId={tournamentId} initialCategories={categories as any[]} />
    </>
  );
}
