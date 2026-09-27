// Scenario data overlay (tasks/MODLAYER-DESIGN.md §1): applies a scenario folder's files over the base GameData, like a
// DW:U theme / customization set but merged instead of replaced. Not a port. Pure except for GameText.txt, which goes
// into the global text table (as loadGameData's own GameText does).

import type { GameData } from '../data/gameData';
import { resolveBuiltObjectSubRole } from '../data/gameData';
import { parseRace, type Race } from '../data/races';
import { parseEmpirePolicy, type EmpirePolicy } from '../data/policies';
import { parseDesignSpecification, type DesignSpecification } from '../data/designTemplates';
import { parseCharacterFile } from '../data/characters';
import { parseResources } from '../data/resources';
import { parseComponents } from '../data/components';
import { parseFacilities } from '../data/facilities';
import { parseFighters } from '../data/fighters';
import { parsePlagues } from '../data/plagues';
import { parseResearch } from '../data/research';
import type { BiasMatrix } from '../data/biases';
import { BuiltObjectSubRole } from '../data/names';
import { addText } from '../textResolver';
import { mergeScenarioManifests, type ScenarioManifest } from './manifest';

/** A scenario folder's content: its manifest and every overlay file (path relative to the folder → text). */
export interface ScenarioOverlay {
    manifest: ScenarioManifest;
    files: Map<string, string>;
    /** Resolved `include` overlays (resolveScenarioIncludes), applied before this one. */
    includes?: ScenarioOverlay[];
}

/**
 * Attaches the overlays named by manifest.include (recursively, from `byId`); throws on a missing id or a cycle.
 */
export function resolveScenarioIncludes(overlay: ScenarioOverlay, byId: ReadonlyMap<string, ScenarioOverlay>, seen: readonly string[] = []): ScenarioOverlay {
    const chain = [...seen, overlay.manifest.id];
    const includes = overlay.manifest.include.map((id) => {
        if (chain.includes(id)) throw new Error(`scenario include cycle: ${[...chain, id].join(' → ')}`);
        const inc = byId.get(id);
        if (inc === undefined) throw new Error(`scenario ${overlay.manifest.id} includes unknown scenario ${id}`);
        return resolveScenarioIncludes(inc, byId, chain);
    });
    return { ...overlay, includes };
}

/** GameData.scenario: what applyScenarioOverlay applied. */
export interface LoadedScenario {
    manifest: ScenarioManifest;
    /** Overlay files applied (normalised paths, sorted). */
    files: string[];
    /** Non-fatal problems (unknown files, id collisions, bias rows missing for new races, ...). */
    warnings: string[];
}

/** Normalised overlay path: forward slashes, no leading "./" or "/". */
export function normaliseOverlayPath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^(\.\/|\/)+/, '');
}

interface NamedRecord {
    name: string;
}

/**
 * Record files: an overlay record whose name matches a base record replaces it in place; the others are appended.
 * `idOf` reports id collisions of appended records.
 */
export function mergeRecordsByName<T extends NamedRecord>(base: readonly T[], overlay: readonly T[], idOf: (r: T) => number, what: string, warnings: string[]): T[] {
    const out = [...base];
    for (const rec of overlay) {
        const i = out.findIndex((r) => r.name === rec.name);
        if (i >= 0) {
            if (idOf(out[i]) !== idOf(rec)) warnings.push(`${what} "${rec.name}": overlay id ${idOf(rec)} differs from base id ${idOf(out[i])}`);
            out[i] = rec;
            continue;
        }
        if (out.some((r) => idOf(r) === idOf(rec))) warnings.push(`${what} "${rec.name}": id ${idOf(rec)} already used`);
        out.push(rec);
    }
    return out;
}

/**
 * Resource ids index arrays in the sim (resourceSystem.resources[id]), so they must run 0..n-1 with no gap. An appended
 * overlay resource whose id leaves a gap (e.g. rim-herders' 47-48, numbered to sit after rimTrade's 41-46, loaded
 * without rimTrade) is renumbered to the next free id, with a warning; packages look resources up by name. Records
 * already contiguous (every stock game, rimTrade alone, rimTrade + rim-herders) are returned unchanged.
 */
