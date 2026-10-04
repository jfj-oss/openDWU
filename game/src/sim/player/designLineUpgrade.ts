// [improvements] Automatic design upgrades along the same tech line — a gameplay Improvement (ui/improvements.ts
// 'designLineUpgrade'; Distant Worlds 2-inspired, NOT in DW:U). PLAYER empire only; AI empires are never touched.
//
// The switch reaches the sim as the journaled player command `setDesignLineUpgrade` (player/playerOps.ts), which the
// game view issues at start / load and whenever the Improvement is toggled (ui/designLineUpgrade.ts). Only then is
// `empire.designLineUpgrade` true; a harness / headless / replayed-without-UI game never has it, so with it unset every
// function here returns at once and the game is 100% the original (no writes, no Rnd).
//
// Player-owned design types: a BuiltObjectSubRole becomes "the player's" once the player saves (creates, edits, copies,
// "Upgrade Manual"), auto-upgrades (Designs → Upgrade), loads, or retrofits ships to a manually made design of that
// sub-role (`empire.playerDesignSubRoles`, recorded by the player ops whether the Improvement is on or not; absent
// until the first one). With the Improvement on:
//   - the original design automation (BaconEmpire.CreateNewDesigns, designGeneration.ts createNewDesigns) no longer
//     generates new designs for the player-owned sub-roles (designLineOwnsSubRole); the untouched sub-roles keep the
//     original automation exactly (tech focus, naming, Rnd and all);
//   - when research completes with new components (Empire.3.cs DoResearchBreakthrough sets ReviewDesignsAndRetrofitFlag →
//     Empire.1.cs ReviewDesignsAndRetrofit), each buildable, non-obsolete design of a player-owned sub-role is upgraded
//     along its own tech lines (processDesignLineUpgrades), whether design automation is on or off: this replaces the
//     automation's regeneration there. Auto-generated designs of untouched sub-roles are never line-upgraded;
//   - Retrofit (fleet "Retrofit to latest designs", the single-ship Retrofit, auto-retrofit) sends a ship of a
//     player-owned sub-role to the newest upgrade descendant of its own design (lineRetrofitDesign).
//
// A line: component X may become component Y when
//   - Y fills the same kind of slot (componentLineFamily: any beam weapon ↔ beam weapon (blaster, laser, phaser, rail
//     gun — the WeaponBeam category), any super beam ↔ super beam; every other component only its own ComponentType,
//     so a missile stays a missile, a torpedo a torpedo, a bombard a bombard, a main engine a main engine), and
//   - one of Y's unlocking projects (research.txt COMPONENTS) is a descendant, through PARENTS, of one of X's.
//   X itself is always a candidate (its improvements are resolved by ResolveImprovedComponentValues).
// The strongest researched candidate wins by the original's per-type evaluation, ResearchSystem.cs DetermineBestComponent
// (2304: IdentifyComponentHighestValue1/2/7, tie → smaller size) over ResolveImprovedComponentValues (1645), with X
// first: Y replaces X only when strictly better by that evaluation. Each slot keeps its count and position (the
// player's layout); then the latest hab modules / life support the new design needs are added, as the original's
// Designs → Upgrade does (BaconMain.cs:2471 btnDesignsUpgrade_Click). The result must stay valid by the original's
// save validation (Main.Part6.cs:226 GetDesignWarningMessages: no new red "must do" warning, e.g. reactor output below
// static energy use) and Empire.10.cs CanBuildDesign (tech + construction size): if not, the replacements that cost
// the most energy (then size) are undone one kind at a time until it is valid (none left → no upgrade).
// The new design is made like btnDesignsUpgrade_Click makes one: "<name> Mk(N+1)" / " Mk2" (Main.Part8.cs:926 name
// rule, designEditor.ts nextMarkName), dated now, BuildCount 0, manually created, ReDefined, added to Empire.Designs,
// and the old design is marked obsolete (that path does so). `upgradedFrom` links it to the old design (lineage for
// Retrofit; `declare`d: only written on designs that have it, so older saves and AI designs are unchanged).
// Then Empire.10.cs ReviewLatestDesigns refreshes LatestDesigns. Headless, deterministic, no Galaxy.Rnd.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { Habitat } from '../types';
import type { BuiltObject } from '../builtObject';
import type { ComponentDefinition } from '../componentStatic';
import type { ResearchNode as ResearchNodeDefinition } from '../data/research';
import { Design } from '../design';
import { ComponentType } from '../data/components';
import { ComponentCategoryType } from '../data/policies';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { canBuildDesign, checkDesignSubRoleShouldBeUpgraded } from '../designGeneration';
import { cloneDesign } from '../gameStartTail';
import { galaxyCurrentStarDate } from '../pirateRelations';
import { designWarnings, nextMarkName } from './designEditor';
import { addRequiredHabitation } from './designTools';

