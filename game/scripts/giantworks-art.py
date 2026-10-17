#!/usr/bin/env python3
"""Giantworks art (the Great Work add-on, Galactic Threats): the shared construction scaffold in four stages and the
finished wonders, kitbashed from stock DW:U frames plus procedural parts. Offline build step; the outputs are our
derived art, committed under public/art/giantworks/ (src/render/threatArt.ts draws them for a Great Work site's base,
picked by its stage and, once complete, its wonder), plus the light table src/render/giantworksLights.ts (frame px of
the blinking nav lights, work lights and neon the runtime layers light up).

    python3 -I scripts/giantworks-art.py [--dwu <DW:U install>] [--out public/art/giantworks]
        [--lights src/render/giantworksLights.ts] [--preview <dir>] [--only scaffold_0,casino]

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
- casino (+ casino-neon-a / -b): the Gilded Orbit, a gaudy gold ring resort: the ring of hotel and casino decks with
  lit windows, garden and pool domes, a central casino hub under a gold dome, spokes, docking arms; neon strips and
  marquee bulbs in two interleaved sets the runtime chases.
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
# The Gilded Orbit (casino resort)
# ---------------------------------------------------------------------------------------------------------------

NEON_A = (1.0, 0.24, 0.82)   # magenta
NEON_B = (0.25, 0.95, 1.0)   # cyan
NEON_G = (1.0, 0.78, 0.3)    # gold


def pool_dome(r, water=True, rng=None):
    """A glass dome over a pool (glowing turquoise water) or a garden (greenery): sphere-cap shading, ribs, a bright
    rim; the water / leaves as emission and native colour under the glass."""
    S = int(math.ceil(2 * r * SS)) + 2
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float64) + 0.5
    dx, dy = (xx - S / 2) / (r * SS), (yy - S / 2) / (r * SS)
    d = np.hypot(dx, dy)
    A = np.clip((1 - d) * r * SS + 0.5, 0, 1)
    nz = np.sqrt(np.clip(1 - d * d, 0, 1))
    L = shade(dx, dy, nz, amb=0.3, k=0.55, spec=0.9)
    ang = np.arctan2(dy, dx)
    rib = np.abs(((ang / (2 * math.pi)) * 10) % 1 - 0.5) > 0.5 - 0.5 / (2 * math.pi * r * np.maximum(d, 0.15) / 10)
    rim = d > 0.86
    frame = (rib & (d > 0.25)) | rim
    n = np.zeros((S, S, 3))
    e = np.zeros((S, S, 3))
    if water:
        wave = 0.5 + 0.5 * np.sin((dx * 9 + np.sin(dy * 7) * 1.5) * 2.2)
        base = np.array([0.05, 0.42, 0.5]) + np.array([0.1, 0.25, 0.2]) * wave[..., None]
        n[:] = base
        e[:] = np.array([0.02, 0.22, 0.26]) * (0.6 + 0.4 * wave)[..., None]
    else:
        g = fbm(rng or np.random.default_rng(3), S, S, max(2, int(r * SS / 3)), 3)
        n[:] = np.array([0.06, 0.2, 0.06]) + np.array([0.12, 0.25, 0.08]) * g[..., None]
        e[:] = np.array([0.03, 0.06, 0.02]) * g[..., None]
    mats = {'nat': np.where(frame, 0.0, 1.0), 'gold': np.where(frame, 1.0, 0.0)}
    L = np.where(frame, L, np.clip(L * 0.4 + 0.45, 0, 1))
    e = np.where(frame[..., None], 0, e)
    # the glass sheen: a soft highlight upper left
    sheen = np.clip(1 - np.hypot(dx + 0.35, dy + 0.4) / 0.45, 0, 1) ** 2 * 0.5
    e = e + sheen[..., None] * np.array([0.7, 0.8, 0.85])
    return Piece(A, np.clip(L, 0, 1), n, e, mats)


def roulette(r, rng):
    """The casino's crown dome seen from above: a wheel of red and black lacquer pockets ringed in gold under glass,
    gold frets between them, a gold boss in the middle; dome shading, a sheen."""
    S = int(math.ceil(2 * r * SS)) + 2
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float64) + 0.5
    dx, dy = (xx - S / 2) / (r * SS), (yy - S / 2) / (r * SS)
    d = np.hypot(dx, dy)
    A = np.clip((1 - d) * r * SS + 0.5, 0, 1)
    nz = np.sqrt(np.clip(1 - d * d * 0.85, 0, 1))
    L = shade(dx * 0.6, dy * 0.6, nz, amb=0.3, k=0.6, spec=0.5)
    ang = (np.arctan2(dy, dx) + math.pi) / (2 * math.pi)
    pocket = (ang * 37).astype(int)
    fret = np.abs((ang * 37) % 1 - 0.5) > 0.5 - 0.35 / (2 * math.pi * r * np.maximum(d, 0.2) / 37)
    ringz = (np.abs(d - 0.62) < 0.035) | (np.abs(d - 0.86) < 0.03) | (d > 0.93)
    red = (pocket % 2 == 0) & (pocket != 0)
    green = pocket == 0
    mats = {'gold': np.zeros((S, S)), 'red': np.zeros((S, S)), 'dark': np.zeros((S, S)), 'nat': np.zeros((S, S))}
    band = (d > 0.62) & (d < 0.86)
    inner = d <= 0.62
    gold = ringz | (band & fret) | (d < 0.2)
    mats['gold'] = gold.astype(float) + (inner & ~gold) * 0.0
    mats['red'] = (band & red & ~gold).astype(float)
    mats['dark'] = (band & ~red & ~green & ~gold).astype(float)
    n = np.zeros((S, S, 3))
    n[:] = (0.05, 0.4, 0.15)
    mats['nat'] = (band & green & ~gold).astype(float)
    # the inner floor: gold-and-cream starburst (the cone of the wheel)
    star = (np.abs(((ang * 8) % 1) - 0.5) < 0.12) & inner & (d > 0.2)
    mats['gold'] = np.maximum(mats['gold'], (inner & ~gold & star).astype(float))
    mats['red'] = np.maximum(mats['red'], (inner & ~gold & ~star).astype(float) * 0.0)
    mats['dark'] = np.maximum(mats['dark'], (inner & ~gold & ~star).astype(float))
    L = np.where(gold, np.clip(L * 1.1, 0, 1), L * 0.85)
    e = np.zeros((S, S, 3))
    sheen = np.clip(1 - np.hypot(dx + 0.32, dy + 0.36) / 0.5, 0, 1) ** 2 * 0.35
    e += sheen[..., None] * np.array([1.0, 0.95, 0.85])
    return Piece(A, np.clip(L, 0, 1), n, e, mats)


def neon_layers(segments, size=FRAME):
    """The neon as two additive layers (set A, set B: the runtime takes them in turns) at the output resolution:
    straight RGBA (colour, alpha = brightness) with a soft halo. segments: (set, kind, params, colour) with kind 'arc'
    (R, a0, a1, width, dash) or 'line' (x0, y0, x1, y1, width)."""
    out = {}
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float64) + 0.5
    dx, dy = xx - C0, yy - C0
    r = np.hypot(dx, dy)
    ang = np.arctan2(dy, dx) % (2 * math.pi)
    for st in ('A', 'B'):
        col = np.zeros((size, size, 3))
        for (sset, kind, prm, c) in segments:
            if sset != st:
                continue
            if kind == 'arc':
                R, a0, a1, w, dash = prm
                t = (ang - a0) % (2 * math.pi)
                m = np.clip(w / 2 + 0.5 - np.abs(r - R), 0, 1) * (t <= (a1 - a0))
                if dash > 0:
                    m = m * (((t * R / dash) % 1) < 0.6)
            else:
                x0, y0, x1, y1, w = prm
                vx, vy = x1 - x0, y1 - y0
                ln2 = vx * vx + vy * vy
                tt = np.clip(((xx - x0) * vx + (yy - y0) * vy) / ln2, 0, 1)
                dd = np.hypot(xx - (x0 + tt * vx), yy - (y0 + tt * vy))
                m = np.clip(w / 2 + 0.5 - dd, 0, 1)
            col = np.maximum(col, m[..., None] * np.array(c))
        halo = np.stack([fblur(col[..., k], 2.2) for k in range(3)], -1) * 1.5
        core = np.clip(col + 0.22 * col.max(2, keepdims=True), 0, 1)  # a hot, paler core
        tot = np.clip(np.maximum(core, halo), 0, 1)
        a = np.clip(tot.max(2), 0, 1)
        rgb = np.where(a[..., None] > 1e-3, tot / np.maximum(a, 1e-3)[..., None], 0)
        res = np.zeros((size, size, 4), np.uint8)
        res[..., :3] = np.round(np.clip(rgb, 0, 1) * 255)
        res[..., 3] = np.round(a * 255)
        out[st] = res
    return out


R_RING = 252.0
RING_T = 44.0


def build_casino(root):
    """The Gilded Orbit: a fat gold ring of hotel and casino decks (lit windows by the thousand, pool and garden domes,
    red lacquer and white enamel), six enclosed promenades to the crown hub (a roulette wheel under glass in a gold
    collar ringed with marquee bulbs), six docking arms outside; neon along every edge, in two sets."""
    rng = seeded('casino')
    gkit = plate_kit(root, rng, 6, GOLD_SRC)
    c = Canvas(FRAME)
    segs = []
    # docking piers (under the ring), between the spokes: a gold deck between two girders, private yachts moored
    yacht = [stock(root, f, light_col=(0.7, 0.9, 1.0)) for f in ('family14/escort.png', 'family14/explorationship.png', 'family14/frigate.png')]
    for k in range(6):
        a = math.radians(30 + 60 * k)
        na = a + math.pi / 2
        x0, y0 = polar(R_RING + 26, a)
        x1, y1 = polar(R_RING + 100, a)
        for sd in (-1, 1):
            ox, oy = math.cos(na) * 7 * sd, math.sin(na) * 7 * sd
            girder(c, x0 + ox, y0 + oy, x1 + ox, y1 + oy, 6, rail=1.5, bay=6, mat='gold', shadow=0.6)
        ln = math.hypot(x1 - x0, y1 - y0)
        c.put(box_module(9, ln, seams=5, vents=False), (x0 + x1) / 2, (y0 + y1) / 2, rot=90 - math.degrees(a), mat='white', shadow=0.5, edge=0.8)
        for j, f in enumerate((0.38, 0.78)):
            for sd in (-1, 1):
                x, y = polar(R_RING + 26 + 74 * f, a)
                ex, ey = x + math.cos(na) * 21 * sd, y + math.sin(na) * 21 * sd
                girder(c, x, y, x + math.cos(na) * 11 * sd, y + math.sin(na) * 11 * sd, 4.0, rail=1.0, mat='gold', shadow=0.4)
                yi = (k + j + (sd > 0)) % 3
                c.put(yacht[yi], ex, ey, scale=0.2 if yi else 0.24, rot=-math.degrees(a) - 90 + (0 if sd > 0 else 180) + 90 * 0, mat='white', nat=0.55, shadow=0.6, edge=0.5)
                c.light(*polar(R_RING + 26 + 74 * f, a), 'white')
        c.put(cylinder(12, 12), *polar(R_RING + 102, a), mat='gold', shadow=0.5)
        c.light(*polar(R_RING + 103, a), 'nav')
        for q in range(6):
            c.light(*polar(R_RING + 32 + q * 12, a + 0.0), 'gold')
        segs.append(('B', 'line', (*polar(R_RING + 28, a), *polar(R_RING + 96, a), 1.2), NEON_B))
    # the ring of decks
    W = 2 * math.pi * R_RING
    H = RING_T * 2
    st = deck_strip(rng, gkit, W, H, 16, 5, period=12, smooth=0.3, contrast=0.6, mat='gold', smooth_mat='gold', nat=0.2)
    span = W / 12
    for wv in (0.17, 0.33, 0.67, 0.83):
        st.put(window_row(W, 3.6, 2.6, rng, lit=0.85, col=(1.0, 0.85, 0.55)), W / 2, wv * H, mat='red', shadow=0.3, edge=0.6)
    st.put(box_module(W, 4.0, seams=0, vents=False), W / 2, 2.2, mat='gold', shadow=0.3, edge=1.0)
    st.put(box_module(W, 4.0, seams=0, vents=False), W / 2, H - 2.2, mat='gold', shadow=0.0, edge=1.0)
    for p in range(12):
        x0 = p * span
        st.put(cylinder(5.0, H, caps=False), x0 + 1, H / 2, mat='gold', shadow=0.55)
        st.put(pool_dome(19, True), x0 + span * 0.5, H * 0.5, shadow=0.6)
        for fu in (0.2, 0.8):
            st.put(pool_dome(11, False, np.random.default_rng(p * 7 + int(fu * 10))), x0 + span * fu, H * 0.5, shadow=0.5)
        for fu in (0.36, 0.64):
            st.put(stock(root, 'family10/resortbase.png', light_col=(1.0, 0.8, 0.45)), x0 + span * fu, H * 0.5, scale=0.13, rot=90, mat='gold', nat=0.3, shadow=0.55, edge=0.5)
    ring = polar_wrap(st.as_piece(), R_RING - RING_T, R_RING + RING_T, shade_k=0.55)
    c.put(ring, C0, C0, shadow=0.7, edge=1.0)
    for (R, w) in ((R_RING - RING_T + 1.5, 4.0), (R_RING + RING_T - 1.5, 4.0)):
        c.put(arc_beam(R, w, ticks=7.0, mat='gold'), C0, C0, shadow=0.4)
    segs.append(('A', 'arc', (R_RING + RING_T + 2.2, 0, 2 * math.pi, 1.6, 9.0), NEON_A))
    segs.append(('B', 'arc', (R_RING + RING_T + 2.2, 0.035, 2 * math.pi + 0.035, 1.6, 9.0), NEON_B))
    segs.append(('B', 'arc', (R_RING - RING_T - 2.2, 0, 2 * math.pi, 1.6, 9.0), NEON_A))
    segs.append(('A', 'arc', (R_RING - RING_T - 2.2, 0.04, 2 * math.pi + 0.04, 1.6, 9.0), NEON_B))
    # the promenades: enclosed tubes on gold girders, hub to ring
    for k in range(6):
        a = math.radians(60 * k)
        girder(c, *polar(78, a), *polar(R_RING - RING_T + 4, a), 24, rail=2.4, bay=12, mat='gold', shadow=0.65)
        x0, y0 = polar(80, a)
        x1, y1 = polar(R_RING - RING_T + 2, a)
        tube = cylinder(12, math.hypot(x1 - x0, y1 - y0), caps=False, bands=(0.2, 0.4, 0.6, 0.8))
        c.put(tube, (x0 + x1) / 2, (y0 + y1) / 2, rot=90 - math.degrees(a), mat='white', shadow=0.6)
        ln = math.hypot(x1 - x0, y1 - y0)
        c.put(window_row(ln, 3.0, 2.4, rng, lit=0.9), (x0 + x1) / 2, (y0 + y1) / 2, rot=-math.degrees(a), mat='dark', shadow=0.0)
        na = a + math.pi / 2
        for sd in (-1, 1):
            ox, oy = math.cos(na) * 9 * sd, math.sin(na) * 9 * sd
            segs.append(('A' if sd > 0 else 'B', 'line', (x0 + ox, y0 + oy, x1 + ox, y1 + oy, 1.3), NEON_G if sd > 0 else NEON_A))
    # the crown hub: a gold collar of decks, the roulette dome on it, marquee bulbs round it
    W2 = 2 * math.pi * 84
    st2 = deck_strip(rng, gkit, W2, 26, 12, 2, period=8, smooth=0.25, contrast=0.65, mat='gold', smooth_mat='white', nat=0.2)
    st2.put(window_row(W2, 3.0, 2.2, rng, lit=0.95), W2 / 2, 13, mat='red', shadow=0.2)
    c.put(polar_wrap(st2.as_piece(), 70, 98, shade_k=0.5), C0, C0, shadow=0.7, edge=1.0)
    c.put(arc_beam(98, 5.0, ticks=6.0, mat='gold'), C0, C0, shadow=0.5)
    c.put(arc_beam(70, 5.0, ticks=6.0, mat='red'), C0, C0, shadow=0.5)
    c.put(roulette(68, rng), C0, C0, shadow=0.7)
    c.put(cylinder(20, 20, caps=True), C0, C0, mat='gold', shadow=0.6)
    c.light(C0, C0, 'white')
    for k in range(32):
        c.light(*polar(98, k * 2 * math.pi / 32), 'gold')
    for k in range(24):
        c.light(*polar(R_RING + RING_T - 1.5, k * 2 * math.pi / 24 + 0.06), 'gold')
    segs.append(('A', 'arc', (102, 0, 2 * math.pi, 1.8, 0), NEON_A))
    segs.append(('B', 'arc', (66, 0, 2 * math.pi, 1.4, 0), NEON_B))
    # neon in the frame itself (dim, so it reads without the runtime layers too)
    neon = neon_layers(segs)
    return c, neon


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


LIGHT_KINDS = ('nav', 'white', 'work', 'weld', 'run', 'neonA', 'neonB', 'data', 'gold')


def write_lights(path, table):
    lines = [
        '// Generated by scripts/giantworks-art.py — do not edit. Frame px [x, y, kind] of the lights threatArt.ts',
        '// GreatWorkFxLayer lights over each Great Work frame (public/art/giantworks/<frame>.png); kind indexes',
        '// GW_LIGHT_KINDS.',
        'export const GW_LIGHT_KINDS = [' + ', '.join("'%s'" % k for k in LIGHT_KINDS) + '] as const;',
        '/** The Leviathan Sanctuary\'s glass sphere radius (frame px of sanctuary.png, centred): the whales are masked to it. */',
        'export const GW_SANCTUARY_GLASS_R = %d;' % int(R_GLASS),
        'export const GW_LIGHTS: Readonly<Record<string, readonly (readonly [number, number, number])[]>> = {',
    ]
    for name in sorted(table):
        pts = ', '.join('[%d, %d, %d]' % (x, y, LIGHT_KINDS.index(k)) for (x, y, k) in table[name])
        lines.append('    %s: [%s],' % (name.replace('-', '_'), pts))
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
    if want('casino'):
        t0 = time.time()
        c, neon = build_casino(root)
        res = finish(c)
        # the neon, dim, baked over the frame where it lies on the structure or just beside it
        for st in ('A', 'B'):
            nl = neon[st].astype(np.float64) / 255
            a = nl[..., 3:4] * 0.55
            rgb = res[..., :3].astype(np.float64) / 255
            al = res[..., 3:4].astype(np.float64) / 255
            out_a = a + al * (1 - a)
            rgb = (nl[..., :3] * a + rgb * al * (1 - a)) / np.maximum(out_a, 1e-4)
            res[..., :3] = np.round(np.clip(rgb, 0, 1) * 255)
            res[..., 3:4] = np.round(np.clip(out_a, 0, 1) * 255)
        res = sanitize(res)
        made['casino'] = res
        lights['casino'] = lights_of(c, res)
        made['casino-neon-a'] = neon['A']
        made['casino-neon-b'] = neon['B']
        print('casino', round(time.time() - t0, 1), 's', flush=True)
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
    return made, lights


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dwu', default=os.path.join(GAME, 'public', 'assets', 'dwu'))
    ap.add_argument('--out', default=os.path.join(GAME, 'public', 'art', 'giantworks'))
    ap.add_argument('--lights', default=os.path.join(GAME, 'src', 'render', 'giantworksLights.ts'))
    ap.add_argument('--preview', default=None)
    ap.add_argument('--only', default=None)
    args = ap.parse_args()
    only = None if args.only is None else set(args.only.split(','))
    made, lights = build_all(args.dwu, only)
    os.makedirs(args.out, exist_ok=True)
    for name, res in made.items():
        if name not in lights:  # an overlay: no registration pixels, but no opaque black nor marker colours either
            blk = (res[..., 3] == 255) & (res[..., :3].max(2) == 0)
            res[blk, :3] = 2
            m = (res[..., 3] > 0) & (((res[..., 0] == 0) & (res[..., 1] == 0) & (res[..., 2] == 255)) | ((res[..., 0] == 255) & (res[..., 1] == 255) & (res[..., 2] == 0)))
            res[m, 2] = np.where(res[m, 2] > 0, res[m, 2] - 1, 1)
        Image.fromarray(res, 'RGBA').save(os.path.join(args.out, name + '.png'), optimize=True)
        print(name, res.shape[1], 'x', res.shape[0], 'lights', len(lights.get(name, [])))
    if only is None:
        write_lights(args.lights, lights)
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
                'neonA': (255, 60, 220), 'neonB': (60, 230, 255), 'data': (80, 240, 255), 'gold': (255, 210, 90)}
        for (x, y, k) in lights.get(name, []):
            d.ellipse((x - 2, y - 2, x + 2, y + 2), outline=cols[k])
        bg.save(os.path.join(out_dir, name + '.png'))
        small = Image.new('RGBA', (im.width // 4 + 20, im.height // 4 + 20), (5, 6, 10, 255))
        small.alpha_composite(im.resize((im.width // 4, im.height // 4), Image.LANCZOS), (10, 10))
        small.save(os.path.join(out_dir, name + '-play.png'))


if __name__ == '__main__':
    main()
