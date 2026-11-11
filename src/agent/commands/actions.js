import * as skills from '../library/skills.js';
import settings from '../settings.js';
import { parseGoal as parseFarmGoal } from '../laya/farm.js';
import { nearestChestTo } from '../laya/pack_actions.js';
import { isHomeName } from '../laya/home_chest.js';
import { jobFailedMessage } from '../laya/job_message.js';
import { parseOnOff } from '../laya/chores.js';

// homeChestAdopter lets a Laya task save a chest marked by a sign with the
// bot's name as the home chest (when none is saved), telling the player.
function homeChestAdopter(agent) {
    return {
        remember: c => agent.memory_bank.rememberPlace('home_chest', c.x, c.y, c.z),
        say: msg => agent.openChat(msg),
    };
}
import convoManager from '../conversation.js';


function runAsAction (actionFn, resume = false, timeout = -1) {
    let actionLabel = null;  // Will be set on first use
    
    const wrappedAction = async function (agent, ...args) {
        // Set actionLabel only once, when the action is first created
        if (!actionLabel) {
            const actionObj = actionsList.find(a => a.perform === wrappedAction);
            actionLabel = actionObj.name.substring(1); // Remove the ! prefix
        }

        const actionFnWithAgent = async () => {
            await actionFn(agent, ...args);
        };
        const code_return = await agent.actions.runAction(`action:${actionLabel}`, actionFnWithAgent, { timeout, resume });
        if (code_return.interrupted && !code_return.timedout)
            return;
        return code_return.message;
    }

    return wrappedAction;
}

// runLayaAction runs a Laya skill as a job on the director's job stack
// (laya/director.js): when a mode (a fight, eating, unstuck) interrupts it,
// the director resumes it once the mode is done. start(agent, ...args) is
// called once per command and returns the work (work.remaining(), optional:
// how many are left), so goals fixed at the command (have N more logs)
// aren't counted again on resume. The job ends when the work finishes by
// itself (or fails), or a player's new command or !stop replaces it.
function runLayaAction(label, start, timeout = -1) {
    return async function (agent, ...args) {
        const work = start(agent, ...args);
        const job = agent.director.stack.start(label, args, { work, remaining: work.remaining, timeout });
        return await runJob(agent, job);
    };
}

// runJob runs (or resumes) a job from the stack as the agent's action.
export async function runJob(agent, job) {
    const stack = agent.director.stack;
    stack.resumed(job);
    let result;
    const r = await agent.actions.runAction(`action:${job.name}`, async () => { result = await job.work(); }, { timeout: job.timeout ?? -1 });
    if (stack.has(job)) {
        if (r.interrupted && !r.timedout) stack.paused(job);
        else {
            const how = !r.success ? 'blocked' : (result === false || result?.ok === false) ? 'failed' : 'done';
            stack.ended(job, how);
            // a chore reports its end to the chores runner (a failed chore
            // goes in Failed, quietly); a job that ends without doing it
            // says why (a resumed job's output reaches no one else)
            if (job.onEnd) job.onEnd(how, result, r);
            else if (how !== 'done') agent.openChat(jobFailedMessage(job, result, r));
        }
    }
    agent.director.tick('job-ended').catch(() => {});
    if (r.interrupted && !r.timedout) return;
    return r.message;
}

