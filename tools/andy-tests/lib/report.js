// A report: <dir>/<Brisbane stamp>.jsonl (one event per line) and .md, both
// appended as things happen so a session that dies half way is still readable.
import fs from 'fs';
import path from 'path';
import { stamp, brisbane, brisbaneIso } from './time.js';

export class Report {
    constructor(dir, { title = 'Andy game tests', now = Date.now, fsImpl = fs } = {}) {
        this.dir = dir;
        this.now = now;
        this.fs = fsImpl;
        const base = path.join(dir, stamp(now()));
        let p = base, n = 1;
        while (fsImpl.existsSync(`${p}.jsonl`) || fsImpl.existsSync(`${p}.md`)) p = `${base}-${++n}`;
        this.jsonlPath = `${p}.jsonl`;
        this.mdPath = `${p}.md`;
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

    paths() { return { md: this.mdPath, jsonl: this.jsonlPath }; }
}
