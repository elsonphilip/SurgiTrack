import { notFound } from "next/navigation";
import { getProfile, listSessions } from "@/lib/store";
import { LiveSession } from "@/components/LiveSession";

export const dynamic = "force-dynamic";

export default async function Live({ params, searchParams }: PageProps<"/p/[id]/live">) {
  const { id } = await params;
  const sp = await searchParams;
  const profile = await getProfile(id);
  if (!profile) notFound();
  const [all, counted] = await Promise.all([listSessions(id), listSessions(id, { counted: true })]);
  const l = counted[counted.length - 1];
  return (
    <LiveSession
      profileId={id}
      startLevel={profile.level}
      nextId={all.length + 1}
      last={l ? { acc: l.accuracy, dev: l.avgDeviationMm, trem: l.tremor, smooth: l.smoothness } : null}
      autoStart={sp.new === "1"}
    />
  );
}
