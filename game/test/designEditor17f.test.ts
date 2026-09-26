// Task 17f: the player design editor (src/sim/player/designEditor.ts) on a createGame galaxy (seed 1, test/helpers/tickGame.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { BuiltObjectStance, findNewest } from '../src/sim/design';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { ComponentType } from '../src/sim/data/components';
import { BattleTactics, BuiltObjectFleeWhen, BuiltObjectRole, InvasionTactics } from '../src/sim/data/designSpecifications';
import { canBuildDesign, checkDesignSubRoleShouldBeUpgraded } from '../src/sim/designGeneration';
import { galaxyCurrentStarDate } from '../src/sim/pirateRelations';
import { getText, resolveGameText } from '../src/sim/textResolver';
import {
    addComponent,
    checkDesignInUseForConstructionOrRetrofits,
    copyDesign,
    deleteDesign,
    designToolboxComponents,
    designWarnings,
    newDesignDraft,
    nextMarkName,
    removeComponent,
    saveDesign,
    setDesignSubRoleShouldBeUpgraded,
    setObsolete,
    summarizeComponents,
} from '../src/sim/player/designEditor';
import { DesignFilter, DesignTypeFilter, designRow, filterDesigns } from '../src/ui/screens/shipDesigns';

const S = BuiltObjectSubRole;
let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function game(): { g: Galaxy; p: Empire } {
    const g = cachedTickGame(gameData).galaxy;
    return { g, p: g.playerEmpire! };
}

