// [improvements] Automatic design upgrades along the same tech line (src/sim/player/designLineUpgrade.ts), on the
// seed-1 harness game. The lines are research.txt PARENTS (verified here against the data):
//   Maxos Blaster (0, project 6 Enhanced Beam Weapons) → Phaser Cannon (106, 290 Phased Beams ← 7 Efficient Blasters ← 6)
//   Phaser Cannon (106, 290) → Phaser Lance (110, 301 Phaser Focusing ← 290); not Titan Beam (3, 9 Advanced Beams on the
//   laser branch 4 / 13)
//   Seeking Missile (128, 369) → Concussion Missile (10, 48 ← 369) → Assault Missile (108, 297 ← 50 ← … ← 369); the
//   torpedoes under 369 (Nuclear Exterminator 12, project 42) are another slot kind
//   Warp Bubble (125, 363) → Gerax (47, 166 ← 363) → Kaldos (48, 157 ← 167 ← 166) → Torrent (51, 169 ← 158 ← 157);
//   Kaldos ↛ Equinox (49, 160 ← 167: a sibling branch)
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { Game } from '../src/sim/game';
import type { BuiltObject } from '../src/sim/builtObject';
import type { ComponentDefinition } from '../src/sim/componentStatic';
import type { Design } from '../src/sim/design';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { ComponentType } from '../src/sim/data/components';
import { cloneDesign } from '../src/sim/gameStartTail';
import { createNewDesigns, findNewestCanBuildFullEvaluate } from '../src/sim/designGeneration';
import { galaxyStarDate } from '../src/sim/tick/simTime';
import { reviewDesignsAndRetrofit } from '../src/sim/construction/empireConstruction';
import { doResearchBreakthrough } from '../src/sim/researchTick';
import { copyDesign } from '../src/sim/player/designEditor';
import { runPlayerCommand } from '../src/sim/player/playerCommands';
import {
    bestLineReplacement,
    designLineOwnsSubRole,
    isSameLine,
    lineRetrofitDesign,
    markPlayerDesignSubRole,
    playerOwnsDesignSubRole,
    processDesignLineUpgrades,
    setDesignLineUpgrade,
    upgradeDesignAlongLines,
} from '../src/sim/player/designLineUpgrade';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';

const S = BuiltObjectSubRole;
let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function fresh(): { game: Game; g: Galaxy; p: Empire } {
    const game = cachedTickGame(gameData);
    return { game, g: game.galaxy, p: game.galaxy.playerEmpire! };
}

function comp(p: Empire, id: number): ComponentDefinition {
    const c = p.research.definitionFor(id);
    if (c === undefined) throw new Error(`component ${id}`);
    return c;
}

/** Research these projects (as a breakthrough would mark them) and refresh the research tables. */
function grant(p: Empire, ...projectIds: number[]): void {
    for (const id of projectIds) {
        const n = p.research.techTree.find((x) => x.def.projectId === id);
        if (n === undefined) throw new Error(`project ${id}`);
        n.isResearched = true;
    }
    p.research.update(p.dominantRace);
}

/** A manual player frigate whose weapons are `weaponId` (the seed's Apulon frigate carries Maxos Blasters, id 0). */
function frigateWith(g: Galaxy, p: Empire, name: string, weaponId: number): Design {
    const base = p.designs.find((d) => d.subRole === S.Frigate && !d.isObsolete)!;
    const d = cloneDesign(base);
    d.name = name;
    // As many of `weaponId` as fit in the blasters' space (the design stays within the frigate size limit).
    const room = d.components.filter((c) => c.componentId === 0).length * 5;
    let left = Math.max(1, Math.floor(room / comp(p, weaponId).size));
    d.components = d.components.filter((c) => c.componentId !== 0 || left-- > 0).map((c) => (c.componentId === 0 ? comp(p, weaponId) : c));
    d.isManuallyCreated = true;
    d.dateCreated = galaxyStarDate(g);
    d.empire = p;
    d.reDefine();
    p.designs.push(d);
    return d;
}

const ids = (d: Design): number[] => d.components.map((c) => c.componentId);

