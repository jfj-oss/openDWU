// Main View sound triggers: ports of the SoundEffectRequest sites in the
// original's Main View draw code. The C# requests its sounds while drawing
// (Controls/MainView.1.cs / MainView.2.cs, XNA path), reading flags the sim
// already keeps on its objects (Weapon.SoundEffectPlayed,
// Explosion.ExplosionSoundPlayed, BuiltObject.HyperjumpAboutToEnter /
// HyperjumpJustExited / IonStrikeSoundPlayed / DoingMining …) and marking
// them played. This module walks the same objects once per rendered frame
// and hands each request to Main.method_0 (`request`), so the sim stays
// DOM-free: it only sets/clears those flags, as the C# sim does.
//
// Render-only state the C# keeps on sim objects (Habitat.NextSoundTime,
// BuiltObject.NextSoundTimeConstruction/Mining/GasMining) lives in WeakMaps
// here, and the lightning flicker (MainView.cs:1792 method_28) draws from a
// local Random instead of Galaxy.Rnd, so rendering never moves the galaxy's
// random stream (the C# construction/mining animation angles that also draw
// Galaxy.Rnd are not ported: the renderer has no animation system yet).

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { BuiltObject } from '../sim/builtObject';
import type { Habitat } from '../sim/types';
import { HabitatCategoryType, HabitatType } from '../sim/types';
import type { Weapon } from '../sim/weapon';
import type { Fighter } from '../sim/combat/fighters';
import type { Explosion } from '../sim/combat/damage';
import { GalaxyLocationEffectType, GalaxyLocationType } from '../sim/galaxyLocation';
import { determineGalaxyLocationsInRangeAtPoint } from '../sim/visibility';
import { isObjectVisibleToThisEmpire } from '../sim/independentTraders';
import { Random } from '../sim/random';
import { MIN_TIME } from '../sim/tick/simTime';
import { resolveBalanceAndDistance, type EffectsPlayer, type SoundEffectRequest } from './effectsPlayer';

/** The Main View's camera as the sound code needs it (world point at the centre, px per world unit, viewport px). */
export interface SoundView {
    x: number;
    y: number;
    zoom: number;
    width: number;
    height: number;
}

/** MainView.1.cs:856 `if (main_0.double_0 < 500.0)`: ships, fighters and habitats are drawn (and heard) below 500. */
export const SOUND_OBJECT_MAX_FACTOR = 500.0;
/** MainView.1.cs:2790 method_91 `if (double_17 < 100.0)`: ambient restricted-area voices. */
export const AMBIENT_MAX_FACTOR = 100.0;
/** MainView.1.cs:94 `if (main_0.double_0 < 150.0)`: nebula lightning (thunder). */
export const LIGHTNING_MAX_FACTOR = 150.0;
/** Galaxy.MaxSolarSystemSize. */
const MAX_SOLAR_SYSTEM_SIZE = 23000;

/** MainView.1.cs:2779 method_91's music tail: what the Main View asks of musicPlayer_0 this frame. */
export type AmbientMusicAction = 'fadePause' | 'fadeResume' | null;

export interface MusicState {
    isPlaying: boolean;
    isInitiatingFade: boolean;
    /** The fade timer is running (a ForceSwitch / FadeStop in progress). */
    fadeTimerRunning: boolean;
    actualVolume: number;
}

/**
 * Port of MainView.1.cs:2812-2819 (method_91 tail):
 *   flag && mp0.IsPlaying && !mp0.IsInitiatingFade && double_0 < 100 → mp0.FadePause()
 *   else Running && (!flag || double_0 >= 100) && (!mp0.IsPlaying || mp0.ActualVolume <= 0) && !mp1.IsPlaying
 *        && !mp0.IsInitiatingFade → mp0.FadeResume()
 * The decompiled build's two players share XNA's static MediaPlayer, so there a ForceSwitch fade could never be
 * overridden; with one element per player a running fade timer also blocks the resume (else a ForceSwitch that has
 * reached silence would be turned into a FadeResume of the old song).
 */
export function ambientMusicAction(ambientPlaying: boolean, zoomFactor: number, timeRunning: boolean, music: MusicState, stingPlaying: boolean): AmbientMusicAction {
    if (ambientPlaying && music.isPlaying && !music.isInitiatingFade && zoomFactor < AMBIENT_MAX_FACTOR) return 'fadePause';
    if (
        timeRunning &&
        (!ambientPlaying || zoomFactor >= AMBIENT_MAX_FACTOR) &&
        (!music.isPlaying || music.actualVolume <= 0.0) &&
        !stingPlaying &&
        !music.isInitiatingFade &&
        !music.fadeTimerRunning
    ) {
        return 'fadeResume';
    }
    return null;
}

