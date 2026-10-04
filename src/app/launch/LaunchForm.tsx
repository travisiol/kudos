"use client";

import Link from "next/link";
import { useState } from "react";
import { openWalletDialog, signAndSendTransaction, signIn, useWallet, walletErrorMessage } from "@/components/wallet/store";

type Done = { mint: string; signature: string; handle: string; name: string; ticker: string };

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? "Request failed.");
  return j;
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("That image could not be read."));
    reader.readAsDataURL(file);
  });
}

export function LaunchForm({ siteName, xHandle, siteUrl }: { siteName: string; xHandle: string; siteUrl: string }) {
  const wallet = useWallet();
  const [handle, setHandle] = useState("");
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [firstBuy, setFirstBuy] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState<Done | null>(null);

  const cleanHandle = handle.trim().replace(/^@/, "");
  const signedIn = wallet.address !== null && wallet.session === wallet.address;

  const launch = async () => {
    setMsg("");
    if (!wallet.address) return openWalletDialog();
    try {
      if (!signedIn) {
        setBusy("Sign the message in your wallet…");
        await signIn();
      }
      setBusy("Checking your coin…");
      const prep = await post<{ id: string; transaction: string | null }>("/api/launch/prepare", {
        forHandle: cleanHandle,
        name,
        ticker,
        description,
        image,
        firstBuySol: firstBuy,
      });
      let signature: string | null = null;
      if (prep.transaction) {
        setBusy("Approve your first buy in your wallet…");
        const bytes = Uint8Array.from(atob(prep.transaction), (c) => c.charCodeAt(0));
        signature = await signAndSendTransaction(bytes);
      }
      setBusy("Launching on pump.fun…");
      const out = await post<{ mint: string; signature: string }>("/api/launch/submit", { id: prep.id, signature });
      setDone({ mint: out.mint, signature: out.signature, handle: cleanHandle, name, ticker: ticker.toUpperCase() });
    } catch (e) {
      setMsg(walletErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const share = done
    ? `https://x.com/intent/post?text=${encodeURIComponent(`I launched $${done.ticker} for @${done.handle} on @${xHandle}. 90% of its creator fees are theirs: ${siteUrl}/coin/${done.mint}`)}`
    : "";

  const label = !wallet.address ? "Connect wallet to launch" : !signedIn ? "Sign in and launch" : cleanHandle ? `Launch for @${cleanHandle}` : "Launch";

  return (
    <div className="composer">
      <form
        className="form glass"
        onSubmit={(e) => {
          e.preventDefault();
          void launch();
        }}
      >
        <div className="fstep">
          <div className="fh">
            <span className="n">1</span>
            <h3>Who it&apos;s for</h3>
          </div>
          <label className="f">
            <span>Their X account</span>
            <input className="in" name="forHandle" placeholder="@yourfriend" value={handle} onChange={(e) => setHandle(e.target.value)} autoComplete="off" />
          </label>
          <div className="hint">The account that receives the fees. They claim by posting one tweet.</div>
        </div>
        <div className="fstep">
          <div className="fh">
            <span className="n">2</span>
            <h3>The coin</h3>
          </div>
          <div className="two">
            <label className="f">
              <span>Name</span>
              <input className="in" name="name" maxLength={32} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="f">
              <span>Ticker</span>
              <input className="in" name="ticker" maxLength={10} value={ticker} onChange={(e) => setTicker(e.target.value.replace(/[^A-Za-z0-9]/g, ""))} />
            </label>
          </div>
          <label className="f">
            <span>
              Image <em>(square is best, 4 MB max)</em>
            </span>
            <div className="drop">
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file */}
              {image && <img src={image} alt="" />}
              {!image && <span>Click or drop an image</span>}
              <input
                type="file"
                name="image"
                accept="image/png,image/jpeg,image/gif,image/webp"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 4 * 1024 * 1024) return setMsg("The image is over 4 MB.");
                  setImage(await readFile(file));
                }}
              />
            </div>
          </label>
          <label className="f">
            <span>
              Description <em>(optional)</em>
            </span>
            <textarea className="in" name="description" maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
        </div>
        <div className="fstep">
          <div className="fh">
            <span className="n">3</span>
            <h3>Your first buy</h3>
          </div>
          <label className="f">
            <span>
              Amount in SOL <em>(optional)</em>
            </span>
            <input className="in" name="firstBuy" inputMode="decimal" placeholder="0.1" value={firstBuy} onChange={(e) => setFirstBuy(e.target.value)} />
          </label>
          <div className="hint">
            Sent from your wallet to the {siteName} launch wallet before the coin is created; it is spent as the first buy and the tokens are sent to you. No launch fee.
          </div>
        </div>
        <div className="msg" role="alert">{msg}</div>
        {done ? (
          <div className="launched" data-testid="launched">
            <b>
              ${done.ticker} is live for @{done.handle}
            </b>
            <span>
              <a href={`https://pump.fun/coin/${done.mint}`} target="_blank" rel="noreferrer">Open on pump.fun</a> ·{" "}
              <Link href={`/coin/${done.mint}`}>Coin page</Link> ·{" "}
              <a href={share} target="_blank" rel="noreferrer">Tell them on X</a>
            </span>
          </div>
        ) : (
          <button type="submit" className="btn btn-white btn-lg" disabled={busy !== null} data-testid="launch-btn">
            {busy ? (
              <>
                <span className="spinner" /> {busy}
              </>
            ) : (
              label
            )}
          </button>
        )}
      </form>
      <aside className="side glass">
        <span className="k">Preview</span>
        <div className="card glass">
          {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
          <div className="img">{image && <img src={image} alt="" />}</div>
          <div className="meta">
            <div className="nm">
              <b>{name || "Coin name"}</b>
              <span>{ticker ? ticker.toUpperCase() : "TICKER"}</span>
            </div>
            <div className="for">{cleanHandle ? `for @${cleanHandle}` : "Pick an X account"}</div>
          </div>
        </div>
        <div className="rows">
          <div>
            <span>Creator fees</span>
            <b>90% to them</b>
          </div>
          <div>
            <span>$KUDOS buyback &amp; burn</span>
            <b>10%</b>
          </div>
          <div>
            <span>Launch fee</span>
            <b>None</b>
          </div>
          <div>
            <span>You get</span>
            <b>Your first buy&apos;s tokens</b>
          </div>
          <div>
            <span>On X</span>
            <b>A post link to tag them</b>
          </div>
        </div>
      </aside>
    </div>
  );
}
