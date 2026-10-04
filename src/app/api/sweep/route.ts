import { timingSafeEqual } from "node:crypto";
import { ENV } from "@/config/kudos";
import { runSweep } from "@/server/sweep";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(request: Request): boolean {
  const secret = ENV.sweepSecret();
  if (!secret) return false;
  const given = request.headers.get("x-sweep-secret") ?? request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

async function sweep(request: Request) {
  if (!authorised(request)) return Response.json({ error: "Not allowed." }, { status: 401 });
  return Response.json(json(await runSweep()));
}

export const POST = sweep;
/** Vercel cron calls GET with `Authorization: Bearer <CRON_SECRET>`; set CRON_SECRET = SWEEP_SECRET. */
export const GET = sweep;
