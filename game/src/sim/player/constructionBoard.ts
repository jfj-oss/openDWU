// Empire-wide construction job board for the PLAYER empire (a deliberate deviation from DW:U, requested by the user).
//
// In the original every player build order is queued on one construction ship (Main.Part7.cs method_347 → the ship's
// QueueMission, or Galaxy.7.cs 705 FastFindBestConstructionShip for orders given from a habitat), so a burst of orders
// near one ship piles up as a long backlog on it while other construction ships idle. Here those orders go onto a
// shared job list on the player empire instead (Empire.constructionBoard). Each player construction ship commits to at
// most its current job + one next job; the rest stays open on the board and is handed out greedily by earliest
// estimated finish time (remaining time on the ship's current and committed next job + travel to the site + build
// time; ties → the nearer ship) whenever something changes:
//   - a job is added / cancelled / moved up (player commands: replays stay deterministic),
//   - a player construction ship ends a mission (missions/assign.ts assignQueuedMission → constructionBoardShipFree),
//   - the number of player construction ships changes (built / destroyed) or any other player command ran
//     (processConstructionBoard, an O(1) check per frame that only evaluates when the board is dirty).
// Evaluation is O(jobs × construction ships) and allocation-light. Jobs whose target became invalid (station already
// there, habitat lost, enemy territory) are dropped with a message. A started job is a player order
// (missions/playerOrder.ts), so automated ships keep their automation and the AI leaves them alone until it is done.
// AI empires never get a board: for them nothing here runs.
//
// Headless: no DOM / Pixi. No Rnd (the mission constructor's own draws aside, as for any player order).

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { BuiltObject } from '../builtObject';
import type { Design } from '../design';
import { HabitatCategoryType, type Habitat } from '../types';
import { BuiltObjectRole } from '../data/designSpecifications';
import { BuiltObjectSubRole } from '../builtObjectTypes';
import { BuiltObjectMission, BuiltObjectMissionPriority, BuiltObjectMissionType, COORD_UNSET_DOUBLE } from '../missions/mission';
import { assignMission, clearPreviousMissionRequirements } from '../missions/assign';
import { markPlayerOrder } from '../missions/playerOrder';
import { checkAlreadyHaveMiningStationAtHabitat, checkForeignBaseAtHabitat } from '../missions/cmdConstruction';
import { checkEmpireTerritoryCanBuildAtHabitat } from '../resourceTargets';
import { checkResearchStationAtLocation } from '../stationPlacement';
import { baconMovementSettings } from '../movement';
import { EmpireMessageType, sendMessageToEmpire } from '../messages';
import { humanEmpires, isHumanEmpire } from '../humanEmpires';

/** One construction order on the board. Plain data (saved with the empire through the generic graph codec). */
export interface ConstructionJob {
    /** Stable id (commands address jobs by it). */
    id: number;
    design: Design;
    /** The habitat to build at, or null for a build at a point. */
    habitat: Habitat | null;
    /** The Build mission's x / y: offset from the habitat, or the point itself (COORD_UNSET_DOUBLE: none). */
    x: number;
    y: number;
    /** The ship that committed to the job (null: open). */
    ship: BuiltObject | null;
    /** True while `ship` runs it (its current Build mission); false with a ship: the ship's committed next job. */
    active: boolean;
    /** Own bases of the design's sub-role at the site when the job started (success test when the ship is done). */
    basesAtStart: number;
    /** Failed starts so far (a job that fails twice is dropped). */
    attempts: number;
}

export interface ConstructionBoard {
    nextId: number;
    /** Board order = priority (Move up). */
    jobs: ConstructionJob[];
    /** Something changed since the last evaluation. */
    dirty: boolean;
    /** empire.constructionShips.length at the last evaluation (built / destroyed ships make the board dirty). */
    shipCount: number;
    /** Bumped by every evaluation that changed an assignment; idle ships already considered at this version skip it. */
    version: number;
    checkedVersion: number;
    /** builtObjectIDs of idle ships that found nothing at `checkedVersion`. */
    checkedShips: number[];
}

