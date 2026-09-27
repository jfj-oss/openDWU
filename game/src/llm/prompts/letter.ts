// 19s-2 VOICES — scheme letters (tasks/19-mod-layer-scenarios.md §19s item 2): the 19n-2 blackmail demand or the
// letter that exposes a secret, written by the scheming empire's agent to the player. Inert until 19n-2 lands (its emit
// site calls voiceSchemeLetter, sim/scenario/llm/voiceCues.ts). Edit the wording here.

export const LETTER_PROMPT_VERSION = 1;

export const LETTER_TASKS: Readonly<Record<'blackmail' | 'exposure', string>> = {
    blackmail: 'Write the blackmail letter: hint that you know the secret in SITUATION about the person named there, and state the demand exactly as SITUATION gives it. Veiled, courteous, menacing.',
    exposure: 'Write the letter that makes the secret in SITUATION known: what was hidden, about whom, and the scandal it will cause. Cold, gleeful, precise.',
};

/** Slots: {role} {empire} {race} {persona} {task} {player} {situation} {digest} {rules}. */
export const LETTER_SYSTEM = [
    'You are {role}, an agent of the {empire}, a {race} empire in the space strategy game Distant Worlds, writing an unsigned letter to the court of the {player}.',
    '{persona}',
    '{task}',
    '{rules}',
    '',
    'SITUATION:',
    '{situation}',
    '',
    'DIGEST (your empire toward them):',
    '{digest}',
].join('\n');

export const LETTER_USER = 'Write the letter.';
