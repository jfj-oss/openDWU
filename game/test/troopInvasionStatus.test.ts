// Port of InfoPanel.cs:4408-4462 (troopStrengthText — the "Show <colony> Ground/Battle Report (Strength: …)" row)
// and InfoPanel.cs:4469-4499 (invasionVsText — the actively-invading "defend vs attack" row), src/ui/hud.ts.
// Hand-built colony state on top of a real (cachedTickGame) habitat, following test/m4qInvasion.test.ts's pattern.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { Galaxy } from '../src/sim/galaxy';
import type { Habitat } from '../src/sim/types';
import type { Empire } from '../src/sim/empire';
import type { GameData } from '../src/sim/data/gameData';
import { Troop, TroopList, TroopType } from '../src/sim/cargo';
import { invasionVsText, troopStrengthText } from '../src/ui/hud';

let gameData: GameData;
let galaxy: Galaxy;

function troop(empire: Empire | null, type: TroopType, attack: number, defend: number, readiness = 100): Troop {
    return new Troop('t', type, attack, defend, 100, readiness, empire, empire?.dominantRace ?? null);
}

/** A fresh independent colony (population, independent empire) with its troop lists emptied — same helper as
 *  test/m4qInvasion.test.ts's independentColony(). */
function independentColony(skip: Habitat[] = []): Habitat {
    const h = galaxy.independentColonies.find((c) => !skip.includes(c) && c.empire === galaxy.independentEmpire && c.population.totalAmount > 0)!;
    h.troops = new TroopList();
    h.troopsToRecruit = new TroopList();
    h.invadingTroops = new TroopList();
    h.invasionStats = null;
    return h;
}

beforeAll(async () => {
    gameData = await loadGameDataFs();
    galaxy = cachedTickGame(gameData).galaxy;
}, 180000);

describe('troopStrengthText (InfoPanel.cs:4408-4462)', () => {
    it('no invader: "Ground Report", strength + composition, no "vs"', () => {
        const h = independentColony();
        const owner = h.empire as Empire;
        h.troops!.add(troop(owner, TroopType.Infantry, 100, 100, 100));
        h.troops!.add(troop(owner, TroopType.Armored, 100, 100, 100));
        const r = troopStrengthText(h, galaxy)!;
        expect(r).not.toBeNull();
        expect(r.invading).toBe(false);
        expect(r.text.startsWith(`Show ${h.name} Ground Report  (Strength: `)).toBe(true);
        expect(r.text).toContain('(1 Inf, 1 Arm)');
        expect(r.text).not.toContain(' vs ');
    });

    it('an active invasion: "Battle Report", "defend (composition)  vs  attack"', () => {
        const h = independentColony();
        const owner = h.empire as Empire;
        const invader = galaxy.empires.find((e) => e !== owner && e !== galaxy.independentEmpire)!;
        h.troops!.add(troop(owner, TroopType.Infantry, 100, 100, 100));
        h.invadingTroops!.add(troop(invader, TroopType.Infantry, 200, 200, 100));
        const r = troopStrengthText(h, galaxy)!;
        expect(r).not.toBeNull();
        expect(r.invading).toBe(true);
        expect(r.text.startsWith(`Show ${h.name} Battle Report  (Strength: `)).toBe(true);
        expect(r.text).toContain('(1 Inf)');
        expect(r.text).toContain('  vs  ');
    });

    it('no troops/recruits/invaders at all: null (row hidden)', () => {
        const h = independentColony();
        expect(troopStrengthText(h, galaxy)).toBeNull();
    });
});

describe('invasionVsText (InfoPanel.cs:4469-4499)', () => {
    it('not visible to a player who is neither the owner nor the invader: null', () => {
        const h = independentColony();
        const owner = h.empire as Empire;
        const invader = galaxy.empires.find((e) => e !== owner && e !== galaxy.independentEmpire)!;
        const bystander = galaxy.empires.find((e) => e !== owner && e !== invader && e !== galaxy.independentEmpire)!;
        h.invadingTroops!.add(troop(invader, TroopType.Infantry, 200, 200, 100));
        expect(invasionVsText(h, galaxy, bystander)).toBeNull();
    });

    it('no active invasion: null even for the owner', () => {
        const h = independentColony();
        expect(invasionVsText(h, galaxy, h.empire as Empire)).toBeNull();
    });

    it('visible to the owner: "  defend   vs   attack" and the Battle Report title', () => {
        const h = independentColony();
        const owner = h.empire as Empire;
        const invader = galaxy.empires.find((e) => e !== owner && e !== galaxy.independentEmpire)!;
        h.troops!.add(troop(owner, TroopType.Infantry, 100, 100, 100));
        h.invadingTroops!.add(troop(invader, TroopType.Infantry, 200, 200, 100));
        const r = invasionVsText(h, galaxy, owner)!;
        expect(r).not.toBeNull();
        expect(r.text).toMatch(/^ {2}\S.*   vs   \S/);
        expect(r.title).toBe(`Show ${h.name} Battle Report`);
    });

    it('visible to the invader too (not just the owner)', () => {
        const h = independentColony();
        const owner = h.empire as Empire;
        const invader = galaxy.empires.find((e) => e !== owner && e !== galaxy.independentEmpire)!;
        h.invadingTroops!.add(troop(invader, TroopType.Infantry, 200, 200, 100));
        expect(invasionVsText(h, galaxy, invader)).not.toBeNull();
    });
});
