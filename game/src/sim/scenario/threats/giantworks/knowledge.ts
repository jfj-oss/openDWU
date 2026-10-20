// Giantworks: what each empire knows. Not a port. The threat framework's levels (framework.ts revealTo / knowledgeLevel):
//   1 rumour    - the empire has heard of the Founders' Compact (a message, from the rumour year; a faint emblem on the founding worlds it has met);
//   2 suspected - the empire has read enough cargo manifests (giantworksHintsToSuspect different hints), or it watches the Fitting stage:
//                 it has a shortlist of the wonders the hints fit (the AI weighs it; the player is never shown it);
//   3 confirmed - never before completion. A Diet inspection only narrows the shortlist; a spy, an investigation or a deep-cover
//                 mission yields one more hint. The wonder's identity is proven only by the finished wonder.
// Hints are discrete tags (kind.hintTags, shared tags are red herrings): every convoy carries one (early convoys the general
// ones, later ones the specific ones, now and then a misleading tag from another wonder); an empire learns a tag when it sees the
// convoy. The shortlist is the set of wonders whose tags overlap the empire's known tags the most.
// Rnd: hint decoys draw from the add-on's own Random (state.ts); nothing here draws galaxy.rnd.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { Habitat } from '../../../types';
import type { BuiltObject } from '../../../builtObject';
import { isHumanEmpire } from '../../../humanEmpires';
import { isObjectVisibleToThisEmpire } from '../../../independentTraders';
import { EmpireMessageType } from '../../../messages';
import { tryGetText } from '../../../textResolver';
import { scenarioMessage, scenarioText } from '../../messages';
import { scenarioEmit } from '../../hooks';
import {
    KNOWLEDGE_CONFIRMED,
    KNOWLEDGE_RUMOUR,
    KNOWLEDGE_SUSPECTED,
    knowledgeLevel,
    registerThreatKnownSites,
    revealTo,
    type KnownThreatSite,
} from '../framework';
import { registerThreatInvestigation } from '../investigate';
import { blockadeNote } from './blockade';
import { enabledKinds } from './founders';
import { greatWorkKind, kindMenace, kindValue } from './registry';
import { GW_KEY, gwParam, ordinaryEmpires, peekGwState, TAG, type GreatWorkRecord } from './state';
import type { Random } from '../../../random';
import type { GreatWorkKind } from './types';

// ---------------------------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------------------------

/** The display name of a wonder (GameText `Giantworks Kind <id>`, else the id). Pure. */
export function kindName(id: string): string {
    return tryGetText(`${TAG} Kind ${id}`) ?? id;
}

/** The hint line of a tag (GameText `Giantworks Hint <tag>`, else a generic line). Pure. */
export function hintText(tag: string): string {
    return tryGetText(`${TAG} Hint ${tag}`) ?? scenarioText(`${TAG} Hint Unknown`, tag);
}

export function workLevel(work: GreatWorkRecord, e: Empire | null): number {
    return knowledgeLevel(work, e);
}

// ---------------------------------------------------------------------------------------------------------------
// Cargo hints
// ---------------------------------------------------------------------------------------------------------------

/**
 * The hint tag a convoy leaving at `progress` carries: the wonder's tags in order as the work advances, now and then (the decoy
 * chance) a tag of some other wonder instead. Draws one or two values from `rnd`.
 */
export function convoyTag(galaxy: Galaxy, work: GreatWorkRecord, rnd: Random): string {
    const kind = greatWorkKind(work.wonder);
    const tags = kind?.hintTags ?? [];
    if (tags.length === 0) return 'unknown';
    const decoy = rnd.nextDouble() * 100 < gwParam(galaxy, 'giantworksDecoyPct');
    if (decoy) {
        const others: string[] = [];
        for (const k of enabledKinds(galaxy)) {
            if (k.id === work.wonder) continue;
            for (const t of k.hintTags) if (!tags.includes(t) && !others.includes(t)) others.push(t);
        }
        others.sort();
        if (others.length > 0) return others[rnd.next(0, others.length)];
    }
    return tags[Math.min(tags.length - 1, Math.floor(Math.min(0.999, work.progress) * tags.length))];
}

function human(galaxy: Galaxy, e: Empire): boolean {
    return isHumanEmpire(galaxy, e);
}

function suspectedNow(galaxy: Galaxy, work: GreatWorkRecord, e: Empire): void {
    if (!revealTo(galaxy, work, e, KNOWLEDGE_SUSPECTED)) return;
    if (human(galaxy, e)) {
        scenarioMessage(galaxy, e, scenarioText(`${TAG} Suspected Title`), scenarioText(`${TAG} Suspected`, work.system.systemStar.name), { type: EmpireMessageType.GeneralWarning, subject: work.base ?? work.system.systemStar, popup: false });
    }
}

