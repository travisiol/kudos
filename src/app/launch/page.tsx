import type { Metadata } from "next";
import { xHandle } from "@/config/kudos";
import { SITE } from "@/config/site";
import { LaunchForm } from "./LaunchForm";

export const metadata: Metadata = { title: "Launch a coin" };

export default function LaunchPage() {
  return (
    <section className="page">
      <div className="ph">
        <h1>Launch a coin</h1>
        <p>
          Pick any X account. 90% of the coin&apos;s creator fees are credited to them and 10% buys back and burns {SITE.ticker}. You keep none of the fees: only the
          tokens from your first buy.
        </p>
      </div>
      <LaunchForm siteName={SITE.name} xHandle={xHandle()} siteUrl={SITE.url} />
    </section>
  );
}