const MAX_ATTEMPTS = 2;
/** Distance within which an own base counts as "at" a point build site. */
const POINT_SITE_RADIUS = 3000;

/** The player's board (created on first use; AI empires never have one). */
export function constructionBoardOf(empire: Empire): ConstructionBoard {
    let b = empire.constructionBoard;
    if (b === undefined || b === null) {
        b = { nextId: 1, jobs: [], dirty: false, shipCount: empire.constructionShips.length, version: 0, checkedVersion: -1, checkedShips: [] };
        empire.constructionBoard = b;
    }
    return b;
}

/** True when a human controls `empire` (the board serves only human empires; humanEmpires.ts). */
function isPlayer(galaxy: Galaxy, empire: Empire | null): empire is Empire {
    return empire !== null && isHumanEmpire(galaxy, empire);
}

/** Board-routed builds: bases built by a construction ship (stations, space ports, defensive / generic bases). */
export function isBoardBuildDesign(design: Design | null | undefined): design is Design {
    return design != null && design.role === BuiltObjectRole.Base;
}

function missionOf(ship: BuiltObject): BuiltObjectMission | null {
    const m = ship.mission as BuiltObjectMission | null;
    return m != null && m.type !== BuiltObjectMissionType.Undefined ? m : null;
}

function idle(ship: BuiltObject): boolean {
    return missionOf(ship) === null && (ship.subsequentMissions as unknown[]).length === 0 && !(ship.revertMission != null && ship.revertMission.type !== BuiltObjectMissionType.Undefined);
}

/** A player construction ship the board may give work to. */
export function boardShipEligible(empire: Empire, ship: BuiltObject): boolean {
    if (ship.hasBeenDestroyed || ship.empire !== empire || ship.builtAt !== null || ship.shipGroup !== null) return false;
    if (ship.role === BuiltObjectRole.Base || ship.topSpeed <= 0 || !ship.isShipYard) return false;
    const m = missionOf(ship);
    return m === null || (m.type !== BuiltObjectMissionType.Retire && m.type !== BuiltObjectMissionType.Retrofit);
}

