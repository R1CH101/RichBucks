import crypto from "crypto";
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

/** Build a Teams app manifest for one registered Azure Bot / app. */
export function buildTeamsManifest(app: TeamsAppPublic, opts?: { version?: string; packageId?: string }) {
  const site = websiteBase();
  const host = botPublicHost();
  const packageId = opts?.packageId || crypto.randomUUID();
  const version = opts?.version || "1.0.0";

  return {
    $schema: "https://developer.microsoft.com/json-schemas/teams/v1.25/MicrosoftTeams.schema.json",
    manifestVersion: "1.25",
    version,
    id: packageId,
    // Required for upload: declare Shared/Private channel readiness (bots/tabs).
    supportsChannelFeatures: "tier1",
    developer: {
      name: "RichBucks",
      websiteUrl: site,
      privacyUrl: `${site}/privacy`,
      termsOfUseUrl: `${site}/terms`,
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
        commandLists: [
          {
            scopes: ["personal", "groupChat", "team"],
            commands: [
              { title: "help", description: "Show RichBucks commands" },
              { title: "balance", description: "Show your RB balance" },
              { title: "give", description: "Tip 1 RB to @someone" },
              { title: "send", description: "Send whole RB to @someone" },
              { title: "leaderboard", description: "Top tippers and earners" },
              { title: "export-wallet", description: "DM only: export key" },
            ],
          },
        ],
      },
    ],
    permissions: ["identity", "messageTeamMembers"],
    validDomains: [host],
  };
}

export async function buildTeamsAppZip(app: TeamsAppPublic): Promise<{ zip: Buffer; filename: string }> {
  const dir = assetsDir();
  const color = fs.readFileSync(path.join(dir, "color.png"));
  const outline = fs.readFileSync(path.join(dir, "outline.png"));
  const manifest = buildTeamsManifest(app);
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
  };
}
