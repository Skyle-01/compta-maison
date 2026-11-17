import type { Toast } from "@/lib/useChanges";

/** The red error banner and the amber warning of a page driven by `useChanges`. */
export function ChangeNotices({
  error,
  warning,
  onDismiss,
}: {
  error: string | null;
  warning: string | null;
  onDismiss: () => void;
}) {
  return (
    <>
      {error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          <p className="flex-1">{error}</p>
          <button onClick={onDismiss} className="text-red-700 hover:text-red-900" title="Fermer" aria-label="Fermer">
            ✕
          </button>
        </div>
      )}

      {warning && (
        <p role="status" className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          ⚠ {warning}
        </p>
      )}
    </>
  );
}

/** The confirmation of the last change with « Annuler » (also Alt+Z). */
export function UndoToast({ toast, undo }: { toast: Toast | null; undo: () => void }) {
  if (!toast) return null;
  return (
    <div className="fixed bottom-6 right-6 flex items-center gap-4 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm shadow-lg">
      <span className="text-green-700">{toast.message}</span>
      <button onClick={undo} className="font-medium text-zinc-600 hover:text-zinc-900" title="Alt+Z">
        Annuler
      </button>
    </div>
  );
}
