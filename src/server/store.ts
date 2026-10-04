/**
 * KUDOS tables: launches, coins, fee_events, vaults, flywheel, claims, kv. Every function takes the
 * database so tests can use an in-memory one.
 */
import type { DatabaseSync } from "node:sqlite";
import { normalizeHandle } from "../config/kudos.ts";

export interface LaunchRow {
  id: string;
  forHandle: string;
  name: string;
  ticker: string;
  imagePath: string | null;
  description: string | null;
  launcher: string;
  firstBuyLamports: string;
  status: string;
  paySig: string | null;
  mint: string | null;
  sig: string | null;
  error: string | null;
  createdAt: number;
}

export interface CoinRow {
  mint: string;
  launchId: string | null;
  forHandle: string;
  name: string;
  ticker: string;
  image: string | null;
  creator: string | null;
  launcher: string | null;
  launchedAt: number;
  sig: string | null;
  lastSig: string | null;
  pendingNewest: string | null;
  beforeSig: string | null;
}

export interface VaultRow {
  handle: string;
  xUserId: string | null;
  lamports: string;
  paidLamports: string;
}

export interface FeeEventRow {
  mint: string;
  sig: string;
  slot: number;
  lamports: string;
  handle: string | null;
  recipient: string;
  flywheel: string;
  at: number;
}

export interface ClaimRow {
  tweetId: string;
  handle: string;
  xUserId: string | null;
  address: string;
  lamports: string;
  sig: string | null;
  status: string;
  at: number;
}

const big = (v: unknown) => BigInt(String(v ?? "0"));

// ───────────────────────────── launches

