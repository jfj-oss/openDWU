// Game Editor: finish a Great Work under construction (the journaled player command editorFinishGreatWork). Its own module so
// the player-command table does not import the whole Giantworks package (an import cycle at load).

import type { Galaxy } from '../../../galaxy';
import { completeWork } from './lifecycle';
import { kindName } from './knowledge';
import { peekGwState } from './state';


/** The Great Works being built now (the editor's "Finish" list): id and a label. Pure. */
export function finishableGreatWorks(galaxy: Galaxy): { id: number; label: string }[] {
    const st = peekGwState(galaxy);
    if (st === null) return [];
    return st.sites.filter((w) => w.phase === 'building').map((w) => ({ id: w.id, label: `${kindName(w.wonder)} at ${w.system.systemStar.name} (${Math.round(w.progress * 100)}%)` }));
}

/** The journaled player command editorFinishGreatWork: completes Great Work `id` now through the normal completion path (its onComplete runs: the Beacon's countdown etc.). False when it is not being built. */
export function editorFinishGreatWork(galaxy: Galaxy, id: number): boolean {
    const work = peekGwState(galaxy)?.sites.find((w) => w.id === id && w.phase === 'building');
    if (work === undefined) return false;
    completeWork(galaxy, work);
    return true;
}
