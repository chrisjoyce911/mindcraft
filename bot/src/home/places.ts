// The remembered places (the old bot's MemoryBank + history.js save()): {name: [x, y, z]} kept in
// bots/<name>/memory.json under `places`, today's format, so the old and the new bot can swap on one world.
// Every change is saved at once (read-modify-write: every other key in memory.json is kept; a missing or
// unreadable file gets {places} alone), atomically (a temp file renamed over it). Loading drops anything
// that isn't three finite numbers (memory_bank loadJson).
import fs from 'fs';
import path from 'path';
import type { Places, Vec3Like } from '../types/index.js';

export type Place = [number, number, number];

/** cleanPlaces: the entries that are three finite numbers. */
export function cleanPlaces(json: unknown): Places {
    const out: Places = {};
    if (!json || typeof json !== 'object') return out;
    for (const [name, p] of Object.entries(json as Record<string, unknown>)) {
        if (Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)) out[name] = [p[0], p[1], p[2]] as Place;
    }
    return out;
}

function readDoc(file: string): Record<string, unknown> | null {
    try {
        const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
        return doc && typeof doc === 'object' && !Array.isArray(doc) ? doc as Record<string, unknown> : null;
    } catch { return null; }
}

/** What the jobs need of the places (PlaceStore satisfies it; tests may pass a map). */
export interface PlaceBook {
    all(): Places;
    recall(name: string): Place | null;
    remember(name: string, at: Vec3Like): void;
    forget(name: string): void;
}

export class PlaceStore implements PlaceBook {
    private places: Places;
    /** Called after a save fails (the console); a failed save never stops the bot. */
    onError: ((e: unknown) => void) | null = null;

    constructor(private readonly file: string) {
        this.places = cleanPlaces(readDoc(file)?.places);
    }

    all(): Places { return { ...this.places }; }
    recall(name: string): Place | null { const p = this.places[name]; return p ? [...p] : null; }

    remember(name: string, at: Vec3Like): void {
        this.places[name] = [at.x, at.y, at.z];
        this.save();
    }

    forget(name: string): void {
        if (!(name in this.places)) return;
        delete this.places[name];
        this.save();
    }

    /** save writes the places into memory.json now, keeping its other keys. */
    save(): void {
        const tmp = `${this.file}.${process.pid}.tmp`;
        try {
            const doc = readDoc(this.file) ?? {};
            doc.places = this.places;
            fs.mkdirSync(path.dirname(this.file), { recursive: true });
            fs.writeFileSync(tmp, JSON.stringify(doc, null, 2));
            fs.renameSync(tmp, this.file);
        } catch (e) {
            try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to clean */ }
            this.onError?.(e);
        }
    }
}
