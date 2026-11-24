const PLACEHOLDERS = new Set([
  "",
  "change-me",
  "dev-only-change-me",
  "change-me-to-32-bytes-hex-or-long-passphrase",
  "0x" + "11".repeat(32),
]);

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production" || process.env.RICHBUCKS_REQUIRE_SECRETS === "true";
}

export function assertBotSecrets(): void {
  if (!isProduction()) return;

  // Coolify injects shared project env into every service. Owner key must never
  // remain in the bot process — strip even if compose blanking was overridden.
  if ((process.env.DEPLOYER_PRIVATE_KEY || "").trim()) {
    console.warn("Stripping DEPLOYER_PRIVATE_KEY from bot env (use WELCOME_MINTER_PRIVATE_KEY only).");
  }
  delete process.env.DEPLOYER_PRIVATE_KEY;
  delete process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_PASSWORD_HASH;
  delete process.env.ADMIN_TOTP_SECRET;
  delete process.env.SESSION_SECRET;

  const missing: string[] = [];
  const bad = (name: string, value: string | undefined, minLen = 16) => {
    const v = (value || "").trim();
    if (!v || PLACEHOLDERS.has(v) || v.length < minLen) missing.push(name);
  };

  bad("WALLET_ENCRYPTION_KEY", process.env.WALLET_ENCRYPTION_KEY, 32);
  // Populated by contract-deploy into env and/or /network/contract.address
  bad("CONTRACT_ADDRESS", process.env.CONTRACT_ADDRESS, 42);
  bad("RPC_URL", process.env.RPC_URL, 8);
  bad("WELCOME_MINTER_PRIVATE_KEY", process.env.WELCOME_MINTER_PRIVATE_KEY, 64);

  // Teams apps: either full env bootstrap OR apps will be loaded from /config (checked after seed).
  const hasEnvTeams =
    Boolean((process.env.MICROSOFT_APP_ID || "").trim()) &&
    Boolean((process.env.MICROSOFT_APP_PASSWORD || "").trim()) &&
    Boolean((process.env.MICROSOFT_APP_TENANT_ID || "").trim());
  if (!hasEnvTeams) {
    // OK if config volume already has apps — validated after TeamsAppsStore.seedFromEnvIfEmpty()
    console.warn(
      "MICROSOFT_APP_* not fully set; expecting Teams apps in TEAMS_CONFIG_DIR (admin UI)."
    );
  }

  if (missing.length) {
    console.error("Refusing to start bot with insecure/missing secrets:", missing.join(", "));
    process.exit(1);
  }
}

export function assertWalletKeyStrength(key: string): void {
  if (key.length < 32) {
    throw new Error("WALLET_ENCRYPTION_KEY must be at least 32 characters");
  }
  if (PLACEHOLDERS.has(key)) {
    throw new Error("WALLET_ENCRYPTION_KEY is a placeholder — set a real secret");
  }
}
