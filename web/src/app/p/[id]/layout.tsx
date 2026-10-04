import { notFound } from "next/navigation";
import { getProfile, listSessions } from "@/lib/store";
import { Shell } from "@/components/Shell";
import { getGame, getView } from "@/lib/view-server";
import { totalXp } from "@/lib/game";

export const dynamic = "force-dynamic";

export default async function ProfileLayout({ children, params }: LayoutProps<"/p/[id]">) {
  const { id } = await params;
  const p = await getProfile(id);
  if (!p) notFound();
  const view = await getView();
  const game = await getGame();
  const xp = game ? totalXp(await listSessions(id, { counted: true })) : 0;
  return <Shell profile={{ id: p.id, name: p.name, level: p.level, demo: p.source === "synthetic" }} initialView={view} initialGame={game} xp={xp}>{children}</Shell>;
}
