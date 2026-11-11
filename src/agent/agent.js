import { History } from './history.js';
import { Coder } from './coder.js';
import { VisionInterpreter } from './vision/vision_interpreter.js';
import { Prompter } from '../models/prompter.js';
import { initModes } from './modes.js';
import { initBot, isHostile } from '../utils/mcdata.js';
import { containsCommand, commandExists, commandArity, executeCommand, truncCommandMessage, isAction, blacklistCommands } from './commands/index.js';
import { ActionManager } from './action_manager.js';
import { NPCContoller } from './npc/controller.js';
import { MemoryBank } from './memory_bank.js';
import { SelfPrompter } from './self_prompter.js';
import convoManager from './conversation.js';
import { handleTranslation, handleEnglishTranslation } from '../utils/translator.js';
import { addBrowserViewer } from './vision/browser_viewer.js';
import { serverProxy, sendOutputToServer } from './mindserver_proxy.js';
import settings from './settings.js';
import { Task } from './tasks/tasks.js';
import { speak } from './speak.js';
import { laya, taskSettings } from '../models/laya.js';
import { handleCommand, CANNED } from './laya/command.js';
import { llmOn, route, NO_LLM_REPLY, deathMessage } from './llm_gate.js';
import { Director, KIND_OF, armedOf, armorPoints, dangerOf, HARMFUL, mobKind } from './laya/director.js';
import { Chores, CHORE_JOB, loadChoresState, saveChoresState } from './laya/chores.js';
import { sense as senseChores, runChore, playerFact, CAN as CHORE_CAN, homeFacts } from './laya/chores_actions.js';
import { homeOnPlace, placedBy, isBed } from './laya/chores_home.js';
import * as skills from './library/skills.js';
import { valuables } from './laya/mine_state.js';
import { depositList } from './laya/mine.js';
import { packDeps } from './laya/pack_actions.js';
import { homeState } from './laya/home_chest.js';
import { performActivity, stopActivity } from './laya/activities.js';
import { interruptBot } from './interrupt.js';
import { handChoice } from './laya/hand.js';
import Vec3 from 'vec3';
import { runJob } from './commands/actions.js';
import { getNearestEntityWhere, getInventoryCounts } from './library/world.js';
import { log, validateNameFormat, handleDisconnection } from './connection_handler.js';

// CHORES_HOLD_MS: after a player's !stop no chore starts for this long
// (or until the player's next command).
export const CHORES_HOLD_MS = 5 * 60_000;

export class Agent {
    async start(load_mem=false, init_message=null, count_id=0) {
        this.last_sender = null;
        this.count_id = count_id;
        this._disconnectHandled = false;

        // Initialize components
        this.actions = new ActionManager(this);
        this.prompter = new Prompter(this, settings.profile);
        this.name = (this.prompter.getName() || '').trim();
        console.log(`Initializing agent ${this.name}...`);
        
        // Validate Name Format
        // connection_handler now ensures the message has [LoginGuard] prefix
        const nameCheck = validateNameFormat(this.name);
        if (!nameCheck.success) {
            log(this.name, nameCheck.msg);
            process.exit(1);
            return;
        }
        
        this.history = new History(this);
        this.coder = new Coder(this);
        this.npc = new NPCContoller(this);
        // places (home_chest, ...) are saved with the memory at every change
        this.memory_bank = new MemoryBank(() => this._savePlaces());
        this.self_prompter = new SelfPrompter(this);
        this.director = this._makeDirector();
        this._initChores();
        convoManager.initAgent(this);
        await this.prompter.initExamples();

        // load mem first before doing task
        let save_data = null;
        if (load_mem) {
            save_data = this.history.load();
        }
        let taskStart = null;
        if (save_data) {
            taskStart = save_data.taskStart;
            // a restart (after a crash or "Killing process") keeps the home chest
            if (save_data.places) {
                this.memory_bank.loadJson(save_data.places);
                console.log('Loaded places:', this.memory_bank.getKeys() || 'none');
            }
        } else {
            taskStart = Date.now();
        }
        this.task = new Task(this, settings.task, taskStart);
        this.blocked_actions = settings.blocked_actions.concat(this.task.blocked_actions || []);
        blacklistCommands(this.blocked_actions);

        console.log(this.name, 'logging into minecraft...');
        this.bot = initBot(this.name);
        
        // Connection Handler
        const onDisconnect = (event, reason) => {
            if (this._disconnectHandled) return;
            this._disconnectHandled = true;

            // Log and Analyze
            // handleDisconnection handles logging to console and server
            const { type } = handleDisconnection(this.name, reason);
     
            process.exit(1);
        };
        
        // Bind events
        this.bot.once('kicked', (reason) => onDisconnect('Kicked', reason));
        this.bot.once('end', (reason) => onDisconnect('Disconnected', reason));
        this.bot.on('error', (err) => {
            if (String(err).includes('Duplicate') || String(err).includes('ECONNREFUSED')) {
                 onDisconnect('Error', err);
            } else {
                 log(this.name, `[LoginGuard] Connection Error: ${String(err)}`);
            }
        });

        initModes(this);

        this.bot.on('login', () => {
            console.log(this.name, 'logged in!');
            serverProxy.login();
            
            // Set skin for profile, requires Fabric Tailor. (https://modrinth.com/mod/fabrictailor)
            if (this.prompter.profile.skin)
                this.bot.chat(`/skin set URL ${this.prompter.profile.skin.model} ${this.prompter.profile.skin.path}`);
            else
                this.bot.chat(`/skin clear`);
        });
		const spawnTimeoutDuration = settings.spawn_timeout;
        const spawnTimeout = setTimeout(() => {
            const msg = `Bot has not spawned after ${spawnTimeoutDuration} seconds. Exiting.`;
            log(this.name, msg);
            process.exit(1);
        }, spawnTimeoutDuration * 1000);
        this.bot.once('spawn', async () => {
            try {
                clearTimeout(spawnTimeout);
                addBrowserViewer(this.bot, count_id);
                console.log('Initializing vision intepreter...');
                this.vision_interpreter = new VisionInterpreter(this, settings.allow_vision);

                // wait for a bit so stats are not undefined
                await new Promise((resolve) => setTimeout(resolve, 1000));
                
                console.log(`${this.name} spawned.`);
                this.clearBotLogs();
              
                this._setupEventHandlers(save_data, init_message);
                this.startEvents();
              
                if (!load_mem) {
                    if (settings.task) {
                        this.task.initBotTask();
                        this.task.setAgentGoal();
                    }
                } else {
                    // set the goal without initializing the rest of the task
                    if (settings.task) {
                        this.task.setAgentGoal();
                    }
                }

                await new Promise((resolve) => setTimeout(resolve, 10000));
                this.checkAllPlayersPresent();

            } catch (error) {
                console.error('Error in spawn event:', error);
                process.exit(0);
            }
        });
    }