function compactResourceIds<T extends { name: string; resourceId: number }>(list: T[], warnings: string[]): T[] {
    if (list.every((r, i) => r.resourceId === i)) return list;
    const used = new Set<number>();
    const out = list.map((r) => r);
    let next = 0;
    // Keep every record whose id is already a dense prefix position; renumber the rest in list order.
    for (let i = 0; i < out.length; i++) {
        const r = out[i];
        if (r.resourceId < out.length && !used.has(r.resourceId)) {
            used.add(r.resourceId);
            continue;
        }
        while (used.has(next)) next++;
        warnings.push(`resource "${r.name}": id ${r.resourceId} renumbered to ${next} (resource ids must be contiguous)`);
        out[i] = { ...r, resourceId: next };
        used.add(next);
    }
    return out;
}

/** raceBiases.txt overlay rows: "index, Name, v0, v1, ..." — the index is ignored, rows are keyed by name. */
function parseBiasRowsByName(text: string): { name: string; values: number[] }[] {
    const rows: { name: string; values: number[] }[] = [];
    const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    for (const raw of body.split(/\r\n|\r|\n/)) {
        const t = raw.trim();
        if (t === '' || t.startsWith("'")) continue;
        const parts = t.split(',');
        if (parts.length < 3) continue;
        const name = parts[1].trim();
        const values = parts.slice(2).map((v) => {
            const n = parseInt(v.trim(), 10);
            return Math.max(-50, Math.min(50, Number.isNaN(n) ? 0 : n));
        });
        rows.push({ name, values });
    }
    return rows;
}

function cloneBias(m: BiasMatrix): BiasMatrix {
    return { names: [...m.names], matrix: m.matrix.map((r) => (r === undefined ? r : [...r])) };
}

function moveKey<V>(map: Map<string, V> | undefined, from: string, to: string): void {
    if (map === undefined || !map.has(from) || map.has(to)) return;
    const v = map.get(from)!;
    map.delete(from);
    map.set(to, v);
}

/** The `BasedOn ;<file>` line of a race overlay (first key line), or null; `rest` = the text without it. */
function basedOnFile(text: string): { file: string; rest: string } | null {
    const lines = text.split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length; i++) {
        const t = lines[i].trim();
        if (t === '' || t.startsWith("'")) continue;
        const sep = lines[i].indexOf(';');
        if (sep < 0 || lines[i].substring(0, sep).trim() !== 'BasedOn') return null;
        let file = lines[i].substring(sep + 1).trim().replace(/^races\//i, '');
        if (!/\.txt$/i.test(file)) file += '.txt';
        return { file, rest: lines.filter((_, j) => j !== i).join('\n') };
    }
    return null;
}

const RECORD_FILES = ['resources.txt', 'components.txt', 'facilities.txt', 'fighters.txt', 'plagues.txt', 'research.txt'] as const;

/**
 * Returns a new GameData with `overlay` applied over `base` (base is not mutated). Merge rules in
 * tasks/MODLAYER-DESIGN.md §1. An overlay with no files yields a GameData whose every field is deep-equal to base's
 * (plus `scenario`).
 */
export function applyScenarioOverlay(base: GameData, overlay: ScenarioOverlay): GameData {
    if (overlay.includes === undefined || overlay.includes.length === 0) {
        if (overlay.manifest.include.length > 0) throw new Error(`scenario ${overlay.manifest.id}: includes not resolved (resolveScenarioIncludes)`);
        return applyOneOverlay(base, overlay);
    }
    // Included overlays first (in order), then this one; the result carries the merged manifest.
    let gd = base;
    const files: string[] = [];
    const warnings: string[] = [];
    const manifests: ScenarioManifest[] = [];
    for (const inc of overlay.includes) {
        gd = applyScenarioOverlay(gd, inc);
        files.push(...gd.scenario!.files.map((f) => (f.includes(':') ? f : `${inc.manifest.id}:${f}`)));
        warnings.push(...gd.scenario!.warnings);
        manifests.push(gd.scenario!.manifest);
    }
    gd = applyOneOverlay(gd, overlay);
    return { ...gd, scenario: { manifest: mergeScenarioManifests(overlay.manifest, manifests), files: [...files, ...gd.scenario!.files], warnings: [...warnings, ...gd.scenario!.warnings] } };
}