export function insertLaunch(db: DatabaseSync, l: Omit<LaunchRow, "paySig" | "mint" | "sig" | "error">) {
  db.prepare(
    "INSERT INTO launches (id, forHandle, name, ticker, imagePath, description, launcher, firstBuyLamports, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(l.id, l.forHandle, l.name, l.ticker, l.imagePath, l.description, l.launcher, l.firstBuyLamports, l.status, l.createdAt);
}

export function getLaunch(db: DatabaseSync, id: string): LaunchRow | null {
  return (db.prepare("SELECT * FROM launches WHERE id = ?").get(id) as unknown as LaunchRow | undefined) ?? null;
}

export function updateLaunch(db: DatabaseSync, id: string, patch: Partial<Pick<LaunchRow, "status" | "paySig" | "mint" | "sig" | "error" | "firstBuyLamports">>) {
  for (const [k, v] of Object.entries(patch)) db.prepare(`UPDATE launches SET ${k} = ? WHERE id = ?`).run(v as string | null, id);
}

export function paySigUsed(db: DatabaseSync, sig: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM launches WHERE paySig = ?").get(sig));
}

// ───────────────────────────── coins

export function insertCoin(db: DatabaseSync, c: Omit<CoinRow, "lastSig" | "pendingNewest" | "beforeSig">) {
  db.prepare(
    "INSERT OR IGNORE INTO coins (mint, launchId, forHandle, name, ticker, image, creator, launcher, launchedAt, sig) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(c.mint, c.launchId, normalizeHandle(c.forHandle), c.name, c.ticker, c.image, c.creator, c.launcher, c.launchedAt, c.sig);
  db.prepare("INSERT OR IGNORE INTO vaults (handle) VALUES (?)").run(normalizeHandle(c.forHandle));
}

export function listCoins(db: DatabaseSync): CoinRow[] {
  return db.prepare("SELECT * FROM coins ORDER BY launchedAt DESC").all() as unknown as CoinRow[];
}

export function getCoin(db: DatabaseSync, mint: string): CoinRow | null {
  return (db.prepare("SELECT * FROM coins WHERE mint = ?").get(mint) as unknown as CoinRow | undefined) ?? null;
}

export function setCoinCursor(db: DatabaseSync, mint: string, cur: { lastSig: string | null; pendingNewest: string | null; beforeSig: string | null }) {
  db.prepare("UPDATE coins SET lastSig = ?, pendingNewest = ?, beforeSig = ? WHERE mint = ?").run(cur.lastSig, cur.pendingNewest, cur.beforeSig, mint);
}

// ───────────────────────────── fees, vaults, flywheel

/** Records one fee event and credits the vault + flywheel. Returns false (nothing credited) when the event is already known. */
export function creditFee(db: DatabaseSync, e: { mint: string; sig: string; slot: number; lamports: bigint; handle: string | null; recipient: bigint; flywheel: bigint }): boolean {
  const res = db
    .prepare("INSERT OR IGNORE INTO fee_events (mint, sig, slot, lamports, handle, recipient, flywheel, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(e.mint, e.sig, e.slot, e.lamports.toString(), e.handle, e.recipient.toString(), e.flywheel.toString(), Date.now());
  if (Number(res.changes) === 0) return false;
  if (e.handle && e.recipient > BigInt(0)) {
    db.prepare("INSERT OR IGNORE INTO vaults (handle) VALUES (?)").run(e.handle);
    const v = getVault(db, e.handle)!;
    db.prepare("UPDATE vaults SET lamports = ? WHERE handle = ?").run((big(v.lamports) + e.recipient).toString(), e.handle);
  }
  if (e.flywheel > BigInt(0)) addToBucket(db, e.flywheel);
  return true;
}

export function feeEventsFor(db: DatabaseSync, mint: string, limit = 50): FeeEventRow[] {
  return db.prepare("SELECT * FROM fee_events WHERE mint = ? ORDER BY slot DESC LIMIT ?").all(mint, limit) as unknown as FeeEventRow[];
}

export function feeTotalFor(db: DatabaseSync, mint: string): { lamports: bigint; recipient: bigint; count: number } {
  const rows = db.prepare("SELECT lamports, recipient FROM fee_events WHERE mint = ?").all(mint) as { lamports: string; recipient: string }[];
  return { lamports: rows.reduce((s, r) => s + big(r.lamports), BigInt(0)), recipient: rows.reduce((s, r) => s + big(r.recipient), BigInt(0)), count: rows.length };
}

export function getVault(db: DatabaseSync, handle: string): VaultRow | null {
  return (db.prepare("SELECT * FROM vaults WHERE handle = ?").get(normalizeHandle(handle)) as unknown as VaultRow | undefined) ?? null;
}

export function vaultBalance(v: VaultRow | null): bigint {
  return v ? big(v.lamports) - big(v.paidLamports) : BigInt(0);
}

export function listVaults(db: DatabaseSync): VaultRow[] {
  return db.prepare("SELECT * FROM vaults").all() as unknown as VaultRow[];
}

export function setVaultPaid(db: DatabaseSync, handle: string, paidLamports: bigint, xUserId?: string | null) {
  db.prepare("UPDATE vaults SET paidLamports = ? WHERE handle = ?").run(paidLamports.toString(), normalizeHandle(handle));
  if (xUserId) db.prepare("UPDATE vaults SET xUserId = ? WHERE handle = ? AND xUserId IS NULL").run(xUserId, normalizeHandle(handle));
}

export function flywheelState(db: DatabaseSync): { bucket: bigint; spent: bigint } {
  const row = db.prepare("SELECT bucketLamports, spentLamports FROM flywheel WHERE id = 1").get() as { bucketLamports: string; spentLamports: string } | undefined;
  return { bucket: big(row?.bucketLamports), spent: big(row?.spentLamports) };
}

export function addToBucket(db: DatabaseSync, lamports: bigint) {
  const f = flywheelState(db);
  db.prepare("INSERT INTO flywheel (id, bucketLamports, spentLamports) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET bucketLamports = excluded.bucketLamports")
    .run((f.bucket + lamports).toString(), f.spent.toString());
}

export function spendBucket(db: DatabaseSync, lamports: bigint) {
  const f = flywheelState(db);
  db.prepare("INSERT INTO flywheel (id, bucketLamports, spentLamports) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET bucketLamports = excluded.bucketLamports, spentLamports = excluded.spentLamports")
    .run((f.bucket - lamports).toString(), (f.spent + lamports).toString());
}

// ───────────────────────────── claims

export function getClaim(db: DatabaseSync, tweetId: string): ClaimRow | null {
  return (db.prepare("SELECT * FROM claims WHERE tweetId = ?").get(tweetId) as unknown as ClaimRow | undefined) ?? null;
}

export function listClaims(db: DatabaseSync, limit = 100): ClaimRow[] {
  return db.prepare("SELECT * FROM claims WHERE status = 'paid' ORDER BY at DESC LIMIT ?").all(limit) as unknown as ClaimRow[];
}

// ───────────────────────────── kv

export function kvGet(db: DatabaseSync, k: string): string | null {
  return (db.prepare("SELECT v FROM kv WHERE k = ?").get(k) as { v: string } | undefined)?.v ?? null;
}

export function kvSet(db: DatabaseSync, k: string, v: string) {
  db.prepare("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, v);
}
