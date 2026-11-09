const settings = {
    "minecraft_version": "1.21.6", // or specific version like "1.21.6"
    "host": "127.0.0.1", // or "localhost", "your.ip.address.here"
    "port": 55916, // set to -1 to automatically scan for open ports
    "auth": "offline", // or "microsoft"

    // the mindserver manages all agents and hosts the UI
    "mindserver_port": 8090,
    "auto_open_ui": true, // opens UI in browser on startup
    
    "base_profile": "assistant", // survival, assistant, creative, or god_mode
    "profiles": [
        "./andy.json",
        // "./profiles/gpt.json",
        // "./profiles/claude.json",
        // "./profiles/gemini.json",
        // "./profiles/llama.json",
        // "./profiles/qwen.json",
        // "./profiles/grok.json",
        // "./profiles/mistral.json",
        // "./profiles/deepseek.json",
        // "./profiles/mercury.json",
        // "./profiles/andy-4.json", // Supports up to 75 messages!

        // using more than 1 profile requires you to /msg each bot indivually
        // individual profiles override values from the base profile
    ],

    "load_memory": false, // load memory from previous session
    "init_message": "Respond with hello world and your name", // sends to all on spawn
    "only_chat_with": [], // users that the bots listen to and send general messages to. if empty it will chat publicly

    "speak": false,
    // allows all bots to speak through text-to-speech. 
    // specify speech model inside each profile with format: {provider}/{model}/{voice}.
    // if set to "system" it will use basic system text-to-speech. 
    // Works on windows and mac, but linux requires you to install the espeak package through your package manager eg: `apt install espeak` `pacman -S espeak`.

    "chat_ingame": true, // bot responses are shown in minecraft chat
    "language": "en", // translate to/from this language. Supports these language names: https://cloud.google.com/translate/docs/languages
    "render_bot_view": false, // show bot's view in browser at localhost:3000, 3001...

    "allow_insecure_coding": false, // allows newAction command and model can write/run code on your computer. enable at own risk
    "allow_vision": false, // allows vision model to interpret screenshots as inputs
    "blocked_actions" : ["!checkBlueprint", "!checkBlueprintLevel", "!getBlueprint", "!getBlueprintLevel"] , // commands to disable and remove from docs. Ex: ["!setMode"]
    "code_timeout_mins": -1, // minutes code is allowed to run. -1 for no timeout
    "relevant_docs_count": 5, // number of relevant code function docs to select for prompting. -1 for all

    "max_messages": 15, // max number of messages to keep in context
    "num_examples": 2, // number of examples to give to the model
    "max_commands": -1, // max number of commands that can be used in consecutive responses. -1 for no limit
    "show_command_syntax": "full", // "full", "shortened", or "none"
    "narrate_behavior": true, // chat simple automatic actions ('Picking up item!')
    "chat_bot_messages": true, // publicly chat messages to other bots

    "spawn_timeout": 30, // num seconds allowed for the bot to spawn before throwing error. Increase when spawning takes a while.
    "block_place_delay": 0, // delay between placing blocks (ms) if using newAction. helps avoid bot being kicked by anti-cheat mechanisms on servers.
  
    "log_all_prompts": false, // log ALL prompts to file

    // Laya decision models: small local models that answer typed questions in milliseconds.
    // Servers speak the decisions API (golaya serve from laya-go, or MLX-Serve). Each task
    // names the server and model that answer one kind of decision; swapping models is a
    // settings change. Check with: npm run laya:check
    "decision_models": {
        "servers": {
            "golaya": { "url": "http://127.0.0.1:11235" }, // laya-go: golaya serve -dir data/laya-go
            "mlx": { "url": "http://127.0.0.1:11234" }     // MLX-Serve, e.g. aac6fef/laya-mlx (share the model for LAN use)
        },
        "tasks": {
            "follow": {
                "enabled": false,      // off: !followPlayer uses the pathfinder as before
                "server": "golaya",
                "model": "follow-a",   // "" uses the server's only decision model
                "prompt": "v1",        // the follow prompt the model was trained on: v1 (follow-a), v2 with mobs (follow-m)
                "timeout_ms": 300,
                "min_confidence": 0.4,
                "step_ms": 250,        // a decision every quarter second
                "fallback_ms": 4000,   // how long to use the pathfinder after a fallback
                "log_steps": true      // bots/<name>/logs/laya-follow.jsonl: each step's state, answer and outcome
            },
            "eat": {
                "enabled": false,      // off: mineflayer-auto-eat eats as before
                "server": "golaya",
                "model": "eat-a",
                "timeout_ms": 300,
                "min_confidence": 0.5,
                "check_ms": 2000,      // how often to ask
                "fallback_ms": 10000,  // auto-eat runs this long after a fallback
                "log_steps": true      // bots/<name>/logs/laya-eat.jsonl
            },
            "defend": {
                "enabled": false,      // off: the self_defense, cowardice and self_preservation modes fight as before
                "server": "golaya",
                "model": "defend-a",
                "timeout_ms": 300,
                "min_confidence": 0.4,
                "step_ms": 400,        // pause between decisions while mobs are active
                "fallback_ms": 8000,   // the ordinary modes defend this long after a fallback
                "quiet_ms": 3000,      // after "ignore", wait this long before engaging again
                "log_steps": true      // bots/<name>/logs/laya-defend.jsonl
            },
            "craft": {
                "enabled": false,      // off: !layaCraft and !layaGather say the task is off
                "server": "golaya",
                "model": "craft-b",    // a craft prompt v2 model
                "timeout_ms": 2000,
                "min_confidence": 0.3, // a step less sure than this stops the run
                "max_steps": 40,       // most steps one !layaCraft takes
                "log_steps": true      // bots/<name>/logs/laya-craft.jsonl
            },
            "mine": {
                "enabled": false,      // off: !layaMine collects the nearest ore blocks
                "server": "golaya",
                "model": "mine-a",
                "timeout_ms": 300,
                "min_confidence": 0.4,
                "max_steps": 300,      // steps before giving up
                "max_failures": 4,     // failed steps in a row before giving up
                "torch_batch": 4,      // torches crafted when they run out
                "log_steps": true      // bots/<name>/logs/laya-mine.jsonl
            },
            "command": {
                "enabled": false,      // off: every player message goes to the LLM as before
                "server": "golaya",
                "model": "command-a",
                "timeout_ms": 500,
                "min_confidence": 0.6, // Command's top probability needed to act without the LLM
                "addressed_min": 0.5,  // less sure the message is for me: the LLM decides
                "ignore_below": 0.15,  // surely for someone else: ignored
                "no_llm": false,       // true: chat and unsure messages get a short canned reply, no LLM
                "log_decisions": true  // bots/<name>/logs/laya-command.jsonl
            },
            "farm": {
                "enabled": false,      // off: !layaFarm says so and does nothing
                "server": "golaya",
                "model": "farm-a",
                "timeout_ms": 300,
                "min_confidence": 0.5,
                "step_ms": 500,        // pause between steps that do nothing
                "max_steps": 400,
                "log_steps": true      // bots/<name>/logs/laya-farm.jsonl
            }
        }
    },

}

export default settings;
