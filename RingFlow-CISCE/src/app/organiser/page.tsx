import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import OrganiserHeader from "@/components/layout/OrganiserHeader";
import { db } from "@/db";
import { tournaments as tournamentsTable } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { getAdminPrincipal, getOrganiserPrincipal } from "@/lib/auth/principal";
import { formatDisplayDate } from "@/lib/utils";
import { serializeTournament } from "@/lib/serializers";

export const dynamic = "force-dynamic";

export default async function OrganiserTournamentSelectionPage() {
  const organiser = await getOrganiserPrincipal();
  if (organiser) {
    redirect(`/organiser/event/${organiser.tournamentId}/dashboard`);
  }

  // An admin may preview the organiser view of their own tournaments.
  const admin = await getAdminPrincipal();
  if (!admin) {
    redirect("/");
  }

  const rows = await db
    .select()
    .from(tournamentsTable)
    .where(eq(tournamentsTable.adminId, admin.adminId))
    .orderBy(desc(tournamentsTable.createdAt));

  const tournamentList = rows.map((row) => serializeTournament(row));

  return (
    <div className="min-h-screen bg-background flex flex-col w-full">
      <OrganiserHeader title="Select Tournament" />
      <div className="p-margin-desktop bg-surface pb-24 w-full flex-1">
        <div className="max-w-7xl mx-auto w-full">
          {/* Welcome Section */}
          <div className="mb-10">
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded text-[11px] font-label-caps font-bold tracking-wider uppercase bg-primary text-on-primary">
                Administrator View · Organiser Terminal
              </span>
            </div>
            <h1 className="font-headline-lg text-headline-lg text-on-surface">
              Welcome, Administrator
            </h1>
            <p className="text-body-sm text-on-surface-variant mt-1">
              Select one of your tournaments to preview in organiser view.
            </p>
          </div>

          {/* Tournament Section Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-secondary">sports_martial_arts</span>
              <h3 className="font-headline-sm text-headline-sm text-on-surface">Your Tournaments</h3>
            </div>
          </div>

          {/* Tournament Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
            {tournamentList.length === 0 && (
              <div className="col-span-full text-center p-12 border border-dashed border-outline-variant rounded-xl text-on-surface-variant bg-white">
                <span className="material-symbols-outlined text-4xl text-outline mb-2">event_busy</span>
                <p className="font-medium">No tournaments found.</p>
                <p className="text-xs text-on-surface-variant/70 mt-1">Create a tournament in the Admin Console to view it here.</p>
              </div>
            )}
            
            {tournamentList.map((tournament) => (
              <Link 
                key={tournament.id} 
                href={`/organiser/event/${tournament.id}/dashboard`} 
                className="group bg-white border border-outline-variant hover:border-secondary transition-all cursor-pointer rounded-xl overflow-hidden flex flex-col shadow-xs hover:shadow-md hover:-translate-y-0.5"
              >
                <div className="p-card-padding flex-grow">
                  <div className="flex justify-between items-start mb-4">
                    <span className={`px-2.5 py-0.5 font-label-caps text-[11px] font-bold rounded-full flex items-center gap-1.5 ${
                      tournament.status === 'active' ? 'bg-error-container text-on-error-container' : 
                      tournament.status === 'draft' ? 'bg-surface-container-highest text-on-surface-variant' : 
                      'bg-tertiary-fixed text-on-tertiary-fixed'
                    }`}>
                      {tournament.status === 'active' && <span className="w-1.5 h-1.5 rounded-full bg-error animate-pulse" />}
                      {tournament.status.toUpperCase()}
                    </span>
                    <span className="font-data-mono text-xs text-on-surface-variant opacity-70">
                      ID: {tournament.id.split('-')[0]}
                    </span>
                  </div>
                  <h4 className="font-headline-sm text-headline-sm text-primary mb-2 group-hover:text-secondary transition-colors font-bold">
                    {tournament.name}
                  </h4>
                  <div className="space-y-1 text-xs text-on-surface-variant">
                    <p className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[15px] text-outline">calendar_today</span>
                      <span>{formatDisplayDate(tournament.event_date)}</span>
                    </p>
                    <p className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[15px] text-outline">location_on</span>
                      <span className="truncate">{tournament.venue || 'Venue TBA'}</span>
                    </p>
                  </div>
                </div>
                <div className="px-card-padding py-3.5 bg-surface-container-low border-t border-outline-variant flex justify-between items-center group-hover:bg-surface-container transition-colors">
                  <span className="font-label-caps text-xs font-semibold text-primary">Enter Dashboard</span>
                  <span className="material-symbols-outlined text-secondary text-sm group-hover:translate-x-1 transition-transform">arrow_forward</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
