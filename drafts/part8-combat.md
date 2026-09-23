---

## PART 4 — SHIPS, FLEETS, AND COMBAT (complete model)

### 4.1 Ship and base model
A ship/base = Design + Components + state.
- **Components**: each is an instance of a researched component definition (see Part 14.7) with Value1–7 stats and status `Normal` / `Damaged` / `Destroyed` (damaged components still occupy space but provide no effect; destroyed ones are gone until repaired).
- **Size** = sum of component sizes (the "hull"). A ship's hull integrity is measured against the sum of sizes of its undamaged components: cumulative hull damage ≥ that sum destroys the ship.
- **Energy**: reactors produce energy (Value1/s) into storage (Value2), consuming fuel (Value3 fuel units to charge; fuel resource per Value4) when storage is low; Energy Collectors generate energy passively; Energy-to-Fuel converters produce fuel from energy (for pirates/empires with fuel-shortage policies); Fuel Cells store fuel. If energy or fuel runs out, dependent components (weapons, shields, engines) go inactive.
- **Movement**: main thrust engines give top speed (Value1) and cruise speed (Value3) with per-second energy costs; vectoring engines add maneuverability; inside movement-slowed nebulae both are ×0.75. Fuel-hungry ships run out of fuel if not refueled (fuel-hungry: weapons + engines consume fuel indirectly through reactor recharging).
- **Hyperdrive**: one per ship (auto-added). Jump initiation time (Value3), top speed and energy use (Value1/V2). Hyperjumps take the ship out of the system for a travel time proportional to distance; the destination is chosen by the ship's next mission waypoint. **HyperDeny** (and HyperStop/Gravity Well Projector) components prevent enemy hyperjumps within their range; ships in a `HyperjumpDisabled` location cannot jump.
- **Fighter bays**: store fighters/bombers (capacity = Value1); repair rate Value2/s (manufacture rate = half); carriers and large military ships have bays; fighters are launched automatically for defense (if the parent ship is under attack) or per assigned fighter missions (attack: fly out and engage the target's fighters/ship; defend: orbit the parent and intercept incoming fighters). Fighters: shield capacity, recharge, hull (Size), health fraction, countermeasure bonus, armor, 2 weapon slots, reactor (capacity/recharge), top speed (half speed when not attacking), acceleration (5–100), turn rate (0.5–6.28 rad/s). The AI builds the highest-tech-level researched fighter/bomber for its carriers.
- **Crew/support**: Life Support + Hab Modules (Value1 = supported size) + Command Center (Value1 = maintenance savings %) determine how many ships can dock and how cheaply the ship maintains. Command centers also give a maintenance cost discount for the whole ship/base.
- **Cargo / passengers / troops**: Cargo Bays (capacity), Passenger Compartments, Troop Compartments (capacity), Docking Bays (cargo throughput for docked ships), Commerce Centers (trade bonus %).
- **Manufacturers**: ship-board factories that build new ships/bases (3 industry variants) — the core of expansion; Construction Yards likewise (Value1 = build speed). Building a new ship consumes the builder's components' manufacturing points and takes time (build time scales with the new ship's size and the yard's speed; a "build queue" per yard).
- **Extractors**: Mining Engine (minerals), Gas Extractor, Luxury Extractor — on mining ships/stations; extraction rate Value1 (boosted by the empire's ResourceExtractionBonus).
- **Sensors/computers**: Proximity Array (range + hyperjump tracking %), Long-Range Scanner, Resource Profile Sensor, Trace Scanner (range+power; reveals stealthed ships and boosts boarding attack +power/100%), Scanner Jammer, Combat Targeting (targeting bonus %; fleet variants apply to the whole fleet), Countermeasures (fleet or ship; % bonus to evade enemy fire), Stealth (rating), Ion Defense.
- **Defense**: Shields (capacity, recharge/s), Area Shield Recharge (restores nearby friendly ships' shields below 50% within range), Armor (rating + reactive rating; see damage model), Damage Control (damage reduction % + repair time per component), Point Defense (vs fighters and assault pods; each PD weapon fires at targets within range with the normal hit math; PD target selection: the incoming fighter with "size + shields + 1" × empire attack-overmatch factor as its priority weight), Assault Pods (see boarding).
- **Weapons** (every type fires with: range check (including fleet weapons-range bonus and captain weapons-range bonus), energy availability, fire rate (ms) + random ±400 ms jitter, hit determination (below), then projectile flight and impact). Types and behaviors:
  - **Beam / Super Beam**: instant hit at fire time (no projectile); full damage on hit.
  - **Phaser / Super Phaser**: hits shields but does NOT trigger the shield-strike stun window (LastShieldStrike is not updated), i.e. phasers can punch through the "shield flicker" timing other weapons suffer.
  - **Rail Gun / Super Rail Gun**: split damage — a random 25%–75% of the hit power still hits shields, the remainder (50%–75%) goes straight to armor/hull (armored penetration).
  - **Missile / Super Missile, Torpedo / Super Torpedo**: homing projectiles (speed Value4); damage halved (min 1) when consumed by armor; torpedo Value7 = bombard damage for colony strikes.
  - **Area (Ion Pulse / Area Destruction / Super Area / Area Gravity)**: blast weapon — checks a minimum number of weapons/targets condition (CheckFireAreaWeaponAtTarget) before firing; damages multiple targets in radius; area-gravity also pulls.
  - **Gravity Beam / Area Gravity**: continuous beam/field; **bypasses shields entirely** (full power to armor/hull); gravity beam applies an alternating push/pull force to the target (damage rate scales with raw damage / target size and distance falloff, clamped 20–60 per tick).
  - **Ion Cannon**: no hull damage; disables target components (ion damage; ion defense resists); **the only weapon that can destroy Silver Mist creatures**.
  - **Tractor Beam**: pulls/pushes the target (Value1 power, range, energy per firing, projection speed, power loss per 100 range, fire rate ms); cannot target bases; used to push ships/creatures.
  - **Bombard weapons**: any weapon with Value7>0 can bombard a colony (see 4.6).
  - **HyperDeny / HyperStop**: not damage; disable enemy hyperjumps in range.
  - **Assault Pod**: the boarding weapon (see 4.7).
- **Superweapons** (race-unique SpecialComponents, researchable via special-function-3 projects, mostly race-locked): Death Ray, Devastator Pulse, Super Laser (super beam), StarBurner XX-12 (engine), TurboThruster ER7 (engine), Swift Vector 5000 (vectoring), Megatron Z4 (shields), NovaCore NX-700 (reactor), VelocityDrive ST3 (hyperdrive), ShadowGhost ECM 2000 (countermeasures), Shaktur FireStorm (beam), High Density Fuel Cell, S2F7 RepairBot (damage control), PulseWave Cannon (super area), Raptor Targetting System.
- **Planet Destroyer** (storyline): a base carrying super beam/super torpedo/super missile/super railgun/super phaser; when attacking a designated colony within range+300 it focuses fire to destroy the planet (permanent); it cannot fire other super weapons at non-designated targets.

### 4.2 Hit determination (exact, from source)
For a firing weapon at a target at distance D (D < weapon effective range R_eff = Range × fleet-WeaponsRangeBonus × captain-WeaponsRangeBonus):
1. `hitRangeChance = 0.15 + max(0, (R_eff − D) / R_eff)` (0.15 at range edge → 1.15 at point blank).
2. Target-speed factor `val = 10 / max(1, target.CurrentSpeed)`, clamped 0.7–5.0, then ×2. For fighter targets: val/1.1 for non-PD weapons, val×2.0 for point defense (PD is much more accurate vs fighters).
3. Targeting modifier `t = (TargettingModifier + FleetTargetingBonus) / 100` (targeting components; +20 flat for the PredictiveHistory race event).
4. `score = val × (hitRangeChance + Rnd(0..1) + t)`; × fleet TargetingBonus; × captain targeting bonus.
5. Rare luck events (1/15 chance): if score > 0.5 it is set to 0 (botch); if score ≤ 0.5 and in range it is set to 1 (ace).
6. Hit iff score > 0.5. On a miss the projectile expires at range (WeaponMissEnemy battle stat).
Countermeasures: the defender's countermeasure bonus (ship + fleet + captain + race) reduces the attacker's effective hit score (applied in the weapon-hit step); stealth reduces detection, not hit chance.

### 4.3 Damage pipeline (exact, from InflictDamage)
When a hit lands with power P (already scaled by attacker weapon-damage bonuses, e.g. captain weapons skill):
- **Creature target**: creature damage model (Silver Mist: ion only).
- **Fighter target**: if P ≤ shields → shields −= P (record strike time/direction for FX). Else shields → 0 and hull damage = P − shields; hull destroyed when size×health ≤ damage (explosion, war-damage event, visibility updated).
- **Ship/base target**:
  1. Weapon-class handling: rail/super-rail splits (random 25–75% to shields, rest to armor/hull); phaser/super-phaser and beam/area-gravity classes as in 4.1; gravity bypasses shields.
  2. Armor pass (unless bypassed): for the first armor component block: reactive rating V2 (× empire armor-reactivity multiplier, × ArmorReinforcingFactor/100; halved vs phasers) absorbs up to V2 points — if remaining ≤ V2 the damage is nulled (or leaves 0–1 point randomly). Remaining damage vs base armor rating V1 (× ArmorReinforcingFactor/100): with probability max(0.1, remaining/V1) that armor block is Disabled (damaged); damage reduced by V1; repeat through armor blocks. Missile/rail/super-missile/super-rail damage is first halved (min 1) against armor.
  3. Damage control: damage ×= (1 − DamageReduction × fleet-damage-control-bonus × captain-damage-control-bonus).
  4. Hull: capped at ship Size. When cumulative hull damage ≥ sum of undamaged component sizes → ship destroyed (explosion sequence, cargo/troops/characters aboard die per their death types, war-damage recorded, position becomes visible to the killer).
  5. Component-level damage (from certain weapons/bombard/boarding) sets components Damaged (Value effects suspended) until repaired by damage control (Value2 seconds per component) or a repair mission.
- **Shield-strike stun**: a shield hit records LastShieldStrike + direction; (used for FX and the "shields at X%" flee triggers).

### 4.4 Nebula/environmental effects during combat — see 3.1.4 (exact formulas).

### 4.5 Fighters and point defense in combat
- On being attacked, a ship with bays launches defenders (auto or by policy); incoming enemy fighters are engaged by point-defense weapons (each PD weapon fires at the closest available fighter target with the hit math of 4.2, PD accuracy ×2 speed factor) and by the fleet's defenders. Fighters attack enemy fighters (interceptors) or enemy ships/bases (bombers) per their type and assigned mission. Fighter squadrons: a bay's fighters act as a group; the parent's battle stats aggregate children's hits/misses.
- **Fleet posture**: Attack / Defend (Neutral via no assignment); **BattleTactics** per design/fleet: Evade (disengage when losing), Standoff (maintain range), All Weapons (fire everything), Point Blank (close in). Engagement range settings: ship/fleet default engagement range (cycled with comma key). Flee-when policies: EnemyMilitarySighted / Attacked / Shields50 / Shields20 / Armor50 / Never (per-ship and per-fleet defaults from empire policy). Encounter actions: Prompt (player popup) / Notify (message only) / None.
- **Blockade**: a military ship with a Blockade mission parks near an enemy colony/spaceport (only against empires with Trade Sanctions) and attacks anything attempting to dock/leave; blockaded targets cannot dock; repeated blockades escalate diplomatic offense.

### 4.6 Bombardment and planet damage
A military ship with a weapon carrying Value7 (bombard damage) can be given a Bombard mission (Shift-right-click on an enemy colony; policy-gated: WarAttacksAllowColonyBombardment 0=always/1=intensely-disliked/2=diabolical-reputation/3=never):
- If the planet has a Planetary Shield facility: no bombard damage.
- Otherwise: artillery garrison mitigation — factor = max(1, 0.5 + sqrt(artilleryDefendStrength × empire-intercept-bonus / 7500)); bombard power ÷ factor.
- Planet takes permanent damage: `habitat.Damage += power/8000` (capped at 1.0), then quality is recalculated (reduced quality → lower development cap; can be healed over very long time or by terraforming).
- Both sides' troops aboard/invading take `power × 1.5` losses; characters on the planet: each has power/1000 chance to be killed (death type ColonyBombardment).
- **Planetary defense units** (troops) are the only ground units that can fire at troops during the space→surface transition (invading troops are vulnerable "assault pod" sprites), and they mitigate bombardment (above).

### 4.7 Boarding, capture, and raiding (exact, from source)
- Prerequisites: research "Ship Boarding" (assault pod tech); the attacker must have Assault Pods and the target's `CurrentShields < pod's shield-penetration (V5)` (significantly depleted shields). Planets with a Planetary Shield cannot be raided by pods.
- While in AssaultRange, each available pod weapon fires (1-in-5 per tick) a pod at the target. Pod power = RawDamage(V1) × (race TroopStrength/100) × empire BoardingAttackFactor × RaidStrengthFactor; boosted +power/100 by attacker Trace Scanner and +1%/level by attacker BoardingAssault character skill.
- **Assault combat**: the target accumulates AssaultAttackValue; the target's own defense value = CalculateBoardingDefenseValue (based on size, life support/crew components, defense pods if any, character skills); both sides' pods also add to their side's values. Each tick both values decay: `attackers decay by dt×(2..4)/ratio`, `defenders decay by dt×(2..4)×ratio` where `ratio = clamp(attack/defense, 0.5, 2.0)` — a stronger boarding force drains the defense faster. During the fight, when `num2+num3 > Rnd×10×dt`, a random target component is disabled for 20–30 s (boarding damage).
- If the attacker value reaches 0 first: repelled; defense resets.
- If the defense value reaches 0: **capture** — the ship changes empire (owner, color, design kept), characters aboard die or are captured per rules, cargo/troops transferred; a crossed-swords symbol and an assault/defense summary show on the ship while boarding. Captured ships per empire policy (CaptureTargetConditionShip/Base, CaptureEnlist/Disassemble military & civilian, CaptureEnlistBase, UpgradeEnlistedMilitaryShips): the captor may enlist it into its fleets, upgrade it, or scrap it for loot (loot = 2 × ship's looting value × income factor × (1 − corruption); if the ship has no engines/hyperdrive or zero top speed it must be scrapped immediately, inflicting 1,000,000 damage to destroy it).
- **Raid** (Shift-Alt or pirate/mercenary mission): pods board; on success the raider gets raid bonuses (credits/research/resources per policy RaidBonusFactor) and the target suffers a 60-second raid countdown with penalties (cargo/tech loss); pirates raid planets too (see Pirate section).
- Point defense can shoot down inbound pods (same PD math).
