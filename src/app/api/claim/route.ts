import { claimByTweet } from "@/server/claim";
import { assertSameOrigin, handle, readJson } from "@/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const { url } = await readJson<{ url?: string }>(request);
    return Response.json(await claimByTweet(String(url ?? "")));
  });
}
