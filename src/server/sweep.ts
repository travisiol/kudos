/**
 * The sweep: attribute → claim → buyback. Nothing loops: it runs from `POST /api/sweep` (cron,
 * SWEEP_SECRET) or from `after()` on a page load when the last run is older than SWEEP_EVERY_MS.
 *
 *  attribute(): reads each coin's bonding-curve signatures since its cursor (≤ SIGS_PER_COIN per run),
 *               parses pump.fun TradeEvent logs, records each `creator_fee` once (fee_events) and
 *               credits 90 % to the handle's vault, 10 % to the flywheel bucket. $KUDOS's own
 *               trades (NEXT_PUBLIC_MINT) credit 20 % of their creator fee to the bucket.
 *  claim():     collects the operator's pump.fun creator vault when ≥ MIN_CLAIM_LAMPORTS.
 *  buyback():   bucket ≥ MIN_BUYBACK_LAMPORTS and a mint set → Jupiter swap SOL→$KUDOS, then burn
 *               exactly what the operator's token account received.
 */
import type { DatabaseSync } from "node:sqlite";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import {
  MIN_BUYBACK_LAMPORTS,
  MIN_CLAIM_LAMPORTS,
  OWN_FEES_BUYBACK_SHARE,
  SIGS_PER_COIN,
  SWEEP_EVERY_MS,
  ENV,
  splitFee,
} from "../config/kudos.ts";
import { WSOL_MINT, serverMint } from "../config/solana.ts";
import { ataAddress, confirmTx, connection, creatorClaimable, mintInfo } from "./chain.ts";
import { db as defaultDb } from "./db.ts";
import { burnToken, operatorKeypair, recordPayout, sendAndRecord } from "./operator.ts";
import { bondingCurvePda, collectCreatorFeeInstruction } from "./pump/instructions.ts";
import { parseEventLogs } from "./pump/events.ts";
import { addToBucket, creditFee, flywheelState, kvGet, kvSet, listCoins, setCoinCursor, spendBucket } from "./store.ts";

export interface Cursor {
  lastSig: string | null;
  pendingNewest: string | null;
  beforeSig: string | null;
}

export interface FeeHit {
  sig: string;
  slot: number;
  lamports: bigint;
}

/** One page of a mint's curve history since the cursor; returns the creator fees found and the next cursor. */
export async function scanMint(mint: string, creator: string | null, cursor: Cursor): Promise<{ hits: FeeHit[]; cursor: Cursor }> {
  const conn = connection();
  const curve = bondingCurvePda(new PublicKey(mint));
  const page = await conn.getSignaturesForAddress(curve, { limit: SIGS_PER_COIN, until: cursor.lastSig ?? undefined, before: cursor.beforeSig ?? undefined }, "confirmed");
  const next: Cursor = { ...cursor };
  if (!next.pendingNewest && page.length) next.pendingNewest = page[0].signature;
  const hits: FeeHit[] = [];
  for (const s of [...page].reverse()) {
    if (s.err) continue;
    const tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }).catch(() => null);
    const logs = tx?.meta?.logMessages ?? [];
    let lamports = BigInt(0);
    for (const e of parseEventLogs(logs)) {
      if (e.kind !== "trade" || e.mint !== mint) continue;
      if (creator && e.creator !== creator) continue;
      lamports += e.creatorFee;
    }
    if (lamports > BigInt(0)) hits.push({ sig: s.signature, slot: s.slot, lamports });
  }
  if (page.length >= SIGS_PER_COIN) {
    next.beforeSig = page[page.length - 1].signature;
  } else {
    next.lastSig = next.pendingNewest ?? next.lastSig;
    next.pendingNewest = null;
    next.beforeSig = null;
  }
  return { hits, cursor: next };
}

export interface AttributeResult {
  coins: number;
  events: number;
  recipientLamports: bigint;
  flywheelLamports: bigint;
}

export async function attribute(db: DatabaseSync = defaultDb()): Promise<AttributeResult> {
  const out: AttributeResult = { coins: 0, events: 0, recipientLamports: BigInt(0), flywheelLamports: BigInt(0) };
  for (const coin of listCoins(db)) {
    out.coins++;
    try {
      const { hits, cursor } = await scanMint(coin.mint, coin.creator, { lastSig: coin.lastSig, pendingNewest: coin.pendingNewest, beforeSig: coin.beforeSig });
      for (const h of hits) {
        const { recipient, flywheel } = splitFee(h.lamports);
        if (creditFee(db, { mint: coin.mint, sig: h.sig, slot: h.slot, lamports: h.lamports, handle: coin.forHandle, recipient, flywheel })) {
          out.events++;
          out.recipientLamports += recipient;
          out.flywheelLamports += flywheel;
        }
      }
      setCoinCursor(db, coin.mint, cursor);
    } catch {
      // RPC refused this coin this time; its cursor is unchanged and the next sweep retries.
    }
  }
  const own = serverMint();
  if (own && !listCoins(db).some((c) => c.mint === own)) {
    try {
      const saved = JSON.parse(kvGet(db, "ownCursor") ?? "null") as Cursor | null;
      const { hits, cursor } = await scanMint(own, null, saved ?? { lastSig: null, pendingNewest: null, beforeSig: null });
      for (const h of hits) {
        const flywheel = (h.lamports * BigInt(OWN_FEES_BUYBACK_SHARE)) / BigInt(100);
        if (creditFee(db, { mint: own, sig: h.sig, slot: h.slot, lamports: h.lamports, handle: null, recipient: BigInt(0), flywheel })) {
          out.events++;
          out.flywheelLamports += flywheel;
        }
      }
      kvSet(db, "ownCursor", JSON.stringify(cursor));
    } catch {
      // retried next sweep
    }
  }
  return out;
}