    async _setupEventHandlers(save_data, init_message) {
        const ignore_messages = [
            "Set own game mode to",
            "Set the time to",
            "Set the difficulty to",
            "Teleported ",
            "Set the weather to",
            "Gamerule "
        ];
        
        const respondFunc = async (username, message) => {
            if (message === "") return;
            if (username === this.name) return;
            if (settings.only_chat_with.length > 0 && !settings.only_chat_with.includes(username)) return;
            try {
                if (ignore_messages.some((m) => message.startsWith(m))) return;

                this.shut_up = false;

                console.log(this.name, 'received message from', username, ':', message);

                if (convoManager.isOtherAgent(username)) {
                    console.warn('received whisper from other bot??')
                }
                else {
                    let translation = await handleEnglishTranslation(message);
                    this.handleMessage(username, translation);
                }
            } catch (error) {
                console.error('Error handling message:', error);
            }
        }

		this.respondFunc = respondFunc;

        this.bot.on('whisper', respondFunc);
        
        this.bot.on('chat', (username, message) => {
            if (serverProxy.getNumOtherAgents() > 0) return;
            // only respond to open chat messages when there are no other agents
            respondFunc(username, message);
        });

        // Set up auto-eat
        this.bot.autoEat.options = {
            priority: 'foodPoints',
            startAt: 14,
            bannedFood: ["rotten_flesh", "spider_eye", "poisonous_potato", "pufferfish", "chicken"]
        };

        if (save_data?.self_prompt && llmOn(settings)) {
            if (init_message) {
                this.history.add('system', init_message);
            }
            await this.self_prompter.handleLoad(save_data.self_prompt, save_data.self_prompting_state);
        }
        if (save_data?.last_sender) {
            this.last_sender = save_data.last_sender;
            if (convoManager.otherAgentInGame(this.last_sender)) {
                const msg_package = {
                    message: `You have restarted and this message is auto-generated. Continue the conversation with me.`,
                    start: true
                };
                convoManager.receiveFromBot(this.last_sender, msg_package);
            }
        }
        else if (init_message && llmOn(settings)) {
            await this.handleMessage('system', init_message, 2);
        }
        else {
            this.openChat("Hello world! I am "+this.name);
        }
    }

    checkAllPlayersPresent() {
        if (!this.task || !this.task.agent_names) {
          return;
        }

        const missingPlayers = this.task.agent_names.filter(name => !this.bot.players[name]);
        if (missingPlayers.length > 0) {
            console.log(`Missing players/bots: ${missingPlayers.join(', ')}`);
            this.cleanKill('Not all required players/bots are present in the world. Exiting.', 4);
        }
    }

