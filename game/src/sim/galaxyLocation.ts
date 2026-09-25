// Port of DistantWorlds.Types.GalaxyLocation (GalaxyLocation.cs), with the
// serialization members and the BuiltObject/CreatureList relations
// omitted (out of scope).

import type { Race } from './data/races';
import type { Creature } from './creature';
import type { BuiltObject } from './builtObject';

export enum GalaxyLocationType {
    Undefined = 0,
    DebrisField,
    NebulaCloud,
    GalacticCore,
    PlanetDestroyer,
    BlackHole,
    RaceRegion,
    SuperNova,
    RestrictedArea,
}

export enum GalaxyLocationEffectType {
    None = 0,
    HyperjumpDisabled = 1,
    MovementSlowed = 2,
    LightningDamage = 4,
    ShieldReduction = 8,
    ShipDamage = 16,
    ShipPull = 32,
}

export enum GalaxyLocationShape {
    Square = 0,
    Circular,
}

export class GalaxyLocation {
    name: string;
    showName: boolean;
    type: GalaxyLocationType;
    // C# stores these as float (the constructor casts double -> float);
    // Math.fround matches that precision.
    xpos: number;
    ypos: number;
    width: number;
    height: number;
    pictureRef: number;
    message: string;
    effect: GalaxyLocationEffectType;
    effectAmount: number;
    effectRandomSeed: number;
    shape: GalaxyLocationShape;
    soundScheme: number;
    // Port of GalaxyLocation.cs RelatedRace (set by SetupAlienRacePopulations
    // for RaceRegion locations).
    relatedRace: Race | null;
    /** GalaxyLocation.cs 203 RelatedBuiltObject (planet destroyer projects, restricted-area abandoned ships; M4u reads it). */
    relatedBuiltObject: BuiltObject | null = null;
    /** GalaxyLocation.cs 32 _RelatedCreatures = new CreatureList() (M4z3: story special zones / planet-destroyer guardians). */
    relatedCreatures: Creature[] = [];

    constructor(name: string, type: GalaxyLocationType, x: number, y: number, width: number, height: number, pictureRef: number) {
        this.name = name;
        this.showName = false;
        this.type = type;
        this.effect = GalaxyLocationEffectType.None;
        this.message = '';
        this.xpos = Math.fround(x);
        this.ypos = Math.fround(y);
        this.width = Math.fround(width);
        this.height = Math.fround(height);
        this.pictureRef = pictureRef;
        this.effectAmount = 0.0;
        this.effectRandomSeed = 0;
        this.shape = GalaxyLocationShape.Square;
        this.soundScheme = -1;
        this.relatedRace = null;
    }

    // Port of GalaxyLocation.ResolveLocationCenter(out x, out y)
    resolveLocationCenter(): { x: number; y: number } {
        return { x: this.xpos + this.width / 2.0, y: this.ypos + this.height / 2.0 };
    }
}