// The reply route (6.2b): a player who whispers to andy (/msg andy …, /tell) is answered by whisper; an open chat
// message sends the replies back to open chat. The route follows the last player message (as lastSpeaker does), so
// the direct reply, a plan's say and doneSay, and the job's later messages for that command all go the same way.
// Note: the old bot answered whispers in open chat (it whispered only to only_chat_with names); the card asks for a
// whisper reply.

import type { Channel, ReplyRoute } from '../types/commands.js';

export interface ReplyOut {
    say(text: string): void;
    whisper(to: string, text: string): void;
}

export class Replies {
    private route_: ReplyRoute = { kind: 'chat' };

    constructor(private readonly out: ReplyOut) {}

    get route(): ReplyRoute { return this.route_; }

    /** heard: a player's message came in on this channel; the replies follow it. */
    heard(from: string, channel: Channel): void {
        this.route_ = channel === 'whisper' ? { kind: 'whisper', to: from } : { kind: 'chat' };
    }

    /** send: one reply on the current route. */
    send(text: string): void {
        const r = this.route_;
        if (r.kind === 'whisper') this.out.whisper(r.to, text);
        else this.out.say(text);
    }
}
