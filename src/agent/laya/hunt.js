// Hunting for a drop: the command task's v2.1 gather of an animal drop
// (beef, porkchop, mutton, chicken, leather, feather, egg; wool, string)
// attacks the mob that drops it (command_state.huntFor) until the bot has
// count more of the drop. Pure: the game side is passed in.

// huntUntil attacks and picks up until have() reaches have()+count at the
// start (or target, kept across a resumed job). deps: have() → count of the
// drop carried, attack() → false when no mob is near, pickup(),
// interrupted(), maxKills (default count*3+4). Returns {ok, reason, kills}.
export async function huntUntil(count, deps, target = null) {
    target ??= deps.have() + count;
    const max = deps.maxKills ?? count * 3 + 4;
    let kills = 0;
    while (deps.have() < target) {
        if (deps.interrupted?.()) return { ok: false, reason: 'interrupted', kills };
        if (kills >= max) return { ok: false, reason: `only ${deps.have()} of ${target} after ${kills} kills`, kills };
        if (!await deps.attack()) {
            await deps.pickup?.();
            return deps.have() >= target ? { ok: true, reason: 'done', kills } : { ok: false, reason: 'none near', kills };
        }
        kills++;
        await deps.pickup?.();
    }
    return { ok: true, reason: 'done', kills };
}
