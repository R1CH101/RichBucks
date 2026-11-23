export type ParsedCommand =
  | { type: "help" }
  | { type: "balance" }
  | { type: "give"; mentionName?: string; mentionId?: string; reason: string }
  | { type: "send"; mentionName?: string; mentionId?: string; amount: string }
  | { type: "leaderboard" }
  | { type: "export-wallet" }
  | { type: "unknown"; raw: string };

export function parseCommand(text: string): ParsedCommand {
  const cleaned = text
    .replace(/<at>[^<]*<\/at>/gi, "")
    .replace(/@[^\s]+/g, "")
    .trim();
  const lower = cleaned.toLowerCase();

  if (!cleaned || lower === "help" || lower.startsWith("/help")) return { type: "help" };
  if (lower === "balance" || lower.startsWith("/balance")) return { type: "balance" };
  if (lower === "leaderboard" || lower.startsWith("/leaderboard")) return { type: "leaderboard" };
  if (lower.startsWith("export-wallet") || lower.startsWith("/export-wallet")) {
    return { type: "export-wallet" };
  }

  const give = cleaned.match(/^\/?give(?:\s+(.*))?$/i);
  if (give) {
    return { type: "give", reason: (give[1] || "").trim() || "👍" };
  }

  const send = cleaned.match(/^\/?send\s+(\d+)\s*$/i);
  if (send) {
    return { type: "send", amount: send[1] };
  }

  return { type: "unknown", raw: cleaned };
}
