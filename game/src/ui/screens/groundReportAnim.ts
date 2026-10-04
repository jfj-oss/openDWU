// Ground Report animation, pure part: the explosions, weapon shots and landing pods of the original's ground
// invasion view (DistantWorlds.Types/ColonyInvasion.cs AddExplosionCore 490, ProcessExplosions 514, ResolveLocation
// 605, CheckInvaderLandingOffset 641, AddInvaderLanding 666, AddInvaderLandingExplosion 688,
// UpdateInvaderLandingProgress 713, ResolveLocationDefendingPopulationForExplosion 830, Draw 1110 / 1508-1559;
// DistantWorlds.Types/AnimationSystem.cs DoAnimations / DrawAnimatedImages). No DOM; groundReport.ts draws the result.
//
// Purely visual. In the C# the battle code itself feeds the view (Habitat.cs 3171 / 3219 / 3491 / 3538 / 3902-4244 /
// 4996 / 5035 AddExplosion, BuiltObject.1.cs 2841-2877 and BuiltObject.2.cs 2349-2396 AddInvaderLanding[Explosion]) and
// picks every firer with Galaxy.Rnd, and the open view drives that colony's battle (see groundReportModel.ts). Here
// the battle stays in the tick and the view only reads: the animator diffs the colony's troops, characters, facilities
// and population between looks and turns each change into the call the battle code would have made —
//   a troop's readiness fell        → AddExplosion(troop, isLarge: false, firer)        (InflictTroopLosses 4996,
//                                                                                       AttemptToDamagePlanetaryDefenseUnits 3171)
//   a troop vanished during a fight → AddExplosion(troop, isLarge: true, firer)         (InflictTroopLosses 5035, 3182)
//   a character vanished in a fight → AddExplosion(character, isLarge: true, null)      (ResolveInvasionBattles 3538 / 3902-4131)
//   a facility vanished in a fight  → AddExplosion(facility, isLarge: true, firer)      (AttemptToDestroyFacility 3219, 4244)
//   the population fell while invaded → AddExplosion(population item, isLarge: false, firer) per item (3491)
//   a new invading troop / character → AddInvaderLanding (the pod descends from the right edge in 4 s of game time),
//     and when the troop arrived damaged (the landing-hit chance struck, BuiltObject.1.cs 2845-2866) also
//     AddInvaderLandingExplosion at 0.3 + 0.45 × NextDouble of the descent with a defending artillery as the firer.
// The firers the C# draws from Galaxy.Rnd (a random troop of the other side) and the 0.3-0.75 landing-hit point come
// from `pickRnd`, a render-local System.Random; ProcessExplosions' explosion set and the population slot come from
// `fxRnd = new Random(Colony.HabitatIndex)` as BindData seeds the view's own _Rnd. Neither is galaxy.rnd.
// The tick resolves a colony's battle every PERIODIC_PROCESSING_SPAN_MS (10 s) of game time where the open C# view
// resolved it about every second (ColonyInvasionPanel.CheckUpdateBattle: Update once ≥ 1 s of game time passed), so a
// hit seen during a fight stands for the HITS_PER_RESOLVE rounds the view would have fought in that time: that many
// small explosions, one about every second over the next HIT_SPREAD_MS (visual only). Kills and landings start at once. The landing progress is kept
// per object (the C# keys it by Name). Animation time is game time (the C# Draw takes Galaxy.CurrentDateTime): it
// stops while paused and runs faster at higher game speeds.

import { Random } from '../../sim/random';
import { Troop, TroopType } from '../../sim/cargo';
import type { Habitat } from '../../sim/types';
import type { Character } from '../../sim/characters';
import { habitatInvadingCharacterList, stellarObjectCharacters } from '../../sim/characters';
import type { PlanetaryFacility } from '../../sim/construction/facilities';
import { HEADER_SIZE, STATUS_BAR_AREA_HEIGHT, type GroundReportModel, type GrRect } from './groundReportModel';

