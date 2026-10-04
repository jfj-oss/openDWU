// Intelligence Agents / Characters screen (F4): row building (CharacterListView.cs BindData, Galaxy.2.cs
// ResolveDescriptionCharacterTask / ResolveCharacterLocationDescription / ResolveCharacterSummary), the mission form's
// legal-mission gating (CharacterMission.cs GetState / change handlers) and the success estimate
// (Empire.6.cs 21 CalculateIntelligenceMissionSuccessChance via CharacterMission.cs GetMissionDifficulty*), hand-worked.
import { beforeAll, describe, expect, it } from 'vitest';
import { loadGameDataFs } from './helpers/loadGameDataFs';
import { cachedTickGame } from './helpers/gameCache';
import type { GameData } from '../src/sim/data/gameData';
import type { Galaxy } from '../src/sim/galaxy';
import type { Empire } from '../src/sim/empire';
import { Character, CharacterRole, CharacterSkillType, getEmpireCharacters } from '../src/sim/characters';
import { IntelligenceMissionOutcome as O, IntelligenceMissionType as T, characterMission, newIntelligenceMissionAgainstEmpire } from '../src/sim/espionage';
import { galaxyCurrentStarDate } from '../src/sim/pirateRelations';
import { resolveStarDateDescription } from '../src/sim/galaxyTime';
import {
    MISSION_TYPE_ORDER,
    TIME_ONE_MONTH,
    TIME_ONE_YEAR,
    TIME_THREE_MONTHS,
    TIME_UNTIL_CANCELLED,
    buildMissionState,
    canDismissCharacter,
    characterRows,
    characterSkillLines,
    characterTraitsLine,
    formFromMission,
    initialMissionForm,
    missionDifficultyDescription,
    missionDifficultyWarning,
    missionNeedsTarget,
    missionPanelMode,
    missionShowsTime,
    missionTargetEmpires,
    resolveCharacterLocationDescription,
    resolveCharacterSummary,
    resolveDescriptionCharacterTask,
    withMissionType,
    withTargetEmpire,
    type MissionForm,
    canTransfer,
    characterBackdropUrl,
    characterInTransitOrUnknown,
    characterPortraitUrl,
    characterRoleCounts,
    filterCharacterRows,
    landscapeImageUrl,
    resolveTransferDestination,
    roleIconOverlayRect,
    roleIconUrl,
    transferOptions,
} from '../src/ui/screens/intelligence';
import { DiplomaticRelationType, obtainDiplomaticRelation } from '../src/sim/diplomacy';
import { PLAYER_OPS } from '../src/sim/player/playerOps';

let gameData: GameData;
beforeAll(async () => {
    gameData = await loadGameDataFs();
}, 120000);

function aiEmpires(g: Galaxy): Empire[] {
    return g.empires.filter((e) => e !== g.playerEmpire && e.pirateEmpireBaseHabitat === null);
}

function newAgent(g: Galaxy, empire: Empire, name: string): Character {
    const c = new Character(name, CharacterRole.IntelligenceAgent, '', empire.dominantRace, null, null, 0);
    c.activate(g, empire, empire.capital);
    return c;
}

/** a has met b; no leader / espionage bonus; b not reclusive: the StealGalaxyMap difficulty is (int)(20 × 3.5) = 70. */
function setup() {
    const { galaxy } = cachedTickGame(gameData);
    const [a, b] = aiEmpires(galaxy);
    obtainDiplomaticRelation(a, b).type = DiplomaticRelationType.None;
    a.leader = null;
    a.espionageBonus = 0;
    b.reclusive = false;
    for (const c of getEmpireCharacters(a).filter((c) => c.role === CharacterRole.Ambassador)) c.kill(galaxy);
    const agent = newAgent(galaxy, a, 'Agent A');
    return { galaxy, a, b, agent };
}