    requestInterrupt() {
        interruptBot(this.bot);
    }

    clearBotLogs() {
        this.bot.output = '';
        this.bot.interrupt_code = false;
    }

    shutUp() {
        this.shut_up = true;
        if (this.self_prompter.isActive()) {
            this.self_prompter.stop(false);
        }
        convoManager.endAllConversations();
    }

    async handleMessage(source, message, max_responses=null) {
        await this.checkTaskDone();
        if (!source || !message) {
            console.warn('Received empty message from', source);
            return false;
        }

        let used_command = false;
        if (max_responses === null) {
            max_responses = settings.max_commands === -1 ? Infinity : settings.max_commands;
        }
        if (max_responses === -1) {
            max_responses = Infinity;
        }

        const self_prompt = source === 'system' || source === this.name;
        const from_other_bot = convoManager.isOtherAgent(source);
        if (!self_prompt) this.last_speaker = source; // !setHomeChest looks next to them

        const llm = llmOn(settings);
        const user_command_name = !self_prompt && !from_other_bot ? containsCommand(message) : null;
        const where = route({ llm, selfPrompt: self_prompt, fromOtherBot: from_other_bot, userCommand: user_command_name,
            commandTask: !!taskSettings('command') });
        if (where === 'refuse') {
            this.routeResponse(source, NO_LLM_REPLY);
            return false;
        }
        if (where === 'drop') {
            // settings.llm off: system, self and other bots' messages are
            // only logged (an interrupted Laya job resumes by itself)
            console.log(`(llm off) not answering ${source}: ${message.slice(0, 200)}`);
            return false;
        }
        if (where === 'canned') {
            this.history.add(source, message);
            this.routeResponse(source, CANNED);
            return false;
        }

        if (where === 'command') { // from user, check for forced commands
            if (!commandExists(user_command_name)) {
                this.routeResponse(source, `Command '${user_command_name}' does not exist.`);
                return false;
            }
            this.routeResponse(source, `*${source} used ${user_command_name.substring(1)}*`);
            this._playerCommand(user_command_name);
            if (user_command_name === '!newAction') {
                // all user-initiated commands are ignored by the bot except for this one
                // add the preceding message to the history to give context for newAction
                this.history.add(source, message);
            }
            let execute_res = await executeCommand(this, message);
            if (execute_res) 
                this.routeResponse(source, execute_res);
            return true;
        }

        if (where === 'laya') {
            // The Laya command model turns plain chat into a command; chat and
            // unsure answers fall through to the LLM below (with the LLM off:
            // a canned reply).
            const handled = await handleCommand(message, {
                client: laya,
                task: llm ? taskSettings('command') : { ...taskSettings('command'), no_llm: true },
                bot: this.bot,
                speaker: source,
                has: name => commandExists(name),
                arity: name => commandArity(name),
                nearestHostile: () => getNearestEntityWhere(this.bot, e => isHostile(e), 16)?.name ?? null,
                execute: line => { this._playerCommand(containsCommand(line)); return executeCommand(this, line); },
                say: text => this.routeResponse(source, text),
                logPath: `./bots/${this.name}/logs/laya-command.jsonl`,
            });
            if (handled) {
                this.history.add(source, message);
                return true;
            }
            if (!llm) {
                this.routeResponse(source, CANNED);
                return false;
            }
        }

        if (from_other_bot)
            this.last_sender = source;

        // Now translate the message
        message = await handleEnglishTranslation(message);
        console.log('received message from', source, ':', message);

        const checkInterrupt = () => this.self_prompter.shouldInterrupt(self_prompt) || this.shut_up || convoManager.responseScheduledFor(source);
        
        let behavior_log = this.bot.modes.flushBehaviorLog().trim();
        if (behavior_log.length > 0) {
            const MAX_LOG = 500;
            if (behavior_log.length > MAX_LOG) {
                behavior_log = '...' + behavior_log.substring(behavior_log.length - MAX_LOG);
            }
            behavior_log = 'Recent behaviors log: \n' + behavior_log;
            await this.history.add('system', behavior_log);
        }

        // Handle other user messages
        await this.history.add(source, message);
        this.history.save();

        if (!self_prompt && this.self_prompter.isActive()) // message is from user during self-prompting
            max_responses = 1; // force only respond to this message, then let self-prompting take over
        for (let i=0; i<max_responses; i++) {
            if (checkInterrupt()) break;
            let history = this.history.getHistory();
            let res = await this.prompter.promptConvo(history);

            console.log(`${this.name} full response to ${source}: ""${res}""`);

            if (res.trim().length === 0) {
                console.warn('no response')
                break; // empty response ends loop
            }

            let command_name = containsCommand(res);

            if (command_name) { // contains query or command
                res = truncCommandMessage(res); // everything after the command is ignored
                this.history.add(this.name, res);
                
                if (!commandExists(command_name)) {
                    this.history.add('system', `Command ${command_name} does not exist.`);
                    console.warn('Agent hallucinated command:', command_name)
                    continue;
                }

                if (checkInterrupt()) break;
                this.self_prompter.handleUserPromptedCmd(self_prompt, isAction(command_name));
                if (!self_prompt && !from_other_bot) this._playerCommand(command_name);

                if (settings.show_command_syntax === "full") {
                    this.routeResponse(source, res);
                }
                else if (settings.show_command_syntax === "shortened") {
                    // show only "used !commandname"
                    let pre_message = res.substring(0, res.indexOf(command_name)).trim();
                    let chat_message = `*used ${command_name.substring(1)}*`;
                    if (pre_message.length > 0)
                        chat_message = `${pre_message}  ${chat_message}`;
                    this.routeResponse(source, chat_message);
                }
                else {
                    // no command at all
                    let pre_message = res.substring(0, res.indexOf(command_name)).trim();
                    if (pre_message.trim().length > 0)
                        this.routeResponse(source, pre_message);
                }

                let execute_res = await executeCommand(this, res);

                console.log('Agent executed:', command_name, 'and got:', execute_res);
                used_command = true;

                if (execute_res)
                    this.history.add('system', execute_res);
                else
                    break;
            }
            else { // conversation response
                this.history.add(this.name, res);
                this.routeResponse(source, res);
                break;
            }
            
            this.history.save();
        }

        return used_command;
    }

