import { assertSameOrigin, handle, readJson } from "@/server/http";
import { prepareLaunch } from "@/server/launch";
import type { LaunchInput } from "@/server/launch";
import { currentAddress } from "@/server/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const body = await readJson<LaunchInput>(request);
    return Response.json(await prepareLaunch(await currentAddress(), body));
  });
}