/** Main.Part12.cs LoadEffectsExplosion: bitmap_19 = the 20 effects/explosions folders, 20 frames each. */
export const EXPLOSION_SET_COUNT = 20;
export const EXPLOSION_FRAME_COUNT = 20;
/** ProcessExplosions 600: new Animation(images, time, 30, ...). */
export const EXPLOSION_FPS = 30;
/** UpdateInvaderLandingProgress 724: the progress falls by 0.25 a second (1 → 0 in 4 s). */
export const LANDING_RATE_PER_SECOND = 0.25;
/** The tick's battle cadence (simTime.ts PERIODIC_PROCESSING_SPAN_MS): one resolve's small hits are spread over it. */
export const HIT_SPREAD_MS = 10000;
/** The C# view's rounds (≥ 1 s of game time each) in one tick resolve. */
export const HITS_PER_RESOLVE = HIT_SPREAD_MS / 1000;
/** A readiness drop smaller than this is float noise, not a hit. */
const READINESS_EPSILON = 0.001;

/** AnimationSystem.DrawAnimatedImages: ms per frame = (int)(n / fps × 1000) / Math.Max(1, n − 1) (int division). */
export function explosionFrameMs(frames = EXPLOSION_FRAME_COUNT, fps = EXPLOSION_FPS): number {
    return Math.trunc(Math.trunc((frames / fps) * 1000) / Math.max(1, frames - 1));
}

/** DrawAnimatedImages: Math.Max(0, (int)elapsed.TotalMilliseconds / num1); ≥ frames: the animation is over. */
export function explosionFrameIndex(elapsedMs: number, frames = EXPLOSION_FRAME_COUNT, fps = EXPLOSION_FPS): number {
    return Math.max(0, Math.trunc(Math.trunc(elapsedMs) / explosionFrameMs(frames, fps)));
}

/** Draw 1512: the shot's progress from the firer to the explosion, elapsed / (n / fps × 1000). */
export function shotProgress(elapsedMs: number, frames = EXPLOSION_FRAME_COUNT, fps = EXPLOSION_FPS): number {
    return elapsedMs / ((frames / fps) * 1000.0);
}

/** ProcessExplosions 557-596: the explosion size by PanelSize (large: a destroyed unit). */
export function explosionSize(panelSize: number, isLarge: boolean): number {
    switch (panelSize) {
        case 1:
            return isLarge ? 140 : 56;
        case 2:
            return isLarge ? 188 : 75;
        default:
            return isLarge ? 100 : 40;
    }
}

/** InitializeImages 324 / ResizeWeaponImages 344: the shot images are (int)(TroopSize.Width × 0.67) square. */
export function shotImageSize(troopSize: number): number {
    return Math.trunc(troopSize * 0.67);
}

/** What an explosion is attached to: an object (resolved when it starts) or an already resolved rectangle. */
type ExplosionItem = Troop | Character | PlanetaryFacility | GrRect | 'population';

interface PendingExplosion {
    item: ExplosionItem;
    isLarge: boolean;
    firer: Troop | null;
    /** Game ms at which ProcessExplosions takes it (now, or later for a spread hit). */
    atMs: number;
}

/** AnimationSystem's Animation: one explosion, with the firer (ExtraData) its shot flies from. */
interface ExplosionAnimation {
    set: number;
    startMs: number;
    x: number;
    y: number;
    size: number;
    firer: Troop | null;
}

export interface GroundAnimPod {
    obj: Troop | Character;
    rect: GrRect;
    /** Readiness for the 2 px bar (troops), else null. */
    readiness: number | null;
    /** The alpha-32 empire colour fill behind a character (Draw 1452), else null. */
    fill: number | null;
}

export interface GroundAnimShot {
    /** The weapon picture: the firer's type (Infantry / PirateRaider share one). */
    type: TroopType;
    /** The centre the rotated picture is drawn round, and the rotation (radians, screen y down). */
    cx: number;
    cy: number;
    angle: number;
    size: number;
}

export interface GroundAnimExplosion {
    set: number;
    frame: number;
    x: number;
    y: number;
    size: number;
}

export interface GroundAnimFrame {
    pods: GroundAnimPod[];
    shots: GroundAnimShot[];
    explosions: GroundAnimExplosion[];
    /** A pod landed this frame: the static layer shows the troop picture again (re-render). */
    landed: boolean;
}

/** What the view looked like at the last look (the diff baseline). */
interface Snapshot {
    defenders: Map<Troop, number>;
    invaders: Map<Troop, number>;
    characters: Set<Character>;
    invadingCharacters: Set<Character>;
    facilities: Set<PlanetaryFacility>;
    population: number;
    battle: boolean;
}

