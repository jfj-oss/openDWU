// Role-based cast selection for the staged combat scenarios (combatScenarios*.test.ts, combatSoak.test.ts): the seed-1
// galaxy's ship names, capitals and pirate factions move whenever galaxy generation changes, so the scenarios pick their
// cast by owner, sub-role, weapons and pirate play style instead of by name. `describeCast` lists what was picked (the
// scenarios assert it in their first test, so a generation change shows up as a one-line diff there).
import type { Galaxy } from '../../src/sim/galaxy';
import type { BuiltObject } from '../../src/sim/builtObject';
import type { Empire } from '../../src/sim/empire';
import type { Habitat } from '../../src/sim/types';
import { BuiltObjectSubRole } from '../../src/sim/builtObjectTypes';
import { ComponentType } from '../../src/sim/data/components';
import { empireRaidStrengthFactor } from '../../src/sim/combat/attackAI';
import { empireRaidBonusFactor } from '../../src/sim/combat/invasion';
import { empireLootingFactor } from '../../src/sim/combat/damage';

const live = (list: readonly (BuiltObject | null)[]) => list.filter((b): b is BuiltObject => b !== null && !b.hasBeenDestroyed);
const hasWeapon = (b: BuiltObject, t: ComponentType) => b.weapons.some((w) => w.component.type === t);
const isPort = (b: BuiltObject) => b.subRole === BuiltObjectSubRole.SmallSpacePort || b.subRole === BuiltObjectSubRole.MediumSpacePort || b.subRole === BuiltObjectSubRole.LargeSpacePort;

function pick<T>(list: T[], what: string, k = 0): T {
    if (list.length <= k) throw new Error(`combatCast: no ${what} (#${k})`);
    return list[k];
}

/** The player's k-th ship of `subRole` (empire list order). */
export function playerShip(g: Galaxy, subRole: BuiltObjectSubRole, k = 0): BuiltObject {
    return pick(live(g.playerEmpire!.builtObjects).filter((b) => b.subRole === subRole), `player ${BuiltObjectSubRole[subRole]}`, k);
}

/** The player's k-th destroyer that carries missiles. */
export function playerMissileShip(g: Galaxy, k = 0): BuiltObject {
    return pick(live(g.playerEmpire!.builtObjects).filter((b) => b.role !== undefined && !isPort(b) && hasWeapon(b, ComponentType.WeaponMissile)), 'player missile ship', k);
}

/** The player's spaceport with fighter bays. */
export function playerCarrierPort(g: Galaxy): BuiltObject {
    return pick(live(g.playerEmpire!.builtObjects).filter((b) => isPort(b) && b.fighterCapacity > 0), 'player carrier spaceport');
}

/** Pirate factions by play style (Galaxy.8.cs 4396 table: [RaidStrength, RaidBonus, Looting]). */
export function pirateFaction(g: Galaxy, factors: [number, number, number], k = 0): Empire {
    const list = g.pirateEmpires.filter((e) => {
        const f = [empireRaidStrengthFactor(e), empireRaidBonusFactor(e), empireLootingFactor(e)];
        return f[0] === factors[0] && f[1] === factors[1] && f[2] === factors[2];
    });
    return pick(list, `pirate faction ${factors.join('/')}`, k);
}
export const MERCENARY: [number, number, number] = [1.25, 0.75, 1.33];
export const PIRATE: [number, number, number] = [1.25, 1.4, 1.0];
export const SMUGGLER: [number, number, number] = [0.75, 0.75, 0.75];
export const BALANCED: [number, number, number] = [1.0, 1.0, 1.0];

/** Pirate ships of all factions (galaxy pirate-empire order). */
function pirateShips(g: Galaxy, exclude: Empire[] = []): BuiltObject[] {
    return g.pirateEmpires.filter((e) => !exclude.includes(e)).flatMap((e) => live(e.builtObjects));
}

/** The k-th unarmed pirate exploration ship (from factions other than `exclude`). */
export function pirateExplorer(g: Galaxy, k = 0, exclude: Empire[] = []): BuiltObject {
    return pick(pirateShips(g, exclude).filter((b) => b.subRole === BuiltObjectSubRole.ExplorationShip && b.firepowerRaw === 0), 'unarmed pirate explorer', k);
}

/** The k-th armed pirate escort with an assault pod and beams (optionally of a given faction). */
export function pirateRaider(g: Galaxy, faction: Empire | null = null, k = 0): BuiltObject {
    const list = (faction !== null ? live(faction.builtObjects) : pirateShips(g)).filter((b) => b.subRole === BuiltObjectSubRole.Escort && hasWeapon(b, ComponentType.AssaultPod) && hasWeapon(b, ComponentType.WeaponBeam));
    return pick(list, 'pirate escort with assault pod + beams', k);
}

/** The k-th armed pirate escort of any weapon fit. */
export function pirateEscort(g: Galaxy, k = 0, exclude: BuiltObject[] = []): BuiltObject {
    return pick(pirateShips(g).filter((b) => b.subRole === BuiltObjectSubRole.Escort && b.firepowerRaw > 0 && !exclude.includes(b)), 'armed pirate escort', k);
}

/** A pirate construction ship (a bystander). */
export function pirateConstructionShip(g: Galaxy, k = 0): BuiltObject {
    return pick(pirateShips(g).filter((b) => b.subRole === BuiltObjectSubRole.ConstructionShip), 'pirate construction ship', k);
}

/** The first pirate base that fires missiles. */
export function pirateMissileBase(g: Galaxy): BuiltObject {
    return pick(pirateShips(g).filter((b) => isPort(b) && hasWeapon(b, ComponentType.WeaponMissile)), 'pirate base with missiles');
}

/** The capital of the k-th AI (non-player) empire. */
export function aiCapital(g: Galaxy, k = 0): Habitat {
    const list = g.empires.filter((e): e is Empire => e !== null && e !== g.playerEmpire && e.capital !== null).map((e) => e.capital!);
    return pick(list, 'AI empire capital', k);
}

/** One line per picked cast member: "role: name (subRole, owner)". */
export function describeCast(cast: Record<string, BuiltObject | Habitat | Empire>): string[] {
    return Object.entries(cast).map(([role, o]) => {
        if ('subRole' in o) return `${role}: ${o.name} (${BuiltObjectSubRole[o.subRole]}, ${o.empire?.name ?? '-'})`;
        if ('population' in o) return `${role}: ${o.name} (${(o as Habitat).empire?.name ?? '-'})`;
        return `${role}: ${o.name}`;
    });
}