/** The ship has construction yards (a construction ship builds bases of any size: MaximumShipSize limits ships only). */
function canBuild(ship: BuiltObject, design: Design): boolean {
    void design;
    const yards = (ship.constructionQueue as { constructionYards: unknown[] | null } | null)?.constructionYards ?? null;
    return yards !== null && yards.length > 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Estimates (ms)
// ---------------------------------------------------------------------------------------------------------------

/** The site's galaxy coordinates. */
export function jobSiteX(job: ConstructionJob): number {
    if (job.habitat !== null) return job.habitat.xpos;
    return job.x;
}
export function jobSiteY(job: ConstructionJob): number {
    if (job.habitat !== null) return job.habitat.ypos;
    return job.y;
}

/** Travel time like the sim moves: hyperjump (warp speed + jump initiation) beyond the hyperjump threshold, else sublight. */
export function estimateTravelMs(galaxy: Galaxy, ship: BuiltObject, fromX: number, fromY: number, toX: number, toY: number): number {
    const d = galaxy.calculateDistance(fromX, fromY, toX, toY);
    if (d <= 0) return 0;
    if (ship.warpSpeed > 0 && d > baconMovementSettings.hyperJumpThreshhold) {
        return (d / Math.max(30, ship.warpSpeed)) * 1000 + Math.max(0, ship.hyperjumpInitiate) * 1000;
    }
    return (d / Math.max(1, ship.cruiseSpeed > 0 ? ship.cruiseSpeed : ship.topSpeed)) * 1000;
}

/** The ship's fastest yard rate in components per second (ConstructionQueue.EstimateCurrentWaitQueueTime: speed / 1000). */
function buildRate(ship: BuiltObject): number {
    const q = ship.constructionQueue as { constructionSpeed: number } | null;
    const speed = q !== null ? q.constructionSpeed : 0;
    return Math.max(0.001, speed / 1000);
}

/** Build time of `design` by `ship` (component count / yard rate). */
export function estimateBuildMs(ship: BuiltObject, design: Design): number {
    return (Math.max(1, design.components.length) / buildRate(ship)) * 1000;
}

// Scratch results of shipFreeAt (no allocation per call).
let freeX = 0;
let freeY = 0;

/**
 * Time until the ship is free of its current mission and committed next board job, and where it is then
 * (freeX / freeY). Pure read.
 */
function shipFreeAt(galaxy: Galaxy, board: ConstructionBoard, ship: BuiltObject): number {
    let t = 0;
    let x = ship.xpos;
    let y = ship.ypos;
    const m = missionOf(ship);
    if (m !== null) {
        const underway = m.type === BuiltObjectMissionType.Build ? m.secondaryTargetBuiltObject : null;
        if (underway !== null) {
            t += (Math.max(0, underway.unbuiltOrDamagedComponentCount) / buildRate(ship)) * 1000;
        } else {
            const p = m.resolveTargetCoordinates(m);
            if (p.x > 0 && p.y > 0) {
                t += estimateTravelMs(galaxy, ship, x, y, p.x, p.y);
                x = p.x;
                y = p.y;
            }
            if (m.type === BuiltObjectMissionType.Build && m.design !== null) t += estimateBuildMs(ship, m.design);
        }
    }
    const jobs = board.jobs;
    for (let i = 0; i < jobs.length; i++) {
        const j = jobs[i];
        if (j.ship === ship && !j.active) {
            const sx = jobSiteX(j);
            const sy = jobSiteY(j);
            t += estimateTravelMs(galaxy, ship, x, y, sx, sy) + estimateBuildMs(ship, j.design);
            x = sx;
            y = sy;
        }
    }
    freeX = x;
    freeY = y;
    return t;
}

/** Estimated time (ms from now) until `ship` would finish `job` if it took it next. */
function etaFor(galaxy: Galaxy, board: ConstructionBoard, ship: BuiltObject, job: ConstructionJob): number {
    const free = shipFreeAt(galaxy, board, ship);
    return free + estimateTravelMs(galaxy, ship, freeX, freeY, jobSiteX(job), jobSiteY(job)) + estimateBuildMs(ship, job.design);
}

/**
 * Estimated time (ms from now) until the job is finished: for an assigned job by its ship, for an open job by the
 * best ship (null when no ship can take it). Pure read (UI).
 */
export function jobEtaMs(galaxy: Galaxy, empire: Empire, job: ConstructionJob): number | null {
    const board = empire.constructionBoard;
    if (board === undefined || board === null) return null;
    const ship = job.ship;
    if (ship !== null) {
        if (job.active) {
            const m = missionOf(ship);
            if (m !== null && !missionMatches(m, job)) return null;
            return shipFreeAtCurrent(galaxy, ship);
        }
        // Committed next: free after the current mission, then this job.
        const m = missionOf(ship);
        let t = 0;
        let x = ship.xpos;
        let y = ship.ypos;
        if (m !== null) {
            t = shipFreeAtCurrent(galaxy, ship);
            const p = m.resolveTargetCoordinates(m);
            if (p.x > 0 && p.y > 0) {
                x = p.x;
                y = p.y;
            }
        }
        return t + estimateTravelMs(galaxy, ship, x, y, jobSiteX(job), jobSiteY(job)) + estimateBuildMs(ship, job.design);
    }
    let best: number | null = null;
    for (const s of empire.constructionShips as BuiltObject[]) {
        if (!boardShipEligible(empire, s) || !canBuild(s, job.design)) continue;
        const e = etaFor(galaxy, board, s, job);
        if (best === null || e < best) best = e;
    }
    return best;
}

/** Time until the ship's current mission ends (no board jobs). */
function shipFreeAtCurrent(galaxy: Galaxy, ship: BuiltObject): number {
    const m = missionOf(ship);
    if (m === null) return 0;
    const underway = m.type === BuiltObjectMissionType.Build ? m.secondaryTargetBuiltObject : null;
    if (underway !== null) return (Math.max(0, underway.unbuiltOrDamagedComponentCount) / buildRate(ship)) * 1000;
    let t = 0;
    const p = m.resolveTargetCoordinates(m);
    if (p.x > 0 && p.y > 0) t += estimateTravelMs(galaxy, ship, ship.xpos, ship.ypos, p.x, p.y);
    if (m.type === BuiltObjectMissionType.Build && m.design !== null) t += estimateBuildMs(ship, m.design);
    return t;
}

// ---------------------------------------------------------------------------------------------------------------
// Validity / success
// ---------------------------------------------------------------------------------------------------------------

function isMining(subRole: BuiltObjectSubRole): boolean {
    return subRole === BuiltObjectSubRole.MiningStation || subRole === BuiltObjectSubRole.GasMiningStation;
}

function isResearch(subRole: BuiltObjectSubRole): boolean {
    return subRole === BuiltObjectSubRole.WeaponsResearchStation || subRole === BuiltObjectSubRole.EnergyResearchStation || subRole === BuiltObjectSubRole.HighTechResearchStation;
}

/** Why the job can no longer be carried out (null: still valid). The checks cmdBuild makes on arrival (cmdConstruction.ts). */
export function jobInvalidReason(galaxy: Galaxy, empire: Empire, job: ConstructionJob): string | null {
    const h = job.habitat;
    const subRole = job.design.subRole;
    if (!empire.designs.includes(job.design)) return 'the design was deleted';
    if (h === null) return null;
    if (h.hasBeenDestroyed) return `${h.name} was lost`;
    if (isMining(subRole) || subRole === BuiltObjectSubRole.ResortBase) {
        if (isMining(subRole) && checkAlreadyHaveMiningStationAtHabitat(h, empire)) return `${h.name} already has a mining station`;
        if (checkForeignBaseAtHabitat(h, empire)) return `another empire has a base at ${h.name}`;
        // BuiltObject.2.cs 1456-1463: a (gas) mining station needs an unowned (or independent) habitat — the player's
        // own colonies too are refused (those buy theirs at the colony yard, Main.Part7.cs 1180); a resort base may
        // also go to the empire's own colony.
        if (h.owner !== null && h.owner !== galaxy.independentEmpire && (isMining(subRole) || h.owner !== empire)) return `${h.name} is owned by ${h.owner.name}`;
        if (!checkEmpireTerritoryCanBuildAtHabitat(galaxy, empire, h)) return `${h.name} is in another empire's territory`;
    }
    if (isResearch(subRole) && checkResearchStationAtLocation(galaxy, h)) return `there already is a research station in the ${h.name} system`;
    return null;
}

/** Own bases of the job's sub-role at its site. */
function basesAtSite(galaxy: Galaxy, empire: Empire, job: ConstructionJob): number {
    const subRole = job.design.subRole;
    let n = 0;
    if (job.habitat !== null) {
        const list = job.habitat.basesAtHabitat;
        for (let i = 0; i < list.length; i++) {
            const b = list[i];
            if (b != null && !b.hasBeenDestroyed && b.empire === empire && b.subRole === subRole) n++;
        }
        return n;
    }
    const list = empire.builtObjects as BuiltObject[];
    for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (b != null && !b.hasBeenDestroyed && b.role === BuiltObjectRole.Base && b.subRole === subRole && galaxy.calculateDistance(b.xpos, b.ypos, job.x, job.y) <= POINT_SITE_RADIUS) n++;
    }
    return n;
}

