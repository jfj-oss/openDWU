// 19r capture gallery (render-only, dev flag `?artGallery=<view>`): a screen-space board over the map drawn with the
// same generators / overlay classes the layers use, for the 4K captures (scripts/art-bundle-shots.mjs). Views:
//   damage    a cruiser at 100 % undamaged / damaged (+ ×5 insets showing the drawn-pixel clusters), damageFx on,
//             a damaged fighter and creatures (original Kaltor frame, a 19g-7b rig body)
//   liveries  six ships of different empires (new → heavily withered + storm scars, and a pirate)
//   threats   the seven threat markers, suspected and confirmed
//   flags     a parent flag / portrait and the company, seceded, exile and Ghost Armada derivations
//   herders   Teekan vs the hooded Ossuvan portrait, the herd flag, a station with camp props
// Nothing here touches the sim: stand-in objects are plain records, the galaxy is only read for real empires.

import { Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { Galaxy } from '../sim/galaxy';
import type { Empire } from '../sim/empire';
import type { BuiltObject } from '../sim/builtObject';
import { BuiltObjectSubRole } from '../sim/builtObjectTypes';
import { DesignImageScalingMode } from '../sim/data/designSpecifications';
import { CreatureType } from '../sim/creature';
import { flagShapeUrl } from '../sim/startGameOptions';
import { galaxyStarDate } from '../sim/tick/simTime';
import { builtObjectImageUrl, builtObjectSizePx } from './builtObjectLayer';
import { loadShipArt, type ShipArt } from './shipArt';
import { DamageOverlays, fighterDamageSubject, shipDamageSubject, textureFromPixels } from './shipOverlays';
import { fighterImageUrl, fighterSizePx } from './fighterLayer';
import { CREATURE_LOADED_SIDE, RIG_CONTENT_FRAC } from './creatureLayer';
import { buildDamageLayer, creatureDamageBudget, creatureDamageColour, damageOverlaySide, rotatedFrameMask, scaledMask } from './damageOverlay';
import { LiveryOverlays } from './liveryLayer';
import { familyPictureRef } from './wreckDebris';
import { KNOWLEDGE_CONFIRMED, KNOWLEDGE_SUSPECTED, THREAT_MARKER_KINDS, drawThreatMarker, threatMarkerStyle } from './threatMarkers';
import {
    companyFlag,
    composeEmpireFlag,
    corporatePortrait,
    exileFlag,
    exilePortrait,
    ghostFlag,
    ghostPortrait,
    herderCampRgba,
    herderFlag,
    herderPortrait,
    secededFlag,
    secededPortrait,
    type RgbaImage,
} from './emblemArt';
import { loadRgba, racePortraitUrl } from '../ui/empireEmblem';
import { FaunaArt } from './faunaArt';
import { CreatureRig } from './creatureRig';

export type ArtGalleryView = 'damage' | 'liveries' | 'threats' | 'flags' | 'herders';

export function artGalleryView(search: string): ArtGalleryView | null {
    const v = new URLSearchParams(search).get('artGallery');
    return v === 'damage' || v === 'liveries' || v === 'threats' || v === 'flags' || v === 'herders' ? v : null;
}

function tex(img: RgbaImage, nearest = false): Texture {
    return textureFromPixels(img.data, img.w, img.h, nearest);
}

let standInId = 800000;

export class ArtBundleGallery {
    readonly root = new Container();
    ready = false;
    private bg = new Graphics();
    private board = new Container();
    private tick: ((t: number) => void)[] = [];
    notes: string[] = [];

    constructor(
        private galaxy: Galaxy,
        stage: Container,
        private w: number,
        private h: number,
        readonly view: ArtGalleryView,
    ) {
        this.root.addChild(this.bg, this.board);
        this.bg.rect(0, 0, w, h).fill({ color: 0x06080c });
        stage.addChild(this.root);
        const build = { damage: () => this.buildDamage(), liveries: () => this.buildLiveries(), threats: () => this.buildThreats(), flags: () => this.buildFlags(), herders: () => this.buildHerders() }[view];
        build()
            .then(() => (this.ready = true))
            .catch((e: unknown) => {
                console.warn('[artGallery]', e);
                this.ready = true;
            });
    }

    /** Updates run (captures). */
    frames = 0;

    update(): void {
        this.frames++;
        const t = performance.now() / 1000;
        for (const f of this.tick) f(t);
    }

    private label(text: string, x: number, y: number, size = 18, colour = 0xd8d4c8, parent: Container = this.board): Text {
        const l = new Text({ text, style: { fontFamily: 'sans-serif', fontSize: size, fill: colour } });
        l.anchor.set(0.5, 0);
        l.position.set(x, y);
        parent.addChild(l);
        return l;
    }

    private async shipArt(pictureRef: number): Promise<ShipArt> {
        const url = builtObjectImageUrl(pictureRef);
        const art = url === null ? null : await loadShipArt(url);
        if (art === null) throw new Error(`no art for pictureRef ${pictureRef}`);
        return art;
    }

    /** A ship sprite drawn like the ship layer: raw art at heading + 90°, anchored on the crop centre, `px` wide. */
    private shipSprite(art: ShipArt, x: number, y: number, px: number, heading: number, parent: Container = this.board): Sprite {
        const s = new Sprite(art.texture);
        s.anchor.set(art.metrics.cropCenterX / art.texture.width, art.metrics.cropCenterY / art.texture.height);
        s.position.set(x, y);
        s.rotation = heading + Math.PI / 2;
        s.scale.set(px / art.metrics.cropSide);
        parent.addChild(s);
        return s;
    }

    // -----------------------------------------------------------------------------------------------------------
    private async buildDamage(): Promise<void> {
        const W = this.w;
        this.label('19r damage overlay — base game (method_106 / 107 / 108 / 113)', W / 2, 18, 26);
        const cruiser = await this.shipArt(familyPictureRef(3, BuiltObjectSubRole.Cruiser));
        const fighterUrl = fighterImageUrl(0);
        const fighter = fighterUrl === null ? null : await loadShipArt(fighterUrl, false);
        const size = 450;
        const px = builtObjectSizePx(size, cruiser.metrics.areaRatio, 1, DesignImageScalingMode.None, 1);
        const layerA = new Container();
        const layerB = new Container();
        this.board.addChild(layerA, layerB);
        const dmg = new DamageOverlays<object>(layerB);
        const hurt = { builtObjectID: 4711, damagedComponentCount: 9, components: { items: new Array(20).fill(0) } };
        const subj = shipDamageSubject(hurt)!;
        const hurtFx0 = { builtObjectID: 4712, damagedComponentCount: 4, components: { items: new Array(20).fill(0) } };
        const hurtFx1 = { ...hurtFx0, damagedComponentCount: 10 };
        const fSub = fighter === null ? null : fighterDamageSubject({ fighterID: 99, health: 0.35 });
        const fpx = fighter === null ? 0 : fighterSizePx(20, fighter.metrics.areaRatio, 1);
        // Row 1: at 100 % (true drawn size).
        const y1 = 150;
        this.label(`cruiser at 100 % (${px} px): undamaged · damaged 45 % · damageFx on`, W * 0.3, 70, 18);
        this.shipSprite(cruiser, W * 0.15, y1, px, -0.3, layerA);
        this.shipSprite(cruiser, W * 0.3, y1, px, -0.3, layerA);
        this.shipSprite(cruiser, W * 0.45, y1, px, -0.3, layerA);
        // Row 2: the same ×5 (the overlay is built at the drawn size, so the clusters show their true pixels).
        const k = 5;
        const y2 = 470;
        this.label('×5 — the clusters are drawn pixels (cross hatch grey 160 over near-black, clipped to the hull)', W * 0.3, 250, 18);
        this.shipSprite(cruiser, W * 0.12, y2, px * k, -0.3, layerA);
        this.shipSprite(cruiser, W * 0.3, y2, px * k, -0.3, layerA);
        this.shipSprite(cruiser, W * 0.48, y2, px * k, -0.3, layerA);
        let fxKey: object = {};
        let fxAt = 0;
        const creature = await this.creatureSamples(layerA, layerB);
        this.tick.push((t) => {
            dmg.begin();
            dmg.draw(hurt, subj, cruiser, W * 0.3, y1, -0.3, px, 1, false);
            dmg.draw(hurt, subj, cruiser, W * 0.3, y2, -0.3, px, 1 / k, false);
            // damageFx: a fresh hit every 3 s (a new key drawn once at the lower damage, then the higher).
            if (t - fxAt > 3) {
                fxKey = {};
                fxAt = t;
                dmg.draw(fxKey, shipDamageSubject(hurtFx0)!, cruiser, -9999, -9999, 0, px, 1, true);
            }
            const s1 = shipDamageSubject(hurtFx1)!;
            dmg.draw(fxKey, s1, cruiser, W * 0.45, y1, -0.3, px, 1, true);
            dmg.draw(fxKey, s1, cruiser, W * 0.48, y2, -0.3, px, 1 / k, true);
            if (fighter !== null && fSub !== null) {
                dmg.draw(fighter, fSub, fighter, W * 0.7, y1, -0.3, fpx, 1, false);
                dmg.draw(fighter, fSub, fighter, W * 0.7, y2 - 60, -0.3, fpx, 1 / 8, false);
            }
            dmg.end();
            creature(t);
        });
        if (fighter !== null) {
            this.label(`fighter, Health 0.35 (${fpx} px, ×8 below)`, W * 0.7, 70, 18);
            this.shipSprite(fighter, W * 0.64, y1, fpx, -0.3, layerA);
            this.shipSprite(fighter, W * 0.7, y1, fpx, -0.3, layerA);
            this.shipSprite(fighter, W * 0.7, y2 - 60, fpx * 8, -0.3, layerA);
        }
    }

    /** Kaltor (original frame, method_108 flesh colour) and a rig body with the damage rope. */
    private async creatureSamples(layerA: Container, layerB: Container): Promise<(t: number) => void> {
        const W = this.w;
        const y = 860;
        this.label('creatures, Damage 60 % of DamageKillThreshhold: Kaltor frame (×3) · 19g-7b rig body', W * 0.75, 700, 18);
        const url = '/assets/dwu/images/units/creatures/kaltor/Kaltor_00000.png';
        const px = await loadRgba(url);
        if (px !== null) {
            const c = document.createElement('canvas');
            c.width = px.w;
            c.height = px.h;
            const ctx = c.getContext('2d', { willReadFrequently: true })!;
            ctx.putImageData(new ImageData(new Uint8ClampedArray(px.data), px.w, px.h), 0, 0);
            const small = document.createElement('canvas');
            small.width = CREATURE_LOADED_SIDE;
            small.height = CREATURE_LOADED_SIDE;
            const sctx = small.getContext('2d', { willReadFrequently: true })!;
            sctx.drawImage(c, 0, 0, px.w, px.h, 0, 0, CREATURE_LOADED_SIDE, CREATURE_LOADED_SIDE);
            const loaded = sctx.getImageData(0, 0, CREATURE_LOADED_SIDE, CREATURE_LOADED_SIDE).data;
            const frame = textureFromPixels(px.data, px.w, px.h, false);
            const drawn = 100;
            const side = damageOverlaySide(drawn);
            const hull = rotatedFrameMask(loaded, CREATURE_LOADED_SIDE, side);
            const layer = buildDamageLayer(4242, side, side, creatureDamageBudget(side, side, 60, 100), hull, { kind: 'solid', rgb: creatureDamageColour(CreatureType.Kaltor)! });
            const ot = textureFromPixels(layer.rgba, side, side, true);
            let hullN = 0;
            for (const v of hull) hullN += v;
            this.notes.push(`kaltor overlay ${side}px: hull ${hullN}, painted ${layer.painted} px in ${layer.clusters.length} clusters`);
            for (const [x, dmg] of [
                [W * 0.62, false],
                [W * 0.72, true],
            ] as const) {
                const s = new Sprite(frame);
                s.anchor.set(0.5);
                s.position.set(x, y);
                s.rotation = -0.4 + Math.PI / 2;
                s.scale.set((drawn * 3) / 360);
                layerA.addChild(s);
                if (dmg) {
                    const o = new Sprite(ot);
                    o.anchor.set(0.5);
                    o.position.set(x, y);
                    o.rotation = -0.4;
                    o.scale.set((drawn * 3) / side);
                    layerB.addChild(o);
                }
            }
        } else this.notes.push('Kaltor frame missing');
        const art = new FaunaArt(true);
        const t0 = performance.now();
        while (!art.ready && performance.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 100));
        const body = art.body('whale') ?? art.body('hunter');
        if (body === null) {
            this.notes.push('rig body unavailable');
            return () => undefined;
        }
        const rig = new CreatureRig(body, 0.3);
        const drawnPx = 360;
        const img = rig.bodyImage;
        const w = damageOverlaySide(drawnPx * RIG_CONTENT_FRAC);
        const h = Math.max(4, Math.round((w * img.h) / img.w));
        const hull = scaledMask(img.data, img.w, img.h, w, h);
        const layer = buildDamageLayer(5151, w, h, creatureDamageBudget(w, h, 60, 100), hull, { kind: 'solid', rgb: creatureDamageColour(CreatureType.Kaltor)! });
        rig.setDamage(textureFromPixels(layer.rgba, w, h, true));
        this.notes.push(`rig overlay ${w}x${h}: painted ${layer.painted}`);
        rig.root.position.set(W * 0.88, y);
        rig.root.rotation = -0.2;
        rig.root.scale.set((drawnPx * RIG_CONTENT_FRAC) / rig.length);
        layerA.addChild(rig.root);
        return (t) => rig.pose(t, 1);
    }

    // -----------------------------------------------------------------------------------------------------------
    private async buildLiveries(): Promise<void> {
        const W = this.w;
        this.label('19r liveries + withered look (tint band, emblem decal, hull number; age since build / retrofit / long repair)', W / 2, 14, 24);
        const g = this.galaxy;
        const real = g.empires.filter((e): e is Empire => e !== null && e !== g.independentEmpire && e.pirateEmpireBaseHabitat === null);
        const pirate = g.pirateEmpires[0] ?? null;
        const fake = (i: number, main: number, sec: number, pirateBase = false): Empire =>
            ({ empireId: 700 + i, name: `Empire ${i}`, mainColor: main, secondaryColor: sec, flagShape: i * 3, pirateEmpireBaseHabitat: pirateBase ? {} : null }) as unknown as Empire;
        const empires: Empire[] = [];
        const palette = [
            [0xc03028, 0xf0e0a0],
            [0x2860c0, 0xe0e8f0],
            [0x30a050, 0xf0f0d0],
            [0xd0a020, 0x302010],
            [0x9040c0, 0xe0d0f0],
        ];
        for (let i = 0; i < 5; i++) empires.push(real[i] ?? fake(i, palette[i][0], palette[i][1]));
        empires.push(pirate ?? fake(9, 0x802020, 0x202020, true));
        const ships: { family: number; role: BuiltObjectSubRole; level?: number; scars?: number; note: string }[] = [
            { family: 3, role: BuiltObjectSubRole.Cruiser, level: 0, note: 'new (level 0)' },
            { family: 7, role: BuiltObjectSubRole.Destroyer, level: 0.25, note: 'level 0.25' },
            { family: 11, role: BuiltObjectSubRole.CapitalShip, level: 0.5, note: 'level 0.5' },
            { family: 15, role: BuiltObjectSubRole.Frigate, level: 0.75, note: 'level 0.75' },
            { family: 20, role: BuiltObjectSubRole.Cruiser, level: 1, scars: 3, note: 'heavily withered + 3 storm scars' },
            { family: 24, role: BuiltObjectSubRole.Destroyer, note: 'pirate (starts withered, floor 0.7)' },
        ];
        const layerA = new Container();
        const layerB = new Container();
        this.board.addChild(layerA, layerB);
        const liv = new LiveryOverlays(layerB, g);
        const now = galaxyStarDate(g);
        const items: { bo: BuiltObject; art: ShipArt; px: number }[] = [];
        for (let i = 0; i < ships.length; i++) {
            const sp = ships[i];
            const art = await this.shipArt(familyPictureRef(sp.family, sp.role));
            const col = i % 3;
            const row = Math.floor(i / 3);
            const x = W * (0.18 + col * 0.32);
            const y = 300 + row * 470;
            const px = 380;
            const bo = {
                empire: empires[i],
                xpos: x,
                ypos: y,
                heading: -0.25,
                builtObjectID: 1000 + i * 37,
                dateBuilt: now,
                dateRetrofit: now,
                subRole: sp.role,
                damagedComponentCount: 0,
                components: { items: [] },
                lastLocationEffectTouch: 0,
                locationEffects: [],
            } as unknown as BuiltObject;
            if (sp.level !== undefined) liv.forced.set(bo, { level: sp.level, scars: sp.scars ?? 0 });
            this.shipSprite(art, x, y, px, bo.heading, layerA);
            // The same ship unpainted, small, for comparison.
            this.shipSprite(art, x - px * 0.62, y + px * 0.4, px * 0.3, bo.heading, layerA);
            items.push({ bo, art, px });
            this.label(`${empires[i].name} — ${sp.note}`, x, y + px * 0.52, 18);
        }
        const drawAll = (): void => {
            liv.begin();
            for (const it of items) liv.draw(it.bo, it.art, it.px, 1, 1);
            liv.end();
        };
        // Build every analysis / texture now (the layer spreads them over frames; the capture machine is slow).
        for (let k = 0; k < 12; k++) drawAll();
        for (const it of items) {
            const an = liv.analysisOf(it.art);
            this.notes.push(
                `${it.bo.empire?.name} main #${(it.bo.empire?.mainColor ?? 0).toString(16)} level ${liv.levelOf(it.bo).toFixed(2)} ` +
                    (an === null ? 'no analysis' : `L ${an.length} band ${an.band.x0}-${an.band.x1} decal r ${an.decal.r.toFixed(1)} number h ${an.number.h}`),
            );
        }
        this.tick.push(drawAll);
    }

    // -----------------------------------------------------------------------------------------------------------
    private async buildThreats(): Promise<void> {
        const W = this.w;
        this.label('19r threat site markers — suspected (top, uncertain) and confirmed (bottom, solid)', W / 2, 16, 24);
        const g = new Graphics();
        this.board.addChild(g);
        const keys = Object.keys(THREAT_MARKER_KINDS);
        const names: Record<string, string> = {
            greyTide: 'Grey Tide nest',
            cult: 'cult world',
            silence: 'Silence source',
            doppelgangers: 'sleeper ship',
            hive: 'Hive world',
            darkFarms: 'Dark Farm',
            exchange: 'Exchange station',
        };
        const ship = new Set(['doppelgangers', 'exchange']);
        const cells: { key: string; x: number; y: number; level: number }[] = [];
        keys.forEach((key, i) => {
            const x = W * ((i + 0.5) / keys.length);
            for (const [row, level] of [
                [0, KNOWLEDGE_SUSPECTED],
                [1, KNOWLEDGE_CONFIRMED],
            ] as const) {
                const y = 330 + row * 440;
                cells.push({ key, x, y, level });
                this.label(`${names[key] ?? key} (${level >= KNOWLEDGE_CONFIRMED ? 'confirmed' : 'suspected'})`, x, y + 150, 17);
            }
        });
        this.tick.push((t) => {
            g.clear();
            for (const c of cells) {
                const kind = ship.has(c.key) ? 'ship' : 'colony';
                if (kind === 'colony') g.circle(c.x, c.y, 40).fill({ color: 0x4a5a6a });
                else g.moveTo(c.x + 22, c.y).lineTo(c.x - 14, c.y - 12).lineTo(c.x - 8, c.y).lineTo(c.x - 14, c.y + 12).closePath().fill({ color: 0x8a96a6 });
                const st = threatMarkerStyle(c.key, c.level, kind)!;
                drawThreatMarker(g, st, c.x, c.y, kind === 'ship' ? 60 : 78, 1, t, c.x);
            }
        });
    }

    // -----------------------------------------------------------------------------------------------------------
    private async buildFlags(): Promise<void> {
        const W = this.w;
        this.label('19r derived flags / portraits (parent → company · seceded · exile · Ghost Armada)', W / 2, 16, 24);
        const g = this.galaxy;
        const parent = g.empires.find((e): e is Empire => e !== null && e.flagShape >= 0 && e.dominantRace !== null) ?? null;
        const shapeIdx = parent?.flagShape ?? 7;
        const main = parent?.mainColor ?? 0x2860c0;
        const sec = parent?.secondaryColor ?? 0xf0e0a0;
        const pic = parent?.dominantRace?.pictureIndex ?? 3;
        const shape = await loadRgba(flagShapeUrl(shapeIdx));
        const portrait = await loadRgba(racePortraitUrl(pic));
        const base = composeEmpireFlag(shape, main, sec);
        const cMain = 0x30a050;
        const cSec = 0xf0f0d0;
        const flags: [string, RgbaImage, RgbaImage | null][] = [
            [`parent: ${parent?.name ?? 'stock'}`, base, portrait],
            ['company (founder flag + seal)', companyFlag(base, cMain, cSec), portrait && corporatePortrait(portrait, cMain)],
            ['seceded state (torn, recoloured)', secededFlag(shape, 0xb03030, 0xf0d890, 5), portrait && secededPortrait(portrait, 0xb03030, 5)],
            ['government in exile (black border)', exileFlag(base), portrait && exilePortrait(portrait)],
            ['Ghost Armada (desaturated + skull)', ghostFlag(base), portrait && ghostPortrait(portrait)],
        ];
        flags.forEach(([name, flag, por], i) => {
            const x = W * ((i + 0.5) / flags.length);
            const f = new Sprite(tex(flag));
            f.anchor.set(0.5);
            f.position.set(x, 250);
            f.scale.set(3);
            this.board.addChild(f);
            if (por !== null) {
                const p = new Sprite(tex(por));
                p.anchor.set(0.5);
                p.position.set(x, 640);
                p.scale.set(300 / por.w);
                this.board.addChild(p);
            }
            this.label(name, x, 830, 18);
        });
    }

    // -----------------------------------------------------------------------------------------------------------
    private async buildHerders(): Promise<void> {
        const W = this.w;
        this.label('19r herder identity — Ossuvan (BasedOn teekan): portrait, flag, camp props over a herder station', W / 2, 16, 24);
        const teekanPic = this.galaxy.races?.find?.((r: { name: string }) => r.name === 'Teekan')?.pictureIndex ?? 11;
        const portrait = await loadRgba(racePortraitUrl(teekanPic));
        if (portrait !== null) {
            for (const [x, img, name] of [
                [W * 0.12, portrait, 'Teekan (stock)'],
                [W * 0.32, herderPortrait(portrait), 'Ossuvan (hooded frame)'],
            ] as const) {
                const s = new Sprite(tex(img));
                s.anchor.set(0.5);
                s.position.set(x, 330);
                s.scale.set(340 / img.w);
                this.board.addChild(s);
                this.label(name, x, 520, 18);
            }
        } else this.notes.push('Teekan portrait missing');
        const flag = new Sprite(tex(herderFlag()));
        flag.anchor.set(0.5);
        flag.position.set(W * 0.22, 760);
        flag.scale.set(3.4);
        this.board.addChild(flag);
        this.label('herd flag', W * 0.22, 880, 18);
        const station = await this.shipArt(familyPictureRef(9, BuiltObjectSubRole.MediumSpacePort));
        const camp = tex(herderCampRgba(256, 19));
        for (const [x, props, name] of [
            [W * 0.55, false, 'herder port (stock art)'],
            [W * 0.82, true, 'with tents and pens'],
        ] as const) {
            const px = 480;
            this.shipSprite(station, x, 520, px, 0.3);
            if (props) {
                const s = new Sprite(camp);
                s.anchor.set(0.5);
                s.position.set(x, 520);
                s.rotation = 0.3;
                s.scale.set((px * 0.95) / 256);
                this.board.addChild(s);
            }
            this.label(name, x, 800, 18);
        }
    }
}
