"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import { checkModeratorStatus } from "@/actions/moderator";
import { useAccessRequestStatus } from "@/hooks/useAccessRequestStatus";

export default function WaitingRoom() {
  const { id } = useParams() as { id: string };
  const router = useRouter();

  // The server sets the httpOnly session cookie when it reports "approved".
  const { state, message } = useAccessRequestStatus(id, checkModeratorStatus, (res) => {
    setTimeout(() => router.push(`/moderator/ring/${res.ringId}/queue`), 1200);
  });

  return (
    <div className="bg-surface text-on-surface min-h-screen flex flex-col font-body-md overflow-hidden relative">
      <header className="w-full px-4 py-6 flex items-center z-10 justify-center">
        <div className="flex items-center gap-2">
          <span className="text-headline-sm font-headline-sm font-extrabold text-primary tracking-tighter">Ring Flow</span>
        </div>
      </header>

      <main className="flex-grow flex items-center justify-center px-4 relative z-10">
        <div className="w-full max-w-md text-center flex flex-col items-center">
          
          {state === "pending" && (
            <>
              <div className="w-24 h-24 mb-10 relative flex justify-center items-center">
                <svg className="w-24 h-24 -rotate-90 animate-spin text-secondary" viewBox="0 0 100 100">
                  <circle
                    cx="50"
                    cy="50"
                    r="42"
                    stroke="currentColor"
                    strokeWidth="5"
                    fill="none"
                    className="text-surface-container-high opacity-30"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="42"
                    stroke="currentColor"
                    strokeWidth="5"
                    strokeDasharray="264"
                    strokeDashoffset="180"
                    strokeLinecap="round"
                    fill="none"
                  />
                </svg>
                <span className="absolute material-symbols-outlined text-secondary text-3xl animate-pulse" style={{fontVariationSettings: '"FILL" 1'}}>admin_panel_settings</span>
              </div>
              <h1 className="text-display-sm font-headline-lg text-primary mb-4 tracking-tight">Waiting for Admin</h1>
              <p className="text-body-lg text-on-surface-variant max-w-xs mx-auto mb-10">
                Your request to control this tatami has been sent. Please wait for the tournament administrator to approve your access.
              </p>
              <div className="w-full max-w-xs bg-surface-container-lowest border border-outline-variant rounded-lg p-4 flex items-center gap-3">
                <span className="material-symbols-outlined text-outline">info</span>
                <span className="text-body-sm text-on-surface-variant text-left">Keep this screen open. You will be redirected automatically.</span>
              </div>
            </>
          )}

          {state === "approved" && (
            <>
              <div className="w-24 h-24 mb-10 rounded-full bg-green-100 flex items-center justify-center shadow-lg transform transition-transform scale-110">
                <span className="material-symbols-outlined text-green-700 text-5xl" style={{fontVariationSettings: '"FILL" 1'}}>check_circle</span>
              </div>
              <h1 className="text-display-sm font-headline-lg text-green-800 mb-4 tracking-tight">Access Granted</h1>
              <p className="text-body-lg text-green-700 mb-10">Entering tatami controls...</p>
            </>
          )}

          {state === "rejected" && (
            <>
              <div className="w-24 h-24 mb-10 rounded-full bg-error-container flex items-center justify-center shadow-lg">
                <span className="material-symbols-outlined text-error text-5xl" style={{fontVariationSettings: '"FILL" 1'}}>cancel</span>
              </div>
              <h1 className="text-display-sm font-headline-lg text-error mb-4 tracking-tight">Access Denied</h1>
              <p className="text-body-lg text-on-error-container mb-10">{message}</p>
              <button 
                onClick={() => router.push('/login/mod')}
                className="bg-error text-white px-6 py-3 rounded-lg font-headline-sm"
              >
                Try Again
              </button>
            </>
          )}
          
        </div>
      </main>
    </div>
  );
}
