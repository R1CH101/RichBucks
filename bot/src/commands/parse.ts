export type ParsedCommand =
  | { type: "help" }
  | { type: "balance" }
  | { type: "give"; email?: string; reason: string }
  | { type: "send"; email?: string; amount: string }
  | { type: "leaderboard" }
  | { type: "export-wallet"; confirmed: boolean }
  | { type: "unknown"; raw: string };

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

export function extractEmail(text: string): string | undefined {
  const m = text.match(EMAIL_RE);
  return m ? m[0].toLowerCase() : undefined;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseCommand(text: string): ParsedCommand {
  const email = extractEmail(text);
  // Strip email before @[...] so "alice@co.com" is not eaten as an @mention
  let cleaned = text;
  if (email) {
    cleaned = cleaned.replace(new RegExp(escapeRegExp(email), "ig"), " ");
  }
  cleaned = cleaned
    .replace(/<at>[^<]*<\/at>/gi, " ")
    .replace(/(^|[\s])@[^\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const lower = cleaned.toLowerCase();

  if (!cleaned || lower === "help" || lower.startsWith("/help")) return { type: "help" };
  if (lower === "balance" || lower.startsWith("/balance")) return { type: "balance" };
  if (lower === "leaderboard" || lower.startsWith("/leaderboard")) return { type: "leaderboard" };
  if (lower.startsWith("export-wallet") || lower.startsWith("/export-wallet")) {
    const confirmed = /\bconfirm\b/i.test(cleaned);
    return { type: "export-wallet", confirmed };
  }

  const give = cleaned.match(/^\/?give(?:\s+(.*))?$/i);
  if (give) {
    return {
      type: "give",
      email,
      reason: (give[1] || "").trim() || "👍",
    };
  }

  const send = cleaned.match(/^\/?send\s+(\d+)\s*$/i);
  if (send) {
    return { type: "send", email, amount: send[1] };
  }

  return { type: "unknown", raw: cleaned };
}
