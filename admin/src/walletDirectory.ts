import fs from "fs";
import { DatabaseSync } from "node:sqlite";

export type WalletRow = {
  teamsId: string;
  displayName: string;
  address: string;
  email: string | null;
};

/** Read-only listing of custodial wallets (same SQLite the bot writes). */
export function listWallets(dbPath: string): WalletRow[] {
  if (!dbPath || !fs.existsSync(dbPath)) return [];
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const cols = db
        .prepare(`PRAGMA table_info(wallets)`)
        .all() as { name: string }[];
      const hasEmail = cols.some((c) => c.name === "email");
      const rows = hasEmail
        ? (db
            .prepare(
              `SELECT teams_id, display_name, address, email FROM wallets ORDER BY lower(display_name)`
            )
            .all() as {
            teams_id: string;
            display_name: string;
            address: string;
            email: string | null;
          }[])
        : (db
            .prepare(
              `SELECT teams_id, display_name, address FROM wallets ORDER BY lower(display_name)`
            )
            .all() as { teams_id: string; display_name: string; address: string }[]);
      return rows.map((r) => ({
        teamsId: r.teams_id,
        displayName: r.display_name,
        address: r.address,
        email: "email" in r ? (r.email as string | null) : null,
      }));
    } finally {
      db.close();
    }
  } catch (e) {
    console.warn("wallet directory unavailable:", e);
    return [];
  }
}
