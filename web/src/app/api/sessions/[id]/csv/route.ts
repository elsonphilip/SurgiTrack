import { getRaw, getSession } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [session, raw] = await Promise.all([getSession(id), getRaw(id)]);
  if (!session || !raw) return Response.json({ error: "not found" }, { status: 404 });
  const cols = ["t", "ax", "ay", "az", "gx", "gy", "gz", "camX", "camY", "distCm"] as const;
  const csv = [cols.join(","), ...raw.map((r) => cols.map((c) => r[c] ?? "").join(","))].join("\n");
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="surgitrack_${session.userId}_${id}.csv"`,
    },
  });
}
