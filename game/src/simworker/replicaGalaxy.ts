// Sim worker: the galaxy-level wiring of the replica sync (docs/sim-worker.md §3). replicaSync.ts is generic over
// object graphs; this binds it to the Galaxy: the roots (the Galaxy, then the side tables the TS port keeps outside
// the graph), the save's class registry / externals / skip list, the hot classes, and on the main thread the static
// GameData tables a replica Galaxy is wired to (exactly what loading a save does).
// No DOM / Pixi imports.

import type { Galaxy } from '../sim/galaxy';
import type { GameData } from '../sim/data/gameData';
import { baconInitializeSettings } from '../sim/baconSettings';
import { applyReplicaSideTables, galaxyExternals, replicaCodecOptions, replicaSideTables, replicaSkipFields, replicaStatics, wireReplicaVisibility } from '../sim/save/galaxySave';
import { Galaxy as GalaxyClass } from '../sim/galaxy';
import { BuiltObject } from '../sim/builtObject';
import { Creature } from '../sim/creature';
import { Fighter, FighterWeapon } from '../sim/combat/fighters';
import { Weapon } from '../sim/weapon';
import { ShipGroup } from '../sim/fleets/shipGroup';
import { Empire } from '../sim/empire';
import { Explosion } from '../sim/combat/damage';
import { Habitat } from '../sim/types';
import { Random } from '../sim/random';
import { ReplicaDecoder, ReplicaEncoder, type ApplyStats, type ReplicaDelta, type ReplicaEncoderOptions } from './replicaSync';

/**
 * Classes compared after every step: what the main view draws and interpolates every frame (positions, headings,
 * speeds, hyper / docking / combat state, shots and explosions), plus the Galaxy and Empire top levels (clock, lists,
 * money). Containers (arrays, Maps, Sets, plain objects) found through a hot object are hot too.
 */
export function hotClasses(): object[] {
    return [GalaxyClass.prototype, BuiltObject.prototype, Creature.prototype, Fighter.prototype, ShipGroup.prototype, Empire.prototype, Explosion.prototype];
}

/** Hot classes compared only through a gated owner (a ship's / fighter's weapons and the shots they carry). */
export function childHotClasses(): object[] {
    return [Weapon.prototype, FighterWeapon.prototype];
}

/**
 * Gates (replicaSync.ts ReplicaEncoderOptions.gates): ships, fighters and creatures are fully hot-compared only in the
 * steps the sim processed them (their lastTouch moved — with over 1000 built objects the sim moves them round-robin,
 * and the renderer extrapolates between touches, render/renderInterp.ts); their weapons (shots in flight) and fighters
 * along with them.
 */
export function hotGates(): Record<string, { gate: string; children: readonly string[] }> {
    return {
        BuiltObject: { gate: 'lastTouch', children: ['weapons', 'fighters'] },
        Fighter: { gate: 'lastTouch', children: ['weapons'] },
        Creature: { gate: 'lastTouch', children: [] },
    };
}

/**
 * Hot fields of the hot classes with a FIXED list (fixedHotClasses below): what the main view reads every frame —
 * render/renderInterp.ts MovingBuiltObject / MovingCreature (position, heading, speeds, parent frame, last touch), the
 * hyperjump / docking / shield-strike / combat state the ship, effects and overlay layers draw, and owner / fleet /
 * role changes, and the fields docs/sim-worker-consumer-audit.md §3 found the layers read every frame (visibility:
 * nearestSystemStar / stealth / sensors; combat bars: attackers; ambient: doing* / engineType / builtAt; travel vectors:
 * mission). Every other field of these classes reaches the replica in the cold cycle (about a second). For the
 * other hot classes these are fields compared every step on top of the adaptive ones (any field that keeps changing).
 */
