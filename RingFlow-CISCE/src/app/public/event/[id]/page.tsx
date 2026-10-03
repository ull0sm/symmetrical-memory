import React from "react";
import { notFound } from "next/navigation";
import PublicEventClient from "@/components/public/PublicEventClient";
import { db } from "@/db";
import {
  tournaments as tournamentsTable,
  rings as ringsTable,
  categories as categoriesTable,
  categoryAssignments as categoryAssignmentsTable,
} from "@/db/schema";
import { eq, inArray, asc } from "drizzle-orm";
import {
  serializeTournament,
  serializeRing,
  serializeCategory,
  serializeCategoryAssignment,
} from "@/lib/serializers";
import { draftGroupIds, redactDraftGroup } from "@/lib/local/publicView";

export default async function PublicEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: tournamentId } = await params;

  // 1. Fetch tournament, rings, and categories in parallel
  const [tournamentRows, ringRows, catRows] = await Promise.all([
    db
      .select()
      .from(tournamentsTable)
      .where(eq(tournamentsTable.id, tournamentId))
      .limit(1),
    db
      .select()
      .from(ringsTable)
      .where(eq(ringsTable.tournamentId, tournamentId))
      .orderBy(asc(ringsTable.ringOrder)),
    db
      .select()
      .from(categoriesTable)
      .where(eq(categoriesTable.tournamentId, tournamentId)),
  ]);

  const tournament = tournamentRows[0];
  if (!tournament) return notFound();

  if (tournament.status === "draft") {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-xl">
          <div className="w-12 h-12 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white mb-2">{tournament.name}</h1>
          <p className="text-slate-400 text-sm mb-6">This tournament has not started yet. Please check back when the event begins.</p>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800 text-xs text-slate-300 font-medium">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            Status: Draft
          </div>
        </div>
      </div>
    );
  }

  const ringIds = ringRows.map((r) => r.id);
  let assignments: any[] = [];

  if (ringIds.length > 0) {
    const rawAssignments = await db
      .select()
      .from(categoryAssignmentsTable)
      .where(inArray(categoryAssignmentsTable.ringId, ringIds))
      .orderBy(asc(categoryAssignmentsTable.queueOrder));

    const catMap = new Map<string, any>(catRows.map((c) => [c.id, c]));
    // Stager names are staff details, not spectator information.
    assignments = rawAssignments.map(({ stagerName: _stagerName, ...a }) =>
      serializeCategoryAssignment(a, catMap.get(a.categoryId))
    );
  }

  // A Local group the stager hasn't locked shows by name only: "Being prepared".
  const draftGroups = await draftGroupIds(tournamentId);

  return (
    <PublicEventClient 
      tournament={serializeTournament(tournament)} 
      initialRings={ringRows.map((row) => serializeRing(row))} 
      initialAssignments={assignments} 
      categories={catRows.map((row) => {
        const serialized = serializeCategory(row);
        return draftGroups.has(row.id) ? redactDraftGroup(serialized) : serialized;
      })}
    />
  );
}
