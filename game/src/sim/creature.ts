// Port of DistantWorlds.Types.CreatureType (CreatureType.cs) and
// DistantWorlds.Types.Creature (Creature.cs): constructor, movement and AI
// tick (task 08h). Combat (CheckForAttackers / CheckForTargets / AttackTarget, Creature.cs 1196-1345) is in
// events.ts (M4u); DamageTarget (Creature.cs 1347) is an M4o stub.

import type { Galaxy } from './galaxy';
import { GalaxyLocationEffectType } from './galaxyLocation';
import { HabitatCategoryType, HabitatType, type Habitat } from './types';
import { isHabitat, type StellarObject } from './missions/mission';
import { creatureAttackTarget, creatureCheckForAttackers, creatureCheckForTargets, creatureCheckTargetInRange } from './events';
import { stellarAttackers, stellarPursuers } from './combat/threats';
import { checkEmpireHasHyperDriveTech } from './forceStructure';
import { clearFightersTargeting } from './combat/fighters';

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
    StraightAhead,
    Left,
    Right,
}

// Sentinel used by the C# Creature ctor overloads for "no explicit offset".
export const CREATURE_OFFSET_UNSET = -2000000001;

// Port of Galaxy.3.cs InitializeStatics (4971-4972).
const HyperJumpThreshhold = 12000;
const BaseHyperJumpAccuracy = 3000.0;

// Port of Galaxy.7.cs ConditionCheckLimit (iterationCount passed by ref).
function conditionCheckLimit(condition: boolean, maximumIterations: number, it: { n: number }): boolean {
    if (it.n >= maximumIterations) {
        return false;
    }
    it.n++;
    return condition;
}

// Port of Galaxy.7.cs DetermineAngle.
export function determineAngle(x1: number, y1: number, x2: number, y2: number): number {
    const num = Math.atan2(y2 - y1, x2 - x1);
    return Number.isNaN(num) ? 0.0 : num;
}

// Port of Galaxy.2.cs ResolveDescription(CreatureType) (English text).
function resolveCreatureDescription(type: CreatureType): string {
    switch (type) {
        case CreatureType.Ardilus:
            return 'Ardilus';
        case CreatureType.DesertSpaceSlug:
            return 'Sand Slug';
        case CreatureType.RockSpaceSlug:
            return 'Space Slug';
        case CreatureType.Kaltor:
            return 'Giant Kaltor';
        case CreatureType.SilverMist:
            return 'SilverMist';
        default:
            return '(Unknown)';
    }
}

// C# System.Drawing.Point; Point.Empty is modeled as null.
export interface AnchorPoint {
    x: number;
    y: number;
}

/** `target is Habitat` for a StellarObject. */
function isHabitatTarget(o: StellarObject): o is Habitat {
    return isHabitat(o);
}

function removeFrom<T>(list: T[], item: T): void {
    const i = list.indexOf(item);
    if (i >= 0) list.splice(i, 1);
}

export class Creature {
    creatureId = 0;
    name = '';
    type: CreatureType;
    galaxy: Galaxy;

    // StellarObject fields.
    xpos = 0;
    ypos = 0;
    size = 0;
    currentSpeed = 0; // C#: float
    targetHeading = 0; // C#: float
    topSpeed = 0; // C#: short StellarObject.TopSpeed (never set for creatures)
    parentHabitat: Habitat | null = null;
    hasBeenDestroyed = false;
    /** StellarObject.CurrentTarget / Attackers / Pursuers (Creature.cs 324-325: the lists are created by the ctor). */
    currentTarget: StellarObject | null = null;
    attackers: StellarObject[] = [];
    pursuers: StellarObject[] = [];

    attackStrength = 0;
    pictureRef = 0;
    maxSize = 0;
    damage = 0;
    damageKillThreshold = 0;
    turnRate = 0; // float
    accelerationRate = 0; // float
    healRate = 0; // float
    // TODO(port): BirthDate = Galaxy.CurrentStarDate (no star date on Galaxy yet).
    birthDate = 0;
    anchorHabitat: Habitat | null = null;
    anchorPoint: AnchorPoint | null;
    anchorRange: number;
    attackRange = 0;
    nearestSystemStar: Habitat | null = null;
    movementSpeed = 0;
    movementSpeedBase = 0;
    hyperSpeed = 0;
    hyperCountdown = 0;
    canHide = false;
    isBenign = false;
    lungeSpeed = 0;
    lungeSpeedBase = 0;
    lungeLength = 0;
    lungeAccelerationRate = 0;
    lungeInterval = 0;
    lastLunge = 0;
    parentOffsetX = 0;
    parentOffsetY = 0;
    locationLocked = false;
    lastPositionX = 0;
    lastPositionY = 0;
    parentX = 0;
    parentY = 0;
    currentHeading = 0; // float
    turnDirection = TurnDirection.StraightAhead;
    targetSpeed = 0; // float
    distanceToTarget = 0;
    isVisible = true;
    isAttacking = false;
    reproductionCounter = 0;
    movementSlowedLocation = false;
    hyperjumpDisabledLocation = false;
    creaturePullAmountLocation = 0;
    creaturePullAngleLocation = 0;
    creatureDamageAmountLocation = 0;
    // C# DateTimes, modeled as game seconds (Galaxy.currentTimeSeconds).
    lastTouch = 0;
    lastShortTouch = 0;
    lastPeriodicTouch = 0;
    lastLongTouch = 0;
    promptSystemCheck = false;