function missionMatches(m: BuiltObjectMission | null | undefined, job: ConstructionJob): boolean {
    return m != null && m.type === BuiltObjectMissionType.Build && m.design === job.design && (job.habitat === null || m.targetHabitat === job.habitat);
}

/** The ship still runs the job (as its mission, or as the mission it reverts to after a diversion). */
function jobRunning(job: ConstructionJob): boolean {
    const s = job.ship;
    return s !== null && !s.hasBeenDestroyed && (missionMatches(s.mission as BuiltObjectMission | null, job) || missionMatches(s.revertMission, job));
}

export function jobLabel(job: ConstructionJob): string {
    return `${job.design.name} at ${job.habitat !== null ? job.habitat.name : `(${Math.round(job.x)}, ${Math.round(job.y)})`}`;
}

function dropJob(galaxy: Galaxy, empire: Empire, board: ConstructionBoard, index: number, reason: string | null): void {
    const job = board.jobs[index];
    board.jobs.splice(index, 1);
    board.dirty = true;
    if (reason !== null) {
        sendMessageToEmpire(empire, empire, EmpireMessageType.GeneralWarning, job.habitat ?? job.ship, `Construction job cancelled: ${jobLabel(job)} — ${reason}`);
    }
    void galaxy;
}

/** The active job ended (finished, failed or replaced): remove it when the base is there, else reopen (or drop). */
function finalizeActive(galaxy: Galaxy, empire: Empire, board: ConstructionBoard, index: number): void {
    const job = board.jobs[index];
    if (basesAtSite(galaxy, empire, job) > job.basesAtStart) {
        board.jobs.splice(index, 1);
        board.dirty = true;
        return;
    }
    job.attempts++;
    job.ship = null;
    job.active = false;
    board.dirty = true;
    if (job.attempts >= MAX_ATTEMPTS) dropJob(galaxy, empire, board, index, 'it could not be completed');
}

