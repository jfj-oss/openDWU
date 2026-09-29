// Fog of war at system zoom (src/render/fog.ts): the player-knowledge rules of MainView.1.cs / Main.Part10-11.cs on a
// hand-built state — ships, fighters, creatures, bodies of unexplored systems, picking, the selection panel.
import { describe, expect, it } from 'vitest';
import { BuiltObject } from '../src/sim/builtObject';
import { HabitatCategoryType, Habitat } from '../src/sim/types';
import { SystemVisibilityStatus } from '../src/sim/visibility';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Creature } from '../src/sim/creature';
import type { Fighter } from '../src/sim/combat/fighters';
import { FogOfWar, builtObjectVisibleToPlayer, creatureVisibleToPlayer, fighterVisibleToPlayer, fogOf, habitatDrawnInFog, habitatInfoKnown, selectionUnseen, systemHasPlayerSensors } from '../src/render/fog';
import { pickableBuiltObjects, pickBuiltObjectBySize } from '../src/render/builtObjectLayer';

const dist2 = (x1: number, y1: number, x2: number, y2: number): number => (x1 - x2) ** 2 + (y1 - y2) ** 2;

interface EmpireOpts {
    /** System statuses by index (default Unexplored). */
    status?: Record<number, SystemVisibilityStatus>;
    scanners?: BuiltObject[];
    knownPirateBases?: BuiltObject[];
}

function makeEmpire(o: EmpireOpts = {}): Empire {
    const status = (i: number): SystemVisibilityStatus => o.status?.[i] ?? SystemVisibilityStatus.Unexplored;
    return {
        empireId: 1,
        empiresViewable: [],
        pirateEmpireBaseHabitat: null,
        knownPirateBases: o.knownPirateBases ?? [],
        longRangeScanners: o.scanners ?? [],
        visibility: {
            empiresSharedVisibility: [],
            checkSystemVisibilityStatus: status,
            checkSystemVisible: (i: number) => status(i) >= SystemVisibilityStatus.Explored,
        },
    } as unknown as Empire;
}

function star(systemIndex: number, x = 0, y = 0): Habitat {
    return Object.assign(Object.create(Habitat.prototype), { systemIndex, xpos: x, ypos: y, category: HabitatCategoryType.Star, empire: null }) as Habitat;
}

function body(systemIndex: number, category: HabitatCategoryType, x = 0, y = 0, empire: Empire | null = null): Habitat {
    return Object.assign(Object.create(Habitat.prototype), { systemIndex, xpos: x, ypos: y, category, empire }) as Habitat;
}

function ship(over: Partial<BuiltObject>): BuiltObject {
    return Object.assign(Object.create(BuiltObject.prototype), {
        empire: null,
        xpos: 0,
        ypos: 0,
        size: 50,
        stealth: 1,
        pirateEmpireId: 0,
        nearestSystemStar: null,
        hasBeenDestroyed: false,
        currentSpeed: 0,
        topSpeed: 10,
        warpSpeed: 0,
        sensorLongRange: 0,
        sensorProximityArrayRange: 0,
        ...over,
    }) as BuiltObject;
}

function makeGalaxy(player: Empire | null, builtObjects: BuiltObject[] = []): Galaxy {
    const g = {
        scenario: null,
        playerEmpire: player,
        empires: player !== null ? [player] : [],
        builtObjects,
        systems: [],
        calculateDistanceSquared: dist2,
        calculateDistance: (x1: number, y1: number, x2: number, y2: number) => Math.sqrt(dist2(x1, y1, x2, y2)),
        resolveIndex: () => ({ x: 0, y: 0 }),
        builtObjectIndexGrid: [[builtObjects]],
    };
    return g as unknown as Galaxy;
}

const S_UNSEEN = 7; // an unexplored system
const S_KNOWN = 3; // a system the player sees

describe('built objects (MainView.1.cs 884: GodMode || IsObjectVisibleToThisEmpire)', () => {
    const player = makeEmpire({ status: { [S_KNOWN]: SystemVisibilityStatus.Visible } });
    const other = makeEmpire();
    const galaxy = makeGalaxy(player);
    it('the player\'s own ships are always seen', () => {
        expect(builtObjectVisibleToPlayer(galaxy, player, ship({ empire: player, nearestSystemStar: star(S_UNSEEN) }))).toBe(true);
    });
    it('an enemy ship in a system the player sees is seen; in an unexplored system it is not', () => {
        expect(builtObjectVisibleToPlayer(galaxy, player, ship({ empire: other, nearestSystemStar: star(S_KNOWN) }))).toBe(true);
        expect(builtObjectVisibleToPlayer(galaxy, player, ship({ empire: other, nearestSystemStar: star(S_UNSEEN) }))).toBe(false);
    });
    it('a long-range scanner covers a ship in range, scaled by its stealth', () => {
        const scanner = ship({ empire: player, xpos: 0, ypos: 0, sensorLongRange: 1000 });
        const withScanner = makeEmpire({ scanners: [scanner] });
        const g = makeGalaxy(withScanner);
        expect(builtObjectVisibleToPlayer(g, withScanner, ship({ empire: other, xpos: 800, ypos: 0, nearestSystemStar: star(S_UNSEEN) }))).toBe(true);
        expect(builtObjectVisibleToPlayer(g, withScanner, ship({ empire: other, xpos: 800, ypos: 0, stealth: 0.5, nearestSystemStar: star(S_UNSEEN) }))).toBe(false);
        expect(builtObjectVisibleToPlayer(g, withScanner, ship({ empire: other, xpos: 1200, ypos: 0, nearestSystemStar: star(S_UNSEEN) }))).toBe(false);
    });
    it('with no player (or the reveal toggle) everything is seen', () => {
        const unseen = ship({ empire: other, nearestSystemStar: star(S_UNSEEN) });
        expect(builtObjectVisibleToPlayer(galaxy, null, unseen)).toBe(true);
        const fog = new FogOfWar(galaxy);
        expect(fog.builtObject(unseen)).toBe(false);
        fog.reveal = true;
        expect(fog.builtObject(unseen)).toBe(true);
    });
});

