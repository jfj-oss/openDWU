#!/usr/bin/env python3
"""Giantworks art (the Great Work add-on, Galactic Threats): the shared construction scaffold in four stages and the
finished wonders, kitbashed from stock DW:U frames plus procedural parts. Offline build step; the outputs are our
derived art, committed under public/art/giantworks/ (src/render/threatArt.ts draws them for a Great Work site's base,
picked by its stage and, once complete, its wonder), plus the light table src/render/giantworksLights.ts (frame px of
the blinking nav lights, work lights and neon the runtime layers light up).

    python3 -I scripts/giantworks-art.py [--dwu <DW:U install>] [--out public/art/giantworks]
        [--lights src/render/giantworksLights.ts] [--preview <dir>] [--only scaffold_0,casino]

--only builds just those frames; the light table keeps the other frames' rows (and the casino tables unless the
casino is built) from the file already there.

Reads images/units/ships/family*/<file>.png and images/units/ships/other/... from the install (default
public/assets/dwu, the symlink npm run import-assets makes). Needs Python 3 with numpy and Pillow only. Deterministic
(fixed seeds per output).

Every frame is square (FRAME px), built at SS x and downsampled sharp (Lanczos on premultiplied colour, a light unsharp
mask): stock pieces keep their hand-painted detail (placed at <= 1 stock px per output px, so the detail is at least
as dense as a stock station's), the procedural parts (lattice girders, ring trusses, cranes, pylons, radiators, the
glass sphere) are drawn crisp at the build resolution. Pieces are layered back to front, each casting a soft contact
shadow on what lies under it; materials are painted from the levelled shading through per-material ramps (steel,
dark steel, construction yellow, gold, white enamel, machine gunmetal, rock) or keep the stock piece's native colour.
Lights are emission (lit windows, work lamps, neon) added over the paint. Every frame carries two near-transparent
registration pixels in opposite corners so the game's crop square (builtObjectLayer.ts shipImageMetrics) is the whole
texture: all frames of a site share one centre and one world size per px, whatever their content.

The frames:
- scaffold_0..3: the Great Work under construction, one shared kit for every wonder (the silhouette never tells which
  wonder it will be). Built once as a list of tagged parts and replayed per stage, so each stage holds the last one
  plus what was added: 0 Foundations (the construction yard hub, six bare spoke girders out to six anchoring pylons
  sunk in captured asteroids, girder stacks, freight and cranes, cleared asteroids towed into the yard, the first arc
  of the foundation ring), 1 Frame (the outer
  frame ring closing - one gap left - with its gantry cranes, the inner ring, bracing), 2 Superstructure (dense
  scaffold packed round the hub and thinning outward, partial plating, lit work zones), 3 Fitting (most of the shell
  plated, fresh panels going on, the systems lighting up: window rows and running lights). Everything is one
  connected structure (any loose part is dropped).
- casino: the Gilded Orbit, a planet that is all casino, always at night. A super dense city on a sphere: about 10,000
  buildings (towers with setbacks, Y-shaped hotel towers, glass and gold domes, black pyramids, arcades, pool decks)
  in broad districts of gold, marble, red lacquer, black glass, flamingo pink and bronze, on a street grid of latitude
  rows (the roof detail is stock plating crops, 1 stock px per frame px). It is rendered as a height field: the city
  map (equirectangular, about a build px a texel) raymarched from the view (orthographic, coarse max-height steps,
  bisected hits), so towers stand out of the limb as a skyline and their walls show lit window floors, LED bands and
  crowns near it; shadow rays from the faint key light. No sun: the city's own light (sodium streets, windows,
  floodlit roofs, neon), the far side a little dimmer, a cool limb light on the near side and a pink / gold haze
  round it, a bloom of the lights, a broad gold grade. Set into it: the Strip and two more boulevards (great circles
  of traffic), two roulette arenas (the crown wheel floodlit, the night wheel glowing; each rotor drawn flat in its
  plane on the sphere), a docking port's lit shaft. On the limb (drawn over it): the CASINO marquee on the north
  skyline, a starburst on a short mast, two gold casino-front gates (tunnels of lit arches) and the High Roller
  observation wheel. Flat on dark rooftop pads: JACKPOT, the four card suits, a giant 7, dice, cherries, an arrow to
  the port. The neon is in the frame as unlit glass; casino-neon.png holds each piece lit (an atlas, one sprite per
  piece, each with its own behaviour: buzz / dying tube / fill-in sequence / blink); casino-rotor-main / -night and
  casino-wheel are the turning sprites; giantworksLights.ts gets the marquee bulbs and the GW_CASINO_* tables (the
  pieces, the rotors' planes, the wheel, the ship lanes and their fade with the distance from the centre). Built at
  its own 3x (PS) and downsampled like the rest. Dark back streets and unlit yards of low sheds along the districts'
  edges keep the value contrast; the gates' feet follow the sphere; the observation wheel stands mostly over it on a
  braced A-frame, its spokes lit.
- casino-pirate (+ -neon, -rotor-main): the same planet as a pirate den (the casino's smugglers' front found out,
  threatArt.ts casinoDens): the same city (same seeds) run down by decay_city (rust and soot, scorch marks with fires
  still burning, patched plating, collapsed and gutted towers, most windows and roof lights out, half the street lamps
  dead), tarnished materials (LOOKS: the build's look, ramp_c maps the materials), a dim dirty-sodium glow and a rust
  haze; the signs mostly dark (DEN_FATES: most tubes dead and cracked, a few failing, half lit or dying: CAS NO,
  J CKP T), most bulbs dead, one roulette rotor grinding round in fits, the other and the observation wheel stopped
  (laid in the frame, cabins missing), a thin trickle of ships.
- ultramind (+ ultramind-glow): the Ultramind standing alone, a dark planetoid wrapped in a machine shell: server
  blocks and lattice, white radiator fins, cyan data lights. ultramind-shell (+ ultramind-shell-glow) is the same
  shell as an overlay for the planet the site sits at (mainView.ts draws it over the planet's own picture, which shows
  through the gaps); ultramind-node (+ ultramind-node-glow) is the site's station then (a machine hub with
  radiators, drawn at half the size).
- sanctuary + sanctuary-front: the Leviathan Sanctuary, a glass sphere in a cage of structural struts: the base frame
  holds the outer equator ring and its docks, the back struts seen through the glass and the deep water-dark inside;
  the front frame (drawn over the runtime whales) holds the front struts, the glass rim and highlights.
"""
import argparse
import math
import os
import time
import zlib

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
LUM = np.array([0.299, 0.587, 0.114])
SS = 2            # build resolution multiple
FRAME = 720       # output frame side (px)
C0 = FRAME / 2    # frame centre (layout px)
F32 = np.float32

# ---------------------------------------------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------------------------------------------


def box1(v, r, axis):
    if r <= 0:
        return v
    k = 2 * r + 1
    p = np.pad(v, [(r, r) if a == axis else (0, 0) for a in range(v.ndim)], mode='constant')
    c = np.cumsum(p, axis=axis, dtype=np.float64)
    c = np.concatenate([np.zeros_like(np.take(c, [0], axis=axis)), c], axis=axis)
    n = v.shape[axis]
    return (np.take(c, np.arange(k, k + n), axis=axis) - np.take(c, np.arange(0, n), axis=axis)) / k


def fblur(v, sigma):
    """Gaussian-like blur (three box passes per axis) of a float image; zero outside."""
    if sigma <= 0:
        return v.astype(np.float64)
    r = max(1, int(round(math.sqrt(12 * sigma * sigma / 3 + 1) / 2 - 0.5)))
    v = v.astype(np.float64)
    for axis in (0, 1):
        for _ in range(3):
            v = box1(v, r, axis)
    return v


def value_noise(rng, h, w, cell):
    cell = max(1, int(cell))
    gw = max(2, int(np.ceil(w / cell)) + 3)
    gh = max(2, int(np.ceil(h / cell)) + 3)
    g = Image.fromarray((rng.random((gh, gw)) * 255).astype(np.uint8))
    big = np.asarray(g.resize((gw * cell, gh * cell), Image.BICUBIC)).astype(np.float64) / 255
    return big[cell:cell + h, cell:cell + w]


def fbm(rng, h, w, cell, octaves=3):
    v = np.zeros((h, w))
    amp, tot = 1.0, 0.0
    for _ in range(octaves):
        v += amp * value_noise(rng, h, w, max(1, cell))
        tot += amp
        amp *= 0.5
        cell = max(1, cell // 2)
    return v / tot


def shift(v, dy, dx):
    out = np.zeros_like(v)
    h, w = v.shape[:2]
    ys0, ys1 = max(0, dy), min(h, h + dy)
    xs0, xs1 = max(0, dx), min(w, w + dx)
    if ys1 > ys0 and xs1 > xs0:
        out[ys0:ys1, xs0:xs1] = v[ys0 - dy:ys1 - dy, xs0 - dx:xs1 - dx]
    return out


def dilate(mask, r):
    if r <= 0:
        return mask
    return np.asarray(Image.fromarray(mask.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(2 * r + 1))) > 0


def hsv(rgb):
    mx = rgb.max(2)
    mn = rgb.min(2)
    dl = np.maximum(mx - mn, 1e-6)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    hue = np.where(mx == r, ((g - b) / dl) % 6, np.where(mx == g, (b - r) / dl + 2, (r - g) / dl + 4)) / 6
    return hue, sat, mx


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def connected_to(seed, mask):
    """The part of `mask` 8-connected to `seed` (labelling by iterative constrained dilation, done coarse-to-fine)."""
    cur = seed & mask
    while True:
        nxt = dilate(cur, 3) & mask
        if nxt.sum() == cur.sum():
            break
        cur = nxt
    while True:
        nxt = dilate(cur, 1) & mask
        if nxt.sum() == cur.sum():
            return nxt
        cur = nxt


LIGHT = np.array([-0.42, -0.55, 0.72])
LIGHT = LIGHT / np.linalg.norm(LIGHT)


def shade(nx, ny, nz, amb=0.16, k=0.78, spec=0.14):
    d = np.clip(nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2], 0, 1)
    return amb + k * d + spec * d ** 14


def seeded(name):
    return np.random.default_rng(zlib.crc32(('giantworks:' + name).encode()))


# ---------------------------------------------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------------------------------------------

RX = np.array([0.0, 0.15, 0.35, 0.55, 0.75, 0.9, 1.0])
RAMPS = {
    # warm neutral steel (the scaffold, the yard)
    'steel': [[.024, .026, .031], [.085, .09, .1], [.19, .195, .205], [.33, .335, .34], [.49, .49, .485], [.65, .645, .63], [.82, .81, .78]],
    'dark': [[.012, .013, .016], [.04, .042, .048], [.085, .088, .095], [.15, .152, .158], [.24, .24, .24], [.34, .335, .33], [.46, .455, .44]],
    # construction yellow (crane booms, gantries, hazard bands)
    'yellow': [[.05, .035, .01], [.18, .115, .025], [.42, .28, .05], [.66, .47, .1], [.84, .66, .2], [.95, .8, .38], [1, .92, .62]],
    # gold (the Gilded Orbit)
    'gold': [[.04, .026, .008], [.17, .1, .025], [.42, .27, .07], [.68, .49, .15], [.88, .7, .3], [.98, .87, .55], [1, .97, .82]],
    # white enamel (radiators, the casino's clean decks)
    'white': [[.05, .055, .06], [.17, .18, .19], [.38, .39, .4], [.58, .59, .6], [.75, .76, .77], [.86, .87, .88], [.95, .96, .97]],
    # machine gunmetal with a blue cast (the Ultramind)
    'machine': [[.012, .016, .024], [.04, .052, .07], [.1, .12, .15], [.19, .215, .255], [.31, .345, .39], [.46, .5, .55], [.66, .72, .78]],
    # rock (the captured asteroids, the Ultramind's planetoid)
    'rock': [[.03, .026, .022], [.09, .075, .06], [.18, .15, .12], [.29, .25, .2], [.41, .36, .3], [.53, .48, .41], [.66, .61, .54]],
    # copper trims
    'copper': [[.04, .018, .01], [.14, .06, .03], [.3, .14, .07], [.5, .25, .12], [.7, .4, .2], [.86, .58, .34], [.97, .8, .6]],
    # casino red lacquer
    'red': [[.04, .005, .008], [.14, .015, .02], [.3, .03, .04], [.5, .06, .07], [.68, .12, .12], [.84, .25, .22], [.96, .5, .45]],
    # pale teal glass (frames of domes / the sphere)
    'glass': [[.01, .03, .04], [.03, .08, .1], [.07, .16, .19], [.13, .26, .3], [.22, .38, .43], [.36, .54, .58], [.6, .76, .8]],
}
RAMPS = {k: np.array(v) for k, v in RAMPS.items()}
MATS = tuple(RAMPS.keys()) + ('nat',)


def ramp(name, v):
    c = RAMPS[name]
    return np.stack([np.interp(v, RX, c[:, k]) for k in range(3)], axis=-1)


# ---------------------------------------------------------------------------------------------------------------
# Pieces and the canvas
# ---------------------------------------------------------------------------------------------------------------

class Piece:
    """Un-premultiplied channels of a part: 'A' alpha, 'L' levelled shading, optionally 'n' native colour (h, w, 3),
    'e' emission (h, w, 3), 'mat:<name>' material weights. `ss`: built at the canvas resolution (placed 1:1), else a
    stock frame (scaled up by SS like the output frame)."""

    cache = {}

    def __init__(self, A, L, n=None, e=None, mats=None, ss=True):
        self.A = A.astype(F32)
        self.L = L.astype(F32)
        self.n = None if n is None else n.astype(F32)
        self.e = None if e is None else e.astype(F32)
        self.mats = {k: v.astype(F32) for k, v in (mats or {}).items()}
        self.ss = ss

    @property
    def shape(self):
        return self.A.shape

    @classmethod
    def load(cls, root, rel, crop=None, lo=0.03, hi=0.97, lights='keep', light_col=(1.0, 0.86, 0.6)):
        """A stock frame (or a crop of it): its levelled shading, its native colour and its lights. `lights`: 'keep'
        (the lit windows and lamps become emission in light_col, scaled by their brightness), 'kill' (put out)."""
        key = (rel, crop, lo, hi, lights, light_col)
        if key in cls.cache:
            return cls.cache[key]
        img = Image.open(os.path.join(root, rel)).convert('RGBA')
        if crop is not None:
            img = img.crop(crop)
        a = np.asarray(img).astype(np.float64) / 255
        rgb, alpha = a[..., :3], a[..., 3]
        raw = np.asarray(img)[..., :3].astype(np.int32)
        marker = ((raw[..., 0] == 0) & (raw[..., 1] == 0) & (raw[..., 2] == 255)) | ((raw[..., 0] == 255) & (raw[..., 1] == 255) & (raw[..., 2] == 0))
        marker &= alpha > 0
        hue, sat, val = hsv(rgb)
        lum = rgb @ LUM
        glow = (sat > 0.42) & (val > 0.45) & ~marker & (alpha > 0.4)
        glow |= (val > 0.93) & (sat < 0.25) & (alpha > 0.4)
        glow = dilate(glow, 1) & (alpha > 0.3) & ~marker
        op = (alpha > 0.6) & ~glow & ~marker
        vals = lum[op]
        p0, p1 = (np.quantile(vals, lo), np.quantile(vals, hi)) if vals.size > 50 else (0.0, 1.0)
        L = np.clip((lum - p0) / max(1e-3, p1 - p0), 0, 1)
        keep = op.astype(np.float64)
        fill = fblur(L * keep, 1.5) / np.maximum(fblur(keep, 1.5), 1e-3)
        L = np.where(glow | marker, fill * 0.8, L)
        nat = rgb.copy()
        nfill = np.stack([fblur(rgb[..., k] * keep, 1.5) / np.maximum(fblur(keep, 1.5), 1e-3) for k in range(3)], -1)
        nat = np.where((glow | marker)[..., None], nfill * 0.8, nat)
        e = None
        if lights == 'keep':
            gv = np.where(glow, np.clip((val - 0.35) / 0.65, 0, 1), 0.0)
            e = gv[..., None] * np.array(light_col)[None, None, :]
        bb = Image.fromarray((alpha * 255).astype(np.uint8)).getbbox()
        sl = (slice(bb[1], bb[3]), slice(bb[0], bb[2]))
        p = cls(alpha[sl], L[sl], nat[sl], None if e is None else e[sl], ss=False)
        cls.cache[key] = p
        return p

    def chans(self):
        """Premultiplied channel list and their names."""
        A = self.A
        names, out = ['A', 'L'], [A, self.L * A]
        if self.n is not None:
            for k in range(3):
                names.append('n%d' % k)
                out.append(self.n[..., k] * A)
        if self.e is not None:
            for k in range(3):
                names.append('e%d' % k)
                out.append(self.e[..., k] * A)
        for m, v in self.mats.items():
            names.append('mat:' + m)
            out.append(v * A)
        return names, out

    def transformed(self, scale, rot, flipx=False, flipy=False, sx=1.0, sy=1.0):
        names, chans = self.chans()
        h0, w0 = self.A.shape
        nw, nh = max(1, round(w0 * scale * sx)), max(1, round(h0 * scale * sy))
        res = {}
        for nm, ch in zip(names, chans):
            im = Image.fromarray(ch.astype(np.float32), 'F')
            if flipx:
                im = im.transpose(Image.FLIP_LEFT_RIGHT)
            if flipy:
                im = im.transpose(Image.FLIP_TOP_BOTTOM)
            if (nw, nh) != (w0, h0):
                im = im.resize((nw, nh), Image.BICUBIC if scale * min(sx, sy) > 1 else Image.LANCZOS)
            if rot % 360:
                im = im.rotate(rot, resample=Image.BICUBIC, expand=True)
            res[nm] = np.asarray(im).astype(F32)
        A = np.clip(res['A'], 0, 1)
        res['A'] = A
        for nm in res:
            if nm != 'A' and not nm.startswith('e'):
                res[nm] = np.clip(res[nm], 0, None)
                if nm == 'L' or nm.startswith('mat:') or nm.startswith('n'):
                    res[nm] = np.minimum(res[nm], A if nm != 'L' else A * 1.0)
            elif nm.startswith('e'):
                res[nm] = np.clip(res[nm], 0, None)
        return res


class Canvas:
    """Premultiplied layers at SS x the layout resolution: A, L (shading), D (shadow factor), T (tone), n0-2 (native
    colour), e0-2 (emission), mat:<m> (material weights)."""

    def __init__(self, w, h=None):
        h = w if h is None else h
        self.lw, self.lh = w, h
        self.w, self.h = int(round(w * SS)), int(round(h * SS))
        self.ch = {}
        for nm in ['A', 'L', 'D', 'T', 'n0', 'n1', 'n2', 'e0', 'e1', 'e2'] + ['mat:' + m for m in MATS]:
            self.ch[nm] = np.zeros((self.h, self.w), F32)
        self.lights = []   # (x, y, kind) layout px

    def put(self, piece, cx, cy, scale=1.0, rot=0.0, flipx=False, flipy=False, sx=1.0, sy=1.0, mat='steel', nat=0.0,
            shadow=0.5, gain=1.0, tone=0.0, emit=1.0, clip=None, edge=0.0, under=False, contrast=1.0):
        """Layer `piece` centred at layout (cx, cy). scale: output px per piece px (a stock piece) or canvas px per
        piece px (a procedural one, ss). mat: the material of the pixels the piece does not tag itself; nat: the share
        of a stock piece's native colour kept (the rest painted as `mat`). clip: a canvas-size mask the piece is cut to.
        under: slide it under what is already there (fills only where the canvas is not yet opaque)."""
        k = scale if piece.ss else scale * SS
        res = piece.transformed(k, rot, flipx, flipy, sx, sy)
        ph, pw = res['A'].shape
        x0 = int(round(cx * SS - pw / 2))
        y0 = int(round(cy * SS - ph / 2))
        sx0, sy0 = max(0, -x0), max(0, -y0)
        dx0, dy0 = max(0, x0), max(0, y0)
        dx1, dy1 = min(self.w, x0 + pw), min(self.h, y0 + ph)
        if dx1 <= dx0 or dy1 <= dy0:
            return None
        sl = (slice(dy0, dy1), slice(dx0, dx1))
        cut = lambda v: v[sy0:sy0 + dy1 - dy0, sx0:sx0 + dx1 - dx0]
        fa = cut(res['A']).copy()
        if clip is not None:
            fa *= clip[sl]
        if under:
            fa = fa * (1 - self.ch['A'][sl])
        fsrc = {nm: cut(v) for nm, v in res.items()}
        ratio = np.where(cut(res['A']) > 1e-6, fa / np.maximum(cut(res['A']), 1e-6), 0).astype(F32)
        # contact shadow (on what is below, offset down-right)
        if shadow > 0 and not under:
            off = max(1, int(round((2.5 + 1.2 * min(k, 3)) * SS / 2)))
            m = off + int(4 * SS) + 2
            ry0, ry1 = max(0, dy0 - m), min(self.h, dy1 + m)
            rx0, rx1 = max(0, dx0 - m), min(self.w, dx1 + m)
            big = np.zeros((ry1 - ry0, rx1 - rx0), np.float64)
            big[dy0 - ry0:dy1 - ry0, dx0 - rx0:dx1 - rx0] = fa
            sh = fblur(shift(big, off, off // 2), 1.6 * SS) * shadow
            rs = (slice(ry0, ry1), slice(rx0, rx1))
            self.ch['D'][rs] *= (1 - sh * (1 - big)).astype(F32)
        inv = 1 - fa
        own = {}
        own['A'] = fa
        own['L'] = fsrc['L'] * ratio * gain
        if contrast != 1.0:
            own['L'] = (0.5 * fa + contrast * (own['L'] - 0.5 * fa)).astype(F32)
        own['D'] = fa
        own['T'] = fa * tone
        tagged = np.zeros_like(fa)
        for m in MATS:
            if 'mat:' + m in fsrc:
                v = fsrc['mat:' + m] * ratio
                own['mat:' + m] = v
                tagged = tagged + v
        rest = np.clip(fa - tagged, 0, None)
        if 'n0' in fsrc and 'mat:nat' in fsrc:
            # the piece tags its own native-colour pixels: their colour comes along whole
            for q in range(3):
                own['n%d' % q] = fsrc['n%d' % q] * ratio * (own['mat:nat'] / np.maximum(fa, 1e-6))
            own['mat:' + mat] = own.get('mat:' + mat, 0) + rest
        elif 'n0' in fsrc and nat > 0:
            for q in range(3):
                own['n%d' % q] = fsrc['n%d' % q] * ratio * nat
            own['mat:nat'] = own.get('mat:nat', 0) + rest * nat
            own['mat:' + mat] = own.get('mat:' + mat, 0) + rest * (1 - nat)
        else:
            own['mat:' + mat] = own.get('mat:' + mat, 0) + rest
        if 'e0' in fsrc and emit > 0:
            for q in range(3):
                own['e%d' % q] = fsrc['e%d' % q] * ratio * emit
        for nm, arr in self.ch.items():
            reg = arr[sl]
            reg *= inv
            if nm in own:
                reg += own[nm]
        if edge > 0:
            self.crisp(sl, fa > 0.5, edge)
        return (dx0, dy0, dx1, dy1)

    def crisp(self, sl, inside, k=1.0):
        """Plate edges, one output px wide: lit along the top / left rim of `inside`, dark along its bottom / right."""
        up = np.ones_like(inside)
        dn = np.ones_like(inside)
        for d in range(1, SS + 1):
            up &= shift(inside, d, 0) & shift(inside, 0, d)
            dn &= shift(inside, -d, 0) & shift(inside, 0, -d)
        lit = inside & ~up
        dark = inside & ~dn & ~lit
        L = self.ch['L'][sl]
        A = self.ch['A'][sl]
        L[lit] = np.minimum(A[lit], L[lit] * (1 + 0.35 * k) + 0.05 * k * A[lit])
        L[dark] *= (1 - 0.45 * k)

    def flood(self, x, y, r, col, k):
        """A floodlit pool baked on the structure: emission falling off from (x, y) over r layout px, on what is there."""
        x0, x1 = max(0, int((x - r) * SS)), min(self.w, int((x + r) * SS) + 1)
        y0, y1 = max(0, int((y - r) * SS)), min(self.h, int((y + r) * SS) + 1)
        yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float64) + 0.5
        d = np.hypot(xx / SS - x, yy / SS - y) / r
        f = (np.clip(1 - d, 0, 1) ** 1.6 * k).astype(F32)
        A = self.ch['A'][y0:y1, x0:x1]
        L = self.ch['L'][y0:y1, x0:x1] / np.maximum(A, 1e-6)
        for q in range(3):
            self.ch['e%d' % q][y0:y1, x0:x1] += f * col[q] * A * (0.35 + 0.65 * np.clip(L, 0, 1))

    def light(self, x, y, kind):
        self.lights.append((float(x), float(y), kind))

    def result(self):
        """Un-premultiplied channels (dict) and alpha."""
        A = self.ch['A']
        a = np.maximum(A, 1e-6)
        out = {}
        for nm, v in self.ch.items():
            if nm == 'A':
                continue
            if nm.startswith('e'):
                out[nm] = v / a
            else:
                out[nm] = np.clip(v / a, 0, None)
        out['A'] = A
        return out

    def as_piece(self):
        """The canvas as a procedural piece (channels un-premultiplied), e.g. a strip to wrap round a ring."""
        r = self.result()
        A = r['A']
        mats = {m: np.clip(r['mat:' + m], 0, 1) for m in MATS if r['mat:' + m].max() > 0.01}
        # the native colour itself (not weighted by its share: the 'nat' material weight carries that)
        n = np.stack([r['n0'], r['n1'], r['n2']], -1) / np.maximum(r['mat:nat'], 1e-4)[..., None]
        n = np.where(r['mat:nat'][..., None] > 1e-4, np.clip(n, 0, 1), 0)
        e = np.stack([r['e0'], r['e1'], r['e2']], -1)
        L = np.clip(r['L'] * r['D'] * (1 + r['T']), 0, 1)
        p = Piece(A, L, n, e if e.max() > 0 else None, mats)
        return p

    def paint(self):
        """Final straight colour (h, w, 3) at the build resolution, and alpha: the materials through their ramps (the
        native colour for 'nat'), shaded, the contact shadows, then the emission added."""
        r = self.result()
        A = r['A']
        L = np.clip(r['L'] * (1 + r['T']), 0, 1)
        tot = np.zeros_like(A)
        col = np.zeros(A.shape + (3,), np.float64)
        for m in MATS:
            w = r['mat:' + m]
            if w.max() <= 1e-4:
                continue
            if m == 'nat':
                nat = np.stack([r['n0'], r['n1'], r['n2']], -1) / np.maximum(w, 1e-6)[..., None]
                c = nat * (0.55 + 0.45 * L[..., None] / np.maximum(nat @ LUM, 0.05)[..., None] * 0.6)
                c = np.where(w[..., None] > 1e-4, np.clip(nat, 0, 1), 0)
            else:
                c = ramp(m, L)
            col += c * w[..., None]
            tot += w
        col = np.where(tot[..., None] > 1e-4, col / np.maximum(tot, 1e-6)[..., None], ramp('steel', L))
        col *= np.clip(r['D'], 0, 1)[..., None]
        e = np.stack([r['e0'], r['e1'], r['e2']], -1)
        col = col + e
        return np.clip(col, 0, 1.5), A, e


def polar_wrap(strip, R0, R1, a0=0.0, a1=2 * math.pi, flip_v=False, shade_k=0.0):
    """A strip piece (built at the canvas resolution: its x runs along the ring, its y across it, y=0 outer edge)
    wrapped round an annulus R0..R1 (layout px) over the angles a0..a1 (rad, y-down screen angles): a procedural piece
    the size of the annulus' bounding square, centred on the ring centre. shade_k: a cylindrical light across the band."""
    s = int(math.ceil(2 * R1 * SS)) + 4
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float64) + 0.5
    dx, dy = (xx - s / 2) / SS, (yy - s / 2) / SS
    r = np.hypot(dx, dy)
    ang = np.arctan2(dy, dx)
    span = a1 - a0
    t = ((ang - a0) % (2 * math.pi)) / span
    inside = (r >= R0) & (r <= R1) & (t <= 1)
    sh, sw = strip.A.shape
    u = np.clip(t, 0, 1) * (sw - 1)
    v = (R1 - r) / max(1e-6, (R1 - R0)) * (sh - 1)
    if flip_v:
        v = (sh - 1) - v
    v = np.clip(v, 0, sh - 1)
    u0 = np.floor(u).astype(int)
    v0 = np.floor(v).astype(int)
    fu, fv = u - u0, v - v0
    u1 = np.minimum(u0 + 1, sw - 1)
    v1 = np.minimum(v0 + 1, sh - 1)

    def samp(a):
        if a.ndim == 3:
            return np.stack([samp(a[..., k]) for k in range(a.shape[2])], -1)
        o = a[v0, u0] * (1 - fu) * (1 - fv) + a[v0, u1] * fu * (1 - fv) + a[v1, u0] * (1 - fu) * fv + a[v1, u1] * fu * fv
        return np.where(inside, o, 0)

    # anti-aliased band edges
    edge = np.clip((r - R0) * SS + 0.5, 0, 1) * np.clip((R1 - r) * SS + 0.5, 0, 1)
    A = samp(strip.A) * edge
    L = samp(strip.L)
    if shade_k > 0:
        q = np.clip((r - (R0 + R1) / 2) / max(1e-6, (R1 - R0) / 2), -1, 1)
        nz = np.sqrt(np.clip(1 - q * q, 0, 1))
        cyl = shade(q * dx / np.maximum(r, 1e-6), q * dy / np.maximum(r, 1e-6), nz, amb=0.25, k=0.75, spec=0.1)
        L = L * (1 - shade_k + shade_k * cyl * 1.2)
    n = None if strip.n is None else samp(strip.n)
    e = None if strip.e is None else samp(strip.e)
    mats = {m: samp(v) for m, v in strip.mats.items()}
    return Piece(A, np.clip(L, 0, 1), n, e, mats)


# ---------------------------------------------------------------------------------------------------------------
# Procedural parts (built at the canvas resolution; sizes in layout px)
# ---------------------------------------------------------------------------------------------------------------

