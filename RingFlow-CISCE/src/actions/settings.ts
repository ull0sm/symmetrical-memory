"use server";

import { db } from "@/db";
import { tournaments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ensureAdminOwnsTournament } from "./admin";

export async function updateTournamentSettings(
  tournamentId: string,
  data: {
    name: string;
    event_date: string;
    status: string;
    venue: string;
    city: string;
    show_public_draws?: boolean;
    show_public_scoreboard?: boolean;
    /** 0 = no bronze, 1 = local official (1 bronze), 2 = official WKF (2 bronzes), 3 = local official (joint 2 bronzes). */
    default_bronze_medals?: 0 | 1 | 2 | 3;
    tunnel_url?: string | null;
    tunnelUrl?: string | null;
  }
) {
  await ensureAdminOwnsTournament(tournamentId);

  const eventDate = data.event_date ? data.event_date.split("T")[0] : null;
  const rawTunnel = data.tunnel_url ?? data.tunnelUrl ?? null;
  const cleanTunnel = rawTunnel ? rawTunnel.trim().replace(/\/+$/, "") : null;

  const rawBronze = data.default_bronze_medals != null ? Number(data.default_bronze_medals) : 2;
  const defaultBronzeMedals: 0 | 1 | 2 | 3 = [0, 1, 2, 3].includes(rawBronze)
    ? (rawBronze as 0 | 1 | 2 | 3)
    : 2;

  await db
    .update(tournaments)
    .set({
      name: data.name,
      eventDate,
      status: data.status,
      venue: data.venue || null,
      city: data.city || null,
      showPublicDraws: data.show_public_draws ?? true,
      showPublicScoreboard: data.show_public_scoreboard ?? false,
      defaultBronzeMedals,
      tunnelUrl: cleanTunnel,
      updatedAt: new Date(),
    })
    .where(eq(tournaments.id, tournamentId));

  try {
    revalidatePath(`/admin/event/${tournamentId}/settings`);
    revalidatePath(`/admin/event/${tournamentId}/categories`);
    revalidatePath(`/admin/event/${tournamentId}/dashboard`);
    revalidatePath(`/admin`);
    revalidatePath(`/organiser`);
    revalidatePath(`/public/event/${tournamentId}`);
  } catch {}

  return { success: true, defaultBronzeMedals };
}

export async function deleteTournament(tournamentId: string) {
  await ensureAdminOwnsTournament(tournamentId);

  await db.delete(tournaments).where(eq(tournaments.id, tournamentId));

  redirect("/admin");
}