export function alwaysHotFields(): Set<string> {
    const out = new Set<string>();
    const add = (c: string, fields: string): void => {
        for (const f of fields.split(/\s+/)) if (f !== '') out.add(`${c}.${f}`);
    };
    add('BuiltObject', `xpos ypos _heading targetHeading currentSpeed _targetSpeed topSpeed warpSpeed parentHabitat parentOffsetX parentOffsetY
        parentBuiltObject dockedAt lastTouch hasBeenDestroyed empire role subRole design shipGroup currentTarget inBattle
        hyperjumpJustExited hyperjumpCountdown hyperjumpPrepare hyperjumpAboutToEnter hyperEnterStartAnimation hyperExitStartAnimation
        hyperjumpX hyperjumpY lastShieldStrike lastShieldStrikeDirection currentShields shieldsCapacity damagedComponentCount
        unbuiltComponentCount dateRetrofit isFunctional
        nearestSystemStar attackers stealth sensorLongRange sensorProximityArrayRange doingMining doingGasMining doingConstruction
        engineType builtAt mission ionStrikeSoundPlayed hyperjumpAboutToEnterSoundPlayed`);
    add('Creature', `xpos ypos currentHeading targetHeading currentSpeed targetSpeed movementSpeed hyperSpeed lungeSpeed currentTarget
        parentHabitat parentX parentY lastTouch hasBeenDestroyed damage isVisible turnDirection distanceToTarget nearestSystemStar`);
    add('Fighter', 'xpos ypos heading targetHeading currentSpeed hasBeenDestroyed onboardCarrier lastTouch');
    add('Galaxy', 'nowMs');
    return out;
}

/** Hot classes whose hot fields are exactly alwaysHotFields. */
export function fixedHotClasses(): string[] {
    return ['BuiltObject', 'Creature'];
}

/**
 * Containers compared every step (discovery labels, replicaSync.ts hotContainers): the lists the main view iterates
 * every frame (ships, creatures, empires) and the per-object lists of things it animates (weapons and their shots,
 * fighters, explosions — of ships and of planets: Habitat itself is cold, its orbit is extrapolated from the synced
 * (orbitAngle, lastTouch) pair, render/renderInterp.ts renderOrbitAngle).
 */
export function hotContainers(): Set<string> {
    return new Set([
        'Galaxy.builtObjects', 'Galaxy.creatures', 'Galaxy.empires', 'Galaxy.pirateEmpires',
        'BuiltObject.explosions', 'Fighter.explosions', 'Creature.explosions',
        'Habitat.explosions',
        'Empire.builtObjects', 'Empire.shipGroups',
        'ShipGroup.ships',
    ]);
}

/** The persistent side-tables root (id 1): refreshed in place so an unchanged table diffs as unchanged. */
type SideRoot = Record<string, unknown>;

export class GalaxySyncSource {
    readonly encoder: ReplicaEncoder;
    private readonly side: SideRoot;
    private sideCycle = -1;

    constructor(readonly galaxy: Galaxy, opts: Partial<Omit<ReplicaEncoderOptions, 'classes' | 'skipFields' | 'externals' | 'hotClasses'> & { hotClasses?: readonly object[] }> = {}) {
        const codec = replicaCodecOptions();
        // The side tables are collected over the objects the save would visit; at construction nothing is known yet,
        // so the first root is an empty holder filled right after the graph is discovered.
        this.side = {};
        this.encoder = new ReplicaEncoder(
            {
                classes: codec.classes,
                skipFields: replicaSkipFields(),
                externals: galaxyExternals(galaxy).byObject,
                hotClasses: opts.hotClasses ?? hotClasses(),
                ...opts,
                trackClasses: [Habitat.prototype, BuiltObject.prototype, Random.prototype],
                hotContainers: opts.hotContainers ?? hotContainers(),
                childHotClasses: opts.childHotClasses ?? childHotClasses(),
                gates: opts.gates ?? hotGates(),
                coldStreamClasses: opts.coldStreamClasses ?? [Empire.prototype, ShipGroup.prototype],
                alwaysHotFields: opts.alwaysHotFields ?? alwaysHotFields(),
                fixedHotClasses: opts.fixedHotClasses ?? fixedHotClasses(),
            },
            [galaxy, this.side],
        );
        this.refreshSideTables();
    }

    /** Recollect the side tables into the persistent root (Maps / arrays refilled in place). */
    refreshSideTables(): void {
        const e = this.encoder;
        const visited = [...e.instancesOf(Habitat.prototype), ...e.instancesOf(BuiltObject.prototype), ...e.instancesOf(Random.prototype)];
        const fresh = replicaSideTables(this.galaxy, visited) as SideRoot;
        assignInPlace(this.side, fresh);
    }

