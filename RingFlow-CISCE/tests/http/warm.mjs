// Log in with the seed's test admin and open every staff page so all server actions get compiled.
import { BASE, Jar, call, loadActions } from "./rbac-lib.mjs";

const [tid, rid] = process.argv.slice(2);
const actions = loadActions();
const admin = new Jar();
const login = await call(actions, "signInWithAdminPassword", [{ email: "admin@ringflow.org", password: "admin123" }], admin);
console.log("admin login", login.status, JSON.stringify(login.value), [...admin.c.keys()]);

const mod = new Jar();
mod.c.set("mod_token", "11111111-2222-3333-4444-555555555555");

const pages = [
  [admin, `/admin`],
  [admin, `/admin/event/${tid}/dashboard`],
  [admin, `/admin/event/${tid}/rings`],
  [admin, `/admin/event/${tid}/rings/balance`],
  [admin, `/admin/event/${tid}/settings`],
  [admin, `/admin/event/${tid}/categories`],
  [admin, `/admin/event/${tid}/athletes`],
  [admin, `/organiser`],
  [admin, `/organiser/event/${tid}/dashboard`],
  [admin, `/organiser/event/${tid}/categories`],
  [admin, `/stager/event/${tid}/balance`],
  [admin, `/scoreboard/${rid}`],
  [mod, `/moderator/ring/${rid}/current`],
  [mod, `/moderator/ring/${rid}/queue`],
  [mod, `/moderator/ring/${rid}/controls`],
];
for (const [jar, p] of pages) {
  const r = await fetch(BASE + p, { headers: { Cookie: jar.header() }, redirect: "manual" });
  console.log(r.status, p);
}
