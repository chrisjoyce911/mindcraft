// The command state (laya-go games/command): a player's chat message, normalised, with who said it to whom.
// A port of src/agent/laya/command_state.js normalize/state; the golden requests pin it.

export const MAX_MESSAGE = 120;

/**
 * normalize is laya-go's generate.Normalize: lower case, apostrophes dropped, anything but a–z, 0–9 and _ as a
 * space, spaces collapsed, cut to MAX_MESSAGE bytes at a space (everything kept is ASCII).
 */
export function normalize(text: string): string {
    let out = '';
    for (const ch of String(text).toLowerCase()) {
        if (ch === "'" || ch === '’') continue;
        out += /[a-z0-9_]/.test(ch) ? ch : ' ';
    }
    out = out.split(/\s+/).filter(Boolean).join(' ');
    if (out.length > MAX_MESSAGE) {
        out = out.slice(0, MAX_MESSAGE);
        const i = out.lastIndexOf(' ');
        if (i > 0) out = out.slice(0, i);
    }
    return out;
}

/** commandState writes the state; null when a name is empty or has a space. */
export function commandState(me: string, from: string, message: string): string | null {
    if (!me || !from || /\s/.test(me + from)) return null;
    return `Command.\nMe ${me} From ${from}\nSaid ${normalize(message)}`;
}
