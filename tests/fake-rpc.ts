/**
 * An in-process Solana JSON-RPC server with canned accounts, for tests and for scripts/play-ui.mjs.
 * Answers the methods the base uses, in the shapes @solana/web3.js 1.98 validates. Listens on an
 * OS-assigned port (0) so it never claims a fixed port.
 *
 *   node tests/fake-rpc.ts            -> prints {"url": "..."} and serves until killed
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import bs58 from "bs58";
import { VersionedTransaction } from "@solana/web3.js";

export interface FakeAccount {
  lamports: number;
  owner: string;
  data?: Buffer;
}

export interface FakeState {
  slot: number;
  blockhash: string;
  accounts: Map<string, FakeAccount>;
  largest: Map<string, { address: string; amount: bigint; decimals: number }[]>;
  supply: Map<string, { amount: bigint; decimals: number }>;
  sent: { signature: string; raw: Buffer }[];
  calls: string[];
  /** Canned transactions by signature (logs only), e.g. pump.fun trades. */
  txs: Map<string, { slot: number; logs: string[] }>;
  /** Signatures touching an address, newest first. */
  sigsFor: Map<string, string[]>;
}

export const SYSTEM = "11111111111111111111111111111111";

/** A 165-byte SPL token account: mint, owner, amount (offset 64). */
export function tokenAccountData(mint: string, owner: string, amount: bigint): Buffer {
  const b = Buffer.alloc(165);
  Buffer.from(bs58.decode(mint)).copy(b, 0);
  Buffer.from(bs58.decode(owner)).copy(b, 32);
  b.writeBigUInt64LE(amount, 64);
  b[108] = 1; // initialized
  return b;
}

/** An 82-byte mint account with `decimals` at offset 44. */
export function mintData(decimals: number, supply: bigint): Buffer {
  const b = Buffer.alloc(82);
  b.writeBigUInt64LE(supply, 36);
  b[44] = decimals;
  b[45] = 1;
  return b;
}

export function newState(): FakeState {
  return {
    slot: 1000,
    blockhash: "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi",
    accounts: new Map(),
    largest: new Map(),
    supply: new Map(),
    sent: [],
    calls: [],
    txs: new Map(),
    sigsFor: new Map(),
  };
}

function encodeAccount(a: FakeAccount | undefined) {
  if (!a) return null;
  const data = a.data ?? Buffer.alloc(0);
  return { data: [data.toString("base64"), "base64"], executable: false, lamports: a.lamports, owner: a.owner, rentEpoch: 0, space: data.length };
}

/** First signature of a wire transaction = its id. */
function signatureOf(raw: Buffer): string {
  return bs58.encode(raw.subarray(1, 65));
}

type Params = unknown[];

