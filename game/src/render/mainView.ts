// Main View: one seamless continuous zoom from full galaxy to a single
// planet and back. Port of the original's MainView renderer
// (Controls/MainView.1.cs: PrepareGalaxyBackdrop ~line 3926,
// FadeGalaxyNebulae/FadeSectorBackground/FadeGalaxyBackground ~4111-4152;
// Main.Part11.cs zoom thresholds ~460-510, e.g. actualZoomFactor > 3.0 /
// > 10.0; Main.Part13.cs LoadMapStars ~line 993).
//
// The original expresses zoom as `actualZoomFactor` (1.0 = 100%, larger =
// more zoomed out); here `Camera.zoom` is its reciprocal (pixels per world
// unit). Layer crossfade windows below are expressed in that zoom.
//
// TODO(port): nebula-anchored gas-cloud placement / radiation fields —
// Galaxy.4.cs GenerateGasCloud.

import { Application, Container, Graphics, Sprite, Text, Texture, TilingSprite } from 'pixi.js';
import { Camera } from './camera';
import {
    AssetStore,
    BACKDROP_URLS,
    CLOUD_COLORS,
    PLANET_COLORS,
    STAR_COLORS,
    asteroidUrls,
    cloudUrls,
    coronaFrameIndex,
    coronaFrameUrls,
    makeBackdropTexture,
    makeCloudTexture,
    makeDotTexture,
    makeGlowTexture,
    makePlanetTexture,
    makeStarSpriteTexture,
    makeStarfieldTexture,
    mapStarUrls,
    planetUrls,
    sampleCentreColour,
    scaleColour,
    starDiscUrl,
    starSpriteUrls,
} from './assets';
import { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { GalaxyLocation, GalaxyLocationType } from '../sim/galaxyLocation';
import { Habitat, HabitatCategoryType, HabitatType, SystemInfo } from '../sim/types';
import { NebulaCloudGenerator } from './nebulaClouds';
import { EmpireLayer } from './empireLayer';
import { OverlayLayer } from './overlayLayer';
import { BuiltObjectLayer, BUILT_OBJECT_MAX_FACTOR } from './builtObjectLayer';
// [combatfx] begin
import { EffectsLayer } from './effectsLayer';
// [combatfx] end
import type { BuiltObject } from '../sim/builtObject';
import { createMapOverlayState, type MapOverlayState } from '../ui/mapOverlays';
import { showRegionLabels, showSystemNames } from '../ui/settings';
import { hideMapTooltip, showMapTooltip, tooltipText } from '../ui/mapTooltip';

export function fadeIn(v: number, a: number, b: number): number {
    if (v <= a) {
        return 0;
    }
    if (v >= b) {
        return 1;
    }
    const t = (v - a) / (b - a);
    return t * t * (3 - 2 * t);
}

// Task 08f3: every map Text uses this family so the labels fall back to
// sans-serif (not serif) when 'Forgotten Futurist' has not loaded yet.
export const MAP_FONT_FAMILY = 'Forgotten Futurist, sans-serif';

/**
 * Task 08f3: wait for the 'Forgotten Futurist' web font (declared via CSS
 * @font-face in hud.css) before building the Main View text layers, so the
 * region/system/planet labels rasterize in the real font instead of the
 * serif fallback. Both weights are requested because RegionLabel switches
 * fontWeight between normal and bold per zoom branch. Failures are caught
 * and ignored — the labels then use the sans-serif fallback.
 */
export async function loadMapFont(): Promise<void> {
    try {
        await document.fonts.load('16px "Forgotten Futurist"');
        await document.fonts.load('bold 16px "Forgotten Futurist"');
    } catch {
        // Font unavailable (e.g. no DW:U install): continue with the fallback.
    }
}

export function fadeOut(v: number, a: number, b: number): number {
    return 1 - fadeIn(v, a, b);
}

// Layer crossfade windows for the mid-zoom gap between the galaxy backdrop
// and the system layers (task 02b2). The backdrop fades out over
// [m*2.5, m*14] where m = minZoom (whole-galaxy zoom), so the starfield
// must start fading in where the backdrop starts fading out and be fully
// opaque by the time the backdrop is gone — otherwise the screen goes
// black at ~zoom factor 150.
export function backdropAlpha(z: number, m: number): number {
    return fadeOut(z, m * 2.5, m * 14);
}

export function starfieldAlpha(z: number, m: number): number {
    return fadeIn(z, m * 2.5, m * 14);
}

// Orbit rings appear once the outermost orbit spans >= ~40 px on screen
// (smoothed with a short fade-in window).
export function orbitRingAlpha(z: number, maxOrbitDistance: number): number {
    if (maxOrbitDistance <= 0) {
        return 0;
    }
    const zMin = 40 / maxOrbitDistance;
    return 0.5 * fadeIn(z, zMin, zMin * 2);
}

// Task 12p (Main.Part11.cs:487-505, MainView.1.cs:437-470/626-642,
// MainView.cs:2186-2191): on-screen body sizes at system zoom, in the
// original's zoom factor f = 1/z (px per world unit z, max 1). Planets and
// moons are drawn while f < 500 with a compressed zoom factor (divided by
// 1.25 / 1.1 above f = 10) and a minimum of 4 px (asteroids 1 px); stars
// use the plain factor with a minimum of 4 px and no cap. The galaxy-level
// map-star icon is D/f clamped to >= 10 px, plus 2 (MainView.2.cs:5465-5473).
export function planetZoomFactor(f: number): number {
    // Port of Main.Part11.cs CalculatePlanetZoomFactor.
    let result = f;
    if (f > 10.0) {
        result = Math.max(10.0, f / 1.25);
    }
    return result;
}

export function moonZoomFactor(f: number): number {
    // Port of Main.Part11.cs CalculateMoonZoomFactor.
    let result = f;
    if (f > 10.0) {
        result = Math.max(10.0, f / 1.1);
    }
    return result;
}

export function planetSpritePx(diameter: number, z: number): number {
    const f = 1 / z;
    return Math.max(4, Math.trunc(diameter / planetZoomFactor(f) + 1e-6));
}

export function moonDotPx(diameter: number, z: number): number {
    const f = 1 / z;
    return Math.max(4, Math.trunc(diameter / moonZoomFactor(f) + 1e-6));
}

export function starSpritePx(diameter: number, z: number): number {
    const f = 1 / z;
    return Math.max(4, Math.trunc(diameter / f + 1e-6));
}

export function starGalaxySpritePx(diameter: number, z: number): number {
    const f = 1 / z;
    return Math.max(10, Math.trunc(diameter / f + 1e-6)) + 2;
}

// Task 12p (MainView.cs:3027-3058 method_60 `result` column): the zoom
// factor below which the star is drawn as rotating discs + corona instead
// of its plain texture (default 100 for unlisted types).
export function starDiscMaxFactor(type: HabitatType): number {
    switch (type) {
        case HabitatType.MainSequence:
            return 60;
        case HabitatType.RedGiant:
        case HabitatType.SuperGiant:
            return 75;
        case HabitatType.WhiteDwarf:
            return 40;
        case HabitatType.Neutron:
            return 30;
        case HabitatType.BlackHole:
        case HabitatType.SuperNova:
            return 150;
        default:
            return 100;
    }
}

// Task 12p (MainView.1.cs:1814-1919 label rules): draw a habitat name while
// f < 500 — populated colonies always, planets only down to f < 10. Bases
// are not modelled (their flag ignored); the ruin marker (flag13) is skipped.
export function habitatLabelVisible(isPlanet: boolean, populated: boolean, f: number): boolean {
    return f < 500 && (populated || (isPlanet && f < 10));
}

// Task 12p (MainView.1.cs:2314-2338 method_84): TinyFont (11 px) at f >= 3,
// NormalFont (17 px) below — the GDI twin's 10.67/16.67 px rounded up.
export function habitatLabelFontSize(f: number): number {
    return f < 3 ? 17 : 11;
}

// Task 12p (method_84): empire main colour unless the habitat belongs to
// the independent empire (or none), then the default grey 0xa0a0a0
// (MainView.cs:1410 color_1 = FromArgb(255,160,160,160)).
export function habitatLabelColor(h: Habitat, independent: Empire | null): number {
    return h.empire !== null && h.empire !== independent ? h.empire.mainColor : 0xa0a0a0;
}

// Task 08g (Controls/MainView.cs mouse picking): pure hit-test over a list of
// candidate habitats. Each object's drawn on-screen rect is the square centred
// on its screen position with side `sizeFn(habitat, zoom)` px (the same size
// functions the renderer uses, incl. the min-pixel sizes). The point belongs
// to an object when |dx| <= size/2 && |dy| <= size/2; among several matches
// the smaller object wins (a moon in front of its planet, a planet in front
// of the star). Returns null for empty space.
export function hitTestHabitats(
    list: Habitat[],
    x: number,
    y: number,
    sizeFn: (h: Habitat, zoom: number) => number,
    zoom: number,
): Habitat | null {
    let best: Habitat | null = null;
    let bestSize = Infinity;
    for (const h of list) {
        const s = sizeFn(h, zoom);
        if (s <= 0) continue;
        const dx = Math.abs(x - h.xpos);
        const dy = Math.abs(y - h.ypos);
        if (dx > s / 2 || dy > s / 2) continue;
        if (s < bestSize) {
            bestSize = s;
            best = h;
        }
    }
    return best;
}

// Task 08f1 (MainView.2.cs 4675-4705): region/nebula location labels are
// drawn only while the original's zoom factor `double_15` satisfies
// 70 < double_15 <= double_5 (the full-galaxy factor, passed by the caller).
// The font depends on the location type and the factor:
//   NebulaCloud:  > 4000 -> font_2 (15.33 px regular)
//                 > 1000 -> font_0 (16.67 px regular)
//                 else   -> font_1 (18.67 px bold)
//   other types:  > 4000 -> font_3 (10.67 px regular)
//                 > 1000 -> font_2 (15.33 px regular)
//                 else   -> font_0 (16.67 px regular)
// Fonts (MainView.cs 624-627): font_0 = 16.67 px regular, font_1 = 18.67 px
// bold, font_2 = 15.33 px regular, font_3 = 10.67 px regular.
export function regionLabelFont(type: GalaxyLocationType, factor: number, maxFactor: number): { size: number; bold: boolean } | null {
    if (!(factor > 70 && factor <= maxFactor)) {
        return null;
    }
    if (type === GalaxyLocationType.NebulaCloud) {
        if (factor > 4000) {
            return { size: 15.33, bold: false };
        }
        if (factor > 1000) {
            return { size: 16.67, bold: false };
        }
        return { size: 18.67, bold: true };
    }
    if (factor > 4000) {
        return { size: 10.67, bold: false };
    }
    if (factor > 1000) {
        return { size: 15.33, bold: false };
    }
    return { size: 16.67, bold: false };
}

// Task 08f2 (Controls/MainView.cs FadeGalaxyNebulae ~4111-4152): the nebula
// cloud images are visible at galaxy/sector zoom and fade out as the sector
// starfield takes over — the same window the backdrop fades out over
// ([m*2.5, m*14], m = minZoom). At full-galaxy zoom they are fully opaque;
// they are gone by the time the dense starfield is opaque.
export function nebulaAlpha(z: number, m: number): number {
    return fadeOut(z, m * 2.5, m * 14);
}

function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
}

