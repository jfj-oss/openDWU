// Task M3 — the "Overlays" HUD toggles (src/ui/mapOverlays.ts) drawn against real sim data. Fade civilian ships is
// builtObjectLayer.ts's sprite alpha.
//
// Fleet Postures / Long Range Scanners (parity C3): MainView.2.cs 3921 method_247 and the scanner discs baked into the
// galaxy / sector backdrops (MainView.1.cs 4006, MainView.2.cs 277) — pure parts in postureOverlay.ts. The posture
// discs and lines are their own container (postureRoot), which MainView places as the C# draws them: method_250
// (MainView.cs 1538) runs after method_76 (the habitats, ships, fighters, creatures and their bars, f < 1000), and
// method_247 is its first pass (MainView.2.cs 5221), before the galaxy-pass symbols / fleet icons (5830-6020, 6140).
// So the discs are above the close-zoom ship art, and below the galaxy-pass symbols (MainView.placePostureLayer).
//
// Travel Vectors (task 14c, parity C3): port of MainView.2.cs method_250's per-ship pass (5925-5956: the viewing
// empire's non-fleet ships, in red, 2 px, when SpecialHighlightBuiltObjects holds them) + method_258's fleet pass
// (6335-6370, f > 150 only: every fleet the player can see — IsObjectVisibleToThisEmpire(lead, true, false) — the
// selected one in yellow) + BaconMainView.cs method_253 (dashed, with the arrowhead texture2D_35); see travelVectorsFor
// / fleetTravelVector. method_258 6371-6393 also draws, for fleets in the viewer's IncomingEnemyFleetsAndPlanetDestroyers
// that attack / bombard it, a dashed 2 px red (128, 255, 0, 0) line to their target (incomingAttackLine).
// SpecialHighlightBuiltObjects (MainView.cs field; Main.Part9.cs 870 method_246; mapHighlights.ts): set when the
// selection changes (Main.Part10.cs 1323-1331) to the player's ships travelling to the selected StellarObject — a ship,
// habitat, creature or fighter (Empire.6.cs 1165 DetermineShipsMovingToDestination) — and by the left-sidebar list hover
// (ui/listHover.ts, ItemListPanel.cs 2384-2389). The hovered row's EventLocations ping (MainView.2.cs 3500 method_232)
// is drawn here too (updateEventPings).
//
// Weapon-range circles / gravity-well ring for the selected ship (BaconMain.cs 404-470): weaponRangeCircles.ts.
//
// Empire Territory (Controls/MainView.2.cs / GalaxyMap.cs): the original's
// GameOptions.MapOverlayEmpireTerritory defaults *false*, but it does not
// gate whether territory is drawn — it only chooses which of two shading
// algorithms GalaxyMap.cs uses (CalculateEmpireTerritoryGrid vs
// CalculateEmpireSystemTerritory); territory is always shown. This renderer
// only implements one disc style (empireLayer.ts), so the toggle instead
// controls that disc's visibility and starts ON (createMapOverlayState) to
// match "territory is always shown" in spirit.
//
// Potential Colonies / Scenic Locations / Research Locations
// (Controls/MainView.2.cs method_248/method_251, flag17/flag18/flag19 built
// from gameOptions_0.MapOverlay{PotentialColonies,ScenicLocations,
// ResearchLocations}): the original marks whole *systems* (aggregated over
// their habitats: SystemInfo.PlayerPotentialColonies / HasScenery /
// HasResearchBonus, set in DistantWorlds.Types/Galaxy.1.cs
// DetermineSystemInfo) with a ring around the system's star icon, drawn by
// method_206/207/208/209: a 4px-wide ellipse 8px larger than the icon, in
// the same yellow as the selection ring (MainView.cs field color_2 default,
// System.Drawing.Color.FromArgb(255, 255, 255, 0)). This renderer marks the
// individual flagged *habitat* (star, planet or moon) with that same ring
// style instead of the whole system, since the Main View shows habitats
// individually at system/planet zoom (unlike the original's separate
// SystemView screen) — the per-habitat marker is strictly more precise and
// uses the identical visual language.
//
// Potential Colonies eligibility ports the per-habitat test inside
// DetermineSystemInfo (`flag`), which is Empire.4.cs
// CanEmpireColonizeHabitat: unowned (or owned by the independent empire),
// system explored, and either a colonizable habitat type for the player race
// or buildable by the player's newest colony-ship design, further gated by
// quality >= 0.5 (or superluxury resources, or positive ruin bonuses). This
// renderer does not carry colony-ship designs or ruins yet, so it checks
// unowned + explored + colonizable type + quality >= 0.5 only.
// TODO(overlay): fold in colony-ship design range and ruin/superluxury
// bonuses once those are ported.
//
// [dw2overlays] The three marker sets are rebuilt when the player's knowledge changes (colonyTargets.ts
// colonyTargetSignature: systems explored, colonies founded / lost, designs, a game month) instead of once at
// construction, and Scenic / Research Locations only mark explored systems, as the C# (MainView.2.cs 4603:
// empire.CheckSystemExplored(systemInfo.SystemStar)) does. The Improvements overlays (ui/improvements.ts) live here too:
// Colony Target Scores (colonyScoreOverlay.ts; it takes over the Potential Colonies ring of every habitat it scores),
// Resources (resourceOverlay.ts) and Fuel Range (fuelOverlay.ts).

