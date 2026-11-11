# Chores: andy works when nobody has given him a job

## Why
With no job, the director answers `idle` and andy stands still. The user (2026-11-11) wants him to start on useful
work by himself: first get what a player needs on the first day and night (wiki Tutorial:Beginner's guide), then
farm and collect resources around his base, until a player gives him a job or a player is attacked.
The choice of chore is a model's (aim: no decision logic outside the Laya models); the code only measures and acts.

## What changes
- **Home and base centre** (code, a fact): the home when set; else a chest or crafting table already placed near him
  (it becomes the home); else the player's position when suitable; else his own position. The first chest or table
  he places becomes the home. The home is kept on disk until a player sets another.
- **Base area**: 21×21 around the centre. **Work area**: 49×49 around the centre — any farm in it is tended and
  resources in it are collected. When the work area has none of a needed resource, the search grows (97×97, then
  193×193) for that resource only, and shrinks back afterwards.
- **Chores sensor** (code): one state text for the new `chores` model — what is placed in the base area (crafting
  table, furnace, chest, bed, shelter, light), what andy carries (tool tiers, logs, cobblestone, coal, torches, food,
  wool, seeds), farms in the work area and how ready they are, nearby resources (trees, stone, coal, sand, water,
  grass, animals by kind) and at what search size, biome, time of day, recent chore failures.
- **Chores model** (laya-go, new game `chores`): state → the next chore. Training data comes from a written priority
  spec (below, from the wiki); the spec is the rules fallback only until the model is served, as with the director.
- **Director v1.2**: new state line `Player <name> attacked <yes/no> by <mob> <dist>`; a player within 24 blocks being
  attacked → `defend` (andy goes to the player and fights the attacker), above everything except his own flee/eat
  emergencies. `idle` now means "do chores" when chores are on.
- **Interrupts**: any player command stops the chore at once (job stack); a player attacked or a director safety
  activity pauses it; chores resume when the job is done.
- Setting `chores: true` (default on in the local settings) and chat "andy do your chores" / "andy take a break".

## Chore priority spec v1 (source of the training data)
First day: logs ≥ 4 → crafting table placed in base → wooden pickaxe (+ axe) → cobblestone ≥ 14 → stone pickaxe,
stone sword/axe, furnace placed → food: hunt to ~half a stack of meat, cook it → wool ×3 (sheep) → bed placed →
chest placed (becomes the home chest if none) → stock to 64 logs and 64 cobblestone, mining whole coal/copper veins seen.
First night (before dusk): torches ≥ 16 (coal, else charcoal from logs) → light the base (one torch per 12 blocks,
ring the base) → shelter in the base (needs the blueprint model; until then skip) → at night: sleep if a bed is placed,
else mine from the home staircase; never wander the surface at night.
What next: seeds from grass → hoe → wheat farm by water in the work area, lit → tend farms (harvest/replant/unload)
whenever ready → iron: tools, armour, shield → fence and light the work area → animal pens and breeding → better home.
Biome: no trees in the work area → search wider for wood, plant saplings near base; snowy → rabbits for food,
torches beside farm water; desert → sand, cactus, rabbits; island/beach → fish. Always: unload to the home chest
when the pack is nearly full; never throw anything away.

## Out of scope (later changes)
Shelter and pens need the blueprint model; place, smelt/cook and light-area need new actuators (shared with the v3
commands). Until they exist those chores are masked out (logged as impossible, not chosen by a rule).