// Planet-type dots at mid zoom (assets.ts keeps the same palette).
const PLANET_DOT_TYPES = [
    HabitatType.Volcanic,
    HabitatType.Desert,
    HabitatType.MarshySwamp,
    HabitatType.Continental,
    HabitatType.Ocean,
    HabitatType.BarrenRock,
    HabitatType.Ice,
    HabitatType.GasGiant,
    HabitatType.FrozenGasGiant,
];

// Parallax factors of the near/far starfield layers (screen-space, tiled).
const FAR_PARALLAX = 0.12;
const NEAR_PARALLAX = 0.3;

function starColors(type: HabitatType): { glow: string; core: string } {
    return STAR_COLORS[type] ?? STAR_COLORS[HabitatType.MainSequence];
}

// ---------------------------------------------------------------------------

class PlanetView {
    habitat: Habitat;
    dot: Sprite;
    sprite: Sprite;
    label: Text;
    moons: MoonView[] = [];
    constructor(private system: SystemView, habitat: Habitat, dotTex: Texture) {
        this.habitat = habitat;
        this.dot = new Sprite(dotTex);
        this.dot.anchor.set(0.5);
        this.dot.visible = false;
        this.system.root.addChild(this.dot);
        this.sprite = new Sprite(makePlanetTexture(PLANET_COLORS[habitat.type] ?? '#888888'));
        this.sprite.anchor.set(0.5);
        this.sprite.visible = false;
        this.sprite.alpha = 0;
        this.system.root.addChild(this.sprite);
        // Task 12p (method_84): name centred on the drawn rect's right edge,
        // vertically centred on the body; 1 px black drop shadow (the XNA
        // offset is not recoverable from the C#).
        this.label = new Text({
            text: habitat.name,
            style: {
                fontSize: 11,
                fill: 0xa0a0a0,
                fontFamily: MAP_FONT_FAMILY,
                dropShadow: { color: 0x000000, distance: 1, blur: 0, alpha: 1, angle: Math.PI / 4 },
            },
        });
        this.label.anchor.set(0.5, 0.5);
        this.label.visible = false;
        this.system.root.addChild(this.label);
    }
}

class MoonView {
    habitat: Habitat;
    dot: Sprite;
    label: Text;
    constructor(private system: SystemView, habitat: Habitat, tex: Texture) {
        this.habitat = habitat;
        this.dot = new Sprite(tex);
        this.dot.anchor.set(0.5);
        this.dot.visible = false;
        this.system.root.addChild(this.dot);
        // Task 12p: moons are full planet-textured sprites at system zoom
        // (MainView.1.cs:437-470 draws them like planets, factor via
        // CalculateMoonZoomFactor), with the same label rules as planets.
        this.label = new Text({
            text: habitat.name,
            style: {
                fontSize: 11,
                fill: 0xa0a0a0,
                fontFamily: MAP_FONT_FAMILY,
                dropShadow: { color: 0x000000, distance: 1, blur: 0, alpha: 1, angle: Math.PI / 4 },
            },
        });
        this.label.anchor.set(0.5, 0.5);
        this.label.visible = false;
        this.system.root.addChild(this.label);
    }
}

class SystemView {
    system: SystemInfo;
    root: Container;
    mapIcon: Sprite;
    starSprite: Sprite;
    nameLabel: Text;
    ring: Graphics;
    planets: PlanetView[] = [];
    asteroids: Sprite[] = [];
    rockHabitats: Habitat[] = [];
    maxExtent = 0; // farthest orbit radius (culling margin)
    private lastRingZoom = -1;

    // Task 02c2: system-zoom star = two tinted counter-rotating discs plus an
    // animated corona (MainView.1.cs ~740-782). Built lazily on first entry to
    // the crossfade window; black holes keep the plain `starSprite` instead.
    private starDiscs: Container | null = null;
    private discA: Sprite | null = null;
    private discB: Sprite | null = null;
    private corona: Sprite | null = null;
    private coronaFrames: Texture[] = [];
    private coronaFps = 15;
    private coronaScale = 1.65;
    private discAngle = 0;