describe('designLineUpgrade: tech lines (research.txt PARENTS)', () => {
    it('blaster → phaser is on the line; phaser → titan beam is not', () => {
        const { g, p } = fresh();
        expect(isSameLine(g, comp(p, 0), comp(p, 106))).toBe(true); // Maxos Blaster → Phaser Cannon
        expect(isSameLine(g, comp(p, 106), comp(p, 110))).toBe(true); // Phaser Cannon → Phaser Lance
        expect(isSameLine(g, comp(p, 106), comp(p, 3))).toBe(false); // Phaser Cannon ↛ Titan Beam
        expect(isSameLine(g, comp(p, 110), comp(p, 106))).toBe(false); // never backwards
    });

    it('a missile only becomes a missile', () => {
        const { g, p } = fresh();
        expect(isSameLine(g, comp(p, 128), comp(p, 10))).toBe(true); // Seeking → Concussion
        expect(isSameLine(g, comp(p, 10), comp(p, 108))).toBe(true); // Concussion → Assault Missile
        expect(isSameLine(g, comp(p, 128), comp(p, 12))).toBe(false); // the Nuclear Exterminator torpedo descends from 369 too
        expect(isSameLine(g, comp(p, 10), comp(p, 0))).toBe(false);
    });

    it('the hyperdrive chain follows the drive tree', () => {
        const { g, p } = fresh();
        expect(isSameLine(g, comp(p, 125), comp(p, 47))).toBe(true); // Warp Bubble → Gerax
        expect(isSameLine(g, comp(p, 47), comp(p, 48))).toBe(true); // Gerax → Kaldos
        expect(isSameLine(g, comp(p, 48), comp(p, 51))).toBe(true); // Kaldos → Torrent
        expect(isSameLine(g, comp(p, 48), comp(p, 49))).toBe(false); // Kaldos ↛ Equinox (sibling branch)
        expect(isSameLine(g, comp(p, 49), comp(p, 48))).toBe(false);
    });

    it('picks the strongest researched candidate on the line, only when strictly better', () => {
        const { g, p } = fresh();
        // Nothing on the Maxos line beyond what the seed has: no replacement.
        expect(bestLineReplacement(g, p, comp(p, 0))).toBeNull();
        grant(p, 7, 290, 301, 9);
        const ci = (id: number) => p.research.resolveImprovedComponentValues(comp(p, id));
        // Phaser Cannon → Phaser Lance (the stronger phaser), never the Titan Beam of the laser branch.
        const fromPhaser = bestLineReplacement(g, p, comp(p, 106));
        expect(fromPhaser?.componentId).toBe(110);
        expect(ci(110).value1).toBeGreaterThan(ci(106).value1);
        // The top of a line stays.
        expect(bestLineReplacement(g, p, comp(p, 110))).toBeNull();
        // Whatever the blaster becomes is strictly better by DetermineBestComponent's value1 (tie → smaller).
        const fromBlaster = bestLineReplacement(g, p, comp(p, 0))!;
        expect(fromBlaster).not.toBeNull();
        const a = ci(0);
        const b = ci(fromBlaster.componentId);
        expect(b.value1 > a.value1 || (b.value1 === a.value1 && b.improvedComponent.size < a.improvedComponent.size)).toBe(true);
        expect(isSameLine(g, comp(p, 0), fromBlaster)).toBe(true);
    });
});

