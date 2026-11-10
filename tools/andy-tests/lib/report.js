// A report: <dir>/[<name>-]<Brisbane stamp>.jsonl (one event per line) and
// .md, both appended as things happen so a session that dies half way is
// still readable, and .json, the machine-readable summary of a suite run
// (written at its end; see runner.js summaryRows and compare.js).
import fs from 'fs';
import path from 'path';
import { stamp, brisbane, brisbaneIso } from './time.js';

export class Report {
    constructor(dir, { title = 'Andy game tests', name = null, now = Date.now, fsImpl = fs } = {}) {
        this.dir = dir;
        this.now = now;
        this.fs = fsImpl;
        if (name != null && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error(`report name "${name}": letters, digits, . _ - only`);
        const base = path.join(dir, `${name ? name + '-' : ''}${stamp(now())}`);
        let p = base, n = 1;
        while (fsImpl.existsSync(`${p}.jsonl`) || fsImpl.existsSync(`${p}.md`) || fsImpl.existsSync(`${p}.json`)) p = `${base}-${++n}`;
        this.jsonlPath = `${p}.jsonl`;
        this.mdPath = `${p}.md`;
        this.jsonPath = `${p}.json`;
        this.title = title;
        this.started = false;
    }

    _start() {
        if (this.started) return;
        this.started = true;
        this.fs.mkdirSync(this.dir, { recursive: true });
        this.fs.appendFileSync(this.mdPath, `# ${this.title}\n\nStarted ${brisbane(this.now())} (Australia/Brisbane).\n\n`);
    }

    event(obj) {
        this._start();
        this.fs.appendFileSync(this.jsonlPath, JSON.stringify({ time: brisbaneIso(this.now()), ...obj }) + '\n');
    }

    md(text) {
        this._start();
        this.fs.appendFileSync(this.mdPath, text.endsWith('\n') ? text : text + '\n');
    }

    // json writes the suite summary (replacing an earlier one of this report).
    json(obj) {
        this._start();
        this.fs.writeFileSync(this.jsonPath, JSON.stringify(obj, null, 2) + '\n');
        this.wroteJson = true;
    }

    paths() { return { md: this.mdPath, jsonl: this.jsonlPath, ...(this.wroteJson ? { json: this.jsonPath } : {}) }; }
}