function applyOneOverlay(base: GameData, overlay: ScenarioOverlay): GameData {
    const warnings: string[] = [];
    const files = new Map<string, string>();
    for (const [p, text] of overlay.files) files.set(normaliseOverlayPath(p), text);
    const paths = [...files.keys()].filter((p) => p.toLowerCase() !== 'scenario.json').sort();
    const lower = (p: string) => p.toLowerCase();
    const handled = new Set<string>();

    const races: Race[] = [...base.races];
    const policies = base.policies === undefined ? undefined : new Map(base.policies);
    const piratePolicies = base.piratePolicies === undefined ? undefined : new Map(base.piratePolicies);
    const policiesByFile = new Map(base.policiesByFile);
    const designTemplates = new Map<string, DesignSpecification>(base.designTemplates);
    const designSpecificationTexts = base.designSpecificationTexts === undefined ? undefined : new Map(base.designSpecificationTexts);
    const characterFiles = base.characterFiles === undefined ? undefined : new Map(base.characterFiles);
    const sourceTexts = base.sourceTexts === undefined ? undefined : new Map(base.sourceTexts);
    let raceBiases = base.raceBiases;
    const out: GameData = { ...base };

    // --- races/: patch (same file as a base race: key lines applied over the base text), rename, or add.
    const renames: [string, string][] = [];
    const derived: [string, string][] = []; // [parent, new] for BasedOn races
    let addedRaces = 0;
    for (const p of paths) {
        if (!lower(p).startsWith('races/')) continue;
        handled.add(p);
        // "BasedOn ;<stock race file>": a new race extending a stock race (key lines over that race's text).
        const basedOn = basedOnFile(files.get(p)!);
        if (basedOn !== null) {
            const parentText = sourceTexts?.get(`races/${basedOn.file}`.toLowerCase());
            if (parentText === undefined) {
                warnings.push(`${p}: BasedOn ${basedOn.file} is not a loaded race file`);
                continue;
            }
            const text = `${parentText}\n${basedOn.rest}`;
            const race = parseRace(text);
            const parentName = parseRace(parentText).name;
            if (race.name === '' || race.name === parentName || races.some((r) => r.name === race.name)) {
                warnings.push(`${p}: a BasedOn race needs its own new Name`);
                continue;
            }
            sourceTexts?.set(lower(p), text);
            races.push(race);
            derived.push([parentName, race.name]);
            continue;
        }
        const baseText = sourceTexts?.get(lower(p));
        const text = baseText !== undefined ? `${baseText}\n${files.get(p)!}` : files.get(p)!;
        const race = parseRace(text);
        if (race.name === '') {
            warnings.push(`${p}: no Name`);
            continue;
        }
        sourceTexts?.set(lower(p), text);
        const oldName = baseText !== undefined ? parseRace(baseText).name : race.name;
        const i = races.findIndex((r) => r.name === oldName);
        if (i >= 0) {
            races[i] = race;
            if (race.name !== oldName) {
                renames.push([oldName, race.name]);
            }
        } else {
            races.push(race);
            addedRaces++;
        }
    }
    // A renamed race inherits the old name's policies, design templates, characters and bias row.
    for (const [from, to] of renames) {
        moveKey(policies, from, to);
        moveKey(piratePolicies, from, to);
        moveKey(characterFiles, from, to);
        for (const sub of ['', 'pirate/']) moveKey(sourceTexts, `policy/${sub}${from}.txt`.toLowerCase(), `policy/${sub}${to}.txt`.toLowerCase());
        if (designSpecificationTexts !== undefined) {
            const prefix = `designTemplates/${from.toLowerCase()}/`;
            for (const key of [...designSpecificationTexts.keys()]) {
                if (!key.startsWith(prefix)) continue;
                moveKey(designSpecificationTexts, key, `designTemplates/${to.toLowerCase()}/${key.slice(prefix.length)}`);
            }
        }
        const bi = raceBiases.names.indexOf(from);
        if (bi >= 0) {
            if (raceBiases === base.raceBiases) raceBiases = cloneBias(raceBiases);
            raceBiases.names[bi] = to;
        }
    }

    // A BasedOn race starts with copies of its parent's policies, design templates and bias row / column.
    for (const [from, to] of derived) {
        const copyKey = <V>(map: Map<string, V> | undefined, a: string, b: string) => {
            if (map !== undefined && map.has(a) && !map.has(b)) map.set(b, map.get(a)!);
        };
        copyKey(policies, from, to);
        copyKey(piratePolicies, from, to);
        for (const sub of ['', 'pirate/']) copyKey(sourceTexts, `policy/${sub}${from}.txt`.toLowerCase(), `policy/${sub}${to}.txt`.toLowerCase());
        if (designSpecificationTexts !== undefined) {
            const prefix = `designTemplates/${from.toLowerCase()}/`;
            for (const key of [...designSpecificationTexts.keys()]) {
                if (key.startsWith(prefix)) copyKey(designSpecificationTexts, key, `designTemplates/${to.toLowerCase()}/${key.slice(prefix.length)}`);
            }
        }
        const bi = raceBiases.names.indexOf(from);
        if (bi >= 0 && !raceBiases.names.includes(to)) {
            if (raceBiases === base.raceBiases) raceBiases = cloneBias(raceBiases);
            const m = raceBiases.matrix;
            for (let r = 0; r < m.length; r++) if (m[r] !== undefined) m[r].push(m[r][bi] ?? 0);
            const row = [...(m[bi] ?? [])];
            row[row.length - 1] = m[bi]?.[bi] ?? 0; // its bias toward itself = the parent's toward itself
            raceBiases.names.push(to);
            m.push(row);
        }
    }

    // --- raceBiases.txt: rows merged by name, all rows padded to the name count.
    for (const p of paths) {
        if (lower(p) !== 'racebiases.txt') continue;
        handled.add(p);
        if (raceBiases === base.raceBiases) raceBiases = cloneBias(raceBiases);
        for (const row of parseBiasRowsByName(files.get(p)!)) {
            const i = raceBiases.names.indexOf(row.name);
            if (i >= 0) raceBiases.matrix[i] = row.values;
            else {
                raceBiases.names.push(row.name);
                raceBiases.matrix.push(row.values);
            }
        }
        const width = raceBiases.names.length;
        for (let i = 0; i < raceBiases.matrix.length; i++) {
            const r = raceBiases.matrix[i] ?? [];
            while (r.length < width) r.push(0);
            raceBiases.matrix[i] = r;
        }
    }
    if (addedRaces > 0 && raceBiases.names.length !== races.length) {
        warnings.push(`raceBiases: ${races.length} races but ${raceBiases.names.length} bias rows — race biases stay unpopulated (add rows in raceBiases.txt)`);
    }

    const raceByFileStem = (stem: string): Race | null => races.find((r) => r.name.toLowerCase() === stem.toLowerCase()) ?? null;

    // --- Policy/[pirate/]<Race>.txt: key lines applied over the base policy text of that race.
    for (const p of paths) {
        const m = /^policy\/(pirate\/)?([^/]+)\.txt$/i.exec(p);
        if (m === null) continue;
        handled.add(p);
        const isPirate = m[1] !== undefined;
        const race = raceByFileStem(m[2]);
        const raceName = race?.name ?? m[2];
        const key = `policy/${isPirate ? 'pirate/' : ''}${raceName}.txt`.toLowerCase();
        const baseText = sourceTexts?.get(key);
        const text = baseText !== undefined ? `${baseText}\n${files.get(p)!}` : files.get(p)!;
        sourceTexts?.set(key, text);
        const policy: EmpirePolicy = parseEmpirePolicy(text);
        policiesByFile.set(`${isPirate ? 'pirate/' : ''}${raceName}.txt`, policy);
        const target = isPirate ? piratePolicies : policies;
        if (race === null) warnings.push(`${p}: no race named "${m[2]}"`);
        target?.set(raceName, parseEmpirePolicy(text));
    }

    // --- designTemplates/: DEFAULT/<subRole>.txt → designTemplates; <race>/[pirate/]<subRole>.txt → per-race texts.
    for (const p of paths) {
        const m = /^designtemplates\/(.+)$/i.exec(p);
        if (m === null) continue;
        handled.add(p);
        const rest = m[1];
        const d = /^default\/([^/]+)\.txt$/i.exec(rest);
        if (d !== null) {
            const subRole = resolveBuiltObjectSubRole(d[1]);
            if (subRole === BuiltObjectSubRole.Undefined) {
                warnings.push(`${p}: unknown sub role`);
                continue;
            }
            // Keyed like loadGameData (the DEFAULT folder's file name as listed).
            const existing = [...designTemplates.keys()].find((k) => k.toLowerCase() === d[1].toLowerCase()) ?? d[1];
            designTemplates.set(existing, parseDesignSpecification(files.get(p)!, existing, subRole, true));
            continue;
        }
        designSpecificationTexts?.set(`designTemplates/${rest.toLowerCase()}`, files.get(p)!);
    }

    // --- characters/<Race>.txt.
    for (const p of paths) {
        const m = /^characters\/([^/]+)\.txt$/i.exec(p);
        if (m === null) continue;
        handled.add(p);
        const race = raceByFileStem(m[1]);
        if (race === null) warnings.push(`${p}: no race named "${m[1]}"`);
        characterFiles?.set(race?.name ?? m[1], parseCharacterFile(files.get(p)!, `characters/${race?.name ?? m[1]}.txt`));
    }

    // --- Record files merged by name.
    for (const p of paths) {
        const name = lower(p) as (typeof RECORD_FILES)[number];
        if (!RECORD_FILES.includes(name)) continue;
        handled.add(p);
        const text = files.get(p)!;
        switch (name) {
            case 'resources.txt':
                out.resources = compactResourceIds(mergeRecordsByName(base.resources, parseResources(text), (r) => r.resourceId, 'resource', warnings), warnings);
                break;
            case 'components.txt':
                out.components = mergeRecordsByName(base.components, parseComponents(text), (r) => r.componentId, 'component', warnings);
                break;
            case 'facilities.txt':
                out.facilities = mergeRecordsByName(base.facilities, parseFacilities(text), (r) => r.facilityId, 'facility', warnings);
                break;
            case 'fighters.txt':
                out.fighters = mergeRecordsByName(base.fighters, parseFighters(text), (r) => r.fighterId, 'fighter', warnings);
                break;
            case 'plagues.txt':
                out.plagues = mergeRecordsByName(base.plagues, parsePlagues(text), (r) => r.plagueId, 'plague', warnings);
                break;
            case 'research.txt':
                out.research = mergeRecordsByName(base.research, parseResearch(text), (r) => r.projectId, 'research project', warnings);
                break;
        }
    }

    // --- GameText.txt: tags added / overridden in the global text table.
    for (const p of paths) {
        if (lower(p) !== 'gametext.txt') continue;
        handled.add(p);
        addText(files.get(p)!);
    }

    for (const p of paths) if (!handled.has(p)) warnings.push(`${p}: not an overlayable file (ignored)`);

    out.races = races;
    out.raceBiases = raceBiases;
    out.policiesByFile = policiesByFile;
    out.designTemplates = designTemplates;
    if (policies !== undefined) out.policies = policies;
    if (piratePolicies !== undefined) out.piratePolicies = piratePolicies;
    if (designSpecificationTexts !== undefined) out.designSpecificationTexts = designSpecificationTexts;
    if (characterFiles !== undefined) out.characterFiles = characterFiles;
    if (sourceTexts !== undefined) out.sourceTexts = sourceTexts;
    out.scenario = { manifest: overlay.manifest, files: paths, warnings };
    return out;
}
