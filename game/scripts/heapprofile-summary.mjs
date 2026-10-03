#!/usr/bin/env node
// Summarise a sampling heap profile (.heapprofile: node --heap-prof, or scripts/profile-save.mjs --alloc-prof):
// sampled bytes allocated per function (self) and per call subtree (inclusive).
//   node scripts/heapprofile-summary.mjs <file> [--top 30] [--under fnName]
import { readFileSync } from 'node:fs';

const p = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const opt = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const top = Number(opt('top', 30));
const under = opt('under', null);
const key = (cf) => `${cf.functionName || '(anon)'} ${cf.url.replace(/^.*dwu-profile-sim-[^/]+\//, '').replace(/^file:\/\/.*\/node_modules\//, 'nm/')}:${cf.lineNumber + 1}`;
const self = new Map();
const incl = new Map();
const walk = (n, inside, seen) => {
    const k = key(n.callFrame);
    const ins = inside || under === null || n.callFrame.functionName === under;
    if (ins) self.set(k, (self.get(k) ?? 0) + n.selfSize);
    let sum = ins ? n.selfSize : 0;
    const again = seen.has(k);
    seen.add(k);
    for (const c of n.children) sum += walk(c, ins, seen);
    if (!again) seen.delete(k);
    if (ins && !again) incl.set(k, (incl.get(k) ?? 0) + sum);
    return sum;
};
const total = walk(p.head, false, new Set());
const mb = (b) => `${(b / 1048576).toFixed(1).padStart(8)} MB ${((100 * b) / total).toFixed(1).padStart(5)}%`;
console.log(`${process.argv[2]}: ${(total / 1048576).toFixed(1)} MB sampled${under ? ` under ${under}` : ''}`);
console.log(`\n== top ${top} self`);
for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`${mb(v)}  ${k}`);
console.log(`\n== top ${top} inclusive`);
for (const [k, v] of [...incl].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`${mb(v)}  ${k}`);
