import { notFound } from "next/navigation";
import { getProfile } from "@/lib/store";
import { Shell } from "@/components/Shell";
import { getView } from "@/lib/view-server";

export const dynamic = "force-dynamic";

export default async function ProfileLayout({ children, params }: LayoutProps<"/p/[id]">) {
  const { id } = await params;
  const p = await getProfile(id);
  if (!p) notFound();
  const view = await getView();
  return <Shell profile={{ id: p.id, name: p.name, level: p.level, demo: p.source === "synthetic" }} initialView={view}>{children}</Shell>;
}
