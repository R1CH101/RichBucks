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

  const missing: string[] = [];
  const bad = (name: string, value: string | undefined, minLen = 16) => {
    const v = (value || "").trim();
    if (!v || PLACEHOLDERS.has(v) || v.length < minLen) missing.push(name);
  };

  bad("WALLET_ENCRYPTION_KEY", process.env.WALLET_ENCRYPTION_KEY, 32);
  bad("MICROSOFT_APP_ID", process.env.MICROSOFT_APP_ID, 30);
  bad("MICROSOFT_APP_PASSWORD", process.env.MICROSOFT_APP_PASSWORD, 16);
  bad("MICROSOFT_APP_TENANT_ID", process.env.MICROSOFT_APP_TENANT_ID, 30);
  bad("CONTRACT_ADDRESS", process.env.CONTRACT_ADDRESS, 42);
  bad("RPC_URL", process.env.RPC_URL, 8);
  // Prefer dedicated welcome minter — never require full deployer in production bot
  const minter = process.env.WELCOME_MINTER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
  bad("WELCOME_MINTER_PRIVATE_KEY", minter, 64);

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
