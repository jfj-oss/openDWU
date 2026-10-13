// The Interstellar Diet window's model (Session / In force / Members tabs) and its map marks (the host world, the
// enforcer fleets). Pure: no DOM, no Rnd, no state changes (never creates the package state), so it also works on the
// sim-worker replica.

import type { Galaxy } from '../../../galaxy';
import type { Empire } from '../../../empire';
import type { Habitat } from '../../../types';
import type { BuiltObject } from '../../../builtObject';
import type { Character } from '../../../characters';
import { resolveStarDateDescription } from '../../../galaxyTime';
import { gameYear } from '../../hooks';
import { galaxyStarDate } from '../../../tick/simTime';
import { isHumanEmpire } from '../../../humanEmpires';
import { strategicValue } from '../../../territory';
import { blocOf, scoreToVote, type Council } from '../../emergent/council';
import { colonyGovernor } from '../../governors';
import { empireGovernors, mostImportantGovernor } from '../governorsCv';
import { tripOfCharacter } from '../vip';
import { type DietMotion, type DietMotionKind, type DietState, DIET_NAME, byId, dietWarCrimesLine, dietMotionKindDef, dietOn, dietParam, peekDietState, registeredDietKinds } from './dietState';
import { dietMembership, dietVoteScore, memberScores, voteWeight } from './dietAi';
import { dietCouncil } from './diet';

export interface DietMotionRow {
    id: number;
    kind: DietMotionKind;
    text: string;
    proposer: string;
    /** What it does, in a line. */
    effect: string;
    /** Our advisers' reading (the AI score for our empire): favourable / unfavourable / neutral. */
    advice: string;
    /** Projected weighted totals (delegates present or on the way; humans as voted so far). */
    projectedYes: number;
    projectedNo: number;
    projected: string;
    ourVote: 'yes' | 'no' | 'abstain' | '';
    vetoed: boolean;
    status: string;
}

export interface DietMemberRow {
    empire: Empire;
    name: string;
    weight: number;
    weightNote: string;
    delegate: string;
    presence: 'present' | 'travelling' | 'lost' | 'none' | 'home';
    tags: string;
    you: boolean;
}

export interface DietLawRow {
    text: string;
    since: string;
    until: string;
}

export interface DietViewModel {
    title: string;
    member: boolean;
    host: string;
    world: Habitat | null;
    worldName: string;
    hostBonuses: string;
    regent: string;
    regentIsYou: boolean;
    emperor: string;
    nextSession: string;
    session: {
        id: number;
        emergency: boolean;
        stage: 'gathering' | 'voting';
        opens: string;
        closes: string;
        motions: DietMotionRow[];
        ourDelegate: string;
        ourPresence: string;
        vetoAvailable: boolean;
        vetoMotionId: number;
    } | null;
    laws: DietLawRow[];
    sanctions: string[];
    enforcers: { target: string; ships: number; stage: string; station: string; lead: BuiltObject | null }[];
    history: { text: string; result: string; tally: string; date: string }[];
    /** Every recorded motion, newest first (the History tab groups them by year and filters by result). */
    motionLog: { year: number; text: string; proposer: string; result: 'passed' | 'failed' | 'vetoed'; yes: number; no: number; target: string }[];
    members: DietMemberRow[];
    governors: { character: Character; label: string; best: boolean; current: boolean }[];
    canEmergency: boolean;
    canEmperor: boolean;
    fund: number;
    /** Kinds the player may propose, with the targets they take. */
    proposable: { kind: DietMotionKind; label: string; needs: 'none' | 'empire' | 'pirate' | 'pair' | 'colony' | 'law' }[];
    proposal: string;
    /** War Crimes: the worst offender's line ('' = the add-on is off). */
    warCrimes: string;
}

const KIND_LABEL: Record<DietMotionKind, string> = {
    sanction: 'Sanctions (with an enforcer blockade)',
    embargo: 'Embargo restricted resources',
    condemn: 'Condemn a war',
    lift: 'Lift sanctions',
    recognise: 'Recognise a new state',
    threat: 'Declare a threat',
    truce: 'Enforced truce',
    freeTrade: 'Galactic free trade',
    banPlanetDestroyers: 'Ban planet destroyers',
    banBombard: 'Ban colony bombardment',
    outlawPirates: 'Outlaw a pirate faction',
    protectIndependents: 'Protect the independents',
    openIndependents: 'Open the independents',
    claim: 'Recognise a claim',
    expel: 'Expel a member',
    regent: 'Elect a Regent',
    repeal: 'Repeal a measure',
};

