"use server";

import { redirect } from "next/navigation";
import { createProfile } from "@/lib/store";

export async function createProfileAction(formData: FormData) {
  const name = String(formData.get("name") ?? "");
  if (!name.trim()) return;
  const p = await createProfile(name);
  redirect(`/profiles/${p.id}`);
}