interface ScreenPoint {
    x: number;
    y: number;
}

function toScreen(view: SoundView, wx: number, wy: number): ScreenPoint {
    // (int)((x - num) / double_0) + Width / 2
    return {
        x: Math.trunc((wx - view.x) * view.zoom) + Math.trunc(view.width / 2),
        y: Math.trunc((wy - view.y) * view.zoom) + Math.trunc(view.height / 2),
    };
}

/** MainView.1.cs:883 on-screen test (object within 50 px of the viewport; the C# adds the drawn image size). */
function onScreen(view: SoundView, p: ScreenPoint, margin: number): boolean {
    return p.x >= -margin && p.x <= view.width + margin && p.y >= -margin && p.y <= view.height + margin;
}

export interface MainViewSoundResult {
    /** Requests made this frame, in draw order. */
    requests: SoundEffectRequest[];
    /** method_91 ran past its `currentStarDate <= long_0` early return: the ambient flag, else null. */
    ambientPlaying: boolean | null;
}

/**
 * Per-frame Main View sound pass. One instance per game view (its render-only timers live here).
 */
export class MainViewSounds {
    // MainView.cs:473 long_0: star date of the next ambient voice.
    private nextAmbientStarDate = 0;
    // Habitat.NextSoundTime (stars and planet shipyards).
    private habitatNextSound = new WeakMap<Habitat, number>();
    // BuiltObject.NextSoundTimeConstruction / Mining / GasMining.
    private nextConstruction = new WeakMap<BuiltObject, number>();
    private nextMining = new WeakMap<BuiltObject, number>();
    private nextGasMining = new WeakMap<BuiltObject, number>();
    // MainView.cs int_5 / dateTime_1: lightning flicker state.
    private lightningStep = 0;
    private lightningTime = 0;
    private lightningRandom: Random;
    /** MainView.cs:3356 the current system (Main.int_28), cached by nearest-system search. */
    private lastSystemIndex = -1;

    constructor(private player: EffectsPlayer, seed = Date.now() & 0x7fffffff) {
        this.lightningRandom = new Random(seed);
    }

