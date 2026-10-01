import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { hashPassword } from "../src/lib/auth/password";
import { eq } from "drizzle-orm";

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;

  for (const line of fs.readFileSync(filePath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));

function getArg(name: string) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  if (match) return match.slice(prefix.length).replace(/^['"]|['"]$/g, "");
  // Check npm env variables when run without '--'
  const envVal = process.env[`npm_config_${name}`];
  if (envVal) return envVal.trim().replace(/^['"]|['"]$/g, "");
  return "";
}

let db: any;
let admins: any;

async function main() {
  const positionalArgs = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const email = (getArg("email") || positionalArgs[0] || "").trim().toLowerCase();
  const password = (getArg("password") || positionalArgs[1] || "").trim();
  const name = (getArg("name") || positionalArgs[2] || "").trim();

  if (!email || !password) {
    console.log(
      "Usage: npm run db:create-admin -- --email=admin@example.com --password=secret [--name='Tournament Director']"
    );
    console.log(
      "Or:    npm run db:create-admin admin@example.com secret 'Tournament Director'"
    );
    process.exit(1);
  }

  ({ db } = await import("../src/db"));
  ({ admins } = await import("../src/db/schema"));
  const passwordHash = await hashPassword(password);
  const existing = await db.select().from(admins).where(eq(admins.email, email)).limit(1);

  if (existing.length > 0) {
    await db
      .update(admins)
      .set({
        name: name || existing[0].name,
        passwordHash,
      })
      .where(eq(admins.email, email));
    console.log(`Updated admin: ${email}`);
  } else {
    await db.insert(admins).values({
      id: crypto.randomUUID(),
      email,
      name: name || null,
      passwordHash,
    });
    console.log(`Created admin: ${email}`);
  }

  console.log(`Password hash: ${passwordHash}`);
  console.log("Username/email is stored as plain text; only the password is hashed.");
  await db.$client.end();
}

main().catch(async (err) => {
  console.error("Failed to create admin:", err);
  try {
    await db.$client.end();
  } catch {}
  process.exit(1);
});