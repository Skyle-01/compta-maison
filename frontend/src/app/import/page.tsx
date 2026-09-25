"use client";

import { useEffect, useState } from "react";
import { api, type Account, type ImportResult, formatEuro, frenchMonth } from "@/lib/api";

/** Mirrors the backend's filename inference, then maps it to a known account code. */
function inferAccountCode(filename: string, accounts: Account[]): string {
  const match = filename.match(/^RELEVE_(?:COMPTE_)?(.+?)_\d{4}/);
  if (!match) return "";
  const raw = match[1].replaceAll("_", " ").toUpperCase();
  const hit = accounts.find((a) => raw.includes(a.code) || a.label.toUpperCase().includes(raw));
  return hit?.code ?? "";
}

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [account, setAccount] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    api.listAccounts().then(setAccounts).catch(() => setAccounts([]));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setErrors([]);
    setResult(null);
    try {
      setResult(await api.uploadCsv(file, account));
    } catch (err) {
      setErrors(err instanceof Error ? err.message.split("\n") : [String(err)]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-xl font-semibold">Importer un relevé bancaire</h1>

      <form onSubmit={submit} className="space-y-4 rounded-lg border border-zinc-200 bg-white p-6">
        <div>
          <label className="mb-1 block text-sm text-zinc-600" htmlFor="file">
            Fichier de relevé (CSV séparé par des points-virgules)
          </label>
          <input
            id="file"
            type="file"
            accept=".csv"
            className="block w-full text-sm"
            onChange={(e) => {
              const selected = e.target.files?.[0] ?? null;
              setFile(selected);
              if (selected) setAccount(inferAccountCode(selected.name, accounts));
            }}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm text-zinc-600" htmlFor="account">
            Compte
          </label>
          <select
            id="account"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm"
          >
            <option value="">Choisir un compte…</option>
            {accounts.map((a) => (
              <option key={a.code} value={a.code}>
                {a.label} ({a.code})
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={!file || !account || busy}
          className="rounded bg-zinc-900 px-4 py-1.5 text-sm text-white disabled:opacity-40"
        >
          {busy ? "Import en cours…" : "Importer"}
        </button>
      </form>

      {errors.length > 0 && (
        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}

      {result && (
        <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-6 text-sm">
          <p>
            <strong>{result.rows_new}</strong> nouvelle(s) opération(s) importée(s) sur{" "}
            {result.rows_total} dans <strong>{result.account}</strong>
            {result.rows_new === 0 && " (toutes en double — déjà importées)"}.
          </p>
          {result.uncategorized_count > 0 && (
            <p className="text-amber-800">
              {result.uncategorized_count} opération(s) des mois concernés sont sans catégorie.
            </p>
          )}
          {Object.entries(result.balance_warnings).map(([month, diff]) => (
            <p key={month} className="text-amber-800">
              {frenchMonth(month)} : les opérations sans catégorie ne s’équilibrent pas (
              {formatEuro(diff)} d’écart) — ajoutez des règles ou vérifiez les transactions.
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