    constructor(private view: MainView, system: SystemInfo, textures: MainViewTextures) {
        this.system = system;
        const star = system.systemStar;
        this.root = new Container();
        this.root.x = star.xpos;
        this.root.y = star.ypos;
        this.root.visible = false;
        view.world.addChild(this.root);

        // Generated fallbacks; the original per-habitat art (pictureRef)
        // loads lazily in MainView.init and swaps the texture in.
        this.mapIcon = new Sprite(makeGlowTexture(starColors(star.type).glow, starColors(star.type).core));
        this.mapIcon.anchor.set(0.5);
        this.mapIcon.visible = false;
        this.root.addChild(this.mapIcon);

        this.starSprite = new Sprite(makeStarSpriteTexture(star.type));
        this.starSprite.anchor.set(0.5);
        this.starSprite.visible = false;
        this.starSprite.alpha = 0;
        this.root.addChild(this.starSprite);

        // Task 02c2: tinted rotating discs + corona for non-black-hole stars,
        // built lazily (see buildStarDiscs) so the corona frames are only
        // fetched once a star actually reaches system zoom.
        if (star.type !== HabitatType.BlackHole) {
            this.starDiscs = new Container();
            this.starDiscs.visible = false;
            this.starDiscs.alpha = 0;
            this.discA = new Sprite(Texture.EMPTY);
            this.discA.anchor.set(0.5);
            this.discB = new Sprite(Texture.EMPTY);
            this.discB.anchor.set(0.5);
            this.corona = new Sprite(Texture.EMPTY);
            this.corona.anchor.set(0.5);
            this.starDiscs.addChild(this.discA, this.discB, this.corona);
            this.root.addChild(this.starDiscs);
        }

        this.ring = new Graphics();
        this.root.addChild(this.ring);

        // Planets and their moons (orbit positions relative to the star).
        for (const habitat of system.habitats) {
            if (habitat.category === HabitatCategoryType.Planet) {
                const planet = new PlanetView(this, habitat, textures.dots.get(habitat.type) ?? textures.dot);
                this.planets.push(planet);
                for (const moon of system.habitats) {
                    if (moon.category === HabitatCategoryType.Moon && moon.parent === habitat) {
                        // Task 12p: moons render as planet-textured sprites, not dots.
                        planet.moons.push(new MoonView(this, moon, makePlanetTexture(PLANET_COLORS[moon.type] ?? '#888888')));
                    }
                }
                this.maxExtent = Math.max(this.maxExtent, habitat.orbitDistance + 3000);
            } else if (habitat.category === HabitatCategoryType.Asteroid) {
                const rock = new Sprite(textures.rock);
                rock.anchor.set(0.5);
                rock.x = Math.cos(habitat.orbitAngle) * habitat.orbitDistance;
                rock.y = Math.sin(habitat.orbitAngle) * habitat.orbitDistance;
                // Rock pixel size is world-linear (px = diameter*zoom*0.45),
                // so the counter-scale is zoom-independent.
                rock.scale.set((habitat.diameter * 0.45) / textures.rock.width);
                rock.visible = false;
                this.asteroids.push(rock);
                this.rockHabitats.push(habitat);
                this.root.addChild(rock);
                this.maxExtent = Math.max(this.maxExtent, habitat.orbitDistance + 3000);
            }
        }

        this.nameLabel = new Text({
            text: star.name,
            style: { fontSize: 11, fill: 0xffffff, fontFamily: MAP_FONT_FAMILY },
        });
        this.nameLabel.anchor.set(0.5, 0);
        this.nameLabel.visible = false;
        this.root.addChild(this.nameLabel);
    }

    /** Per-frame level-of-detail update (only for systems near the view). */
    update(zoom: number, cam: Camera, labelAllowed: boolean, dtSeconds: number): void {
        const star = this.system.systemStar;
        // Culling: screen-space margin plus the farthest orbit so rings
        // don't pop in at the screen edge.
        const margin = (300 + this.maxExtent * 0.3) / zoom;
        const halfW = cam.width / 2 + margin;
        const halfH = cam.height / 2 + margin;
        const visible =
            star.xpos > cam.x - halfW && star.xpos < cam.x + halfW && star.ypos > cam.y - halfH && star.ypos < cam.y + halfH;
        this.root.visible = visible;
        if (!visible) {
            return;
        }

        const z = zoom;
        // Task 12p (MainView.1.cs:735-785, MainView.2.cs:5465-5473): hard
        // bands on the original's zoom factor f = 1/z — no crossfade.
        //   f < discMax(type)      : rotating discs + corona (not BH/SN)
        //   BH and f < 150         : plain star sprite
        //   f < 150                : galaxy-level map-star icon
        //   f >= 150               : small map icon (iconPx)
        const f = 1 / z;
        const S = starSpritePx(star.diameter, z);
        const isBHOrSN = star.type === HabitatType.BlackHole || star.type === HabitatType.SuperNova;
        if (!isBHOrSN && f < starDiscMaxFactor(star.type)) {
            this.mapIcon.visible = false;
            this.starSprite.visible = false;
            this.updateStarDiscs(1, S, z, dtSeconds);
        } else if (star.type === HabitatType.BlackHole && f < 150) {
            this.mapIcon.visible = false;
            this.updateStarDiscs(0, S, z, dtSeconds);
            this.starSprite.visible = true;
            this.starSprite.alpha = 1;
            this.starSprite.scale.set(S / (this.starSprite.texture.width * z));
        } else if (f < 150) {
            this.updateStarDiscs(0, S, z, dtSeconds);
            this.starSprite.visible = false;
            this.mapIcon.visible = true;
            this.mapIcon.alpha = 1;
            const gpx = starGalaxySpritePx(star.diameter, z);
            this.mapIcon.scale.set(gpx / (this.mapIcon.texture.width * z));
        } else {
            this.updateStarDiscs(0, S, z, dtSeconds);
            this.starSprite.visible = false;
            this.mapIcon.visible = true;
            this.mapIcon.alpha = 1;
            const iconPx = clamp(star.diameter * z * 30, 2.5, 26);
            this.mapIcon.scale.set(iconPx / (this.mapIcon.texture.width * z));
        }

        // Faint circular orbit rings: visible from the zoom where the
        // outermost orbit spans >= ~40 px on screen (task 02b2), persist
        // through 100%.
        const ringA = orbitRingAlpha(z, this.maxExtent);
        this.ring.visible = ringA > 0.02;
        if (this.ring.visible) {
            this.ring.alpha = ringA;
            if (this.lastRingZoom < 0 || Math.abs(z / this.lastRingZoom - 1) > 0.05) {
                this.redrawRings(z);
                this.lastRingZoom = z;
            }
        }

        // Task 12p (MainView.1.cs:437-470): no dot crossfade — planet sprites are
        // drawn while f < 500 at their compressed-factor size; the name
        // label follows the original's populated/planet rules (method_84).
        for (const planet of this.planets) {
            const p = planet.habitat;
            const px = Math.cos(p.orbitAngle) * p.orbitDistance;
            const py = Math.sin(p.orbitAngle) * p.orbitDistance;
            const sprPx = planetSpritePx(p.diameter, z);
            planet.dot.visible = false;
            planet.sprite.visible = f < 500;
            planet.sprite.alpha = 1;
            planet.sprite.position.set(px, py);
            planet.sprite.scale.set(sprPx / (planet.sprite.texture.width * z));
            // Label centred on the drawn rect's right edge (method_84),
            // vertically centred on the body.
            const populated = p.owner !== null && p.population.items.length > 0;
            planet.label.visible = habitatLabelVisible(true, populated, f);
            planet.label.position.set(px + (sprPx / 2) / z, py);
            planet.label.scale.set(1 / z);
            if (planet.label.visible) {
                const fontSize = habitatLabelFontSize(f);
                if (fontSize !== planet.label.style.fontSize) {
                    planet.label.style.fontSize = fontSize;
                }
                const fill = habitatLabelColor(p, this.view.galaxy.independentEmpire);
                if (fill !== planet.label.style.fill) {
                    planet.label.style.fill = fill;
                }
            }
            for (const moon of planet.moons) {
                const m = moon.habitat;
                const mx = px + Math.cos(m.orbitAngle) * m.orbitDistance;
                const my = py + Math.sin(m.orbitAngle) * m.orbitDistance;
                const mPx = moonDotPx(m.diameter, z);
                moon.dot.visible = f < 500;
                moon.dot.alpha = 1;
                moon.dot.position.set(mx, my);
                moon.dot.scale.set(mPx / (moon.dot.texture.width * z));
                const mPopulated = m.owner !== null && m.population.items.length > 0;
                moon.label.visible = habitatLabelVisible(false, mPopulated, f);
                moon.label.position.set(mx + (mPx / 2) / z, my);
                moon.label.scale.set(1 / z);
                if (moon.label.visible) {
                    const fontSize = habitatLabelFontSize(f);
                    if (fontSize !== moon.label.style.fontSize) {
                        moon.label.style.fontSize = fontSize;
                    }
                    const fill = habitatLabelColor(m, this.view.galaxy.independentEmpire);
                    if (fill !== moon.label.style.fill) {
                        moon.label.style.fill = fill;
                    }
                }
            }
        }

        // Asteroid fields: scattered rocks, only once they resolve to >1 px.
        const rocksVisible = z > 0.05;
        for (const rock of this.asteroids) {
            rock.visible = rocksVisible;
        }

        // System name label under the star (small white text). Task 12p: only
        // drawn above f = 150 (MainView.2.cs:5153/5627-5630) — nothing names
        // stars at system zoom; offset uses the larger of the map icon and
        // the drawn star size.
        this.nameLabel.visible = labelAllowed && f > 150;
        if (this.nameLabel.visible) {
            const gpx = starGalaxySpritePx(star.diameter, z);
            const iconPx = clamp(star.diameter * z * 30, 2.5, 26);
            this.nameLabel.position.set(0, (Math.max(iconPx, gpx) * 0.5 + 10) / z);
            this.nameLabel.scale.set(1 / z);
        }
    }

