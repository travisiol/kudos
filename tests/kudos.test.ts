import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { MIN_PAYOUT_LAMPORTS, claimTweetText, flywheelCredit, splitFee } from "../src/config/kudos.ts";
import { clearChainCache } from "../src/server/chain.ts";
import { claimByTweet } from "../src/server/claim.ts";
import { openDb } from "../src/server/db.ts";
import { HttpError } from "../src/server/errors.ts";
import { LAUNCH_CLOSED, prepareLaunch, submitLaunch } from "../src/server/launch.ts";
import { listLedger } from "../src/server/operator.ts";
import { bondingCurvePda } from "../src/server/pump/instructions.ts";
import { encodeTradeEvent, parseEventLogs } from "../src/server/pump/events.ts";
import { feeTotalFor, flywheelState, getVault, insertCoin, vaultBalance } from "../src/server/store.ts";
import { attribute, buyback, claim } from "../src/server/sweep.ts";
import { statusIdFromUrl, syndicationToken } from "../src/server/tweet.ts";
import type { Tweet } from "../src/server/tweet.ts";
import { SYSTEM, startFakeRpc } from "./fake-rpc.ts";

process.env.KUDOS_DB_PATH = join(tmpdir(), `kudos-test-${process.pid}.db`);
const rpc = await startFakeRpc();
const operator = Keypair.generate();
const OP = operator.publicKey.toBase58();
const fixture = JSON.parse(readFileSync(new URL("./fixtures/pump-trade.json", import.meta.url), "utf8")) as { signature: string; slot: number; mint: string; logMessages: string[] };

// 1×1 PNG
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const code = async (p: Promise<unknown>) => p.then(() => 200, (e: HttpError) => e.status ?? 500);

before(() => {
  process.env.SOLANA_RPC_URL = rpc.url;
  process.env.SOLANA_CLUSTER = "devnet";
  process.env.OPERATOR_SECRET_KEY = bs58.encode(operator.secretKey);
  delete process.env.NEXT_PUBLIC_MINT;
  rpc.state.accounts.set(OP, { lamports: 5_000_000_000, owner: SYSTEM });
});
beforeEach(() => clearChainCache());
after(() => rpc.close());

/** Seeds `n` trades of `mint` on its bonding curve, each paying `fee` lamports of creator fee. */
function seedTrades(mint: string, creator: string, n: number, fee: bigint, tag: string) {
  const curve = bondingCurvePda(new PublicKey(mint)).toBase58();
  const list = rpc.state.sigsFor.get(curve) ?? [];
  for (let i = 0; i < n; i++) {
    const sig = bs58.encode(Buffer.from(`${tag}-${i}-${mint}`.padEnd(64, "x").slice(0, 64)));
    rpc.state.txs.set(sig, { slot: 2000 + list.length, logs: ["Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]", encodeTradeEvent({ mint, user: OP, creator, solAmount: fee * BigInt(333), creatorFee: fee })] });
    list.unshift(sig);
  }
  rpc.state.sigsFor.set(curve, list);
}

test("TradeEvent parsing reads creator_fee from a real mainnet pump.fun trade", () => {
  const [e] = parseEventLogs(fixture.logMessages);
  assert.equal(e.kind, "trade");
  if (e.kind !== "trade") return;
  assert.equal(e.mint, fixture.mint);
  assert.ok(e.creatorFee > BigInt(0));
  // pump.fun creator fee is 30 bps of the SOL amount
  assert.equal(e.creatorFee, (e.solAmount * BigInt(30) + BigInt(9999)) / BigInt(10_000));
});

test("attribution credits 90 % to the vault and 10 % to the flywheel, and a re-run credits nothing twice", async () => {
  const db = openDb(":memory:");
  const mint = Keypair.generate().publicKey.toBase58();
  insertCoin(db, { mint, launchId: null, forHandle: "YourFriend", name: "Friend", ticker: "FRND", image: null, creator: OP, launcher: null, launchedAt: Date.now(), sig: null });
  seedTrades(mint, OP, 3, BigInt(1_000_000), "a");
  seedTrades(mint, Keypair.generate().publicKey.toBase58(), 1, BigInt(5_000_000), "other-creator");
  const first = await attribute(db);
  assert.equal(first.events, 3);
  assert.equal(vaultBalance(getVault(db, "yourfriend")), BigInt(2_700_000));
  assert.equal(flywheelState(db).bucket, BigInt(300_000));
  const again = await attribute(db);
  assert.equal(again.events, 0);
  assert.equal(vaultBalance(getVault(db, "@YOURFRIEND")), BigInt(2_700_000));
  seedTrades(mint, OP, 2, BigInt(1_000_000), "b");
  assert.equal((await attribute(db)).events, 2);
  assert.equal(feeTotalFor(db, mint).lamports, BigInt(5_000_000));
});

test("splitFee and flywheel math: bucket gets 10 % of launched fees + 20 % of $KUDOS's own", () => {
  assert.deepEqual(splitFee(BigInt(1001)), { recipient: BigInt(900), flywheel: BigInt(101) });
  assert.equal(flywheelCredit(BigInt(1_000_000), BigInt(0)), BigInt(100_000));
  assert.equal(flywheelCredit(BigInt(1_000_000), BigInt(500_000)), BigInt(200_000));
});

