// The Intelligence screen's "Knowledge" page (Beacon / Great Work add-on): what the viewing empire has found or already knows about the
// Reclaimers' war, as lists and short tips. Not a port. No DOM; read-only: never creates scenario state, never draws.
// Nothing here is read from state the viewer does not know: every row comes from the same per-empire knowledge the threat list and the map use
// (beaconKnownSites, knownCores, giantworksCompactSites, giantworksKnownSites, the Watcher sightings the viewer's sensors made).
//
// Hooks for sections other branches fill (registerKnowledgeSection): the mega-station components and blueprint progress, foundries found,
// Doppelganger sleeper warnings and the Age 2 memory record ("What We Remember"). A section whose provider is absent or returns null is hidden.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { Habitat } from '../sim/types';
import type { BuiltObject } from '../sim/builtObject';
import { scenarioText } from '../sim/scenario/messages';
import { galaxyStarDate } from '../sim/tick/simTime';
import { GAME_DAY_LENGTH } from '../sim/scenario/hooks';
import { resolveStarDateDescription } from '../sim/galaxyTime';
import { peekThreatState } from '../sim/scenario/threats/framework';
import { beaconKnownSites } from '../sim/scenario/threats/giantworks/beacon';
import { peekBeaconState, warOn, type BeaconState } from '../sim/scenario/threats/giantworks/beaconState';
import { beaconArtInfo, knownCores } from '../sim/scenario/threats/giantworks/beaconHarvest';
import { eliminatedPct } from '../sim/scenario/threats/giantworks/beaconFleet';
import { giantworksCompactSites, giantworksKnownSites } from '../sim/scenario/threats/giantworks/knowledge';
import { sightingLogOf } from '../render/beaconCloakFx';
import { peekGwState } from '../sim/scenario/threats/giantworks/state';
import { megaKnowledgeRows } from '../sim/scenario/threats/giantworks/megaStation';
import { foundriesKnownTo } from '../sim/scenario/threats/giantworks/beaconFoundry';
import { memoryRecordOf } from '../sim/scenario/threats/giantworks/longNightState';

/** The Galactopedia article on the Great Works (expansionArticles.ts). */
export const KNOWLEDGE_ARTICLE = 'The Great Work (Giantworks)';

/** A row of a section: `goTo` an object to centre the map on, or `point` (a sighting) when there is none. */
export interface KnowledgeRow {
    key: string;
    what: string;
    where: string;
    status: string;
    goTo: Habitat | BuiltObject | null;
    point: { x: number; y: number } | null;
    /** 0..1 (sightings fade as they age); 1 for everything else. */
    fade: number;
}

export interface KnowledgeSection {
    id: string;
    title: string;
    rows: KnowledgeRow[];
}

export interface KnowledgeView {
    /** The war at a glance (empty before the first mega beam: the war is public from then on). */
    war: string[];
    sections: KnowledgeSection[];
    /** Recommended moves unlocked by what is known (resolved texts). */
    tips: string[];
    /** The Galactopedia article to link (null: none). */
    article: string | null;
}

/** Whether the page is offered: the Great Works are in this game. */
export function knowledgeVisible(galaxy: Galaxy): boolean {
    return peekGwState(galaxy) !== null || peekBeaconState(galaxy) !== null;
}

// ---------------------------------------------------------------------------------------------------------------
// Hooks for other branches' sections
// ---------------------------------------------------------------------------------------------------------------

export type KnowledgeSectionProvider = (galaxy: Galaxy, empire: Empire) => KnowledgeRow[] | null;

const providers = new Map<string, { title: string; provider: KnowledgeSectionProvider }>();

/** A module adds (or replaces) a section: its rows for the viewer, or null to hide it. Sections list in registration order after the built-in ones. */
export function registerKnowledgeSection(id: string, title: string, provider: KnowledgeSectionProvider): void {
    providers.set(id, { title, provider });
}

