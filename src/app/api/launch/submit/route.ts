import { after } from "next/server";
import { HttpError } from "@/server/errors";
import { assertSameOrigin, handle, readJson } from "@/server/http";
import { submitLaunch } from "@/server/launch";
import { sendToken } from "@/server/operator";
import { currentAddress } from "@/server/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const launcher = await currentAddress();
    if (!launcher) throw new HttpError(401, "Sign in with your wallet first.");
    const body = await readJson<{ id?: string; signature?: string | null }>(request);
    const out = await submitLaunch(launcher, String(body.id ?? ""), body.signature ?? null);
    if (out.tokensBought > BigInt(0)) {
      // The engine bought with the operator wallet; the tokens are forwarded to the launcher after the response.
      after(async () => {
        await sendToken(launcher, out.mint, out.tokensBought, "first buy").catch(() => null);
      });
    }
    return Response.json({ mint: out.mint, signature: out.signature });
  });
}
