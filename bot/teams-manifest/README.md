# Teams app package

Contents (zip these three files at the **archive root**):

| File | Purpose |
|---|---|
| `manifest.json` | Teams app manifest — set `bots[0].botId` (and `id`) to your Microsoft App ID |
| `color.png` | 192×192 colour icon |
| `outline.png` | 32×32 white outline on transparent background |

## Build

1. Edit `manifest.json`: set `id` to a new random GUID for the package, and set `bots[0].botId` to your Azure **Application (client) ID**.  
2. Package:

```bash
# PowerShell
Compress-Archive -Path manifest.json,color.png,outline.png -DestinationPath RichBucks-teams.zip -Force

# bash
zip -j RichBucks-teams.zip manifest.json color.png outline.png
```

3. Upload in Teams Admin Center (**Manage apps** → **Upload**) or sideload if your org allows it.  
4. Add **RichBucks** to the group chat.

Messaging endpoint (Azure Bot → Configuration): `https://bot.richbucks.xyz/api/messages`

For multiple Entra tenants, create one Azure Bot + one zip per tenant (different `botId`). See [guide.md](../../guide.md) §2.4.