    private redrawRings(z: number): void {
        const g = this.ring;
        g.clear();
        for (const planet of this.planets) {
            const p = planet.habitat;
            g.circle(0, 0, p.orbitDistance).stroke({ width: 1 / z, color: 0x7f90a8, alpha: 0.55 });
            if (z > 0.25) {
                // Faint moon-orbit circles around planets (system zoom).
                const px = Math.cos(p.orbitAngle) * p.orbitDistance;
                const py = Math.sin(p.orbitAngle) * p.orbitDistance;
                for (const moon of planet.moons) {
                    g.circle(px, py, moon.habitat.orbitDistance).stroke({ width: 1 / z, color: 0x7f90a8, alpha: 0.35 });
                }
            }
        }
    }

    /**
     * Task 02c2 (MainView.1.cs ~740-782): lazily build the system-zoom star
     * from two tinted counter-rotating discs plus an animated corona frame.
     * The tint is the centre pixel of this star's MAP-STAR image (the same
     * icon used at galaxy/sector zoom), sampled once per URL. Corona B is
     * used for all stars except neutron stars, which use Corona C with a
     * larger scale and slower fps.
     */
    private async buildStarDiscs(): Promise<void> {
        if (this.starDiscs === null || this.discA === null || this.discB === null || this.corona === null) {
            return;
        }
        const store = this.view.store;
        const star = this.system.systemStar;
        const [discATex, discBTex] = await Promise.all([
            store.loadFirst([starDiscUrl(2)], () => makeGlowTexture(starColors(star.type).glow, starColors(star.type).core)),
            store.loadFirst([starDiscUrl(0)], () => makeGlowTexture(starColors(star.type).glow, starColors(star.type).core)),
        ]);
        this.discA.texture = discATex;
        this.discB.texture = discBTex;

        // Tint = centre pixel of the map-star icon (method_120 in the
        // original); falls back to white when the image can't be read.
        const mapUrls = mapStarUrls(star);
        const c = mapUrls.length > 0 ? await sampleCentreColour(mapUrls[0]) : 0xffffff;
        const bright = scaleColour(c, 1.2);
        this.discA.tint = bright; // star_disc_2, rotation +angle, alpha 255
        this.discA.alpha = 1;
        this.discB.tint = c; // star_disc_0 on top, rotation -angle, alpha 96
        this.discB.alpha = 96 / 255;

        // Corona frames load lazily here (only when a star reaches system
        // zoom) and only once (AssetStore caches by first URL).
        const isNeutron = star.type === HabitatType.Neutron;
        this.coronaFps = isNeutron ? 12 : 15;
        this.coronaScale = isNeutron ? 2.3 : 1.65;
        const frames = await Promise.all(coronaFrameUrls(isNeutron ? 'C' : 'B').map((url) => store.loadFirst([url], () => Texture.EMPTY)));
        this.coronaFrames = frames;
        this.corona.texture = frames[0];
        this.corona.tint = bright;
        this.corona.alpha = 240 / 255;
    }

    /** Per-frame update of the disc/corona group (no-op until built). */
    private updateStarDiscs(crossT: number, fullPx: number, z: number, dtSeconds: number): void {
        if (this.starDiscs === null || this.discA === null || this.discB === null || this.corona === null) {
            return;
        }
        if (crossT <= 0.005) {
            this.starDiscs.visible = false;
            this.starDiscs.alpha = 0;
            return;
        }
        if (this.coronaFrames.length === 0) {
            // First entry into the crossfade window: kick off the lazy load
            // (disc textures, centre-pixel tint, corona frames).
            void this.buildStarDiscs();
            this.starDiscs.visible = false;
            this.starDiscs.alpha = 0;
            return;
        }
        this.discAngle += dtSeconds * 0.02; // double_5 -= elapsed * 0.02; A rotates +angle, B -angle
        this.starDiscs.visible = true;
        this.starDiscs.alpha = crossT;
        const s = fullPx / (this.discA.texture.width * z);
        this.discA.scale.set(s);
        this.discA.rotation = this.discAngle;
        this.discB.scale.set(s);
        this.discB.rotation = -this.discAngle;
        const cs = (fullPx * this.coronaScale) / (this.corona.texture.width * z);
        this.corona.scale.set(cs);
        const nowMs = performance.now();
        this.corona.texture = this.coronaFrames[coronaFrameIndex(nowMs, this.coronaFrames.length, this.coronaFps)];
    }
}

class CloudView {
    cloud: Habitat;
    sprite: Sprite;
    constructor(private view: MainView, cloud: Habitat, texture: Texture) {
        this.cloud = cloud;
        this.sprite = new Sprite(texture);
        this.sprite.anchor.set(0.5);
        this.sprite.x = cloud.xpos;
        this.sprite.y = cloud.ypos;
        this.sprite.alpha = 0.5;
        this.sprite.visible = false;
        this.view.world.addChild(this.sprite);
    }

    update(zoom: number, cam: Camera): void {
        const px = Math.min(this.cloud.diameter * zoom * 0.6, 2400);
        const visible = px > 16;
        // Culling margin of one cloud radius plus a screen margin.
        const halfW = cam.width / 2 + px / 2 + 100;
        const halfH = cam.height / 2 + px / 2 + 100;
        this.sprite.visible =
            visible &&
            this.cloud.xpos > cam.x - halfW &&
            this.cloud.xpos < cam.x + halfW &&
            this.cloud.ypos > cam.y - halfH &&
            this.cloud.ypos < cam.y + halfH;
        if (this.sprite.visible) {
            this.sprite.scale.set(px / (this.sprite.texture.width * zoom));
        }
    }
}

// Task 08f1 (MainView.2.cs 4675-4705): a GalaxyLocation name label in
// screen space (the original draws text at fixed pixel sizes on top of the
// world). One Text object per location, created once and reused; the font
// style is only rebuilt when the zoom-factor branch changes.
class RegionLabel {
    location: GalaxyLocation;
    text: Text;
    private lastSize = -1;
    private lastBold = false;
    constructor(location: GalaxyLocation, layer: Container) {
        this.location = location;
        this.text = new Text({
            text: location.name,
            style: { fontSize: 16.67, fill: 0xffffff, fontFamily: MAP_FONT_FAMILY },
        });
        this.text.anchor.set(0.5);
        this.text.alpha = 0.85;
        this.text.visible = false;
        layer.addChild(this.text);
    }