/** A game-time clock for the animation that advances smoothly between sim steps / worker deltas (real-time
 *  frames × the measured game-ms per real-ms), never runs backwards, and stops when the game time stops. */
export class GroundAnimClock {
    private anim = Number.NaN;
    private lastSim = Number.NaN;
    private lastSimChangeReal = 0;
    private lastReal = 0;
    /** Game ms per real ms, measured. */
    private rate = 0;
    /** Real ms between changes of the sim time (a step in-thread, a delta in worker mode), measured. */
    private interval = 50;

    now(simNowMs: number, realMs: number): number {
        if (Number.isNaN(this.anim) || simNowMs < this.lastSim - 5000 || Math.abs(simNowMs - this.anim) > 5000) {
            // First look, or a load / jump: start at the sim's time.
            this.anim = simNowMs;
            this.lastSim = simNowMs;
            this.lastSimChangeReal = realMs;
            this.lastReal = realMs;
            this.rate = 0;
            return this.anim;
        }
        if (simNowMs !== this.lastSim) {
            const dt = realMs - this.lastSimChangeReal;
            if (dt > 0) {
                const measured = Math.min(1000, Math.max(0, (simNowMs - this.lastSim) / dt));
                this.rate = this.rate === 0 ? measured : this.rate * 0.7 + measured * 0.3;
                if (dt < 1000) this.interval = this.interval * 0.8 + dt * 0.2;
            }
            this.lastSim = simNowMs;
            this.lastSimChangeReal = realMs;
        } else if (realMs - this.lastSimChangeReal > Math.max(80, 2.5 * this.interval)) {
            this.rate = 0; // paused (or stalled)
        }
        this.anim += Math.max(0, realMs - this.lastReal) * this.rate;
        this.lastReal = realMs;
        // Stay within a step or so of the committed time.
        if (this.anim > simNowMs + 250) this.anim = simNowMs + 250;
        if (this.anim < simNowMs - 1000) this.anim = simNowMs - 1000;
        return this.anim;
    }
}

const isRect = (o: unknown): o is GrRect => typeof o === 'object' && o !== null && 'w' in o && 'h' in o && 'x' in o && 'y' in o;

/**
 * The animation state of one open Ground Report (ColonyInvasion's _ExplodingItems / _AnimationSystem /
 * _InvadersLanding* for the bound colony). `observe` diffs the colony, `frame` advances and lists what to draw.
 */
export class GroundReportAnimator {
    readonly colony: Habitat;
    /** BindData 430: `_Rnd = new Random(_Colony.HabitatIndex)` (explosion set, population slot). */
    private readonly fxRnd: Random;
    /** Render-local stand-in for the Galaxy.Rnd draws the C# battle code makes for the view (firers, hit point). */
    private readonly pickRnd: Random;
    private model: GroundReportModel | null = null;
    private rects = new Map<object, GrRect>();
    private lastRects = new Map<object, GrRect>();
    private prev: Snapshot;
    private pending: PendingExplosion[] = [];
    private animations: ExplosionAnimation[] = [];
    private landing = new Map<Troop | Character, number>();
    private landingHitPoint = new Map<Troop | Character, number>();
    private landingHitFirer = new Map<Troop | Character, Troop | null>();
    private lastLandingUpdate: number;

    constructor(colony: Habitat, nowMs: number) {
        this.colony = colony;
        this.fxRnd = new Random(colony.habitatIndex);
        this.pickRnd = new Random(colony.habitatIndex + 1000003);
        this.prev = this.snapshot();
        this.lastLandingUpdate = nowMs;
    }

    /** The static layer's latest layout (groundReport.ts render): the objects' rectangles, columns and size. */
    setModel(model: GroundReportModel): void {
        this.model = model;
        this.rects = new Map();
        for (const item of model.items) {
            if (item.kind === 'population') continue;
            this.rects.set(item.obj, item.rect);
        }
    }

    /** True while `obj` comes down in its pod (the static layer leaves its picture to the animation). */
    isLanding(obj: object): boolean {
        return this.landing.has(obj as Troop);
    }

    /** Anything to draw or still to come (the DOM part skips idle frames). */
    get busy(): boolean {
        return this.pending.length > 0 || this.animations.length > 0 || this.landing.size > 0;
    }

