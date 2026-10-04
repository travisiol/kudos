/**
 * Launch requests. The site never creates a coin: it validates the request, takes the optional
 * first buy (a SystemProgram transfer from the launcher to the operator with a memo = launch id,
 * confirmed and read back from the chain), then hands the request to the owner's engine through
 * LAUNCH_WEBHOOK, which launches with the operator wallet as the coin's creator.
 *
 * Webhook contract: POST JSON {id, name, ticker, description, imageDataUrl, forHandle, launcher,
 * firstBuyLamports} with header `x-kudos-secret: LAUNCH_SECRET`; reply 200 JSON
 * {mint, signature, creator, tokensBought?} (tokensBought in base units, as a string or number).
 */
import type { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { ENV, HANDLE_RE, MAX_IMAGE_BYTES, MEMO_PROGRAM } from "../config/kudos.ts";
import { LAMPORTS_PER_SOL } from "../config/solana.ts";
import { confirmTx, connection } from "./chain.ts";
import { db as defaultDb, dbInfo } from "./db.ts";
import { HttpError } from "./errors.ts";
import { operatorAddress } from "./operator.ts";
import { getLaunch, insertCoin, insertLaunch, paySigUsed, updateLaunch } from "./store.ts";

export const LAUNCH_CLOSED = "Launching is not open yet.";

export interface LaunchInput {
  forHandle?: string;
  name?: string;
  ticker?: string;
  description?: string;
  image?: string; // data URL
  firstBuySol?: string | number;
}

export interface CleanLaunch {
  forHandle: string;
  name: string;
  ticker: string;
  description: string;
  image: { mime: string; bytes: Buffer };
  firstBuyLamports: bigint;
}

/** Width/height of a PNG, JPEG, GIF or WebP, or null. */
export function imageSize(b: Buffer): { w: number; h: number } | null {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.length > 10 && b.toString("ascii", 0, 3) === "GIF") return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
  if (b.length > 30 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
    const kind = b.toString("ascii", 12, 16);
    if (kind === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (kind === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (kind === "VP8L") {
      const bits = b.readUInt32LE(21);
      return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) return null;
      const marker = b[o + 1];
      const len = b.readUInt16BE(o + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { w: b.readUInt16BE(o + 7), h: b.readUInt16BE(o + 5) };
      o += 2 + len;
    }
  }
  return null;
}

export function parseSolAmount(v: string | number | undefined): bigint {
  const s = String(v ?? "").trim();
  if (!s) return BigInt(0);
  if (!/^\d+(\.\d{1,9})?$/.test(s)) throw new HttpError(400, "First buy must be an amount in SOL, like 0.1.");
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole) * BigInt(LAMPORTS_PER_SOL) + BigInt(frac.padEnd(9, "0"));
}

export function validateLaunch(input: LaunchInput): CleanLaunch {
  const forHandle = String(input.forHandle ?? "").trim().replace(/^@/, "");
  if (!HANDLE_RE.test(forHandle)) throw new HttpError(400, "Enter an X handle: letters, numbers and _, up to 15.");
  if (ENV.blockedHandles().includes(forHandle.toLowerCase())) throw new HttpError(403, "This account asked not to have coins launched for it.");
  const name = String(input.name ?? "").trim();
  if (!name || name.length > 32) throw new HttpError(400, "Give the coin a name (up to 32 characters).");
  const ticker = String(input.ticker ?? "").trim().replace(/^\$/, "").toUpperCase();
  if (!/^[A-Z0-9]{1,10}$/.test(ticker)) throw new HttpError(400, "Ticker: letters and numbers, up to 10.");
  const description = String(input.description ?? "").trim().slice(0, 500);
  const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(input.image ?? ""));
  if (!m) throw new HttpError(400, "Add an image (PNG, JPG, GIF or WebP).");
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > MAX_IMAGE_BYTES) throw new HttpError(400, "The image is over 4 MB.");
  const size = imageSize(bytes);
  if (!size || !size.w || !size.h) throw new HttpError(400, "That image could not be read.");
  const ratio = size.w / size.h;
  if (ratio < 0.8 || ratio > 1.25) throw new HttpError(400, "Use a square image (or close to square).");
  const firstBuyLamports = parseSolAmount(input.firstBuySol);
  if (firstBuyLamports > BigInt(100) * BigInt(LAMPORTS_PER_SOL)) throw new HttpError(400, "First buy is capped at 100 SOL.");
  return { forHandle, name, ticker, description, image: { mime: m[1], bytes }, firstBuyLamports };
}