/** A plain row for a provider (no map target). */
export function knowledgeRow(key: string, what: string, where = '', status = ''): KnowledgeRow {
    return { key, what, where, status, goTo: null, point: null, fade: 1 };
}

/** The scenario state `key` as a loose record (absent: null). Hooks read their branch's state with it, defensively. */
function looseState(galaxy: Galaxy, key: string): Record<string, unknown> | null {
    const s = peekThreatState<unknown>(galaxy, key);
    return s !== null && typeof s === 'object' ? (s as Record<string, unknown>) : null;
}

// Mega-station components + blueprint progress (wip/megapath adds the state), foundries found (wip/foundries) and the Doppelganger sleeper
// warnings have no state in this branch: empty hooks, registered by those modules. The Age 2 memory record reads the Long Night's state
// (scenario state `longNight`, a `memory` list of strings: "What We Remember") when it exists.
registerKnowledgeSection('megaStation', 'The Severance', (g, e) => megaKnowledgeRows(g, e));
registerKnowledgeSection('foundries', 'Foundries', (g, e) => {
    const st = peekBeaconState(g);
    if (st === null) return null;
    const rows = foundriesKnownTo(st, e).map((f): KnowledgeRow => ({
        ...knowledgeRow(`foundry:${f.id}`, scenarioText('Beacon Foundry Name', f.id), '', f.status === 'destroyed' ? 'destroyed' : f.knowledge.some((k) => k.empireId === e.empireId && k.level >= 3) ? scenarioText('Beacon Foundry Status Intel', Math.round(f.intel[String(e.empireId)]?.guard ?? 0), f.intel[String(e.empireId)]?.built ?? f.built) : scenarioText('Beacon Foundry Status')),
        goTo: f.status === 'destroyed' ? null : f.base,
        point: { x: f.x, y: f.y },
    }));
    return rows.length > 0 ? rows : null;
});
registerKnowledgeSection('sleepers', 'Sleeper warnings', () => null); // TODO(doppelgangers): sleeper warnings the viewer has
registerKnowledgeSection('ageMemory', 'What We Remember', (galaxy) => {
    const mem = memoryRecordOf(galaxy);
    if (mem === null) return null;
    const rows: KnowledgeRow[] = [knowledgeRow('memory:age', `Age ${mem.age}`, '', `${Math.round(mem.eliminatedPct)}% of the old galaxy's people were taken before the Long Night`)];
    for (const [i, sc] of mem.scars.entries()) rows.push({ ...knowledgeRow(`memory:scar:${i}`, sc.name, sc.systemName, 'a harvest world of the old age'), point: { x: sc.x, y: sc.y } });
    for (const [i, f] of mem.foundries.located.entries()) rows.push({ ...knowledgeRow(`memory:found:${i}`, f.name, '', 'a foundry we found before the Long Night'), point: { x: f.x, y: f.y } });
    for (const [i, f] of mem.foundries.destroyed.entries()) rows.push({ ...knowledgeRow(`memory:gone:${i}`, f.name, '', 'destroyed before the Long Night'), point: { x: f.x, y: f.y } });
    return rows;
});

// ---------------------------------------------------------------------------------------------------------------
// Watcher sightings (the viewer's own detections of a cloaked Watcher; kept per galaxy while the page renders)
// ---------------------------------------------------------------------------------------------------------------

const SIGHTING_FADE_DAYS = 180;
const SIGHTING_FLOOR = 0.35;

function systemNear(galaxy: Galaxy, o: { xpos: number; ypos: number }): string {
    let best = '';
    let bd = Infinity;
    for (const sys of galaxy.systems) {
        const s = sys?.systemStar ?? null;
        if (s === null) continue;
        const d = galaxy.calculateDistance(o.xpos, o.ypos, s.xpos, s.ypos);
        if (d < bd) {
            bd = d;
            best = s.name;
        }
    }
    return best;
}