function vaultWith(db: ReturnType<typeof openDb>, handle: string, lamports: bigint) {
  insertCoin(db, { mint: Keypair.generate().publicKey.toBase58(), launchId: null, forHandle: handle, name: "x", ticker: "X", image: null, creator: OP, launcher: null, launchedAt: Date.now(), sig: null });
  db.prepare("UPDATE vaults SET lamports = ? WHERE handle = ?").run(lamports.toString(), handle.toLowerCase());
}

const wallet = Keypair.generate().publicKey.toBase58();
const tweetBy = (handle: string, text: string, authorId = "42"): ((id: string) => Promise<Tweet>) => async (id) => ({ id, authorHandle: handle, authorId, text });

test("a verified tweet pays the whole vault once; the same tweet is refused after", async () => {
  const db = openDb(":memory:");
  vaultWith(db, "yourfriend", BigInt(5_000_000));
  const url = "https://x.com/yourfriend/status/1840000000000000001";
  const out = await claimByTweet(url, { db, fetcher: tweetBy("YourFriend", claimTweetText(wallet)) });
  assert.equal(out.address, wallet);
  assert.equal(out.lamports, "5000000");
  const tx = Transaction.from(rpc.state.sent.at(-1)!.raw);
  assert.equal(tx.instructions[0].data.readBigUInt64LE(4), BigInt(5_000_000));
  assert.equal(tx.instructions[1].data.toString("utf8"), "kudos claim @yourfriend tweet 1840000000000000001");
  assert.equal(vaultBalance(getVault(db, "yourfriend")), BigInt(0));
  assert.equal(getVault(db, "yourfriend")?.xUserId, "42");
  assert.equal(await code(claimByTweet(url, { db, fetcher: tweetBy("YourFriend", claimTweetText(wallet)) })), 409);
  const [row] = listLedger(db);
  assert.equal(row.kind, "sol");
  assert.equal(row.to, wallet);
});

test("claims are refused for a handle mismatch, a missing address, two addresses or a missing tag", async () => {
  const db = openDb(":memory:");
  vaultWith(db, "yourfriend", BigInt(5_000_000));
  const u = (n: number) => `https://twitter.com/x/status/18400000000000001${n}`;
  assert.equal(await code(claimByTweet(u(1), { db, fetcher: tweetBy("someoneelse", claimTweetText(wallet)) })), 404);
  assert.equal(await code(claimByTweet(u(2), { db, fetcher: tweetBy("yourfriend", claimTweetText("")) })), 400);
  const other = Keypair.generate().publicKey.toBase58();
  assert.equal(await code(claimByTweet(u(3), { db, fetcher: tweetBy("yourfriend", `${claimTweetText(wallet)} ${other}`) })), 400);
  assert.equal(await code(claimByTweet(u(4), { db, fetcher: tweetBy("yourfriend", `my wallet ${wallet}`) })), 400);
  assert.equal(vaultBalance(getVault(db, "yourfriend")), BigInt(5_000_000));
  assert.equal(await code(claimByTweet("https://example.com/nope", { db })), 400);
});

test("a recycled handle (other X user id) cannot drain the vault; below 0.001 SOL nothing is sent", async () => {
  const db = openDb(":memory:");
  vaultWith(db, "yourfriend", BigInt(5_000_000));
  db.prepare("UPDATE vaults SET xUserId = '42' WHERE handle = 'yourfriend'").run();
  assert.equal(await code(claimByTweet("https://x.com/a/status/1840000000000000201", { db, fetcher: tweetBy("yourfriend", claimTweetText(wallet), "99") })), 403);
  vaultWith(db, "small", MIN_PAYOUT_LAMPORTS - BigInt(1));
  const sent = rpc.state.sent.length;
  assert.equal(await code(claimByTweet("https://x.com/a/status/1840000000000000202", { db, fetcher: tweetBy("small", claimTweetText(wallet)) })), 400);
  assert.equal(rpc.state.sent.length, sent);
});

test("tweet links parse; the syndication token matches X's embed formula", () => {
  assert.equal(statusIdFromUrl("https://x.com/yourfriend/status/1840000000000000001?s=20"), "1840000000000000001");
  assert.equal(statusIdFromUrl("https://mobile.twitter.com/a_b/status/123456789"), "123456789");
  assert.equal(statusIdFromUrl("https://x.com/home"), null);
  assert.match(syndicationToken("1840000000000000001"), /^[0-9a-z]+$/);
});

