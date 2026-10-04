// The hover texts of a colony's planetary facilities, where the original shows them:
// - the selection panel's Facilities row (InfoPanel.cs 2552 DrawFacilities → AddHotspot message, shown as the main
//   view's hover message, Main.Part10.cs 1141-1159 → string_17), and its click (Main.Part4.cs 3586-3597
//   pnlDetailInfo_MouseClick: a PlanetaryFacility hotspot opens the Galactopedia at "Wonders" or "Planetary
//   Facilities", method_456);
// - the Colonies screen's Facilities tab (DistantWorlds.Controls PlanetaryFacilityListIconView.cs 211
//   GenerateFacilityItems: the item text and its ToolTipText).
// The original keeps no damaged / disabled state on a PlanetaryFacility (PlanetaryFacility.cs: definition id +
// ConstructionProgress), so the hovers carry the name, the build progress, the pirate owner, the wonder benefits and the
// maintenance, exactly as the C# builds them.
//
// Pure reads of the sim (no Rnd, no lazy writes): checkFacilityOwner / getEmpireById / getByFacilityControl only look.
// No DOM.

import type { Galaxy } from '../sim/galaxy';
import type { Habitat } from '../sim/types';
import type { PlanetaryFacility } from '../sim/construction/facilities';
import { PlanetaryFacilityType } from '../sim/researchSystem';
import { checkFacilityOwner } from '../sim/pirates/pirateEmpireAI';
import { getEmpireById } from '../sim/logistics/contracts';
import { resolveWonderDescription } from '../sim/construction/facilityText';
import { formatNet, tryGetText } from '../sim/textResolver';

/** TextResolver.GetText with the GameText.txt English as the fallback (headless tests run without the table). */
function T(key: string, english: string): string {
    return tryGetText(key) ?? english;
}

/** .NET `ToString("0%")` / `(x * 100f).ToString("0")`: ×100, rounded half away from zero. */
function pct0(v: number): string {
    const p = v * 100;
    return String(p < 0 ? -Math.round(-p) : Math.round(p));
}

/** .NET `ToString("#,###,##0")`: rounded half away from zero, comma-grouped. */
function money(v: number): string {
    const r = v < 0 ? -Math.round(-v) : Math.round(v);
    const s = String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return r < 0 ? `-${s}` : s;
}

function isPirateFacility(f: PlanetaryFacility): boolean {
    const t = f.type;
    return t === PlanetaryFacilityType.PirateBase || t === PlanetaryFacilityType.PirateFortress || t === PlanetaryFacilityType.PirateCriminalNetwork;
}

/**
 * Port of InfoPanel.cs 2575-2604 (DrawFacilities): the facility hotspot's hover message — the name, " (NN% complete)"
 * while under construction, " (Empire)" for a pirate facility whose facility control a faction holds, then
 * " (click for details)".
 */
export function facilityPanelHoverText(galaxy: Galaxy, h: Habitat, f: PlanetaryFacility): string {
    let text = f.name;
    if (f.constructionProgress < 1) text = `${text} (${pct0(f.constructionProgress)}% ${T('Complete', 'Complete').toLowerCase()})`;
    if (isPirateFacility(f)) {
        const byFacilityControl = h.pirateColonyControl.getByFacilityControl();
        if (byFacilityControl !== null && byFacilityControl.hasFacilityControl) {
            const empire = getEmpireById(galaxy, byFacilityControl.empireId);
            if (empire !== null) text = `${text} (${empire.name})`;
        }
    }
    return `${text} (${T('click for details', 'click for details')})`;
}

/** Main.Part4.cs 3586-3597: the Galactopedia topic a facility hotspot opens (method_456(GetText(...))). */
export function facilityGalactopediaTopic(f: PlanetaryFacility): string {
    return f.type === PlanetaryFacilityType.Wonder ? 'Wonders' : 'Planetary Facilities';
}

/** One PlanetaryFacilityListIconView item: its label and its tool tip ('' = none). */
export interface FacilityListItem {
    text: string;
    toolTip: string;
}

/**
 * Port of PlanetaryFacilityListIconView.cs 211 GenerateFacilityItems for one facility: the label is the name, plus
 * " (Owned by X)" when the facility's owner (Habitat.CheckFacilityOwner) is not the colony owner; the tool tip is that
 * owner text upper-cased, the "NN% complete" progress, the wonder's benefits (Galaxy.ResolveWonderDescription) and the
 * annual maintenance (" (when completed)" while under construction), one per line. As in the C#, the progress line
 * replaces (`str3 = ...`, not `+=`) the owner line written before it, and a wonder's maintenance shows twice (its
 * ResolveWonderDescription lines already end with the "Facility Maintenance Cost" line, Galaxy.5.cs 487 / 589).
 */
export function facilityListItem(galaxy: Galaxy, colony: Habitat | null, f: PlanetaryFacility): FacilityListItem {
    let text = f.name;
    let owner = '';
    if (colony !== null) {
        const empire = checkFacilityOwner(galaxy, colony, f);
        if (empire !== colony.owner && empire !== null) owner = formatNet(T('Pirate Facility Owner Description', 'Owned by {0}'), [empire.name]);
    }
    if (owner !== '') text = `${text} (${owner})`;
    let tip = '';
    if (owner !== '') tip = `${tip}${owner.toUpperCase()}\n`;
    if (f.constructionProgress < 1) tip = `${pct0(f.constructionProgress)}% ${T('Complete', 'Complete').toLowerCase()}`;
    if (f.type === PlanetaryFacilityType.Wonder) {
        if (tip !== '') tip += '\n';
        tip += resolveWonderDescription(f.def);
    }
    if (f.maintenance > 0) {
        if (tip !== '') tip += '\n';
        tip = `${tip}${T('Facility Maintenance Cost', 'Annual Maintenance')}: ${money(f.maintenance)} ${T('credits', 'credits')}`;
        if (f.constructionProgress < 1) tip = `${tip} (${T('when completed', 'when completed')})`;
    }
    return { text, toolTip: tip };
}
