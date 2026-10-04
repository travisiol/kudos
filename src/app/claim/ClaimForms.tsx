"use client";

import { useState } from "react";
import { explorerUrl } from "@/config/solana";
import { formatSol, shortAddress } from "@/lib/format";

type Paid = { handle: string; address: string; lamports: string; sig: string };
type Vault = { handle: string; balanceLamports: string; paidLamports: string; coins: { mint: string; name: string; ticker: string }[] };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? "Request failed.");
  return j;
}

export function ClaimForms({ handle, intent, example }: { handle: string; intent: string; example: string }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [paid, setPaid] = useState<Paid | null>(null);
  const [who, setWho] = useState("");
  const [vault, setVault] = useState<Vault | null>(null);
  const [lookMsg, setLookMsg] = useState("");

  const send = async () => {
    setBusy(true);
    setMsg("");
    try {
      setPaid(await call<Paid>("/api/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) }));
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const look = async () => {
    setLookMsg("");
    setVault(null);
    try {
      setVault(await call<Vault>(`/api/vault/${encodeURIComponent(who.trim().replace(/^@/, ""))}`));
    } catch (e) {
      setLookMsg((e as Error).message);
    }
  };

  return (
    <div className="opts">
      <div className="opt main glass">
        <span className="tag">Just post a tweet</span>
        <h3>Post your wallet on X</h3>
        <div className="ol">
          <div>
            <span>
              From the account the coin was launched for, post your Solana wallet address and tag <b>@{handle}</b>.{" "}
              <a href={intent} target="_blank" rel="noreferrer">Write the post</a>
            </span>
          </div>
          <div>
            <span>We check the post comes from that account. The first claim pins the vault to its X user id, so a renamed handle cannot take it later.</span>
          </div>
          <div>
            <span>The whole vault is sent to the wallet in your post, with a memo naming your account.</span>
          </div>
        </div>
        <div className="example">{example}</div>
        <p>Posted it? Paste the link to claim:</p>
        <form
          className="wd"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input className="in" name="tweet" placeholder="https://x.com/you/status/…" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button type="submit" className="btn btn-white" disabled={busy || !url.trim()} data-testid="claim-send">
            {busy ? <span className="spinner" /> : "Send"}
          </button>
        </form>
        <div className="msg" role="alert">{msg}</div>
        {paid && (
          <div className="done" data-testid="claim-done">
            Verified @{paid.handle}. <b>{formatSol(BigInt(paid.lamports))} SOL</b> sent to <span className="mono">{shortAddress(paid.address)}</span>.{" "}
            <a href={explorerUrl("tx", paid.sig)} target="_blank" rel="noreferrer">View the transaction</a>
          </div>
        )}
      </div>
      <div className="opt glass">
        <span className="tag">Look anyone up</span>
        <h3>What is waiting for them</h3>
        <p>Every vault balance is public: anyone can check it, and only a post from that account can claim it.</p>
        <form
          className="wd"
          onSubmit={(e) => {
            e.preventDefault();
            void look();
          }}
        >
          <input className="in" name="handle" placeholder="@handle" value={who} onChange={(e) => setWho(e.target.value)} />
          <button type="submit" className="btn" disabled={!who.trim()}>
            Look up
          </button>
        </form>
        <div className="msg" role="alert">{lookMsg}</div>
        {vault && (
          <div className="rows" data-testid="vault">
            <div>
              <span>@{vault.handle}</span>
              <b>{formatSol(BigInt(vault.balanceLamports))} SOL waiting</b>
            </div>
            <div>
              <span>Already paid</span>
              <b>{formatSol(BigInt(vault.paidLamports))} SOL</b>
            </div>
            <div>
              <span>Coins for them</span>
              <b>{vault.coins.length ? vault.coins.map((c) => `$${c.ticker}`).join(", ") : "None yet"}</b>
            </div>
          </div>
        )}
        <small className="muted">Claiming works by tweet only: we never ask for access to your X account.</small>
      </div>
    </div>
  );
}