    /**
     * Walk the view like MainView.1.cs's XNA draw (lines 70-1560) and collect the sound requests.
     * `now` = Galaxy.CurrentDateTime (game ms), `starDate` = Galaxy.CurrentStarDate.
     */
    collect(galaxy: Galaxy, view: SoundView, viewer: Empire | null, now: number, starDate: number, godMode = false): MainViewSoundResult {
        const out: SoundEffectRequest[] = [];
        const f = 1 / view.zoom; // main_0.double_0
        const req = (r: SoundEffectRequest | null): void => {
            if (r !== null) out.push(r);
        };
        const bd = (p: ScreenPoint): { balance: number; distance: number } => resolveBalanceAndDistance(p.x, p.y, view.width, view.height, f);
        // MainView.cs:672 double_9: half the view diagonal in px.
        const double9 = Math.sqrt(Math.pow(view.width / 2, 2) + Math.pow(view.height / 2, 2));

        // MainView.1.cs:94-139: nebula lightning (thunder) at the view centre.
        if (f < LIGHTNING_MAX_FACTOR) {
            const nebulae = determineGalaxyLocationsInRangeAtPoint(galaxy, view.x, view.y, double9 * f, GalaxyLocationType.NebulaCloud);
            const lightning = nebulae.some((l) => l.effect === GalaxyLocationEffectType.LightningDamage);
            if (lightning) this.lightning(now, view, f, req);
        }

        if (f < SOUND_OBJECT_MAX_FACTOR) {
            // MainView.1.cs:442-851: habitats of the current system (int_28..int_29).
            const system = this.currentSystem(galaxy, view);
            if (system !== null) {
                const habitats: Habitat[] = [system.systemStar, ...system.habitats.filter((h) => h !== system.systemStar)];
                for (const h of habitats) {
                    if (h === null || h === undefined) continue;
                    const p = toScreen(view, h.xpos, h.ypos);
                    // MainView.1.cs:476-829: the near-screen branch (drawn) calls method_92.
                    if (!onScreen(view, p, 800)) continue;
                    this.habitatSounds(galaxy, h, p, viewer, starDate, bd, req);
                    // method_169 / method_171: the Giant Ion Cannon's shot.
                    if (h.giantIonCannonPresent && h.giantIonCannon !== null) this.weaponSound(h.giantIonCannon, p, bd, req);
                    // method_180 (Habitat.Explosions) and method_187 (Habitat.Explosion: planet destroyed).
                    const exps = h.explosions as Explosion[] | null;
                    if (exps !== null && exps.length > 0) this.explosions(h.xpos, h.ypos, exps, view, f, bd, req);
                    const planetExp = h.explosion as Explosion | null;
                    if (planetExp !== null && !planetExp.explosionSoundPlayed) {
                        const ep = this.explosionPoint(h.xpos, h.ypos, planetExp, view, f);
                        const b = bd(ep);
                        req(this.player.resolvePlanetExplosion(planetExp.explosionSize, b.balance, b.distance));
                        planetExp.explosionSoundPlayed = true;
                    }
                }
            }

            // MainView.1.cs:864-887: built objects near the screen and visible to the viewing empire.
            const fighters: Fighter[] = [];
            for (const bo of galaxy.builtObjects) {
                if (bo === null || bo === undefined || bo.hasBeenDestroyed) continue;
                const p = toScreen(view, bo.xpos, bo.ypos);
                if (!onScreen(view, p, 100)) continue;
                if (!godMode && viewer !== null && !isObjectVisibleToThisEmpire(galaxy, viewer, bo)) continue;
                // MainView.1.cs:1161-1176: ion strike (within 1400 ms of the hit).
                if (bo.lastIonStrike > MIN_TIME && now - bo.lastIonStrike < 1400.0 && !bo.ionStrikeSoundPlayed) {
                    bo.ionStrikeSoundPlayed = true;
                    const b = bd(p);
                    req(this.player.resolveIonStrike(b.balance, b.distance));
                }
                // MainView.1.cs:1302 method_97 (hyperjump) and 1303 method_95 (construction / mining / gas mining).
                this.hyperjump(bo, p, bd, req);
                this.industry(bo, p, starDate, bd, req);
                // MainView.1.cs:1304-1311: explosions (method_183) then weapons (method_167 → method_171).
                const exps = bo.explosions as Explosion[];
                if (exps.length > 0) this.explosions(bo.xpos, bo.ypos, exps, view, f, bd, req);
                for (const w of bo.weapons) this.weaponSound(w, p, bd, req);
                // Galaxy.GetFightersForBuiltObjects(builtObjectsAtLocation).
                if (bo.fighters !== null) for (const fi of bo.fighters as Fighter[]) if (fi != null) fighters.push(fi);
            }

            // MainView.1.cs:1380-1557: fighters near the screen.
            for (const fighter of fighters) {
                const p = toScreen(view, fighter.xpos, fighter.ypos);
                if (!onScreen(view, p, 100)) continue;
                // method_184 (explosions) then method_165 (fighter weapons).
                if (fighter.explosions.length > 0) this.explosions(fighter.xpos, fighter.ypos, fighter.explosions, view, f, bd, req);
                for (const w of fighter.weapons) {
                    if (!(w.distanceTravelled >= 0)) continue;
                    if (!w.soundEffectPlayed) {
                        const b = bd(p);
                        w.soundEffectPlayed = true;
                        req(this.player.resolveFighterWeapon(fighter.specification.weaponSoundEffectFilename, w.type, b.balance, b.distance));
                    }
                }
            }
        }

        // MainView.1.cs:1923 method_91(num, num2, double_0): ambient voices of restricted areas near the view centre.
        const ambientPlaying = this.ambient(galaxy, view, f, double9, starDate, req);
        return { requests: out, ambientPlaying };
    }

