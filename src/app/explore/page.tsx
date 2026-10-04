import type { Metadata } from "next";
import { SITE } from "@/config/site";
import { pumpCoin } from "@/server/chain";
import { db } from "@/server/db";
import { getVault, listCoins, vaultBalance } from "@/server/store";
import { CoinGrid } from "./CoinGrid";
import type { CoinCard } from "./CoinGrid";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Coins" };

export default async function ExplorePage() {
  const coins = listCoins(db());
  const cards: CoinCard[] = await Promise.all(
    coins.slice(0, 60).map(async (c) => {
      const live = await pumpCoin(c.mint).catch(() => null);
      return {
        mint: c.mint,
        name: c.name,
        ticker: c.ticker,
        image: c.image,
        handle: c.forHandle,
        launchedAt: c.launchedAt,
        marketCapUsd: live?.marketCapUsd ?? 0,
        vaultLamports: vaultBalance(getVault(db(), c.forHandle)).toString(),
      };
    }),
  );
  return (
    <section className="page">
      <div className="ph">
        <h1>Coins</h1>
        <p>Every coin launched on {SITE.name}, with live market data from pump.fun.</p>
      </div>
      <CoinGrid cards={cards} />
    </section>
  );
}
