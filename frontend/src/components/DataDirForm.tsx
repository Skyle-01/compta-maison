"use client";

import { useState } from "react";
import { api, errorMessage, type DataDirStatus } from "@/lib/api";

/** Choose the data folder (database, config, statements, backups). The server creates the folder when
 *  missing and switches to it at once; the page reloads afterwards so everything refetches. A folder
 *  fixed by the COMPTA_DATA_DIR variable is only shown. */
export default function DataDirForm({ status }: { status: DataDirStatus }) {
  const [path, setPath] = useState(status.path ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status.locked) {
    return (
      <p className="text-sm text-zinc-600">
        Dossier fixé par la variable d&apos;environnement{" "}
        <code className="rounded bg-zinc-100 px-1 text-zinc-700">COMPTA_DATA_DIR</code> :{" "}
        <code className="rounded bg-zinc-100 px-1 text-zinc-700">{status.path}</code>. Modifiez la
        variable, puis relancez l&apos;application pour en changer.
      </p>
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.setDataDir(path);
      window.location.reload();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-2">
      {status.problem && (
        <p role="alert" className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {status.problem}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          aria-label="Chemin du dossier de données"
          placeholder="D:\compta-data"
          className="min-w-80 flex-1 rounded border border-zinc-300 px-2 py-1.5 text-sm"
        />
        <button type="submit" disabled={busy || !path.trim()} className="btn-primary">
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>
    </form>
  );
}
