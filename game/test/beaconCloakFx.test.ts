// beaconCloakFx.ts: the Watchers' cloak visuals (render only): the reveal's pace, the lights' gate, the sightings' fade.
import { describe, expect, it } from 'vitest';
import { CLOAK_RECLOAK_S, CLOAK_TRANSITION_S, CONTACT_NAME, DECLOAK_HIT_S, PULSE_FAR, isCloakedContact, isCloakedContactFleet, cloakGlow, cloakLightGate, cloakStep, decloaksSince, noteDecloak, pulseLevel, watcherSightings, type DecloakEvent } from '../src/render/beaconCloakFx';
import { unidentifiedContactInfo, rowText } from '../src/ui/selectionInfo';
import { enemyTargetItems } from '../src/ui/leftSidebar';
import { pulseRing, pulseVignette } from '../src/render/beaconPulseFx';
import { DECLOAK_REST_S, POPUP_DUCK, POPUP_LOOP_END_S, decloakAllowed } from '../src/audio/beaconDecloak';
import { BuiltObject } from '../src/sim/builtObject';
import { ShipGroup } from '../src/sim/fleets/shipGroup';
import type { Empire } from '../src/sim/empire';

describe('the Watchers\' cloak (render only)', () => {
    it('a decloak / re-cloak takes CLOAK_TRANSITION_S; the engines come up late, the lights last', () => {
        expect(CLOAK_TRANSITION_S).toBe(10);
        expect(CLOAK_RECLOAK_S).toBeGreaterThanOrEqual(4);
        expect(CLOAK_RECLOAK_S).toBeLessThanOrEqual(5);
        let r = 0;
        let t = 0;
        while (r < 1 && t < 10) {
            r = cloakStep(r, 1, 0.05);
            t += 0.05;
        }
        expect(t).toBeCloseTo(CLOAK_TRANSITION_S, 1);
        expect(cloakStep(1, 0, CLOAK_RECLOAK_S / 2)).toBeCloseTo(0.5, 9);
        expect(cloakGlow(0.4)).toBe(0);
        expect(cloakGlow(1)).toBe(1);
        expect(cloakLightGate(0.7, 3.1, 2)).toBe(0);
        expect(cloakLightGate(1, 3.1, 2)).toBe(1);
        let on = 0;
        for (let i = 0; i < 200; i++) on += cloakLightGate(0.9, i * 0.013, 5);
        expect(on).toBeGreaterThan(40);
        expect(on).toBeLessThan(160);
    });

    it('a sighting stays where the viewer detected the Watcher, fading out over its seen-through span', () => {
        const viewer = { empireId: 3 } as Empire;
        const w = { xpos: 100, ypos: 200, hasBeenDestroyed: false, cloakSeenBy: [{ empireId: 3, until: 1000 }] } as unknown as BuiltObject;
        const out: { x: number; y: number; fade: number }[] = [];
        expect(watcherSightings([w], viewer, 0, out)).toBe(1);
        expect(out[0].fade).toBeCloseTo(1, 9);
        w.xpos = 5000; // it moves on, the sighting stays put
        expect(watcherSightings([w], viewer, 500, out)).toBe(1);
        expect(out[0].x).toBe(100);
        expect(out[0].fade).toBeCloseTo(0.5, 9);
        expect(watcherSightings([w], { empireId: 4 } as Empire, 1001, out)).toBe(0);
    });

    it('the pulse: by the distance from the camera and the player\'s worlds; nothing far from every player world', () => {
        const S = 2_000_000;
        const home = [{ xpos: 0, ypos: 0 }];
        expect(pulseLevel(0, 0, 0, 0, home, S)).toBe(1);
        // near the player's world, the camera far off: still full
        expect(pulseLevel(S * 0.3, 0, S * 50, 0, home, S)).toBe(1);
        // two sectors out, the camera on it: full (near the camera), but fading by distance from home otherwise
        expect(pulseLevel(S * 2, 0, S * 2, 0, home, S)).toBe(1);
        expect(pulseLevel(S * 2, 0, S * 40, 0, home, S)).toBeGreaterThan(0);
        expect(pulseLevel(S * 2, 0, S * 40, 0, home, S)).toBeLessThan(1);
        // beyond PULSE_FAR sectors of every player world: silent, whatever the camera
        expect(pulseLevel(S * (PULSE_FAR + 0.1), 0, S * (PULSE_FAR + 0.1), 0, home, S)).toBe(0);
        expect(pulseLevel(0, 0, 0, 0, [], S)).toBe(0);
        // the ring runs out and fades; the screen-edge dark is brief
        expect(pulseRing(0).radius).toBe(0);
        expect(pulseRing(1).radius).toBeCloseTo(1, 9);
        expect(pulseRing(1).alpha).toBeCloseTo(0, 9);
        expect(pulseVignette(-0.1)).toBe(0);
        expect(pulseVignette(0.12)).toBeCloseTo(1, 6);
        expect(pulseVignette(3)).toBeLessThan(0.05);
        expect(DECLOAK_HIT_S).toBeCloseTo(1.3, 9);
    });

    it('the decloaks are noted in order for the pulse and its sound; the sound never overlaps; the popup loop keeps the beat', () => {
        const out: DecloakEvent[] = [];
        const s0 = decloaksSince(0, out);
        const w = { xpos: 5, ypos: 6 } as unknown as BuiltObject;
        noteDecloak(w, 12);
        const s1 = decloaksSince(s0, out);
        expect(s1).toBe(s0 + 1);
        expect(out.length).toBe(1);
        expect(out[0].x).toBe(5);
        expect(decloaksSince(s1, out)).toBe(s1);
        expect(out.length).toBe(0);
        expect(decloakAllowed(10, 9)).toBe(false);
        expect(decloakAllowed(9 + DECLOAK_REST_S, 9)).toBe(true);
        expect(decloakAllowed(0, -Infinity)).toBe(true);
        expect(POPUP_DUCK).toBeCloseTo(0.4, 9);
        expect(POPUP_LOOP_END_S / 5.45).toBeCloseTo(6, 1);
    });
});

