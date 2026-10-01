import React from "react";
import { redirect } from "next/navigation";
import { getTournamentStaff } from "@/lib/auth/guards";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { athletes, categories, rings, tournaments } from "@/db/schema";
import AdminSidebar from "@/components/layout/AdminSidebar";

/**
 * The sidebar counters are read here, on the server, so they are correct even
 * when the browser cannot reach PostgREST (which is how they used to show 0).
 */
export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!(await getTournamentStaff(id, ["admin"]))) {
    redirect("/admin");
  }

  const [tournament] = await db
    .select({ name: tournaments.name })
    .from(tournaments)
    .where(eq(tournaments.id, id));

  const [[ringsCount], [categoriesCount], [athletesCount]] = await Promise.all([
    db.select({ value: sql<number>`count(*)::int` }).from(rings).where(eq(rings.tournamentId, id)),
    db.select({ value: sql<number>`count(*)::int` }).from(categories).where(eq(categories.tournamentId, id)),
    db.select({ value: sql<number>`count(*)::int` }).from(athletes).where(eq(athletes.tournamentId, id)),
  ]);

  return (
    <div className="flex min-h-screen bg-background text-on-surface w-full">
      <AdminSidebar
        initialCounts={{
          name: tournament?.name ?? "Tournament",
          ringsCount: ringsCount?.value ?? 0,
          categoriesCount: categoriesCount?.value ?? 0,
          athletesCount: athletesCount?.value ?? 0,
        }}
      />
      <div className="flex-1 flex flex-col min-w-0 w-full">
        {children}
      </div>
    </div>
  );
}
