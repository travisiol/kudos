import type { Metadata } from "next";
import Link from "next/link";
import { xHandle } from "@/config/kudos";
import { SITE } from "@/config/site";
import { explorerUrl } from "@/config/solana";
import { formatSol, formatUsd, isBase58Address, shortAddress } from "@/lib/format";
import { pumpCoin } from "@/server/chain";
import { db } from "@/server/db";
import { feeEventsFor, feeTotalFor, getCoin, getVault, vaultBalance } from "@/server/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Coin" };

export default async function CoinPage({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  const coin = isBase58Address(mint) ? getCoin(db(), mint) : null;
  if (!coin) {
    return (
      <section className="page">
        <div className="empty" data-testid="coin-missing">
          <h4>This coin is not on {SITE.name}</h4>
          A coin launched a few seconds ago can take a moment to appear.
          <div>
            <Link className="btn" href="/explore">
              All coins
            </Link>
          </div>
        </div>
      </section>
    );
  }
  const live = await pumpCoin(coin.mint).catch(() => null);
  const vault = vaultBalance(getVault(db(), coin.forHandle));
  const fees = feeTotalFor(db(), coin.mint);
  const events = feeEventsFor(db(), coin.mint, 30);
  const share = `https://x.com/intent/post?text=${encodeURIComponent(`@${coin.forHandle} a coin was launched for you on @${xHandle()}: $${coin.ticker}. 90% of its creator fees are yours, claim them with one tweet: ${SITE.url}/claim`)}`;
  return (
    <section className="page">
      <div className="coinhead glass" data-testid="coin-head">
        {/* eslint-disable-next-line @next/next/no-img-element -- uploaded coin image */}
        <div className="img">{coin.image && <img src={coin.image} alt="" />}</div>
        <div>
          <span className="k">{coin.ticker}</span>
          <h1>{coin.name}</h1>
          <div className="for">for @{coin.forHandle}</div>
          <div className="links">
            <a className="btn btn-white" href={`https://pump.fun/coin/${coin.mint}`} target="_blank" rel="noreferrer">pump.fun</a>
            <a className="btn" href={explorerUrl("token", coin.mint)} target="_blank" rel="noreferrer">Solscan</a>
            <a className="btn" href={share} target="_blank" rel="noreferrer">Share on X</a>
          </div>
        </div>
      </div>
      <div className="strip" style={{ marginTop: 16 }}>
        <div className="stat glass">
          <span className="k">In @{coin.forHandle}&apos;s vault</span>
          <b>{formatSol(vault)} SOL</b>
          <i>all their coins, not claimed yet</i>
        </div>
        <div className="stat glass">
          <span className="k">Fees from this coin</span>
          <b>{formatSol(fees.recipient)} SOL</b>
          <i>their 90%, over {fees.count} trades</i>
        </div>
        <div className="stat glass">
          <span className="k">Market cap</span>
          <b>{live?.marketCapUsd ? formatUsd(live.marketCapUsd) : "—"}</b>
          <i>{live ? `from ${live.source}` : "no market data yet"}</i>
        </div>
        <div className="stat glass">
          <span className="k">Launched by</span>
          <b className="mono">{coin.launcher ? shortAddress(coin.launcher) : "—"}</b>
          <i>{new Date(coin.launchedAt).toISOString().slice(0, 10)}</i>
        </div>
      </div>
      {live?.complete && <iframe className="embed" title="Chart" src={`https://dexscreener.com/solana/${coin.mint}?embed=1&theme=dark`} />}
      <div className="box glass" style={{ marginTop: 16 }}>
        <h3>Creator fees, per trade</h3>
        {events.length === 0 ? (
          <p className="muted">No fees attributed yet. Trades are read every 10 minutes.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table" data-testid="fee-events">
              <thead>
                <tr>
                  <th>Transaction</th>
                  <th>Creator fee</th>
                  <th>To the vault</th>
                  <th>To the flywheel</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.sig}>
                    <td className="mono">
                      <a href={explorerUrl("tx", e.sig)} target="_blank" rel="noreferrer">{shortAddress(e.sig)}</a>
                    </td>
                    <td className="mono">{formatSol(BigInt(e.lamports))}</td>
                    <td className="mono">{formatSol(BigInt(e.recipient))}</td>
                    <td className="mono">{formatSol(BigInt(e.flywheel))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
