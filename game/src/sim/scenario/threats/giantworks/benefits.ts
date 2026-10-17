// Giantworks: who benefits from a finished wonder. The shared helper every wonder uses (Casino and Sanctuary income, Ultramind
// contracts, a tolled gate ...). Not a port. Pure except greatWorkPay. Rnd: none.
//
// Decision (no investors): the benefits go to the territory owner of the site, less the Compact's cut
// (giantworksCompactCutPct). An empire that seized the finished wonder (stock boarding) holds it and takes the owner's part
// itself. Once the Diet has passed "Internationalise it" the rest is split among the Diet's members, the territory owner
// keeping giantworksIntlOwnerPct of it. A site no empire's territory covers pays the Compact the whole.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import { dietCouncil } from '../../charactersVictory/diet/diet';
import { dietMembership } from '../../charactersVictory/diet/dietAi';
import { lawInForce, peekDietState } from '../../charactersVictory/diet/dietState';
import { LAW_INTERNATIONALISE } from './actions';
import { compactFaction, gwParam, type GreatWorkRecord } from './state';
import type { GreatWorkSite } from './types';

/** Whoever's territory covers the site (null: nobody's). Pure. */
export function greatWorkTerritoryOwner(galaxy: Galaxy, site: GreatWorkSite): Empire | null {
    const star = site.system.systemStar;
    const id = galaxy.checkEmpireTerritoryIdAtLocation(star.xpos, star.ypos);
    if (id < 0 || id === (galaxy.independentEmpire?.empireId ?? -2)) return null;
    return galaxy.empires.find((e): e is Empire => e !== null && e.active && e.empireId === id) ?? null;
}

/** The empire that seized the finished wonder, or null while the Compact still holds it. Pure. */
export function greatWorkHolder(site: GreatWorkSite): Empire | null {
    return (site as GreatWorkRecord).holder ?? null;
}

/** The wonder turned hostile (a module says so): destroying or seizing it is no crime. Pure. */
export function greatWorkIsHostile(site: GreatWorkSite): boolean {
    return (site as GreatWorkRecord).hostile === true;
}

/** A wonder's module reports that the finished wonder is now hostile (an awakened Ultramind, a smugglers' front, the Beacon). */
export function markGreatWorkHostile(site: GreatWorkSite, hostile = true): void {
    (site as GreatWorkRecord).hostile = hostile;
}

export interface GreatWorkShare {
    /** The Compact (its faction), an empire, or null when the Compact does not exist yet. */
    empire: Empire | null;
    /** Fractions summing to 1. */
    share: number;
    role: 'compact' | 'owner' | 'territory' | 'member';
}

/** True once the Diet has internationalised the wonders. Pure. */
export function internationalised(galaxy: Galaxy): boolean {
    return lawInForce(peekDietState(galaxy), LAW_INTERNATIONALISE) !== null;
}

/** The shares of one payment from the wonder (see the file comment). Pure. */
export function greatWorkShares(galaxy: Galaxy, site: GreatWorkSite): GreatWorkShare[] {
    const compact = compactFaction(galaxy);
    const holder = greatWorkHolder(site);
    const territory = greatWorkTerritoryOwner(galaxy, site);
    const owner = holder ?? territory;
    const cut = holder !== null ? 0 : Math.min(1, Math.max(0, gwParam(galaxy, 'giantworksCompactCutPct') / 100));
    const rest = 1 - cut;
    const out: GreatWorkShare[] = [];
    if (owner === null && !internationalised(galaxy)) return [{ empire: compact, share: 1, role: 'compact' }]; // nobody's territory: the Compact keeps it all
    if (cut > 0) out.push({ empire: compact, share: cut, role: 'compact' });
    if (internationalised(galaxy)) {
        const c = dietCouncil(galaxy);
        const members = c === null ? [] : dietMembership(galaxy, c).filter((m) => m !== owner && m !== compact);
        if (members.length > 0) {
            const ownerShare = owner === null ? 0 : (rest * gwParam(galaxy, 'giantworksIntlOwnerPct')) / 100;
            if (owner !== null) out.push({ empire: owner, share: ownerShare, role: holder !== null ? 'owner' : 'territory' });
            const each = (rest - ownerShare) / members.length;
            for (const m of members) out.push({ empire: m, share: each, role: 'member' });
            return out;
        }
    }
    if (owner === null) {
        if (rest > 0) out.push({ empire: compact, share: rest, role: 'compact' });
    } else {
        out.push({ empire: owner, share: rest, role: holder !== null ? 'owner' : 'territory' });
    }
    return out;
}

/** The empire that takes the main benefit (the holder, else the territory owner), or null. Pure. */
export function greatWorkBeneficiary(galaxy: Galaxy, site: GreatWorkSite): Empire | null {
    return greatWorkHolder(site) ?? greatWorkTerritoryOwner(galaxy, site);
}

/**
 * Pays `amount` credits out by the shares (into each empire's state treasury; the Compact's part into its own). Returns what
 * the empires (not the Compact) received.
 */
export function greatWorkPay(galaxy: Galaxy, site: GreatWorkSite, amount: number): number {
    if (!(amount > 0)) return 0;
    let paid = 0;
    for (const s of greatWorkShares(galaxy, site)) {
        if (s.empire === null || !s.empire.active) continue;
        const x = amount * s.share;
        s.empire.stateMoney += x;
        if (s.empire !== compactFaction(galaxy)) paid += x;
    }
    return paid;
}
