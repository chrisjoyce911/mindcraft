#!/bin/zsh
# Starts andy — the NEW bot only (bot/, OpenSpec bot-rebuild). HARD RULE (user, 2026-11-14): all play and all work
# happen in the new bot; the old bot (node main.js, src/) is never started. See CLAUDE.md.
#   ./start-bot.sh                 your LAN world (Open to LAN)
#   PLAY_WORLD=test ./start-bot.sh the local test world
cd "$(dirname "$0")"
export PATH=/opt/homebrew/opt/node@20/bin:$PATH
if [ ! -f bot/dist/src/main.js ]; then
  echo "New bot not built: (cd bot && npm run build)" >&2
  exit 1
fi
exec node tools/play/new-bot.mjs "$@"