/** `e` learns a cargo hint. True when the tag was new. Raises the level to suspected when it has enough different hints. */
export function learnTag(galaxy: Galaxy, work: GreatWorkRecord, e: Empire, tag: string): boolean {
    const list = (work.tags[e.empireId] ??= []);
    if (list.includes(tag)) return false;
    if (list.length >= 16) list.shift();
    list.push(tag);
    if (human(galaxy, e)) {
        scenarioMessage(galaxy, e, scenarioText(`${TAG} Hint Title`), scenarioText(`${TAG} Hint`, hintText(tag), work.system.systemStar.name), {
            type: EmpireMessageType.GeneralNeutralEvent,
            subject: work.base ?? work.system.systemStar,
            popup: false,
        });
    }
    revealTo(galaxy, work, e, KNOWLEDGE_RUMOUR);
    if (list.length >= gwParam(galaxy, 'giantworksHintsToSuspect')) suspectedNow(galaxy, work, e);
    return true;
}

/** `e` learns the next true hint it does not have yet (an investigation, a spy). Returns the tag, or null when it has them all. */
export function grantTrueHint(galaxy: Galaxy, work: GreatWorkRecord, e: Empire): string | null {
    const kind = greatWorkKind(work.wonder);
    if (kind === null) return null;
    const have = work.tags[e.empireId] ?? [];
    const next = kind.hintTags.find((t) => !have.includes(t));
    if (next === undefined) return null;
    learnTag(galaxy, work, e, next);
    return next;
}

/** True when the empire knows every true hint (an investigation has nothing more to find). Pure. */
export function knowsAllHints(work: GreatWorkRecord, e: Empire): boolean {
    const kind = greatWorkKind(work.wonder);
    const have = work.tags[e.empireId] ?? [];
    return kind === null || kind.hintTags.every((t) => have.includes(t));
}

// ---------------------------------------------------------------------------------------------------------------
// The shortlist
// ---------------------------------------------------------------------------------------------------------------

/**
 * The wonders `e`'s hints fit, best fit first (at most `giantworksShortlistMax`): those whose tags overlap the known tags most
 * (within one of the best), minus the wrong candidates Diet inspections removed (never below two). Misleading hints can push the
 * true wonder off the list. Empty without any hint. Pure.
 */
export function shortlist(galaxy: Galaxy, work: GreatWorkRecord, e: Empire | null): string[] {
    if (e === null) return [];
    const tags = work.tags[e.empireId] ?? [];
    if (tags.length === 0) return [];
    const pool: GreatWorkKind[] = enabledKinds(galaxy);
    const truth = greatWorkKind(work.wonder);
    if (truth !== null && !pool.includes(truth)) pool.push(truth);
    const scored = pool.map((k) => ({ k, s: tags.filter((t) => k.hintTags.includes(t)).length })).filter((x) => x.s > 0);
    if (scored.length === 0) return [];
    const best = Math.max(...scored.map((x) => x.s));
    let cands = scored.filter((x) => x.s >= Math.max(1, best - 1)).sort((a, b) => b.s - a.s || (a.k.id < b.k.id ? -1 : 1));
    // Inspections remove wrong candidates (lowest fit first), always keeping at least two.
    let remove = work.narrowed;
    while (remove > 0 && cands.length > 2) {
        let idx = -1;
        for (let i = cands.length - 1; i >= 0; i--) {
            if (cands[i].k.id !== work.wonder) {
                idx = i;
                break;
            }
        }
        if (idx < 0) break;
        cands = cands.filter((_, i) => i !== idx);
        remove--;
    }
    return cands.slice(0, Math.max(1, gwParam(galaxy, 'giantworksShortlistMax'))).map((x) => x.k.id);
}

/** The mean common-lore menace / value of `e`'s shortlist (what the AI weighs). 0.4 each when it has no shortlist. Pure. */
export function expectedMenace(galaxy: Galaxy, work: GreatWorkRecord, e: Empire): number {
    const s = shortlist(galaxy, work, e);
    return s.length === 0 ? 0.4 : s.reduce((a, id) => a + kindMenace(id), 0) / s.length;
}
export function expectedValue(galaxy: Galaxy, work: GreatWorkRecord, e: Empire): number {
    const s = shortlist(galaxy, work, e);
    return s.length === 0 ? 0.4 : s.reduce((a, id) => a + kindValue(id), 0) / s.length;
}

