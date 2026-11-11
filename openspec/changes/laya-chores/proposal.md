# Chores: andy works when nobody has given him a job

## Why
With no job, the director answers `idle` and andy stands still. The user (2026-11-11) wants him to start on useful
work by himself: first get what a player needs on the first day and night (wiki Tutorial:Beginner's guide), then
farm and collect resources around his base, until a player gives him a job or a player is attacked.
The choice of chore is a model's (aim: no decision logic outside the Laya models); the code only measures and acts.

## What changes
- **Home and base centre** (code, a fact): the home when set; else a chest or crafting table a player placed; else one already placed near him
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
- **Player kit** (user, 2026-11-11): the home chest always holds a set of basic tools, a weapon and food for the
  player, at andy's best tier.
- **Interrupts**: any player command stops the chore at once (job stack); a player attacked or a director safety
  activity pauses it; chores resume when the job is done.
- Setting `chores: true` (default on in the local settings) and chat "andy do your chores" / "andy take a break".

## Chore priority spec v1 (source of the training data)
First day (user, 2026-11-11: food, light and an axe early):
1. logs ≥ 4 → crafting table placed in base;
2. wooden axe (tool and first weapon) and wooden pickaxe;
3. if water is in the work area: wooden hoe, seeds from grass, a 16-block farm by the water (renewable food);
4. cobblestone ≥ 14 → stone axe, stone pickaxe, furnace placed;
5. food: hunt to ~half a stack of meat and cook it;
6. light: torches ≥ 16 (coal, else charcoal from logs), light the base (a torch per 12 blocks, ring the base);
7. chest placed (becomes the home chest if none) → wool ×3 and a bed → player kit in the home chest (pickaxe, axe,
   shovel, sword of his best tier, 8 cooked food, 16 torches; upgraded each tier, never taken for his own use);
8. stock to 64 logs and 64 cobblestone, mining whole coal/copper veins seen; stone sword later.
Food and light come back first whenever they run short: fewer than 8 food items → food chore next (after an axe);
fewer than 8 torches or an unlit base with dusk within ~2 minutes → light chore next.
Night: shelter in the base (needs the blueprint model; until then skip) → sleep if a bed is placed, else mine from
the home staircase; never wander the surface at night.
What next: seeds from grass → hoe → wheat farm by water in the work area, lit → tend farms (harvest/replant/unload)
whenever ready → iron: tools, armour, shield → fence and light the work area → animal pens and breeding → better home.
Biome: no trees in the work area → search wider for wood, plant saplings near base; snowy → rabbits for food,
torches beside farm water; desert → sand, cactus, rabbits; island/beach → fish. Always: pick up saplings that fall in the base area and replant them there; replant where a cut tree stood; unload to the home chest
when the pack is nearly full; never throw anything away.

## Out of scope (later changes)
Shelter and pens need the blueprint model; place, smelt/cook and light-area need new actuators (shared with the v3
commands). Until they exist those chores are masked out (logged as impossible, not chosen by a rule).
