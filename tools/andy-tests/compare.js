#!/usr/bin/env node
/* global process */
// npm run game-test:compare -- <a.json> <b.json>
// Compares two suite summaries (the .json next to a game-test report): per
// test, a's and b's result, seconds and via, and whether b is better, worse
// or the same. Exit code 1 when any test got worse.
import fs from 'fs';
import path from 'path';

// pass beats fail beats error; skip (and a test only one run has) is not
// ranked: it shows as "skip"/"new"/"gone", never better or worse.
const RANK = { pass: 2, fail: 1, error: 0 };

export function loadSummary(file) {
    let doc;
    try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${file}: ${e.message}`); }
    const tests = Array.isArray(doc) ? doc : doc.tests;
    if (!Array.isArray(tests)) throw new Error(`${file}: no "tests" list (is it a game-test summary .json?)`);
    return { ...(Array.isArray(doc) ? {} : doc), tests };
}

export function compare(a, b) {
    const ia = new Map(a.tests.map(t => [t.test, t])), ib = new Map(b.tests.map(t => [t.test, t]));
    const names = [...a.tests.map(t => t.test), ...b.tests.map(t => t.test).filter(n => !ia.has(n))];
    const rows = names.map(name => {
        const x = ia.get(name), y = ib.get(name);
        let change;
        if (!x) change = 'new';
        else if (!y) change = 'gone';
        else if (!(x.result in RANK) || !(y.result in RANK)) change = x.result === y.result ? 'same' : 'skip';
        else change = RANK[y.result] > RANK[x.result] ? 'better' : RANK[y.result] < RANK[x.result] ? 'worse' : 'same';
        const viaChanged = !!(x && y && (x.via || '') !== (y.via || ''));
        return { test: name, a: x || null, b: y || null, change, viaChanged };
    });
    const count = k => rows.filter(r => r.change === k).length;
    const passes = s => s.tests.filter(t => t.result === 'pass').length;
    return { rows, totals: { better: count('better'), worse: count('worse'), same: count('same'), other: rows.length - count('better') - count('worse') - count('same'), passA: passes(a), passB: passes(b), nA: a.tests.length, nB: b.tests.length } };
}

const cell = t => (t ? `${t.result.toUpperCase()} ${Number(t.seconds ?? 0).toFixed(1)}s ${t.via || ''}`.trim() : '—');

export function table(cmp, { nameA = 'a', nameB = 'b' } = {}) {
    const head = ['Test', nameA, nameB, 'Change'];
    const body = cmp.rows.map(r => [r.test, cell(r.a), cell(r.b), r.change + (r.viaChanged ? ' (via changed)' : '')]);
    const w = head.map((h, i) => Math.max(h.length, ...body.map(row => row[i].length)));
    const line = row => row.map((c, i) => c.padEnd(w[i])).join('  ').trimEnd();
    const t = cmp.totals;
    return [line(head), w.map(n => '-'.repeat(n)).join('  '), ...body.map(line), '',
        `${nameA}: ${t.passA}/${t.nA} pass   ${nameB}: ${t.passB}/${t.nB} pass   better ${t.better}, worse ${t.worse}, same ${t.same}${t.other ? `, other ${t.other}` : ''}`].join('\n');
}

function main() {
    const files = process.argv.slice(2).filter(a => !a.startsWith('-'));
    if (files.length !== 2) { console.error('usage: npm run game-test:compare -- <a.json> <b.json>'); return 2; }
    const [a, b] = files.map(loadSummary);
    const cmp = compare(a, b);
    console.log(table(cmp, { nameA: path.basename(files[0], '.json'), nameB: path.basename(files[1], '.json') }));
    return cmp.totals.worse ? 1 : 0;
}

if (process.argv[1]?.endsWith('compare.js')) {
    try { process.exit(main()); } catch (e) { console.error(e.message); process.exit(2); }
}