    private area(): GrRect {
        const size = this.model?.size ?? { w: 0, h: 0 };
        return { x: 0, y: HEADER_SIZE + STATUS_BAR_AREA_HEIGHT, w: size.w, h: size.h - (HEADER_SIZE + STATUS_BAR_AREA_HEIGHT) };
    }

    private snapshot(): Snapshot {
        const c = this.colony;
        const defenders = new Map<Troop, number>();
        for (const t of c.troops?.items ?? []) if (t != null) defenders.set(t, t.readiness);
        const invaders = new Map<Troop, number>();
        for (const t of c.invadingTroops?.items ?? []) if (t != null) invaders.set(t, t.readiness);
        const characters = new Set<Character>((stellarObjectCharacters(c) ?? []).filter((x): x is Character => x != null));
        const invadingCharacters = new Set<Character>((habitatInvadingCharacterList(c) ?? []).filter((x): x is Character => x != null));
        const facilities = new Set<PlanetaryFacility>(((c.facilities ?? []) as (PlanetaryFacility | null)[]).filter((x): x is PlanetaryFacility => x != null));
        return {
            defenders,
            invaders,
            characters,
            invadingCharacters,
            facilities,
            population: c.population?.totalAmount ?? 0,
            battle: invaders.size > 0 || invadingCharacters.size > 0,
        };
    }

    private pick<T>(list: readonly T[]): T | null {
        return list.length > 0 ? list[this.pickRnd.next(0, list.length)] : null;
    }

    private add(item: ExplosionItem, isLarge: boolean, firer: Troop | null, atMs: number): void {
        // AddExplosionCore 490: a large explosion's place is resolved at once (the object is about to go).
        if (isLarge && !isRect(item)) {
            const r = this.lastRects.get(item as object) ?? this.resolve(item);
            if (r === null) return;
            item = r;
        }
        this.pending.push({ item, isLarge, firer, atMs });
    }

    /**
     * Diff the colony against the last look and queue the explosions / landings the battle code would have reported.
     * Returns true when the lists changed (the static layer should re-render now). Reads only.
     */
    observe(nowMs: number): boolean {
        const prev = this.prev;
        const cur = this.snapshot();
        const battle = cur.battle || prev.battle;
        const curDefenders = [...cur.defenders.keys()];
        const curInvaders = [...cur.invaders.keys()];
        let changed = false;
        // A hit in a fight: one small explosion per round the C# view would have fought (see the header), each with
        // its own firer, one round apart with a random offset; outside a fight (bombardment) a single one at once.
        const hits = (item: ExplosionItem, firers: readonly Troop[]): void => {
            const n = cur.battle ? HITS_PER_RESOLVE : 1;
            for (let k = 0; k < n; k++) {
                const at = n === 1 ? nowMs : nowMs + ((k + this.pickRnd.nextDouble()) * HIT_SPREAD_MS) / n;
                this.add(item, false, this.pick(firers), at);
            }
        };

        for (const [t, r] of cur.defenders) {
            const before = prev.defenders.get(t);
            if (before === undefined) {
                changed = true; // a recruit, a reinforcement, or the invaders becoming the garrison
                continue;
            }
            if (r < before - READINESS_EPSILON) hits(t, curInvaders);
        }
        for (const [t, r] of cur.invaders) {
            const before = prev.invaders.get(t);
            if (before !== undefined) {
                if (r < before - READINESS_EPSILON) hits(t, curDefenders);
                continue;
            }
            changed = true;
            if (prev.defenders.has(t)) continue;
            // AddInvaderLanding; a damaged arrival was hit on the way down (AddInvaderLandingExplosion).
            this.landing.set(t, 1);
            if (r < 100 - READINESS_EPSILON) {
                this.landingHitPoint.set(t, 0.3 + this.pickRnd.nextDouble() * 0.45);
                this.landingHitFirer.set(t, this.pick(curDefenders.filter((d) => d.type === TroopType.Artillery)));
            }
        }
        const gone = (t: Troop): boolean => !cur.defenders.has(t) && !cur.invaders.has(t);
        for (const t of prev.defenders.keys()) {
            if (!gone(t)) continue;
            changed = true;
            // Loaded onto a ship (Troop.BuiltObject set) is not a loss; outside a fight nothing explodes.
            if (battle && t.builtObject === null) this.add(t, true, this.pick(curInvaders), nowMs);
        }
        for (const t of prev.invaders.keys()) {
            if (!gone(t)) continue;
            changed = true;
            if (battle && t.builtObject === null) this.add(t, true, this.pick(curDefenders), nowMs);
        }
        for (const ch of cur.invadingCharacters) {
            if (prev.invadingCharacters.has(ch)) continue;
            changed = true;
            if (!prev.characters.has(ch)) this.landing.set(ch, 1);
        }
        for (const ch of [...prev.characters, ...prev.invadingCharacters]) {
            if (cur.characters.has(ch) || cur.invadingCharacters.has(ch)) continue;
            changed = true;
            if (battle) this.add(ch, true, null, nowMs);
        }
        for (const f of prev.facilities) {
            if (cur.facilities.has(f)) continue;
            changed = true;
            if (battle) this.add(f, true, this.pick(curInvaders.filter((t) => t.type === TroopType.SpecialForces)), nowMs);
        }
        if (cur.characters.size !== prev.characters.size || cur.facilities.size !== prev.facilities.size) changed = true;
        // 3470-3498: every population item takes a hit when the invaders kill people.
        if (cur.battle && cur.population < prev.population) {
            const n = this.colony.population?.items.length ?? 0;
            for (let i = 0; i < n; i++) hits('population', curInvaders);
        }
        // Pending hits on objects that are gone are dropped when they come up (resolve fails).
        for (const o of this.landing.keys()) {
            if (!cur.invaders.has(o as Troop) && !cur.invadingCharacters.has(o as Character)) this.endLanding(o);
        }
        this.prev = cur;
        // The places of everything present, for the large explosion when it goes.
        this.lastRects = new Map();
        for (const o of [...cur.defenders.keys(), ...cur.invaders.keys(), ...cur.characters, ...cur.invadingCharacters, ...cur.facilities]) {
            const r = this.resolve(o);
            if (r !== null) this.lastRects.set(o, r);
        }
        return changed;
    }

