import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The authorization guards with the database and cookies replaced by plain
 * data: who is calling (`principals`, `judge`), who owns which tournament
 * (`owners`), and where tatamis / bouts belong (`rings`, `matchScope`).
 */
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const R1 = "33333333-3333-4333-8333-333333333333";
const R2 = "44444444-4444-4444-8444-444444444444";
const D1 = "66666666-6666-4666-8666-666666666666";
const D2 = "77777777-7777-4777-8777-777777777777";

const state = vi.hoisted(() => ({
  principals: [] as Array<Record<string, unknown>>,
  judge: null as Record<string, unknown> | null,
  owners: new Map<string, string>(),
  rings: new Map<string, string>(),
  matchScope: null as Record<string, unknown> | null,
  tournamentTypes: new Map<string, string>(),
  divisions: new Map<string, { tournamentId: string; tournamentType: string }>(),
  holds: new Map<string, { holderKind: string; stagerCodeHash: string | null; adminId: string | null }>(),
  stagerCodes: new Map<string, string>(),
}));

vi.mock("react", () => ({ cache: <T,>(fn: T) => fn }));
vi.mock("drizzle-orm", () => ({ eq: (_col: unknown, value: unknown) => ({ value }) }));
vi.mock("@/db/schema", () => ({ tournaments: { id: "id", adminId: "admin_id" } }));
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (cond: { value: string }) => ({
          limit: async () => (state.owners.has(cond.value) ? [{ adminId: state.owners.get(cond.value) }] : []),
        }),
      }),
    }),
  },
}));
vi.mock("./principal", () => ({
  getPrincipals: async () => state.principals,
  getAdminPrincipal: async () => state.principals.find((p) => p.role === "admin") ?? null,
  getJudgePrincipal: async () => state.judge,
}));
vi.mock("./scope", () => ({
  tournamentIdForRing: async (ringId: string) => {
    const t = state.rings.get(ringId);
    if (!t) throw new Error("Tatami not found");
    return t;
  },
  scopeForMatch: async () => state.matchScope,
}));

vi.mock("./localScope", async () => {
  const { AuthError } = await import("./errors");
  return {
    tournamentTypeOf: async (tournamentId: string) => {
      const type = state.tournamentTypes.get(tournamentId);
      if (!type) throw new AuthError("Tournament not found", "NOT_FOUND");
      return type;
    },
    scopeForDivision: async (divisionId: string) => {
      const d = state.divisions.get(divisionId);
      if (!d) throw new AuthError("Category not found", "NOT_FOUND");
      return { divisionId, ...d };
    },
    holdOfDivision: async (divisionId: string) => state.holds.get(divisionId) ?? null,
    stagerCodeHashFor: async (requestId: string) => state.stagerCodes.get(requestId) ?? null,
  };
});

const guards = await import("./guards");

const admin = (adminId: string) => ({ role: "admin", adminId, name: "Director", sessionId: "s" });
const staff = (role: string, tournamentId: string, extra: Record<string, unknown> = {}) => ({
  role,
  requestId: `${role}-req`,
  name: role,
  tournamentId,
  ...extra,
});

beforeEach(() => {
  state.principals = [];
  state.judge = null;
  state.owners = new Map([
    [T1, "admin-a"],
    [T2, "admin-b"],
  ]);
  state.rings = new Map([
    [R1, T1],
    [R2, T2],
  ]);
  state.matchScope = null;
  state.tournamentTypes = new Map([
    [T1, "LOCAL"],
    [T2, "OFFICIAL"],
  ]);
  state.divisions = new Map([
    [D1, { tournamentId: T1, tournamentType: "LOCAL" }],
    [D2, { tournamentId: T2, tournamentType: "OFFICIAL" }],
  ]);
  state.holds = new Map();
  state.stagerCodes = new Map([
    ["stager-1", "hash-code-1"],
    ["stager-2", "hash-code-2"],
  ]);
});

