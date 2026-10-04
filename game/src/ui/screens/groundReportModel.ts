// [parC1] Ground Report (the ground invasion status panel), pure part: the layout and content of the original's
// ColonyInvasion view (DistantWorlds.Types/ColonyInvasion.cs, drawn by DistantWorlds.Controls ColonyInvasionPanel in the
// pnlColonyInvasion ScreenPanel, Main.Part11.cs:2682 method_164). Everything the view draws is returned as positioned
// items in the panel's own pixels; groundReport.ts puts them in the original-style window. No DOM.
//
// Ported: ResetSize (106) / ReviewXCoords (184) column layouts for the three panel sizes, Draw (1104) — the header
// (defender / invader names, their modifier lists, the strength text), the frontline and its status bar, the bases in
// orbit, the planetary shield, the population figures, the facilities, the defending / invading characters and troops
// with their readiness bars, the resize glyph and the hover message — the ResolveLocation* placements (611-1080) and
// the resize hotspot's size choice (ColonyInvasionPanel.cs OnClick).
//
// The view's animation (the explosions and weapon shots, AddExplosion / ProcessExplosions / the AnimationSystem, and
// the landing pods, AddInvaderLanding / UpdateInvaderLandingProgress) is groundReportAnim.ts. In the C# opening the
// panel sets Habitat.ColonyInvasion (BindData), which hands that colony's ground battle to the panel's paint loop
// (Habitat.cs 1464: DoTasks skips ProcessColonyTroops / ResolveInvasionBattles while it is set; ColonyInvasion.Update
// runs them from ColonyInvasionPanel.OnPaint once at least 1 s of game time passed) and adds a Galaxy.Rnd draw per
// landing hit (BuiltObject.1.cs 2875 firer pick). That would make the sim depend on when the UI paints, so the port
// never attaches a view: the battle resolves in the tick exactly as with the panel closed, and the panel only reads —
// the animation is driven from the colony's state as the tick leaves it, with render-local randomness.

import type { Galaxy } from '../../sim/galaxy';
import type { Empire } from '../../sim/empire';
import type { Habitat } from '../../sim/types';
import type { BuiltObject } from '../../sim/builtObject';
import type { Character } from '../../sim/characters';
import { CharacterRole, habitatInvadingCharacterList, stellarObjectCharacters } from '../../sim/characters';
import { Troop, TroopList, TroopType } from '../../sim/cargo';
import type { PlanetaryFacility } from '../../sim/construction/facilities';
import { calculateForceStrengthsDetailed, calculatePopulationStrength, resolveInvasionEmpires } from '../../sim/combat/invasion';
import { CHARACTER_ROLE, resolveEnumTextDescription } from '../../sim/enumText';
import { formatNet, tryGetText } from '../../sim/textResolver';

// ---------------------------------------------------------------------------------------------------------------
// Sizes and columns
// ---------------------------------------------------------------------------------------------------------------

/** Main.Part11.cs:2687-2702 / ColonyInvasionPanel.cs OnClick: the view size per PanelSize (0 / 1 / 2). */
export const GROUND_REPORT_SIZES: readonly { w: number; h: number }[] = [
    { w: 555, h: 520 },
    { w: 725, h: 647 },
    { w: 910, h: 786 },
];

/** pnlColonyInvasion.Size = view + (25, 70) (Main.Part11.cs:2705); the view sits at (5, 5) in the body. */
export function groundReportWindowSize(panelSize: number): { w: number; h: number } {
    const s = GROUND_REPORT_SIZES[panelSize] ?? GROUND_REPORT_SIZES[0];
    return { w: s.w + 25, h: s.h + 70 };
}

/** ColonyInvasionPanel.cs OnClick "resize": shrink when expanded, else the largest size the screen (the Main form's
 *  ClientSize, original pixels) allows. */
export function nextGroundReportSize(panelSize: number, screen: { w: number; h: number }): number {
    if (panelSize > 0) return 0;
    if (screen.w < 1120) return 0;
    if (screen.w < 1320 || screen.h < 820) return 1;
    return 2;
}

