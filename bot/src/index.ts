import express from "express";
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  ConfigurationServiceClientCredentialFactory,
  TurnContext,
  CardFactory,
  MessageFactory,
} from "botbuilder";
import * as dotenv from "dotenv";
import { WalletStore } from "./walletStore";
import { ChainClient, parseWholeRb } from "./chainClient";
import { parseCommand } from "./commands/parse";

dotenv.config({ path: "../.env" });
dotenv.config();

const port = Number(process.env.BOT_PORT || 3978);
const showMetamask = process.env.SHOW_METAMASK_CARD === "true";

const credentialsFactory = new ConfigurationServiceClientCredentialFactory({
  MicrosoftAppId: process.env.MICROSOFT_APP_ID || "",
  MicrosoftAppPassword: process.env.MICROSOFT_APP_PASSWORD || "",
  MicrosoftAppType: process.env.MICROSOFT_APP_TENANT_ID ? "SingleTenant" : "MultiTenant",
  MicrosoftAppTenantId: process.env.MICROSOFT_APP_TENANT_ID,
});

const botFrameworkAuthentication = new ConfigurationBotFrameworkAuthentication(
  {},
  credentialsFactory
);
const adapter = new CloudAdapter(botFrameworkAuthentication);

adapter.onTurnError = async (context, error) => {
  console.error("Bot error:", error);
  await context.sendActivity("Something went wrong with RichBucks. Try again in a moment.");
};

const store = new WalletStore(
  process.env.WALLET_DB_PATH || "./data/wallets.sqlite",
  process.env.WALLET_ENCRYPTION_KEY || "dev-only-change-me"
);

if (!process.env.RPC_URL || !process.env.CONTRACT_ADDRESS || !process.env.DEPLOYER_PRIVATE_KEY) {
  console.warn("RPC_URL / CONTRACT_ADDRESS / DEPLOYER_PRIVATE_KEY not fully set — chain calls will fail until configured.");
}

const chain = new ChainClient(
  process.env.RPC_URL || "http://127.0.0.1:8545",
  process.env.CONTRACT_ADDRESS || "0x0000000000000000000000000000000000000001",
  process.env.DEPLOYER_PRIVATE_KEY || "0x" + "11".repeat(32)
);

const HELP = [
  "**RichBucks** — internal joke token, no cash value.",
  "`/balance` — your RB + address",
  "`/give @Name [reason]` — tip 1 RB (once per London/configured day)",
  "`/send @Name <whole amount>` — transfer RB you hold",
  "`/leaderboard` — top tippers / earners / proposers",
  "`/export-wallet` — DM only: export private key for MetaMask",
].join("\n");

async function ensureUser(context: TurnContext) {
  const teamsId = context.activity.from.aadObjectId || context.activity.from.id;
  const name = context.activity.from.name || "User";
  const { wallet, created } = store.ensureWallet(teamsId, name);
  if (created) {
    try {
      await chain.mintWelcome(wallet.address);
      await context.sendActivity(
        `Welcome to RichBucks. Custodial wallet created and welcome pack minted.\n\`${wallet.address}\``
      );
    } catch (e) {
      console.error("welcome mint failed", e);
      await context.sendActivity(
        `Wallet created at \`${wallet.address}\` (welcome mint pending — ask admin).`
      );
    }
  }
  return wallet;
}

function firstMention(context: TurnContext): { id: string; name: string } | undefined {
  const entities = context.activity.entities || [];
  for (const e of entities) {
    if ((e as any).type === "mention") {
      const mentioned = (e as any).mentioned;
      if (mentioned && mentioned.id !== context.activity.recipient.id) {
        return {
          id: mentioned.aadObjectId || mentioned.id,
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
        msg += `\n\nRPC: \`${process.env.PUBLIC_RPC_URL || "ask admin"}\` · chainId **88420** · token \`${process.env.CONTRACT_ADDRESS}\``;
      }
      await context.sendActivity(msg);
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
      } catch (e: any) {
        const msg = String(e?.shortMessage || e?.reason || e?.message || e);
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
      } catch (e: any) {
        await context.sendActivity(`Send failed: ${e?.shortMessage || e?.message || e}`);
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
        await context.sendActivity("For safety, run `/export-wallet` in a **1:1 chat** with the bot.");
        return;
      }
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
                text: "Export private key",
                weight: "Bolder",
                size: "Medium",
              },
              {
                type: "TextBlock",
                text: "Anyone with this key controls your RB. Import into MetaMask carefully.",
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
  console.log(`RichBucks bot listening on ${port}`);
});
