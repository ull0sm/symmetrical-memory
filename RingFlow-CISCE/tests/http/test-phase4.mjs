// Phase 4: judge panel — pairing, approval, seat ownership, voting window, void/override, server totals.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { BASE, Jar, call, check, loadActions, results } from "./rbac-lib.mjs";

const require = createRequire(process.env.APP_DIR + "/package.json");
const postgres = require("postgres");
const sql = postgres(process.env.DATABASE_URL, { max: 2 });
const A = loadActions();
const [T1, R1] = process.argv.slice(2);
const sha = (v) => createHash("sha256").update(v).digest("hex");
const denied = (r) => (r.status >= 300 && r.status < 400) || !r.ok || r.value?.success === false || r.value === null;
const lastAudit = async (action) =>
  (await sql`select * from audit_log where tournament_id=${T1} and action=${action} order by created_at desc limit 1`)[0];

// ── Setup: a kata category running on a second tatami, with its own moderator ──
const [R2row] = await sql`select id from rings where tournament_id=${T1} and id<>${R1} order by ring_order limit 1`;
const R2 = R2row.id;
const kataCats = await sql`
  select c.id from categories c join draws d on d.category_id=c.id
  where c.tournament_id=${T1} and (c.event_type in ('kata','team_kata') or c.name ilike '%kata%')`;
let KC = null, BOUT = null;
for (const c of kataCats) {
  const ms = await sql`select id, status from matches where category_id=${c.id} order by match_no`;
  const slots = ms.length ? await sql`select match_id, position, athlete_id from match_slots where match_id = any(${ms.map((m) => m.id)})` : [];
  const b = ms.find((m) => m.status !== "CONFIRMED" && slots.filter((s) => s.match_id === m.id && s.athlete_id).length === 2);
  if (b) { KC = c.id; BOUT = b.id; break; }
}
check("setup: found a kata bout with two athletes", Boolean(BOUT));
await sql`update category_assignments set status='pending' where ring_id=${R2} and status in ('running','paused')`;
await sql`delete from category_assignments where category_id=${KC}`;
await sql`insert into category_assignments (ring_id, category_id, queue_order, status) values (${R2}, ${KC}, 0, 'running')`;
await sql`update categories set kata_scoring_mode='FLAG' where id=${KC}`;
await sql`update matches set kata_scoring_mode='FLAG' where category_id=${KC}`;

const admin = new Jar();
await call(A, "signInWithAdminPassword", [{ email: "admin@ringflow.org", password: "admin123" }], admin);
const code = String(100000 + Math.floor(Math.random() * 899999));
await sql`update rings set access_code=${code} where id=${R2}`;
const mod = new Jar();
const req = await call(A, "requestModeratorAccess", [code, "Kata Moderator", {}, "offline-bypass"], mod);
await call(A, "approveModeratorRequest", [req.value.requestId, R2, T1], admin, `/admin/event/${T1}/rings`);
await call(A, "checkModeratorStatus", [req.value.requestId], mod);
const PAGE = `/moderator/ring/${R2}/current`;
const JPAGE = `/judge/ring/${R2}`;

// ── Panel access ──
const anon = new Jar();
check("anonymous cannot read the judge panel (PIN/QR)", denied(await call(A, "getJudgePanel", [R2], anon, PAGE)));
check("anonymous cannot open voting", denied(await call(A, "openKataVoting", [BOUT], anon, PAGE)));
const panel = await call(A, "getJudgePanel", [R2], mod, PAGE);
check("moderator reads the judge panel", panel.value?.success === true && /^\d{4}$/.test(panel.value.pin) && panel.value.pairingKey?.length >= 30);
const { pin, pairingKey } = panel.value;
check("judge panel of another tatami is refused", denied(await call(A, "getJudgePanel", [R1], mod, PAGE)));
const bout = await call(A, "getRingActiveBout", [R2], mod, PAGE);
check("moderator bout payload has no PIN fields", bout.value && !/judgePin|judge_pin|judgePairingKey|judge_pairing_key/.test(JSON.stringify(bout.value)));
check("bout payload never carries the pairing key", !JSON.stringify(bout.value ?? "").includes(pairingKey));

