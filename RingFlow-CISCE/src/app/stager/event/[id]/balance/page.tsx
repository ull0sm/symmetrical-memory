import React from "react";
import { redirect } from "next/navigation";
import { getTournamentStaff } from "@/lib/auth/guards";
import StagerBalancingClient from "./StagerBalancingClient";
import { db } from "@/db";
import {
  tournaments as tournamentsTable,
  categories as categoriesTable,
  rings as ringsTable,
  categoryAssignments as categoryAssignmentsTable,
  eventLog as eventLogTable,
} from "@/db/schema";
import { eq, inArray, desc, asc, and } from "drizzle-orm";
import { healPartSizes } from "@/lib/draws/partRouting";
import { serializeRing, serializeCategory, serializeCategoryAssignment } from "@/lib/serializers";

export const dynamic = "force-dynamic";

export default async function StagerBalancePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: tournamentId } = await params;

  // Stagers of this event, or its own admin checking the call area.
  const stagerInfo = await getTournamentStaff(tournamentId, ["stager", "admin"]);
  if (!stagerInfo) {
    redirect("/login/stager");
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
    redirect("/login/stager");
  }
  // A Local tournament's stagers work at the desk; there is no calling board.
  if (tournament.tournamentType === "LOCAL") {
    redirect(`/stager/event/${tournamentId}`);
  }

  const ringIds = ringRows.map((r) => r.id);
  let assignments: any[] = [];
  const completedTimes: Record<string, string> = {};

  if (ringIds.length > 0) {
    await healPartSizes(ringIds, { recompute: true });
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

    assignments = rawAssignments.map((row) => serializeCategoryAssignment(row));

    finishLogs.forEach((log) => {
      if (log.categoryId && log.createdAt) {
        completedTimes[log.categoryId] = new Date(log.createdAt).toISOString();
      }
    });
  }

  return (
    <StagerBalancingClient
      tournamentId={tournamentId}
      tournamentName={tournament.name}
      stagerName={stagerInfo.name || "Stager"}
      initialCategories={catRows.map((row) => serializeCategory(row))}
      initialRings={ringRows.map((row) => serializeRing(row))}
      initialAssignments={assignments}
      completedTimes={completedTimes}
    />
  );
}
