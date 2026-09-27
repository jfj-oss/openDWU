// 19r item 2 — independent leagues (19k-3) listed with their generated flag in the Empires list and the Diplomacy
// screen. Reads scenario.state['independents'] by shape (render/leagueArt.ts); nothing shows without leagues.

import type { Galaxy } from '../sim/galaxy';
import { flagShapeUrl } from '../sim/startGameOptions';
import { activeLeaguesOf, leagueFlag, type LeagueShape } from '../render/leagueArt';
import { loadRgba, rgbaToDataUrl } from './empireEmblem';

/** The leagues to list (active, by id). */
export function leagueListRows(galaxy: Galaxy | null | undefined): { league: LeagueShape; label: string; members: number }[] {
    const s = galaxy?.scenario;
    if (s == null || !('independents' in s.state)) return [];
    return activeLeaguesOf(s.state['independents'])
        .slice()
        .sort((a, b) => a.id - b.id)
        .map((l) => ({ league: l, label: l.name, members: l.members.length }));
}

const flagUrls = new Map<number, Promise<string>>();

/** The league flag as a data URL (founder shape + chain links, league colour), generated once. */
export function leagueFlagUrl(l: LeagueShape): Promise<string> {
    let p = flagUrls.get(l.id);
    if (p === undefined) {
        p = (l.flagShape >= 0 ? loadRgba(flagShapeUrl(l.flagShape)) : Promise.resolve(null)).then((shape) => rgbaToDataUrl(leagueFlag(shape, l.colour)));
        flagUrls.set(l.id, p);
    }
    return p;
}

/** A section of league rows (null when there are none). `rowClass` prefixes the screen's own row styling. */
export function leagueSection(galaxy: Galaxy | null | undefined, rowClass: string): HTMLElement | null {
    const rows = leagueListRows(galaxy);
    if (rows.length === 0) return null;
    const box = document.createElement('div');
    box.className = `${rowClass}-leagues`;
    const head = document.createElement('div');
    head.className = `${rowClass}-leagues-heading`;
    head.style.cssText = 'margin-top:8px;opacity:0.8;font-weight:bold';
    head.textContent = 'Independent Leagues';
    box.appendChild(head);
    for (const r of rows) {
        const line = document.createElement('div');
        line.className = `${rowClass}-row ${rowClass}-league-row`;
        const flag = document.createElement('img');
        flag.alt = '';
        flag.draggable = false;
        flag.style.cssText = 'width:24px;height:14px;margin-right:6px;vertical-align:middle';
        void leagueFlagUrl(r.league).then((u) => (flag.src = u));
        const name = document.createElement('span');
        name.textContent = `${r.label} (${r.members} ${r.members === 1 ? 'colony' : 'colonies'})`;
        line.append(flag, name);
        box.appendChild(line);
    }
    return box;
}
