// The Designs window's design tools (src/sim/player/designTools.ts): the "Only Show Latest Components" toolbox,
// "Auto Upgrade Selected Designs" and the design file round-trip, on the seed-1 harness game.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { findNewest } from '../src/sim/design';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { ComponentType } from '../src/sim/data/components';
import { ComponentCategoryType } from '../src/sim/data/policies';
import { cloneDesign } from '../src/sim/gameStartTail';
import { galaxyCurrentStarDate } from '../src/sim/pirateRelations';
import { designToolboxComponents } from '../src/sim/player/designEditor';
import {
    autoUpgradeDesigns,
    latestToolboxComponents,
    loadDesignFile,
    parseDesignFile,
    resolveLatestStandardTorpedoWeapon,
    writeDesignFile,
} from '../src/sim/player/designTools';
import { runPlayerCommand } from '../src/sim/player/playerCommands';
import { commandLog } from '../src/sim/player/commandLog';

const S = BuiltObjectSubRole;
const C = ComponentCategoryType;
let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function game(): { g: Galaxy; p: Empire } {
    const g = cachedTickGame(gameData).galaxy;
    return { g, p: g.playerEmpire! };
}

describe('design tools: latest components', () => {
    it('lists a subset of the researched components with the latest of each main category', () => {
        const { g, p } = game();
        const all = designToolboxComponents(p);
        const latest = latestToolboxComponents(g, p);
        const ids = latest.map((c) => c.componentId);
        expect(latest.length).toBeGreaterThan(0);
        expect(latest.length).toBeLessThan(all.length);
        expect(new Set(ids).size).toBe(ids.length);
        // Every listed component is researched.
        for (const c of latest) expect(p.research.checkComponentResearched(c)).toBe(true);
        for (const cat of [C.Armor, C.Reactor, C.Shields, C.WeaponBeam, C.HyperDrive]) {
            const l = p.research.getLatestComponent(cat, true);
            if (l !== null) expect(ids).toContain(l.componentId);
        }
        // An older researched reactor (lower tech level than the latest, not improved up to it) is filtered out.
        const latestReactor = p.research.getLatestComponent(ComponentType.Reactor)!;
        const reactors = p.research.getLatestComponents(ComponentType.Reactor).map((c) => c.componentId);
        expect(reactors[0]).toBe(latestReactor.componentId);
        const older = all.filter((c) => c.type === ComponentType.Reactor && !reactors.includes(c.componentId));
        for (const c of older) expect(ids).not.toContain(c.componentId);
        // The standard torpedo lookup is a researched, non-missile, non-bombard torpedo.
        const torp = resolveLatestStandardTorpedoWeapon(g, p);
        if (torp !== null) {
            expect(torp.category).toBe(C.WeaponTorpedo);
            expect(torp.type).not.toBe(ComponentType.WeaponMissile);
            expect(torp.value7).toBeLessThanOrEqual(0);
            expect(ids).toContain(torp.componentId);
        }
    });
});

describe('design tools: auto upgrade', () => {
    it('upgrades an outdated design to the latest components, renames it Mk2 and obsoletes the old one', () => {
        const { g, p } = game();
        const template = findNewest(p.designs, S.Escort)!;
        // An outdated copy: its main-thrust engines swapped for the weakest researched one.
        const latestEngine = p.research.evaluateDesiredComponent(ComponentType.EngineMainThrust, 0, true)!;
        const weaker = designToolboxComponents(p).find((c) => c.type === ComponentType.EngineMainThrust && c.componentId !== latestEngine.componentId);
        expect(weaker).toBeDefined(); // seed 1 has an older main-thrust engine researched
        const outdated = cloneDesign(template);
        outdated.name = 'Outdated Escort';
        outdated.components = outdated.components.map((c) => (c.type === ComponentType.EngineMainThrust ? weaker! : c));
        outdated.reDefine();
        p.designs.push(outdated);
        const before = p.designs.length;

        const res = runPlayerCommand(g, p, 'autoUpgradeDesigns', [[outdated]]);
        const entry = commandLog(g).at(-1)!;
        expect('op' in entry && entry.op).toBe('autoUpgradeDesigns');
        expect(res.added).toHaveLength(1);
        const up = res.added[0];
        expect(res.select).toBe(up);
        expect(p.designs.length).toBe(before + 1);
        expect(p.designs).toContain(up);
        expect(up.name).toBe('Outdated Escort Mk2');
        expect(outdated.isObsolete).toBe(true);
        expect(up.isObsolete).toBe(false);
        expect(up.isManuallyCreated).toBe(true);
        expect(up.buildCount).toBe(0);
        expect(up.empire).toBe(p);
        expect(up.dateCreated).toBe(galaxyCurrentStarDate(g));
        expect(up.components.filter((c) => c.type === ComponentType.EngineMainThrust).every((c) => c.componentId === latestEngine.componentId)).toBe(true);
        expect(up.components.some((c) => c.componentId === weaker!.componentId)).toBe(false);
    });

    it('leaves an up-to-date design alone', () => {
        const { g, p } = game();
        const design = findNewest(p.designs, S.Escort)!;
        // First bring it up to date, then a second upgrade of the result changes nothing.
        const first = autoUpgradeDesigns(g, p, [design]);
        const current = first.added[0] ?? design;
        const count = p.designs.length;
        const second = autoUpgradeDesigns(g, p, [current]);
        expect(second.added).toEqual([]);
        expect(second.select).toBeNull();
        expect(p.designs.length).toBe(count);
        expect(current.isObsolete).toBe(false);
    });
});