export function answer(state: FakeState, method: string, params: Params): { result?: unknown; error?: { code: number; message: string } } {
  state.calls.push(method);
  const context = { slot: state.slot, apiVersion: "2.2.0" };
  switch (method) {
    case "getHealth":
      return { result: "ok" };
    case "getSlot":
      return { result: state.slot };
    case "getBlockHeight":
      return { result: state.slot };
    case "getBalance":
      return { result: { context, value: state.accounts.get(String(params[0]))?.lamports ?? 0 } };
    case "getAccountInfo":
      return { result: { context, value: encodeAccount(state.accounts.get(String(params[0]))) } };
    case "getMultipleAccounts":
      return { result: { context, value: (params[0] as string[]).map((k) => encodeAccount(state.accounts.get(k))) } };
    case "getTokenAccountBalance": {
      const a = state.accounts.get(String(params[0]));
      if (!a?.data) return { error: { code: -32602, message: "Invalid param: could not find account" } };
      const amount = a.data.readBigUInt64LE(64);
      const mint = bs58.encode(a.data.subarray(0, 32));
      const decimals = state.supply.get(mint)?.decimals ?? 6;
      return { result: { context, value: { amount: amount.toString(), decimals, uiAmount: Number(amount) / 10 ** decimals, uiAmountString: String(Number(amount) / 10 ** decimals) } } };
    }
    case "getTokenSupply": {
      const s = state.supply.get(String(params[0]));
      if (!s) return { error: { code: -32602, message: "Invalid param: not a Token mint" } };
      return { result: { context, value: { amount: s.amount.toString(), decimals: s.decimals, uiAmount: Number(s.amount) / 10 ** s.decimals, uiAmountString: String(Number(s.amount) / 10 ** s.decimals) } } };
    }
    case "getTokenLargestAccounts": {
      const list = state.largest.get(String(params[0])) ?? [];
      return {
        result: {
          context,
          value: list.map((l) => ({ address: l.address, amount: l.amount.toString(), decimals: l.decimals, uiAmount: Number(l.amount) / 10 ** l.decimals, uiAmountString: String(Number(l.amount) / 10 ** l.decimals) })),
        },
      };
    }
    case "getTokenAccountsByOwner":
      return { result: { context, value: [] } };
    case "getLatestBlockhash":
      return { result: { context, value: { blockhash: state.blockhash, lastValidBlockHeight: state.slot + 150 } } };
    case "sendTransaction": {
      const raw = Buffer.from(String(params[0]), "base64");
      const signature = signatureOf(raw);
      state.sent.push({ signature, raw });
      return { result: signature };
    }
    case "getSignatureStatuses": {
      const sigs = params[0] as string[];
      return {
        result: {
          context,
          value: sigs.map((s) => (state.sent.some((t) => t.signature === s) ? { slot: state.slot, confirmations: 1, err: null, status: { Ok: null }, confirmationStatus: "confirmed" } : null)),
        },
      };
    }
    case "getSignaturesForAddress": {
      const all = state.sigsFor.get(String(params[0])) ?? [];
      const opts = (params[1] ?? {}) as { limit?: number; before?: string; until?: string };
      let list = all;
      if (opts.before) list = list.slice(list.indexOf(opts.before) + 1);
      if (opts.until) {
        const i = list.indexOf(opts.until);
        if (i >= 0) list = list.slice(0, i);
      }
      list = list.slice(0, opts.limit ?? 1000);
      return { result: list.map((signature) => ({ signature, slot: state.txs.get(signature)?.slot ?? state.slot, err: null, memo: null, blockTime: 1_759_000_000, confirmationStatus: "confirmed" })) };
    }
    case "getTransaction": {
      const sig = String(params[0]);
      const sent = state.sent.find((t) => t.signature === sig);
      if (sent) {
        const vtx = VersionedTransaction.deserialize(sent.raw);
        const m = vtx.message;
        const keys = m.staticAccountKeys.map((k) => k.toBase58());
        return {
          result: {
            slot: state.slot,
            blockTime: 1_759_000_000,
            meta: { err: null, fee: 5000, preBalances: keys.map(() => 0), postBalances: keys.map(() => 0), logMessages: [], innerInstructions: [], preTokenBalances: [], postTokenBalances: [] },
            transaction: {
              signatures: vtx.signatures.map((x) => bs58.encode(x)),
              message: {
                accountKeys: keys,
                header: m.header,
                instructions: m.compiledInstructions.map((ix) => ({ programIdIndex: ix.programIdIndex, accounts: ix.accountKeyIndexes, data: bs58.encode(ix.data) })),
                recentBlockhash: m.recentBlockhash,
              },
            },
          },
        };
      }
      const canned = state.txs.get(sig);
      if (!canned) return { result: null };
      return {
        result: {
          slot: canned.slot,
          blockTime: 1_759_000_000,
          meta: { err: null, fee: 5000, preBalances: [0], postBalances: [0], logMessages: canned.logs, innerInstructions: [], preTokenBalances: [], postTokenBalances: [] },
          transaction: {
            signatures: [sig],
            message: { accountKeys: [SYSTEM], header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 0 }, instructions: [], recentBlockhash: state.blockhash },
          },
        },
      };
    }
    default:
      return { error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

export async function startFakeRpc(state: FakeState = newState()): Promise<{ url: string; state: FakeState; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    // The stub wallet in play-ui sends from the page's origin.
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400).end();
        return;
      }
      const one = (call: { id?: unknown; method: string; params?: Params }) => ({ jsonrpc: "2.0", id: call.id ?? null, ...answer(state, call.method, call.params ?? []) });
      const out = Array.isArray(parsed) ? parsed.map(one) : one(parsed as { method: string });
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    state,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

// Standalone mode for scripts/play-ui.mjs: seeds a wallet balance given as FAKE_WALLET (+ FAKE_LAMPORTS).
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "")) {
  const state = newState();
  const wallet = process.env.FAKE_WALLET;
  if (wallet) state.accounts.set(wallet, { lamports: Number(process.env.FAKE_LAMPORTS ?? 2_500_000_000), owner: SYSTEM });
  const { url } = await startFakeRpc(state);
  console.log(JSON.stringify({ url }));
}