export interface GroundReportColumns {
    facility: number;
    troop: number;
    character: number;
    population: number;
    builtObject: number;
    defendingCharactersX: number;
    populationX: number;
    facilityX: number;
    defendingTroopsSpecialForcesX: number;
    attackingTroopsSpecialForcesX: number;
    defendingTroopsArtilleryX: number;
    defendingTroopsInfantryX: number;
    defendingTroopsArmorX: number;
    attackingTroopsArmorX: number;
    attackingTroopsInfantryX: number;
    attackingTroopsArtilleryX: number;
    attackingCharactersX: number;
    attackingForcesLowerAtmosphereX: number;
    attackingForcesOrbitX: number;
}

/** ColonyInvasion.cs ResetSize (106-180): the image sizes (square) and column x of a panel size. */
export function groundReportColumns(panelSize: number): GroundReportColumns {
    switch (panelSize) {
        case 1:
            return {
                facility: 50, troop: 42, character: 42, population: 42, builtObject: 50,
                defendingCharactersX: 5, populationX: 55, facilityX: 97, defendingTroopsSpecialForcesX: 150, attackingTroopsSpecialForcesX: 200,
                defendingTroopsArtilleryX: 250, defendingTroopsInfantryX: 300, defendingTroopsArmorX: 350, attackingTroopsArmorX: 425,
                attackingTroopsInfantryX: 475, attackingTroopsArtilleryX: 525, attackingCharactersX: 575, attackingForcesLowerAtmosphereX: 625, attackingForcesOrbitX: 700,
            };
        case 2:
            return {
                facility: 60, troop: 56, character: 56, population: 56, builtObject: 60,
                defendingCharactersX: 5, populationX: 65, facilityX: 121, defendingTroopsSpecialForcesX: 180, attackingTroopsSpecialForcesX: 240,
                defendingTroopsArtilleryX: 300, defendingTroopsInfantryX: 360, defendingTroopsArmorX: 420, attackingTroopsArmorX: 510,
                attackingTroopsInfantryX: 570, attackingTroopsArtilleryX: 630, attackingCharactersX: 690, attackingForcesLowerAtmosphereX: 750, attackingForcesOrbitX: 840,
            };
        default:
            return {
                facility: 40, troop: 30, character: 30, population: 30, builtObject: 40,
                defendingCharactersX: 5, populationX: 40, facilityX: 70, defendingTroopsSpecialForcesX: 110, attackingTroopsSpecialForcesX: 145,
                defendingTroopsArtilleryX: 180, defendingTroopsInfantryX: 215, defendingTroopsArmorX: 250, attackingTroopsArmorX: 310,
                attackingTroopsInfantryX: 345, attackingTroopsArtilleryX: 380, attackingCharactersX: 415, attackingForcesLowerAtmosphereX: 450, attackingForcesOrbitX: 510,
            };
    }
}

/** The x ratios between the backline and the frontline (ColonyInvasion.cs 79-87). */
const RATIO = {
    defendingInfantry: 0.6,
    defendingArmor: 0.8,
    defendingArtillery: 0.4,
    attackingInfantry: 0.25,
    attackingArmor: 0.0,
    attackingArtillery: 0.5,
} as const;

/** TroopList.cs 36 SplitTroopsByType(includePirateRaidersWithInfantry, out ...). */
export function splitTroopsByType(list: TroopList | null, includePirateRaidersWithInfantry: boolean): { infantry: Troop[]; armored: Troop[]; artillery: Troop[]; specialForces: Troop[] } {
    const out = { infantry: [] as Troop[], armored: [] as Troop[], artillery: [] as Troop[], specialForces: [] as Troop[] };
    if (list === null) return out;
    for (const troop of list.items) {
        if (troop == null) continue;
        switch (troop.type) {
            case TroopType.Infantry:
                out.infantry.push(troop);
                break;
            case TroopType.Armored:
                out.armored.push(troop);
                break;
            case TroopType.Artillery:
                out.artillery.push(troop);
                break;
            case TroopType.SpecialForces:
                out.specialForces.push(troop);
                break;
            case TroopType.PirateRaider:
                if (includePirateRaidersWithInfantry) out.infantry.push(troop);
                break;
        }
    }
    return out;
}

