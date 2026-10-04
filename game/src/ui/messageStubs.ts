// popupstubs: the stub list under the top-right panel — every incoming player message, advisor suggestion and
// conversation first appears here as a one-line stub; clicking one opens the 16d popup card, the suggest window or the
// conversation dialog. Pure logic (no DOM): icons, stub building, ordering, the visible window / auto-scroll state and
// expiry. messageStubList.ts wires it to the DOM.
//
// Sources in the original:
// - the popup card (Main.Part9.cs 2381-2413 pnlMessagePopup + 2415 timer_1_Elapsed): one message at a time, slides in,
//   stays and slides out — int_4 += 25 per 100 ms tick until Width + 10 + 2000 + Width + 10 (335 px wide) = 2690, i.e.
//   ~10.8 s on screen. A plain message stub expires after that much time in the visible window (POPUP_DURATION_MS).
// - the scrolling ticker (Controls/ScrollingLinkList.cs): 18 px rows scrolling at double_0 = 20 px per galaxy second,
//   frozen while the galaxy clock is paused (method_3 measures galaxy CurrentDateTime). The stub list's auto-scroll
//   moves at that speed and freezes when paused; it also holds on each row (dwell) so a stub can be read and clicked.
// - the conversation queue (DiplomaticMessageQueue.cs): conversation / advisor entries stay until answered or older than
//   250 x RealSecondsInGalacticYear (671 method_3); advisor icons per AdvisorMessageType (:931-980).

import { EmpireMessage, EmpireMessageType } from '../sim/messages';
import { DiplomaticRelationType } from '../sim/diplomacy';
import { AdvisorMessageType } from '../sim/advisorQueue';
import { REAL_SECONDS_IN_GALACTIC_YEAR } from '../sim/galaxyTime';
import type { Empire } from '../sim/empire';

/** 'battle': a battle report notification (an Improvement; ui/battleReports.ts), keyed by a UI-only token. */
export type StubKind = 'message' | 'conversation' | 'suggestion' | 'battle';

export interface MessageStub {
    /** Identity: the EmpireMessage (conversation stubs: the queue entry's message). */
    key: EmpireMessage;
    kind: StubKind;
    /** Icon URL under /assets/dwu/images/ui (null: none). */
    icon: string | null;
    /** One-line title. */
    title: string;
    /** Hover text (the full description). */
    tooltip: string;
    /** Galaxy star date the message arrived. */
    starDate: number;
    /** Sender colour as CSS (null: none). */
    color: string | null;
    /** Conversations and advisor suggestions wait for the player's answer. */
    needsAnswer: boolean;
    /** The player opened it. */
    read: boolean;
    /** Milliseconds spent in the visible window (plain messages expire after POPUP_DURATION_MS). */
    shownMs: number;
    /** Arrival order (ties on starDate). */
    seq: number;
}

/** Main.Part9.cs 2415 timer_1_Elapsed: (335 + 10) + 2000 + (335 + 10) = 2690 units at 25 per 100 ms tick. */
export const POPUP_DURATION_MS = Math.ceil(((335 + 10) * 2 + 2000) / 25) * 100;

/** DiplomaticMessageQueue.cs 671 method_3: conversation / advisor entries older than this (star-date units) expire. */
export const CONVERSATION_LIFETIME = 250 * REAL_SECONDS_IN_GALACTIC_YEAR;

/** Controls/ScrollingLinkList.cs: double_0 = 20 px per second, 18 px rows (LinkLabel.Height = 18). */
export const SCROLL_PX_PER_SECOND = 20;
export const TICKER_ROW_PX = 18;
/** Time the list holds on a row before moving on (not in the C#, whose ticker only moves while it has a backlog). */
export const STUB_DWELL_MS = 3000;

/** The visible window: user direction — up to 6 stubs at once, the rest scrolling. */
export const MAX_VISIBLE_STUBS = 6;
export const DEFAULT_VISIBLE_STUBS = 6;

export function clampVisibleStubs(n: number): number {
    if (!Number.isFinite(n)) return DEFAULT_VISIBLE_STUBS;
    return Math.min(MAX_VISIBLE_STUBS, Math.max(1, Math.round(n)));
}

const MSG = '/assets/dwu/images/ui/messages/';
const CHROME = '/assets/dwu/images/ui/chrome/';

