#!/usr/bin/env node
// Summarise a V8 .heapsnapshot (scripts/mem-probe.mjs --snapshot, DevTools) without DevTools: shallow size and count
// by node type + constructor name (DevTools' Summary, shallow column), and for the biggest groups the owner each node
// hangs from (its first non-weak retainer: "<owner constructor>.<edge name>"), so e.g. Float64Arrays are attributed to
// the class field that holds them. Streams the numbers out of the file (a 2 GB snapshot is fine with
// node --max-old-space-size=6000).
//   node scripts/heapsnapshot-summary.mjs <file> [--top 40] [--owners 12] [--ownersOf name1,name2]
import { openSync, readSync, fstatSync, closeSync } from 'node:fs';

const file = process.argv[2];
const opt = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i < 0 ? d : process.argv[i + 1]; };
const TOP = Number(opt('top', 40));
const OWNERS = Number(opt('owners', 12));
const ownersOf = opt('ownersOf', '') ? opt('ownersOf', '').split(',') : null;

const fd = openSync(file, 'r');
const size = fstatSync(fd).size;
const BUF = 1 << 24;
const buf = Buffer.alloc(BUF);
let bufStart = 0;
let bufLen = 0;
let pos = 0;
function byteAt(p) {
    if (p < bufStart || p >= bufStart + bufLen) {
        bufStart = p;
        bufLen = readSync(fd, buf, 0, BUF, p);
        if (bufLen <= 0) return -1;
    }
    return buf[p - bufStart];
}
function readStr(p, n) {
    const b = Buffer.alloc(n);
    const k = readSync(fd, b, 0, n, p);
    return b.subarray(0, k).toString('utf8');
}
function find(token, from) {
    // Scan forward for an ASCII token.
    const t = Buffer.from(token);
    let p = from;
    const chunk = Buffer.alloc(1 << 22);
    for (;;) {
        const k = readSync(fd, chunk, 0, chunk.length, p);
        if (k <= 0) return -1;
        const i = chunk.subarray(0, k).indexOf(t);
        if (i >= 0) return p + i;
        if (k < t.length) return -1;
        p += k - t.length;
    }
}
// Header: {"snapshot":{"meta":{...},"node_count":N,"edge_count":M,...}
const nodesAt = find('"nodes":[', 0);
const head = JSON.parse(readStr(0, nodesAt).replace(/,\s*$/, '').replace(/^\{/, '{') + '}');
const meta = head.snapshot.meta;
const NF = meta.node_fields.length;
const EF = meta.edge_fields.length;
const nodeTypes = meta.node_types[0];
const edgeTypes = meta.edge_types[0];
const nTypeI = meta.node_fields.indexOf('type');
const nNameI = meta.node_fields.indexOf('name');
const nSizeI = meta.node_fields.indexOf('self_size');
const nEdgesI = meta.node_fields.indexOf('edge_count');
const eTypeI = meta.edge_fields.indexOf('type');
const eNameI = meta.edge_fields.indexOf('name_or_index');
const eToI = meta.edge_fields.indexOf('to_node');
const nodeCount = head.snapshot.node_count;
const edgeCount = head.snapshot.edge_count;

function parseInts(at, out) {
    pos = at;
    let n = 0;
    let v = 0;
    let inNum = false;
    for (;;) {
        const c = byteAt(pos++);
        if (c >= 48 && c <= 57) {
            v = v * 10 + (c - 48);
            inNum = true;
        } else {
            if (inNum) {
                out[n++] = v;
                v = 0;
                inNum = false;
            }
            if (c === 93 /* ] */ || c < 0) break;
        }
    }
    return n;
}
const nodes = new Float64Array(nodeCount * NF);
parseInts(nodesAt + 9, nodes);
const edgesAt = find('"edges":[', pos);
const edges = new Uint32Array(edgeCount * EF);
parseInts(edgesAt + 9, edges);
const stringsAt = find('"strings":[', pos);
// The strings array runs to the end of the file: "strings":[ ... ]}
const tail = readStr(stringsAt + 10, size - stringsAt - 10).replace(/\}\s*$/, '');
const strings = JSON.parse(tail);
closeSync(fd);