import { circleAtScreenRes, segmentCircle } from './screenCircle';
import { drawnBuiltObjectPos, type MotionInterpolator } from './renderInterp';
import { ColorMatrixFilter, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { LRS_DISC_URL, LRS_LAYER_ALPHA, POSTURE_ALPHA, POSTURE_LINE_WIDTH_PX, fleetPostureMarks, longRangeScannerDiscs, scannerLayerFade } from './postureOverlay';
import { WEAPON_CIRCLES_MIN_FACTOR, drawRangeCircle, gravityWellRing, weaponRangeCircles } from './weaponRangeCircles';
import { isObjectVisibleToThisEmpire } from '../sim/independentTraders';
import { BuiltObjectMission, BuiltObjectMissionType, CommandAction, type Command } from '../sim/missions/mission';
import { baconMovementSettings, calculateGravityWellSize } from '../sim/movement';
import { getSettings } from '../ui/settings';
import type { Camera } from './camera';
import type { Galaxy } from '../sim/galaxy';
import { Habitat, HabitatCategoryType } from '../sim/types';
import { onOverlayChange, setOverlay, type MapOverlayState, type OverlayKey } from '../ui/mapOverlays';
import type { EmpireLayer } from './empireLayer';
import { moonDotPx, planetSpritePx, starSpritePx } from './mainView';
import { BuiltObject } from '../sim/builtObject';
import type { Creature } from '../sim/creature';
import type { Fighter } from '../sim/combat/fighters';
import {
    EVENT_PING_COLOR,
    EVENT_PING_MARGIN_PX,
    EVENT_PING_SIDES,
    EVENT_PING_WIDTH_PX,
    EventPingClock,
    mapHighlightsOf,
    selectedStellarObject,
    shipsMovingToDestination,
    type MapHighlights,
    type SelectedObjectLike,
} from './mapHighlights';
// Moved to mapHighlights.ts (the list hover shares them); re-exported for the existing importers.
export { checkShipTravellingToDestination, selectedStellarObject, shipsMovingToDestination, type SelectedObjectLike } from './mapHighlights';
import type { Empire } from '../sim/empire';
import type { ShipGroup } from '../sim/fleets/shipGroup';
import { builtObjectMission } from '../sim/missions/mission';
import { BuiltObjectRole } from '../sim/data/designSpecifications';
import { DrawKey, DrawSig } from './drawCache';
import { warEmpires } from './builtObjectLayer';
import { FreightOverlay } from './freightOverlay'; // [freightOverlay]
import { threatKnownSites, type KnownThreatSite } from '../sim/scenario/threats/framework';
import { scenarioMapFeatures, type ScenarioMapMarker } from '../sim/scenario/mapFeatures';
import { WRECK_MARKER_COLOR, visibleWreckFields, wreckFieldHit, wreckMarker } from '../ui/scenario/wreckageUi'; // [wreckage]
import type { WreckField } from '../sim/scenario/wreckage/common'; // [wreckage]
// [dw2overlays] begin
import { ResourceOverlay } from './resourceOverlay';
import { ColonyScoreOverlay } from './colonyScoreOverlay';
import { FuelOverlay } from './fuelOverlay';
import { colonyTargetSignature } from './colonyTargets';
import { fogOf } from './fog';
import { resourceTooltipText, knownResourceIndexFor } from './resourceOverlayData';
import type { HabitatType } from '../sim/types';
// [dw2overlays] end
import { SupplyOverlay } from './supplyOverlay'; // [improvements] supplyChain

/** Scenario threat markers (19b "Threats" overlay): suspected = amber, confirmed = red. */
export const THREAT_SUSPECTED_COLOR = 0xffa020;
export const THREAT_CONFIRMED_COLOR = 0xff3030;

/** Marker geometry for a known threat site at zoom z (world units): a ring around a colony, a diamond on a ship. */
export function threatMarker(site: KnownThreatSite, z: number): { kind: 'ring' | 'diamond'; x: number; y: number; r: number; color: number } {
    const t = site.target;
    const color = site.level >= 3 ? THREAT_CONFIRMED_COLOR : THREAT_SUSPECTED_COLOR;
    if (site.kind === 'colony') {
        const h = t as Habitat;
        return { kind: 'ring', x: h.xpos, y: h.ypos, r: Math.max(drawnPx(h, z) / 2 + 12 / z, 14 / z), color };
    }
    const b = t as BuiltObject;
    return { kind: 'diamond', x: b.xpos, y: b.ypos, r: 10 / z, color };
}

/** The original's selection-ring yellow (MainView.cs `color_2` default,
 * `System.Drawing.Color.FromArgb(255, 255, 255, 0)`), reused by
 * method_206/207/208/209 for these overlay markers. */
export const OVERLAY_MARKER_COLOR = 0xffff00;

/** Drawn on-screen size of a habitat at the current zoom, matching
 * MainView.ts's own per-category size functions (duplicated here rather
 * than imported as a method since MainView's version is private). */
function drawnPx(h: Habitat, z: number): number {
    if (h.category === HabitatCategoryType.Star) return starSpritePx(h.diameter, z);
    if (h.category === HabitatCategoryType.Moon) return moonDotPx(h.diameter, z);
    return planetSpritePx(h.diameter, z);
}

/** Port of Galaxy.1.cs DetermineSystemInfo's per-habitat `flag` test
 * (Empire.4.cs CanEmpireColonizeHabitat), simplified per the module doc
 * comment above: unowned (or independent-owned) + system explored + a
 * colonizable habitat type for the player race + quality >= 0.5. */
export function isPotentialColony(h: Habitat, galaxy: Galaxy, colonizable?: readonly HabitatType[]): boolean {
    const empire = galaxy.playerEmpire;
    if (empire === null) return false;
    if (h.category !== HabitatCategoryType.Planet && h.category !== HabitatCategoryType.Moon) return false;
    const owner = h.owner ?? h.empire;
    if (owner !== null && owner !== undefined && owner !== galaxy.independentEmpire) return false;
    if (!empire.visibility.checkSystemExplored(h.systemIndex)) return false;
    // `colonizable`: ColonizableHabitatTypesForEmpire computed once for a whole pass.
    if (!(colonizable ?? empire.colonizableHabitatTypesForEmpire()).includes(h.type)) return false;
    return h.quality >= 0.5;
}

/** Port of Galaxy.1.cs DetermineSystemInfo's `hasScenery` per-habitat test
 * (`habitat.ScenicFactor > 0f`); stars carry a ScenicFactor too. */
export function isScenicLocation(h: Habitat): boolean {
    return h.scenicFactor > 0;
}

/** Port of Galaxy.1.cs DetermineSystemInfo's `hasResearchBonus` per-habitat
 * test (`habitat.ResearchBonus > 0`); stars carry a ResearchBonus too. */
export function isResearchLocation(h: Habitat): boolean {
    return h.researchBonus > 0;
}

class MarkerRing {
    graphics = new Graphics();
    /** Last drawn position / radius / width (the geometry is rebuilt only on change). */
    key = new DrawKey();
    constructor(public habitat: Habitat, layer: Container) {
        this.graphics.visible = false;
        layer.addChild(this.graphics);
    }
}

// MainView.2.cs method_251: Color.FromArgb(170, 170, 170)
export const TRAVEL_VECTOR_COLOR = 0xaaaaaa;
/** Zoom factor (galaxy units per px) below which the Travel Vectors overlay is hidden: the system pass (f < 150). */
export const TRAVEL_VECTOR_MIN_FACTOR = 150;
/** XnaDrawingHelper.DrawLine(dashed) (XnaDrawingHelper.cs 572-605): 6 px dashes with 6 px gaps (every other 6 px step). */
export const TRAVEL_VECTOR_DASH_PX = 6;

/** The arrowhead art (Main.Part12.cs:709 bitmap_105 -> MainView.1.cs:2184 texture2D_35). */
export const ARROWHEAD_URL = '/assets/dwu/images/ui/chrome/arrowhead.png';

/**
 * Port of XnaDrawingHelper.DrawLine's arrowhead (XnaDrawingHelper.cs 587-596): drawn centred at the line end pulled
 * back towards the start by half its height, rotated to the line angle + 90 degrees, scaled so it is
 * 9 / (texW / min(2, lineThickness)) of the art (9 px wide for a 1 px line). `pxToWorld` converts the px offset.
 */
export function arrowheadPlacement(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    texW: number,
    texH: number,
    lineThickness: number,
    pxToWorld: number,
): { x: number; y: number; rotation: number; scale: number } {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const scale = 9 / (texW / Math.min(2, lineThickness));
    const h = texH * scale;
    const back = Math.atan2(y1 - y2, x1 - x2);
    return { x: x2 + Math.cos(back) * (h / 2) * pxToWorld, y: y2 + Math.sin(back) * (h / 2) * pxToWorld, rotation: angle + Math.PI / 2, scale };
}

/** method_252 draws the vector 1 px thick (lineThickness 1) — one DEVICE pixel, so on a HiDPI screen it stays as thin
 * (and as faint) as the original instead of doubling to 2 device px. Returned in CSS px. */
export function travelVectorWidthPx(devicePixelRatio: number): number {
    return 1 / Math.max(1, devicePixelRatio);
}

export type TravelVectorKind = 'state' | 'private';

export interface TravelVector {
    builtObject: BuiltObject;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    /**
     * Streamlined (not in the original): when (x2, y2) is the gravity-well exit point BaconBuiltObject
     * SendShipTowardsEdgeOfGravityWell queued (useStarGravityWells), the mission's real destination beyond it. The
     * selected-ship vector draws a second leg to it; the other vectors ignore it.
     */
    x3?: number;
    y3?: number;
}

/**
 * Commands that only do bookkeeping and complete at once (no point of their own): ResolveTargetCoordinatesCurrentCommand
 * is Point.Empty for them, so method_253 draws to the parent — or, with none, to (0, 0), the galaxy's top-left corner.
 */
const BOOKKEEPING_COMMANDS: ReadonlySet<CommandAction> = new Set([
    CommandAction.Undock,
    CommandAction.RepeatSubsequentCommands,
    CommandAction.EvaluateThreats,
    CommandAction.SelectTargetToAttack,
    CommandAction.ReassignMission,
    CommandAction.SetParent,
    CommandAction.ClearParent,
    CommandAction.ClearAttackers,
]);

const MOVEMENT_COMMANDS: ReadonlySet<CommandAction> = new Set([
    CommandAction.ImpulseTo,
    CommandAction.MoveTo,
    CommandAction.SprintTo,
    CommandAction.HyperTo,
    CommandAction.ConditionalHyperTo,
]);

/** BuiltObjectMission.cs 913 ResolveTargetCoordinatesCurrentCommand for any queued command; null for Point.Empty. */
function commandTargetPoint(m: BuiltObjectMission, command: Command): { x: number; y: number } | null {
    let x = -1.0;
    let y = -1.0;
    if (command.targetBuiltObject !== null) {
        x = command.targetBuiltObject.xpos;
        y = command.targetBuiltObject.ypos;
    } else if (command.targetHabitat !== null) {
        x = command.targetHabitat.xpos;
        y = command.targetHabitat.ypos;
    } else if (command.targetCreature !== null) {
        x = command.targetCreature.xpos;
        y = command.targetCreature.ypos;
    } else if (command.targetShipGroup !== null) {
        if (command.targetShipGroup.leadShip !== null) {
            x = command.targetShipGroup.leadShip.xpos;
            y = command.targetShipGroup.leadShip.ypos;
        }
    } else if (command.xpos > -2000000001.0 && command.ypos > -2000000001.0) {
        x = command.xpos;
        y = command.ypos;
    }
    const p = m.ensureCoordsInGalaxy(x, y);
    const r = { x: Math.trunc(p.x), y: Math.trunc(p.y) };
    return r.x === 0 && r.y === 0 ? null : r;
}

/**
 * Whether `p` (a plain-point MoveTo / HyperTo / ConditionalHyperTo target) is the well exit point
 * BaconBuiltObject.cs 3746 SendShipTowardsEdgeOfGravityWell queues: on the circle of radius max(1.03 r, r + 1000)
 * round the ship's nearest star (r = CalculateGravityWellSize). A small tolerance covers the float32 command
 * coordinates and a well size that changed since the point was queued.
 */
function isGravityWellExitPoint(bo: BuiltObject, command: Command, p: { x: number; y: number }): boolean {
    if (!baconMovementSettings.useStarGravityWells) return false;
    if (command.action !== CommandAction.MoveTo && command.action !== CommandAction.HyperTo && command.action !== CommandAction.ConditionalHyperTo) return false;
    if (command.targetBuiltObject !== null || command.targetHabitat !== null || command.targetCreature !== null || command.targetShipGroup !== null) return false;
    const star = bo.nearestSystemStar;
    if (star === null || star === undefined) return false;
    const r = calculateGravityWellSize(bo);
    if (!(r > 0)) return false;
    const exitR = Math.max(r * 1.03, r + 1000.0);
    return Math.abs(Math.hypot(p.x - star.xpos, p.y - star.ypos) - exitR) <= Math.max(50, exitR * 0.02);
}

// Port of BaconDistantWorlds/BaconMainView.cs method_253 guard + target
// (without the ShipGroup clause; travelVectorsFor handles fleets), with three streamlined fixes for the Bacon gravity
// wells (useStarGravityWells), where a ship stays HyperjumpPrepare while it flies sublight out of the well (its jump
// is held back) and keeps it after a trip that ended inside a well:
// - bookkeeping commands at the top of the queue (ClearParent, Undock, ...) are looked past to the next real one
//   instead of falling back to the parent / (0, 0) (a line to the galaxy's top-left corner);
// - below warp speed only a movement command draws (a ship holding / loading with a stale HyperjumpPrepare is not
//   travelling), and a target that resolves to nothing draws nothing rather than a line to (0, 0);
// - a gravity-well exit waypoint carries the mission's destination (x3, y3).
export function travelVectorFor(bo: BuiltObject): TravelVector | null {
    if (bo.hasBeenDestroyed) return null;
    if (bo.role === BuiltObjectRole.Base) return null;
    if (bo.topSpeed <= 0) return null;
    if (bo.warpSpeed <= 0) return null;
    const atWarp = bo.currentSpeed > bo.topSpeed;
    if (!atWarp && !bo.hyperjumpPrepare) return null;
    const m = builtObjectMission(bo.mission);
    if (m === null) return null;
    if (m.type === 0) return null; // BuiltObjectMissionType.Undefined
    const current = m.fastPeekCurrentCommand();
    let command = current;
    if (command !== null && BOOKKEEPING_COMMANDS.has(command.action)) {
        command = null;
        for (const c of m.showAllCommands()) {
            if (c != null && !BOOKKEEPING_COMMANDS.has(c.action)) {
                command = c;
                break;
            }
        }
    }
    if (!atWarp && (command === null || !MOVEMENT_COMMANDS.has(command.action))) return null;
    let p: { x: number; y: number } | null;
    if (command === current) {
        p = m.resolveTargetCoordinatesCurrentCommand();
        if (p.x === 0 && p.y === 0) p = null;
    } else {
        p = command !== null ? commandTargetPoint(m, command) : null;
    }
    if (p === null) {
        // Point.IsEmpty
        if (bo.parentBuiltObject !== null) {
            p = { x: Math.trunc(bo.parentBuiltObject.xpos), y: Math.trunc(bo.parentBuiltObject.ypos) };
        } else if (bo.parentHabitat !== null) {
            p = { x: Math.trunc(bo.parentHabitat.xpos), y: Math.trunc(bo.parentHabitat.ypos) };
        } else {
            return null;
        }
    }
    const v: TravelVector = { builtObject: bo, x1: bo.xpos, y1: bo.ypos, x2: p.x, y2: p.y };
    if (command !== null && isGravityWellExitPoint(bo, command, p)) {
        const t = m.resolveTargetCoordinates(m);
        if (!(t.x === 0 && t.y === 0) && Math.abs(t.x - p.x) + Math.abs(t.y - p.y) > 1000) {
            v.x3 = t.x;
            v.y3 = t.y;
        }
    }
    return v;
}

/** MainView.2.cs method_250 6037-6053 (drawn at zoom factor > BaconMain.minZoomLevelForWeaponsCircles = 0.9): the selected
 * ship — or the selected fleet's lead ship — gets its travel vector in yellow whatever the Travel Vectors toggles say,
 * when it is not a base and belongs to the viewing empire; the same moving / mission / length guards as every other
 * vector (BaconMainView.method_253 with bool_13 true, so a fleet member selected alone is not excluded). */
export const SELECTED_TRAVEL_VECTOR_COLOR = 0xffff00;
export const SELECTED_TRAVEL_VECTOR_MIN_FACTOR = 0.9;
/** The onward leg past a gravity-well exit waypoint (TravelVector.x3; ours). */
export const SELECTED_TRAVEL_VECTOR_ONWARD_ALPHA = 0.55;
export function selectedTravelVectorFor(sel: SelectedObjectLike, player: Empire | null, f: number): TravelVector | null {
    if (sel === null || player === null || !(f > SELECTED_TRAVEL_VECTOR_MIN_FACTOR)) return null;
    const bo = (sel.shipGroup !== undefined ? sel.shipGroup.leadShip : sel.builtObject) ?? null;
    if (bo === null || bo.actualEmpire !== player) return null;
    const v = travelVectorFor(bo);
    if (v === null) return null;
    // With a well-exit leg the destination beyond it counts too (the ship may be next to its exit point).
    const far = v.x3 !== undefined && v.y3 !== undefined && travelVectorLongEnough({ ...v, x2: v.x3, y2: v.y3 }, f);
    return far || travelVectorLongEnough(v, f) ? v : null;
}

// Port of MainView.2.cs method_250's per-ship pass (5925-5956): the viewing empire's ships outside a fleet (a fleet's
// ships are drawn by method_258's fleet pass: lead ships are skipped there, 5932-5935, and members fail method_253's
// ShipGroup clause), State = with an Owner, Private = without.
export function travelVectorsFor(
    galaxy: { builtObjects: readonly (BuiltObject | null)[] },
    player: Empire | null,
    kind: TravelVectorKind,
): TravelVector[] {
    if (player === null) return [];
    const out: TravelVector[] = [];
    for (const bo of galaxy.builtObjects) {
        if (bo === null || bo === undefined) continue;
        const group = bo.shipGroup as ShipGroup | null;
        if (group !== null && group !== undefined) continue;
        if (bo.actualEmpire !== player || (kind === 'private' ? bo.owner !== null : bo.owner === null)) continue;
        const v = travelVectorFor(bo);
        if (v !== null) out.push(v);
    }
    return out;
}

/** MainView.2.cs 5939-5942: SpecialHighlightBuiltObjects vectors are red (255, 0, 0) and 2 px. */
export const SPECIAL_HIGHLIGHT_VECTOR_COLOR = 0xff0000;
export const SPECIAL_HIGHLIGHT_VECTOR_WIDTH = 2;
/** MainView.2.cs 6162: method_258 (fleet icons, fleet travel vectors, incoming attacks) runs only at f > 150 (num16). */
export const FLEET_PASS_MIN_FACTOR = 150;
/** method_258 6390: Color.FromArgb(128, 255, 0, 0), 2 px, dashed. */
export const INCOMING_ATTACK_COLOR = 0xff0000;
export const INCOMING_ATTACK_ALPHA = 128 / 255;
export const INCOMING_ATTACK_WIDTH = 2;

/**
 * Port of MainView.2.cs 6335-6370 (method_258, the Travel Vectors (State) part): a visible fleet's lead-ship vector —
 * yellow when the fleet is the selection, else the 170-grey (method_251); method_253's guards with bool_13 false
 * (a lead ship passes the ShipGroup clause).
 */
export function fleetTravelVector(sg: ShipGroup, selected: boolean): { v: TravelVector; color: number } | null {
    const lead = sg.leadShip;
    if (lead === null) return null;
    const v = travelVectorFor(lead);
    if (v === null) return null;
    return { v, color: selected ? SELECTED_TRAVEL_VECTOR_COLOR : TRAVEL_VECTOR_COLOR };
}

/**
 * Port of MainView.2.cs 6371-6393: when `viewer`'s IncomingEnemyFleetsAndPlanetDestroyers holds this fleet and the
 * fleet's mission attacks / bombards the viewer (ResolveMissionTargetEmpire), the line from its lead ship to the
 * mission target (ResolveTargetCoordinates). Null otherwise.
 */
export function incomingAttackLine(sg: ShipGroup, viewer: Pick<Empire, 'incomingEnemyFleetsAndPlanetDestroyers'>): { x: number; y: number } | null {
    let inList = false;
    for (const fa of viewer.incomingEnemyFleetsAndPlanetDestroyers) {
        if ((fa as { fleet: ShipGroup | null }).fleet === sg) {
            inList = true;
            break;
        }
    }
    if (!inList) return null;
    const m = sg.mission;
    if (m === null) return null;
    const t = m.type;
    if (t !== BuiltObjectMissionType.Attack && t !== BuiltObjectMissionType.WaitAndAttack && t !== BuiltObjectMissionType.Bombard && t !== BuiltObjectMissionType.WaitAndBombard) return null;
    if (BuiltObjectMission.resolveMissionTargetEmpire(m) !== viewer) return null;
    return m.resolveTargetCoordinates(m);
}

// BaconMainView.cs method_253 length gate; f = 1 / z (C# zoom factor).
export function travelVectorLongEnough(v: TravelVector, f: number): boolean {
    return (Math.abs(v.x2 - v.x1) + Math.abs(v.y2 - v.y1)) * (1500 / f) > 40000;
}

/** Split a line into dash segments [x1, y1, x2, y2]; dash/gap are scaled up
 * so no more than `maxDashes` segments are produced. */
export function dashSegments(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    dash: number,
    gap: number,
    maxDashes = 200,
): Array<[number, number, number, number]> {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len === 0) return [];
    let d = dash;
    let g = gap;
    if (len / (d + g) > maxDashes) {
        const k = len / (maxDashes * (d + g));
        d *= k;
        g *= k;
    }
    const ux = (x2 - x1) / len;
    const uy = (y2 - y1) / len;
    const out: Array<[number, number, number, number]> = [];
    for (let t = 0; t < len; t += d + g) {
        const e = Math.min(t + d, len);
        out.push([x1 + ux * t, y1 + uy * t, x1 + ux * e, y1 + uy * e]);
    }
    return out;
}

