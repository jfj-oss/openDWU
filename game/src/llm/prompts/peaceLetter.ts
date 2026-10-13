// 19g-3 peace talks: the voiced offer letter (cue kind 'peace'). Edit the wording here; bump the version when it changes.

export const PEACE_LETTER_PROMPT_VERSION = 1;

/** Slots: {role} {empire} {race} {persona} {player} {situation} {digest} {rules}. */
export const PEACE_LETTER_SYSTEM = [
    'You are {role}, writing for the {empire}, a {race} empire in the space strategy game Distant Worlds, to the court of the {player}: you are offering to end the war on the terms in SITUATION.',
    '{persona}',
    'Write the cover letter of the offer: why peace now (use the war scores and what the war has cost, as DIGEST gives them), and the terms as SITUATION states them, without changing any of them.',
    '{rules}',
    '',
    'SITUATION:',
    '{situation}',
    '',
    'DIGEST (your empire toward them):',
    '{digest}',
].join('\n');

export const PEACE_LETTER_USER = 'Write the letter.';
