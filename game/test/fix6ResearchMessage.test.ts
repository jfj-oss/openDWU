// fix6 (playtest 2026-09-25-b N3): a research-breakthrough message with several benefits. Empire.3.cs 2600-2640 formats
// each benefit eagerly (string.Format(TextResolver.GetText(tag), name)), appends ", ", wraps the joined text in
// "This breakthrough provides {0}" and drops the last 2 characters. The port used to nest deferred gameText() tokens
// and cut the *encoded* string, which the ticker then decoded as "'Standard Fighter Bay, ' for our ships and basesaccess…".
import { beforeAll, describe, expect, it } from 'vitest';
import { generateGalaxy } from '../src/sim/galaxy';
import { setGovernmentsStatic } from '../src/sim/empire';
import { generateEmpire } from '../src/sim/empireGeneration';
import { doResearchBreakthrough } from '../src/sim/researchTick';
import { EmpireMessageType } from '../src/sim/messages';
import { GalaxyShape, HabitatCategoryType } from '../src/sim/types';
import { formatGameTextNow, resolveGameText } from '../src/sim/textResolver';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs(); // loads GameText.txt into the TextResolver table
    setGovernmentsStatic(gameData.governments);
}, 60000);

describe('fix6 N3: research breakthrough message text (Empire.3.cs DoResearchBreakthrough 2600-2640)', () => {
    it('formatGameTextNow = string.Format(TextResolver.GetText(tag)[.ToLower()], args)', () => {
        // GameText.txt 2992: the new component X for our ships and bases ;the new component '{0}' for our ships and bases
        expect(formatGameTextNow('the new component X for our ships and bases', ['Standard Fighter Bay'])).toBe("the new component 'Standard Fighter Bay' for our ships and bases");
        expect(formatGameTextNow('No such tag', ['a'])).toBe('No such tag|a');
    });

    it('Star Fighters: component + two fighter types, in C# order, with the C# spacing', () => {
        const g = generateGalaxy({ seed: 2, shape: GalaxyShape.Spiral, starCount: 200, sectorWidth: 6, sectorHeight: 6, systemNames: Array.from({ length: 200 }, (_, i) => `S${i}`), gameData });
        const race = gameData.races.find((r) => r.name === 'Human')!;
        const cap = g.habitats.find((h) => h.category === HabitatCategoryType.Planet && h.type === race.nativeHabitatType)!;
        const empire = generateEmpire(g, true, 'P', cap, race, -1, 0, 1.0, 'Normal', 0, 0.0, 1.0).empire;
        const node = empire.research.techTree.find((n) => n.def.name === 'Star Fighters')!;
        expect(node).toBeDefined();
        expect(node.isResearched).toBe(false);
        const before = empire.messages.length;
        doResearchBreakthrough(g, empire, node, true);
        const msgs = (empire.messages as { messageType: EmpireMessageType; description: string }[]).slice(before).filter((m) => m.messageType === EmpireMessageType.ResearchBreakthrough);
        expect(msgs.length).toBe(1);
        // text = " " + part + ", " per benefit (Empire.3.cs 2602/2629); "This breakthrough provides {0}" then Substring(0, len - 2).
        const expected =
            'Our engineers have completed research in Star Fighters. This breakthrough provides ' +
            " the new component 'Standard Fighter Bay' for our ships and bases, " +
            ' access to a new fighter type Standard Fighter, ' +
            ' access to a new fighter type Standard Bomber';
        expect(msgs[0].description).toBe(expected);
        // The ticker's decoder leaves the finished text alone.
        expect(resolveGameText(msgs[0].description)).toBe(expected);
    });
});