test("the sweep skips the creator-fee claim under 0.002 SOL and claims above it", async () => {
  const db = openDb(":memory:");
  const vault = PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), operator.publicKey.toBuffer()], new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"))[0].toBase58();
  rpc.state.accounts.set(vault, { lamports: 890_880 + 1_000_000, owner: SYSTEM });
  assert.deepEqual(await claim(db), { skipped: "under the claim minimum" });
  clearChainCache();
  rpc.state.accounts.set(vault, { lamports: 890_880 + 3_000_000, owner: SYSTEM });
  const r = await claim(db);
  assert.ok("sig" in r, String(Object.keys(r)));
  const tx = Transaction.from(rpc.state.sent.at(-1)!.raw);
  assert.deepEqual([...tx.instructions[0].data], [20, 22, 86, 123, 198, 28, 219, 132]);
  assert.equal(listLedger(db)[0].kind, "claim");
  assert.equal(listLedger(db)[0].amount, "3000000");
});

test("buyback: without a mint the bucket accumulates and nothing is spent", async () => {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO flywheel (id, bucketLamports, spentLamports) VALUES (1, '50000000', '0')").run();
  let called = false;
  const r = await buyback(db, (async () => {
    called = true;
    return new Response("{}");
  }) as unknown as typeof fetch);
  assert.deepEqual(r, { skipped: "no mint: the bucket accumulates" });
  assert.equal(called, false);
  assert.equal(flywheelState(db).bucket, BigInt(50_000_000));
});

test("launch: refused without sign-in; webhook unset → the neutral sentence and nothing stored", async () => {
  process.env.LAUNCH_WEBHOOK = "http://engine.local/launch";
  assert.equal(await code(prepareLaunch(null, { forHandle: "yourfriend", name: "Friend", ticker: "FRND", image: PNG }, openDb(":memory:"))), 401);
  delete process.env.LAUNCH_WEBHOOK;
  const db = openDb(":memory:");
  await assert.rejects(prepareLaunch(wallet, { forHandle: "yourfriend", name: "Friend", ticker: "FRND", image: PNG }, db), (e: HttpError) => e.message === LAUNCH_CLOSED && e.status === 503);
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM launches").get() as { n: number }).n, 0);
});

test("launch: bad handle, bad ticker and non-square image are refused", async () => {
  process.env.LAUNCH_WEBHOOK = "http://engine.local/launch";
  const db = openDb(":memory:");
  assert.equal(await code(prepareLaunch(wallet, { forHandle: "not a handle!", name: "F", ticker: "F", image: PNG }, db)), 400);
  assert.equal(await code(prepareLaunch(wallet, { forHandle: "ok", name: "F", ticker: "TOOLONGTICKER", image: PNG }, db)), 400);
  const wide = Buffer.from(PNG.split(",")[1], "base64");
  wide.writeUInt32BE(400, 16);
  wide.writeUInt32BE(100, 20);
  assert.equal(await code(prepareLaunch(wallet, { forHandle: "ok", name: "F", ticker: "F", image: `data:image/png;base64,${wide.toString("base64")}` }, db)), 400);
});

test("launch with a first buy: the transfer is confirmed, its amount read from chain, the engine called, the coin stored", async () => {
  process.env.LAUNCH_WEBHOOK = "http://engine.local/launch";
  process.env.LAUNCH_SECRET = "s3cret";
  const db = openDb(":memory:");
  const launcher = Keypair.generate();
  const L = launcher.publicKey.toBase58();
  const prep = await prepareLaunch(L, { forHandle: "@YourFriend", name: "Friend", ticker: "frnd", image: PNG, firstBuySol: "0.1" }, db);
  assert.ok(prep.transaction);
  const tx = Transaction.from(Buffer.from(prep.transaction!, "base64"));
  tx.partialSign(launcher);
  const sig = await (await import("../src/server/chain.ts")).connection().sendRawTransaction(tx.serialize());
  const mint = Keypair.generate().publicKey.toBase58();
  let body: Record<string, unknown> = {};
  let secret = "";
  const engine = (async (_url: string, init: RequestInit) => {
    body = JSON.parse(String(init.body));
    secret = new Headers(init.headers).get("x-kudos-secret") ?? "";
    return Response.json({ mint, signature: "engineSig", creator: OP, tokensBought: "123456" });
  }) as unknown as typeof fetch;
  // someone else cannot submit it
  assert.equal(await code(submitLaunch(wallet, prep.id, sig, db, engine)), 404);
  const out = await submitLaunch(L, prep.id, sig, db, engine);
  assert.equal(out.mint, mint);
  assert.equal(out.tokensBought, BigInt(123456));
  assert.equal(body.firstBuyLamports, "100000000");
  assert.equal(body.forHandle, "YourFriend");
  assert.equal(body.ticker, "FRND");
  assert.equal(secret, "s3cret");
  assert.ok(String(body.imageDataUrl).startsWith("data:image/png;base64,"));
  const coin = db.prepare("SELECT * FROM coins WHERE mint = ?").get(mint) as { forHandle: string; launcher: string };
  assert.equal(coin.forHandle, "yourfriend");
  assert.equal(coin.launcher, L);
  // the same transfer cannot pay for another launch
  const prep2 = await prepareLaunch(L, { forHandle: "b", name: "B", ticker: "B", image: PNG, firstBuySol: "0.1" }, db);
  assert.equal(await code(submitLaunch(L, prep2.id, sig, db, engine)), 409);
});
