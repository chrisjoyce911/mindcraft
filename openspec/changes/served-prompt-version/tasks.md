# Tasks

- [x] laya.js: served prompt cache (/v1/models, decision header), taskSettings prompt getter with the settings fallback, primeServedPrompts
- [x] prime when the client loads (no agent.js change)
- [x] laya_check: sample and report by served prompt version
- [x] Tests: served version used, header updates it, fallback, director follows a swap
- [x] npm test (332 pass)
- [x] Live check against golaya serve (director v1.2 in place, settings v1): the v1.2 text with the Player line, model answered defend-player p=1.00
- [ ] Game check on the test world (it was in use by the chores2 tab's andy on 2026-11-11 16:05)