    /** Update position/font/visibility for the current camera state. */
    update(cam: Camera, factor: number, maxFactor: number): void {
        const font = regionLabelFont(this.location.type, factor, maxFactor);
        if (font === null || !this.location.showName) {
            this.text.visible = false;
            return;
        }
        // Screen centre of the location (MainView.2.cs x/y formulas), with
        // the non-nebula offset of (-5, -20) px.
        const c = this.location.resolveLocationCenter();
        const s = cam.worldToScreen(c.x, c.y);
        if (s.x < -100 || s.x > cam.width + 100 || s.y < -100 || s.y > cam.height + 100) {
            this.text.visible = false;
            return;
        }
        if (this.location.type !== GalaxyLocationType.NebulaCloud) {
            s.x -= 5;
            s.y -= 20;
        }
        if (font.size !== this.lastSize || font.bold !== this.lastBold) {
            this.text.style.fontSize = font.size;
            this.text.style.fontWeight = font.bold ? 'bold' : 'normal';
            this.lastSize = font.size;
            this.lastBold = font.bold;
        }
        this.text.position.set(s.x, s.y);
        this.text.visible = true;
    }
}

// Task 08f2 (NebulaCloudGenerator): a procedurally generated translucent
// nebula image placed over the location's rectangle. The texture is generated
// lazily the first time the cloud becomes visible (the original generates all
// clouds on a background thread at galaxy load; lazy generation keeps the
// same per-location seed = location index, so results are identical).
class NebulaView {
    location: GalaxyLocation;
    sprite: Sprite;
    private generator: NebulaCloudGenerator;
    constructor(private view: MainView, location: GalaxyLocation) {
        this.location = location;
        // Port of MainView.cs:1438-1452: two generators, seeds 1 and 2.
        // Nebula locations use the second one (nebulaCloudGenerator_1); the
        // color scheme stays -1 (random per generation, seeded by the call).
        this.generator = new NebulaCloudGenerator(2);
        this.sprite = new Sprite(Texture.EMPTY);
        this.sprite.anchor.set(0.5);
        this.sprite.x = location.xpos + location.width / 2;
        this.sprite.y = location.ypos + location.height / 2;
        this.sprite.alpha = 0;
        this.sprite.visible = false;
        this.view.world.addChild(this.sprite);
    }

    /** Generate (once) and draw the cloud for the current camera state. */
    update(zoom: number, cam: Camera, alpha: number): void {
        if (alpha <= 0.01) {
            this.sprite.visible = false;
            return;
        }
        const c = this.location.resolveLocationCenter();
        const halfW = cam.width / 2 + this.location.width * zoom * 0.5 + 100;
        const halfH = cam.height / 2 + this.location.height * zoom * 0.5 + 100;
        if (c.x < cam.x - halfW || c.x > cam.x + halfW || c.y < cam.y - halfH || c.y > cam.y + halfH) {
            this.sprite.visible = false;
            return;
        }
        if (this.sprite.texture === Texture.EMPTY) {
            // Lazy first-time generation (see class comment). The C# sizes
            // the cloud to the location rect via minimumSize/maximumSize; we
            // derive them from the rect in world units (the generator caps
            // the texture at 512 px and the sprite is stretched to the rect).
            const size = Math.max(64, Math.min(this.location.width, this.location.height));
            const result = this.generator.generateNebulaBackdrop(
                this.location.pictureRef >= 0 ? this.location.pictureRef : this.location.effectRandomSeed,
                114, // TransparencyLevel set in method_41 (double_2 == 4.5 default)
                -1,
                Math.trunc(size),
                Math.trunc(size * 1.5),
                true,
                false,
                false,
            );
            this.sprite.texture = this.generator.toTexture(result);
        }
        // Stretch the (<=512 px) texture over the location rectangle.
        this.sprite.scale.set(this.location.width / this.sprite.texture.width, this.location.height / this.sprite.texture.height);
        this.sprite.alpha = alpha;
        this.sprite.visible = true;
    }
}

// ---------------------------------------------------------------------------

export interface MainViewTextures {
    dots: Map<HabitatType, Texture>;
    dot: Texture;
    rock: Texture;
    backdrop: Texture;
    starfieldFar: Texture;
    starfieldNear: Texture;
}

export class MainView {
    world = new Container();
    fx = new Container();
    /** Task 08g: thin selection ring around the picked object (screen-space). */
    selectionRing = new Graphics();
    private backdrop: Sprite;
    private grid = new Graphics();
    private starfieldFar!: TilingSprite;
    private starfieldNear!: TilingSprite;
    /** Region-name label layer (task 08f1), screen-space. */
    regionLabels = new Container();
    private regionLabelViews: RegionLabel[] = [];
    systems: SystemView[] = [];
    clouds: CloudView[] = [];
    /** Task 08f2: nebula cloud images, world-space between backdrop and stars. */
    nebulae: NebulaView[] = [];
    /** Task M2e: empire ownership overlays (colony rings, markers, territory). */
    private empireLayer!: EmpireLayer;
    /** Task M3: the Overlays HUD toggles this renderer implements (potential
     * colonies, scenic/research markers, empire territory visibility). */
    private overlayLayer!: OverlayLayer;
    /** Task 13a: ships, bases, pirates and traders (BuiltObjects). */
    private builtObjectLayer!: BuiltObjectLayer;
    // [combatfx] begin
    /** Combat effects: weapon fire, explosions, shield strikes, hyperjump flashes (effectsLayer.ts). */
    combatEffects: EffectsLayer | null = null;
    // [combatfx] end
    private textures!: MainViewTextures;
    private minZoom = 1e-6;
    private lastGridZoom = -1;
    private dragging = false;
    private lastPointer = { x: 0, y: 0 };
    private lastDragX = 0;
    private lastDragY = 0;
    private pointerInside = false;
    /** Task 12k: debounce timer for the hover tooltip pick. */
    private tooltipTimer: number | undefined;
    /** Elapsed seconds since boot (disc rotation / corona frame clock). */
    private elapsedSeconds = 0;
    private lastUpdateMs = -1;
    /** Task 08g: set by main.ts — receives the habitat picked on left click. */
    onSelectionChange?: (h: Habitat | null) => void;
    /** Task 13d: set by main.ts — receives the ship/base picked on left click. */
    onBuiltObjectSelect?: (bo: BuiltObject) => void;
    /** Task 08g: set by main.ts — star double-clicked at galaxy/sector zoom. */
    onDoubleClickStar?: (h: Habitat) => void;
    // [ordermenu] begin
    /** 17c: a right click without drag (< 4 px between down and up); replaces the default centre-on-click. */
    onRightClick?: (sx: number, sy: number, e: MouseEvent) => void;
    /** 17c: a left click the order layer consumes (fleet attack point / home base pick); return true to skip selection. */
    onLeftClickIntercept?: (sx: number, sy: number) => boolean;
    /** 17c: the pointer rested on the map (debounced like the hover tooltip). */
    onPointerRest?: (sx: number, sy: number, clientX: number, clientY: number) => void;
    // [ordermenu] end

    /** Task M3: map overlay toggle state (src/ui/mapOverlays.ts), shared
     * with the HUD's options list. Defaults to a fresh state so existing
     * callers that only pass the first four constructor args keep working. */
    constructor(
        readonly app: Application,
        readonly camera: Camera,
        readonly galaxy: Galaxy,
        readonly store: AssetStore,
        private overlays: MapOverlayState = createMapOverlayState(),
    ) {
        app.stage.addChild(this.world);
        app.stage.addChild(this.fx);
        this.world.addChild(this.grid);
        this.backdrop = new Sprite(Texture.EMPTY);
        this.world.addChildAt(this.backdrop, 0);
        this.selectionRing.visible = false;
        this.fx.addChild(this.selectionRing);
    }

    /** Task 08g: the habitat currently selected in the Main View (null = none). */
    selectedHabitat: Habitat | null = null;
    /** Task 13d: the ship/base currently selected in the Main View (null = none). */
    selectedBuiltObject: BuiltObject | null = null;

