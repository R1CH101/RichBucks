import express from "express";
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  TurnContext,
  CardFactory,
  MessageFactory,
} from "botbuilder";
import * as dotenv from "dotenv";
import { WalletStore } from "./walletStore";
import { ChainClient, parseWholeRb } from "./chainClient";
import { parseCommand } from "./commands/parse";
import { assertBotSecrets, assertWalletKeyStrength, isProduction } from "./secrets";
import { MultiAppCredentialsFactory } from "./multiAppCredentialsFactory";
import { TeamsAppsStore, teamsConfigDir, teamsConfigSecret } from "./teamsAppsStore";
import { resolveContractAddress } from "./resolveContractAddress";

dotenv.config({ path: "../.env" });
dotenv.config();

const contractAddress = resolveContractAddress();
assertBotSecrets();

const port = Number(process.env.BOT_PORT || 3978);
const showMetamask = process.env.SHOW_METAMASK_CARD === "true";

const teamsSecret =
  teamsConfigSecret() || process.env.WALLET_ENCRYPTION_KEY || "dev-only-change-me-local-not-prod!!";
assertWalletKeyStrength(teamsSecret);

const teamsApps = new TeamsAppsStore(
  process.env.TEAMS_CONFIG_DIR ||
    (isProduction() ? teamsConfigDir() : "./data/config"),
  teamsSecret
);
teamsApps.seedFromEnvIfEmpty();

if (isProduction() && teamsApps.list().length === 0) {
  console.error(
    "No Teams apps configured. Set MICROSOFT_APP_ID/PASSWORD/TENANT_ID or add apps in admin → Teams apps."
  );
  process.exit(1);
}

const credentialsFactory = new MultiAppCredentialsFactory(teamsApps);
const botFrameworkAuthentication = new ConfigurationBotFrameworkAuthentication(
  {},
  credentialsFactory
);
const adapter = new CloudAdapter(botFrameworkAuthentication);

adapter.onTurnError = async (context, error) => {
  console.error("Bot error:", error);
  await context.sendActivity("Something went wrong with RichBucks. Try again in a moment.");
};

const walletKey = process.env.WALLET_ENCRYPTION_KEY || "dev-only-change-me-local-not-prod!!";
assertWalletKeyStrength(walletKey);
const store = new WalletStore(process.env.WALLET_DB_PATH || "./data/wallets.sqlite", walletKey);

const minterKey = process.env.WELCOME_MINTER_PRIVATE_KEY || "0x" + "11".repeat(32);
if (isProduction() && !process.env.WELCOME_MINTER_PRIVATE_KEY) {
  console.error("WELCOME_MINTER_PRIVATE_KEY required in production");
  process.exit(1);
}

const chain = new ChainClient(
  process.env.RPC_URL || "http://127.0.0.1:8545",
  contractAddress || "0x0000000000000000000000000000000000000001",
  minterKey
);

const HELP = [
  "**RichBucks** — private office token on your company chain.",
  "`/balance` — your RB + address (**DM**; in a group you'll get a private reply)",
  "`/give @Name [reason]` — tip **1 RB** once per day (minted; group or DM)",
  "`/send @Name <whole amount>` — transfer RB you hold (group or DM)",
  "`/leaderboard` — top tippers / earners / proposers (group or DM)",
  "`/export-wallet CONFIRM` — **DM only**: export private key (once/hour)",
  "`/help` — this list",
].join("\n");

const exportHits = new Map<string, number>();
const EXPORT_COOLDOWN_MS = 60 * 60 * 1000;

function activityTenantId(context: TurnContext): string {
  return (
    context.activity.conversation?.tenantId ||
    (context.activity.channelData as { tenant?: { id?: string } })?.tenant?.id ||
    ""
  );
}

function microsoftAppIdForActivity(context: TurnContext): string {
  const tenant = activityTenantId(context).toLowerCase();
  if (tenant) {
    const match = teamsApps.list().find((a) => a.tenantId.toLowerCase() === tenant);
    if (match) return match.appId;
  }
  return teamsApps.list()[0]?.appId || process.env.MICROSOFT_APP_ID || "";
}

function tenantAllowed(tenantId: string): boolean {
  if (!tenantId) return false;
  const allowed = teamsApps.allowedTenantIds();
  if (allowed.size === 0) return false;
  return allowed.has(tenantId.toLowerCase());
}