// BaconMain.cs 2165 LoadUiMessages: the bitmap_28 (_MessageImages) index → file.
const MESSAGE_IMAGES = [
    'underAttack.png', 'colonygain.png', 'colonyloss.png', 'declarewar.png', 'endwar.png', 'freetradeagreement.png',
    'mutualdefensepact.png', 'protectorate.png', 'researchbreakthrough.png', 'resumetrade.png', 'subjugateddominion.png',
    'tradesanctions.png', 'canceltreaty.png', 'treatyrefused.png', 'money.png', 'warning.png', 'construction.png',
    'request.png', 'agentsuccess.png', 'agentfailure.png', 'blockade.png', 'blockadecancelled.png', 'restrictedArea.png',
    'agentalert.png', 'explorationDiscovery.png', 'galacticHistory.png', 'information.png', 'pirateMessage.png',
    'planetdestroy.png', 'galacticnewsnet.png', 'construction_stalled.png',
] as const;

function img(i: number): string {
    return MSG + MESSAGE_IMAGES[i];
}

// MessagePopup.cs 163-257: the relation-change / proposal image by the subject's DiplomaticRelationType.
function relationImage(message: EmpireMessage, player: Empire | null, propose: boolean): number | null {
    const subject = message.subject;
    if (typeof subject !== 'number') return null;
    const Rel = DiplomaticRelationType;
    switch (subject) {
        case Rel.None: {
            const rel = message.sender === null ? null : (player?.diplomaticRelations?.byEmpire(message.sender) ?? null);
            if (rel === null) return 12;
            if (rel.type === Rel.TradeSanctions) return 9;
            if (rel.type === Rel.War) return 4;
            if (propose && message.description.toLowerCase().includes('trade')) return 9;
            return 12;
        }
        case Rel.FreeTradeAgreement:
            return 5;
        case Rel.MutualDefensePact:
            return 6;
        case Rel.SubjugatedDominion:
            return 10;
        case Rel.Protectorate:
            return 7;
        case Rel.TradeSanctions:
            return 11;
        case Rel.War:
            return 3;
        default:
            return null;
    }
}

/**
 * The message's category icon: port of MessagePopup.cs 161-1000 (Ignite's _MainImage switch) for the cases that use a
 * _MessageImages entry. Cases that show the subject's own picture there (ship, colony landscape, character, ruin,
 * resource, flag) fall back to information.png.
 */
export function messageIconUrl(message: EmpireMessage, player: Empire | null): string {
    const T = EmpireMessageType;
    let i: number | null = null;
    switch (message.messageType) {
        case T.DiplomaticRelationChange:
        case T.AcceptDiplomaticRelation:
            i = relationImage(message, player, false);
            break;
        case T.ProposeDiplomaticRelation:
            i = relationImage(message, player, true);
            break;
        case T.RefuseDiplomaticRelation:
            i = 13;
            break;
        case T.RemoveColoniesFromSystem:
        case T.StopMissionsAgainstUs:
        case T.StopAttacks:
        case T.LeaveSystem:
        case T.RemoveForcesFromSystem:
        case T.GeneralWarning:
            i = 15;
            break;
        case T.RequestJointWar:
        case T.RequestJointTradeSanctions:
        case T.RequestStopWar:
        case T.RequestLiftTradeSanctions:
            i = 17;
            break;
        case T.GiveGift:
        case T.PirateAttackMissionAvailable:
        case T.PirateDefendMissionAvailable:
        case T.PirateSmugglingMissionAvailable:
            i = 14;
            break;
        case T.ShipBaseCompleted:
        case T.ColonyFacilityCompleted:
        case T.ColonyFacilityCancelled:
        case T.ColonyWonderBegun:
        case T.PlanetaryFacilityDestroyed:
        case T.PlanetaryFacilityDamaged:
        case T.ColonyShipMissionCancelled:
        case T.AdvisorSuggestion:
            i = 16;
            break;
        case T.BattleUnderAttack:
        case T.BattleAttacking:
        case T.IncomingEnemyFleet:
            i = 0;
            break;
        case T.ResearchBreakthrough:
        case T.ResearchCriticalBreakthrough:
        case T.ResearchCriticalFailure:
            i = 8; // MessagePopup.cs 329: the research overlay image
            break;
        case T.CharacterAppearance:
        case T.CharacterSkillTraitChange:
        case T.CharacterMissionAccomplished:
            i = 18;
            break;
        case T.CharacterDeath:
        case T.CharacterMissionFailure:
            i = 19;
            break;
        case T.ColonyGained:
            i = 1;
            break;
        case T.ColonyLost:
        case T.ColonyDefended:
        case T.ColonyRebelling:
        case T.Revolution:
            i = 2;
            break;
        case T.BlockadeInitiated:
            i = 20;
            break;
        case T.BlockadeCancelled:
            i = 21;
            break;
        case T.ExplorationRuins:
        case T.ExplorationBuiltObject:
        case T.ExplorationHabitat:
        case T.ExplorationLocation:
        case T.RestrictedResourceDiscovered:
        case T.RestrictedResourceTradingAllowed:
        case T.RestrictedResourceTradingBlocked:
            i = 24;
            break;
        case T.GalacticHistory:
        case T.HistoryOfferLocationHint:
        case T.HistoryOfferStoryClue:
        case T.StoryMessage:
            i = 25;
            break;
        case T.ColonyDestroyed:
            i = 28;
            break;
        case T.GalacticNewsNet:
            i = 29;
            break;
        case T.PirateAttackMissionFailed:
        case T.PirateDefendMissionFailed:
        case T.RaidBonuses:
        case T.RaidVictim:
        case T.PirateOfferProtection:
        case T.CancelPirateProtection:
            i = 27;
            break;
        case T.ConstructionResourceShortage:
            i = 30;
            break;
        case T.SellInfoRestrictedArea:
            i = 22;
            break;
        case T.SellInfoPlanetDestroyer:
            i = 28;
            break;
        case T.OfferTrade:
            i = 14;
            break;
    }
    return img(i ?? 26);
}

