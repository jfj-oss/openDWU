// Scenario proposal kinds on the ported diplomacy conversation (player/diplomacyProposals.ts: Main.Part9.cs:46
// method_238 lists the options, Main.Part10.cs:3957 method_237 evaluates the chosen one). Not a port. A package fills
// the slots at import; listProposals / submitProposal call them only when a scenario is loaded, and the package gates
// them by its flag (an empty list / null = the stock conversation). No runtime imports (no cycles).

import type { Galaxy } from '../galaxy';
import type { Empire } from '../empire';

export interface ScenarioProposalOption {
    /** Stable id; must start with "SCENARIO_" (submitProposal routes those ids here). */
    id: string;
    label: string;
    enabled: boolean;
    hint: string;
}

export interface ScenarioProposalSlots {
    /** Extra TREATY_PROPOSAL options `player` may offer `other`. Pure. */
    options: ((galaxy: Galaxy, player: Empire, other: Empire) => ScenarioProposalOption[]) | null;
    /** Evaluates a chosen option: `other` accepts or refuses at once (as method_237 does). May change state. */
    submit: ((galaxy: Galaxy, player: Empire, other: Empire, id: string) => { accepted: boolean; message: string }) | null;
}

export const scenarioProposalSlots: ScenarioProposalSlots = { options: null, submit: null };
