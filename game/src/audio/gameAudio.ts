// In-game audio glue: the per-frame Main View sound pass + request flush
// (Main.Part13.cs method_0/1/2), the ambient music fade (MainView.1.cs:2812),
// the game-start music switch (Main.Part12.cs:2918), the event stings
// (Main.Part4.cs:487 method_523 → method_515..method_521 / ArhCaEfBkk) and
// the message sounds (Main.Part9.cs:2352-2360). Pure mapping functions are
// exported for tests; installGameAudio wires them to the running game.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { EventMessageType } from '../sim/eventTypes';
import { Creature, CreatureType } from '../sim/creature';
import { Character } from '../sim/characters';
import { isBuiltObject, isHabitat } from '../sim/missions/mission';
import { empireEvaluationByEmpire, empireEvaluationsOf } from '../sim/diplomacy';
import type { MessageRoute } from '../ui/messageRouting';
import { ShipActionType, type ShipAction } from '../sim/player/shipAction';
import { checkRuinsHaveBenefit } from '../sim/exploration';
import { BuiltObjectRole } from '../sim/data/designSpecifications';
import { startEffects, type EffectsPlayer, type SoundEffectRequest } from './effectsPlayer';
import { ambientMusicAction, MainViewSounds, ReplicaSoundMarks, simFlagSoundMarks, type SoundMarks, type SoundView } from './mainViewSounds';
import { hasRemoteCommandSink } from '../sim/player/playerCommands';
import { eventStingClosed, musicGameStarted, musicPlayer, playEventSting, stingPlayer } from './musicPlayer';
// [rimatmo-wiring] begin — 19i items 8/9/10 (data/wiring; render half in src/render/rimAtmosphereLayer.ts, not edited here)
import { scenarioParam } from '../sim/scenario/state';
import { rimWeightAt, rimWeightAtCapital } from './rimAtmosphereGeometry';
import { RIM_MOOD_TRACKS, RimAmbientBed, playRimVoiceStaticBurst, rimMoodProbability, rimVoiceStaticGain } from './rimAtmosphereMix';
// [rimatmo-wiring] end
import type { BuiltObject } from '../sim/builtObject';
import { RimCreatureAudio } from './rimCreatureAudio'; // [rimatmo-audio] 19i audio addendum

// ---------------------------------------------------------------------------
// Pure trigger mapping
// ---------------------------------------------------------------------------

/** Main.Part4.cs:452 ArhCaEfBkk. */
export const STING_DISCOVERY = 'discovery.mp3';

/**
 * Port of Main.Part4.cs:487 method_523's sting choice for an event message: the sting file, or null.
 * `suppressAllPopups` is gameOptions_0.SuppressAllPopups (flag), `stingPlaying` musicPlayer_1.IsPlaying.
 * TODO(port): flag7's per-type popup level gate (Main.Part4.cs:1300-1395, the event popup options) — the event
 * popup panel itself (pnlEventMessage) is not ported, so only SuppressAllPopups gates the stings.
 */
export function eventStingFile(type: EventMessageType, additionalData: unknown, suppressAllPopups: boolean, stingPlaying: boolean): string | null {
    const flag = !suppressAllPopups;
    switch (type) {
        // Main.Part4.cs:509-552: exploration encounters play discovery with their popup.
        case EventMessageType.EncounterBuiltObject:
            return flag && isBuiltObject(additionalData) ? STING_DISCOVERY : null;
        case EventMessageType.EncounterRuins:
            return flag && isHabitat(additionalData) ? STING_DISCOVERY : null;
        // Main.Part4.cs:1505-1509: the three answerable events (else branch).
        case EventMessageType.RogueFleetDefectsToUs:
        case EventMessageType.UncoverPirateAttackFundingAnotherEmpire:
        case EventMessageType.UncoverPlanetDestroyerConstruction:
            return flag ? STING_DISCOVERY : null;
    }
    // Main.Part4.cs:1400: `if (flag7 && !musicPlayer_1.IsPlaying)`.
    if (!flag || stingPlaying) return null;
    switch (type) {
        case EventMessageType.CreatureOutbreak:
            return additionalData instanceof Creature && additionalData.type === CreatureType.SilverMist ? 'dread.mp3' : null;
        case EventMessageType.FreeSuperShip:
            return isBuiltObject(additionalData) || additionalData instanceof Character ? STING_DISCOVERY : null;
        case EventMessageType.LostColonyFound:
        case EventMessageType.IndependentPopulation:
            return 'happyEvent.mp3'; // method_516
        case EventMessageType.OriginsDiscovery:
        case EventMessageType.AncientBattleDebrisField:
        case EventMessageType.StoryClue:
        case EventMessageType.SpecialArea:
        case EventMessageType.UncoverPirateAttackFundingYourEmpire:
        case EventMessageType.RareResourceIntercepted:
            return STING_DISCOVERY; // ArhCaEfBkk
        case EventMessageType.RogueFleetDefectsFromUs:
        case EventMessageType.EmpireSplits:
        case EventMessageType.DisasterEvent:
            return 'disaster.mp3'; // method_519
        case EventMessageType.RaceEvent:
            return 'raceEvent.mp3'; // method_517
        case EventMessageType.WonderBuilt:
            return 'wonder.mp3'; // method_515
        case EventMessageType.PirateFactionJoinsYou:
        case EventMessageType.PhantomPirates:
            return 'dread.mp3'; // method_520
        case EventMessageType.CharacterEvent:
        case EventMessageType.LeaderChange:
            return 'characterEvent.mp3'; // method_518
    }
    return null;
}

