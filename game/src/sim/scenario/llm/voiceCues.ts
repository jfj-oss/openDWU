// 19s-2 VOICES, sim side (tasks/19-mod-layer-scenarios.md §19s item 2). Not a port.
//
// The emit sites of the packages (19m lead confirmed, 19g-3 war goal decision, 19d1 loyalty warning, 19d8 motion on the
// floor, 19a Concord contact / treasure fleet, 19j herder migration warning; and, once merged, 19o grievances, 19n
// faction ultimatums and 19n-2 scheme letters) call `noteVoiceCue` right after they sent their scripted message. A cue
// only records WHAT happened and WHERE the text is shown (the message / the motion) — by reference, in a module-level
// WeakMap keyed by the galaxy, NOT in the galaxy's state: nothing is saved, nothing is drawn, nothing the sim reads
// changes, so a game with voices on runs byte-identical to one with voices off. The model call lives UI-side
// (llm/voiceJob.ts), which drains the cues between frames and upgrades the message text in place when a model answers.
//
// Gate: flag `llmVoices` (scenario llm-layer) AND `llmFoundations`. Off → noteVoiceCue returns at once.
// Every function here is pure or writes only the WeakMap; none touches galaxy.rnd.

import type { Galaxy } from '../../galaxy';
import type { Empire } from '../../empire';
import type { EmpireMessage } from '../../messages';
import { empireMessages } from '../../messages';
import { Character, CharacterRole, getEmpireCharacters } from '../../characters';
import { galaxyStarDate } from '../../tick/simTime';
import { tryGetText } from '../../textResolver';
import { scenarioFlag } from '../state';

export const VOICES_FLAG = 'llmVoices';

/** Voices on: the layer (llmFoundations) and the voices flag. */
export function voicesOn(galaxy: Galaxy | null | undefined): boolean {
    return galaxy != null && galaxy.scenario != null && scenarioFlag(galaxy, 'llmFoundations') && scenarioFlag(galaxy, VOICES_FLAG);
}

/**
 * What speaks:
 * - spymaster / chancellor / marshal: the player's council seats (19n seat holder, else the character in the matching
 *   stock role) brief the player on a confirmed lead / a new grievance / the war goal;
 * - ultimatum: a discontented character (19d1 loyalty warning; 19n faction leader) speaks for their faction;
 * - speech: a council member empire speaks for / against the motion on the floor (19d8; council screen);
 * - concord: the Rim Concord's mask-ritual greeting (19a first contact / treasure fleet at our port);
 * - herders: the herder elders' migration lore (19j herd path announced);
 * - letter: a blackmail / exposure letter (19n-2 schemes).
 */
export type VoiceKind = 'spymaster' | 'chancellor' | 'marshal' | 'ultimatum' | 'speech' | 'concord' | 'herders' | 'letter';

export interface VoiceCue {
    kind: VoiceKind;
    /** The empire whose surface shows the text (the player). */
    empire: Empire;
    /** The message the text lands in (null for the council motion: the council screen shows it). */
    message: EmpireMessage | null;
    /** The speaking empire (the player's own for seats and ultimatums; the Concord, the herders, the letter's sender, the council member). */
    voice: Empire;
    /** The counterpart the digest looks at (the lead's / grievance's / war's other empire; the player for foreign voices). */
    other: Empire | null;
    /** The character who speaks, when the sim knows one. */
    speaker: Character | null;
    /** The speaker's title when there is no character ("the spymaster", "the elders of X"). */
    role: string;
    /** The event's own facts (shown to the model as SITUATION; plain values only). */
    facts: Record<string, string | number | boolean>;
    /** Package object the surface is keyed by (the council motion); never shown to the model. */
    ref?: unknown;
    /** The scripted text as it was sent (the fallback; the message's description at cue time). */
    scripted: string;
    starDate: number;
}

const MAX_PENDING = 64;
const pendingCues = new WeakMap<Galaxy, VoiceCue[]>();

/** Records one cue (flag-gated). The oldest are dropped past MAX_PENDING (voices are best-effort). */
export function noteVoiceCue(galaxy: Galaxy, cue: Omit<VoiceCue, 'starDate' | 'scripted'> & { scripted?: string }): VoiceCue | null {
    if (!voicesOn(galaxy)) return null;
    const full: VoiceCue = { ...cue, scripted: cue.scripted ?? cue.message?.description ?? '', starDate: galaxyStarDate(galaxy) };
    let list = pendingCues.get(galaxy);
    if (list === undefined) pendingCues.set(galaxy, (list = []));
    list.push(full);
    if (list.length > MAX_PENDING) list.splice(0, list.length - MAX_PENDING);
    return full;
}

/** Takes every pending cue (oldest first). The voice job calls it between frames. */
export function drainVoiceCues(galaxy: Galaxy): VoiceCue[] {
    const list = pendingCues.get(galaxy);
    if (list === undefined || list.length === 0) return [];
    pendingCues.set(galaxy, []);
    return list;
}