    // Port of Creature.cs ctor (lines 297-491); the 3- and 5-arg overloads
    // collapse into the defaults (offsets = -2000000001, Point.Empty, 500).
    constructor(
        galaxy: Galaxy,
        type: CreatureType,
        startingHabitat: Habitat | null,
        offsetX = CREATURE_OFFSET_UNSET,
        offsetY = CREATURE_OFFSET_UNSET,
        startingPoint: AnchorPoint | null = null,
        anchorRange = 500,
    ) {
        this.galaxy = galaxy;
        this.type = type;
        this.creatureId = galaxy.getNextCreatureID();
        this.currentHeading = galaxy.selectRandomHeading();
        this.targetHeading = this.currentHeading;
        this.currentSpeed = 0;
        this.targetSpeed = 0;
        this.turnDirection = TurnDirection.StraightAhead;
        if (offsetX > CREATURE_OFFSET_UNSET && offsetY > CREATURE_OFFSET_UNSET) {
            this.parentOffsetX = offsetX;
            this.parentOffsetY = offsetY;
        } else {
            const p = galaxy.selectRelativeHabitatSurfacePoint(startingHabitat);
            this.parentOffsetX = p.x;
            this.parentOffsetY = p.y;
        }
        this.parentX = this.parentOffsetX;
        this.parentY = this.parentOffsetY;
        if (startingHabitat !== null) {
            this.xpos = startingHabitat.xpos + this.parentOffsetX;
            this.ypos = startingHabitat.ypos + this.parentOffsetY;
        } else if (startingPoint !== null) {
            this.xpos = startingPoint.x + this.parentOffsetX;
            this.ypos = startingPoint.y + this.parentOffsetY;
        }
        this.damage = 0;
        this.isAttacking = false;
        this.reproductionCounter = 0;
        this.isBenign = false;
        this.anchorPoint = startingPoint;
        this.anchorRange = anchorRange;
        const seconds = galaxy.rnd.next(1, 30);
        const now = galaxy.currentTimeSeconds;
        this.lastLongTouch = now - seconds;
        this.lastPeriodicTouch = now - seconds;
        this.lastShortTouch = now - seconds;
        this.lastTouch = now - seconds;
        const attach = (): void => {
            this.parentHabitat = this.anchorHabitat;
            this.parentOffsetX = this.xpos - this.parentHabitat!.xpos;
            this.parentOffsetY = this.ypos - this.parentHabitat!.ypos;
        };
        switch (this.type) {
            case CreatureType.Kaltor:
                this.anchorHabitat = startingHabitat;
                if (this.anchorHabitat !== null) {
                    this.anchorRange = this.anchorHabitat.category !== HabitatCategoryType.Asteroid ? 600 : 1200;
                    attach();
                }
                this.accelerationRate = 7;
                this.attackRange = this.anchorRange;
                this.size = galaxy.rnd.next(80, 190);
                this.maxSize = 600;
                this.attackStrength = Math.trunc(this.size / 20.0);
                this.turnRate = Math.fround(1.9);
                this.damageKillThreshold = Math.trunc(this.size * 1.4);
                this.healRate = Math.fround(0.2);
                this.movementSpeed = 34;
                this.isVisible = true;
                this.canHide = false;
                this.lungeSpeed = 0;
                this.lungeLength = 0.0;
                this.lungeAccelerationRate = 0.0;
                this.lungeInterval = 100.0;
                this.lastLunge = this.lastTouch;
                this.name = this.selectName(startingHabitat);
                this.pictureRef = 2;
                break;
            case CreatureType.RockSpaceSlug:
            case CreatureType.DesertSpaceSlug:
                this.anchorHabitat = startingHabitat;
                if (this.anchorHabitat !== null) {
                    this.anchorRange =
                        this.anchorHabitat.category !== HabitatCategoryType.Asteroid ? Math.trunc(this.anchorHabitat.diameter / 1.3) : 400;
                    attach();
                }
                this.accelerationRate = 2;
                this.attackRange = this.anchorRange;
                this.size = galaxy.rnd.next(120, 180);
                this.maxSize = 350;
                this.attackStrength = Math.trunc(this.size / 30.0);
                this.turnRate = Math.fround(1.5);
                this.damageKillThreshold = Math.trunc(this.size * 1.1);
                this.healRate = Math.fround(0.1);
                this.movementSpeed = 7;
                this.isVisible = false;
                this.canHide = true;
                this.lungeSpeed = 20;
                this.lungeLength = 2.3;
                this.lungeAccelerationRate = 25.0;
                this.lungeInterval = 12.0;
                this.lastLunge = this.lastTouch;
                this.name = this.selectName(startingHabitat);
                this.pictureRef = 0;
                break;
            case CreatureType.Ardilus:
                this.anchorHabitat = startingHabitat;
                if (this.anchorHabitat !== null) {
                    this.anchorRange = 800;
                    attach();
                }
                this.accelerationRate = 2;
                this.attackRange = 40000;
                this.size = galaxy.rnd.next(210, 390);
                this.maxSize = 1500;
                this.attackStrength = Math.trunc(this.size / 40.0);
                this.turnRate = Math.fround(1.4);
                this.damageKillThreshold = Math.trunc(this.size * 2.2);
                this.healRate = Math.fround(0.3);
                this.movementSpeed = 9;
                this.hyperSpeed = 10000;
                this.isVisible = true;
                this.canHide = false;
                this.lungeSpeed = 38;
                this.lungeLength = 2.1;
                this.lungeAccelerationRate = 82.0;
                this.lungeInterval = 14.0;
                this.lastLunge = this.lastTouch;
                this.name = this.selectName(startingHabitat);
                this.pictureRef = 3;
                break;
            case CreatureType.SilverMist:
                this.anchorHabitat = startingHabitat;
                this.anchorRange = 1500;
                if (this.anchorHabitat !== null) {
                    this.anchorRange = 1500;
                    attach();
                }
                this.accelerationRate = 5;
                this.attackRange = 50000;
                this.size = galaxy.rnd.next(220, 280);
                this.maxSize = 1500;
                this.attackStrength = Math.trunc(this.size / 10.0);
                this.turnRate = Math.fround(1.9);
                this.damageKillThreshold = Math.trunc(this.size * 3.0);
                this.healRate = Math.fround(0.4);
                this.movementSpeed = 27;
                this.hyperSpeed = 5000;
                this.isVisible = true;
                this.canHide = false;
                this.lungeSpeed = 72;
                this.lungeLength = 6.5;
                this.lungeAccelerationRate = 138.0;
                this.lungeInterval = 16.0;
                this.lastLunge = this.lastTouch;
                this.name = this.selectName(startingHabitat);
                this.pictureRef = 4;
                break;
        }
        this.movementSpeedBase = this.movementSpeed;
        this.lungeSpeedBase = this.lungeSpeed;
        if (this.type !== CreatureType.DesertSpaceSlug) {
            return;
        }
        this.pictureRef = 1;
        this.size = galaxy.rnd.next(150, 220);
        this.maxSize = 550;
        this.attackStrength = Math.trunc(this.size / 12.0);
        this.turnRate = Math.fround(1.7);
        this.damageKillThreshold = Math.trunc(this.size * 1.2);
    }

