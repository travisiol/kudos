import type { Metadata } from "next";
import { explorerUrl } from "@/config/solana";
import type { Cluster } from "@/config/solana";
import { formatSol, shortAddress } from "@/lib/format";
import { listLedger } from "@/server/operator";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ledger" };

const KIND: Record<string, string> = { sol: "Payout", token: "Tokens sent", claim: "Fees collected", buyback: "Buyback", burn: "Burn" };

export default function LedgerPage() {
  const rows = listLedger();
  return (
    <section className="page">
      <div className="ph">
        <h1>Ledger</h1>
        <p>Every transaction sent by the launch wallet, with its link on Solscan.</p>
      </div>
      <div className="box glass" style={{ overflowX: "auto" }}>
        {rows.length === 0 ? (
          <p className="muted" data-testid="ledger-empty">No transactions yet.</p>
        ) : (
          <table className="table" data-testid="ledger-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Kind</th>
                <th>To</th>
                <th>Amount</th>
                <th>Note</th>
                <th>Transaction</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const cluster = row.cluster as Cluster;
                return (
                  <tr key={row.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{new Date(row.at).toISOString().replace("T", " ").slice(0, 16)} UTC</td>
                    <td>{KIND[row.kind] ?? row.kind}</td>
                    <td className="mono">
                      {row.to ? (
                        <a href={explorerUrl("account", row.to, cluster)} target="_blank" rel="noreferrer">{shortAddress(row.to)}</a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="mono">{row.kind === "sol" || row.kind === "claim" || row.kind === "buyback" ? `${formatSol(BigInt(row.amount))} SOL` : row.amount}</td>
                    <td>{row.note ?? ""}</td>
                    <td className="mono">
                      <a href={explorerUrl("tx", row.sig, cluster)} target="_blank" rel="noreferrer" data-testid="ledger-sig">
                        {shortAddress(row.sig)}
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
