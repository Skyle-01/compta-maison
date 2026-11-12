"use client";

import { useEffect, useState } from "react";
import DataDirForm from "@/components/DataDirForm";
import { api, type DataDirStatus } from "@/lib/api";

/** Shows the pages once the data folder is configured, else a setup screen asking for it (the
 *  backend answers 409 to every other route until then, so the pages must not mount first). When
 *  the backend does not answer, the pages are shown: each one reports the unreachable server. */
export default function DataDirGate({ children }: { children: React.ReactNode }) {
  // undefined = not asked yet.
  const [status, setStatus] = useState<DataDirStatus | null | undefined>(undefined);

  useEffect(() => {
    api
      .dataDir()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  if (status === undefined) return null;
  if (status === null || status.configured) return <>{children}</>;
  return (
    <div className="mx-auto max-w-2xl space-y-4 py-8">
      <h1 className="text-xl font-semibold">Où ranger vos données ?</h1>
      <p className="text-sm text-zinc-600">
        La base, la configuration, les relevés bancaires et les sauvegardes sont enregistrés dans un
        seul dossier, en dehors du code de l&apos;application. Indiquez son chemin complet : il sera
        créé s&apos;il n&apos;existe pas. Pensez à le sauvegarder, il contient toutes vos données.
      </p>
      <DataDirForm status={status} />
    </div>
  );
}
