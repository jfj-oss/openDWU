// Ground Report animation (groundReportAnim.ts: ColonyInvasion.cs ProcessExplosions / UpdateInvaderLandingProgress /
// Draw 1508-1559, AnimationSystem.DoAnimations): the timing maths, and on a staged ground battle that the animation
// sees the hits, kills and landings while reading only — the state digest and Galaxy.Rnd are those of the same game
// played without it, in-thread and on the worker replica (no replica writes).
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import { inThread, inWorker, type Side } from './helpers/simWorkerSides';
import type { GameData } from '../src/sim/data/gameData';
import type { Game } from '../src/sim/game';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { HabitatType, type Habitat } from '../src/sim/types';
import { Troop, TroopList, TroopType } from '../src/sim/cargo';
import { buildGroundReport } from '../src/ui/screens/groundReportModel';
import {
    explosionFrameIndex,
    explosionFrameMs,
    explosionSize,
    GroundAnimClock,
    GroundReportAnimator,
    shotImageSize,
    shotProgress,
    type GroundAnimFrame,
} from '../src/ui/screens/groundReportAnim';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 1_800_000);

describe('Ground Report animation maths', () => {
    it('explosion frames, sizes, shot progress (AnimationSystem.DrawAnimatedImages, ProcessExplosions)', () => {
        // (int)(20 / 30 × 1000) = 666, / 19 = 35 ms a frame; 20 frames → done at 700 ms.
        expect(explosionFrameMs()).toBe(35);
        expect(explosionFrameIndex(0)).toBe(0);
        expect(explosionFrameIndex(34.9)).toBe(0);
        expect(explosionFrameIndex(35)).toBe(1);
        expect(explosionFrameIndex(699)).toBe(19);
        expect(explosionFrameIndex(700)).toBe(20);
        expect(shotProgress(1000 / 3)).toBeCloseTo(0.5, 10);
        expect([explosionSize(0, false), explosionSize(0, true), explosionSize(1, false), explosionSize(1, true), explosionSize(2, false), explosionSize(2, true)]).toEqual([40, 100, 56, 140, 75, 188]);
        expect(shotImageSize(30)).toBe(20);
    });

    it('the clock follows game time smoothly and stops with it', () => {
        const c = new GroundAnimClock();
        expect(c.now(1000, 0)).toBe(1000);
        // The sim advances 100 game ms every 100 real ms: the clock runs at that rate in between.
        c.now(1100, 100);
        c.now(1200, 200);
        const mid = c.now(1200, 250);
        expect(mid).toBeGreaterThan(1200);
        expect(mid).toBeLessThanOrEqual(1250 + 1e-9);
        // Paused: the sim time stays, the clock stops within 400 ms + 250 ms lead.
        let last = 0;
        for (let t = 300; t < 2000; t += 50) last = c.now(1200, t);
        expect(c.now(1200, 3000)).toBe(last);
        expect(last).toBeLessThanOrEqual(1450);
    });
});

/** A ground battle on the most populous independent colony: three defenders (one artillery, two worn), four player invaders. */
function stage(game: Game): Habitat {
    const g = game.galaxy;
    const p = g.playerEmpire!;
    const ind = g.independentEmpire!;
    const colony = [...g.independentColonies].filter((h) => h.population.totalAmount > 0).sort((a, b) => b.population.totalAmount - a.population.totalAmount)[0];
    const mk = (e: Empire, type: TroopType, attack: number, defend: number, readiness = 100): Troop => new Troop('t', type, attack, defend, 100, readiness, e, e.dominantRace);
    colony.troops = new TroopList();
    colony.invadingTroops = new TroopList();
    colony.invasionStats = null;
    for (const d of [mk(ind, TroopType.Infantry, 50, 300, 15), mk(ind, TroopType.Infantry, 50, 300, 15), mk(ind, TroopType.Artillery, 80, 200)]) {
        d.colony = colony;
        colony.troops.add(d);
    }
    for (let i = 0; i < 4; i++) {
        const a = mk(p, i === 3 ? TroopType.Armored : TroopType.Infantry, 121, 100);
        a.colony = colony;
        colony.invadingTroops.add(a);
        p.troops.add(a);
    }
    return colony;
}

