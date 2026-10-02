"use server";

import { audit } from "@/lib/audit";
import { db } from "@/db";
import {
  rings as ringsTable,
  categories as categoriesTable,
  categoryAssignments as categoryAssignmentsTable,
} from "@/db/schema";
import { eq, inArray, and, type InferSelectModel } from "drizzle-orm";
import { broadcastLiveEvent } from "@/lib/realtime/bus";
import { requireTournamentAdmin, requireTournamentStaff } from "@/lib/auth/guards";
import { sequenceQueue } from "@/lib/draws/queueOrder";
import { healPartSizes } from "@/lib/draws/partRouting";
import { isValidUuid } from "@/lib/utils";

type CategoryAssignmentRow = InferSelectModel<typeof categoryAssignmentsTable>;

export type AssignmentInput = {
  category_id: string;
  /** 'ALL' (the default), or the 'POOL:n' / 'FINALS' card of a category whose pools run on different tatamis. */
  part?: string;
  ring_id: string | null; // null means unassigned
  queue_order: number;
  status?: string;
  completed_at?: string | null;
};

export type SaveAssignmentsResult = {
  success: boolean;
  error?: string;
};

const cardKey = (categoryId: string, part: string) => `${categoryId}|${part}`;

/**
 * Saves the balancing board: which tatami each card is on, and in what order.
 *
 * The board lists cards: a whole category, or, once its pools run on different tatamis, one card per
 * pool and one for the finals. A save can reorder any card and move a whole category between tatamis.
 * Moving a pool or the finals to another tatami changes where the category runs, so it goes through
 * `setCategoryRouting`, which checks what is live; a save that tries it is refused.
 */
