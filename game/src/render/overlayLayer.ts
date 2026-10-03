// Task M3 — render three of the nine "Overlays" HUD toggles
// (src/ui/mapOverlays.ts) against real sim data. The others (Fleet
// Postures, Long Range Scanners, Fade civilian ships) need ship state
// this renderer has not ported yet; their click handler in src/ui/hud.ts
// just keeps the toggle state and leaves a
// `// TODO(overlay): needs ships (M3)` note — no rendering happens here for
// them.
//
// Travel Vectors (task 14c): port of MainView.2.cs method_250 per-ship pass +
// BaconMainView.cs method_253; see travelVectorsFor.
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

import { circleAtScreenRes } from './screenCircle';
import type { MotionInterpolator } from './renderInterp';
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Camera } from './camera';
import type { Galaxy } from '../sim/galaxy';
import { HabitatCategoryType, type Habitat } from '../sim/types';
import { onOverlayChange, type MapOverlayState } from '../ui/mapOverlays';
import type { EmpireLayer } from './empireLayer';
import { moonDotPx, planetSpritePx, starSpritePx } from './mainView';
import type { BuiltObject } from '../sim/builtObject';
import type { Empire } from '../sim/empire';
import type { ShipGroup } from '../sim/fleets/shipGroup';
import { builtObjectMission } from '../sim/missions/mission';
import { BuiltObjectRole } from '../sim/data/designSpecifications';
import { DrawKey } from './drawCache';
import { FreightOverlay } from './freightOverlay'; // [freightOverlay]
import { threatKnownSites, type KnownThreatSite } from '../sim/scenario/threats/framework';
import { scenarioMapFeatures, type ScenarioMapMarker } from '../sim/scenario/mapFeatures';
import { WRECK_MARKER_COLOR, visibleWreckFields, wreckFieldHit, wreckMarker } from '../ui/scenario/wreckageUi'; // [wreckage]
import type { WreckField } from '../sim/scenario/wreckage/common'; // [wreckage]

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
export function isPotentialColony(h: Habitat, galaxy: Galaxy): boolean {
    const empire = galaxy.playerEmpire;
    if (empire === null) return false;
    if (h.category !== HabitatCategoryType.Planet && h.category !== HabitatCategoryType.Moon) return false;
    const owner = h.owner ?? h.empire;
    if (owner !== null && owner !== undefined && owner !== galaxy.independentEmpire) return false;
    if (!empire.visibility.checkSystemExplored(h.systemIndex)) return false;
    if (!empire.colonizableHabitatTypesForEmpire().includes(h.type)) return false;
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
}

// Port of BaconDistantWorlds/BaconMainView.cs method_253 guard + target
// (without the ShipGroup clause; travelVectorsFor handles fleets).
export function travelVectorFor(bo: BuiltObject): TravelVector | null {
    if (bo.hasBeenDestroyed) return null;
    if (bo.role === BuiltObjectRole.Base) return null;
    if (bo.topSpeed <= 0) return null;
    if (bo.warpSpeed <= 0) return null;
    if (bo.currentSpeed <= bo.topSpeed && !bo.hyperjumpPrepare) return null;
    const m = builtObjectMission(bo.mission);
    if (m === null) return null;
    if (m.type === 0) return null; // BuiltObjectMissionType.Undefined
    let p = m.resolveTargetCoordinatesCurrentCommand();
    if (p.x === 0 && p.y === 0) {
        // Point.IsEmpty
        if (bo.parentBuiltObject !== null) {
            p = { x: Math.trunc(bo.parentBuiltObject.xpos), y: Math.trunc(bo.parentBuiltObject.ypos) };
        } else if (bo.parentHabitat !== null) {
            p = { x: Math.trunc(bo.parentHabitat.xpos), y: Math.trunc(bo.parentHabitat.ypos) };
        }
    }
    return { builtObject: bo, x1: bo.xpos, y1: bo.ypos, x2: p.x, y2: p.y };
}