function effectOf(st: DietState, m: DietMotion): string {
    switch (m.kind) {
        case 'sanction':
            return `Every member puts trade sanctions on the ${m.target?.name ?? ''}; the Diet sends an enforcer fleet from the host world to blockade one of their most valuable worlds.`;
        case 'embargo':
            return 'Members stop supplying restricted resources to the target.';
        case 'condemn':
            return 'Every member thinks less of the aggressor; their reputation falls.';
        case 'lift':
            return 'Members lift their sanctions; the enforcers go home.';
        case 'recognise':
            return 'Members meet and recognise the new state; it may take a seat.';
        case 'threat':
            return 'Members at war with it draw closer; the AI members sanction it.';
        case 'truce':
            return `The war becomes a truce for ${3} years; breaking it brings automatic sanctions.`;
        case 'freeTrade':
            return 'Free trade agreements between every pair of members at peace.';
        case 'banPlanetDestroyers':
            return 'No member may use planet destroyers against colonies; using one is a violation.';
        case 'banBombard':
            return 'No member may bombard colonies; bombarding is a violation.';
        case 'outlawPirates':
            return `Members' warships are welcome in each other's territory, and the Diet pays a bounty per ${m.target?.name ?? ''} warship destroyed.`;
        case 'protectIndependents':
            return 'No member may invade an independent world; taking one is a violation.';
        case 'openIndependents':
            return 'The protection of the independents ends.';
        case 'claim':
            return `The claimant may go to war for ${m.colony?.name ?? 'the colony'} without the reputation and incident cost of declaring war; condemnations of that war are barred.`;
        case 'expel':
            return 'The member loses its seat and may not rejoin for years.';
        case 'regent':
            return 'The Regent may veto one motion per session, call emergency sessions, and may declare themselves Emperor.';
        case 'repeal': {
            const law = st.laws.find((l) => l.id === m.resourceId);
            return `Ends: ${law?.text ?? 'a measure'}.`;
        }
        default:
            return dietMotionKindDef(m.kind)?.effect(m) ?? '';
    }
}

function kindLabel(k: DietMotionKind): string {
    return (KIND_LABEL as Record<string, string>)[k] ?? dietMotionKindDef(k)?.label ?? k;
}

function dateOf(sd: number): string {
    return sd < 0 ? '—' : resolveStarDateDescription(sd);
}

function presenceOf(st: DietState, galaxy: Galaxy, e: Empire): { delegate: string; presence: DietMemberRow['presence'] } {
    const s = st.session;
    if (s === null) {
        const g = st.delegateChoice[e.empireId] ?? mostImportantGovernor(galaxy, e);
        return { delegate: g?.name ?? '—', presence: g === null ? 'none' : 'home' };
    }
    const d = s.delegates.find((x) => x.empire === e);
    if (d === undefined || d.character === null) return { delegate: '—', presence: 'none' };
    if (d.lost || !d.character.active) return { delegate: d.character.name, presence: 'lost' };
    if (d.character.location === s.world) return { delegate: d.character.name, presence: 'present' };
    return { delegate: d.character.name, presence: tripOfCharacter(galaxy, d.character) !== null || d.character.transferDestination !== null ? 'travelling' : 'home' };
}

