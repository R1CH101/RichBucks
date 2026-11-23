# Teams app package

1. Replace `bots[0].botId` in `manifest.json` with your Microsoft App ID.
2. Add `color.png` (192×192) and `outline.png` (32×32).
3. Zip `manifest.json` + icons (files at zip root).
4. Upload in Teams Admin / Apps → Manage apps → Upload custom app.
5. Add the bot to your main group chat.

Bot endpoint: `https://<your-bot-host>/api/messages`
