import React from "react";
import AdminDashboardClient from "@/components/admin/AdminDashboardClient";
import { redirect } from "next/navigation";
import { requireTournamentAdmin } from "@/lib/auth/guards";
import { getTournamentActiveBouts } from "@/actions/matches";
import { db } from "@/db";
import {
  tournaments as tournamentsTable,
  categories as categoriesTable,
  rings as ringsTable,
  categoryAssignments as categoryAssignmentsTable,
  moderatorRequests as moderatorRequestsTable,
  eventLog as eventLogTable,
} from "@/db/schema";
import { eq, inArray, desc, asc, count } from "drizzle-orm";
import {
  serializeTournament,
  serializeRing,
  serializeCategoryAssignment,
  serializeModRequest,
  serializeEventLog,
} from "@/lib/serializers";

export default async function AdminDashboard({ params }: { params: Promise<{ id: string }> }) {
  const { id: tournamentId } = await params;
  try {
    await requireTournamentAdmin(tournamentId);
  } catch {
    redirect("/admin");
  }

  // 1. Fetch Tournament
  const [tournamentRow] = await db
    .select()
    .from(tournamentsTable)
    .where(eq(tournamentsTable.id, tournamentId))
    .limit(1);

  if (!tournamentRow) {
    redirect("/admin");
  }

  // 2. Fetch Categories count, Rings, and Logs in parallel via Drizzle
  const [catCountRes, ringRows, logRows] = await Promise.all([
    db
      .select({ value: count() })
      .from(categoriesTable)
      .where(eq(categoriesTable.tournamentId, tournamentId)),
    db
      .select()
      .from(ringsTable)
      .where(eq(ringsTable.tournamentId, tournamentId))
      .orderBy(asc(ringsTable.ringOrder)),
    db
      .select()
      .from(eventLogTable)
      .where(eq(eventLogTable.tournamentId, tournamentId))
      .orderBy(desc(eventLogTable.createdAt))
      .limit(200),
  ]);

  const categoryCount = catCountRes[0]?.value ?? 0;
  const ringIds = ringRows.map((r) => r.id);

  // 3. Category assignments and mod requests
  let assignments: any[] = [];
  let modRequests: any[] = [];

  if (ringIds.length > 0) {
    const [rawAssignments, rawModRequests] = await Promise.all([
      db
        .select()
        .from(categoryAssignmentsTable)
        .where(inArray(categoryAssignmentsTable.ringId, ringIds))
        .orderBy(asc(categoryAssignmentsTable.queueOrder)),
      db
        .select()
        .from(moderatorRequestsTable)
        .where(inArray(moderatorRequestsTable.ringId, ringIds))
        .orderBy(desc(moderatorRequestsTable.createdAt))
        .limit(20),
    ]);

    // Fetch categories for assignments in one batch
    const categoryIds = Array.from(new Set(rawAssignments.map((a) => a.categoryId).filter(Boolean)));
    const catMap = new Map<string, any>();
    if (categoryIds.length > 0) {
      const cats = await db
        .select()
        .from(categoriesTable)
        .where(inArray(categoriesTable.id, categoryIds));
      cats.forEach((c) => catMap.set(c.id, c));
    }

    const ringMap = new Map<string, any>(ringRows.map((r) => [r.id, r]));

    assignments = rawAssignments.map((a) =>
      serializeCategoryAssignment(a, catMap.get(a.categoryId))
    );
    modRequests = rawModRequests.map((mr) =>
      serializeModRequest(mr, ringMap.get(mr.ringId))
    );
  }

  // Who is fighting whom on each mat, so the floor view names the bout
  const initialActiveBouts = await getTournamentActiveBouts(tournamentId).catch((err) => {
    console.error("[dashboard] live bout lookup failed:", err);
    return {};
  });

  return (
    <AdminDashboardClient 
      tournament={serializeTournament(tournamentRow)}
      categoryCount={categoryCount}
      initialRings={ringRows.map((row) => serializeRing(row))}
      initialAssignments={assignments}
      initialModRequests={modRequests}
      initialLogs={logRows.map((row) => serializeEventLog(row))}
      initialActiveBouts={initialActiveBouts}
    />
  );
}