    // MainView.1.cs:3356 / Main.Part11.cs:1768 method_149: the system nearest the view centre (FastFindNearestSystem).
    private currentSystem(galaxy: Galaxy, view: SoundView): Galaxy['systems'][number] | null {
        const systems = galaxy.systems;
        if (systems.length === 0) return null;
        const last = this.lastSystemIndex >= 0 && this.lastSystemIndex < systems.length ? systems[this.lastSystemIndex] : null;
        // Cheap reuse: stay on the cached system while the view centre is well inside it.
        if (last !== null) {
            const s = last.systemStar;
            const dx = s.xpos - view.x;
            const dy = s.ypos - view.y;
            if (dx * dx + dy * dy < (MAX_SOLAR_SYSTEM_SIZE / 4) * (MAX_SOLAR_SYSTEM_SIZE / 4)) return last;
        }
        let best = -1;
        let bestD = Infinity;
        for (let i = 0; i < systems.length; i++) {
            const s = systems[i].systemStar;
            const dx = s.xpos - view.x;
            const dy = s.ypos - view.y;
            const d = dx * dx + dy * dy;
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        }
        this.lastSystemIndex = best;
        return best >= 0 ? systems[best] : null;
    }

    // Port of MainView.1.cs:2821 method_92 (sound part): stars every 4200 ms, planet/moon shipyards every 4100 ms.
    private habitatSounds(
        galaxy: Galaxy,
        h: Habitat,
        p: ScreenPoint,
        viewer: Empire | null,
        starDate: number,
        bd: (p: ScreenPoint) => { balance: number; distance: number },
        req: (r: SoundEffectRequest | null) => void,
    ): void {
        const next = this.habitatNextSound.get(h) ?? 0;
        if (h.category === HabitatCategoryType.Star) {
            if (starDate > next) {
                const b = bd(p);
                req(this.player.resolveStar(h.type, b.balance, b.distance));
                this.habitatNextSound.set(h, starDate + 4200);
            }
            return;
        }
        if (h.category !== HabitatCategoryType.Planet && h.category !== HabitatCategoryType.Moon) return;
        if (starDate <= next) return;
        const queue = h.constructionQueue as { constructionYards: Array<{ shipUnderConstruction: unknown }> | null } | null;
        const yards = queue?.constructionYards ?? null;
        // ConstructionYardList.CountUnderConstruction: yards with a ship on the slip.
        if (yards === null || !yards.some((y) => y.shipUnderConstruction != null)) return;
        const player = galaxy.playerEmpire;
        if (player === null || !isObjectVisibleToThisEmpire(galaxy, viewer ?? player, h)) return;
        const b = bd(p);
        req(this.player.resolveConstruction(b.balance, b.distance));
        this.habitatNextSound.set(h, starDate + 4100);
        // The construction-spark animation (Galaxy.Rnd angle) is not ported — see the file header.
    }

    // Port of MainView.2.cs:1509 method_171 (sound part): the first frame a shot is drawn.
    private weaponSound(w: Weapon, p: ScreenPoint, bd: (p: ScreenPoint) => { balance: number; distance: number }, req: (r: SoundEffectRequest | null) => void): void {
        if (!(w.distanceTravelled >= 0)) return;
        if (!w.soundEffectPlayed) {
            const b = bd(p);
            w.soundEffectPlayed = true;
            req(this.player.resolveWeapon(w.component.def.soundEffectFilename, b.balance, b.distance));
        }
    }

    // MainView.2.cs:2791-2796 explosion rectangle's top-left (the point method_90 is given).
    private explosionPoint(x: number, y: number, e: Explosion, view: SoundView, f: number): ScreenPoint {
        const size = e.explosionSize;
        return {
            x: Math.trunc((Math.trunc(x + e.explosionOffsetX) - (view.x + Math.trunc(size / 2))) / f) + Math.trunc(view.width / 2),
            y: Math.trunc((Math.trunc(y + e.explosionOffsetY) - (view.y + Math.trunc(size / 2))) / f) + Math.trunc(view.height / 2),
        };
    }

    // Port of MainView.2.cs:2789 method_185 / 2640 method_179 (sound part).
    private explosions(
        x: number,
        y: number,
        list: readonly Explosion[],
        view: SoundView,
        f: number,
        bd: (p: ScreenPoint) => { balance: number; distance: number },
        req: (r: SoundEffectRequest | null) => void,
    ): void {
        for (const e of list.slice()) {
            if (e.explosionSoundPlayed) continue;
            const b = bd(this.explosionPoint(x, y, e, view, f));
            req(this.player.resolveExplosion(e.explosionSize, b.balance, b.distance));
            e.explosionSoundPlayed = true;
            // TODO(port): screen shake for ExplosionSize > 150 — Main.method_217 (MainView.2.cs:2811).
        }
    }

