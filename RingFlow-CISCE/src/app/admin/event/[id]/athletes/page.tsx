import React, { Suspense } from "react";
import AdminHeader from "@/components/layout/AdminHeader";
import { redirect } from "next/navigation";
import { requireTournamentAdmin } from "@/lib/auth/guards";
import AthletesClient from "@/components/admin/AthletesClient";
import { db } from "@/db";
import { tournaments as tournamentsTable, athletes as athletesTable, categories as categoriesTable } from "@/db/schema";
import { eq, desc, asc } from "drizzle-orm";
import { serializeAthlete } from "@/lib/serializers";
import { loadAthletePools } from "@/lib/draws/poolRosters";

export default async function AdminAthletes({ params }: { params: Promise<{ id: string }> }) {
  const { id: tournamentId } = await params;
  try {
    await requireTournamentAdmin(tournamentId);
  } catch {
    redirect("/admin");
  }

  const [tournamentRows, athleteRows, categoryRows] = await Promise.all([
    db
      .select({ name: tournamentsTable.name })
      .from(tournamentsTable)
      .where(eq(tournamentsTable.id, tournamentId))
      .limit(1),
    db
      .select()
      .from(athletesTable)
      .where(eq(athletesTable.tournamentId, tournamentId))
      .orderBy(desc(athletesTable.createdAt)),
    db
      .select({ id: categoriesTable.id, name: categoriesTable.name })
      .from(categoriesTable)
      .where(eq(categoriesTable.tournamentId, tournamentId))
      .orderBy(asc(categoriesTable.name)),
  ]);

  const tournament = tournamentRows[0];
  if (!tournament) redirect("/admin");

  const catMap = new Map<string, string>(categoryRows.map((c) => [c.id, c.name]));
  // Which pool each athlete is drawn into, for categories whose draw has pools.
  const poolOf = await loadAthletePools(tournamentId);
  const validAthletes = athleteRows.map((a) => {
    const pool = poolOf.get(a.id);
    return {
      ...serializeAthlete(a, a.categoryId ? catMap.get(a.categoryId) : null),
      pool: pool && pool.categoryId === a.categoryId ? { label: pool.label, tatami: pool.tatami } : null,
    };
  });

  return (
    <>
      <AdminHeader title="Athletes Roster" eventName={tournament.name} />
      <Suspense fallback={<div className="p-8 text-center text-[#64748B]">Loading roster...</div>}>
        <AthletesClient 
          tournamentId={tournamentId} 
          initialAthletes={validAthletes} 
          categories={categoryRows} 
        />
      </Suspense>
    </>
  );
}
