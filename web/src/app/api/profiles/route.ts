import { createProfile, listProfiles } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await listProfiles());
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return Response.json({ error: "name required" }, { status: 400 });
  }
  return Response.json(await createProfile(body.name), { status: 201 });
}