/**
 * Main.Part7.cs:498-519 (method_347 for a selected ship): InvestigateRuins with a benefit → ArhCaEfBkk
 * (discovery.mp3); InvestigateBuiltObject of an abandoned ship → discovery.mp3 on musicPlayer_1 at SoundVolume.Maximum.
 * Returns the sting and its volume (null = the player's music volume), or null.
 */
export function investigateSting(
    galaxy: Galaxy,
    empire: Empire,
    selected: unknown,
    action: ShipAction,
): { file: string; maximum: boolean } | null {
    if (!isBuiltObject(selected) || selected.role === BuiltObjectRole.Base) return null;
    if (action.actionType === ShipActionType.InvestigateRuins && isHabitat(action.target) && checkRuinsHaveBenefit(galaxy, action.target.ruin, empire)) {
        return { file: STING_DISCOVERY, maximum: false };
    }
    if (action.actionType === ShipActionType.InvestigateBuiltObject && isBuiltObject(action.target) && action.target.empire === null) {
        return { file: STING_DISCOVERY, maximum: true };
    }
    return null;
}

/** Port of Main.Part4.cs:369 method_521: the diplomacy mood sting for a talk with `other`. */
export function diplomacyMoodFile(isPirate: boolean, reclusive: boolean, overallAttitude: number): string {
    if (isPirate) return 'diplomacyMoodMenacing.mp3';
    if (reclusive) return 'diplomacyMoodNeutral.mp3';
    if (overallAttitude < -10.0) return 'diplomacyMoodAngry.mp3';
    if (overallAttitude < 10.0) return 'diplomacyMoodNeutral.mp3';
    return 'diplomacyMoodHappy.mp3';
    // Race subfolders (Sounds/Effects/<Race>/…) and Customization sets: none ship with DW:U 1.9.5.
}

/**
 * Port of Main.Part9.cs:2348-2361 (ReceiveMessageInternal tail): the effects a received message requests.
 * `if (flag && ((bool_ && !message.SupressPopup) || bool_2)) ResolveMessage(type)`; `if (conversationOption != null)
 * ResolveImportantMessage()`. MessageRoute.popup already includes !SupressPopup.
 */
export function messageSoundRequests(player: EffectsPlayer, messageType: number, route: MessageRoute, suppressAllPopups: boolean): SoundEffectRequest[] {
    const out: SoundEffectRequest[] = [];
    if (!suppressAllPopups && (route.popup || route.ticker)) out.push(player.resolveMessage(messageType));
    if (route.conversation !== null) out.push(player.resolveImportantMessage());
    return out;
}

// ---------------------------------------------------------------------------
// App wiring (DOM / Web Audio side)
// ---------------------------------------------------------------------------

/** Main.method_0 on the session queue; false when there is no audio (tests / no Web Audio). */
export function requestSound(req: SoundEffectRequest | null): boolean {
    try {
        return startEffects().request(req);
    } catch {
        return false;
    }
}

/** The session EffectsPlayer (for the Resolve* builders at UI sites). */
export function effects(): EffectsPlayer | null {
    try {
        return startEffects().player;
    } catch {
        return null;
    }
}

/** A message reached the player (Main.Part9.cs:2352-2360). */
export function playMessageSounds(messageType: number, route: MessageRoute, suppressAllPopups: boolean): void {
    const p = effects();
    if (p === null) return;
    for (const r of messageSoundRequests(p, messageType, route, suppressAllPopups)) requestSound(r);
}