function isGroupConversation(context: TurnContext): boolean {
  const t = context.activity.conversation?.conversationType;
  return t === "groupChat" || t === "channel";
}

/** Personal details go to DM; in a group we acknowledge publicly then message privately. */
async function replyPrivately(
  context: TurnContext,
  privateText: string,
  groupAck = "Sent you a DM."
) {
  if (!isGroupConversation(context)) {
    await context.sendActivity(privateText);
    return;
  }

  await context.sendActivity(groupAck);

  const appId = microsoftAppIdForActivity(context);
  const tenantId = activityTenantId(context) || undefined;
  const members = [
    {
      id: context.activity.from.id,
      name: context.activity.from.name,
    },
  ];

  try {
    await adapter.createConversationAsync(
      appId,
      context.activity.channelId,
      context.activity.serviceUrl,
      "https://api.botframework.com",
      {
        isGroup: false,
        bot: {
          id: context.activity.recipient.id,
          name: context.activity.recipient.name,
        },
        members,
        tenantId,
        channelData: tenantId ? { tenant: { id: tenantId } } : undefined,
      } as Parameters<CloudAdapter["createConversationAsync"]>[4],
      async (dmContext) => {
        await dmContext.sendActivity(privateText);
      }
    );
  } catch (e) {
    console.error("DM failed", e);
    await context.sendActivity(
      "Couldn't DM you — open a 1:1 chat with RichBucks and run the command again."
    );
  }
}

async function ensureUser(context: TurnContext) {
  const teamsId = context.activity.from.aadObjectId || context.activity.from.id;
  const name = context.activity.from.name || "User";
  const { wallet, created } = store.ensureWallet(teamsId, name);
  if (created) {
    try {
      await chain.mintWelcome(wallet.address);
      await replyPrivately(
        context,
        `Welcome to RichBucks. Custodial wallet created and welcome pack minted.\n\`${wallet.address}\``,
        "Welcome — check your DM for wallet details."
      );
    } catch (e) {
      console.error("welcome mint failed", e);
      await replyPrivately(
        context,
        `Wallet created at \`${wallet.address}\` (welcome mint pending — ask admin).`,
        "Welcome — check your DM for wallet details."
      );
    }
  }
  return wallet;
}

function firstMention(context: TurnContext): { id: string; name: string } | undefined {
  const entities = context.activity.entities || [];
  for (const e of entities) {
    if ((e as { type?: string }).type === "mention") {
      const mentioned = (e as { mentioned?: { id?: string; aadObjectId?: string; name?: string } }).mentioned;
      if (mentioned && mentioned.id !== context.activity.recipient.id) {
        return {
          id: mentioned.aadObjectId || mentioned.id || "",
          name: mentioned.name || "User",
        };
      }
    }
  }
  return undefined;
}

async function resolveRecipient(context: TurnContext, fallbackName?: string) {
  const mention = firstMention(context);
  if (mention) {
    return store.ensureWallet(mention.id, mention.name).wallet;
  }
  if (fallbackName) {
    const found = store.findByDisplayName(fallbackName);
    if (found) return found;
  }
  return undefined;
}