// ── Pairing ──
const j1 = new Jar();
check("wrong PIN refused", denied(await call(A, "requestJudgeSeat", [{ ringId: R2, pin: pin === "1111" ? "2222" : "1111", name: "Wrong", seat: 1 }], j1, JPAGE)));
check("wrong QR key refused", denied(await call(A, "requestJudgeSeat", [{ ringId: R2, key: "x".repeat(32), name: "Wrong", seat: 1 }], j1, JPAGE)));
const r1 = await call(A, "requestJudgeSeat", [{ ringId: R2, key: pairingKey, name: "Judge One", seat: 1 }], j1, JPAGE);
check("QR key pairing creates a pending request", r1.value?.status === "pending");
check("claim cookie is httpOnly", j1.flags?.judge_claim?.includes("httponly"));
check("pending judge cannot see the bout", denied(await call(A, "getJudgeBout", [R2], j1, JPAGE)));
check("pending judge cannot vote", denied(await call(A, "submitJudgeVote", [{ matchId: BOUT, flag: "AKA" }], j1, JPAGE)));

const j2 = new Jar();
await call(A, "requestJudgeSeat", [{ ringId: R2, pin, name: "Judge Two", seat: 2 }], j2, JPAGE);
const j3 = new Jar();
await call(A, "requestJudgeSeat", [{ ringId: R2, pin, name: "Judge Three", seat: 3 }], j3, JPAGE);

const sessions = (await call(A, "getJudgePanel", [R2], mod, PAGE)).value.sessions;
const sid = (n) => sessions.find((s) => s.judgeName === n)?.id;
check("desk sees the three waiting phones", ["Judge One", "Judge Two", "Judge Three"].every((n) => sid(n)));
check("anonymous cannot approve a judge", denied(await call(A, "approveJudge", [sid("Judge One")], anon, PAGE)));
for (const n of ["Judge One", "Judge Two", "Judge Three"]) await call(A, "approveJudge", [sid(n)], mod, PAGE);
check("approval is audited", (await lastAudit("JUDGE_APPROVED"))?.actor_name === "Kata Moderator");

const thief = new Jar();
check("a browser without the claim cannot collect the session", (await call(A, "getJudgeStatus", [R2], thief, JPAGE)).value?.status === "none");
const st1 = await call(A, "getJudgeStatus", [R2], j1, JPAGE);
check("approved phone collects its session", st1.value?.status === "approved" && st1.value?.seat === 1);
check("judge cookie is httpOnly", j1.flags?.judge_token?.includes("httponly"));
const tok = j1.c.get("judge_token");
const [row1] = await sql`select token_hash from judge_sessions where id=${sid("Judge One")}`;
check("only the judge token hash is stored", row1.token_hash === sha(tok) && row1.token_hash !== tok);
await call(A, "getJudgeStatus", [R2], j2, JPAGE);
await call(A, "getJudgeStatus", [R2], j3, JPAGE);

// ── Voting window ──
const jb = await call(A, "getJudgeBout", [R2], j1, JPAGE);
const jbText = JSON.stringify(jb.value ?? "");
check("judge bout view has no PIN, key or tokens", !jbText.includes(pin) && !jbText.includes(pairingKey) && !/token/i.test(jbText));
check("vote refused before voting opens", denied(await call(A, "submitJudgeVote", [{ matchId: BOUT, flag: "AKA" }], j1, JPAGE)));
check("judge cannot open voting", denied(await call(A, "openKataVoting", [BOUT], j1, PAGE)));
const opened = await call(A, "openKataVoting", [BOUT], mod, PAGE);
check("moderator opens voting", opened.value?.success === true);

check("judge 1 votes AKA", (await call(A, "submitJudgeVote", [{ matchId: BOUT, flag: "AKA" }], j1, JPAGE)).value?.success === true);
check("judge 1 may change their vote while open", (await call(A, "submitJudgeVote", [{ matchId: BOUT, flag: "AO" }], j1, JPAGE)).value?.success === true);
await call(A, "submitJudgeVote", [{ matchId: BOUT, flag: "AKA" }], j1, JPAGE);
await call(A, "submitJudgeVote", [{ matchId: BOUT, flag: "AKA" }], j2, JPAGE);
await call(A, "submitJudgeVote", [{ matchId: BOUT, flag: "AO" }], j3, JPAGE);
const votes = await sql`select judge_seat, flag_vote, judge_name, judge_session_id from kata_scores where match_id=${BOUT} order by judge_seat`;
check("each vote lands on the judge's own seat", votes.length === 3 && votes[0].judge_seat === 1 && votes[0].judge_name === "Judge One" && votes[0].judge_session_id === sid("Judge One"));
check("POINTS mark refused on a FLAG bout", denied(await call(A, "submitJudgeVote", [{ matchId: BOUT, aka: 8.0 }], j1, JPAGE)));
const [m1] = await sql`select aka_flags, ao_flags from matches where id=${BOUT}`;
check("server totals flags", m1.aka_flags === 2 && m1.ao_flags === 1);
check("vote is audited as the judge", (await lastAudit("KATA_VOTE"))?.actor_role === "judge");