/** The pending cues, not taken (tests). */
export function peekVoiceCues(galaxy: Galaxy): readonly VoiceCue[] {
    return pendingCues.get(galaxy) ?? [];
}

/** The newest message of `empire` whose subject is `subject` (a decision's GeneralDecision message), else null. */
export function messageAbout(empire: Empire, subject: unknown): EmpireMessage | null {
    const list = empireMessages(empire);
    for (let i = list.length - 1; i >= 0; i--) if (list[i] != null && list[i].subject === subject) return list[i];
    return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Speakers
// ---------------------------------------------------------------------------------------------------------------

export type CouncilSeat = 'spymaster' | 'chancellor' | 'marshal';

/** The stock role that stands in for a 19n seat when the court package is absent. */
// Lazy: this module is reached through import cycles (packages → rimHerders → here) before characters.ts has run.
let seatRoles: Record<CouncilSeat, CharacterRole[]> | null = null;
const SEAT_ROLES = (): Record<CouncilSeat, CharacterRole[]> =>
    (seatRoles ??= {
        spymaster: [CharacterRole.IntelligenceAgent],
        chancellor: [CharacterRole.Ambassador, CharacterRole.Leader],
        marshal: [CharacterRole.FleetAdmiral, CharacterRole.TroopGeneral],
    });

/**
 * Who holds `seat` for `empire`: the 19n court's seat holder (read behind a presence check, like the digest), else the
 * active character of the matching stock role with the best skill for the seat (ties: list order), else null.
 */
export function seatSpeaker(galaxy: Galaxy, empire: Empire, seat: CouncilSeat): Character | null {
    const court = galaxy.scenario?.state.court as { seats?: unknown } | undefined;
    if (court !== undefined && scenarioFlag(galaxy, 'courtDynasties') && court.seats instanceof Map) {
        const seats = court.seats.get(empire) as Record<string, unknown> | undefined;
        const c = seats?.[seat];
        if (c instanceof Character && c.active) return c;
    }
    const chars = getEmpireCharacters(empire).filter((c) => c.active);
    for (const role of SEAT_ROLES()[seat]) {
        let best: Character | null = null;
        for (const c of chars) {
            if (c.role !== role) continue;
            if (best === null || seatSkill(c, seat) > seatSkill(best, seat)) best = c;
        }
        if (best !== null) return best;
    }
    return null;
}

function seatSkill(c: Character, seat: CouncilSeat): number {
    if (seat === 'spymaster') return c.counterEspionageFactored;
    return 0;
}

/** "Spymaster Name" / "the spymaster" (display label of a seat voice). */
export function seatLabel(seat: CouncilSeat, c: Character | null): string {
    const title = tryGetText(`Voice Seat ${seat}`) ?? seat.charAt(0).toUpperCase() + seat.slice(1);
    return c !== null ? `${title} ${c.name}` : title;
}

// ---------------------------------------------------------------------------------------------------------------
// Hooks for packages not on this build (documented event names). Each is inert unless its package's flag is on.
// ---------------------------------------------------------------------------------------------------------------

/**
 * Documented voice events for the sibling-branch packages. When the package lands, its emit site calls the helper
 * right after sending its scripted message:
 * - `reputation.grievanceAdded` (19o ledger.ts, a negative entry is added for or against the player):
 *   voiceGrievanceAdded(galaxy, { holder, against, cause, value, message })
 * - `court.factionUltimatum` (19n court.ts, a faction issues its ultimatum to the player):
 *   voiceFactionUltimatum(galaxy, { empire, leader, faction, demand, threat, message })
 * - `intrigue.schemeLetter` (19n-2 schemes.ts, a blackmail demand or a secret exposed to the player):
 *   voiceSchemeLetter(galaxy, { empire, from, agent, scheme, victim, secret, demand, message })
 */
export const VOICE_EVENTS = {
    grievanceAdded: 'reputation.grievanceAdded',
    factionUltimatum: 'court.factionUltimatum',
    schemeLetter: 'intrigue.schemeLetter',
} as const;

/** 19o: a grievance entered the ledger between the player and another empire; the player's chancellor voices it. */
export function voiceGrievanceAdded(
    galaxy: Galaxy,
    ev: { holder: Empire; against: Empire; cause: string; value: number; message: EmpireMessage | null },
): VoiceCue | null {
    if (!voicesOn(galaxy) || !scenarioFlag(galaxy, 'reputationLedger')) return null;
    const player = galaxy.playerEmpire;
    if (player === null || (ev.holder !== player && ev.against !== player)) return null;
    const other = ev.holder === player ? ev.against : ev.holder;
    const speaker = seatSpeaker(galaxy, player, 'chancellor');
    return noteVoiceCue(galaxy, {
        kind: 'chancellor',
        empire: player,
        message: ev.message,
        voice: player,
        other,
        speaker,
        role: seatLabel('chancellor', speaker),
        facts: { grievance: tryGetText(`Reputation Cause ${ev.cause}`) ?? ev.cause, value: Math.round(ev.value), heldBy: ev.holder.name, against: ev.against.name, weHoldIt: ev.holder === player },
    });
}

/** 19n: a character faction's ultimatum to the player, in the faction leader's voice. */
export function voiceFactionUltimatum(
    galaxy: Galaxy,
    ev: { empire: Empire; leader: Character; faction: string; demand: string; threat: string; message: EmpireMessage | null },
): VoiceCue | null {
    if (!voicesOn(galaxy) || !scenarioFlag(galaxy, 'courtDynasties') || ev.empire !== galaxy.playerEmpire) return null;
    return noteVoiceCue(galaxy, {
        kind: 'ultimatum',
        empire: ev.empire,
        message: ev.message,
        voice: ev.empire,
        other: null,
        speaker: ev.leader,
        role: `${ev.leader.name}, ${ev.faction}`,
        facts: { faction: ev.faction, demand: ev.demand, threat: ev.threat, leader: ev.leader.name, leaderRole: CharacterRole[ev.leader.role] ?? '' },
    });
}

/** 19n-2: a scheme's letter — a blackmail demand, or a secret exposed — reaches the player. */
export function voiceSchemeLetter(
    galaxy: Galaxy,
    ev: { empire: Empire; from: Empire; agent: Character | null; scheme: 'blackmail' | 'exposure'; victim: string; secret: string; demand: string; message: EmpireMessage | null },
): VoiceCue | null {
    if (!voicesOn(galaxy) || !scenarioFlag(galaxy, 'courtIntrigue') || ev.empire !== galaxy.playerEmpire) return null;
    return noteVoiceCue(galaxy, {
        kind: 'letter',
        empire: ev.empire,
        message: ev.message,
        voice: ev.from,
        other: ev.empire,
        speaker: ev.agent,
        role: ev.agent !== null ? ev.agent.name : `an agent of the ${ev.from.name}`,
        facts: { scheme: ev.scheme, victim: ev.victim, secret: ev.secret, demand: ev.demand, from: ev.from.name },
    });
}

// ---------------------------------------------------------------------------------------------------------------
// Council speeches (19d8): who speaks, and the scripted lines
// ---------------------------------------------------------------------------------------------------------------

/** The structural bits of a 19d8 motion / council the speeches need (council.ts Motion / Council). */
export interface SpeechMotion {
    id: number;
    kind: string;
    proposer: Empire;
    target: Empire;
    text: string;
    votes: { empire: Empire; vote: string; score: number }[];
}

export interface SpeechSide {
    side: 'for' | 'against';
    empire: Empire;
    /** The scripted paragraph (shown until the model answers, and when it never does). */
    scripted: string;
}

/**
 * The two member empires that speak on `m` (never the player): FOR — the proposer, else the AI voter with the highest
 * score; AGAINST — the target when it is a member, else the AI voter with the lowest score that is not voting yes.
 * Deterministic (ties: vote order). A side is null when nobody fits.
 */
export function councilSpeakers(galaxy: Galaxy, members: readonly Empire[], m: SpeechMotion): { for: SpeechSide | null; against: SpeechSide | null } {
    const player = galaxy.playerEmpire;
    const ai = m.votes.filter((v) => v.empire !== player && members.includes(v.empire));
    let pro: Empire | null = m.proposer !== player && members.includes(m.proposer) ? m.proposer : null;
    if (pro === null) {
        let best: { empire: Empire; score: number } | null = null;
        for (const v of ai) if (v.vote === 'yes' && (best === null || v.score > best.score)) best = v;
        pro = best?.empire ?? null;
    }
    let con: Empire | null = m.target !== player && members.includes(m.target) && m.target !== pro ? m.target : null;
    if (con === null) {
        let worst: { empire: Empire; score: number } | null = null;
        for (const v of ai) if (v.vote !== 'yes' && v.empire !== pro && (worst === null || v.score < worst.score)) worst = v;
        con = worst?.empire ?? null;
    }
    const fill = (tag: string, fallback: string, speaker: Empire): string =>
        (tryGetText(tag) ?? fallback).replace('{0}', speaker.name).replace('{1}', m.text).replace('{2}', m.target.name).replace('{3}', m.proposer.name);
    return {
        for: pro !== null ? { side: 'for', empire: pro, scripted: fill('Voice Speech For', 'The {0} speak for the motion: {1}. The council must act.', pro) } : null,
        against: con !== null ? { side: 'against', empire: con, scripted: fill('Voice Speech Against', 'The {0} speak against the motion: {1}. The council oversteps.', con) } : null,
    };
}