    // Port of Creature.cs SelectName (line 493); "CREATURETYPE of LOCATION" = "{0} of {1}".
    private selectName(startingHabitat: Habitat | null): string {
        let str = resolveCreatureDescription(this.type);
        if (startingHabitat !== null && this.type !== CreatureType.Undefined) {
            const starName = this.galaxy.determineHabitatSystemStar(startingHabitat).name;
            if (this.type === CreatureType.RockSpaceSlug && startingHabitat.category === HabitatCategoryType.Asteroid) {
                str = `${str} of ${starName} Asteroid Field`;
            } else {
                str = `${str} of ${starName}`;
            }
        }
        return str;
    }

    // Port of Creature.cs Heal (line 520).
    private heal(timePassed: number): void {
        if (this.damage > 0.0) {
            this.damage -= this.healRate * timePassed;
        }
        if (this.damage >= 0.0) {
            return;
        }
        this.damage = 0.0;
    }

    // Port of Creature.cs DoTasks(DateTime) (line 531); time in game seconds.
    doTasks(time: number = this.galaxy.currentTimeSeconds): void {
        const timePassed = time - this.lastTouch;
        const totalSeconds1 = time - this.lastShortTouch;
        const totalSeconds2 = time - this.lastPeriodicTouch;
        const totalSeconds3 = time - this.lastLongTouch;
        this.move(timePassed, time);
        this.doLocationEffects(timePassed);
        if (totalSeconds1 >= 3.0) {
            creatureCheckForAttackers(this.galaxy, this);
            creatureAttackTarget(this.galaxy, this, totalSeconds1, time);
            this.heal(totalSeconds1);
            this.applyLocationEffects();
            this.lastShortTouch = time;
        }
        if (totalSeconds2 >= 10.0) {
            if (this.isVisible) creatureCheckForTargets(this.galaxy, this);
            if (this.hasBeenDestroyed) {
                this.completeTeardown();
            }
            this.checkFixNotInSystem();
            this.lastPeriodicTouch = time;
        }
        if (totalSeconds3 >= 30.0) {
            this.split();
            this.chooseAction();
            this.reproduce(totalSeconds3);
            this.attackers.length = 0;
            this.lastLongTouch = time;
        }
        this.lastTouch = time;
    }

    private systemCreatures(systemIndex: number): Creature[] | null {
        const system = this.galaxy.systems[systemIndex];
        if (system === undefined) return null;
        if (!system.creatures) system.creatures = [];
        return system.creatures;
    }

