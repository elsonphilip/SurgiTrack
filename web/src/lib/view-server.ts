import "server-only";
import { cookies } from "next/headers";
import { VIEW_COOKIE, type View } from "./view";
import { GAME_COOKIE } from "./game";

export async function getView(): Promise<View> {
  return (await cookies()).get(VIEW_COOKIE)?.value === "detailed" ? "detailed" : "simple";
}

/** Game mode is independent of Simple/Detailed. */
export async function getGame(): Promise<boolean> {
  return (await cookies()).get(GAME_COOKIE)?.value === "on";
}
