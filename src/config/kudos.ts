/**
 * KUDOS mechanic constants. Imported by server modules (relative paths) and pages.
 */

/** Share of every coin's creator fees credited to the X account's vault. */
export const RECIPIENT_SHARE = 90;
/** Share of every coin's creator fees set aside to buy back and burn $KUDOS. */
export const FLYWHEEL_SHARE = 10;
/** Share of $KUDOS's own creator fees that also buys $KUDOS back. */
export const OWN_FEES_BUYBACK_SHARE = 20;
/** Smallest payout from a vault: 0.001 SOL. */
export const MIN_PAYOUT_LAMPORTS = BigInt(1_000_000);
/** The operator's creator vault is claimed only above this: 0.002 SOL. */
export const MIN_CLAIM_LAMPORTS = BigInt(2_000_000);
/** The flywheel buys only from this bucket size: 0.01 SOL. */
export const MIN_BUYBACK_LAMPORTS = BigInt(10_000_000);
/** A sweep is due when the last one is older than this. */
export const SWEEP_EVERY_MS = 10 * 60_000;
/** The burn page reads "Running" when a sweep finished within this window. */
export const SWEEP_FRESH_MS = 20 * 60_000;
/** Signatures read per coin per sweep (serverless budget); the rest is read next time. */
export const SIGS_PER_COIN = 200;
/** Image upload limit. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** Canonical SPL Memo v2 program id (https://spl.solana.com/memo). Used to tag first-buy transfers and payouts. */
export const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

/** The X handle every claim tweet must tag (without @). */
export function xHandle(): string {
  return (process.env["NEXT_PUBLIC_X_HANDLE"]?.trim() || "kudoslaunch").replace(/^@/, "");
}

/** The exact text a recipient posts. */
export function claimTweetText(address = ""): string {
  return `Claiming my @${xHandle()} fees to my wallet: ${address}`.trimEnd();
}

export const ENV = {
  launchWebhook: () => process.env["LAUNCH_WEBHOOK"]?.trim() || null,
  launchSecret: () => process.env["LAUNCH_SECRET"]?.trim() || "",
  sweepSecret: () => process.env["SWEEP_SECRET"]?.trim() || null,
  tweetApi: () => process.env["KUDOS_TWEET_API"]?.trim() || null,
  blockedHandles: () => (process.env["KUDOS_BLOCKED_HANDLES"] ?? "").split(",").map((h) => h.trim().replace(/^@/, "").toLowerCase()).filter(Boolean),
  jupiterApi: () => process.env["JUPITER_API_URL"]?.trim() || "https://quote-api.jup.ag/v6",
} as const;

/** Split a creator fee: 90 % to the vault, the rest (10 %, rounding included) to the flywheel. */
export function splitFee(lamports: bigint): { recipient: bigint; flywheel: bigint } {
  const recipient = (lamports * BigInt(RECIPIENT_SHARE)) / BigInt(100);
  return { recipient, flywheel: lamports - recipient };
}

/** Lamports the flywheel gets: 10 % of launched coins' fees + 20 % of $KUDOS's own fees. */
export function flywheelCredit(launchedFees: bigint, ownFees: bigint): bigint {
  return launchedFees - splitFee(launchedFees).recipient + (ownFees * BigInt(OWN_FEES_BUYBACK_SHARE)) / BigInt(100);
}

export const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
export const normalizeHandle = (h: string) => h.trim().replace(/^@/, "").toLowerCase();
