// Per-empire / per-race ship naming (documented deviation, src/sim/shipNameStyle.ts).
import { beforeAll, describe, expect, it } from 'vitest';
import { Galaxy } from '../src/sim/galaxy';
import { Random } from '../src/sim/random';
import { BuiltObjectSubRole as S } from '../src/sim/builtObjectTypes';
import {
    SHIP_NAME_STYLES, applyShipRegistryPrefix, empireRegistryInitials, resolveEmpireShipNameStyle,
    resolveRaceShipNameStyle, shipNameRoleClass, shipRegistryPrefix, type ShipNameEmpireLike,
} from '../src/sim/shipNameStyle';
import { setGovernmentsStatic } from '../src/sim/empire';
import { GalaxyTime } from '../src/sim/galaxyTime';
import { defaultStartGameOptions } from '../src/sim/startGameOptions';
import { deserializeGame, serializeGame } from '../src/sim/save/gameSave';
import { cachedTickGame } from './helpers/gameCache';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import type { GameData } from '../src/sim/data/gameData';
import type { BuiltObject } from '../src/sim/builtObject';
import type { Empire } from '../src/sim/empire';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
    setGovernmentsStatic(gameData.governments);
}, 60000);

const race = (name: string, over: Partial<{ raceFamily: number; aggression: number; intelligence: number; friendliness: number }> = {}) =>
    ({ name, raceFamily: 0, aggression: 100, intelligence: 100, friendliness: 100, ...over });
const empire = (name: string, raceName: string | null, pirate = false): ShipNameEmpireLike =>
    ({ name, dominantRace: raceName === null ? null : race(raceName), pirateEmpireBaseHabitat: pirate ? {} : null });

/** Galaxy method run against a bare `this` with only an Rnd (habitat null: no star lookups). */
function nameWith(seed: number, kind: 'military' | 'standard', owner: ShipNameEmpireLike | null, subRole: S): { name: string; after: number } {
    const self = { rnd: new Random(seed) } as unknown as Galaxy;
    const fn = kind === 'military' ? Galaxy.prototype.selectRandomUniqueMilitaryShipName : Galaxy.prototype.selectRandomUniqueStandardShipName;
    const name = (fn as (this: Galaxy, h: null, e: unknown, s: S) => string).call(self, null, owner, subRole);
    return { name, after: self.rnd.next(0, 1_000_000) };
}