/** ColonyInvasion.cs ReviewXCoords (184-256): the size's columns, closed up where a troop type is absent. */
export function reviewXCoords(panelSize: number, troops: TroopList | null, invadingTroops: TroopList | null): GroundReportColumns {
    const c = groundReportColumns(panelSize);
    let s = splitTroopsByType(troops, true);
    if (s.armored.length <= 0) c.defendingTroopsInfantryX = c.defendingTroopsArmorX;
    if (s.infantry.length <= 0) c.defendingTroopsArtilleryX = c.defendingTroopsInfantryX;
    if (s.specialForces.length <= 0) c.attackingTroopsSpecialForcesX = c.defendingTroopsSpecialForcesX;
    s = splitTroopsByType(invadingTroops, true);
    if (s.armored.length <= 0) c.attackingTroopsInfantryX = c.attackingTroopsArmorX;
    if (s.infantry.length <= 0) c.attackingTroopsArtilleryX = c.attackingTroopsInfantryX;
    if (s.specialForces.length > 0) return c;
    c.defendingTroopsSpecialForcesX = c.defendingTroopsArtilleryX - 35;
    return c;
}

// ---------------------------------------------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------------------------------------------

/** ColonyInvasion.cs 57-58: _HeaderSize 150, _StatusBarAreaHeight 32. */
export const HEADER_SIZE = 150;
export const STATUS_BAR_AREA_HEIGHT = 32;
/** ui/chrome/Space.png (bitmap_103) width: the orbit strip at the right edge. */
export const SPACE_IMAGE_WIDTH = 105;

/** The fonts method_164 binds (Main.Part12.cs 1521-1525 GenerateFont): font_6 normal, font_7 bold, font_2 large, font_0 huge. */
export const GROUND_FONTS = {
    normal: 16.67,
    normalBold: 16.67,
    large: 18.67,
    huge: 32,
} as const;

/** Font.Height (the line spacing) of a GenerateFont size, as the layout uses it. */
export function fontHeight(size: number): number {
    return Math.round(size * 1.2);
}

function text(tag: string, fallback: string): string {
    return tryGetText(tag) ?? fallback;
}

/** `string.Format(TextResolver.GetText(tag), args)`, with the English text as the fallback when no table is loaded. */
function textf(tag: string, fallback: string, ...args: unknown[]): string {
    return formatNet(text(tag, fallback), args);
}

/** C# Math.Round(x, MidpointRounding.AwayFromZero) as a custom numeric format rounds. */
function roundAway(v: number): number {
    return v < 0 ? -Math.round(-v) : Math.round(v);
}

/** `v.ToString("0,K")`: thousands, rounded, a literal K. */
export function formatThousandsK(v: number): string {
    return `${roundAway(v / 1000)}K`;
}

/** `v.ToString("+0%;-0%")` (zero takes the positive section). */
export function formatSignedPercent(v: number): string {
    const p = roundAway(v * 100);
    return p < 0 ? `-${-p}%` : `+${p}%`;
}

/** Galaxy.ResolveDescription(CharacterRole). */
function roleText(role: CharacterRole): string {
    return resolveEnumTextDescription(CHARACTER_ROLE, CharacterRole[role]);
}

// ---------------------------------------------------------------------------------------------------------------
// The drawn content
// ---------------------------------------------------------------------------------------------------------------

export interface GrRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** One drawn picture (base, population, facility, character, troop) with its hover message. */
export interface GroundReportItem {
    kind: 'base' | 'population' | 'facility' | 'defendingCharacter' | 'invadingCharacter' | 'defendingTroop' | 'invadingTroop';
    rect: GrRect;
    /** The object the picture shows (the image is resolved by the DOM part). */
    obj: BuiltObject | Habitat | PlanetaryFacility | Character | Troop;
    /** Defending troops are drawn mirrored (Draw 1353: a negative destination width). */
    mirrored: boolean;
    /** The (alpha 32) empire-colour fill behind a character (Draw 1314 / 1452). */
    fill: number | null;
    /** Readiness 0-100 for the troops' 2 px bar (green over red when below 100), else null. */
    readiness: number | null;
    message: string;
}

