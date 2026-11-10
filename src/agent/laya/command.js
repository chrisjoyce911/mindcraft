// Player chat to bot commands with a Laya decision model (the "command" task).
//
// For each player message the bot asks the command model (laya-go's command
// game) Addressed, Command, Item, Tier and Count, then plan() turns the answer
// into Mindcraft command lines (!followPlayer, !layaCraft, !givePlayer, …),
// a short reply, "hand to the LLM" or "ignore". The bot runs the lines with
// its ordinary command system, so a command does exactly what the LLM's
// command would. Chat, unsure answers and failures go to the LLM as before;
// with no_llm set they get a short canned reply instead.

import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { state, questionsFor, resolve, carried, FOODS, NONE } from './command_state.js';

export const DEFAULTS = {
    min_confidence: 0.6,   // Command's top probability to act on it
    addressed_min: 0.5,    // below this the message may not be for me: the LLM decides
    ignore_below: 0.15,    // below this it's for someone else: ignored
    follow_distance: 3,
    come_distance: 2,
    gather_count: 8,       // counts when the message says none
    mine_count: 4,
    craft_count: 1,
    farm_max: 640,         // the most a farm count asks for
    prompt: 'v1',          // v2: the farm command and crops (a command v2 model)
    no_llm: false,         // true: reply with a canned line instead of asking the LLM
    log_decisions: true,
};

export const CANNED = "Sorry, I only understand simple commands, like: follow me, come here, stop, mine 8 iron, " +
    "get 16 logs, craft a stone pickaxe, farm wheat, give me your coal, store everything, this is your chest.";

// Ore and generic names the plain fallbacks (no Laya craft or mine commands)
// need as blocks or recipes.
const ORE_BLOCK = { raw_iron: 'iron_ore', coal: 'coal_ore', diamond: 'diamond_ore', raw_gold: 'gold_ore', raw_copper: 'copper_ore',
    redstone: 'redstone_ore', lapis_lazuli: 'lapis_ore', emerald: 'emerald_ore', cobblestone: 'stone', log: 'oak_log', planks: 'oak_planks' };

// MINE_ORE: the ore !layaMine takes for the item mine gets (laya-go's
// gather item); other items aren't ores and go to the gather fallbacks.
const MINE_ORE = { coal: 'coal', raw_copper: 'copper', raw_iron: 'iron', lapis_lazuli: 'lapis', raw_gold: 'gold', redstone: 'redstone', diamond: 'diamond' };

// Foods eaten when "eat" names none, best first; bad foods aren't chosen.
const GOOD_FOODS = ['golden_carrot', 'cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_salmon', 'baked_potato', 'bread',
    'cooked_chicken', 'cooked_cod', 'pumpkin_pie', 'mushroom_stew', 'carrot', 'apple', 'beetroot', 'melon_slice', 'sweet_berries', 'cookie', 'dried_kelp', 'potato'];

// Items "store everything" keeps: tools, weapons, armour, food.
const keep = n => /_(pickaxe|axe|sword|shovel|hoe|helmet|chestplate|leggings|boots)$/.test(n) || n === 'shield' || FOODS.includes(n);

const q = s => JSON.stringify(String(s));

// openEnded: a count that means "keep going" (none said).
const openEnded = count => count === 'any' || count === 'all';

function countOf(answer, fallback) {
    const n = parseInt(answer, 10);
    return Number.isFinite(n) ? n : fallback;
}