describe('character rows (CharacterListView.cs BindData)', () => {
    it('one row per character; an idle agent reads "(No mission)", an agent on a mission "<Description>  (completed DATE)" and location "(Unknown)"', () => {
        const { galaxy, a, b, agent } = setup();
        const rows = characterRows(a, galaxy);
        expect(rows.map((r) => r.character)).toEqual(getEmpireCharacters(a));
        const row = rows.find((r) => r.character === agent)!;
        expect(row.role).toBe('Intelligence Agent');
        expect(row.mission).toBe('(No mission)');
        expect(row.location).toBe(a.capital!.name);

        const m = newIntelligenceMissionAgainstEmpire(a, agent, T.StealGalaxyMap, 1000, b);
        agent.mission = m;
        // Galaxy.2.cs 5563 with Outcome Undefined → the "Fail" template "steal the galaxy map of the {0}", capitalised.
        expect(resolveDescriptionCharacterTask(agent, galaxy)).toBe(`Steal the galaxy map of the ${b.name}  (completed ${resolveStarDateDescription(1000 + TIME_ONE_MONTH)})`);
        expect(resolveCharacterLocationDescription(agent)).toBe('(Unknown)');

        // Counter-intelligence until cancelled: TimeLength > 1e9 → "Until cancelled"; location stays visible.
        const ci = buildMissionState(galaxy, a, agent, withMissionType(galaxy, a, initialMissionForm(galaxy, a), T.CounterIntelligence))!;
        agent.mission = ci;
        expect(resolveDescriptionCharacterTask(agent, galaxy)).toMatch(/\(Until cancelled\)$/);
        expect(resolveCharacterLocationDescription(agent)).toBe(a.capital!.name);

        // Deep cover established (SucceedNotDetect): "Deep cover in the EMPIRE".
        const dc = newIntelligenceMissionAgainstEmpire(a, agent, T.DeepCover, 0, b);
        dc.outcome = O.SucceedNotDetect;
        agent.mission = dc;
        expect(resolveDescriptionCharacterTask(agent, galaxy).startsWith(`Deep cover in the ${b.name}  (`)).toBe(true);
    });

    it('summary counts every role (Galaxy.2.cs 3512)', () => {
        const { a } = setup();
        const n = getEmpireCharacters(a).filter((c) => c.role === CharacterRole.IntelligenceAgent).length;
        const s = resolveCharacterSummary(a);
        expect(s.startsWith(`${getEmpireCharacters(a).filter((c) => c.role === CharacterRole.Leader).length} Leader, `)).toBe(true);
        expect(s.endsWith(`, ${n} Intelligence Agent`)).toBe(true);
        expect(s.split(', ')).toHaveLength(8);
    });

    it('skills show "?%" until the bonuses are known, then "+x%" (CharacterSkillsTraitsProgress.cs)', () => {
        const { agent } = setup();
        agent.addSkill(CharacterSkillType.Espionage, 20, null);
        agent.bonusesKnown = false;
        const esp = () => characterSkillLines(agent).find((l) => l.name === 'Espionage')!;
        expect(esp().value).toBe('?%');
        agent.bonusesKnown = true;
        expect(esp().value).toBe(`+${agent.getSkillLevel(CharacterSkillType.Espionage)}%`);
        expect(characterTraitsLine(agent) === '' || characterTraitsLine(agent).startsWith('TRAITS: ')).toBe(true);
    });
});