    // Port of Creature.cs CheckFixNotInSystem (line 570).
    private checkFixNotInSystem(): void {
        if (this.currentSpeed > this.movementSpeed) {
            return;
        }
        if (this.promptSystemCheck) {
            const nearestSystem = this.galaxy.fastFindNearestSystem(this.xpos, this.ypos);
            if (nearestSystem !== this.nearestSystemStar && nearestSystem !== null) {
                if (this.nearestSystemStar !== null) {
                    const list = this.systemCreatures(this.nearestSystemStar.systemIndex);
                    if (list !== null) removeFrom(list, this);
                }
                if (this.galaxy.calculateDistance(this.xpos, this.ypos, nearestSystem.xpos, nearestSystem.ypos) < 25000.0) {
                    this.nearestSystemStar = nearestSystem;
                }
                if (this.nearestSystemStar !== null) {
                    const list = this.systemCreatures(this.nearestSystemStar.systemIndex);
                    if (list !== null && !list.includes(this)) list.push(this);
                    if (this.parentHabitat !== null && this.parentHabitat.systemIndex !== this.nearestSystemStar.systemIndex) this.parentHabitat = null;
                    if (this.anchorHabitat !== null && this.anchorHabitat.systemIndex !== this.nearestSystemStar.systemIndex) this.anchorHabitat = null;
                }
            }
            this.promptSystemCheck = false;
        }
        if (this.nearestSystemStar !== null) {
            const list = this.systemCreatures(this.nearestSystemStar.systemIndex);
            if (list !== null && !list.includes(this)) {
                list.push(this);
                const star = this.galaxy.systems[this.nearestSystemStar.systemIndex].systemStar;
                this.nearestSystemStar = star;
                if (this.parentHabitat !== null && this.parentHabitat.systemIndex !== star.systemIndex) this.parentHabitat = null;
                if (this.anchorHabitat !== null && this.anchorHabitat.systemIndex !== star.systemIndex) this.anchorHabitat = null;
            }
        }
        if (this.parentHabitat !== null) {
            const list = this.systemCreatures(this.parentHabitat.systemIndex);
            if (list !== null && !list.includes(this)) {
                list.push(this);
                const star = this.galaxy.systems[this.parentHabitat.systemIndex].systemStar;
                this.nearestSystemStar = star;
                if (this.parentHabitat.systemIndex !== star.systemIndex) this.parentHabitat = null;
                if (this.anchorHabitat !== null && this.anchorHabitat.systemIndex !== star.systemIndex) this.anchorHabitat = null;
            }
        }
        if (this.anchorHabitat === null) {
            return;
        }
        const list1 = this.systemCreatures(this.anchorHabitat.systemIndex);
        if (list1 === null || list1.includes(this)) {
            return;
        }
        list1.push(this);
        const star1 = this.galaxy.systems[this.anchorHabitat.systemIndex].systemStar;
        this.nearestSystemStar = star1;
        if (this.parentHabitat !== null && this.parentHabitat.systemIndex !== star1.systemIndex) this.parentHabitat = null;
        if (this.anchorHabitat.systemIndex === star1.systemIndex) return;
        this.anchorHabitat = null;
    }

    // Port of Creature.cs ChooseAction (line 648).
    private chooseAction(): void {
        if (this.currentTarget !== null || this.currentSpeed > 0.0 || this.targetSpeed > 0.0) {
            return;
        }
        let num = this.galaxy.rnd.next(0, 6);
        if (this.type === CreatureType.SilverMist) {
            num = this.galaxy.rnd.next(0, 3);
        }
        switch (num) {
            case 0:
            case 1:
                this.initiateWander();
                break;
            case 2:
            case 3:
                break;
            default:
                this.hideCreature();
                break;
        }
    }

    // Port of Creature.cs ReduceAngle / IncreaseAngle.
    private reduceAngle(a: number): number {
        return a >= Math.PI ? a - 2.0 * Math.PI : a;
    }

    private increaseAngle(a: number): number {
        return a <= -1.0 * Math.PI ? a + 2.0 * Math.PI : a;
    }

    // Port of Creature.cs CalculateCurrentHeading (line 685).
    private calculateCurrentHeading(timePassed: number): void {
        if (this.currentHeading === this.targetHeading) {
            return;
        }
        const num1 = this.turnRate * timePassed;
        const num2 = this.targetHeading - this.currentHeading;
        const it = { n: 0 };
        if ((num2 < 0.0 && num2 > -1.0 * Math.PI) || (num2 >= Math.PI && num2 < 2.0 * Math.PI)) {
            if (Math.abs(num2) < Math.abs(num1)) {
                this.currentHeading = this.targetHeading;
                this.turnDirection = TurnDirection.StraightAhead;
            } else {
                this.currentHeading = Math.fround(this.currentHeading - Math.fround(num1));
                this.turnDirection = TurnDirection.Left;
            }
            while (conditionCheckLimit(this.currentHeading <= -1.0 * Math.PI, 20, it)) {
                this.currentHeading = Math.fround(this.increaseAngle(this.currentHeading));
            }
        } else {
            if (Math.abs(num2) < Math.abs(num1)) {
                this.currentHeading = this.targetHeading;
                this.turnDirection = TurnDirection.StraightAhead;
            } else {
                this.currentHeading = Math.fround(this.currentHeading + Math.fround(num1));
                this.turnDirection = TurnDirection.Right;
            }
            while (conditionCheckLimit(this.currentHeading >= Math.PI, 20, it)) {
                this.currentHeading = Math.fround(this.reduceAngle(this.currentHeading));
            }
        }
    }

    // Port of Creature.cs AccelerateToTargetSpeed (line 725).
    private accelerateToTargetSpeed(timePassed: number, accelerationRate: number): void {
        if (this.targetSpeed > this.currentSpeed) {
            const num = accelerationRate * timePassed;
            if (this.currentSpeed + num >= this.targetSpeed) this.currentSpeed = this.targetSpeed;
            else this.currentSpeed = Math.fround(this.currentSpeed + Math.fround(num));
        } else if (this.targetSpeed < this.currentSpeed) {
            const num = Math.max(1.0, accelerationRate) * timePassed;
            if (this.currentSpeed - num < this.targetSpeed) this.currentSpeed = this.targetSpeed;
            else this.currentSpeed = Math.fround(this.currentSpeed - Math.fround(num));
        }
        if (this.currentSpeed >= 0.0) return;
        this.currentSpeed = 0;
    }