    /** Drawn on-screen size of a habitat at the current zoom — the same size
     * functions the renderer uses (planets >= 14 px, moons >= 7 px, star
     * sprite >= 40 px via planetSpritePx/moonDotPx/starSpritePx). */
    private drawnSize(h: Habitat, z: number): number {
        if (h.category === HabitatCategoryType.Star) {
            return starSpritePx(h.diameter, z);
        }
        if (h.category === HabitatCategoryType.Moon) {
            return moonDotPx(h.diameter, z);
        }
        if (h.category === HabitatCategoryType.Planet) {
            return planetSpritePx(h.diameter, z);
        }
        // Asteroids/gas clouds are not pickable.
        return 0;
    }

    /**
     * Task 08g (Controls/MainView.cs mouse picking): the habitat drawn under
     * the given screen point. At system/planet zoom prefer planets/moons whose
     * drawn sprite rect contains the point (same size functions as the
     * renderer), then the star; at galaxy/sector zoom pick the nearest star
     * within 12 px of the cursor. Ties go to the smaller object.
     */
    pick(screenX: number, screenY: number): Habitat | null {
        const cam = this.camera;
        const w = cam.screenToWorld(screenX, screenY);
        const z = cam.zoom;
        const m = this.minZoom;
        const factor = 1 / z;
        const atSystemZoom = factor < 70; // original's system-zoom threshold
        for (const sv of this.systems) {
            const star = sv.system.systemStar;
            const s = cam.worldToScreen(star.xpos, star.ypos);
            if (atSystemZoom) {
                // Planets + their moons first (smaller objects win ties),
                // then the star itself.
                const bodies: Habitat[] = [];
                for (const p of sv.planets) {
                    bodies.push(p.habitat);
                    for (const moon of p.moons) {
                        bodies.push(moon.habitat);
                    }
                }
                let hit = hitTestHabitats(bodies, w.x, w.y, (h, zz) => this.drawnSize(h, zz), z);
                if (hit === null) {
                    hit = hitTestHabitats([star], w.x, w.y, (h, zz) => this.drawnSize(h, zz), z);
                }
                if (hit !== null) {
                    return hit;
                }
            } else if (Math.hypot(s.x - screenX, s.y - screenY) <= 12) {
                // Galaxy/sector zoom: nearest star within 12 px of the cursor.
                return star;
            }
        }
        return null;
    }

    /** Task 13d (Main.Part11.cs method_145): the ship/base under the screen point. Ships win over habitats. */
    pickBuiltObject(screenX: number, screenY: number): BuiltObject | null {
        const w = this.camera.screenToWorld(screenX, screenY);
        return this.builtObjectLayer.pick(w.x, w.y, 1 / this.camera.zoom, this.galaxy.playerEmpire);
    }

    // [ordermenu] begin
    /** 17c: double_0, the zoom as galaxy units per screen pixel (> 100: sector / galaxy level). */
    get zoomFactor(): number {
        return 1 / this.camera.zoom;
    }

    /**
     * 17c: Main.Part11.cs 1330 method_143 (the object under a screen point) from the renderer's pickers: a ship / base
     * (its fleet when it leads one at zoom factor > 100), else the habitat drawn there — its SystemInfo when it is a
     * star picked at zoom factor > 100 — else null.
     * TODO(port): method_145's exact radii (fleet lead ship within 10 px scaled, systems within their dominant empire's
     * strategic radius) and creature picking; this reuses the 13d / 08g pickers.
     */
    pickOrderTarget(sx: number, sy: number): unknown {
        const f = this.zoomFactor;
        const bo = this.pickBuiltObject(sx, sy);
        if (bo !== null) {
            const g = bo.shipGroup as { leadShip?: BuiltObject | null } | null;
            if (f > 100 && g !== null && g !== undefined && g.leadShip === bo) return g;
            return bo;
        }
        const h = this.pick(sx, sy);
        if (h === null) return null;
        if (f > 100 && h.category === HabitatCategoryType.Star) {
            return this.galaxy.systems.find((s) => s.systemStar === h) ?? h;
        }
        return h;
    }
    // [ordermenu] end

    /** Load textures, build all scene objects, attach input handlers. */
    async init(): Promise<void> {
        const store = this.store;
        // Task 08f3: wait for the 'Forgotten Futurist' web font BEFORE any
        // map Text object is built below (system/planet labels are created
        // in SystemView's constructor), so they rasterize in the real font.
        await loadMapFont();
        // If the font finishes loading later (or was created earlier by a
        // caller that skipped the wait), force every label to re-render in
        // it once document.fonts settles.
        void document.fonts.ready
            .then(() => {
                for (const sv of this.systems) {
                    sv.nameLabel.style.fontFamily = MAP_FONT_FAMILY;
                    for (const planet of sv.planets) {
                        planet.label.style.fontFamily = MAP_FONT_FAMILY;
                    }
                }
                for (const rl of this.regionLabelViews) {
                    rl.text.style.fontFamily = MAP_FONT_FAMILY;
                }
            })
            .catch(() => undefined);
        // Only the backdrop is preloaded up front; star map icons, star
        // sprites, planet sprites, rocks and gas clouds all load lazily
        // below, per habitat pictureRef (task 01).
        const loaded = await store.preload([['backdrop', BACKDROP_URLS, makeBackdropTexture]]);

        const textures: MainViewTextures = {
            dots: new Map(),
            dot: makeDotTexture('#cccccc'),
            rock: makeDotTexture('#8a7f6a', 32),
            backdrop: loaded.get('backdrop')!,
            starfieldFar: makeStarfieldTexture(512, 160),
            starfieldNear: makeStarfieldTexture(512, 320),
        };
        // Planet-type dot textures.
        for (const t of PLANET_DOT_TYPES) {
            textures.dots.set(t, makeDotTexture(PLANET_COLORS[t] ?? '#888888'));
        }
        this.textures = textures;

        // Backdrop: stretched over the galaxy bounds, world-space.
        this.backdrop.texture = textures.backdrop;
        this.backdrop.scale.set(this.galaxy.sizeX / textures.backdrop.width, this.galaxy.sizeY / textures.backdrop.height);
        this.minZoom = this.camera.minZoom;

        // Sector grid (world-space lines every sectorSize units).
        this.drawGrid(this.camera.zoom);

        // Parallax starfield (screen-space, tiled).
        this.starfieldFar = new TilingSprite(textures.starfieldFar);
        this.starfieldNear = new TilingSprite(textures.starfieldNear);
        this.starfieldFar.alpha = 0;
        this.starfieldFar.visible = false;
        this.starfieldNear.alpha = 0;
        this.starfieldNear.visible = false;
        this.fx.addChild(this.starfieldFar);
        this.fx.addChild(this.starfieldNear);

        // Systems and gas clouds.
        for (const system of this.galaxy.systems) {
            // Gas clouds are SystemInfos too (C# / task C2c-1); they are drawn as clouds below.
            if (system.systemStar.category === HabitatCategoryType.GasCloud) continue;
            this.systems.push(new SystemView(this, system, textures));
        }
        for (const habitat of this.galaxy.habitats) {
            if (habitat.category === HabitatCategoryType.GasCloud) {
                // Generated fallback; the original art loads lazily below.
                this.clouds.push(new CloudView(this, habitat, makeCloudTexture(CLOUD_COLORS[habitat.type] ?? '#88aaff')));
            }
        }

        // Lazy per-habitat sprite loading (pictureRef-selected art).
        const lazyLoads: Promise<unknown>[] = [];
        for (const sv of this.systems) {
            const star = sv.system.systemStar;
            lazyLoads.push(
                store
                    .loadFirst(mapStarUrls(star), () => makeGlowTexture(starColors(star.type).glow, starColors(star.type).core))
                    .then((tex) => {
                        sv.mapIcon.texture = tex;
                    }),
            );
            lazyLoads.push(
                store.loadFirst(starSpriteUrls(star), () => makeStarSpriteTexture(star.type)).then((tex) => {
                    sv.starSprite.texture = tex;
                }),
            );
            for (const planet of sv.planets) {
                lazyLoads.push(
                    store
                        .loadFirst(planetUrls(planet.habitat), () => makePlanetTexture(PLANET_COLORS[planet.habitat.type] ?? '#888888'))
                        .then((tex) => {
                            planet.sprite.texture = tex;
                        }),
                );
                // Task 12p: moons use per-habitat planet art too.
                for (const moon of planet.moons) {
                    lazyLoads.push(
                        store
                            .loadFirst(planetUrls(moon.habitat), () => makePlanetTexture(PLANET_COLORS[moon.habitat.type] ?? '#888888'))
                            .then((tex) => {
                                moon.dot.texture = tex;
                            }),
                    );
                }
            }
            for (let i = 0; i < sv.asteroids.length; i++) {
                const rock = sv.asteroids[i];
                const h = sv.rockHabitats[i];
                lazyLoads.push(
                    store
                        .loadFirst(asteroidUrls(h), () => this.textures.rock)
                        .then((tex) => {
                            rock.texture = tex;
                            rock.scale.set((h.diameter * 0.45) / tex.width);
                        }),
                );
            }
        }
        for (const cloud of this.clouds) {
            lazyLoads.push(
                store
                    .loadFirst(cloudUrls(cloud.cloud), () => makeCloudTexture(CLOUD_COLORS[cloud.cloud.type] ?? '#88aaff'))
                    .then((tex) => {
                        cloud.sprite.texture = tex;
                    }),
            );
        }
        await Promise.all(lazyLoads);

        // Task 08f1: region/nebula location name labels (screen-space layer).
        // All locations are treated as known to the empire for now.
        for (const location of this.galaxy.galaxyLocations) {
            this.regionLabelViews.push(new RegionLabel(location, this.regionLabels));
        }
        this.fx.addChild(this.regionLabels);

        // Task 08f2: nebula cloud images over each NebulaCloud location rect,
        // in world space between the backdrop and the map stars.
        for (const location of this.galaxy.galaxyLocations) {
            if (location.type === GalaxyLocationType.NebulaCloud) {
                const nv = new NebulaView(this, location);
                this.nebulae.push(nv);
                this.world.addChildAt(nv.sprite, 1); // just above the backdrop
            }
        }

        // Task M2e: empire ownership overlays. The layer's root is added to
        // world after all system roots, so rings/discs draw on top of stars.
        this.empireLayer = new EmpireLayer(this.galaxy, this.world);
        // Task M3: potential-colonies/scenic/research markers + the Empire
        // Territory toggle. Added after empireLayer so its yellow marker
        // rings draw above the territory discs and colony rings.
        this.overlayLayer = new OverlayLayer(this.galaxy, this.world, this.empireLayer, this.overlays);
        // Task 13a: ships/bases/pirates/traders on top of all map layers.
        this.builtObjectLayer = new BuiltObjectLayer(this.galaxy, this.world, this.store, this.overlays);
        // [combatfx] begin
        this.combatEffects = new EffectsLayer(this.galaxy, this.world, this.store, (bo) => this.builtObjectLayer.drawnSizePx(bo));
        // [combatfx] end

        this.attachInput();
    }

