import React from "react";
import ModeratorQueueClient from "@/components/moderator/ModeratorQueueClient";
import { db } from "@/db";
import {
  categoryAssignments as categoryAssignmentsTable,
  categories as categoriesTable,
} from "@/db/schema";
import { eq, inArray, and, asc } from "drizzle-orm";
import { serializeCategoryAssignment } from "@/lib/serializers";
import { redirect } from "next/navigation";
import { getRingModerator } from "@/lib/auth/guards";
import { localCardStages } from "@/lib/local/queueLabels";

export default async function ModeratorQueuePage({ params }: { params: Promise<{ id?: string; ringId: string }> }) {
  const { ringId } = await params;
  const moderator = await getRingModerator(ringId);
  if (!moderator) redirect("/login/mod");

  const rawAssignments = await db
    .select()
    .from(categoryAssignmentsTable)
    .where(
      and(
        eq(categoryAssignmentsTable.ringId, ringId),
        inArray(categoryAssignmentsTable.status, ["pending", "running", "paused"])
      )
    )
    .orderBy(asc(categoryAssignmentsTable.queueOrder));

  const categoryIds = Array.from(new Set(rawAssignments.map((a) => a.categoryId).filter(Boolean)));
  const catMap = new Map<string, any>();
  if (categoryIds.length > 0) {
    const cats = await db
      .select()
      .from(categoriesTable)
      .where(inArray(categoriesTable.id, categoryIds));
    cats.forEach((c) => catMap.set(c.id, c));
  }

  // A Local group says whether its stager has sent it yet.
  const stages = await localCardStages(categoryIds);
  const assignments = rawAssignments.map((a) => ({
    ...serializeCategoryAssignment(a, catMap.get(a.categoryId)),
    local_stage: stages.get(a.categoryId)?.stage ?? null,
    local_holder: stages.get(a.categoryId)?.holderName ?? null,
  }));

  return <ModeratorQueueClient ringId={ringId} tournamentId={moderator.tournamentId} initialAssignments={assignments} />;
}