// plan turns a decide() result into what to do:
//   {kind: 'run', lines: [...], say}  run these command lines in order
//                                    (confirm {when, say}: say that instead
//                                    of a result matching when)
//   {kind: 'reply', text}             answer without a command
//   {kind: 'llm', reason}             let the LLM handle the message
//   {kind: 'ignore'}                  the message is for someone else
// ctx: speaker, carry ([{item, count}]), has(name) → command exists,
// nearestHostile() → mob name or null, arity(name) → {min, max} arguments
// of a command (so an optional count can be left off), opts (DEFAULTS merged
// with settings).
export function plan(r, ctx) {
    const o = { ...DEFAULTS, ...(ctx.opts || {}) };
    if (!r) return { kind: 'llm', reason: 'no-answer' };
    const a = r.answers;
    const addressed = a.Addressed.probability;
    if (addressed < o.ignore_below) return { kind: 'ignore' };
    if (addressed < o.addressed_min) return { kind: 'llm', reason: 'not-sure-addressed' };
    const command = a.Command.top;
    if (command === 'chat') return { kind: 'llm', reason: 'chat' };
    if (a.Command.topProbability < o.min_confidence) return { kind: 'llm', reason: 'low-confidence' };
    const key = a.Item.top, tier = a.Tier.top, count = a.Count.top;
    const carry = ctx.carry || [];
    const item = resolve(command, key, tier, carry);
    const has = ctx.has || (() => false);
    const held = name => carry.filter(s => s.item === name).reduce((n, s) => n + s.count, 0);
    const run = (lines, say) => ({ kind: 'run', lines, say });

    switch (command) {
        case 'follow':
            return run([`!followPlayer(${q(ctx.speaker)}, ${o.follow_distance})`], 'Following you.');
        case 'come':
            return run([`!goToPlayer(${q(ctx.speaker)}, ${o.come_distance})`], 'On my way.');
        case 'stop':
            return run(['!stop']);
        case 'stay':
            return run(['!stay(-1)'], "I'll stay here.");
        case 'inventory':
            return run(['!inventory']);
        case 'gather': {
            if (item === NONE) return { kind: 'reply', text: 'What should I gather?' };
            const n = Math.min(64, countOf(count, o.gather_count));
            if (has('!layaGather')) return run([`!layaGather(${q(item)}, ${n})`], `Getting ${n} ${item}.`);
            return run([`!collectBlocks(${q(ORE_BLOCK[item] || item)}, ${n})`], `Getting ${n} ${item}.`);
        }
        case 'mine': {
            if (item === NONE) return { kind: 'reply', text: 'What should I mine for? Iron, coal, diamonds…' };
            const ore = MINE_ORE[item], mine = ore && has('!layaMine');
            // "mine some iron": until stopped, when !layaMine takes a lone ore
            if (mine && openEnded(count) && (ctx.arity?.('!layaMine')?.min ?? 2) <= 1)
                return run([`!layaMine(${q(ore)})`], `Mining ${ore} until you say stop.`);
            const n = Math.min(64, countOf(count, o.mine_count));
            if (mine) return run([`!layaMine(${q(ore)}, ${n})`], `Mining for ${n} ${item}.`);
            if (has('!layaGather')) return run([`!layaGather(${q(item)}, ${n})`], `Mining for ${n} ${item}.`);
            return run([`!collectBlocks(${q(ORE_BLOCK[item] || item)}, ${n})`], `Mining for ${n} ${item}.`);
        }
        case 'farm': {
            if (!has('!layaFarm')) return { kind: 'llm', reason: 'no-farm-command' };
            const crop = item !== NONE ? item : 'any';
            const what = crop === 'any' ? 'crops' : crop;
            if (openEnded(count)) return run([`!layaFarm(${q(crop)})`], `Farming ${what} until you say stop.`);
            const n = Math.min(o.farm_max, countOf(count, o.farm_max));
            return run([`!layaFarm(${q(crop)}, ${n})`], `Farming until I've harvested ${n} ${what}.`);
        }
        case 'home': // "this is your chest": the chest by the speaker
            if (!has('!setHomeChest')) return { kind: 'llm', reason: 'no-home-command' };
            return { kind: 'run', lines: ['!setHomeChest'], confirm: { when: /^Home chest set/, say: "That's my chest now." } };
        case 'craft': {
            if (item === NONE) return { kind: 'reply', text: "I don't know how to make that." };
            const n = Math.min(64, countOf(count, o.craft_count));
            if (has('!layaCraft')) return run([`!layaCraft(${q(item)}, ${n})`], `Making ${n} ${item}.`);
            return run([`!craftRecipe(${q(ORE_BLOCK[item] || item)}, ${n})`], `Making ${item}.`);
        }
        case 'give': {
            if (key === NONE) {
                if (count !== 'all' || !carry.length) return { kind: 'reply', text: carry.length ? 'What should I give you?' : "I don't have anything." };
                return run(carry.map(s => `!givePlayer(${q(ctx.speaker)}, ${q(s.item)}, ${s.count})`), 'Here, take everything.');
            }
            if (item === NONE) return { kind: 'reply', text: `I don't have any ${key}.` };
            const have = held(item);
            const n = count === 'all' || count === 'any' ? have : Math.min(have, countOf(count, have));
            const say = n < countOf(count, n) ? `I only have ${have} ${item}.` : `Here you go.`;
            return run([`!givePlayer(${q(ctx.speaker)}, ${q(item)}, ${n})`], say);
        }
        case 'attack': {
            const mob = item !== NONE ? item : ctx.nearestHostile?.();
            if (!mob) return { kind: 'reply', text: "I don't see anything to fight." };
            return run([`!attack(${q(mob)})`], `Attacking the ${mob.replace(/_/g, ' ')}!`);
        }
        case 'store': {
            if (key === NONE) {
                const stacks = carry.filter(s => !keep(s.item));
                if (!stacks.length) return { kind: 'reply', text: 'Nothing to store.' };
                return run(stacks.map(s => `!putInChest(${q(s.item)}, ${s.count})`), 'Putting my things in the chest.');
            }
            if (item === NONE) return { kind: 'reply', text: `I don't have any ${key}.` };
            const have = held(item);
            const n = count === 'all' || count === 'any' ? have : Math.min(have, countOf(count, have));
            return run([`!putInChest(${q(item)}, ${n})`], `Storing ${n} ${item}.`);
        }
        case 'eat': {
            const food = item !== NONE ? item : GOOD_FOODS.find(f => held(f) > 0);
            if (!food) return { kind: 'reply', text: key !== NONE ? `I don't have any ${key}.` : "I don't have any food." };
            return run([`!consume(${q(food)})`]);
        }
    }
    return { kind: 'llm', reason: 'unknown-command' };
}

