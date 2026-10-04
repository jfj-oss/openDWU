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
export function hotGates(): Record<string, { gate: string; children: readonly string[]; lists?: readonly string[] }> {
    return {
        // Lists mutated in place, compared with the ship (without their elements): its attackers (combat bars) and its
        // location effects (liveryLayer.ts lightning scars, with lastLocationEffectTouch).
        BuiltObject: { gate: 'lastTouch', children: ['weapons', 'fighters'], lists: ['attackers', 'locationEffects'] },
        Fighter: { gate: 'lastTouch', children: ['weapons'] },
        Creature: { gate: 'lastTouch', children: [] },
    };
}

/**
 * Hot fields of the hot classes with a FIXED list (fixedHotClasses below): what the main view reads every frame —
 * render/renderInterp.ts MovingBuiltObject / MovingCreature / MovingFighter / MovingShot (position, heading, speeds,
 * parent frame, last touch), the hyperjump / docking / shield-strike / ion-strike / combat state the ship, effects and
 * overlay layers draw (effectsLayer.ts weaponDrawCommand / fighterWeaponDrawCommand / drawExplosion, combatBars.ts battle
 * bars incl. the boarding values,
 * shipOverlays.ts, liveryLayer.ts lightning scars), owner / fleet / role changes, and what
 * docs/sim-worker-consumer-audit.md §3 found the layers read every frame (visibility: nearestSystemStar / stealth /
 * sensors; ambient: doing* / engineType / builtAt; travel vectors: mission). The audio's `*SoundPlayed` flags are not
 * synced at the step rate: the main thread keeps its own played-marks (audio/mainViewSounds.ts ReplicaSoundMarks).
 * Every other field of these classes reaches the replica in the cold cycle (about a second). For the other hot classes
 * these are fields compared every step on top of the adaptive ones (any field that keeps changing).
 */
export function alwaysHotFields(): Set<string> {
    const out = new Set<string>();
    const add = (c: string, fields: string): void => {
        for (const f of fields.split(/\s+/)) if (f !== '') out.add(`${c}.${f}`);
    };
    add('BuiltObject', `xpos ypos _heading targetHeading currentSpeed _targetSpeed topSpeed warpSpeed parentHabitat parentOffsetX parentOffsetY
        parentBuiltObject dockedAt lastTouch hasBeenDestroyed empire role subRole design shipGroup currentTarget inBattle
        hyperjumpJustExited hyperjumpCountdown hyperjumpPrepare hyperjumpAboutToEnter hyperEnterStartAnimation hyperExitStartAnimation
        hyperjumpX hyperjumpY canHyperJump lastShieldStrike lastShieldStrikeDirection currentShields shieldsCapacity damagedComponentCount
        unbuiltComponentCount dateRetrofit isFunctional lastIonStrike lastLocationEffectTouch
        nearestSystemStar attackers stealth sensorLongRange sensorProximityArrayRange doingMining doingGasMining doingConstruction
        engineType builtAt mission assaultAttackValue assaultDefenseValue`);
    add('Creature', `xpos ypos currentHeading targetHeading currentSpeed targetSpeed movementSpeed hyperSpeed lungeSpeed currentTarget
        parentHabitat parentX parentY lastTouch hasBeenDestroyed damage isVisible turnDirection distanceToTarget nearestSystemStar`);
    add('Fighter', `xpos ypos heading targetHeading currentSpeed _targetSpeed topSpeed hasBeenDestroyed onboardCarrier lastTouch health
        currentShields lastShieldStrike lastShieldStrikeDirection currentTarget parentBuiltObject empire inBattle`);
    // Shots in flight (compared with their firer, render/effectsLayer.ts weaponDrawCommand + sampleShot).
    add('Weapon', 'x y heading lastFired distanceTravelled target power willHitTarget _resetNext');
    add('FighterWeapon', 'x y heading lastFired distanceTravelled power willHitTarget resetNext');
    // effectsLayer.ts drawExplosion / drawPlanetExplosion (the frame of a ship's explosion follows from its start).
    add('Explosion', 'explosionStart explosionSize explosionOffsetX explosionOffsetY explosionImageIndex explosionCurrentImage');
    add('Galaxy', 'nowMs');
    return out;
}