    private hideCreature(): void {
        if (!this.canHide) return;
        this.isVisible = false;
    }

    private showCreature(): void {
        this.isVisible = true;
    }

    // Port of Creature.cs InitiateWander (line 757).
    initiateWander(): void {
        const rnd = this.galaxy.rnd;
        if (this.anchorHabitat !== null && this.currentTarget === null) {
            this.showCreature();
            if (this.type === CreatureType.Kaltor && !this.locationLocked) {
                if (rnd.next(0, 2) === 1) {
                    let habitat: Habitat | null = null;
                    let num = 536870911.0;
                    const sysHabitats = this.galaxy.systemHabitatsOf(this.anchorHabitat.systemIndex);
                    for (let index = 0; num > 8000.0 && index < 20; ++index) {
                        if (sysHabitats.length > 0) {
                            habitat = sysHabitats[rnd.next(0, sysHabitats.length)];
                            num = this.galaxy.calculateDistance(habitat.xpos, habitat.ypos, this.anchorHabitat.xpos, this.anchorHabitat.ypos);
                        }
                    }
                    if (habitat !== null && habitat !== this.anchorHabitat) this.anchorHabitat = habitat;
                }
            } else if (this.type === CreatureType.SilverMist && !this.locationLocked) {
                let habitat1: Habitat | null = null;
                const ordered = this.galaxy.generateDistanceOrderedSystemList(this.xpos, this.ypos);
                for (let index1 = 0; habitat1 === null && index1 < 20; ++index1) {
                    const index2 = rnd.next(1, Math.min(5, ordered.length));
                    habitat1 = ordered[index2].systemStar;
                    if (habitat1 !== null && this.galaxy.calculateDistance(this.xpos, this.ypos, habitat1.xpos, habitat1.ypos) > 1000000.0) {
                        habitat1 = null;
                    }
                }
                if (habitat1 !== null) {
                    let habitat2: Habitat = habitat1;
                    const sysHabitats = this.galaxy.systemHabitatsOf(habitat1.systemIndex);
                    if (sysHabitats.length > 0) {
                        habitat2 = sysHabitats[rnd.next(0, sysHabitats.length)];
                    }
                    this.parentHabitat = habitat2;
                    this.anchorHabitat = habitat2;
                    const num1 = (this.parentHabitat.diameter / 2.0) * rnd.nextDouble();
                    const num2 = rnd.nextDouble() * Math.PI * 2.0;
                    this.parentOffsetX = Math.cos(num2) * num1;
                    this.parentOffsetY = Math.sin(num2) * num1;
                    this.parentX = Math.cos(num2) * num1;
                    this.parentY = Math.sin(num2) * num1;
                    this.targetSpeed = this.movementSpeed;
                }
            } else if (this.type === CreatureType.Ardilus && !this.locationLocked && rnd.next(0, 2) === 1) {
                let habitat: Habitat | null = null;
                const habitats = this.galaxy.habitats;
                let index = this.anchorHabitat.habitatIndex + 1;
                const it = { n: 0 };
                while (conditionCheckLimit(habitat === null, 40000, it)) {
                    if (index >= habitats.length) index = 0;
                    if (
                        habitats[index].type === HabitatType.GasGiant &&
                        this.galaxy.calculateDistance(habitats[index].xpos, habitats[index].ypos, this.xpos, this.ypos) < 1000000.0
                    ) {
                        habitat = habitats[index];
                        let flag = false;
                        const sys = this.galaxy.systems[this.galaxy.determineHabitatSystemStar(habitat).systemIndex];
                        if (sys.dominantEmpire != null && sys.dominantEmpire.empire != null && !checkEmpireHasHyperDriveTech(sys.dominantEmpire.empire)) flag = true;
                        if (flag) habitat = null;
                    }
                    ++index;
                    if (index >= habitats.length) index = 0;
                    if (index === this.anchorHabitat.habitatIndex) break;
                }
                if (habitat !== null && habitat !== this.anchorHabitat) this.anchorHabitat = habitat;
            }
            if (this.anchorHabitat === null) return;
            this.parentHabitat = this.anchorHabitat;
            let num3 = this.parentHabitat.diameter;
            if (num3 < this.anchorRange * 2) num3 = this.anchorRange * 2;
            let num4 = num3 - 20.0;
            if (num4 < 1.0) num4 = 1.0;
            const num5 = (num4 / 2.0) * rnd.nextDouble();
            const num6 = rnd.nextDouble() * Math.PI * 2.0;
            this.parentOffsetX = Math.cos(num6) * num5;
            this.parentOffsetY = Math.sin(num6) * num5;
            this.targetSpeed = this.movementSpeed;
        } else {
            if (this.anchorPoint === null || this.currentTarget !== null || rnd.next(0, 2) !== 1) return;
            const num7 = rnd.nextDouble() * Math.PI * 2.0;
            const num8 = this.anchorRange * 0.9 * rnd.nextDouble();
            this.parentOffsetX = Math.cos(num7) * num8;
            this.parentOffsetY = Math.sin(num7) * num8;
            this.targetSpeed = this.movementSpeed;
        }
    }

