"use client";

import Link from "next/link";
import { useState } from "react";
import { formatSol, formatUsd } from "@/lib/format";

export interface CoinCard {
  mint: string;
  name: string;
  ticker: string;
  image: string | null;
  handle: string;
  launchedAt: number;
  marketCapUsd: number;
  vaultLamports: string;
}

const SORTS = [
  ["new", "Newest"],
  ["mcap", "Market cap"],
  ["vault", "Most in vault"],
] as const;

export function CoinGrid({ cards }: { cards: CoinCard[] }) {
  const [sort, setSort] = useState<(typeof SORTS)[number][0]>("new");
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase().replace(/^[@$]/, "");
  const list = cards
    .filter((c) => !needle || c.name.toLowerCase().includes(needle) || c.ticker.toLowerCase().includes(needle) || c.handle.includes(needle) || c.mint === q.trim())
    .sort((a, b) =>
      sort === "mcap" ? b.marketCapUsd - a.marketCapUsd : sort === "vault" ? Number(BigInt(b.vaultLamports) - BigInt(a.vaultLamports)) : b.launchedAt - a.launchedAt,
    );
  return (
    <>
      <div className="toolbar">
        <label className="search">
          <svg viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input placeholder="Search name, ticker or @handle" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="seg">
          {SORTS.map(([key, label]) => (
            <button key={key} type="button" className={sort === key ? "on" : ""} onClick={() => setSort(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {cards.length === 0 ? (
        <div className="empty">
          <h4>No coins yet</h4>
          Be the first to launch a coin for someone on X.
          <div>
            <Link className="btn btn-white" href="/launch">
              Launch a coin
            </Link>
          </div>
        </div>
      ) : list.length === 0 ? (
        <div className="empty">
          <h4>Nothing matches</h4>
          Try another name, ticker or handle.
        </div>
      ) : (
        <div className="grid" data-testid="coin-grid">
          {list.map((c) => (
            <Link key={c.mint} href={`/coin/${c.mint}`} className="card glass">
              {/* eslint-disable-next-line @next/next/no-img-element -- uploaded coin image */}
              <div className="img">{c.image && <img src={c.image} alt="" />}</div>
              <div className="meta">
                <div className="nm">
                  <b>{c.name}</b>
                  <span>{c.ticker}</span>
                </div>
                <div className="for">for @{c.handle}</div>
                <div className="vlt">
                  <span>In their vault</span>
                  <b>{formatSol(BigInt(c.vaultLamports))} SOL</b>
                </div>
                <div className="line">
                  <span>Market cap</span>
                  <span>{c.marketCapUsd ? formatUsd(c.marketCapUsd) : "—"}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