/**
 * Hot classes whose hot fields are exactly alwaysHotFields. A fixed list, not the adaptive one, for everything the
 * view animates: an adaptive field becomes hot only after a cold cycle in which it changed often enough, so the first
 * second of a fight (shots, fighters, explosions after a quiet spell) would otherwise travel at the cold rate.
 */
export function fixedHotClasses(): string[] {
    return ['BuiltObject', 'Creature', 'Fighter', 'Weapon', 'FighterWeapon', 'Explosion'];
}

/**
 * Fields of cold classes whose changes travel in the hot stream (replicaSync.ts hotStreamFields) — rare changes the
 * view must show at once. They are compared every step for the objects a shot or ship refers to (relatedFields), the
 * habitats with a giant ion cannon and the player's system visibility (GalaxySyncSource.hotPass):
 * - Habitat explosions / planet explosion / giant ion cannon / destroyed flag (effectsLayer.ts habitatEffects): a
 *   bombardment's explosion is pushed onto the target planet while the firing ship is processed;
 * - SystemVisibility.status (render/fog.ts: whether the ships in a system are drawn, every frame).
 */
export function hotStreamFields(): Set<string> {
    const out = new Set<string>();
    for (const f of ['explosions', 'explosion', 'giantIonCannon', 'hasBeenDestroyed']) out.add(`Habitat.${f}`);
    out.add('SystemVisibility.status');
    return out;
}

/**
 * Fields of cold classes that travel cold from the cold pass and hot when compared through a reference
 * (replicaSync.ts mixedStreamFields): a habitat's (orbitAngle, lastTouch) pair and committed position. The background
 * round-robin moves a thousand habitats a step, which the view extrapolates from the pair (renderInterp.ts
 * renderOrbitAngle) at any staleness — but a ship parked at a planet is placed at the planet's committed position plus
 * its offset when it is processed, and drawn in the planet's frame only while the two agree (renderInterp.ts
 * followsParent), so its parent's fields come hot with it (relatedFields BuiltObject.parentHabitat / dockedAt); and a
 * giant ion cannon's shot is extrapolated from its habitat's LastTouch.
 */
export function mixedStreamFields(): Set<string> {
    return new Set(['Habitat.lastTouch', 'Habitat.orbitAngle', 'Habitat.xpos', 'Habitat.ypos']);
}

/**
 * Hot fields whose changes travel cold (replicaSync.ts coldStreamFields): compared every step, applied by the main
 * thread's cold pump (normally the same or the next frame). A new mission is a burst of births (the mission, its
 * command list, Commands), a new design or fleet is usually born in a cold part first (Empire.designs /
 * Empire.shipGroups): sent hot they made the occasional 3-14 ms hot-apply spike (docs/sim-worker.md §8).
 */
export function coldStreamFields(): Set<string> {
    return new Set(['BuiltObject.mission', 'BuiltObject.design', 'BuiltObject.shipGroup']);
}

/**
 * References whose target is compared with the holder (replicaSync.ts relatedFields): a shot's / fighter's / creature's
 * target (shield strikes, bombardment explosions show at once), and a ship's parent habitat / dock (its position, which
 * the ship's was just derived from).
 */
export function relatedFields(): Set<string> {
    return new Set(['Weapon.target', 'Fighter.currentTarget', 'Creature.currentTarget', 'BuiltObject.parentHabitat', 'BuiltObject.dockedAt']);
}

/**
 * Containers compared every step (discovery labels, replicaSync.ts hotContainers): the lists the main view iterates
 * every frame (ships, creatures, empires, a system's creatures) and the per-object lists of things it animates
 * (explosions — of ships and of planets: Habitat itself is cold, its orbit is extrapolated from the synced
 * (orbitAngle, lastTouch) pair, render/renderInterp.ts renderOrbitAngle). A ship's weapons and fighters lists are its
 * gate's children (compared when it moves, streamed hot).
 */