    private endLanding(o: Troop | Character): void {
        this.landing.delete(o);
        this.landingHitPoint.delete(o);
        this.landingHitFirer.delete(o);
    }

    /** CheckInvaderLandingOffset 641. */
    private landingOffset(o: object): number {
        return this.landing.get(o as Troop) ?? 0;
    }

    /**
     * ResolveLocation 605 (+ ResolveLocationAttacking* landing offsets, ResolveLocationDefendingPopulationForExplosion):
     * the rectangle of `item` now, or null when it is not on the view (the C#'s Rectangle.Empty).
     */
    resolve(item: ExplosionItem): GrRect | null {
        if (isRect(item)) return item;
        const m = this.model;
        if (m === null) return null;
        const area = this.area();
        if (item === 'population') {
            // 830: one of 1 + Population / 1e9 slots, by _Rnd.
            const pop = this.colony.population;
            if (pop == null) return null;
            const maxValue = 1 + Math.trunc(pop.totalAmount / 1000000000);
            const size = m.columns.population;
            const num1 = Math.trunc((area.h - size) / maxValue);
            const num2 = this.fxRnd.next(0, maxValue);
            return { x: m.columns.populationX, y: area.y + Math.trunc(num1 / 2) + num1 * num2, w: size, h: size };
        }
        const r = this.rects.get(item);
        if (r === undefined) return null;
        const p = this.landingOffset(item);
        if (p <= 0) return r;
        // ResolveLocationAttackingTroop 1057 / ResolveLocationAttackingCharacter 822: x + p × (area.Right − x);
        // special forces keep their column (the pod still shows).
        if (item instanceof Troop && item.type === TroopType.SpecialForces) return r;
        const right = area.x + area.w;
        return { x: r.x + Math.trunc(p * (right - r.x)), y: r.y, w: r.w, h: r.h };
    }