/**
 * Streamlined (not in the original, whose XnaDrawingHelper.DrawLine dashes from the line start): the dashes of a→b that
 * fall inside the clip rectangle, counted from b — so with b fixed in the world they stay put while a (a moving ship)
 * slides along, at the exact dash / gap length however long the line is (no dashSegments maxDashes stretch, which
 * re-spaces every dash as the length changes). Coordinates are returned relative to (ox, oy).
 */
export function anchoredDashSegments(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    dash: number,
    gap: number,
    clip: { x0: number; y0: number; x1: number; y1: number },
    ox: number,
    oy: number,
): Array<[number, number, number, number]> {
    const len = Math.hypot(ax - bx, ay - by);
    const out: Array<[number, number, number, number]> = [];
    if (!(len > 0) || !(dash > 0)) return out;
    const ux = (ax - bx) / len;
    const uy = (ay - by) / len;
    // Liang-Barsky in length units along b -> a.
    let t0 = 0;
    let t1 = len;
    const dx = ux;
    const dy = uy;
    const p = [-dx, dx, -dy, dy];
    const q = [bx - clip.x0, clip.x1 - bx, by - clip.y0, clip.y1 - by];
    for (let k = 0; k < 4; k++) {
        if (p[k] === 0) {
            if (q[k] < 0) return out;
        } else {
            const r = q[k] / p[k];
            if (p[k] < 0) {
                if (r > t1) return out;
                if (r > t0) t0 = r;
            } else {
                if (r < t0) return out;
                if (r < t1) t1 = r;
            }
        }
    }
    const period = dash + gap;
    for (let t = Math.floor(t0 / period) * period; t < t1; t += period) {
        const s0 = Math.max(t, t0);
        const s1 = Math.min(t + dash, t1);
        if (s1 <= s0) continue;
        out.push([bx + ux * s0 - ox, by + uy * s0 - oy, bx + ux * s1 - ox, by + uy * s1 - oy]);
    }
    return out;
}