describe('mission form gating (CharacterMission.cs)', () => {
    it('the eleven mission types in combo order; five take a target object', () => {
        expect(MISSION_TYPE_ORDER).toEqual([T.CounterIntelligence, T.SabotageConstruction, T.DestroyBase, T.StealTerritoryMap, T.StealOperationsMap, T.StealGalaxyMap, T.StealTechData, T.SabotageColony, T.InciteRevolution, T.AssassinateCharacter, T.DeepCover]);
        expect(MISSION_TYPE_ORDER.filter(missionNeedsTarget)).toEqual([T.SabotageConstruction, T.DestroyBase, T.StealTechData, T.SabotageColony, T.AssassinateCharacter]);
    });

    it('target empires: met empires only, sorted by name', () => {
        const { galaxy, a, b } = setup();
        const list = missionTargetEmpires(galaxy, a);
        expect(list).toContain(b);
        expect(list).not.toContain(a);
        expect([...list].sort((x, y) => x.name.localeCompare(y.name))).toEqual(list);
        obtainDiplomaticRelation(a, b).type = DiplomaticRelationType.NotMet;
        expect(missionTargetEmpires(galaxy, a)).not.toContain(b);
    });

    it('SetState(null) is Counter Intelligence for one month; changing the type re-lists durations (none picked except "Until cancelled")', () => {
        const { galaxy, a, agent } = setup();
        const f0 = initialMissionForm(galaxy, a);
        expect(f0.type).toBe(T.CounterIntelligence);
        expect(buildMissionState(galaxy, a, agent, f0)!.timeLength).toBe(TIME_ONE_MONTH);
        const ci = withMissionType(galaxy, a, f0, T.CounterIntelligence);
        expect(ci.timeOptions.map((o) => o.value)).toEqual([TIME_UNTIL_CANCELLED, TIME_ONE_MONTH, TIME_THREE_MONTHS, TIME_ONE_YEAR]);
        expect(buildMissionState(galaxy, a, agent, { ...ci, targetEmpire: null })!.timeLength).toBe(TIME_UNTIL_CANCELLED);
        const gm = withMissionType(galaxy, a, f0, T.StealGalaxyMap);
        expect(gm.timeIndex).toBe(-1);
        expect(buildMissionState(galaxy, a, agent, gm)).toBeNull(); // no duration picked
        expect(buildMissionState(galaxy, a, agent, { ...gm, timeIndex: 2 })!.timeLength).toBe(TIME_ONE_YEAR);
        expect(buildMissionState(galaxy, a, agent, { ...gm, targetEmpire: null, timeIndex: 0 })).toBeNull(); // no empire
    });

    it('changing the target empire lands on Sabotage Construction; target types need a resolved target', () => {
        const { galaxy, a, b, agent } = setup();
        a.visibility.checkSystemExplored = () => true;
        let f: MissionForm = withTargetEmpire(galaxy, a, initialMissionForm(galaxy, a), b);
        expect(f.type).toBe(T.SabotageConstruction);
        f = withMissionType(galaxy, a, f, T.SabotageColony);
        expect(f.targetOptions).toContain(b.capital!.name);
        expect(buildMissionState(galaxy, a, agent, { ...f, timeIndex: 0 })).toBeNull(); // no target picked
        expect(buildMissionState(galaxy, a, agent, { ...f, timeIndex: 0, target: 'no such colony' })).toBeNull();
        const m = buildMissionState(galaxy, a, agent, { ...f, timeIndex: 1, target: b.capital!.name.toUpperCase() })!; // case-insensitive (ToLower)
        expect(m.type).toBe(T.SabotageColony);
        expect(m.targetHabitat).toBe(b.capital);
        expect(m.timeLength).toBe(TIME_THREE_MONTHS);
        expect(m.startDate).toBe(galaxyCurrentStarDate(galaxy));
    });

    it('assign → panel "active" with the mission; cancel → "assign" again; the form reads back the assigned mission', () => {
        const { galaxy, a, b, agent } = setup();
        expect(missionPanelMode(agent)).toBe('assign');
        const f = { ...withMissionType(galaxy, a, { ...initialMissionForm(galaxy, a), targetEmpire: b }, T.StealTerritoryMap), timeIndex: 1 };
        // The screen issues these as commands (setAgentMission / cancelAgentMission); their executors.
        const state = buildMissionState(galaxy, a, agent, f);
        expect(state).not.toBeNull();
        expect(PLAYER_OPS.setAgentMission(galaxy, a, agent, state!)).toBe(true);
        expect(missionPanelMode(agent)).toBe('active');
        const m = characterMission(agent)!;
        expect(m.type).toBe(T.StealTerritoryMap);
        const back = formFromMission(galaxy, a, m);
        expect([back.type, back.targetEmpire, back.timeIndex]).toEqual([T.StealTerritoryMap, b, 1]);
        expect(missionShowsTime(m)).toBe(true);
        PLAYER_OPS.cancelAgentMission(galaxy, a, agent);
        expect(characterMission(agent)).toBeNull();
        expect(missionPanelMode(agent)).toBe('assign');
        expect(missionPanelMode(a.leader ?? null)).toBe('hidden');
    });

    it('dismiss: Mission = null then Kill; a leader cannot be dismissed while LeaderChangeInfluence != 0', () => {
        const { galaxy, a, agent } = setup();
        agent.mission = newIntelligenceMissionAgainstEmpire(a, agent, T.StealGalaxyMap, 0, aiEmpires(galaxy)[1]);
        PLAYER_OPS.dismissCharacter(galaxy, a, agent);
        expect(getEmpireCharacters(a)).not.toContain(agent);
        const leader = new Character('L', CharacterRole.Leader, '', a.dominantRace, null, null, 0);
        a.leaderChangeInfluence = 0.5;
        expect(canDismissCharacter(leader, a)).toBe(false);
        a.leaderChangeInfluence = 0;
        expect(canDismissCharacter(leader, a)).toBe(true);
    });
});

