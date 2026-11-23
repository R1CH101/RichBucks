import crypto from "crypto";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { Wallet } from "ethers";

export type StoredWallet = {
  teamsId: string;
  displayName: string;
  address: string;
};

/** scrypt params — intentional slow KDF if WALLET_ENCRYPTION_KEY is a passphrase. */
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const SALT_LEN = 16;
const MAGIC = Buffer.from("RB2\0"); // v2: scrypt + AES-GCM

function deriveKeyScrypt(secret: string, salt: Buffer): Buffer {
  return crypto.scryptSync(secret, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
}

/** Legacy v1: single SHA-256 (kept only for decrypt/migrate). */
function deriveKeyLegacy(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}

export class WalletStore {
  private db: Database.Database;
  private secret: string;

  constructor(dbPath: string, encryptionSecret: string) {
    if (!encryptionSecret || encryptionSecret.length < 32) {
      throw new Error("WALLET_ENCRYPTION_KEY must be at least 32 characters");
    }
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.secret = encryptionSecret;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS wallets (
        teams_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        address TEXT NOT NULL UNIQUE,
        enc_private_key BLOB NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_wallets_address ON wallets(address);
    `);
  }

  getByTeamsId(teamsId: string): StoredWallet | undefined {
    const row = this.db
      .prepare(`SELECT teams_id, display_name, address FROM wallets WHERE teams_id = ?`)
      .get(teamsId) as { teams_id: string; display_name: string; address: string } | undefined;
    if (!row) return undefined;
    return { teamsId: row.teams_id, displayName: row.display_name, address: row.address };
  }

  getByAddress(address: string): StoredWallet | undefined {
    const row = this.db
      .prepare(`SELECT teams_id, display_name, address FROM wallets WHERE lower(address) = lower(?)`)
      .get(address) as { teams_id: string; display_name: string; address: string } | undefined;
    if (!row) return undefined;
    return { teamsId: row.teams_id, displayName: row.display_name, address: row.address };
  }

  findByDisplayName(name: string): StoredWallet | undefined {
    const row = this.db
      .prepare(
        `SELECT teams_id, display_name, address FROM wallets WHERE lower(display_name) = lower(?)`
      )
      .get(name) as { teams_id: string; display_name: string; address: string } | undefined;
    if (!row) return undefined;
    return { teamsId: row.teams_id, displayName: row.display_name, address: row.address };
  }

  ensureWallet(teamsId: string, displayName: string): { wallet: StoredWallet; created: boolean } {
    const existing = this.getByTeamsId(teamsId);
    if (existing) {
      this.db
        .prepare(`UPDATE wallets SET display_name = ? WHERE teams_id = ?`)
        .run(displayName, teamsId);
      return { wallet: { ...existing, displayName }, created: false };
    }

    const w = Wallet.createRandom();
    const enc = this.encrypt(w.privateKey);
    this.db
      .prepare(
        `INSERT INTO wallets (teams_id, display_name, address, enc_private_key, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(teamsId, displayName, w.address, enc, Date.now());

    return {
      wallet: { teamsId, displayName, address: w.address },
      created: true,
    };
  }

  getSignerKey(teamsId: string): string {
    const row = this.db
      .prepare(`SELECT enc_private_key FROM wallets WHERE teams_id = ?`)
      .get(teamsId) as { enc_private_key: Buffer } | undefined;
    if (!row) throw new Error("wallet not found");
    const { plain, upgraded } = this.decrypt(row.enc_private_key);
    if (upgraded) {
      this.db
        .prepare(`UPDATE wallets SET enc_private_key = ? WHERE teams_id = ?`)
        .run(this.encrypt(plain), teamsId);
    }
    return plain;
  }

  private encrypt(plain: string): Buffer {
    const salt = crypto.randomBytes(SALT_LEN);
    const key = deriveKeyScrypt(this.secret, salt);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([MAGIC, salt, iv, tag, ciphertext]);
  }

  private decrypt(blob: Buffer): { plain: string; upgraded: boolean } {
    if (blob.length >= 4 + SALT_LEN + 12 + 16 && blob.subarray(0, 4).equals(MAGIC)) {
      const salt = blob.subarray(4, 4 + SALT_LEN);
      const iv = blob.subarray(4 + SALT_LEN, 4 + SALT_LEN + 12);
      const tag = blob.subarray(4 + SALT_LEN + 12, 4 + SALT_LEN + 12 + 16);
      const data = blob.subarray(4 + SALT_LEN + 12 + 16);
      const key = deriveKeyScrypt(this.secret, salt);
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
      return { plain, upgraded: false };
    }

    // Legacy v1: iv(12) + tag(16) + ciphertext, key = SHA-256(secret)
    const iv = blob.subarray(0, 12);
    const tag = blob.subarray(12, 28);
    const data = blob.subarray(28);
    const key = deriveKeyLegacy(this.secret);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    return { plain, upgraded: true };
  }
}
