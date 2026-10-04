import type { Metadata } from "next";
import { explorerUrl } from "@/config/solana";
import { formatSol, shortAddress } from "@/lib/format";
import { payoutStats } from "@/server/stats";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Payouts" };

export default function PayoutsPage() {
  const s = payoutStats();
  return (
    <section className="page">
      <div className="ph">
        <h1>Payouts</h1>
        <p>Every time someone claimed their fees. Each one is a Solana transaction you can open.</p>
      </div>
      <div className="strip">
        <div className="stat glass">
          <span className="k">Sent to people</span>
          <b data-testid="sent">{formatSol(s.sentLamports)} SOL</b>
          <i>all payouts</i>
        </div>
        <div className="stat glass">
          <span className="k">Waiting</span>
          <b>{formatSol(s.waitingLamports)} SOL</b>
          <i>earned, not claimed yet</i>
        </div>
        <div className="stat glass">
          <span className="k">Payouts</span>
          <b>{s.payouts}</b>
          <i>on-chain transfers</i>
        </div>
        <div className="stat glass">
          <span className="k">People paid</span>
          <b>{s.people}</b>
          <i>accounts paid</i>
        </div>
      </div>
      {s.claims.length === 0 ? (
        <div className="empty" style={{ marginTop: 16 }}>
          <h4>No payouts yet</h4>
          When someone claims their fees it appears here, with its transaction.
        </div>
      ) : (
        <div className="plist" data-testid="payout-list">
          {s.claims.map((c) => (
            <div key={c.tweetId} className="pay glass">
              <span className="pv">{c.handle.slice(0, 1).toUpperCase()}</span>
              <div>
                <b>@{c.handle}</b>
                <small>
                  to <span className="mono">{shortAddress(c.address)}</span> · {new Date(c.at).toISOString().replace("T", " ").slice(0, 16)} UTC
                  {c.sig && (
                    <>
                      {" · "}
                      <a href={explorerUrl("tx", c.sig)} target="_blank" rel="noreferrer">
                        {shortAddress(c.sig)}
                      </a>
                    </>
                  )}
                </small>
              </div>
              <span className="amt">{formatSol(BigInt(c.lamports))} SOL</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