/** DiplomaticMessageQueue.cs 931-980: the advisor entry's icon by AdvisorMessageType (InitializeImages, Main.Part12.cs 1467). */
export function advisorIconUrl(t: AdvisorMessageType): string {
    const A = AdvisorMessageType;
    switch (t) {
        case A.BuildOrder:
            return CHROME + 'build.png';
        case A.Colonization:
            return CHROME + 'colonize.png';
        case A.IntelligenceMission:
            return CHROME + 'characters.png';
        case A.EnemyBombard:
            return CHROME + 'bombard.png';
        case A.EnemyAttackPlanetDestroyer:
            return MSG + 'planetdestroy.png';
        case A.DiplomaticGift:
            return CHROME + 'money.png';
        case A.OfferMilitaryRefueling:
        case A.CancelMilitaryRefueling:
            return CHROME + 'refuel.png';
        case A.OfferMiningRights:
        case A.CancelMiningRights:
            return CHROME + 'mine.png';
        case A.EnemyAttack:
        case A.InvadeIndependent:
        case A.DefendTerritory:
            return CHROME + 'attack.png';
        case A.BuildOneOff:
        case A.Retrofit:
            return CHROME + 'construction.png';
        case A.PirateRaid:
            return CHROME + 'raid.png';
        case A.OfferPirateAttackMission:
        case A.OfferPirateDefendMission:
        case A.OfferPirateSmuggleMission:
        case A.PirateFacilityEradicate:
        case A.DefendTarget:
            return CHROME + 'pirateflag.png';
        default:
            return CHROME + 'advisorsuggestion.png';
    }
}