declare module '../empire' {
    interface Empire {
        /** [improvements] designLineUpgrade on for this (player) empire; absent = off (the original). */
        designLineUpgrade?: boolean;
        /** [improvements] The sub-roles (BuiltObjectSubRole) the player has designed / touched, ascending; absent = none. */
        playerDesignSubRoles?: number[];
    }
}

declare module '../design' {
    interface Design {
        /** [improvements] The design this one was upgraded from (same-line upgrade or the player's Upgrade); absent = none. */
        upgradedFrom?: Design | null;
    }
}

/** Improvement id (ui/improvements.ts, settings key). */
export const DESIGN_LINE_UPGRADE_IMPROVEMENT = 'designLineUpgrade';

// ---------------------------------------------------------------------------
// The switch and the player-owned sub-roles
// ---------------------------------------------------------------------------

/** Whether the Improvement acts for `empire`: the player empire with the flag set by the UI. */
export function designLineUpgradeActive(galaxy: Galaxy, empire: Empire): boolean {
    return empire.designLineUpgrade === true && empire === galaxy.playerEmpire;
}

/** The `setDesignLineUpgrade` player op: on sets the flag; off removes it (state identical to never set). */
export function setDesignLineUpgrade(galaxy: Galaxy, empire: Empire, on: boolean): boolean {
    if (empire !== galaxy.playerEmpire) return false;
    if (on) empire.designLineUpgrade = true;
    else delete empire.designLineUpgrade;
    return true;
}

/** Whether the player has designed / touched a design of this sub-role. */
export function playerOwnsDesignSubRole(empire: Empire, subRole: BuiltObjectSubRole): boolean {
    return empire.playerDesignSubRoles?.includes(subRole) ?? false;
}

/** Record a sub-role as the player's (player empire only; Undefined ignored). */
export function markPlayerDesignSubRole(galaxy: Galaxy, empire: Empire, subRole: BuiltObjectSubRole): void {
    if (empire !== galaxy.playerEmpire || subRole === BuiltObjectSubRole.Undefined) return;
    const list = empire.playerDesignSubRoles ?? [];
    if (list.includes(subRole)) return;
    list.push(subRole);
    list.sort((a, b) => a - b);
    empire.playerDesignSubRoles = list;
}

/** The Improvement is on and `subRole` is the player's: original design automation must not generate for it. */
export function designLineOwnsSubRole(galaxy: Galaxy, empire: Empire, subRole: BuiltObjectSubRole): boolean {
    return designLineUpgradeActive(galaxy, empire) && playerOwnsDesignSubRole(empire, subRole);
}

// ---------------------------------------------------------------------------
// Tech lines (research.txt PARENTS)
// ---------------------------------------------------------------------------

interface LineGraph {
    /** ProjectId → its child projects (projects listing it in PARENTS). */
    children: Map<number, number[]>;
    /** ComponentId → the projects listing it in COMPONENTS. */
    unlockedBy: Map<number, number[]>;
    /** ProjectId → every descendant (lazily filled). */
    descendants: Map<number, Set<number>>;
}

const graphs = new WeakMap<readonly ResearchNodeDefinition[], LineGraph>();

function lineGraph(defs: readonly ResearchNodeDefinition[]): LineGraph {
    let g = graphs.get(defs);
    if (g !== undefined) return g;
    const children = new Map<number, number[]>();
    const unlockedBy = new Map<number, number[]>();
    for (const d of defs) {
        for (const p of d.parents) {
            const list = children.get(p.parentProjectId) ?? [];
            list.push(d.projectId);
            children.set(p.parentProjectId, list);
        }
        for (const c of d.components) {
            const list = unlockedBy.get(c) ?? [];
            if (!list.includes(d.projectId)) list.push(d.projectId);
            unlockedBy.set(c, list);
        }
    }
    g = { children, unlockedBy, descendants: new Map() };
    graphs.set(defs, g);
    return g;
}