describe('designLineUpgrade: upgrading designs', () => {
    it('keeps the layout: every slot keeps its place, beams stay beams, missiles stay missiles', () => {
        const { g, p } = fresh();
        const phaser = frigateWith(g, p, 'Phaser Frigate', 106);
        grant(p, 7, 290, 301, 297, 42);
        const mixed = cloneDesign(phaser);
        // Half the phasers become Concussion Missiles.
        let n = 0;
        mixed.components = mixed.components.map((c) => (c.componentId === 106 && n++ % 2 === 0 ? comp(p, 10) : c));
        mixed.reDefine();
        const up = upgradeDesignAlongLines(g, p, mixed)!;
        expect(up).not.toBeNull();
        expect(up.components.length).toBeGreaterThanOrEqual(mixed.components.length);
        for (let i = 0; i < mixed.components.length; i++) {
            const was = mixed.components[i];
            const now = up.components[i];
            if (was.componentId === 106) expect(now.componentId).toBe(110);
            else if (was.componentId === 10) expect(now.type).toBe(ComponentType.WeaponMissile);
            else expect(isSameLine(g, was, now)).toBe(true);
        }
        // Anything after the original slots is the hab modules / life support the Upgrade path tops up.
        for (const c of up.components.slice(mixed.components.length)) expect([ComponentType.HabitationHabModule, ComponentType.HabitationLifeSupport]).toContain(c.type);
    });

    it('research completion upgrades the player-owned types: Mk2, the old one obsolete, no automation frigate', () => {
        const { g, p } = fresh();
        setDesignLineUpgrade(g, p, true);
        markPlayerDesignSubRole(g, p, S.Frigate);
        const beam = frigateWith(g, p, 'Lance', 106);
        const missile = frigateWith(g, p, 'Dart', 10);
        const frigatesBefore = p.designs.filter((d) => d.subRole === S.Frigate).length;
        grant(p, 7, 290);
        const node = p.research.techTree.find((x) => x.def.projectId === 301)!;
        doResearchBreakthrough(g, p, node, true, true);
        grant(p, 297);
        expect(p.reviewDesignsAndRetrofitFlag).toBe(true);
        reviewDesignsAndRetrofit(g, p);
        const frigates = p.designs.filter((d) => d.subRole === S.Frigate);
        const lance2 = frigates.find((d) => d.name === 'Lance Mk2')!;
        const dart2 = frigates.find((d) => d.name === 'Dart Mk2')!;
        expect(lance2).toBeDefined();
        expect(dart2).toBeDefined();
        expect(lance2.upgradedFrom).toBe(beam);
        expect(dart2.upgradedFrom).toBe(missile);
        expect(beam.isObsolete).toBe(true);
        expect(missile.isObsolete).toBe(true);
        expect(ids(lance2)).toContain(110);
        expect(ids(lance2)).not.toContain(108);
        expect(ids(dart2)).toContain(108);
        expect(ids(dart2)).not.toContain(110);
        // Only the line upgrades are new frigates (the seed's own Apulon frigate is upgraded too): automation made none.
        const newFrigates = frigates.length - frigatesBefore;
        expect(frigates.filter((d) => d.upgradedFrom !== undefined).length).toBe(newFrigates);
    });
});

describe('designLineUpgrade: design automation per design type', () => {
    function automationRun(touch: boolean): { p: Empire; added: Design[] } {
        const { g, p } = fresh();
        setDesignLineUpgrade(g, p, true);
        if (touch) markPlayerDesignSubRole(g, p, S.Frigate);
        grant(p, 7, 290, 301, 297, 167, 157);
        const before = new Set(p.designs);
        const now = galaxyStarDate(g);
        createNewDesigns(g, p, now, now, true);
        return { p, added: p.designs.filter((d) => !before.has(d)) };
    }

    it('touching a sub-role stops automation generating for it; untouched sub-roles still auto-generate', () => {
        const untouched = automationRun(false);
        expect(untouched.added.some((d) => d.subRole === S.Frigate)).toBe(true);
        expect(untouched.added.some((d) => d.subRole === S.Escort)).toBe(true);
        const touched = automationRun(true);
        expect(touched.added.some((d) => d.subRole === S.Frigate)).toBe(false);
        expect(touched.added.some((d) => d.subRole === S.Escort)).toBe(true);
        // The untouched types are all still generated (their names draw Galaxy.Rnd, so only the frigate's draws differ).
        const roles = (r: { added: Design[] }) => r.added.map((d) => d.subRole).filter((x) => x !== S.Frigate);
        expect(roles(touched)).toEqual(roles(untouched));
    });

    it('a design save through the player command marks its sub-role', () => {
        const { g, p } = fresh();
        expect(playerOwnsDesignSubRole(p, S.Destroyer)).toBe(false);
        const source = p.designs.find((d) => d.subRole === S.Destroyer)!;
        const draft = copyDesign(g, p, source);
        const r = runPlayerCommand(g, p, 'saveDesign', [draft]);
        expect(r.ok).toBe(true);
        expect(playerOwnsDesignSubRole(p, S.Destroyer)).toBe(true);
        expect(p.playerDesignSubRoles).toEqual([S.Destroyer]);
        // Not active until the Improvement switch reaches the sim.
        expect(designLineOwnsSubRole(g, p, S.Destroyer)).toBe(false);
        runPlayerCommand(g, p, 'setDesignLineUpgrade', [true]);
        expect(designLineOwnsSubRole(g, p, S.Destroyer)).toBe(true);
    });
});