export async function saveAssignments(
  tournamentId: string,
  assignments: AssignmentInput[]
): Promise<SaveAssignmentsResult> {
  try {
    // Only the event's admin assigns categories to tatamis.
    let admin;
    try {
      admin = await requireTournamentAdmin(tournamentId);
    } catch {
      return { success: false, error: "Unauthorized: Only administrators can assign categories to Tatamis." };
    }

    if (!Array.isArray(assignments) || assignments.length > 5000) {
      return { success: false, error: "Invalid assignment list" };
    }

    // 1. Deduplicate payload by card (latest entry wins)
    const partOfInput = (a: AssignmentInput) => a.part || "ALL";
    const dedupedMap = new Map<string, AssignmentInput>();
    for (const a of assignments) {
      dedupedMap.set(cardKey(a.category_id, partOfInput(a)), a);
    }
    const cleanAssignments = Array.from(dedupedMap.values());
    const validAssignments = cleanAssignments.filter((a) => a.ring_id !== null);

    // 2. Fetch all ring IDs and valid categories for this tournament
    const [rings, tournamentCategories] = await Promise.all([
      db.select({ id: ringsTable.id }).from(ringsTable).where(eq(ringsTable.tournamentId, tournamentId)),
      db.select({ id: categoriesTable.id }).from(categoriesTable).where(eq(categoriesTable.tournamentId, tournamentId)),
    ]);

    const validCatIds = new Set(tournamentCategories.map((c) => c.id));
    for (const a of validAssignments) {
      if (!validCatIds.has(a.category_id)) {
        return { success: false, error: `Category ${a.category_id} does not belong to this tournament` };
      }
    }

    const ringIds = rings.map((r) => r.id);
    const validRingIds = new Set(ringIds);
    for (const a of validAssignments) {
      if (!validRingIds.has(a.ring_id!)) {
        return { success: false, error: `Tatami ${a.ring_id} does not belong to this tournament` };
      }
      if (!Number.isInteger(a.queue_order) || a.queue_order < 0 || a.queue_order > 100000) {
        return { success: false, error: "Invalid queue order" };
      }
    }

    // 3. Fetch current live assignments to preserve matches_completed and guard running categories
    let currentAssignments: CategoryAssignmentRow[] = [];
    if (ringIds.length > 0) {
      currentAssignments = await db
        .select()
        .from(categoryAssignmentsTable)
        .where(inArray(categoryAssignmentsTable.ringId, ringIds));
    }

    const currentCard = new Map<string, CategoryAssignmentRow>();
    for (const a of currentAssignments) currentCard.set(cardKey(a.categoryId, a.part), a);
    const splitCategoryIds = new Set(currentAssignments.filter((a) => a.part !== "ALL").map((a) => a.categoryId));

    // The board has to be showing the cards that exist. If the category was split, merged or redrawn since
    // the board loaded, ask it to reload rather than guess.
    for (const a of cleanAssignments) {
      const part = partOfInput(a);
      const isSplit = splitCategoryIds.has(a.category_id);
      if (a.ring_id === null && isSplit) return { success: false, error: `SPLIT_CATEGORY_CHANGED:${a.category_id}` };
      if (a.ring_id === null) continue;
      if (part === "ALL" && isSplit) return { success: false, error: `LAYOUT_CHANGED:${a.category_id}` };
      if (part !== "ALL") {
        const current = currentCard.get(cardKey(a.category_id, part));
        if (!current) return { success: false, error: `LAYOUT_CHANGED:${a.category_id}` };
        if (current.ringId !== a.ring_id) return { success: false, error: `PART_MOVE_USES_ROUTING:${a.category_id}` };
      }
    }

    const currentMap = new Map<string, { status: string; matchesCompleted: number; completedAt: Date | null }>();
    currentCard.forEach((a, key) => {
      currentMap.set(key, {
        status: a.status,
        matchesCompleted: a.matchesCompleted ?? 0,
        completedAt: a.completedAt,
      });
    });

    // 4. Guard: reject if a running/paused card is displaced from queue_order 0
    for (const a of validAssignments) {
      const live = currentMap.get(cardKey(a.category_id, partOfInput(a)));
      if (live && (live.status === "running" || live.status === "paused")) {
        if (a.queue_order !== 0) {
          return { success: false, error: `RUNNING_CATEGORY_DISPLACED:${a.category_id}` };
        }
      }
    }

    // 5. Atomic database transaction
    await db.transaction(async (tx) => {
      // Remove whole categories that were moved out of all rings (now unassigned). A split category is
      // never dropped by a save.
      const incomingKeys = new Set(validAssignments.map((a) => cardKey(a.category_id, partOfInput(a))));
      const toDelete = Array.from(currentCard.values())
        .filter((a) => a.part === "ALL" && !incomingKeys.has(cardKey(a.categoryId, a.part)))
        .map((a) => a.categoryId);

      if (toDelete.length > 0) {
        await tx
          .delete(categoryAssignmentsTable)
          .where(
            and(
              inArray(categoryAssignmentsTable.categoryId, toDelete),
              ringIds.length > 0 ? inArray(categoryAssignmentsTable.ringId, ringIds) : undefined
            )
          );
      }
      const deleted = new Set(toDelete);

      if (validAssignments.length > 0) {
        const rows = validAssignments.map((a) => {
          const part = partOfInput(a);
          const live = currentMap.get(cardKey(a.category_id, part));
          const isExplicitRevert = a.status === "pending" && live?.status === "completed";
          return {
            ringId: a.ring_id!,
            categoryId: a.category_id,
            part,
            queueOrder: a.queue_order,
            status:
              isExplicitRevert || a.status === "pending"
                ? "pending"
                : live?.status === "running" || live?.status === "paused"
                ? live.status
                : a.status === "completed"
                ? "completed"
                : "pending",
            matchesCompleted: isExplicitRevert ? 0 : (live?.matchesCompleted ?? 0),
            completedAt:
              isExplicitRevert || a.status === "pending"
                ? null
                : a.status === "completed"
                ? live?.completedAt || (a.completed_at ? new Date(a.completed_at) : new Date())
                : null,
          };
        });

        const existingRows = rows.filter((r) => currentMap.has(cardKey(r.categoryId, r.part)));
        const newRows = rows.filter((r) => !currentMap.has(cardKey(r.categoryId, r.part)));
        const placedKeys = new Set(rows.map((r) => cardKey(r.categoryId, r.part)));
        const touchedRings = new Set(rows.map((r) => r.ringId));

        // Cards this save does not mention but that share a tatami with ones it places keep their
        // place relative to the placed cards.
        const stillHere = currentAssignments.filter(
          (a) => touchedRings.has(a.ringId) && !deleted.has(a.categoryId) && !placedKeys.has(cardKey(a.categoryId, a.part))
        );

        const finalOrder = new Map<string, number>();
        for (const ringId of touchedRings) {
          const held = stillHere.filter((a) => a.ringId === ringId);
          if (held.length === 0) continue; // nothing to share the queue with: keep the board's own numbers
          const items = [
            ...rows
              .filter((r) => r.ringId === ringId)
              .map((r) => ({
                key: cardKey(r.categoryId, r.part),
                queueOrder: r.queueOrder,
                onMat: r.status === "running" || r.status === "paused",
                placed: true,
              })),
            ...held.map((a) => ({
              key: cardKey(a.categoryId, a.part),
              queueOrder: a.queueOrder,
              onMat: a.status === "running" || a.status === "paused",
              placed: false,
            })),
          ];
          for (const [key, position] of sequenceQueue(items)) finalOrder.set(key, position);
        }
        const orderOf = (categoryId: string, part: string, boardOrder: number) =>
          finalOrder.get(cardKey(categoryId, part)) ?? boardOrder;

        const sameCard = (c: { categoryId: string; part: string }) =>
          and(eq(categoryAssignmentsTable.categoryId, c.categoryId), eq(categoryAssignmentsTable.part, c.part));

        // (ring_id, queue_order) is unique, so park every row being moved on a
        // temporary negative slot first; otherwise swapping two categories'
        // positions collides halfway through.
        let parking = -1;
        for (const r of existingRows) {
          await tx.update(categoryAssignmentsTable).set({ queueOrder: parking-- }).where(sameCard(r));
        }
        for (const a of stillHere) {
          await tx.update(categoryAssignmentsTable).set({ queueOrder: parking-- }).where(sameCard(a));
        }

        // Update existing rows in place
        for (const r of existingRows) {
          await tx
            .update(categoryAssignmentsTable)
            .set({
              ringId: r.ringId,
              queueOrder: orderOf(r.categoryId, r.part, r.queueOrder),
              status: r.status,
              matchesCompleted: r.matchesCompleted,
              completedAt: r.completedAt,
            })
            .where(sameCard(r));
        }
        for (const a of stillHere) {
          await tx
            .update(categoryAssignmentsTable)
            .set({ queueOrder: orderOf(a.categoryId, a.part, a.queueOrder) })
            .where(sameCard(a));
        }

        // Insert new rows
        if (newRows.length > 0) {
          await tx
            .insert(categoryAssignmentsTable)
            .values(newRows.map((r) => ({ ...r, queueOrder: orderOf(r.categoryId, r.part, r.queueOrder) })));
        }
      }
    });

    await audit({
      tournamentId,
      actor: admin,
      action: "ASSIGNMENTS_SAVED",
      before: currentAssignments.map((a) => ({ categoryId: a.categoryId, part: a.part, ringId: a.ringId, queueOrder: a.queueOrder, status: a.status })),
      after: validAssignments.map((a) => ({ categoryId: a.category_id, part: partOfInput(a), ringId: a.ring_id, queueOrder: a.queue_order })),
    });

    // Broadcast immediately so Mod, Organiser, Stager receive updates with zero latency
    broadcastLiveEvent({
      table: "category_assignments",
      op: "UPDATE",
      tournamentId,
    });
    for (const rId of ringIds) {
      broadcastLiveEvent({
        table: "category_assignments",
        op: "UPDATE",
        ringId: rId,
        tournamentId,
      });
    }

    return { success: true };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Unexpected error while saving assignments";
    console.error("Unexpected error in saveAssignments:", err);
    return { success: false, error: errorMessage };
  }
}

