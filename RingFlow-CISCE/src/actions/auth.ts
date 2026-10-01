"use server";

import { db } from "@/db";
import { admins, adminSessions } from "@/db/schema";
import { and, eq, lt } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { verifyPassword } from "@/lib/auth/password";
import { SESSION_COOKIES, LEGACY_COOKIES, clearCookies, setSessionCookie } from "@/lib/auth/cookies";
import { getAdminPrincipal } from "@/lib/auth/principal";
import { hashToken, newSessionToken } from "@/lib/auth/tokens";
import { RATE_LIMITS, TOO_MANY_ATTEMPTS, allowAttempt, clientAddress } from "@/lib/rateLimit";

const ADMIN_SESSION_SECONDS = 7 * 24 * 60 * 60;

// A well-formed hash that matches no password. Checking against it means an
// unknown email costs the same time as a wrong password, so the login form
// cannot be used to find out which emails are admins.
const DUMMY_HASH =
  "00000000000000000000000000000000:" + "0".repeat(128);

export async function signInWithAdminPassword(
  formData: FormData | { email?: string; password?: string }
) {
  let email = "";
  let password = "";

  if (formData instanceof FormData) {
    email = String(formData.get("email") ?? "");
    password = String(formData.get("password") ?? "");
  } else if (formData && typeof formData === "object") {
    email = formData.email || "";
    password = formData.password || "";
  }

  email = email.trim().toLowerCase().slice(0, 320);
  password = password.slice(0, 1024);

  if (!email || !password) {
    return { success: false, error: "Email and password are required." };
  }

  const address = await clientAddress();
  const allowed = await allowAttempt([
    { key: `admin-login:addr:${address}`, ...RATE_LIMITS.adminLoginPerAddress },
    { key: `admin-login:email:${email}`, ...RATE_LIMITS.adminLoginPerEmail },
  ]);
  if (!allowed) return { success: false, error: TOO_MANY_ATTEMPTS };

  const [admin] = await db.select().from(admins).where(eq(admins.email, email)).limit(1);

  // Accounts without a password must be given one with `npm run db:create-admin`;
  // there is no built-in default password.
  const valid = await verifyPassword(password, admin?.passwordHash || DUMMY_HASH);
  if (!admin || !admin.passwordHash || !valid) {
    return { success: false, error: "Invalid email or password." };
  }

  const h = await headers();
  const token = newSessionToken();
  // Housekeeping: drop this admin's expired sessions while we are here.
  await db
    .delete(adminSessions)
    .where(and(eq(adminSessions.adminId, admin.id), lt(adminSessions.expiresAt, new Date())));
  await db.insert(adminSessions).values({
    adminId: admin.id,
    tokenHash: hashToken(token),
    userAgent: (h.get("user-agent") || "").slice(0, 300) || null,
    ip: (h.get("x-forwarded-for") || "").split(",")[0].trim() || null,
    expiresAt: new Date(Date.now() + ADMIN_SESSION_SECONDS * 1000),
  });

  await clearCookies(...LEGACY_COOKIES);
  await setSessionCookie(SESSION_COOKIES.admin, token, ADMIN_SESSION_SECONDS);

  try {
    revalidatePath("/admin");
  } catch {
    // Outside a revalidatable context.
  }

  return { success: true };
}

export async function logoutAdminAction() {
  const admin = await getAdminPrincipal();
  if (admin) {
    await db.delete(adminSessions).where(eq(adminSessions.id, admin.sessionId));
  }
  await clearCookies(SESSION_COOKIES.admin, ...LEGACY_COOKIES);
  try {
    revalidatePath("/admin");
  } catch {
    // Outside a revalidatable context.
  }
  return { success: true };
}
