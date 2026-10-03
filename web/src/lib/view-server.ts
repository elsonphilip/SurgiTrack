import "server-only";
import { cookies } from "next/headers";
import { VIEW_COOKIE, type View } from "./view";

export async function getView(): Promise<View> {
  return (await cookies()).get(VIEW_COOKIE)?.value === "detailed" ? "detailed" : "simple";
}