    // Port of MainView.1.cs:3062 method_97 (sound part).
    private hyperjump(bo: BuiltObject, p: ScreenPoint, bd: (p: ScreenPoint) => { balance: number; distance: number }, req: (r: SoundEffectRequest | null) => void): void {
        if (bo.hyperjumpAboutToEnter && !bo.hyperjumpAboutToEnterSoundPlayed) {
            const b = bd(p);
            req(this.player.resolveHyperjumpEntry(b.balance, b.distance));
            bo.hyperjumpAboutToEnterSoundPlayed = true;
        }
        // No played flag in the C#: requested every frame while HyperjumpJustExited (the sim clears it next tick).
        if (bo.hyperjumpJustExited) {
            const b = bd(p);
            req(this.player.resolveHyperjumpExit(b.balance, b.distance));
        }
    }

    // Port of MainView.1.cs:2932 method_95 (sound part).
    private industry(bo: BuiltObject, p: ScreenPoint, starDate: number, bd: (p: ScreenPoint) => { balance: number; distance: number }, req: (r: SoundEffectRequest | null) => void): void {
        if (bo.doingConstruction && starDate > (this.nextConstruction.get(bo) ?? 0)) {
            const b = bd(p);
            req(this.player.resolveConstruction(b.balance, b.distance));
            this.nextConstruction.set(bo, starDate + 4100);
        }
        if (bo.doingMining && starDate > (this.nextMining.get(bo) ?? 0)) {
            const b = bd(p);
            req(this.player.resolveMining(b.balance, b.distance));
            this.nextMining.set(bo, starDate + 3000);
        }
        if (bo.doingGasMining && starDate > (this.nextGasMining.get(bo) ?? 0)) {
            const b = bd(p);
            req(this.player.resolveGasMining(b.balance, b.distance));
            this.nextGasMining.set(bo, starDate + 5600);
        }
    }

    // Port of MainView.1.cs:2779 method_91 (sound part). Returns the ambient flag, or null on the early return.
    private ambient(galaxy: Galaxy, view: SoundView, f: number, double9: number, starDate: number, req: (r: SoundEffectRequest | null) => void): boolean | null {
        let flag = false;
        if (starDate <= this.nextAmbientStarDate) return null;
        if (f < AMBIENT_MAX_FACTOR) {
            const range = f * double9;
            const list = determineGalaxyLocationsInRangeAtPoint(galaxy, view.x, view.y, range, GalaxyLocationType.RestrictedArea);
            for (const location of list) {
                if (location.soundScheme >= 0) {
                    flag = true;
                    const r = this.player.resolveAmbientEffect(location.soundScheme, 0.0, 200.0);
                    req(r.request);
                    this.nextAmbientStarDate = starDate + r.nextEffectOffset;
                }
            }
        }
        return flag;
    }

    // Port of MainView.cs:1792 method_28 (sound part): the lightning flicker's thunder claps. `now` is
    // Galaxy.CurrentDateTime; the draws use this view's Random, not Galaxy.Rnd.
    private lightning(now: number, view: SoundView, f: number, req: (r: SoundEffectRequest | null) => void): void {
        const spanSeconds = (now - this.lightningTime) / 1000;
        const centre = resolveBalanceAndDistance(Math.trunc(view.width / 2), Math.trunc(view.height / 2), view.width, view.height, f);
        const rnd = this.lightningRandom;
        if (this.lightningStep === 0) {
            const num = rnd.nextDouble() * spanSeconds;
            if (num > 10.0) {
                this.lightningStep = 1;
                this.lightningTime = now;
                req(this.player.resolveThunder(centre.balance, centre.distance));
            }
        } else if (this.lightningStep % 4 !== 0) {
            if (spanSeconds > 0.08 + rnd.nextDouble() * 0.08) {
                this.lightningStep++;
                this.lightningTime = now;
                if (this.lightningStep > 1 && rnd.next(0, 5) > 1) this.lightningStep = 0;
            }
        } else if (spanSeconds > 0.08 + rnd.nextDouble() * 0.04) {
            this.lightningStep++;
            this.lightningTime = now;
            req(this.player.resolveThunder(centre.balance, centre.distance));
        }
    }
}

/** HabitatType values ResolveStar maps (EffectsPlayer.cs ResolveStar): exported for the wiring table test. */
export const STAR_SOUND_TYPES: readonly HabitatType[] = [
    HabitatType.MainSequence,
    HabitatType.RedGiant,
    HabitatType.SuperGiant,
    HabitatType.WhiteDwarf,
    HabitatType.Neutron,
    HabitatType.BlackHole,
];
