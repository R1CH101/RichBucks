import fs from "fs";
import path from "path";
import JSZip from "jszip";
import type { TeamsAppPublic } from "./teamsAppsStore";

function assetsDir(): string {
  // Prefer packaged assets next to dist/, fall back to repo layout in dev
  const candidates = [
    path.join(__dirname, "..", "assets", "teams"),
    path.join(__dirname, "assets", "teams"),
    path.join(process.cwd(), "assets", "teams"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "color.png")) && fs.existsSync(path.join(dir, "outline.png"))) {
      return dir;
    }
  }
  throw new Error("Teams icons missing (assets/teams/color.png + outline.png)");
}

function botPublicHost(): string {
  const fromEnv =
    process.env.BOT_PUBLIC_HOST ||
    process.env.TEAMS_BOT_DOMAIN ||
    "";
  if (fromEnv.trim()) return fromEnv.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  try {
    const u = new URL(process.env.PUBLIC_BOT_URL || "https://bot.richbucks.xyz");
    return u.hostname;
  } catch {
    return "bot.richbucks.xyz";
  }
}

function websiteBase(): string {
  return (process.env.PUBLIC_WEBSITE_URL || "https://richbucks.xyz").replace(/\/$/, "");
}

/**
 * Teams app manifest aligned with schema 1.30 + current Microsoft bot/group-chat guidance:
 * - bots.scopes includes groupChat + team
 * - defaultInstallScope / defaultGroupCapability so Add offers chat (not only Open)
 * - supportsTargetedMessages + slash/mention triggers for group compose
 * - stable package id (caller must pass packageId; never randomize per download)
 *
 * @see https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/deploy-and-publish/add-default-install-scope
 * @see https://learn.microsoft.com/en-us/microsoftteams/platform/agents-in-teams/agent-slash-commands
 */
export function buildTeamsManifest(
  app: TeamsAppPublic,
  opts?: { version?: string; packageId?: string }
) {
  const site = websiteBase();
  const host = botPublicHost();
  const packageId = opts?.packageId || app.packageId || app.appId;
  const version = opts?.version || app.packageVersion || "1.0.0";

  const commands = [
    { title: "help", description: "Show RichBucks commands" },
    { title: "balance", description: "Show your RB balance" },
    { title: "give", description: "Tip 1 RB to @someone or email" },
    { title: "send", description: "Send whole RB to @someone or email" },
    { title: "leaderboard", description: "Top tippers and earners" },
    { title: "export-wallet", description: "DM only: export key" },
  ];

  return {
    $schema: "https://developer.microsoft.com/json-schemas/teams/v1.30/MicrosoftTeams.schema.json",
    manifestVersion: "1.30",
    version,
    id: packageId,
    supportsChannelFeatures: "tier1",
    // Recommended install target in the Add dialog (chat, not personal-only Open)
    defaultInstallScope: "groupChat",
    // Schema key is lowercase "groupchat" (not groupChat) — see json-schemas#188
    defaultGroupCapability: {
      team: "bot",
      groupchat: "bot",
      meetings: "bot",
    },
    developer: {
      name: "RichBucks",
      websiteUrl: site,
      privacyUrl: `${site}/privacy`,
      termsOfUseUrl: `${site}/terms`,
      mpnId: "",
    },
    name: {
      short: "RichBucks",
      full: app.label ? `RichBucks (${app.label})` : "RichBucks bot",
    },
    description: {
      short: "Tip RichBucks in Teams",
      full: "Tip coworkers with /give, check /balance, transfer with /send, and view the leaderboard. Private company chain token (RB).",
    },
    icons: {
      color: "color.png",
      outline: "outline.png",
    },
    accentColor: "#0B3D2E",
    bots: [
      {
        botId: app.appId,
        scopes: ["personal", "groupChat", "team"],
        supportsFiles: false,
        isNotificationOnly: false,
        // Required for / slash commands + targeted messages in group chats (manifest 1.29+)
        supportsTargetedMessages: true,
        commandLists: [
          {
            scopes: ["personal", "groupChat", "team"],
            triggers: ["slash", "mention"],
            commands,
          },
        ],
      },
    ],
    permissions: ["identity", "messageTeamMembers"],
    validDomains: [host],
    webApplicationInfo: {
      id: app.appId,
      resource: "",
    },
  };
}

export async function buildTeamsAppZip(
  app: TeamsAppPublic,
  opts?: { version?: string; packageId?: string }
): Promise<{ zip: Buffer; filename: string; version: string; packageId: string }> {
  const dir = assetsDir();
  const color = fs.readFileSync(path.join(dir, "color.png"));
  const outline = fs.readFileSync(path.join(dir, "outline.png"));
  const manifest = buildTeamsManifest(app, opts);
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("color.png", color);
  zip.file("outline.png", outline);
  const buf = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
  const safe = (app.label || "app").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 40);
  return {
    zip: buf,
    filename: `RichBucks-teams-${safe}.zip`,
    version: String(manifest.version),
    packageId: String(manifest.id),
  };
}