/** MainView.2.cs method_250 6037-6053 (drawn at zoom factor > BaconMain.minZoomLevelForWeaponsCircles = 0.9): the selected
 * ship — or the selected fleet's lead ship — gets its travel vector in yellow whatever the Travel Vectors toggles say,
 * when it is not a base and belongs to the viewing empire; the same moving / mission / length guards as every other
 * vector (BaconMainView.method_253 with bool_13 true, so a fleet member selected alone is not excluded). */
export const SELECTED_TRAVEL_VECTOR_COLOR = 0xffff00;
export const SELECTED_TRAVEL_VECTOR_MIN_FACTOR = 0.9;
export type SelectedObjectLike = { builtObject?: BuiltObject; shipGroup?: ShipGroup } | null;
export function selectedTravelVectorFor(sel: SelectedObjectLike, player: Empire | null, f: number): TravelVector | null {
    if (sel === null || player === null || !(f > SELECTED_TRAVEL_VECTOR_MIN_FACTOR)) return null;
    const bo = (sel.shipGroup !== undefined ? sel.shipGroup.leadShip : sel.builtObject) ?? null;
    if (bo === null || bo.actualEmpire !== player) return null;
    const v = travelVectorFor(bo);
    return v !== null && travelVectorLongEnough(v, f) ? v : null;
}