async function handleMessage(context: TurnContext) {
  if (context.activity.type !== "message") return;
  const text = (context.activity.text || "").trim();
  if (!text) return;

  const tenantId = activityTenantId(context);
  if (!tenantAllowed(tenantId)) {
    await context.sendActivity("This RichBucks bot is not enabled for your organisation.");
    return;
  }

  const me = await ensureUser(context);
  const cmd = parseCommand(text);

  switch (cmd.type) {
    case "help":
      await context.sendActivity(HELP);
      return;

    case "balance": {
      const bal = await chain.balance(me.address);
      const canTip = await chain.canTipToday(me.address);
      let msg = `**Balance:** ${bal.toString()} RB\n**Address:** \`${me.address}\`\n**Today's /give:** ${canTip ? "available" : "already used"}`;
      if (showMetamask) {
        msg += `\n\nRPC: \`${process.env.PUBLIC_RPC_URL || "ask admin"}\` · chainId **88420** · token \`${contractAddress}\``;
      }
      await replyPrivately(context, msg, "Sent your balance in a DM.");
      return;
    }

    case "give": {
      const recipient = await resolveRecipient(context);
      if (!recipient) {
        await context.sendActivity("Mention who to tip: `/give @Name nice one`");
        return;
      }
      if (recipient.teamsId === me.teamsId) {
        await context.sendActivity("You can't tip yourself.");
        return;
      }
      try {
        const key = store.getSignerKey(me.teamsId);
        const receipt = await chain.giveDailyTip(key, recipient.address, cmd.reason);
        const bal = await chain.balance(recipient.address);
        await context.sendActivity(
          `Sent **1 RB** to **${recipient.displayName}** (${cmd.reason}).\nTheir balance: **${bal} RB**\nTx: \`${receipt?.hash || "ok"}\``
        );
      } catch (e: unknown) {
        const err = e as { shortMessage?: string; reason?: string; message?: string };
        const msg = String(err?.shortMessage || err?.reason || err?.message || e);
        if (msg.includes("already tipped")) {
          await context.sendActivity("You've already used today's /give.");
        } else {
          await context.sendActivity(`Tip failed: ${msg}`);
        }
      }
      return;
    }

    case "send": {
      const recipient = await resolveRecipient(context);
      if (!recipient) {
        await context.sendActivity("Mention who to pay: `/send @Name 5`");
        return;
      }
      try {
        const amount = parseWholeRb(cmd.amount);
        const key = store.getSignerKey(me.teamsId);
        await chain.send(key, recipient.address, amount);
        await context.sendActivity(
          `Sent **${amount} RB** to **${recipient.displayName}**.`
        );
      } catch (e: unknown) {
        const err = e as { shortMessage?: string; message?: string };
        await context.sendActivity(`Send failed: ${err?.shortMessage || err?.message || e}`);
      }
      return;
    }

    case "leaderboard": {
      const board = await chain.leaderboard(0);
      const fmt = (rows: { address: string; amount: bigint }[]) =>
        rows.length
          ? rows
              .map((r, i) => {
                const w = store.getByAddress(r.address);
                const label = w?.displayName || r.address.slice(0, 10);
                return `${i + 1}. ${label} — ${r.amount} RB`;
              })
              .join("\n")
          : "_none yet_";
      await context.sendActivity(
        [
          "**Top earners**",
          fmt(board.topEarners),
          "",
          "**Top givers**",
          fmt(board.topGivers),
          "",
          "**Top proposers**",
          fmt(board.topProposers),
        ].join("\n")
      );
      return;
    }

    case "export-wallet": {
      const conv = context.activity.conversation;
      if (conv.conversationType === "groupChat" || conv.conversationType === "channel") {
        await context.sendActivity("For safety, run `/export-wallet CONFIRM` in a **1:1 chat** with the bot.");
        return;
      }
      if (!cmd.confirmed) {
        await context.sendActivity(
          "Exporting your private key is irreversible risk if anyone else sees this chat.\n\n" +
            "Reply with **`/export-wallet CONFIRM`** to proceed (limited to once per hour)."
        );
        return;
      }
      const last = exportHits.get(me.teamsId) || 0;
      if (Date.now() - last < EXPORT_COOLDOWN_MS) {
        await context.sendActivity("Export cooldown: try again in an hour.");
        return;
      }
      exportHits.set(me.teamsId, Date.now());
      const key = store.getSignerKey(me.teamsId);
      await context.sendActivity(
        MessageFactory.attachment(
          CardFactory.adaptiveCard({
            type: "AdaptiveCard",
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            version: "1.5",
            body: [
              {
                type: "TextBlock",
                text: "⚠ Private key — delete this message after importing",
                weight: "Bolder",
                size: "Medium",
                color: "Attention",
              },
              {
                type: "TextBlock",
                text: "Anyone with this key controls your RB. Import into MetaMask, then delete this chat message.",
                wrap: true,
              },
              {
                type: "TextBlock",
                text: me.address,
                fontType: "Monospace",
                wrap: true,
              },
              {
                type: "TextBlock",
                text: key,
                fontType: "Monospace",
                wrap: true,
              },
            ],
          })
        )
      );
      return;
    }

    default:
      await context.sendActivity("Unknown command. Try `/help`.");
  }
}

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.status(200).send("ok"));

app.post("/api/messages", async (req, res) => {
  await adapter.process(req, res, async (context) => {
    await handleMessage(context);
  });
});

app.listen(port, () => {
  console.log(
    `RichBucks bot listening on ${port} (teamsApps=${teamsApps.list().length})`
  );
});
