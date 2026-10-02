"use server";

import { audit } from "@/lib/audit";
import { db } from "@/db";
import { tournaments } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTournamentAdmin } from "@/lib/auth/guards";

const TOURNAMENT_STATUSES = ["draft", "active", "completed"] as const;
type TournamentStatus = (typeof TOURNAMENT_STATUSES)[number];

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
    /** OFFICIAL follows WKF strictly; LOCAL lets the organiser tweak (bronze format, separation). */
    draw_profile?: "OFFICIAL" | "LOCAL";
    /** Local events only: keep club-mates apart ('CLUB') or ignore club ('OFF'). */
    draw_separation?: "CLUB" | "OFF";
    tunnel_url?: string | null;
    tunnelUrl?: string | null;
  }
) {
  const admin = await requireTournamentAdmin(tournamentId);
  const [beforeRow] = await db
    .select({
      name: tournaments.name,
      eventDate: tournaments.eventDate,
      status: tournaments.status,
      venue: tournaments.venue,
      city: tournaments.city,
      showPublicDraws: tournaments.showPublicDraws,
      showPublicScoreboard: tournaments.showPublicScoreboard,
      defaultBronzeMedals: tournaments.defaultBronzeMedals,
      drawProfile: tournaments.drawProfile,
      drawSeparation: tournaments.drawSeparation,
      tunnelUrl: tournaments.tunnelUrl,
    })
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId));

  const name = String(data.name ?? "").trim().slice(0, 200);
  if (!name) return { success: false, error: "Tournament name is required." };

  const status = TOURNAMENT_STATUSES.includes(data.status as TournamentStatus) ? data.status : null;
  if (!status) return { success: false, error: "Status must be draft, active or completed." };

  const rawDate = data.event_date ? String(data.event_date).split("T")[0] : null;
  const eventDate = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : null;

  const rawTunnel = data.tunnel_url ?? data.tunnelUrl ?? null;
  const cleanTunnel = rawTunnel ? rawTunnel.trim().replace(/\/+$/, "").slice(0, 300) : null;
  if (cleanTunnel && !/^https?:\/\/[^\s]+$/i.test(cleanTunnel)) {
    return { success: false, error: "The judge link must start with http:// or https://" };
  }

  const rawBronze = data.default_bronze_medals != null ? Number(data.default_bronze_medals) : 2;
  const defaultBronzeMedals: 0 | 1 | 2 | 3 = [0, 1, 2, 3].includes(rawBronze)
    ? (rawBronze as 0 | 1 | 2 | 3)
    : 2;

  // An omitted field keeps what is stored: a caller that does not know about draw settings must not reset them.
  const drawProfile = (data.draw_profile ?? beforeRow?.drawProfile) === "OFFICIAL" ? "OFFICIAL" : "LOCAL";
  const drawSeparation = (data.draw_separation ?? beforeRow?.drawSeparation) === "OFF" ? "OFF" : "CLUB";

  await db
    .update(tournaments)
    .set({
      name,
      eventDate,
      status,
      venue: String(data.venue ?? "").trim().slice(0, 200) || null,
      city: String(data.city ?? "").trim().slice(0, 200) || null,
      showPublicDraws: data.show_public_draws ?? true,
      showPublicScoreboard: data.show_public_scoreboard ?? false,
      defaultBronzeMedals,
      drawProfile,
      drawSeparation,
      tunnelUrl: cleanTunnel,
      updatedAt: new Date(),
    })
    .where(eq(tournaments.id, tournamentId));

  await audit({
    tournamentId,
    actor: admin,
    action: "SETTINGS_UPDATED",
    targetType: "tournament",
    targetId: tournamentId,
    before: beforeRow,
    after: {
      name,
      eventDate,
      status,
      venue: data.venue,
      city: data.city,
      showPublicDraws: data.show_public_draws ?? true,
      showPublicScoreboard: data.show_public_scoreboard ?? false,
      defaultBronzeMedals,
      drawProfile,
      drawSeparation,
      tunnelUrl: cleanTunnel,
    },
  });

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
  await requireTournamentAdmin(tournamentId);

  await db.delete(tournaments).where(eq(tournaments.id, tournamentId));

  redirect("/admin");
}