// ---------------------------------------------------------------------------------------------------------------
// Starting a job
// ---------------------------------------------------------------------------------------------------------------

/** The ship starts the job now (the same AssignMission the ship order makes, marked as a player order). */
function startJob(galaxy: Galaxy, empire: Empire, ship: BuiltObject, job: ConstructionJob): void {
    job.ship = ship;
    job.active = true;
    job.basesAtStart = basesAtSite(galaxy, empire, job);
    clearPreviousMissionRequirements(galaxy, ship, true);
    const args: { design: Design; manuallyAssigned: boolean; x?: number; y?: number } = { design: job.design, manuallyAssigned: true };
    if (job.x !== COORD_UNSET_DOUBLE || job.y !== COORD_UNSET_DOUBLE) {
        args.x = job.x;
        args.y = job.y;
    }
    assignMission(galaxy, ship, BuiltObjectMissionType.Build, job.habitat, null, BuiltObjectMissionPriority.Normal, args);
    markPlayerOrder(ship);
}

// ---------------------------------------------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------------------------------------------

/** Number of board jobs (active or next) the ship holds. */
function committed(board: ConstructionBoard, ship: BuiltObject): number {
    let n = 0;
    for (let i = 0; i < board.jobs.length; i++) if (board.jobs[i].ship === ship) n++;
    return n;
}

/** The ship has room for one more board job (current + at most one next). */
function hasFreeSlot(board: ConstructionBoard, ship: BuiltObject): boolean {
    if (idle(ship)) return committed(board, ship) === 0;
    if ((ship.subsequentMissions as unknown[]).length > 0) return false;
    let next = 0;
    for (let i = 0; i < board.jobs.length; i++) {
        const j = board.jobs[i];
        if (j.ship === ship && !j.active) next++;
    }
    return next === 0;
}

/**
 * Re-check every job (drop invalid ones, reopen ones whose ship is gone or no longer runs them), then hand the open
 * jobs out in board order, each to the ship with the earliest estimated finish (ties → nearer ship).
 */
export function evaluateConstructionBoard(galaxy: Galaxy, empire: Empire): void {
    const board = constructionBoardOf(empire);
    board.dirty = false;
    board.shipCount = empire.constructionShips.length;
    const jobs = board.jobs;
    let changed = false;
    for (let i = jobs.length - 1; i >= 0; i--) {
        const job = jobs[i];
        const ship = job.ship;
        if (ship !== null && job.active) {
            if (!jobRunning(job)) {
                finalizeActive(galaxy, empire, board, i);
                changed = true;
            }
            continue;
        }
        if (ship !== null && !boardShipEligible(empire, ship)) {
            job.ship = null;
            changed = true;
        }
        const why = jobInvalidReason(galaxy, empire, job);
        if (why !== null) {
            dropJob(galaxy, empire, board, i, why);
            changed = true;
        }
    }
    const ships = empire.constructionShips as BuiltObject[];
    for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        if (job.ship !== null) continue;
        let best: BuiltObject | null = null;
        let bestEta = 0;
        let bestDist = 0;
        for (let k = 0; k < ships.length; k++) {
            const s = ships[k];
            if (s == null || !boardShipEligible(empire, s) || !hasFreeSlot(board, s) || !canBuild(s, job.design)) continue;
            const eta = etaFor(galaxy, board, s, job);
            const dist = galaxy.calculateDistance(s.xpos, s.ypos, jobSiteX(job), jobSiteY(job));
            if (best === null || eta < bestEta || (eta === bestEta && dist < bestDist)) {
                best = s;
                bestEta = eta;
                bestDist = dist;
            }
        }
        if (best === null) continue;
        changed = true;
        if (idle(best)) startJob(galaxy, empire, best, job);
        else {
            job.ship = best;
            job.active = false;
        }
    }
    if (changed) board.version++;
    board.dirty = false;
}