/** The weapon-range circles are opt-in (BaconMain.drawWeaponRangeCircles stand-in): the setting, or `?rangeCircles=1`. */
let rangeCirclesParam: boolean | null = null;
export function weaponCirclesEnabled(): boolean {
    if (rangeCirclesParam === null) rangeCirclesParam = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('rangeCircles') === '1';
    return rangeCirclesParam || getSettings().showWeaponRangeCircles;
}

/** The toggles of each guarded overlay (OverlayLayer.runOverlay switches them off when the overlay throws). */
const COLONY_SCORE_KEYS: readonly OverlayKey[] = ['colonyScores'];
const RESOURCE_KEYS: readonly OverlayKey[] = ['resources'];
const FUEL_KEYS: readonly OverlayKey[] = ['fuelRange'];
const FREIGHT_KEYS: readonly OverlayKey[] = ['freightFlows', 'tradeHubs'];
const SUPPLY_KEYS: readonly OverlayKey[] = ['supplyShortages'];

let overlayErrorNotifier: ((message: string) => void) | null = null;
/** The one-line notice (the HUD toast) for an overlay that failed and was switched off (main.ts sets it). */
export function setOverlayErrorNotifier(fn: ((message: string) => void) | null): void {
    overlayErrorNotifier = fn;
}

export class OverlayLayer {
    /** World-space layer: marker rings live above everything else. */
    root = new Container();
    private potentialColonies: MarkerRing[] = [];
    private scenicLocations: MarkerRing[] = [];
    private researchLocations: MarkerRing[] = [];
    private unsubscribe: () => void;
    private travelVectors = new Graphics();
    /** Travel-vector arrowheads (pooled sprites of ARROWHEAD_URL; none until the art has loaded). */
    private arrowheads = new Container();
    private arrowTex: Texture | null = null;
    /** The selected ship / fleet's travel vector (yellow, independent of the toggles) and its arrowhead. */
    private selVector = new Graphics();
    private selArrow: Sprite | null = null;
    /** The HUD selection (set by MainView). */
    getSelection: () => SelectedObjectLike = () => null;
    // [freightOverlay] begin — task 19e-9: Freight Flows / Trade Hubs (src/render/freightOverlay.ts).
    readonly freight: FreightOverlay;
    // [freightOverlay] end
    private threats = new Graphics();
    private threatSites: KnownThreatSite[] = [];
    /** Render interpolation between sim steps (renderInterp.ts; set by MainView): travel vectors start at the drawn
     * ship. Null: its sim position. */
    motion: MotionInterpolator | null = null;
    private threatFrame = 0;
    /** Scenario map markers (mod layer, e.g. the 19a treasure fleet beacon): drawn at every zoom. */
    private scenarioMarkers = new Graphics();
    private scenarioMarkerList: ScenarioMapMarker[] = [];
    private scenarioFrame = 0;
    /** Long Range Scanners: lrs.png discs composited as one layer, then (one colour matrix) RGB set to white — method_221
     *  — and alpha x 13 % — method_236(0.13) — as the C#'s separate bitmap. */
    private lrsLayer = new Container();
    /** Created on first use (a filter compiles a GL program; headless tests build the layer without a GL context). */
    private lrsFilter: ColorMatrixFilter | null = null;
    private lrsSprites: Sprite[] = [];
    private lrsTex: Texture | null = null;
    /** Fleet Postures: the discs (sprites of lrs.png, tinted), their circles and the gather → attack lines, then the
     *  EventLocations pings — in their own world container, which MainView places above the ship art (file header). */
    readonly postureRoot = new Container();
    private postureDiscs = new Container();
    private postureSprites: Sprite[] = [];
    private postureLines = new Graphics();
    private postureArrows = new Container();
    /** Red 2 px vectors of SpecialHighlightBuiltObjects and the incoming-attack lines (their own strokes). */
    private highlightVectors = new Graphics();
    private incomingLines = new Graphics();
    /** Another empire's selected fleet's vector (yellow; method_258 6352-6365). */
    private foreignSelVector = new Graphics();
    /** SpecialHighlightBuiltObjects / EventLocations (mapHighlights.ts): set on a selection change (below) and by
     *  the left-sidebar list hover (ui/listHover.ts). */
    private readonly highlights: MapHighlights;
    private highlightFor: unknown = undefined;
    /** EventLocations pings (method_232) and their shared phase. */
    private eventPings = new Graphics();
    private readonly pingClock = new EventPingClock();
    /** method_258's fleets the player can see (IsObjectVisibleToThisEmpire(lead, true, false)), refreshed once a second. */
    private visibleFleets: ShipGroup[] = [];
    private fleetsRefreshedAt = -Infinity;
    /** Weapon-range circles (centred on the selected ship) and the gravity-well ring (on its nearest star). */
    private weaponCircles = new Graphics();
    private gravityRing = new Graphics();
    // [wreckage] begin — scenario 19e-7 wreck-field markers.
    private wrecks = new Graphics();
    private wreckList: WreckField[] = [];
    private wreckFrame = 0;
    // [wreckage] end
    // [dw2overlays] begin
    readonly resources: ResourceOverlay;
    readonly colonyScores: ColonyScoreOverlay;
    readonly fuel: FuelOverlay;
    /** colonyTargetSignature of the last marker rebuild (null: no player — built once). */
    private markersSig: number | null = null;
    private markersFrame = 0;
    // [dw2overlays] end
    /** [improvements] supplyChain: Supply Shortages markers (src/render/supplyOverlay.ts). */
    readonly supply: SupplyOverlay;

    constructor(
        private galaxy: Galaxy,
        world: Container,
        private empireLayer: EmpireLayer,
        private state: MapOverlayState,
    ) {
        // The scanner discs stay put: just above the territory layer (empireLayer, added to world before), as they share
        // the backdrop bitmap in the C#. The rest of this root is MainView's, placed above the ship art (placePostureLayer).
        this.lrsLayer.visible = false;
        world.addChild(this.lrsLayer);
        world.addChild(this.root);
        this.highlights = mapHighlightsOf(galaxy);
        // method_250 order: the posture discs (5221), then the pings (5777-5783) — both over the ship art.
        this.postureRoot.addChild(this.postureDiscs, this.postureLines, this.postureArrows, this.eventPings);
        // Until MainView places it (headless tests: the layer alone), right above this root.
        world.addChild(this.postureRoot);
        this.root.addChild(this.travelVectors);
        this.root.addChild(this.highlightVectors);
        this.root.addChild(this.incomingLines);
        this.root.addChild(this.foreignSelVector);
        this.root.addChild(this.arrowheads);
        this.root.addChild(this.selVector);
        this.root.addChild(this.weaponCircles, this.gravityRing);
        if (typeof Image !== 'undefined') {
            // Texture.from keeps the image in Pixi's global cache: the handler is dropped once it ran, else the cached
            // image kept this layer — the main view, its galaxy — alive after the game view was torn down.
            const img = new Image();
            img.onload = () => {
                img.onload = null;
                this.arrowTex = Texture.from(img);
            };
            img.src = ARROWHEAD_URL;
            const disc = new Image();
            disc.onload = () => {
                disc.onload = null;
                this.lrsTex = Texture.from(disc);
            };
            disc.src = LRS_DISC_URL;
        }
        // [freightOverlay] begin
        this.freight = new FreightOverlay(galaxy, this.root, state);
        // [freightOverlay] end
        this.root.addChild(this.threats);
        this.root.addChild(this.scenarioMarkers);
        this.root.addChild(this.wrecks); // [wreckage]
        // [dw2overlays] begin
        this.colonyScores = new ColonyScoreOverlay(galaxy, this.root, state);
        this.resources = new ResourceOverlay(galaxy, this.root, state);
        this.fuel = new FuelOverlay(galaxy, this.root, state);
        // [dw2overlays] end
        // [dw2overlays] The marker sets are rebuilt as the player's knowledge changes (rebuildMarkersIfChanged).
        this.rebuildMarkers();
        this.supply = new SupplyOverlay(galaxy, this.root, state); // [improvements] supplyChain
        // React to a toggle immediately rather than waiting for the next
        // frame's update() (which reads `state` fresh anyway, but the
        // Empire Territory gate lives on EmpireLayer and only this layer
        // knows to push it there).
        this.unsubscribe = onOverlayChange(() => {
            this.applyTerritoryToggle();
            this.freight.syncRecording(); // [freightOverlay] toggling either on starts recording contracts
        });
        this.applyTerritoryToggle();
    }

    // [dw2overlays] begin
    /** Recompute the Potential Colonies / Scenic / Research marker sets (rings kept for habitats that stay). */
    private rebuildMarkers(): void {
        const galaxy = this.galaxy;
        const player = galaxy.playerEmpire;
        this.markersSig = player !== null ? colonyTargetSignature(galaxy, player) : null;
        const reveal = fogOf(galaxy).reveal;
        const explored = (h: Habitat): boolean => player === null || reveal || player.visibility.checkSystemExplored(h.systemIndex);
        const colonizable = player !== null ? player.colonizableHabitatTypesForEmpire() : [];
        const pc: Habitat[] = [];
        const sc: Habitat[] = [];
        const rs: Habitat[] = [];
        for (const h of galaxy.habitats) {
            if (h.category !== HabitatCategoryType.Planet && h.category !== HabitatCategoryType.Moon && h.category !== HabitatCategoryType.Star) continue;
            if (isPotentialColony(h, galaxy, colonizable)) pc.push(h);
            if (isScenicLocation(h) && explored(h)) sc.push(h);
            if (isResearchLocation(h) && explored(h)) rs.push(h);
        }
        this.potentialColonies = this.syncMarkers(this.potentialColonies, pc);
        this.scenicLocations = this.syncMarkers(this.scenicLocations, sc);
        this.researchLocations = this.syncMarkers(this.researchLocations, rs);
    }

