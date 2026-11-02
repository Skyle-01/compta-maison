import { useEffect, useState } from "react";
import { type Account, api } from "./api";

/** Every account in the API order (for the colour dots: a failed load just leaves the list empty,
 *  the dots are decoration). */
export function useAccounts(): Account[] {
  const [accounts, setAccounts] = useState<Account[]>([]);
  useEffect(() => {
    api.listAccounts().then(setAccounts).catch(() => setAccounts([]));
  }, []);
  return accounts;
}