describe('success estimate (Empire.6.cs 21 via CharacterMission.cs GetMissionDifficultyDescription / Warning)', () => {
    it('unskilled agent (factored 25) vs Steal Galaxy Map (difficulty 70)', () => {
        const { galaxy, a, b, agent } = setup();
        const f = withMissionType(galaxy, a, { ...initialMissionForm(galaxy, a), targetEmpire: b }, T.StealGalaxyMap);
        // One month: ratio 25 × 1 / 70 = 0.357 ≤ 1 → 0.7 × 0.357 = 0.25 → "25%", < 0.7 → highly risky.
        const m1 = buildMissionState(galaxy, a, agent, { ...f, timeIndex: 0 })!;
        expect(missionDifficultyDescription(m1, agent)).toBe('25%');
        expect(missionDifficultyWarning(m1, agent)).toBe('WARNING: This mission is highly risky - your agent may be captured');
        // One year: ratio 25 × 4 / 70 = 1.4286 > 1 → 1 − 0.3 / 1.4286 = 0.79 → "79%", < 0.85 → somewhat risky.
        const m12 = buildMissionState(galaxy, a, agent, { ...f, timeIndex: 2 })!;
        expect(missionDifficultyDescription(m12, agent)).toBe('79%');
        expect(missionDifficultyWarning(m12, agent)).toBe('This mission is somewhat risky, maybe you should reconsider');
        // Espionage 100 → factored (int)(25 × (1 + 3)) = 100; one year: 400 / 70 = 5.714 → 1 − 0.0525 = 0.9475 → "95%", no warning.
        agent.addSkill(CharacterSkillType.Espionage, 100 - agent.espionage, null);
        expect(agent.espionageFactored).toBe(100);
        expect(missionDifficultyDescription(m12, agent)).toBe('95%');
        expect(missionDifficultyWarning(m12, agent)).toBe('');
        // Counter-intelligence shows no probability.
        const ci = buildMissionState(galaxy, a, agent, initialMissionForm(galaxy, a))!;
        expect(missionDifficultyDescription(ci, agent)).toBe('');
        expect(missionDifficultyWarning(ci, agent)).toBe('');
        expect(missionDifficultyDescription(null, agent)).toBe('(Unknown)');
    });
});

