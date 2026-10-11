// Characters & Victory UI rows (docs/CHARACTERS_AND_VICTORY.md §9). Pure view models over the (replica) galaxy: the
// Characters screen's travel / post block, the colony screen's governor slot, the task text for a VIP trip. The DOM
// halves live in the screens; every action is a player command (playerOps.ts cvAcceptSuggestion / cvRequestGovernor /
// cvSetAutomation, transferCharacter).

import type { Galaxy } from '../../sim/galaxy';
import type { Empire } from '../../sim/empire';
import type { Habitat } from '../../sim/types';
import { type Character, CharacterRole, isBuiltObjectLocation } from '../../sim/characters';
import { resolveStarDateDescription } from '../../sim/galaxyTime';
import { CV_ESCORT_FLAG, CV_GOV_FLAG, CV_VIP_FLAG, cvOn, peekCvState } from '../../sim/scenario/charactersVictory/common';
import { tripOfCharacter, vipTripView } from '../../sim/scenario/charactersVictory/vip';
import { colonyVacancy, fitAt, governorLockedUntil } from '../../sim/scenario/charactersVictory/governorsCv';
import { colonyGovernor } from '../../sim/scenario/governors';

/** The add-on runs in this game (any of its parts). */
export function cvVisible(galaxy: Galaxy): boolean {
    return cvOn(galaxy, CV_VIP_FLAG) || cvOn(galaxy, CV_GOV_FLAG);
}

/** The Characters screen's task text for a character on a VIP trip (null: not on one). */
export function cvTaskText(galaxy: Galaxy, c: Character): string | null {
    const v = vipTripView(galaxy, c);
    if (v === null) return null;
    const t = v.trip;
    const wait = t.waitUntil > 0 ? ', waiting for escort' : '';
    const esc = t.escorts.length > 0 ? `, ${t.escorts.length} escort${t.escorts.length === 1 ? '' : 's'}` : '';
    return `Travelling to ${t.destination.name} aboard ${t.shuttle.name} (ETA ${resolveStarDateDescription(v.etaStarDate)}${esc}${wait})`;
}

export interface CvCharacterDetail {
    status: string;
    lines: string[];
    /** A suggestion to accept (null: none). */
    suggestion: { label: string; colony: Habitat } | null;
    /** Automation toggles (shown once, for the player). */
    automateGovernors: boolean | null;
    automateEscorts: boolean | null;
    escortLevel: number;
}

function postStatus(galaxy: Galaxy, c: Character): string {
    if (tripOfCharacter(galaxy, c) !== null) return 'Travelling';
    const loc = c.location;
    if (c.role !== CharacterRole.ColonyGovernor) return 'At post';
    if (loc === null || isBuiltObjectLocation(loc)) return 'Reserve';
    const h = loc as Habitat;
    return h.empire === c.empire && colonyGovernor(h) === c ? 'In post' : 'Reserve';
}

/** The Characters screen block for `c` of `player` (null: the add-on is off or `c` is not the player's). Pure. */
export function cvCharacterDetail(galaxy: Galaxy, player: Empire, c: Character): CvCharacterDetail | null {
    if (!cvVisible(galaxy) || c.empire !== player) return null;
    const st = peekCvState(galaxy);
    const ce = st?.empires[player.empireId];
    const lines: string[] = [];
    const task = cvTaskText(galaxy, c);
    if (task !== null) lines.push(task);
    let suggestion: CvCharacterDetail['suggestion'] = null;
    if (c.role === CharacterRole.ColonyGovernor && cvOn(galaxy, CV_GOV_FLAG)) {
        const loc = c.location;
        if (loc !== null && !isBuiltObjectLocation(loc) && (loc as Habitat).empire === player) {
            const f = fitAt(galaxy, c, loc as Habitat);
            if (f !== null) lines.push(`Fit at ${loc.name}: ${Math.round(f)}`);
        }
        let best: Habitat | null = null;
        let bf = -1;
        for (const h of player.colonies) {
            const f = fitAt(galaxy, c, h) ?? -1;
            if (f > bf) {
                bf = f;
                best = h;
            }
        }
        if (best !== null) lines.push(`Best fit: ${best.name} (${Math.round(bf)})`);
        const s = ce?.suggestions.find((x) => x.character === c) ?? null;
        if (s !== null) suggestion = { label: `Suggested: ${s.to.name}${s.from !== null ? ` (from ${s.from.name}, +${Math.round(s.gainPct)}%)` : ''}`, colony: s.to };
    }
    return {
        status: postStatus(galaxy, c),
        lines,
        suggestion,
        automateGovernors: cvOn(galaxy, CV_GOV_FLAG) ? (ce?.automateGovernors ?? false) : null,
        automateEscorts: cvOn(galaxy, CV_ESCORT_FLAG) ? (ce?.automateEscorts ?? true) : null,
        escortLevel: ce?.escortLevel ?? 1,
    };
}

export interface CvColonySlot {
    governor: Character | null;
    /** "Vacant — grace 4 months" / "Vacant — neglect 35%" / "Governor en route: X" / "" */
    status: string;
    neglectPct: number;
    canRequest: boolean;
    requested: boolean;
}

/** The colony screen's governor slot (null: the governor rule is off or `h` is not the player's). Pure. */
export function cvColonySlot(galaxy: Galaxy, player: Empire, h: Habitat): CvColonySlot | null {
    if (!cvOn(galaxy, CV_GOV_FLAG) || h.empire !== player) return null;
    const v = colonyVacancy(galaxy, h);
    const gov = colonyGovernor(h);
    const requested = peekCvState(galaxy)?.empires[player.empireId]?.requests.includes(h) ?? false;
    let status = '';
    const neglectPct = Math.round(v.neglect * 100);
    const locked = governorLockedUntil(galaxy, h);
    if (v.vacant && locked >= 0) {
        // [charactersVictory part 2] its governor died as a Diet delegate.
        status = `No governor can be appointed until ${resolveStarDateDescription(locked)}${v.graceLeftDays > 0 ? '' : ` — neglect ${neglectPct}%`}`;
    } else if (v.vacant) {
        if (v.enRoute !== null) status = `Governor en route: ${v.enRoute.name}`;
        else if (v.graceLeftDays > 0) status = `Vacant — decline in ${Math.max(1, Math.round(v.graceLeftDays / 30))} months`;
        else status = `Vacant — neglect ${neglectPct}%`;
    } else if (v.neglect > 0) status = `Recovering — neglect ${neglectPct}%`;
    return { governor: gov, status, neglectPct, canRequest: v.vacant && v.enRoute === null && !requested && locked < 0, requested };
}
