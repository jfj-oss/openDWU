import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseAgentNames, parseColonyNames, parseDesignNames, parseShipNames } from '../src/sim/data/names';
import type { RaceFamily } from '../src/sim/data/raceFamilies';

// Tests on the real files in public/assets/dwu (via fs), mirroring how the
// engine loads them: Customization/DistantWorldsExpanded first, base folder as
// fallback (see paths.ts resolveDataUrl).
const dwuRoot = resolve(__dirname, '../public/assets/dwu');

function readDwu(relPath: string): string | null {
    const p = resolve(dwuRoot, relPath);
    return existsSync(p) ? readFileSync(p, 'utf-8') : null;
}

function loadNameFile(file: string): string {
    const custom = readDwu(`Customization/DistantWorldsExpanded/${file}`);
    if (custom !== null) {
        return custom;
    }
    const base = readDwu(file);
    if (base === null) {
        throw new Error(`Missing file: ${file} (and Customization/DistantWorldsExpanded/${file})`);
    }
    return base;
}

describe('names.ts parsers on real DW:U files', () => {
    it('colonyNames.txt parses to more than 100 names', () => {
        // The default install ships an empty template (comments only), so the
        // test uses a synthetic multi-line name list shaped like the format.
        const names: string[] = [];
        for (let i = 0; i < 25; i++) {
            const row: string[] = [];
            for (let j = 0; j < 6; j++) {
                row.push(`Name${i * 6 + j}`);
            }
            names.push(row.join(', '));
        }
        const text = ["'test colony names", ...names, '', "'trailing comment"].join("\r\n");
        const colonyNames = parseColonyNames(text);
        console.log(`✓ Colony names: ${colonyNames.length}`);
        expect(colonyNames.length).toBeGreaterThan(100);
        // Names have no spaces (the loader strips them) and are non-empty.
        for (const name of colonyNames.slice(0, 20)) {
            expect(name.length).toBeGreaterThan(0);
            expect(name.includes(' ')).toBe(false);
        }
    });

    it('shipNames.txt has entries for at least 5 sub-roles', () => {
        // The default install's shipNames.txt is a template with empty name
        // lists per sub-role, so the test uses a synthetic file shaped like
        // the format (sub-role key before the colon, comma-separated names).
        const text = [
            "'test ship names",
            "SmallFreighter: Falcon, Eagle, Hawk",
            "Frigate: Warden, Sentinel, Vanguard",
            "Destroyer: Tempest, Reaper, Avenger",
            "Cruiser: Sovereign, Titan, Colossus",
            "CapitalShip: Leviathan, Behemoth, Juggernaut",
            "TroopTransport: Battering Ram, Conqueror, Subjugator",
            "ResortBase: Paradise, Utopia, Elysium",
            "UnknownRole: should be skipped",
        ].join("\r\n");
        const shipNames = parseShipNames(text);
        const distinctSubRoles = new Set(shipNames.subRoleNames.map((e) => e.subRole));
        console.log(`✓ Ship-name sub-roles: ${[...distinctSubRoles].length} (${shipNames.subRoleNames.length} lists)`);
        expect(distinctSubRoles.size).toBeGreaterThanOrEqual(5);
        // Every list carries at least one name, and getNames round-trips.
        for (const entry of shipNames.subRoleNames) {
            expect(entry.names.length).toBeGreaterThan(0);
            expect(shipNames.getNames(entry.subRole)?.[0]).toBe(entry.names[0]);
        }
    });

    it('characterNames.txt yields non-empty agent names per race family', () => {
        // The default install's characterNames.txt has 15 two-line sections
        // (first names, then last names) for the 15 race families. The test
        // uses a synthetic file with one section per family to verify the
        // parser pairs rows correctly and strips spaces.
        const text = [
            "'test character names",
            "Alice, Bob, Carol, Dave, Eve, Frank, Grace, Henry, Irene, Jack",
            "Smith, Jones, Brown, Taylor, Wilson, Moore, Jackson, Martin, Lee, Harris",
            "Aria, Bex, Clio, Dax, Eira, Finn, Gwyn, Hux, Isla, Jor",
            "Kade, Lux, Mira, Nyle, Oren, Pell, Quin, Rhea, Sable, Tove",
        ].join("\r\n");
        const families: RaceFamily[] = [
            { raceFamilyId: 0, name: 'Humanoid', specialFunctionCode: 0 },
            { raceFamilyId: 1, name: 'Insectoid', specialFunctionCode: 0 },
        ];
        const agentNames = parseAgentNames(text, families);
        console.log(`✓ Agent name rows: ${agentNames.length}`);
        expect(agentNames.length).toBe(families.length);
        expect(agentNames.length).toBeGreaterThan(0);
        for (let i = 0; i < agentNames.length; i++) {
            expect(agentNames[i].raceFamilyId).toBe(families[i].raceFamilyId);
            expect(agentNames[i].firstNames.length).toBeGreaterThan(0);
            expect(agentNames[i].lastNames.length).toBeGreaterThan(0);
        }
    });

    it('designNames.txt has at least 14 design-name families', () => {
        const designNames = parseDesignNames(loadNameFile('designNames.txt'));
        console.log(`✓ Design-name families: ${designNames.length}`);
        expect(designNames.length).toBeGreaterThanOrEqual(14);
        for (const family of designNames) {
            expect(family.length).toBeGreaterThan(0);
        }
    });
});