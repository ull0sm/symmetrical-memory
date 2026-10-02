"use client";
import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { startCategory, reorderCategory } from "@/actions/moderator";
import { useLiveEvents } from "@/hooks/useLiveEvents";

export default function ModeratorQueueClient({ ringId, initialAssignments }: { ringId: string, initialAssignments: any[] }) {
  const [assignments, setAssignments] = useState(initialAssignments);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // The server component owns this list; adopt it whenever it is re-fetched.
  useEffect(() => {
    setAssignments(initialAssignments);
  }, [initialAssignments]);

  // A change on this mat re-reads the queue — no waiting on a poll.
  useLiveEvents({ ringId }, () => router.refresh(), { feed: "staff" });

  const activeAssignment = assignments.find(a => a.status === 'running' || a.status === 'paused');
  const pendingAssignments = assignments.filter(a => a.status === 'pending').sort((a, b) => a.queue_order - b.queue_order);

  const handleStartCategory = async (assignmentId: string) => {
    setLoading(true);
    try {
      await startCategory(assignmentId, ringId);
      router.push(`/moderator/ring/${ringId}/current`);
    } catch (e) {
      console.error(e);
      alert("Failed to start category");
    } finally {
      setLoading(false);
    }
  };

  const handleReorder = async (assignmentId: string, direction: "up" | "down") => {
    setLoading(true);
    try {
      await reorderCategory(assignmentId, ringId, direction);
    } catch (e) {
      console.error(e);
      alert("Failed to reorder");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Empty state — compact prompt when no category is running */}
      {!activeAssignment && pendingAssignments.length > 0 && (
        <section className="flex flex-col items-center justify-center py-10 sm:py-14 text-center">
          <div className="w-16 h-16 sm:w-20 sm:h-20 bg-surface-container rounded-full flex items-center justify-center mb-4 sm:mb-5">
            <span className="material-symbols-outlined text-3xl sm:text-4xl text-outline" style={{fontVariationSettings: '"FILL" 1'}}>event_busy</span>
          </div>
          <h2 className="font-headline-sm text-base sm:text-headline-sm mb-1.5">No category running</h2>
          <p className="text-on-surface-variant text-sm mb-6 max-w-xs">Initialize the first category below to begin.</p>
          <button 
            disabled={loading}
            onClick={() => handleStartCategory(pendingAssignments[0].id)}
            className="bg-primary text-on-primary px-6 sm:px-8 py-3 rounded-lg font-bold flex items-center gap-2 hover:opacity-80 transition-opacity disabled:opacity-50 text-sm sm:text-base active:scale-[0.98]"
          >
            <span className="material-symbols-outlined text-[20px]" style={{fontVariationSettings: '"FILL" 1'}}>play_arrow</span>
            Start First Category
          </button>
        </section>
      )}

      {/* Active assignment card */}
      {activeAssignment && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-label-caps text-label-caps text-on-surface-variant tracking-widest uppercase">CURRENT</h2>
            <span className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-label-caps text-[10px] sm:text-label-caps border ${
              activeAssignment.status === 'running' 
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                : 'bg-error-container text-on-error-container border-error/20'
            }`}>
              {activeAssignment.status === 'running' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>}
              {activeAssignment.status.toUpperCase()}
            </span>
          </div>
          <div className="bg-surface-container-lowest border-l-4 border-secondary border-t border-r border-b border-outline-variant rounded-xl shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-6 p-3 sm:p-5 md:p-6">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-secondary-container rounded-xl flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-xl sm:text-2xl text-on-secondary-container" style={{fontVariationSettings: '"FILL" 1'}}>sports_martial_arts</span>
              </div>
              <div className="space-y-0.5 min-w-0">
                <h3 className="font-headline-sm text-sm sm:text-base font-semibold truncate">{activeAssignment.categories?.name}</h3>
                <span className="flex items-center gap-1 text-on-surface-variant text-xs">
                  <span className="material-symbols-outlined text-[14px]">group</span>
                  {activeAssignment.categories?.expected_matches || 0} Matches
                </span>
              </div>
            </div>
            <button 
              onClick={() => router.push(`/moderator/ring/${ringId}/current`)}
              className="w-full sm:w-auto px-5 py-2.5 bg-primary text-on-primary rounded-lg font-label-caps text-label-caps hover:opacity-80 transition-opacity text-center active:scale-[0.98]"
            >
              GO TO MATCH
            </button>
          </div>
        </div>
      )}

      {/* Queue list */}
      {pendingAssignments.length > 0 && (
        <div className="space-y-3 pt-4">
          <h2 className="font-label-caps text-label-caps text-on-surface-variant tracking-widest uppercase">UP NEXT</h2>
          <div className="space-y-2">
            {pendingAssignments.map((assignment, index) => (
              <div key={assignment.id} className="group bg-surface-container-low border border-outline-variant rounded-xl p-3 sm:p-4 flex items-center justify-between gap-2 transition-all">
                <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
                  {/* Number badge */}
                  <span className="flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-surface-container text-outline font-data-mono text-[10px] sm:text-xs font-bold shrink-0">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-body-md font-medium text-on-surface truncate text-xs sm:text-sm">{assignment.categories?.name}</p>
                    <p className="text-on-surface-variant text-[10px] sm:text-xs">
                      {assignment.categories?.expected_matches || 0} Matches
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {/* Start button — visible when no category is running */}
                  {!activeAssignment && (
                    <button
                      disabled={loading}
                      onClick={() => handleStartCategory(assignment.id)}
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
                      title="Start this category"
                    >
                      <span className="material-symbols-outlined text-[20px]" style={{fontVariationSettings: '"FILL" 1'}}>play_arrow</span>
                    </button>
                  )}
                  {/* Reorder buttons — larger touch targets */}
                  <div className="flex flex-col gap-0.5">
                    <button 
                      disabled={loading || index === 0} 
                      onClick={() => handleReorder(assignment.id, "up")}
                      className="min-w-[36px] min-h-[36px] sm:min-w-[40px] sm:min-h-[40px] flex items-center justify-center rounded-lg hover:bg-surface-container text-on-surface-variant disabled:opacity-20 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[18px]">keyboard_arrow_up</span>
                    </button>
                    <button 
                      disabled={loading || index === pendingAssignments.length - 1} 
                      onClick={() => handleReorder(assignment.id, "down")}
                      className="min-w-[36px] min-h-[36px] sm:min-w-[40px] sm:min-h-[40px] flex items-center justify-center rounded-lg hover:bg-surface-container text-on-surface-variant disabled:opacity-20 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[18px]">keyboard_arrow_down</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!activeAssignment && pendingAssignments.length === 0 && (
        <div className="text-center p-8 sm:p-12 bg-surface-container-lowest border border-outline-variant rounded-xl text-on-surface-variant text-sm">
          No categories assigned to this tatami yet.
        </div>
      )}
    </div>
  );
}