describe("admin tenancy", () => {
  it("refuses anyone who is not signed in", async () => {
    await expect(guards.requireAdmin()).rejects.toThrow(/Not authenticated/);
  });

  it("lets an admin into their own tournament only", async () => {
    state.principals = [admin("admin-a")];
    await expect(guards.requireTournamentAdmin(T1)).resolves.toMatchObject({ adminId: "admin-a" });
    await expect(guards.requireTournamentAdmin(T2)).rejects.toThrow(/not yours/);
  });

  it("refuses an unknown tournament", async () => {
    state.principals = [admin("admin-a")];
    await expect(guards.requireTournamentAdmin("55555555-5555-4555-8555-555555555555")).rejects.toThrow();
  });
});

describe("tournament staff", () => {
  it("only counts floor staff for the tournament they were approved for", async () => {
    state.principals = [staff("organiser", T1)];
    expect(await guards.getTournamentStaff(T1)).toMatchObject({ role: "organiser" });
    expect(await guards.getTournamentStaff(T2)).toBeNull();
  });

  it("respects the allowed roles", async () => {
    state.principals = [staff("organiser", T1)];
    expect(await guards.getTournamentStaff(T1, ["admin", "stager"])).toBeNull();
    await expect(guards.requireTournamentStaff(T1, ["admin", "stager"])).rejects.toThrow();
  });

  it("does not count another admin's tournament", async () => {
    state.principals = [admin("admin-b")];
    expect(await guards.getTournamentStaff(T1)).toBeNull();
  });

  it("rejects a malformed tournament id without a lookup", async () => {
    state.principals = [admin("admin-a")];
    expect(await guards.getTournamentStaff("not-a-uuid")).toBeNull();
  });
});

describe("tatami control", () => {
  it("lets a moderator control only their own tatami", async () => {
    state.principals = [staff("moderator", T1, { ringId: R1 })];
    await expect(guards.requireRingModerator(R1)).resolves.toMatchObject({ role: "moderator" });
    await expect(guards.requireRingModerator(R2)).rejects.toThrow(/not the active moderator/);
  });

  it("lets the owning admin override a tatami, but not another admin's", async () => {
    state.principals = [admin("admin-a")];
    await expect(guards.requireRingOperator(R1)).resolves.toMatchObject({ role: "admin" });
    await expect(guards.requireRingOperator(R2)).rejects.toThrow(/Not authorized/);
  });

  it("never lets an organiser control a tatami", async () => {
    state.principals = [staff("organiser", T1)];
    await expect(guards.requireRingOperator(R1)).rejects.toThrow();
  });
});

describe("bout scoring", () => {
  it("requires the bout's category to be on the moderator's tatami and running", async () => {
    state.principals = [staff("moderator", T1, { ringId: R1 })];
    state.matchScope = { matchId: "m", categoryId: "c", tournamentId: T1, ringId: R1, assignmentStatus: "running" };
    await expect(guards.requireMatchModerator("m")).resolves.toMatchObject({ moderator: { role: "moderator" } });

    state.matchScope = { ...state.matchScope, assignmentStatus: "pending" };
    await expect(guards.requireMatchModerator("m")).rejects.toThrow(/Start this category/);

    state.matchScope = { ...state.matchScope, ringId: R2, assignmentStatus: "running" };
    await expect(guards.requireMatchModerator("m")).rejects.toThrow(/not the active moderator/);

    state.matchScope = { ...state.matchScope, ringId: null };
    await expect(guards.requireMatchModerator("m")).rejects.toThrow(/not assigned/);
  });

  it("does not let an admin score bouts", async () => {
    state.principals = [admin("admin-a")];
    state.matchScope = { matchId: "m", categoryId: "c", tournamentId: T1, ringId: R1, assignmentStatus: "running" };
    await expect(guards.requireMatchModerator("m")).rejects.toThrow();
  });
});