    // _playerCommand: a player's new action command replaces the top Laya
    // job (a new Laya job replaces it itself); !stop clears the stack.
    _playerCommand(name) {
        if (!name) return;
        if (name === '!stop') {
            this.director.stack.clear();
            this._choresHoldUntil = Date.now() + CHORES_HOLD_MS; // stop means stop: no chore for a while
        } else {
            if (isAction(name)) this._choresHoldUntil = 0;
            if (isAction(name) && !name.startsWith('!laya')) this.director.stack.replaceTop();
        }
    }

    async routeResponse(to_player, message) {
        if (this.shut_up) return;
        let self_prompt = to_player === 'system' || to_player === this.name;
        if (self_prompt && this.last_sender) {
            // this is for when the agent is prompted by system while still in conversation
            // so it can respond to events like death but be routed back to the last sender
            to_player = this.last_sender;
        }

        if (convoManager.isOtherAgent(to_player) && convoManager.inConversation(to_player)) {
            // if we're in an ongoing conversation with the other bot, send the response to it
            convoManager.sendToBot(to_player, message);
        }
        else {
            // otherwise, use open chat
            this.openChat(message);
            // note that to_player could be another bot, but if we get here the conversation has ended
        }
    }

    async openChat(message) {
        let to_translate = message;
        let remaining = '';
        let command_name = containsCommand(message);
        let translate_up_to = command_name ? message.indexOf(command_name) : -1;
        if (translate_up_to != -1) { // don't translate the command
            to_translate = to_translate.substring(0, translate_up_to);
            remaining = message.substring(translate_up_to);
        }
        message = (await handleTranslation(to_translate)).trim() + " " + remaining;
        // newlines are interpreted as separate chats, which triggers spam filters. replace them with spaces
        message = message.replaceAll('\n', ' ');

        if (settings.only_chat_with.length > 0) {
            for (let username of settings.only_chat_with) {
                this.bot.whisper(username, message);
            }
        }
        else {
            if (settings.speak) {
                speak(to_translate, this.prompter.profile.speak_model);
            }
            if (settings.chat_ingame) {this.bot.chat(message);}
            sendOutputToServer(this.name, message);
        }
    }

