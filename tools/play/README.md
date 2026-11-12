# Play the new bot

`tools/play/new-bot.mjs` starts the new bot (`bot/dist`) with your own `settings.js` (from `~/lnkz/mindcraft`, or
`PLAY_SETTINGS_DIR`), for playing with andy yourself.

```sh
cd bot && npm run build && cd ..
node tools/play/new-bot.mjs                  # your LAN world (Open to LAN; port -1 is looked up)
PLAY_WORLD=test node tools/play/new-bot.mjs  # the local test world 127.0.0.1:25566
```

Use node 20 (`/opt/homebrew/opt/node@20/bin/node`). Ctrl+C stops andy. The test world is one slot shared by the
board's runs: take it through `"$BOARD_HEAVY"` (or make sure no test run is using it) before `PLAY_WORLD=test`.

## Chores at the start

- andy starts with chores **on** unless your settings say `chores: false`.
- The test harness turns chores off after each world reset (`bots/andy/laya-chores.json` with `"by":"test-harness"`).
  Only the harness's own launch (`tools/test-world/lib/bot.js` sets `ANDY_TEST_HARNESS=1`) heeds that, so a play
  session after a test run still starts with chores on.
- A player's "take a break" (`!layaChores("off")` or the chat command) is remembered across restarts, as before.

## Talking to andy

Open chat and whispers both work: `/msg andy come here` (or `/tell`) is answered by whisper.
