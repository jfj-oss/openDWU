// Smarter AI add-on, military parts (src/sim/scenario/smarterAI/defence.ts, pirates.ts): a known pirate base near an AI
// colony raises its warship projection and makes the colony a defensive-base site (smarterAIDefence), and is hunted on a
// roll the stock 1-in-3 gate refuses (smarterAIPirates); the wizard's Start keeps the Smarter AI choice when the add-on
// list loads late. The flags-off digest is test/smarterAI.test.ts "flags off = faithful game".
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { createScenarioGame, scenarioIndexFs } from './helpers/scenarioGame';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import type { BuiltObject } from '../src/sim/builtObject';
import type { Habitat } from '../src/sim/types';
import { BuiltObjectRole } from '../src/sim/data/designSpecifications';
import { BuiltObjectSubRole } from '../src/sim/builtObjectTypes';
import { projectForceStructure } from '../src/sim/forceStructure';
import { scenarioEmit } from '../src/sim/scenario/hooks';
import { addonCatalog, defaultSmarterAIChoice } from '../src/sim/scenario/addons';
import { isSmarterAIEmpire } from '../src/sim/scenario/smarterAI/common';
import { DEFENCE_RULES, localThreat } from '../src/sim/scenario/smarterAI/defence';
import { PIRATE_RULES, smarterHuntPirates } from '../src/sim/scenario/smarterAI/pirates';
import { addonChoiceFor, startWhenAddonsLoaded } from '../src/ui/screens/newGameWizard';

let base: GameData;
beforeAll(async () => {
    base = await loadGameDataFs();
}, 120000);

const WARSHIPS = [BuiltObjectSubRole.Escort, BuiltObjectSubRole.Frigate, BuiltObjectSubRole.Destroyer, BuiltObjectSubRole.Cruiser, BuiltObjectSubRole.CapitalShip, BuiltObjectSubRole.Carrier];

/** The AI empire and pirate base closest together, the base made known to it; `range` just covers the distance. */
function pirateNeighbour(g: Galaxy): { e: Empire; b: BuiltObject; colony: Habitat; range: number } {
    let best: { e: Empire; b: BuiltObject; colony: Habitat; range: number } | null = null;
    const bases = g.pirateEmpires.flatMap((p) => p.builtObjects.filter((b) => b !== null && !b.hasBeenDestroyed && b.role === BuiltObjectRole.Base));
    for (const e of g.empires.filter((x) => isSmarterAIEmpire(g, x))) {
        for (const colony of e.colonies) {
            for (const b of bases) {
                const d = Math.hypot(colony.xpos - b.xpos, colony.ypos - b.ypos);
                if (best === null || d < best.range) best = { e, b, colony, range: d };
            }
        }
    }
    expect(best).not.toBeNull();
    if (!best!.e.knownPirateBases.includes(best!.b)) best!.e.knownPirateBases.push(best!.b);
    best!.range += 1;
    return best!;
}

describe('smarter AI military', () => {
    it('defence: a known pirate base near a colony raises the warship projection and adds a defensive-base site', () => {
        const g = createScenarioGame(base, { scenario: 'smarter-ai' }).game.galaxy;
        const { e, colony, range } = pirateNeighbour(g);
        const saved = DEFENCE_RULES.range;
        DEFENCE_RULES.range = range;
        try {
            const t = localThreat(g, e);
            expect(t.hostile).toBeGreaterThan(0);
            expect(t.threatened).toContain(colony);
            const warships = (): number => {
                projectForceStructure(g, e, { currentStarDate: 0, difficultyLevel: g.difficultyLevel });
                let n = 0;
                for (let i = 0; i < e.stateForceStructureProjections!.count; i++) {
                    const p = e.stateForceStructureProjections!.get(i);
                    if (WARSHIPS.includes(p.subRole)) n += p.amount;
                }
                return n;
            };
            g.scenario!.flags.smarterAIDefence = false;
            const off = warships();
            const locsOff: unknown[] = [];
            scenarioEmit(g, 'defensiveBaseLocations', { empire: e, locations: locsOff });
            g.scenario!.flags.smarterAIDefence = true;
            const on = warships();
            const locsOn: unknown[] = [];
            scenarioEmit(g, 'defensiveBaseLocations', { empire: e, locations: locsOn });
            expect(on).toBeGreaterThan(off);
            expect(locsOff).toEqual([]);
            expect(locsOn).toContain(colony);
        } finally {
            DEFENCE_RULES.range = saved;
        }
    }, 600000);

    it('pirates: a base near a colony is hunted on a roll the stock gate refuses (forming a strike fleet if needed)', () => {
        const g = createScenarioGame(base, { scenario: 'smarter-ai' }).game.galaxy;
        const { e, b, range } = pirateNeighbour(g);
        const rules = { ...PIRATE_RULES, nearRange: range, strikeMargin: 0.01 };
        const far = smarterHuntPirates(g, e, 0, { ...rules, nearRange: 0 });
        expect(far).toEqual([]);
        const sent = smarterHuntPirates(g, e, 0, rules);
        expect(sent).toEqual([b]);
        const hunters = e.builtObjects.filter((s) => (s.mission as { targetBuiltObject?: unknown } | null)?.targetBuiltObject === b);
        expect(hunters.length).toBeGreaterThan(0);
    }, 600000);
});

describe('wizard', () => {
    it('Start waits for a slow add-on list and keeps the Smarter AI choice', async () => {
        let cat = addonCatalog([]);
        const smart = { ...defaultSmarterAIChoice(), enabled: true };
        let choice: ReturnType<typeof addonChoiceFor> = null;
        let started: ReturnType<typeof addonChoiceFor> | undefined;
        let release!: () => void;
        const ready = new Promise<void>((r) => (release = r));
        const done = startWhenAddonsLoaded(ready, () => (choice = addonChoiceFor(cat, [], { flags: {}, params: {} }, smart)), () => (started = choice));
        await Promise.resolve();
        expect(started).toBeUndefined();
        cat = addonCatalog(scenarioIndexFs());
        release();
        await done;
        expect(started?.id).toBe('smarter-ai');
        expect(started?.flags).toMatchObject({ smarterAI: true, smarterAIDefence: true, smarterAIPirates: true });
    });
});
