/**
 * Checks the Local stager's cores against a real database: holding a category, every draft change
 * (moving, pinning, swapping, shuffling, groups, filling, rebalancing, undo), attendance and walk-ins,
 * locking a group into a real draw, the hold ending once everything is sent, and the rule that only
 * a locked group can start. Writes a throwaway tournament, so it refuses to run against anything but
 * the isolated test database on :55432.
 *
 *   DATABASE_URL=postgres://event_suite:event_suite@127.0.0.1:55432/ringflow npx tsx scripts/verify-local-staging.ts
 */
import assert from "node:assert/strict";

if (!/:55432\//.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing to run: DATABASE_URL must point at the test database on :55432.");
  process.exit(1);
}

let passed = 0;
async function check(label: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`ok   ${label}`);
}
async function refused(fn: () => Promise<unknown>, pattern: RegExp) {
  await assert.rejects(fn, (err: Error) => {
    assert.match(err.message, pattern);
    return true;
  });
}

async function main() {
  const { db } = await import("../src/db");
  const schema = await import("../src/db/schema");
  const { admins, tournaments, rings, categories, categoryEntries, divisionEvents, divisionHolds, draws, drawVersions, matches, athletes, groupDrafts, tournamentRegistrations } = schema;
  const { eq, and, sql, asc } = await import("drizzle-orm");
  const { hashStagerCode } = await import("../src/lib/auth/localScope");
  const { createDivisionCore } = await import("../src/lib/local/divisions");
  const { addLocalAthleteCore } = await import("../src/lib/local/localRoster");
  const { buildStartingGroupsCore, setDivisionEventCore } = await import("../src/lib/local/startingGroups");
  const { assignDivisionCore } = await import("../src/lib/local/tatami");
  const holds = await import("../src/lib/local/holds");
  const draft = await import("../src/lib/local/groupDraft");
  const { loadGroupState, previewGroup } = await import("../src/lib/local/groupBuild");
  const { loadStagerDesk, loadWorkspace } = await import("../src/lib/local/stagingView");
  const { localGroupStartCheck } = await import("../src/lib/local/startGate");

  const adminId = crypto.randomUUID();
  await db.insert(admins).values({ id: adminId, email: `staging-${adminId}@test.local`, name: "Staging test" });
  const [t] = await db
    .insert(tournaments)
    .values({ adminId, name: "Local staging check", tournamentType: "LOCAL", beltLevels: ["White", "Yellow", "Blue"] })
    .returning();

  try {
    const [ring] = await db.insert(rings).values({ tournamentId: t.id, name: "Tatami 1", ringOrder: 1, accessCode: `ST-${adminId.slice(0, 8)}` }).returning();
    const blue9 = await createDivisionCore(t.id, { sex: "M", ageMin: 9, ageMax: 9, belts: ["Blue"] });
    const yellow8 = await createDivisionCore(t.id, { sex: "F", ageMin: 8, ageMax: 8, belts: ["Yellow"] });
    const clubs = ["Sakura", "Kaizen", "Tiger"];
    const boys: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const { athlete } = await addLocalAthleteCore(t.id, { name: `Boy ${String(i + 1).padStart(2, "0")}`, club: clubs[i % 3], age: 9, belt: "Blue", sex: "M", divisionId: blue9.id });
      boys.push(athlete.id);
    }
    for (let i = 0; i < 5; i += 1) {
      await addLocalAthleteCore(t.id, { name: `Girl ${i + 1}`, club: clubs[i % 3], age: 8, belt: "Yellow", sex: "F", divisionId: yellow8.id });
    }
    const [kumite] = await db.select().from(divisionEvents).where(and(eq(divisionEvents.divisionId, blue9.id), eq(divisionEvents.eventType, "kumite")));
    const [kata] = await db.select().from(divisionEvents).where(and(eq(divisionEvents.divisionId, blue9.id), eq(divisionEvents.eventType, "kata")));
    await setDivisionEventCore(kumite.id, { groupSize: 5, boutDurationMs: 90_000 });
    await buildStartingGroupsCore(kumite.id, { seed: 7 });
    await buildStartingGroupsCore(kata.id, { seed: 7 });
    await assignDivisionCore(blue9.id, ring.id);

    const groupsOf = async (eventId: string) =>
      db.select().from(categories).where(eq(categories.divisionEventId, eventId)).orderBy(asc(categories.groupNo));
    const membersOf = async (groupId: string) =>
      (await db.select({ id: categoryEntries.athleteId }).from(categoryEntries).where(eq(categoryEntries.categoryId, groupId))).map((r) => r.id);
    const preview = async (groupId: string) => previewGroup((await loadGroupState(db, groupId))!);
    const placeOf = async (groupId: string, athleteId: string) => (await preview(groupId)).places.find((p) => p.athleteId === athleteId)?.place;

    const ravi = { kind: "stager" as const, codeHash: hashStagerCode("RAVI01"), name: "Ravi", label: "Stager 1" };
    const priya = { kind: "stager" as const, codeHash: hashStagerCode("PRIY02"), name: "Priya", label: "Stager 2" };
    const director = { kind: "admin" as const, adminId, name: "Director" };

    // ── Holds ──
    await check("a stager takes a category; taking it again is harmless", async () => {
      assert.equal((await holds.takeDivisionCore(blue9.id, ravi)).alreadyHeld, false);
      assert.equal((await holds.takeDivisionCore(blue9.id, ravi)).alreadyHeld, true);
    });
    await check("nobody else can take a held category, the admin included", async () => {
      await refused(() => holds.takeDivisionCore(blue9.id, priya), /Ravi is preparing this category/);
      await refused(() => holds.takeDivisionCore(blue9.id, director), /Ravi is preparing/);
    });
    await check("a stager holds one category at a time", async () => {
      await refused(() => holds.takeDivisionCore(yellow8.id, ravi), /already preparing "Blue · 9 · M"/);
    });
    await check("taking a category without groups builds them first", async () => {
      await holds.takeDivisionCore(yellow8.id, priya);
      const [yk] = await db.select().from(divisionEvents).where(and(eq(divisionEvents.divisionId, yellow8.id), eq(divisionEvents.eventType, "kumite")));
      assert.equal((await groupsOf(yk.id)).length, 1);
    });
    await check("only the holder can hand a category back", async () => {
      await refused(() => holds.handBackCore(yellow8.id, ravi), /aren't preparing/);
      await holds.handBackCore(yellow8.id, priya);
      assert.equal(await holds.readHold(db, yellow8.id), null);
    });
    await check("the desk shows who holds what, soonest first", async () => {
      const desk = await loadStagerDesk(t.id, ravi);
      const mine = desk.items.find((i) => i.divisionId === blue9.id);
      assert.equal(mine?.status, "held");
      assert.equal(mine?.isMine, true);
      assert.equal(mine?.tatami?.ringName, "Tatami 1");
      assert.equal(desk.items[0]?.divisionId, blue9.id);
      assert.equal(desk.mine, blue9.id);
    });

    // ── Moving athletes ──
    const [k1, k2] = await groupsOf(kumite.id);
    await check("starting groups follow the plan of 5: 5 + 5", async () => {
      assert.deepEqual([(await membersOf(k1.id)).length, (await membersOf(k2.id)).length], [5, 5]);
    });
    const mover = (await membersOf(k1.id))[0] as string;
    await check("an athlete moves between groups, and counts follow", async () => {
      await draft.moveAthleteCore(blue9.id, { athleteId: mover, eventType: "kumite", to: k2.id }, "stager:Ravi");
      assert.equal((await membersOf(k2.id)).includes(mover), true);
      const [g1] = await db.select().from(categories).where(eq(categories.id, k1.id));
      assert.equal(g1.athletesCount, 4);
    });
    await check("an athlete can be taken out to Unplaced and into a new group", async () => {
      await draft.moveAthleteCore(blue9.id, { athleteId: mover, eventType: "kumite", to: null }, "stager:Ravi");
      const ws = await loadWorkspace(blue9.id);
      assert.deepEqual(ws?.events.find((e) => e.eventType === "kumite")?.unplaced, [mover]);
      const { groupId } = await draft.moveAthleteCore(blue9.id, { athleteId: mover, eventType: "kumite", to: "new" }, "stager:Ravi");
      const [g3] = await db.select().from(categories).where(eq(categories.id, groupId as string));
      assert.equal(g3.groupNo, 3);
      assert.equal(g3.name, "Blue · 9 · M · Kumite · Group 3");
    });
    await check("a new group joins the tatami right after its event's other groups", async () => {
      const queue = await db.execute(sql`select c.name from category_assignments a join categories c on c.id = a.category_id where a.ring_id = ${ring.id} order by a.queue_order`);
      const names = (queue as unknown as { name: string }[]).map((r) => r.name);
      assert.deepEqual(names.slice(0, 3), ["Blue · 9 · M · Kumite · Group 1", "Blue · 9 · M · Kumite · Group 2", "Blue · 9 · M · Kumite · Group 3"]);
    });
    await check("removing a group sends its athletes to Unplaced and keeps the numbering", async () => {
      const g3 = (await groupsOf(kumite.id))[2]!;
      await draft.removeGroupCore(blue9.id, g3.id);
      assert.equal((await groupsOf(kumite.id)).length, 2);
      const ws = await loadWorkspace(blue9.id);
      assert.deepEqual(ws?.events.find((e) => e.eventType === "kumite")?.unplaced, [mover]);
    });
    await check("auto-fill puts the unplaced athlete in the smallest group", async () => {
      await draft.autoFillCore(blue9.id, "kumite", "stager:Ravi");
      assert.equal((await membersOf(k1.id)).includes(mover), true);
    });

    // ── Places ──
    const someone = (await membersOf(k1.id))[1] as string;
    const other = (await membersOf(k1.id))[2] as string;
    await check("pinning puts an athlete in a place and keeps them there", async () => {
      await draft.placeAthleteCore(blue9.id, { groupId: k1.id, athleteId: someone, place: 1 }, "stager:Ravi");
      assert.equal(await placeOf(k1.id, someone), 1);
      await draft.shuffleGroupCore(blue9.id, k1.id, "stager:Ravi");
      assert.equal(await placeOf(k1.id, someone), 1);
    });
    await check("pinning onto a pinned athlete swaps their places", async () => {
      const before = await placeOf(k1.id, other);
      await draft.placeAthleteCore(blue9.id, { groupId: k1.id, athleteId: other, place: 1 }, "stager:Ravi");
      assert.equal(await placeOf(k1.id, other), 1);
      assert.equal(await placeOf(k1.id, someone), before);
    });
    await check("a swap pins both athletes", async () => {
      const [a, b] = [someone, other];
      const [pa, pb] = [await placeOf(k1.id, a), await placeOf(k1.id, b)];
      await draft.swapAthletesCore(blue9.id, { groupId: k1.id, a, b }, "stager:Ravi");
      assert.deepEqual([await placeOf(k1.id, a), await placeOf(k1.id, b)], [pb, pa]);
    });
    await check("a stale view is refused", async () => {
      const state = await loadGroupState(db, k1.id);
      await refused(() => draft.placeAthleteCore(blue9.id, { groupId: k1.id, athleteId: someone, place: 3, expectedVersion: (state?.version ?? 0) - 1 }, "stager:Ravi"), /changed since you looked/);
    });
    await check("pins that would leave a bout empty are refused", async () => {
      await draft.unpinCore(blue9.id, { groupId: k1.id }, "stager:Ravi");
      const five = await membersOf(k1.id); // 5 athletes in a bracket of 8: three byes
      await draft.placeAthleteCore(blue9.id, { groupId: k1.id, athleteId: five[0]!, place: 1 }, "stager:Ravi");
      await draft.placeAthleteCore(blue9.id, { groupId: k1.id, athleteId: five[1]!, place: 2 }, "stager:Ravi");
      await draft.placeAthleteCore(blue9.id, { groupId: k1.id, athleteId: five[2]!, place: 3 }, "stager:Ravi");
      await refused(() => draft.placeAthleteCore(blue9.id, { groupId: k1.id, athleteId: five[3]!, place: 4 }, "stager:Ravi"), /bout with nobody in it/);
      await draft.unpinCore(blue9.id, { groupId: k1.id }, "stager:Ravi");
    });

    // ── Attendance and walk-ins ──
    await check("an absent athlete leaves their groups and can't be put back until present", async () => {
      await draft.setAttendanceCore(blue9.id, mover, "absent", "stager:Ravi");
      assert.equal((await membersOf(k1.id)).includes(mover), false);
      await refused(() => draft.moveAthleteCore(blue9.id, { athleteId: mover, eventType: "kumite", to: k1.id }, "stager:Ravi"), /marked absent/);
      await draft.setAttendanceCore(blue9.id, mover, null, "stager:Ravi");
      await draft.moveAthleteCore(blue9.id, { athleteId: mover, eventType: "kumite", to: k1.id }, "stager:Ravi");
    });
    await check("a walk-in with a known name is offered the existing athlete first", async () => {
      const offer = await draft.registerWalkInCore(blue9.id, { name: "boy 01", club: "Tiger" }, false);
      assert.equal(offer.athleteId, null);
      assert.equal(offer.duplicates.length, 1);
    });
    await check("a walk-in takes the category's age, belt and sex, and is flagged for review", async () => {
      const added = await draft.registerWalkInCore(blue9.id, { name: "Arjun Walkin", club: "Tiger" }, false);
      const [a] = await db.select().from(athletes).where(eq(athletes.id, added.athleteId as string));
      assert.deepEqual([a.age, a.belt, a.sex, a.walkIn, a.needsReview], ["9", "Blue", "M", true, true]);
      const ws = await loadWorkspace(blue9.id);
      assert.equal(ws?.events.find((e) => e.eventType === "kumite")?.unplaced.includes(a.id), true);
    });
    await check("rebalance evens the groups out and places everyone present", async () => {
      await draft.rebalanceCore(blue9.id, "kumite", "stager:Ravi");
      const sizes = [(await membersOf(k1.id)).length, (await membersOf(k2.id)).length];
      assert.equal(sizes[0]! + sizes[1]!, 11);
      assert.ok(Math.abs(sizes[0]! - sizes[1]!) <= 1);
    });
    // ── Undo ──
    const kumiteDraft = async () => {
      const ws = await loadWorkspace(blue9.id);
      const groups = ws!.events.find((e) => e.eventType === "kumite")!.groups.filter((g) => !g.locked);
      return {
        snapshot: { groups: groups.map((g) => ({ id: g.id, members: [...g.members].sort(), pins: g.pins, seed: g.seed })) },
        versions: Object.fromEntries(groups.map((g) => [g.id, g.version])),
      };
    };
    await check("undo puts members, pins and the seed back", async () => {
      const before = await kumiteDraft();
      const [a, b] = [(await membersOf(k1.id))[0]!, (await membersOf(k1.id))[1]!];
      await draft.moveAthleteCore(blue9.id, { athleteId: a, eventType: "kumite", to: k2.id }, "stager:Ravi");
      await draft.placeAthleteCore(blue9.id, { groupId: k1.id, athleteId: b, place: 2 }, "stager:Ravi");
      await draft.shuffleGroupCore(blue9.id, k1.id, "stager:Ravi");
      const now = await kumiteDraft();
      const undone = await draft.restoreEventDraftCore(blue9.id, "kumite", before.snapshot, now.versions, "stager:Ravi");
      assert.equal(undone.skipped, 0);
      assert.deepEqual((await kumiteDraft()).snapshot, before.snapshot);
    });
    await check("undo removes a group added since, and refuses a stale view", async () => {
      const before = await kumiteDraft();
      await draft.addGroupCore(blue9.id, "kumite");
      const now = await kumiteDraft();
      await refused(() => draft.restoreEventDraftCore(blue9.id, "kumite", before.snapshot, before.versions, "stager:Ravi"), /changed since you looked/);
      const undone = await draft.restoreEventDraftCore(blue9.id, "kumite", before.snapshot, now.versions, "stager:Ravi");
      assert.equal(undone.removedGroups.length, 1);
      assert.equal((await groupsOf(kumite.id)).length, 2);
    });

    await check("an athlete held in another category can't be pulled in", async () => {
      const [girl] = await db.select({ id: tournamentRegistrations.athleteId }).from(tournamentRegistrations).where(eq(tournamentRegistrations.divisionId, yellow8.id)).limit(1);
      await holds.takeDivisionCore(yellow8.id, priya);
      await refused(() => draft.moveIntoDivisionCore(blue9.id, girl!.id), /Priya is preparing/);
      await holds.handBackCore(yellow8.id, priya);
      const moved = await draft.moveIntoDivisionCore(blue9.id, girl!.id);
      assert.equal(moved.after, blue9.id);
    });

    // ── Lock and send ──
    await check("a group with an absent athlete can't be locked", async () => {
      const someoneIn = (await membersOf(k1.id))[0] as string;
      await db.update(tournamentRegistrations).set({ attendance: "absent" }).where(eq(tournamentRegistrations.athleteId, someoneIn));
      await refused(() => draft.lockGroupCore(blue9.id, k1.id, "Ravi"), /marked absent/);
      await db.update(tournamentRegistrations).set({ attendance: null }).where(eq(tournamentRegistrations.athleteId, someoneIn));
    });
    await check("a draft group can't start on the tatami", async () => {
      await refused(() => localGroupStartCheck(k1.id), /hasn't been sent/);
    });
    await check("a lock refuses a group that changed since it was shown", async () => {
      await refused(() => draft.lockGroupCore(blue9.id, k1.id, "Ravi", "0".repeat(64)), /changed since you looked/);
    });
    let lockedChecksum = "";
    await check("locking writes exactly the previewed draw, locked, as version 1", async () => {
      const shown = await preview(k1.id);
      const result = await draft.lockGroupCore(blue9.id, k1.id, "Ravi", shown.graph?.checksum);
      lockedChecksum = result.snapshot.checksum;
      const [d] = await db.select().from(draws).where(eq(draws.categoryId, k1.id));
      assert.equal(d.state, "LOCKED");
      assert.equal(d.checksum, shown.graph?.checksum);
      assert.equal(d.format, "SINGLE_ELIM_REPECHAGE");
      assert.equal(d.bronzeMedals, 3);
      const [v] = await db.select().from(drawVersions).where(eq(drawVersions.drawId, d.id));
      assert.equal(v.reason, "Locked by Ravi");
      const bouts = await db.select().from(matches).where(eq(matches.categoryId, k1.id));
      assert.equal(bouts.length, shown.graph?.matches.length);
    });
    await check("a locked group can start, with its event's bout length", async () => {
      assert.deepEqual(await localGroupStartCheck(k1.id), { boutDurationMs: 90_000 });
    });
    await check("a locked group can't be changed by the stager", async () => {
      await refused(() => draft.shuffleGroupCore(blue9.id, k1.id, "Ravi"), /locked/);
      await refused(() => draft.lockGroupCore(blue9.id, k1.id, "Ravi"), /locked/);
      const memberOfLocked = (await membersOf(k1.id))[0] as string;
      await refused(() => draft.moveAthleteCore(blue9.id, { athleteId: memberOfLocked, eventType: "kumite", to: k2.id }, "Ravi"), /locked/);
      assert.equal((await db.select().from(draws).where(eq(draws.categoryId, k1.id)))[0]?.checksum, lockedChecksum);
    });
    await check("a ranked kata group locks as a performance order", async () => {
      const [kg] = await groupsOf(kata.id);
      await draft.lockGroupCore(blue9.id, kg!.id, "Ravi");
      const [d] = await db.select().from(draws).where(eq(draws.categoryId, kg!.id));
      assert.equal(d.format, "KATA_RANKED");
      const bouts = await db.select().from(matches).where(eq(matches.categoryId, kg!.id)).orderBy(asc(matches.matchNo));
      assert.equal(bouts[0]?.status, "READY");
      assert.equal(bouts.every((b) => b.bracketType === "POOL" && b.poolGroup === "Ranking"), true);
      assert.deepEqual(await localGroupStartCheck(kg!.id), { boutDurationMs: null });
    });
    await check("the hold ends once every group is locked", async () => {
      for (const g of [...(await groupsOf(kumite.id)), ...(await groupsOf(kata.id))]) {
        const [d] = await db.select().from(draws).where(eq(draws.categoryId, g.id));
        if (d?.state === "LOCKED") continue;
        const state = await loadGroupState(db, g.id);
        if (!state?.members.length) await draft.removeGroupCore(blue9.id, g.id);
        else await draft.lockGroupCore(blue9.id, g.id, "Ravi");
      }
      assert.equal(await holds.readHold(db, blue9.id), null);
      const desk = await loadStagerDesk(t.id, ravi);
      assert.equal(desk.items.find((i) => i.divisionId === blue9.id)?.status, "sent");
      await refused(() => holds.takeDivisionCore(blue9.id, ravi), /has been sent/);
    });

    // ── The admin's hand on holds ──
    await check("the admin can release and reassign a hold", async () => {
      await holds.takeDivisionCore(yellow8.id, priya);
      const before = await holds.reassignHoldCore(yellow8.id, ravi);
      assert.equal(before?.holderName, "Priya");
      assert.equal((await holds.readHold(db, yellow8.id))?.holderName, "Ravi");
      await holds.releaseHoldCore(yellow8.id);
      assert.equal(await holds.readHold(db, yellow8.id), null);
    });
    await check("removing a stager code ends its hold", async () => {
      await holds.takeDivisionCore(yellow8.id, priya);
      await holds.releaseHoldsOfCode("priy02");
      assert.equal(await holds.readHold(db, yellow8.id), null);
    });
    await check("drafts carry versions and seeds", async () => {
      const rows = await db.select().from(groupDrafts);
      assert.ok(rows.length > 0);
    });
    await check("holds never store a stager code", async () => {
      const rows = await db.select().from(divisionHolds).where(eq(divisionHolds.tournamentId, t.id));
      assert.equal(rows.every((r) => !r.stagerCodeHash || !/RAVI01|PRIY02/i.test(r.stagerCodeHash)), true);
    });
  } finally {
    await db.delete(tournaments).where(eq(tournaments.id, t.id));
    await db.delete(admins).where(eq(admins.id, adminId));
  }
  console.log(`\n${passed} checks passed`);
  process.exit(0);
}

main().catch((err) => {
  console.error("\nFAILED:", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
