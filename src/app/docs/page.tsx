import type { Metadata } from "next";
import Link from "next/link";
import { FLYWHEEL_SHARE, OWN_FEES_BUYBACK_SHARE, RECIPIENT_SHARE, xHandle } from "@/config/kudos";
import { SITE } from "@/config/site";

export const metadata: Metadata = { title: "Docs" };

const NAV = [
  ["how", "How it works"],
  ["post", "The launch post"],
  ["claim", "Claiming"],
  ["vaults", "Vaults"],
  ["fees", "Fees"],
  ["flywheel", "The flywheel"],
  ["launch", "How a launch runs"],
  ["launchers", "For launchers"],
  ["removed", "Opting out"],
  ["check", "Check it yourself"],
  ["setup", "Running it"],
  ["limits", "No guarantees"],
] as const;

const ENV: [string, string][] = [
  ["NEXT_PUBLIC_SOLANA_CLUSTER", "mainnet-beta (default) or devnet."],
  ["SOLANA_RPC_URL", "Server RPC endpoint (use a keyed provider). Never sent to the browser."],
  ["NEXT_PUBLIC_MINT", `${SITE.ticker}'s mint. Unset: the flywheel bucket accumulates and nothing is bought.`],
  ["OPERATOR_SECRET_KEY", "The launch wallet: creator of every coin, collector of the creator fees, payer of every payout."],
  ["LAUNCH_WEBHOOK", "The engine that creates the coin on pump.fun (contract below). Unset: launching is closed."],
  ["LAUNCH_SECRET", "Sent to the engine in the x-kudos-secret header."],
  ["SWEEP_SECRET", "Authorises POST /api/sweep (header x-sweep-secret or Bearer). Set CRON_SECRET to the same value on Vercel."],
  ["SESSION_SECRET", "32+ characters that sign the wallet session cookie."],
  ["KUDOS_DB_PATH", "SQLite file. Default ./data/kudos.db; the OS temp dir on a read-only disk."],
  ["NEXT_PUBLIC_SITE_URL", "Public URL, used in metadata and share links."],
  ["NEXT_PUBLIC_X_HANDLE", `The X account claim posts must tag. Default ${xHandle()}.`],
  ["KUDOS_BLOCKED_HANDLES", "Comma-separated handles that opted out: new launches for them are refused."],
  ["KUDOS_TWEET_API", "Tests only: points the post reader at a local fake."],
];

