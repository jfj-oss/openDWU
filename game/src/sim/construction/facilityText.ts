// Facility description texts for the wonder / pirate-facility "built" event messages: Galaxy.5.cs
// ResolvePlanetaryFacilityLines (539, the Wonder and pirate-facility cases), ResolveWonderDescription (487) and
// ResolvePirateFacilityDescription (513). Pure text helpers: no Rnd, no state.
//
// TextResolver.GetText(tag) is evaluated now (formatGameTextNow): the lines are joined into one argument of the
// outer "Wonder Build Description" text, and a gameText() encoding cannot nest. Without a loaded GameText table
// (headless tests) each line is its tag.

import type { Facility } from '../data/facilities';
import { PlanetaryFacilityType, WonderType, facilityType } from '../researchSystem';
import { formatGameTextNow } from '../textResolver';
import { resolveDescription } from '../messages';
import { HabitatType, resolveColonyHabitatTypeByIndexDesertBeforeOcean } from '../types';

const getText = (tag: string): string => formatGameTextNow(tag);

/** `value.ToString("#,###,##0")`: rounded away from zero, comma-grouped. */
function formatMaintenance(v: number): string {
    const r = Math.sign(v) * Math.round(Math.abs(v));
    const s = String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return r < 0 ? '-' + s : s;
}

/** `Maintenance.ToString("#,###,##0") + " " + GetText("credits")`. */
function maintenanceValue(f: Facility): string {
    return formatMaintenance(f.maintenanceCost) + ' ' + getText('credits');
}

/**
 * Port of Galaxy.5.cs 539 ResolvePlanetaryFacilityLines(planetaryFacility, out descriptions, out values,
 * includeExtraWonderNotes) — the Wonder (545-686) and pirate-facility (765-792) cases, which are all the wonder /
 * pirate "built" texts read. Other facility types return only descriptions[0] = Name.
 * TODO(port): the remaining facility types (687-764, incl. IonCannon's ComponentDefinitionsStatic lines) — Galaxy.5.cs:ResolvePlanetaryFacilityLines
 */
export function resolvePlanetaryFacilityLines(f: Facility, includeExtraWonderNotes = true): { descriptions: (string | null)[]; values: (string | null)[] } {
    const descriptions: (string | null)[] = [null, null, null, null, null, null];
    const values: (string | null)[] = [null, null, null, null, null, null];
    descriptions[0] = f.name;
    switch (facilityType(f)) {
        case PlanetaryFacilityType.Wonder: {
            let text = '\n' + getText('Note that each wonder may only be built once in the galaxy');
            if (f.value3 > 0) {
                const type = resolveColonyHabitatTypeByIndexDesertBeforeOcean(f.value3 - 1);
                text += '. ' + formatGameTextNow('Wonder Build Location Requirement', [resolveDescription(HabitatType as unknown as Record<number, string>, type).toUpperCase()]);
            }
            if (!includeExtraWonderNotes) text = '';
            const devBonus = (): void => {
                descriptions[2] = getText('Colony Development Bonus');
                values[2] = '+' + f.value1 + '%';
            };
            const maintenance = (i: number): void => {
                descriptions[i] = getText('Facility Maintenance Cost');
                values[i] = maintenanceValue(f);
            };
            const bonus = (tag: string, value: string): void => {
                descriptions[1] = f.description + text;
                devBonus();
                descriptions[3] = getText(tag);
                values[3] = value;
                maintenance(4);
            };
            switch (f.wonderType as WonderType) {
                case WonderType.ColonyConstructionSpeed:
                    bonus('Construction Speed', formatGameTextNow('X% faster', ['+' + f.value2]));
                    break;
                case WonderType.ColonyDefense:
                    bonus('Colony Defense', '+' + f.value2 * 10 + '%');
                    break;
                case WonderType.ColonyHappiness:
                    bonus('Colony Happiness', '+' + f.value2 + '%');
                    break;
                case WonderType.ColonyIncome:
                    bonus('Colony Income', '+' + f.value2 + '%');
                    break;
                case WonderType.ColonyPopulationGrowth:
                    bonus('Colony Population', formatGameTextNow('X% faster growth', ['+' + f.value2]));
                    break;
                case WonderType.EmpireHappiness:
                    bonus('Empire Happiness', '+' + f.value2 + '%');
                    break;
                case WonderType.EmpireIncome:
                    bonus('Empire Income', '+' + f.value2 + '%');
                    break;
                case WonderType.EmpirePopulationGrowth:
                    bonus('Empire Population', formatGameTextNow('X% faster growth', ['+' + f.value2]));
                    break;
                case WonderType.EmpireResearchEnergy:
                    bonus('Energy Research', '+' + f.value2 + '%');
                    break;
                case WonderType.EmpireResearchHighTech:
                    bonus('HighTech Research', '+' + f.value2 + '%');
                    break;
                case WonderType.EmpireResearchWeapons:
                    // 674 assigns "Wonder Description Empire Research Weapons" first, then 675 overwrites it.
                    bonus('Weapons Research', '+' + f.value2 + '%');
                    break;
                case WonderType.RaceAchievement:
                    descriptions[1] = f.description + text;
                    devBonus();
                    maintenance(3);
                    break;
            }
            break;
        }
        case PlanetaryFacilityType.PirateBase:
        case PlanetaryFacilityType.PirateFortress:
            descriptions[1] = f.description;
            descriptions[2] = getText('Empire Research Bonus');
            values[2] = '+' + f.value1.toFixed(0) + '%';
            descriptions[3] = getText('Colony Income Bonus');
            values[3] = '+' + f.value2.toFixed(0) + '%';
            descriptions[4] = getText('Colony Corruption');
            values[4] = '+' + f.value3.toFixed(0) + '%';
            break;
        case PlanetaryFacilityType.PirateCriminalNetwork:
            descriptions[1] = f.description;
            descriptions[2] = getText('Empire Research Bonus');
            values[2] = '+' + f.value1.toFixed(0) + '%';
            descriptions[3] = getText('Colony Corruption');
            values[3] = '+' + f.value3.toFixed(0) + '%';
            break;
    }
    return { descriptions, values };
}

/** Galaxy.5.cs 487/513 shared loop: "description[: value]\n" for lines 1.., then the last character dropped. */
function joinLines(text: string, f: Facility): string {
    const { descriptions, values } = resolvePlanetaryFacilityLines(f, false);
    for (let i = 1; i < descriptions.length; i++) {
        const d = descriptions[i];
        if (d === null || d === '') continue;
        text += d;
        const v = values[i];
        if (v !== null && v !== '') text = text + ': ' + v;
        text += '\n';
    }
    if (text.length >= 1) text = text.substring(0, text.length - 1);
    return text;
}

/** Port of Galaxy.5.cs 487 ResolveWonderDescription(planetaryFacility): the wonder's benefit lines ('' for a non-wonder). */
export function resolveWonderDescription(f: Facility | null): string {
    if (f === null || facilityType(f) !== PlanetaryFacilityType.Wonder) return '';
    return joinLines('', f);
}

/** Port of Galaxy.5.cs 513 ResolvePirateFacilityDescription(planetaryFacility): description, a blank block, then the lines. */
export function resolvePirateFacilityDescription(f: Facility | null): string {
    if (f === null) return '';
    const type = facilityType(f);
    if (type !== PlanetaryFacilityType.PirateBase && type !== PlanetaryFacilityType.PirateFortress && type !== PlanetaryFacilityType.PirateCriminalNetwork) return '';
    // 519-532: each case is `Description + "\n\n"` then `+= "\n\n"`.
    return joinLines(f.description + '\n\n' + '\n\n', f);
}
