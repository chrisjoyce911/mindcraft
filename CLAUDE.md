# mindcraft (andy)

## HARD RULE: new bot only

All gameplay and all development happen in the **new bot**: the TypeScript bot in `bot/` (OpenSpec change
`bot-rebuild`). This was set by the user on 2026-11-14 and can't be altered.

- **Play:** start andy only with `./start-bot.sh` (which runs `tools/play/new-bot.mjs`) or `tools/play/new-bot.mjs`
  directly. Never run `node main.js`, the old `start-bot.sh` behaviour, or anything that starts the old bot in `src/`.
- **Work:** every fix and feature goes in `bot/`, with its OpenSpec change. Don't edit, fix or ship old-bot code in
  `src/agent/`, even to fix a problem seen in play: fix it in the new bot.
- **Test-world tools:** use `ANDY_BOT=new` (`tools/test-world/bot.js`).
- The old bot is deleted in bot-rebuild phase 7. Until then, treat `src/` as read-only reference.