/** The window model for `player`; null when the Diet is off or no council exists yet. */
export function dietView(galaxy: Galaxy, player: Empire): DietViewModel | null {
    if (!dietOn(galaxy)) return null;
    const c: Council | null = dietCouncil(galaxy);
    const st = peekDietState(galaxy);
    if (c === null || st === null) return null;
    const now = galaxyStarDate(galaxy);
    const ms = dietMembership(galaxy, c).filter((m) => m.active && st.expelled[m.empireId] === undefined).sort(byId);
    const member = ms.includes(player);
    const scores = memberScores(galaxy, ms);
    const s = st.session;
    const regentActive = st.regent !== null && st.regent.active && ms.includes(st.regent) && now < st.regentUntil;
    let session: DietViewModel['session'] = null;
    if (s !== null) {
        const mine = s.delegates.find((d) => d.empire === player) ?? null;
        const motions: DietMotionRow[] = s.motions.map((m) => {
            let yes = 0;
            let no = 0;
            for (const d of s.delegates) {
                if (d.character === null || d.lost || !d.character.active) continue;
                let v: 'yes' | 'no' | 'abstain' = 'abstain';
                const cast = m.votes.find((x) => x.empire === d.empire);
                if (cast !== undefined) v = cast.vote;
                else if (!isHumanEmpire(galaxy, d.empire)) v = scoreToVote(galaxy, dietVoteScore(galaxy, c, st, d.empire, m));
                else continue;
                const w = voteWeight(galaxy, st, ms, scores, d.empire, d.lesser).weight;
                if (v === 'yes') yes += w;
                else if (v === 'no') no += w;
            }
            const ours = m.votes.find((x) => x.empire === player);
            const advise = member ? dietVoteScore(galaxy, c, st, player, m) : 0;
            return {
                id: m.id,
                kind: m.kind,
                text: m.text,
                proposer: m.proposer.name,
                effect: effectOf(st, m),
                advice: !member ? '' : advise >= 5 ? `Favourable to us (${Math.round(advise)})` : advise <= -5 ? `Against our interest (${Math.round(advise)})` : 'Of little concern to us',
                projectedYes: Math.round(yes * 10) / 10,
                projectedNo: Math.round(no * 10) / 10,
                projected: `${(Math.round(yes * 10) / 10).toFixed(1)} for, ${(Math.round(no * 10) / 10).toFixed(1)} against — ${yes > no ? 'likely to pass' : 'likely to fail'}`,
                ourVote: ours?.vote ?? '',
                vetoed: (st.vetoMotionId ?? 0) === m.id,
                status: m.status,
            };
        });
        const pres = presenceOf(st, galaxy, player);
        session = {
            id: s.id,
            emergency: s.emergency,
            stage: s.stage,
            opens: dateOf(s.opens),
            closes: dateOf(s.closes),
            motions,
            ourDelegate: mine?.character?.name ?? '—',
            ourPresence: mine === null ? '' : mine.lesser ? `${pres.presence} (lesser delegate: ${Math.round(dietParam(galaxy, 'dietLesserDelegatePct'))}% weight)` : pres.presence,
            vetoAvailable: regentActive && st.regent === player && !s.vetoUsed,
            vetoMotionId: st.vetoMotionId ?? 0,
        };
    }
    const members: DietMemberRow[] = ms.map((e) => {
        const d = s?.delegates.find((x) => x.empire === e) ?? null;
        const w = voteWeight(galaxy, st, ms, scores, e, d?.lesser ?? false);
        const p = presenceOf(st, galaxy, e);
        const tags = [e === st.host ? 'host' : '', regentActive && e === st.regent ? 'Regent' : '', st.emperor?.empire === e ? 'Emperor' : '', blocOf(c, e)?.name ?? '', c.sanctions.some((x) => x.target === e) ? 'sanctioned' : ''].filter((x) => x !== '').join(', ');
        return {
            empire: e,
            name: e.name,
            weight: w.weight,
            weightNote: `size and strength ${w.base.toFixed(1)}; standing ${(w.standing * 100).toFixed(0)}%, gifts ${(w.gifts * 100).toFixed(0)}%, spies ${(w.spies * 100).toFixed(0)}%${w.lesser < 1 ? `; lesser delegate ×${w.lesser}` : ''}`,
            delegate: p.delegate,
            presence: p.presence,
            tags,
            you: e === player,
        };
    });
    const best = mostImportantGovernor(galaxy, player);
    const chosen = st.delegateChoice[player.empireId] ?? null;
    const governors = member
        ? empireGovernors(player)
              .filter((g) => g.active && g.location !== null)
              .map((g) => {
                  const post = [...player.colonies].find((h) => colonyGovernor(h) === g) ?? null;
                  return { character: g, label: `${g.name}${post !== null ? ` (${post.name}, value ${Math.round(strategicValue(post))})` : ''}`, best: g === best, current: chosen === null ? g === best : g === chosen };
              })
              .sort((a, b) => Number(b.best) - Number(a.best) || a.character.name.localeCompare(b.character.name))
        : [];
    const em = st.emperor;
    const lastEm = st.lastEmergency;
    const p = st.proposals[player.empireId];
    return {
        title: `The ${DIET_NAME}`,
        member,
        host: st.host?.name ?? '—',
        world: st.world,
        worldName: st.world?.name ?? '—',
        hostBonuses: `+${dietParam(galaxy, 'dietHostIncomePct')}% income, +${dietParam(galaxy, 'dietHostHappinessPct')}% happiness, +${dietParam(galaxy, 'dietHostGrowthPct')}% growth, +${dietParam(galaxy, 'dietHostConstructionPct')}% construction, scenic ${dietParam(galaxy, 'dietHostScenic')}; visitor trade during sessions`,
        regent: regentActive ? `${st.regent!.name} (until ${dateOf(st.regentUntil)})` : 'none',
        regentIsYou: regentActive && st.regent === player,
        emperor: em !== null ? `${em.empire.name}: must hold ${em.capital.name} and ${em.world.name} until ${dateOf(em.until)}` : '',
        nextSession: s !== null ? 'in session' : dateOf(st.nextSessionAt),
        warCrimes: dietWarCrimesLine.fn?.(galaxy) ?? '',
        session,
        laws: st.laws.map((l) => ({ text: l.text, since: dateOf(l.since), until: l.until < 0 ? 'until repealed' : dateOf(l.until) })),
        sanctions: c.sanctions.map((x) => `${x.kind === 'sanction' ? 'Sanctions' : 'Embargo'} on the ${x.target.name} (since ${x.year})`),
        enforcers: st.enforcers.map((f) => ({ target: f.target.name, ships: f.ships.filter((b) => !b.hasBeenDestroyed).length, stage: f.stage === 'blockading' ? 'blockading' : f.stage === 'enRoute' ? 'en route' : 'gathering', station: f.station?.name ?? '—', lead: f.fleet?.leadShip ?? f.ships[0] ?? null })),
        history: [...st.history].reverse().slice(0, 12).map((h) => ({ text: h.text, result: h.result, tally: `${h.yes.toFixed(1)}–${h.no.toFixed(1)}`, date: dateOf(h.starDate) })),
        motionLog: [...st.history].reverse().map((h) => ({ year: h.year ?? gameYear(h.starDate), text: h.text, proposer: h.proposer.name, result: h.result, yes: h.yes, no: h.no, target: h.target?.name ?? '—' })),
        members,
        governors,
        canEmergency: regentActive && st.regent === player && s === null && (lastEm < 0 || now - lastEm >= dietParam(galaxy, 'dietEmergencyYears') * 600_000),
        canEmperor: regentActive && st.regent === player && em === null,
        fund: Math.round(st.fund),
        proposable: [
            ...(Object.keys(KIND_LABEL) as DietMotionKind[]).map((k): DietViewModel['proposable'][number] => ({
                kind: k,
                label: KIND_LABEL[k],
                needs: k === 'truce' ? 'pair' : k === 'outlawPirates' ? 'pirate' : k === 'claim' ? 'colony' : k === 'repeal' ? 'law' : ['freeTrade', 'banPlanetDestroyers', 'banBombard', 'protectIndependents', 'openIndependents'].includes(k) ? 'none' : 'empire',
            })),
            ...registeredDietKinds()
                .filter((d) => d.proposable === undefined || d.proposable(galaxy))
                .map((d) => ({ kind: d.kind as DietMotionKind, label: d.label, needs: d.needs })),
        ],
        proposal: p !== undefined ? `${kindLabel(p.kind)}${p.target !== null ? `: ${p.target.name}` : ''}` : '',
    };
}

