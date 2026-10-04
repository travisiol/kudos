/** Page-load trigger: schedules a sweep with after() when the last one is older than SWEEP_EVERY_MS. */
import { after } from "next/server";
import { runSweep, sweepDue } from "./sweep.ts";

export function sweepIfDue() {
  try {
    if (!sweepDue()) return;
    after(async () => {
      await runSweep().catch(() => null);
    });
  } catch {
    // outside a request scope (build time): nothing to schedule
  }
}