/** A text drawn with a drop shadow (DrawStringWithDropShadow[Centered]). */
export interface GroundReportText {
    text: string;
    x: number;
    y: number;
    size: number;
    bold: boolean;
    /** The x is the text's centre. */
    centered: boolean;
    /** A layout width (the GDI maxSize), when the source gives one. */
    maxWidth: number | null;
}

/** The hotspots in Draw's AddHotspot order (HotspotList.ResolveHotspotAtPoint returns the first containing the point). */
export interface GroundReportHotspot {
    rect: GrRect;
    message: string;
    /** 'resize' for the size glyph, else an index into `items` (or -1: the planetary shield). */
    target: 'resize' | number;
}

export interface GroundReportModel {
    /** ColonyInvasion.PanelSize (0 / 1 / 2). */
    panelSize: number;
    size: { w: number; h: number };
    columns: GroundReportColumns;
    /** The (32, 32, 32) header fill (only for an owned colony, Draw 1115-1119). */
    headerFill: boolean;
    /** images/environment/planetmaps file for the landscape, or null (Draw 1123). */
    landscape: string | null;
    /** The landscape's right edge (the orbit strip, Space.png, starts here). */
    landscapeWidth: number;
    /** The atmosphere gradient at the landscape's right edge (Draw 1126-1150): packed RGB. */
    atmosphereColor: number;
    texts: GroundReportText[];
    /** The frontline x (the dashed red line), or null when nothing attacks. */
    frontlineX: number | null;
    /** The status bar's defender / invader parts (packed RGB), when something attacks. */
    statusBar: { x: number; y: number; w: number; h: number; split: number; defenderColor: number | null; invaderColor: number | null } | null;
    /** The planetary shield column (128, 160, 224, 255), or null. */
    shield: GrRect | null;
    items: GroundReportItem[];
    /** The size glyph: expanded (PanelSize > 0) draws the shrink arrow. */
    resize: { rect: GrRect; expanded: boolean };
    hotspots: GroundReportHotspot[];
    defendingStrength: number;
    attackingStrength: number;
}

/** ColonyInvasion.cs InitializeImages 290-321: the planet-map files by Habitat.LandscapePictureRef. */
const LANDSCAPE_FILES: readonly string[] = [
    '', '', '', '', 'continental1.png', 'continental2.png', 'continental3.png', 'continental4.png', 'jungle1.png',
    '', '', '', '', '', '', '', '', 'ice1.png', 'ice2.png', 'ice3.png', 'marsh1.png', 'marsh2.png', 'marsh3.png',
    'ocean1.png', 'ocean2.png', 'desert1.png', 'desert2.png', 'desert3.png', 'volcanic1.png', 'volcanic2.png',
];

/** ColonyInvasion.cs BindData 420-446: the landscape file (a type default when the habitat's own is missing). */
export function groundReportLandscape(habitatTypeName: string, landscapePictureRef: number): string {
    let index = landscapePictureRef;
    if (index >= LANDSCAPE_FILES.length || index < 0 || !LANDSCAPE_FILES[index]) {
        switch (habitatTypeName) {
            case 'Volcanic': index = 28; break;
            case 'Desert': index = 25; break;
            case 'MarshySwamp': index = 20; break;
            case 'Continental': index = 4; break;
            case 'Ocean': index = 23; break;
            case 'Ice': index = 17; break;
            default: index = 4; break;
        }
    }
    return LANDSCAPE_FILES[index];
}

/** Draw 1126-1150: the atmosphere colour by habitat type. */
export function atmosphereColor(habitatTypeName: string): number {
    switch (habitatTypeName) {
        case 'Volcanic': return 0xa05000;
        case 'Desert': return 0xa08060;
        case 'MarshySwamp': return 0x004838;
        case 'Continental': return 0x182850;
        case 'Ocean': return 0x183060;
        case 'Ice': return 0x606ca0;
        default: return 0x404040;
    }
}

/** int / int in C#. */
const idiv = (a: number, b: number): number => Math.trunc(a / b);

