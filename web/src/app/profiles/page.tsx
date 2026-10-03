import Link from "next/link";
import { listProfiles } from "@/lib/store";
import { LEVELS } from "@/lib/scoring";
import { createProfileAction } from "../actions";
import { Demo } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Profiles() {
  const profiles = await listProfiles();
  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px", display: "flex", flexDirection: "column", gap: 22 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div className="head" style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--cream)", color: "var(--card)", display: "grid", placeItems: "center", fontSize: 22 }}>ST</div>
        <h1 className="head" style={{ margin: 0, fontSize: "clamp(34px,4vw,52px)", lineHeight: 1 }}>Profiles</h1>
      </div>

      <form action={createProfileAction} className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          name="name"
          required
          maxLength={60}
          placeholder="Name"
          style={{ flex: "1 1 220px", height: 52, padding: "0 22px", borderRadius: 999, border: 0, background: "var(--pill)", color: "var(--cream)", fontSize: 14.5 }}
        />
        <button className="btn btn-red">Create profile</button>
      </form>

      {profiles.length === 0 ? (
        <div className="empty">No profiles yet. Create one above, then run a session.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 14 }}>
          {profiles.map((p) => (
            <Link key={p.id} href={`/p/${p.id}/live`} className="card card-link" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 17 }}>
                {p.name}
                {p.source === "synthetic" && <Demo />}
              </div>
              <div className="mono muted" style={{ fontSize: 12 }}>
                {p.id} · L{p.level} {LEVELS[p.level - 1].name} · best {p.bestScore || "—"}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
