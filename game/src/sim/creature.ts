// Port of DistantWorlds.Types.CreatureType (CreatureType.cs) and
// DistantWorlds.Types.Creature (Creature.cs, generation-time fields only).

import type { Galaxy } from './galaxy';
import type { Habitat } from './types';

// Port of DistantWorlds.Types.CreatureType (member order exact; byte enum).
export enum CreatureType {
    Undefined,
    Kaltor,
    RockSpaceSlug,
    DesertSpaceSlug,
    Ardilus,
    SilverMist,
}

// Port of DistantWorlds.Types.TurnDirection (TurnDirection.cs).
export enum TurnDirection {
    None,
    Left,
    Right,
}

// Port of DistantWorlds.Types.Creature (Creature.cs) — the constructor and
// the fields set at generation time. Movement/AI state (_LastTouch,
// _Locations, hyperjump countdown, lunging, ...) is out of scope:
// TODO(port): creature movement/AI tick — Creature.cs Move/DoTasks.
export class Creature {
    // C#: int _CreatureID (Galaxy assigns on load/save; 0 at generation).
    creatureId = 0;
    // C#: int _AttackStrength. The default values below mirror the C#
    // field initializers for the species used at generation; the C# ctor
    // sets them per species (see the switch in the ctor region of
    // Creature.cs) — the generation-time ports in galaxy.ts override the
    // few that differ (e.g. the giant RockSpaceSlug roll).
    attackStrength = 10;
    // C#: short _PictureRef (species picture index).
    pictureRef = 0;
    // C#: int _MaxSize.
    maxSize = 100;
    // C#: float _Damage.
    damage = 10;
    // C#: int _DamageKillThreshhold.
    damageKillThreshold = 100;
    // C#: short _Size (current size; set by the giant RockSpaceSlug roll in
    // Galaxy.GenerateCreatureAtHabitat).
    size = 100;
    // C#: CreatureType _Type.
    type: CreatureType;
    // C#: float _TurnRate.
    turnRate = 5;
    // C#: float _AccelerationRate.
    accelerationRate = 2;
    // C#: float _HealRate.
    healRate = 1;
    // C#: long _BirthDate (ticks since DateTime.MinValue; 0 at generation).
    birthDate = 0;
    // C#: int _AnchorRange.
    anchorRange = 100;
    // C#: int _AttackRange.
    attackRange = 100;
    // C#: short _MovementSpeed / _MovementSpeedBase.
    movementSpeed = 10;
    movementSpeedBase = 10;
    // C#: int _HyperSpeed.
    hyperSpeed = 100;
    // C#: bool _CanHide.
    canHide = false;
    // C#: bool _IsBenign.
    isBenign = false;
    // C#: double _ParentOffsetX / _ParentOffsetY (the offset passed to the
    // ctor; -2000000001 means "not locked to an explicit offset").
    parentOffsetX = 0;
    parentOffsetY = 0;
    // C#: bool _LocationLocked.
    locationLocked = false;
    // C#: double _LastPositionX / _LastPositionY.
    lastPositionX = 0;
    lastPositionY = 0;
    // C#: double _ParentX / _ParentY (anchor position at creation).
    parentX = 0;
    parentY = 0;
    // C#: float _CurrentHeading.
    currentHeading = 0;
    // C#: TurnDirection _TurnDirection.
    turnDirection = TurnDirection.None;
    // C#: float _TargetSpeed.
    targetSpeed = 0;
    // C#: double _DistanceToTarget.
    distanceToTarget = 0;
    // C#: bool _IsVisible.
    isVisible = true;
    // C#: double _ReproductionCounter.
    reproductionCounter = 0;

    // C#: Galaxy _Galaxy.
    galaxy: Galaxy | null;
    // C#: Habitat _AnchorHabitat.
    anchorHabitat: Habitat | null;
    // C#: Habitat _NearestSystemStar (set by Galaxy.GenerateCreatureAtHabitat).
    nearestSystemStar: Habitat | null = null;

    // Port of Creature.cs ctor Creature(galaxy, creatureType, habitat,
    // offsetX, offsetY): anchors the creature to the habitat's position
    // (plus any explicit offset) and initializes the species defaults.
    constructor(galaxy: Galaxy | null, creatureType: CreatureType, habitat: Habitat | null, offsetX: number, offsetY: number) {
        this.galaxy = galaxy;
        this.type = creatureType;
        this.anchorHabitat = habitat;
        this.parentOffsetX = offsetX;
        this.parentOffsetY = offsetY;
        if (habitat !== null) {
            this.lastPositionX = habitat.xpos + offsetX;
            this.lastPositionY = habitat.ypos + offsetY;
            this.parentX = habitat.xpos + offsetX;
            this.parentY = habitat.ypos + offsetY;
        }
        // Species defaults from the C# ctor's per-type initialization block.
        switch (creatureType) {
            case CreatureType.Kaltor:
                this.pictureRef = 34;
                this.attackStrength = 10;
                this.maxSize = 100;
                this.damage = 10;
                this.damageKillThreshold = 100;
                break;
            case CreatureType.RockSpaceSlug:
                this.pictureRef = 36;
                this.attackStrength = 10;
                this.maxSize = 100;
                this.damage = 10;
                this.damageKillThreshold = 100;
                break;
            case CreatureType.DesertSpaceSlug:
                this.pictureRef = 37;
                this.attackStrength = 10;
                this.maxSize = 100;
                this.damage = 10;
                this.damageKillThreshold = 100;
                break;
            case CreatureType.Ardilus:
                this.pictureRef = 35;
                this.attackStrength = 10;
                this.maxSize = 100;
                this.damage = 10;
                this.damageKillThreshold = 100;
                break;
            case CreatureType.SilverMist:
                this.pictureRef = 38;
                this.attackStrength = 10;
                this.maxSize = 100;
                this.damage = 10;
                this.damageKillThreshold = 100;
                break;
            default:
                break;
        }
    }
}