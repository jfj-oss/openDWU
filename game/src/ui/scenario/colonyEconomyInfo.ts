// Colony Economy add-on: the colony selection panel's lines (docs/ECONOMY.md §6) — the designation badge and name, and
// the private facilities' icons beside the stock facilities. Our own art (public/art/economy, scripts/gen-econ-icons.mjs).
// No DOM; pure reads of the add-on's state.

import type { Galaxy } from '../../sim/galaxy';
import type { Habitat } from '../../sim/types';
import { DESIGNATION_NAMES, DESIGNATION_SUMMARY, Designation, ECON_DESIG_FLAG, ECON_FAC_FLAG, activeFacilities, designationOf, econOn, facilityDef, peekColony, type FacilityId } from '../../sim/scenario/colonyEconomy/common';

export function econFacilityIconUrl(id: FacilityId): string {
    return `/art/economy/fac-${id}.svg`;
}
export function econDesignationIconUrl(d: Designation): string {
    return `/art/economy/desig-${d}.svg`;
}
/** The Galactopedia topic id of a facility / good / designation entry (screens/galactopedia.ts econ items). */
export function econTopicId(kind: 'fac' | 'good' | 'desig', key: string | number): string {
    return `econ-${kind}-${String(key).toLowerCase()}`;
}

export interface EconColonyInfo {
    designation: { img: string; name: string; title: string; topic: string } | null;
    facilities: { img: string; title: string; faded: boolean; topic: string }[];
}

/** The colony's designation and private facilities for the selection panel (null: the add-on is off). Pure. */
export function econColonyInfo(galaxy: Galaxy, h: Habitat): EconColonyInfo | null {
    if (!econOn(galaxy, ECON_DESIG_FLAG) && !econOn(galaxy, ECON_FAC_FLAG)) return null;
    const d = designationOf(galaxy, h);
    const c = peekColony(galaxy, h);
    const active = new Set(activeFacilities(galaxy, h));
    const facilities = (c?.facilities ?? []).map((f) => {
        const def = facilityDef(f.id);
        const status = f.progress < 1 ? ` (under construction, ${Math.round(f.progress * 100)}%)` : active.has(f) ? '' : f.unpaidSince > 0 ? ' (unpaid: not working)' : ' (not working)';
        return { img: econFacilityIconUrl(f.id), title: `${def.name}${status} (private, click for details)\n${def.effect}`, faded: f.progress < 1 || !active.has(f), topic: econTopicId('fac', f.id) };
    });
    const designation = d === Designation.None ? null : { img: econDesignationIconUrl(d), name: DESIGNATION_NAMES[d], title: `${DESIGNATION_NAMES[d]} (click for details)\n${DESIGNATION_SUMMARY[d]}`, topic: econTopicId('desig', d) };
    return { designation, facilities };
}