describe('17f design editor', () => {
    it('drafts an escort from the newest escort template (btnDesignsUpgradeManual_Click)', () => {
        const { g, p } = game();
        const template = findNewest(p.designs, S.Escort)!;
        expect(template.name).toBe('Praefectus'); // seed 1
        const draft = newDesignDraft(g, p, { kind: 'upgrade', design: template });
        expect(draft.mode).toBe('copyasnew');
        expect(draft.replaces).toBe(template);
        expect(draft.design.name).toBe('Praefectus Mk2');
        expect(draft.design.subRole).toBe(S.Escort);
        expect(draft.design.components.map((c) => c.componentId)).toEqual(template.components.map((c) => c.componentId));
        expect(draft.design.isObsolete).toBe(false);
        expect(draft.design.buildCount).toBe(0);
        expect(draft.design.dateCreated).toBe(galaxyCurrentStarDate(g));
        expect(p.designs).not.toContain(draft.design);
    });

    it('names copies like btnDesignsCopyAsNew_Click', () => {
        expect(nextMarkName('Javelin')).toBe('Javelin Mk2');
        expect(nextMarkName('Big Javelin')).toBe('Big Javelin Mk2');
        expect(nextMarkName('Javelin Mk2')).toBe('Javelin Mk3');
        expect(nextMarkName('Javelin Mk 9')).toBe('Javelin Mk 9 Mk2'); // last word "9" has no "Mk"
        expect(nextMarkName('Javelin Mkx')).toBe('Javelin Mkx Mk2');
    });

    it('warns like GetDesignWarningMessages: no engine (red) and over the size limit (advisory)', () => {
        const { g, p } = game();
        const draft = copyDesign(g, p, findNewest(p.designs, S.Escort)!);
        // The seed-1 player supplies none of these, so the resources line is the template's only warning.
        const base = designWarnings(g, p, draft.design);
        expect(base.mustDo).toEqual([]);
        expect(base.shouldDo).toEqual(['We do not have a supply of all required resources|(Silicon, Polymer, Carbon Fibre, Helium, Nekros Stone, Iridium, Chromium)']);
        expect(resolveGameText(base.shouldDo[0])).toBe('We do not have a supply of required resources (Silicon, Polymer, Carbon Fibre, Helium, Nekros Stone, Iridium, Chromium)');

        // Remove all 6 Proton Thrusters (EngineMainThrust): list (must-have types) → "Must have a {0} component".
        const thruster = draft.design.components.find((c) => c.type === ComponentType.EngineMainThrust)!;
        expect(removeComponent(draft, thruster, 5).ok).toBe(true);
        expect(draft.design.components.filter((c) => c.type === ComponentType.EngineMainThrust)).toHaveLength(1);
        expect(removeComponent(draft, thruster).ok).toBe(true);
        const noEngine = designWarnings(g, p, draft.design);
        expect(noEngine.mustDo).toEqual([`Must have a X component|${getText('Component Type Main Thrust Engine')}`]);
        expect(resolveGameText(noEngine.mustDo[0])).toBe('Must have a Main Thrust Engine component');
        expect(saveDesign(g, p, draft)).toMatchObject({
            ok: false, design: null, title: 'Cannot Save Design', message: 'All warnings in red must be resolved before this design can be saved',
        });

        // Put them back and add armor until the size passes Empire.MaximumConstructionSize(Escort).
        addComponent(p, draft, thruster, 5);
        addComponent(p, draft, thruster);
        const armor = draft.design.components.find((c) => c.type === ComponentType.Armor)!;
        const max = p.maximumConstructionSize(S.Escort);
        while (draft.design.size <= max) addComponent(p, draft, armor, 5);
        const big = designWarnings(g, p, draft.design);
        // The extra armor is non-habitation size the 3 Hab Modules / 2 Life Supports no longer cover.
        expect(big.mustDo).toEqual(['Need more Habitation Modules', 'Need more Life Support components']);
        expect(big.shouldDo).toContain(`Cannot currently build a design of this size maximum size|${draft.design.size}|${max}`);
        expect(resolveGameText(big.shouldDo[1])).toBe(`Cannot currently build a design of this size (${draft.design.size}), maximum size ${max}`);
        // New armor lands right after the last armor (LastIndexById + 1), not at the end.
        const ids = draft.design.components.map((c) => c.componentId);
        expect(ids.lastIndexOf(armor.componentId)).toBeLessThan(ids.length - 1);
    });

    it('blank design warnings for an undefined sub-role, then the sub-role defaults (method_388)', () => {
        const { g, p } = game();
        const draft = newDesignDraft(g, p, { kind: 'blank' });
        expect(draft.mode).toBe('addnew');
        const w = designWarnings(g, p, draft.design);
        expect(w.mustDo).toEqual([
            'Must have a X component|Reactor', 'Must have a X component|Command Center', 'Must have a X component|Fuel Storage Cell',
            'Design must have a name', 'Must set Role for Design', 'Must set FleeWhen for Design', 'Must set Invasion Tactics for Design',
            'Must set Battle Tactics against stronger opponents for this Design', 'Must set Battle Tactics against weaker opponents for this Design',
        ].map((s) => s.replace('|Reactor', `|${getText('Component Category Reactor')}`)));

        const freighter = newDesignDraft(g, p, { kind: 'blank', subRole: S.SmallFreighter });
        expect(freighter.design.role).toBe(BuiltObjectRole.Freight);
        expect(freighter.design.tacticsStrongerShips).toBe(BattleTactics.Evade);
        expect(freighter.design.tacticsInvasion).toBe(InvasionTactics.DoNotInvade);
        expect(freighter.design.fleeWhen).toBe(BuiltObjectFleeWhen.EnemyMilitarySighted);
        expect(freighter.design.stance).toBe(BuiltObjectStance.DoNotAttack);
        const escort = newDesignDraft(g, p, { kind: 'blank', subRole: S.Escort });
        expect(escort.design.fleeWhen).toBe(p.policy!.defaultMilitaryFleeWhen);
        expect(escort.design.tacticsInvasion).toBe(InvasionTactics.InvadeWhenClear);
    });

    it('saves a buildable escort that the 16b row builder lists, obsoleting the template; no galaxy.rnd draws', () => {
        const { g, p } = game();
        const rnd = g.rnd.snapshotState();
        const draws = g.rnd.drawCount;
        const template = findNewest(p.designs, S.Escort)!;
        const count = p.designs.length;
        const draft = newDesignDraft(g, p, { kind: 'upgrade', design: template });
        const shields = designToolboxComponents(p).find((c) => c.type === ComponentType.Shields)!;
        addComponent(p, draft, shields);
        const r = saveDesign(g, p, draft);
        expect(r.ok).toBe(true);
        const saved = r.design!;
        expect(p.designs).toHaveLength(count + 1);
        expect(p.designs[count]).toBe(saved);
        expect(saved.subRole).toBe(S.Escort);
        expect(saved.role).toBe(BuiltObjectRole.Military);
        expect(saved.isManuallyCreated).toBe(true);
        expect(saved.stance).toBe(BuiltObjectStance.AttackEnemies);
        expect(saved.size).toBe(template.size + shields.size);
        expect(template.isObsolete).toBe(true);
        expect(canBuildDesign(p, saved)).toBe(true);

        const listed = filterDesigns(p, DesignFilter.LatestBuildable, DesignTypeFilter.StateShips);
        expect(listed).toContain(saved);
        expect(listed).not.toContain(template);
        const row = designRow(saved, p, g);
        expect(row).toMatchObject({ name: 'Praefectus Mk2', role: 'Military', subRole: 'Escort', size: saved.size, manual: true, obsolete: 'Not obsolete' });

        expect(g.rnd.drawCount).toBe(draws);
        expect(g.rnd.snapshotState()).toEqual(rnd);
    });

    it('edits an unused design in place and opens a used one in View mode', () => {
        const { g, p } = game();
        const unused = p.designs.find((d) => !p.builtObjects.some((b) => b.design === d) && !p.privateBuiltObjects.some((b) => b.design === d)
            && !checkDesignInUseForConstructionOrRetrofits(p, d))!;
        const draft = newDesignDraft(g, p, { kind: 'edit', design: unused });
        expect(draft.mode).toBe('edit');
        const idx = p.designs.indexOf(unused);
        draft.design.name = 'Renamed';
        expect(unused.name).not.toBe('Renamed'); // working copy until saved
        expect(saveDesign(g, p, draft).ok).toBe(true);
        expect(p.designs[idx]).toBe(unused);
        expect(unused.name).toBe('Renamed');
        expect(unused.isManuallyCreated).toBe(true);

        const used = p.builtObjects[0].design!;
        const view = newDesignDraft(g, p, { kind: 'edit', design: used });
        expect(view.mode).toBe('view');
        expect(addComponent(p, view, used.components[0]).ok).toBe(false);
        expect(removeComponent(view, used.components[0]).ok).toBe(false);
    });

    it('deletes unused designs, refuses used ones; obsolete and auto-upgrade setters', () => {
        const { g, p } = game();
        const used = p.builtObjects[0].design!;
        const refused = deleteDesign(p, [used]);
        expect(refused).toMatchObject({ ok: false, message: 'This design is in use and cannot be deleted', title: 'Cannot Delete Design' });
        expect(p.designs).toContain(used);
        const draft = copyDesign(g, p, used);
        const saved = saveDesign(g, p, draft).design!;
        const some = deleteDesign(p, [saved, used]);
        expect(some.deleted).toEqual([saved]);
        expect(some.message).toBe('Some of the selected designs were in use and could not be deleted');
        expect(p.designs).not.toContain(saved);

        setObsolete(used, true);
        expect(used.isObsolete).toBe(true);
        const before = checkDesignSubRoleShouldBeUpgraded(p, S.Cruiser);
        setDesignSubRoleShouldBeUpgraded(p, S.Cruiser, !before);
        expect(checkDesignSubRoleShouldBeUpgraded(p, S.Cruiser)).toBe(!before);
        expect(summarizeComponents(used).reduce((n, e) => n + e.count, 0)).toBe(used.components.length);
    });
});