// ---------------------------------------------------------------------------------------------------------------
// Periodic: sightings and manifests
// ---------------------------------------------------------------------------------------------------------------

function firstVisible(galaxy: Galaxy, e: Empire, ships: readonly BuiltObject[]): boolean {
    let n = 0;
    for (const b of ships) {
        if (b.hasBeenDestroyed) continue;
        if (isObjectVisibleToThisEmpire(galaxy, e, b)) return true;
        if (++n >= 3) break;
    }
    return false;
}

/** Sightings of the site and the convoys by every ordinary empire; the Fitting stage makes a watcher suspect. */
export function updateKnowledge(galaxy: Galaxy, work: GreatWorkRecord): void {
    if (work.phase !== 'building' || work.base === null || work.base.hasBeenDestroyed) return;
    const kind = greatWorkKind(work.wonder);
    for (const e of ordinaryEmpires(galaxy)) {
        const sees = isObjectVisibleToThisEmpire(galaxy, e, work.base);
        if (sees && !work.seenBy.includes(e.empireId)) {
            work.seenBy.push(e.empireId);
            revealTo(galaxy, work, e, KNOWLEDGE_RUMOUR);
            if (human(galaxy, e)) {
                scenarioMessage(galaxy, e, scenarioText(`${TAG} Seen Title`), scenarioText(`${TAG} Seen`, work.system.systemStar.name), {
                    type: EmpireMessageType.GeneralWarning,
                    subject: work.base,
                    popup: false,
                });
            }
        }
        if (sees && work.stage >= 3 && kind !== null && knowledgeLevel(work, e) < KNOWLEDGE_SUSPECTED) {
            // Watching the Fitting stage: whoever can see the site now suspects, with the first hints in hand.
            for (const t of kind.hintTags.slice(0, Math.max(1, gwParam(galaxy, 'giantworksHintsToSuspect')))) learnTag(galaxy, work, e, t);
            suspectedNow(galaxy, work, e);
        }
        for (const c of work.convoys) {
            if (c.seen.includes(e.empireId) || c.ships.length === 0) continue;
            if (firstVisible(galaxy, e, c.ships) || firstVisible(galaxy, e, c.escorts)) {
                c.seen.push(e.empireId);
                learnTag(galaxy, work, e, c.tag);
            }
        }
    }
}

/** The finished wonder is public: every ordinary empire knows it for certain. */
export function confirmToAll(galaxy: Galaxy, work: GreatWorkRecord): void {
    for (const e of ordinaryEmpires(galaxy)) revealTo(galaxy, work, e, KNOWLEDGE_CONFIRMED);
}

/** A mission against the Compact or an independent world (deep cover, stolen technology) learns one more true hint. */
export function onSpyMission(galaxy: Galaxy, work: GreatWorkRecord, e: Empire, hints: number): void {
    if (work.phase !== 'building') return;
    for (let i = 0; i < hints; i++) if (grantTrueHint(galaxy, work, e) === null) break;
}

// ---------------------------------------------------------------------------------------------------------------
// The rumour
// ---------------------------------------------------------------------------------------------------------------