export function hotContainers(): Set<string> {
    return new Set([
        'Galaxy.builtObjects', 'Galaxy.creatures', 'Galaxy.empires', 'Galaxy.pirateEmpires',
        'BuiltObject.explosions', 'Fighter.explosions', 'Creature.explosions',
        'Habitat.explosions',
        'Empire.builtObjects', 'Empire.shipGroups',
        'ShipGroup.ships',
        // SystemInfo (a plain object, labelled by where it was found) .creatures: creatureLayer.ts creaturesNear.
        'Galaxy.systems[].creatures',
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
                hotStreamFields: opts.hotStreamFields ?? hotStreamFields(),
                mixedStreamFields: opts.mixedStreamFields ?? mixedStreamFields(),
                coldStreamFields: opts.coldStreamFields ?? coldStreamFields(),
                relatedFields: opts.relatedFields ?? relatedFields(),
                touchChildren: opts.touchChildren ?? { Habitat: ['giantIonCannon'] },
            },
            [galaxy, this.side],
        );
        this.encoder.onHotPass = (enc) => this.hotPass(enc);
        this.refreshSideTables();
    }

    /** Sync ids of the habitats with a giant ion cannon and of the player's (and its shared-visibility partners')
     *  SystemVisibility records, refreshed once per cold cycle. */
    private cannonIds: number[] = [];
    private visibilityIds: number[] = [];
    private idsCycle = -1;

    /**
     * The binding's per-step compares (ReplicaEncoder.onHotPass), for what the sim may change this step that no gate or
     * reference brings in:
     * - the habitats with a giant ion cannon (its shot is the habitat's touch child; it moves when the habitat is ticked);
     * - the player's system visibility (render/fog.ts reads SystemVisibility.status every frame) and that of the empires
     *   it shares visibility with (EmpireVisibility.checkSystemVisible reads theirs too).
     * The lists are rebuilt once per cold cycle (a cannon built since shows from then on). Read only.
     */
    private hotPass(enc: ReplicaEncoder): void {
        if (this.idsCycle !== enc.cycleCount) {
            this.idsCycle = enc.cycleCount;
            const g = this.galaxy;
            this.cannonIds.length = 0;
            for (const h of g.habitats) {
                if (h != null && h.giantIonCannonPresent) {
                    const id = enc.knownId(h);
                    if (id >= 0) this.cannonIds.push(id);
                }
            }
            this.visibilityIds.length = 0;
            const player = g.playerEmpire;
            if (player !== null) {
                for (const e of [player.visibility, ...player.visibility.empiresSharedVisibility]) {
                    for (const sv of e.systemVisibility) {
                        const id = enc.knownId(sv);
                        if (id >= 0) this.visibilityIds.push(id);
                    }
                }
            }
        }
        for (const id of this.cannonIds) enc.touchId(id);
        for (const id of this.visibilityIds) enc.touchId(id);
    }

    /** Recollect the side tables into the persistent root (Maps / arrays refilled in place). */
    refreshSideTables(): void {
        const e = this.encoder;
        const visited = [...e.instancesOf(Habitat.prototype), ...e.instancesOf(BuiltObject.prototype), ...e.instancesOf(Random.prototype)];
        const fresh = replicaSideTables(this.galaxy, visited) as SideRoot;
        assignInPlace(this.side, fresh);
    }

    /**
     * Put a table the save does not write into the side-tables root under `key` (null removes it): the trade-flow
     * ledger view (tradeFlowSync.ts). The side-table collection never overwrites such a key (assignInPlace copies only
     * the save's keys) and restoreSideTables ignores it on the replica.
     */
    setSideTable(key: string, value: unknown): void {
        if (value === null) delete this.side[key];
        else this.side[key] = value;
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
        // The same live table on both sides (characterState.raceAvailableCharacters is the sim's own Map): nothing to
        // copy — and clearing `a` would empty the authoritative table.
        if (a === b) continue;
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
        this.decoder = new ReplicaDecoder({ classes: codec.classes, revive: codec.revive, externals: this.statics.byRef, mixedFields: mixedStreamFields() });
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

    /**
     * Apply a delta and every cold part queued up to it, now (a step message carrying command replies: the onApplied
     * callbacks then read the replica as of the boundary that applied the commands). The side tables keep their own
     * cadence.
     */
    applyThrough(d: ReplicaDelta): ApplyStats {
        const st = this.decoder.apply(d, true);
        this.afterApply(false);
        return st;
    }

    /** Apply queued cold parts for up to `budgetMs` (once per render frame). */
    pumpCold(budgetMs: number): ApplyStats {
        const st = this.decoder.pumpCold(budgetMs);
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