/** Queue state for the given tatamis. All must belong to one tournament the caller staffs. */
export async function getBalancingAssignments(ringIds: string[]) {
  const ids = (Array.isArray(ringIds) ? ringIds : []).filter(isValidUuid).slice(0, 200);
  if (ids.length === 0) return [];

  const owners = await db
    .select({ tournamentId: ringsTable.tournamentId })
    .from(ringsTable)
    .where(inArray(ringsTable.id, ids));
  const tournamentIds = new Set(owners.map((o) => o.tournamentId));
  if (tournamentIds.size !== 1) return [];
  await requireTournamentStaff([...tournamentIds][0]);

  try {
    await healPartSizes(ids);
    const rows = await db
      .select()
      .from(categoryAssignmentsTable)
      .where(inArray(categoryAssignmentsTable.ringId, ids));

    return rows.map((row) => ({
      category_id: row.categoryId,
      part: row.part,
      part_athletes: row.partAthletes,
      part_matches: row.partMatches,
      ring_id: row.ringId,
      matches_completed: row.matchesCompleted || 0,
      status: row.status || "pending",
      queue_order: row.queueOrder ?? 0,
      stager_status: row.stagerStatus ?? null,
      stager_name: row.stagerName ?? null,
    }));
  } catch (err) {
    console.error("Failed to fetch balancing assignments:", err);
    return [];
  }
}
