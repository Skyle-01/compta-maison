"use client";

import { useEffect, useState } from "react";
import {
  api,
  errorMessage,
  type Account,
  type ImportResult,
  type InputsImportResult,
  formatEuro,
  frenchMonth,
  notifyUncategorizedChanged,
} from "@/lib/api";

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [account, setAccount] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [inputsBusy, setInputsBusy] = useState(false);
  const [inputsResult, setInputsResult] = useState<InputsImportResult | null>(null);
  const [inputsError, setInputsError] = useState<string | null>(null);

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
      notifyUncategorizedChanged();
    } catch (err) {
      setErrors(errorMessage(err).split("\n"));
    } finally {
      setBusy(false);
    }
  }

  async function importInputs() {
    setInputsBusy(true);
    setInputsError(null);
    setInputsResult(null);
    try {
      setInputsResult(await api.importInputs());
      notifyUncategorizedChanged();
    } catch (err) {
      setInputsError(errorMessage(err));
    } finally {
      setInputsBusy(false);
    }
  }

  // Files that brought new rows or were skipped; the already imported ones are only counted.
  const inputsNotable = inputsResult?.files.filter((f) => f.error || f.rows_new > 0) ?? [];
  const inputsUnchanged = (inputsResult?.files.length ?? 0) - inputsNotable.length;

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-xl font-semibold">Importer des relevés bancaires</h1>

      <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-6 text-sm">
        <h2 className="font-medium">Relevés déposés dans le dossier _inputs</h2>
        <p className="text-zinc-500">
          Relit tous les fichiers CSV de <code>_inputs/</code> et n’ajoute que les opérations absentes de
          la base : les relevés déjà importés ou qui se chevauchent ne créent pas de doublons.
        </p>
        <button
          type="button"
          onClick={importInputs}
          disabled={inputsBusy}
          className="rounded bg-zinc-900 px-4 py-1.5 text-sm text-white disabled:opacity-40"
        >
          {inputsBusy ? "Import en cours…" : "Importer les nouveaux relevés"}
        </button>
        {inputsError && <p className="text-red-800">{inputsError}</p>}
        {inputsResult && (
          <div className="space-y-2">
            <p>
              <strong>{inputsResult.rows_new}</strong> nouvelle(s) opération(s) importée(s) depuis{" "}
              {inputsResult.files.length} fichier(s).
            </p>
            {inputsNotable.length > 0 && (
              <ul className="space-y-1">
                {inputsNotable.map((f) => (
                  <li key={f.name}>
                    <span className="font-mono text-xs">{f.name}</span>
                    {f.error ? (
                      <span className="text-red-800"> : ignoré, {f.error}</span>
                    ) : (
                      <span className="text-zinc-500">
                        {" "}
                        : {f.rows_new} / {f.rows_total} dans {f.account}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {inputsUnchanged > 0 && (
              <p className="text-zinc-500">{inputsUnchanged} fichier(s) sans nouvelle opération.</p>
            )}
          </div>
        )}
      </section>

      <form onSubmit={submit} className="space-y-4 rounded-lg border border-zinc-200 bg-white p-6">
        <div>
          <label className="mb-1 block text-sm text-zinc-600" htmlFor="file">
            Fichier de relevé (CSV)
          </label>
          <input
            id="file"
            type="file"
            accept=".csv"
            className="block w-full text-sm"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
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
            {/* Empty: the backend infers the account from the file name (bank profiles included). */}
            <option value="">Déduire du nom du fichier</option>
            {accounts.map((a) => (
              <option key={a.code} value={a.code}>
                {a.label} ({a.code})
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={!file || busy}
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
          <p className="text-zinc-500">
            Format : {result.profile === "default" ? "par défaut" : result.profile}
          </p>
          {result.archived_as ? (
            <p className="text-zinc-500">
              Copié dans <code>_inputs/</code> sous « {result.archived_as} ».
            </p>
          ) : (
            <p className="text-amber-800">
              Fichier non copié dans <code>_inputs/</code> : ajoutez-le à la main sous un nom qui
              désigne le compte, sinon une reconstruction de la base l’oubliera.
            </p>
          )}
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