/** Main.Part10.cs:3401 / 3539 method_0(ResolveAttackClick()): an attack / bombard order given by right-click. */
export function playAttackClick(): void {
    const p = effects();
    if (p !== null) requestSound(p.resolveAttackClick());
}

/** Main.Part10.cs:2947 method_225 (grid.wav at the effects volume): an object selected in the Main View. */
export function playGridClick(): void {
    const p = effects();
    if (p !== null) requestSound(p.resolveGrid());
}

/** Main.Part8.cs:449 method_296 → method_521: a talk with `other` opened (the diplomacy window was closed). */
export function playDiplomacyMood(galaxy: Galaxy, other: Empire | null, player: Empire): void {
    if (other === null) return;
    // EmpireEvaluation lookup without ObtainEmpireEvaluation's insert (the UI must not add sim records).
    const evaluation = empireEvaluationByEmpire(empireEvaluationsOf(other), player);
    const attitude = evaluation !== null ? evaluation.overallAttitude : 0.0;
    try {
        playEventSting(diplomacyMoodFile(other.pirateEmpireBaseHabitat !== null, other.reclusive, attitude));
    } catch {
        // no audio
    }
    // [rimatmo-wiring] begin — 19i item 10: a faint static burst under the mood sting when `other`'s capital sits
    // in the fog band (no camera at this call site — messagePopups.ts opens the dialog outside the Main View — so
    // only the capital side of "camera or capital" applies here).
    try {
        const gain = rimVoiceStaticGain(0, rimWeightAtCapital(galaxy, other), scenarioParam(galaxy, 'staticGain', 0.25));
        playRimVoiceStaticBurst(gain);
    } catch {
        // no audio
    }
    // [rimatmo-wiring] end
}

/** A player order (orderMenu performAction): the investigate stings of Main.Part7.cs:504 / 515. */
export function playOrderSting(galaxy: Galaxy, empire: Empire, selected: unknown, action: ShipAction): void {
    const s = investigateSting(galaxy, empire, selected, action);
    if (s === null) return;
    try {
        playEventSting(s.file, s.maximum ? 1.0 : undefined);
    } catch {
        // no audio
    }
}

/** Main.Part4.cs:465 method_522: an event / talk window closed. */
export function closeEventSting(): void {
    try {
        eventStingClosed();
    } catch {
        // no audio
    }
}

export interface GameAudioDeps {
    galaxy: Galaxy;
    camera: SoundView;
    /** GalaxyTime: paused flag and CurrentStarDate. */
    time: { paused: boolean; currentStarDate: number };
    /** SuppressAllPopups (messageRouting options). */
    suppressAllPopups: () => boolean;
    /** The Main View's selected ship (19i hull creaks prefer it over the nearest own ship). */
    selectedShip?: () => BuiltObject | null;
    /**
     * `galaxy` is the main thread's read-only replica of a game simulated in the worker (docs/sim-worker.md): the
     * played-sound marks are kept render-side (mainViewSounds.ts ReplicaSoundMarks) instead of on the sim's flags.
     * Default: whether the galaxy's player commands go to a remote sink (simworker/clientCore.ts sets one on its replica).
     */
    replica?: boolean;
}

export interface GameAudio {
    /** Once per rendered frame, after view.update(). */
    frame(): void;
    dispose(): void;
}

/**
 * [simworker] The Main View sound pass's played-marks for `galaxy`: the sim's own flags in-thread, render-side marks on
 * a sim-worker replica (a flag written there would never reach the worker, and the sync would never re-arm it).
 * `replica` defaults to whether the galaxy's commands go to a remote sink (simworker/clientCore.ts sets one).
 */
export function soundMarksFor(galaxy: Galaxy, replica: boolean = hasRemoteCommandSink(galaxy)): SoundMarks {
    return replica ? new ReplicaSoundMarks() : simFlagSoundMarks;
}