function sightingRows(galaxy: Galaxy, viewer: Empire, now: number): KnowledgeRow[] {
    const log = sightingLogOf(viewer);
    const rows: KnowledgeRow[] = [];
    log.forEach((s, index) => {
        const ageDays = Math.max(0, (now - s.date) / GAME_DAY_LENGTH);
        rows.push({
            key: `sighting:${index}`,
            what: scenarioText('Knowledge Sighting Row'),
            where: systemNear(galaxy, { xpos: s.x, ypos: s.y }),
            status: scenarioText('Knowledge Sighting Status', resolveStarDateDescription(s.date)),
            goTo: null,
            point: { x: s.x, y: s.y },
            fade: Math.max(SIGHTING_FLOOR, 1 - ageDays / SIGHTING_FADE_DAYS),
        });
    });
    return rows.sort((a, b) => b.fade - a.fade);
}

// ---------------------------------------------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------------------------------------------

function placeOf(galaxy: Galaxy, t: Habitat | BuiltObject): string {
    const h = t as Habitat;
    if (h.systemIndex !== undefined && h.systemIndex >= 0 && galaxy.systems[h.systemIndex]?.systemStar !== undefined) return galaxy.systems[h.systemIndex].systemStar!.name;
    return systemNear(galaxy, t);
}

function millions(n: number): string {
    return `${Math.round(n / 1e6).toLocaleString('en-US')} million`;
}

/** The war at a glance, line by line; [] before the war began. Public information (the beam and its news reach everyone). */
function warLines(galaxy: Galaxy, st: BeaconState): string[] {
    if (!warOn(st)) return [];
    const now = galaxyStarDate(galaxy);
    const art = beaconArtInfo(galaxy, st);
    const lines: string[] = [];
    if (art.phase === 'dead') return [scenarioText('Knowledge War Over')];
    lines.push(scenarioText('Knowledge War Phase', scenarioText(`Knowledge Phase ${art.phase}`), art.season));
    if (art.launchAt > now) lines.push(scenarioText('Knowledge War Launch', Math.max(1, Math.ceil((art.launchAt - now) / GAME_DAY_LENGTH))));
    lines.push(scenarioText('Knowledge War Eliminated', eliminatedPct(st).toFixed(1)));
    lines.push(scenarioText('Knowledge War Taken', millions(st.popEliminated), millions((st.stats.captivesFreed ?? 0) + (st.stats.captivesRescued ?? 0))));
    lines.push(scenarioText('Knowledge War Worlds', st.stats.conquests, st.stats.retaken ?? 0));
    return lines;
}