    private syncMarkers(old: MarkerRing[], habitats: readonly Habitat[]): MarkerRing[] {
        const keep = new Map<Habitat, MarkerRing>();
        for (const m of old) keep.set(m.habitat, m);
        const out: MarkerRing[] = [];
        for (const h of habitats) {
            const m = keep.get(h);
            if (m !== undefined) {
                keep.delete(h);
                out.push(m);
            } else out.push(new MarkerRing(h, this.root));
        }
        for (const m of keep.values()) m.graphics.destroy();
        return out;
    }

    /** Twice a second while a marker overlay is on: rebuild when the player's knowledge changed. */
    private rebuildMarkersIfChanged(): void {
        const st = this.state;
        if (!st.potentialColonies && !st.scenicLocations && !st.researchLocations) return;
        if (this.markersFrame++ % 30 !== 0) return;
        const player = this.galaxy.playerEmpire;
        if (player === null) return;
        if (colonyTargetSignature(this.galaxy, player) !== this.markersSig) this.rebuildMarkers();
    }

    /** Hover text of an Improvements overlay mark under world (wx, wy) (nothing picked there), or null. */
    improvementsHitTest(wx: number, wy: number, z: number): string | null {
        return this.fuel.hitTest(wx, wy, z) ?? this.colonyScores.hitTest(wx, wy) ?? this.resources.hitTest(wx, wy);
    }

    /** Extra tooltip lines for a hovered habitat from the Improvements overlays that are on, or null. */
    habitatTooltipExtra(h: Habitat): string | null {
        const lines: string[] = [];
        const c = this.colonyScores.habitatTooltipExtra(h);
        if (c !== null) lines.push(c);
        const player = this.galaxy.playerEmpire;
        if (this.resources.root.visible && player !== null) {
            const index = knownResourceIndexFor(this.galaxy, player, fogOf(this.galaxy).reveal);
            const sys = index.bySystem.get(h.systemIndex);
            const name = (id: number): string => this.galaxy.resourceSystem.byId.get(id)?.name ?? `#${id}`;
            const star = sys?.star === h;
            const own = sys?.habitats.find((x) => x.habitat === h);
            if (sys !== undefined && star && 1 / this.lastZ >= 70) lines.push(resourceTooltipText('Known resources in the system:', sys.resources, name));
            else if (own !== undefined) lines.push(resourceTooltipText('Known resources:', own.resources, name));
        }
        return lines.length > 0 ? lines.join('\n') : null;
    }
    private lastZ = 1;
    // [dw2overlays] end

    private applyTerritoryToggle(): void {
        this.empireLayer.setTerritoryEnabled(this.state.empireTerritory);
    }

    private updateGroup(markers: MarkerRing[], enabled: boolean, z: number, cam: Camera, skip: ReadonlyMap<Habitat, unknown> | null = null): void {
        for (const m of markers) {
            if (!enabled) {
                m.graphics.visible = false;
                continue;
            }
            const h = m.habitat;
            // [dw2overlays] a habitat the Colony Target Scores overlay rings in its heat colour.
            if (skip !== null && skip.has(h)) {
                m.graphics.visible = false;
                continue;
            }
            const halfW = cam.width / (2 * z) + 200 / z;
            const halfH = cam.height / (2 * z) + 200 / z;
            // Around the drawn (render-interpolated orbit) body, else its committed position.
            let hx = h.xpos;
            let hy = h.ypos;
            if (this.motion !== null) {
                const hp = this.motion.habitatPos(h);
                hx = hp.x;
                hy = hp.y;
            }
            if (hx < cam.x - halfW || hx > cam.x + halfW || hy < cam.y - halfH || hy > cam.y + halfH) {
                m.graphics.visible = false;
                continue;
            }
            const r = drawnPx(h, z) / 2 + 8 / z;
            // Geometry around (0, 0), rebuilt only on a radius / width change; moved to the body each frame.
            if (m.key.changed(r, 4 / z)) {
                m.graphics.clear();
                circleAtScreenRes(m.graphics, 0, 0, r, z).stroke({ width: 4 / z, color: OVERLAY_MARKER_COLOR, alpha: 1 });
            }
            m.graphics.position.set(hx, hy);
            m.graphics.visible = true;
        }
    }

    /** Per-frame update. Markers share the system/planet-zoom gate
     * empireLayer.ts's colony rings use (factor < 70 = MainView.pick's
     * system-zoom threshold): that's when habitats draw individually. */
    update(z: number, cam: Camera): void {
        const atSystemZoom = 1 / z < 70;
        this.lastZ = z; // [dw2overlays]
        // [dw2overlays] begin — the Improvements overlays (the colony scores first: Potential Colonies defers to them).
        this.rebuildMarkersIfChanged();
        this.colonyScores.motion = this.motion;
        this.runOverlay('Colony Target Scores', COLONY_SCORE_KEYS, () => this.colonyScores.update(z, cam));
        this.resources.motion = this.motion;
        this.runOverlay('Resources', RESOURCE_KEYS, () => this.resources.update(z, cam));
        this.fuel.motion = this.motion;
        this.fuel.getSelection = this.getSelection;
        this.runOverlay('Fuel Range', FUEL_KEYS, () => this.fuel.update(z, cam));
        // [dw2overlays] end
        this.updateGroup(this.potentialColonies, atSystemZoom && this.state.potentialColonies, z, cam, this.colonyScores.active?.byHabitat ?? null);
        this.updateGroup(this.scenicLocations, atSystemZoom && this.state.scenicLocations, z, cam);
        this.updateGroup(this.researchLocations, atSystemZoom && this.state.researchLocations, z, cam);
        const f = 1 / z;
        // MainView.cs 1538: method_250 (everything below but the scanner discs) runs above minZoomLevelForWeaponsCircles.
        const overlays = f > WEAPON_CIRCLES_MIN_FACTOR;
        this.updateScanners(z, cam);
        this.updatePostures(z, cam, overlays);
        this.arrowCount = 0;
        this.refreshSpecialHighlight();
        this.updateEventPings(z, cam, overlays);
        this.updateTravelVectors(z, cam, overlays);
        this.updateSelectedVector(z, cam);
        this.updateRangeCircles(z, overlays);
        this.freight.motion = this.motion; // [freightOverlay] leaders follow the drawn freighters
        this.runOverlay('Trade Flows', FREIGHT_KEYS, () => this.freight.update(z, cam)); // [freightOverlay]
        this.updateThreats(z);
        this.updateScenarioMarkers(z);
        this.updateWrecks(z); // [wreckage]
        this.supply.motion = this.motion; // [improvements] supplyChain
        this.runOverlay('Supply Shortages', SUPPLY_KEYS, () => this.supply.update(z, cam));
    }

    /** Overlays that threw and were switched off (runOverlay); retried when the player turns one back on. */
    private failedOverlays = new Set<string>();

    /**
     * Run one optional (Improvements) overlay's per-frame update so that a throw cannot take the frame down: the rest of
     * the Main View update would be skipped every frame (MainView.update runs after it), leaving the map stale or
     * blank. The overlay is switched off (its toggles cleared, then one more update so it hides what it drew), the
     * error logged and a toast shown once; turning it back on retries it.
     */
    private runOverlay(name: string, keys: readonly OverlayKey[], fn: () => void): void {
        if (this.failedOverlays.has(name)) {
            if (!keys.some((k) => this.state[k])) return;
            this.failedOverlays.delete(name);
        }
        try {
            fn();
        } catch (err) {
            this.failedOverlays.add(name);
            console.error(`${name} overlay failed and was turned off:`, err);
            for (const k of keys) setOverlay(this.state, k, false);
            try {
                fn();
            } catch {
                /* it could not even hide itself: it stays skipped until turned back on */
            }
            overlayErrorNotifier?.(`${name} overlay failed and was turned off — see console`);
        }
    }

    /** Scenario markers (src/sim/scenario/mapFeatures.ts): a double ring with a pennant, re-queried 4 times a second. */
    private readonly scenarioSig = new DrawSig();
    private readonly wreckSig = new DrawSig();
    private readonly threatSig = new DrawSig();
    private updateScenarioMarkers(z: number): void {
        const g = this.scenarioMarkers;
        if (this.galaxy.scenario === null) {
            if (g.visible) {
                g.clear();
                g.visible = false;
            }
            this.scenarioSig.reset();
            return;
        }
        if (this.scenarioFrame++ % 15 === 0) this.scenarioMarkerList = scenarioMapFeatures(this.galaxy, this.galaxy.playerEmpire).markers;
        if (this.scenarioMarkerList.length === 0) {
            if (g.visible) g.clear();
            this.scenarioSig.reset();
            g.visible = false;
            return;
        }
        // Rebuilt only when a marker or the zoom changed (the list is re-queried 4 times a second).
        const k = this.scenarioSig;
        k.begin();
        k.push(z);
        for (const m of this.scenarioMarkerList) k.push4(m.x, m.y, m.color, 0);
        if (!k.changed()) {
            g.visible = true;
            return;
        }
        g.clear();
        for (const m of this.scenarioMarkerList) {
            const r = 12 / z;
            circleAtScreenRes(g, m.x, m.y, r, z).stroke({ width: 2 / z, color: m.color, alpha: 1 });
            circleAtScreenRes(g, m.x, m.y, r + 5 / z, z).stroke({ width: 1 / z, color: m.color, alpha: 0.5 });
            g.moveTo(m.x, m.y - r).lineTo(m.x, m.y - r - 14 / z).lineTo(m.x + 9 / z, m.y - r - 10 / z).lineTo(m.x, m.y - r - 6 / z).stroke({ width: 2 / z, color: m.color, alpha: 1 });
        }
        g.visible = true;
    }