/** A damaged reinforcement lands (as a landing hit leaves it). */
function reinforce(g: Galaxy, colony: Habitat): void {
    const p = g.playerEmpire!;
    const a = new Troop('r', TroopType.Infantry, 121, 100, 100, 60, p, p.dominantRace);
    a.colony = colony;
    colony.invadingTroops!.add(a);
    p.troops.add(a);
}

const STEPS = 3600; // 60 game seconds: about five battle resolves (one a PERIODIC_PROCESSING_SPAN_MS)
const REINFORCE_AT = 300;

interface Seen {
    explosions: number;
    shots: number;
    pods: number;
    large: number;
}

/** Play the staged battle; with `watch` an open Ground Report's animation runs on the side's (UI) galaxy each frame. */
function play(side: Side, colonyIndex: number, watch: boolean): { digest: string; rnd: string; seen: Seen } {
    const seen: Seen = { explosions: 0, shots: 0, pods: 0, large: 0 };
    const view = (): Habitat => side.galaxy.habitats[colonyIndex];
    let anim: GroundReportAnimator | null = null;
    const relayout = (): void => {
        const c = view();
        anim!.setModel(buildGroundReport({ galaxy: side.galaxy, colony: c, panelSize: 0, habitatTypeName: HabitatType[c.type] }));
    };
    if (watch) {
        anim = new GroundReportAnimator(view(), side.galaxy.nowMs);
        relayout();
    }
    for (let i = 0; i < STEPS; i++) {
        if (i === REINFORCE_AT) reinforce(side.real, side.real.habitats[colonyIndex]);
        side.tick();
        if (anim === null) continue;
        if (i % 30 === 0) side.settle(); // the open panel's refresh request, about once a second
        const now = side.galaxy.nowMs;
        if (anim.observe(now) || i % 15 === 0) relayout();
        const f: GroundAnimFrame = anim.frame(now);
        seen.explosions += f.explosions.length;
        seen.shots += f.shots.length;
        seen.pods += f.pods.length;
        seen.large += f.explosions.filter((e) => e.size === 100).length;
    }
    return { digest: side.digest(), rnd: JSON.stringify(side.real.rnd.getState()), seen };
}

describe('Ground Report animation on a staged battle', () => {
    it('in-thread: hits, kills and a landing pod animate; digest and Rnd as without the view', () => {
        const a = cachedTickGame(gameData);
        const b = cachedTickGame(gameData);
        const ci = stage(a).habitatIndex;
        expect(stage(b).habitatIndex).toBe(ci);
        const colonyIndex = a.galaxy.habitats.findIndex((h) => h.habitatIndex === ci);
        const watched = play(inThread(a), colonyIndex, true);
        const plain = play(inThread(b), colonyIndex, false);
        expect(watched.digest).toBe(plain.digest);
        expect(watched.rnd).toBe(plain.rnd);
        expect(watched.seen.explosions).toBeGreaterThan(0);
        expect(watched.seen.shots).toBeGreaterThan(0);
        expect(watched.seen.pods).toBeGreaterThan(0);
        expect(watched.seen.large).toBeGreaterThan(0);
    }, 600000);

    it('worker replica: the same animation reads the replica and writes nothing', () => {
        const a = cachedTickGame(gameData);
        const b = cachedTickGame(gameData);
        const ci = stage(a).habitatIndex;
        stage(b);
        const colonyIndex = a.galaxy.habitats.findIndex((h) => h.habitatIndex === ci);
        const side = inWorker(a, gameData);
        try {
            const watched = play(side, colonyIndex, true);
            expect(side.replicaWrites()).toEqual([]);
            const plain = play(inThread(b), colonyIndex, false);
            expect(watched.digest).toBe(plain.digest);
            expect(watched.rnd).toBe(plain.rnd);
            expect(watched.seen.explosions).toBeGreaterThan(0);
            expect(watched.seen.pods).toBeGreaterThan(0);
        } finally {
            side.dispose();
        }
    }, 600000);
});
