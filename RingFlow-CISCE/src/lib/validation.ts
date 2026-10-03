import { z } from "zod";
import { TOURNAMENT_TYPES } from "@/lib/statuses";

/**
 * Input schemas for server actions that take objects from the browser.
 * Anything arriving from a client is untrusted: shapes are checked and
 * strings bounded before they reach the database.
 */

/** Parse or throw a short, user-readable error. */
export function parseInput<T>(schema: z.ZodType<T>, input: unknown, what = "input"): T {
  const res = schema.safeParse(input);
  if (!res.success) {
    const first = res.error.issues[0];
    const where = first?.path?.length ? ` (${first.path.join(".")})` : "";
    throw new Error(`Invalid ${what}${where}: ${first?.message ?? "check the values"}`);
  }
  return res.data;
}

const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => String(v).trim().slice(0, max))
    .nullish();
const looseNumber = z.union([z.number(), z.string()]).nullish();

export const categoryInputSchema = z.object({
  name: text(200).min(1, "Category name is required"),
  age_bracket: optText(100),
  weight_class: optText(100),
  athletes_count: z.coerce.number().int().min(0).max(10000).catch(0),
});

export const tournamentInputSchema = z.object({
  name: text(200).min(1, "Tournament name is required"),
  event_date: z.string().max(40).nullish(),
  venue: optText(200),
  city: optText(200),
  categories: z.array(categoryInputSchema.partial({ age_bracket: true, weight_class: true })).max(2000).default([]),
  ringCount: z.coerce.number().int().min(1).max(50).optional(),
  ring_count: z.coerce.number().int().min(1).max(50).optional(),
  tournament_type: z.enum(TOURNAMENT_TYPES).default("OFFICIAL"),
});

export const athleteInputSchema = z.object({
  name: text(200).min(1, "Athlete name is required"),
  chest_number: optText(50),
  category_id: z.string().max(64).nullish(),
  school: optText(200),
  school_code: optText(50),
  sports_id: optText(50),
  sex: optText(20),
  age: optText(20),
  belt: optText(50),
  weight: looseNumber,
});

export const simpleRosterSchema = z
  .array(z.object({ no: optText(50), name: text(200) }))
  .max(5000);

export const masterRosterSchema = z
  .array(
    z
      .object({
        name: text(200),
        no: optText(50),
        age: optText(20),
        sex: optText(20),
        belt: optText(50),
        day: optText(50),
        school: optText(200),
        dojo: optText(200),
        school_code: optText(50),
        sports_id: optText(50),
        category: optText(200),
        category_name: optText(200),
      })
      .passthrough()
  )
  .max(10000);

const flag = z.union([z.boolean(), z.string(), z.number()]).nullish();

export const officialRosterSchema = z
  .array(
    z.object({
      name: text(200),
      chestNumber: optText(50),
      school: optText(200),
      schoolCode: optText(50),
      sportsId: optText(50),
      belt: optText(50),
      age: looseNumber,
      sex: optText(20),
      weight: looseNumber,
      kata: flag,
      kumite: flag,
      teamKata: flag,
      teamKumite: flag,
    })
  )
  .max(10000);
