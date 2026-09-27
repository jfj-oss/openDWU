// 19r "Art bundle 2" switches. Every item except the damage overlay (base game, always on) is off unless the running
// scenario turns its flag on (scenarios/art-bundle/scenario.json: damageFx, liveries — a scenario may `include`
// art-bundle to get them) or the page URL forces it for captures (?damageFx=1, ?liveries=1). Render-only: the sim
// never reads these.

import type { Galaxy } from '../sim/galaxy';
import { scenarioFlag } from '../sim/scenario/state';

export type ArtBundleFlag = 'damageFx' | 'liveries';

let urlFlags: Record<string, boolean> | null = null;

function fromUrl(name: string): boolean | undefined {
    if (urlFlags === null) {
        urlFlags = {};
        if (typeof window !== 'undefined' && typeof window.location?.search === 'string') {
            const q = new URLSearchParams(window.location.search);
            for (const k of ['damageFx', 'liveries']) {
                const v = q.get(k);
                if (v !== null) urlFlags[k] = v === '1' || v === 'true';
            }
        }
    }
    return urlFlags[name];
}

/** Test hook: override the URL flags (null = read the URL again). */
export function setArtBundleUrlFlags(flags: Record<string, boolean> | null): void {
    urlFlags = flags;
}

/** True when the art-bundle item `name` is on for this game. */
export function artBundleFlag(galaxy: Galaxy | null | undefined, name: ArtBundleFlag): boolean {
    const u = fromUrl(name);
    if (u !== undefined) return u;
    return galaxy != null && scenarioFlag(galaxy, name);
}