describe('design tools: design files', () => {
    it('round-trips designs through a file and skips the ones already present', () => {
        const { g, p } = game();
        const designs = [findNewest(p.designs, S.Escort)!, findNewest(p.designs, S.ConstructionShip)!].filter((d) => d !== null);
        const text = writeDesignFile(designs);
        const parsed = parseDesignFile(g, text);
        expect(parsed.skipped).toBe(0);
        expect(parsed.designs).toHaveLength(designs.length);
        parsed.designs!.forEach((d, i) => {
            const src = designs[i];
            expect(d.name).toBe(src.name);
            expect(d.empire).toBeNull();
            expect(d.subRole).toBe(src.subRole);
            expect(d.role).toBe(src.role);
            expect(d.pictureRef).toBe(src.pictureRef);
            expect(d.tacticsStrongerShips).toBe(src.tacticsStrongerShips);
            expect(d.fleeWhen).toBe(src.fleeWhen);
            expect(d.allowAutoRetrofit).toBe(src.allowAutoRetrofit);
            expect(d.isEquivalent(src)).toBe(true);
        });
        // Galaxy.LoadDesigns: the same designs (equivalent, same name) are already there → nothing added.
        const count = p.designs.length;
        expect(loadDesignFile(g, p, text)).toMatchObject({ ok: true, loaded: [] });
        expect(p.designs.length).toBe(count);

        // Renamed in the file → loaded, owned by the player, BuildCount 0, dated now, ReDefined.
        const renamed = text.replace(`"name": ${JSON.stringify(designs[0].name)}`, '"name": "Imported Escort"');
        const res = runPlayerCommand(g, p, 'loadDesignFile', [renamed]);
        expect(res.ok).toBe(true);
        expect(res.loaded.map((d) => d.name)).toEqual(['Imported Escort']);
        const loaded = res.loaded[0];
        expect(p.designs).toContain(loaded);
        expect(loaded.empire).toBe(p);
        expect(loaded.buildCount).toBe(0);
        expect(loaded.dateCreated).toBe(galaxyCurrentStarDate(g));
        expect(loaded.size).toBe(designs[0].size);
        expect(loaded.isEquivalent(designs[0])).toBe(true);
        // Saving the loaded design gives the same file entry (apart from the name and date).
        const again = JSON.parse(writeDesignFile([loaded])).designs[0];
        const orig = JSON.parse(writeDesignFile([designs[0]])).designs[0];
        expect({ ...again, name: '', dateCreated: 0, buildCount: 0 }).toEqual({ ...orig, name: '', dateCreated: 0, buildCount: 0 });
    });

    it('refuses text that is not a design file', () => {
        const { g, p } = game();
        const count = p.designs.length;
        expect(parseDesignFile(g, 'not json').designs).toBeNull();
        expect(parseDesignFile(g, '{"format":"other"}').designs).toBeNull();
        const res = loadDesignFile(g, p, 'garbage');
        expect(res.ok).toBe(false);
        expect(res.message).toBeDefined();
        expect(p.designs.length).toBe(count);
        // An unknown component id skips that design.
        const bad = JSON.stringify({ format: 'dwu-designs', version: 1, designs: [{ name: 'X', components: [999999] }] });
        expect(parseDesignFile(g, bad)).toEqual({ designs: [], skipped: 1 });
    });
});
