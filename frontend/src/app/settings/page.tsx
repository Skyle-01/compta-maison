"use client";

import { useCallback, useEffect, useState } from "react";
import HelpLink from "@/components/HelpLink";
import {
  api,
  errorMessage,
  type Account,
  type ConfigExportResult,
  type Transaction,
  frenchDate,
  notifyUncategorizedChanged,
} from "@/lib/api";
import SignedAmount from "@/components/SignedAmount";
import { groupManualTransfers, type ManualTransfer } from "@/lib/manualTransfers";

// Section order on the page; the ids are URL fragments (e.g. /settings#virements-manuels).
// Categories, rules and manual assignments live on the Catégories page.
const SECTIONS = [
  { id: "comptes", label: "Comptes" },
  { id: "virements-internes", label: "Virements internes" },
  { id: "virements-manuels", label: "Virements manuels" },
  { id: "sauvegarde", label: "Sauvegarde" },
] as const;

// scroll-mt keeps a section title clear of the sticky table of contents when jumping to it.
const SECTION_CLASS = "scroll-mt-16 space-y-3";

/** A failed action's message, shown in the section that raised it. It sticks just below the table
 *  of contents while that section is on screen, so it stays in view from a row deep in a long
 *  table. */
function SectionError({ message, onClose }: { message: string | null; onClose: () => void }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="sticky top-11 z-[5] flex items-start gap-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 shadow-sm"
    >
      <p className="flex-1">{message}</p>
      <button onClick={onClose} className="text-red-700 hover:text-red-900" title="Fermer" aria-label="Fermer">
        ✕
      </button>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <div className="space-y-10">
      <h1 className="text-xl font-semibold">
        Réglages
        <HelpLink page="/settings" />
      </h1>
      {/* A direct child of the page container, so it stays stuck for the whole page. */}
      <nav
        aria-label="Sections des réglages"
        className="sticky top-0 z-10 -mx-6 -mt-7 overflow-x-auto border-b border-zinc-200 bg-zinc-50/95 px-6 py-2 backdrop-blur"
      >
        <ul className="flex gap-2 whitespace-nowrap text-sm">
          {SECTIONS.map(({ id, label }) => (
            <li key={id}>
              <a
                href={`#${id}`}
                className="block rounded-full border border-zinc-300 bg-white px-3 py-1 text-zinc-700 hover:border-zinc-500 hover:text-zinc-900"
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <AccountsSection />
      <TransferMarkersSection />
      <ManualTransfersSection />
      <BackupSection />
    </div>
  );
}

const ACCOUNT_TYPE_LABEL: Record<Account["type"], string> = {
  checking: "Compte courant",
  savings: "Épargne",
};

type AccountDraft = { code: string; label: string; type: Account["type"]; aliases: string; pattern: string };

const NEW_ACCOUNT: AccountDraft = { code: "", label: "", type: "checking", aliases: "", pattern: "" };

/** Create an account or edit one's label, aliases and deposit pattern (its code and type are fixed
 *  once created). Saving re-derives the transfers, since names and patterns decide which are. */
function AccountsSection() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [draft, setDraft] = useState<AccountDraft>(NEW_ACCOUNT);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .listAccounts()
      .then(setAccounts)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  useEffect(load, [load]);

  function edit(a: Account) {
    setDraft({
      code: a.code,
      label: a.label,
      type: a.type,
      aliases: a.aliases.join("\n"),
      pattern: a.deposit_pattern ?? "",
    });
    setEditing(true);
    setSaved(null);
    setError(null);
  }

  function reset() {
    setDraft(NEW_ACCOUNT);
    setEditing(false);
  }

  async function save() {
    setSaved(null);
    setError(null);
    try {
      const a = await api.saveAccount(draft.code, {
        label: draft.label,
        type: draft.type,
        deposit_pattern: draft.type === "savings" ? draft.pattern : null,
        aliases: draft.aliases.split("\n"),
      });
      setSaved(`Compte ${a.code} enregistré, virements recalculés. Pensez à « Enregistrer la configuration » (section Sauvegarde).`);
      reset();
      load();
      notifyUncategorizedChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <section id="comptes" className={SECTION_CLASS}>
      <h2 className="text-base font-semibold">Comptes</h2>
      <SectionError message={error} onClose={() => setError(null)} />
      <p className="text-sm text-zinc-500">
        Un relevé est rattaché à un compte par son nom de fichier : le code, le libellé ou un alias
        (une ligne par alias, par exemple le numéro de compte de la banque) doit s&apos;y retrouver. Les
        libellés de virement sont lus avec le libellé et les alias. Un nom ne peut désigner qu&apos;un seul
        compte. Le code et le type ne changent plus après la création. Un motif de dépôt (épargne
        externe, sans relevé) repère ses versements dans les libellés des comptes courants, sans
        distinction de casse.
      </p>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">Libellé</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Alias / motif de dépôt</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.code} className="border-t border-zinc-100 align-top">
                <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">{a.code}</td>
                <td className="px-3 py-1.5">{a.label}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-zinc-500">{ACCOUNT_TYPE_LABEL[a.type]}</td>
                <td className="px-3 py-1.5 text-zinc-500">
                  {[...a.aliases, ...(a.deposit_pattern ? [`dépôts : ${a.deposit_pattern}`] : [])].join(" · ")}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right">
                  <button
                    onClick={() => edit(a)}
                    className="text-zinc-600 hover:text-zinc-900"
                    title="Modifier ce compte"
                  >
                    ✎
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500">Code</span>
          <input
            value={draft.code}
            onChange={(e) => setDraft({ ...draft, code: e.target.value })}
            disabled={editing}
            className="w-40 rounded border border-zinc-300 px-2 py-1 font-mono text-xs disabled:bg-zinc-100"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500">Libellé</span>
          <input
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            className="w-48 rounded border border-zinc-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500">Type</span>
          <select
            value={draft.type}
            onChange={(e) => setDraft({ ...draft, type: e.target.value as Account["type"] })}
            disabled={editing}
            className="rounded border border-zinc-300 px-2 py-1.5 disabled:bg-zinc-100"
          >
            <option value="checking">{ACCOUNT_TYPE_LABEL.checking}</option>
            <option value="savings">{ACCOUNT_TYPE_LABEL.savings}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-zinc-500">Alias (un par ligne)</span>
          <textarea
            value={draft.aliases}
            onChange={(e) => setDraft({ ...draft, aliases: e.target.value })}
            rows={2}
            className="w-56 rounded border border-zinc-300 px-2 py-1 font-mono text-xs"
          />
        </label>
        {draft.type === "savings" && (
          <label className="flex flex-col gap-1">
            <span className="text-zinc-500">Motif de dépôt (épargne externe)</span>
            <input
              value={draft.pattern}
              onChange={(e) => setDraft({ ...draft, pattern: e.target.value })}
              className="w-56 rounded border border-zinc-300 px-2 py-1"
            />
          </label>
        )}
        <button onClick={save} className="btn-primary">
          {editing ? "Enregistrer le compte" : "Ajouter le compte"}
        </button>
        {editing && (
          <button onClick={reset} className="btn-secondary">
            Annuler
          </button>
        )}
        {saved && <p className="w-full text-xs text-zinc-500">{saved}</p>}
      </div>
    </section>
  );
}

const TRANSFER_TYPE_LABEL: Record<ManualTransfer["type"], string> = {
  pair: "Virement associé",
  single: "Virement seul",
  none: "Pas un virement",
};

/** Transfer decisions made on the Transactions page (kind_manual), with a way back to detection. */
function ManualTransfersSection() {
  const [rows, setRows] = useState<Transaction[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .listTransactions({ manualTransfer: true, limit: 1000 })
      .then((page) => setRows(page.items))
      .catch((e) => setStatus(errorMessage(e)));
  }, []);

  useEffect(load, [load]);

  async function backToAuto(id: number) {
    setStatus(null);
    try {
      await api.setTransferMode(id, "auto");
      notifyUncategorizedChanged();
      load();
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }

  const decisions = groupManualTransfers(rows);

  return (
    <section id="virements-manuels" className={SECTION_CLASS}>
      <h2 className="text-base font-semibold">Virements manuels</h2>
      <SectionError message={status} onClose={() => setStatus(null)} />
      <p className="text-sm text-zinc-500">
        Les décisions prises sur la page Transactions : deux opérations associées en virement, une
        opération marquée comme virement seule, ou un virement détecté que vous avez dissocié. « Auto »
        rend l’opération (et son éventuel partenaire) à la détection automatique. Elles sont
        enregistrées avec la configuration (section Sauvegarde).
      </p>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Opération(s)</th>
              <th className="px-3 py-2 text-right font-medium">Montant</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {decisions.map((d) => {
              const legs = d.type === "pair" ? [d.debit, d.credit] : [d.tx];
              return (
                <tr key={legs[0].id} className="border-t border-zinc-100 align-top">
                  <td className="whitespace-nowrap px-3 py-1.5">{TRANSFER_TYPE_LABEL[d.type]}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-zinc-500">
                    {legs.map((t) => (
                      <div key={t.id}>{frenchDate(t.date_valeur)}</div>
                    ))}
                  </td>
                  <td className="max-w-md px-3 py-1.5">
                    {legs.map((t) => (
                      <div key={t.id} className="truncate" title={t.libelle}>
                        <span className="text-zinc-500">{t.account_id ?? t.account}</span> · {t.libelle}
                      </div>
                    ))}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">
                    {legs.map((t) => (
                      <div key={t.id}>
                        <SignedAmount tx={t} />
                      </div>
                    ))}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">
                    <button
                      onClick={() => backToAuto(legs[0].id)}
                      className="text-zinc-600 hover:text-zinc-900"
                      title="Revenir à la détection automatique"
                    >
                      Auto
                    </button>
                  </td>
                </tr>
              );
            })}
            {decisions.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                  Aucune décision manuelle sur les virements.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Label prefixes that identify a virement for automatic transfer pairing. */
function TransferMarkersSection() {
  const [text, setText] = useState("");
  const [isDefault, setIsDefault] = useState(true);
  // The success note stays next to the button; a failure goes to the red banner.
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getTransferMarkers()
      .then((m) => {
        setText(m.markers.join("\n"));
        setIsDefault(m.is_default);
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  async function save() {
    setSaved(false);
    setError(null);
    try {
      const m = await api.setTransferMarkers(text.split("\n"));
      setText(m.markers.join("\n"));
      setIsDefault(m.is_default);
      setSaved(true);
      notifyUncategorizedChanged();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <section id="virements-internes" className={SECTION_CLASS}>
      <h2 className="text-base font-semibold">Virements internes</h2>
      <SectionError message={error} onClose={() => setError(null)} />
      <p className="text-sm text-zinc-500">
        Un débit et un crédit de même montant sur deux comptes, à 3 jours d’écart au plus, sont
        associés en virement (exclus des revenus/dépenses) si les deux libellés commencent par l’un
        de ces préfixes (un par ligne, sans distinction de casse ; « * » = tout libellé). Liste vide =
        valeur par défaut. Pour corriger un cas précis, utilisez la page Transactions (Associer /
        Dissocier).
      </p>
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          className="w-48 rounded border border-zinc-300 px-2 py-1 font-mono text-xs"
        />
        <button onClick={save} className="btn-primary">
          Enregistrer
        </button>
        {isDefault && <span className="text-xs text-zinc-500">(par défaut)</span>}
        {saved && <span className="text-xs text-zinc-500">Enregistré — virements recalculés.</span>}
      </div>
    </section>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

function savedMessage(r: ConfigExportResult): string {
  const counts = [
    plural(r.accounts, "compte", "comptes"),
    plural(r.categories, "catégorie", "catégories"),
    plural(r.rules, "règle", "règles"),
    plural(r.overrides, "modification manuelle", "modifications manuelles"),
    plural(r.transfer_markers, "marqueur de virement", "marqueurs de virement"),
  ].join(", ");
  return `Configuration enregistrée dans ${r.config_dir} : ${counts}. L’ancienne version et la base sont copiées dans ${r.backup_dir}.`;
}

/** Writes the DB's accounts, taxonomy, manual decisions and transfer markers to the config dir, so
 *  reset_db.py --source defaults rebuilds the same DB if compta.db is lost. */
function BackupSection() {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setSaved(null);
    setError(null);
    try {
      setSaved(savedMessage(await api.exportConfig()));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section id="sauvegarde" className={SECTION_CLASS}>
      <h2 className="text-base font-semibold">Sauvegarde</h2>
      <SectionError message={error} onClose={() => setError(null)} />
      <p className="text-sm text-zinc-500">
        Enregistre les comptes, catégories, règles, modifications manuelles et marqueurs de virement
        dans le dossier de configuration, pour reconstruire la base sans rien reclasser avec
        <code className="mx-1 rounded bg-zinc-100 px-1 text-zinc-700">reset_db.py --source defaults</code>
        si elle est perdue ou abîmée. Les fichiers remplacés sont d’abord copiés, avec la base, dans
        un dossier daté de <code className="rounded bg-zinc-100 px-1 text-zinc-700">_backups/</code>.
        Les profils de banque et la date de début ne sont jamais modifiés.
      </p>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <button
          onClick={save}
          disabled={saving}
          className="btn-primary"
        >
          {saving ? "Enregistrement…" : "Enregistrer la configuration"}
        </button>
        {saved && <p className="flex-1 text-zinc-600">{saved}</p>}
      </div>
    </section>
  );
}
