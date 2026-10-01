import React from "react";
import { redirect } from "next/navigation";
import { getRingModerator } from "@/lib/auth/guards";
import { db } from "@/db";
import { rings as ringsTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import ModeratorBottomNav from "@/components/moderator/ModeratorBottomNav";
import ModeratorTopTabs from "@/components/moderator/ModeratorTopTabs";
import ModeratorProfileMenu from "@/components/moderator/ModeratorProfileMenu";

export default async function ModeratorRingLayout({
  children,
  params
}: {
  children: React.ReactNode;
  params: Promise<{ ringId: string }>;
}) {
  const { ringId } = await params;

  // Only the approved moderator of this exact tatami gets the desk.
  const moderator = await getRingModerator(ringId);
  if (!moderator) {
    redirect("/login/mod");
  }

  // Fetch Ring Info via direct Drizzle
  const [ring] = await db
    .select()
    .from(ringsTable)
    .where(eq(ringsTable.id, ringId))
    .limit(1);

  if (!ring) {
    return <div>Ring not found.</div>;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background pb-20 font-body-md text-on-background lg:pb-6">
      {/* Top bar: identity on phones, the section tabs on laptops */}
      <header className="sticky top-0 z-40 flex h-14 sm:h-16 w-full items-center justify-between gap-2 border-b border-outline-variant bg-surface-container-lowest px-3 text-primary sm:px-4 md:px-margin-desktop">
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          <span className="shrink-0 font-headline-sm text-sm sm:text-headline-sm font-black tracking-tighter text-primary">RingFlow</span>
          <div className="h-4 w-[1px] shrink-0 bg-outline-variant sm:h-5"></div>
          <div className="min-w-0">
            <h1 className="truncate text-xs sm:text-sm font-bold text-on-surface uppercase leading-tight">{ring.name.replace(/Ring/i, "Tatami")}</h1>
            <p className="hidden sm:block truncate text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">
              Moderator desk
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-4">
          <ModeratorTopTabs ringId={ringId} />
          <ModeratorProfileMenu moderator={{ id: moderator.requestId, moderator_name: moderator.name }} />
        </div>
      </header>

      {/* Main Content — full width on laptops, comfortable measure below */}
      <main className="mx-auto w-full max-w-5xl flex-grow p-3 sm:p-4 md:p-margin-desktop lg:max-w-[1800px]">
        {children}
      </main>

      {/* Bottom Navigation Bar (phones and tablets only) */}
      <ModeratorBottomNav ringId={ringId} />
    </div>
  );
}