export interface GroundReportInput {
    galaxy: Galaxy;
    colony: Habitat;
    panelSize: number;
    /** HabitatType's name (Volcanic, Desert, ...): passed in so the model does not import the enum's table. */
    habitatTypeName: string;
}

/** Build everything ColonyInvasion.Draw draws for `colony` (no hover state: groundReport.ts adds it). */
export function buildGroundReport(input: GroundReportInput): GroundReportModel {
    const { galaxy, colony, panelSize } = input;
    const size = GROUND_REPORT_SIZES[panelSize] ?? GROUND_REPORT_SIZES[0];
    const W = size.w;
    const H = size.h;
    const area: GrRect = { x: 0, y: HEADER_SIZE + STATUS_BAR_AREA_HEIGHT, w: W, h: H - (HEADER_SIZE + STATUS_BAR_AREA_HEIGHT) };
    const areaRight = area.x + area.w;
    const areaBottom = area.y + area.h;
    const c = reviewXCoords(panelSize, colony.troops, colony.invadingTroops);
    const texts: GroundReportText[] = [];
    const items: GroundReportItem[] = [];
    const hotspots: GroundReportHotspot[] = [];
    const addItem = (item: GroundReportItem): void => {
        items.push(item);
        hotspots.push({ rect: item.rect, message: item.message, target: items.length - 1 });
    };
    // The C# lists: our null character lists stand for the empty CharacterLists every colony of an empire gets
    // (Empire.1.cs 85-103, Habitat.cs 2920-2939).
    const troops = colony.troops ?? new TroopList();
    const invadingTroops = colony.invadingTroops ?? new TroopList();
    const characters = stellarObjectCharacters(colony) ?? [];
    const invadingCharacters = habitatInvadingCharacterList(colony) ?? [];
    const empire = colony.empire as Empire | null;

    let frontline = c.attackingTroopsArmorX; // num2
    let defendingStrength = 0;
    let attackingStrength = 0;
    let statusBar: GroundReportModel['statusBar'] = null;
    let frontlineX: number | null = null;
    const normalH = fontHeight(GROUND_FONTS.normal);
    const largeH = fontHeight(GROUND_FONTS.large);
    const hugeH = fontHeight(GROUND_FONTS.huge);
    // Draw 1155: `_Colony.Empire != null && Troops != null && Characters != null && InvadingTroops != null &&
    // InvadingCharacters != null` — the lists exist for every colony of an empire, so the empire decides.
    if (empire !== null) {
        const resolved = resolveInvasionEmpires(colony);
        const invader = resolved.invader;
        const defender = resolved.defender ?? empire;
        const r = calculateForceStrengthsDetailed(galaxy, colony, defender, invader, troops, characters, invadingTroops, invadingCharacters);
        defendingStrength = r.defendingStrength;
        attackingStrength = r.attackingStrength;
        const pop = calculatePopulationStrength(galaxy, colony, invader, defender);
        if (pop.isDefending) defendingStrength += pop.result;
        else attackingStrength += pop.result;
        const raiding = invadingTroops.count > 0 && invadingTroops.items[0].type === TroopType.PirateRaider;
        const num3 = 40;
        const num4 = normalH - 2;
        const y1 = idiv(HEADER_SIZE - (largeH + r.defend.amounts.length * num4), 2);
        const y2 = idiv(HEADER_SIZE - (largeH + r.attack.amounts.length * num4), 2);
        const reasonWidth = 220 - num3; // maxSize2.Width
        texts.push({ text: defender.name, x: area.x, y: y1, size: GROUND_FONTS.large, bold: true, centered: false, maxWidth: null });
        r.defend.amounts.forEach((amount, i) => {
            const y3 = y1 + largeH + i * num4;
            texts.push({ text: formatSignedPercent(amount), x: 5, y: y3, size: GROUND_FONTS.normal, bold: false, centered: false, maxWidth: null });
            texts.push({ text: r.defend.reasons[i], x: 5 + num3, y: y3, size: GROUND_FONTS.normal, bold: false, centered: false, maxWidth: reasonWidth });
        });
        if (invader !== null) {
            const x = areaRight - (5 + reasonWidth);
            const name = raiding ? `${invader.name} (${text('Raiding', 'Raiding')})` : invader.name;
            texts.push({ text: name, x, y: y2, size: GROUND_FONTS.large, bold: true, centered: false, maxWidth: null });
            r.attack.amounts.forEach((amount, i) => {
                const y4 = y2 + largeH + i * num4;
                texts.push({ text: formatSignedPercent(amount), x: 5 + x, y: y4, size: GROUND_FONTS.normal, bold: false, centered: false, maxWidth: null });
                texts.push({ text: r.attack.reasons[i], x: 5 + x + num3, y: y4, size: GROUND_FONTS.normal, bold: false, centered: false, maxWidth: reasonWidth });
            });
        }
        const strength = invader !== null
            ? textf('Battle Strength Description', '{0}  vs  {1}', formatThousandsK(defendingStrength), formatThousandsK(attackingStrength))
            : formatThousandsK(defendingStrength);
        texts.push({ text: strength, x: area.x + idiv(area.w, 2), y: idiv(HEADER_SIZE - hugeH, 2), size: GROUND_FONTS.huge, bold: true, centered: true, maxWidth: area.w });
        if (attackingStrength > 0) {
            const total = defendingStrength + attackingStrength;
            const share = Math.fround(defendingStrength / total);
            const width = c.attackingForcesLowerAtmosphereX - c.defendingTroopsSpecialForcesX;
            frontline = c.defendingTroopsSpecialForcesX + Math.trunc(width * share);
            frontlineX = frontline;
            statusBar = {
                x: c.defendingTroopsSpecialForcesX,
                y: HEADER_SIZE + 5,
                w: width,
                h: STATUS_BAR_AREA_HEIGHT - 10,
                split: frontline,
                defenderColor: defender.mainColor,
                invaderColor: invader !== null ? invader.mainColor : null,
            };
            texts.push({
                text: textf('Battle Strength Description', '{0}  vs  {1}', formatThousandsK(defendingStrength), formatThousandsK(attackingStrength)),
                x: c.defendingTroopsSpecialForcesX + idiv(width, 2),
                y: HEADER_SIZE + 6,
                size: GROUND_FONTS.normalBold,
                bold: true,
                centered: true,
                maxWidth: null,
            });
        }
    }

    // Bases in orbit (ResolveLocationBaseAtHabitat).
    const bases = colony.basesAtHabitat ?? [];
    bases.forEach((bo, i) => {
        if (bo == null || bo.hasBeenDestroyed) return;
        const n2 = idiv(area.h, bases.length);
        const y = area.y + idiv(n2, 2) + n2 * i - idiv(c.builtObject, 2);
        addItem({ kind: 'base', rect: { x: area.x + c.attackingForcesOrbitX, y, w: c.builtObject, h: c.builtObject }, obj: bo, mirrored: false, fill: null, readiness: null, message: bo.name });
    });

    // The planetary shield, halfway between the lower atmosphere and the orbit (Draw 1281-1289).
    let shield: GrRect | null = null;
    if (colony.planetaryShieldPresent) {
        shield = { x: c.attackingForcesLowerAtmosphereX + idiv(c.attackingForcesOrbitX - c.attackingForcesLowerAtmosphereX, 2) - 3, y: area.y, w: 6, h: areaBottom };
        hotspots.push({ rect: shield, message: text('Planetary Facility Planetary Shield', 'Planetary Shield'), target: -1 });
    }

    // The population: one figure per billion (Draw 1290-1305).
    const population = colony.population;
    const race = population?.dominantRace ?? null;
    if (population != null && race !== null) {
        const num9 = 1 + Math.trunc(population.totalAmount / 1000000000);
        const popStrength = idiv(calculatePopulationStrength(galaxy, colony, null, null).result, num9);
        const num11 = idiv(area.h, num9);
        for (let i = 0; i < num9; i++) {
            const rect = { x: c.populationX, y: area.y + idiv(num11, 2) + num11 * i - idiv(c.population, 2), w: c.population, h: c.population };
            const message = attackingStrength > 0
                ? textf('Colony Population Defending RACE Description', 'Defending {0} Population, Defense Strength: {1}', race.name, popStrength.toFixed(0))
                : textf('Colony Population RACE Description', '{0} Population', race.name);
            addItem({ kind: 'population', rect, obj: colony, mirrored: false, fill: null, readiness: null, message });
        }
    }

    // Facilities (ResolveLocationFacility).
    const facilities = (colony.facilities ?? []) as (PlanetaryFacility | null)[];
    facilities.forEach((f, i) => {
        if (f == null) return;
        const n2 = idiv(area.h, facilities.length);
        const y = area.y + idiv(n2, 2) + n2 * i - idiv(c.facility, 2);
        addItem({ kind: 'facility', rect: { x: area.x + c.facilityX, y, w: c.facility, h: c.facility }, obj: f, mirrored: false, fill: null, readiness: null, message: f.name });
    });

    // Defending characters (ResolveLocationDefendingCharacter).
    characters.forEach((ch, i) => {
        if (ch == null) return;
        const n2 = idiv(area.h - c.character, characters.length);
        const y = area.y + idiv(n2, 2) + n2 * i;
        addItem({
            kind: 'defendingCharacter',
            rect: { x: area.x + c.defendingCharactersX, y, w: c.character, h: c.character },
            obj: ch,
            mirrored: false,
            fill: ch.empire !== null ? ch.empire.mainColor : null,
            readiness: null,
            message: `${ch.name} (${roleText(ch.role)})`,
        });
    });

    // Defending troops (ResolveLocationDefendingTroop, the split-list overload; mirrored, readiness bars).
    const ds = splitTroopsByType(troops, true);
    for (const troop of troops.items) {
        if (troop == null) continue;
        const rect = defendingTroopRect(troop, area, c, c.defendingTroopsSpecialForcesX, frontline, ds);
        if (rect === null) continue;
        addItem({
            kind: 'defendingTroop',
            rect,
            obj: troop,
            mirrored: true,
            fill: null,
            readiness: troop.readiness,
            message: textf('Troop Description Defend NAME STRENGTH HEALTH', '{0}, Defense Strength: {1}, Health: {2}', troop.name, troop.overallDefendStrength.toFixed(0), `${roundAway(troop.readiness)}%`),
        });
    }

    // Invading troops (ResolveLocationAttackingTroop at landing offset 0: a landing pod is groundReportAnim.ts's).
    const as = splitTroopsByType(invadingTroops, true);
    for (const troop of invadingTroops.items) {
        if (troop == null) continue;
        const rect = attackingTroopRect(troop, area, c, c.attackingForcesLowerAtmosphereX, frontline, as);
        if (rect === null) continue;
        addItem({
            kind: 'invadingTroop',
            rect,
            obj: troop,
            mirrored: false,
            fill: null,
            readiness: troop.readiness,
            message: textf('Troop Description Attack NAME STRENGTH HEALTH', '{0}, Attack Strength: {1}, Health: {2}', troop.name, troop.overallAttackStrength.toFixed(0), `${roundAway(troop.readiness)}%`),
        });
    }

    // Invading characters (ResolveLocationAttackingCharacter).
    invadingCharacters.forEach((ch, i) => {
        if (ch == null) return;
        const n2 = idiv(area.h - c.character, invadingCharacters.length);
        const y = area.y + idiv(n2, 2) + n2 * i;
        addItem({
            kind: 'invadingCharacter',
            rect: { x: area.x + c.attackingCharactersX, y, w: c.character, h: c.character },
            obj: ch,
            mirrored: false,
            fill: ch.empire !== null ? ch.empire.mainColor : null,
            readiness: null,
            message: `${ch.name} (${roleText(ch.role)})`,
        });
    });

    // The size glyph (Draw 1471-1492): 18 × 18 at (W - 24, 6).
    const resizeRect: GrRect = { x: W - (18 + 6), y: 6, w: 18, h: 18 };
    hotspots.push({ rect: resizeRect, message: panelSize > 0 ? text('Shrink Screen', 'Shrink Screen') : text('Expand Screen', 'Expand Screen'), target: 'resize' });

    return {
        panelSize,
        size,
        columns: c,
        headerFill: empire !== null,
        landscape: groundReportLandscape(input.habitatTypeName, colony.landscapePictureRef),
        landscapeWidth: W - SPACE_IMAGE_WIDTH,
        atmosphereColor: atmosphereColor(input.habitatTypeName),
        texts,
        frontlineX,
        statusBar,
        shield,
        items,
        resize: { rect: resizeRect, expanded: panelSize > 0 },
        hotspots,
        defendingStrength,
        attackingStrength,
    };
}