describe('fighters (Empire.9.cs 3095-3112)', () => {
    const player = makeEmpire({ status: { [S_KNOWN]: SystemVisibilityStatus.Visible } });
    const other = makeEmpire();
    const galaxy = makeGalaxy(player);
    const fighter = (parent: BuiltObject | null, onboard = false): Fighter =>
        ({ empire: other, xpos: 0, ypos: 0, onboardCarrier: onboard, parentBuiltObject: parent }) as unknown as Fighter;
    it('is seen when its carrier is; not when the carrier is unseen or it is still aboard', () => {
        const seenCarrier = ship({ empire: other, nearestSystemStar: star(S_KNOWN) });
        const unseenCarrier = ship({ empire: other, nearestSystemStar: star(S_UNSEEN) });
        expect(fighterVisibleToPlayer(galaxy, player, fighter(seenCarrier))).toBe(true);
        expect(fighterVisibleToPlayer(galaxy, player, fighter(unseenCarrier))).toBe(false);
        expect(fighterVisibleToPlayer(galaxy, player, fighter(seenCarrier, true))).toBe(false);
        expect(fighterVisibleToPlayer(galaxy, player, fighter(null))).toBe(false);
    });
    it('a known pirate base alone does not reveal its fighters', () => {
        const base = ship({ empire: other, nearestSystemStar: star(S_UNSEEN) });
        const p2 = makeEmpire({ knownPirateBases: [base] });
        const g2 = makeGalaxy(p2);
        expect(builtObjectVisibleToPlayer(g2, p2, base)).toBe(true); // the base itself is known
        expect(fighterVisibleToPlayer(g2, p2, fighter(base))).toBe(false);
    });
    it('an own fighter is seen', () => {
        const own = { empire: player, xpos: 0, ypos: 0, onboardCarrier: false, parentBuiltObject: null } as unknown as Fighter;
        expect(fighterVisibleToPlayer(galaxy, player, own)).toBe(true);
    });
});

describe('creatures', () => {
    const player = makeEmpire({ status: { [S_KNOWN]: SystemVisibilityStatus.Visible } });
    const galaxy = makeGalaxy(player);
    it('seen in a visible system, unseen in an unexplored one', () => {
        const c = (idx: number): Creature => ({ isVisible: true, nearestSystemStar: star(idx), xpos: 9e6, ypos: 9e6 }) as unknown as Creature;
        expect(creatureVisibleToPlayer(galaxy, player, c(S_KNOWN))).toBe(true);
        expect(creatureVisibleToPlayer(galaxy, player, c(S_UNSEEN))).toBe(false);
    });
});

