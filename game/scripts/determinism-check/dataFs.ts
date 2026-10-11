// The DW:U game data from a folder for the determinism-check scripts (runner.ts, lockstepPeer.ts): test/helpers/
// loadGameDataFs.ts with the folder as an argument and no repo checkout.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadGameData, type FetchText, type GameData } from '../../src/sim/data/gameData';

// --- Game data from a folder (test/helpers/loadGameDataFs.ts, with the folder as an argument). Every file read is
// fingerprinted (path + content) so a data mismatch between the machines is told apart from a sim divergence.
export async function loadData(root: string, listFiles = false): Promise<{ data: GameData; fingerprint: string; files: number }> {
    const reads = new Map<string, string>();
    const fetchText: FetchText = async (candidates: string[]) => {
        for (const c of candidates) {
            const rel = decodeURIComponent(c.replace(/^\/assets\/dwu\/?/, ''));
            const p = resolve(root, rel);
            if (!existsSync(p)) continue;
            const text = readFileSync(p, 'utf-8');
            reads.set(rel, text);
            return text;
        }
        throw new Error(`Could not load any of: ${candidates.join(', ')}`);
    };
    const txt = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.txt')).sort() : []);
    const races = txt(resolve(root, 'races'));
    const templates = txt(resolve(root, 'designTemplates', 'DEFAULT')).map((f) => f.replace(/\.txt$/, ''));
    const policyDir = resolve(root, 'Policy');
    const policies = existsSync(policyDir) ? readdirSync(policyDir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.txt')).map((e) => e.name).sort() : [];
    policies.push(...txt(resolve(policyDir, 'pirate')).map((f) => `pirate/${f}`));
    const data = await loadGameData(fetchText, undefined, races, templates, policies);
    const h = createHash('sha1');
    // Paths lower-cased: a case-insensitive file system (macOS) opens the first candidate spelling, Linux a later one.
    const keys = [...reads.keys()].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0));
    for (const k of keys) {
        h.update(`${k.toLowerCase()}\0${reads.get(k)!}\0`);
        if (listFiles) console.log(`# file ${createHash('sha1').update(reads.get(k)!).digest('hex').slice(0, 12)} ${k}`);
    }
    return { data, fingerprint: h.digest('hex'), files: reads.size };
}
