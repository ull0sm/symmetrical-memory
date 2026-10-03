import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STATUS_CHECKS, sqlList } from "./statuses";

const root = path.resolve(import.meta.dirname, "../..");
const schema = fs.readFileSync(path.join(root, "src/db/schema/index.ts"), "utf8");
const readMigration = (file: string) => fs.readFileSync(path.join(root, "db/migrations", file), "utf8");
/** Checks created by their own migration rather than by migration 14, keyed to that migration. */
const OWN_MIGRATION: Record<string, string> = {
  tournaments_draw_profile_check: "migration15_draw_profile.sql",
  tournaments_draw_separation_check: "migration15_draw_profile.sql",
  categories_draw_profile_check: "migration15_draw_profile.sql",
  tournaments_tournament_type_check: "migration18_local_tournaments.sql",
  tournaments_local_event_order_check: "migration18_local_tournaments.sql",
  categories_kata_format_check: "migration18_local_tournaments.sql",
  tournament_registrations_attendance_check: "migration18_local_tournaments.sql",
  divisions_sex_check: "migration18_local_tournaments.sql",
  division_events_event_type_check: "migration18_local_tournaments.sql",
  division_holds_holder_kind_check: "migration18_local_tournaments.sql",
  kata_tie_decisions_method_check: "migration19_kata_tie_decisions.sql",
};
/** Written as a column CHECK by migration 13, so it has no named constraint text to compare. */
const UNNAMED_CHECKS = new Set(["category_attendance_status_check"]);
const migration14 = readMigration("migration14_status_checks.sql");

describe("status CHECK constraints", () => {
  it("are declared in the Drizzle schema", () => {
    for (const [name] of STATUS_CHECKS) {
      if (name === "category_attendance_status_check") continue; // created inline by migration 13
      expect(schema, name).toContain(`statusCheck('${name}')`);
    }
  });

  it("match the SQL migration value for value", () => {
    for (const [name, , column, values, nullable] of STATUS_CHECKS) {
      if (UNNAMED_CHECKS.has(name)) continue;
      const sqlText = OWN_MIGRATION[name] ? readMigration(OWN_MIGRATION[name]) : migration14;
      const expr = `${column} IN ${sqlList(values)}`;
      expect(sqlText, name).toContain(`CONSTRAINT ${name} CHECK (${nullable ? `${column} IS NULL OR ${expr}` : expr})`);
    }
  });

  it("only use safe literal values", () => {
    for (const [, , , values] of STATUS_CHECKS) {
      for (const v of values) expect(v).toMatch(/^[A-Za-z_]+$/);
    }
  });
});
