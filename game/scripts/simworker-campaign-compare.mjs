#!/usr/bin/env node
// Compare two campaign runs (scripts/simworker-campaign.mjs <out>/campaign.json), e.g. worker against in-thread: the
// checks that passed in one and not the other, the steps' journaled ops that differ, popups, console errors, timings.
//   node scripts/simworker-campaign-compare.mjs <a/campaign.json> <b/campaign.json>
import { readFileSync } from 'node:fs';
const [fa, fb] = process.argv.slice(2);
const a = JSON.parse(readFileSync(fa, 'utf8'));
const b = JSON.parse(readFileSync(fb, 'utf8'));
const key = (r) => `${r.step} | ${r.what.replace(/in the worker|in-thread|inthread|worker/g, '<mode>').replace(/[\d.]+/g, '#').replace(/\(.*\)/g, '()').slice(0, 90)}`;
const map = (x) => {
    const m = new Map();
    for (const r of x.results) if ('ok' in r) m.set(key(r), (m.get(key(r)) ?? true) && r.ok);
    return m;
};
const ma = map(a), mb = map(b);
console.log(`${a.kind}/${a.mode}: ${a.results.filter((r) => r.ok === true).length} ok, ${a.failed} failed, ${(a.wallS / 60).toFixed(1)} min, played ${(a.playedMs / 1000).toFixed(0)} game s`);
console.log(`${b.kind}/${b.mode}: ${b.results.filter((r) => r.ok === true).length} ok, ${b.failed} failed, ${(b.wallS / 60).toFixed(1)} min, played ${(b.playedMs / 1000).toFixed(0)} game s`);
console.log('\nchecks that differ:');
for (const k of new Set([...ma.keys(), ...mb.keys()])) {
    const x = ma.get(k), y = mb.get(k);
    if (x === y) continue;
    console.log(`  ${k}: ${a.mode} ${x === undefined ? '-' : x ? 'ok' : 'FAIL'} / ${b.mode} ${y === undefined ? '-' : y ? 'ok' : 'FAIL'}`);
}
console.log('\nops per step (where they differ):');
const sa = new Map(a.steps.map((s) => [s.name, s])), sb = new Map(b.steps.map((s) => [s.name, s]));
const norm = (ops) => [...new Set(ops)].sort().join(',');
for (const [n, s] of sa) {
    const t = sb.get(n);
    if (!t) continue;
    if (norm(s.ops) !== norm(t.ops)) console.log(`  ${n}: ${a.mode} [${norm(s.ops)}] / ${b.mode} [${norm(t.ops)}]`);
}
console.log('\nstep wall time (s), worst ratios:');
const ratios = [...sa].filter(([n]) => sb.has(n) && !/^play|crash|replay|restart/.test(n)).map(([n, s]) => [n, s.ms / 1000, sb.get(n).ms / 1000]).sort((x, y) => y[1] / Math.max(0.1, y[2]) - x[1] / Math.max(0.1, x[2]));
for (const [n, x, y] of ratios.slice(0, 8)) console.log(`  ${n}: ${a.mode} ${x.toFixed(1)} / ${b.mode} ${y.toFixed(1)}`);
const errs = (x) => x.consoleLines.filter((l) => (l.type === 'error' || l.type === 'pageerror') && !l.expected);
console.log(`\nconsole errors: ${a.mode} ${errs(a).length}, ${b.mode} ${errs(b).length}; warnings: ${a.consoleLines.filter((l) => l.type === 'warning').length} / ${b.consoleLines.filter((l) => l.type === 'warning').length}`);
for (const e of [...errs(a), ...errs(b)].slice(0, 20)) console.log(`  [${e.step}] ${e.text.slice(0, 200)}`);
console.log(`popups: ${a.mode} ${a.popupsSeen.length} (choices ${a.choicesTaken}, tribute ${a.pirateTributeTaken}) / ${b.mode} ${b.popupsSeen.length} (choices ${b.choicesTaken}, tribute ${b.pirateTributeTaken})`);