// ---------------------------------------------------------------------------------------------------------------
// Map marks
// ---------------------------------------------------------------------------------------------------------------

export interface DietMapMarks {
    world: { x: number; y: number; label: string; inSession: boolean } | null;
    fleets: { lead: BuiltObject; label: string }[];
}

/** The host world and the visible enforcer fleets (lead ships) for `viewer`. Pure. */
export function dietMapMarks(galaxy: Galaxy, viewer: Empire | null, visible: (bo: BuiltObject) => boolean): DietMapMarks | null {
    if (galaxy.scenario === null || !dietOn(galaxy)) return null;
    const st = peekDietState(galaxy);
    if (st === null) return null;
    const w = st.world;
    const fleets: DietMapMarks['fleets'] = [];
    for (const f of st.enforcers) {
        const lead = f.fleet?.leadShip ?? f.ships.find((b) => !b.hasBeenDestroyed) ?? null;
        if (lead === null || lead.hasBeenDestroyed || !visible(lead)) continue;
        fleets.push({ lead, label: `Diet enforcers (${f.ships.filter((b) => !b.hasBeenDestroyed).length} ships) — blockade of the ${f.target.name}` });
    }
    void viewer;
    return {
        world: w === null ? null : { x: w.xpos, y: w.ypos, label: `${w.name}: seat of the ${DIET_NAME}${st.session !== null ? ' (in session)' : ''}`, inSession: st.session !== null },
        fleets,
    };
}