function descendantsOf(g: LineGraph, projectId: number): Set<number> {
    let s = g.descendants.get(projectId);
    if (s !== undefined) return s;
    s = new Set<number>();
    const stack = [projectId];
    while (stack.length > 0) {
        const x = stack.pop()!;
        for (const k of g.children.get(x) ?? []) {
            if (s.has(k)) continue;
            s.add(k);
            stack.push(k);
        }
    }
    g.descendants.set(projectId, s);
    return s;
}

function definitions(galaxy: Galaxy): readonly ResearchNodeDefinition[] {
    return galaxy.researchStatic?.definitions ?? [];
}

/** The kind of slot a component fills: beam weapons share one family across types, everything else is its own type. */
export function componentLineFamily(c: ComponentDefinition): string {
    if (c.category === ComponentCategoryType.WeaponBeam) return 'beam';
    if (c.category === ComponentCategoryType.WeaponSuperBeam) return 'superbeam';
    return `type:${c.type}`;
}

/** Whether `to` is on a tech line of `from`: same family and an unlocking project of `to` descends from one of `from`'s. */
export function isSameLine(galaxy: Galaxy, from: ComponentDefinition, to: ComponentDefinition): boolean {
    if (from.componentId === to.componentId) return true;
    if (componentLineFamily(from) !== componentLineFamily(to)) return false;
    const g = lineGraph(definitions(galaxy));
    const fromProjects = g.unlockedBy.get(from.componentId) ?? [];
    const toProjects = g.unlockedBy.get(to.componentId) ?? [];
    for (const fp of fromProjects) {
        const desc = descendantsOf(g, fp);
        for (const tp of toProjects) if (desc.has(tp)) return true;
    }
    return false;
}

/**
 * The strongest researched component on X's lines, when strictly better than X by the original's per-type
 * evaluation (ResearchSystem.cs DetermineBestComponent with ResolveImprovedComponentValues; X first so a tie keeps it,
 * unless the other is smaller, as IdentifyComponentHighestValueN decides). Null keeps X.
 */
export function bestLineReplacement(galaxy: Galaxy, empire: Empire, x: ComponentDefinition): ComponentDefinition | null {
    if (x.type === ComponentType.Undefined) return null;
    const research = empire.research;
    const candidates: ComponentDefinition[] = [x];
    for (const y of research.researchedComponents) {
        if (y.componentId === x.componentId) continue;
        if (isSameLine(galaxy, x, y)) candidates.push(y);
    }
    if (candidates.length === 1) return null;
    const best = research.determineBestComponentAmong(x.type, candidates);
    if (best === null || best.componentId === x.componentId) return null;
    return research.definitionFor(best.componentId) ?? best;
}

// ---------------------------------------------------------------------------
// Upgrading designs
// ---------------------------------------------------------------------------

interface Replacement {
    from: ComponentDefinition;
    to: ComponentDefinition;
}

/** The red warnings of the original's save validation (GetDesignWarningMessages mustDo). */
function mustDoOf(galaxy: Galaxy, empire: Empire, design: Design): string[] {
    return designWarnings(galaxy, empire, design).mustDo;
}

function buildCandidate(empire: Empire, source: Design, active: readonly Replacement[]): Design {
    const design = cloneDesign(source);
    for (let j = 0; j < design.components.length; j++) {
        const r = active.find((a) => a.from.componentId === design.components[j].componentId);
        if (r !== undefined) design.components[j] = r.to;
    }
    addRequiredHabitation(empire, design);
    design.reDefine();
    return design;
}

function candidateValid(galaxy: Galaxy, empire: Empire, sourceMustDo: readonly string[], sourceBuildable: boolean, design: Design): boolean {
    if (!canBuildDesign(empire, design, false)) return false;
    if (sourceBuildable && !canBuildDesign(empire, design, true)) return false;
    for (const m of mustDoOf(galaxy, empire, design)) if (!sourceMustDo.includes(m)) return false;
    return true;
}

/**
 * The same-line upgrade of one design (not added anywhere), or null when nothing on its lines is strictly better or
 * no valid variant exists. See the file header.
 */
