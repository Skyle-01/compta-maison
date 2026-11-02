import type { Account } from "./api";

/** The palette an account colour is picked from. The names and their order mirror
 *  backend/app/db.py::ACCOUNT_COLORS (the order sets the default colour by position); the classes
 *  are spelled out in full so Tailwind sees them. */
export const ACCOUNT_COLORS = [
  { name: "blue", label: "Bleu", dot: "bg-blue-500" },
  { name: "orange", label: "Orange", dot: "bg-orange-500" },
  { name: "violet", label: "Violet", dot: "bg-violet-500" },
  { name: "teal", label: "Turquoise", dot: "bg-teal-500" },
  { name: "pink", label: "Rose", dot: "bg-pink-500" },
  { name: "amber", label: "Ambre", dot: "bg-amber-500" },
  { name: "lime", label: "Citron vert", dot: "bg-lime-500" },
  { name: "slate", label: "Ardoise", dot: "bg-slate-500" },
] as const;

export type AccountColor = (typeof ACCOUNT_COLORS)[number];

/** The colour of an account: its own, else the palette entry at its position in `accounts` (the
 *  API order, by sort_order). Null for an unknown code. */
export function accountColor(
  accounts: Pick<Account, "code" | "color">[],
  code: string | null | undefined,
): AccountColor | null {
  const index = accounts.findIndex((a) => a.code === code);
  if (index < 0) return null;
  const own = ACCOUNT_COLORS.find((c) => c.name === accounts[index].color);
  return own ?? ACCOUNT_COLORS[index % ACCOUNT_COLORS.length];
}