    // [wreckage] begin
    /** Wreck Fields overlay (scenario 19e-7): a rust ring around every debris field the player knows, at every zoom; the
     * list is re-read twice a second. */
    private updateWrecks(z: number): void {
        const g = this.wrecks;
        const player = this.galaxy.playerEmpire;
        if (!this.state.wrecks || player === null || this.galaxy.scenario === null) {
            if (g.visible) {
                g.clear();
                g.visible = false;
            }
            this.wreckSig.reset();
            return;
        }
        if (this.wreckFrame++ % 30 === 0) this.wreckList = visibleWreckFields(this.galaxy, player);
        if (this.wreckList.length === 0) {
            if (g.visible) g.clear();
            this.wreckSig.reset();
            g.visible = false;
            return;
        }
        // Rebuilt only when a ring or the zoom changed (the list is re-read twice a second).
        const marks = this.wreckList.map((f) => wreckMarker(f, z));
        const k = this.wreckSig;
        k.begin();
        k.push(z);
        for (const m of marks) k.push4(m.x, m.y, m.r, 0);
        if (!k.changed()) {
            g.visible = true;
            return;
        }
        g.clear();
        for (const m of marks) {
            circleAtScreenRes(g, m.x, m.y, m.r, z).stroke({ width: 2 / z, color: WRECK_MARKER_COLOR, alpha: 0.9 });
            const c = 5 / z;
            g.moveTo(m.x - c, m.y - c).lineTo(m.x + c, m.y + c).moveTo(m.x + c, m.y - c).lineTo(m.x - c, m.y + c).stroke({ width: 2 / z, color: WRECK_MARKER_COLOR, alpha: 0.9 });
        }
        g.visible = true;
    }

    /** The known wreck field under a world point (hover tooltip), or null. */
    wreckHitTest(x: number, y: number, z: number): WreckField | null {
        if (!this.state.wrecks) return null;
        return wreckFieldHit(this.galaxy, this.galaxy.playerEmpire, x, y, z);
    }
    // [wreckage] end

    /** Threats overlay: every scenario threat site / carrier the player knows (level ≥ 2), at every zoom. The selector
     * is re-read twice a second; the markers follow moving ships every frame. */
    private updateThreats(z: number): void {
        const g = this.threats;
        const player = this.galaxy.playerEmpire;
        if (!this.state.threats || player === null || this.galaxy.scenario === null) {
            if (g.visible) {
                g.clear();
                g.visible = false;
            }
            this.threatSig.reset();
            return;
        }
        if (this.threatFrame++ % 30 === 0) this.threatSites = threatKnownSites(this.galaxy, player);
        if (this.threatSites.length === 0) {
            if (g.visible) g.clear();
            this.threatSig.reset();
            g.visible = false;
            return;
        }
        // The markers follow moving carriers: rebuilt only when one moved (or the zoom / list changed).
        const marks = this.threatSites.map((site) => threatMarker(site, z));
        const k = this.threatSig;
        k.begin();
        k.push(z);
        for (const m of marks) k.push4(m.kind, m.x, m.y, m.r), k.push(m.color);
        if (!k.changed()) {
            g.visible = true;
            return;
        }
        g.clear();
        for (const m of marks) {
            if (m.kind === 'ring') {
                circleAtScreenRes(g, m.x, m.y, m.r, z).stroke({ width: 3 / z, color: m.color, alpha: 1 });
                circleAtScreenRes(g, m.x, m.y, m.r + 5 / z, z).stroke({ width: 1 / z, color: m.color, alpha: 0.6 });
            } else {
                g.moveTo(m.x, m.y - m.r).lineTo(m.x + m.r, m.y).lineTo(m.x, m.y + m.r).lineTo(m.x - m.r, m.y).closePath().stroke({ width: 2 / z, color: m.color, alpha: 1 });
            }
        }
        g.visible = true;
    }

    /** A pooled arrowhead sprite (texture2D_35) at the end of a vector, tinted with the line colour. */
    private arrowCount = 0;
    private placeArrow(x1: number, y1: number, x2: number, y2: number, color: number, alpha: number, lineThickness: number, f: number): void {
        const tex = this.arrowTex;
        if (tex === null) return;
        const a = arrowheadPlacement(x1, y1, x2, y2, tex.width, tex.height, lineThickness, f);
        let sp = this.arrowheads.children[this.arrowCount] as Sprite | undefined;
        if (sp === undefined) {
            sp = new Sprite(tex);
            sp.anchor.set(0.5);
            this.arrowheads.addChild(sp);
        }
        sp.visible = true;
        sp.tint = color;
        sp.alpha = alpha;
        sp.position.set(a.x, a.y);
        sp.rotation = a.rotation;
        sp.scale.set(a.scale * f);
        this.arrowCount++;
    }

    /** XnaDrawingHelper.DrawLine(dashed: true): 6 px dashes and gaps. Returns false when shorter than one step (no
     * arrowhead then: the C# loop does not run). */
    /** updateTravelVectors' lines: target 0 = travelVectors, 1 = highlightVectors, 2 = incomingLines, 3 =
     * foreignSelVector. Recorded for the redraw; returns dashed()'s arrowhead test. */
    private readonly tvOps: number[] = [];
    private readonly tvSig = new DrawSig();
    private tvLine(target: number, x1: number, y1: number, x2: number, y2: number, f: number): boolean {
        this.tvOps.push(target, x1, y1, x2, y2);
        return Math.hypot(x2 - x1, y2 - y1) >= TRAVEL_VECTOR_DASH_PX * f;
    }

    private dashed(g: Graphics, x1: number, y1: number, x2: number, y2: number, f: number): boolean {
        const segs = dashSegments(x1, y1, x2, y2, TRAVEL_VECTOR_DASH_PX * f, TRAVEL_VECTOR_DASH_PX * f);
        for (const [ax, ay, bx, by] of segs) g.moveTo(ax, ay).lineTo(bx, by);
        return Math.hypot(x2 - x1, y2 - y1) >= TRAVEL_VECTOR_DASH_PX * f;
    }

    /** SpecialHighlightBuiltObjects: recomputed when the selected object changes (Main.Part10.cs 1323-1331, 1501). */
    private refreshSpecialHighlight(): void {
        const target = selectedStellarObject(this.getSelection());
        if (target === this.highlightFor) return;
        this.highlightFor = target;
        const player = this.galaxy.playerEmpire;
        this.highlights.setSpecialHighlight(player !== null && target !== null ? shipsMovingToDestination(player, target) : null);
    }

    /**
     * MainView.2.cs 5777-5783: the EventLocations pings (method_232, within method_250), each a yellow circle 3 px wide
     * growing from 1 to 101 px over 1.6 s and fading out over its second half, at the point it was added (the drawn
     * position of its ship / habitat at the first frame that draws it, mapHighlights.ts). Skipped more than 40 px off
     * screen. Wall clock (DateTime.Now).
     */
    private updateEventPings(z: number, cam: Camera, overlays: boolean): void {
        const g = this.eventPings;
        if (g.visible) g.clear();
        const now = performance.now() / 1000;
        const pings = this.highlights.eventLocations;
        if (!overlays) {
            g.visible = false;
            return; // method_250 did not run: dateTime_3 keeps its time
        }
        let any = false;
        const left = cam.x - cam.width / (2 * z);
        const top = cam.y - cam.height / (2 * z);
        for (const p of pings) {
            if (p.x === null || p.y === null) {
                const o = p.obj;
                const at = o instanceof BuiltObject ? this.drawnPos(o) : o instanceof Habitat ? (this.motion !== null ? this.motion.habitatPos(o) : { x: o.xpos, y: o.ypos }) : o;
                p.x = Math.trunc(at.x);
                p.y = Math.trunc(at.y);
            }
            // num / num2: (int)((x - viewLeft) / double_15).
            const sx = Math.trunc((p.x - left) * z);
            const sy = Math.trunc((p.y - top) * z);
            if (sx < -EVENT_PING_MARGIN_PX || sx > cam.width + EVENT_PING_MARGIN_PX || sy < -EVENT_PING_MARGIN_PX || sy > cam.height + EVENT_PING_MARGIN_PX) continue;
            const { radius, alpha } = this.pingClock.advance(now);
            // A negative num5 (the first frame after a gap wraps the phase below 0) is still a circle of |num5| px.
            segmentCircle(g, left + sx / z, top + sy / z, Math.abs(radius) / z, EVENT_PING_SIDES).stroke({ width: EVENT_PING_WIDTH_PX / z, color: EVENT_PING_COLOR, alpha: Math.max(0, alpha) / 255 });
            any = true;
        }
        this.pingClock.endFrame(now);
        g.visible = any;
    }

    /** Where `bo` is drawn this frame (renderInterp.ts drawnBuiltObjectPos), else its sim position. */
    private drawnPos(bo: BuiltObject): { x: number; y: number } {
        return this.motion !== null ? drawnBuiltObjectPos(this.motion, bo) : { x: bo.xpos, y: bo.ypos };
    }