describe('pictures (CharacterImageCache.cs, CharacterSummary.cs)', () => {
    it('role icons are images/ui/chrome/characterRole_<Role>.png', () => {
        expect(roleIconUrl(CharacterRole.ColonyGovernor)).toBe('/assets/dwu/images/ui/chrome/characterRole_ColonyGovernor.png');
        expect(roleIconUrl(CharacterRole.PirateLeader)).toBe('/assets/dwu/images/ui/chrome/characterRole_PirateLeader.png');
    });
    it('OverlayRoleIcon: 20% / 20 px on a 300 px portrait, 35% / 1 px on the 38 px list image', () => {
        expect(roleIconOverlayRect(300, 0.2, 20)).toEqual({ x: 220, y: 220, w: 60, h: 60 });
        expect(roleIconOverlayRect(38, 0.35, 1)).toEqual({ x: 24, y: 24, w: 13, h: 13 });
    });
    it('landscape refs follow the LoadEnvLandscapes order (GalaxyImages offsets)', () => {
        expect(landscapeImageUrl(0)).toBe('/assets/dwu/images/environment/landscapes/barrenrock/landscape_0.png');
        expect(landscapeImageUrl(4)).toBe('/assets/dwu/images/environment/landscapes/continental/landscape_0.png');
        expect(landscapeImageUrl(8)).toBe('/assets/dwu/images/environment/landscapes/forest/landscape_0.png');
        expect(landscapeImageUrl(23)).toBe('/assets/dwu/images/environment/landscapes/ocean/landscape_0.png');
        expect(landscapeImageUrl(29)).toBe('/assets/dwu/images/environment/landscapes/volcanic/landscape_1.png');
        expect(landscapeImageUrl(30)).toBeNull();
        expect(landscapeImageUrl(-1)).toBeNull();
    });
    it('race portrait without a picture file; space backdrop while on an offensive mission', () => {
        const { galaxy, a, b, agent } = setup();
        expect(characterPortraitUrl(agent)).toBe(`/assets/dwu/images/units/races/race_${a.dominantRace!.pictureIndex}.png`);
        expect(characterInTransitOrUnknown(agent)).toBe(false);
        const cap = a.capital!;
        // The capital's own landscape (a GalaxyImages index: sim/galaxy.ts SelectXxxPlanet), not the space fallback.
        const land = landscapeImageUrl(cap.landscapePictureRef);
        expect(land).not.toBeNull();
        expect(characterBackdropUrl(agent)).toBe(land);
        agent.mission = newIntelligenceMissionAgainstEmpire(a, agent, T.StealGalaxyMap, galaxyCurrentStarDate(galaxy), b);
        expect(characterInTransitOrUnknown(agent)).toBe(true);
        expect(characterBackdropUrl(agent)).toBe('/assets/dwu/images/ui/chrome/storyEvent.jpg');
    });
});

describe('role filter (lblCharacterSummary entries)', () => {
    it('counts match ResolveCharacterSummary and the filter keeps only that role', () => {
        const { galaxy, a } = setup();
        const counts = characterRoleCounts(a);
        expect(counts.map((r) => `${r.count} ${r.label}`).join(', ')).toBe(resolveCharacterSummary(a));
        const rows = characterRows(a, galaxy);
        expect(filterCharacterRows(rows, null)).toHaveLength(rows.length);
        const agents = filterCharacterRows(rows, CharacterRole.IntelligenceAgent);
        expect(agents.length).toBe(counts.find((r) => r.role === CharacterRole.IntelligenceAgent)!.count);
        expect(agents.every((r) => r.character.role === CharacterRole.IntelligenceAgent)).toBe(true);
    });
});

describe('transfer (CharacterSummary.cs SetupTransferControls / btnTransfer_Click)', () => {
    it('agents have no transfer combo; governors list the colonies by name; no transfer to the current location', () => {
        const { galaxy, a, agent } = setup();
        expect(transferOptions(galaxy, agent)).toBeNull();
        const gov = new Character('Gov', CharacterRole.ColonyGovernor, '', a.dominantRace, null, null, 0);
        gov.activate(galaxy, a, a.capital);
        const opts = transferOptions(galaxy, gov)!;
        expect(opts.map((o) => o.label)).toEqual(a.colonies.map((h) => h.name).sort((x, y) => x.localeCompare(y)));
        const here = opts.find((o) => o.target === a.capital)!;
        expect(canTransfer(gov, resolveTransferDestination(gov, here))).toBe(false);
        expect(canTransfer(gov, resolveTransferDestination(gov, null))).toBe(false);
        const other = opts.find((o) => o.target !== a.capital);
        if (other) expect(canTransfer(gov, resolveTransferDestination(gov, other))).toBe(true);
    });
    it('a fleet admiral transfers to the lead ship of the chosen fleet', () => {
        const { galaxy, a } = setup();
        const adm = new Character('Adm', CharacterRole.FleetAdmiral, '', a.dominantRace, null, null, 0);
        adm.activate(galaxy, a, a.capital);
        const opts = transferOptions(galaxy, adm)!;
        expect(opts.every((o) => o.fleet !== null)).toBe(true);
        for (const o of opts) expect(resolveTransferDestination(adm, o)).toBe(o.fleet!.leadShip);
    });
});