/** Per frame (tick/scheduler.ts): O(1) per human empire unless its board is dirty or its construction ship count changed. */
export function processConstructionBoard(galaxy: Galaxy): void {
    for (const empire of humanEmpires(galaxy)) {
        const board = empire.constructionBoard;
        if (board === undefined || board === null || board.jobs.length === 0) continue;
        if (board.dirty || board.shipCount !== empire.constructionShips.length) evaluateConstructionBoard(galaxy, empire);
    }
}

/** A player command ran: re-check the board at the next frame (an order may have replaced a board job). */
export function noteConstructionBoardCommand(galaxy: Galaxy, empire: Empire): void {
    if (!isPlayer(galaxy, empire)) return;
    const board = empire.constructionBoard;
    if (board !== undefined && board !== null && board.jobs.length > 0) board.dirty = true;
}

/**
 * missions/assign.ts assignQueuedMission: `ship` ended a mission (or is idle and looking for its next one). Finalizes
 * its active board job when that has ended; with an empty queue (`queueEmpty`) it starts the ship's committed next
 * job, or pulls the best open one. Returns true when the ship got a board job (assignQueuedMission returns true).
 * O(1) for any ship of an empire without board jobs.
 */
export function constructionBoardShipFree(galaxy: Galaxy, ship: BuiltObject, queueEmpty: boolean): boolean {
    const empire = ship.empire;
    if (empire === null) return false;
    const board = empire.constructionBoard;
    if (board === undefined || board === null || board.jobs.length === 0 || !isPlayer(galaxy, empire)) return false;
    const jobs = board.jobs;
    let next: ConstructionJob | null = null;
    for (let i = jobs.length - 1; i >= 0; i--) {
        const j = jobs[i];
        if (j.ship !== ship) continue;
        if (j.active) {
            if (!jobRunning(j)) finalizeActive(galaxy, empire, board, i);
        } else {
            next = j; // the earliest committed next job (iterating down)
        }
    }
    if (!queueEmpty || !idle(ship)) return false;
    if (next !== null) {
        const why = jobInvalidReason(galaxy, empire, next);
        if (why === null && boardShipEligible(empire, ship)) {
            startJob(galaxy, empire, ship, next);
            board.version++;
            board.dirty = true; // its next slot is free again
            return true;
        }
        const idx = jobs.indexOf(next);
        if (why !== null) dropJob(galaxy, empire, board, idx, why);
        else next.ship = null;
    }
    let open = false;
    for (let i = 0; i < jobs.length; i++) {
        if (jobs[i].ship === null) {
            open = true;
            break;
        }
    }
    if (!open || !boardShipEligible(empire, ship)) return false;
    const id = ship.builtObjectID;
    if (!board.dirty && board.checkedVersion === board.version && board.checkedShips.includes(id)) return false;
    evaluateConstructionBoard(galaxy, empire);
    if (!idle(ship)) return true;
    if (board.checkedVersion !== board.version) {
        board.checkedVersion = board.version;
        board.checkedShips.length = 0;
    }
    board.checkedShips.push(id);
    return false;
}

// ---------------------------------------------------------------------------------------------------------------
// Player commands (player/playerOps.ts)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Add a job (open, or committed as `nextFor`'s next job when that ship has room) and hand out the open jobs. Returns
 * the job id, or 0 when it was not added (not the player, not a base design, invalid target).
 */