    /** Per-frame update: camera transform + per-layer level of detail. */
    update(): void {
        const cam = this.camera;
        const z = cam.zoom;
        const m = this.minZoom;

        // Frame delta for the animated star discs/corona (task 02c2).
        const nowMs = performance.now();
        const dtSeconds = this.lastUpdateMs < 0 ? 0 : Math.max(0, (nowMs - this.lastUpdateMs) / 1000);
        this.lastUpdateMs = nowMs;
        this.elapsedSeconds += dtSeconds;

        this.world.scale.set(z);
        this.world.x = cam.width / 2 - cam.x * z;
        this.world.y = cam.height / 2 - cam.y * z;

        // Galaxy backdrop: bright at full-galaxy zoom, fading out as the
        // sector view takes over (MainView.1.cs FadeGalaxyBackground).
        const bdA = backdropAlpha(z, m);
        this.backdrop.alpha = bdA;
        this.backdrop.visible = bdA > 0.01;

        // Faint sector grid: fades in over the galaxy zoom, out at mid zoom
        // (MainView.1.cs FadeSectorBackground).
        const gridA = fadeIn(z, m * 2, m * 6) * fadeOut(z, 0.004, 0.015);
        this.grid.alpha = gridA;
        this.grid.visible = gridA > 0.01;
        if (this.grid.visible && (this.lastGridZoom < 0 || Math.abs(z / this.lastGridZoom - 1) > 0.05)) {
            this.drawGrid(z);
            this.lastGridZoom = z;
        }

        // Dense parallax starfield: fades in over the same window the backdrop
        // fades out (task 02b2), so something is always visible while
        // zooming between galaxy and system view.
        const sfA = starfieldAlpha(z, m);
        this.starfieldFar.alpha = sfA * 0.5;
        this.starfieldFar.visible = sfA > 0.01;
        this.starfieldNear.alpha = sfA;
        this.starfieldNear.visible = sfA > 0.01;
        if (this.starfieldFar.width !== cam.width || this.starfieldFar.height !== cam.height) {
            this.starfieldFar.width = cam.width;
            this.starfieldFar.height = cam.height;
            this.starfieldNear.width = cam.width;
            this.starfieldNear.height = cam.height;
        }
        if (sfA > 0.01) {
            // Parallax: each layer pans a fraction of the world pan.
            this.starfieldFar.position.set(wrapOffset(-cam.x * z * FAR_PARALLAX), wrapOffset(-cam.y * z * FAR_PARALLAX));
            this.starfieldNear.position.set(wrapOffset(-cam.x * z * NEAR_PARALLAX), wrapOffset(-cam.y * z * NEAR_PARALLAX));
        }

        // Systems: greedy 80 px label-overlap suppression across systems.
        const labelZoom = m * 4; // system names appear at ~sector zoom
        const kept: Array<{ x: number; y: number }> = [];
        for (const sv of this.systems) {
            // Cheap pre-cull before the (margin-inclusive) update.
            const star = sv.system.systemStar;
            const halfW = cam.width / 2 + 400 / z + sv.maxExtent / z;
            const halfH = cam.height / 2 + 400 / z + sv.maxExtent / z;
            if (star.xpos < cam.x - halfW || star.xpos > cam.x + halfW || star.ypos < cam.y - halfH || star.ypos > cam.y + halfH) {
                sv.root.visible = false;
                continue;
            }
            // Decide label visibility greedily (min 80 px between labels).
            // Task 10f: the "Show system names" setting disables them entirely.
            const s = cam.worldToScreen(star.xpos, star.ypos);
            let allow = z > labelZoom && showSystemNames();
            if (allow) {
                for (const k of kept) {
                    const dx = k.x - s.x;
                    const dy = k.y - s.y;
                    if (dx * dx + dy * dy < 80 * 80) {
                        allow = false;
                        break;
                    }
                }
                if (allow) {
                    kept.push(s);
                }
            }
            sv.update(z, cam, allow, dtSeconds);
        }
        for (const cloud of this.clouds) {
            cloud.update(z, cam);
        }

        // Task 08f2: nebula clouds fade out over the same window the backdrop
        // fades out (FadeGalaxyNebulae), so they are fully visible at
        // galaxy/sector zoom and gone by system zoom.
        const nebA = nebulaAlpha(z, m);
        for (const nv of this.nebulae) {
            nv.update(z, cam, nebA);
        }

        // Task M2e: empire ownership overlays (colony rings at system zoom;
        // owned-system markers + territory discs at galaxy/sector zoom).
        this.empireLayer.update(z, cam);
        // Task M3: potential-colonies/scenic/research markers (Empire
        // Territory's visibility toggle is applied straight to empireLayer,
        // above).
        this.overlayLayer.update(z, cam);
        // Task 13a: built objects (ships, bases, pirates, traders).
        this.builtObjectLayer.update(z, cam);
        // [combatfx] begin
        this.combatEffects?.update(z, cam);
        // [combatfx] end

        // Region/nebula location name labels (task 08f1): visible while the
        // original's zoom factor double_15 satisfies 70 < double_15 <=
        // double_5 (the full-galaxy factor = 1/minZoom). Task 10f: the
        // "Show region labels" setting hides the whole layer.
        const showRegions = showRegionLabels();
        this.regionLabels.visible = showRegions;
        if (showRegions) {
            const factor = 1 / z;
            const maxFactor = 1 / m;
            for (const rl of this.regionLabelViews) {
                rl.update(cam, factor, maxFactor);
            }
        }

        // Task 08g / 13d: keep the selection ring around the selected habitat or ship.
        const selBo = this.selectedBuiltObject;
        const sel = this.selectedHabitat;
        if (selBo !== null && !selBo.hasBeenDestroyed && 1 / z < BUILT_OBJECT_MAX_FACTOR) {
            const s = cam.worldToScreen(selBo.xpos, selBo.ypos);
            const r = Math.max(this.builtObjectLayer.drawnSizePx(selBo), 8) * 0.5 + 4;
            this.selectionRing.clear();
            this.selectionRing.circle(s.x, s.y, r).stroke({ width: 1.5, color: 0x4fc3f7 });
            this.selectionRing.visible = true;
        } else if (sel === null) {
            this.selectionRing.visible = false;
        } else {
            const s = cam.worldToScreen(sel.xpos, sel.ypos);
            const r = this.drawnSize(sel, z) * 0.5 + 4;
            this.selectionRing.clear();
            this.selectionRing.circle(s.x, s.y, r).stroke({ width: 1.5, color: 0x4fc3f7 });
            this.selectionRing.visible = true;
        }

        // Screen-edge auto-scroll (original control scheme).
        if (!this.dragging && this.pointerInside) {
            const edge = 24;
            const speed = 16;
            let dx = 0;
            let dy = 0;
            if (this.lastPointer.x < edge) {
                dx = -speed;
            } else if (this.lastPointer.x > cam.width - edge) {
                dx = speed;
            }
            if (this.lastPointer.y < edge) {
                dy = -speed;
            } else if (this.lastPointer.y > cam.height - edge) {
                dy = speed;
            }
            if (dx !== 0 || dy !== 0) {
                cam.panByScreen(dx, dy);
            }
        }
    }