// A judge on R2 cannot vote on a bout of another tatami.
const [r1asg] = await sql`select category_id from category_assignments where ring_id=${R1} and status='running' limit 1`;
const [otherBout] = r1asg ? await sql`select id from matches where category_id=${r1asg.category_id} limit 1` : [];
if (otherBout) check("judge cannot vote on another tatami's bout", denied(await call(A, "submitJudgeVote", [{ matchId: otherBout.id, flag: "AKA" }], j1, JPAGE)));

// ── Void / override ──
check("anonymous cannot void a vote", denied(await call(A, "voidJudgeVote", [{ matchId: BOUT, judgeSeat: 3 }], anon, PAGE)));
check("moderator voids seat 3", (await call(A, "voidJudgeVote", [{ matchId: BOUT, judgeSeat: 3 }], mod, PAGE)).value?.success === true);
check("void is audited with the old vote", (await lastAudit("KATA_VOTE_VOIDED"))?.before?.[0]?.flag === "AO");
// Seat 2's phone vote is replaced from the desk; seat 3 (voided) is entered by the desk.
const ov = await call(A, "submitModeratorManualKataMarks", [{ matchId: BOUT, seats: [{ seat: 2, flag: "AKA" }, { seat: 3, flag: "AKA" }] }], mod, PAGE);
check("desk enters seat 3 and leaves untouched seats alone", ov.value?.success === true);
const rows3 = await sql`select judge_seat, flag_vote, is_overridden, judge_name from kata_scores where match_id=${BOUT} order by judge_seat`;
check("seat 1 keeps its judge's vote", rows3.find((r) => r.judge_seat === 1)?.judge_name === "Judge One" && !rows3.find((r) => r.judge_seat === 1)?.is_overridden);
check("seat 3 is a desk mark", rows3.find((r) => r.judge_seat === 3)?.is_overridden === true);
await call(A, "submitModeratorManualKataMarks", [{ matchId: BOUT, seats: [{ seat: 2, flag: "AO" }] }], mod, PAGE);
check("overriding a phone vote is audited with the judge's name", (await lastAudit("KATA_VOTE_OVERRIDDEN"))?.before?.[0]?.judge === "Judge Two");
await call(A, "submitModeratorManualKataMarks", [{ matchId: BOUT, seats: [{ seat: 2, flag: "AKA" }] }], mod, PAGE);
check("judge cannot vote over a desk mark", denied(await call(A, "submitJudgeVote", [{ matchId: BOUT, flag: "AO" }], j3, JPAGE)));

// ── Close voting, then finalize from the server tally ──
await call(A, "closeKataVoting", [BOUT], mod, PAGE);
check("votes refused after voting closes", denied(await call(A, "submitJudgeVote", [{ matchId: BOUT, flag: "AO" }], j1, JPAGE)));
check("finalizing against the flags is refused", denied(await call(A, "submitModeratorManualKataMarks", [{ matchId: BOUT, winnerSide: "AO", finalize: true }], mod, PAGE)));
const fin = await call(A, "submitModeratorManualKataMarks", [{ matchId: BOUT, finalize: true }], mod, PAGE);
const [m2] = await sql`select status, winner_side, decision_method from matches where id=${BOUT}`;
check("bout finalized with the flags' winner", fin.value?.success === true && m2.status === "CONFIRMED" && m2.winner_side === "AKA" && m2.decision_method === "FLAGS", JSON.stringify({ fin: fin.value ?? fin.raw?.slice(0, 300), m2 }));

