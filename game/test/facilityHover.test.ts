// The planetary facility hovers and clicks (ui/facilityHover.ts, selectionInfo.ts facilitySegs):
// - selection panel: InfoPanel.cs 2552 DrawFacilities hotspot message ("Name (NN% complete) (Pirate) (click for
//   details)") and its click (Main.Part4.cs 3586 → the Galactopedia at "Wonders" / "Planetary Facilities");
// - Colonies screen: PlanetaryFacilityListIconView.cs 211 GenerateFacilityItems (label + ToolTipText).
// All of it is a pure read of the game: the state digest is unchanged.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Habitat } from '../src/sim/types';
import { PlanetaryFacility, planetaryFacilityDefinitionsStatic } from '../src/sim/construction/facilities';
import { resolveWonderDescription } from '../src/sim/construction/facilityText';
import { PlanetaryFacilityType, facilityType } from '../src/sim/researchSystem';
import { PirateColonyControl } from '../src/sim/pirates/pirateColonyControl';
import { stateDigest } from '../src/sim/tick/digest';
import { facilityGalactopediaTopic, facilityListItem, facilityPanelHoverText } from '../src/ui/facilityHover';
import { habitatInfo, type InfoContext, type InfoRow } from '../src/ui/selectionInfo';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

const PIRATE_TYPES = [PlanetaryFacilityType.PirateBase, PlanetaryFacilityType.PirateFortress, PlanetaryFacilityType.PirateCriminalNetwork];

function setup(): { game: Game; h: Habitat } {
    const game = cachedTickGame(gameData);
    const h = game.playerEmpire.capital!;
    return { game, h };
}

function defOf(game: Game, pred: (t: PlanetaryFacilityType) => boolean) {
    return planetaryFacilityDefinitionsStatic(game.galaxy).find((d) => pred(facilityType(d)) && d.maintenanceCost > 0)!;
}

const maint = (v: number): string => Math.round(v).toLocaleString('en-US');

describe('facility hover texts (InfoPanel DrawFacilities / PlanetaryFacilityListIconView)', () => {
    it('a completed and an under-construction facility', () => {
        const { game, h } = setup();
        const g = game.galaxy;
        const def = defOf(game, (t) => !PIRATE_TYPES.includes(t) && t !== PlanetaryFacilityType.Wonder);
        const done = new PlanetaryFacility(def, 1);
        const building = new PlanetaryFacility(def, 0.455);
        h.facilities = [done, building];
        const before = stateDigest(g);

        expect(facilityPanelHoverText(g, h, done)).toBe(`${def.name} (click for details)`);
        expect(facilityPanelHoverText(g, h, building)).toBe(`${def.name} (46% complete) (click for details)`);
        expect(facilityGalactopediaTopic(done)).toBe('Planetary Facilities');

        expect(facilityListItem(g, h, done)).toEqual({ text: def.name, toolTip: `Annual Maintenance: ${maint(def.maintenanceCost)} credits` });
        expect(facilityListItem(g, h, building)).toEqual({
            text: def.name,
            toolTip: `46% complete\nAnnual Maintenance: ${maint(def.maintenanceCost)} credits (when completed)`,
        });
        expect(stateDigest(g)).toBe(before);
    }, 300000);

    it('a wonder: the Wonders topic and its benefits in the tool tip', () => {
        const { game, h } = setup();
        const g = game.galaxy;
        const def = planetaryFacilityDefinitionsStatic(g).find((d) => facilityType(d) === PlanetaryFacilityType.Wonder)!;
        const w = new PlanetaryFacility(def, 1);
        h.facilities = [w];
        expect(facilityGalactopediaTopic(w)).toBe('Wonders');
        const item = facilityListItem(g, h, w);
        const benefits = resolveWonderDescription(def);
        expect(benefits).not.toBe('');
        expect(item.toolTip.startsWith(benefits)).toBe(true);
        if (def.maintenanceCost > 0) expect(item.toolTip).toBe(`${benefits}\nAnnual Maintenance: ${maint(def.maintenanceCost)} credits`);
    }, 300000);

    it('a pirate faction\'s base: owner in the label, the panel hover and (completed only) the tool tip', () => {
        const { game, h } = setup();
        const g = game.galaxy;
        const pirate = g.pirateEmpires[0];
        expect(pirate).toBeDefined();
        const def = planetaryFacilityDefinitionsStatic(g).find((d) => facilityType(d) === PlanetaryFacilityType.PirateBase)!;
        const base = new PlanetaryFacility(def, 1);
        h.facilities = [base];
        // No faction holds facility control: the colony owner owns it, no suffix.
        expect(facilityPanelHoverText(g, h, base)).toBe(`${def.name} (click for details)`);
        expect(facilityListItem(g, h, base).text).toBe(def.name);

        h.pirateColonyControl.add(new PirateColonyControl(pirate.empireId, 0.5, true));
        const before = stateDigest(g);
        expect(facilityPanelHoverText(g, h, base)).toBe(`${def.name} (${pirate.name}) (click for details)`);
        const item = facilityListItem(g, h, base);
        expect(item.text).toBe(`${def.name} (Owned by ${pirate.name})`);
        expect(item.toolTip.startsWith(`OWNED BY ${pirate.name.toUpperCase()}\n`)).toBe(true);
        // GenerateFacilityItems: the progress line replaces the owner line (`str3 = ...`).
        base.constructionProgress = 0.2;
        expect(facilityListItem(g, h, base).toolTip.startsWith('20% complete')).toBe(true);
        expect(facilityPanelHoverText(g, h, base)).toBe(`${def.name} (20% complete) (${pirate.name}) (click for details)`);
        expect(stateDigest(g)).toBe(before);
    }, 300000);

    it('the selection panel Facilities row: each icon a Galactopedia hotspot with the hover message', () => {
        const { game, h } = setup();
        const g = game.galaxy;
        const def = defOf(game, (t) => !PIRATE_TYPES.includes(t) && t !== PlanetaryFacilityType.Wonder);
        const wonder = planetaryFacilityDefinitionsStatic(g).find((d) => facilityType(d) === PlanetaryFacilityType.Wonder)!;
        h.facilities = [new PlanetaryFacility(def, 0.5), new PlanetaryFacility(wonder, 1)];
        const ctx: InfoContext = { galaxy: g, player: game.playerEmpire, resource: (id) => gameData.resources.find((r) => r.resourceId === id) ?? null };
        const before = stateDigest(g);
        const m = habitatInfo(ctx, h);
        const row = m.rows.find((r): r is Extract<InfoRow, { kind: 'row' }> => r.kind === 'row' && r.label === 'Facilities')!;
        expect(row.strip).toBe(true);
        expect(row.segs.length).toBe(2);
        expect(row.segs[0]).toMatchObject({ faded: true, title: `${def.name} (50% complete) (click for details)`, target: { kind: 'galactopedia', topic: 'Planetary Facilities' } });
        expect(row.segs[1]).toMatchObject({ faded: false, title: `${wonder.name} (click for details)`, target: { kind: 'galactopedia', topic: 'Wonders' } });
        expect(stateDigest(g)).toBe(before);

        h.facilities = [];
        const none = habitatInfo(ctx, h).rows.find((r): r is Extract<InfoRow, { kind: 'row' }> => r.kind === 'row' && r.label === 'Facilities')!;
        expect(none.segs.map((s) => s.text)).toEqual(['(None)']);
    }, 300000);
});