export function knowledgeView(galaxy: Galaxy, empire: Empire): KnowledgeView {
    const st = peekBeaconState(galaxy);
    const now = galaxyStarDate(galaxy);
    const sections: KnowledgeSection[] = [];
    const tips: string[] = [];
    const add = (id: string, title: string, rows: KnowledgeRow[]): void => {
        if (rows.length > 0) sections.push({ id, title, rows });
    };
    const row = (key: string, what: string, target: Habitat | BuiltObject, status: string): KnowledgeRow => ({ key, what, where: placeOf(galaxy, target), status, goTo: target, point: null, fade: 1 });

    let beaconKnown = false;
    let coresKnown = 0;
    let harvesters = 0;
    let stagingKnown = 0;
    let corruptedKnown = 0;
    let watchersKnown = 0;
    if (st !== null && st.faction !== null) {
        const known = beaconKnownSites(galaxy, empire);
        const cores = knownCores(st, empire);
        const beacon: KnowledgeRow[] = [];
        const coreRows: KnowledgeRow[] = [];
        const harvesterRows: KnowledgeRow[] = [];
        const stagingRows: KnowledgeRow[] = [];
        const corruptRows: KnowledgeRow[] = [];
        const watcherRows: KnowledgeRow[] = [];
        for (const s of known) {
            const status = s.status ?? '';
            if (s.target === st.beacon) beacon.push(row('beacon', s.label, s.target, status));
            else if (cores.some((c) => c.colony === s.target)) coreRows.push(row(`core:${(s.target as Habitat).name}`, s.label, s.target, status));
            else if (st.corrupted.some((c) => c.colony === s.target)) corruptRows.push(row(`corrupt:${(s.target as Habitat).name}`, s.label, s.target, status));
            else if (st.watchers.some((w) => w.ship === s.target)) watcherRows.push(row(`watcher:${watcherRows.length}`, s.label, s.target, status));
            else if (st.season?.staging.some((p) => p === s.site) === true) stagingRows.push(row(`staging:${stagingRows.length}`, s.label, s.target, status));
        }
        for (const c of cores) {
            if (c.harvester !== null && !c.harvester.hasBeenDestroyed) harvesterRows.push(row(`harvester:${c.colony.name}`, scenarioText('Knowledge Harvester Row', c.colony.name), c.harvester, scenarioText('Knowledge Harvester Status')));
        }
        beaconKnown = beacon.length > 0;
        coresKnown = coreRows.length;
        harvesters = harvesterRows.length;
        stagingKnown = stagingRows.length;
        corruptedKnown = corruptRows.length;
        watchersKnown = watcherRows.length;
        add('beacon', scenarioText('Knowledge Section Beacon'), beacon);
        add('cores', scenarioText('Knowledge Section Cores'), coreRows);
        add('harvesters', scenarioText('Knowledge Section Harvesters'), harvesterRows);
        add('staging', scenarioText('Knowledge Section Staging'), stagingRows);
        add('corrupted', scenarioText('Knowledge Section Corrupted'), corruptRows);
        add('watchers', scenarioText('Knowledge Section Watchers'), watcherRows.concat(sightingRows(galaxy, empire, now)));
    }

    // The Founders' Compact: its founding worlds the viewer has heard of and explored, and the scaffold / wonder it has seen.
    const founderSites = giantworksCompactSites(galaxy, empire);
    const founderRows = founderSites.map((s, i) => row(`founder:${i}`, s.label, s.target, s.status ?? ''));
    const workRows = giantworksKnownSites(galaxy, empire).map((s, i) => row(`work:${i}`, s.label, s.target, s.status ?? ''));
    add('founders', scenarioText('Knowledge Section Founders'), founderRows);
    add('work', scenarioText('Knowledge Section Work'), workRows);

    for (const [id, p] of providers) {
        const rows = p.provider(galaxy, empire);
        if (rows !== null) add(id, p.title, rows);
    }

    // Recommended moves: each unlocks with the knowledge it rests on.
    if (founderRows.length > 0) tips.push(scenarioText('Knowledge Tip Founders'));
    if (coresKnown > 0) tips.push(scenarioText('Knowledge Tip Cattle'));
    if (harvesters > 0) tips.push(scenarioText('Knowledge Tip Harvester'));
    if (stagingKnown > 0) tips.push(scenarioText('Knowledge Tip Staging'));
    if (corruptedKnown > 0) tips.push(scenarioText('Knowledge Tip Purge'));
    if (watchersKnown > 0 || sightingRows(galaxy, empire, now).length > 0) tips.push(scenarioText('Knowledge Tip Watchers'));
    if (beaconKnown && st !== null && st.beacon !== null) {
        const bx = st.beacon.xpos;
        const by = st.beacon.ypos;
        const near = empire.colonies
            .filter((h) => !h.hasBeenDestroyed)
            .sort((a, b) => galaxy.calculateDistance(a.xpos, a.ypos, bx, by) - galaxy.calculateDistance(b.xpos, b.ypos, bx, by))
            .slice(0, 3)
            .map((h) => h.name);
        tips.push(scenarioText('Knowledge Tip Beacon Fortify', near.length > 0 ? near.join(', ') : scenarioText('Knowledge Tip Beacon Nearest')));
        if (!warOn(st)) tips.push(scenarioText('Knowledge Tip Beacon Diet'));
    }

    return {
        war: st !== null ? warLines(galaxy, st) : [],
        sections,
        tips,
        article: knowledgeVisible(galaxy) ? KNOWLEDGE_ARTICLE : null,
    };
}
