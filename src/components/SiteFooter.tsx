import Link from "next/link";
import { SITE } from "@/config/site";
import { MINT } from "@/config/solana";
import { Mark } from "./Logo";

export function SiteFooter() {
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-in">
          <Link className="brand" href="/">
            <Mark />
            <span>{SITE.name}</span>
          </Link>
          <div className="foot-links">
            <Link href="/launch">Launch</Link>
            <Link href="/explore">Coins</Link>
            <Link href="/claim">Claim</Link>
            <Link href="/burn">Burn</Link>
            <Link href="/payouts">Payouts</Link>
            <Link href="/ledger">Ledger</Link>
            <Link href="/docs">Docs</Link>
            <a href={`https://x.com/${SITE.xHandle}`} target="_blank" rel="noreferrer">X</a>
          </div>
        </div>
        <small>
          {MINT ? (
            <>
              {SITE.ticker} CA <span className="mono">{MINT}</span> ·{" "}
            </>
          ) : null}
          Not affiliated with X or pump.fun. © 2026 {SITE.name}
        </small>
      </div>
    </footer>
  );
}
