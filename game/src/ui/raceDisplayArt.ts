// The portrait and flag an empire is shown with in the UI. Stock: the race portrait (images/units/races/race_<i>.png,
// races.txt PictureIndex — Main.Part13.cs ~2195) and the empire's flag shape tinted with its main colour (as the HUD's
// Empires button does). Scenario display overrides keyed by race name replace both — the 19a Concord's procedural
// mask portrait and flag (render/concordArt.ts raceDisplayOverride) — so the race files stay data.

import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import { flagShapeUrl } from '../sim/startGameOptions';
import { raceDisplayOverride } from '../render/concordArt';
import { colorHueRotate } from './hud';

export interface EmpireEmblem {
    portraitUrl: string | null;
    flagUrl: string | null;
    /** CSS filter for the flag image ('' = draw as is). */
    flagFilter: string;
}

export function empireEmblem(galaxy: Galaxy | null | undefined, empire: Empire): EmpireEmblem {
    const race = empire.dominantRace;
    const o = raceDisplayOverride(galaxy, race?.name);
    if (o !== null) return { portraitUrl: o.portraitUrl, flagUrl: o.flagUrl, flagFilter: '' };
    return {
        portraitUrl: race !== null ? `/assets/dwu/images/units/races/race_${race.pictureIndex}.png` : null,
        // A pirate faction's flagShape indexes the pirate shapes (a wizard pirate start): no stock flag here, as before.
        flagUrl: empire.flagShape >= 0 && empire.pirateEmpireBaseHabitat === null ? flagShapeUrl(empire.flagShape) : null,
        flagFilter: `sepia(1) saturate(4) hue-rotate(${colorHueRotate(empire.mainColor)}deg)`,
    };
}