// Node names: for objects the constructor, for strings the text (grouped as "(string)").
const label = (i) => {
    const t = nodeTypes[nodes[i * NF + nTypeI]];
    const name = strings[nodes[i * NF + nNameI]];
    if (t === 'string' || t === 'concatenated string' || t === 'sliced string') return `(${t})`;
    if (t === 'number') return '(heap number)';
    if (t === 'code') return '(code)';
    if (t === 'array') return `(array) ${name.length > 40 ? '' : name}`;
    if (t === 'hidden' || t === 'object shape') return `(${t}) ${name.split(' ')[0]}`;
    if (t === 'closure') return `(closure) ${name}`;
    return `${t === 'object' ? '' : `(${t}) `}${name.length > 60 ? `${name.slice(0, 57)}...` : name}`;
};
const groups = new Map();
let total = 0;
for (let i = 0; i < nodeCount; i++) {
    const s = nodes[i * NF + nSizeI];
    total += s;
    const k = label(i);
    const g = groups.get(k) ?? { n: 0, size: 0 };
    g.n++;
    g.size += s;
    groups.set(k, g);
}
const mb = (b) => `${(b / 1048576).toFixed(1).padStart(8)} MB`;
console.log(`${file}: ${nodeCount} nodes, ${edgeCount} edges, ${mb(total)} shallow total`);
const top = [...groups].sort((a, b) => b[1].size - a[1].size).slice(0, TOP);
for (const [k, g] of top) console.log(`${mb(g.size)} ${String(g.n).padStart(10)}  ${k}`);

// First non-weak retainer of every node.
const firstEdge = new Uint32Array(nodeCount + 1);
for (let i = 0, e = 0; i < nodeCount; i++) {
    firstEdge[i] = e;
    e += nodes[i * NF + nEdgesI];
}
firstEdge[nodeCount] = edgeCount;
const parent = new Int32Array(nodeCount).fill(-1);
const parentEdge = new Int32Array(nodeCount).fill(-1);
for (let i = 0; i < nodeCount; i++) {
    for (let e = firstEdge[i]; e < firstEdge[i + 1]; e++) {
        const et = edgeTypes[edges[e * EF + eTypeI]];
        if (et === 'weak' || et === 'shortcut') continue;
        const to = edges[e * EF + eToI] / NF;
        if (parent[to] === -1) {
            parent[to] = i;
            parentEdge[to] = e;
        }
    }
}
const edgeName = (e) => {
    const et = edgeTypes[edges[e * EF + eTypeI]];
    const v = edges[e * EF + eNameI];
    return et === 'element' || et === 'hidden' ? `[${et}]` : strings[v];
};
const which = ownersOf ?? top.slice(0, OWNERS).map(([k]) => k);
for (const k of which) {
    const by = new Map();
    for (let i = 0; i < nodeCount; i++) {
        if (label(i) !== k) continue;
        let p = parent[i];
        let pe = parentEdge[i];
        // Through arrays / internal nodes up to a named owner (at most 3 hops).
        let path = '';
        for (let hop = 0; hop < 3 && p >= 0; hop++) {
            const t = nodeTypes[nodes[p * NF + nTypeI]];
            path = `${edgeName(pe)}${path ? `/${path}` : ''}`;
            if (t === 'object' || t === 'closure' || t === 'native') break;
            pe = parentEdge[p];
            p = parent[p];
        }
        const ok = p >= 0 ? `${label(p)}.${path}` : '(root)';
        const g = by.get(ok) ?? { n: 0, size: 0 };
        g.n++;
        g.size += nodes[i * NF + nSizeI];
        by.set(ok, g);
    }
    console.log(`\n== owners of ${k}`);
    for (const [o, g] of [...by].sort((a, b) => b[1].size - a[1].size).slice(0, 10)) console.log(`${mb(g.size)} ${String(g.n).padStart(10)}  ${o}`);
}