type Split = ReturnType<typeof splitTroopsByType>;

/** ColonyInvasion.cs 845 ResolveLocationDefendingTroop(troop, area, backlineX, frontlineX, infantry, armored, ...). */
export function defendingTroopRect(troop: Troop, area: GrRect, c: GroundReportColumns, backlineX: number, frontlineX: number, s: Split): GrRect | null {
    let list: Troop[] = [];
    let ratio = 0;
    switch (troop.type) {
        case TroopType.Infantry:
        case TroopType.PirateRaider:
            list = s.infantry;
            ratio = RATIO.defendingInfantry;
            break;
        case TroopType.Armored:
            list = s.armored;
            ratio = RATIO.defendingArmor;
            break;
        case TroopType.Artillery:
            list = s.artillery;
            ratio = RATIO.defendingArtillery;
            break;
        case TroopType.SpecialForces:
            list = s.specialForces;
            break;
    }
    const i = list.indexOf(troop);
    if (i < 0) return null;
    const n3 = idiv(area.h - c.troop, list.length);
    const y = area.y + idiv(n3, 2) + n3 * i;
    const x = troop.type === TroopType.SpecialForces ? area.x + c.defendingTroopsSpecialForcesX : backlineX + Math.trunc((frontlineX - backlineX) * Math.fround(ratio));
    return { x, y, w: c.troop, h: c.troop };
}

