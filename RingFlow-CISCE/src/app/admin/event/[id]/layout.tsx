import React from "react";
import { redirect } from "next/navigation";
import { getTournamentStaff } from "@/lib/auth/guards";
import AdminSidebar from "@/components/layout/AdminSidebar";
import { tournamentCounts } from "@/lib/tournamentCounts";

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

  const counts = await tournamentCounts(id);
  return (
    <div className="flex min-h-screen bg-background text-on-surface w-full">
      <AdminSidebar
        initialCounts={counts ?? { name: "Tournament", ringsCount: 0, categoriesCount: 0, athletesCount: 0 }}
      />
      <div className="flex-1 flex flex-col min-w-0 w-full">
        {children}
      </div>
    </div>
  );
}
