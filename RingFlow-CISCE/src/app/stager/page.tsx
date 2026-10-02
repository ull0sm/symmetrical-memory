import { redirect } from "next/navigation";
import { getStagerPrincipal } from "@/lib/auth/principal";

/** /stager root: send an approved stager straight to their event's board. */
export default async function StagerRootPage() {
  const stager = await getStagerPrincipal();
  if (stager) {
    redirect(`/stager/event/${stager.tournamentId}/balance`);
  }
  redirect("/login/stager");
}
