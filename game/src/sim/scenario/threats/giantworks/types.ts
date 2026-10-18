// Giantworks: the contract between the framework (framework.ts) and the wonders (beacon.ts, casino.ts, ultramind.ts, sanctuary.ts, ...).
// Not a port. The framework owns this file; a wonder module only imports its types and calls registerGreatWork (framework.ts).
// See the design plan (Giantworks, section 13).

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { Habitat, SystemInfo } from '../../../types';
import type { BuiltObject } from '../../../builtObject';

/** 0 Foundations, 1 Frame, 2 Superstructure, 3 Fitting, 4 Complete. */
export type GreatWorkStage = 0 | 1 | 2 | 3 | 4; // 4 = complete

export interface GreatWorkSite {
    id: number;
    system: SystemInfo;
    habitat: Habitat | null;
    base: BuiltObject | null;
    progress: number /*0..1*/;
    stage: GreatWorkStage;
    wonder: string /*secret id*/;
    founders: Habitat[];
    startDate: number;
    completeDate: number | null;
    destroyedBy: Empire | null;
}

export interface GreatWorkKind {
    id: string; // 'casino' | 'ultramind' | 'sanctuary' | 'beacon' | ...
    flag: string; // per-wonder toggle
    weight: number; // roll weight
    hintTags: string[]; // hint-table tags (shared tags = red herrings)
    onRolled?(g: Galaxy, site: GreatWorkSite): void; // secretly chosen at game start (Beacon: spawn the Watchers)
    buildRateMultiplier?(g: Galaxy, site: GreatWorkSite): number; // e.g. the Beacon's corrupted worlds speed it up
    extraSuppliers?(g: Galaxy, site: GreatWorkSite): Habitat[]; // e.g. corrupted worlds also send freighters
    onComplete(g: Galaxy, site: GreatWorkSite): void; // the wonder activates
    onDestroyed?(g: Galaxy, site: GreatWorkSite, by: Empire | null): void;
    periodic?(g: Galaxy, site: GreatWorkSite): void; // after completion
    aiStrike?(g: Galaxy, site: GreatWorkSite): { target: BuiltObject; defenders: BuiltObject[]; marginPct?: number } | null; // a hostile wonder with a garrison of its own (the casino's smugglers): what the AI strikes and what stands in its way (null: the wonder's own base)
    aiAbstains?(g: Galaxy, site: GreatWorkSite, empire: Empire): boolean; // a hostile wonder this empire has a deal with (the Ultramind's spared partners): its Smarter AI does not strike it
}
// export function registerGreatWork(kind: GreatWorkKind): void;  // in framework.ts
