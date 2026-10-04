import type { Metadata } from "next";
import { claimTweetText, xHandle } from "@/config/kudos";
import { ClaimForms } from "./ClaimForms";

export const metadata: Metadata = { title: "Claim your fees" };

export default function ClaimPage() {
  const handle = xHandle();
  const intent = `https://x.com/intent/post?text=${encodeURIComponent(claimTweetText(""))}%20`;
  return (
    <section className="page">
      <div className="ph">
        <h1>Claim your fees</h1>
        <p>Someone launched a coin for your X account. Every creator fee it earns is credited to a vault in your name. Post one tweet to take it.</p>
      </div>
      <ClaimForms handle={handle} intent={intent} example={claimTweetText("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU")} />
    </section>
  );
}