export const actionsList = [
    {
        name: '!newAction',
        description: 'Perform new and unknown custom behaviors that are not available as a command.', 
        params: {
            'prompt': { type: 'string', description: 'A natural language prompt to guide code generation. Make a detailed step-by-step plan.' }
        },
        perform: async function(agent, prompt) {
            // just ignore prompt - it is now in context in chat history
            if (!settings.allow_insecure_coding) { 
                agent.openChat('newAction is disabled. Enable with allow_insecure_coding=true in settings.js');
                return "newAction not allowed! Code writing is disabled in settings. Notify the user.";
            }
            let result = "";
            const actionFn = async () => {
                try {
                    result = await agent.coder.generateCode(agent.history);
                } catch (e) {
                    result = 'Error generating code: ' + e.toString();
                }
            };
            await agent.actions.runAction('action:newAction', actionFn, {timeout: settings.code_timeout_mins});
            return result;
        }
    },
    {
        name: '!stop',
        description: 'Force stop all actions and commands that are currently executing.',
        perform: async function (agent) {
            agent.director?.stack.clear(); // no Laya job resumes
            await agent.actions.stop();
            agent.clearBotLogs();
            agent.actions.cancelResume();
            agent.bot.emit('idle');
            let msg = 'Agent stopped.';
            if (agent.self_prompter.isActive())
                msg += ' Self-prompting still active.';
            return msg;
        }
    },
    {
        name: '!stfu',
        description: 'Stop all chatting and self prompting, but continue current action.',
        perform: async function (agent) {
            agent.openChat('Shutting up.');
            agent.shutUp();
            return;
        }
    },
    {
        name: '!restart',
        description: 'Restart the agent process.',
        perform: async function (agent) {
            agent.cleanKill();
        }
    },
    {
        name: '!clearChat',
        description: 'Clear the chat history.',
        perform: async function (agent) {
            agent.history.clear();
            return agent.name + "'s chat history was cleared, starting new conversation from scratch.";
        }
    },
    {
        name: '!goToPlayer',
        description: 'Go to the given player.',
        params: {
            'player_name': {type: 'string', description: 'The name of the player to go to.'},
            'closeness': {type: 'float', description: 'How close to get to the player.', domain: [0, Infinity]}
        },
        perform: runAsAction(async (agent, player_name, closeness) => {
            await skills.goToPlayer(agent.bot, player_name, closeness);
        })
    },
    {
        name: '!followPlayer',
        description: 'Endlessly follow the given player.',
        params: {
            'player_name': {type: 'string', description: 'name of the player to follow.'},
            'follow_dist': {type: 'float', description: 'The distance to follow from.', domain: [0, Infinity]}
        },
        perform: runAsAction(async (agent, player_name, follow_dist) => {
            await skills.followPlayer(agent.bot, player_name, follow_dist);
        }, true)
    },
    {
        name: '!layaMine',
        description: 'Mine underground until you have the given number of an ore (coal, copper, iron, lapis, gold, redstone or diamond): a staircase down to its height and a branch mine there, placing torches, blocking lava, crafting the pickaxe and torches it needs, and emptying a full pack into the home chest (the remembered place "home_chest").',
        params: {
            'ore': {type: 'string', description: 'The ore: coal, copper, iron, lapis, gold, redstone or diamond.'},
            'count': {type: 'int', description: 'How many of the ore to collect.', domain: [1, 64]}
        },
        // progress.done (the drop collected so far) is kept across resumes
        // after a fight, so a resumed job mines only what is left.
        perform: runLayaAction('layaMine', (agent, ore, count) => {
            const progress = { done: 0 };
            const work = () => skills.mineOre(agent.bot, ore, Math.max(1, count - progress.done),
                () => agent.homeChest(), progress);
            work.remaining = () => count - progress.done;
            return work;
        })
    },
    {
        name: '!hunt',
        description: 'Hunt an animal or mob until you have the given number more of its drop (e.g. cow for beef or leather, pig for porkchop, sheep for mutton or wool, chicken for chicken, feather or egg, spider for string), picking up the drops.',
        params: {
            'mob': { type: 'string', description: 'The mob to hunt, e.g. cow.' },
            'item': { type: 'string', description: 'The drop to collect, e.g. beef.' },
            'count': { type: 'int', description: 'How many more of the drop to have.', domain: [1, 64] },
        },
        // the target is fixed at the command, so a resumed hunt doesn't add more
        perform: runLayaAction('hunt', (agent, mob, item, count) => {
            const target = (skills.inventoryCount?.(agent.bot, item) ?? 0) + count;
            const work = () => skills.huntForDrop(agent.bot, mob, item, count, target);
            work.remaining = () => target - (skills.inventoryCount?.(agent.bot, item) ?? 0);
            return work;
        })
    },
    {
        name: '!layaFarm',
        description: 'Farm nearby with the Laya farm model: harvest ripe crops, replant, till, water, bone meal and breed animals, making a hoe, seeds or a water bucket when needed and emptying a full pack into the home chest (the remembered place "home_chest"). With a count it stops once that many of the crop are harvested; without one it farms until stopped. A lone number is minutes to farm (old form).',
        params: {
            'crop': {type: 'string', optional: true, description: 'The crop: wheat, carrots, potatoes, beetroot or any (default any).'},
            'count': {type: 'string', optional: true, description: 'How many of the crop to harvest, or "any" to farm until stopped (default).'}
        },
        perform: async function (agent, crop, count) {
            const goal = parseFarmGoal(crop, count);
            if (goal.error) return goal.error;
            const end = goal.minutes == null ? null : Date.now() + goal.minutes * 60000;
            const progress = { harvested: 0 }; // kept across resumes after a fight
            return runLayaAction('layaFarm', () => {
                const work = () => skills.farmWithLayaModel(agent.bot,
                    { crop: goal.crop, count: goal.count, progress, minutes: end == null ? null : Math.max(0.1, (end - Date.now()) / 60000) },
                    () => agent.homeChest(), homeChestAdopter(agent));
                if (goal.count != null) work.remaining = () => goal.count - progress.harvested;
                return work;
            })(agent, goal.crop, goal.count ?? 'any');
        }
    },
    {
        name: '!goToCoordinates',
        description: 'Go to the given x, y, z location.',
        params: {
            'x': {type: 'float', description: 'The x coordinate.', domain: [-Infinity, Infinity]},
            'y': {type: 'float', description: 'The y coordinate.', domain: [-64, 320]},
            'z': {type: 'float', description: 'The z coordinate.', domain: [-Infinity, Infinity]},
            'closeness': {type: 'float', description: 'How close to get to the location.', domain: [0, Infinity]}
        },
        perform: runAsAction(async (agent, x, y, z, closeness) => {
            await skills.goToPosition(agent.bot, x, y, z, closeness);
        })
    },
    {
        name: '!searchForBlock',
        description: 'Find and go to the nearest block of a given type in a given range.',
        params: {
            'type': { type: 'BlockName', description: 'The block type to go to.' },
            'search_range': { type: 'float', description: 'The range to search for the block. Minimum 32.', domain: [10, 512] }
        },
        perform: runAsAction(async (agent, block_type, range) => {
            if (range < 32) {
                log(agent.bot, `Minimum search range is 32.`);
                range = 32;
            }
            await skills.goToNearestBlock(agent.bot, block_type, 4, range);
        })
    },
    {
        name: '!searchForEntity',
        description: 'Find and go to the nearest entity of a given type in a given range.',
        params: {
            'type': { type: 'string', description: 'The type of entity to go to.' },
            'search_range': { type: 'float', description: 'The range to search for the entity.', domain: [32, 512] }
        },
        perform: runAsAction(async (agent, entity_type, range) => {
            await skills.goToNearestEntity(agent.bot, entity_type, 4, range);
        })
    },
    {
        name: '!moveAway',
        description: 'Move away from the current location in any direction by a given distance.',
        params: {'distance': { type: 'float', description: 'The distance to move away.', domain: [0, Infinity] }},
        perform: runAsAction(async (agent, distance) => {
            await skills.moveAway(agent.bot, distance);
        })
    },
    {
        name: '!layaChores',
        description: 'Turn chores on or off: with chores on, when nobody has given you a job you work by yourself (wood, tools, a farm, food, torches, a chest, beds, a kit for the player). Saved across restarts.',
        params: { 'state': { type: 'string', description: 'on or off.' } },
        perform: async function (agent, state) {
            const on = parseOnOff(state);
            if (on == null) return 'Say on or off.';
            agent.setChores(on);
            if (on) setTimeout(() => agent.director.tick('chores-on').catch(() => {}), 200);
            return on ? "Okay, I'll do my chores when nobody needs me." : "Okay, I'm taking a break from chores.";
        }
    },
    {
        name: '!setHomeChest',
        description: 'Make the chest next to the player who spoke last (or next to you) your home chest, where Laya mining and farming empty a full pack.',
        perform: async function (agent) {
            const speaker = agent.last_speaker && agent.bot.players?.[agent.last_speaker]?.entity;
            const at = (speaker || agent.bot.entity).position;
            const c = nearestChestTo(agent.bot, at);
            if (!c) return "I can't see a chest near you.";
            agent.memory_bank.rememberPlace('home_chest', c.x, c.y, c.z);
            // a player set the home: it replaces a table home and the chores centre
            agent.memory_bank.forgetPlace('home_table');
            agent.memory_bank.forgetPlace('chores_centre');
            return `Home chest set at ${c.x} ${c.y} ${c.z}.`;
        }
    },
    {
        name: '!rememberHere',
        description: 'Save the current location with a given name.',
        params: {'name': { type: 'string', description: 'The name to remember the location as.' }},
        perform: async function (agent, name) {
            const pos = agent.bot.entity.position;
            if (isHomeName(name)) {
                // the home chest is only ever a chest: the one nearest me
                const c = nearestChestTo(agent.bot, pos);
                if (!c) return "There's no chest here, so I can't make it my home chest. Stand by a chest and use !setHomeChest.";
                agent.memory_bank.rememberPlace('home_chest', c.x, c.y, c.z);
                return `Home chest set at ${c.x} ${c.y} ${c.z}.`;
            }
            agent.memory_bank.rememberPlace(name, pos.x, pos.y, pos.z);
            return `Location saved as "${name}".`;
        }
    },
    {
        name: '!goToRememberedPlace',
        description: 'Go to a saved location.',
        params: {'name': { type: 'string', description: 'The name of the location to go to.' }},
        perform: runAsAction(async (agent, name) => {
            const pos = agent.memory_bank.recallPlace(name);
            if (!pos) {
            skills.log(agent.bot, `No location named "${name}" saved.`);
            return;
            }
            await skills.goToPosition(agent.bot, pos[0], pos[1], pos[2], 1);
        })
    },
    {
        name: '!givePlayer',
        description: 'Give the specified item to the given player.',
        params: { 
            'player_name': { type: 'string', description: 'The name of the player to give the item to.' }, 
            'item_name': { type: 'ItemName', description: 'The name of the item to give.' },
            'num': { type: 'int', description: 'The number of items to give.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, player_name, item_name, num) => {
            await skills.giveToPlayer(agent.bot, item_name, player_name, num);
        })
    },
    {
        name: '!consume',
        description: 'Eat/drink the given item.',
        params: {'item_name': { type: 'ItemName', description: 'The name of the item to consume.' }},
        perform: runAsAction(async (agent, item_name) => {
            await skills.consume(agent.bot, item_name);
        })
    },
    {
        name: '!equip',
        description: 'Equip the given item.',
        params: {'item_name': { type: 'ItemName', description: 'The name of the item to equip.' }},
        perform: runAsAction(async (agent, item_name) => {
            await skills.equip(agent.bot, item_name);
        })
    },
    {
        name: '!putInChest',
        description: 'Put the given item in the nearest chest.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to put in the chest.' },
            'num': { type: 'int', description: 'The number of items to put in the chest.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            await skills.putInChest(agent.bot, item_name, num);
        })
    },
    {
        name: '!takeFromChest',
        description: 'Take the given items from the nearest chest.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to take.' },
            'num': { type: 'int', description: 'The number of items to take.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            await skills.takeFromChest(agent.bot, item_name, num);
        })
    },
    {
        name: '!viewChest',
        description: 'View the items/counts of the nearest chest.',
        params: { },
        perform: runAsAction(async (agent) => {
            await skills.viewChest(agent.bot);
        })
    },
    {
        name: '!discard',
        description: 'Discard the given item from the inventory.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the item to discard.' },
            'num': { type: 'int', description: 'The number of items to discard.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            const start_loc = agent.bot.entity.position;
            await skills.moveAway(agent.bot, 5);
            await skills.discard(agent.bot, item_name, num);
            await skills.goToPosition(agent.bot, start_loc.x, start_loc.y, start_loc.z, 0);
        })
    },
    {
        name: '!collectBlocks',
        description: 'Collect the nearest blocks of a given type.',
        params: {
            'type': { type: 'BlockName', description: 'The block type to collect.' },
            'num': { type: 'int', description: 'The number of blocks to collect.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, type, num) => {
            await skills.collectBlock(agent.bot, type, num);
        }, false, 10) // 10 minute timeout
    },
    {
        name: '!layaCraft',
        description: 'Make an item from scratch with the Laya craft model: it gathers, smelts, places stations and crafts every step needed, storing junk in a chest when the inventory is full.',
        params: {
            'item_name': { type: 'string', description: 'The item to make, e.g. iron_pickaxe, torch, chest, bread.' },
            'num': { type: 'int', description: 'How many items to have made.', domain: [1, 64] }
        },
        perform: runLayaAction('layaCraft', (agent, item_name, num) => {
            const target = skills.layaTarget(agent.bot, item_name, num);
            return () => skills.layaMake(agent.bot, item_name, num, target);
        }, 20)
    },
    {
        name: '!layaGather',
        description: 'Gather resources with the Laya craft model, making any tool needed first (e.g. a stone pickaxe for iron), storing junk in a chest when full.',
        params: {
            'item_name': { type: 'string', description: 'What to gather: log, cobblestone, coal, raw_iron (iron ore), diamond, sand, wheat, wheat_seeds.' },
            'num': { type: 'int', description: 'How many to gather.', domain: [1, 64] }
        },
        perform: runLayaAction('layaGather', (agent, item_name, num) => {
            const target = skills.layaTarget(agent.bot, item_name, num);
            return () => skills.layaMake(agent.bot, item_name, num, target);
        }, 20)
    },
    {
        name: '!craftRecipe',
        description: 'Craft the given recipe a given number of times.',
        params: {
            'recipe_name': { type: 'ItemName', description: 'The name of the output item to craft.' },
            'num': { type: 'int', description: 'The number of times to craft the recipe. This is NOT the number of output items, as it may craft many more items depending on the recipe.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, recipe_name, num) => {
            await skills.craftRecipe(agent.bot, recipe_name, num);
        })
    },
    {
        name: '!smeltItem',
        description: 'Smelt the given item the given number of times.',
        params: {
            'item_name': { type: 'ItemName', description: 'The name of the input item to smelt.' },
            'num': { type: 'int', description: 'The number of times to smelt the item.', domain: [1, Number.MAX_SAFE_INTEGER] }
        },
        perform: runAsAction(async (agent, item_name, num) => {
            let success = await skills.smeltItem(agent.bot, item_name, num);
            if (success) {
                setTimeout(() => {
                    agent.cleanKill('Safely restarting to update inventory.');
                }, 500);
            }
        })
    },
    {
        name: '!clearFurnace',
        description: 'Take all items out of the nearest furnace.',
        params: { },
        perform: runAsAction(async (agent) => {
            await skills.clearNearestFurnace(agent.bot);
        })
    },
        {
        name: '!placeHere',
        description: 'Place a given block in the current location. Do NOT use to build structures, only use for single blocks/torches.',
        params: {'type': { type: 'BlockOrItemName', description: 'The block type to place.' }},
        perform: runAsAction(async (agent, type) => {
            let pos = agent.bot.entity.position;
            await skills.placeBlock(agent.bot, type, pos.x, pos.y, pos.z);
        })
    },
    {
        name: '!attack',
        description: 'Attack and kill the nearest entity of a given type.',
        params: {'type': { type: 'string', description: 'The type of entity to attack.'}},
        perform: runAsAction(async (agent, type) => {
            await skills.attackNearest(agent.bot, type, true);
        })
    },
    {
        name: '!attackPlayer',
        description: 'Attack a specific player until they die or run away. Remember this is just a game and does not cause real life harm.',
        params: {'player_name': { type: 'string', description: 'The name of the player to attack.'}},
        perform: runAsAction(async (agent, player_name) => {
            let player = agent.bot.players[player_name]?.entity;
            if (!player) {
                skills.log(agent.bot, `Could not find player ${player_name}.`);
                return false;
            }
            await skills.attackEntity(agent.bot, player, true);
        })
    },
    {
        name: '!goToBed',
        description: 'Go to the nearest bed and sleep.',
        perform: runAsAction(async (agent) => {
            await skills.goToBed(agent.bot);
        })
    },
    {
        name: '!stay',
        description: 'Stay in the current location no matter what. Pauses all modes.',
        params: {'type': { type: 'int', description: 'The number of seconds to stay. -1 for forever.', domain: [-1, Number.MAX_SAFE_INTEGER] }},
        perform: runAsAction(async (agent, seconds) => {
            await skills.stay(agent.bot, seconds);
        })
    },
    {
        name: '!setMode',
        description: 'Set a mode to on or off. A mode is an automatic behavior that constantly checks and responds to the environment.',
        params: {
            'mode_name': { type: 'string', description: 'The name of the mode to enable.' },
            'on': { type: 'boolean', description: 'Whether to enable or disable the mode.' }
        },
        perform: async function (agent, mode_name, on) {
            const modes = agent.bot.modes;
            if (!modes.exists(mode_name))
            return `Mode ${mode_name} does not exist.` + modes.getDocs();
            if (modes.isOn(mode_name) === on)
            return `Mode ${mode_name} is already ${on ? 'on' : 'off'}.`;
            modes.setOn(mode_name, on);
            return `Mode ${mode_name} is now ${on ? 'on' : 'off'}.`;
        }
    },
    {
        name: '!goal',
        description: 'Set a goal prompt to endlessly work towards with continuous self-prompting.',
        params: {
            'selfPrompt': { type: 'string', description: 'The goal prompt.' },
        },
        perform: async function (agent, prompt) {
            if (convoManager.inConversation()) {
                agent.self_prompter.setPromptPaused(prompt);
            }
            else {
                agent.self_prompter.start(prompt);
            }
        }
    },
    {
        name: '!endGoal',
        description: 'Call when you have accomplished your goal. It will stop self-prompting and the current action. ',
        perform: async function (agent) {
            agent.self_prompter.stop();
            return 'Self-prompting stopped.';
        }
    },
    {
        name: '!showVillagerTrades',
        description: 'Show trades of a specified villager.',
        params: {'id': { type: 'int', description: 'The id number of the villager that you want to trade with.' }},
        perform: runAsAction(async (agent, id) => {
            await skills.showVillagerTrades(agent.bot, id);
        })
    },
    {
        name: '!tradeWithVillager',
        description: 'Trade with a specified villager.',
        params: {
            'id': { type: 'int', description: 'The id number of the villager that you want to trade with.' },
            'index': { type: 'int', description: 'The index of the trade you want executed (1-indexed).', domain: [1, Number.MAX_SAFE_INTEGER] },
            'count': { type: 'int', description: 'How many times that trade should be executed.', domain: [1, Number.MAX_SAFE_INTEGER] },
        },
        perform: runAsAction(async (agent, id, index, count) => {
            await skills.tradeWithVillager(agent.bot, id, index, count);
        })
    },
    {
        name: '!startConversation',
        description: 'Start a conversation with a bot. (FOR OTHER BOTS ONLY)',
        params: {
            'player_name': { type: 'string', description: 'The name of the player to send the message to.' },
            'message': { type: 'string', description: 'The message to send.' },
        },
        perform: async function (agent, player_name, message) {
            if (!convoManager.isOtherAgent(player_name))
                return player_name + ' is not a bot, cannot start conversation.';
            if (convoManager.inConversation() && !convoManager.inConversation(player_name)) 
                convoManager.forceEndCurrentConversation();
            else if (convoManager.inConversation(player_name))
                agent.history.add('system', 'You are already in conversation with ' + player_name + '. Don\'t use this command to talk to them.');
            convoManager.startConversation(player_name, message);
        }
    },
    {
        name: '!endConversation',
        description: 'End the conversation with the given bot. (FOR OTHER BOTS ONLY)',
        params: {
            'player_name': { type: 'string', description: 'The name of the player to end the conversation with.' }
        },
        perform: async function (agent, player_name) {
            if (!convoManager.inConversation(player_name))
                return `Not in conversation with ${player_name}.`;
            convoManager.endConversation(player_name);
            return `Converstaion with ${player_name} ended.`;
        }
    },
    {
        name: '!lookAtPlayer',
        description: 'Look at a player or look in the same direction as the player.',
        params: {
            'player_name': { type: 'string', description: 'Name of the target player' },
            'direction': {
                type: 'string',
                description: 'How to look ("at": look at the player, "with": look in the same direction as the player)',
            }
        },
        perform: async function(agent, player_name, direction) {
            if (direction !== 'at' && direction !== 'with') {
                return "Invalid direction. Use 'at' or 'with'.";
            }
            let result = "";
            const actionFn = async () => {
                result = await agent.vision_interpreter.lookAtPlayer(player_name, direction);
            };
            await agent.actions.runAction('action:lookAtPlayer', actionFn);
            return result;
        }
    },
    {
        name: '!lookAtPosition',
        description: 'Look at specified coordinates.',
        params: {
            'x': { type: 'int', description: 'x coordinate' },
            'y': { type: 'int', description: 'y coordinate' },
            'z': { type: 'int', description: 'z coordinate' }
        },
        perform: async function(agent, x, y, z) {
            let result = "";
            const actionFn = async () => {
                result = await agent.vision_interpreter.lookAtPosition(x, y, z);
            };
            await agent.actions.runAction('action:lookAtPosition', actionFn);
            return result;
        }
    },
    {
        name: '!digDown',
        description: 'Digs down a specified distance. Will stop if it reaches lava, water, or a fall of >=4 blocks below the bot.',
        params: {'distance': { type: 'int', description: 'Distance to dig down', domain: [1, Number.MAX_SAFE_INTEGER] }},
        perform: runAsAction(async (agent, distance) => {
            await skills.digDown(agent.bot, distance)
        })
    },
    {
        name: '!goToSurface',
        description: 'Moves the bot to the highest block above it (usually the surface).',
        params: {},
        perform: runAsAction(async (agent) => {
            await skills.goToSurface(agent.bot);
        })
    },
    {
        name: '!useOn',
        description: 'Use (right click) the given tool on the nearest target of the given type.',
        params: {
            'tool_name': { type: 'string', description: 'Name of the tool to use, or "hand" for no tool.' },
            'target': { type: 'string', description: 'The target as an entity type, block type, or "nothing" for no target.' }
        },
        perform: runAsAction(async (agent, tool_name, target) => {
            await skills.useToolOn(agent.bot, tool_name, target);
        })
    },
];
