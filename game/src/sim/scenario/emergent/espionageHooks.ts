// 19d3 espionage consequences — hook slots called from the ported espionage / trade code (tasks/19d3-espionage-
// consequences.md §2). Not a port.
//
// The ported modules (espionage.ts, tradeItems.ts) call these slots only inside `scenarioFlag(galaxy,
// 'espionageConsequences')` branches; the package module (emergent/espionage.ts) fills them at import. This module has
// no runtime imports so espionage.ts can import it without an import cycle (the package imports espionage.ts).

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { Character, IntelligenceMission } from '../../characters';
import type { TechNode } from '../../researchSystem';

/** How performIntelligenceMissions applies a detected mission of a framed agent (falseFlagAttribution). */
export interface FalseFlagResult {
    /** The empire the target blames (the framed empire, or the true originator when the frame is seen through). */
    blamed: Empire;
    /** Incident multiplier on num17 (1.5 when the frame holds). */
    factor: number;
    /** applyIncident repetitions (2 when the frame is seen through). */
    repeats: number;
    /** Whether the originator's civility drops (only when the frame is seen through). */
    civility: boolean;
}

export const ESPIONAGE_FLAG = 'espionageConsequences';

export interface EspionageHookSlots {
    /** §A1 — a detected mission (Capture / FailDetect / SucceedDetect) after its incident was applied. No Rnd. */
    exposure: ((galaxy: Galaxy, offender: Empire, victim: Empire, mission: IntelligenceMission, agent: Character, incident: number, outcome: number) => void) | null;
    /** §C11 — who the target blames; null = no frame on this mission (the ported path). Rnd only when a frame exists. */
    attribution: ((galaxy: Galaxy, self: Empire, target: Empire, mission: IntelligenceMission, agent: Character, outcome: number) => FalseFlagResult | null) | null;
    /** §B5 — a StealTechData completion. No Rnd. */
    stolenTech: ((galaxy: Galaxy, thief: Empire, victim: Empire | null, node: TechNode) => void) | null;
    /** §B6 — giveTradeableItem(ResearchProject). No Rnd. */
    techTransfer: ((galaxy: Galaxy, giver: Empire, receiver: Empire, node: TechNode) => void) | null;
    /** §C10 — after the ported sabotage assignment. Rnd (frame roll) only when a candidate exists. */
    sabotageAssigned: ((galaxy: Galaxy, self: Empire, target: Empire, mission: IntelligenceMission) => void) | null;
    /** §C9 — cancelIntelligenceMission: the mission's frame is dropped. No Rnd. */
    missionEnded: ((galaxy: Galaxy, mission: IntelligenceMission) => void) | null;
}

export const espionageHooks: EspionageHookSlots = {
    exposure: null,
    attribution: null,
    stolenTech: null,
    techTransfer: null,
    sabotageAssigned: null,
    missionEnded: null,
};