describe('bodies of unexplored systems (MainView.1.cs 440-448)', () => {
    const player = makeEmpire({ status: { [S_KNOWN]: SystemVisibilityStatus.Explored } });
    const galaxy = makeGalaxy(player);
    const U = SystemVisibilityStatus.Unexplored;
    it('explored / visible systems draw everything', () => {
        const planet = body(S_KNOWN, HabitatCategoryType.Planet);
        expect(habitatDrawnInFog(galaxy, player, planet, SystemVisibilityStatus.Explored, false)).toBe(true);
        expect(habitatDrawnInFog(galaxy, player, planet, SystemVisibilityStatus.Visible, false)).toBe(true);
    });
    it('an unexplored system draws only its star without sensors in range', () => {
        expect(habitatDrawnInFog(galaxy, player, star(S_UNSEEN), U, false)).toBe(true);
        for (const c of [HabitatCategoryType.Planet, HabitatCategoryType.Moon, HabitatCategoryType.Asteroid, HabitatCategoryType.GasCloud]) {
            expect(habitatDrawnInFog(galaxy, player, body(S_UNSEEN, c), U, false)).toBe(false);
        }
    });
    it('with sensors in range: gas clouds and visible bodies only', () => {
        expect(habitatDrawnInFog(galaxy, player, body(S_UNSEEN, HabitatCategoryType.GasCloud), U, true)).toBe(true);
        expect(habitatDrawnInFog(galaxy, player, body(S_UNSEEN, HabitatCategoryType.Planet), U, true)).toBe(false);
        expect(habitatDrawnInFog(galaxy, player, body(S_UNSEEN, HabitatCategoryType.Planet, 0, 0, player), U, true)).toBe(true); // ours
        const scanner = ship({ empire: player, xpos: 0, ypos: 0, sensorLongRange: 500 });
        const p2 = makeEmpire({ scanners: [scanner] });
        const g2 = makeGalaxy(p2);
        expect(habitatDrawnInFog(g2, p2, body(S_UNSEEN, HabitatCategoryType.Planet, 300, 0), U, true)).toBe(true);
        expect(habitatDrawnInFog(g2, p2, body(S_UNSEEN, HabitatCategoryType.Planet, 900, 0), U, true)).toBe(false);
    });
    it('flag4: own ships / scanners within MaxSolarSystemSize + 500 of the star (minus their range)', () => {
        const near = ship({ empire: player, xpos: 60000, ypos: 0 }); // 60000 - THREAT_RANGE 40000 = 20000 <= 23500
        const far = ship({ empire: player, xpos: 100000, ypos: 0 });
        const enemyNear = ship({ empire: makeEmpire(), xpos: 1, ypos: 0 });
        expect(systemHasPlayerSensors(makeGalaxy(player, [near]), player, star(S_UNSEEN))).toBe(true);
        expect(systemHasPlayerSensors(makeGalaxy(player, [far]), player, star(S_UNSEEN))).toBe(false);
        expect(systemHasPlayerSensors(makeGalaxy(player, [enemyNear]), player, star(S_UNSEEN))).toBe(false);
    });
    it('a body of an unexplored system cannot be hovered or selected (Main.Part10.cs 1291)', () => {
        expect(habitatInfoKnown(player, body(S_UNSEEN, HabitatCategoryType.Planet))).toBe(false);
        expect(habitatInfoKnown(player, body(S_KNOWN, HabitatCategoryType.Planet))).toBe(true);
        expect(habitatInfoKnown(null, body(S_UNSEEN, HabitatCategoryType.Planet))).toBe(true);
    });
});

describe('FogOfWar per-frame cache', () => {
    it('answers once per frame per object; begin() forgets', () => {
        let visible = false;
        const player = makeEmpire();
        (player.visibility as unknown as { checkSystemVisible: (i: number) => boolean }).checkSystemVisible = () => visible;
        const galaxy = makeGalaxy(player);
        const fog = fogOf(galaxy);
        const bo = ship({ empire: makeEmpire(), nearestSystemStar: star(S_UNSEEN) });
        expect(fog.builtObject(bo)).toBe(false);
        visible = true;
        expect(fog.builtObject(bo)).toBe(false); // cached for this frame
        fog.begin();
        expect(fog.builtObject(bo)).toBe(true);
        expect(fogOf(galaxy)).toBe(fog);
    });
});

describe('picking and the selection panel', () => {
    const player = makeEmpire({ status: { [S_KNOWN]: SystemVisibilityStatus.Visible } });
    const other = makeEmpire();
    const seen = ship({ empire: other, xpos: 100, ypos: 100, nearestSystemStar: star(S_KNOWN) });
    const unseen = ship({ empire: other, xpos: 100, ypos: 100, size: 10, nearestSystemStar: star(S_UNSEEN) });
    const galaxy = makeGalaxy(player, [seen, unseen]);
    it('unseen ships are not pickable, even when smaller and under the cursor', () => {
        fogOf(galaxy).begin();
        const list = pickableBuiltObjects(galaxy);
        expect(list).toEqual([seen]);
        expect(pickBuiltObjectBySize(list, 100, 100, 1, () => 20)).toBe(seen);
        // without the fog the smaller one would win the tie
        expect(pickBuiltObjectBySize([seen, unseen], 100, 100, 1, () => 20)).toBe(unseen);
    });
    it('the selection panel drops an unseen ship / fleet lead / creature, keeps seen and own ones', () => {
        expect(selectionUnseen(galaxy, player, { builtObject: unseen })).toBe(true);
        expect(selectionUnseen(galaxy, player, { builtObject: seen })).toBe(false);
        expect(selectionUnseen(galaxy, player, { builtObject: ship({ empire: player, nearestSystemStar: star(S_UNSEEN) }) })).toBe(false);
        expect(selectionUnseen(galaxy, player, { shipGroup: { leadShip: unseen } })).toBe(true);
        const c = { isVisible: true, nearestSystemStar: star(S_UNSEEN), xpos: 9e6, ypos: 9e6 } as unknown as Creature;
        expect(selectionUnseen(galaxy, player, { creature: c })).toBe(true);
        expect(selectionUnseen(galaxy, player, null)).toBe(false);
        expect(selectionUnseen(galaxy, null, { builtObject: unseen })).toBe(false);
    });
});
