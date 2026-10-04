/**
 * Claim by tweet: the recipient posts their address tagging our X account, pastes the link, and
 * the operator pays the vault's whole balance to that address (memo names the handle and tweet).
 */
import type { DatabaseSync } from "node:sqlite";
import { PublicKey } from "@solana/web3.js";
import { MIN_PAYOUT_LAMPORTS, normalizeHandle, xHandle } from "../config/kudos.ts";
import { db as defaultDb } from "./db.ts";
import { HttpError } from "./errors.ts";
import { operatorKeypair, sendSol, PAYOUTS_CLOSED } from "./operator.ts";
import type { PayoutResult } from "./operator.ts";
import { getClaim, getVault, setVaultPaid, vaultBalance } from "./store.ts";
import { fetchTweet, statusIdFromUrl } from "./tweet.ts";
import type { TweetFetcher } from "./tweet.ts";

const B58 = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

/** Every distinct valid Solana address in a text. */
export function addressesIn(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.match(B58) ?? []) {
    try {
      if (new PublicKey(m).toBase58() === m) found.add(m);
    } catch {
      // not a public key
    }
  }
  return [...found];
}

export interface ClaimOutcome {
  handle: string;
  address: string;
  lamports: string;
  sig: string;
  tweetId: string;
}

type Sender = (to: string, lamports: bigint, note: string, db: DatabaseSync, memo: string) => Promise<PayoutResult>;
const defaultSender: Sender = (to, lamports, note, db, memo) => sendSol(to, lamports, note, db, memo);

export async function claimByTweet(url: string, deps: { db?: DatabaseSync; fetcher?: TweetFetcher; send?: Sender } = {}): Promise<ClaimOutcome> {
  const db = deps.db ?? defaultDb();
  const id = statusIdFromUrl(url);
  if (!id) throw new HttpError(400, "Paste the link of your post (x.com/…/status/…).");
  if (getClaim(db, id)) throw new HttpError(409, "This post was already used for a claim.");
  const tweet = await (deps.fetcher ?? fetchTweet)(id);
  if (!tweet) throw new HttpError(404, "We could not read that post. Is the account public?");
  const handle = normalizeHandle(tweet.authorHandle);
  if (!new RegExp(`@${xHandle()}(?![A-Za-z0-9_])`, "i").test(tweet.text)) throw new HttpError(400, `The post must tag @${xHandle()}.`);
  const addresses = addressesIn(tweet.text);
  if (addresses.length === 0) throw new HttpError(400, "The post has no Solana wallet address in it.");
  if (addresses.length > 1) throw new HttpError(400, "The post has more than one address. Post exactly one.");
  const vault = getVault(db, handle);
  if (!vault) throw new HttpError(404, `No coin was launched for @${tweet.authorHandle} yet.`);
  if (vault.xUserId && tweet.authorId && vault.xUserId !== tweet.authorId) throw new HttpError(403, "This vault belongs to another X account with that name.");
  const balance = vaultBalance(vault);
  if (balance < MIN_PAYOUT_LAMPORTS) throw new HttpError(400, "The vault holds less than 0.001 SOL, the smallest payout.");
  if (!operatorKeypair() && !deps.send) throw new HttpError(503, PAYOUTS_CLOSED);
  const address = addresses[0];
  const paidBefore = BigInt(vault.paidLamports);
  // Reserve the tweet and the balance before sending, so a second request cannot pay twice.
  db.prepare("INSERT INTO claims (tweetId, handle, xUserId, address, lamports, status, at) VALUES (?, ?, ?, ?, ?, 'sending', ?)").run(
    id, handle, tweet.authorId, address, balance.toString(), Date.now(),
  );
  setVaultPaid(db, handle, paidBefore + balance, tweet.authorId);
  let result: PayoutResult;
  try {
    result = await (deps.send ?? defaultSender)(address, balance, `claim @${handle} tweet ${id}`, db, `kudos claim @${handle} tweet ${id}`);
  } catch {
    result = { error: "The payout could not be sent." };
  }
  if ("error" in result) {
    db.prepare("DELETE FROM claims WHERE tweetId = ?").run(id);
    setVaultPaid(db, handle, paidBefore);
    throw new HttpError(502, result.error);
  }
  db.prepare("UPDATE claims SET status = 'paid', sig = ? WHERE tweetId = ?").run(result.sig, id);
  return { handle, address, lamports: balance.toString(), sig: result.sig, tweetId: id };
}