describe("judges", () => {
  it("accepts a judge only on their own tatami", async () => {
    state.judge = { role: "judge", sessionId: "j", name: "J", ringId: R1, seat: 2, tournamentId: T1 };
    await expect(guards.requireJudge(R1)).resolves.toMatchObject({ seat: 2 });
    await expect(guards.requireJudge(R2)).rejects.toThrow(/not an approved judge/);
  });

  it("never treats a judge as event staff", async () => {
    state.judge = { role: "judge", sessionId: "j", name: "J", ringId: R1, seat: 2, tournamentId: T1 };
    expect(await guards.getTournamentStaff(T1)).toBeNull();
    await expect(guards.requireRingOperator(R1)).rejects.toThrow();
  });
});

describe("Local tournaments", () => {
  const stager = (requestId: string, tournamentId = T1) => ({ role: "stager", requestId, name: requestId, tournamentId });

  it("refuses Local actions on an Official tournament", async () => {
    await expect(guards.requireLocalTournament(T1)).resolves.toBeUndefined();
    await expect(guards.requireLocalTournament(T2)).rejects.toThrow(/only available in a Local tournament/);
  });

  it("lets only the stager whose code holds the category change it", async () => {
    state.holds.set(D1, { holderKind: "stager", stagerCodeHash: "hash-code-1", adminId: null });

    state.principals = [stager("stager-1")];
    await expect(guards.requireDivisionHolder(D1)).resolves.toMatchObject({ principal: { requestId: "stager-1" } });

    state.principals = [stager("stager-2")];
    expect(await guards.getDivisionHolder(D1)).toBeNull();
    await expect(guards.requireDivisionHolder(D1)).rejects.toThrow(/Take this category/);
  });

  it("does not let a stager of another tournament through, even with the same code", async () => {
    state.holds.set(D1, { holderKind: "stager", stagerCodeHash: "hash-code-1", adminId: null });
    state.principals = [stager("stager-1", T2)];
    expect(await guards.getDivisionHolder(D1)).toBeNull();
  });

  it("does not let the admin edit a category a stager holds", async () => {
    state.holds.set(D1, { holderKind: "stager", stagerCodeHash: "hash-code-1", adminId: null });
    state.principals = [admin("admin-a")];
    expect(await guards.getDivisionHolder(D1)).toBeNull();
  });

  it("lets the owning admin edit a category the admin holds, but not another admin", async () => {
    state.holds.set(D1, { holderKind: "admin", stagerCodeHash: null, adminId: "admin-a" });
    state.principals = [admin("admin-a")];
    await expect(guards.requireDivisionHolder(D1)).resolves.toMatchObject({ principal: { role: "admin" } });

    state.holds.set(D1, { holderKind: "admin", stagerCodeHash: null, adminId: "admin-b" });
    state.principals = [admin("admin-b")];
    expect(await guards.getDivisionHolder(D1)).toBeNull();
  });

  it("refuses a category nobody holds, an Official tournament's division, and an unknown one", async () => {
    state.principals = [stager("stager-1"), admin("admin-a")];
    expect(await guards.getDivisionHolder(D1)).toBeNull();

    state.holds.set(D2, { holderKind: "stager", stagerCodeHash: "hash-code-1", adminId: null });
    state.principals = [stager("stager-1", T2)];
    expect(await guards.getDivisionHolder(D2)).toBeNull();

    expect(await guards.getDivisionHolder("88888888-8888-4888-8888-888888888888")).toBeNull();
  });
});

describe("describePrincipal", () => {
  it("names admins by admin id and floor staff by request id", () => {
    expect(guards.describePrincipal(admin("admin-a") as never)).toEqual({ role: "admin", id: "admin-a", name: "Director" });
    expect(guards.describePrincipal(staff("stager", T1) as never)).toMatchObject({ role: "stager", id: "stager-req" });
  });
});
