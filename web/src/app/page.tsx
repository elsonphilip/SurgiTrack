import { redirect } from "next/navigation";
import { listProfiles } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Home() {
  const profiles = await listProfiles();
  // Prefer a real profile; fall back to demo; none → profile creation page.
  const pick = profiles.find((p) => p.source === "device") ?? profiles[0];
  redirect(pick ? `/p/${pick.id}/live` : "/profiles");
}