    startEvents() {
        // Custom events
        this.bot.on('time', () => {
            if (this.bot.time.timeOfDay == 0)
            this.bot.emit('sunrise');
            else if (this.bot.time.timeOfDay == 6000)
            this.bot.emit('noon');
            else if (this.bot.time.timeOfDay == 12000)
            this.bot.emit('sunset');
            else if (this.bot.time.timeOfDay == 18000)
            this.bot.emit('midnight');
        });

        let prev_health = this.bot.health;
        this.bot.lastDamageTime = 0;
        this.bot.lastDamageTaken = 0;
        this.bot.on('health', () => {
            if (this.bot.health < prev_health) {
                this.bot.lastDamageTime = Date.now();
                this.bot.lastDamageTaken = prev_health - this.bot.health;
            }
            prev_health = this.bot.health;
        });
        this._choreSensors();
        // Logging callbacks
        this.bot.on('error' , (err) => {
            console.error('Error event!', err);
        });
        // Use connection handler for runtime disconnects
        this.bot.on('end', (reason) => {
            if (!this._disconnectHandled) {
                const { msg } = handleDisconnection(this.name, reason);
                this.cleanKill(msg);
            }
        });
        this.bot.on('death', () => {
            this.director.stack.clear();
            this.actions.cancelResume();
            this.actions.stop();
        });
        this.bot.on('kicked', (reason) => {
            if (!this._disconnectHandled) {
                const { msg } = handleDisconnection(this.name, reason);
                this.cleanKill(msg);
            }
        });
        this.bot.on('messagestr', async (message, _, jsonMsg) => {
            if (jsonMsg.translate && jsonMsg.translate.startsWith('death') && message.startsWith(this.name)) {
                console.log('Agent died: ', message);
                let death_pos = this.bot.entity.position;
                this.memory_bank.rememberPlace('last_death_position', death_pos.x, death_pos.y, death_pos.z);
                let death_pos_text = null;
                if (death_pos) {
                    death_pos_text = `x: ${death_pos.x.toFixed(2)}, y: ${death_pos.y.toFixed(2)}, z: ${death_pos.z.toFixed(2)}`;
                }
                let dimention = this.bot.game.dimension;
                if (!llmOn(settings)) {
                    // no LLM to decide what next: say where, and stay stopped
                    this.openChat(deathMessage(death_pos, message));
                    return;
                }
                this.handleMessage('system', `You died at position ${death_pos_text || "unknown"} in the ${dimention} dimension with the final message: '${message}'. Your place of death is saved as 'last_death_position' if you want to return. Previous actions were stopped and you have respawned.`);
            }
        });
        this.bot.on('idle', () => {
            this.bot.clearControlStates();
            this.bot.pathfinder.stop(); // clear any lingering pathfinder
            this.bot.modes.unPauseAll();
            setTimeout(() => {
                if (this.isIdle()) {
                    this._equipHand();
                    this.actions.resumeAction();
                    this.director.tick('idle').catch(err => console.warn('[laya] director:', err.message));
                }
            }, 1000);
        });

        // a pickup while idle can land in the hand (an arrow, a torch)
        this.bot.on('playerCollect', collector => {
            if (collector !== this.bot.entity) return;
            clearTimeout(this._handTimer);
            this._handTimer = setTimeout(() => { if (this.isIdle()) this._equipHand(); }, 500);
        });

        // Init NPC controller
        this.npc.init();

        // This update loop ensures that each update() is called one at a time, even if it takes longer than the interval
        const INTERVAL = 300;
        let last = Date.now();
        setTimeout(async () => {
            while (true) {
                let start = Date.now();
                await this.update(start - last);
                let remaining = INTERVAL - (Date.now() - start);
                if (remaining > 0) {
                    await new Promise((resolve) => setTimeout(resolve, remaining));
                }
                last = start;
            }
        }, INTERVAL);

        this.bot.emit('idle');
    }

    // _makeDirector: the job stack and the one decision point for what to do
    // next (laya/director.js, the shared director spec); the modes stay the
    // executors of defend and flee, the agent runs eat, heal, unload, resume.
    _makeDirector() {
        return new Director({
            read: () => this._directorSituation(),
            current: () => {
                const kind = KIND_OF[(this.actions.currentActionLabel || '').replace(/^action:/, '')];
                return kind ? { kind, item: null, left: 'any' } : null;
            },
            idle: () => this.isIdle(),
            resume: job => runJob(this, job),
            perform: activity => this.actions.runAction(`director:${activity}`, () => this._perform(activity)),
            stop: activity => this._stopActivity(activity),
            client: taskSettings('director') ? laya : null,
            task: taskSettings('director') || null,
            chore: () => this._startChore(),
            choresOn: () => !!this._chores?.on && !this._choresHeld(),
            now: () => Date.now(),
            warn: err => console.warn('[laya] director:', err?.message || err),
            stepLog: `./bots/${this.name}/logs/laya-director.jsonl`,
        });
    }

