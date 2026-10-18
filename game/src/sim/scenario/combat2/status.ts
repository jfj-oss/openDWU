// The compact ship state of the combat changes for the existing ship / selection panel (ui/selectionInfo.ts): "Decoys 2/3",
// "Critical: engines", "Struck colours", the ambush seconds left. Pure reads of the sim; nothing without the flags. Not a port.

import type { Galaxy } from '../../galaxy';
import type { BuiltObject } from '../../builtObject';
import { ambushSecondsLeft } from './ambush';
import { critText } from './criticals';
import { decoyText } from './decoys';
import { struckText } from './surrender';
import { anyCombat2On } from './common';

export interface StatusLine {
    label: string;
    text: string;
}

/** The ship's combat state lines (empty with all six changes off, or nothing to show). */
export function combat2StatusLines(galaxy: Galaxy, bo: BuiltObject): StatusLine[] {
    if (!anyCombat2On(galaxy)) return [];
    const out: StatusLine[] = [];
    const struck = struckText(galaxy, bo);
    if (struck !== null) out.push({ label: 'Status', text: struck });
    const decoys = decoyText(galaxy, bo);
    if (decoys !== null) out.push({ label: 'Countermeasures', text: decoys });
    const crit = critText(galaxy, bo);
    if (crit !== null) out.push({ label: 'Critical', text: crit });
    const left = ambushSecondsLeft(galaxy, bo);
    if (left > 0) out.push({ label: 'Ambush', text: `${left} s left` });
    return out;
}
