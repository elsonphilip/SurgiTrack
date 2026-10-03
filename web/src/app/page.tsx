import Link from "next/link";
import { listProfiles } from "@/lib/store";
import { LEVELS } from "@/lib/scoring";
import { createProfileAction } from "./actions";
import { DemoBadge } from "@/components/DemoBadge";

export const dynamic = "force-dynamic";

export default async function Home() {
  const profiles = await listProfiles();
  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Profiles</h1>
        <p className="mt-1 text-sm text-ink2">
          Pick a profile to see progress, or create one before your first session.
        </p>
      </section>

      <form action={createProfileAction} className="flex gap-2">
        <input
          name="name"
          required
          maxLength={60}
          placeholder="Name or ID"
          className="w-full max-w-xs rounded-md border border-line bg-surface px-3 py-2 text-sm"
        />
        <button className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-bg">Create profile</button>
      </form>

      {profiles.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-6 text-sm text-muted">
          No profiles yet. Create one above, then record a session from the Pi.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {profiles.map((p) => (
            <li key={p.id}>
              <Link href={`/profiles/${p.id}`} className="block rounded-lg border border-line bg-surface p-4 hover:border-muted">
                <div className="flex items-center font-medium">
                  {p.name}
                  {p.id.startsWith("demo-") && <DemoBadge />}
                </div>
                <div className="mt-2 flex gap-6 text-sm text-ink2">
                  <span>Level {p.level} · {LEVELS[p.level - 1].name}</span>
                  <span>Best {p.bestScore ? p.bestScore.toFixed(1) : "—"}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
