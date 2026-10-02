import React from "react";
import AdminHeader from "@/components/layout/AdminHeader";
import { redirect } from "next/navigation";
import { requireTournamentAdmin } from "@/lib/auth/guards";
import RingsClient from "@/components/admin/RingsClient";
import { db } from "@/db";
import { tournaments, rings, moderatorRequests, stagerRequests } from "@/db/schema";
import { eq, and, inArray, desc, asc } from "drizzle-orm";

export default async function AdminRings({ params }: { params: Promise<{ id: string }> }) {
  const { id: tournamentId } = await params;
  try {
    await requireTournamentAdmin(tournamentId);
  } catch (err) {
    console.error("ensureAdminOwnsTournament failed on rings page:", err);
    redirect("/admin");
  }

  const [tournament] = await db
    .select({ name: tournaments.name, stagerCodes: tournaments.stagerCodes })
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);

  if (!tournament) {
    console.warn(`Tournament ${tournamentId} not found, redirecting to /admin`);
    redirect("/admin");
  }

  const ringList = await db
    .select()
    .from(rings)
    .where(eq(rings.tournamentId, tournamentId))
    .orderBy(asc(rings.ringOrder));

  const ringIds = ringList.map((r) => r.id);
  let modRequests: any[] = [];
  if (ringIds.length > 0) {
    try {
      const reqs = await db
        .select()
        .from(moderatorRequests)
        .where(
          and(
            inArray(moderatorRequests.ringId, ringIds),
            inArray(moderatorRequests.status, ["pending", "approved"])
          )
        )
        .orderBy(desc(moderatorRequests.createdAt));

      modRequests = reqs.map((m) => ({
        id: m.id,
        ring_id: m.ringId,
        moderator_name: m.moderatorName || "Moderator",
        status: m.status,
        device_info: m.deviceInfo,
        created_at: m.createdAt ? m.createdAt.toISOString() : new Date().toISOString(),
      }));
    } catch (err) {
      console.warn("Could not fetch moderatorRequests:", err);
    }
  }

  // Stager codes live on the tournament row and stager requests in their own
  // table. Both used to be passed as empty arrays, which is why a freshly
  // generated code vanished on the next render.
  const stagerCodes = Array.isArray(tournament.stagerCodes) ? tournament.stagerCodes : [];

  let stagerReqList: any[] = [];
  try {
    const reqs = await db
      .select()
      .from(stagerRequests)
      .where(eq(stagerRequests.tournamentId, tournamentId))
      .orderBy(desc(stagerRequests.createdAt))
      .limit(50);

    stagerReqList = reqs.map((r) => ({
      id: r.id,
      tournament_id: r.tournamentId,
      stager_name: r.stagerName || "Stager",
      access_code_used: r.accessCodeUsed,
      status: r.status,
      device_info: r.deviceInfo,
      created_at: r.createdAt ? r.createdAt.toISOString() : new Date().toISOString(),
      expires_at: r.expiresAt ? r.expiresAt.toISOString() : new Date().toISOString(),
    }));
  } catch (err) {
    console.warn("Could not fetch stagerRequests:", err);
  }

  return (
    <>
      <AdminHeader title="Access" eventName={tournament.name} />
      <RingsClient
        tournamentId={tournamentId}
        initialRings={ringList.map((r) => ({
          id: r.id,
          name: r.name,
          ring_order: r.ringOrder,
          access_code: r.accessCode,
        }))}
        initialModRequests={modRequests}
        initialStagerRequests={stagerReqList}
        initialStagerCodes={stagerCodes}
      />
    </>
  );
}
