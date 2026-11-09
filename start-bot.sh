#!/bin/zsh
# Starts Mindcraft bots with Node 20.
#   ./start-bot.sh         andy only (full andy-4)
#   ./start-bot.sh micro   andy only (faster andy-4 micro)
#   ./start-bot.sh duo     andy + bob together (full andy-4)
cd "$(dirname "$0")"
export PATH=/opt/homebrew/opt/node@20/bin:$PATH
case "$1" in
  micro) exec node main.js --profiles ./profiles/andy-micro.json ;;
  duo)   exec node main.js --profiles ./andy.json ./profiles/bob.json ;;
  *)     exec node main.js --profiles ./andy.json ;;
esac
