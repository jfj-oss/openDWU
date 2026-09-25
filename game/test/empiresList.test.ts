import { describe, expect, it } from 'vitest';
import { empireRows } from '../src/ui/screens/empiresList';
import type { Empire } from '../src/sim/empire';
import { Habitat, HabitatCategoryType, HabitatType } from '../src/sim/types';
import { DiplomaticRelationType } from '../src/sim/diplomacy';
import { PirateRelationType } from '../src/sim/pirateRelations';

// The panel's DOM needs a browser (jsdom is not configured), so this tests
// only the pure row logic: ordering, exclusion and labels.

function empire(name: string, capitalName?: string, colonies = 0): Empire {
    const e = {} as Empire;
    e.name = name;
    e.capital = capitalName === undefined ? null : new Habitat(HabitatCategoryType.Planet, HabitatType.Ocean, capitalName, 0, 0);
    e.colonies = Array.from({ length: colonies }, () => e.capital!);
    return e;
}

/** Give `player` a relation of `type` with each of `others`. */
function meet(player: Empire, others: Empire[], type = DiplomaticRelationType.None): void {
    (player as { diplomaticRelations: unknown }).diplomaticRelations = others.map((o) => ({ type, otherEmpire: o }));
}

describe('empireRows (task 12b)', () => {
    it('puts the player first, then the others by name', () => {
        const player = empire('Zeta', 'Zeta Prime');
        const a = empire('Alpha', 'Alpha Prime');
        const b = empire('Beta', 'Beta Prime');
        meet(player, [a, b]);
        const rows = empireRows([a, b, player], player);
        expect(rows.map((r) => r.label)).toEqual(['Zeta (you)', 'Alpha', 'Beta']);
        expect(rows[0].empire).toBe(player);
    });

    it('excludes empires with an empty name or no capital', () => {
        const player = empire('Player', 'Home');
        const unnamed = empire('', 'Somewhere');
        const capitalless = empire('Nomad');
        const named = empire('Named', 'Capital');
        meet(player, [unnamed, capitalless, named]);
        const rows = empireRows([player, unnamed, capitalless, named], player);
        expect(rows.map((r) => r.label)).toEqual(['Player (you)', 'Named']);
    });

    it('marks the player label with " (you)"', () => {
        const player = empire('Empire X', 'X Prime');
        const rows = empireRows([player], player);
        expect(rows[0].label.endsWith(' (you)')).toBe(true);
    });

    it('reports colony counts and capital names', () => {
        const player = empire('Player', 'Home', 3);
        const other = empire('Other', 'Elsewhere', 5);
        meet(player, [other]);
        const rows = empireRows([other, player], player);
        expect(rows[0]).toMatchObject({ label: 'Player (you)', colonies: 3, capitalName: 'Home' });
        expect(rows[1]).toMatchObject({ label: 'Other', colonies: 5, capitalName: 'Elsewhere' });
    });

    // fix4ui (playtest #6): DiplomaticRelationListView.cs 160-176 BindData.
    it('lists only met empires (relation not NotMet), never the independent empire', () => {
        const player = empire('Player', 'Home');
        const met = empire('Met', 'M');
        const unmet = empire('Unmet', 'U');
        const independent = empire('Independent', 'I');
        const pirate = empire('Pirates', 'P');
        const unmetPirate = empire('Hidden Pirates', 'HP');
        (player as { galaxy: unknown }).galaxy = { independentEmpire: independent };
        (player as { diplomaticRelations: unknown }).diplomaticRelations = [
            { type: DiplomaticRelationType.None, otherEmpire: met },
            { type: DiplomaticRelationType.NotMet, otherEmpire: unmet },
            { type: DiplomaticRelationType.None, otherEmpire: independent },
        ];
        (player as { pirateRelations: unknown }).pirateRelations = [
            { type: PirateRelationType.None, otherEmpire: pirate },
            { type: PirateRelationType.NotMet, otherEmpire: unmetPirate },
        ];
        const rows = empireRows([player, met, unmet, independent, pirate, unmetPirate], player);
        expect(rows.map((r) => r.label)).toEqual(['Player (you)', 'Met', 'Pirates']);
    });

    it('shows only the player before first contact', () => {
        const player = empire('Player', 'Home');
        const other = empire('Other', 'Elsewhere');
        expect(empireRows([player, other], player).map((r) => r.label)).toEqual(['Player (you)']);
    });
});
