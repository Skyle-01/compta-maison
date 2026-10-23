"use client";

import { useEffect, useState } from "react";
import {
  api,
  errorMessage,
  type Account,
  type AccountCoverage,
  type ImportResult,
  type InputsImportResult,
  type Silence,
  formatEuro,
  frenchDate,
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
  const [coverage, setCoverage] = useState<AccountCoverage[] | null>(null);
  const [coverageError, setCoverageError] = useState<string | null>(null);

  async function loadCoverage() {
    try {
      setCoverage(await api.importCoverage());
      setCoverageError(null);
    } catch (err) {
      setCoverageError(errorMessage(err));
    }
  }

  useEffect(() => {
    api.listAccounts().then(setAccounts).catch(() => setAccounts([]));
    api
      .importCoverage()
      .then(setCoverage)
      .catch((err) => setCoverageError(errorMessage(err)));
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
      loadCoverage();
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
      loadCoverage();
    } catch (err) {
      setInputsError(errorMessage(err));
    } finally {
      setInputsBusy(false);
    }
  }

  // Files that brought new rows, were skipped or start after a hole; the already imported ones are
  // only counted.
  const inputsNotable =
    inputsResult?.files.filter((f) => f.error || f.rows_new > 0 || f.gap_warning) ?? [];
  const inputsUnchanged = (inputsResult?.files.length ?? 0) - inputsNotable.length;
  const inputsBeforeStart = inputsResult?.files.reduce((n, f) => n + f.rows_before_start, 0) ?? 0;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Importer des relevés bancaires</h1>

      <div className="grid items-start gap-6 md:grid-cols-2">
        <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-6 text-sm">
          <h2 className="font-semibold">Relevés déposés dans le dossier _inputs</h2>
          <p className="text-zinc-500">
            Relit tous les fichiers CSV de <code>_inputs/</code> et n’ajoute que les opérations absentes de
            la base : les relevés déjà importés ou qui se chevauchent ne créent pas de doublons. Exportez
            vos relevés avec quelques jours de chevauchement : un trou entre deux relevés est alors
            signalé à coup sûr.
          </p>
          <button
            type="button"
            onClick={importInputs}
            disabled={inputsBusy}
            className="btn-primary"
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
                      {f.gap_warning && <p className="text-amber-800">{f.gap_warning}</p>}
                    </li>
                  ))}
                </ul>
              )}
              {inputsUnchanged > 0 && (
                <p className="text-zinc-500">{inputsUnchanged} fichier(s) sans nouvelle opération.</p>
              )}
              {inputsBeforeStart > 0 && <BeforeStart count={inputsBeforeStart} />}
            </div>
          )}
        </section>

        <div className="space-y-4">
          <form onSubmit={submit} className="space-y-4 rounded-lg border border-zinc-200 bg-white p-6 text-sm">
            <h2 className="font-semibold">Importer un fichier</h2>
            <div>
              <label className="mb-1 block text-sm text-zinc-600" htmlFor="file">
                Fichier de relevé (CSV)
              </label>
              <input
                id="file"
                type="file"
                accept=".csv"
                className="block w-full text-zinc-600 file:mr-3 file:cursor-pointer file:rounded file:border file:border-zinc-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:text-zinc-700 hover:file:bg-zinc-50"
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
                className="w-full rounded border border-zinc-300 bg-white px-2 py-1.5"
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
              className="btn-primary"
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
                {result.rows_new === 0 && result.rows_total > 0 && " (toutes en double — déjà importées)"}.
              </p>
              {result.gap_warning && <p className="text-amber-800">{result.gap_warning}</p>}
              {result.rows_before_start > 0 && <BeforeStart count={result.rows_before_start} />}
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
      </div>

      <CoverageSection coverage={coverage} error={coverageError} />
    </div>
  );
}

/** Per account, the dates the DB and the _inputs/ statements cover: a hole between two statements
 *  means one is missing; the longest silence may only be a quiet spell. */
function CoverageSection({ coverage, error }: { coverage: AccountCoverage[] | null; error: string | null }) {
  return (
    <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-6 text-sm">
      <h2 className="font-semibold">Couverture des relevés</h2>
      <p className="text-zinc-500">
        Pour chaque compte, les dates couvertes par la base et par les relevés de <code>_inputs/</code>.
        Des jours couverts par aucun relevé entre deux fichiers signalent un relevé manquant. Le plus long
        silence (aucune opération en base) peut aussi être une simple période calme.
      </p>
      {error && <p className="text-red-800">{error}</p>}
      {coverage && (
        <table className="w-full">
          <thead className="text-left text-zinc-500">
            <tr>
              <th className="py-2 pr-3 font-medium">Compte</th>
              <th className="py-2 pr-3 text-right font-medium">Opérations</th>
              <th className="py-2 pr-3 font-medium">Première</th>
              <th className="py-2 pr-3 font-medium">Dernière</th>
              <th className="py-2 pr-3 text-right font-medium">Relevés</th>
              <th className="py-2 pr-3 font-medium">Plus long silence</th>
              <th className="py-2 font-medium">Trous entre relevés</th>
            </tr>
          </thead>
          <tbody>
            {coverage.map((a) => (
              <tr key={a.code} className="whitespace-nowrap border-t border-zinc-100 align-top">
                <td className="py-1.5 pr-3">{a.label}</td>
                <td className="py-1.5 pr-3 text-right">{a.operations}</td>
                <td className="py-1.5 pr-3">{a.first ? frenchDate(a.first) : "-"}</td>
                <td className="py-1.5 pr-3">{a.last ? frenchDate(a.last) : "-"}</td>
                <td className="py-1.5 pr-3 text-right">{a.files}</td>
                <td className="whitespace-normal py-1.5 pr-3 text-zinc-500">
                  {a.longest_silence ? <Period period={a.longest_silence} /> : "-"}
                </td>
                <td className="whitespace-normal py-1.5">
                  {a.holes.length === 0 ? (
                    <span className="text-zinc-500">aucun</span>
                  ) : (
                    a.holes.map((h) => (
                      <div key={h.start} className="text-amber-800">
                        <Period period={h} />
                      </div>
                    ))
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Period({ period }: { period: Silence }) {
  return (
    <>
      {period.days} jour(s), du {frenchDate(period.start)} au {frenchDate(period.end)}
    </>
  );
}

/** Rows the backend left out because they predate the books' start date (settings.toml). */
function BeforeStart({ count }: { count: number }) {
  return (
    <p className="text-zinc-500">
      {count} opération(s) antérieure(s) à la date de début (<code>start_date</code> de{" "}
      <code>settings.toml</code>) non importée(s).
    </p>
  );
}