/** ColonyInvasion.cs 957 ResolveLocationAttackingTroop(troop, area, backlineX, frontlineX, infantry, ...), landing 0. */
export function attackingTroopRect(troop: Troop, area: GrRect, c: GroundReportColumns, backlineX: number, frontlineX: number, s: Split): GrRect | null {
    let list: Troop[] = [];
    let ratio = 0;
    switch (troop.type) {
        case TroopType.Infantry:
        case TroopType.PirateRaider:
            list = s.infantry;
            ratio = RATIO.attackingInfantry;
            break;
        case TroopType.Armored:
            list = s.armored;
            ratio = RATIO.attackingArmor;
            break;
        case TroopType.Artillery:
            list = s.artillery;
            ratio = RATIO.attackingArtillery;
            break;
        case TroopType.SpecialForces:
            list = s.specialForces;
            break;
    }
    const i = list.indexOf(troop);
    if (i < 0) return null;
    const n3 = idiv(area.h - c.troop, list.length);
    const y = area.y + idiv(n3, 2) + n3 * i;
    const x = troop.type === TroopType.SpecialForces ? area.x + c.attackingTroopsSpecialForcesX : frontlineX + Math.trunc((backlineX - frontlineX) * Math.fround(ratio));
    return { x, y, w: c.troop, h: c.troop };
}

/** HotspotList.ResolveHotspotAtPoint: the first hotspot whose rectangle contains the point (Rectangle.Contains:
 *  left / top inclusive, right / bottom exclusive). */
export function hotspotAt(hotspots: readonly GroundReportHotspot[], x: number, y: number): GroundReportHotspot | null {
    for (const h of hotspots) {
        const r = h.rect;
        if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return h;
    }
    return null;
}

/**
 * Main_KeyUp OpenGroundInvasionStatusScreen (Main.Part7.cs:3321-3350): the colony the "[" key opens — the selected
 * habitat when it has population, else the player's capital (null: none, the key does nothing).
 */
export function groundReportKeyColony(selected: unknown, isHabitat: (o: unknown) => o is Habitat, capital: Habitat | null): Habitat | null {
    if (selected === null || !isHabitat(selected)) return capital;
    const h = selected;
    if (h.population == null || h.population.items.length <= 0) return capital;
    return h;
}
