import React from "react";
import { redirect } from "next/navigation";
import RingBalancingClient from "@/app/admin/event/[id]/rings/balance/RingBalancingClient";
import { getTournamentStaff } from "@/lib/auth/guards";
import { db } from "@/db";
import {
  tournaments as tournamentsTable,
  categories as categoriesTable,
  rings as ringsTable,
  categoryAssignments as categoryAssignmentsTable,
  eventLog as eventLogTable,
} from "@/db/schema";
import { eq, inArray, desc, asc, and } from "drizzle-orm";
import { serializeRing, serializeCategory, serializeCategoryAssignment } from "@/lib/serializers";

export default async function OrganiserRingBalancingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: tournamentId } = await params;

  // Organisers of this event, or its own admin previewing the organiser view.
  if (!(await getTournamentStaff(tournamentId, ["organiser", "admin"]))) {
    redirect("/");
  }

  const [tournamentRows, catRows, ringRows] = await Promise.all([
    db
      .select()
      .from(tournamentsTable)
      .where(eq(tournamentsTable.id, tournamentId))
      .limit(1),
    db
      .select()
      .from(categoriesTable)
      .where(eq(categoriesTable.tournamentId, tournamentId))
      .orderBy(desc(categoriesTable.createdAt)),
    db
      .select()
      .from(ringsTable)
      .where(eq(ringsTable.tournamentId, tournamentId))
      .orderBy(asc(ringsTable.ringOrder)),
  ]);

  const tournament = tournamentRows[0];
  if (!tournament) {
    redirect("/");
  }

  const ringIds = ringRows.map((r) => r.id);
  let assignments: any[] = [];
  const completedTimes: Record<string, string> = {};

  if (ringIds.length > 0) {
    const [rawAssignments, finishLogs] = await Promise.all([
      db
        .select()
        .from(categoryAssignmentsTable)
        .where(inArray(categoryAssignmentsTable.ringId, ringIds)),
      db
        .select({
          categoryId: eventLogTable.categoryId,
          createdAt: eventLogTable.createdAt,
        })
        .from(eventLogTable)
        .where(
          and(
            eq(eventLogTable.action, "FINISH_CATEGORY"),
            inArray(eventLogTable.ringId, ringIds)
          )
        ),
    ]);

    assignments = rawAssignments.map(serializeCategoryAssignment);

    finishLogs.forEach((log) => {
      if (log.categoryId && log.createdAt) {
        completedTimes[log.categoryId] = new Date(log.createdAt).toISOString();
      }
    });
  }

  return (
    <RingBalancingClient 
      tournamentId={tournamentId}
      tournamentName={tournament.name}
      initialCategories={catRows.map(serializeCategory)}
      initialRings={ringRows.map(serializeRing)}
      initialAssignments={assignments}
      completedTimes={completedTimes}
      readOnly={true}
    />
  );
}