/** One line of text: newlines and runs of blanks collapsed (ScrollingLinkList.AddItem replaces "\n" with " "). */
export function oneLine(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

/** A plain message's stub title: its title, else "<sender>: <description>", else the description. */
export function messageStubTitle(title: string, description: string, senderName: string | null): string {
    const t = oneLine(title);
    if (t !== '') return t;
    const d = oneLine(description);
    if (senderName && d !== '') return `${senderName}: ${d}`;
    return d || senderName || 'Message';
}

// ---------------------------------------------------------------------------
// The list state
// ---------------------------------------------------------------------------

export interface StubListState {
    stubs: MessageStub[];
    /** Index (into the ordered list) of the first visible row. */
    offset: number;
    /** Time held on the current row (ms). */
    dwellMs: number;
    /** Scroll progress towards the next row, 0..1 (animated in the DOM). */
    progress: number;
    nextSeq: number;
    /** Messages whose stub the player dismissed (double right-click): their stub is not added again. */
    dismissed: WeakSet<EmpireMessage>;
}

export function createStubListState(): StubListState {
    return { stubs: [], offset: 0, dwellMs: 0, progress: 0, nextSeq: 0, dismissed: new WeakSet<EmpireMessage>() };
}

/** Two right-clicks on the same stub within this many ms dismiss it. */
export const DOUBLE_RIGHT_CLICK_MS = 450;

export interface RightClickTracker {
    key: EmpireMessage | null;
    at: number;
    /** When the last right-button mousedown was counted (its contextmenu event, fired for the same press, is not counted again). */
    downAt?: number;
}

/**
 * Records a right-click on the stub `key` at time `now` (ms). Returns true when it completes a double right-click
 * (the previous right-click was on the same stub within DOUBLE_RIGHT_CLICK_MS), which resets the tracker.
 */
export function registerStubRightClick(tracker: RightClickTracker, key: EmpireMessage, now: number): boolean {
    if (tracker.key === key && now - tracker.at <= DOUBLE_RIGHT_CLICK_MS) {
        tracker.key = null;
        tracker.at = 0;
        return true;
    }
    tracker.key = key;
    tracker.at = now;
    return false;
}

/** A `contextmenu` event on a stub row: the browser menu is suppressed; true when it completes a double right-click. */
export function handleStubContextMenu(e: { preventDefault(): void; stopPropagation(): void }, tracker: RightClickTracker, key: EmpireMessage, now: number): boolean {
    e.preventDefault();
    e.stopPropagation();
    return registerStubRightClick(tracker, key, now);
}

/**
 * A mouse event on a stub row for the double right-click: the right-button `mousedown` counts (Chromium on Linux and
 * Firefox fire `contextmenu` on press, Windows / macOS on release, so the press is the one common signal); a
 * `contextmenu` that no right press preceded (ctrl-click on macOS, a long press) counts by itself. `contextmenu` is
 * always suppressed. True when it completes a double right-click.
 */
export function handleStubMouseEvent(
    e: { type: string; button?: number; preventDefault(): void; stopPropagation(): void },
    tracker: RightClickTracker,
    key: EmpireMessage,
    now: number,
): boolean {
    if (e.type === 'contextmenu') {
        e.preventDefault();
        e.stopPropagation();
        if (tracker.downAt !== undefined && now - tracker.downAt < 1000) return false; // the press already counted
        return registerStubRightClick(tracker, key, now);
    }
    if (e.type === 'mousedown' && e.button === 2) {
        tracker.downAt = now;
        return registerStubRightClick(tracker, key, now);
    }
    return false;
}

/** Removes the stub and keeps it from coming back (a queue-backed stub is re-added by syncStubs otherwise). */
export function dismissStub(state: StubListState, key: EmpireMessage): boolean {
    state.dismissed.add(key);
    return removeStub(state, key);
}

export type NewStub = Omit<MessageStub, 'seq' | 'read' | 'shownMs'> & { read?: boolean };

/** Adds a stub unless one with the same key exists. Returns whether it was added. A new stub resets the view to the
 *  top so the newest entry shows. */
export function addStub(state: StubListState, stub: NewStub): boolean {
    if (state.dismissed.has(stub.key) || state.stubs.some((s) => s.key === stub.key)) return false;
    state.stubs.push({ ...stub, read: stub.read ?? false, shownMs: 0, seq: state.nextSeq++ });
    state.offset = 0;
    state.dwellMs = 0;
    state.progress = 0;
    return true;
}

export function removeStub(state: StubListState, key: EmpireMessage): boolean {
    const i = state.stubs.findIndex((s) => s.key === key);
    if (i < 0) return false;
    state.stubs.splice(i, 1);
    clampOffset(state);
    return true;
}

export function markStubRead(state: StubListState, key: EmpireMessage): void {
    const s = state.stubs.find((x) => x.key === key);
    if (s) s.read = true;
}

/**
 * Keeps the stubs of one queue-backed kind (conversation / suggestion) in step with its queue: stubs whose entry left
 * the queue go, new entries get a stub from `make`.
 */
export function syncStubs(state: StubListState, kind: StubKind, live: readonly EmpireMessage[], make: (m: EmpireMessage) => NewStub): void {
    const liveSet = new Set(live);
    for (let i = state.stubs.length - 1; i >= 0; i--) {
        const s = state.stubs[i];
        if (s.kind === kind && !liveSet.has(s.key)) state.stubs.splice(i, 1);
    }
    for (const m of live) {
        if (!state.stubs.some((s) => s.key === m)) addStub(state, make(m));
    }
    clampOffset(state);
}

/** Newest first: by star date, then arrival order. */
export function orderStubs(stubs: readonly MessageStub[]): MessageStub[] {
    return [...stubs].sort((a, b) => b.starDate - a.starDate || b.seq - a.seq);
}

function clampOffset(state: StubListState): void {
    const n = state.stubs.length;
    if (n === 0) {
        state.offset = 0;
        state.progress = 0;
    } else if (state.offset >= n) state.offset %= n;
}

export interface StubWindow {
    /** The rows to draw, top to bottom (wrapping round the ordered list when it scrolls). */
    rows: MessageStub[];
    /** Entries not in the window ("n more"). */
    more: number;
    /** Whether the list is longer than the window (and so scrolls). */
    scrolls: boolean;
    /** The row that scrolls in below the window (null when the list does not scroll). */
    next: MessageStub | null;
}

export function visibleStubs(state: StubListState, visible: number): StubWindow {
    const ordered = orderStubs(state.stubs);
    const n = ordered.length;
    const v = clampVisibleStubs(visible);
    if (n <= v) return { rows: ordered, more: 0, scrolls: false, next: null };
    const rows: MessageStub[] = [];
    for (let i = 0; i < v; i++) rows.push(ordered[(state.offset + i) % n]);
    return { rows, more: n - v, scrolls: true, next: ordered[(state.offset + v) % n] };
}

export interface AdvanceOptions {
    visible: number;
    /** The pointer is over the list: no scrolling, no expiry. */
    hovered: boolean;
    /** The galaxy clock is paused (ScrollingLinkList follows galaxy time). */
    paused: boolean;
    rowPx?: number;
}

/**
 * Advances the list by `dtMs`: plain message stubs in the visible window age and expire after POPUP_DURATION_MS
 * (unread or read); when the list is longer than the window it holds each row for STUB_DWELL_MS, then scrolls one row at
 * SCROLL_PX_PER_SECOND, wrapping round. Returns the expired stubs.
 */
export function advanceStubList(state: StubListState, dtMs: number, opts: AdvanceOptions): MessageStub[] {
    const expired: MessageStub[] = [];
    if (opts.hovered || opts.paused || dtMs <= 0) return expired;
    const win = visibleStubs(state, opts.visible);
    for (const s of win.rows) {
        if (s.kind !== 'message' && s.kind !== 'battle') continue;
        s.shownMs += dtMs;
        if (s.shownMs >= POPUP_DURATION_MS) expired.push(s);
    }
    if (expired.length > 0) {
        for (const s of expired) state.stubs.splice(state.stubs.indexOf(s), 1);
        clampOffset(state);
    }
    if (!visibleStubs(state, opts.visible).scrolls) {
        state.offset = 0;
        state.dwellMs = 0;
        state.progress = 0;
        return expired;
    }
    let t = dtMs;
    const rowMs = ((opts.rowPx ?? TICKER_ROW_PX) / SCROLL_PX_PER_SECOND) * 1000;
    while (t > 0) {
        if (state.progress === 0 && state.dwellMs < STUB_DWELL_MS) {
            const d = Math.min(t, STUB_DWELL_MS - state.dwellMs);
            state.dwellMs += d;
            t -= d;
            continue;
        }
        const need = (1 - state.progress) * rowMs;
        if (t < need) {
            state.progress += t / rowMs;
            t = 0;
        } else {
            t -= need;
            stepStubList(state, 1);
        }
    }
    return expired;
}

/** Moves the window by `rows` (wheel / auto-scroll), wrapping round; resets the dwell. */
export function stepStubList(state: StubListState, rows: number): void {
    const n = state.stubs.length;
    state.progress = 0;
    state.dwellMs = 0;
    if (n === 0) {
        state.offset = 0;
        return;
    }
    state.offset = (((state.offset + rows) % n) + n) % n;
}

/** Stubs of the conversation / suggestion kinds older than CONVERSATION_LIFETIME (DiplomaticMessageQueue.cs 671). */
export function isConversationExpired(starDate: number, currentStarDate: number): boolean {
    return starDate < currentStarDate - CONVERSATION_LIFETIME;
}
