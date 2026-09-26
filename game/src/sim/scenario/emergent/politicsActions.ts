// Emergent Galaxy — 19d1 player counterplay (tasks/19d1-internal-politics.md §5). Not a port. Each action returns
// { ok, reason } and draws no Rnd; the AI rules (politics.ts) call honour / arrest directly, the player's UI goes through
// the command queue (player/playerOps.ts `politicsAction`) so the command log replays it.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Habitat } from '../../types';
import { type Character, CharacterRole, type StellarObject } from '../../characters';
import { EmpireMessageType } from '../../messages';
import { scenarioFlag } from '../state';
import { scenarioMessage, scenarioText } from '../messages';
import {
    POLITICS_FLAG,
    dismissCharacter,
    governedColony,
    honourCost,
    politicsEntry,
    politicsState,
    politicsYear,
    setPoliticsActions,
} from './politics';

export interface PoliticsActionResult {
    ok: boolean;
    reason?: string;
}

const HONOUR_COOLDOWN_YEARS = 3;
const AUTONOMY_YEARS = 5;
const AUTONOMY_TAX = 0.05;

function roleName(c: Character): string {
    return CharacterRole[c.role].replace(/([a-z])([A-Z])/g, '$1 $2');
}

/** Common checks: flag on, a living character of `empire` who is not its leader. */
function checkCharacter(galaxy: Galaxy, empire: Empire, c: Character): PoliticsActionResult | null {
    if (!scenarioFlag(galaxy, POLITICS_FLAG)) return { ok: false, reason: 'Internal politics is off' };
    if (!c.active || c.empire !== empire) return { ok: false, reason: 'Not one of our characters' };
    if (c.role === CharacterRole.Leader || c.role === CharacterRole.PirateLeader) return { ok: false, reason: 'Not the leader' };
    return null;
}

/** Why honorCharacter would fail now (null: it would succeed). Pure (UI). */
export function honourBlocked(galaxy: Galaxy, empire: Empire, c: Character): string | null {
    const bad = checkCharacter(galaxy, empire, c);
    if (bad !== null) return bad.reason ?? 'Unavailable';
    const st = politicsState(galaxy);
    const e = st.chars.get(c);
    if (e !== undefined && politicsYear(galaxy) - e.honoredYear < HONOUR_COOLDOWN_YEARS) return 'Honoured recently';
    if (empire.stateMoney < honourCost(c)) return 'Not enough money';
    return null;
}

/** §5 honorCharacter: costs GetCharacterValue/2, +15 loyalty, cooldown 3 years. */
export function honorCharacter(galaxy: Galaxy, empire: Empire, c: Character): PoliticsActionResult {
    const why = honourBlocked(galaxy, empire, c);
    if (why !== null) return { ok: false, reason: why };
    const cost = honourCost(c);
    empire.stateMoney -= cost;
    const e = politicsEntry(galaxy, c);
    e.loyalty = Math.min(100, e.loyalty + 15);
    e.honoredYear = politicsYear(galaxy);
    if (empire === galaxy.playerEmpire) {
        scenarioMessage(galaxy, empire, scenarioText('Emergent Honour Title'), scenarioText('Emergent Honour', roleName(c), c.name, cost), { type: EmpireMessageType.GeneralGoodEvent, subject: c });
    }
    return { ok: true };
}

/** §5 arrestCharacter: only an exposed plotter; dismissed without penalty. */
export function arrestCharacter(galaxy: Galaxy, empire: Empire, c: Character): PoliticsActionResult {
    const bad = checkCharacter(galaxy, empire, c);
    if (bad !== null) return bad;
    if (!politicsState(galaxy).exposed.has(c)) return { ok: false, reason: 'No evidence against them' };
    const text = scenarioText('Emergent Arrest', roleName(c), c.name);
    dismissCharacter(galaxy, c);
    if (empire === galaxy.playerEmpire) scenarioMessage(galaxy, empire, scenarioText('Emergent Arrest Title'), text, { type: EmpireMessageType.GeneralNeutralEvent, subject: empire.capital });
    return { ok: true };
}

