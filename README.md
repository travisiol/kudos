# KUDOS — launch a coin for anyone on X

Next 16 + React 19 + Tailwind 4, `@solana/web3.js`, `node:sqlite`. Port **3970**.

A pump.fun launchpad where you launch a coin **for someone else's X account**. 90% of the coin's creator fees are
credited to that account's vault; they claim by posting one tweet with their address. The other 10% (plus 20% of
$KUDOS's own creator fees) buys $KUDOS through Jupiter and burns it.

## How it works (code)

| Piece | Files |
|-------|-------|
| Constants (90/10, 20%, 0.001 SOL min payout, 10 min sweep, X handle) | `src/config/kudos.ts` |
| Launch: validation, first-buy transfer (launcher → operator, memo `kudos launch <id>`), confirmation + amount read from chain, engine webhook, coin row | `src/server/launch.ts`, `src/app/api/launch/{prepare,submit}` |
| Sweep: attribute TradeEvent `creator_fee` per coin (bonding-curve signatures, ≤200/coin/run, cursor), collect the operator's creator vault, Jupiter buyback + burn | `src/server/sweep.ts`, `src/server/pump/*`, `src/app/api/sweep` |
| Claim by tweet: fxtwitter JSON → syndication fallback, author/tag/one-address checks, tweet used once, vault pinned to the X user id, payout with memo | `src/server/tweet.ts`, `src/server/claim.ts`, `src/app/api/claim` |
| Tables: launches, coins, fee_events, vaults, flywheel, claims, kv, ledger | `src/server/db.ts`, `src/server/store.ts` |
| Pages | `/`, `/launch`, `/explore`, `/coin/[mint]`, `/claim`, `/burn`, `/payouts`, `/docs`, `/ledger`, `/api/health`, `/api/vault/<handle>` |

The site never creates a coin. `LAUNCH_WEBHOOK` contract:

```
POST LAUNCH_WEBHOOK   x-kudos-secret: LAUNCH_SECRET
{ id, name, ticker, description, imageDataUrl, forHandle, launcher, firstBuyLamports }
→ 200 { mint, signature, creator, tokensBought? }      (creator = the operator wallet; tokensBought in base units)
```

The engine launches from the operator wallet and spends `firstBuyLamports` on the first buy; KUDOS forwards
`tokensBought` to the launcher with `sendToken` in `after()`.

## Env vars

| Var | What |
|-----|------|
| `NEXT_PUBLIC_SOLANA_CLUSTER` | `mainnet-beta` (default) or `devnet` |
| `SOLANA_RPC_URL` | Server RPC (keyed provider strongly advised: the sweep reads many transactions) |
| `NEXT_PUBLIC_MINT` | $KUDOS mint. Unset: the flywheel bucket accumulates, nothing is bought |
| `OPERATOR_SECRET_KEY` | Launch wallet: creator of every coin, collects creator fees, pays every payout. Unset: payouts closed |
| `LAUNCH_WEBHOOK` / `LAUNCH_SECRET` | The launch engine and its shared secret. Unset webhook: "Launching is not open yet." |
| `SWEEP_SECRET` | Authorises `POST/GET /api/sweep` (`x-sweep-secret` or `Authorization: Bearer`). On Vercel set `CRON_SECRET` to the same value |
| `SESSION_SECRET` | 32+ chars for the wallet session cookie |
| `KUDOS_DB_PATH` | SQLite file (default `./data/kudos.db`, OS temp dir on a read-only disk) |
| `NEXT_PUBLIC_SITE_URL` | Public URL (metadata, share links) |
| `NEXT_PUBLIC_X_HANDLE` | The handle claim posts must tag (default `kudoslaunch`) |
| `KUDOS_BLOCKED_HANDLES` | Comma-separated opted-out handles |
| `JUPITER_API_URL` | Default `https://quote-api.jup.ag/v6` |
| `KUDOS_TWEET_API` | Tests only: local fake tweet reader |

## Commands

```
npm run dev        # next dev -p 3970
npm test           # node tests on the fake RPC (incl. a real mainnet pump.fun trade's logs in tests/fixtures)
npx eslint .
npx next typegen && npx tsc --noEmit
npx next build
npm run play       # needs a build: full flow in headless Chrome (stub wallet, fake RPC, engine + tweet stubs)
node scripts/capture.mjs http://localhost:3970
```

## Serverless notes

Nothing loops. The sweep runs from `/api/sweep` (cron in `vercel.json`, every 10 min — needs a Vercel plan that
allows it) and from `after()` on a visit to `/` or `/burn` when the last run is older than 10 minutes. SQLite on Vercel
lives in `/tmp`: vaults, claims and the ledger are per instance and lost on recycle — set `KUDOS_DB_PATH` to a
persistent disk or move the store before real money flows.