export type StepResult = { skipped: string } | { sig: string; lamports: bigint } | { error: string };

/** Collects the operator's curve creator vault (all KUDOS coins share it: the operator is their creator). */
export async function claim(db: DatabaseSync = defaultDb()): Promise<StepResult> {
  const operator = operatorKeypair();
  if (!operator) return { skipped: "no operator key" };
  const { curveLamports } = await creatorClaimable(operator.publicKey.toBase58());
  if (curveLamports < MIN_CLAIM_LAMPORTS) return { skipped: "under the claim minimum" };
  const result = await sendAndRecord(
    operator,
    [collectCreatorFeeInstruction(operator.publicKey)],
    { kind: "claim", to: operator.publicKey.toBase58(), mint: null, amount: curveLamports, note: "creator fees collected from pump.fun" },
    db,
  );
  return "sig" in result ? { sig: result.sig, lamports: curveLamports } : result;
}

type FetchLike = typeof fetch;

/** Buys $KUDOS with the whole bucket through Jupiter, then burns what arrived. Without a mint the bucket keeps accumulating. */
export async function buyback(db: DatabaseSync = defaultDb(), fetcher: FetchLike = fetch): Promise<StepResult> {
  const mint = serverMint();
  const { bucket } = flywheelState(db);
  if (!mint) return { skipped: "no mint: the bucket accumulates" };
  if (bucket < MIN_BUYBACK_LAMPORTS) return { skipped: "bucket under 0.01 SOL" };
  const operator = operatorKeypair();
  if (!operator) return { skipped: "no operator key" };
  const conn = connection();
  const { program } = await mintInfo(mint);
  const ata = ataAddress(operator.publicKey, new PublicKey(mint), new PublicKey(program));
  const readAta = async () => BigInt((await conn.getTokenAccountBalance(ata, "confirmed").catch(() => null))?.value.amount ?? "0");
  const before = await readAta();
  const api = ENV.jupiterApi();
  const quote = await (await fetcher(`${api}/quote?inputMint=${WSOL_MINT}&outputMint=${mint}&amount=${bucket}&slippageBps=300`)).json();
  if (!quote || (quote as { error?: string }).error) return { error: "No Jupiter route right now." };
  const swap = (await (
    await fetcher(`${api}/swap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quoteResponse: quote, userPublicKey: operator.publicKey.toBase58(), wrapAndUnwrapSol: true }),
    })
  ).json()) as { swapTransaction?: string };
  if (!swap.swapTransaction) return { error: "Jupiter returned no transaction." };
  const tx = VersionedTransaction.deserialize(Buffer.from(swap.swapTransaction, "base64"));
  tx.sign([operator]);
  const sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
  const status = await confirmTx(sig);
  if (status === "failed") return { error: "The buyback failed on chain." };
  spendBucket(db, bucket);
  recordPayout(db, { kind: "buyback", to: null, mint, amount: bucket, sig, note: "SOL spent buying $KUDOS" });
  const received = (await readAta()) - before;
  if (received > BigInt(0)) await burnToken(mint, received, "$KUDOS bought back and burned", db);
  return { sig, lamports: bucket };
}

export interface SweepReport {
  at: number;
  attribute: AttributeResult;
  claim: StepResult;
  buyback: StepResult;
}

export async function runSweep(db: DatabaseSync = defaultDb(), fetcher: FetchLike = fetch): Promise<SweepReport | { skipped: string }> {
  const lock = Number(kvGet(db, "sweepLock") ?? 0);
  if (Date.now() - lock < 90_000) return { skipped: "a sweep is already running" };
  kvSet(db, "sweepLock", String(Date.now()));
  try {
    const attributed = await attribute(db);
    const claimed = await claim(db).catch(() => ({ error: "claim failed" }) as StepResult);
    const bought = await buyback(db, fetcher).catch(() => ({ error: "buyback failed" }) as StepResult);
    const at = Date.now();
    if (operatorKeypair()) kvSet(db, "lastSweepAt", String(at));
    kvSet(db, "lastSweepTry", String(at));
    return { at, attribute: attributed, claim: claimed, buyback: bought };
  } finally {
    kvSet(db, "sweepLock", "0");
  }
}

/** True when a page load should schedule a sweep with after(). */
export function sweepDue(db: DatabaseSync = defaultDb(), now = Date.now()): boolean {
  return now - Number(kvGet(db, "lastSweepTry") ?? 0) > SWEEP_EVERY_MS;
}

export function lastSweepAt(db: DatabaseSync = defaultDb()): number | null {
  const v = kvGet(db, "lastSweepAt");
  return v ? Number(v) : null;
}

export { addToBucket };