describe('designLineUpgrade: retrofit', () => {
    it('sends a ship to the newest upgrade of its own design, not the newest of its sub-role', () => {
        const { g, p } = fresh();
        setDesignLineUpgrade(g, p, true);
        markPlayerDesignSubRole(g, p, S.Frigate);
        const beam = frigateWith(g, p, 'Lance', 106);
        const missile = frigateWith(g, p, 'Dart', 10);
        grant(p, 7, 290, 301, 297);
        processDesignLineUpgrades(g, p);
        const lance2 = p.designs.find((d) => d.name === 'Lance Mk2')!;
        const dart2 = p.designs.find((d) => d.name === 'Dart Mk2')!;
        dart2.dateCreated = lance2.dateCreated + 1; // the missile line is the newest frigate
        const newestOfSubRole = findNewestCanBuildFullEvaluate(p.designs, S.Frigate, null);
        expect(newestOfSubRole).toBe(dart2);
        const ship = (design: Design) => ({ design, subRole: S.Frigate }) as unknown as BuiltObject;
        expect(lineRetrofitDesign(g, p, ship(beam), newestOfSubRole)).toBe(lance2);
        expect(lineRetrofitDesign(g, p, ship(missile), newestOfSubRole)).toBe(dart2);
        // Already the newest of its line: it stays (not refitted into the missile frigate).
        expect(lineRetrofitDesign(g, p, ship(lance2), newestOfSubRole)).toBe(lance2);
        // Off: the original choice.
        setDesignLineUpgrade(g, p, false);
        expect(lineRetrofitDesign(g, p, ship(beam), newestOfSubRole)).toBe(newestOfSubRole);
    });
});

describe('designLineUpgrade: off is the original', () => {
    it('owned sub-roles with the switch off: the same designs and the same Rnd as an untouched game', () => {
        const run = (mark: boolean) => {
            const { g, p } = fresh();
            if (mark) {
                markPlayerDesignSubRole(g, p, S.Frigate);
                setDesignLineUpgrade(g, p, true);
                setDesignLineUpgrade(g, p, false);
            }
            frigateWith(g, p, 'Lance', 106);
            grant(p, 7, 290, 301, 297, 167, 157);
            p.reviewDesignsAndRetrofitFlag = true;
            reviewDesignsAndRetrofit(g, p);
            const now = galaxyStarDate(g);
            createNewDesigns(g, p, now, now, true);
            return {
                designs: p.designs.map((d) => `${d.name}|${d.isObsolete}|${ids(d).join(',')}`),
                flag: 'designLineUpgrade' in p,
                rnd: [g.rnd.next(0, 1 << 30), g.rnd.next(0, 1 << 30), g.rnd.next(0, 1 << 30)],
            };
        };
        const original = run(false);
        const marked = run(true);
        expect(marked.designs).toEqual(original.designs);
        expect(marked.rnd).toEqual(original.rnd);
        expect(marked.flag).toBe(false);
        const f = fresh();
        expect(processDesignLineUpgrades(f.g, f.p)).toEqual([]);
    });
});

describe('designLineUpgrade: save / load', () => {
    it('the switch, the player-owned sub-roles and the lineage round-trip; an untouched game saves none of them', () => {
        const { game, g, p } = fresh();
        const time = new GalaxyTime();
        time.togglePause();
        const start = { ...defaultStartGameOptions(), seed: 1 };
        const plain = serializeGame(game, time, start);
        expect(plain).not.toContain('playerDesignSubRoles');
        expect(plain).not.toContain('upgradedFrom');
        expect(plain).not.toContain('designLineUpgrade');
        setDesignLineUpgrade(g, p, true);
        markPlayerDesignSubRole(g, p, S.Frigate);
        markPlayerDesignSubRole(g, p, S.Escort);
        frigateWith(g, p, 'Lance', 106);
        grant(p, 7, 290, 301);
        expect(processDesignLineUpgrades(g, p).length).toBeGreaterThan(0);
        const loaded = deserializeGame(serializeGame(game, time, start), gameData).game;
        const p2 = loaded.galaxy.playerEmpire!;
        expect(p2.designLineUpgrade).toBe(true);
        expect(p2.playerDesignSubRoles).toEqual([S.Escort, S.Frigate].sort((a, b) => a - b));
        const lance2 = p2.designs.find((d) => d.name === 'Lance Mk2')!;
        expect(lance2.upgradedFrom?.name).toBe('Lance');
        expect(p2.designs).toContain(lance2.upgradedFrom);
        expect(designLineOwnsSubRole(loaded.galaxy, p2, S.Frigate)).toBe(true);
    }, 300000);
});
