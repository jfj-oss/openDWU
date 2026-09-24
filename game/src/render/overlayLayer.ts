// Task M3 — render three of the nine "Overlays" HUD toggles
// (src/ui/mapOverlays.ts) against real sim data. The other five (Fleet
// Postures, Travel Vectors State/Private, Long Range Scanners, Fade civilian
// ships) need ship state this renderer has not ported yet; their click
// handler in src/ui/hud.ts just keeps the toggle state and leaves a
// `// TODO(overlay): needs ships (M3)` note — no rendering happens here for
// them.
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

import { Container, Graphics } from 'pixi.js';
import type { Camera } from './camera';
import type { Galaxy } from '../sim/galaxy';
import { HabitatCategoryType, type Habitat } from '../sim/types';
import { onOverlayChange, type MapOverlayState } from '../ui/mapOverlays';
import type { EmpireLayer } from './empireLayer';
import { moonDotPx, planetSpritePx, starSpritePx } from './mainView';

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
    constructor(public habitat: Habitat, layer: Container) {
        this.graphics.visible = false;
        layer.addChild(this.graphics);
    }
}

export class OverlayLayer {
    /** World-space layer: marker rings live above everything else. */
    root = new Container();
    private potentialColonies: MarkerRing[] = [];
    private scenicLocations: MarkerRing[] = [];
    private researchLocations: MarkerRing[] = [];
    private unsubscribe: () => void;

    constructor(
        private galaxy: Galaxy,
        world: Container,
        private empireLayer: EmpireLayer,
        private state: MapOverlayState,
    ) {
        world.addChild(this.root);
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
        this.unsubscribe = onOverlayChange(() => this.applyTerritoryToggle());
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
            if (h.xpos < cam.x - halfW || h.xpos > cam.x + halfW || h.ypos < cam.y - halfH || h.ypos > cam.y + halfH) {
                m.graphics.visible = false;
                continue;
            }
            const r = drawnPx(h, z) / 2 + 8 / z;
            m.graphics.clear();
            m.graphics.circle(h.xpos, h.ypos, r).stroke({ width: 4 / z, color: OVERLAY_MARKER_COLOR, alpha: 1 });
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
    }

    /** Drop the overlay-change subscription (tests / view teardown). */
    destroy(): void {
        this.unsubscribe();
    }
}