    private drawGrid(z: number): void {
        const g = this.grid;
        g.clear();
        const sizeX = this.galaxy.sizeX;
        const sizeY = this.galaxy.sizeY;
        const step = this.galaxy.sectorSize;
        const line = { width: 1 / z, color: 0x3a4a66, alpha: 0.6 };
        for (let x = 0; x <= sizeX + 1; x += step) {
            g.moveTo(x, 0).lineTo(x, sizeY).stroke(line);
        }
        for (let y = 0; y <= sizeY + 1; y += step) {
            g.moveTo(0, y).lineTo(sizeX, y).stroke(line);
        }
    }

    // ------------------------------------------------------------------
    // Input: wheel zoom around cursor, right-drag pan, right-click center,
    // PageUp/PageDown zoom steps, screen-edge scroll (manual control set).

    private attachInput(): void {
        const canvas = this.app.canvas;
        let downX = 0;
        let downY = 0;
        let rightDownX = 0; // [ordermenu] the right button's press point (click vs drag)
        let rightDownY = 0;
        canvas.addEventListener(
            'wheel',
            (e: WheelEvent) => {
                e.preventDefault();
                const rect = canvas.getBoundingClientRect();
                const sx = e.clientX - rect.left;
                const sy = e.clientY - rect.top;
                const factor = e.deltaY < 0 ? 1.25 : 0.8;
                this.camera.zoomAt(this.camera.zoom * factor, sx, sy);
            },
            { passive: false },
        );
        canvas.addEventListener('mousedown', (e: MouseEvent) => {
            if (e.button === 2) {
                this.dragging = true;
                const rect = canvas.getBoundingClientRect();
                this.lastDragX = e.clientX - rect.left;
                this.lastDragY = e.clientY - rect.top;
                rightDownX = this.lastDragX;
                rightDownY = this.lastDragY;
            } else if (e.button === 0) {
                const rect = canvas.getBoundingClientRect();
                downX = e.clientX - rect.left;
                downY = e.clientY - rect.top;
            }
        });
        window.addEventListener('mousemove', (e: MouseEvent) => {
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            this.pointerInside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
            this.lastPointer = { x, y };
            if (this.dragging) {
                this.camera.panByScreen(x - this.lastDragX, y - this.lastDragY);
                this.lastDragX = x;
                this.lastDragY = y;
                // Task 12k: no hover tooltip while panning.
                hideMapTooltip();
                return;
            }
            // Task 12k: hover tooltip — debounce ~120 ms so it only appears
            // when the mouse rests on a pickable object.
            if (this.tooltipTimer !== undefined) {
                clearTimeout(this.tooltipTimer);
            }
            this.tooltipTimer = window.setTimeout(() => {
                this.tooltipTimer = undefined;
                if (!this.pointerInside) {
                    hideMapTooltip();
                    return;
                }
                this.onPointerRest?.(x, y, e.clientX, e.clientY); // [ordermenu]
                const hit = this.pick(x, y);
                if (hit === null) {
                    hideMapTooltip();
                    return;
                }
                // Same lookup as main.ts's selection code: the system star of
                // the habitat's system, guarded against out-of-range indices.
                let systemName: string | null = null;
                const sys = this.galaxy.systems[hit.systemIndex];
                if (sys !== undefined) {
                    systemName = sys.systemStar.name;
                }
                showMapTooltip(tooltipText(hit, systemName), e.clientX, e.clientY);
            }, 120);
        });
        window.addEventListener('mouseup', (e: MouseEvent) => {
            if (e.button === 2 && this.dragging) {
                this.dragging = false;
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                // [ordermenu] begin: a right click without drag goes to the order layer (17c) when installed.
                if (this.onRightClick !== undefined) {
                    if (Math.hypot(x - rightDownX, y - rightDownY) < 4) this.onRightClick(x, y, e);
                    return;
                }
                // [ordermenu] end
                if (Math.hypot(x - this.lastDragX, y - this.lastDragY) < 4) {
                    // Right-click on empty space centers the view there.
                    const w = this.camera.screenToWorld(x, y);
                    this.camera.centerOn(w.x, w.y);
                }
            } else if (e.button === 0) {
                // Left click (no drag: < 4 px pointer movement between
                // down/up) selects the object under the cursor; empty space
                // clears the selection.
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                if (Math.hypot(x - downX, y - downY) >= 4) {
                    return;
                }
                if (this.onLeftClickIntercept?.(x, y)) return; // [ordermenu]
                const bo = this.pickBuiltObject(x, y);
                if (bo !== null) {
                    this.selectedHabitat = null;
                    this.selectedBuiltObject = bo;
                    this.onBuiltObjectSelect?.(bo);
                    return;
                }
                const hit = this.pick(x, y);
                this.selectedBuiltObject = null;
                this.selectedHabitat = hit;
                this.onSelectionChange?.(hit);
            }
        });
        canvas.addEventListener('dblclick', (e: MouseEvent) => {
            // Double-click a star at galaxy/sector zoom -> zoom to System
            // level centred on it.
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const hit = this.pick(x, y);
            if (hit !== null && hit.category === HabitatCategoryType.Star) {
                this.onDoubleClickStar?.(hit);
            }
        });
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());
        // PageUp/PageDown zoom is handled by the KEY_BINDINGS dispatch
        // (src/ui/keyboard.ts zoomOut/zoomIn); a second listener here undid it
        // and survived game-view teardown.
    }

    /** Task 12k: drop the hover tooltip when this view is torn down. */
    dispose(): void {
        if (this.tooltipTimer !== undefined) {
            clearTimeout(this.tooltipTimer);
            this.tooltipTimer = undefined;
        }
        hideMapTooltip();
    }
}

/** Parallax wrap: screen-space travel into a tile offset in [0, 512). */
function wrapOffset(v: number): number {
    return v - Math.floor(v / 512) * 512;
}