    /**
     * Travel Vectors (State / Private) and method_258's fleet lines, redrawn every frame:
     * - the per-ship pass (method_250 5925-5956) for the player's non-fleet ships: 1 px grey, 2 px red when special-
     *   highlighted, only ships inside the view;
     * - at f > 150 the fleet pass (method_258): for every fleet the player sees, with State on, its lead ship's vector
     *   (yellow when selected), and — whatever the toggles — the red incoming-attack line.
     */
    private updateTravelVectors(z: number, cam: Camera, overlays: boolean): void {
        const g = this.travelVectors;
        const hg = this.highlightVectors;
        const ig = this.incomingLines;
        // The dashed lines are collected first (tvLine) and the four Graphics rebuilt only when that list changed:
        // clearing marks a Graphics for re-tessellation, and a paused game or fleets at rest draw the same lines again.
        const ops = this.tvOps;
        ops.length = 0;
        const player = this.galaxy.playerEmpire;
        const f = 1 / z;
        const halfW = cam.width / (2 * z);
        const halfH = cam.height / (2 * z);
        const inView = (x: number, y: number): boolean => !(x < cam.x - halfW || x > cam.x + halfW || y < cam.y - halfH || y > cam.y + halfH);
        let any = false;
        let anyHi = false;
        let anyIn = false;
        let anySel = false;
        const sg2 = this.foreignSelVector;
        // Travel Vectors only from the sector / galaxy zoom out (the original draws them in its galaxy pass); at system
        // zoom the lines from moving ships to their nearby targets squirm with every course correction.
        if (overlays && player !== null && f >= TRAVEL_VECTOR_MIN_FACTOR && (this.state.travelVectorsState || this.state.travelVectorsPrivate)) {
            const kinds: TravelVectorKind[] = [];
            if (this.state.travelVectorsState) kinds.push('state');
            if (this.state.travelVectorsPrivate) kinds.push('private');
            for (const kind of kinds) {
                for (const v of travelVectorsFor(this.galaxy, player, kind)) {
                    // Cull on the committed position first (cheap), then start at the drawn ship.
                    if (!inView(v.x1, v.y1)) continue;
                    const d = this.drawnPos(v.builtObject);
                    v.x1 = d.x;
                    v.y1 = d.y;
                    if (!inView(v.x1, v.y1) || !travelVectorLongEnough(v, f)) continue;
                    const hi = this.highlights.specialHighlight;
                    if (hi.size > 0 && hi.has(v.builtObject)) {
                        if (this.tvLine(1, v.x1, v.y1, v.x2, v.y2, f)) this.placeArrow(v.x1, v.y1, v.x2, v.y2, SPECIAL_HIGHLIGHT_VECTOR_COLOR, 1, SPECIAL_HIGHLIGHT_VECTOR_WIDTH, f);
                        anyHi = true;
                    } else {
                        if (this.tvLine(0, v.x1, v.y1, v.x2, v.y2, f)) this.placeArrow(v.x1, v.y1, v.x2, v.y2, TRAVEL_VECTOR_COLOR, 1, 1, f);
                        any = true;
                    }
                }
            }
        }
        if (overlays && player !== null && f > FLEET_PASS_MIN_FACTOR) {
            const now = performance.now();
            if (now - this.fleetsRefreshedAt >= 1000) {
                this.fleetsRefreshedAt = now;
                this.refreshVisibleFleets(player);
            }
            const sel = this.getSelection();
            const selGroup = sel?.shipGroup ?? null;
            const opts = getSettings();
            for (const sg of this.visibleFleets) {
                const lead = sg.leadShip;
                if (lead === null || lead.hasBeenDestroyed) continue;
                // method_250 6127-6160: the GalaxyViewDisplay options (beyond f = 3500) gate the whole method_258 call.
                if (f > 3500 && !opts.galaxyViewDisplayFleets && !(this.war.has(sg.empire) && opts.galaxyViewDisplayAlwaysEnemyFleets)) continue;
                if (!inView(lead.xpos, lead.ypos)) continue;
                const p = this.drawnPos(lead);
                const lx = p.x;
                const ly = p.y;
                if (!inView(lx, ly)) continue;
                if (this.state.travelVectorsState) {
                    const fv = fleetTravelVector(sg, sg === selGroup);
                    if (fv !== null) {
                        fv.v.x1 = lx;
                        fv.v.y1 = ly;
                        if (travelVectorLongEnough(fv.v, f)) {
                            if (fv.color === SELECTED_TRAVEL_VECTOR_COLOR && sg.empire === player) {
                                // The player's selected fleet: the selected-object vector (updateSelectedVector) draws the
                                // same yellow line (the C# draws both); one suffices.
                            } else if (fv.color === SELECTED_TRAVEL_VECTOR_COLOR) {
                                // Another empire's selected fleet: yellow, here only.
                                if (this.tvLine(3, lx, ly, fv.v.x2, fv.v.y2, f)) this.placeArrow(lx, ly, fv.v.x2, fv.v.y2, fv.color, 1, 1, f);
                                anySel = true;
                            } else {
                                if (this.tvLine(0, lx, ly, fv.v.x2, fv.v.y2, f)) this.placeArrow(lx, ly, fv.v.x2, fv.v.y2, fv.color, 1, 1, f);
                                any = true;
                            }
                        }
                    }
                }
                const t = incomingAttackLine(sg, player);
                if (t !== null) {
                    this.tvLine(2, lx, ly, t.x, t.y, f);
                    anyIn = true;
                }
            }
        }
        for (let i = this.arrowCount; i < this.arrowheads.children.length; i++) this.arrowheads.children[i].visible = false;
        this.arrowheads.visible = this.arrowCount > 0;
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
        const sig = this.tvSig;
        sig.begin();
        sig.push2(f, dpr);
        for (let i = 0; i < ops.length; i++) sig.push(ops[i]);
        if (sig.changed()) {
            const targets = [g, hg, ig, sg2];
            for (const t of targets) t.clear();
            for (let i = 0; i < ops.length; i += 5) this.dashed(targets[ops[i]], ops[i + 1], ops[i + 2], ops[i + 3], ops[i + 4], f);
            if (any) g.stroke({ width: f * travelVectorWidthPx(dpr), color: TRAVEL_VECTOR_COLOR, alpha: 1 });
            if (anyHi) hg.stroke({ width: f * SPECIAL_HIGHLIGHT_VECTOR_WIDTH, color: SPECIAL_HIGHLIGHT_VECTOR_COLOR, alpha: 1 });
            if (anySel) sg2.stroke({ width: f * travelVectorWidthPx(dpr), color: SELECTED_TRAVEL_VECTOR_COLOR, alpha: 1 });
            if (anyIn) ig.stroke({ width: f * INCOMING_ATTACK_WIDTH, color: INCOMING_ATTACK_COLOR, alpha: INCOMING_ATTACK_ALPHA });
        }
        sg2.visible = anySel;
        g.visible = any;
        hg.visible = anyHi;
        ig.visible = anyIn;
    }

    /** method_258 6340: the fleets of every empire the player can see (its own always). */
    private refreshVisibleFleets(player: Empire): void {
        const out: ShipGroup[] = [];
        // The player's own fleets first (method_258(empire)), then the other empires' (MainView.2.cs 6136-6158).
        const empires = [player, ...this.galaxy.empires.filter((e) => e !== null && e !== player)];
        for (const e of empires) {
            for (const sgU of (e as Empire).shipGroups) {
                const sg = sgU as ShipGroup | null;
                if (sg === null || sg.leadShip === null || sg.leadShip.hasBeenDestroyed) continue;
                if (sg.empire !== player && !isObjectVisibleToThisEmpire(this.galaxy, player, sg.leadShip, true, false)) continue;
                out.push(sg);
            }
        }
        this.visibleFleets = out;
        this.war = new Set(warEmpires(player.diplomaticRelations));
    }
    private war = new Set<Empire | null>();

    /**
     * Long Range Scanners (MainView.1.cs 4006-4058 / MainView.2.cs 277-322): the white discs, composited at 13 %, with
     * the backdrop's fade, at f > 70.
     */
    private updateScanners(z: number, cam: Camera): void {
        const player = this.galaxy.playerEmpire;
        const fade = scannerLayerFade(1 / z);
        const tex = this.lrsTex;
        if (!this.state.longRangeScanners || player === null || fade <= 0 || tex === null) {
            this.lrsLayer.visible = false;
            return;
        }
        let n = 0;
        // method_123(method_125(), 2): the view rectangle doubled.
        const halfW = cam.width / z;
        const halfH = cam.height / z;
        for (const d of longRangeScannerDiscs(player)) {
            if (d.x + d.radius < cam.x - halfW || d.x - d.radius > cam.x + halfW || d.y + d.radius < cam.y - halfH || d.y - d.radius > cam.y + halfH) continue;
            let sp = this.lrsSprites[n];
            if (sp === undefined) {
                sp = new Sprite(tex);
                sp.anchor.set(0.5);
                this.lrsSprites.push(sp);
                this.lrsLayer.addChild(sp);
            }
            sp.texture = tex;
            sp.visible = true;
            sp.position.set(d.x, d.y);
            sp.scale.set((2 * d.radius) / (tex.width || 1), (2 * d.radius) / (tex.height || 1));
            n++;
        }
        for (let i = n; i < this.lrsSprites.length; i++) this.lrsSprites[i].visible = false;
        const a = LRS_LAYER_ALPHA * fade;
        if (this.lrsFilter === null) {
            this.lrsFilter = new ColorMatrixFilter();
            this.lrsLayer.filters = [this.lrsFilter];
        }
        if (this.lrsFilter.matrix[18] !== a) this.lrsFilter.matrix = [0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, a, 0];
        this.lrsLayer.visible = n > 0;
    }