    // Port of Creature.cs Split (line 869).
    split(): void {
        const g = this.galaxy;
        if (
            g.silverMistCreatureCount >= Math.trunc(Math.sqrt(g.starCount)) ||
            this.type !== CreatureType.SilverMist ||
            this.currentSpeed > 0.0 ||
            this.damage > Math.trunc(this.damageKillThreshold * 0.2) ||
            this.size <= g.rnd.next(400, 550)
        ) {
            return;
        }
        const num = Math.trunc(this.size / 2);
        this.size -= num;
        this.attackStrength = Math.trunc(this.size / 10.0);
        this.damageKillThreshold = Math.trunc(this.size * 3.0);
        const creature = new Creature(g, CreatureType.SilverMist, this.parentHabitat, Math.trunc(this.parentX), Math.trunc(this.parentY));
        creature.size = num;
        creature.attackStrength = Math.trunc(creature.size / 10.0);
        g.creatures.push(creature);
        if (this.nearestSystemStar !== null) {
            this.systemCreatures(this.nearestSystemStar.systemIndex)?.push(creature);
            creature.nearestSystemStar = this.nearestSystemStar;
        }
        ++g.silverMistCreatureCount;
    }

    // Port of Creature.cs Reproduce (line 889).
    reproduce(timePassed: number): void {
        const g = this.galaxy;
        if (g.creatures.length >= Math.trunc(g.starCount / 2) || this.type === CreatureType.SilverMist || this.nearestSystemStar === null) {
            return;
        }
        if (g.systems.length > this.nearestSystemStar.systemIndex) {
            const list = g.systems[this.nearestSystemStar.systemIndex].creatures;
            if (list) {
                let num = 20;
                const system = g.systems[this.nearestSystemStar.systemIndex];
                if (system.dominantEmpire != null && system.dominantEmpire.empire != null) num = 4;
                if (list.length > num) return;
            }
        }
        if (this.type === CreatureType.Kaltor) {
            this.reproductionCounter += timePassed / 10.0;
        }
        if (this.reproductionCounter <= 100.0 || this.currentTarget !== null || this.parentHabitat === null) {
            return;
        }
        this.reproductionCounter = 0.0;
        const parentHabitat = this.parentHabitat;
        if (this.type !== CreatureType.Kaltor) return;
        const num1 = g.rnd.next(1, 3);
        for (let index = 0; index < num1; ++index) {
            const creature = new Creature(g, CreatureType.Kaltor, parentHabitat);
            g.creatures.push(creature);
            if (this.nearestSystemStar !== null) {
                this.systemCreatures(this.nearestSystemStar.systemIndex)?.push(creature);
                creature.nearestSystemStar = this.nearestSystemStar;
            }
        }
    }

    // Port of Creature.cs DamageCreature (line 926) with weapon == null
    // (location damage). TODO(port): Ion-weapon bypass, empire kill counters.
    damageCreature(damage: number): boolean {
        if (this.type === CreatureType.SilverMist) {
            damage = Math.max(1, Math.trunc(damage / 10.0));
        }
        this.damage += damage;
        if (this.damage > this.damageKillThreshold) {
            this.hasBeenDestroyed = true;
            removeFrom(this.galaxy.creatures, this);
            if (this.parentHabitat !== null) {
                const l = this.galaxy.systems[this.parentHabitat.systemIndex]?.creatures;
                if (l) removeFrom(l, this);
            } else if (this.nearestSystemStar !== null) {
                const l = this.galaxy.systems[this.nearestSystemStar.systemIndex]?.creatures;
                if (l) removeFrom(l, this);
            }
            return true;
        }
        if (this.damage < 0.0) this.damage = 0.0;
        return false;
    }

    // Port of Creature.cs CompleteTeardown (line 948). TODO(port): GalaxyLocation.RelatedCreatures
    // (not modelled on the TS GalaxyLocation; only story special zones set it).
    completeTeardown(): void {
        if (this.currentTarget !== null) {
            const pursuers = stellarPursuers(this.currentTarget);
            if (pursuers !== null) removeFrom(pursuers, this as StellarObject);
            const attackers = stellarAttackers(this.currentTarget);
            if (attackers !== null) removeFrom(attackers, this as StellarObject);
        }
        const builtObjects = this.galaxy.builtObjects;
        for (let index1 = 0; index1 < builtObjects.length; ++index1) {
            const bo = builtObjects[index1];
            if (bo != null) {
                const index2 = bo.attackers !== null ? bo.attackers.indexOf(this) : -1;
                if (index2 >= 0) bo.attackers!.splice(index2, 1);
                const index3 = bo.pursuers !== null ? bo.pursuers.indexOf(this) : -1;
                if (index3 >= 0) bo.pursuers!.splice(index3, 1);
                if (bo.currentTarget === this) bo.currentTarget = null;
                // 969-982: fighters targeting this creature abandon it, re-evaluate threats, patrol (combat/fighters.ts).
                if (bo.fighters != null && bo.fighters.length > 0) clearFightersTargeting(this.galaxy, bo, (t) => t === this);
            }
        }
        removeFrom(this.galaxy.creatures, this);
        for (const system of this.galaxy.systems) {
            if (system.creatures) {
                while (system.creatures.includes(this)) removeFrom(system.creatures, this);
            }
        }
    }