def truss(w, length, rail=1.4, bay=None, brace=0.55, solid_ends=0.0, yellow=False, cut=None, deck=False):
    """A see-through lattice girder along y (length), w wide: two round rails, cross bars, alternating diagonals.
    deck: a plated walkway down its middle. cut: (f0, f1) a jagged break (fractions of the length)."""
    W, H = max(3, int(round(w * SS))), max(3, int(round(length * SS)))
    rl = max(1.0, rail * SS)
    bay = (bay or max(4.0, w * 1.05)) * SS
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64) + 0.5
    A = np.zeros((H, W))
    qx_l = (xx - rl / 2) / (rl / 2)
    qx_r = (xx - (W - rl / 2)) / (rl / 2)
    railm = (np.abs(qx_l) <= 1) | (np.abs(qx_r) <= 1)
    nx = np.where(np.abs(qx_l) <= 1, qx_l, np.where(np.abs(qx_r) <= 1, qx_r, 0.0))
    t = yy % bay
    crossm = (t < max(1.0, 0.45 * SS * rail)) & ~railm
    u = (xx - rl) / max(1.0, W - 2 * rl)
    side = ((yy // bay) % 2) == 0
    dv = np.abs(t / bay - np.where(side, u, 1 - u)) * bay
    diag = (dv < brace * SS * 0.5 + 0.35) & ~railm & ~crossm & (xx > rl * 0.5) & (xx < W - rl * 0.5)
    A[railm] = 1
    A[crossm] = 1
    A[diag] = 0.95
    L = np.where(railm, shade(nx * 0.95, np.zeros_like(nx) - 0.05, np.sqrt(np.clip(1 - nx * nx, 0, 1)), amb=0.2, k=0.72),
                 np.where(crossm, 0.62, 0.48))
    mats = {}
    if deck:
        dm = (np.abs(xx - W / 2) < W * 0.2) & ~railm
        A[dm] = 1
        L = np.where(dm, 0.42 + 0.12 * ((yy // (2 * SS)) % 2), L)
    if solid_ends > 0:
        e = solid_ends * SS
        em = (yy < e) | (yy > H - e)
        A[em] = 1
        L = np.where(em, shade(np.clip((xx - W / 2) / (W / 2), -1, 1) * 0.5, -0.2 * np.ones_like(xx), 0.85 * np.ones_like(xx), amb=0.2, k=0.7), L)
    if cut is not None:
        jag = np.sin(xx * 1.3) * 1.5 * SS + np.cos(xx * 0.7 + 1) * 1.2 * SS
        A = np.where((yy > cut[0] * H + jag) & (yy < cut[1] * H + jag), 0, A)
    if yellow:
        mats['yellow'] = np.ones((H, W))
    return Piece(A, np.clip(L, 0, 1), None, None, mats)


def arc_truss(R, w, a0, a1, rail=1.6, bay=None, brace=0.6, mat=None, deck=False):
    """A curved lattice girder along the circle of radius R (layout px) from angle a0 to a1 (rad, screen angles):
    a procedural piece the size of the circle's bounding square, centred on the circle centre."""
    R1 = R + w / 2
    s = int(math.ceil(2 * R1 * SS)) + 6
    ys, xs = np.mgrid[0:s, 0:s].astype(np.float64) + 0.5
    dx, dy = (xs - s / 2) / SS, (ys - s / 2) / SS
    r = np.hypot(dx, dy)
    ang = np.arctan2(dy, dx)
    span = (a1 - a0)
    t = ((ang - a0) % (2 * math.pi))
    inarc = t <= span
    along = t * R  # layout px along the arc
    q = (r - R) / (w / 2)  # -1 inner .. 1 outer
    rl = rail / (w / 2)
    in_l = np.abs(q + 1 - rl) <= rl
    in_r = np.abs(q - 1 + rl) <= rl
    railm = (in_l | in_r) & inarc
    bay = bay or max(4.0, w * 1.05)
    tb = along % bay
    crossm = (tb < 0.5 * rail + 0.2) & (np.abs(q) < 1) & inarc & ~railm
    uu = (q + 1) / 2
    side = ((along // bay) % 2) == 0
    dv = np.abs(tb / bay - np.where(side, uu, 1 - uu)) * bay
    diag = (dv < brace * 0.5 + 0.18) & (np.abs(q) < 1 - rl) & inarc & ~railm & ~crossm
    A = np.zeros((s, s))
    A[railm] = 1
    A[crossm] = 1
    A[diag] = 0.95
    # rails: round across the radius
    qq = np.where(in_l, (q + 1 - rl) / rl, (q - 1 + rl) / rl)
    nrx, nry = dx / np.maximum(r, 1e-6), dy / np.maximum(r, 1e-6)
    L = np.where(railm, shade(qq * nrx * 0.95, qq * nry * 0.95, np.sqrt(np.clip(1 - qq * qq, 0, 1)), amb=0.2, k=0.72),
                 np.where(crossm, 0.62, 0.48))
    if deck:
        dm = (np.abs(q) < 0.36) & inarc & ~railm
        A[dm] = 1
        L = np.where(dm, 0.42 + 0.12 * ((along // 2) % 2), L)
    mats = {} if mat is None else {mat: np.ones((s, s))}
    return Piece(A, np.clip(L, 0, 1), None, None, mats)


def rock(rng, r, lumpy=0.22):
    """A captured asteroid chunk (procedural): a lumpy ball, noise relief, craters, rock material."""
    s = int(math.ceil(2.6 * r * SS)) + 4
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float64) + 0.5
    dx, dy = (xx - s / 2) / SS, (yy - s / 2) / SS
    ang = np.arctan2(dy, dx)
    rr = np.hypot(dx, dy)
    k = rng.uniform(0, 2 * math.pi, 5)
    rad = r * (1 + lumpy * (0.5 * np.sin(2 * ang + k[0]) + 0.3 * np.sin(3 * ang + k[1]) + 0.2 * np.sin(5 * ang + k[2])))
    n = fbm(rng, s, s, max(2, int(r * SS / 3)), 4)
    rad = rad * (0.92 + 0.16 * n)
    A = np.clip((rad - rr) * SS + 0.5, 0, 1)
    h = np.clip(1 - (rr / np.maximum(rad, 1e-3)) ** 2, 0, 1) ** 0.5
    rel = fbm(rng, s, s, max(2, int(r * SS / 6)), 4)
    hgt = h * r + rel * r * 0.35
    gy, gx = np.gradient(hgt * SS)
    nx, ny, nz = -gx, -gy, np.ones_like(gx) * 1.0
    nl = np.sqrt(nx * nx + ny * ny + nz * nz)
    L = shade(nx / nl, ny / nl, nz / nl, amb=0.12, k=0.85, spec=0.0)
    for _ in range(int(3 + r / 6)):
        cx, cy = rng.uniform(-0.6, 0.6, 2) * r
        cr = rng.uniform(0.08, 0.22) * r
        d = np.hypot(dx - cx, dy - cy) / cr
        L = np.where(d < 1, L * (0.55 + 0.35 * d), L)
        L = np.where((d >= 1) & (d < 1.25), np.minimum(1, L * 1.18), L)
    return Piece(A, np.clip(L, 0, 1), None, None, {'rock': np.ones((s, s))})


def box_module(w, h, rng=None, bevel=1.2, seams=2, vents=True):
    """A plated box module (container, tank block): bevelled lit top-left, panel seams, small vents."""
    W, H = max(3, int(round(w * SS))), max(3, int(round(h * SS)))
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64) + 0.5
    A = np.ones((H, W))
    b = bevel * SS
    L = np.full((H, W), 0.5)
    L = np.where((xx < b) | (yy < b), 0.78, L)
    L = np.where((xx > W - b) | (yy > H - b), 0.25, L)
    for k in range(1, seams + 1):
        y = int(H * k / (seams + 1))
        L[y:y + max(1, SS // 2)] *= 0.55
    if vents and min(W, H) > 6 * SS:
        for k in range(3):
            y0 = int(H * (0.2 + 0.25 * k))
            L[y0:y0 + SS, int(W * 0.3):int(W * 0.7)] *= 0.6
    return Piece(A, np.clip(L, 0, 1))


def cylinder(w, h, caps=True, bands=()):
    """A tank / tube lying along y: cylinder shading, rounded ends, dark bands."""
    W, H = max(3, int(round(w * SS))), max(3, int(round(h * SS)))
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64) + 0.5
    r = W / 2
    nx = (xx - r) / r
    A = (np.abs(nx) <= 1).astype(np.float64)
    ny = np.zeros_like(nx)
    if caps:
        for cyc, sel in ((r, yy < r), (H - r, yy > H - r)):
            d = np.hypot(xx - r, yy - cyc) / r
            A = np.where(sel, (d <= 1).astype(np.float64), A)
            ny = np.where(sel, (yy - cyc) / r, ny)
            nx = np.where(sel, (xx - r) / r, nx)
    nz = np.sqrt(np.clip(1 - nx * nx - ny * ny, 0, 1))
    L = shade(nx, ny, nz, amb=0.18, k=0.75)
    for f in bands:
        y = int(f * H)
        L[max(0, y - SS):y + SS] *= 0.5
    return Piece(A, np.clip(L, 0, 1))


def crane(boom, w=3.0, rng=None):
    """A gantry crane seen from above: a yellow lattice boom with a counterweight block at the root and a hook trolley
    out along it (along y, root at the bottom)."""
    c = Canvas(w * 3.2, boom + w * 2)
    cx = c.lw / 2
    c.put(truss(w, boom, rail=0.8, yellow=True), cx, w + boom / 2, shadow=0.2)
    c.put(box_module(w * 2.6, w * 1.8, seams=1, vents=False), cx, c.lh - w * 1.1, mat='dark', shadow=0.2)
    c.put(box_module(w * 1.6, w * 1.4, seams=0, vents=False), cx, w + boom * 0.35, mat='yellow', shadow=0.3)
    return c.as_piece()


def arc_beam(R, w, a0=0.0, a1=2 * math.pi, ticks=0.0, mat=None):
    """A solid curved beam (a ring rail seen from above): cylinder shading across, rivet / bracket ticks every `ticks`
    layout px along it; the bounding square of the circle, centred."""
    R1 = R + w / 2
    s = int(math.ceil(2 * R1 * SS)) + 6
    ys, xs = np.mgrid[0:s, 0:s].astype(np.float64) + 0.5
    dx, dy = (xs - s / 2) / SS, (ys - s / 2) / SS
    r = np.hypot(dx, dy)
    t = (np.arctan2(dy, dx) - a0) % (2 * math.pi)
    inarc = t <= (a1 - a0) + 1e-9
    q = (r - R) / (w / 2)
    A = np.clip((1 - np.abs(q)) * w / 2 * SS + 0.5, 0, 1) * inarc
    nrx, nry = dx / np.maximum(r, 1e-6), dy / np.maximum(r, 1e-6)
    qc = np.clip(q, -1, 1)
    L = shade(qc * nrx * 0.9, qc * nry * 0.9, np.sqrt(np.clip(1 - qc * qc * 0.81, 0, 1)), amb=0.22, k=0.7, spec=0.25)
    if ticks > 0:
        along = t * R
        tk = (along % ticks) < 0.8
        L = np.where(tk & (np.abs(q) < 0.8), L * 0.55, L)
    mats = {} if mat is None else {mat: np.ones((s, s))}
    return Piece(A, np.clip(L, 0, 1), None, None, mats)


def window_row(w, h, pitch, rng, lit=0.75, col=(1.0, 0.82, 0.52)):
    """A recessed strip of windows (along x): dark, a lit pane every `pitch` px (some dark)."""
    W, H = max(3, int(round(w * SS))), max(2, int(round(h * SS)))
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64) + 0.5
    A = np.ones((H, W))
    L = np.full((H, W), 0.14)
    L[:max(1, SS // 2)] = 0.06
    L[-max(1, SS // 2):] = 0.5
    p = pitch * SS
    k = (xx // p).astype(int)
    on = rng.random(int(W // p) + 2) < lit
    pane = ((xx % p) < p * 0.55) & (yy > H * 0.25) & (yy < H * 0.8)
    e = np.zeros((H, W, 3))
    m = pane & on[k]
    for q in range(3):
        e[..., q] = np.where(m, col[q] * 0.9, 0)
    L = np.where(pane & ~on[k], 0.22, L)
    return Piece(A, L, None, e)


def plate_panel(w, h, rng, bevel=1.0, seams=1):
    """A smooth hull plate: a gentle gradient, a lit top-left bevel, dark bottom-right, one or two seams, faint
    mottling (the calm areas between the detailed machinery)."""
    W, H = max(3, int(round(w * SS))), max(3, int(round(h * SS)))
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64) + 0.5
    L = 0.4 + 0.05 * (1 - (xx / W + yy / H)) + 0.05 * (value_noise(rng, H, W, max(2, int(6 * SS))) - 0.5)
    b = bevel * SS
    L = np.where((xx < b) | (yy < b), L + 0.2, L)
    L = np.where((xx > W - b) | (yy > H - b), L - 0.22, L)
    for k in range(seams):
        if rng.random() < 0.5:
            y = int(H * rng.uniform(0.3, 0.7))
            L[y:y + max(1, SS // 2)] -= 0.2
        else:
            x = int(W * rng.uniform(0.3, 0.7))
            L[:, x:x + max(1, SS // 2)] -= 0.2
    return Piece(np.ones((H, W)), np.clip(L, 0, 1))


def stock(root, rel, **kw):
    return Piece.load(root, os.path.join('images', 'units', 'ships', rel), **kw)


def girder(c, x0, y0, x1, y1, w, **kw):
    """A straight lattice girder between two layout points (truss kwargs: rail, bay, brace, yellow, cut, deck,
    solid_ends; put kwargs: mat, shadow, gain, tone, clip)."""
    tk = {k: kw.pop(k) for k in ('rail', 'bay', 'brace', 'yellow', 'cut', 'deck', 'solid_ends') if k in kw}
    ln = math.hypot(x1 - x0, y1 - y0)
    phi = math.degrees(math.atan2(y1 - y0, x1 - x0))
    return c.put(truss(w, ln, **tk), (x0 + x1) / 2, (y0 + y1) / 2, rot=90 - phi, **kw)


def polar(r, a, cx=C0, cy=C0):
    return cx + r * math.cos(a), cy + r * math.sin(a)


def radial_put(c, piece, r, a, scale=1.0, outward=True, **kw):
    """A piece placed at radius r, angle a, its 'up' (bow) pointing outward (or inward)."""
    x, y = polar(r, a)
    rot = -math.degrees(a) - 90 if outward else -math.degrees(a) + 90
    return c.put(piece, x, y, scale=scale, rot=rot, **kw)


# ---------------------------------------------------------------------------------------------------------------
# The shared shell (the plating the scaffold carries from the Superstructure stage on)
# ---------------------------------------------------------------------------------------------------------------

R_HUB = 62.0
R_CORE = 112.0
R_IN = 182.0
R_FRAME = 288.0
PYLON_A = [math.radians(30 + 60 * k) for k in range(6)]


def opaque_crops(root, rel, size, n, rng, scale=1.0, light_col=(1.0, 0.84, 0.56)):
    """n square crops (stock px, side `size`) lying wholly on the opaque hull of a stock frame (its plating detail)."""
    img = Image.open(os.path.join(root, 'images', 'units', 'ships', rel)).convert('RGBA')
    a = np.asarray(img)[..., 3] > 240
    ii = np.pad(np.cumsum(np.cumsum(a.astype(np.int64), 0), 1), ((1, 0), (1, 0)))
    H, W = a.shape
    s = int(size)
    tot = ii[s:, s:] - ii[:-s, s:] - ii[s:, :-s] + ii[:-s, :-s]
    ys, xs = np.nonzero(tot >= s * s)
    out = []
    if len(ys) == 0:
        return out
    for _ in range(n):
        i = int(rng.integers(len(ys)))
        out.append(stock(root, rel, crop=(int(xs[i]), int(ys[i]), int(xs[i]) + s, int(ys[i]) + s), lights='keep', light_col=light_col))
    return out


PLATE_SRC = [('family22/largespaceport.png', 46), ('family22/capitalship.png', 40), ('family23/largespaceport.png', 50),
             ('family24/capitalship.png', 40), ('family22/cruiser.png', 40), ('family23/capitalship.png', 36),
             ('family6/largespaceport.png', 44), ('family21/largespaceport.png', 48)]


GOLD_SRC = [('family10/largespaceport.png', 60), ('family10/capitalship.png', 40), ('family10/resortbase.png', 44),
            ('family10/genericbase.png', 50), ('family10/cruiser.png', 40), ('family10/carrier.png', 44)]


def plate_kit(root, rng, n_each=6, src=PLATE_SRC, light_col=(1.0, 0.84, 0.56)):
    kit = []
    for (rel, size) in src:
        kit += opaque_crops(root, rel, size, n_each, rng, light_col=light_col)
    return kit


def deck_strip(rng, kit, W, H, tile, rows, nat=0.3, period=None, smooth=0.35, contrast=0.7, mat='steel', smooth_mat=None):
    """A plated deck: rows of cells about `tile` px, most a stock plating crop (flipped / turned at random, its
    contrast eased), some a smooth plate; tones vary by groups of cells (whole panels), crisp seams between cells.
    period: repeat the first 1/period of the strip round it."""
    c = Canvas(W, H)
    rh = H / rows
    span = W if period is None else W / period
    cells = []
    for i in range(rows):
        x = 0.0
        gt = float(rng.uniform(-0.14, 0.1))
        while x < span:
            w = float(rng.uniform(0.7, 1.4) * tile)
            if rng.random() < 0.3:
                gt = float(rng.uniform(-0.14, 0.1))
            cells.append((x, i * rh, min(w, span - x + 1), rh, int(rng.integers(len(kit))), int(rng.integers(4)),
                          gt + float(rng.uniform(-0.03, 0.03)), rng.random() < smooth, int(rng.integers(1 << 30))))
            x += w
    reps = 1 if period is None else period
    for p in range(reps):
        for (x, y, w, h, ki, rot, tn, sm, sd) in cells:
            if sm:
                c.put(plate_panel(w + 0.4, h + 0.4, np.random.default_rng(sd)), p * span + x + w / 2, y + h / 2, mat=smooth_mat or mat, tone=tn, shadow=0.0)
                continue
            pc = kit[ki]
            sc = max(w, h) / pc.A.shape[0] * 1.02
            c.put(pc, p * span + x + w / 2, y + h / 2, scale=sc, rot=90 * rot, sx=w / max(w, h), sy=h / max(w, h), mat=mat,
                  nat=nat, tone=tn, shadow=0.0, edge=0.9, contrast=contrast)
    return c


def build_shell(root):
    """The generic shell disc of the Great Work: three plated bands round the hub (stock plating crops and smooth
    plates, a window row, radial ribs, stock machinery set in), raised ring beams between them; one piece the size of
    the frame, centred; never a wonder's look. Its windows are lit only once the systems come on (emit)."""
    rng = seeded('shell')
    kit = plate_kit(root, rng)
    c = Canvas(FRAME)
    bands = [
        (R_HUB, R_CORE, 6, 15, [('family22/gasminingstation.png', 0.34, 0.5, 0.42, 0.0)], (0.82,)),
        (R_CORE, R_IN, 8, 17, [('family22/genericbase.png', 0.28, 0.5, 0.5, 0.0), ('family24/largefreighter.png', 0.28, 0.14, 0.5, 90.0)], (0.18, 0.86)),
        (R_IN, R_FRAME - 9, 12, 19, [('family22/smallspaceport.png', 0.32, 0.5, 0.5, 0.0), ('family24/genericbase.png', 0.24, 0.1, 0.74, 90.0)], (0.12, 0.42, 0.9)),
    ]
    for (R0, R1, period, tile, mods, wins) in bands:
        W = 2 * math.pi * (R0 + R1) / 2
        H = R1 - R0
        st = deck_strip(rng, kit, W, H, tile, max(2, int(round(H / tile))), period=period)
        span = W / period
        for wv in wins:
            st.put(window_row(W, 3.2, 3.0, rng), W / 2, wv * H, mat='dark', shadow=0.3, edge=0.6)
        for p in range(period):
            # a raised rib between sectors, and the stock machinery set into the deck
            st.put(cylinder(4.5, H, caps=False), p * span + 1, H / 2, mat='steel', shadow=0.55, gain=0.78)
            st.put(cylinder(2.4, H, caps=False), p * span + span / 2, H / 2, mat='dark', shadow=0.35, gain=0.9)
            for (rel, sc, fu, fv, rot) in mods:
                st.put(stock(root, rel, light_col=(1.0, 0.84, 0.56)), p * span + fu * span, fv * H, scale=sc, rot=rot, mat='steel', nat=0.35, shadow=0.65, edge=0.6)
        c.put(polar_wrap(st.as_piece(), R0, R1, shade_k=0.2), C0, C0, shadow=0.0, edge=1.0)
    for (R, w) in ((R_HUB + 1, 5.0), (R_CORE, 6.0), (R_IN, 7.0)):
        c.put(arc_beam(R, w, ticks=9.0), C0, C0, shadow=0.55, gain=0.8)
    return c.as_piece()


def polar_lattice(R0, R1, spokes, rings, w=6.0, mat='dark'):
    """The bare structural skeleton under the shell: ring girders and radial girders on a polar grid (what shows
    through wherever the plating is not on yet)."""
    c = Canvas(FRAME)
    for k in range(rings + 1):
        R = R0 + (R1 - R0) * k / rings
        c.put(arc_truss(R, w, 0, 2 * math.pi, rail=1.3, bay=w + 2, mat=mat), C0, C0, shadow=0.0)
    for k in range(spokes):
        a = 2 * math.pi * k / spokes
        girder(c, *polar(R0, a), *polar(R1, a), w * 0.9, rail=1.2, bay=w + 2, shadow=0.3, mat=mat)
    return c.as_piece()


def scaffold_block(w, h, cell, rng, deck=0.25):
    """Scaffolding seen from above: a grid of tubes (standards at the crossings, ledgers both ways), diagonal braces
    in some bays, plank decks on some (along y = h)."""
    W, H = max(3, int(round(w * SS))), max(3, int(round(h * SS)))
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64) + 0.5
    cs = cell * SS
    t = 0.55 * SS
    gx = np.abs(((xx + cs / 2) % cs) - cs / 2)
    gy = np.abs(((yy + cs / 2) % cs) - cs / 2)
    A = ((gx < t) | (gy < t)).astype(np.float64)
    A[:, :int(t * 2)] = 1
    A[:, W - int(t * 2):] = 1
    A[:int(t * 2)] = 1
    A[H - int(t * 2):] = 1
    L = np.where(gx < t, 0.46 - 0.18 * (gx / t), 0.4 - 0.12 * (gy / t))
    ci, cj = (yy // cs).astype(int), (xx // cs).astype(int)
    nb = (int(H // cs) + 2, int(W // cs) + 2)
    r = rng.random(nb)
    uu, vv = (xx % cs) / cs, (yy % cs) / cs
    br = (r[ci, cj] < 0.35) & (np.abs(uu - vv) * cs < t * 0.9)
    br |= (r[ci, cj] > 0.85) & (np.abs(uu - (1 - vv)) * cs < t * 0.9)
    A = np.maximum(A, br * 0.95)
    L = np.where(br, 0.45, L)
    dk = rng.random(nb) < deck
    plank = dk[ci, cj] & (A < 0.5)
    A = np.where(plank, 1.0, A)
    L = np.where(plank, 0.36 + 0.1 * ((yy // (1.6 * SS)) % 2) + 0.05 * r[ci, cj], L)
    # standards: a brighter dot at each crossing (the vertical tubes, end on)
    std = (gx < t * 1.4) & (gy < t * 1.4)
    L = np.where(std, 0.66, L)
    A = np.where(std, 1.0, A)
    return Piece(A, np.clip(L, 0, 1))


# ---------------------------------------------------------------------------------------------------------------
# The scaffold (shared kit, four stages)
# ---------------------------------------------------------------------------------------------------------------

class Op:
    def __init__(self, s0, fn, s1=9):
        self.s0, self.s1, self.fn = s0, s1, fn


def cell_field(rng, R0, R1, rings, cell_len, seed_ang=0.0):
    """Random value per polar cell over the canvas (layout cells: `rings` radial rows between R0 and R1, cells about
    cell_len long), at the canvas resolution."""
    s = FRAME * SS
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float64) + 0.5
    dx, dy = xx / SS - C0, yy / SS - C0
    r = np.hypot(dx, dy)
    a = (np.arctan2(dy, dx) + seed_ang) % (2 * math.pi)
    ri = np.clip(((r - R0) / (R1 - R0) * rings).astype(int), 0, rings - 1)
    rmid = R0 + (ri + 0.5) * (R1 - R0) / rings
    ncell = np.maximum(6, (2 * math.pi * rmid / cell_len).astype(int))
    ai = (a / (2 * math.pi) * ncell).astype(int)
    vals = rng.random((rings, 400))
    v = vals[ri, ai % 400]
    inside = (r >= R0) & (r <= R1)
    return np.where(inside, v, 2.0), r, a


def scaffold_ops(root):
    """Every part of the scaffold, tagged with the stage it appears at (and the last stage it stays)."""
    rng = seeded('scaffold')
    ops = []
    add = lambda s0, fn, s1=9: ops.append(Op(s0, fn, s1))
    hub = stock(root, 'other/MinorSets/bases/base_1.png', light_col=(1.0, 0.85, 0.6))
    head = stock(root, 'family24/gasminingstation.png', light_col=(1.0, 0.85, 0.6))
    cont = [stock(root, f, lights='kill') for f in ('family22/mediumfreighter.png', 'family24/largefreighter.png', 'family22/miningship.png')]
    shell = build_shell(root)
    skeleton = polar_lattice(R_HUB + 4, R_FRAME - 10, 24, 6, w=6.5)

    # --- stage 0: Foundations ---
    rocks = [(rock(np.random.default_rng(100 + k), float(rng.uniform(20, 27))), float(rng.uniform(-0.04, 0.04))) for k in range(6)]
    for k, a in enumerate(PYLON_A):
        rk, da = rocks[k]
        add(0, lambda c, rk=rk, a=a, da=da: c.put(rk, *polar(R_FRAME + 18, a + da), shadow=0.5))
    # the six spokes (heavy girders with a walkway), hub out to the pylons
    for a in PYLON_A:
        add(0, lambda c, a=a: girder(c, *polar(R_HUB - 8, a), *polar(R_FRAME + 4, a), 19, rail=2.6, bay=15, deck=True, solid_ends=4, shadow=0.6))
    # pylons: a heavy lattice mast sunk in each rock, a stock pod at its head
    for a in PYLON_A:
        def pyl(c, a=a):
            girder(c, *polar(R_FRAME - 2, a), *polar(R_FRAME + 50, a), 15, rail=2.4, bay=8, brace=0.8, solid_ends=4, shadow=0.6)
            for s_ in (-1, 1):
                girder(c, *polar(R_FRAME + 8, a + s_ * 0.06), *polar(R_FRAME + 44, a), 4.5, rail=1.2, bay=6, shadow=0.4)
            radial_put(c, head, R_FRAME + 53, a, scale=0.25, mat='steel', nat=0.45, shadow=0.6, edge=0.6)
            c.light(*polar(R_FRAME + 66, a), 'nav')
            c.light(*polar(R_FRAME + 46, a + 0.03), 'white')
        add(0, pyl)
    # the yard hub: a plated collar every spoke runs into, the stock yard station on it
    ckit = plate_kit(root, seeded('collar'), 3)
    cW = 2 * math.pi * (R_HUB - 16)
    cst = deck_strip(seeded('collar2'), ckit, cW, 30, 12, 2, period=6)
    for p in range(6):
        cst.put(cylinder(4.0, 30, caps=False), p * cW / 6, 15, mat='steel', shadow=0.5)
    collar = polar_wrap(cst.as_piece(), R_HUB - 30, R_HUB + 2, shade_k=0.3)

    def hubf(c):
        c.put(collar, C0, C0, shadow=0.6, edge=1.0)
        c.put(arc_beam(R_HUB + 1, 5.0, ticks=8.0), C0, C0, shadow=0.5)
        c.put(hub, C0, C0, scale=0.56, mat='steel', nat=0.45, shadow=0.6, edge=0.6)
        for k in range(3):
            c.light(*polar(R_HUB - 12, math.radians(90 + 120 * k)), 'white')
    add(0, hubf)
    # girder stacks and freight lying beside the spokes in the yard; cranes on the spokes
    for i, a in enumerate(PYLON_A):
        side = 1 if i % 2 == 0 else -1
        n_st = int(rng.integers(3, 5))
        r0 = float(rng.uniform(R_HUB + 16, R_HUB + 34))
        ln = float(rng.uniform(44, 70))
        off = [float(13 + 5.6 * j) for j in range(n_st)]

        def stack(c, a=a, side=side, r0=r0, ln=ln, off=off):
            na = a + math.pi / 2
            for f in (0.12, 0.88):
                x, y = polar(r0 + ln * f, a)
                girder(c, x, y, x + math.cos(na) * (off[-1] + 3) * side, y + math.sin(na) * (off[-1] + 3) * side, 3.2, rail=0.9, shadow=0.3, mat='yellow')
            for o in off:
                x0, y0 = polar(r0, a)
                x1, y1 = polar(r0 + ln, a)
                ox, oy = math.cos(na) * o * side, math.sin(na) * o * side
                girder(c, x0 + ox, y0 + oy, x1 + ox, y1 + oy, 5.0, rail=1.1, bay=5, shadow=0.5, mat='steel', tone=-0.08)
        add(0, stack, 1)
        cn = [(int(rng.integers(0, 3)), float(R_HUB + 100 + 46 * j + rng.uniform(-6, 6)), float(rng.uniform(0.26, 0.32))) for j in range(3)]

        def conts(c, a=a, side=side, cn=cn):
            na = a + math.pi / 2
            for (ci, r, sc) in cn:
                x, y = polar(r, a)
                ox, oy = math.cos(na) * 17 * -side, math.sin(na) * 17 * -side
                girder(c, x, y, x + ox * 0.8, y + oy * 0.8, 4.0, rail=1.0, shadow=0.3)
                c.put(cont[ci], x + ox, y + oy, scale=sc, rot=-math.degrees(a) - 90, mat='steel', nat=0.5, shadow=0.6, edge=0.5)
        add(0, conts, 1)
        rr = float(rng.uniform(140, 205))
        ang = float(rng.uniform(30, 60)) * side

        def cr(c, a=a, rr=rr, ang=ang):
            x, y = polar(rr, a)
            c.put(crane(58, 3.8), x, y, rot=-math.degrees(a) - 90 + ang, shadow=0.6)
            c.light(x, y, 'nav')
        add(0, cr, 1)
    # cleared asteroids: rocks towed into the yard, held by girders off the spokes (broken up and gone by the Superstructure)
    for k, (a_, r_, rr_) in enumerate(((PYLON_A[1] + 0.32, 168.0, 15.0), (PYLON_A[3] + 0.3, 205.0, 13.0), (PYLON_A[5] + 0.28, 150.0, 11.0))):
        rk_ = rock(np.random.default_rng(300 + k), rr_, lumpy=0.3)

        def tow(c, a_=a_, r_=r_, rr_=rr_, rk_=rk_, k=k):
            base_a = a_ - 0.32 + 0.0 * k
            x0, y0 = polar(r_, base_a)
            x1, y1 = polar(r_ + 4, a_)
            girder(c, x0, y0, x1, y1, 4.5, rail=1.1, bay=5, mat='yellow', shadow=0.4)
            c.put(rk_, x1, y1, shadow=0.55)
            girder(c, *polar(r_ - rr_ * 0.8, a_), *polar(r_ + rr_ * 0.9, a_ + 0.02), 3.0, rail=0.8, shadow=0.3, mat='yellow')
            c.light(x1, y1 - rr_ * 0.4, 'work')
        add(0, tow, 1)
    # the foundation ring's first arcs
    add(0, lambda c: c.put(arc_truss(R_FRAME, 22, PYLON_A[0], PYLON_A[1] + 0.01, rail=2.6, bay=15, deck=True), C0, C0, shadow=0.6))
    add(0, lambda c: c.put(arc_truss(R_FRAME, 22, PYLON_A[3], PYLON_A[3] + 0.55, rail=2.6, bay=15, deck=True), C0, C0, shadow=0.6), 0)

    # --- stage 1: Frame ---
    gap0, gap1 = PYLON_A[4] + 0.22, PYLON_A[5] - 0.12
    def frame(c):
        c.put(arc_truss(R_FRAME, 22, PYLON_A[1], gap0, rail=2.6, bay=15, deck=True), C0, C0, shadow=0.6)
        c.put(arc_truss(R_FRAME, 22, gap1, PYLON_A[0] + 2 * math.pi + 0.01, rail=2.6, bay=15, deck=True), C0, C0, shadow=0.6)
        for k in range(24):
            a = PYLON_A[0] + k * math.pi / 12 + math.pi / 24
            if gap0 - 0.05 < (a % (2 * math.pi)) < gap1 + 0.05:
                continue
            if k % 3 == 1:
                c.light(*polar(R_FRAME + 10, a), 'nav')
    add(1, frame)
    add(2, lambda c: c.put(arc_truss(R_FRAME, 22, gap0 - 0.02, gap1 + 0.02, rail=2.6, bay=15, deck=True), C0, C0, shadow=0.6))
    # gantry cranes riding the frame (two at the gap's ends)
    for a, sgn in ((gap0 - 0.03, 1), (gap1 + 0.03, -1), (PYLON_A[1] + 0.5, 1), (PYLON_A[2] + 0.45, -1)):
        def gc(c, a=a, sgn=sgn):
            x, y = polar(R_FRAME, a)
            c.put(crane(50, 3.6), x, y, rot=-math.degrees(a) + (180 if sgn > 0 else 0), shadow=0.6)
            c.light(x, y, 'nav')
        add(1, gc, 2)
    # the inner ring (gapped) and the core ring
    inner_gaps = [(0.3, 0.75), (2.4, 2.9), (4.3, 4.65)]
    def inner(c):
        a = 0.0
        for (g0, g1) in inner_gaps:
            c.put(arc_truss(R_IN, 15, a, g0, rail=2.0, bay=12, deck=True), C0, C0, shadow=0.55)
            a = g1
        c.put(arc_truss(R_IN, 15, a, 2 * math.pi, rail=2.0, bay=12, deck=True), C0, C0, shadow=0.55)
    add(1, inner)
    add(1, lambda c: c.put(arc_truss(R_CORE, 13, 0, 2 * math.pi, rail=2.0, bay=11, deck=True), C0, C0, shadow=0.55))
    # bracing: diagonals from a spoke to the frame between them (triangles), in most sectors
    for k, a in enumerate(PYLON_A):
        if k == 4:
            continue
        b = a + math.pi / 3
        def br(c, a=a, b=b):
            girder(c, *polar(R_IN, a), *polar(R_FRAME - 6, (a + b) / 2), 9, rail=1.6, bay=9, shadow=0.55)
            girder(c, *polar(R_IN, b), *polar(R_FRAME - 6, (a + b) / 2), 9, rail=1.6, bay=9, shadow=0.55)
        add(1, br)
    # scaffold towers starting round the hub
    blocks1 = []
    for k in range(10):
        a = float(rng.uniform(0, 2 * math.pi))
        r = float(rng.uniform(R_HUB + 8, R_CORE + 10))
        blocks1.append((r, a, float(rng.uniform(16, 28)), float(rng.uniform(12, 20)), int(rng.integers(1 << 30))))

    def blocks(c, bl):
        for (r, a, bw, bh, sd) in bl:
            x, y = polar(r, a)
            c.put(scaffold_block(bw, bh, 6.0, np.random.default_rng(sd), deck=0.38), x, y, rot=-math.degrees(a) - 90, shadow=0.6, mat='steel')
    add(1, lambda c: blocks(c, blocks1))

    # --- stage 2: Superstructure ---
    field, rr, aa = cell_field(rng, R_HUB - 2, R_FRAME - 9, 7, 40)
    work_a = [PYLON_A[0] + 0.5, PYLON_A[3] + 0.4]
    near = np.zeros_like(rr)
    for wa in work_a:
        d = np.abs(((aa - wa + math.pi) % (2 * math.pi)) - math.pi)
        near = np.maximum(near, np.exp(-(d / 0.8) ** 2))
    u = np.clip((rr - R_HUB) / (R_FRAME - R_HUB), 0, 1)
    dens = np.clip(1.08 - u * 1.1 + 0.35 * near, 0, 1)
    plate2 = (field < dens * 0.7).astype(F32)
    plate3 = (field < np.clip(dens * 0.55 + 0.6, 0, 0.92)).astype(F32)
    fresh = np.clip(plate3 - plate2, 0, 1)
    add(2, lambda c: c.put(skeleton, C0, C0, shadow=0.5))
    add(2, lambda c: c.put(shell, C0, C0, clip=plate2, emit=0.0, shadow=0.5, edge=1.0), 2)
    add(3, lambda c: c.put(shell, C0, C0, clip=plate2, emit=1.0, shadow=0.5, edge=1.0))
    # dense scaffold: blocks of scaffolding round the plating, packed near the hub / the working sectors, thinning out;
    # loose members bridging them
    blocks2 = []
    tries = 0
    while len(blocks2) < 95 and tries < 2000:
        tries += 1
        r = float(R_HUB + 10 + (R_FRAME - R_HUB - 20) * rng.random() ** 1.2)
        a = float(rng.uniform(0, 2 * math.pi))
        uu = (r - R_HUB) / (R_FRAME - R_HUB)
        nr = max(math.exp(-((((a - wa + math.pi) % (2 * math.pi)) - math.pi) / 0.8) ** 2) for wa in work_a)
        if rng.random() > min(1.0, 1.1 - uu + 0.45 * nr):
            continue
        blocks2.append((r, a, float(rng.uniform(14, 34) * (1.1 - 0.4 * uu)), float(rng.uniform(10, 24)), int(rng.integers(1 << 30))))
    add(2, lambda c: blocks(c, blocks2), 2)
    sticks = []
    for k in range(160):
        r = float(R_HUB + (R_FRAME - R_HUB) * rng.random() ** 1.1)
        a = float(rng.uniform(0, 2 * math.pi))
        uu = (r - R_HUB) / (R_FRAME - R_HUB)
        if rng.random() > 1.0 - 0.7 * uu:
            continue
        ln = float(rng.uniform(18, 40))
        w = float(rng.uniform(4.5, 7.0))
        if rng.random() < 0.5:
            p0, p1 = polar(r, a), polar(r + ln, a)
        else:
            p0, p1 = polar(r, a), polar(r, a + ln / r)
        cut = (0.62, 0.7) if rng.random() < 0.1 else None
        sticks.append((p0, p1, w, cut, float(rng.uniform(-0.12, 0.04))))

    def scaf(c, st):
        for (p0, p1, w, cut, tone) in st:
            girder(c, *p0, *p1, w, rail=1.2, bay=w + 1.5, cut=cut, shadow=0.45, tone=tone, mat='steel', gain=0.9)
    add(2, lambda c: scaf(c, sticks), 2)
    # lit work zones: floodlit pools on the structure, lamps and welding sparks
    zones = []
    for wa in work_a + [PYLON_A[2] + 0.3, PYLON_A[5] - 0.2]:
        for j in range(3):
            zones.append((float(rng.uniform(R_HUB + 30, R_FRAME - 40)), float(wa + rng.uniform(-0.35, 0.35))))

    def work(c, zs, flood=True):
        for (r, a) in zs:
            x, y = polar(r, a)
            if flood:
                c.flood(x, y, 26, (1.0, 0.72, 0.38), 0.55)
            c.light(x, y, 'work')
            for q in range(2):
                c.light(x + math.cos(q * 2.4 + r) * 8, y + math.sin(q * 2.4 + a) * 8, 'weld')
    add(2, lambda c: work(c, zones), 2)

    # --- stage 3: Fitting ---
    add(3, lambda c: c.put(shell, C0, C0, clip=fresh, emit=0.7, shadow=0.45, edge=1.0, tone=0.14))
    late_s = [t for t in sticks if plate3[int(t[0][1] * SS), int(t[0][0] * SS)] < 0.5]
    add(3, lambda c: scaf(c, late_s))
    add(3, lambda c: work(c, zones[::3]))
    # the last open cells: scaffolding over each, a few with a fresh panel being swung in
    gaps = []
    gm = (plate3 < 0.5) & (rr > R_HUB + 6) & (rr < R_FRAME - 14)
    for k in range(400):
        r = float(R_HUB + 12 + (R_FRAME - R_HUB - 30) * rng.random())
        a = float(rng.uniform(0, 2 * math.pi))
        x, y = polar(r, a)
        if gm[int(y * SS), int(x * SS)]:
            gaps.append((r, a, float(rng.uniform(16, 26)), float(rng.uniform(12, 20)), int(rng.integers(1 << 30))))
    gaps = gaps[:70]
    add(3, lambda c: blocks(c, gaps))
    for a in (work_a[0] + 0.35, work_a[1] - 0.3, PYLON_A[2] + 0.2):
        def pc(c, a=a):
            x, y = polar(R_IN + 20, a)
            c.put(crane(62, 3.8), x, y, rot=-math.degrees(a) - 60, shadow=0.6)
            c.light(x, y, 'nav')
        add(3, pc)
    def run(c):
        for k in range(36):
            a = k * 2 * math.pi / 36
            c.light(*polar(R_FRAME - 13, a), 'run')
            if k % 2 == 0:
                c.light(*polar(R_IN, a + 0.05), 'run')
    add(3, run)
    return ops


def render_ops(ops, stage):
    c = Canvas(FRAME)
    for op in ops:
        if op.s0 <= stage <= op.s1:
            op.fn(c)
    return c


# ---------------------------------------------------------------------------------------------------------------
# The Gilded Orbit: a casino planet (always night)
# ---------------------------------------------------------------------------------------------------------------

PS = 3                       # the planet's build resolution multiple (its own; the kitbash canvas keeps SS)
NB = FRAME * PS              # build canvas side
R_PL = 248.0                 # planet radius (frame px)
H_MAX = 16.0                 # tallest tower (frame px above the ground sphere)
PL_TILT = math.radians(17)   # the north pole tipped toward the viewer
PL_LEAN = math.radians(-12)  # ... and leaning left on screen
LAT0 = -math.radians(78)     # the map's southern edge
MW, MH = 4700, 2200          # city map texels (lon x lat): about one build px each at the equator
DLON = 2 * math.pi / MW
DLAT = (math.pi / 2 - LAT0) / MH
# It is always night on the Gilded Orbit: no sun. PL_LIGHT is the faint key (a moon, starlight) from the upper left
# that keeps the sphere's form: a cool sheen and a limb light on that side, the far side darker.
PL_LIGHT = np.array([-0.7, -0.6, 0.38])
PL_LIGHT = PL_LIGHT / np.linalg.norm(PL_LIGHT)


def planet_basis():
    """Rows: the planet frame's X (lon 0, facing the viewer), Y and Z (north) axes in view space (x right, y down,
    z toward the viewer)."""
    u = np.array([math.sin(PL_LEAN), -math.cos(PL_LEAN), 0.0])
    P = math.cos(PL_TILT) * u + math.sin(PL_TILT) * np.array([0, 0, 1.0])
    ez = np.array([0, 0, 1.0])
    X = ez - ez.dot(P) * P
    X /= np.linalg.norm(X)
    Y = np.cross(P, X)
    return np.stack([X, Y, P])


PL_M = planet_basis()


def view_dir(sx, sy):
    """View-space unit vector of the ground sphere under frame px (sx, sy) (on the limb if outside)."""
    dx, dy = (sx - C0) / R_PL, (sy - C0) / R_PL
    d2 = dx * dx + dy * dy
    if d2 >= 1:
        s = math.sqrt(d2)
        return np.array([dx / s, dy / s, 0.0])
    return np.array([dx, dy, math.sqrt(1 - d2)])


def limb_dir(deg):
    a = math.radians(deg)
    return np.array([math.cos(a), math.sin(a), 0.0])


def tangent_frame(v):
    """At view-space surface direction v: (east, north) unit vectors in view space (planet frame east / north)."""
    q = PL_M @ v
    lat = math.asin(max(-1, min(1, q[2])))
    lon = math.atan2(q[1], q[0])
    e = PL_M.T @ np.array([-math.sin(lon), math.cos(lon), 0])
    n = PL_M.T @ np.array([-math.sin(lat) * math.cos(lon), -math.sin(lat) * math.sin(lon), math.cos(lat)])
    return e, n


def affine_at(v, h=0.0):
    """The orthographic projection of the tangent plane at surface direction v (height h frame px): frame px of a
    point (e, n) (frame px along the planet's east / north there) = o + e * ex + n * ey. Returns (o, ex, ey) as
    2-vectors. (The planet's east runs screen-left here, so the flat art uses (a, b) = (west, south), which run
    screen right / down near the disc centre: M2 = [-ex, -ey].)"""
    e, n = tangent_frame(v)
    o = C0 + v[:2] * (R_PL + h)
    return o, e[:2], n[:2]


# ----------------------------------------------------------------------------------------------------------------
# The features (the roulette arenas, the docking port, the boulevards), placed on screen
# ----------------------------------------------------------------------------------------------------------------

FEAT = {
    # name: (screen x, y, radii (wheel, bezel, colonnade, ring road) frame px)
    'wheel_main': (287.3, 319.4, (40.0, 46.0, 51.0, 57.0)),
    'wheel_2': (473.3, 458.3, (23.0, 27.0, 30.5, 35.0)),
    'port': (381.4, 525.7, (16.0, 22.0, 26.0, 31.0)),
}
FEAT_V = {k: view_dir(x, y) for k, (x, y, _) in FEAT.items()}
# the boulevards: great circles through two view directions; width frame px
BLVDS = [
    (limb_dir(152), FEAT_V['wheel_main'], 8.0),     # the Strip: the west gate, the crown wheel, the north-east gate
    (FEAT_V['port'], FEAT_V['wheel_2'], 5.5),
    (FEAT_V['wheel_main'], FEAT_V['port'], 5.5),
]
BLVD_N = [np.cross(a, b) / np.linalg.norm(np.cross(a, b)) for (a, b, _) in BLVDS]


# the rooftop signs lying flat on dark pads: (name, screen x, y, rotation deg (in the tangent plane), pad half
# sizes (a, b) frame px, pad height frame px)
SIGNS = [
    ('jackpot', 458.3, 298.0, -14.0, (40.0, 9.5), 6.0),
    ('suit0', 332.2, 385.7, 0.0, (8.5, 8.5), 7.0),
    ('suit1', 345.0, 417.7, 0.0, (8.5, 8.5), 8.0),
    ('suit2', 357.9, 449.8, 0.0, (8.5, 8.5), 7.0),
    ('suit3', 371.8, 481.9, 0.0, (8.5, 8.5), 6.0),
    ('seven', 522.5, 366.4, 8.0, (13.0, 17.0), 7.0),
    ('dice', 417.7, 454.1, 20.0, (16.0, 9.0), 5.0),
    ('cherry', 204.0, 255.2, -10.0, (13.0, 13.0), 6.0),
    ('arrow', 437.0, 501.1, 0.0, (17.0, 7.0), 4.0),
]
SIGN_V = {s[0]: view_dir(s[1], s[2]) for s in SIGNS}


def _tangent_angle(v, toward_xy):
    """The tangent-plane angle (a west, b south) at v of the screen direction toward frame px toward_xy."""
    e, n = tangent_frame(v)
    M2 = np.stack([-e[:2], -n[:2]], -1)
    t = np.linalg.solve(M2, np.array(toward_xy) - (C0 + v[:2] * R_PL))
    return math.degrees(math.atan2(t[1], t[0]))


SIGNS = [sg if sg[0] not in ('jackpot', 'arrow') else
         (sg[0], sg[1], sg[2], _tangent_angle(SIGN_V[sg[0]], tuple(C0 + limb_dir(-28)[:2] * R_PL) if sg[0] == 'jackpot' else FEAT['port'][:2]), sg[4], sg[5])
         for sg in SIGNS]


def blvd_dist(v):
    """Frame px from view direction(s) v (..., 3) to each boulevard's centre line: (..., nb)."""
    return np.stack([np.abs(np.arcsin(np.clip(v @ nb, -1, 1))) * R_PL for nb in BLVD_N], -1)


# ----------------------------------------------------------------------------------------------------------------
# Materials, themes
# ----------------------------------------------------------------------------------------------------------------

MATS_C = ['gold', 'white', 'red', 'black', 'glass', 'copper', 'pink', 'cream']
RAMPS_C = {
    'gold': RAMPS['gold'],
    'white': np.array([[.06, .058, .055], [.2, .19, .18], [.42, .41, .39], [.62, .6, .57], [.78, .76, .72], [.89, .87, .83], [.97, .96, .93]]),
    'red': RAMPS['red'],
    'black': np.array([[.008, .01, .016], [.025, .03, .045], [.05, .06, .085], [.09, .1, .14], [.16, .17, .22], [.28, .29, .34], [.5, .5, .55]]),
    'glass': np.array([[.01, .03, .045], [.03, .09, .12], [.06, .18, .22], [.12, .3, .34], [.22, .44, .48], [.4, .62, .64], [.7, .85, .86]]),
    'copper': RAMPS['copper'],
    'pink': np.array([[.05, .015, .03], [.18, .05, .1], [.4, .13, .24], [.62, .26, .4], [.8, .42, .55], [.9, .6, .7], [.97, .82, .88]]),
    'cream': np.array([[.05, .045, .03], [.18, .15, .1], [.4, .35, .25], [.6, .54, .4], [.77, .71, .56], [.88, .83, .7], [.96, .93, .84]]),
}
RAMPS_C.update({
    # the pirate den's decay: tarnished gold, rust, grime, dirty red lacquer, murky glass
    'tarnish': np.array([[.03, .025, .01], [.1, .08, .035], [.21, .17, .07], [.33, .27, .12], [.44, .37, .18], [.54, .46, .25], [.66, .58, .36]]),
    'rust': np.array([[.03, .015, .008], [.1, .045, .02], [.22, .1, .045], [.36, .17, .07], [.5, .25, .11], [.62, .34, .16], [.74, .46, .26]]),
    'grime': np.array([[.025, .024, .022], [.08, .075, .065], [.16, .15, .13], [.26, .24, .2], [.36, .33, .28], [.46, .42, .36], [.58, .54, .47]]),
    'rustred': np.array([[.03, .008, .006], [.1, .025, .018], [.2, .05, .035], [.32, .09, .06], [.42, .14, .09], [.52, .2, .13], [.62, .3, .2]]),
    'murk': np.array([[.01, .015, .015], [.03, .045, .045], [.06, .085, .08], [.1, .13, .12], [.15, .18, .16], [.22, .25, .22], [.32, .35, .3]]),
    'plate': np.array([[.02, .022, .026], [.07, .075, .085], [.15, .16, .18], [.24, .25, .27], [.33, .34, .36], [.42, .43, .45], [.54, .55, .57]]),
})
MI = {m: k for k, m in enumerate(MATS_C)}
THEMES = [
    ('gold', [('gold', .55), ('cream', .2), ('red', .13), ('white', .12)]),
    ('marble', [('white', .5), ('gold', .32), ('cream', .18)]),
    ('gold2', [('gold', .5), ('white', .25), ('black', .1), ('red', .15)]),
    ('lacquer', [('red', .45), ('gold', .4), ('black', .15)]),
    ('glass', [('black', .4), ('gold', .35), ('glass', .25)]),
    ('flamingo', [('pink', .35), ('cream', .3), ('white', .2), ('gold', .15)]),
    ('bronze', [('copper', .4), ('gold', .4), ('black', .2)]),
]


# The two looks of the frame: the Gilded Orbit, and the same planet as a pirate den (the smugglers' front found out:
# rust and grime over the gold, most lights out, the signs mostly dark, the few that work failing). Build-time state:
# build_casino sets LK for the look it builds (ramp_c, the lighting, the items and the neon read it).
LOOKS = {
    'casino': dict(
        pirate=False, mats={},
        moon=np.array([0.26, 0.3, 0.46], F32),          # the faint cool key
        flood=np.array([0.56, 0.34, 0.17], F32),        # the city's warm light on its own roofs and walls
        amb=np.array([0.025, 0.022, 0.035], F32),
        far=0.62,                                       # the city's light on the far side (form shading), share of the near
        em_street=1.4, em_roof=1.25, em_win=1.25,
        haze=((1.0, 0.3, 0.66), (1.0, 0.68, 0.36), (0.8, 0.72, 1.0)), haze_k=0.45,
        grade=dict(sat=1.3, warm=(1.02, 1.04, 0.8), gain=1.06),
        face=1.0, glass=1.0, gate_fill=1.0,
        spin={'wheel_main': 0.32, 'wheel_2': -0.5}, jerk={}, wheel_spin=0.07, ball=True,
        lane=(8.0, 16.0, 1.0), keep={},
    ),
    'casino-pirate': dict(
        pirate=True,
        mats={'gold': 'tarnish', 'copper': 'rust', 'white': 'grime', 'cream': 'grime', 'pink': 'rustred', 'red': 'rustred', 'glass': 'murk'},
        moon=np.array([0.17, 0.19, 0.22], F32),
        flood=np.array([0.42, 0.19, 0.08], F32),        # a dim, dirty sodium glow
        amb=np.array([0.02, 0.018, 0.016], F32),
        far=0.5,
        em_street=0.85, em_roof=0.8, em_win=1.0,
        haze=((0.7, 0.2, 0.12), (0.72, 0.36, 0.14), (0.42, 0.4, 0.38)), haze_k=0.5,
        grade=dict(sat=0.9, warm=(1.05, 0.9, 0.72), gain=0.96),
        face=0.55, glass=0.5, gate_fill=0.42,
        spin={'wheel_main': 0.22, 'wheel_2': 0.0}, jerk={'wheel_main': 2.6}, wheel_spin=None, ball=False,
        lane=(24.0, 10.0, 0.55), keep={'bulb': 0.22, 'gold': 0.25, 'nav': 0.6, 'white': 0.3},
    ),
}
LK = LOOKS['casino']


def set_look(name):
    global LK
    LK = LOOKS[name]


def ramp_c(name, v):
    c = RAMPS_C[LK['mats'].get(name, name)]
    return np.stack([np.interp(v, RX, c[:, k]) for k in range(3)], axis=-1)


WIN_COLS = np.array([[1.0, 0.78, 0.42], [1.0, 0.9, 0.7], [1.0, 0.66, 0.3], [0.95, 0.95, 1.0], [1.0, 0.55, 0.75], [0.55, 0.9, 1.0]])
LED_COLS = np.array([[1.0, 0.2, 0.75], [0.25, 0.9, 1.0], [1.0, 0.8, 0.25], [0.65, 0.35, 1.0], [0.3, 1.0, 0.5], [1.0, 0.3, 0.2]])
SODIUM = np.array([1.0, 0.58, 0.22])
# the den's windows and LED bands: dim sodium, dirty orange and red, a sickly green-white
WIN_COLS_DEN = np.array([[0.85, 0.45, 0.15], [0.7, 0.38, 0.14], [0.6, 0.2, 0.1], [0.75, 0.65, 0.4], [0.5, 0.55, 0.3], [0.85, 0.3, 0.12]])
LED_COLS_DEN = np.array([[0.7, 0.15, 0.1], [0.3, 0.6, 0.5], [0.8, 0.45, 0.12], [0.5, 0.25, 0.35], [0.4, 0.6, 0.25], [0.8, 0.2, 0.1]])

# street / special ids (negative lot ids)
ST_MINOR, ST_AVE, ST_BLVD, ST_ALLEY, ST_PLAZA = -1, -2, -3, -4, -5
ID_FEAT = {'wheel_main': -10, 'wheel_2': -11, 'port': -12}   # the floor inside each feature's bezel


def noise3(rng, n=6, scale=3.0):
    """A smooth random field over the unit sphere: random 3D plane waves (seamless). f(planet-frame vectors) -> ~0..1."""
    ks = rng.normal(size=(n, 3)) * scale
    ph = rng.uniform(0, 2 * math.pi, n)
    amp = rng.uniform(0.5, 1.0, n)

    def f(v):
        s = np.zeros(v.shape[:-1])
        for k in range(n):
            s = s + amp[k] * np.sin(v @ ks[k] + ph[k])
        return 0.5 + 0.5 * s / amp.sum() * 1.6

    return f


class CityMap:
    def __init__(self):
        self.H = np.zeros((MH, MW), F32)            # height above the ground sphere (build px)
        self.ID = np.full((MH, MW), ST_MINOR, np.int32)
        self.ALB = np.zeros((MH, MW, 3), np.float16)  # roof / ground albedo
        self.EM = np.zeros((MH, MW, 3), np.float16)   # roof / ground emission
        self.lat = (math.pi / 2 - (np.arange(MH) + 0.5) * DLAT).astype(F32)
        self.lon = (-math.pi + (np.arange(MW) + 0.5) * DLON).astype(F32)
        self.lots = []

    def rows(self, la0, la1):
        i0 = int(math.ceil((math.pi / 2 - la1) / DLAT - 0.5))
        i1 = int(math.floor((math.pi / 2 - la0) / DLAT - 0.5)) + 1
        return max(0, i0), min(MH, i1)

    def cols(self, lo0, lo1):
        j0 = int(math.ceil((lo0 + math.pi) / DLON - 0.5))
        j1 = int(math.floor((lo1 + math.pi) / DLON - 0.5)) + 1
        return max(0, j0), min(MW, j1)

    def dirs(self, i0, i1, j0, j1):
        """View-space unit vectors of a texel block (h, w, 3)."""
        lat = self.lat[i0:i1, None]
        lon = self.lon[None, j0:j1]
        q = np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat) + 0 * lon], -1)
        return q @ PL_M  # rows of PL_M are planet axes in view space: v = q0 X + q1 Y + q2 Z


def dir_of(lon, lat):
    q = np.array([math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)])
    return PL_M.T @ q


def visible(lon, lat, margin=0.12):
    return dir_of(lon, lat)[2] > -margin


def roof_kit(root, rng):
    """Stock plating crops (levelled shading, 32 stock px) for the roof detail: 1 stock px per frame px."""
    kit = []
    for (rel, size) in GOLD_SRC + PLATE_SRC[:4]:
        for p in opaque_crops(root, rel, 32, 4, rng):
            L = p.L.astype(F32)
            kit.append((L - L.mean()) / max(1e-3, L.std()))
    return kit


def build_city(root, seed='casino-city'):
    rng = seeded(seed)
    cm = CityMap()
    R = R_PL
    ctx = dict(
        rng=rng,
        dist=noise3(rng, 7, 2.6),       # districts: how tall
        flash=noise3(rng, 5, 4.0),      # how gaudy
        theme=noise3(rng, 5, 1.9),      # which palette (broad districts, like continents)
        kit=roof_kit(root, rng),
    )
    cm.ALB[:] = (0.03, 0.029, 0.032)
    la = math.pi / 2 - math.radians(4.0)
    rows = []
    while la > LAT0:
        depth = float(rng.uniform(11, 16)) / R
        sw = (4.2 if rng.random() < 0.25 else 2.0) / R
        rows.append((la - depth, la, sw))
        la -= depth + sw
    for (b0, b1, sw) in rows:
        i0, i1 = cm.rows(b0 - sw, b0)
        paint_street_band(cm, i0, i1, b0 - sw, b0, ST_AVE if sw > 3 / R else ST_MINOR)
    i0, i1 = cm.rows(math.pi / 2 - math.radians(4.0), math.pi / 2)
    cm.ID[i0:i1] = ST_PLAZA
    for (b0, b1, sw) in rows:
        lac = (b0 + b1) / 2
        x = -math.pi
        while x < math.pi - 1e-6:
            bw = float(rng.uniform(14, 28))
            msw = 4.2 if rng.random() < 0.16 else 2.0
            dlo = bw / (R * math.cos(lac))
            slo = msw / (R * math.cos(lac))
            x1 = min(math.pi, x + dlo)
            if math.pi - x1 < dlo * 0.4:
                x1 = math.pi
            s1 = min(math.pi, x1 + slo)
            if visible((x + x1) / 2, lac, 0.3):
                j0, j1 = cm.cols(x1, s1)
                i0, i1 = cm.rows(b0, b1)
                paint_street_rect(cm, i0, i1, j0, j1, x1, s1, ST_AVE if msw > 3 else ST_MINOR)
                block(cm, ctx, x, x1, b0, b1)
            x = s1
    carve_boulevards(cm)
    for name in FEAT:
        carve_feature(cm, name)
    for sg in SIGNS:
        carve_pad(cm, sg)
    return cm


def paint_street_band(cm, i0, i1, la0, la1, kind):
    if i1 <= i0:
        return
    lat = cm.lat[i0:i1, None]
    c = (lat - (la0 + la1) / 2) / max(1e-6, (la1 - la0) / 2)
    along = cm.lon[None, :] * R_PL * np.cos(lat)
    cm.ID[i0:i1] = kind
    cm.EM[i0:i1] = street_light(c, along, kind).astype(np.float16)


def paint_street_rect(cm, i0, i1, j0, j1, lo0, lo1, kind):
    if i1 <= i0 or j1 <= j0:
        return
    lat = cm.lat[i0:i1, None]
    lon = cm.lon[None, j0:j1]
    c = (lon - (lo0 + lo1) / 2) / max(1e-6, (lo1 - lo0) / 2) + 0 * lat
    along = lat * R_PL + 0 * lon
    cm.ID[i0:i1, j0:j1] = kind
    cm.EM[i0:i1, j0:j1] = street_light(c, along, kind).astype(np.float16)


def street_light(c, along, kind):
    """Emission of a street texel: c -1..1 across it, `along` frame px along it. Sodium lamps along both kerbs and a
    soft pool between; avenues and boulevards carry traffic (white headlights one way, red tail lights the other)."""
    ac = np.abs(c)
    if kind == ST_MINOR:
        # the back streets stay dark between the blocks (the lit buildings and signs pop against them): a faint pool,
        # a sodium lamp now and then
        pool = 0.025 + 0.05 * np.exp(-((ac - 0.8) / 0.25) ** 2)
        lamp = ((along / 6.3) % 1 < 0.16) & (ac > 0.62)
        return (pool + 0.55 * lamp)[..., None] * SODIUM
    pool = (0.05 if kind == ST_AVE else 0.16) + (0.1 if kind == ST_AVE else 0.22) * np.exp(-((ac - 0.8) / 0.25) ** 2)
    lamp = ((along / 3.6) % 1 < 0.24) & (ac > 0.62)
    e = (pool + 0.65 * lamp)[..., None] * SODIUM
    if kind in (ST_AVE, ST_BLVD):
        lanes = (0.3,) if kind == ST_AVE else (0.18, 0.42)
        for lc in lanes:
            lane_w = np.exp(-((c - lc) / 0.1) ** 2)
            lane_r = np.exp(-((c + lc) / 0.1) ** 2)
            dash_w = 0.3 + 0.7 * ((np.sin(along * 1.7 + lc * 9) * np.sin(along * 0.37 + 1.3)) > -0.2)
            dash_r = 0.3 + 0.7 * ((np.sin(along * 1.3 + 2 + lc * 5) * np.sin(along * 0.29)) > -0.2)
            e = e + (lane_w * dash_w)[..., None] * np.array([1.0, 0.95, 0.85]) * 0.9
            e = e + (lane_r * dash_r)[..., None] * np.array([1.0, 0.14, 0.08]) * 0.8
    if kind == ST_BLVD:
        # the Strip's median: gold lamps, and the glare off the resorts' signs
        med = np.exp(-(c / 0.06) ** 2) * (0.6 + 0.4 * ((along / 2.2) % 1 < 0.5))
        e = e + med[..., None] * np.array([1.0, 0.82, 0.45]) * 0.9
        e = e * 0.95 + 0.06
    return e


DISTRICT_GAP = 0.055   # share of a theme bin, each side of its edge, left as dark yards between the districts


def dark_yard(cm, lo0, lo1, la0, la1):
    """A block between two districts left to low, unlit service sheds and yards (dark roofs, a dim lamp here and
    there): the dark seams that set the districts apart."""
    i0, i1 = cm.rows(la0, la1)
    j0, j1 = cm.cols(lo0, lo1)
    if i1 <= i0 or j1 <= j0:
        return
    lat = cm.lat[i0:i1, None]
    lon = cm.lon[None, j0:j1]
    u = (lon - lo0) * R_PL * np.cos(lat)
    v = (lat - la0) * R_PL + 0 * lon
    w, d = (lo1 - lo0) * R_PL * math.cos((la0 + la1) / 2), (la1 - la0) * R_PL
    shed = ((u % 6.5) > 0.9) & ((v % 5.5) > 0.9) & (u > 0.8) & (u < w - 0.8) & (v > 0.8) & (v < d - 0.8)
    ridge = 0.5 + 0.5 * np.cos((u % 6.5) / 6.5 * 2 * math.pi * 3)
    dots = (((u / 5.3) % 1) < 0.12) & (((v / 4.7) % 1) < 0.14) & ((np.floor(u / 5.3) + np.floor(v / 4.7)) % 3 == 0) & ~shed
    cm.H[i0:i1, j0:j1] = np.where(shed, (0.7 + 0.3 * ridge) * PS, 0)
    cm.ALB[i0:i1, j0:j1] = np.where(shed[..., None], ramp_c('black', 0.38 + 0.12 * ridge), np.array([0.02, 0.022, 0.02])).astype(np.float16)
    cm.EM[i0:i1, j0:j1] = (dots[..., None] * SODIUM * 0.3).astype(np.float16)
    cm.ID[i0:i1, j0:j1] = ST_PLAZA


def block(cm, ctx, lo0, lo1, la0, la1):
    rng = ctx['rng']
    R = R_PL
    lac = (la0 + la1) / 2
    k = R * math.cos(lac)
    w = (lo1 - lo0) * k
    d = (la1 - la0) * R
    v = dir_of((lo0 + lo1) / 2, lac)
    q = PL_M @ v
    tall = float(np.clip(ctx['dist'](q[None])[0], 0, 1))
    gaud = float(np.clip(ctx['flash'](q[None])[0], 0, 1))
    bd = blvd_dist(v[None])[0].min()
    strip = bd < 22
    if strip:
        gaud = max(gaud, 0.85)
        tall = max(tall, 0.75)
    th = ctx['theme'](q[None])[0]
    tb = float(np.clip(th, 0, 0.999)) * len(THEMES)
    if not strip and min(tb % 1, 1 - tb % 1) < DISTRICT_GAP and feature_clear(v, 6):
        dark_yard(cm, lo0, lo1, la0, la1)
        return
    ti = int(np.clip(th, 0, 0.999) * len(THEMES))
    if rng.random() < 0.07:
        ti = int(rng.integers(len(THEMES)))
    pal = THEMES[ti][1]
    lots = []

    def split(u0, u1, v0, v1, depth):
        uw, vd = u1 - u0, v1 - v0
        lim = rng.uniform(5, 11)
        if depth > 0 and (max(uw, vd) < lim or depth > 4):
            lots.append((u0, u1, v0, v1))
            return
        if uw >= vd:
            m = u0 + uw * rng.uniform(0.32, 0.68)
            split(u0, m, v0, v1, depth + 1)
            split(m, u1, v0, v1, depth + 1)
        else:
            m = v0 + vd * rng.uniform(0.32, 0.68)
            split(u0, u1, v0, m, depth + 1)
            split(u0, u1, m, v1, depth + 1)

    mega = rng.random() < (0.14 + 0.3 * strip) * (0.5 + gaud)
    if mega:
        lots.append((0, w, 0, d))
    else:
        split(0, w, 0, d, 0)
    for (u0, u1, v0, v1) in lots:
        building(cm, ctx, lo0 + u0 / k, lo0 + u1 / k, la0 + v0 / R, la0 + v1 / R, tall, gaud, pal, mega)


def feature_clear(v, pad):
    """True when view direction v keeps clear of every feature (ring road + pad frame px)."""
    for name, (_, _, rr) in FEAT.items():
        if math.acos(max(-1, min(1, float(v @ FEAT_V[name])))) * R_PL < rr[3] + pad:
            return False
    return True


def carve_pad(cm, sg):
    """A dark podium roof under a rooftop sign (black glass, a gold rim), its walls lit like the rest."""
    name, sx, sy, rot, (ha, hb), hp = sg
    R = R_PL
    fv = SIGN_V[name]
    q = PL_M @ fv
    lat_c = math.asin(q[2])
    lon_c = math.atan2(q[1], q[0])
    ang = (math.hypot(ha, hb) + 4) / R
    i0, i1 = cm.rows(lat_c - ang, lat_c + ang)
    dlo = ang / max(0.05, math.cos(lat_c))
    j0, j1 = cm.cols(lon_c - dlo, lon_c + dlo)
    v = cm.dirs(i0, i1, j0, j1)
    e, n = tangent_frame(fv)
    a = -(v @ e) * R
    b = -(v @ n) * R
    cr, sr = math.cos(math.radians(rot)), math.sin(math.radians(rot))
    u = a * cr + b * sr
    w = -a * sr + b * cr
    pad = (np.abs(u) < ha + 2.5) & (np.abs(w) < hb + 2.5)
    rim = pad & ((np.abs(u) > ha + 1.3) | (np.abs(w) > hb + 1.3))
    H = cm.H[i0:i1, j0:j1]
    H[pad] = hp * PS
    cm.ID[i0:i1, j0:j1][pad] = ST_PLAZA
    alb = np.where(rim[..., None], ramp_c('gold', 0.75), ramp_c('black', 0.32 + 0.05 * np.sin(u * 2.1)))
    cm.ALB[i0:i1, j0:j1][pad] = alb[pad].astype(np.float16)
    cm.EM[i0:i1, j0:j1][pad] = 0


def building(cm, ctx, lo0, lo1, la0, la1, tall, gaud, pal, mega=False):
    rng = ctx['rng']
    R = R_PL
    i0, i1 = cm.rows(la0, la1)
    j0, j1 = cm.cols(lo0, lo1)
    if i1 <= i0 or j1 <= j0:
        return
    lac, loc = (la0 + la1) / 2, (lo0 + lo1) / 2
    half_diag = math.hypot((lo1 - lo0) * R * math.cos(lac), (la1 - la0) * R) / 2
    if not feature_clear(dir_of(loc, lac), half_diag):
        return
    lid = len(cm.lots)
    lat = cm.lat[i0:i1, None]
    lon = cm.lon[None, j0:j1]
    lu = (lon - loc) * R * np.cos(lat) * PS
    lv = (lat - lac) * R * PS + 0 * lon
    hw = (lo1 - lo0) * R * math.cos(lac) / 2 * PS
    hd = (la1 - la0) * R / 2 * PS
    sb = float(rng.uniform(0.35, 0.8)) * PS
    aw, ad = hw - sb, hd - sb
    if aw < 1.5 or ad < 1.5:
        return
    t = tall ** 1.6
    base_h = 1.2 + 9.0 * t * float(rng.uniform(0.4, 1.15))
    if rng.random() < 0.07 + 0.25 * t:
        base_h *= float(rng.uniform(1.3, 1.8))
    if mega:
        base_h = max(base_h, float(rng.uniform(5, 9)))
    base_h = min(H_MAX - 0.5, base_h)
    top = base_h * PS
    names, ws = zip(*pal)
    ws = np.array(ws) ** 2.4
    mat = MI[names[int(rng.choice(len(names), p=ws / ws.sum()))]]
    acc = MI[names[int(rng.integers(len(names)))]]
    kind = 'box'
    r = rng.random()
    small = min(aw, ad)
    if mega:
        kind = ['podium_y', 'pyramid', 'dome', 'podium_tower', 'podium_y'][int(rng.integers(5))]
    elif r < 0.1 and small > 6:
        kind = 'cyl'
    elif r < 0.16 and small > 8:
        kind = 'dome'
    elif r < 0.2 and small > 9:
        kind = 'pyramid'
    elif r < 0.34 and small > 7:
        kind = 'podium_tower'
    elif r < 0.44 and base_h < 4.5:
        kind = 'arcade'
    elif r < 0.46:
        kind = 'pool'
    h = np.zeros(lu.shape, F32)
    inside = (np.abs(lu) < aw) & (np.abs(lv) < ad)
    roofL = np.full(lu.shape, 0.6, F32)
    em = np.zeros(lu.shape + (3,), F32)
    rmat = np.full(lu.shape, mat, np.int8)
    led = int(rng.integers(len(LED_COLS))) if rng.random() < 0.2 + 0.5 * gaud else -1
    if kind == 'box':
        h = np.where(inside, top, 0)
        if rng.random() < 0.45 and small > 5:
            k2 = float(rng.uniform(0.45, 0.75))
            t2 = top * float(rng.uniform(1.2, 1.6))
            in2 = (np.abs(lu) < aw * k2) & (np.abs(lv) < ad * k2)
            h = np.where(in2, min(t2, H_MAX * PS), h)
            if rng.random() < 0.5:
                in3 = (np.abs(lu) < aw * k2 * 0.5) & (np.abs(lv) < ad * k2 * 0.5)
                h = np.where(in3, min(t2 * 1.15, H_MAX * PS), h)
        edge = inside & ((np.abs(lu) > aw - 0.9) | (np.abs(lv) > ad - 0.9))
        roofL = np.where(edge, 0.85, roofL)
        if led >= 0 and rng.random() < 0.5:
            em = np.where(edge[..., None], LED_COLS[led] * 0.7, em)
        # rooftop plant (dark boxes) and a lit atrium now and then
        if small > 6 and rng.random() < 0.5:
            bx, by = float(rng.uniform(-0.4, 0.4)) * aw, float(rng.uniform(-0.4, 0.4)) * ad
            hv = (np.abs(lu - bx) < aw * 0.22) & (np.abs(lv - by) < ad * 0.18)
            roofL = np.where(hv & inside, 0.3, roofL)
        if small > 7 and rng.random() < 0.18:
            at = (np.abs(lu) < aw * 0.3) & (np.abs(lv) < ad * 0.3)
            em = np.where(at[..., None], np.array([1.0, 0.82, 0.5]) * 0.55, em)
            rmat = np.where(at, MI['glass'], rmat)
    elif kind == 'cyl':
        rad = small
        rho = np.hypot(lu, lv)
        inside = rho < rad
        h = np.where(inside, top, 0)
        crown = inside & (rho > rad * 0.78)
        h = np.where(crown, top + 1.0, h)
        em = np.where((crown & (rho < rad * 0.86))[..., None], WIN_COLS[int(rng.integers(3))] * 0.9, em)
        rmat = np.where(crown, MI['gold'], rmat)
    elif kind == 'dome':
        rad = small
        rho = np.hypot(lu, lv) / rad
        inside = rho < 1
        drum = top * 0.35
        h = np.where(inside, drum + rad * 0.55 * np.sqrt(np.clip(1 - rho * rho, 0, 1)), 0)
        ribs = (np.abs(((np.arctan2(lv, lu) / (2 * math.pi)) * 16) % 1 - 0.5) > 0.42) & inside
        roofL = np.where(ribs, 0.8, 0.55)
        dm = MI[['glass', 'gold', 'white', 'gold'][int(rng.integers(4))]]
        rmat = np.where(inside, dm, rmat)
        rmat = np.where(ribs, MI['gold'], rmat)
        if dm == MI['glass'] or rng.random() < 0.4:
            em = np.where((inside & ~ribs)[..., None], np.array([1.0, 0.75, 0.4]) * 0.45 * (1.2 - rho)[..., None], em)
    elif kind == 'pyramid':
        hp = min(H_MAX * PS, max(top, small * 0.9))
        m = np.maximum(np.abs(lu) / aw, np.abs(lv) / ad)
        h = np.where(inside, hp * (1 - m) + 1.0, 0)
        rmat = np.where(inside, MI['black'], rmat)
        ridge = inside & (np.abs(np.abs(lu) / aw - np.abs(lv) / ad) < 0.035)
        rmat = np.where(ridge, MI['gold'], rmat)
        roofL = np.where(ridge, 0.9, 0.62)
        tip = inside & (m < 0.07)
        em = np.where(tip[..., None], np.array([1.0, 0.95, 0.85]) * 1.5, em)
    elif kind in ('podium_tower', 'podium_y'):
        pod = max(1.5 * PS, top * 0.28)
        h = np.where(inside, pod, 0)
        edge = inside & ((np.abs(lu) > aw - 1.0) | (np.abs(lv) > ad - 1.0))
        if led >= 0:
            em = np.where(edge[..., None], LED_COLS[led] * 0.75, em)
        if kind == 'podium_tower':
            ox = float(rng.uniform(-0.3, 0.3)) * aw
            oy = float(rng.uniform(-0.3, 0.3)) * ad
            tw, td = aw * float(rng.uniform(0.35, 0.55)), ad * float(rng.uniform(0.35, 0.55))
            tin = (np.abs(lu - ox) < tw) & (np.abs(lv - oy) < td)
            h = np.where(tin, top * 1.25, h)
            rmat = np.where(tin, mat, acc)
            pool = inside & ~dilate(tin, 2) & (np.abs(lu + ox) < aw * 0.35) & (np.abs(lv + oy) < ad * 0.3)
        else:
            a0 = float(rng.uniform(0, 2 * math.pi))
            ww = small * 0.2
            L = small * 0.92
            yin = np.zeros(lu.shape, bool)
            stepped = np.zeros(lu.shape, F32)
            for kk in range(3):
                a = a0 + kk * 2 * math.pi / 3
                ca, sa = math.cos(a), math.sin(a)
                al = lu * ca + lv * sa
                ac = -lu * sa + lv * ca
                wing = (np.abs(ac) < ww) & (al > -ww) & (al < L)
                yin |= wing
                stepped = np.where(wing, np.maximum(stepped, 1 - np.floor(np.clip(al / L, 0, 0.999) * 4) * 0.12), stepped)
            hy = min(H_MAX * PS, top * 1.4)
            h = np.where(yin, hy * stepped, h)
            core = np.hypot(lu, lv) < ww * 1.2
            h = np.where(core, hy + 1.5, h)
            rmat = np.where(yin, mat, acc)
            pool = inside & ~dilate(yin, 3) & (np.hypot(lu, lv) > L * 0.6) & (np.hypot(lu, lv) < L * 0.9)
        em = np.where(pool[..., None], np.array([0.15, 0.75, 0.85]) * 0.9, em)
        rmat = np.where(pool, MI['glass'], rmat)
        roofL = np.where(pool, 0.75, roofL)
    elif kind == 'arcade':
        h0 = max(1.0 * PS, top * 0.6)
        p = 2.4 * PS
        ph = ((lu if aw > ad else lv) % p) / p
        barrel = np.sqrt(np.clip(1 - (2 * ph - 1) ** 2, 0, 1))
        h = np.where(inside, h0 + 0.8 * PS * barrel, 0)
        sky = inside & (np.abs(ph - 0.5) < 0.12)
        em = np.where(sky[..., None], np.array([1.0, 0.8, 0.45]) * 0.8, em)
        rmat = np.where(inside, acc, rmat)
        roofL = np.where(inside, 0.35 + 0.45 * barrel, roofL)
    elif kind == 'pool':
        h = np.where(inside, 0.3 * PS, 0)
        water = inside & (np.abs(lu) < aw - 1.2) & (np.abs(lv) < ad - 1.2)
        em = np.where(water[..., None], np.array([0.1, 0.62, 0.75]) * (0.7 + 0.3 * np.sin(lu * 0.9) * np.sin(lv * 0.7))[..., None], em)
        rmat = np.where(water, MI['glass'], MI['white'])
        fj = (np.hypot((lu % (3 * PS)) - 1.5 * PS, (lv % (3 * PS)) - 1.5 * PS) < 0.55 * PS) & water
        em = np.where(fj[..., None], np.array([0.9, 0.95, 1.0]), em)
    sel = h > 0
    reg = (slice(i0, i1), slice(j0, j1))
    cm.H[reg] = np.where(sel, h, 0)
    cm.ID[reg] = np.where(sel, lid, ST_ALLEY)
    # roof albedo: the material ramps over a stock plating crop's detail (1 stock px per frame px)
    kit = ctx['kit']
    tile = kit[int(rng.integers(len(kit)))]
    ox, oy = int(rng.integers(32)), int(rng.integers(32))
    ti = ((lv / PS).astype(np.int32) + oy) % 32
    tj = ((lu / PS).astype(np.int32) + ox) % 32
    det = roofL + 0.09 * np.clip(tile[ti, tj], -2.5, 2.5)
    alb = np.zeros(lu.shape + (3,), F32)
    for mi in np.unique(rmat[sel]):
        mm = sel & (rmat == mi)
        alb[mm] = ramp_c(MATS_C[mi], np.clip(det[mm], 0, 1))
    alb = np.where(sel[..., None], alb, np.array([0.025, 0.024, 0.027]))
    cm.ALB[reg] = alb.astype(np.float16)
    aem = np.where(sel[..., None], 0, SODIUM * 0.015)
    cm.EM[reg] = (em + aem).astype(np.float16)
    lit = float(np.clip(rng.uniform(0.45, 0.95) * (0.7 + 0.5 * gaud), 0.3, 0.97))
    cm.lots.append(dict(lo=loc, la=lac, mat=int(mat), top=float(h.max()), lit=lit, wcol=int(rng.integers(len(WIN_COLS))),
                        led=led, ledk=int(rng.integers(3, 7)), fh=float(rng.uniform(1.8, 2.4)), kind=kind, box=(i0, i1, j0, j1)))


def decay_city(cm):
    """The pirate den: the same city run down. Most windows dark and the LED bands off; most roofs' lights out; a
    few towers collapsed to stumps of rubble, a few gutted (the shell standing, burnt out inside, embers); rust and
    soot over everything; scorch marks; patched plating on the roofs; half the street lamps out, the rest dim."""
    rng = seeded('casino-pirate-decay')
    nl = len(cm.lots)
    for l in cm.lots:
        l['lit'] *= 0.22
        if rng.random() < 0.88:
            l['led'] = -1
    tall = [lid for lid, l in enumerate(cm.lots) if l['top'] > 5 * PS and l['kind'] in ('box', 'cyl', 'podium_tower', 'podium_y')]
    order = rng.permutation(len(tall))
    ncol, ngut = int(len(tall) * 0.09), int(len(tall) * 0.07)
    for n, idx in enumerate(order[:ncol + ngut]):
        lid = tall[idx]
        l = cm.lots[lid]
        i0, i1, j0, j1 = l['box']
        reg = (slice(i0, i1), slice(j0, j1))
        mine = cm.ID[reg] == lid
        if not mine.any():
            continue
        H, ALB, EM = cm.H[reg], cm.ALB[reg], cm.EM[reg]
        if n < ncol:
            f = float(rng.uniform(0.2, 0.5))
            rub = value_noise(rng, i1 - i0, j1 - j0, 2) * 1.8 * PS
            H[mine] = (H * f + rub)[mine]
            ALB[mine] = (ALB.astype(F32) * 0.3 + np.array([0.035, 0.03, 0.026], F32))[mine]
            EM[mine] = 0
            l['top'] *= f
            l['lit'] = 0.02
        else:
            inner = mine & ~dilate(~mine, 2)
            H[inner] = (H * 0.3)[inner]
            ALB[inner] = np.array([0.03, 0.025, 0.02], np.float16)
            EM[inner] = 0
            embers = inner & (rng.random(inner.shape) < 0.03)
            EM[embers] = np.array([0.9, 0.3, 0.06], np.float16)
            l['lit'] = 0.04
    kill = np.concatenate([rng.random(nl) < 0.72, [False]])
    rustn = fbm(rng, MH, MW, 60, 3).astype(F32)
    sootn = fbm(rng, MH, MW, 36, 3).astype(F32)
    for i0 in range(0, MH, 200):
        i1 = min(MH, i0 + 200)
        ALB = cm.ALB[i0:i1].astype(F32)
        EM = cm.EM[i0:i1].astype(F32)
        ID = cm.ID[i0:i1]
        lot = ID >= 0
        ii, jj = np.mgrid[i0:i1, 0:MW]
        out = ((((ii // 7) * 73856093) ^ ((jj // 7) * 19349663)) & 1023) < 460
        k = np.where(lot, np.where(kill[np.where(lot, ID, nl)], 0.04, 0.5), np.where(ID == ST_PLAZA, 0.3, 0.45))
        k = np.where(~lot & out, 0.06, k)
        lum = (ALB @ LUM.astype(F32))[..., None]
        rustc = np.array([0.42, 0.18, 0.07], F32) * (0.4 + 1.2 * lum)
        mr = smoothstep(0.5, 0.66, rustn[i0:i1])[..., None]
        ms = smoothstep(0.55, 0.72, sootn[i0:i1])[..., None]
        ALB = (ALB * (1 - 0.75 * mr) + rustc * 0.75 * mr) * (1 - 0.6 * ms)
        EM = EM * k[..., None] * (1 - 0.8 * ms)
        # what light is left goes dirty sodium (no clean cyan or pink left in the den)
        EM = EM * 0.3 + (EM @ LUM.astype(F32))[..., None] * np.array([1.3, 0.62, 0.24], F32) * 0.7
        cm.ALB[i0:i1] = ALB.astype(np.float16)
        cm.EM[i0:i1] = EM.astype(np.float16)
    del rustn, sootn

    def spot(lon, lat, rad):
        """The texel window round (lon, lat) and the frame px distance of each texel from it."""
        i0, i1 = cm.rows(lat - rad / R_PL, lat + rad / R_PL)
        dlo = rad / (R_PL * max(0.1, math.cos(lat)))
        j0, j1 = cm.cols(lon - dlo, lon + dlo)
        v = cm.dirs(i0, i1, j0, j1)
        d = np.arccos(np.clip(v @ dir_of(lon, lat), -1, 1)) * R_PL
        return (slice(i0, i1), slice(j0, j1)), d

    def visible_point():
        while True:
            lon, lat = float(rng.uniform(-math.pi, math.pi)), float(rng.uniform(LAT0 + 0.1, math.pi / 2 - 0.1))
            if dir_of(lon, lat)[2] > 0.2:
                return lon, lat

    for n in range(34):   # scorch marks, a fire still burning in some
        lon, lat = visible_point()
        rad = float(rng.uniform(4, 13))
        reg, d = spot(lon, lat, rad)
        f = np.clip(d / rad, 0, 1) ** 0.8
        em = cm.EM[reg].astype(F32) * (f * f)[..., None]
        if n % 3 == 0:
            fire = np.clip(1 - d / (rad * 0.45), 0, 1) ** 1.5
            flick = 0.6 + 0.4 * (value_noise(rng, *d.shape, 2) > 0.5)
            em = em + (fire * flick)[..., None] * np.array([1.0, 0.36, 0.07], F32) * 1.4
        cm.ALB[reg] = (cm.ALB[reg].astype(F32) * (0.15 + 0.85 * f)[..., None]).astype(np.float16)
        cm.EM[reg] = em.astype(np.float16)
    for _ in range(320):  # patched plating on the roofs
        lon, lat = visible_point()
        a, b = float(rng.uniform(1.0, 3.0)), float(rng.uniform(0.8, 2.0))
        i0, i1 = cm.rows(lat - b / R_PL, lat + b / R_PL)
        j0, j1 = cm.cols(lon - a / (R_PL * math.cos(lat)), lon + a / (R_PL * math.cos(lat)))
        reg = (slice(i0, i1), slice(j0, j1))
        roof = cm.ID[reg] >= 0
        cm.ALB[reg][roof] = ramp_c('plate', float(rng.uniform(0.35, 0.65))).astype(np.float16)


def carve_boulevards(cm):
    """The boulevards cut through the blocks (ground level, the Strip's lights)."""
    R = R_PL
    step = 64
    for i0 in range(0, MH, step):
        i1 = min(MH, i0 + step)
        v = cm.dirs(i0, i1, 0, MW)
        vis = v[..., 2] > -0.3
        if not vis.any():
            continue
        d = blvd_dist(v)
        for b, (_, _, w) in enumerate(BLVDS):
            m = vis & (d[..., b] < w / 2)
            if not m.any():
                continue
            c = np.clip(np.arcsin(np.clip(v @ BLVD_N[b], -1, 1)) * R / (w / 2), -1, 1)
            # along: the angle round the circle's axis
            a_ref = BLVDS[b][0]
            b_ref = np.cross(BLVD_N[b], a_ref)
            along = np.arctan2(v @ b_ref, v @ a_ref) * R
            e = street_light(c, along, ST_BLVD)
            sl = cm.H[i0:i1]
            sl[m] = 0
            cm.ID[i0:i1][m] = ST_BLVD
            cm.EM[i0:i1][m] = e[m].astype(np.float16)
            cm.ALB[i0:i1][m] = np.array([0.07, 0.065, 0.07], np.float16)


def carve_feature(cm, name):
    """A roulette arena (a flat floor for the wheel, a gold bezel, a colonnade ring, a ring road) or the docking
    port (its throat, a gold collar, an apron)."""
    R = R_PL
    fv = FEAT_V[name]
    rr = FEAT[name][2]
    q = PL_M @ fv
    lat_c = math.asin(q[2])
    ang = (rr[3] + 2) / R
    i0, i1 = cm.rows(lat_c - ang * 1.2, lat_c + ang * 1.2)
    lon_c = math.atan2(q[1], q[0])
    dlo = ang * 1.2 / max(0.05, math.cos(lat_c))
    j0, j1 = cm.cols(lon_c - dlo, lon_c + dlo)
    v = cm.dirs(i0, i1, j0, j1)
    rho = np.arccos(np.clip(v @ fv, -1, 1)) * R
    e, n = tangent_frame(fv)
    a = (v @ e) * R
    b = (v @ n) * R
    th = np.arctan2(b, a)
    H = cm.H[i0:i1, j0:j1]
    ID = cm.ID[i0:i1, j0:j1]
    ALB = cm.ALB[i0:i1, j0:j1]
    EM = cm.EM[i0:i1, j0:j1]
    road = rho < rr[3]
    H[road] = 0
    ID[road] = ST_BLVD
    c = np.clip((rho - (rr[2] + rr[3]) / 2) / ((rr[3] - rr[2]) / 2), -1, 1)
    EM[road] = street_light(c, th * rho, ST_AVE)[road].astype(np.float16)
    ALB[road] = np.array([0.07, 0.065, 0.07], np.float16)
    col = rho < rr[2]
    if name == 'port':
        # a gold collar standing round the throat, lamps on it
        H[col] = 4.0 * PS
        ALB[col] = ramp_c('gold', 0.55 + 0.25 * (np.cos(th * 24) > 0.6))[col].astype(np.float16)
        EM[col] = (np.array([1.0, 0.8, 0.4]) * 0.5 * (np.cos(th * 24) > 0.8)[..., None])[col].astype(np.float16)
        ID[col] = ST_PLAZA
    else:
        # the colonnade: a low gold ring of arches, lit between the columns
        H[col] = 3.0 * PS
        arch = (np.cos(th * (rr[2] * 0.9)) > 0.2)
        ALB[col] = np.where(arch[..., None], ramp_c('white', 0.75), ramp_c('gold', 0.6))[col].astype(np.float16)
        EM[col] = np.where(arch[..., None], np.array([1.0, 0.75, 0.4]) * 0.4, 0)[col].astype(np.float16)
        ID[col] = ST_PLAZA
    fl = rho < rr[1]
    H[fl] = 0.5 * PS
    ID[fl] = ID_FEAT[name]
    ALB[fl] = ramp_c('gold', 0.5).astype(np.float16)
    EM[fl] = 0


# ----------------------------------------------------------------------------------------------------------------
# The raymarch (orthographic view rays down -z onto the displaced sphere)
# ----------------------------------------------------------------------------------------------------------------

CF = 8


def coarse_max(Hm):
    ph = (-MH) % CF
    pw = (-MW) % CF
    P = np.pad(Hm, ((0, ph), (0, pw)), mode='edge')
    hc = P.reshape(P.shape[0] // CF, CF, P.shape[1] // CF, CF).max((1, 3))
    d = hc.copy()
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            sh = np.roll(hc, dx, axis=1)
            if dy:
                sh = np.roll(sh, dy, axis=0)
                if dy > 0:
                    sh[0] = np.maximum(sh[0], hc[0])
                else:
                    sh[-1] = np.maximum(sh[-1], hc[-1])
            d = np.maximum(d, sh)
    return d.astype(F32)


def to_texel(px, py, pz):
    r = np.sqrt(px * px + py * py + pz * pz)
    qx, qy, qz = px / r, py / r, pz / r
    M = PL_M.astype(F32)
    a = M[0, 0] * qx + M[0, 1] * qy + M[0, 2] * qz
    b = M[1, 0] * qx + M[1, 1] * qy + M[1, 2] * qz
    c = M[2, 0] * qx + M[2, 1] * qy + M[2, 2] * qz
    lat = np.arcsin(np.clip(c, -1, 1))
    lon = np.arctan2(b, a)
    fi = (math.pi / 2 - lat) / DLAT - 0.5
    fj = (lon + math.pi) / DLON - 0.5
    return r, lat, lon, fi, fj


def height_at(Hm, fi, fj):
    i = np.clip(np.rint(fi).astype(np.int32), 0, MH - 1)
    j = np.rint(fj).astype(np.int32) % MW
    h = Hm[i, j]
    return np.where(fi > MH - 0.5, 0, h), i, j


def raymarch(Hm, step=0.6, verbose=True):
    Rb = R_PL * PS
    Hmax = float(Hm.max()) + 1.0
    Ro = Rb + Hmax
    HC = coarse_max(Hm)
    ys, xs = np.mgrid[0:NB, 0:NB]
    x = (xs + 0.5 - NB / 2).astype(F32).ravel()
    y = (ys + 0.5 - NB / 2).astype(F32).ravel()
    d2 = x * x + y * y
    rays = np.flatnonzero(d2 < Ro * Ro)
    X, Y, D2 = x[rays], y[rays], d2[rays]
    zt = np.sqrt(Ro * Ro - D2).astype(F32)
    n = len(rays)
    zhit = np.full(n, np.nan, F32)
    act = np.arange(n)
    z = zt.copy()
    zprev = zt.copy()
    it = 0
    t0 = time.time()
    while act.size:
        it += 1
        Xa, Ya, za = X[act], Y[act], z[act]
        r, lat, lon, fi, fj = to_texel(Xa, Ya, za)
        h, i, j = height_at(Hm, fi, fj)
        hh = r - Rb
        hit = hh <= h
        if hit.any():
            hi_ = act[hit]
            lo = za[hit].copy()
            up = zprev[hi_].copy()
            Xh, Yh = Xa[hit], Ya[hit]
            for _ in range(7):
                mid = (lo + up) / 2
                r2, _, _, fi2, fj2 = to_texel(Xh, Yh, mid)
                h2, _, _ = height_at(Hm, fi2, fj2)
                ins = (r2 - Rb) <= h2
                lo = np.where(ins, mid, lo)
                up = np.where(ins, up, mid)
            zhit[hi_] = lo
        ci = np.clip(np.rint(fi).astype(np.int32) // CF, 0, HC.shape[0] - 1)
        cj = (np.rint(fj).astype(np.int32) % MW) // CF
        hcd = HC[ci, cj]
        clat = np.maximum(np.cos(lat), 0.12)
        room = hh - hcd
        big = room > 0.5
        st = np.where(big, np.clip(np.minimum(7.0 * clat, room * r / np.maximum(np.abs(za), 1.0)), step, 7.0), step).astype(F32)
        zn = za - st
        cross = (za > 0) & (zn < 0)
        zn = np.where(cross, 0, zn)
        out = zn < -zt[act]
        zprev[act] = za
        z[act] = zn
        act = act[~hit & ~out]
    if verbose:
        print('  march', it, 'its', round(time.time() - t0, 1), 's', flush=True)
    return rays, X, Y, zhit


def shadow_rays(Hm, px, py, pz, L, length=150.0, step=0.8):
    Rb = R_PL * PS
    HC = coarse_max(Hm)
    hmx = float(Hm.max()) + 2
    n = len(px)
    lit = np.ones(n, F32)
    t = np.zeros(n, F32)
    act = np.arange(n)
    Lx, Ly, Lz = (F32(v) for v in L)
    while act.size:
        ta = t[act]
        qx, qy, qz = px[act] + Lx * ta, py[act] + Ly * ta, pz[act] + Lz * ta
        r, lat, lon, fi, fj = to_texel(qx, qy, qz)
        h, i, j = height_at(Hm, fi, fj)
        hh = r - Rb
        blocked = (hh < h - 0.3) & (ta > 0.5)
        lit[act[blocked]] = 0
        ci = np.clip(np.rint(fi).astype(np.int32) // CF, 0, HC.shape[0] - 1)
        cj = (np.rint(fj).astype(np.int32) % MW) // CF
        room = hh - HC[ci, cj]
        st = np.where(room > 0.5, np.clip(np.minimum(7.0 * np.maximum(np.cos(lat), 0.12), room * 4), step, 7.0), step).astype(F32)
        tn = ta + st
        t[act] = tn
        done = blocked | (tn > length) | (hh > hmx)
        act = act[~done]
    return lit


def hash3(a, b, c):
    h = (a.astype(np.uint32) * np.uint32(73856093)) ^ (b.astype(np.uint32) * np.uint32(19349663)) ^ (c.astype(np.uint32) * np.uint32(83492791))
    h = (h ^ (h >> np.uint32(13))) * np.uint32(0x5bd1e995)
    h = h ^ (h >> np.uint32(15))
    return (h & np.uint32(0xffffff)).astype(F32) / F32(0x1000000)


# ----------------------------------------------------------------------------------------------------------------
# Shading
# ----------------------------------------------------------------------------------------------------------------



def lot_table(lots):
    T = {}
    for k in ('lo', 'la', 'top', 'lit', 'fh'):
        T[k] = np.array([l[k] for l in lots], F32)
    for k in ('mat', 'wcol', 'led', 'ledk'):
        T[k] = np.array([l[k] for l in lots], np.int32)
    T['facade'] = np.stack([ramp_c(MATS_C[l['mat']], 0.45) for l in lots]).astype(F32)
    return T


def shade_planet(cm, rays, X, Y, zhit, shadows=True):
    Rb = R_PL * PS
    Hm = cm.H
    T = lot_table(cm.lots)
    ok = ~np.isnan(zhit)
    rid = rays[ok]
    px, py, pz = X[ok], Y[ok], zhit[ok]
    r, lat, lon, fi, fj = to_texel(px, py, pz)
    h, i, j = height_at(Hm, fi, fj)
    ID = cm.ID[i, j]
    hh = r - Rb
    ns = np.stack([px, py, pz], -1) / r[:, None]

    def Hs(di, dj):
        return Hm[np.clip(i + di, 0, MH - 1), (j + dj) % MW]

    dU = (DLON * Rb * np.maximum(np.cos(lat), 0.05)).astype(F32)
    dV = F32(DLAT * Rb)
    Gu = ((Hs(-1, 1) + 2 * Hs(0, 1) + Hs(1, 1)) - (Hs(-1, -1) + 2 * Hs(0, -1) + Hs(1, -1))) / (8 * dU)
    Gv = ((Hs(-1, -1) + 2 * Hs(-1, 0) + Hs(-1, 1)) - (Hs(1, -1) + 2 * Hs(1, 0) + Hs(1, 1))) / (8 * dV)
    wall = (ID >= 0) & (hh < h - 0.9)
    wall |= (ID == ST_PLAZA) & (hh < h - 0.9)
    M = PL_M.astype(F32)
    sl, cl, so, co = np.sin(lat), np.cos(lat), np.sin(lon), np.cos(lon)
    E = np.stack([-so, co, np.zeros_like(so)], -1) @ M
    Nn = np.stack([-sl * co, -sl * so, cl], -1) @ M
    gm = np.hypot(Gu, Gv)
    k = np.minimum(1.0, 1.6 / np.maximum(gm, 1e-6))
    n_roof = -Gu[:, None] * k[:, None] * E - Gv[:, None] * k[:, None] * Nn + ns
    wu, wv = -Gu / np.maximum(gm, 1e-6), -Gv / np.maximum(gm, 1e-6)
    snap = np.maximum(np.abs(wu), np.abs(wv)) > 0.9
    wu2 = np.where(snap, np.where(np.abs(wu) > np.abs(wv), np.sign(wu), 0), wu)
    wv2 = np.where(snap, np.where(np.abs(wv) >= np.abs(wu), np.sign(wv), 0), wv)
    wu, wv = wu2, wv2
    n_wall = wu[:, None] * E + wv[:, None] * Nn
    n = np.where(wall[:, None], n_wall, n_roof)
    n = n / np.maximum(np.linalg.norm(n, axis=-1, keepdims=True), 1e-6)
    L = PL_LIGHT.astype(F32)
    dl = np.clip(n @ L, 0, 1)
    ds = ns @ L
    key = smoothstep(-0.45, 0.7, ds).astype(F32)   # the side toward the faint key (the sphere's form)
    MOON, FLOOD, NIGHT_AMB, CITY_FAR = LK['moon'], LK['flood'], LK['amb'], LK['far']
    sh = np.ones(len(px), F32)
    if shadows:
        need = (key > 0.05) & (dl > 0.01)
        if need.any():
            q = n[need]
            sh[need] = shadow_rays(Hm, px[need] + q[:, 0] * 0.8, py[need] + q[:, 1] * 0.8, pz[need] + q[:, 2] * 0.8, L)
    lid = np.where(ID >= 0, ID, 0)
    alb = cm.ALB[i, j].astype(F32)
    emi = cm.EM[i, j].astype(F32)
    street = ID < 0
    glowk = (CITY_FAR + (1 - CITY_FAR) * key).astype(F32)   # the city's light a little dimmer on the far side
    emk = np.where(street, LK['em_street'], LK['em_roof']) * glowk
    em = emi * emk[:, None]
    # facades: floors of windows (some lit), LED bands, lit crowns, the bright casino floor at the foot
    lu = (((lon - T['lo'][lid] + math.pi) % (2 * math.pi)) - math.pi) * Rb * np.cos(lat)
    lv = (lat - T['la'][lid]) * Rb
    along = lu * (-wv) + lv * wu
    FH = T['fh'][lid] * 1.4
    fl = np.floor(hh / FH)
    ff = hh / FH - fl
    CP = 3.0
    cc = np.floor(along / CP)
    fc = along / CP - cc
    pane = (ff > 0.28) & (ff < 0.86) & (fc > 0.18) & (fc < 0.82)
    flo = fl.astype(np.int64) + 1000
    col_ = cc.astype(np.int64) + 100000
    floor_on = hash3(lid, flo, np.full_like(flo, 7)) < 0.85
    litw = pane & floor_on & (hash3(lid, flo, col_) < T['lit'][lid])
    wc = (WIN_COLS_DEN if LK['pirate'] else WIN_COLS)[T['wcol'][lid]].astype(F32) * (0.75 + 0.5 * hash3(lid, flo, col_ + 3))[:, None]
    fac = T['facade'][lid]
    walb = np.where(pane[:, None], np.array([0.03, 0.035, 0.05], F32), fac)
    wem = np.where(litw[:, None], wc, 0)
    led = T['led'][lid]
    band = (led >= 0) & ((flo % np.maximum(T['ledk'][lid], 1)) == 0) & (ff > 0.2) & (ff < 0.7)
    wem = np.where(band[:, None], (LED_COLS_DEN if LK['pirate'] else LED_COLS)[np.maximum(led, 0)].astype(F32) * 1.2, wem)
    crown = (hh > T['top'][lid] - FH * 1.1) & (hash3(lid, np.zeros_like(flo), np.ones_like(flo)) < (0.06 if LK['pirate'] else 0.5))
    wem = np.where((crown & (ff > 0.15))[:, None], np.array([1.0, 0.85, 0.55], F32) * 1.2, wem)
    base = hh < 3.2
    wem = np.where((base & (T['top'][lid] > 5 * PS))[:, None], np.array([1.0, 0.75, 0.35], F32) * (0.25 if LK['pirate'] else 1.0), wem)
    wemk = LK['em_win'] * glowk
    plaza_wall = (ID == ST_PLAZA) & wall
    alb = np.where(wall[:, None] & ~plaza_wall[:, None], walb, alb)
    em = np.where(wall[:, None] & ~plaza_wall[:, None], wem * wemk[:, None], em)
    ao = np.where(wall, 0.55 + 0.45 * smoothstep(0, 8, hh), 1.0)
    # no sun: the cool key on the near side, and the city's own warm glow (floodlights, signs, the streets below)
    amb = NIGHT_AMB + FLOOD * ((0.45 + 0.55 * key) * (0.5 + 0.5 * wall))[:, None]
    direct = MOON * (dl * sh * key)[:, None]
    hv = L + np.array([0, 0, 1.0], F32)
    hv = hv / np.linalg.norm(hv)
    sp = np.clip(n @ hv, 0, 1) ** 30
    shiny = np.where(wall, 0.2, 0.5)
    col = alb * (direct + amb) * ao[:, None] + MOON * (sp * sh * key * shiny)[:, None] * (0.25 + alb) + em
    out = np.zeros((NB * NB, 3), F32)
    out[rid] = col
    emo = np.zeros((NB * NB, 3), F32)
    emo[rid] = em
    A = np.zeros(NB * NB, F32)
    A[rid] = 1
    buf = dict(id=np.full(NB * NB, -99, np.int32), hh=np.zeros(NB * NB, F32), key=np.zeros(NB * NB, F32), nz=np.zeros(NB * NB, F32))
    buf['id'][rid] = ID
    buf['hh'][rid] = hh
    buf['key'][rid] = key
    buf['nz'][rid] = ns[:, 2]
    buf = {k: v.reshape(NB, NB) for k, v in buf.items()}
    buf['em'] = emo.reshape(NB, NB, 3)
    return out.reshape(NB, NB, 3), A.reshape(NB, NB), buf


def atmosphere(col, A, buf):
    """The neon smog: haze over the limb of the disc and a glow ring round it, the city's pink and gold light
    pollution all round, a cooler, brighter limb light on the key side (the sphere's form)."""
    ys, xs = np.mgrid[0:NB, 0:NB]
    dx = (xs + 0.5 - NB / 2) / PS
    dy = (ys + 0.5 - NB / 2) / PS
    rho = np.hypot(dx, dy)
    L = PL_LIGHT
    sd = (dx * L[0] + dy * L[1]) / np.maximum(rho, 1e-3) / math.hypot(L[0], L[1])
    pinkc, goldc, keyc = (np.array(c, F32) for c in LK['haze'])
    t = (0.5 + 0.5 * np.sin(np.arctan2(dy, dx) * 2 + 0.7))[..., None]
    w = smoothstep(-0.3, 0.8, sd)[..., None]
    hc = (pinkc * (1 - t) + goldc * t) * (1 - w * 0.6) + keyc * w * 0.6
    gain = (0.55 + 0.8 * w[..., 0])
    nz = buf['nz']
    fres = (np.clip(1 - nz, 0, 1) ** 3 * A)[..., None] * gain[..., None]
    col = col * (1 - 0.3 * fres) + hc * fres * LK['haze_k']
    g = np.exp(-np.clip(rho - R_PL, 0, None) / 4.0) * (rho > R_PL - 1) * 0.8 * gain
    g = g + np.exp(-np.clip(rho - R_PL, 0, None) / 13.0) * (rho > R_PL - 1) * 0.28
    ga = g * (1 - A)
    tot = A + ga
    col = (col * A[..., None] + hc * ga[..., None]) / np.maximum(tot, 1e-4)[..., None]
    return col, np.clip(tot, 0, 1)


def to_frame(col, A):
    a = np.clip(down(A, FRAME, FRAME), 0, 1)
    rgb = np.stack([down(col[..., k] * A, FRAME, FRAME) for k in range(3)], -1) / np.maximum(a, 1e-4)[..., None]
    rgb = np.where(a[..., None] > 1e-3, rgb, 0)
    rgb = unsharp(rgb, 0.3)
    return np.clip(rgb, 0, 1.5), a


def bloom(rgb, a, em_frame, k1=0.45, k2=0.14):
    """A soft glow of the emission (the city's light) over the disc and just past it."""
    g1 = np.stack([fblur(em_frame[..., c], 1.6) for c in range(3)], -1)
    g2 = np.stack([fblur(em_frame[..., c], 5.0) for c in range(3)], -1)
    g = g1 * k1 + g2 * k2
    prem = rgb * a[..., None] + g
    ga = np.clip(g.max(-1), 0, 1) * (1 - a) * 0.9
    a2 = np.clip(a + ga, 0, 1)
    rgb2 = prem / np.maximum(a2, 1e-4)[..., None]
    return rgb2, a2


def rgba8(rgb, a):
    res = np.zeros(rgb.shape[:2] + (4,), np.uint8)
    res[..., :3] = np.round(np.clip(rgb, 0, 1) * 255)
    res[..., 3] = np.round(np.clip(a, 0, 1) * 255)
    return res


POCKETS = 37


def rotor(a, b, r, night=False, aa=PS):
    """The roulette rotor at tangent-plane coords (a east, b south; frame px from its centre), radius r: straight albedo,
    emission, alpha. Pockets red / black (one green), gold frets, the number ring, a mahogany cone with gold spokes, a
    gold turret. Lit evenly (a flat disc), so it can turn."""
    rho = np.hypot(a, b) / r
    th = np.arctan2(b, a)
    t = ((th + math.pi) / (2 * math.pi)) * POCKETS
    k = np.floor(t).astype(np.int32) % POCKETS
    fr = t - np.floor(t)
    alb = np.zeros(a.shape + (3,), F32)
    em = np.zeros(a.shape + (3,), F32)
    red = np.array([0.72, 0.04, 0.05])
    blk = np.array([0.035, 0.03, 0.035])
    grn = np.array([0.02, 0.42, 0.14])
    pc = np.where((k == 0)[..., None], grn, np.where((k % 2 == 1)[..., None], red, blk))
    gold = lambda v: ramp_c('gold', v)
    # rings
    zone = np.select([rho < 0.1, rho < 0.42, rho < 0.46, rho < 0.7, rho < 0.8, rho < 0.86, rho <= 1.0],
                     [0, 1, 2, 3, 4, 5, 6], 7)
    fw = 0.55 / np.maximum(2 * math.pi * rho * r / POCKETS, 0.3)
    fret = np.abs(fr - 0.5) > 0.5 - fw
    # turret: dome + a cross of four arms with knobs
    arms = np.zeros(a.shape, bool)
    for q in range(4):
        ang = q * math.pi / 2 + math.pi / 4
        ca, sa = math.cos(ang), math.sin(ang)
        al = (a * ca + b * sa) / r
        ac = (-a * sa + b * ca) / r
        arms |= (np.abs(ac) < 0.028) & (al > 0) & (al < 0.22)
        arms |= np.hypot(al - 0.22, ac) < 0.045
    cone_sp = (np.abs(((th / (2 * math.pi)) * 8) % 1 - 0.5) > 0.5 - 0.5 / np.maximum(2 * math.pi * rho * r / 8, 0.5))
    mah = np.array([0.32, 0.09, 0.04]) * (0.55 + 0.6 * rho[..., None])
    alb = np.where((zone == 1)[..., None], np.where(cone_sp[..., None], gold(0.8), mah), alb)
    alb = np.where((zone == 0)[..., None], gold(0.85 - 0.5 * rho / 0.1), alb)
    alb = np.where((zone == 2)[..., None], gold(0.75), alb)
    alb = np.where((zone == 3)[..., None], np.where(fret[..., None], gold(0.9), pc), alb)
    # the number ring: the same colours, a white numeral dash in each
    numeral = (np.abs(fr - 0.5) < 0.16) & (np.abs(rho - 0.75) < 0.025)
    alb = np.where((zone == 4)[..., None], np.where(fret[..., None], gold(0.85), np.where(numeral[..., None], np.array([0.92, 0.9, 0.85]), pc)), alb)
    alb = np.where((zone == 5)[..., None], gold(0.62), alb)
    alb = np.where((zone == 6)[..., None], gold(0.78 - 0.3 * ((rho > 0.92) & (rho < 0.935))), alb)
    alb = np.where(arms[..., None], gold(0.95), alb)
    if night:
        # the night wheel is lit from inside: glowing pockets, gold-lit frets
        glow = np.where((k == 0)[..., None], np.array([0.1, 1.0, 0.35]), np.where((k % 2 == 1)[..., None], np.array([1.0, 0.1, 0.12]), np.array([0.06, 0.04, 0.12])))
        em = np.where(((zone == 3) & ~fret)[..., None], glow * 0.85, em)
        em = np.where(((zone == 3) | (zone == 4)) & fret, 1, 0)[..., None] * np.array([1.0, 0.8, 0.35]) * 0.7 + em
        em = np.where(numeral[..., None], np.array([1.0, 1.0, 0.95]) * 0.8, em)
        em = np.where((zone == 6)[..., None] & ((np.floor(t * 2) % 2) == 0)[..., None], np.array([1.0, 0.75, 0.3]) * 0.5, em)
    A = np.clip((1 - rho) * r * aa + 0.5, 0, 1)
    if LK['pirate']:
        # tarnished, chipped lacquer; a few pockets' lamps still on
        lum = (alb @ LUM)[..., None]
        alb = (alb * 0.45 + lum * 0.25) * np.array([1.0, 0.85, 0.7])
        em = em * ((k % 7) == 3)[..., None] * 0.5
    return alb, em, A


def bezel(a, b, r0, r1, night=False):
    """The static bowl round a rotor: the ball track (polished dark wood), eight gold diamond deflectors, the gold rim."""
    rho = np.hypot(a, b)
    th = np.arctan2(b, a)
    u = (rho - r0) / (r1 - r0)
    wood = np.array([0.22, 0.07, 0.035]) * (0.7 + 0.5 * np.sin(u * math.pi)[..., None])
    alb = np.where((u > 0.72)[..., None], ramp_c('gold', 0.55 + 0.3 * np.clip((u - 0.72) / 0.28, 0, 1)), wood)
    dd = np.abs(((th / (2 * math.pi)) * 8) % 1 - 0.5) * 2 * math.pi * rho / 8
    diamond = (np.abs(u - 0.4) * (r1 - r0) + dd < 1.6)
    alb = np.where(diamond[..., None], ramp_c('gold', 0.95), alb)
    em = np.zeros(a.shape + (3,), F32)
    if night and not LK['pirate']:
        em = np.where(diamond[..., None], np.array([1.0, 0.85, 0.5]) * 0.8, em)
    if LK['pirate']:
        alb = alb * 0.6
    return alb, em


def feature_affine(name, h=0.5):
    """(o, M2, Minv) of a feature's tangent plane (a east, b south): frame px = o + M2 @ (a, b)."""
    v = FEAT_V[name]
    o, ex, ey = affine_at(v, h)
    M2 = np.stack([-ex, -ey], -1)   # columns: the screen images of west and south (screen right / down near the centre)
    return o, M2, np.linalg.inv(M2)


# the wheels: the crown wheel is floodlit (lacquer and gold under the colonnade's lamps), the other glows from inside
GLOWING = {'wheel_main': False, 'wheel_2': True}


def floodlit(v):
    """The light on a flat arena floor at view direction v (rgb multiplier): the colonnade's warm floodlights, a
    touch of the cool key on the near side."""
    ds = float(v @ PL_LIGHT)
    key = float(smoothstep(-0.45, 0.7, ds))
    return (np.array([0.98, 0.82, 0.62]) * (0.8 + 0.2 * key) + LK['moon'] * max(0.0, ds) * 0.5) * (0.55 if LK['pirate'] else 1.0)


def draw_features(col, A, buf):
    """Lay the wheels (rotor + bezel) and the port's throat over the arena / port floors (only where the floor shows)."""
    ys, xs = np.mgrid[0:NB, 0:NB]
    for name in FEAT:
        sel = buf['id'] == ID_FEAT[name]
        if not sel.any():
            continue
        yy, xx = np.nonzero(sel)
        p = np.stack([(xx + 0.5) / PS, (yy + 0.5) / PS], -1)
        o, M2, Mi = feature_affine(name)
        ab = (p - o) @ Mi.T
        a, b = ab[:, 0], ab[:, 1]
        rr = FEAT[name][2]
        m = floodlit(FEAT_V[name])
        if name == 'port':
            c, e = throat(p, name)
            col[yy, xx] = c
            buf['em'][yy, xx] = e
            continue
        night = GLOWING[name]
        ra, re, rA = rotor(a, b, rr[0], night)
        ba, be = bezel(a, b, rr[0], rr[1], night)
        inner = np.hypot(a, b) < rr[0]
        alb = np.where(inner[:, None], ra, ba)
        em = np.where(inner[:, None], re, be)
        # a soft ring shadow of the bezel lip on the rotor's edge
        lip = np.clip(1 - (rr[0] - np.hypot(a, b)) / 2.5, 0, 1) * inner
        c = alb * m * (1 - 0.45 * lip)[:, None] + em
        col[yy, xx] = c
        buf['em'][yy, xx] = em
    return col


def throat(p, name):
    """The docking port's throat seen down its shaft: rings of light down the wall, a blazing bay at the bottom."""
    v = FEAT_V[name]
    o, M2, Mi = feature_affine(name, 0.0)
    up = v[:2]  # screen image of the local up (outward)
    rt = FEAT[name][2][1]
    n = len(p)
    depth = np.full(n, np.nan)
    th_hit = np.zeros(n)
    for d in np.arange(0, 44, 0.4):
        ab = (p - o + d * up[None, :]) @ Mi.T
        rr = np.hypot(ab[:, 0], ab[:, 1])
        new = np.isnan(depth) & (rr > rt)
        depth[new] = d
        th_hit[new] = np.arctan2(ab[new, 1], ab[new, 0])
    bottom = np.isnan(depth)
    d = np.where(bottom, 44, depth)
    # the wall: dark metal, a ring of lights every 7 px of depth, warming and dimming down the shaft
    band = (d % 7) < 1.4
    studs = band & ((np.floor((th_hit + math.pi) / (2 * math.pi) * 28) % 2) == 0)
    fall = np.exp(-d / 40)[:, None]
    wall = np.array([0.08, 0.07, 0.075])[None, :] * (0.4 + 0.6 * fall)
    e = np.where(band[:, None], np.array([1.0, 0.7, 0.35]) * 0.35, 0) * fall + np.where(studs[:, None], np.array([1.0, 0.9, 0.7]) * 0.9, 0) * fall
    e = e + np.array([1.0, 0.75, 0.4])[None, :] * (0.25 * np.exp(-d / 14))[:, None]
    bay = np.array([1.0, 0.92, 0.75]) * 1.25
    if LK['pirate']:
        e = e * 0.35
        bay = np.array([0.9, 0.42, 0.14]) * 0.6
    c = np.where(bottom[:, None], bay, wall + e)
    e = np.where(bottom[:, None], bay, e)
    return c, e


# ----------------------------------------------------------------------------------------------------------------
# 2D painting at the build resolution (premultiplied over the planet)
# ----------------------------------------------------------------------------------------------------------------

def seg_dist(xx, yy, pts):
    """Distance (same units as the inputs) from points to a polyline."""
    d = np.full(xx.shape, 1e9)
    for (x0, y0), (x1, y1) in zip(pts[:-1], pts[1:]):
        vx, vy = x1 - x0, y1 - y0
        l2 = max(vx * vx + vy * vy, 1e-9)
        t = np.clip(((xx - x0) * vx + (yy - y0) * vy) / l2, 0, 1)
        d = np.minimum(d, np.hypot(xx - (x0 + t * vx), yy - (y0 + t * vy)))
    return d


class Painter:
    """Premultiplied colour / alpha / emission at the build resolution; shapes in frame px."""

    def __init__(self, col, A, em):
        self.P = col * A[..., None]
        self.A = A.copy()
        self.E = em * A[..., None]

    def region(self, x0, y0, x1, y1):
        i0, i1 = max(0, int((y0) * PS) - 2), min(NB, int(math.ceil(y1 * PS)) + 2)
        j0, j1 = max(0, int((x0) * PS) - 2), min(NB, int(math.ceil(x1 * PS)) + 2)
        yy, xx = np.mgrid[i0:i1, j0:j1].astype(np.float64)
        return (slice(i0, i1), slice(j0, j1)), (xx + 0.5) / PS, (yy + 0.5) / PS

    def over(self, sl, m, rgb, em=None):
        m = np.clip(m, 0, 1)[..., None]
        self.P[sl] = rgb * m + self.P[sl] * (1 - m)
        self.A[sl] = m[..., 0] + self.A[sl] * (1 - m[..., 0])
        e = 0 if em is None else em
        self.E[sl] = e * m + self.E[sl] * (1 - m)

    def add_em(self, sl, e):
        self.P[sl] += e
        self.E[sl] += e

    def stroke(self, pts, w, rgb_fn, em_fn=None, pad=2):
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        sl, xx, yy = self.region(min(xs) - w - pad, min(ys) - w - pad, max(xs) + w + pad, max(ys) + w + pad)
        d = seg_dist(xx, yy, pts)
        m = np.clip((w / 2 - d) * PS + 0.5, 0, 1)
        if m.max() <= 0:
            return
        q = np.clip(d / (w / 2), 0, 1)
        rgb = rgb_fn(xx, yy, q)
        em = None if em_fn is None else em_fn(xx, yy, q)
        self.over(sl, m, rgb, em)

    def poly(self, pts, rgb_fn, em_fn=None):
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        sl, xx, yy = self.region(min(xs) - 1, min(ys) - 1, max(xs) + 1, max(ys) + 1)
        i0, j0 = sl[0].start, sl[1].start
        im = Image.new('L', (xx.shape[1] * 2, xx.shape[0] * 2), 0)
        ImageDraw.Draw(im).polygon([((x * PS - j0) * 2, (y * PS - i0) * 2) for (x, y) in pts], fill=255)
        m = np.asarray(im.resize((xx.shape[1], xx.shape[0]), Image.BOX)).astype(np.float64) / 255
        if m.max() <= 0:
            return
        rgb = rgb_fn(xx, yy)
        em = None if em_fn is None else em_fn(xx, yy)
        self.over(sl, m, rgb, em)

    def disc(self, cx, cy, r, rgb_fn, em_fn=None):
        sl, xx, yy = self.region(cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1)
        d = np.hypot(xx - cx, yy - cy)
        m = np.clip((r - d) * PS + 0.5, 0, 1)
        q = np.clip(d / r, 0, 1)
        self.over(sl, m, rgb_fn(xx, yy, q), None if em_fn is None else em_fn(xx, yy, q))

    def blit(self, rgba, centre, spr):
        """Lay an RGBA sprite (spr px per frame px, centred) over the canvas with its centre at frame px `centre`."""
        p = rgba.astype(np.float64) / 255
        n = int(round(rgba.shape[0] * PS / spr))
        prem = [np.asarray(Image.fromarray((p[..., k] * (p[..., 3] if k < 3 else 1)).astype(np.float32), 'F').resize((n, n), Image.BICUBIC)) for k in range(4)]
        a = np.clip(prem[3], 0, 1)
        i0 = int(round(centre[1] * PS - n / 2))
        j0 = int(round(centre[0] * PS - n / 2))
        sl = (slice(i0, i0 + n), slice(j0, j0 + n))
        P = np.stack(prem[:3], -1).clip(0, None)
        self.P[sl] = P + self.P[sl] * (1 - a[..., None])
        self.A[sl] = a + self.A[sl] * (1 - a)
        self.E[sl] = self.E[sl] * (1 - a[..., None])

    def result(self):
        A = self.A
        col = self.P / np.maximum(A, 1e-6)[..., None]
        em = self.E / np.maximum(A, 1e-6)[..., None]
        return col, A, em


def item_light(at):
    """Light on an upright item at frame px `at` (a face toward the viewer): the city's warm glow from below, the
    cool key on the near side. -> (rgb multiplier for the face, key share)."""
    v = np.array([(at[0] - C0) / R_PL, (at[1] - C0) / R_PL, 0.0])
    ln = np.linalg.norm(v)
    v = v / max(ln, 1e-6)
    ds = float(v @ PL_LIGHT)
    key = float(smoothstep(-0.45, 0.7, ds))
    face = (np.array([0.62, 0.44, 0.3]) * (0.75 + 0.25 * key) + LK['moon'] * PL_LIGHT[2] * key * 1.2 + 0.03) * LK['face']
    return face, key


def metal(mat, face, sun, across=None, axis=None):
    """A shading function for an upright metal part: material ramp, a cylindrical light across it (q 0 centre..1 edge
    in stroke coordinates) brighter toward the sun."""
    def fn(xx, yy, q=None):
        lv = np.full(xx.shape, 0.55)
        if q is not None:
            lv = 0.62 - 0.3 * q ** 2
        c = ramp_c(mat, np.clip(lv, 0, 1))
        return c * face
    return fn


# ----------------------------------------------------------------------------------------------------------------
# Neon: stroke letters and shapes, the tubes in the frame (unlit glass), the glow pieces (the runtime lights them)
# ----------------------------------------------------------------------------------------------------------------

def arc_pts(cx, cy, rx, ry, a0, a1, n=None):
    n = n or max(6, int(abs(a1 - a0) / 12))
    return [(cx + rx * math.cos(math.radians(a0 + (a1 - a0) * k / n)), cy + ry * math.sin(math.radians(a0 + (a1 - a0) * k / n))) for k in range(n + 1)]


GLYPHS = {
    'C': [arc_pts(0.52, 0.5, 0.46, 0.5, -42, -318)],
    'A': [[(0.0, 1.0), (0.5, 0.0), (1.0, 1.0)], [(0.24, 0.62), (0.76, 0.62)]],
    'S': [arc_pts(0.5, 0.26, 0.42, 0.26, -10, -270)[:-1] + arc_pts(0.5, 0.75, 0.46, 0.25, -90, 165)],
    'I': [[(0.5, 0.0), (0.5, 1.0)], [(0.22, 0.0), (0.78, 0.0)], [(0.22, 1.0), (0.78, 1.0)]],
    'N': [[(0.05, 1.0), (0.05, 0.0), (0.95, 1.0), (0.95, 0.0)]],
    'O': [arc_pts(0.5, 0.5, 0.47, 0.5, 0, 360, 40)],
    'J': [[(0.25, 0.0), (0.9, 0.0)], [(0.65, 0.0), (0.65, 0.7)] + arc_pts(0.38, 0.7, 0.27, 0.3, 0, 170)],
    'K': [[(0.08, 0.0), (0.08, 1.0)], [(0.92, 0.0), (0.08, 0.58)], [(0.34, 0.42), (0.95, 1.0)]],
    'P': [[(0.08, 1.0), (0.08, 0.0), (0.55, 0.0)] + arc_pts(0.55, 0.27, 0.38, 0.27, -90, 90)[1:] + [(0.08, 0.54)]],
    'T': [[(0.0, 0.0), (1.0, 0.0)], [(0.5, 0.0), (0.5, 1.0)]],
    '7': [[(0.05, 0.0), (0.95, 0.0), (0.38, 1.0)], [(0.32, 0.5), (0.78, 0.5)]],
}


def glyph(ch, x, y, w, h):
    return [[(x + px * w, y + py * h) for (px, py) in st] for st in GLYPHS[ch]]


def star_pts(cx, cy, r0, r1, n=5, rot=-90):
    pts = []
    for k in range(2 * n + 1):
        r = r1 if k % 2 == 0 else r0
        a = math.radians(rot + 180 * k / n)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


# neon colours
N_PINK = (1.0, 0.22, 0.72)
N_CYAN = (0.2, 0.92, 1.0)
N_GOLD = (1.0, 0.74, 0.22)
N_RED = (1.0, 0.16, 0.12)
N_WHITE = (1.0, 0.95, 0.88)
N_GREEN = (0.3, 1.0, 0.45)

# the neon behaviours (threatArt.ts casinoNeonAlpha runs them)
BUZZ, DEAD, SEQ, BLINK, BAD = 0, 1, 2, 3, 4

# The den's signs: most tubes dead (only their dark glass left), the few that work failing: 'bad' (a failing
# transformer: dark spells, sputtering, never full), 'dying' (the DEAD behaviour), 'half' (the first half of each tube
# still lit, badly; the rest dead). Untagged or unlisted pieces are dead.
DEN_FATES = {
    'casino:C': 'bad', 'casino:A': 'bad', 'casino:S': 'dying', 'casino:I': 'dead', 'casino:N': 'bad', 'casino:O': 'bad',
    'casino:frame': 'half',
    'burst:6': 'dying',
    'gate152:roof': 'half',
    'jackpot:0J': 'bad', 'jackpot:2C': 'bad', 'jackpot:K': 'dying', 'jackpot:4P': 'bad', 'jackpot:6T': 'dying', 'jackpot:rule': 'half',
    'suit:1': 'bad',
    'seven:red': 'half', 'cherry:red': 'dying',
}
# and their colours gone dirty: pink to a dirty red, cyan to a sickly teal, gold to rust orange, white to dim sodium
DEN_NEON = {N_PINK: (1.0, 0.24, 0.16), N_CYAN: (0.3, 0.78, 0.62), N_GOLD: (1.0, 0.5, 0.16), N_WHITE: (1.0, 0.72, 0.42),
            N_RED: (1.0, 0.2, 0.1), N_GREEN: (0.5, 0.8, 0.3)}


def half_line(pts):
    """The first half (by length) of a polyline."""
    L = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(pts[:-1], pts[1:])]
    tot, acc, out = sum(L), 0.0, [pts[0]]
    for (a, b), l in zip(zip(pts[:-1], pts[1:]), L):
        if acc + l >= tot / 2:
            u = (tot / 2 - acc) / max(l, 1e-9)
            out.append((a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u))
            return out
        out.append(b)
        acc += l
    return out


class Neon:
    """The neon pieces: tubes (polylines in frame px, width, colour) grouped into pieces that light together, each
    with a behaviour (BUZZ steady with a flicker now and then, DEAD a failing tube, SEQ (i, n, step s) a sequence,
    BLINK (phase, period s) alternate)."""

    def __init__(self):
        self.pieces = []
        self.glass = []   # every tube, lit or not (the frame bakes them all as glass)
        self.broken = set()   # the den's dead tubes' indexes in glass (cracked, a piece missing)

    def piece(self, tubes, beh, p1=0.0, p2=0.0, p3=0.0, tag=None):
        if LK['pirate']:
            tubes = [(pts, w, DEN_NEON.get(c, c)) for (pts, w, c) in tubes]
        self.glass += tubes
        if not LK['pirate']:
            self.pieces.append(dict(tubes=tubes, beh=beh, p=(p1, p2, p3), tag=tag))
            return
        fate = DEN_FATES.get(tag, 'dead')
        seed = float(zlib.crc32((tag or '').encode()) % 97) / 7.0
        if fate == 'dead':
            self.broken.update(range(len(self.glass) - len(tubes), len(self.glass)))
            return
        if fate == 'half':
            tubes = [(half_line(pts), w, c) for (pts, w, c) in tubes]
        beh, p = (DEAD, (seed, 0.0, 0.0)) if fate == 'dying' else (BAD, (seed, 0.0, 0.0))
        self.pieces.append(dict(tubes=tubes, beh=beh, p=p, tag=tag))

    def bake_glass(self, pnt):
        """The tubes in the frame, unlit: pale coloured glass with a faint glow of their own (the den's: dark, dirty,
        broken in places)."""
        k = LK['glass']
        for n, (pts, w, c) in enumerate(self.glass):
            c = np.array(c)
            segs = [pts]
            if n in self.broken and len(pts) > 3:
                cut = 1 + (n * 7) % (len(pts) - 2)
                segs = [pts[:cut], pts[cut + 1:]]
            for sg in segs:
                if len(sg) < 2:
                    continue
                pnt.stroke(sg, w, lambda xx, yy, q: ((0.18 + 0.25 * c) * (1.0 - 0.4 * q[..., None]) + 0.12) * k,
                           lambda xx, yy, q: c * 0.12 * k * (1 - q[..., None]))

    def glow(self, pc, size=FRAME):
        """One piece lit: straight RGBA (colour, alpha = brightness) at the frame resolution, and its bbox."""
        xs = [p[0] for (pts, w, c) in pc['tubes'] for p in pts]
        ys = [p[1] for (pts, w, c) in pc['tubes'] for p in pts]
        pad = 22
        x0, y0 = max(0, int(min(xs)) - pad), max(0, int(min(ys)) - pad)
        x1, y1 = min(size, int(max(xs)) + pad + 1), min(size, int(max(ys)) + pad + 1)
        W, H = x1 - x0, y1 - y0
        S = 4
        yy, xx = np.mgrid[0:H * S, 0:W * S].astype(np.float64)
        xx = (xx + 0.5) / S + x0
        yy = (yy + 0.5) / S + y0
        core = np.zeros((H, W, 3))
        hot = np.zeros((H, W))
        for (pts, w, c) in pc['tubes']:
            d = seg_dist(xx, yy, pts)
            m = np.clip((w / 2 - d) * S + 0.5, 0, 1)
            m = m.reshape(H, S, W, S).mean((1, 3))
            mh = np.clip((w * 0.22 - d) * S + 0.5, 0, 1).reshape(H, S, W, S).mean((1, 3))
            core = np.maximum(core, m[..., None] * np.array(c))
            hot = np.maximum(hot, mh)
        g1 = np.stack([fblur(core[..., k], 1.3) for k in range(3)], -1)
        g2 = np.stack([fblur(core[..., k], 4.0) for k in range(3)], -1)
        g3 = np.stack([fblur(core[..., k], 10.0) for k in range(3)], -1)
        e = core * 1.2 + hot[..., None] * 1.0 + g1 * 1.1 + g2 * 0.75 + g3 * 0.55
        a = np.clip(e.max(-1), 0, 1)
        rgb = np.where(a[..., None] > 1e-4, np.clip(e, 0, None) / np.maximum(e.max(-1, keepdims=True), 1e-4), 0)
        rgb = np.clip(rgb * np.clip(e.max(-1, keepdims=True), 1, None) ** 0.0, 0, 1)
        res = np.zeros((H, W, 4), np.uint8)
        res[..., :3] = np.round(rgb * 255)
        res[..., 3] = np.round(a * 255)
        return res, (x0, y0)


# ----------------------------------------------------------------------------------------------------------------
# The limb items (standing proud of the silhouette) and their lights
# ----------------------------------------------------------------------------------------------------------------

def polar_xy(rho, deg, s=0.0):
    a = math.radians(deg)
    return (C0 + rho * math.cos(a) - s * math.sin(a), C0 + rho * math.sin(a) + s * math.cos(a))


class Items:
    def __init__(self):
        self.neon = Neon()
        self.lights = []      # (x, y, kind)
        self.lanes = []       # (points, kind)
        self.sprites = {}     # rotating parts


def casino_sign(pnt, it, x, by1, w=84, h=21):
    """The CASINO marquee sitting on the north skyline: a red board in a gold frame on three short posts down into the
    city, the letters in pink neon that fill one by one, a cyan outline tube, chasing bulbs round it, a star on top."""
    face, key = item_light((x, by1 - h / 2))
    x0, x1 = x - w / 2, x + w / 2
    by0 = by1 - h
    for px in (x0 + 9, x, x1 - 9):
        pnt.stroke([(px, by1 - 3), (px, by1 + 11)], 3.0, metal('gold', face * 0.85, key))
    pnt.stroke([(x0 + 9, by1 + 7), (x1 - 9, by1 + 7)], 1.2, metal('gold', face * 0.7, key))
    pnt.poly([(x0 - 2.6, by0 - 2.6), (x1 + 2.6, by0 - 2.6), (x1 + 2.6, by1 + 2.6), (x0 - 2.6, by1 + 2.6)], lambda xx, yy: ramp_c('gold', 0.62 + 0 * xx) * face)
    pnt.poly([(x0, by0), (x1, by0), (x1, by1), (x0, by1)], lambda xx, yy: ramp_c('red', 0.3 + 0.1 * ((yy - by0) / h)) * face * 0.8)
    # bulbs round the frame (in path order for the chase)
    per = []
    nt, ns = 22, 5
    for k in range(nt):
        per.append((x0 - 1.3 + (w + 2.6) * k / nt, by0 - 1.3))
    for k in range(ns):
        per.append((x1 + 1.3, by0 - 1.3 + (h + 2.6) * k / ns))
    for k in range(nt):
        per.append((x1 + 1.3 - (w + 2.6) * k / nt, by1 + 1.3))
    for k in range(ns):
        per.append((x0 - 1.3, by1 + 1.3 - (h + 2.6) * k / ns))
    for (bx, by) in per:
        pnt.disc(bx, by, 0.8, lambda xx, yy, q: np.array([1.0, 0.9, 0.7]) * (0.6 + 0.4 * (1 - q[..., None])))
        it.lights.append((bx, by, 'bulb'))
    # the letters (a sequence: C, CA, CAS, ... all, then dark)
    lw, lh, gap = 10.4, 12.6, 2.7
    lx0 = x - (6 * lw + 5 * gap) / 2
    for k, ch in enumerate('CASINO'):
        g = glyph(ch, lx0 + k * (lw + gap), by0 + (h - lh) / 2, lw, lh)
        it.neon.piece([(st, 1.9, N_PINK) for st in g], SEQ, k, 6, 0.42, tag='casino:' + ch)
    it.neon.piece([([(x0 + 1.9, by0 + 1.9), (x1 - 1.9, by0 + 1.9), (x1 - 1.9, by1 - 1.9), (x0 + 1.9, by1 - 1.9), (x0 + 1.9, by0 + 1.9)], 1.1, N_CYAN)], BUZZ, 3.0, tag='casino:frame')
    sx, sy = x, by0 - 8.5
    pnt.stroke([(x, by0 - 2.6), (x, sy + 3)], 2.0, metal('gold', face, key))
    st = star_pts(sx, sy, 3.2, 7.2, 5)
    pnt.poly(st, lambda xx, yy: ramp_c('gold', 0.5 + 0 * xx) * face)
    it.neon.piece([(st, 1.4, N_GOLD)], BLINK, 0, 0.9, tag='casino:star')
    it.lights.append((sx, sy, 'nav'))


def starburst(pnt, it, deg):
    """A googie starburst on a short lattice mast at the limb: twelve rays that fill in turn."""
    base = polar_xy(R_PL - 12, deg)
    hub = polar_xy(R_PL + 16, deg)
    face, key = item_light(hub)
    for s in (-4.0, 4.0):
        pnt.stroke([polar_xy(R_PL - 14, deg, s * 1.5), polar_xy(R_PL + 10, deg, s * 0.6)], 2.4, metal('gold', face * 0.9, key))
    for k in range(4):
        r0 = R_PL - 12 + k * 5.5
        f0 = 1.5 - 0.9 * (k / 4)
        f1 = 1.5 - 0.9 * ((k + 1) / 4)
        pnt.stroke([polar_xy(r0, deg, -4.0 * f0), polar_xy(r0 + 5.5, deg, 4.0 * f1)], 1.0, metal('gold', face * 0.7, key))
    pnt.disc(*hub, 6.0, lambda xx, yy, q: ramp_c('gold', 0.75 - 0.35 * q) * face)
    n = 12
    cols = [N_GOLD, N_PINK, N_CYAN, N_WHITE]
    for k in range(n):
        a = deg + 360 * k / n + 15
        ln = 25 if k % 2 == 0 else 16
        p0 = (hub[0] + 7.5 * math.cos(math.radians(a)), hub[1] + 7.5 * math.sin(math.radians(a)))
        p1 = (hub[0] + ln * math.cos(math.radians(a)), hub[1] + ln * math.sin(math.radians(a)))
        pnt.stroke([p0, p1], 2.6, metal('gold', face * 0.8, key))
        it.neon.piece([([p0, p1], 1.7, cols[k % 4])], SEQ, k, n, 0.11, tag='burst:%d' % k)
        it.lights.append((p1[0], p1[1], 'white'))
    ring = arc_pts(hub[0], hub[1], 10.0, 10.0, 0, 360, 36)
    it.neon.piece([(ring, 1.6, N_WHITE)], DEAD, 5.0, tag='burst:ring')
    it.lights.append((base[0], base[1], 'nav'))


def high_roller(pnt, it, deg, rw=44.0):
    """The observation wheel on the east of the city, mostly over the sphere (its top just clear of the limb): a
    braced A-frame of two legs on a plinth, the hub, the rim and its inner rings (round, so they stay put as it turns),
    a neon tube round the rim. Its spokes and cabins are a sprite the runtime turns (it.sprites['wheel']); the den's
    wheel has stopped, so its sprite is laid in the frame."""
    hub = polar_xy(R_PL - 20, deg)
    face, sun = item_light(hub)
    steel = metal('white', face * 0.9, sun)
    fr = R_PL - 20 - rw - 6           # the feet, on the city below the wheel
    feet = [polar_xy(fr, deg, s) for s in (-25, 25)]
    pnt.poly([polar_xy(fr + 2.5, deg, -31), polar_xy(fr + 2.5, deg, 31), polar_xy(fr - 3.5, deg, 33), polar_xy(fr - 3.5, deg, -33)],
             lambda xx, yy: ramp_c('gold', 0.5 + 0 * xx) * face)
    dark = lambda xx, yy, q: np.array([0.02, 0.02, 0.025]) + 0 * q[..., None]
    lit = metal('white', face * 1.5, sun)   # floodlit from below
    lerp = lambda a, b, t: (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
    braces = [(lerp(feet[0], hub, t), lerp(feet[1], hub, t), 2.4) for t in (0.3, 0.62)]
    braces += [(lerp(feet[i], hub, t0), lerp(feet[1 - i], hub, t1), 1.4) for (t0, t1) in ((0.0, 0.3), (0.3, 0.62)) for i in (0, 1)]
    # a dark outline under every member first, so the A-frame reads over the bright city, then the steel
    for f in feet:
        pnt.stroke([f, hub], 7.6, dark)
    for (a0, a1, w) in braces:
        pnt.stroke([a0, a1], w + 2.2, dark)
    for f in feet:
        pnt.stroke([f, hub], 5.2, lit)
    for (a0, a1, w) in braces:
        pnt.stroke([a0, a1], w, lit)
    for f in feet:
        it.lights.append((f[0] * 0.1 + hub[0] * 0.9, f[1] * 0.1 + hub[1] * 0.9, 'nav'))
        for t in (0.15, 0.4, 0.65):
            it.lights.append((*lerp(f, hub, t), 'bulb'))
    for (r, w, k) in ((rw, 3.2, 1.0), (rw - 4.5, 1.5, 0.85), (rw * 0.46, 1.6, 0.85), (9.5, 1.4, 0.8)):
        pnt.stroke(arc_pts(hub[0], hub[1], r, r, 0, 360, max(40, int(r * 3))), w, metal('white', face * k, sun))
    pnt.disc(*hub, 6.5, lambda xx, yy, q: ramp_c('white', 0.8 - 0.4 * q) * face)
    pnt.disc(*hub, 2.6, lambda xx, yy, q: ramp_c('gold', 0.9 - 0.3 * q) * face)
    rim = arc_pts(hub[0], hub[1], rw + 2.4, rw + 2.4, 0, 360, 120)
    it.neon.piece([(rim, 1.5, N_CYAN)], BLINK, 0, 2.4, tag='wheel:cyan')
    it.neon.piece([(rim, 1.5, N_PINK)], BLINK, 1, 2.4, tag='wheel:pink')
    it.sprites['wheel'] = dict(centre=hub, r=rw, face=face, sun=sun)
    if LK['wheel_spin'] is None:
        pnt.blit(wheel_sprite(it.sprites['wheel'], missing=(2, 3, 9, 15, 16, 21)), hub, SPR)


def gate(pnt, it, deg, col_neon):
    """A docking gate on the limb: a gold casino front standing out of the skyline (seen side on, its up is the
    planet's up there): a horseshoe mouth, its tunnel of nested lit arches running in to a blazing bay, columns and
    a crown over it, red wings; marquee bulbs round the mouth, neon along the roofline; ships come in along
    it.lanes."""
    face, sun = item_light(polar_xy(R_PL, deg))
    q = lambda r, s: polar_xy(r, deg, s)
    G = R_PL - 14          # the ground the gate stands on (behind the near skyline)

    def ground(s0, s1, n=10):
        """The gate's foot along the planet's curve (radius G) from tangent offset s0 to s1."""
        return [polar_xy(G, deg + math.degrees((s0 + (s1 - s0) * k / n) / G)) for k in range(n + 1)]

    # red wings (stepped), the gold front, the crown
    for s in (-1, 1):
        pnt.poly([q(R_PL + 14, 30 * s), q(R_PL + 14, 38 * s), q(R_PL + 6, 44 * s)] + ground(46 * s, 30 * s, 6), lambda xx, yy: ramp_c('red', 0.42 + 0 * xx) * face)
        for k in range(3):
            pnt.stroke([q(G + 6 + k * 6, 33 * s), q(G + 6 + k * 6, 42 * s)], 1.0, lambda xx, yy, qq: np.array([0.08, 0.05, 0.04]) + 0 * qq[..., None],
                       lambda xx, yy, qq: np.array([1.0, 0.8, 0.45]) * 0.9 + 0 * qq[..., None])
    front = ground(30, -30, 12) + [q(R_PL + 26, -30), q(R_PL + 32, -24), q(R_PL + 32, 24), q(R_PL + 26, 30)]
    pnt.poly(front, lambda xx, yy: ramp_c('gold', 0.46 + 0 * xx) * face)
    crown = [q(R_PL + 31, -22), q(R_PL + 38, -14), q(R_PL + 35.5, -7), q(R_PL + 42, 0), q(R_PL + 35.5, 7), q(R_PL + 38, 14), q(R_PL + 31, 22)]
    pnt.poly(crown, lambda xx, yy: ramp_c('gold', 0.7 + 0 * xx) * face)
    for s in (-1, 1):
        for k in range(2):
            c0 = 21 + 4.5 * k
            pnt.stroke([q(G + 2, c0 * s), q(R_PL + 24, c0 * s)], 2.4, lambda xx, yy, qq: ramp_c('white', 0.8 - 0.35 * qq) * face)
    # the mouth: nested arches, each smaller and further in, to the bay of light
    Rm, Hm = 16.0, R_PL + 8

    def arch(r, hc):
        return ground(r, -r, 4)[1:-1] + [q(G, -r)] + [polar_xy(hc + r * math.cos(math.radians(t)), deg, -r * math.sin(math.radians(t))) for t in range(90, -91, -9)] + [q(G, r)]

    pnt.poly(arch(Rm + 3.5, Hm), lambda xx, yy: ramp_c('gold', 0.85 + 0 * xx) * face)
    n = 7
    for k in range(n):
        f = k / n
        r = Rm * (1 - 0.8 * f)
        hc = Hm - 6 * f
        glow = 0.15 + 1.0 * f ** 1.5
        dark = k % 2 == 0
        c = np.array([1.0, 0.72, 0.38]) * glow if dark else np.array([0.18, 0.1, 0.06]) + np.array([1.0, 0.8, 0.5]) * glow * 0.6
        c = c * LK['gate_fill'] * (np.array([1.0, 0.7, 0.5]) if LK['pirate'] else 1.0)
        pnt.poly(arch(r, hc), lambda xx, yy, c=c: c + 0 * xx[..., None], lambda xx, yy, c=c: c * 0.9 + 0 * xx[..., None])
    core = q(Hm - 6, 0)
    gf = LK['gate_fill']
    pnt.disc(*core, 3.6, lambda xx, yy, qq: np.array([1.0, 0.97, 0.88]) * (1.4 - 0.4 * qq[..., None]) * gf, lambda xx, yy, qq: np.array([1.0, 0.95, 0.8]) * (1.4 - 0.4 * qq[..., None]) * gf)
    bulbs = [polar_xy(Hm + (Rm + 1.8) * math.cos(math.radians(t)), deg, -(Rm + 1.8) * math.sin(math.radians(t))) for t in range(-90, 91, 10)]
    bulbs = [q(G + 3 + 4 * k, -(Rm + 1.8)) for k in range(4)] + bulbs + [q(Hm - 1 - 4 * k, Rm + 1.8) for k in range(4)]
    for b in bulbs:
        it.lights.append((b[0], b[1], 'bulb'))
    roof = [q(R_PL + 14, -44), q(R_PL + 14, -31), q(R_PL + 27, -31), q(R_PL + 33, -24), q(R_PL + 33, 24), q(R_PL + 27, 31), q(R_PL + 14, 31), q(R_PL + 14, 44)]
    it.neon.piece([(roof, 1.7, col_neon)], BUZZ, deg * 0.37, tag='gate%d:roof' % deg)
    it.neon.piece([(crown + [crown[0]], 1.4, N_GOLD)], BLINK, 0, 0.7, tag='gate%d:crown' % deg)
    it.lights.append((*q(R_PL + 41, 0), 'nav'))
    # the lanes: ships come in from out past the frame edge into the mouth, and leave beside them
    it.lanes.append(([q(R_PL + 150, -10), q(R_PL + 80, -6), q(Hm, -2.5)], 'in'))
    it.lanes.append(([q(Hm, 2.5), q(R_PL + 80, 7), q(R_PL + 150, 12)], 'out'))


def heart_pts(n=36):
    pts = []
    for k in range(n + 1):
        t = 2 * math.pi * k / n
        x = 16 * math.sin(t) ** 3 / 17
        y = -(13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)) / 17
        pts.append((x, y + 0.1))
    return pts


def suit_tubes(kind, s):
    if kind == 0:   # spade
        h = [(x * s, -y * s - 0.15 * s) for (x, y) in heart_pts()]
        return [h, [(0, 0.35 * s), (-0.3 * s, 0.95 * s), (0.3 * s, 0.95 * s), (0, 0.35 * s)]], N_WHITE
    if kind == 1:   # heart
        return [[(x * s, y * s) for (x, y) in heart_pts()]], N_RED
    if kind == 2:   # diamond
        return [[(0, -s), (0.68 * s, 0), (0, s), (-0.68 * s, 0), (0, -s)]], N_RED
    lobes = [arc_pts(cx * s, cy * s, 0.32 * s, 0.32 * s, 0, 360, 20) for (cx, cy) in ((0, -0.42), (-0.4, 0.1), (0.4, 0.1))]
    return lobes + [[(0, 0.2 * s), (-0.25 * s, 0.95 * s), (0.25 * s, 0.95 * s), (0, 0.2 * s)]], N_WHITE


def rooftop_signs(it):
    """The neon lying flat on the pads, projected (tangent plane at the pad top -> frame px)."""
    for (name, sx, sy, rot, (ha, hb), hp) in SIGNS:
        v = SIGN_V[name]
        o, ex, ey = affine_at(v, hp)
        M2 = np.stack([-ex, -ey], -1)
        cr, sr = math.cos(math.radians(rot)), math.sin(math.radians(rot))

        def P(u, w):
            a = u * cr - w * sr
            b = u * sr + w * cr
            p = o + M2 @ np.array([a, b])
            return (float(p[0]), float(p[1]))

        def T(strokes):
            return [[P(u, w) for (u, w) in st] for st in strokes]

        if name == 'jackpot':
            lw, lh, gap = 8.6, 12.0, 2.3
            x0 = -(7 * lw + 6 * gap) / 2
            for k, ch in enumerate('JACKPOT'):
                g = T(glyph(ch, x0 + k * (lw + gap), -lh / 2 - 1.0, lw, lh))
                if ch == 'K':
                    it.neon.piece([(st, 1.7, N_GOLD) for st in g], DEAD, 11.0, tag='jackpot:' + ch)
                else:
                    it.neon.piece([(st, 1.7, N_GOLD) for st in g], SEQ, k, 7, 0.16, tag='jackpot:%d%s' % (k, ch))
            it.neon.piece([(T([[(-ha + 1, hb - 1.5), (ha - 1, hb - 1.5)]])[0], 1.3, N_RED), (T([[(-ha + 1, -hb + 1.2), (ha - 1, -hb + 1.2)]])[0], 1.3, N_RED)], BUZZ, 7.0, tag='jackpot:rule')
        elif name.startswith('suit'):
            k = int(name[-1])
            tubes, c = suit_tubes(k, 6.6)
            it.neon.piece([(st, 1.5, c) for st in T(tubes)], SEQ, k, 4, 0.55, tag='suit:%d' % k)
        elif name == 'seven':
            g = glyph('7', -9, -13, 18, 26)
            it.neon.piece([(st, 2.6, N_RED) for st in T(g)], BUZZ, 13.0, tag='seven:red')
            out = [[(-11.5, -15.5), (11.5, -15.5), (1.5, 15.0), (-5.5, 15.0), (2.5, -9.5), (-11.5, -9.5), (-11.5, -15.5)]]
            it.neon.piece([(st, 1.2, N_GOLD) for st in T(out)], BLINK, 0, 0.6, tag='seven:gold')
        elif name == 'dice':
            for d, cx in enumerate((-7.5, 7.5)):
                sq = [[(cx - 6, -6), (cx + 6, -6), (cx + 6, 6), (cx - 6, 6), (cx - 6, -6)]]
                it.neon.piece([(st, 1.4, N_WHITE) for st in T(sq)], BUZZ, 17.0 + d, tag='dice:%d' % d)
                pips = [(0, 0)] if d == 0 else [(-3, -3), (3, 3), (-3, 3), (3, -3), (0, 0)]
                if d == 0:
                    pips = [(-3, -3), (0, 0), (3, 3)]
                dots = [[(cx + px - 0.4, py), (cx + px + 0.4, py)] for (px, py) in pips]
                it.neon.piece([(st, 1.9, N_RED) for st in T(dots)], BLINK, d, 0.8, tag='pips:%d' % d)
        elif name == 'cherry':
            ch = [arc_pts(-5, 5, 5.2, 5.2, 0, 360, 24), arc_pts(5.5, 6.5, 5.2, 5.2, 0, 360, 24)]
            st_ = [[(-4, 0), (-1, -6), (3, -11)], [(5, 1.5), (4, -5), (3, -11)], [(3, -11), (8, -12), (11, -9), (6, -8.5), (3, -11)]]
            it.neon.piece([(st, 1.8, N_RED) for st in T(ch)], BUZZ, 23.0, tag='cherry:red')
            it.neon.piece([(st, 1.4, N_GREEN) for st in T(st_)], DEAD, 29.0, tag='cherry:green')
        elif name == 'arrow':
            for k in range(3):
                x = -11 + k * 9
                chev = [[(x, -5.5), (x + 6, 0), (x, 5.5)]]
                it.neon.piece([(st, 2.0, N_CYAN) for st in T(chev)], SEQ, k, 3, 0.24, tag='arrow:%d' % k)


def build_items(pnt):
    it = Items()
    casino_sign(pnt, it, 332.0, 125.0)
    starburst(pnt, it, 208)
    gate(pnt, it, 152, N_PINK)
    gate(pnt, it, -28, N_CYAN)
    high_roller(pnt, it, 6)
    rooftop_signs(it)
    # the port's lane comes down from beyond the south limb
    po = FEAT['port']
    it.lanes.append(([(458, 728), (428, 640), (po[0] + 4, po[1] + 4)], 'in'))
    it.lanes.append(([(po[0] - 4, po[1] + 6), (402, 640), (420, 728)], 'out'))
    return it


# ----------------------------------------------------------------------------------------------------------------
# The turning sprites (the runtime turns them over the frame), the lamps
# ----------------------------------------------------------------------------------------------------------------

SPR = 2   # sprite px per frame px


def rgba_of(col, A):
    res = np.zeros(A.shape + (4,), np.uint8)
    res[..., :3] = np.round(np.clip(col, 0, 1) * 255)
    res[..., 3] = np.round(np.clip(A, 0, 1) * 255)
    return res


def rotor_sprite(name):
    """The rotor of a roulette arena, top down (its own tangent plane: x west, y south), SPR px per frame px."""
    r = FEAT[name][2][0]
    m = floodlit(FEAT_V[name])
    S = int(math.ceil(2 * r * SPR)) + 4
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float64) + 0.5
    a, b = (xx - S / 2) / SPR, (yy - S / 2) / SPR
    alb, em, A = rotor(a, b, r, GLOWING[name], aa=SPR)
    lip = np.clip(1 - (r - np.hypot(a, b)) / 2.5, 0, 1)
    col = alb * m * (1 - 0.45 * lip)[..., None] + em
    return rgba_of(col, A)


def wheel_sprite(spec, missing=()):
    """The observation wheel's turning part, face on: 16 bold spokes from the hub to the rim, a thin tension spoke
    either side of each, 28 lit cabins on the rim (`missing`: cabin indexes gone, the den's)."""
    r = spec['r']
    face = spec['face']
    S = int(math.ceil(2 * (r + 8) * SPR)) + 4
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float64) + 0.5
    a, b = (xx - S / 2) / SPR, (yy - S / 2) / SPR
    A = np.zeros(a.shape)
    col = np.zeros(a.shape + (3,))
    steel = ramp_c('white', 0.75) * face

    def line(p0, p1, hw, c):
        nonlocal col, A
        d = seg_dist(a, b, [p0, p1])
        m = np.clip((hw - d) * SPR + 0.5, 0, 1)
        col = col * (1 - m[..., None]) + c * m[..., None]
        A = np.maximum(A, m)

    # the spokes are lit along their length (LED strips), so they read over the city at night; the den's are dead
    led = np.array([0.08, 0.06, 0.05]) + steel * 0.5 if LK['pirate'] else np.array([1.0, 0.9, 0.74])
    for k in range(16):
        t = 2 * math.pi * k / 16
        line((8.5 * math.cos(t), 8.5 * math.sin(t)), ((r - 1.5) * math.cos(t), (r - 1.5) * math.sin(t)), 1.25, np.array([0.03, 0.03, 0.035]))
        line((8.5 * math.cos(t), 8.5 * math.sin(t)), ((r - 1.5) * math.cos(t), (r - 1.5) * math.sin(t)), 0.62, led)
        for off in (-0.16, 0.16):
            line((8.5 * math.cos(t + off), 8.5 * math.sin(t + off)), ((r - 1.5) * math.cos(t - off * 0.35), (r - 1.5) * math.sin(t - off * 0.35)), 0.3, steel * 0.8)
    ncab = 28
    tints = [np.array(N_GOLD), np.array(N_PINK), np.array(N_CYAN), np.array(N_WHITE)]
    for k in range(ncab):
        if k in missing:
            continue
        t = 2 * math.pi * (k + 0.5) / ncab
        cx, cy = (r + 4.0) * math.cos(t), (r + 4.0) * math.sin(t)
        ca, sa = math.cos(t), math.sin(t)
        u = (a - cx) * ca + (b - cy) * sa
        w = -(a - cx) * sa + (b - cy) * ca
        q = np.hypot(u / 2.4, w / 1.9)
        m = np.clip((1 - q) * 2.0 * SPR + 0.5, 0, 1)
        glass = q < 0.62
        lit = tints[k % 4] * 0.85 + 0.15
        if LK['pirate']:
            lit = np.array([0.06, 0.05, 0.04]) if k % 5 else np.array([0.7, 0.35, 0.12])   # dark cabins, one lamp left in a few
        c = np.where(glass[..., None], lit, ramp_c('white', 0.75) * face)
        col = col * (1 - m[..., None]) + c * m[..., None]
        A = np.maximum(A, m)
        # the cabin's hanger to the rim
        d = seg_dist(a, b, [((r - 0.5) * ca, (r - 0.5) * sa), ((r + 2.0) * ca, (r + 2.0) * sa)])
        mh = np.clip((0.5 - d) * SPR + 0.5, 0, 1)
        col = col * (1 - mh[..., None]) + steel * mh[..., None]
        A = np.maximum(A, mh)
    return rgba_of(col / np.maximum(A, 1e-6)[..., None] * (A > 0)[..., None], A)


def item_lamps(it, cm, buf):
    """Marquee bulbs round the arenas' colonnades and the port's collar (where they show), red aviation lights on
    the tallest towers, white strobes on the pyramids' tips."""
    idb = buf['id']

    def shows(x, y, ids):
        i, j = int(y * PS), int(x * PS)
        return 0 <= i < NB and 0 <= j < NB and idb[i, j] in ids

    for name, (_, _, rr) in FEAT.items():
        R0 = (rr[1] + rr[2]) / 2
        h = 4.0 if name == 'port' else 3.0
        o, M2, Mi = feature_affine(name, h)
        n = int(2 * math.pi * R0 / 6.0)
        for k in range(n):
            t = 2 * math.pi * k / n
            p = o + M2 @ np.array([R0 * math.cos(t), R0 * math.sin(t)])
            if shows(p[0], p[1], (ST_PLAZA,)):
                it.lights.append((float(p[0]), float(p[1]), 'gold'))
    navs = []
    for lid, l in enumerate(cm.lots):
        topf = l['top'] / PS
        if topf < 12.5 and l['kind'] != 'pyramid':
            continue
        v = dir_of(l['lo'], l['la'])
        if v[2] < 0.08:
            continue
        p = C0 + v[:2] * (R_PL + topf)
        if shows(p[0], p[1], (lid,)):
            navs.append((float(p[0]), float(p[1]), 'white' if l['kind'] == 'pyramid' else 'nav'))
    rng = np.random.default_rng(5)
    if len(navs) > 48:
        navs = [navs[i] for i in sorted(rng.choice(len(navs), 48, replace=False))]
    it.lights += navs


# ----------------------------------------------------------------------------------------------------------------
# The runtime, simulated (the same patterns threatArt.ts runs): neon behaviours, the wheels, the ball, the lanes
# ----------------------------------------------------------------------------------------------------------------



LANE_C = {'in': (1.0, 0.93, 0.78), 'out': (1.0, 0.2, 0.12)}   # headlights in, tail lights out
LANE_NEAR = R_PL + 14.0    # the lanes are full bright within this many frame px of the centre ...
LANE_FAR = R_PL + 105.0    # ... and gone past this (threatArt.ts fades the ships the same way)


def lane_fade(rho):
    """A lane's brightness at `rho` frame px from the casino's centre: full near the planet, nothing far out."""
    return np.clip((LANE_FAR - rho) / (LANE_FAR - LANE_NEAR), 0, 1) ** 1.3


def lane_glow(pnt, pts, kind):
    """A faint stream of light along a traffic lane (the ships' wake), fading out with the distance from the centre."""
    c = np.array(LANE_C[kind])
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    sl, xx, yy = pnt.region(min(xs) - 4, min(ys) - 4, max(xs) + 4, max(ys) + 4)
    d = seg_dist(xx, yy, pts)
    m = np.exp(-(d / 1.0) ** 2) * 0.16 * LK['lane'][2] * lane_fade(np.hypot(xx - C0, yy - C0)) * (1 - pnt.A[sl])
    pnt.over(sl, m, c * 0.9, c * 0.9)



# ----------------------------------------------------------------------------------------------------------------
# The whole casino: the frame, its neon atlas and turning sprites, the runtime tables
# ----------------------------------------------------------------------------------------------------------------

def gold_grade(rgb, sigma=5.0, sat=1.3, warm=(1.02, 1.04, 0.8), gain=1.06):
    """A grade of the frame's broad colour only (a blur of it): richer, warmer, a touch brighter, so from afar the
    casino reads as a gold blaze; the fine detail (the sparkle of a thousand lights) rides on it untouched."""
    low = np.stack([fblur(rgb[..., k], sigma) for k in range(3)], -1)
    high = rgb - low
    lum = (low @ LUM)[..., None]
    graded = np.clip((lum + (low - lum) * sat) * np.array(warm) * gain, 0, None)
    return np.clip(graded + high, 0, 1.5)


def pack_atlas(imgs, pad=4):
    """Shelf-pack RGBA pieces into one square atlas (side a multiple of 8): (atlas, [(x, y)] per piece)."""
    area = sum((g.shape[0] + pad) * (g.shape[1] + pad) for g in imgs)
    side = int(math.ceil(math.sqrt(area) * 1.12 / 8)) * 8
    order = sorted(range(len(imgs)), key=lambda k: (-imgs[k].shape[0], k))
    while True:
        pos = [None] * len(imgs)
        x = y = pad
        shelf = 0
        ok = True
        for k in order:
            h, w = imgs[k].shape[:2]
            if x + w + pad > side:
                x = pad
                y += shelf + pad
                shelf = 0
            if y + h + pad > side or w + 2 * pad > side:
                ok = False
                break
            pos[k] = (x, y)
            x += w + pad
            shelf = max(shelf, h)
        if ok:
            break
        side += 16
    atlas = np.zeros((side, side, 4), np.uint8)
    for k, g in enumerate(imgs):
        x, y = pos[k]
        atlas[y:y + g.shape[0], x:x + g.shape[1]] = g
    return atlas, pos


def build_casino(root):
    """The Gilded Orbit: a planet that is all casino, always at night (see the header). Returns the frame (RGBA uint8,
    FRAME px), its lamps (frame px, kind) and the extras: the neon atlas, the two rotor sprites, the observation
    wheel sprite and the runtime tables (giantworksLights.ts GW_CASINO_*)."""
    t0 = time.time()
    cm = build_city(root)
    if LK['pirate']:
        decay_city(cm)
    t1 = time.time()
    rays, X, Y, zhit = raymarch(cm.H, verbose=False)
    t2 = time.time()
    col, A, buf = shade_planet(cm, rays, X, Y, zhit)
    del rays, X, Y, zhit
    col = draw_features(col, A, buf)
    col2, A2 = atmosphere(col, A, buf)
    pnt = Painter(col2, A2, buf['em'] * A[..., None] / np.maximum(A2, 1e-6)[..., None])
    it = build_items(pnt)
    it.neon.bake_glass(pnt)
    for (pts, kind) in it.lanes:
        lane_glow(pnt, pts, kind)
    col2, A2, emb = pnt.result()
    rgb, a = to_frame(col2, A2)
    emf = np.stack([down(emb[..., k] * A2, FRAME, FRAME) for k in range(3)], -1)
    rgb, a = bloom(rgb, a, emf)
    rgb = gold_grade(rgb, **LK['grade'])
    res = rgba8(rgb, a)
    item_lamps(it, cm, buf)
    if LK['keep']:
        # the den: most bulbs dead, half the aviation lights out
        it.lights = [L for n, L in enumerate(it.lights) if zlib.crc32(b'den%d' % n) % 1000 < 1000 * LK['keep'].get(L[2], 1.0)]
    glows = [it.neon.glow(pc) for pc in it.neon.pieces]
    atlas, places = pack_atlas([g for g, _ in glows])
    print('   casino: city %.1f s (%d lots), march %.1f s, the rest %.1f s; %d neon pieces in a %d px atlas' % (
        t1 - t0, len(cm.lots), t2 - t1, time.time() - t2, len(glows), atlas.shape[0]), flush=True)
    neon = []
    for pc, (g, (fx, fy)), (ax, ay) in zip(it.neon.pieces, glows, places):
        neon.append([ax, ay, g.shape[1], g.shape[0], fx, fy, pc['beh'], *pc['p']])
    rotors, sprites = [], []
    for name in ('wheel_main', 'wheel_2'):
        spin = LK['spin'][name]
        if spin == 0:
            continue   # stopped: the frame's wheel is all there is
        o, M2, Mi = feature_affine(name)
        rr = FEAT[name][2]
        rotors.append([len(sprites), o[0], o[1], M2[0, 0], M2[0, 1], M2[1, 0], M2[1, 1], spin, rr[0], rr[1], LK['jerk'].get(name, 0.0)])
        sprites.append((('rotor-main', 'rotor-night')[name == 'wheel_2'], rotor_sprite(name)))
    hs = it.sprites['wheel']
    turning = LK['wheel_spin'] is not None
    extras = dict(
        atlas=atlas,
        rotors=sprites,
        wheel=wheel_sprite(hs) if turning else None,
        tables=dict(neon=neon, rotors=rotors, wheel=[hs['centre'][0], hs['centre'][1], LK['wheel_spin']] if turning else None,
                    lanes=[[0 if kind == 'in' else 1] + [v for p in pts for v in p] for (pts, kind) in it.lanes],
                    fade=[LANE_NEAR, LANE_FAR], lane=list(LK['lane']), ball=LK['ball']),
    )
    return res, it.lights, extras


def casino_lights(lights, res):
    """The casino's lamps that sit on the finished frame (an opaque pixel), as rounded frame px."""
    out = []
    H, W = res.shape[:2]
    for (x, y, k) in lights:
        xi, yi = int(math.floor(x)), int(math.floor(y))
        if 0 <= xi < W and 0 <= yi < H and res[yi, xi, 3] > 120:
            out.append((xi, yi, k))
    return out


# ---------------------------------------------------------------------------------------------------------------
# The Ultramind (a planet wrapped in a machine)
# ---------------------------------------------------------------------------------------------------------------

MACHINE_SRC = [('family14/largespaceport.png', 50), ('family14/capitalship.png', 40), ('family14/resupplyship.png', 44),
               ('family0/largespaceport.png', 46), ('family9/largespaceport.png', 44), ('family14/largefreighter.png', 36)]
CYAN = (0.3, 0.95, 1.0)
TILT = math.radians(28)


def sphere_coords(S, Rs, tilt=TILT):
    """Per pixel of an S x S canvas (build px) round its centre: inside-disc mask, view normal (nx, ny, nz) and the
    planet-frame longitude / latitude (the axis tipped `tilt` toward the viewer, north up)."""
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float64) + 0.5
    x = (xx - S / 2) / (Rs * SS)
    y = (yy - S / 2) / (Rs * SS)
    d2 = x * x + y * y
    inside = d2 < 1
    z = np.sqrt(np.clip(1 - d2, 0, 1))
    # rotate the view vector about the x axis: planet Y (north) leans toward the viewer
    Y = -y * math.cos(tilt) + z * math.sin(tilt)
    Z = y * math.sin(tilt) + z * math.cos(tilt)
    lon = np.arctan2(x, Z)
    lat = np.arcsin(np.clip(Y, -1, 1))
    return inside, x, y, z, lon, lat, np.sqrt(d2)


def sphere_wrap(strip, Rs, S=None, tilt=TILT, keep=None):
    """A strip piece (x along the longitude, 0..2pi; y down the latitude, north at 0) mapped onto the visible face of a
    sphere of radius Rs (layout px): a procedural piece (S build px square), sphere-shaded. keep: a mask (S x S) of the
    pixels kept."""
    S = S or int(math.ceil(2 * Rs * SS)) + 4
    inside, x, y, z, lon, lat, d = sphere_coords(S, Rs, tilt)
    sh, sw = strip.A.shape
    u = (lon + math.pi) / (2 * math.pi) * (sw - 1)
    v = (math.pi / 2 - lat) / math.pi * (sh - 1)
    u0 = np.clip(np.floor(u).astype(int), 0, sw - 1)
    v0 = np.clip(np.floor(v).astype(int), 0, sh - 1)
    u1 = np.clip(u0 + 1, 0, sw - 1)
    v1 = np.clip(v0 + 1, 0, sh - 1)
    fu, fv = u - np.floor(u), v - np.floor(v)
    m = inside if keep is None else inside & keep

    def samp(a):
        if a.ndim == 3:
            return np.stack([samp(a[..., k]) for k in range(a.shape[2])], -1)
        o = a[v0, u0] * (1 - fu) * (1 - fv) + a[v0, u1] * fu * (1 - fv) + a[v1, u0] * (1 - fu) * fv + a[v1, u1] * fu * fv
        return np.where(m, o, 0)

    edge = np.clip((1 - d) * Rs * SS + 0.5, 0, 1)
    A = samp(strip.A) * edge
    sph = shade(x, y, z, amb=0.18, k=0.85, spec=0.18)
    L = samp(strip.L) * (0.35 + 0.85 * sph)
    n = None if strip.n is None else samp(strip.n)
    e = None if strip.e is None else samp(strip.e)
    mats = {k: samp(v) for k, v in strip.mats.items()}
    return Piece(A, np.clip(L, 0, 1), n, e, mats)


def machine_strip(root, rng, Rs, emit=True):
    """The Ultramind's server plating unrolled (longitude x latitude): machine-grey stock crops and smooth plates in
    rows, cyan status-light rows; the whole sphere (only the visible face is sampled)."""
    kit = plate_kit(root, rng, 6, MACHINE_SRC, light_col=(0.55, 0.92, 1.0))
    W = 2 * math.pi * Rs
    H = math.pi * Rs
    c = deck_strip(rng, kit, W, H, 22, int(H / 20), period=8, smooth=0.25, contrast=0.75, mat='machine', smooth_mat='machine', nat=0.15)
    for k in range(int(H / 20)):
        c.put(window_row(W, 2.4, 3.4, rng, lit=0.35 if emit else 0.0, col=(0.35, 0.7, 0.8)), W / 2, (k + 0.5) * H / int(H / 20), mat='dark', shadow=0.2)
    return c.as_piece()


def lattice_mask(S, Rs, step_deg=15, w=2.2, tilt=TILT):
    """The geodesic frame over the sphere: meridians and parallels every step_deg, `w` layout px wide (thinning toward
    the limb as they turn away)."""
    inside, x, y, z, lon, lat, d = sphere_coords(S, Rs, tilt)
    st = math.radians(step_deg)
    dl = np.abs(((lat + st / 2) % st) - st / 2) * Rs
    dm = np.abs(((lon + st / 2) % st) - st / 2) * Rs * np.cos(lat)
    k = np.sqrt(np.clip(z, 0.05, 1))
    m = np.clip(w / 2 * k + 0.5 - np.minimum(dl, dm) * k, 0, 1)
    m = np.where(np.abs(lat) > math.radians(82), 0, m)
    return m * inside, lon, lat, inside, x, y, z


def radiator(length, w0, w1, rng):
    """A radiator wing seen from above (along y, root at the bottom): a tapering array of pale heat-exchanger panels
    in rows (tones varying, dark gaps), a coolant manifold pipe down the middle with branch pipes, lattice edge rails,
    pump blocks at the root."""
    c = Canvas(max(w0, w1) + 6, length + 2)
    cx = c.lw / 2
    rows = int(length / 7)
    for i in range(rows):
        t = (i + 0.5) / rows               # 0 tip .. 1 root (y down)
        w = w1 + (w0 - w1) * t
        y = 1 + (i + 0.5) * length / rows
        for sd in (-1, 1):
            pw = w / 2 - 3
            c.put(plate_panel(pw, length / rows - 0.9, rng, bevel=0.7, seams=0), cx + sd * (pw / 2 + 2.2), y, mat='white',
                  tone=float(rng.uniform(0.05, 0.25)), shadow=0.0, edge=0.7)
            if rng.random() < 0.18:
                c.put(box_module(pw * 0.4, length / rows - 2, seams=0, vents=False), cx + sd * (pw * 0.6 + 2), y, mat='machine', shadow=0.3)
    for sd in (-1, 1):
        x0 = cx + sd * (w0 / 2 - 1.2)
        x1 = cx + sd * (w1 / 2 - 1.2)
        girder(c, x0, length, x1, 1, 3.2, rail=0.9, bay=4, mat='machine', shadow=0.4)
    c.put(cylinder(4.4, length, caps=False, bands=tuple(np.linspace(0.05, 0.95, 9))), cx, length / 2 + 1, mat='machine', shadow=0.5)
    for i in range(0, rows, 3):
        y = 1 + (i + 0.5) * length / rows
        c.put(cylinder(1.8, (w1 + (w0 - w1) * i / rows) * 0.8, caps=False), cx, y, rot=90, mat='steel', shadow=0.3, gain=0.8)
    c.put(box_module(w0 * 0.7, 9, seams=1), cx, length - 3, mat='machine', shadow=0.5, edge=0.8)
    return c.as_piece()


def ultramind_eye(r, rng):
    """The processing core on the visible pole: concentric rings of circuitry round a glowing iris (cyan emission)."""
    S = int(math.ceil(2 * r * SS)) + 2
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float64) + 0.5
    dx, dy = (xx - S / 2) / (r * SS), (yy - S / 2) / (r * SS)
    d = np.hypot(dx, dy)
    ang = np.arctan2(dy, dx)
    A = np.clip((1 - d) * r * SS + 0.5, 0, 1)
    L = 0.4 + 0.2 * np.cos(d * 40) * (d > 0.3)
    rings = (np.abs(((d * 7) % 1) - 0.5) > 0.38) & (d > 0.28)
    L = np.where(rings, 0.7, L)
    seg = np.abs(((ang / (2 * math.pi) * 24) % 1) - 0.5) > 0.42
    L = np.where(seg & (d > 0.45), L * 0.5, L)
    e = np.zeros((S, S, 3))
    iris = np.clip(1 - d / 0.3, 0, 1)
    trace = rings & ~seg & (d > 0.3)
    glow = iris ** 0.7 + 0.45 * trace
    e += glow[..., None] * np.array(CYAN)
    mats = {'machine': np.ones((S, S))}
    return Piece(A, np.clip(L, 0, 1), None, e, mats)


def glow_from(c, kinds=None, boost=1.0, blur=1.8, size=None):
    """An additive glow layer (straight RGBA: colour, alpha = brightness) from a canvas' emission: the emission
    brought down to the frame, a soft halo round it."""
    r = c.result()
    A = c.ch['A']
    e = np.stack([c.ch['e0'], c.ch['e1'], c.ch['e2']], -1)
    W, H = int(c.lw), int(c.lh)
    ed = np.stack([np.clip(down(e[..., k], W, H), 0, None) for k in range(3)], -1) * boost
    halo = np.stack([fblur(ed[..., k], blur) for k in range(3)], -1) * 1.4
    tot = np.clip(np.maximum(ed, halo), 0, 1)
    a = tot.max(2)
    rgb = np.where(a[..., None] > 1e-3, tot / np.maximum(a, 1e-3)[..., None], 0)
    res = np.zeros((H, W, 4), np.uint8)
    res[..., :3] = np.round(np.clip(rgb, 0, 1) * 255)
    res[..., 3] = np.round(np.clip(a, 0, 1) * 255)
    return res


def wrap_machine(c, root, rng, Rs, cover, cx, cy, fins=8, fin_len=110, planet=None):
    """The machine shell round a sphere of radius Rs at (cx, cy): radiator fins behind it, the planet (a piece, or
    None: the gaps stay open), server plating on the `cover` share of the lattice cells, the geodesic frame, the polar
    eye, status lights."""
    S = int(math.ceil(2 * Rs * SS)) + 4
    # radiator fins (under everything), each on a short truss root
    for k in range(fins):
        a = math.radians(22.5 + 360 / fins * k)
        x0, y0 = polar(Rs - 30, a, cx, cy)
        x1, y1 = polar(Rs + fin_len, a, cx, cy)
        ln = math.hypot(x1 - x0, y1 - y0)
        c.put(radiator(ln, 30, 46, rng), (x0 + x1) / 2, (y0 + y1) / 2, rot=-math.degrees(a) - 90, shadow=0.6, edge=0.6)
        girder(c, *polar(Rs - 20, a, cx, cy), *polar(Rs + 18, a, cx, cy), 12, rail=2.2, bay=7, mat='machine', shadow=0.6)
        c.light(*polar(Rs + fin_len - 2, a, cx, cy), 'nav')
    c.put(arc_beam(Rs + 6, 7, ticks=8.0, mat='machine'), cx, cy, shadow=0.6)
    if planet is not None:
        c.put(planet, cx, cy, shadow=0.0, gain=0.72)
    # the plating: lattice cells chosen at random (denser on the visible pole and the equator band)
    lat_m, lon, lat, inside, x, y, z = lattice_mask(S, Rs, 15, 3.4)
    st = math.radians(15)
    ci = np.floor(lon / st).astype(int) + 100
    cj = np.floor(lat / st).astype(int) + 100
    rv = rng.random((300, 300))
    cov = rv[cj, ci] < cover
    strip = machine_strip(root, rng, Rs)
    plating = sphere_wrap(strip, Rs, S, keep=cov)
    c.put(plating, cx, cy, shadow=0.55, edge=1.0)
    # the frame
    sph = shade(x, y, z, amb=0.25, k=0.8, spec=0.3)
    fr = Piece(lat_m, np.clip(0.3 + 0.6 * sph, 0, 1), None, None, {'machine': np.ones((S, S))})
    c.put(fr, cx, cy, shadow=0.45)
    # data seams: a few parallels and meridians glowing
    seam = np.zeros((S, S))
    for la in (0.0, math.radians(30), math.radians(-30)):
        seam = np.maximum(seam, np.clip(1.2 - np.abs(lat - la) * Rs * np.sqrt(np.clip(z, 0.05, 1)) * 1.4, 0, 1))
    for lo in np.arange(-math.pi, math.pi, math.radians(45)):
        seam = np.maximum(seam, np.clip(1.2 - np.abs(lon - lo) * Rs * np.cos(lat) * np.sqrt(np.clip(z, 0.05, 1)) * 1.4, 0, 1) * (np.abs(lat) < math.radians(70)))
    seam *= inside
    sp = Piece(seam * 0.8, np.full((S, S), 0.3), None, seam[..., None] * np.array(CYAN)[None, None, :] * 0.45, {'machine': np.ones((S, S))})
    c.put(sp, cx, cy, shadow=0.0)
    # the eye on the visible pole
    py = -math.sin(TILT) * 0 - Rs * math.cos(TILT)
    ex, ey = cx, cy - Rs * math.cos(TILT)
    c.put(ultramind_eye(Rs * 0.2, rng), ex, ey, sy=math.sin(TILT) * 1.6, shadow=0.5)
    # status lights on the plating
    ys, xs = np.nonzero(cov & inside & (z > 0.3))
    for i in rng.choice(len(ys), size=min(40, len(ys)), replace=False):
        c.light(cx + (xs[i] / SS - S / SS / 2), cy + (ys[i] / SS - S / SS / 2), 'data')


R_UM = 200.0


def build_ultramind(root):
    """The Ultramind standing alone: a dark rocky planetoid wrapped in its machine shell, eight radiator fins out."""
    rng = seeded('ultramind')
    c = Canvas(FRAME)
    core = rock(np.random.default_rng(77), R_UM / 1.02, lumpy=0.0)
    wrap_machine(c, root, rng, R_UM, 0.74, C0, C0, planet=core)
    return c


SHELL_FRAME = 644
SHELL_R = 230.0


def build_ultramind_shell(root):
    """The same shell as an overlay for the planet the site wraps (mainView.ts draws it over the planet picture, which
    shows through the open cells): SHELL_FRAME px, the planet disc SHELL_R px (ULTRAMIND_SHELL_SCALE 1.4)."""
    rng = seeded('ultramind-shell')
    c = Canvas(SHELL_FRAME)
    cc = SHELL_FRAME / 2
    wrap_machine(c, root, rng, SHELL_R, 0.5, cc, cc, fin_len=88)
    return c


def build_ultramind_node(root):
    """The uplink node (the site's station beside the planet it wraps): a machine core with four radiators, a ring of
    processor blocks and uplink dishes, cyan lights."""
    rng = seeded('ultramind-node')
    c = Canvas(FRAME)
    for k in range(4):
        a = math.radians(45 + 90 * k)
        x0, y0 = polar(120, a)
        x1, y1 = polar(330, a)
        c.put(radiator(math.hypot(x1 - x0, y1 - y0), 48, 70, rng), (x0 + x1) / 2, (y0 + y1) / 2, rot=-math.degrees(a) - 90, shadow=0.6, edge=0.6)
        girder(c, *polar(100, a), *polar(170, a), 22, rail=3, bay=10, mat='machine', shadow=0.6)
        c.light(*polar(326, a), 'nav')
    kit = plate_kit(root, rng, 6, MACHINE_SRC, light_col=(0.55, 0.92, 1.0))
    W = 2 * math.pi * 150
    st = deck_strip(rng, kit, W, 70, 24, 3, period=8, smooth=0.2, contrast=0.75, mat='machine', smooth_mat='machine', nat=0.15)
    for wv in (0.2, 0.5, 0.8):
        st.put(window_row(W, 3.0, 3.6, rng, lit=0.4, col=(0.35, 0.7, 0.8)), W / 2, wv * 70, mat='dark', shadow=0.2)
    c.put(polar_wrap(st.as_piece(), 115, 185, shade_k=0.5), C0, C0, shadow=0.65, edge=1.0)
    c.put(arc_beam(185, 8, ticks=8.0, mat='machine'), C0, C0, shadow=0.5)
    c.put(arc_beam(115, 8, ticks=8.0, mat='machine'), C0, C0, shadow=0.5)
    hub = stock(root, 'family14/largespaceport.png', light_col=CYAN)
    c.put(hub, C0, C0, scale=0.8, mat='machine', nat=0.2, shadow=0.7, edge=0.7)
    dish = stock(root, 'family13/gasminingstation.png', lights='kill')
    for k in range(4):
        a = math.radians(90 * k)
        c.put(dish, *polar(205, a), scale=0.3, rot=-math.degrees(a) - 90, mat='white', nat=0.3, shadow=0.6, edge=0.6)
        girder(c, *polar(180, a), *polar(200, a), 10, rail=2, mat='machine', shadow=0.5)
    c.put(ultramind_eye(42, rng), C0, C0, shadow=0.6)
    for k in range(40):
        c.light(*polar(150 + 22 * ((k % 3) - 1), k * 2 * math.pi / 40 + 0.04), 'data')
    return c


# ---------------------------------------------------------------------------------------------------------------
# The Leviathan Sanctuary (a void aquarium)
# ---------------------------------------------------------------------------------------------------------------

R_GLASS = 230.0     # the glass sphere (frame px): threatArt.ts GW_SANCTUARY_GLASS_R masks the whales to it
CAGE_TILT = math.radians(34)


def water(Rg, rng):
    """The deep inside of the glass: dark void-water, lighter toward the upper left (the light falls in there),
    rippling caustics, drifting plankton motes (emission)."""
    S = int(math.ceil(2 * Rg * SS)) + 4
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float64) + 0.5
    x, y = (xx - S / 2) / (Rg * SS), (yy - S / 2) / (Rg * SS)
    d = np.hypot(x, y)
    A = np.clip((1 - d) * Rg * SS + 0.5, 0, 1)
    lightf = np.clip(1 - np.hypot(x + 0.3, y + 0.35) / 1.3, 0, 1)
    deep = np.array([0.02, 0.1, 0.16])
    mid = np.array([0.1, 0.36, 0.46])
    col = deep + (mid - deep) * (lightf ** 1.5)[..., None]
    n1 = fbm(rng, S, S, int(26 * SS), 3)
    n2 = fbm(rng, S, S, int(11 * SS), 2)
    caust = np.clip(1 - np.abs(np.sin((n1 * 3.2 + n2 * 1.3) * math.pi)) * 2.6, 0, 1) ** 2
    caust = fblur(caust, 1.2 * SS)
    col = col + caust[..., None] * np.array([0.06, 0.2, 0.22]) * (0.3 + 0.7 * lightf)[..., None]
    # the rim darker (the glass bends the light away)
    col *= (1 - 0.5 * smoothstep(0.7, 1.0, d))[..., None]
    e = np.zeros((S, S, 3))
    for _ in range(260):
        r_ = rng.random() ** 0.6 * 0.95
        a_ = rng.uniform(0, 2 * math.pi)
        mx, my = S / 2 + math.cos(a_) * r_ * Rg * SS, S / 2 + math.sin(a_) * r_ * Rg * SS
        rad = rng.uniform(0.5, 1.4) * SS
        dd = np.hypot(xx[int(max(0, my - 6)):int(my + 6), int(max(0, mx - 6)):int(mx + 6)] - mx, yy[int(max(0, my - 6)):int(my + 6), int(max(0, mx - 6)):int(mx + 6)] - my)
        g = np.clip(1 - dd / rad, 0, 1) ** 1.5 * rng.uniform(0.25, 0.8)
        cc = np.array([0.35, 0.95, 0.85]) if rng.random() < 0.7 else np.array([0.5, 0.7, 1.0])
        e[int(max(0, my - 6)):int(my + 6), int(max(0, mx - 6)):int(mx + 6)] += g[..., None] * cc
    mats = {'nat': np.ones((S, S))}
    return Piece(A, np.full((S, S), 0.5), col, e, mats)


def cage_mask(S, Rg, back=False, step=30, w=6.0, tilt=CAGE_TILT):
    """The cage's struts on the front (or, seen through the glass, the back) of the sphere: meridians and parallels
    every `step` deg, w layout px wide, thinning as they turn away; and the node points where they cross."""
    inside, x, y, z, lon, lat, d = sphere_coords(S, Rg, tilt)
    if back:
        zb = -z
        Y = -y * math.cos(tilt) + zb * math.sin(tilt)
        Z = y * math.sin(tilt) + zb * math.cos(tilt)
        lon = np.arctan2(x, Z)
        lat = np.arcsin(np.clip(Y, -1, 1))
        z = np.abs(zb)
    st = math.radians(step)
    dl = np.abs(((lat + st / 2) % st) - st / 2) * Rg
    dm = np.abs(((lon + st / 2) % st) - st / 2) * Rg * np.cos(lat)
    k = np.sqrt(np.clip(z, 0.04, 1))
    m = np.clip(w / 2 * k + 0.5 - np.minimum(dl, dm) * k, 0, 1)
    m = np.where(np.abs(lat) > math.radians(78), 0, m) * inside
    node = (dl < w * 0.9) & (dm < w * 0.9) & inside & (np.abs(lat) < math.radians(78))
    return m, node, x, y, z, inside


def build_sanctuary(root):
    """Two frames: the base (the support ring round the sphere with its galleries and four liner docks, the dark
    water inside the glass with the far struts seen through it) and the front (the near struts of the cage, their
    joints, the glass: a blue film, a bright rim, sheen), the runtime whales swimming between the two."""
    rng = seeded('sanctuary')
    c = Canvas(FRAME)
    S = int(math.ceil(2 * R_GLASS * SS)) + 4
    # liner docks (under the ring) on the diagonals
    liner = stock(root, 'family14/passengership.png', light_col=(1.0, 0.9, 0.7))
    for k in range(4):
        a = math.radians(45 + 90 * k)
        girder(c, *polar(R_GLASS + 50, a), *polar(R_GLASS + 116, a), 16, rail=2.6, bay=10, deck=True, solid_ends=4, mat='white', shadow=0.6)
        na = a + math.pi / 2
        x, y = polar(R_GLASS + 92, a)
        for sd in (-1, 1):
            girder(c, x, y, x + math.cos(na) * 16 * sd, y + math.sin(na) * 16 * sd, 5, rail=1.2, mat='steel', shadow=0.4)
        c.put(liner, x + math.cos(na) * 26, y + math.sin(na) * 26, scale=0.22, rot=-math.degrees(a) - 90, mat='white', nat=0.5, shadow=0.6, edge=0.5)
        c.put(cylinder(13, 13), *polar(R_GLASS + 118, a), mat='steel', shadow=0.5)
        c.light(*polar(R_GLASS + 119, a), 'nav')
        for q in range(4):
            c.light(*polar(R_GLASS + 58 + q * 14, a), 'white' if q % 2 else 'run')
    # the support ring: viewing galleries (long window rows, warm), maintenance decks, pumps
    kit = plate_kit(root, rng, 5, PLATE_SRC + [('family14/largespaceport.png', 46)])
    R0, R1 = R_GLASS - 2, R_GLASS + 56
    W = 2 * math.pi * (R0 + R1) / 2
    H = R1 - R0
    st = deck_strip(rng, kit, W, H, 18, 3, period=16, smooth=0.45, contrast=0.6, mat='white', smooth_mat='white', nat=0.15)
    for wv in (0.16, 0.3):
        st.put(window_row(W, 3.4, 2.4, rng, lit=0.9, col=(0.75, 0.92, 1.0)), W / 2, wv * H, mat='dark', shadow=0.3, edge=0.6)
    st.put(window_row(W, 3.0, 3.0, rng, lit=0.7), W / 2, 0.8 * H, mat='dark', shadow=0.3, edge=0.6)
    span = W / 16
    for p_ in range(16):
        st.put(cylinder(5.0, H, caps=False), p_ * span, H / 2, mat='steel', shadow=0.55)
        if p_ % 2 == 0:
            st.put(stock(root, 'family22/gasminingstation.png', light_col=(0.75, 0.92, 1.0)), p_ * span + span / 2, H * 0.58, scale=0.22, mat='white', nat=0.25, shadow=0.6, edge=0.5)
    c.put(polar_wrap(st.as_piece(), R0, R1, shade_k=0.45), C0, C0, shadow=0.7, edge=1.0)
    c.put(arc_beam(R1 - 1, 5.0, ticks=8.0, mat='steel'), C0, C0, shadow=0.5)
    for k in range(48):
        c.light(*polar(R1 - 1, k * 2 * math.pi / 48), 'run')
    # inside: the water, the far struts through it
    c.put(water(R_GLASS, rng), C0, C0, shadow=0.0)
    bm, bnode, x, y, z, inside = cage_mask(S, R_GLASS, back=True, w=5.0)
    back = Piece(bm * 0.55, np.full((S, S), 0.35), None, None, {'glass': np.ones((S, S))})
    c.put(back, C0, C0, shadow=0.0)
    # the front frame: near struts and joints (painted), then the glass under them
    f = Canvas(FRAME)
    fm, fnode, x, y, z, inside = cage_mask(S, R_GLASS, back=False, w=10.0)
    groove, _, _, _, _, _ = cage_mask(S, R_GLASS, back=False, w=3.0)
    sph = shade(x, y, z, amb=0.2, k=0.8, spec=0.35)
    Ls = np.clip(0.25 + 0.7 * sph, 0, 1) * (1 - 0.45 * groove)
    f.put(Piece(fm, Ls, None, None, {'steel': np.ones((S, S))}), C0, C0, shadow=0.0)
    # joints: a boss at each crossing on the front face (the lat / lon grid crossings, projected)
    ct, sn = math.cos(CAGE_TILT), math.sin(CAGE_TILT)
    for la in (-60, -30, 0, 30, 60):
        for lo in range(-180, 180, 30):
            la_r, lo_r = math.radians(la), math.radians(lo)
            X, Y, Z = math.cos(la_r) * math.sin(lo_r), math.sin(la_r), math.cos(la_r) * math.cos(lo_r)
            # planet frame -> view: invert Y = -y cos t + z sin t, Z = y sin t + z cos t
            yv = -Y * ct + Z * sn
            zv = Y * sn + Z * ct
            if zv < 0.22:
                continue
            px_, py_ = C0 + X * R_GLASS, C0 + yv * R_GLASS
            rr_ = 10 * math.sqrt(zv) + 3
            f.put(cylinder(rr_, rr_), px_, py_, mat='steel', shadow=0.45)
            f.put(cylinder(rr_ * 0.45, rr_ * 0.45), px_, py_, mat='dark', shadow=0.0)
            if (la + lo) % 60 == 0:
                f.light(px_, py_, 'white')
    # the pole cap: the life-support hub the meridians run into (seen at an angle)
    px_, py_ = C0, C0 - math.cos(CAGE_TILT) * R_GLASS
    f.put(cylinder(58, 58), px_, py_, sy=math.sin(CAGE_TILT) * 1.15, mat='steel', shadow=0.5)
    f.put(stock(root, 'family13/gasminingstation.png', light_col=(0.6, 0.95, 1.0)), px_, py_, scale=0.3, sy=math.sin(CAGE_TILT) * 1.15, mat='steel', nat=0.4, shadow=0.5)
    f.light(px_, py_, 'nav')
    # the rim clamp: a heavy ring where the glass meets the support ring
    f.put(arc_beam(R_GLASS + 1, 8.0, ticks=10.0, mat='steel'), C0, C0, shadow=0.0)
    return c, f


def glass_rgba(Rg, size=FRAME):
    """The glass over the whales (output px, straight RGBA): a faint blue film, a brighter fresnel rim, a soft sheen
    upper left and a sharp window glint."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float64) + 0.5
    x, y = (xx - C0) / Rg, (yy - C0) / Rg
    d = np.hypot(x, y)
    inside = np.clip((1 - d) * Rg + 0.5, 0, 1)
    film = 0.1
    rim = smoothstep(0.8, 1.0, d) ** 2 * 0.55
    sheen = np.clip(1 - np.hypot((x + 0.42) / 0.55, (y + 0.48) / 0.28), 0, 1) ** 1.5 * 0.3
    glint = np.clip(1 - np.hypot((x + 0.52) / 0.09, (y + 0.3) / 0.035), 0, 1) * 0.7
    a = np.clip(film + rim + sheen + glint, 0, 1) * inside
    col = np.zeros((size, size, 3))
    col[:] = (0.45, 0.7, 0.85)
    w = np.clip((sheen + glint) / np.maximum(a, 1e-3), 0, 1)[..., None]
    col = col * (1 - w) + np.array([0.92, 0.97, 1.0]) * w
    return col, a


# ---------------------------------------------------------------------------------------------------------------
# Finishing: paint, one body, down to the frame, outline, registration pixels
# ---------------------------------------------------------------------------------------------------------------

def down(v, w, h):
    im = Image.fromarray(v.astype(np.float32), 'F').resize((w, h), Image.LANCZOS)
    return np.asarray(im).astype(np.float64)


def unsharp(rgb, amt=0.35):
    out = np.empty_like(rgb)
    for k in range(3):
        b = fblur(rgb[..., k], 0.9)
        out[..., k] = rgb[..., k] + amt * (rgb[..., k] - b)
    return out


def finish(c, one_body=True, outline=True, seed_r=12.0, halo=None):
    """The canvas painted and brought down to the output frame (RGBA uint8). one_body: drop everything not 8-connected
    to the centre (no loose parts). halo: (rgb, strength) a soft glow of the emission round the lights."""
    col, A, E = c.paint()
    if one_body:
        s = c.w
        seed = np.zeros(A.shape, bool)
        r = int(seed_r * SS)
        seed[c.h // 2 - r:c.h // 2 + r, c.w // 2 - r:c.w // 2 + r] = True
        body = connected_to(seed, A > 0.1)
        keep = dilate(body, 1)
        dropped = float(((A > 0.1) & ~keep).sum()) / SS / SS
        if dropped > 0:
            print('   dropped loose px (layout):', round(dropped))
        A = np.where(keep, A, 0)
    W, H = int(c.lw), int(c.lh)
    a = np.clip(down(A, W, H), 0, 1)
    rgb = np.stack([down(col[..., k] * A, W, H) for k in range(3)], -1) / np.maximum(a, 1e-4)[..., None]
    rgb = np.where(a[..., None] > 1e-3, rgb, 0)
    rgb = unsharp(rgb, 0.35)
    if halo is not None:
        e = np.stack([down(E[..., k] * A, W, H) for k in range(3)], -1)
        g = np.stack([fblur(e[..., k], halo) for k in range(3)], -1) * 1.6
        ga = np.clip(g.max(2), 0, 1) * (1 - a)
        rgb = rgb * a[..., None] + g * (1 - a)[..., None]
        a = a + ga * 0.85
        rgb = rgb / np.maximum(a, 1e-4)[..., None]
    rgb = np.clip(rgb, 0, 1)
    if outline:
        solid = a > 0.5
        ring = dilate(solid, 1) & ~solid & (a < 0.35)
        rgb[ring] = np.array([0.02, 0.02, 0.025])
        a[ring] = np.maximum(a[ring], 0.55)
    res = np.zeros((H, W, 4), np.uint8)
    res[..., :3] = np.round(rgb * 255)
    res[..., 3] = np.round(a * 255)
    return res


def no_faint(res, below=4):
    """Clear the faintest pixels (alpha < `below`): a browser reads the PNG through a premultiplied canvas, and a
    warm glow pixel at alpha 1 or 2 comes back as exactly (255, 255, 0), a light marker (shipArt.ts scanShipMarkers),
    which the ambient layer would then light as a navigation lamp."""
    res = res.copy()
    res[res[..., 3] < below] = 0
    return res


def sanitize(res):
    """No opaque black (shipImageMetrics), no pixel in either marker colour (scanShipMarkers), two registration pixels
    so the crop square is the whole frame."""
    blk = (res[..., 3] == 255) & (res[..., :3].max(2) == 0)
    res[blk, :3] = 2
    m = (res[..., 3] > 0) & (((res[..., 0] == 0) & (res[..., 1] == 0) & (res[..., 2] == 255)) | ((res[..., 0] == 255) & (res[..., 1] == 255) & (res[..., 2] == 0)))
    res[m, 2] = np.where(res[m, 2] > 0, res[m, 2] - 1, 1)
    H, W = res.shape[:2]
    for (y, x) in ((4, 4), (H - 5, W - 5)):
        if res[y, x, 3] == 0:
            res[y, x] = (8, 8, 8, 1)
    return res


def lights_of(c, res, kinds=None):
    """The canvas lights that sit on the finished frame (on an opaque pixel), as rounded frame px."""
    out = []
    H, W = res.shape[:2]
    for (x, y, k) in c.lights:
        if kinds is not None and k not in kinds:
            continue
        xi, yi = int(round(x)), int(round(y))
        if 0 <= xi < W and 0 <= yi < H and res[yi, xi, 3] > 120:
            out.append((xi, yi, k))
    return out


LIGHT_KINDS = ('nav', 'white', 'work', 'weld', 'run', 'neonA', 'neonB', 'data', 'gold', 'bulb')


def _num(v, dp=2):
    if isinstance(v, (float, np.floating)):
        t = ('%.*f' % (dp, v)).rstrip('0').rstrip('.')
        return '0' if t in ('-0', '') else t
    return '%d' % v


def _rows(rows, dp=2):
    return ', '.join('[' + ', '.join(_num(v, dp) for v in r) + ']' for r in rows)


def _look_ts(name, t):
    f = t['files']
    return ("    '%s': { neonFile: '%s', neon: [%s], rotorFiles: [%s], rotors: [%s], wheelFile: %s, wheel: %s, lanes: [%s], "
            "laneFade: [%s], lane: [%s], ball: %s }," % (
                name, f['neon'], _rows(t['neon']), ', '.join("'%s'" % r for r in f['rotors']), _rows(t['rotors'], 4),
                "'%s'" % f['wheel'] if f['wheel'] else 'null',
                '[' + ', '.join(_num(v) for v in t['wheel']) + ']' if t['wheel'] is not None else 'null',
                _rows(t['lanes']), ', '.join(_num(v) for v in t['fade']), ', '.join(_num(v) for v in t['lane']),
                'true' if t['ball'] else 'false'))


def write_lights(path, table, casino=None):
    """The light table and the casino looks' runtime tables. A partial build (--only) keeps the rows of the frames
    (and the casino looks) it did not build from the file already there."""
    old_rows, old_looks = {}, {}
    if os.path.exists(path):
        with open(path) as f:
            old = f.read().split('\n')
        at = None
        for ln in old:
            if ln.startswith('export const GW_LIGHTS'):
                at = 'lights'
            elif ln.startswith('export const GW_CASINO_LOOKS'):
                at = 'looks'
            elif ln.startswith('};'):
                at = None
            elif at == 'lights' and ln.startswith('    '):
                old_rows[ln.strip().split(':')[0]] = ln
            elif at == 'looks' and ln.startswith("    '"):
                old_looks[ln.strip().split("'")[1]] = ln
    rows = dict(old_rows)
    for name in table:
        pts = ', '.join('[%d, %d, %d]' % (x, y, LIGHT_KINDS.index(k)) for (x, y, k) in table[name])
        rows[name.replace('-', '_')] = '    %s: [%s],' % (name.replace('-', '_'), pts)
    looks = dict(old_looks)
    for name, t in (casino or {}).items():
        looks[name] = _look_ts(name, t)
    lines = [
        '// Generated by scripts/giantworks-art.py — do not edit. Frame px [x, y, kind] of the lights threatArt.ts',
        '// GreatWorkFxLayer lights over each Great Work frame (public/art/giantworks/<frame>.png); kind indexes',
        '// GW_LIGHT_KINDS.',
        'export const GW_LIGHT_KINDS = [' + ', '.join("'%s'" % k for k in LIGHT_KINDS) + '] as const;',
        '/** The Leviathan Sanctuary\'s glass sphere radius (frame px of sanctuary.png, centred): the whales are masked to it. */',
        'export const GW_SANCTUARY_GLASS_R = %d;' % int(R_GLASS),
        'export const GW_LIGHTS: Readonly<Record<string, readonly (readonly [number, number, number])[]>> = {',
    ]
    lines += [rows[k] for k in sorted(rows)]
    lines += [
        '};',
        '/** The Gilded Orbit\'s runtime layers, one look per frame (the casino; the pirate den). */',
        'export interface GwCasinoLook {',
        '    /** The neon atlas (public/art/giantworks/<neonFile>.png) and its pieces: [atlas x, y, w, h, frame x, y (the piece\'s top left), behaviour (0 buzz, 1 dead, 2 seq, 3 blink, 4 bad), p1, p2, p3]. */',
        '    neonFile: string;',
        '    neon: readonly (readonly number[])[];',
        '    /** The roulette rotors that turn: [sprite (rotorFiles index), centre x, y (frame px), m00, m01, m10, m11 (frame px per rotor px: its plane seen on the sphere), spin rad/s, rotor radius, bowl radius, jerk (s; 0 a smooth turn)]. */',
        '    rotorFiles: readonly string[];',
        '    rotors: readonly (readonly number[])[];',
        '    /** The observation wheel turning ([hub x, y (frame px), spin rad/s]), or null (stopped: it is in the frame). */',
        '    wheelFile: string | null;',
        '    wheel: readonly number[] | null;',
        '    /** The ship lanes: [kind (0 in, 1 out), x0, y0, x1, y1, ...] (frame px, the way the ships fly); full bright within laneFade[0] frame px of the centre, gone past laneFade[1]; lane: [frame px between ships, speed frame px/s, brightness]. */',
        '    lanes: readonly (readonly number[])[];',
        '    laneFade: readonly [number, number];',
        '    lane: readonly [number, number, number];',
        '    /** A roulette ball runs on the turning rotors. */',
        '    ball: boolean;',
        '}',
        '/** The casino\'s turning sprites are this many px per frame px. */',
        'export const GW_CASINO_SPR = %d;' % SPR,
        'export const GW_CASINO_LOOKS: Readonly<Record<string, GwCasinoLook>> = {',
    ]
    lines += [looks[k] for k in sorted(looks)]
    lines.append('};')
    with open(path, 'w') as f:
        f.write('\n'.join(lines) + '\n')


# ---------------------------------------------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------------------------------------------

def build_all(root, only):
    import time
    made = {}
    lights = {}
    tables = {}
    want = lambda n: only is None or n in only
    if any(want('scaffold_%d' % s) for s in range(4)):
        t0 = time.time()
        ops = scaffold_ops(root)
        print('scaffold ops', round(time.time() - t0, 1), 's', flush=True)
        for s in range(4):
            name = 'scaffold_%d' % s
            if not want(name):
                continue
            t0 = time.time()
            c = render_ops(ops, s)
            print(name, 'render', round(time.time() - t0, 1), 's', flush=True)
            res = sanitize(finish(c))
            made[name] = res
            lights[name] = lights_of(c, res)
    for look in ('casino', 'casino-pirate'):
        if not want(look):
            continue
        t0 = time.time()
        set_look(look)
        res, lts, extra = build_casino(root)
        res = sanitize(no_faint(res))
        made[look] = res
        lights[look] = casino_lights(lts, res)
        made[look + '-neon'] = no_faint(extra['atlas'])
        files = dict(neon=look + '-neon', rotors=[], wheel=None)
        for (nm, img) in extra['rotors']:
            made[look + '-' + nm] = no_faint(img)
            files['rotors'].append(look + '-' + nm)
        if extra['wheel'] is not None:
            made[look + '-wheel'] = no_faint(extra['wheel'])
            files['wheel'] = look + '-wheel'
        tables[look] = dict(extra['tables'], files=files)
        set_look('casino')
        print(look, round(time.time() - t0, 1), 's', flush=True)
    for name, fn, frame in (('ultramind', build_ultramind, None), ('ultramind-shell', build_ultramind_shell, None), ('ultramind-node', build_ultramind_node, None)):
        if not want(name):
            continue
        t0 = time.time()
        c = fn(root)
        res = sanitize(finish(c, one_body=name != 'ultramind-shell', outline=name != 'ultramind-shell'))
        made[name] = res
        lights[name] = lights_of(c, res)
        made[name + '-glow'] = glow_from(c, boost=0.7)
        print(name, round(time.time() - t0, 1), 's', flush=True)
    if want('sanctuary'):
        t0 = time.time()
        c, f = build_sanctuary(root)
        res = sanitize(finish(c))
        made['sanctuary'] = res
        lights['sanctuary'] = lights_of(c, res)
        fr = finish(f, one_body=False, outline=False)
        gcol, ga = glass_rgba(R_GLASS)
        fa = fr[..., 3:4].astype(np.float64) / 255
        fc = fr[..., :3].astype(np.float64) / 255
        oa = fa + ga[..., None] * (1 - fa)
        oc = (fc * fa + gcol * ga[..., None] * (1 - fa)) / np.maximum(oa, 1e-4)
        front = np.zeros_like(fr)
        front[..., :3] = np.round(np.clip(oc, 0, 1) * 255)
        front[..., 3:4] = np.round(np.clip(oa, 0, 1) * 255)
        made['sanctuary-front'] = front
        lights['sanctuary'] += [(int(round(x)), int(round(y)), k) for (x, y, k) in f.lights]
        print('sanctuary', round(time.time() - t0, 1), 's', flush=True)
    return made, lights, tables


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dwu', default=os.path.join(GAME, 'public', 'assets', 'dwu'))
    ap.add_argument('--out', default=os.path.join(GAME, 'public', 'art', 'giantworks'))
    ap.add_argument('--lights', default=os.path.join(GAME, 'src', 'render', 'giantworksLights.ts'))
    ap.add_argument('--preview', default=None)
    ap.add_argument('--only', default=None)
    args = ap.parse_args()
    only = None if args.only is None else set(args.only.split(','))
    made, lights, tables = build_all(args.dwu, only)
    os.makedirs(args.out, exist_ok=True)
    for name, res in made.items():
        if name not in lights:  # an overlay: no registration pixels, but no opaque black nor marker colours either
            blk = (res[..., 3] == 255) & (res[..., :3].max(2) == 0)
            res[blk, :3] = 2
            m = (res[..., 3] > 0) & (((res[..., 0] == 0) & (res[..., 1] == 0) & (res[..., 2] == 255)) | ((res[..., 0] == 255) & (res[..., 1] == 255) & (res[..., 2] == 0)))
            res[m, 2] = np.where(res[m, 2] > 0, res[m, 2] - 1, 1)
        Image.fromarray(res, 'RGBA').save(os.path.join(args.out, name + '.png'), optimize=True)
        print(name, res.shape[1], 'x', res.shape[0], 'lights', len(lights.get(name, [])))
    if args.lights:
        write_lights(args.lights, lights, tables)
    if args.preview:
        preview(args.preview, made, lights)


def preview(out_dir, made, lights):
    """Each frame on a dark field at full size, and at play size (1/4), with its lights marked."""
    os.makedirs(out_dir, exist_ok=True)
    for name, res in made.items():
        im = Image.fromarray(res, 'RGBA')
        bg = Image.new('RGBA', im.size, (5, 6, 10, 255))
        bg.alpha_composite(im)
        d = ImageDraw.Draw(bg)
        cols = {'nav': (255, 40, 30), 'white': (255, 255, 255), 'work': (255, 200, 120), 'weld': (180, 220, 255), 'run': (120, 200, 255),
                'neonA': (255, 60, 220), 'neonB': (60, 230, 255), 'data': (80, 240, 255), 'gold': (255, 210, 90), 'bulb': (255, 236, 170)}
        for (x, y, k) in lights.get(name, []):
            d.ellipse((x - 2, y - 2, x + 2, y + 2), outline=cols[k])
        bg.save(os.path.join(out_dir, name + '.png'))
        small = Image.new('RGBA', (im.width // 4 + 20, im.height // 4 + 20), (5, 6, 10, 255))
        small.alpha_composite(im.resize((im.width // 4, im.height // 4), Image.LANCZOS), (10, 10))
        small.save(os.path.join(out_dir, name + '-play.png'))


if __name__ == '__main__':
    main()