export function upgradeDesignAlongLines(galaxy: Galaxy, empire: Empire, source: Design): Design | null {
    const replacements: Replacement[] = [];
    for (const c of source.components) {
        if (replacements.some((r) => r.from.componentId === c.componentId)) continue;
        const to = bestLineReplacement(galaxy, empire, c);
        if (to !== null) replacements.push({ from: c, to });
    }
    if (replacements.length === 0) return null;
    // Undo order when the result is invalid: the largest energy increase first, then the largest size increase.
    const undoOrder = replacements
        .map((r, i) => ({ r, i, de: r.to.energyUsed - r.from.energyUsed, ds: r.to.size - r.from.size }))
        .sort((a, b) => b.de - a.de || b.ds - a.ds || b.i - a.i)
        .map((e) => e.r);
    const sourceMustDo = mustDoOf(galaxy, empire, source);
    const sourceBuildable = canBuildDesign(empire, source, true);
    const active = replacements.slice();
    for (;;) {
        const design = buildCandidate(empire, source, active);
        if (!design.isEquivalent(source) && candidateValid(galaxy, empire, sourceMustDo, sourceBuildable, design)) return design;
        const drop = undoOrder.find((r) => active.includes(r));
        if (drop === undefined) return null;
        active.splice(active.indexOf(drop), 1);
        if (active.length === 0) return null;
    }
}

/** Mark the result like BaconMain.cs:2610-2626 does and add it to Empire.Designs; the old design goes obsolete. */
function commitUpgrade(galaxy: Galaxy, empire: Empire, source: Design, design: Design): void {
    design.name = nextMarkName(source.name);
    design.dateCreated = galaxyCurrentStarDate(galaxy);
    design.empire = empire;
    design.buildCount = 0;
    design.isObsolete = false;
    design.isManuallyCreated = true;
    design.upgradedFrom = source;
    design.reDefine();
    source.isObsolete = true;
    empire.designs.push(design);
}

/**
 * Upgrade every buildable, non-obsolete design of the player-owned sub-roles along its lines (Improvement on only).
 * Sub-roles the empire policy says not to upgrade (Empire.10.cs CheckDesignSubRoleShouldBeUpgraded, the Designs
 * screen's "Upgrade Roles") are left alone. Returns the new designs, in Empire.Designs order.
 */
export function processDesignLineUpgrades(galaxy: Galaxy, empire: Empire): Design[] {
    const added: Design[] = [];
    if (!designLineUpgradeActive(galaxy, empire)) return added;
    for (const d of empire.designs.slice()) {
        if (d == null || d.isObsolete || !playerOwnsDesignSubRole(empire, d.subRole)) continue;
        if (!checkDesignSubRoleShouldBeUpgraded(empire, d.subRole)) continue;
        if (!canBuildDesign(empire, d, false)) continue;
        const up = upgradeDesignAlongLines(galaxy, empire, d);
        if (up === null) continue;
        commitUpgrade(galaxy, empire, d, up);
        added.push(up);
    }
    return added;
}

// ---------------------------------------------------------------------------
// Retrofit along the lineage
// ---------------------------------------------------------------------------

/** Whether `design` descends (through upgradedFrom) from `ancestor`. */
export function descendsFrom(design: Design, ancestor: Design): boolean {
    let d = design.upgradedFrom ?? null;
    for (let n = 0; d !== null && n < 10000; n++) {
        if (d === ancestor) return true;
        d = d.upgradedFrom ?? null;
    }
    return false;
}

/** The newest buildable, non-obsolete upgrade descendant of `design` in the empire's designs (null when none). */
export function newestLineDescendant(empire: Empire, design: Design, colony: Habitat | null = null): Design | null {
    let best: Design | null = null;
    for (const d of empire.designs) {
        if (d == null || d === design || d.isObsolete || !descendsFrom(d, design)) continue;
        if (!canBuildDesign(empire, d, true, colony)) continue;
        if (best === null || d.dateCreated >= best.dateCreated) best = d;
    }
    return best;
}

/**
 * The retrofit design for a ship (Improvement on, player-owned sub-role): the newest upgrade descendant of its own
 * design; else its own design while that is still current (not obsolete, buildable) — a phaser frigate is not
 * refitted into the newest missile frigate; else `fallback` (the original's newest-of-sub-role choice). Any other
 * case returns `fallback` unchanged.
 */
export function lineRetrofitDesign(galaxy: Galaxy, empire: Empire, builtObject: BuiltObject, fallback: Design | null, colony: Habitat | null = null): Design | null {
    const own = builtObject.design;
    if (own === null || !designLineOwnsSubRole(galaxy, empire, builtObject.subRole)) return fallback;
    const next = newestLineDescendant(empire, own, colony);
    if (next !== null) return next;
    if (!own.isObsolete && empire.designs.includes(own) && canBuildDesign(empire, own, true, colony)) return own;
    return fallback;
}

/** Whether a design is the player's own work (the ownership rule for "retrofit to a design they made"). */
export function isPlayerMadeDesign(design: Design | null): design is Design {
    return design instanceof Design && design.isManuallyCreated;
}
