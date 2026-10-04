"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { SITE } from "@/config/site";
import { Mark } from "./Logo";

const TABS = [
  ["/launch", "Launch"],
  ["/explore", "Coins"],
  ["/claim", "Claim"],
  ["/burn", "Burn"],
  ["/payouts", "Payouts"],
  ["/docs", "Docs"],
] as const;

const DRAWER = [
  ["/", "Home"],
  ["/launch", "Launch a coin"],
  ["/explore", "Coins"],
  ["/claim", "Claim your fees"],
  ["/burn", `${SITE.ticker} burn`],
  ["/payouts", "Payouts"],
  ["/docs", "Docs"],
] as const;

export function SiteHeader() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <>
      <header className="nav">
        <div className="nav-in">
          <Link className="brand" href="/" onClick={() => setOpen(false)}>
            <Mark />
            <span>{SITE.name}</span>
          </Link>
          <nav className="tabs">
            {TABS.map(([href, label]) => (
              <Link key={href} href={href} className={path === href || (href === "/explore" && path.startsWith("/coin/")) ? "on" : ""}>
                {label}
              </Link>
            ))}
          </nav>
          <span className="sp" />
          <ConnectButton className="btn btn-white" />
          <button type="button" className="burger" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <svg viewBox="0 0 24 24">
              {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </header>
      {open && (
        <div className="drawer">
          {DRAWER.map(([href, label]) => (
            <Link key={href} href={href} onClick={() => setOpen(false)}>
              {label}
            </Link>
          ))}
          <a href={`https://x.com/${SITE.xHandle}`} target="_blank" rel="noreferrer">
            {SITE.name} on X
          </a>
        </div>
      )}
    </>
  );
}
