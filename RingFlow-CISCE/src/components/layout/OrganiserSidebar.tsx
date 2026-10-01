"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useParams, useRouter } from "next/navigation";
import { RingFlowLogo } from "@/components/ui/ringflow-logo";
import LogoutConfirmModal from "@/components/ui/LogoutConfirmModal";
import { validateOrganiserSessionAction, logoutOrganiser } from "@/actions/organiser";
import { getSidebarTournamentCounts } from "@/actions/admin";
import { useLiveEvents } from "@/hooks/useLiveEvents";

interface SidebarCounts {
  name: string;
  ringsCount: number;
  categoriesCount: number;
  athletesCount: number;
}

export default function OrganiserSidebar({ initialCounts }: { initialCounts?: SidebarCounts }) {
  const pathname = usePathname();
  const params = useParams();
  const router = useRouter();
  const id = (params.id as string) || "";
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [organiserName, setOrganiserName] = useState<string>("Organiser");
  const [tournamentData, setTournamentData] = useState<SidebarCounts>(
    initialCounts ?? {
      name: "Tournament",
      ringsCount: 0,
      categoriesCount: 0,
      athletesCount: 0,
    }
  );

  useEffect(() => {
    const saved = localStorage.getItem("ringflow_sidebar_collapsed");
    if (saved !== null) {
      setIsCollapsed(saved === "true");
    }
    const savedName = localStorage.getItem("ringflow_organiser_name");
    if (savedName && !savedName.toLowerCase().includes("suprateek") && savedName !== "Admin") {
      setOrganiserName(savedName);
    }
  }, []);

  const toggleCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("ringflow_sidebar_collapsed", String(next));
      return next;
    });
  };

  const handleRevoked = React.useCallback(() => {
    void logoutOrganiser().catch(() => {});
    try {
      localStorage.removeItem("ringflow_organiser_name");
    } catch {}
    router.replace("/");
  }, [router]);

  // The session cookie is httpOnly, so the server reads it; the browser never sees the token.
  const checkSession = React.useCallback(async () => {
    try {
      const res = await validateOrganiserSessionAction();
      if (!res.valid) {
        handleRevoked();
      } else if ("organiserName" in res && res.organiserName) {
        setOrganiserName(res.organiserName);
        localStorage.setItem("ringflow_organiser_name", res.organiserName);
      }
      return res;
    } catch (err) {
      console.warn("Session check error, keeping session intact:", err);
      return null;
    }
  }, [handleRevoked]);

  // Live real-time SSE listener for session / tournament changes
  useLiveEvents(
    { tournamentId: id },
    React.useCallback(() => {
      void checkSession();
    }, [checkSession])
  );

  // Active session watcher: periodically verifies organiser token validity
  useEffect(() => {
    let isCleanedUp = false;

    void checkSession();
    const interval = setInterval(() => {
      if (!isCleanedUp) void checkSession();
    }, 60000);

    return () => {
      isCleanedUp = true;
      clearInterval(interval);
    };
  }, [checkSession]);

  // Fetch tournament counts
  useEffect(() => {
    if (!id) return;
    let isMounted = true;

    const fetchDetails = async () => {
      try {
        const counts = await getSidebarTournamentCounts(id);
        if (isMounted && counts) {
          setTournamentData((prev) => ({
            name: counts.name || prev.name,
            ringsCount: counts.ringsCount ?? prev.ringsCount,
            categoriesCount: counts.categoriesCount ?? prev.categoriesCount,
            athletesCount: counts.athletesCount ?? prev.athletesCount,
          }));
        }
      } catch (err) {
        console.error("Failed to load organiser sidebar stats:", err);
      }
    };

    fetchDetails();
    return () => {
      isMounted = false;
    };
  }, [id]);

  const [pendingPath, setPendingPath] = useState<string | null>(null);

  // Clear pending path when route finishes loading and pathname updates
  useEffect(() => {
    setPendingPath(null);
  }, [pathname]);

  // Safety fallback: clear pending after 8s if navigation gets interrupted
  useEffect(() => {
    if (!pendingPath) return;
    const timer = setTimeout(() => {
      setPendingPath(null);
    }, 8000);
    return () => clearTimeout(timer);
  }, [pendingPath]);

  const navItems = [
    {
      name: "Dashboard",
      href: `/organiser/event/${id}/dashboard`,
      icon: (
        <svg className="w-[22px] h-[22px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </svg>
      ),
      count: null,
      isLive: false,
    },
    {
      name: "Tatami Balancing",
      href: `/organiser/event/${id}/rings/balance`,
      icon: (
        <svg className="w-[22px] h-[22px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 3v18M6 7l-3 6a3 3 0 006 0l-3-6zM18 7l-3 6a3 3 0 006 0l-3-6zM6 7h12" />
        </svg>
      ),
      count: tournamentData.ringsCount || 0,
      isLive: true,
    },
    {
      name: "Categories",
      href: `/organiser/event/${id}/categories`,
      icon: (
        <svg className="w-[22px] h-[22px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 3l9 5-9 5-9-5 9-5zM3 8v8l9 5 9-5V8" />
        </svg>
      ),
      count: tournamentData.categoriesCount || 0,
      isLive: false,
    },
    {
      name: "Athletes",
      href: `/organiser/event/${id}/athletes`,
      icon: (
        <svg className="w-[22px] h-[22px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="9" cy="8" r="3.2" />
          <path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6" />
          <circle cx="18" cy="9" r="2.6" />
          <path d="M15.5 14c2.8.3 5 2.5 5 6" />
        </svg>
      ),
      count: tournamentData.athletesCount || 0,
      isLive: false,
    },
  ];

  return (
    <>
      <aside
        className={`hidden md:flex flex-col sticky top-0 h-screen bg-[#FAF9F5] border-r border-[#E1DDCF] shrink-0 z-40 transition-[width] duration-200 select-none relative ${isCollapsed ? "w-[68px]" : "w-[260px]"
          }`}
      >
        {/* ─── Prominent Vertically Centered Sticked-out Toggle (< / >) ─── */}
        <button
          onClick={toggleCollapse}
          type="button"
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="absolute top-1/2 -right-3.5 -translate-y-1/2 z-50 w-7 h-7 rounded-full bg-[#FAF9F5] border border-[#E1DDCF] shadow-[0_2px_8px_rgba(0,0,0,0.10)] hover:shadow-md flex items-center justify-center text-slate-700 hover:text-[#0E9C7C] hover:border-[#0E9C7C] hover:scale-110 active:scale-95 transition-all cursor-pointer"
        >
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {isCollapsed ? <path d="M9 18l6-6-6-6" /> : <path d="M15 18l-6-6 6-6" />}
          </svg>
        </button>

        {/* ─── Top Branding & Event Header ─── */}
        {isCollapsed ? (
          <div className="h-[60px] border-b border-[#E1DDCF] flex items-center justify-center shrink-0">
            <Link href="/" title="RingFlow" className="hover:scale-110 transition-transform p-1">
              <RingFlowLogo className="h-9 w-9 text-[#1B1815] shrink-0" />
            </Link>
          </div>
        ) : (
          <div className="p-3.5 border-b border-[#E1DDCF] shrink-0 space-y-2.5">
            {/* RingFlow Brand Row */}
            <Link
              href="/"
              className="flex items-center gap-2.5 group transition-opacity hover:opacity-90 py-0.5"
            >
              <RingFlowLogo className="h-8 w-8 text-[#1B1815] shrink-0 group-hover:scale-105 transition-transform" />
              <span className="font-['Plus_Jakarta_Sans',sans-serif] font-black text-[20px] tracking-tight text-[#0F172A]">
                RingFlow
              </span>
            </Link>

            {/* Event Name & Live Mats (Below RingFlow branding, no down arrow) */}
            <div className="pt-2 border-t border-[#E1DDCF]/60">
              <Link
                href={`/organiser/event/${id}/dashboard`}
                className="block group"
              >
                <div className="text-[#0F172A] font-bold text-[14.5px] truncate tracking-tight group-hover:text-[#0B7C63] transition-colors">
                  {tournamentData.name}
                </div>
              </Link>
              <div className="flex items-center gap-1.5 mt-1">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#0E9C7C] opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[#0E9C7C]" />
                </span>
                <span className="text-[#0B7C63] text-[11.5px] font-semibold">Live</span>
                <span className="text-[#94A3B8] text-[11.5px]">
                  · {tournamentData.ringsCount || 0} mats active
                </span>
              </div>
            </div>
          </div>
        )}

        {/* ─── Navigation Groups ─── */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          <div>
            {!isCollapsed && (
              <div className="text-[#94A3B8] text-[11.5px] font-semibold tracking-[0.3px] px-3 pb-2 uppercase">
                Operations
              </div>
            )}
            <div className={`space-y-1.5 ${isCollapsed ? "space-y-2" : ""}`}>
              {navItems.map((item) => {
                const isPending = pendingPath === item.href;
                const isActive = pendingPath ? isPending : pathname.startsWith(item.href);

                return (
                  <div
                    key={item.name}
                    className="pb-1.5 border-b border-[#E1DDCF]"
                  >
                    <Link
                      href={item.href}
                      onClick={(e) => {
                        if (pathname.startsWith(item.href)) {
                          e.preventDefault();
                          return;
                        }
                        setPendingPath(item.href);
                      }}
                      title={item.name}
                      className={`flex items-center gap-3 transition-all ${isPending ? "pointer-events-none cursor-wait" : ""
                        } ${isCollapsed
                          ? "w-[44px] h-[44px] mx-auto justify-center rounded-xl"
                          : "px-3 py-2.5 rounded-lg text-[14.5px]"
                        } ${isActive
                          ? "bg-[#E3F6F0] text-[#0B7C63] font-semibold border border-[#0E9C7C]/30 shadow-2xs"
                          : "text-[#334155] hover:bg-[#ECE9DF]/60 font-medium border border-transparent"
                        }`}
                    >
                      {isCollapsed ? (
                        isPending ? (
                          <span className="w-4 h-4 border-2 border-[#0B7C63] border-t-transparent rounded-full animate-spin shrink-0" />
                        ) : (
                          <span className={isActive ? "text-[#0B7C63]" : "text-[#94A3B8]"}>
                            {item.icon}
                          </span>
                        )
                      ) : (
                        <>
                          <span className={isActive ? "text-[#0B7C63]" : "text-[#94A3B8]"}>
                            {item.icon}
                          </span>
                          <span className="flex-1 whitespace-nowrap font-medium">{item.name}</span>
                          {isPending ? (
                            <span className="flex items-center gap-1.5 text-[11.5px] text-[#0B7C63] font-semibold shrink-0">
                              <span className="w-3.5 h-3.5 border-2 border-[#0B7C63] border-t-transparent rounded-full animate-spin shrink-0" />
                              <span className="animate-pulse">Loading...</span>
                            </span>
                          ) : (
                            item.count !== null && (
                              item.isLive ? (
                                <span className="text-[11px] bg-[#E3F6F0] text-[#0B7C63] px-2 py-0.5 rounded-full font-semibold flex items-center gap-1 shrink-0">
                                  <span className="w-1.5 h-1.5 rounded-full bg-[#0E9C7C]" />
                                  {item.count}
                                </span>
                              ) : (
                                <span className="text-[11px] text-[#94A3B8] bg-[#ECE9DF] px-2 py-0.5 rounded-full font-semibold shrink-0">
                                  {item.count}
                                </span>
                              )
                            )
                          )}
                        </>
                      )}
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
        </nav>

        {/* ─── Standard CruxStudios Capsule Footer (Theme Toggle Removed) ─── */}
        {/* ─── Role & Profile Footer (Click to Sign Out) ─── */}
        <div className="p-3 border-t border-[#E1DDCF] bg-[#FAF9F5] shrink-0">
          {isCollapsed ? (
            <button
              type="button"
              onClick={() => setShowLogoutConfirm(true)}
              title={`${organiserName || "Organiser"} (Organiser) · Click to sign out`}
              className="w-[42px] h-[42px] mx-auto rounded-xl flex items-center justify-center text-[#64748B] hover:text-red-600 hover:bg-red-50 border border-[#E1DDCF] hover:border-red-200 transition-all cursor-pointer group shadow-2xs"
            >
              <svg
                className="w-5 h-5 group-hover:hidden transition-all"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <circle cx="12" cy="8" r="3.5" />
                <path d="M4.5 20c0-4 3.4-7 7.5-7s7.5 3 7.5 7" />
              </svg>
              <span className="material-symbols-outlined text-[20px] hidden group-hover:block transition-all">
                logout
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowLogoutConfirm(true)}
              title="Click role to sign out"
              className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-red-50/70 border border-transparent hover:border-red-200/60 transition-all group cursor-pointer text-left"
            >
              <div className="w-[40px] h-[40px] rounded-xl bg-[#ECE9DF] border border-[#E1DDCF] text-[#475569] group-hover:bg-red-100/70 group-hover:text-red-600 group-hover:border-red-200 flex items-center justify-center shrink-0 shadow-2xs transition-colors">
                <svg
                  className="w-5 h-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <circle cx="12" cy="8" r="3.5" />
                  <path d="M4.5 20c0-4 3.4-7 7.5-7s7.5 3 7.5 7" />
                </svg>
              </div>
              <div className="flex-1 min-w-0 leading-tight">
                <div className="text-[14.5px] font-bold text-[#0F172A] group-hover:text-red-700 truncate transition-colors">
                  {organiserName || "Organiser"}
                </div>
                <div className="text-[12px] text-[#64748B] group-hover:text-red-500 font-medium flex items-center gap-1.5 transition-colors mt-0.5">
                  <span>Organiser</span>
                  <span className="opacity-0 group-hover:opacity-100 text-[11px] text-red-500 font-semibold transition-opacity">
                    · Sign out
                  </span>
                </div>
              </div>
              <svg
                className="w-5 h-5 text-[#94A3B8] group-hover:text-red-600 group-hover:translate-x-0.5 transition-all shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          )}
        </div>
      </aside>

      {/* Mobile Bottom Navigation Bar (md:hidden) */}
      <nav className="md:hidden fixed bottom-0 left-0 w-full bg-[#FAF9F5]/95 backdrop-blur-md border-t border-[#E1DDCF] z-50 flex items-center justify-around px-2 py-1.5 shadow-[0_-2px_8px_rgba(0,0,0,0.04)]">
        {navItems.map((item) => {
          const isPending = pendingPath === item.href;
          const isActive = pendingPath ? isPending : pathname.startsWith(item.href);
          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={(e) => {
                if (pathname.startsWith(item.href)) {
                  e.preventDefault();
                  return;
                }
                setPendingPath(item.href);
              }}
              className={`flex flex-col items-center justify-center py-1 px-3 rounded-xl transition-all ${isPending ? "pointer-events-none cursor-wait" : ""
                } ${isActive
                  ? "text-[#0B7C63] font-semibold bg-[#E3F6F0] border border-[#0E9C7C]/30 shadow-2xs"
                  : "text-[#64748B] hover:text-[#0F172A] border border-transparent"
                }`}
            >
              {isPending ? (
                <span className="w-5 h-5 border-2 border-[#0B7C63] border-t-transparent rounded-full animate-spin my-0.5" />
              ) : (
                <span className="material-symbols-outlined text-[20px]">
                  {item.name === "Dashboard"
                    ? "dashboard"
                    : item.name === "Tatami Balancing"
                      ? "balance"
                      : item.name === "Categories"
                        ? "category"
                        : "groups"}
                </span>
              )}
              <span className="text-[10px] font-medium tracking-tight mt-0.5 whitespace-nowrap">
                {isPending ? "Loading..." : item.name}
              </span>
            </Link>
          );
        })}
      </nav>

      <LogoutConfirmModal
        isOpen={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        onConfirm={async () => {
          setIsLoggingOut(true);
          try {
            await logoutOrganiser();
            try {
              localStorage.removeItem("ringflow_organiser_name");
            } catch {}
            router.replace("/");
          } catch (e) {
            console.error("Organiser logout error:", e);
            try {
              localStorage.removeItem("ringflow_organiser_name");
            } catch {}
            router.replace("/");
          }
        }}
        isLoggingOut={isLoggingOut}
        title="Sign Out of Organiser Portal"
        message="Are you sure you want to sign out? You will need your 6-character access code and director approval to regain access."
        confirmLabel="Sign Out"
      />
    </>
  );
}
