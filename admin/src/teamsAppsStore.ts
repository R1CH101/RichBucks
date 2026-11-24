import crypto from "crypto";
import fs from "fs";
import path from "path";

export type TeamsApp = {
  id: string;
  label: string;
  appId: string;
  appPassword: string;
  tenantId: string;
  createdAt: number;
};

export type TeamsAppPublic = Omit<TeamsApp, "appPassword">;

type StoreFile = { version: 1; apps: TeamsApp[] };

const MAGIC = Buffer.from("TA1\0");
const SALT_LEN = 16;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

function deriveKey(secret: string, salt: Buffer): Buffer {
  return crypto.scryptSync(secret, salt, 32, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
}

function normalizeGuid(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Encrypted Teams app registry shared by bot + admin via the app-config volume.
 * File: {configDir}/teams-apps.enc
 */
export class TeamsAppsStore {
  private filePath: string;
  private secret: string;
  private cache: TeamsApp[] | null = null;
  private cacheMtimeMs = 0;

  constructor(configDir: string, encryptionSecret: string) {
    if (!encryptionSecret || encryptionSecret.length < 32) {
      throw new Error("TEAMS_CONFIG_KEY / WALLET_ENCRYPTION_KEY must be at least 32 characters");
    }
    fs.mkdirSync(configDir, { recursive: true });
    this.filePath = path.join(configDir, "teams-apps.enc");
    this.secret = encryptionSecret;
  }

  /** Import MICROSOFT_APP_* from env once when the store is empty. */
  seedFromEnvIfEmpty(): boolean {
    const apps = this.list();
    if (apps.length > 0) return false;
    const appId = (process.env.MICROSOFT_APP_ID || "").trim();
    const appPassword = (process.env.MICROSOFT_APP_PASSWORD || "").trim();
    const tenantId = (process.env.MICROSOFT_APP_TENANT_ID || "").trim();
    if (!appId || !appPassword || !tenantId) return false;
    this.upsert({
      label: "Bootstrap (env)",
      appId,
      appPassword,
      tenantId,
    });
    return true;
  }

  list(): TeamsApp[] {
    return this.load().map((a) => ({ ...a }));
  }

  listPublic(): TeamsAppPublic[] {
    return this.list().map(({ appPassword: _p, ...rest }) => rest);
  }

  getByAppId(appId: string): TeamsApp | undefined {
    const id = normalizeGuid(appId);
    return this.list().find((a) => normalizeGuid(a.appId) === id);
  }

  getById(id: string): TeamsApp | undefined {
    return this.list().find((a) => a.id === id);
  }

  /** Allowed tenant IDs across all configured apps. */
  allowedTenantIds(): Set<string> {
    return new Set(this.list().map((a) => normalizeGuid(a.tenantId)));
  }

  upsert(input: {
    id?: string;
    label: string;
    appId: string;
    appPassword: string;
    tenantId: string;
  }): TeamsApp {
    const apps = this.load();
    const appId = input.appId.trim();
    const tenantId = input.tenantId.trim();
    const label = (input.label || "").trim() || appId;
    if (!appId || !tenantId) throw new Error("appId and tenantId are required");

    let app: TeamsApp;
    if (input.id) {
      const idx = apps.findIndex((a) => a.id === input.id);
      if (idx < 0) throw new Error("app not found");
      const prev = apps[idx]!;
      const password = input.appPassword.trim() || prev.appPassword;
      if (!password) throw new Error("appPassword is required");
      // Unique appId
      if (apps.some((a, i) => i !== idx && normalizeGuid(a.appId) === normalizeGuid(appId))) {
        throw new Error("another app already uses this appId");
      }
      app = { ...prev, label, appId, appPassword: password, tenantId };
      apps[idx] = app;
    } else {
      if (!input.appPassword.trim()) throw new Error("appPassword is required");
      if (apps.some((a) => normalizeGuid(a.appId) === normalizeGuid(appId))) {
        throw new Error("appId already registered");
      }
      app = {
        id: crypto.randomBytes(12).toString("hex"),
        label,
        appId,
        appPassword: input.appPassword.trim(),
        tenantId,
        createdAt: Date.now(),
      };
      apps.push(app);
    }
    this.save(apps);
    return { ...app };
  }

  delete(id: string): boolean {
    const apps = this.load();
    const next = apps.filter((a) => a.id !== id);
    if (next.length === apps.length) return false;
    this.save(next);
    return true;
  }

  private load(): TeamsApp[] {
    if (!fs.existsSync(this.filePath)) {
      this.cache = [];
      this.cacheMtimeMs = 0;
      return [];
    }
    const st = fs.statSync(this.filePath);
    if (this.cache && st.mtimeMs === this.cacheMtimeMs) {
      return this.cache;
    }
    const blob = fs.readFileSync(this.filePath);
    const json = this.decrypt(blob);
    const data = JSON.parse(json) as StoreFile;
    if (!data || data.version !== 1 || !Array.isArray(data.apps)) {
      throw new Error("corrupt teams-apps config");
    }
    this.cache = data.apps;
    this.cacheMtimeMs = st.mtimeMs;
    return this.cache;
  }

  private save(apps: TeamsApp[]): void {
    const payload: StoreFile = { version: 1, apps };
    const enc = this.encrypt(JSON.stringify(payload));
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, enc, { mode: 0o600 });
    fs.renameSync(tmp, this.filePath);
    this.cache = apps;
    this.cacheMtimeMs = fs.statSync(this.filePath).mtimeMs;
  }

  private encrypt(plain: string): Buffer {
    const salt = crypto.randomBytes(SALT_LEN);
    const key = deriveKey(this.secret, salt);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([MAGIC, salt, iv, tag, ciphertext]);
  }

  private decrypt(blob: Buffer): string {
    if (blob.length < 4 + SALT_LEN + 12 + 16 || !blob.subarray(0, 4).equals(MAGIC)) {
      throw new Error("invalid teams-apps file (bad magic)");
    }
    const salt = blob.subarray(4, 4 + SALT_LEN);
    const iv = blob.subarray(4 + SALT_LEN, 4 + SALT_LEN + 12);
    const tag = blob.subarray(4 + SALT_LEN + 12, 4 + SALT_LEN + 12 + 16);
    const data = blob.subarray(4 + SALT_LEN + 12 + 16);
    const key = deriveKey(this.secret, salt);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  }
}

export function teamsConfigSecret(): string {
  return (
    process.env.TEAMS_CONFIG_KEY ||
    process.env.WALLET_ENCRYPTION_KEY ||
    ""
  );
}

export function teamsConfigDir(): string {
  return process.env.TEAMS_CONFIG_DIR || "/config";
}