describe('a detected, cloaked Watcher is a bare contact', () => {
    const viewer = { empireId: 3 } as Empire;
    const owner = { empireId: 9 } as Empire;
    const watcher = (cloaked: boolean | undefined): BuiltObject => ({ empire: owner, cloaked, name: 'Secret Name' }) as unknown as BuiltObject;

    it('is one for every viewer but its owner while cloaked; a spectator and an ordinary ship see none', () => {
        expect(isCloakedContact(watcher(true), viewer)).toBe(true);
        expect(isCloakedContact(watcher(true), owner)).toBe(false);
        expect(isCloakedContact(watcher(true), null)).toBe(false);
        expect(isCloakedContact(watcher(false), viewer)).toBe(false);
        expect(isCloakedContact(watcher(undefined), viewer)).toBe(false);
    });

    it('a fleet led by one is one; a fleet without a lead is not', () => {
        expect(isCloakedContactFleet({ leadShip: watcher(true) }, viewer)).toBe(true);
        expect(isCloakedContactFleet({ leadShip: watcher(false) }, viewer)).toBe(false);
        expect(isCloakedContactFleet({ leadShip: null }, viewer)).toBe(false);
    });

    it('its panel names nothing of the ship', () => {
        const m = unidentifiedContactInfo();
        expect(m.title.map((t) => t.text).join('')).toBe(CONTACT_NAME);
        expect(m.corner).toBeNull();
        expect(m.picture).toBeNull();
        const text = m.rows.map(rowText).join(' ');
        expect(text).not.toMatch(/Secret|Design|Empire|Type|Weapons|Shields|Speed|Cargo|Crew|Size/i);
    });

    it('is left out of the enemy-targets list (alone or as a fleet lead), other targets stay', () => {
        const make = <T extends object>(proto: object, o: object): T => Object.assign(Object.create(proto), o) as T;
        const other = make<BuiltObject>(BuiltObject.prototype, { empire: owner, cloaked: false, hasBeenDestroyed: false });
        const hidden = make<BuiltObject>(BuiltObject.prototype, { empire: owner, cloaked: true, hasBeenDestroyed: false });
        const fleet = make<never>(ShipGroup.prototype, { leadShip: hidden, hasBeenDestroyed: false });
        const items = enemyTargetItems([hidden, other, fleet], viewer);
        expect(items.map((i) => i.target)).toEqual([other]);
        expect(enemyTargetItems([hidden], null)).toHaveLength(1);
    });
});
