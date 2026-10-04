import { HANDLE_RE, normalizeHandle } from "@/config/kudos";
import { db } from "@/server/db";
import { handle as run } from "@/server/http";
import { HttpError } from "@/server/errors";
import { getVault, listCoins } from "@/server/store";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: { params: Promise<{ handle: string }> }) {
  return run(async () => {
    const h = normalizeHandle(decodeURIComponent((await ctx.params).handle));
    if (!HANDLE_RE.test(h)) throw new HttpError(400, "That is not an X handle.");
    const v = getVault(db(), h);
    const lamports = BigInt(v?.lamports ?? "0");
    const paid = BigInt(v?.paidLamports ?? "0");
    const coins = listCoins(db())
      .filter((c) => c.forHandle === h)
      .map((c) => ({ mint: c.mint, name: c.name, ticker: c.ticker }));
    return Response.json({ handle: h, balanceLamports: (lamports - paid).toString(), paidLamports: paid.toString(), coins });
  });
}