export function imagesDir(): string {
  return join(dirname(dbInfo().path), "images");
}

/** The unsigned first-buy transfer the launcher's wallet signs and sends. */
export function buildFirstBuyTx(launcher: string, operator: string, lamports: bigint, launchId: string, blockhash: string): Transaction {
  const from = new PublicKey(launcher);
  const tx = new Transaction({ feePayer: from, recentBlockhash: blockhash });
  tx.add(SystemProgram.transfer({ fromPubkey: from, toPubkey: new PublicKey(operator), lamports }));
  tx.add(new TransactionInstruction({ programId: new PublicKey(MEMO_PROGRAM), keys: [{ pubkey: from, isSigner: true, isWritable: false }], data: Buffer.from(`kudos launch ${launchId}`, "utf8") }));
  return tx;
}

export interface Prepared {
  id: string;
  /** base64 wire transaction to sign, or null when there is no first buy. */
  transaction: string | null;
}

/** Validates and stores the request. Without LAUNCH_WEBHOOK nothing is stored. */
export async function prepareLaunch(launcher: string | null, input: LaunchInput, db: DatabaseSync = defaultDb()): Promise<Prepared> {
  if (!launcher) throw new HttpError(401, "Sign in with your wallet first.");
  if (!ENV.launchWebhook()) throw new HttpError(503, LAUNCH_CLOSED);
  const clean = validateLaunch(input);
  const operator = operatorAddress();
  if (clean.firstBuyLamports > BigInt(0) && !operator) throw new HttpError(503, LAUNCH_CLOSED);
  const id = randomBytes(8).toString("hex");
  const ext = clean.image.mime.split("/")[1].replace("jpeg", "jpg");
  mkdirSync(imagesDir(), { recursive: true });
  const imagePath = join(imagesDir(), `${id}.${ext}`);
  writeFileSync(imagePath, clean.image.bytes);
  insertLaunch(db, {
    id,
    forHandle: clean.forHandle,
    name: clean.name,
    ticker: clean.ticker,
    imagePath,
    description: clean.description || null,
    launcher,
    firstBuyLamports: clean.firstBuyLamports.toString(),
    status: clean.firstBuyLamports > BigInt(0) ? "awaiting-payment" : "ready",
    createdAt: Date.now(),
  });
  if (clean.firstBuyLamports === BigInt(0)) return { id, transaction: null };
  const { blockhash } = await connection().getLatestBlockhash("confirmed");
  const tx = buildFirstBuyTx(launcher, operator!, clean.firstBuyLamports, id, blockhash);
  return { id, transaction: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64") };
}

/** Reads a confirmed transaction and returns the lamports `from` sent to `to` with memo `kudos launch <id>`. */
export async function readFirstBuy(sig: string, from: string, to: string, launchId: string): Promise<bigint> {
  const status = await confirmTx(sig, 45_000, 800);
  if (status !== "confirmed" && status !== "finalized") throw new HttpError(400, "The first-buy transfer is not confirmed.");
  const tx = await connection().getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  if (!tx || tx.meta?.err) throw new HttpError(400, "The first-buy transfer failed.");
  const msg = tx.transaction.message;
  const keys = msg.staticAccountKeys.map((k) => k.toBase58());
  let lamports = BigInt(0);
  let memoOk = false;
  for (const ix of msg.compiledInstructions) {
    const program = keys[ix.programIdIndex];
    const data = Buffer.from(ix.data);
    if (program === SystemProgram.programId.toBase58() && data.length === 12 && data.readUInt32LE(0) === 2) {
      const [src, dst] = ix.accountKeyIndexes.map((i) => keys[i]);
      if (src === from && dst === to) lamports += data.readBigUInt64LE(4);
    }
    if (program === MEMO_PROGRAM && data.toString("utf8") === `kudos launch ${launchId}`) memoOk = true;
  }
  if (!memoOk) throw new HttpError(400, "That transfer is not for this launch.");
  return lamports;
}

export interface WebhookReply {
  mint: string;
  signature: string;
  creator: string;
  tokensBought?: string | number;
}

/** Confirms the first buy (if any), calls the engine, stores the coin. Returns the coin and tokens owed to the launcher. */
export async function submitLaunch(
  launcher: string,
  id: string,
  paySig: string | null,
  db: DatabaseSync = defaultDb(),
  fetcher: typeof fetch = fetch,
): Promise<{ mint: string; signature: string; tokensBought: bigint }> {
  const webhook = ENV.launchWebhook();
  if (!webhook) throw new HttpError(503, LAUNCH_CLOSED);
  const launch = getLaunch(db, id);
  if (!launch || launch.launcher !== launcher) throw new HttpError(404, "Launch request not found.");
  if (launch.status === "launched" && launch.mint) return { mint: launch.mint, signature: launch.sig ?? "", tokensBought: BigInt(0) };
  let firstBuy = BigInt(0);
  if (launch.status === "awaiting-payment") {
    if (!paySig) throw new HttpError(400, "Sign the first-buy transfer in your wallet first.");
    if (paySigUsed(db, paySig)) throw new HttpError(409, "That transfer was already used.");
    firstBuy = await readFirstBuy(paySig, launcher, operatorAddress() ?? "", id);
    if (firstBuy <= BigInt(0)) throw new HttpError(400, "No transfer to the launch wallet was found in that transaction.");
    updateLaunch(db, id, { paySig, firstBuyLamports: firstBuy.toString(), status: "paid" });
  } else {
    firstBuy = BigInt(launch.firstBuyLamports);
  }
  const image = launch.imagePath ? readFileSync(launch.imagePath) : Buffer.alloc(0);
  const mime = launch.imagePath?.endsWith(".png") ? "image/png" : launch.imagePath?.endsWith(".gif") ? "image/gif" : launch.imagePath?.endsWith(".webp") ? "image/webp" : "image/jpeg";
  let reply: WebhookReply;
  try {
    const r = await fetcher(webhook, {
      method: "POST",
      headers: { "content-type": "application/json", "x-kudos-secret": ENV.launchSecret() },
      body: JSON.stringify({
        id,
        name: launch.name,
        ticker: launch.ticker,
        description: launch.description ?? "",
        imageDataUrl: `data:${mime};base64,${image.toString("base64")}`,
        forHandle: launch.forHandle,
        launcher,
        firstBuyLamports: firstBuy.toString(),
      }),
      signal: AbortSignal.timeout(50_000),
    });
    if (!r.ok) throw new Error(String(r.status));
    reply = (await r.json()) as WebhookReply;
    new PublicKey(reply.mint);
  } catch {
    updateLaunch(db, id, { error: "engine did not answer" });
    throw new HttpError(502, "The launch engine did not answer. Your first buy is recorded; try again in a minute.");
  }
  updateLaunch(db, id, { status: "launched", mint: reply.mint, sig: reply.signature, error: null });
  insertCoin(db, {
    mint: reply.mint,
    launchId: id,
    forHandle: launch.forHandle,
    name: launch.name,
    ticker: launch.ticker,
    image: `/api/image/${id}`,
    creator: reply.creator ?? null,
    launcher,
    launchedAt: Date.now(),
    sig: reply.signature,
  });
  return { mint: reply.mint, signature: reply.signature, tokensBought: BigInt(String(reply.tokensBought ?? "0")) };
}