// logDecision appends one decision to the bot's log file; never throws.
export function logDecision(path, entry) {
    if (!path) return;
    try {
        mkdirSync(dirname(path), { recursive: true });
        appendFileSync(path, JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n');
    } catch { /* logging never stops the bot */ }
}

// handleCommand decides one player message. deps:
//   client {decide}, task (settings), bot ({username, inventory}), speaker,
//   has(name), arity(name), nearestHostile(), execute(line) → result text, say(text),
//   logPath.
// It returns true when the message was handled (the LLM isn't asked).
export async function handleCommand(message, deps) {
    const o = { ...DEFAULTS, ...(deps.task || {}) };
    const text = state(deps.bot.username, deps.speaker, message);
    if (!text) return false;
    const r = await deps.client.decide('command', text, questionsFor(o.prompt));
    const carry = carried(deps.bot);
    const p = plan(r, { speaker: deps.speaker, carry, has: deps.has, arity: deps.arity, nearestHostile: deps.nearestHostile, opts: o });
    const entry = { state: text, kind: p.kind, reason: p.reason, lines: p.lines, ms: r?.ms };
    if (r) {
        const a = r.answers;
        Object.assign(entry, { addressed: +a.Addressed.probability.toFixed(3), command: a.Command.top, p: +a.Command.topProbability.toFixed(3),
            item: a.Item.top, tier: a.Tier.top, count: a.Count.top });
    }
    if (o.log_decisions) logDecision(deps.logPath, entry);
    switch (p.kind) {
        case 'ignore':
            return true;
        case 'reply':
            deps.say(p.text);
            return true;
        case 'run':
            if (p.say) deps.say(p.say);
            for (const line of p.lines) {
                const res = await deps.execute(line);
                // confirm: a short reply instead of the command's own when it worked
                if (res && p.confirm?.when.test(res)) deps.say(p.confirm.say);
                else if (res) deps.say(res);
            }
            return true;
    }
    if (o.no_llm) {
        deps.say(CANNED);
        return true;
    }
    return false;
}
