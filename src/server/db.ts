import { DatabaseSync } from "node:sqlite";
import { accessSync, constants, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * One SQLite file (node:sqlite, no native module). Path: `KUDOS_DB_PATH`, else `./data/kudos.db`,
 * else the OS temp dir when the disk is read-only (Vercel: /tmp, per instance and ephemeral —
 * plug a real store behind an env var if a project needs durable history there).
 */
export function resolveDbPath(): { path: string; persistent: boolean } {
  const explicit = process.env["KUDOS_DB_PATH"]?.trim();
  const candidates = explicit ? [explicit] : [join(process.cwd(), "data", "kudos.db")];
  for (const file of candidates) {
    try {
      mkdirSync(/* turbopackIgnore: true */ dirname(file), { recursive: true });
      accessSync(/* turbopackIgnore: true */ dirname(file), constants.W_OK);
      return { path: file, persistent: !process.env["VERCEL"] };
    } catch {
      // fall through to the temp dir
    }
  }
  const dir = join(tmpdir(), "kudos");
  mkdirSync(dir, { recursive: true });
  return { path: join(dir, "kudos.db"), persistent: false };
}

export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    "to" TEXT,
    mint TEXT,
    amount TEXT NOT NULL,
    sig TEXT NOT NULL,
    at INTEGER NOT NULL,
    note TEXT,
    cluster TEXT NOT NULL DEFAULT 'mainnet-beta'
  );
  CREATE INDEX IF NOT EXISTS ledger_at ON ledger(at DESC);
  CREATE TABLE IF NOT EXISTS launches (
    id TEXT PRIMARY KEY, forHandle TEXT NOT NULL, name TEXT NOT NULL, ticker TEXT NOT NULL, imagePath TEXT,
    description TEXT, launcher TEXT NOT NULL, firstBuyLamports TEXT NOT NULL DEFAULT '0', status TEXT NOT NULL,
    paySig TEXT, mint TEXT, sig TEXT, error TEXT, createdAt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS coins (
    mint TEXT PRIMARY KEY, launchId TEXT, forHandle TEXT NOT NULL, name TEXT NOT NULL, ticker TEXT NOT NULL,
    image TEXT, creator TEXT, launcher TEXT, launchedAt INTEGER NOT NULL, sig TEXT,
    lastSig TEXT, pendingNewest TEXT, beforeSig TEXT
  );
  CREATE TABLE IF NOT EXISTS fee_events (
    mint TEXT NOT NULL, sig TEXT NOT NULL, slot INTEGER NOT NULL, lamports TEXT NOT NULL, handle TEXT,
    recipient TEXT NOT NULL, flywheel TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (mint, sig)
  );
  CREATE TABLE IF NOT EXISTS vaults (
    handle TEXT PRIMARY KEY, xUserId TEXT, lamports TEXT NOT NULL DEFAULT '0', paidLamports TEXT NOT NULL DEFAULT '0'
  );
  CREATE TABLE IF NOT EXISTS flywheel (id INTEGER PRIMARY KEY CHECK (id = 1), bucketLamports TEXT NOT NULL DEFAULT '0', spentLamports TEXT NOT NULL DEFAULT '0');
  CREATE TABLE IF NOT EXISTS claims (
    tweetId TEXT PRIMARY KEY, handle TEXT NOT NULL, xUserId TEXT, address TEXT NOT NULL, lamports TEXT NOT NULL,
    sig TEXT, status TEXT NOT NULL, at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`;

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(SCHEMA);
  return db;
}

const holder = globalThis as unknown as { __kudosDb?: { db: DatabaseSync; path: string; persistent: boolean } };

/** The process-wide database (survives dev hot reloads). */
export function db(): DatabaseSync {
  if (!holder.__kudosDb) {
    const { path, persistent } = resolveDbPath();
    holder.__kudosDb = { db: openDb(path), path, persistent };
  }
  return holder.__kudosDb.db;
}

export function dbInfo(): { path: string; persistent: boolean } {
  db();
  const { path, persistent } = holder.__kudosDb!;
  return { path, persistent };
}