    /** The initial snapshot (everything discovered so far, incl. the side tables). */
    snapshot(): ReplicaDelta {
        // The side root was filled after the encoder discovered it empty: a full compare sends its contents.
        return this.encoder.diff(true);
    }

    /** The delta after a step; the side tables are recollected once per cold cycle (before a full compare). */
    delta(fullCold = false): ReplicaDelta {
        if (fullCold || this.encoder.cycleCount !== this.sideCycle) {
            this.refreshSideTables();
            this.sideCycle = this.encoder.cycleCount;
        }
        return this.encoder.diff(fullCold);
    }
}

/** Copy `src`'s fields into `dst` keeping dst's Map / array / plain-object instances where both sides have one. */
function assignInPlace(dst: Record<string, unknown>, src: Record<string, unknown>): void {
    for (const k of Object.keys(src)) {
        const a = dst[k];
        const b = src[k];
        if (a instanceof Map && b instanceof Map) {
            a.clear();
            for (const [x, y] of b) a.set(x, y);
        } else if (Array.isArray(a) && Array.isArray(b)) {
            a.length = 0;
            for (const x of b) a.push(x);
        } else if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object' && Object.getPrototypeOf(a) === Object.prototype && Object.getPrototypeOf(b) === Object.prototype) {
            assignInPlace(a as Record<string, unknown>, b as Record<string, unknown>);
        } else {
            dst[k] = b;
        }
    }
}

/** The main-thread replica: a decoder plus the replica Galaxy's static wiring. */
export class GalaxyReplica {
    readonly decoder: ReplicaDecoder;
    private readonly statics: ReturnType<typeof replicaStatics>;
    private wired = false;
    private empiresSeen = 0;
    private sideCountdown = 0;

    constructor(gameData: GameData, baseTechCost: number) {
        this.statics = replicaStatics(gameData, baseTechCost);
        // The BaconSettings.txt statics (prices, maintenance, movement) the main thread's screens read, as the worker's
        // createGame / deserializeGame applied them there (statics only: the galaxy is the worker's).
        baconInitializeSettings(null, gameData.baconSettings);
        const codec = replicaCodecOptions();
        this.decoder = new ReplicaDecoder({ classes: codec.classes, revive: codec.revive, externals: this.statics.byRef });
    }

    /** The replica's static GameData objects by `kind:key` (the save's externals). */
    get staticByRef(): Map<string, object> {
        return this.statics.byRef;
    }

    /** The replica Galaxy (null before the snapshot). */
    get galaxy(): Galaxy | null {
        return (this.decoder.object(0) as Galaxy | null) ?? null;
    }

    /** Apply a delta (hot part now, cold part queued; `all`: everything now — the snapshot, a save, tests). */
    apply(d: ReplicaDelta, all = false): ApplyStats {
        const st = this.decoder.apply(d, all);
        this.afterApply(all);
        return st;
    }

    /** Apply queued cold parts for up to `budgetMs` (once per render frame). */
    pumpCold(budgetMs: number): ApplyStats {
        const st = this.decoder.pumpCold(budgetMs);
        if (st.coldParts > 0) this.afterApply(false);
        return st;
    }

    /** Apply the queued cold parts up to delta `seq` now (a command reply that waited too long). */
    flushColdThrough(seq: number): ApplyStats {
        const st = this.decoder.flushColdThrough(seq);
        if (st.coldParts > 0) this.afterApply(false);
        return st;
    }

    private afterApply(all: boolean): void {
        const g = this.galaxy;
        if (g === null) return;
        if (!this.wired) {
            this.statics.wire(g);
            this.wired = true;
        }
        // New empires (pirates appearing, rebels) need their visibility owner hooks.
        const n = g.empires.length + g.pirateEmpires.length;
        if (n !== this.empiresSeen) {
            this.empiresSeen = n;
            wireReplicaVisibility(g);
        }
        const side = this.decoder.object(1);
        if (side !== null && (all || (--this.sideCountdown <= 0 && this.decoder.coldBacklog === 0)) && Object.keys(side).length > 0) {
            applyReplicaSideTables(g, side);
            this.sideCountdown = 60;
        }
    }
}
