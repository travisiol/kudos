import { readFileSync } from "node:fs";
import { db } from "@/server/db";
import { getLaunch } from "@/server/store";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = (await ctx.params).id;
  const launch = /^[0-9a-f]{16}$/.test(id) ? getLaunch(db(), id) : null;
  if (!launch?.imagePath) return new Response("Not found", { status: 404 });
  try {
    const bytes = readFileSync(launch.imagePath);
    const ext = launch.imagePath.split(".").pop() ?? "png";
    return new Response(new Uint8Array(bytes), { headers: { "content-type": TYPES[ext] ?? "application/octet-stream", "cache-control": "public, max-age=86400" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
