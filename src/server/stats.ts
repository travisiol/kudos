/** Figures the pages show, all read from our own tables (+ the chain for supply and pending fees). */
import type { DatabaseSync } from "node:sqlite";
import { serverMint } from "../config/solana.ts";
import { creatorClaimable, mintInfo, tokenSupply } from "./chain.ts";
import { db as defaultDb } from "./db.ts";
import { listLedger, operatorAddress } from "./operator.ts";
import type { LedgerRow } from "./operator.ts";
import { flywheelState, listClaims, listCoins, listVaults, vaultBalance } from "./store.ts";

const sum = (rows: { amount: string }[]) => rows.reduce((s, r) => s + BigInt(r.amount), BigInt(0));

export interface FlywheelStats {
  feesClaimedLamports: bigint;
  claims: number;
  spentLamports: bigint;
  burnedUnits: bigint;
  decimals: number;
  nextBuybackLamports: bigint;
  feesWaitingLamports: bigint;
  supplyUnits: bigint;
  burns: LedgerRow[];
  activity: LedgerRow[];
}

export async function flywheelStats(db: DatabaseSync = defaultDb()): Promise<FlywheelStats> {
  const ledger = listLedger(db, 1000);
  const claimRows = ledger.filter((r) => r.kind === "claim");
  const mint = serverMint();
  const burns = ledger.filter((r) => r.kind === "burn" && r.mint === mint);
  let decimals = 6;
  let supplyUnits = BigInt(0);
  if (mint) {
    try {
      decimals = (await mintInfo(mint)).decimals;
      supplyUnits = (await tokenSupply(mint)).amount;
    } catch {
      // chain unreachable: figures from our ledger only
    }
  }
  let feesWaitingLamports = BigInt(0);
  const op = operatorAddress();
  if (op) feesWaitingLamports = await creatorClaimable(op).then((c) => c.curveLamports).catch(() => BigInt(0));
  return {
    feesClaimedLamports: sum(claimRows),
    claims: claimRows.length,
    spentLamports: flywheelState(db).spent,
    burnedUnits: sum(burns),
    decimals,
    nextBuybackLamports: flywheelState(db).bucket,
    feesWaitingLamports,
    supplyUnits,
    burns,
    activity: ledger.filter((r) => r.kind === "claim" || r.kind === "buyback" || r.kind === "burn").slice(0, 20),
  };
}

export function payoutStats(db: DatabaseSync = defaultDb()) {
  const claims = listClaims(db, 500);
  const waiting = listVaults(db).reduce((s, v) => s + vaultBalance(v), BigInt(0));
  return {
    sentLamports: claims.reduce((s, c) => s + BigInt(c.lamports), BigInt(0)),
    waitingLamports: waiting,
    payouts: claims.length,
    people: new Set(claims.map((c) => c.handle)).size,
    claims,
  };
}

export function homeCounts(db: DatabaseSync = defaultDb()) {
  return { coins: listCoins(db).length, sentLamports: payoutStats(db).sentLamports };
}