/** The rumour goes out: every ordinary empire hears of the secret meetings of the independent worlds. */
export function spreadRumour(galaxy: Galaxy, work: GreatWorkRecord): void {
    if (work.rumoured) return;
    work.rumoured = true;
    const names = work.circles.map((c) => c[0].name);
    const list = names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} ${scenarioText(`${TAG} And`)} ${names[names.length - 1]}`;
    for (const e of ordinaryEmpires(galaxy)) {
        revealTo(galaxy, work, e, KNOWLEDGE_RUMOUR);
        scenarioEmit(galaxy, 'foundersRumour', { empire: e });
        if (human(galaxy, e)) scenarioMessage(galaxy, e, scenarioText(`${TAG} Rumour Title`), scenarioText(`${TAG} Rumour`, list), { type: EmpireMessageType.GeneralNeutralEvent, subject: work.circles[0][0], popup: false });
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Known sites (Intelligence screen, selection panel) and the investigation
// ---------------------------------------------------------------------------------------------------------------

/** Percent progress, whole. Pure. */
export function progressPct(work: GreatWorkRecord): number {
    return Math.floor(Math.min(1, Math.max(0, work.progress)) * 100);
}

/** The text of a site for `e`: the label (selection panel) and the Intelligence status. Pure. */
export function siteTexts(galaxy: Galaxy, work: GreatWorkRecord, e: Empire): { label: string; status: string; level: number } {
    const level = knowledgeLevel(work, e);
    if (work.phase === 'complete') {
        const name = kindName(work.wonder);
        return { label: scenarioText(`${TAG} Label Complete`, name), status: scenarioText(`${TAG} Status Complete`, name), level: Math.max(level, KNOWLEDGE_CONFIRMED) };
    }
    const stage = scenarioText(`${TAG} Stage ${work.stage}`);
    // What it might be is never shown before it is finished (the user: keep it a mystery); the shortlist still guides the AI.
    let purpose = scenarioText(`${TAG} Purpose Unknown`);
    const bn = blockadeNote(galaxy, work);
    if (bn !== null) purpose += ' ' + scenarioText(`${TAG} Blockade Speed`, bn.pct, bn.held, bn.of);
    return { label: scenarioText(`${TAG} Label Building`, progressPct(work), purpose), status: scenarioText(`${TAG} Status Building`, stage, progressPct(work), purpose), level };
}

/**
 * Known-site rows for `e` (threat key `giantworks`): the scaffold / wonder base, from Rumour level on once `e` has seen it (the
 * Intelligence screen and the generic markers list only suspected and confirmed rows; the station art draws the rest). Level 2 or 3
 * show "purpose unknown" until it is finished.
 */
export function giantworksKnownSites(galaxy: Galaxy, e: Empire): KnownThreatSite[] {
    const st = peekGwState(galaxy);
    if (st === null) return [];
    const out: KnownThreatSite[] = [];
    for (const w of st.sites) {
        if ((w.phase !== 'building' && w.phase !== 'complete') || w.base === null || w.base.hasBeenDestroyed) continue;
        const t = siteTexts(galaxy, w, e);
        if (t.level < KNOWLEDGE_SUSPECTED && !w.seenBy.includes(e.empireId)) continue;
        out.push({ threat: GW_KEY, kind: 'ship', target: w.base, level: Math.max(1, t.level), site: w, label: t.label, status: t.status });
    }
    return out;
}

/** The threat key of the founding worlds' rows (the Compact's faint seal on the map). */
export const GW_COMPACT_KEY = 'giantworksCompact';

/**
 * Known-site rows for the founding worlds (threat key `giantworksCompact`, target = the habitat): every founder `e` has heard of
 * (Rumour) and explored, while the work is not over. The level is `e`'s level for the work (the seal is faint until it suspects).
 */
export function giantworksCompactSites(galaxy: Galaxy, e: Empire): KnownThreatSite[] {
    const st = peekGwState(galaxy);
    if (st === null) return [];
    const out: KnownThreatSite[] = [];
    for (const w of st.sites) {
        const level = workLevel(w, e);
        if (level < 1 || (w.phase !== 'seeded' && w.phase !== 'building' && w.phase !== 'complete')) continue;
        for (const h of w.founders) {
            if (h.hasBeenDestroyed || !e.visibility.checkSystemExplored(h.systemIndex)) continue;
            out.push({ threat: GW_COMPACT_KEY, kind: 'colony', target: h, level, site: w, label: scenarioText(`${TAG} Founder Label`), status: scenarioText(`${TAG} Founder Status`) });
        }
    }
    return out;
}

function workOfTarget(galaxy: Galaxy, target: Habitat | BuiltObject): GreatWorkRecord | null {
    return (peekGwState(galaxy)?.sites ?? []).find((w) => w.base === target) ?? null;
}

registerThreatKnownSites(GW_KEY, giantworksKnownSites);
registerThreatKnownSites(GW_COMPACT_KEY, giantworksCompactSites);

registerThreatInvestigation(GW_KEY, {
    blocked: (g, e, target) => {
        const w = workOfTarget(g, target);
        if (w === null || w.phase !== 'building') return 'Nothing to investigate';
        return knowsAllHints(w, e) ? 'Nothing more to learn' : null;
    },
    resolve: (g, e, target, agent, success) => {
        const w = workOfTarget(g, target);
        const where = (target as { name?: string }).name ?? '?';
        if (w === null || !success) return { title: scenarioText(`${TAG} Investigation Title`), text: scenarioText(`${TAG} Investigation Nothing`, agent.name, where), good: false };
        const tag = grantTrueHint(g, w, e);
        if (tag === null) return { title: scenarioText(`${TAG} Investigation Title`), text: scenarioText(`${TAG} Investigation Nothing`, agent.name, where), good: false };
        return { title: scenarioText(`${TAG} Investigation Title`), text: scenarioText(`${TAG} Investigation Found`, agent.name, where, hintText(tag)), good: true };
    },
});