describe('shipNameStyle', () => {
    it('every shipped race has an explicit style', () => {
        const races = gameData.races;
        expect(races.length).toBeGreaterThan(15);
        const seen = new Set<string>();
        for (const r of races) seen.add(resolveRaceShipNameStyle(r).id);
        // Shipped races cover all non-pirate styles.
        expect([...seen].sort()).toEqual(['hive', 'machine', 'martial', 'mercantile', 'mystic', 'naval', 'scholarly']);
        expect(resolveRaceShipNameStyle(race('Human')).id).toBe('naval');
        expect(resolveRaceShipNameStyle(race('Mechanoid')).id).toBe('machine');
        expect(resolveRaceShipNameStyle(race('Boskara')).id).toBe('hive');
        expect(resolveRaceShipNameStyle(race('Mortalen')).id).toBe('martial');
        expect(resolveRaceShipNameStyle(race('Teekan')).id).toBe('mercantile');
        expect(resolveRaceShipNameStyle(race('Quameno')).id).toBe('scholarly');
        expect(resolveRaceShipNameStyle(race('Wekkarus')).id).toBe('mystic');
    });

    it('modded races fall back by family / traits', () => {
        expect(resolveRaceShipNameStyle(race('Zorg', { raceFamily: 6 })).id).toBe('machine');
        expect(resolveRaceShipNameStyle(race('Zorg', { raceFamily: 2 })).id).toBe('hive');
        expect(resolveRaceShipNameStyle(race('Zorg', { aggression: 130 })).id).toBe('martial');
        expect(resolveRaceShipNameStyle(race('Zorg', { intelligence: 130 })).id).toBe('scholarly');
        expect(resolveRaceShipNameStyle(race('Zorg', { friendliness: 120 })).id).toBe('mercantile');
        expect(resolveRaceShipNameStyle(race('Zorg')).id).toBe('naval');
        expect(resolveEmpireShipNameStyle(empire('Raiders', 'Human', true))!.id).toBe('corsair');
        expect(resolveEmpireShipNameStyle(empire('Nobody', null))).toBeNull();
        expect(resolveEmpireShipNameStyle(null)).toBeNull();
    });

    it('registry prefixes per empire and role class', () => {
        expect(empireRegistryInitials('Human Federation')).toBe('HF');
        expect(empireRegistryInitials('Republic of the Teekan')).toBe('RT');
        expect(empireRegistryInitials('Zenox')).toBe('ZE');
        expect(empireRegistryInitials('')).toBe('');
        expect(shipNameRoleClass(S.Cruiser)).toBe('war');
        expect(shipNameRoleClass(S.ExplorationShip)).toBe('survey');
        expect(shipNameRoleClass(S.MiningShip)).toBe('works');
        expect(shipNameRoleClass(S.LargeFreighter)).toBe('civ');
        expect(shipNameRoleClass(S.SmallSpacePort)).toBe('base');
        const hf = empire('Human Federation', 'Human');
        expect(applyShipRegistryPrefix(hf, S.Escort, 'Apulon 001')).toBe('HFS Apulon 001');
        expect(applyShipRegistryPrefix(hf, S.SmallFreighter, 'Bright Horizon')).toBe('HFM Bright Horizon');
        expect(applyShipRegistryPrefix(hf, S.ExplorationShip, 'Swift Voyager')).toBe('HFR Swift Voyager');
        expect(applyShipRegistryPrefix(hf, S.ConstructionShip, 'Steady Anchor')).toBe('HFC Steady Anchor');
        expect(applyShipRegistryPrefix(hf, S.DefensiveBase, 'Earth Fort')).toBe('Earth Fort');
        expect(applyShipRegistryPrefix(empire('Mortalen Empire', 'Mortalen'), S.Cruiser, 'X')).toBe('IMES X');
        expect(applyShipRegistryPrefix(empire('Mechanoid Collective', 'Mechanoid'), S.Cruiser, 'X')).toBe('MC-W X');
        expect(applyShipRegistryPrefix(empire('Black Fang', 'Human', true), S.Cruiser, 'X')).toBe('X');
        expect(applyShipRegistryPrefix(null, S.Cruiser, 'X')).toBe('X');
    });

    it('styled names draw exactly the same Rnd sequence as the original lists', () => {
        const owners = [null, ...['Human', 'Mortalen', 'Boskara', 'Teekan', 'Quameno', 'Mechanoid', 'Wekkarus'].map((r) => empire(`${r} Empire`, r)), empire('Black Fang', 'Human', true)];
        for (let seed = 1; seed <= 20; seed++) {
            for (const kind of ['military', 'standard'] as const) {
                const sr = kind === 'military' ? S.Destroyer : S.MediumFreighter;
                const base = nameWith(seed, kind, null, sr);
                for (const o of owners) expect(nameWith(seed, kind, o, sr).after).toBe(base.after);
            }
        }
        // Same seed, different races: different flavour; same race: same name.
        const h = nameWith(7, 'military', empire('Human Federation', 'Human'), S.Cruiser).name;
        expect(h).toBe(nameWith(7, 'military', empire('Human Federation', 'Human'), S.Cruiser).name);
        expect(h.startsWith('HFS ')).toBe(true);
        const words = h.split(' ').slice(1);
        expect(SHIP_NAME_STYLES.naval.militaryAdjectives).toContain(words[0]);
        expect(SHIP_NAME_STYLES.naval.militaryNouns).toContain(words[1]);
        const m = nameWith(7, 'military', empire('Mortalen Empire', 'Mortalen'), S.Cruiser).name;
        expect(m.startsWith('IMES ')).toBe(true);
        expect(SHIP_NAME_STYLES.martial.militaryAdjectives).toContain(m.split(' ')[1]);
    });

    it('game ships carry their empire style, and save/load keeps every name', () => {
        const game = cachedTickGame(gameData);
        const g = game.galaxy;
        let prefixed = 0;
        for (const e of g.empires as Empire[]) {
            const style = resolveEmpireShipNameStyle(e);
            if (style === null) continue;
            for (const b of [...e.builtObjects, ...e.privateBuiltObjects] as BuiltObject[]) {
                const p = shipRegistryPrefix(style, e.name, b.subRole);
                if (p === '' || b.name === '') continue;
                // Ships bought/captured from another empire keep their old name; the empire's own builds dominate.
                if (b.name.startsWith(p + ' ')) prefixed++;
            }
        }
        expect(prefixed).toBeGreaterThan(20);
        const text = serializeGame(game, new GalaxyTime(), { ...defaultStartGameOptions(), seed: 1 });
        const loaded = deserializeGame(text, gameData).game.galaxy;
        const names = (gx: Galaxy) => (gx.builtObjects as BuiltObject[]).map((b) => `${b.builtObjectID}:${b.name}`);
        expect(names(loaded)).toEqual(names(g));
    }, 600000);
});