    // Port of Creature.cs Move (line 998); `tempNow` in game seconds (the lunge clock).
    private move(timePassed: number, tempNow: number): void {
        const g = this.galaxy;
        if (this.targetSpeed > 0.0 || this.currentSpeed > 0.0) {
            let num1 = this.xpos;
            let num2 = this.ypos;
            if (!this.isBenign && this.currentTarget !== null) {
                if (creatureCheckTargetInRange(g, this, this.currentTarget)) {
                    num1 = this.currentTarget.xpos;
                    num2 = this.currentTarget.ypos;
                    this.targetSpeed = Math.fround(this.movementSpeed);
                } else {
                    this.currentTarget = null;
                    this.distanceToTarget = Number.MAX_VALUE;
                    this.targetSpeed = 0;
                }
            } else if (this.isBenign && this.attackers.length > 0) {
                this.fleeFromAttacker(this.attackers[0]);
            } else if (this.parentHabitat !== null) {
                num1 = this.parentHabitat.xpos + this.parentOffsetX;
                num2 = this.parentHabitat.ypos + this.parentOffsetY;
            } else if (this.anchorPoint !== null) {
                num1 = this.anchorPoint.x + this.parentOffsetX;
                num2 = this.anchorPoint.y + this.parentOffsetY;
            } else {
                this.targetSpeed = 0;
                this.accelerateToTargetSpeed(timePassed, this.accelerationRate);
                return;
            }
            if (num1 !== this.xpos && num2 !== this.ypos) {
                this.targetHeading = Math.fround(determineAngle(this.xpos, this.ypos, num1, num2));
            }
            let accelerationRate = this.accelerationRate;
            if (this.currentTarget !== null && this.lungeSpeed > 0) {
                const timeSpan = tempNow - this.lastLunge;
                if (timeSpan <= this.lungeLength) {
                    this.targetSpeed = Math.fround(this.lungeSpeed);
                    accelerationRate = this.lungeAccelerationRate;
                } else if (timeSpan > this.lungeInterval) {
                    if (Math.abs(this.targetHeading - this.currentHeading) < 0.5 && g.calculateDistance(this.currentTarget.xpos, this.currentTarget.ypos, this.xpos, this.ypos) < this.lungeLength * this.lungeSpeed) {
                        this.lastLunge = tempNow;
                        this.targetSpeed = Math.fround(this.lungeSpeed);
                        accelerationRate = this.lungeAccelerationRate;
                    }
                } else {
                    this.targetSpeed = Math.fround(this.movementSpeed);
                    this.currentSpeed = Math.fround(this.movementSpeed);
                    accelerationRate = this.accelerationRate;
                }
            }
            this.calculateCurrentHeading(timePassed);
            this.accelerateToTargetSpeed(timePassed, accelerationRate);
            const num3 = this.currentSpeed * timePassed;
            if (this.parentHabitat !== null) {
                if (this.currentTarget === null) {
                    // CalculateCurrentParentOffset + step + ApplyCurrentParentOffset.
                    this.parentX = this.xpos - this.parentHabitat.xpos;
                    this.parentY = this.ypos - this.parentHabitat.ypos;
                    this.parentX += Math.cos(this.currentHeading) * num3;
                    this.parentY += Math.sin(this.currentHeading) * num3;
                    this.xpos = this.parentHabitat.xpos + this.parentX;
                    this.ypos = this.parentHabitat.ypos + this.parentY;
                } else {
                    this.xpos += Math.cos(this.currentHeading) * num3;
                    this.ypos += Math.sin(this.currentHeading) * num3;
                    this.parentX = this.xpos - this.parentHabitat.xpos;
                    this.parentY = this.ypos - this.parentHabitat.ypos;
                }
            } else {
                this.xpos += Math.cos(this.currentHeading) * num3;
                this.ypos += Math.sin(this.currentHeading) * num3;
            }
            const arrived = this.checkWhetherArrived(this.xpos, this.ypos, num1, num2, 30.0);
            if (arrived.arrived) {
                this.targetSpeed = 0;
                if (this.currentTarget !== null && !isHabitatTarget(this.currentTarget)) {
                    this.targetSpeed = this.currentTarget.currentSpeed;
                    if (this.targetSpeed > this.movementSpeed) this.targetSpeed = Math.fround(this.movementSpeed);
                }
                if (this.currentSpeed <= this.movementSpeed || this.currentSpeed <= this.lungeSpeed) return;
                // Arriving from hyperspeed: drop out at a hyperjump exit point.
                this.currentSpeed = this.movementSpeed;
                const exit = g.selectHyperJumpExitPoint(BaseHyperJumpAccuracy);
                this.xpos = num1 + exit.x;
                this.ypos = num2 + exit.y;
                this.nearestSystemStar = g.fastFindNearestSystem(this.xpos, this.ypos);
                if (this.nearestSystemStar !== null) {
                    this.systemCreatures(this.nearestSystemStar.systemIndex)?.push(this);
                }
            } else {
                this.targetSpeed = this.movementSpeed;
                if (this.hyperSpeed <= 0 || arrived.currentDistance <= HyperJumpThreshhold || this.targetSpeed >= this.hyperSpeed) return;
                if (this.hyperCountdown === 0) this.hyperCountdown = g.rnd.next(8000, 14000);
                this.hyperCountdown -= Math.trunc(timePassed * 1000.0);
                if (this.hyperCountdown > 0) return;
                this.hyperCountdown = 0;
                this.targetSpeed = this.hyperSpeed;
                this.currentSpeed = this.hyperSpeed;
                if (this.nearestSystemStar === null) return;
                const l = g.systems[this.nearestSystemStar.systemIndex]?.creatures;
                if (l) removeFrom(l, this);
                this.nearestSystemStar = null;
                this.parentHabitat = null;
                this.anchorHabitat = null;
            }
        } else {
            if (this.currentTarget !== null) {
                if (!isHabitatTarget(this.currentTarget)) {
                    this.targetSpeed = this.currentTarget.currentSpeed;
                    if (this.targetSpeed > this.movementSpeed) this.targetSpeed = Math.fround(this.movementSpeed);
                } else {
                    this.targetSpeed = Math.fround(this.movementSpeed);
                }
            }
            if (this.parentHabitat === null) return;
            this.xpos = this.parentHabitat.xpos + this.parentX;
            this.ypos = this.parentHabitat.ypos + this.parentY;
        }
    }