    /** UpdateInvaderLandingProgress 713. Returns true when a pod came down. */
    private updateLanding(nowMs: number): boolean {
        const seconds = Math.max(0, nowMs - this.lastLandingUpdate) / 1000;
        this.lastLandingUpdate = nowMs;
        let landed = false;
        for (const [o, num1] of [...this.landing]) {
            const num3 = num1 - seconds * LANDING_RATE_PER_SECOND;
            const point = this.landingHitPoint.get(o);
            if (point !== undefined && num1 >= point && point >= num3) {
                const r = this.resolve(o);
                if (r !== null) this.pending.push({ item: r, isLarge: false, firer: this.landingHitFirer.get(o) ?? null, atMs: nowMs });
                this.landingHitPoint.delete(o);
                this.landingHitFirer.delete(o);
            }
            if (num3 > 0) this.landing.set(o, num3);
            else {
                this.endLanding(o);
                landed = true;
            }
        }
        return landed;
    }

    /** ProcessExplosions 514: start the explosions that are due. */
    private processExplosions(nowMs: number): void {
        if (this.pending.length === 0 || this.model === null) return;
        const keep: PendingExplosion[] = [];
        for (const e of this.pending) {
            if (e.atMs > nowMs) {
                keep.push(e);
                continue;
            }
            const rect = this.resolve(e.item);
            if (rect === null) continue;
            const size = explosionSize(this.model.panelSize, e.isLarge);
            const x = rect.x + Math.trunc(rect.w / 2) - Math.trunc(size / 2);
            const y = rect.y + Math.trunc(rect.h / 2) - Math.trunc(size / 2);
            this.animations.push({ set: this.fxRnd.next(0, EXPLOSION_SET_COUNT), startMs: nowMs, x, y, size, firer: e.firer });
        }
        this.pending = keep;
    }

    /** Draw 1110 / 1508-1559 + DoAnimations: advance to `nowMs` and list the pods, shots and explosions to draw. */
    frame(nowMs: number): GroundAnimFrame {
        const out: GroundAnimFrame = { pods: [], shots: [], explosions: [], landed: false };
        out.landed = this.updateLanding(nowMs);
        const m = this.model;
        if (m === null) return out;
        // The pods (Draw 1404-1407 / 1444-1447: the assault pod picture while landing).
        for (const o of this.landing.keys()) {
            const r = this.resolve(o);
            if (r === null) continue;
            const isTroop = o instanceof Troop;
            out.pods.push({
                obj: o,
                rect: r,
                readiness: isTroop ? o.readiness : null,
                fill: isTroop ? null : ((o as Character).empire?.mainColor ?? null),
            });
        }
        this.processExplosions(nowMs);
        // 1508-1556: each explosion's shot, from the firer's centre towards the explosion's as the explosion plays.
        const shotSize = shotImageSize(m.columns.troop);
        for (const a of this.animations) {
            if (a.firer === null) continue;
            const r = this.resolve(a.firer);
            if (r === null) continue; // the C# would fly it from (0, 0)
            const p1x = Math.trunc(a.x) + Math.trunc(a.size / 2);
            const p1y = Math.trunc(a.y) + Math.trunc(a.size / 2);
            const p2x = r.x + Math.trunc(r.w / 2);
            const p2y = r.y + Math.trunc(r.h / 2);
            const t = shotProgress(nowMs - a.startMs);
            const num15 = p2x - Math.trunc((p2x - p1x) * t);
            const num16 = p2y - Math.trunc((p2y - p1y) * t);
            const angle = Math.atan2(p1y - p2y, p1x - p2x); // Galaxy.DetermineAngle(p2, p1)
            // GraphicsHelper.RotateImage grows the bitmap to the rotated bounds and it is drawn at the unrotated
            // top-left, so the picture's centre sits half the growth right / down of the point.
            const bound = Math.max(1, Math.ceil(shotSize * (Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle)))));
            const left = num15 - Math.trunc(shotSize / 2);
            const top = num16 - Math.trunc(shotSize / 2);
            out.shots.push({ type: a.firer.type, cx: left + bound / 2, cy: top + bound / 2, angle, size: shotSize });
        }
        // DoAnimations: the frame by elapsed time; finished ones go.
        const alive: ExplosionAnimation[] = [];
        for (const a of this.animations) {
            const frame = explosionFrameIndex(nowMs - a.startMs);
            if (frame >= EXPLOSION_FRAME_COUNT) continue;
            alive.push(a);
            out.explosions.push({ set: a.set, frame, x: Math.trunc(a.x), y: Math.trunc(a.y), size: a.size });
        }
        this.animations = alive;
        return out;
    }
}