export default function DocsPage() {
  const h = xHandle();
  return (
    <section className="page">
      <div className="docs">
        <nav className="dside">
          {NAV.map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
        </nav>
        <article className="doc glass">
          <h1>Docs</h1>
          <p>
            {SITE.name} launches pump.fun coins for X accounts. {RECIPIENT_SHARE}% of every creator fee a coin earns is credited to the account it was launched for, and they
            claim it by posting a tweet. The other {FLYWHEEL_SHARE}% buys back and burns {SITE.ticker}.
          </p>

          <h2 id="how">How it works</h2>
          <ol>
            <li>
              <b>Pick someone on X.</b> Any account: a friend, a creator, someone who deserves a hand.
            </li>
            <li>
              <b>Launch a coin for them.</b> You fill in the coin and, if you want, a first buy. The {SITE.name} launch wallet creates the coin on pump.fun and is its creator, so
              every creator fee the coin pays lands with us, and we credit {RECIPIENT_SHARE}% of it to that account&apos;s vault.
            </li>
            <li>
              <b>They post their wallet on X. We check it.</b> As the coin trades, their vault grows. When they want it, they post their Solana address tagging @{h}, paste the
              link on the <Link href="/claim">Claim</Link> page, and the whole vault is sent to that address.
            </li>
          </ol>

          <h2 id="post">The launch post</h2>
          <p>
            {SITE.name} does not post on X for you. After a launch, the form and the coin page give you a ready-made post that tags the account the coin is for, so you can tell
            them it exists.
          </p>

          <h2 id="claim">Claiming</h2>
          <div className="spec">
            <div>
              <span>Post a tweet</span>
              <b>
                From the account the coin was launched for, post <code>Claiming my @{h} fees to my wallet: &lt;address&gt;</code> and paste its link on the Claim page. The post must
                tag @{h} and hold exactly one Solana address.
              </b>
            </div>
            <div>
              <span>How it is read</span>
              <b>We read the public post through public tweet endpoints (no X login, no X keys): its author, the author&apos;s X user id and its text.</b>
            </div>
            <div>
              <span>Who sends it</span>
              <b>The {SITE.name} launch wallet, right away, in one Solana transfer with a memo naming the account and the post. Each post can be used once.</b>
            </div>
            <div>
              <span>Smallest payout</span>
              <b>0.001 SOL. The network fee is paid by us.</b>
            </div>
            <div>
              <span>No deadline</span>
              <b>The balance stays credited until they claim it. Claiming is by tweet only; there is no X login.</b>
            </div>
          </div>

          <h2 id="vaults">Vaults</h2>
          <p>
            Each X handle gets one vault: a balance in our ledger, credited from the coins launched for it and paid out from the launch wallet. The first successful claim pins
            the vault to the X user id that posted it; after that, a post from another account using the same handle is refused. Anyone can look a vault up on the{" "}
            <Link href="/claim">Claim</Link> page.
          </p>

          <h2 id="fees">Fees</h2>
          <div className="spec">
            <div>
              <span>Creator fees</span>
              <b>{RECIPIENT_SHARE}% credited to the recipient&apos;s vault.</b>
            </div>
            <div>
              <span>Platform share</span>
              <b>
                {FLYWHEEL_SHARE}%, set aside to buy {SITE.ticker} and burn it. {SITE.name} keeps none of it as SOL.
              </b>
            </div>
            <div>
              <span>Launch fee</span>
              <b>None. Your only cost is your optional first buy and your wallet&apos;s network fee.</b>
            </div>
            <div>
              <span>Trading fees</span>
              <b>Set by pump.fun, the same as any other pump.fun coin.</b>
            </div>
            <div>
              <span>Where fees are read</span>
              <b>From each trade on the coin&apos;s pump.fun bonding curve. Fees a coin earns after it moves to PumpSwap are not counted.</b>
            </div>
          </div>

          <h2 id="flywheel">The flywheel</h2>
          <ul>
            <li>
              <b>{FLYWHEEL_SHARE}% of every coin launched on {SITE.name}.</b> Set aside on every attributed trade.
            </li>
            <li>
              <b>
                {OWN_FEES_BUYBACK_SHARE}% of {SITE.ticker}&apos;s own creator fees.
              </b>{" "}
              Added to the same bucket.
            </li>
          </ul>
          <p>
            Every 10 minutes the sweep collects the launch wallet&apos;s pump.fun creator fees, and once the bucket holds 0.01 SOL it buys {SITE.ticker} through Jupiter and burns
            exactly the tokens received. The <Link href="/burn">tracker</Link> reads its numbers from those transactions. Until {SITE.ticker} trades, the bucket only grows.
          </p>

          <h2 id="launch">How a launch runs</h2>
          <ol>
            <li>You sign in with your wallet (a signed message, no transaction).</li>
            <li>If you added a first buy, your wallet sends that SOL to the launch wallet with a memo naming your launch. We wait for it to confirm and read the amount from the chain.</li>
            <li>Our engine creates the coin on pump.fun from the launch wallet, which signs the launch and spends your first buy on it.</li>
            <li>The tokens bought are sent from the launch wallet to you, and the coin appears on the Coins page.</li>
          </ol>
          <p>
            Unlike a launch you sign yourself, the coin is created by the {SITE.name} launch wallet, not by your wallet: that is how its creator fees reach the recipient&apos;s
            vault. Your first buy is a separate transfer before the launch, not part of the launch transaction.
          </p>
          <pre>{`POST LAUNCH_WEBHOOK   x-kudos-secret: LAUNCH_SECRET
{ id, name, ticker, description, imageDataUrl, forHandle, launcher, firstBuyLamports }
→ 200 { mint, signature, creator, tokensBought? }`}</pre>

          <h2 id="launchers">For launchers</h2>
          <p>
            Connect Phantom, Solflare or Backpack. We never hold your keys. You get the tokens from your first buy and nothing else: no share of the fees.
          </p>

          <h2 id="removed">Opting out</h2>
          <p>
            If you don&apos;t want coins launched for your account, message @{h} on X and we add your handle to the opt-out list: new launches for it are refused. Your vault stays yours to claim.
          </p>

          <h2 id="check">Check it yourself</h2>
          <ul>
            <li>Every payout is a transfer from the launch wallet with a memo naming the X account and the post. See <Link href="/payouts">Payouts</Link> and the <Link href="/ledger">ledger</Link>.</li>
            <li>Vault balances are our server&apos;s attribution of pump.fun&apos;s on-chain creator_fee events. Each coin page lists them per transaction.</li>
            <li>Every fee collection, buyback and burn is on the <Link href="/burn">burn tracker</Link> with its transaction.</li>
          </ul>

          <h2 id="setup">Running it</h2>
          <div className="spec">
            {ENV.map(([k, v]) => (
              <div key={k}>
                <span className="mono">{k}</span>
                <b>{v}</b>
              </div>
            ))}
          </div>

          <h2 id="limits">No guarantees</h2>
          <p>
            A coin can earn very little: fees depend on trading volume, and many coins earn almost nothing. Coins launched here are not investments and you can lose what you put
            in. {SITE.name} is not affiliated with X or pump.fun.
          </p>
        </article>
      </div>
    </section>
  );
}
