import Link from "next/link";
import { CopyCa } from "@/components/CopyCa";
import { Mark } from "@/components/Logo";
import { FLYWHEEL_SHARE, OWN_FEES_BUYBACK_SHARE, RECIPIENT_SHARE, xHandle } from "@/config/kudos";
import { SITE } from "@/config/site";
import { MINT } from "@/config/solana";
import { formatSol, formatUnits } from "@/lib/format";
import { flywheelStats, homeCounts } from "@/server/stats";
import { sweepIfDue } from "@/server/sweep-trigger";

export const dynamic = "force-dynamic";

const Arrow = () => (
  <span className="ar">
    <svg viewBox="0 0 24 24">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  </span>
);

export default async function Home() {
  sweepIfDue();
  const counts = homeCounts();
  const fly = await flywheelStats();
  const handle = xHandle();
  return (
    <>
      <div className="hero">
        <div>
          <h1 className="h1">
            Launch a coin
            <br />
            for anyone
            <br />
            on&nbsp;X.
          </h1>
          <p className="lede">
            {RECIPIENT_SHARE}% of its creator fees go to that account. They claim by posting one tweet. The other {FLYWHEEL_SHARE}% buys back and burns {SITE.ticker}.
          </p>
          <div className="cta">
            <Link className="btn btn-go" href="/launch">
              Launch a coin
              <Arrow />
            </Link>
            <Link className="btn btn-lg" href="/claim">
              Claim your fees
            </Link>
          </div>
          {MINT && <CopyCa label={`${SITE.ticker} CA`} value={MINT} />}
          <div className="chips" data-testid="chips">
            <span className="chip">
              <b>{formatSol(counts.sentLamports)} SOL</b> sent to people
            </span>
            <span className="chip">
              <b>{counts.coins}</b> coins
            </span>
            <span className="chip">
              <b>{FLYWHEEL_SHARE}%</b> burns {SITE.ticker}
            </span>
          </div>
        </div>
        <div className="feedwrap" aria-label="How a claim looks">
          <div className="tw glass">
            <span className="av p">
              <Mark />
            </span>
            <div>
              <b>
                {SITE.name}
                <small>@{handle} · now</small>
              </b>
              <p>
                A coin was launched for <span className="at">@yourfriend</span> on {SITE.name}. Its fees are waiting.
              </p>
            </div>
          </div>
          <div className="tw glass">
            <span className="av">Y</span>
            <div>
              <b>
                Your Friend
                <small>@yourfriend · 2m</small>
              </b>
              <p>
                Claiming my <span className="at">@{handle}</span> fees to my wallet: <span className="addr">7xKX…9fQa</span>
              </p>
            </div>
          </div>
          <div className="ok glass">
            <span className="sh">
              <svg viewBox="0 0 24 24">
                <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />
                <path d="m8.5 12 2.5 2.5 4.5-5" />
              </svg>
            </span>
            <div>
              <b>
                <em>Verified.</em> Fees sent.
              </b>
              <small>Straight to their wallet, on-chain.</small>
            </div>
          </div>
        </div>
      </div>

      <section className="sec" id="how-home">
        <h2 className="sh2">How it works</h2>
        <p className="sub">Fees are claimed with one tweet.</p>
        <div className="steps">
          <div className="step glass">
            <span className="n">1</span>
            <div>
              <b>Pick someone on X</b>
              <span>Any account. A friend, a creator, someone who deserves a hand.</span>
            </div>
            <svg viewBox="0 0 64 64">
              <circle cx="28" cy="28" r="14" />
              <path d="m39 39 13 13" />
            </svg>
          </div>
          <div className="step glass">
            <span className="n">2</span>
            <div>
              <b>Launch a coin for them</b>
              <span>{RECIPIENT_SHARE}% of its creator fees are credited to their vault on every trade.</span>
            </div>
            <svg viewBox="0 0 64 64">
              <path d="M32 6c9 7 13 17 11 30H21C19 23 23 13 32 6z" />
              <path d="M21 36l-7 10h11M43 36l7 10H39M27 50h10" />
              <circle cx="32" cy="24" r="4" />
            </svg>
          </div>
          <div className="step glass">
            <span className="n">3</span>
            <div>
              <b>They post their wallet. We check it.</b>
              <span>The SOL goes straight to them. No sign-up, nothing to install.</span>
            </div>
            <svg viewBox="0 0 64 64">
              <path d="M32 6 12 14v14c0 13 9 22 20 26 11-4 20-13 20-26V14z" />
              <path d="m22 31 7 7 13-14" />
            </svg>
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="fly">
          <div>
            <h2 className="sh2">The {SITE.name} Flywheel</h2>
            <p className="sub">
              We buy back and burn {SITE.ticker} with {FLYWHEEL_SHARE}% of every coin launched here, plus fees from {SITE.ticker} itself.
            </p>
            <div className="bstats">
              <div className="bstat glass">
                <span>Fees claimed</span>
                <b>{formatSol(fly.feesClaimedLamports)} SOL</b>
              </div>
              <div className="bstat glass">
                <span>Spent on buybacks</span>
                <b>{formatSol(fly.spentLamports)} SOL</b>
              </div>
              <div className="bstat glass">
                <span>{SITE.ticker} burned</span>
                <b>{formatUnits(fly.burnedUnits, fly.decimals, 0)}</b>
              </div>
              <div className="bstat glass">
                <span>Next buyback</span>
                <b>{formatSol(fly.nextBuybackLamports)} SOL</b>
              </div>
            </div>
            <p className="bnote">
              {FLYWHEEL_SHARE}% of every {SITE.name} coin&apos;s creator fees, plus <b>{OWN_FEES_BUYBACK_SHARE}%</b> of {SITE.ticker}&apos;s own, buys {SITE.ticker} and burns
              what it bought, checked every 10 minutes. <Link href="/burn">Open the tracker</Link>
            </p>
          </div>
          <div className="wheel" aria-hidden="true">
            <div className="wheelring">
              <svg viewBox="0 0 200 200">
                <defs>
                  <path id="ringpath" d="M100 100m-84 0a84 84 0 1 1 168 0a84 84 0 1 1-168 0" />
                </defs>
                <circle cx="100" cy="100" r="96" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="1.5" strokeDasharray="2 6" />
                <text fill="#fff" fontSize="13" fontWeight="700" letterSpacing="3">
                  <textPath href="#ringpath">FEES · BUYBACK · BURN · FEES · BUYBACK · BURN · FEES · BUYBACK · BURN ·</textPath>
                </text>
              </svg>
            </div>
            <div className="core">
              <Mark />
            </div>
          </div>
        </div>
      </section>

      <section className="endcard glass">
        <h2 className="sh2">Tip anyone on X.</h2>
        <p className="sub">Pick an account, launch a coin, and let the fees find them.</p>
        <div className="cta">
          <Link className="btn btn-go" href="/launch">
            Launch a coin
            <Arrow />
          </Link>
        </div>
      </section>
    </>
  );
}
