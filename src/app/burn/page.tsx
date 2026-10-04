import type { Metadata } from "next";
import { FLYWHEEL_SHARE, OWN_FEES_BUYBACK_SHARE, SWEEP_FRESH_MS } from "@/config/kudos";
import { SITE } from "@/config/site";
import { explorerUrl, serverMint } from "@/config/solana";
import { formatSol, formatUnits, shortAddress } from "@/lib/format";
import { flywheelStats } from "@/server/stats";
import { lastSweepAt } from "@/server/sweep";
import { sweepIfDue } from "@/server/sweep-trigger";
import { nowMs } from "@/server/clock";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `${SITE.ticker} burn` };

const KIND: Record<string, string> = { claim: "Fees claimed", buyback: "Buyback", burn: "Burned" };

export default async function BurnPage() {
  sweepIfDue();
  const s = await flywheelStats();
  const last = lastSweepAt();
  const running = last !== null && nowMs() - last < SWEEP_FRESH_MS;
  const mint = serverMint();
  const pct = s.supplyUnits > BigInt(0) ? Number((s.burnedUnits * BigInt(1_000_000)) / s.supplyUnits) / 10_000 : 0;
  const left = s.supplyUnits > s.burnedUnits ? s.supplyUnits - s.burnedUnits : BigInt(0);
  const burns = [...s.burns].reverse().slice(-40);
  const max = burns.reduce((m, b) => (BigInt(b.amount) > m ? BigInt(b.amount) : m), BigInt(1));
  return (
    <section className="page">
      <div className="ph">
        <h1>The {SITE.name} Flywheel</h1>
        <p>
          {FLYWHEEL_SHARE}% of every coin launched on {SITE.name}, plus <b>{OWN_FEES_BUYBACK_SHARE}%</b> of {SITE.ticker}&apos;s own creator fees, buys {SITE.ticker}, and every
          token bought is burned right after. The sweep runs every 10 minutes.
        </p>
        <div className="bstatus" data-testid="burn-status">
          <i className={running ? "" : "wait"} />
          {running ? "Running every 10 minutes" : "Waiting for the next sweep"}
        </div>
      </div>
      <div className="bhero">
        <div className="bbig">
          <span className="k">Total burned</span>
          <div className="num" data-testid="burned">
            {formatUnits(s.burnedUnits, s.decimals, 0)}
            <small>{SITE.ticker}</small>
          </div>
          <div className="bar">
            <span style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <div className="row">
            <span>{pct.toFixed(3)}% of supply burned</span>
            <span>{formatUnits(left, s.decimals, 0)} left</span>
          </div>
        </div>
        <div className="bkpis">
          <div className="stat glass">
            <span className="k">Fees claimed</span>
            <b>{formatSol(s.feesClaimedLamports)} SOL</b>
            <i>{s.claims} claims</i>
          </div>
          <div className="stat glass">
            <span className="k">Spent on buybacks</span>
            <b>{formatSol(s.spentLamports)} SOL</b>
            <i>
              {FLYWHEEL_SHARE}% of coins + {OWN_FEES_BUYBACK_SHARE}% of {SITE.ticker}
            </i>
          </div>
          <div className="stat glass">
            <span className="k">Next buyback</span>
            <b data-testid="next-buyback">{formatSol(s.nextBuybackLamports)} SOL</b>
            <i>{mint ? "set aside, spent from 0.01 SOL" : `set aside until ${SITE.ticker} trades`}</i>
          </div>
          <div className="stat glass">
            <span className="k">Fees waiting</span>
            <b>{formatSol(s.feesWaitingLamports)} SOL</b>
            <i>collected on the next run</i>
          </div>
        </div>
      </div>
      <div className="chartbox glass">
        <h3>{SITE.ticker} burned over time</h3>
        <div className="chart">
          {burns.length === 0 ? (
            <div className="empty">The chart starts with the first burn.</div>
          ) : (
            burns.map((b) => <span key={b.id} className="col" title={b.amount} style={{ height: `${Math.max(4, Number((BigInt(b.amount) * BigInt(100)) / max))}%` }} />)
          )}
        </div>
      </div>
      <div className="bgrid">
        <div className="box glass">
          <h3>Activity</h3>
          {s.activity.length === 0 ? (
            <p className="muted">No claims or burns yet. The first one appears here with its transaction.</p>
          ) : (
            <div className="act" data-testid="burn-activity">
              {s.activity.map((r) => (
                <div key={r.id}>
                  <span>
                    {KIND[r.kind] ?? r.kind} · {r.kind === "burn" ? `${formatUnits(BigInt(r.amount), s.decimals, 0)} ${SITE.ticker}` : `${formatSol(BigInt(r.amount))} SOL`}
                  </span>
                  <a href={explorerUrl("tx", r.sig)} target="_blank" rel="noreferrer">
                    {shortAddress(r.sig)}
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="box glass">
          <h3>How the flywheel turns</h3>
          <div className="ol">
            <div>
              <span>
                Every trade of a {SITE.name} coin pays a creator fee; {FLYWHEEL_SHARE}% of it is set aside for the flywheel.
              </span>
            </div>
            <div>
              <span>Every 10 minutes the launch wallet collects the creator fees waiting on pump.fun.</span>
            </div>
            <div>
              <span>
                {SITE.ticker}&apos;s own trades add {OWN_FEES_BUYBACK_SHARE}% of their creator fee to the same bucket.
              </span>
            </div>
            <div>
              <span>From 0.01 SOL, the bucket buys {SITE.ticker} through Jupiter and the tokens received are burned in the next transaction.</span>
            </div>
            <div>
              <span>Every claim, buyback and burn is listed here and on the ledger with its transaction.</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
