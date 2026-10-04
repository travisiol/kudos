/**
 * Plays the KUDOS flow in headless Chrome over CDP against a local rig (zero deps:
 * --remote-debugging-port=0, Node's WebSocket):
 *
 *   connect → sign in → /launch for @yourfriend with a 0.1 SOL first buy → the wallet signs the
 *   transfer → a local engine stub answers a fresh mint → the coin is on /explore and /coin →
 *   canned pump.fun trades + a sweep → /claim with a post served by a local fake tweet endpoint →
 *   payout recorded → /payouts and /burn show it.
 *
 *   npm run build && npm run play
 *
 * Everything chain-side is the in-process fake RPC (tests/fake-rpc.ts); the operator and the test
 * wallet are fresh keypairs each run. Never point this at mainnet.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { Keypair, PublicKey } from "@solana/web3.js";
import { mintData, startFakeRpc, SYSTEM } from "../tests/fake-rpc.ts";
import { encodeTradeEvent } from "../src/server/pump/events.ts";

const PORT = 3970;
const base = `http://localhost:${PORT}`;
const root = resolve(import.meta.dirname, "..");
const shots = join(root, "shots");
mkdirSync(shots, { recursive: true });
mkdirSync(join(root, "data"), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// ── keys
const secret = nacl.sign.keyPair().secretKey;
const testAddress = bs58.encode(secret.slice(32));
const operator = Keypair.generate();
const OP = operator.publicKey.toBase58();
const MINT = Keypair.generate().publicKey.toBase58();
const PUMP = new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
console.log("test wallet:", testAddress, "operator:", OP);

// ── fake chain
const fake = await startFakeRpc();
fake.state.accounts.set(testAddress, { lamports: 2_500_000_000, owner: SYSTEM });
fake.state.accounts.set(OP, { lamports: 5_000_000_000, owner: SYSTEM });

// ── local stubs: launch engine, tweet reader, pump/dexscreener (404 → no market data)
const TWEET_ID = "1840000000000000777";
let engineCalls = 0;
const stub = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url === "/launch" && req.method === "POST") {
      engineCalls++;
      const j = JSON.parse(body);
      const ok = req.headers["x-kudos-secret"] === "play-secret" && j.forHandle === "yourfriend" && j.firstBuyLamports === "100000000";
      // The engine "launched": the mint exists on the fake chain and the operator holds the first-buy tokens.
      fake.state.accounts.set(MINT, { lamports: 1_461_600, owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", data: mintData(6, BigInt(1e15)) });
      res.writeHead(ok ? 200 : 400, { "content-type": "application/json" }).end(JSON.stringify({ mint: MINT, signature: bs58.encode(Buffer.alloc(64, 7)), creator: OP, tokensBought: "3500000000000" }));
      return;
    }
    if (req.url === `/status/${TWEET_ID}`) {
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({ tweet: { id: TWEET_ID, text: `Claiming my @kudoslaunch fees to my wallet: ${testAddress}`, author: { screen_name: "YourFriend", id: "777" } } }),
      );
      return;
    }
    res.writeHead(404).end("{}");
  });
});
await new Promise((r) => stub.listen(0, "127.0.0.1", r));
const stubUrl = `http://127.0.0.1:${stub.address().port}`;

// ── server
const dbPath = join(root, "data", "play.db");
for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) rmSync(f, { force: true });
const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
const server = spawn(process.execPath, [nextBin, "start", "-p", String(PORT)], {
  cwd: root,
  env: {
    ...process.env,
    SOLANA_RPC_URL: fake.url,
    KUDOS_DB_PATH: dbPath,
    OPERATOR_SECRET_KEY: bs58.encode(operator.secretKey),
    LAUNCH_WEBHOOK: `${stubUrl}/launch`,
    LAUNCH_SECRET: "play-secret",
    SWEEP_SECRET: "play-sweep",
    KUDOS_TWEET_API: stubUrl,
    PUMP_API_URL: stubUrl,
    DEXSCREENER_API_URL: stubUrl,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write(`[next] ${d}`));
for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch(`${base}/api/health`)).ok) break;
  } catch {}
  await sleep(500);
}

// ── a 256×256 PNG for the coin image
function png(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const o = y * (size * 3 + 1) + 1 + x * 3;
      const d = Math.hypot(x - size / 2, y - size / 2) / (size / 2);
      raw[o] = d < 0.55 ? 182 : 110 + y / 4;
      raw[o + 1] = d < 0.55 ? 255 : 60;
      raw[o + 2] = d < 0.55 ? 92 : 240;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const imgPath = join(root, "data", "play-coin.png");
writeFileSync(imgPath, png(256));

// ── chrome
const chromePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find((p) => p && existsSync(p));
const profile = join(tmpdir(), `kudos-play-${Date.now()}`);
const chrome = spawn(chromePath, ["--headless=new", "--no-first-run", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "--hide-scrollbars", "--window-size=1536,960", "about:blank"], { stdio: "ignore" });
let cdpPort = null;
for (let i = 0; i < 100 && !cdpPort; i++) {
  try {
    cdpPort = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]) || null;
  } catch {}
  if (!cdpPort) await sleep(150);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) rej(new Error(m.error.message));
        else res(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
}

async function main() {
  const target = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  const cdp = new Cdp(ws);
  await cdp.send("Page.enable");
  await cdp.send("DOM.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1536, height: 960, deviceScaleFactor: 1, mobile: false });
  const naclSrc = readFileSync(join(root, "node_modules", "tweetnacl", "nacl-fast.min.js"), "utf8");
  const wallet = readFileSync(join(root, "scripts", "dev-wallet.js"), "utf8");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `${naclSrc}\n;window.KUDOS_TEST_SECRET=${JSON.stringify(Array.from(secret))};window.KUDOS_TEST_RPC=${JSON.stringify(fake.url)};\n${wallet}`,
  });
  const js = async (expression) => (await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
  const clickText = (text, scope = "") =>
    js(`(() => { const b = [...document.querySelectorAll("${scope} button")].find((x) => x.textContent.trim().includes(${JSON.stringify(text)}) && !x.disabled); if (b) b.click(); return Boolean(b); })()`);
  const waitFor = async (expression, ms = 20000) => {
    for (let t = 0; t < ms; t += 250) {
      const v = await js(expression).catch(() => null);
      if (v) return v;
      await sleep(250);
    }
    return null;
  };
  const shot = async (name, full = false) => {
    if (full) {
      const h = await js("document.documentElement.scrollHeight");
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1536, height: Math.min(h, 4000), deviceScaleFactor: 1, mobile: false });
      await sleep(400);
    }
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(shots, `${name}.png`), Buffer.from(data, "base64"));
    if (full) await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1536, height: 960, deviceScaleFactor: 1, mobile: false });
    console.log(`     shots/${name}.png`);
  };
  const go = async (path, ready) => {
    await cdp.send("Page.navigate", { url: `${base}${path}` });
    await waitFor(`document.readyState === "complete" && ${ready ?? "true"}`);
    await sleep(900);
  };
  const setValue = (selector, value) =>
    js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);

  // 1. connect + sign in from /launch
  await go("/launch", `Boolean(document.querySelector("[data-testid=launch-btn]"))`);
  check("launch button reads 'Connect wallet to launch'", (await js(`document.querySelector("[data-testid=launch-btn]").innerText`)) === "Connect wallet to launch");
  await js(`document.querySelector("[data-testid=launch-btn]").click()`);
  check("wallet-standard lists Kudos Test", Boolean(await waitFor(`[...document.querySelectorAll(".wallet-option")].some((b) => b.textContent.includes("Kudos Test"))`)));
  await shot("play-1-connect-1536");
  await clickText("Kudos Test", "dialog[open]");
  const short = `${testAddress.slice(0, 4)}…${testAddress.slice(-4)}`;
  check("connected: header shows the short address", Boolean(await waitFor(`document.querySelector(".nav .wallet-connect")?.innerText.includes(${JSON.stringify(short)})`)));
  await waitFor(`[...document.querySelectorAll("dialog[open] button")].some((b) => b.textContent.trim() === "Sign in" && !b.disabled)`);
  await clickText("Sign in", "dialog[open]");
  check("signed in (ed25519 verified by the server)", Boolean(await waitFor(`Boolean(document.querySelector("[data-testid=signed-in]"))`)));
  await js(`document.querySelector("dialog[open]")?.close()`);

  // 2. fill the launch form
  await setValue("input[name=forHandle]", "@yourfriend");
  await setValue("input[name=name]", "Your Friend");
  await setValue("input[name=ticker]", "FRND");
  await setValue("textarea[name=description]", "Kudos to my friend.");
  await setValue("input[name=firstBuy]", "0.1");
  const { root: docRoot } = await cdp.send("DOM.getDocument");
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: docRoot.nodeId, selector: "input[name=image]" });
  await cdp.send("DOM.setFileInputFiles", { nodeId, files: [imgPath] });
  check("image preview shown", Boolean(await waitFor(`document.querySelector(".drop img")?.src.startsWith("data:image/png")`)));
  check("button names the recipient", Boolean(await waitFor(`document.querySelector("[data-testid=launch-btn]").innerText === "Launch for @yourfriend"`)));
  await shot("play-2-launch-form-1536");
  const sentBefore = fake.state.sent.length;
  await js(`document.querySelector("[data-testid=launch-btn]").click()`);
  const launched = await waitFor(`document.querySelector("[data-testid=launched]")?.innerText`, 60000);
  check("launch confirmed: first buy signed, engine answered", Boolean(launched), launched ?? (await js(`document.querySelector(".msg")?.innerText`)));
  check("the wallet sent the first-buy transfer and the engine was called once", fake.state.sent.length >= sentBefore + 1 && engineCalls === 1, `engine calls ${engineCalls}`);
  await sleep(2500); // after(): tokens forwarded to the launcher
  await shot("play-3-launched-1536");

  // 3. coin listed
  await go("/explore", `Boolean(document.querySelector("[data-testid=coin-grid]"))`);
  check("/explore lists the coin for @yourfriend", Boolean(await js(`document.querySelector("[data-testid=coin-grid]")?.innerText.includes("for @yourfriend")`)));
  await shot("play-4-explore-1536");

  // 4. canned trades on the coin's bonding curve + fees in the operator's creator vault, then a sweep
  const curve = PublicKey.findProgramAddressSync([Buffer.from("bonding-curve"), new PublicKey(MINT).toBuffer()], PUMP)[0].toBase58();
  const sigs = [];
  for (let i = 0; i < 4; i++) {
    const sig = bs58.encode(Buffer.from(`play-trade-${i}`.padEnd(64, "z")));
    fake.state.txs.set(sig, { slot: 3000 + i, logs: [encodeTradeEvent({ mint: MINT, user: testAddress, creator: OP, solAmount: BigInt(1_000_000_000), creatorFee: BigInt(3_000_000) })] });
    sigs.unshift(sig);
  }
  fake.state.sigsFor.set(curve, sigs);
  const creatorVault = PublicKey.findProgramAddressSync([Buffer.from("creator-vault"), operator.publicKey.toBuffer()], PUMP)[0].toBase58();
  fake.state.accounts.set(creatorVault, { lamports: 890_880 + 12_000_000, owner: SYSTEM });
  const sweep = await (await fetch(`${base}/api/sweep`, { method: "POST", headers: { "x-sweep-secret": "play-sweep" } })).json();
  check("sweep attributed 4 trades (90 % = 0.0108 SOL to @yourfriend)", sweep?.attribute?.events === 4 && sweep.attribute.recipientLamports === "10800000", JSON.stringify(sweep?.attribute ?? sweep));
  check("sweep collected the creator vault", Boolean(sweep?.claim?.sig), JSON.stringify(sweep?.claim));
  const refused = await fetch(`${base}/api/sweep`, { method: "POST" });
  check("sweep without the secret is refused", refused.status === 401);
  await go(`/coin/${MINT}`, `Boolean(document.querySelector("[data-testid=coin-head]"))`);
  check("/coin shows the fee rows", Boolean(await js(`document.querySelector("[data-testid=fee-events]")?.querySelectorAll("tbody tr").length === 4`)));
  await shot("play-5-coin-1536", true);

  // 5. claim by tweet
  await go("/claim", `Boolean(document.querySelector("input[name=tweet]"))`);
  await setValue("input[name=handle]", "@yourfriend");
  await clickText("Look up");
  check("vault lookup shows 0.0108 SOL waiting", Boolean(await waitFor(`document.querySelector("[data-testid=vault]")?.innerText.includes("0.0108 SOL waiting")`)));
  await setValue("input[name=tweet]", `https://x.com/YourFriend/status/${TWEET_ID}`);
  await js(`document.querySelector("[data-testid=claim-send]").click()`);
  const paid = await waitFor(`document.querySelector("[data-testid=claim-done]")?.innerText`, 60000);
  check("claim verified and paid", Boolean(paid) && paid.includes("0.0108 SOL"), paid ?? (await js(`document.querySelector(".msg")?.innerText`)));
  await shot("play-6-claim-1536");
  const again = await (await fetch(`${base}/api/claim`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify({ url: `https://x.com/YourFriend/status/${TWEET_ID}` }) })).json();
  check("the same post cannot claim twice", /already used/.test(again?.error ?? ""), again?.error);

  // 6. payouts + burn + ledger
  await go("/payouts", `Boolean(document.querySelector("[data-testid=sent]"))`);
  check("/payouts lists the payout", Boolean(await js(`document.querySelector("[data-testid=payout-list]")?.innerText.includes("@yourfriend")`)));
  await shot("play-7-payouts-1536");
  await go("/burn", `Boolean(document.querySelector("[data-testid=burn-status]"))`);
  check("/burn shows the fee collection and the bucket", Boolean(await js(`document.querySelector("[data-testid=burn-activity]")?.innerText.includes("Fees claimed") && document.querySelector("[data-testid=next-buyback]").innerText === "0.0012 SOL"`)));
  check("/burn status reads running", (await js(`document.querySelector("[data-testid=burn-status]").innerText.trim()`)) === "Running every 10 minutes");
  await shot("play-8-burn-1536", true);
  await go("/ledger", `Boolean(document.querySelector("[data-testid=ledger-table]"))`);
  const kinds = await js(`[...document.querySelectorAll("[data-testid=ledger-table] tbody tr td:nth-child(2)")].map((t) => t.innerText).join(",")`);
  check("ledger has the payout, the fee collection and the first-buy tokens", /Payout/.test(kinds) && /Fees collected/.test(kinds) && /Tokens sent/.test(kinds), kinds);
  ws.close();
}

let failed = true;
try {
  await main();
  failed = results.some((r) => !r.ok);
} catch (e) {
  console.error(e);
} finally {
  chrome.kill();
  server.kill();
  stub.close();
  await fake.close();
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
  console.log(failed ? "\nplay-ui: FAILED" : `\nplay-ui: green (${results.length} checks)`);
  process.exit(failed ? 1 : 0);
}