// TODO(port): other empires' fleets (method_258 + IsObjectVisibleToThisEmpire), selected-fleet yellow, SpecialHighlightBuiltObjects red, arrow head (texture2D_35)
// Port of MainView.2.cs method_250 (5925-5956) travel-vector filter + method_258 (player fleets, State only)
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
        let include: boolean;
        if (group !== null && group !== undefined) {
            // method_258: fleet lead ships ignore Owner; other members are
            // skipped (method_253's ShipGroup clause).
            include = kind === 'state' && group.leadShip === bo && group.empire === player;
        } else {
            include = bo.actualEmpire === player && (kind === 'private' ? bo.owner === null : bo.owner !== null);
        }
        if (!include) continue;
        const v = travelVectorFor(bo);
        if (v !== null) out.push(v);
    }
    return out;
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
    // [wreckage] begin — scenario 19e-7 wreck-field markers.
    private wrecks = new Graphics();
    private wreckList: WreckField[] = [];
    private wreckFrame = 0;
    // [wreckage] end

    constructor(
        private galaxy: Galaxy,
        world: Container,
        private empireLayer: EmpireLayer,
        private state: MapOverlayState,
    ) {
        world.addChild(this.root);
        this.root.addChild(this.travelVectors);
        this.root.addChild(this.arrowheads);
        this.root.addChild(this.selVector);
        if (typeof Image !== 'undefined') {
            const img = new Image();
            img.onload = () => {
                this.arrowTex = Texture.from(img);
            };
            img.src = ARROWHEAD_URL;
        }
        // [freightOverlay] begin
        this.freight = new FreightOverlay(galaxy, this.root, state);
        // [freightOverlay] end
        this.root.addChild(this.threats);
        this.root.addChild(this.scenarioMarkers);
        this.root.addChild(this.wrecks); // [wreckage]
        // Eligibility is computed once from the galaxy as built: nothing in
        // the current sim (no ship/colonization missions yet) changes
        // ownership, quality or exploration after createGame runs.
        // TODO(overlay): recompute when ships can colonize/explore (M3+).
        for (const h of galaxy.habitats) {
            if (
                h.category !== HabitatCategoryType.Planet &&
                h.category !== HabitatCategoryType.Moon &&
                h.category !== HabitatCategoryType.Star
            ) {
                continue;
            }
            if (isPotentialColony(h, galaxy)) this.potentialColonies.push(new MarkerRing(h, this.root));
            if (isScenicLocation(h)) this.scenicLocations.push(new MarkerRing(h, this.root));
            if (isResearchLocation(h)) this.researchLocations.push(new MarkerRing(h, this.root));
        }
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

    private applyTerritoryToggle(): void {
        this.empireLayer.setTerritoryEnabled(this.state.empireTerritory);
    }

    private updateGroup(markers: MarkerRing[], enabled: boolean, z: number, cam: Camera): void {
        for (const m of markers) {
            if (!enabled) {
                m.graphics.visible = false;
                continue;
            }
            const h = m.habitat;
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
        this.updateGroup(this.potentialColonies, atSystemZoom && this.state.potentialColonies, z, cam);
        this.updateGroup(this.scenicLocations, atSystemZoom && this.state.scenicLocations, z, cam);
        this.updateGroup(this.researchLocations, atSystemZoom && this.state.researchLocations, z, cam);
        this.updateTravelVectors(z, cam);
        this.updateSelectedVector(z);
        this.freight.motion = this.motion; // [freightOverlay] leaders follow the drawn freighters
        this.freight.update(z, cam); // [freightOverlay]
        this.updateThreats(z);
        this.updateScenarioMarkers(z);
        this.updateWrecks(z); // [wreckage]
    }

    /** Scenario markers (src/sim/scenario/mapFeatures.ts): a double ring with a pennant, re-queried 4 times a second. */
    private updateScenarioMarkers(z: number): void {
        const g = this.scenarioMarkers;
        if (this.galaxy.scenario === null) {
            if (g.visible) {
                g.clear();
                g.visible = false;
            }
            return;
        }
        if (this.scenarioFrame++ % 15 === 0) this.scenarioMarkerList = scenarioMapFeatures(this.galaxy, this.galaxy.playerEmpire).markers;
        g.clear();
        if (this.scenarioMarkerList.length === 0) {
            g.visible = false;
            return;
        }
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
            return;
        }
        if (this.wreckFrame++ % 30 === 0) this.wreckList = visibleWreckFields(this.galaxy, player);
        g.clear();
        if (this.wreckList.length === 0) {
            g.visible = false;
            return;
        }
        for (const f of this.wreckList) {
            const m = wreckMarker(f, z);
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
            return;
        }
        if (this.threatFrame++ % 30 === 0) this.threatSites = threatKnownSites(this.galaxy, player);
        g.clear();
        if (this.threatSites.length === 0) {
            g.visible = false;
            return;
        }
        for (const site of this.threatSites) {
            const m = threatMarker(site, z);
            if (m.kind === 'ring') {
                circleAtScreenRes(g, m.x, m.y, m.r, z).stroke({ width: 3 / z, color: m.color, alpha: 1 });
                circleAtScreenRes(g, m.x, m.y, m.r + 5 / z, z).stroke({ width: 1 / z, color: m.color, alpha: 0.6 });
            } else {
                g.moveTo(m.x, m.y - m.r).lineTo(m.x + m.r, m.y).lineTo(m.x, m.y + m.r).lineTo(m.x - m.r, m.y).closePath().stroke({ width: 2 / z, color: m.color, alpha: 1 });
            }
        }
        g.visible = true;
    }

    /** Travel Vectors (State / Private): dashed grey line from each of the
     * player's hyperspeed ships to its current command target, redrawn every
     * frame. MainView.2.cs method_250 draws above zoom factor 0.9 (always). */
    private updateTravelVectors(z: number, cam: Camera): void {
        const g = this.travelVectors;
        const player = this.galaxy.playerEmpire;
        if ((!this.state.travelVectorsState && !this.state.travelVectorsPrivate) || player === null) {
            // Off (the default): clear once, not every frame (clearing marks the geometry for a rebuild).
            if (g.visible) {
                g.clear();
                g.visible = false;
            }
            this.arrowheads.visible = false;
            return;
        }
        g.clear();
        let arrows = 0;
        const tex = this.arrowTex;
        const kinds: TravelVectorKind[] = [];
        if (this.state.travelVectorsState) kinds.push('state');
        if (this.state.travelVectorsPrivate) kinds.push('private');
        const f = 1 / z;
        const halfW = cam.width / (2 * z);
        const halfH = cam.height / (2 * z);
        for (const kind of kinds) {
            for (const v of travelVectorsFor(this.galaxy, player, kind)) {
                // Start at the drawn (render-interpolated) ship when BuiltObjectLayer drew it this frame.
                const d = this.motion !== null ? this.motion.drawn(v.builtObject) : null;
                if (d !== null) {
                    v.x1 = d.x;
                    v.y1 = d.y;
                }
                // MainView.2.cs: only ships inside the view get a vector.
                if (v.x1 < cam.x - halfW || v.x1 > cam.x + halfW || v.y1 < cam.y - halfH || v.y1 > cam.y + halfH) continue;
                if (!travelVectorLongEnough(v, f)) continue;
                for (const [ax, ay, bx, by] of dashSegments(v.x1, v.y1, v.x2, v.y2, TRAVEL_VECTOR_DASH_PX * f, TRAVEL_VECTOR_DASH_PX * f)) {
                    g.moveTo(ax, ay).lineTo(bx, by);
                }
                if (tex !== null) {
                    const a = arrowheadPlacement(v.x1, v.y1, v.x2, v.y2, tex.width, tex.height, 1, f);
                    let sp = this.arrowheads.children[arrows] as Sprite | undefined;
                    if (sp === undefined) {
                        sp = new Sprite(tex);
                        sp.anchor.set(0.5);
                        sp.tint = TRAVEL_VECTOR_COLOR;
                        this.arrowheads.addChild(sp);
                    }
                    sp.visible = true;
                    sp.position.set(a.x, a.y);
                    sp.rotation = a.rotation;
                    sp.scale.set(a.scale * f);
                    arrows++;
                }
            }
        }
        for (let i = arrows; i < this.arrowheads.children.length; i++) this.arrowheads.children[i].visible = false;
        this.arrowheads.visible = true;
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
        g.stroke({ width: f * travelVectorWidthPx(dpr), color: TRAVEL_VECTOR_COLOR, alpha: 1 });
        g.visible = true;
    }

    /** The selected ship / fleet's yellow travel vector (MainView.2.cs method_250 selected-object block). */
    private updateSelectedVector(z: number): void {
        const g = this.selVector;
        const f = 1 / z;
        const v = selectedTravelVectorFor(this.getSelection(), this.galaxy.playerEmpire, f);
        if (v === null) {
            if (g.visible) {
                g.clear();
                g.visible = false;
            }
            if (this.selArrow !== null) this.selArrow.visible = false;
            return;
        }
        const d = this.motion !== null ? this.motion.drawn(v.builtObject) : null;
        if (d !== null) {
            v.x1 = d.x;
            v.y1 = d.y;
        }
        g.clear();
        for (const [ax, ay, bx, by] of dashSegments(v.x1, v.y1, v.x2, v.y2, TRAVEL_VECTOR_DASH_PX * f, TRAVEL_VECTOR_DASH_PX * f)) {
            g.moveTo(ax, ay).lineTo(bx, by);
        }
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
        g.stroke({ width: f * travelVectorWidthPx(dpr), color: SELECTED_TRAVEL_VECTOR_COLOR, alpha: 1 });
        g.visible = true;
        const tex = this.arrowTex;
        if (tex !== null) {
            if (this.selArrow === null) {
                this.selArrow = new Sprite(tex);
                this.selArrow.anchor.set(0.5);
                this.selArrow.tint = SELECTED_TRAVEL_VECTOR_COLOR;
                this.root.addChild(this.selArrow);
            }
            const a = arrowheadPlacement(v.x1, v.y1, v.x2, v.y2, tex.width, tex.height, 1, f);
            this.selArrow.visible = true;
            this.selArrow.position.set(a.x, a.y);
            this.selArrow.rotation = a.rotation;
            this.selArrow.scale.set(a.scale * f);
        } else if (this.selArrow !== null) {
            this.selArrow.visible = false;
        }
    }

    /** Drop the overlay-change subscription (tests / view teardown). */
    destroy(): void {
        this.unsubscribe();
        this.freight.destroy(); // [freightOverlay]
    }
}
