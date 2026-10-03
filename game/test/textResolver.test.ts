import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatNet, getText, loadText, resolveGameText } from '../src/sim/textResolver';
import { gameText } from '../src/sim/colonyTick';
import { EmpireMessage, EmpireMessageType } from '../src/sim/messages';
import type { Empire } from '../src/sim/empire';
import { formatEmpireMessage } from '../src/ui/empireMessageFeed';

// TextResolver.cs over the stock GameText.txt; the sim encodes `string.Format(TextResolver.GetText(tag), args)`
// as gameText(tag, ...args) = "tag|arg0|…" and the ticker resolves it.
beforeAll(() => {
    loadText(readFileSync(resolve(__dirname, '../public/assets/dwu/GameText.txt'), 'utf-8'));
});

describe('TextResolver (TextResolver.cs LoadText / GetText)', () => {
    it('reads tag;text pairs, trims, skips comments, turns \\n into newlines', () => {
        // GameText.txt 1356 "The SHIPTYPE NAME has been completed at LOCATION\t\t;The {0} '{1}' has been completed at {2}"
        expect(getText('The SHIPTYPE NAME has been completed at LOCATION')).toBe("The {0} '{1}' has been completed at {2}");
        // GameText.txt 293 contains "\n\n".
        expect(getText('Image too big')).toBe('Image too big: {0}\n\nEnsure that this image is no more than {1}Kb in size.\nPlease change the image and try again.');
        expect(getText('No such tag')).toBe("KEY NOT FOUND: 'No such tag'");
    });

    it('formatNet substitutes {n} in argument order', () => {
        expect(formatNet('{1} before {0}, {0} again', ['a', 'b'])).toBe('b before a, a again');
        expect(formatNet('{{literal}} {0}', [7])).toBe('{literal} 7');
        expect(formatNet('missing {1}', ['x'])).toBe('missing {1}');
    });
});

describe('resolveGameText (gameText encoding → C# text)', () => {
    it('ship completed (ConstructionQueue.cs 835)', () => {
        const s = gameText('The SHIPTYPE NAME has been completed at LOCATION', 'Frigate', 'Defender I', 'Sol III');
        expect(s).toBe('The SHIPTYPE NAME has been completed at LOCATION|Frigate|Defender I|Sol III');
        expect(resolveGameText(s)).toBe("The Frigate 'Defender I' has been completed at Sol III");
    });

    it('refuelling (BuiltObject.cs 5050) and stranded ship (two / three arguments)', () => {
        expect(resolveGameText(gameText('SHIPTYPE NAME requires refuelling', 'Escort', 'Swift'))).toBe('Escort Swift requires refuelling');
        expect(resolveGameText('Stranded Ship SHIPTYPE NAME SYSTEM|Frigate|Talon|Vega')).toBe(
            'Frigate Talon has been badly damaged and is stranded in the Vega system. Send a construction ship to repair it.',
        );
    });

    it('surplus arguments at the end are dropped, as string.Format ignores them (Empire.7.cs 3508)', () => {
        // "PreWarpProgressEvent Message BuildFirstMiningStation" uses {0} only; the sender also passes the planet name.
        const s = resolveGameText(gameText('PreWarpProgressEvent Message BuildFirstMiningStation', 'Ore Station Xylothar', 'Sol 2'));
        expect(s).toContain('Building Ore Station Xylothar has galvanized the resolve of our population');
        expect(s).not.toContain('|');
        expect(s).not.toContain('Sol 2');
    });

    it('concatenated texts, tag-only texts, literal prefixes and unknown text', () => {
        const s = gameText('SHIPTYPE NAME requires refuelling', 'Escort', 'Swift') + '\n\n' + gameText('SHIPTYPE NAME has completed its mission', 'Frigate', 'Talon');
        expect(resolveGameText(s)).toBe('Escort Swift requires refuelling\n\nFrigate Talon has completed its mission');
        expect(resolveGameText('Our ships: ' + gameText('SHIPTYPE NAME requires refuelling', 'Escort', 'Swift'))).toBe('Our ships: Escort Swift requires refuelling');
        // A tag whose template takes arguments is never an argument-less send: left as is (textkeys: no double resolution).
        expect(resolveGameText('X says')).toBe('X says');
        expect(resolveGameText('Pirate Offer Discovery')).toBe('We can share the location of an intriguing discovery');
        expect(resolveGameText('Frigate built')).toBe('Frigate built');
        expect(resolveGameText('Unknown tag|a|b')).toBe('Unknown tag|a|b');
    });
});

describe('formatEmpireMessage resolves the description', () => {
    const player = { name: 'Us', messages: [] } as unknown as Empire;
    const zorg = { name: 'Zorg', messages: [] } as unknown as Empire;
    function msg(sender: Empire | null, description: string): EmpireMessage {
        const m = new EmpireMessage(sender, EmpireMessageType.ShipBaseCompleted, null);
        m.description = description;
        return m;
    }

    it('player ticker text and the "X says" prefix (Main.Part9.cs 1041 method_250)', () => {
        const d = gameText('The SHIPTYPE NAME has been completed at LOCATION', 'Frigate', 'Defender I', 'Sol III');
        expect(formatEmpireMessage(msg(player, d), player)).toBe("The Frigate 'Defender I' has been completed at Sol III");
        expect(formatEmpireMessage(msg(zorg, gameText('SHIPTYPE NAME requires refuelling', 'Escort', 'Swift')), player)).toBe('Zorg says: Escort Swift requires refuelling');
    });
});

describe('textkeys: eager GetText and no double resolution', () => {
    it('an already resolved text that equals another key whose template takes arguments is not resolved again', () => {
        // Galaxy.cs 2901 GetText("Pirate Offer Contact Empire") = "We can put you in contact with another empire", itself the
        // key of "... for {0} credits" (Main.Part9.cs 109, the conversation option).
        const once = resolveGameText(gameText('Pirate Offer Contact Empire'));
        expect(once).toBe('We can put you in contact with another empire');
        expect(resolveGameText(once)).toBe(once);
    });

    it('diplomacyTick formatText(getText(tag), args) = string.Format(TextResolver.GetText(tag), args)', async () => {
        const { formatText, getText: simGetText } = await import('../src/sim/diplomacyTick');
        // GameText.txt: Build new ships for X credits ;Build new ships for {0} credits (EmpireConstruction advisor text).
        expect(formatText(simGetText('Build new ships for X credits'), '1,000')).toBe('Build new ships for 1,000 credits');
        expect(simGetText('No such tag')).toBe('No such tag');
    });
});
