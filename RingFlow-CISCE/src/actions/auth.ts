"use server";

import { db } from "@/db";
import { admins } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { verifyPassword } from "@/lib/auth/password";
import { SESSION_COOKIES, LEGACY_COOKIES, clearCookies, setSessionCookie } from "@/lib/auth/cookies";

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

  const [admin] = await db.select().from(admins).where(eq(admins.email, email)).limit(1);

  // Accounts without a password must be given one with `npm run db:create-admin`;
  // there is no built-in default password.
  const valid = await verifyPassword(password, admin?.passwordHash || DUMMY_HASH);
  if (!admin || !admin.passwordHash || !valid) {
    return { success: false, error: "Invalid email or password." };
  }

  await clearCookies(...LEGACY_COOKIES);
  await setSessionCookie(SESSION_COOKIES.admin, admin.id, ADMIN_SESSION_SECONDS);

  try {
    revalidatePath("/admin");
  } catch {
    // Outside a revalidatable context.
  }

  return { success: true };
}

export async function logoutAdminAction() {
  await clearCookies(SESSION_COOKIES.admin, ...LEGACY_COOKIES);
  try {
    revalidatePath("/admin");
  } catch {
    // Outside a revalidatable context.
  }
  return { success: true };
}