/** Wire the running game's audio; returns the per-frame hook and the teardown. */
export function installGameAudio(deps: GameAudioDeps): GameAudio {
    const { galaxy, camera, time } = deps;
    const session = startEffects();
    const sounds = new MainViewSounds(session.player, undefined, soundMarksFor(galaxy, deps.replica));
    // EffectsPlayer.DX.cs:107 Initialize: preload ResolveWeaponSoundEffectFilenames(ComponentDefinitionsStatic) + explosions.
    const weaponFiles = new Set<string>();
    for (const c of galaxy.researchStatic?.componentsById.values() ?? []) {
        const f = (c as { soundEffectFilename?: string }).soundEffectFilename;
        if (f) weaponFiles.add(f);
    }
    void session.player.preload([...weaponFiles]);
    // EffectsPlayer.DX.cs:107 Initialize: preload ComponentDefinitionList.ResolveWeaponSoundEffectFilenames + explosions.
    const weaponSounds = new Set<string>();
    for (const c of galaxy.researchStatic?.componentsById.values() ?? []) {
        if (c.soundEffectFilename !== undefined && c.soundEffectFilename !== '') weaponSounds.add(c.soundEffectFilename);
    }
    void session.player.preload([...weaponSounds]);
    // Main.Part12.cs:2918: the game view opens → musicPlayer_0.ForceSwitch().
    try {
        musicGameStarted();
    } catch {
        // no audio
    }
    // Empire.EventMessageRecipient (Main implements IEventMessageRecipient, Main.Part4.cs:481).
    const player = galaxy.playerEmpire;
    const previousRecipient = player?.eventMessageRecipient ?? null;
    // Non-enumerable while installed: a UI callback, not game state (serializeGame walks the empire's own keys).
    const setRecipient = (value: Empire['eventMessageRecipient'], enumerable: boolean): void => {
        if (player !== null) Object.defineProperty(player, 'eventMessageRecipient', { value, writable: true, configurable: true, enumerable });
    };
    if (player !== null) {
        setRecipient({
            receiveEventMessage(type, title, message, additionalData, location) {
                previousRecipient?.receiveEventMessage(type, title, message, additionalData, location);
                try {
                    const file = eventStingFile(type as EventMessageType, additionalData, deps.suppressAllPopups(), stingPlayer().isPlaying);
                    if (file !== null) playEventSting(file);
                } catch {
                    // no audio
                }
            },
        }, false);
    }
    // [rimatmo-wiring] begin — 19i item 9: one ambient bed per game view, gain updated every frame.
    // [rimatmo-audio] The bed, the creature calls and the hull creaks share one lazily-created AudioContext (none is
    // created with the flag off), closed with the game view.
    let rimCtx: AudioContext | null = null;
    const rimContext = (): AudioContext => (rimCtx ??= new AudioContext());
    const rimAmbient = new RimAmbientBed(rimContext);
    const rimCreatures = new RimCreatureAudio({
        galaxy,
        view: camera,
        selectedShip: deps.selectedShip ?? (() => null),
        effectsVolume: () => session.player.volume,
        context: rimContext,
    });
    // [rimatmo-wiring] end
    return {
        frame(): void {
            const r = sounds.collect(galaxy, camera, player, galaxy.nowMs, time.currentStarDate);
            for (const q of r.requests) session.request(q);
            session.flush();
            // [rimatmo-wiring] begin — 19i items 8/9: read the rim weight at the camera centre once per frame and
            // drive the music selector's mood pool + the wind/static ambient bed from it. No-op (weightAtCamera stays
            // 0, RimAmbientBed never creates an AudioContext, setRimMood's pool is ignored) with the flag off.
            try {
                const weightAtCamera = rimWeightAt(galaxy, camera.x, camera.y);
                musicPlayer().setRimMood(RIM_MOOD_TRACKS, rimMoodProbability(weightAtCamera, scenarioParam(galaxy, 'musicMoodWeight', 0.8)));
                rimAmbient.update(weightAtCamera, scenarioParam(galaxy, 'ambientGain', 0.35));
                rimCreatures.step(performance.now() / 1000, weightAtCamera); // [rimatmo-audio] calls + creaks
            } catch {
                // no audio
            }
            // [rimatmo-wiring] end
            if (r.ambientPlaying === null) return;
            try {
                const m = musicPlayer();
                const action = ambientMusicAction(
                    r.ambientPlaying,
                    1 / camera.zoom,
                    !time.paused,
                    { isPlaying: m.isPlaying, isInitiatingFade: m.isInitiatingFade, fadeTimerRunning: m.fadeTimerRunning, actualVolume: m.actualVolume },
                    stingPlayer().isPlaying,
                );
                if (action === 'fadePause') m.fadePause();
                else if (action === 'fadeResume') m.fadeResume();
            } catch {
                // no audio
            }
        },
        dispose(): void {
            setRecipient(previousRecipient, true);
            rimAmbient.dispose(); // [rimatmo-wiring] 19i item 9
            // [rimatmo-audio] tear the synth bus and the shared rim context down with the audio graph.
            rimCreatures.dispose();
            if (rimCtx !== null) void rimCtx.close().catch(() => undefined);
            rimCtx = null;
        },
    };
}