    /** Fleet Postures (MainView.2.cs 3921 method_247): the player's fleets' attack / defend discs and gather lines. */
    private updatePostures(z: number, cam: Camera, overlays: boolean): void {
        const g = this.postureLines;
        const player = this.galaxy.playerEmpire;
        const tex = this.lrsTex;
        if (!overlays || !this.state.fleetPostures || player === null) {
            if (g.visible) g.clear();
            this.postureSig.reset();
            this.postureDiscs.visible = false;
            this.postureArrows.visible = false;
            g.visible = false;
            return;
        }
        const f = 1 / z;
        const halfW = cam.width / (2 * z);
        const halfH = cam.height / (2 * z);
        let n = 0;
        let arrows = 0;
        let any = false;
        // The lines' Graphics is rebuilt only when what it draws (the zoom, each drawn disc's rim and gather line)
        // changed: the marks sit at fixed points, so most frames redraw nothing. Sprites are placed every frame.
        const sig = this.postureSig;
        sig.begin();
        sig.push(f);
        const marks = fleetPostureMarks(player);
        for (const m of marks) {
            const r = m.radius;
            if (r > 0 && m.x + r > cam.x - halfW && m.x - r < cam.x + halfW && m.y + r > cam.y - halfH && m.y - r < cam.y + halfH) {
                if (tex !== null) {
                    let sp = this.postureSprites[n];
                    if (sp === undefined) {
                        sp = new Sprite(tex);
                        sp.anchor.set(0.5);
                        this.postureSprites.push(sp);
                        this.postureDiscs.addChild(sp);
                    }
                    sp.texture = tex;
                    sp.visible = true;
                    sp.position.set(m.x, m.y);
                    sp.scale.set((2 * r) / (tex.width || 1), (2 * r) / (tex.height || 1));
                    sp.tint = m.color;
                    sp.alpha = POSTURE_ALPHA;
                    n++;
                }
                sig.push4(0, m.x, m.y, r);
                sig.push(m.color);
                any = true;
            }
            if (m.from !== null) {
                // DrawLine(gather → attack, color, 3, dashed, texture2D_35): the arrowhead when at least one dash step long.
                if (Math.hypot(m.x - m.from.x, m.y - m.from.y) >= TRAVEL_VECTOR_DASH_PX * f && this.arrowTex !== null) {
                    const at = this.arrowTex;
                    const a = arrowheadPlacement(m.from.x, m.from.y, m.x, m.y, at.width, at.height, POSTURE_LINE_WIDTH_PX, f);
                    let sp = this.postureArrows.children[arrows] as Sprite | undefined;
                    if (sp === undefined) {
                        sp = new Sprite(at);
                        sp.anchor.set(0.5);
                        this.postureArrows.addChild(sp);
                    }
                    sp.visible = true;
                    sp.tint = m.color;
                    sp.alpha = POSTURE_ALPHA;
                    sp.position.set(a.x, a.y);
                    sp.rotation = a.rotation;
                    sp.scale.set(a.scale * f);
                    arrows++;
                }
                sig.push4(1, m.from.x, m.from.y, m.x);
                sig.push2(m.y, m.color);
                any = true;
            }
        }
        if (sig.changed()) {
            g.clear();
            for (const m of marks) {
                const r = m.radius;
                if (r > 0 && m.x + r > cam.x - halfW && m.x - r < cam.x + halfW && m.y + r > cam.y - halfH && m.y - r < cam.y + halfH) {
                    // XnaDrawingHelper.DrawCircle(rect, 100 segments, color, 1).
                    segmentCircle(g, m.x, m.y, r, 100).stroke({ width: f, color: m.color, alpha: POSTURE_ALPHA });
                }
                if (m.from !== null) {
                    this.dashed(g, m.from.x, m.from.y, m.x, m.y, f);
                    g.stroke({ width: POSTURE_LINE_WIDTH_PX * f, color: m.color, alpha: POSTURE_ALPHA });
                }
            }
        }
        for (let i = n; i < this.postureSprites.length; i++) this.postureSprites[i].visible = false;
        for (let i = arrows; i < this.postureArrows.children.length; i++) this.postureArrows.children[i].visible = false;
        this.postureDiscs.visible = n > 0;
        this.postureArrows.visible = arrows > 0;
        g.visible = any;
    }
    private readonly postureSig = new DrawSig();

    /**
     * BaconMain.cs 442 DrawWeaponRanges (opt-in: the showWeaponRangeCircles setting, or `?rangeCircles=1`) around the
     * selected ship's drawn position and 404 DrawGravityWellRange around its nearest star (useStarGravityWells).
     */
    private updateRangeCircles(z: number, overlays: boolean): void {
        const wg = this.weaponCircles;
        const gg = this.gravityRing;
        let weaponsShown = false;
        let ringShown = false;
        const sel = overlays ? this.getSelection() : null;
        const f = 1 / z;
        if (overlays && weaponCirclesEnabled() && sel !== null && sel.builtObject !== undefined && sel.shipGroup === undefined && sel.builtObjects === undefined) {
            const bo = sel.builtObject;
            if (!bo.hasBeenDestroyed) {
                const circles = weaponRangeCircles(bo as unknown as Parameters<typeof weaponRangeCircles>[0], f);
                if (circles.length > 0) {
                    const p = this.drawnPos(bo);
                    // Drawn around (0, 0) and moved there: galaxy coordinates run to millions (float32 vertices). So
                    // the geometry is rebuilt only when the circles or the zoom change, not as the ship moves.
                    wg.position.set(p.x, p.y);
                    const k = this.weaponCirclesSig;
                    k.begin();
                    k.push(z);
                    for (const c of circles) k.push4(c.radius, c.color, c.dashed, 0);
                    if (k.changed()) {
                        wg.clear();
                        for (const c of circles) {
                            drawRangeCircle(wg, 0, 0, c, z);
                            wg.stroke({ width: f, color: c.color, alpha: 1 });
                        }
                    }
                    weaponsShown = true;
                }
            }
        }
        const ring = overlays ? gravityWellRing(sel, this.galaxy.playerEmpire) : null;
        if (ring !== null) {
            gg.position.set(ring.star.xpos, ring.star.ypos);
            if (this.gravityRingKey.changed(ring.radius, z)) {
                gg.clear();
                drawRangeCircle(gg, 0, 0, { radius: ring.radius, color: 0x0000ff, dashed: true }, z);
                gg.stroke({ width: f, color: 0x0000ff, alpha: 1 });
            }
            ringShown = true;
        }
        // Hidden ones are cleared once (and their keys forgotten), not every frame.
        if (!weaponsShown && wg.visible) {
            wg.clear();
            this.weaponCirclesSig.reset();
        }
        if (!ringShown && gg.visible) {
            gg.clear();
            this.gravityRingKey.reset();
        }
        wg.visible = weaponsShown;
        gg.visible = ringShown;
    }
    private readonly weaponCirclesSig = new DrawSig();
    private readonly gravityRingKey = new DrawKey();

    /**
     * The selected ship / fleet's yellow travel vector (MainView.2.cs method_250 selected-object block). Drawn from the
     * ship's drawn position, in Graphics coordinates relative to it (galaxy coordinates run to millions: float32
     * vertices would wobble at close zoom), with the dashes anchored at the far end and clipped to the view. A
     * gravity-well exit waypoint (TravelVector.x3) gets a second, fainter leg on to the destination, which takes the
     * arrowhead.
     */
    private readonly selVectorSig = new DrawSig();
    private updateSelectedVector(z: number, cam: Camera): void {
        const g = this.selVector;
        const f = 1 / z;
        const v = selectedTravelVectorFor(this.getSelection(), this.galaxy.playerEmpire, f);
        if (v === null) {
            if (g.visible) {
                g.clear();
                g.visible = false;
            }
            this.selVectorSig.reset();
            if (this.selArrow !== null) this.selArrow.visible = false;
            return;
        }
        const d = this.drawnPos(v.builtObject);
        v.x1 = d.x;
        v.y1 = d.y;
        g.position.set(d.x, d.y);
        const pad = 64 * f;
        const halfW = cam.width / (2 * z) + pad;
        const halfH = cam.height / (2 * z) + pad;
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
        const twoLegs = v.x3 !== undefined && v.y3 !== undefined;
        // Rebuilt only when an end, the view's clip rectangle or the zoom changed (a ship at rest under a still camera,
        // or a paused game, draws the same dashes).
        const k = this.selVectorSig;
        k.begin();
        k.push4(d.x, d.y, v.x2, v.y2);
        k.push4(twoLegs ? v.x3 : 0, twoLegs ? v.y3 : 0, f, dpr);
        k.push4(cam.x, cam.y, halfW, halfH);
        k.push(twoLegs);
        if (k.changed()) {
            g.clear();
            const clip = { x0: cam.x - halfW, y0: cam.y - halfH, x1: cam.x + halfW, y1: cam.y + halfH };
            const dash = TRAVEL_VECTOR_DASH_PX * f;
            const width = f * travelVectorWidthPx(dpr);
            const leg = (ax: number, ay: number, bx: number, by: number, alpha: number): void => {
                const segs = anchoredDashSegments(ax, ay, bx, by, dash, dash, clip, d.x, d.y);
                if (segs.length === 0) return;
                for (const [sx, sy, ex, ey] of segs) g.moveTo(sx, sy).lineTo(ex, ey);
                g.stroke({ width, color: SELECTED_TRAVEL_VECTOR_COLOR, alpha });
            };
            leg(v.x1, v.y1, v.x2, v.y2, 1);
            if (twoLegs) leg(v.x2, v.y2, v.x3!, v.y3!, SELECTED_TRAVEL_VECTOR_ONWARD_ALPHA);
        }
        g.visible = true;
        const tex = this.arrowTex;
        if (tex !== null) {
            if (this.selArrow === null) {
                this.selArrow = new Sprite(tex);
                this.selArrow.anchor.set(0.5);
                this.selArrow.tint = SELECTED_TRAVEL_VECTOR_COLOR;
                this.root.addChild(this.selArrow);
            }
            const a = twoLegs ? arrowheadPlacement(v.x2, v.y2, v.x3!, v.y3!, tex.width, tex.height, 1, f) : arrowheadPlacement(v.x1, v.y1, v.x2, v.y2, tex.width, tex.height, 1, f);
            this.selArrow.visible = true;
            this.selArrow.alpha = twoLegs ? SELECTED_TRAVEL_VECTOR_ONWARD_ALPHA : 1;
            this.selArrow.position.set(a.x, a.y);
            this.selArrow.rotation = a.rotation;
            this.selArrow.scale.set(a.scale * f);
        } else if (this.selArrow !== null) {
            this.selArrow.visible = false;
        }
    }

    /** Drop the overlay-change subscription (tests / view teardown). */
    destroy(): void {
        this.lrsLayer.destroy({ children: true });
        this.unsubscribe();
        this.freight.destroy(); // [freightOverlay]
        this.supply.destroy(); // [improvements] supplyChain
        this.fuel.destroy(); // [dw2overlays]
    }
}