    _directorSituation() {
        const bot = this.bot;
        const pos = bot.entity.position;
        const hostiles = Object.values(bot.entities).filter(e => e !== bot.entity && e.position && isHostile(e)
            && e.position.distanceTo(pos) <= 16);
        let nearest = null;
        for (const e of hostiles) {
            const d = Math.ceil(e.position.distanceTo(pos));
            if (!nearest || d < nearest.dist) nearest = { kind: e.name, dist: d };
        }
        const items = bot.inventory.items();
        const foods = bot.registry.foodsByName || {};
        const inv = getInventoryCounts(this.bot);
        const home = this._usableHome();
        const feet = pos.floored();
        const blockAt = (dx, dy, dz) => { try { return bot.blockAt(feet.offset(dx, dy, dz)); } catch { return null; } };
        const here = blockAt(0, 0, 0), head = blockAt(0, 1, 0);
        const time = bot.time?.timeOfDay ?? 6000;
        const night = time >= 13000 && time < 23000;
        let under = false;
        for (let dy = 2; dy <= 64 && !under; dy++) under = blockAt(0, dy, 0)?.boundingBox === 'block';
        const near = [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0], [0, 1, 0], [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1], [0, 2, 0]];
        return {
            health: bot.health ?? 20, food: bot.food ?? 20,
            armed: armedOf(items.map(i => i.name)),
            armor: armorPoints([5, 6, 7, 8].map(i => bot.inventory.slots[i]?.name).filter(Boolean)),
            hostiles: hostiles.length, nearest,
            light: Math.max(here?.light ?? 0, night ? 0 : (here?.skyLight ?? 0)), night, under,
            free: bot.inventory.emptySlotCount(),
            home: home ? Math.ceil(Math.hypot(home.x - pos.x, home.y - pos.y, home.z - pos.z)) : null,
            valuables: valuables(inv),
            foodItems: items.filter(i => foods[i.name] && !HARMFUL.has(i.name)).reduce((n, i) => n + i.count, 0),
            player: playerFact(bot, this._playerHits || {}),
            danger: dangerOf({
                onFire: !!((bot.entity.metadata?.[0] ?? 0) & 1), inFire: /fire$/.test(here?.name || ''),
                oxygen: bot.oxygenLevel, headInWater: head?.name === 'water',
                lavaNear: near.some(([x, y, z]) => blockAt(x, y, z)?.name === 'lava'),
                falling: !bot.entity.onGround && (bot.entity.velocity?.y ?? 0) < -0.6 && !here?.name?.includes('water'),
            }),
        };
    }

    // homeChest is the saved home chest place ([x, y, z]) when a chest is
    // still there (or its chunk isn't loaded); a home whose chest is gone is
    // forgotten, with a word to the players.
    homeChest() {
        const h = this.memory_bank.recallPlace('home_chest');
        if (!h) return undefined;
        let st = 'unknown';
        try { st = homeState(h, (x, y, z) => this.bot.blockAt(new Vec3(x, y, z))); } catch { /* not loaded */ }
        if (st !== 'gone') return h;
        this.memory_bank.forgetPlace('home_chest');
        this.openChat(`My home chest at ${Math.floor(h[0])} ${Math.floor(h[1])} ${Math.floor(h[2])} is gone, so I've forgotten it.`);
        return undefined;
    }

    // _usableHome: the home chest unless unloading there failed lately (then
    // the director sees Home none and goes on with the job).
    _usableHome() {
        if (Date.now() < (this._noUnloadUntil || 0)) return null;
        const h = this.homeChest();
        return h ? { x: h[0], y: h[1], z: h[2] } : null;
    }

    async _eatBest() {
        const foods = this.bot.registry.foodsByName || {};
        const item = this.bot.inventory.items().filter(i => foods[i.name] && !HARMFUL.has(i.name))
            .sort((a, b) => (i => i.name === 'rotten_flesh' ? -1 : (foods[i.name].foodPoints || 0))(b)
                - (i => i.name === 'rotten_flesh' ? -1 : (foods[i.name].foodPoints || 0))(a))[0];
        if (!item) return false;
        try { await this.bot.equip(item, 'hand'); await this.bot.consume(); return true; } catch { return false; }
    }

    // _perform runs the director's eat, heal and unload (laya/activities.js):
    // each one ends within ~100 ms of an interrupt.
    async _perform(activity) {
        const bot = this.bot;
        const why = await performActivity(activity, {
            stopped: () => !!bot.interrupt_code,
            health: () => bot.health ?? 20,
            food: () => bot.food ?? 20,
            eat: () => (bot.interrupt_code ? Promise.resolve(false) : this._eatBest()),
            nearestDist: () => this._directorSituation().nearest?.dist ?? null,
            say: msg => this.openChat(msg),
            askedFoodAt: () => this._askedFoodAt || 0,
            setAskedFoodAt: t => { this._askedFoodAt = t; },
            unload: () => this._unload(),
            defend: () => this._defendPlayer(),
            flee: () => skills.avoidEnemies(bot, 24),
        });
        if (why === 'stopped') console.log(`[laya] director: ${activity} stopped`);
    }

    // _defendPlayer: go to the attacked player and fight the attacker
    // (director v1.2 defend-player); the attacker is the mob that hit them
    // (or the nearest hostile within 4 of them).
    async _defendPlayer() {
        const bot = this.bot;
        const p = playerFact(bot, this._playerHits || {});
        if (!p?.attacked) return;
        let mob = p.entity?.isValid !== false ? p.entity : null;
        const player = bot.players?.[p.name]?.entity;
        if (!mob && player) mob = getNearestEntityWhere(bot, e => isHostile(e) && e.position.distanceTo(player.position) <= 4, 28);
        if (!mob) { await new Promise(r => setTimeout(r, 500)); return; } // nothing to hit (yet)
        this.openChat(`Hang on ${p.name}, I'm coming for that ${String(mob.name).replace(/_/g, ' ')}!`);
        await skills.attackEntity(bot, mob, true);
    }

    // ---- chores (laya/chores.js) ----

    _initChores() {
        this._choresPath = `./bots/${this.name}/laya-chores.json`;
        this._chores = loadChoresState(this._choresPath, !!settings.chores);
        this._playerPlaced = [];
        this._playerHits = {};
        this._saveChores = () => saveChoresState(this._choresPath, this._chores);
        const task = taskSettings('chores');
        this.choresRunner = new Chores({
            sense: () => Promise.resolve().then(() => senseChores(this, this._chores, {
                place: (settings.decision_models?.tasks?.chores?.can_place ?? true) && CHORE_CAN.place,
                smelt: (settings.decision_models?.tasks?.chores?.can_smelt ?? true) && CHORE_CAN.smelt,
            })),
            client: task ? laya : null,
            task: task || null,
            stepLog: `./bots/${this.name}/logs/laya-chores.jsonl`,
        });
    }

    // setChores turns chores on or off (saved across restarts).
    setChores(on) {
        this._chores.on = !!on;
        this._choresHoldUntil = 0;
        this._saveChores();
        if (!on && this.director.stack.job()?.chore) {
            this.director.stack.clear();
            this.actions.stop().catch(() => {});
        }
    }

    // _choresHeld: a player's !stop holds chores for a while (until the
    // next player command or CHORES_HOLD_MS).
    _choresHeld() { return Date.now() < (this._choresHoldUntil || 0); }

    // _startChore asks for the next chore and runs it as a job of kind
    // chore on the job stack (the director answered idle, nothing runs).
    async _startChore() {
        const d = await this.choresRunner.next();
        if (!d) return;
        // something started while it asked
        if (!this.isIdle() || this.director.stack.depth > 0 || this.director.performing || !this._chores.on || this._choresHeld()) return;
        const [kind, item] = CHORE_JOB[d.chore] || ['gather', 'none'];
        const chore = d.chore;
        console.log(`[laya] chores: ${chore} (${d.source}${d.source === 'rules' ? ' ' + d.rule : ''})`);
        let result = null;
        const job = this.director.stack.start('chore', [chore], { kind, item, chore, timeout: 10,
            work: async () => { result = await runChore(this, chore); return result; },
            onEnd: how => this.choresRunner.ended(chore, how, result?.reason) });
        await runJob(this, job);
    }

    // _choreSensors: who placed a chest, table or bed (a player within 5 of
    // it, nearer than anyone else), and a player hurt by a mob (the
    // director's Player line).
    _choreSensors() {
        const bot = this.bot;
        bot.layaHomeChest = () => this.homeChest(); // takeFromChest leaves the player kit in it
        bot.on('entityHurt', (entity, source) => {
            if (!entity || entity.type !== 'player' || entity === bot.entity || !entity.username) return;
            if (entity.position.distanceTo(bot.entity.position) > 24) return;
            let mob = source && isHostile(source) ? source : null;
            if (!mob) mob = getNearestEntityWhere(bot, e => isHostile(e) && e.position.distanceTo(entity.position) <= 4, 32);
            if (!mob) return; // not a mob's hit (a fall, a player)
            this._playerHits[entity.username] = { at: Date.now(), by: mobKind(mob.name), entity: mob };
        });
        bot.on('blockUpdate', (oldBlock, newBlock) => {
            if (!newBlock || oldBlock?.name === newBlock.name) return;
            const kind = newBlock.name === 'crafting_table' ? 'table' : ['chest', 'trapped_chest', 'barrel'].includes(newBlock.name) ? 'chest'
                : isBed(newBlock.name) && newBlock.getProperties?.().part !== 'head' ? 'bed' : null;
            if (!kind) return;
            const pos = newBlock.position;
            const mine = this._placingAt && this._placingAt.x === pos.x && this._placingAt.y === pos.y && this._placingAt.z === pos.z
                && Date.now() - this._placingAt.at < 15000;
            if (mine) return; // the chore that placed it remembers it
            const players = Object.values(bot.players || {}).filter(p => p.entity && p.entity !== bot.entity)
                .map(p => ({ name: p.username, x: p.entity.position.x, y: p.entity.position.y, z: p.entity.position.z }));
            const who = placedBy(pos, players, bot.entity.position);
            if (!who) return;
            const at = { x: pos.x, y: pos.y, z: pos.z };
            if (kind === 'bed') {
                const h = homeFacts(this);
                for (const sv of homeOnPlace('bed', at, 'player', { ...h })) {
                    this.memory_bank.rememberPlace(sv.place, sv.pos.x, sv.pos.y, sv.pos.z);
                    if (sv.say) this.openChat(sv.say);
                }
                return;
            }
            const h = homeFacts(this);
            if (!h.homeBed && !h.homeChest && !h.homeTable) {
                this._playerPlaced.push({ kind, pos: at, player: who, at: Date.now() });
                this._playerPlaced = this._playerPlaced.slice(-4);
            }
        });
        // the bed he last slept in is his home bed when he has none
        bot.on('sleep', () => {
            if (this.memory_bank.recallPlace('home_bed')) return;
            const b = bot.findBlock?.({ matching: blk => isBed(blk.name), maxDistance: 3 });
            if (b) {
                this.memory_bank.rememberPlace('home_bed', b.position.x, b.position.y, b.position.z);
                this.openChat(`My home is now at ${b.position.x} ${b.position.y} ${b.position.z}.`);
            }
        });
    }

    async _unload() {
        const bot = this.bot;
        const home = this._usableHome();
        if (!home) return;
        const pack = packDeps(bot, () => this.homeChest());
        let ok = await pack.goHome(home);
        if (bot.interrupt_code) return;
        if (ok) {
            const items = depositList(getInventoryCounts(bot), pack.isFood, 32);
            const before = bot.inventory.emptySlotCount();
            ok = await pack.deposit(items).catch(() => false) || bot.inventory.emptySlotCount() > before;
        }
        if (!ok && !bot.interrupt_code) {
            this._noUnloadUntil = Date.now() + 60000; // carry on; try again in a minute
            console.log('[laya] director: unload failed; Home none for 60 s');
        }
    }

    // _stopActivity ends the director's running activity (the director
    // answered something else): the action stops, then the bot is idle again.
    // Only that action is interrupted: a mode that took over meanwhile runs on.
    async _stopActivity(activity) {
        const label = `director:${activity}`;
        if (this.actions.currentActionLabel !== label) return;
        console.log(`[laya] director: stopping ${activity}`);
        await stopActivity(label, {
            currentLabel: () => this.actions.currentActionLabel,
            interrupt: () => this.requestInterrupt(),
            executing: () => this.actions.executing,
            idle: () => { this.clearBotLogs(); this.bot.emit('idle'); },
        });
    }

    async update(delta) {
        await this.bot.modes.update();
        if (Date.now() - (this._directorAt || 0) >= 1000) {
            this._directorAt = Date.now();
            this.director.tick('tick').catch(err => console.warn('[laya] director:', err.message));
        }
        this.self_prompter.update(delta);
        await this.checkTaskDone();
    }

    // _equipHand holds the best weapon (else a tool, else a pickaxe, else
    // nothing) when no action runs (laya/hand.js).
    async _equipHand() {
        const bot = this.bot;
        try {
            const c = handChoice(bot.inventory.items().map(i => i.name), bot.heldItem?.name ?? null);
            if (!c || !this.isIdle()) return;
            if (c.equip) {
                const item = bot.inventory.items().find(i => i.name === c.equip);
                if (item) await bot.equip(item, 'hand');
            } else if (c.empty && bot.inventory.emptySlotCount() > 0) await bot.unequip('hand');
        } catch (err) { console.warn('[laya] hand:', err?.message || err); }
    }

    // _savePlaces writes memory.json now (history.save includes the places);
    // never throws.
    _savePlaces() {
        try { this.history?.save(); } catch (err) { console.warn('[memory] saving places failed:', err?.message || err); }
    }

    isIdle() {
        return !this.actions.executing;
    }
    

    cleanKill(msg='Killing agent process...', code=1) {
        this.history.add('system', msg);
        this.bot.chat(code > 1 ? 'Restarting.': 'Exiting.');
        this.history.save();
        process.exit(code);
    }
    async checkTaskDone() {
        if (this.task.data) {
            let res = this.task.isDone();
            if (res) {
                await this.history.add('system', `Task ended with score : ${res.score}`);
                await this.history.save();
                // await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 second for save to complete
                console.log('Task finished:', res.message);
                this.killAll();
            }
        }
    }

    killAll() {
        serverProxy.shutdown();
    }
}