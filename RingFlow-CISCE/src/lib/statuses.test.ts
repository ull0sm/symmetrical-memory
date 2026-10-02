import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STATUS_CHECKS, sqlList } from "./statuses";

const root = path.resolve(import.meta.dirname, "../..");
const schema = fs.readFileSync(path.join(root, "src/db/schema/index.ts"), "utf8");
const migration = fs.readFileSync(path.join(root, "db/migrations/migration14_status_checks.sql"), "utf8");

describe("status CHECK constraints", () => {
  it("are declared in the Drizzle schema", () => {
    for (const [name] of STATUS_CHECKS) {
      if (name === "category_attendance_status_check") continue; // created inline by migration 13
      expect(schema, name).toContain(`statusCheck('${name}')`);
    }
  });

  it("match the SQL migration value for value", () => {
    for (const [name, , column, values, nullable] of STATUS_CHECKS) {
      if (name === "category_attendance_status_check") continue;
      const expr = `${column} IN ${sqlList(values)}`;
      expect(migration, name).toContain(`CONSTRAINT ${name} CHECK (${nullable ? `${column} IS NULL OR ${expr}` : expr})`);
    }
  });

  it("only use safe literal values", () => {
    for (const [, , , values] of STATUS_CHECKS) {
      for (const v of values) expect(v).toMatch(/^[A-Za-z_]+$/);
    }
  });
});