/** §5 purgeCharacter: any character; −5 loyalty to every non-Patriot for 2 years, and leader-change unrest. */
export function purgeCharacter(galaxy: Galaxy, empire: Empire, c: Character): PoliticsActionResult {
    const bad = checkCharacter(galaxy, empire, c);
    if (bad !== null) return bad;
    const text = scenarioText('Emergent Purge', roleName(c), c.name);
    dismissCharacter(galaxy, c);
    politicsState(galaxy).purgeYear.set(empire, politicsYear(galaxy));
    empire.leaderChangeInfluence = Math.min(empire.leaderChangeInfluence, -0.15);
    if (empire === galaxy.playerEmpire) scenarioMessage(galaxy, empire, scenarioText('Emergent Purge Title'), text, { type: EmpireMessageType.GeneralWarning, subject: empire.capital });
    return { ok: true };
}

/** §5 reassignCharacter: the stock transfer (Character.TransferToNewLocation); a governor moved away loses 5 loyalty. */
export function reassignCharacter(galaxy: Galaxy, empire: Empire, c: Character, destination: StellarObject): PoliticsActionResult {
    const bad = checkCharacter(galaxy, empire, c);
    if (bad !== null) return bad;
    if (destination.empire !== empire) return { ok: false, reason: 'Destination is not ours' };
    const governed = governedColony(c);
    c.transferToNewLocation(destination, galaxy);
    if (governed !== null && governed !== destination) {
        const e = politicsEntry(galaxy, c);
        e.loyalty = Math.max(0, e.loyalty - 5);
    }
    return { ok: true };
}

/** §5 grantAutonomy: the colony's tax rate is 5% for 5 years (then the stock rule again); its governor +10 loyalty. */
export function grantAutonomy(galaxy: Galaxy, empire: Empire, colony: Habitat): PoliticsActionResult {
    if (!scenarioFlag(galaxy, POLITICS_FLAG)) return { ok: false, reason: 'Internal politics is off' };
    if (colony.empire !== empire) return { ok: false, reason: 'Not our colony' };
    if (colony === empire.capital) return { ok: false, reason: 'Not the capital' };
    const st = politicsState(galaxy);
    if (st.autonomy.has(colony)) return { ok: false, reason: 'Already autonomous' };
    st.autonomy.set(colony, politicsYear(galaxy) + AUTONOMY_YEARS);
    colony.taxRate = AUTONOMY_TAX;
    for (const [ch, e] of st.chars) if (governedColony(ch) === colony) e.loyalty = Math.min(100, e.loyalty + 10);
    if (empire === galaxy.playerEmpire) scenarioMessage(galaxy, empire, scenarioText('Emergent Autonomy Title'), scenarioText('Emergent Autonomy', colony.name), { type: EmpireMessageType.GeneralNeutralEvent, subject: colony });
    return { ok: true };
}

/** Why arrest / purge are unavailable (null: available). Pure (UI). */
export function arrestBlocked(galaxy: Galaxy, empire: Empire, c: Character): string | null {
    const bad = checkCharacter(galaxy, empire, c);
    if (bad !== null) return bad.reason ?? 'Unavailable';
    return politicsState(galaxy).exposed.has(c) ? null : 'No evidence against them';
}
export function purgeBlocked(galaxy: Galaxy, empire: Empire, c: Character): string | null {
    const bad = checkCharacter(galaxy, empire, c);
    return bad !== null ? (bad.reason ?? 'Unavailable') : null;
}

export type PoliticsActionName = 'honour' | 'arrest' | 'purge';

/** The player op's dispatcher (player/playerOps.ts politicsAction). */
export function runPoliticsAction(galaxy: Galaxy, empire: Empire, action: PoliticsActionName, c: Character): PoliticsActionResult {
    switch (action) {
        case 'honour':
            return honorCharacter(galaxy, empire, c);
        case 'arrest':
            return arrestCharacter(galaxy, empire, c);
        case 'purge':
            return purgeCharacter(galaxy, empire, c);
    }
}

setPoliticsActions({ honorCharacter, arrestCharacter });
