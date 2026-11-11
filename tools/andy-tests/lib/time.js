// Brisbane time (AEST, UTC+10 all year, no daylight saving) for everything
// people read: report names, report lines, the CLI.

export const TZ = 'Australia/Brisbane';

const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function parts(d) {
    const o = {};
    for (const p of fmt.formatToParts(new Date(d))) o[p.type] = p.value;
    return o;
}

// stamp: 2026-11-10_14-05-06, safe in a file name.
export function stamp(d = Date.now()) {
    const p = parts(d);
    return `${p.year}-${p.month}-${p.day}_${p.hour}-${p.minute}-${p.second}`;
}

// brisbane: 2026-11-10 14:05:06 AEST
export function brisbane(d = Date.now()) {
    const p = parts(d);
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} AEST`;
}

// brisbaneIso: 2026-11-10T14:05:06+10:00
export function brisbaneIso(d = Date.now()) {
    const p = parts(d);
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+10:00`;
}

// clock: 14:05:06
export function clock(d = Date.now()) {
    const p = parts(d);
    return `${p.hour}:${p.minute}:${p.second}`;
}
