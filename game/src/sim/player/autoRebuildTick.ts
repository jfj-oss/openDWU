// [auto-rebuild] The deterministic replacement pass (rules in autoRebuild.ts). Runs in the human empire's intermediate
// tick; does nothing unless the empire switched a kind on and has a recorded loss.

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';
import type { Design } from '../design';
import type { BuiltObject } from '../builtObject';
import { isHumanEmpire } from '../humanEmpires';
import { canBuildDesign, findNewestCanBuild } from '../designGeneration';
import { buildNewShips, checkSafeToBuildAtLocation } from '../construction/empireConstruction';
import { checkForeignBaseAtHabitat } from '../missions/cmdConstruction';
import { assignMission } from '../missions/assign';
import { BuiltObjectMissionPriority, BuiltObjectMissionType, builtObjectMission } from '../missions/mission';
import { EmpireMessageType, sendMessageToEmpire } from '../messages';
import { newestLineDescendant } from './designLineUpgrade';
import type { AutoRebuildLoss } from './autoRebuild';

/** Retry period and give-up age, in sim ms. */
const RETRY_MS = 20_000;
const EXPIRE_MS = 1_800_000;
const MAX_ATTEMPTS = 5;

function say(empire: Empire, text: string): void {
    sendMessageToEmpire(empire, empire, EmpireMessageType.Informational, null, text);
}

/** The lost design, its newest line upgrade, else the newest buildable of its sub-role (null: nothing can be built). */
function replacementDesign(galaxy: Galaxy, empire: Empire, loss: AutoRebuildLoss): Design | null {
    void galaxy;
    let d: Design | null = loss.design;
    if (empire.designs.includes(d)) d = newestLineDescendant(empire, d) ?? d;
    if (empire.designs.includes(d) && !d.isObsolete && canBuildDesign(empire, d, true, null)) return d;
    return findNewestCanBuild(empire.designs, loss.subRole, empire);
}

function basesAtSite(empire: Empire, loss: AutoRebuildLoss): number {
    if (loss.habitat !== null) return loss.habitat.basesAtHabitat.filter((b) => !b.hasBeenDestroyed && b.empire === empire && b.subRole === loss.subRole).length;
    return (empire.builtObjects as BuiltObject[]).filter((b) => !b.hasBeenDestroyed && b.subRole === loss.subRole && Math.abs(b.xpos - loss.x) < 2000 && Math.abs(b.ypos - loss.y) < 2000).length;
}

function siteName(loss: AutoRebuildLoss): string {
    return loss.habitat !== null ? loss.habitat.name : 'open space';
}

type Step = 'done' | 'wait' | 'skip';

function rebuildShip(galaxy: Galaxy, empire: Empire, loss: AutoRebuildLoss): Step {
    const design = replacementDesign(galaxy, empire, loss);
    if (design === null) return 'skip';
    if (design.calculateCurrentPurchasePrice(galaxy) > empire.stateMoney) return 'wait';
    const r = buildNewShips(galaxy, empire, [design], [1]);
    if (!r.ok || r.built.length === 0) return 'wait';
    say(empire, `Auto-rebuild: a replacement ${design.name} has been queued for construction`);
    return 'done';
}

function rebuildStation(galaxy: Galaxy, empire: Empire, loss: AutoRebuildLoss): Step {
    const habitat = loss.habitat;
    if (loss.builder !== null) {
        if (basesAtSite(empire, loss) > loss.basesBefore) return 'done';
        const m = builtObjectMission(loss.builder.mission);
        if (!loss.builder.hasBeenDestroyed && m !== null && m.type === BuiltObjectMissionType.Build) return 'wait';
        loss.builder = null;
        if (++loss.attempts >= MAX_ATTEMPTS) return 'skip';
    }
    if (habitat !== null) {
        if (habitat.hasBeenDestroyed || (habitat.empire !== null && habitat.empire !== empire) || (loss.ownColony && habitat.empire !== empire)) return 'skip';
        if (!checkSafeToBuildAtLocation(galaxy, empire, habitat) || checkForeignBaseAtHabitat(habitat, empire)) return 'wait';
    }
    const design = replacementDesign(galaxy, empire, loss);
    if (design === null) return 'skip';
    if (design.calculateCurrentPurchasePrice(galaxy) > empire.stateMoney) return 'wait';
    const x = habitat !== null ? habitat.xpos : loss.x;
    const y = habitat !== null ? habitat.ypos : loss.y;
    let best: BuiltObject | null = null;
    let bestDistance = Infinity;
    for (const o of empire.constructionShips) {
        const s = o as BuiltObject;
        if (s.hasBeenDestroyed || !s.isShipYard || !s.isAutoControlled) continue;
        const m = builtObjectMission(s.mission);
        if (m !== null && m.type !== BuiltObjectMissionType.Undefined) continue;
        const dist = galaxy.calculateDistanceSquared(s.xpos, s.ypos, x, y);
        if (dist < bestDistance) {
            bestDistance = dist;
            best = s;
        }
    }
    if (best === null) {
        if (!loss.waitNoted) {
            loss.waitNoted = true;
            say(empire, `Auto-rebuild: waiting for a free construction ship to rebuild the ${design.name} at ${siteName(loss)}`);
        }
        return 'wait';
    }
    loss.basesBefore = basesAtSite(empire, loss);
    if (habitat !== null) assignMission(galaxy, best, BuiltObjectMissionType.Build, habitat, null, BuiltObjectMissionPriority.Normal, { design, x: loss.offsetX, y: loss.offsetY });
    else assignMission(galaxy, best, BuiltObjectMissionType.Build, null, null, BuiltObjectMissionPriority.Normal, { design, x: loss.x, y: loss.y });
    loss.builder = best;
    say(empire, `Auto-rebuild: ${best.name} has been sent to rebuild the ${design.name} at ${siteName(loss)}`);
    return 'wait';
}

/** One pass over the empire's recorded losses, in the order they were lost. */
export function processAutoRebuild(galaxy: Galaxy, empire: Empire): void {
    const st = empire.autoRebuild;
    if (st === undefined || st.losses.length === 0 || !isHumanEmpire(galaxy, empire)) return;
    const now = galaxy.nowMs;
    for (const loss of st.losses.slice()) {
        if (loss.nextTry > now) continue;
        loss.nextTry = now + RETRY_MS;
        let step: Step;
        if (now - loss.lostAt > EXPIRE_MS) step = 'skip';
        else step = loss.station ? rebuildStation(galaxy, empire, loss) : rebuildShip(galaxy, empire, loss);
        if (step === 'wait') continue;
        st.losses.splice(st.losses.indexOf(loss), 1);
        if (step === 'skip') say(empire, `Auto-rebuild skipped: the ${loss.design.name} at ${siteName(loss)} can no longer be rebuilt`);
    }
}