export function addConstructionJob(galaxy: Galaxy, empire: Empire, design: Design, habitat: Habitat | null, x: number, y: number, nextFor: BuiltObject | null = null): number {
    if (!isPlayer(galaxy, empire) || !isBoardBuildDesign(design)) return 0;
    if (habitat !== null && habitat.category === HabitatCategoryType.Star && isMining(design.subRole)) return 0;
    const board = constructionBoardOf(empire);
    const job: ConstructionJob = { id: board.nextId++, design, habitat, x, y, ship: null, active: false, basesAtStart: 0, attempts: 0 };
    if (jobInvalidReason(galaxy, empire, job) !== null) return 0;
    board.jobs.push(job);
    if (nextFor !== null && boardShipEligible(empire, nextFor) && canBuild(nextFor, design) && hasFreeSlot(board, nextFor)) {
        if (idle(nextFor)) startJob(galaxy, empire, nextFor, job);
        else job.ship = nextFor;
        board.version++;
    }
    evaluateConstructionBoard(galaxy, empire);
    return job.id;
}

/** Cancel a job. An active job whose build has not started also stops its ship's mission. */
export function cancelConstructionJob(galaxy: Galaxy, empire: Empire, jobId: number): boolean {
    const board = empire.constructionBoard;
    if (board === undefined || board === null) return false;
    const i = board.jobs.findIndex((j) => j.id === jobId);
    if (i < 0) return false;
    const job = board.jobs[i];
    board.jobs.splice(i, 1);
    const ship = job.ship;
    if (ship !== null && job.active) {
        const m = ship.mission as BuiltObjectMission | null;
        if (missionMatches(m, job) && m!.secondaryTargetBuiltObject === null) clearPreviousMissionRequirements(galaxy, ship, true);
    }
    board.version++;
    evaluateConstructionBoard(galaxy, empire);
    return true;
}

/** Move a job one place up the board (earlier jobs are handed out first). */
export function moveConstructionJobUp(galaxy: Galaxy, empire: Empire, jobId: number): boolean {
    const board = empire.constructionBoard;
    if (board === undefined || board === null) return false;
    const i = board.jobs.findIndex((j) => j.id === jobId);
    if (i <= 0) return false;
    const job = board.jobs[i];
    board.jobs[i] = board.jobs[i - 1];
    board.jobs[i - 1] = job;
    board.version++;
    evaluateConstructionBoard(galaxy, empire);
    return true;
}

/** A shift-queued build order to a busy player construction ship: the ship's next job when it has room, else the board. */
export function queueBuildOrderOnBoard(galaxy: Galaxy, empire: Empire, ship: BuiltObject, design: Design, habitat: Habitat | null, x: number, y: number): number {
    return addConstructionJob(galaxy, empire, design, habitat, x, y, ship);
}

/** Whether a ship order should go to the board: a shift-queued base build for a busy player construction ship. */
export function routesToBoard(galaxy: Galaxy, empire: Empire, ship: BuiltObject, design: Design | null, isSubsequent: boolean): boolean {
    return isSubsequent && isPlayer(galaxy, empire) && isBoardBuildDesign(design) && ship.empire === empire && boardShipEligible(empire, ship) && !idle(ship);
}

// ---------------------------------------------------------------------------------------------------------------
// UI rows
// ---------------------------------------------------------------------------------------------------------------

export interface ConstructionJobRow {
    id: number;
    label: string;
    /** "open" / "next" / "active". */
    state: 'open' | 'next' | 'active';
    ship: BuiltObject | null;
    shipName: string;
    /** Estimated ms until done (null: unknown). */
    etaMs: number | null;
}

/** The board as display rows (board order). Pure read. */
export function constructionJobRows(galaxy: Galaxy, empire: Empire): ConstructionJobRow[] {
    const board = empire.constructionBoard;
    if (board === undefined || board === null) return [];
    return board.jobs.map((j) => ({
        id: j.id,
        label: jobLabel(j),
        state: j.ship === null ? 'open' : j.active ? 'active' : 'next',
        ship: j.ship,
        shipName: j.ship?.name ?? '',
        etaMs: jobEtaMs(galaxy, empire, j),
    }));
}