    // Port of Creature.cs FleeFromAttacker (line 1190).
    private fleeFromAttacker(attacker: StellarObject): void {
        this.targetHeading = Math.fround(determineAngle(attacker.xpos, attacker.ypos, this.xpos, this.ypos));
        this.targetSpeed = Math.fround(this.movementSpeed);
    }

    // Port of Creature.cs CheckWhetherArrived (line 1150).
    private checkWhetherArrived(cx: number, cy: number, tx: number, ty: number, allowance: number): { arrived: boolean; currentDistance: number } {
        const g = this.galaxy;
        const currentDistance = g.calculateDistance(cx, cy, tx, ty);
        if (currentDistance <= allowance) {
            this.lastPositionX = cx;
            this.lastPositionY = cy;
            return { arrived: true, currentDistance };
        }
        const distance1 = g.calculateDistance(this.lastPositionX, this.lastPositionY, tx, ty);
        const distance2 = g.calculateDistance(this.lastPositionX, this.lastPositionY, cx, cy);
        this.lastPositionX = cx;
        this.lastPositionY = cy;
        return { arrived: distance1 <= distance2, currentDistance };
    }

    // Port of Creature.cs ApplyLocationEffects (line 1609).
    private applyLocationEffects(): void {
        const locations = this.galaxy.determineGalaxyLocationsAtPoint(this.xpos, this.ypos);
        let flag1 = false;
        let flag2 = false;
        let flag3 = false;
        let num1 = 0.0;
        let flag4 = false;
        let num2 = 0.0;
        let num3 = 0.0;
        for (const location of locations) {
            switch (location.effect) {
                case GalaxyLocationEffectType.HyperjumpDisabled:
                    flag3 = true;
                    break;
                case GalaxyLocationEffectType.MovementSlowed:
                    flag1 = true;
                    break;
                case GalaxyLocationEffectType.ShipDamage:
                    flag2 = true;
                    num1 = location.effectAmount;
                    break;
                case GalaxyLocationEffectType.ShipPull: {
                    flag4 = true;
                    const x2 = location.xpos + location.width / 2.0;
                    const y2 = location.ypos + location.height / 2.0;
                    const distance = this.galaxy.calculateDistance(this.xpos, this.ypos, x2, y2);
                    const num4 = location.width / 2.0 / distance;
                    num2 = location.effectAmount * num4;
                    num3 = determineAngle(this.xpos, this.ypos, x2, y2);
                    break;
                }
            }
        }
        this.creatureDamageAmountLocation = flag2 ? Math.fround(num1) : 0;
        if (flag4) {
            this.creaturePullAmountLocation = Math.fround(num2);
            this.creaturePullAngleLocation = Math.fround(num3);
        } else {
            this.creaturePullAmountLocation = 0;
            this.creaturePullAngleLocation = 0;
        }
        this.hyperjumpDisabledLocation = flag3;
        if (flag1) {
            this.movementSpeed = Math.trunc(this.movementSpeedBase * 0.75);
            this.lungeSpeed = Math.trunc(this.lungeSpeedBase * 0.75);
        } else if (!flag1 && this.movementSlowedLocation) {
            this.movementSpeed = this.movementSpeedBase;
            this.lungeSpeed = this.lungeSpeedBase;
        }
        this.movementSlowedLocation = flag1;
    }

    // Port of Creature.cs DoLocationEffects (line 1672).
    private doLocationEffects(timePassed: number): void {
        if (this.creatureDamageAmountLocation > 0.0 && this.damageCreature(Math.trunc(this.creatureDamageAmountLocation * timePassed))) {
            this.completeTeardown();
        }
        if (this.creaturePullAmountLocation <= 0.0) return;
        const num = this.creaturePullAmountLocation * timePassed;
        this.xpos += Math.cos(this.creaturePullAngleLocation) * num;
        this.ypos += Math.sin(this.creaturePullAngleLocation) * num;
        if (this.parentHabitat !== null) {
            this.parentOffsetX += Math.cos(this.creaturePullAngleLocation) * num;
            this.parentOffsetY += Math.sin(this.creaturePullAngleLocation) * num;
        }
        this.targetHeading = Math.fround(this.creaturePullAngleLocation + Math.fround(3.14159274));
        this.currentSpeed = this.topSpeed;
    }
}