// ── POINTS bout: marks per side, 5.0–10.0 in 0.1 steps, totals on the server ──
const msP = await sql`select id from matches where category_id=${KC} and status<>'CONFIRMED' order by match_no`;
const slotsP = msP.length ? await sql`select match_id, athlete_id from match_slots where match_id = any(${msP.map((m) => m.id)})` : [];
const PB = msP.find((m) => slotsP.filter((s) => s.match_id === m.id && s.athlete_id).length === 2)?.id;
if (PB) {
  await sql`update matches set kata_scoring_mode='POINTS' where id=${PB}`;
  await call(A, "openKataVoting", [PB], mod, PAGE);
  check("flag refused on a POINTS bout", denied(await call(A, "submitJudgeVote", [{ matchId: PB, flag: "AKA" }], j1, JPAGE)));
  check("mark below 5.0 refused", denied(await call(A, "submitJudgeVote", [{ matchId: PB, aka: 4.9 }], j1, JPAGE)));
  check("mark off the 0.1 grid refused", denied(await call(A, "submitJudgeVote", [{ matchId: PB, aka: 8.35 }], j1, JPAGE)));
  for (const [jar, aka, ao] of [[j1, 8.3, 7.9], [j2, 8.1, 8.0], [j3, 7.7, 8.2]]) {
    await call(A, "submitJudgeVote", [{ matchId: PB, aka, ao }], jar, JPAGE);
  }
  const [pm] = await sql`select aka_score_total, ao_score_total from matches where id=${PB}`;
  check("server totals the marks (3 judges: all kept)", Number(pm.aka_score_total) === 24.1 && Number(pm.ao_score_total) === 24.1, JSON.stringify(pm));
  await call(A, "closeKataVoting", [PB], mod, PAGE);
  check("a tie is not finalized without the desk's call", denied(await call(A, "submitModeratorManualKataMarks", [{ matchId: PB, finalize: true }], mod, PAGE)));
  const tb = await call(A, "submitModeratorManualKataMarks", [{ matchId: PB, finalize: true, winnerSide: "AO" }], mod, PAGE);
  const [pm2] = await sql`select status, winner_side, decision_method from matches where id=${PB}`;
  check("desk breaks the tie, recorded as a desk decision", tb.value?.success === true && pm2.winner_side === "AO" && pm2.decision_method === "DESK_DECISION");
}

// ── Seat ownership, kick, rotate, end ──
const j1b = new Jar();
await call(A, "requestJudgeSeat", [{ ringId: R2, pin, name: "Judge One B", seat: 1 }], j1b, JPAGE);
const s1b = (await call(A, "getJudgePanel", [R2], mod, PAGE)).value.sessions.find((s) => s.judgeName === "Judge One B").id;
await call(A, "approveJudge", [s1b], mod, PAGE);
check("approving a new phone for a seat ends the old one", denied(await call(A, "getJudgeBout", [R2], j1, JPAGE)));
check("old phone is told it was replaced", (await call(A, "getJudgeStatus", [R2], j1, JPAGE)).value?.endReason === "replaced");
const approvedSeat1 = await sql`select count(*)::int as n from judge_sessions where ring_id=${R2} and seat=1 and status='approved'`;
check("one approved phone per seat", approvedSeat1[0].n === 1);

await call(A, "kickJudge", [sid("Judge Two")], mod, PAGE);
check("kicked judge loses access immediately", denied(await call(A, "getJudgeBout", [R2], j2, JPAGE)));

const j4 = new Jar();
await call(A, "requestJudgeSeat", [{ ringId: R2, key: pairingKey, name: "Late", seat: 4 }], j4, JPAGE);
await call(A, "rotateJudgePairing", [R2], mod, PAGE);
const st4 = await call(A, "getJudgeStatus", [R2], j4, JPAGE);
check("rotation drops pairings not yet approved", st4.value?.endReason === "rotated", JSON.stringify(st4.value));
check("old QR key stops working", denied(await call(A, "requestJudgeSeat", [{ ringId: R2, key: pairingKey, name: "Late", seat: 4 }], new Jar(), JPAGE)));
check("approved judges keep their seat after rotation", (await call(A, "getJudgeStatus", [R2], j3, JPAGE)).value?.status === "approved");

await call(A, "endJudgePanel", [R2], mod, PAGE);
check("ending the panel signs every phone out", denied(await call(A, "getJudgeBout", [R2], j3, JPAGE)));
check("end panel is audited", Boolean(await lastAudit("JUDGE_PANEL_ENDED")));

// ── Desk-only path still works (no phones) ──
const ms = await sql`select id from matches where category_id=${KC} and status<>'CONFIRMED' order by match_no`;
const slots2 = ms.length ? await sql`select match_id, athlete_id from match_slots where match_id = any(${ms.map((m) => m.id)})` : [];
const desk = ms.find((m) => slots2.filter((s) => s.match_id === m.id && s.athlete_id).length === 2);
if (desk) {
  const res = await call(A, "submitModeratorManualKataMarks", [{ matchId: desk.id, seats: [{ seat: 1, flag: "AO" }, { seat: 2, flag: "AO" }, { seat: 3, flag: "AKA" }], finalize: true }], mod, PAGE);
  const [m3] = await sql`select status, winner_side, ao_flags from matches where id=${desk.id}`;
  check("desk-entered flags finalize without phones", res.value?.success === true && m3.status === "CONFIRMED" && m3.winner_side === "AO" && m3.ao_flags === 2);
}

await sql.end();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
