const PLACEHOLDERS = new Set([
  "",
  "change-me",
  "change-me-long-random",
  "dev-session-secret",
  "dev-only-change-me",
  "change-me-to-32-bytes-hex-or-long-passphrase",
  "change-me-join-token",
  "coworker-join-token-change-me",
]);

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production" || process.env.RICHBUCKS_REQUIRE_SECRETS === "true";
}

export function assertAdminSecrets(): void {
  if (!isProduction()) return;

  const missing: string[] = [];
  const bad = (name: string, value: string | undefined, minLen = 16) => {
    const v = (value || "").trim();
    if (!v || PLACEHOLDERS.has(v) || v.length < minLen) missing.push(name);
  };

  bad("SESSION_SECRET", process.env.SESSION_SECRET, 32);
  bad("ADMIN_TOTP_SECRET", process.env.ADMIN_TOTP_SECRET, 16);
  bad("DEPLOYER_PRIVATE_KEY", process.env.DEPLOYER_PRIVATE_KEY, 64);
  bad("CONTRACT_ADDRESS", process.env.CONTRACT_ADDRESS, 42);
  bad("RPC_URL", process.env.RPC_URL, 8);
  bad("ADMIN_ALLOWED_IPS", process.env.ADMIN_ALLOWED_IPS, 7);
  // Encrypts Teams app registry shared with the bot (same key as wallets by default)
  bad(
    "TEAMS_CONFIG_KEY or WALLET_ENCRYPTION_KEY",
    process.env.TEAMS_CONFIG_KEY || process.env.WALLET_ENCRYPTION_KEY,
    32
  );
  if (process.env.JOIN_ENABLED === "true") {
    bad("NODE_JOIN_API_KEY", process.env.NODE_JOIN_API_KEY, 24);
  }

  if (!process.env.ADMIN_PASSWORD_HASH && PLACEHOLDERS.has(process.env.ADMIN_PASSWORD || "change-me")) {
    missing.push("ADMIN_PASSWORD_HASH or strong ADMIN_PASSWORD");
  }

  if (missing.length) {
    console.error("Refusing to start admin with insecure/missing secrets:", missing.join(", "));
    process.exit(1);
  }
}
