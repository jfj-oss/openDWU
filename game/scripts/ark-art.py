#!/usr/bin/env python3
"""The Ark Engine's art (Giantworks, the 'ark' wonder): a planet-sized machine-world ship, ray-traced from analytic
geometry and skinned with a dense kitbash of stock DW:U frames. Offline build step; the outputs are our derived art
under public/art/giantworks/ark*.png, plus the light table src/render/arkLights.ts (arkFx.ts ArkFxLayer draws them).

    python3 -I scripts/ark-art.py [--dwu <DW:U install>] [--out public/art/giantworks] [--lights src/render/arkLights.ts]
        [--frame 2048]

Reads images/units/ships/family*/<role>.png from the install (default public/assets/dwu). Needs Python 3 with numpy and
Pillow only. Deterministic (fixed seeds).

The look (the user's picks, 2026-10-17): a whole planet that is a ship, a "machine world" and a "shell world" in one,
built the way the stock spaceports are: layered hull plating, modules, docking arms, antennas and lit windows, at many
scales, in the stock frames' own painted metal (worn steel, warm bronze and olive steel, blue steel by race family).
Seen a little from above (the north pole tipped ELEV toward the viewer, the axis leaning LEAN on screen), lit from the
upper left like the stock planets, orthographic:
- the globe: its map (equirectangular, ~1 stock px per frame px) is a mat of hull-plating crops under whole capital
  hulls, carriers and freighters, then whole stations and bases, then small hulls as greebles, each casting a soft
  contact shadow; districts of the families' palettes; spines of capital hulls along five meridians; two habitation
  belts of stations along the parallels; a polar cap in its own azimuthal kit with a crown of hulls round a hub
  station; the hull's great plates (Voronoi cells) tilt a little each, with dark seams and lit rims between them;
- the equatorial band: two stepped zones round the equator, kitbashed the same way (hulls laid along the band, deck
  grooves with rows of windows), the engine deck with a row of great engine bells, and the DOCKING IRIS: a hangar
  mouth in the engine deck, an elongated twelve-blade iris in a heavy collar on a striped apron, opening onto the lit
  bay inside (its berths, docked transports, guide lights); the runtime opens it with the iris atlas;
- the outer ring: a habitation ring in the equatorial plane on six spokes: a stationary rim (outer and inner walls) and
  the deck that turns inside it (ark-deck.png, the deck in its own plane: the runtime turns it and draws ark-occluder,
  the frame's pixels in front of the deck, over it).
Every surface keeps the stock pieces' own painted light, then the globe's key light (and its shadows: the ring's on the
globe, the globe's on the ring) shades it as a whole.

Every frame is square (FRAME px), built at SS x and downsampled (Lanczos on premultiplied colour, a light unsharp mask).
"""
import argparse
import importlib.util
import json
import math
import os
import time
import zlib

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
_spec = importlib.util.spec_from_file_location('giantworks_art', os.path.join(HERE, 'giantworks-art.py'))
gw = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gw)

F32 = np.float32
LUM = np.array([0.299, 0.587, 0.114])

# ---------------------------------------------------------------------------------------------------------------
# Layout (set by configure: frame px, the globe radius in frame px; geometry in units of the globe radius)
# ---------------------------------------------------------------------------------------------------------------

FRAME = 2048
SS = 2
C0 = FRAME / 2
RPX = 0.306 * FRAME            # the globe's radius (frame px)
ELEV = math.radians(20)       # the north pole tipped toward the viewer
LEAN = math.radians(-9)       # ... and the axis leaning (screen, + counter-clockwise)
# the band: two stepped zones (radius, half-height along the axis)
BAND = ((1.042, 0.168), (1.072, 0.09))
# the ring: inner / outer radius, half-height; the spokes
RING_I, RING_O, RING_H = 1.385, 1.5, 0.034
SPOKES = [math.radians(a) for a in (30, 90, 150, 210, 270, 330)]
SPOKE_R = 0.019
# the docking iris: a hangar mouth in the engine deck at IRIS_LON, an ellipse IRIS_SA along the band x IRIS_SB across
# (globe radii), twelve blades
IRIS_LON = math.radians(0)
IRIS_SA, IRIS_SB = 0.185, 0.05
IRIS_BLADES = 12
# dome rings (lat deg, dome angular radius, spacing factor)
DOME_RINGS = ((61.0, 0.027, 2.25), (46.0, 0.033, 2.2), (-33.0, 0.032, 2.2))

LIGHT_S = np.array([-0.62, -0.52, 0.59])   # key light, screen coords (x right, y down, z to the viewer)
LIGHT_S = LIGHT_S / np.linalg.norm(LIGHT_S)


def configure(frame):
    global FRAME, C0, RPX
    FRAME = frame
    C0 = FRAME / 2
    RPX = 0.306 * FRAME


def seeded(name):
    return np.random.default_rng(zlib.crc32(('ark:' + name).encode()))


def unlean(xs, ys_up):
    """Screen (x right, y up; leaned) to the un-leaned view."""
    c, s = math.cos(LEAN), math.sin(LEAN)
    return xs * c + ys_up * s, -xs * s + ys_up * c


def relean(x, y_up):
    c, s = math.cos(LEAN), math.sin(LEAN)
    return x * c - y_up * s, x * s + y_up * c


def view_to_planet(x, y, z):
    ce, se = math.cos(ELEV), math.sin(ELEV)
    return x, y * ce + z * se, -y * se + z * ce


def planet_to_view(X, Y, Z):
    ce, se = math.cos(ELEV), math.sin(ELEV)
    return X, Y * ce - Z * se, Y * se + Z * ce


def planet_to_frame(X, Y, Z):
    """A planet-frame point (globe radii) to frame px (and its view depth)."""
    x, y, z = planet_to_view(X, Y, Z)
    xs, ys = relean(x, y)
    return C0 + xs * RPX, C0 - ys * RPX, z


LX, LY, LZ = view_to_planet(*unlean(LIGHT_S[0], -LIGHT_S[1]), LIGHT_S[2])
LP = np.array([LX, LY, LZ])
LP = LP / np.linalg.norm(LP)
VP = np.array(view_to_planet(0.0, 0.0, 1.0))   # toward the viewer, planet frame
HP = (LP + VP) / np.linalg.norm(LP + VP)       # Blinn half vector


def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------------------------------------------------------
# Ray casting (orthographic, per build pixel; view z toward the viewer: the largest z hit wins)
# ---------------------------------------------------------------------------------------------------------------

S_NONE, S_GLOBE, S_BANDA, S_BANDB, S_WALLA, S_WALLB, S_DECK, S_RIMO, S_RIMI, S_SPOKE = range(10)


def cast(x, y):
    """x, y: un-leaned view coords (globe radii), flat arrays. Returns (surface id, z, P (3 arrays, planet frame), the
    deck's z where the ray crosses the deck under whatever is nearer (or -inf))."""
    ce, se = math.cos(ELEV), math.sin(ELEV)
    n = x.shape[0]
    best = np.full(n, -np.inf)
    sid = np.zeros(n, np.int8)
    r2 = x * x + y * y

    def Y_of(z):
        return y * ce + z * se

    def rho2_of(z):
        Z = -y * se + z * ce
        return x * x + Z * Z

    def take(z, ok, s):
        m = ok & (z > best)
        best[m] = z[m]
        sid[m] = s

    # the globe
    zg = np.sqrt(np.clip(1 - r2, 0, None))
    take(zg, r2 < 1, S_GLOBE)
    # the band zones (front of a larger sphere within |Y| < h) and their top steps (plane Y = h, between the radii)
    inner = 1.0
    for k, (rb, hb) in enumerate(BAND):
        z = np.sqrt(np.clip(rb * rb - r2, 0, None))
        take(z, (r2 < rb * rb) & (np.abs(Y_of(z)) < hb), S_BANDA + k)
        zw = (hb - y * ce) / se
        rr = rho2_of(zw)
        take(zw, (rr >= inner * inner - hb * hb) & (rr <= rb * rb - hb * hb), S_WALLA + k)
        inner = rb
    # the ring: top deck, outer wall (front), inner wall (back half, seen from inside)
    zd = (RING_H - y * ce) / se
    rr = rho2_of(zd)
    deck_ok = (rr >= RING_I ** 2) & (rr <= RING_O ** 2)
    take(zd, deck_ok, S_DECK)
    for (rad, s, front) in ((RING_O, S_RIMO, True), (RING_I, S_RIMI, False)):
        q = rad * rad - x * x
        sq = np.sqrt(np.clip(q, 0, None))
        z = (y * se + (sq if front else -sq)) / ce
        take(z, (q > 0) & (np.abs(Y_of(z)) <= RING_H), s)
    # the spokes (cylinders along the equatorial plane from the engine deck to the ring)
    P0 = np.stack([x, y * ce, -y * se])
    D = np.array([0.0, se, ce])
    for phi in SPOKES:
        a = np.array([math.sin(phi), 0.0, math.cos(phi)])
        pa = a @ P0
        q0 = P0 - a[:, None] * pa[None]
        q1 = D - a * (a @ D)
        A = q1 @ q1
        B = 2 * (q1 @ q0)
        Cc = (q0 * q0).sum(0) - SPOKE_R ** 2
        disc = B * B - 4 * A * Cc
        z = (-B + np.sqrt(np.clip(disc, 0, None))) / (2 * A)
        along = pa + z * (a @ D)
        take(z, (disc > 0) & (along > BAND[1][0] - 0.01) & (along < RING_I + 0.005), S_SPOKE)
    X = x
    Y = y * ce + best * se
    Z = -y * se + best * ce
    deck_z = np.where(deck_ok, zd, -np.inf)
    return sid, best, (X, Y, Z), deck_z


def in_globe_shadow(X, Y, Z):
    """1 where the ray from the point toward the key light hits the globe (soft edge)."""
    pl = X * LP[0] + Y * LP[1] + Z * LP[2]
    p2 = X * X + Y * Y + Z * Z
    d2 = p2 - pl * pl                     # squared distance of the light ray's line from the centre
    ahead = pl < 0                         # the globe lies toward the light
    return np.where(ahead, sstep(1.004, 0.985, np.sqrt(np.clip(d2, 0, None))), 0.0) * (p2 > 1.0005)


def in_ring_shadow(X, Y, Z):
    """1 where the ray toward the light crosses the ring's plane inside the ring (the ring's shadow; soft)."""
    t = (0.0 - Y) / LP[1]
    hx = X + t * LP[0]
    hz = Z + t * LP[2]
    rho = np.sqrt(hx * hx + hz * hz)
    m = sstep(RING_I - 0.006, RING_I + 0.006, rho) * sstep(RING_O + 0.006, RING_O - 0.006, rho)
    return np.where(t > 0, m, 0.0)


def in_band_shadow(X, Y, Z):
    """1 where the ray toward the light hits the band's outer zone sphere within its height (its shadow on the globe)."""
    rb, hb = BAND[0]
    pl = X * LP[0] + Y * LP[1] + Z * LP[2]
    p2 = X * X + Y * Y + Z * Z
    disc = pl * pl - (p2 - rb * rb)
    sq = np.sqrt(np.clip(disc, 0, None))
    out = np.zeros_like(X)
    for t in (-pl - sq, -pl + sq):
        hy = Y + t * LP[1]
        out = np.maximum(out, ((disc > 0) & (t > 1e-3) & (np.abs(hy) < hb)).astype(np.float64))
    return out


# ---------------------------------------------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------------------------------------------

RX = np.array([0.0, 0.2, 0.45, 0.7, 0.88, 1.0])
RAMPS = {
    # dark machinery gunmetal (the continents)
    'mach': [[.022, .023, .027], [.07, .072, .078], [.14, .142, .148], [.23, .23, .232], [.33, .325, .32], [.43, .42, .41]],
    # armour plate (the seas): a cool mid grey
    'plate': [[.08, .085, .095], [.18, .188, .2], [.3, .31, .325], [.4, .41, .425], [.48, .49, .505], [.56, .57, .58]],
    # a warmer, older plate (the seas' patches)
    'plate2': [[.085, .08, .075], [.185, .175, .16], [.3, .285, .265], [.395, .38, .355], [.47, .455, .43], [.55, .535, .51]],
    # pale habitation plating (the dome belts, the band's decks)
    'pale': [[.1, .1, .1], [.24, .24, .235], [.4, .4, .39], [.54, .535, .52], [.64, .63, .61], [.74, .73, .7]],
    # dark glass (the domes, the solar decks)
    'glass': [[.008, .016, .022], [.02, .04, .052], [.04, .075, .09], [.07, .12, .14], [.11, .17, .19], [.17, .24, .26]],
    # heat-stained bronze (engine collars, old machinery)
    'bronze': [[.03, .02, .012], [.09, .06, .035], [.18, .12, .07], [.29, .2, .12], [.39, .28, .17], [.5, .38, .25]],
    # hazard yellow (the iris apron's stripes, sparse)
    'hazard': [[.05, .035, .005], [.16, .11, .02], [.34, .24, .05], [.52, .38, .09], [.64, .48, .14], [.74, .58, .22]],
    # near black (recesses, trenches, the iris shaft)
    'dark': [[.004, .004, .005], [.012, .012, .014], [.025, .025, .028], [.045, .045, .05], [.07, .07, .075], [.1, .1, .105]],
}
RAMPS = {k: np.array(v) for k, v in RAMPS.items()}
MATS = tuple(RAMPS.keys())
MI = {m: k for k, m in enumerate(MATS)}
# per material: specular strength, exponent (plate glossy, machinery rough)
GLOSS = {'mach': (0.10, 18), 'plate': (0.55, 60), 'plate2': (0.4, 45), 'pale': (0.25, 30), 'glass': (0.9, 120), 'bronze': (0.3, 24), 'hazard': (0.15, 20), 'dark': (0.05, 10)}


def ramp(name, v):
    c = RAMPS[name]
    return np.stack([np.interp(v, RX, c[:, k]) for k in range(3)], axis=-1)


def noise3(rng, n=6, scale=3.0):
    """A smooth random field over the unit sphere: random 3D plane waves (seamless). f(vectors (..., 3)) -> ~0..1."""
    ks = rng.normal(size=(n, 3)) * scale
    ph = rng.uniform(0, 2 * math.pi, n)
    amp = rng.uniform(0.5, 1.0, n)

    def f(v):
        s = np.zeros(v.shape[:-1])
        for k in range(n):
            s = s + amp[k] * np.sin(v @ ks[k] + ph[k])
        return 0.5 + 0.5 * s / amp.sum() * 1.6

    return f


# ---------------------------------------------------------------------------------------------------------------
# The globe's surface map (equirectangular: u along the longitude from -pi, v down from the north pole; build px)
# ---------------------------------------------------------------------------------------------------------------

def fit(arr, w, h, k90=0, flip=False):
    """A crop channel resized to w x h (after a quarter turn / flip)."""
    a = np.rot90(arr, k90) if k90 else arr
    if flip:
        a = a[:, ::-1]
    if a.ndim == 3:
        return np.stack([fit(a[..., q], w, h) for q in range(a.shape[2])], -1)
    im = Image.fromarray(np.ascontiguousarray(a).astype(np.float32), 'F').resize((max(1, w), max(1, h)), Image.BICUBIC)
    return np.asarray(im).astype(F32)


LON_VIS = math.radians(118)   # only the near side is painted (the rest is never seen)
_ROOT = [os.path.join(GAME, 'public', 'assets', 'dwu')]


def root_dir():
    return _ROOT[0]


# ---------------------------------------------------------------------------------------------------------------
# Stock pieces (whole DW:U frames and crops of them, their own painted colour and lights)
# ---------------------------------------------------------------------------------------------------------------

# The race families by palette: worn cool steel (most of the Ark), warm bronze / olive steel, blue steel.
FAM_COOL = (22, 23, 24, 25, 6)
FAM_WARM = (5, 7, 8, 21, 12, 11)
FAM_BLUE = (0, 9)
HULLS = ('capitalship', 'carrier', 'cruiser', 'largefreighter', 'destroyer', 'trooptransport', 'colonyship', 'resupplyship')
STATIONS = ('largespaceport', 'mediumspaceport', 'genericbase', 'resortbase', 'miningstation', 'gasminingstation', 'smallspaceport')
SMALL = ('escort', 'frigate', 'explorationship', 'constructionship', 'smallfreighter', 'mediumfreighter', 'passengership', 'miningship', 'gasminingship')

_STOCK = {}


def stock(rel):
    """A whole stock frame: coverage A, native colour C (its lit windows and marker pixels filled from round them), the
    lit windows as emission E in their own colour; cropped to its content. None if the file is missing."""
    if rel in _STOCK:
        return _STOCK[rel]
    path = os.path.join(root_dir(), 'images', 'units', 'ships', rel)
    if not os.path.exists(path):
        _STOCK[rel] = None
        return None
    img = Image.open(path).convert('RGBA')
    raw = np.asarray(img)
    a = raw.astype(np.float64) / 255
    rgb, al = a[..., :3], a[..., 3]
    r8 = raw[..., :3].astype(np.int32)
    marker = (((r8[..., 0] == 0) & (r8[..., 1] == 0) & (r8[..., 2] == 255)) | ((r8[..., 0] == 255) & (r8[..., 1] == 255) & (r8[..., 2] == 0))) & (al > 0)
    hue, sat, val = gw.hsv(rgb)
    glow = (sat > 0.42) & (val > 0.45) & ~marker & (al > 0.4)
    glow |= (val > 0.93) & (sat < 0.25) & (al > 0.4)
    glow = gw.dilate(glow, 1) & (al > 0.3) & ~marker
    keep = ((al > 0.5) & ~glow & ~marker).astype(np.float64)
    den = np.maximum(gw.fblur(keep, 1.5), 1e-3)
    fill = np.stack([gw.fblur(rgb[..., k] * keep, 1.5) / den for k in range(3)], -1)
    C = np.where((glow | marker)[..., None], fill * 0.8, rgb)
    E = np.where(glow[..., None], rgb * np.clip((val - 0.3) / 0.7, 0, 1)[..., None], 0.0)
    bb = Image.fromarray((al * 255).astype(np.uint8)).getbbox()
    sl = (slice(bb[1], bb[3]), slice(bb[0], bb[2]))
    p = {'A': al[sl].astype(F32), 'C': C[sl].astype(F32), 'E': E[sl].astype(F32)}
    _STOCK[rel] = p
    return p


def fam_file(fam, role):
    return 'family%d/%s.png' % (fam, role)


def pick_piece(rng, fams, roles):
    for _ in range(12):
        p = stock(fam_file(int(rng.choice(fams)), str(rng.choice(roles))))
        if p is not None:
            return p
    return stock('family22/capitalship.png')


def opaque_crop(rng, p, size):
    """A square crop (stock px) lying wholly on a piece's opaque hull, or None."""
    key = ('ii', id(p))
    if key not in _STOCK:
        ok = p['A'] > 0.97
        _STOCK[key] = np.pad(np.cumsum(np.cumsum(ok.astype(np.int64), 0), 1), ((1, 0), (1, 0)))
    ii = _STOCK[key]
    s = int(size)
    H, W = p['A'].shape
    if s >= H or s >= W:
        return None
    tot = ii[s:, s:] - ii[:-s, s:] - ii[s:, :-s] + ii[:-s, :-s]
    ys, xs = np.nonzero(tot >= s * s)
    if len(ys) == 0:
        return None
    i = int(rng.integers(len(ys)))
    y, x = int(ys[i]), int(xs[i])
    return {'A': np.ones((s, s), F32), 'C': p['C'][y:y + s, x:x + s], 'E': p['E'][y:y + s, x:x + s]}


def xform(p, scale, rot=0.0, flip=False, sx=1.0, sy=1.0):
    """A piece resized (scale x sx, scale x sy) after a flip, then turned `rot` degrees (counter-clockwise, expanded):
    straight channels A, C, E."""
    A = p['A']
    chans = [A] + [p['C'][..., k] * A for k in range(3)] + [p['E'][..., k] * A for k in range(3)]
    out = []
    for ch in chans:
        im = Image.fromarray(np.ascontiguousarray(ch).astype(np.float32), 'F')
        if flip:
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
        if rot % 360:
            # turned first at the piece's own scale, then stretched in the target's axes (sx, sy: e.g. the map's 1 / cos
            # lat), so the stretch never shears the piece
            im = im.rotate(rot, resample=Image.BICUBIC, expand=True)
        rw, rh = im.size
        tw, th = max(1, int(round(rw * scale * sx))), max(1, int(round(rh * scale * sy)))
        if (tw, th) != (rw, rh):
            im = im.resize((tw, th), Image.LANCZOS if scale * min(sx, sy) < 1 else Image.BICUBIC)
        out.append(np.asarray(im).astype(F32))
    a = np.clip(out[0], 0, 1)
    inv = 1 / np.maximum(a, 1e-4)
    C = np.clip(np.stack(out[1:4], -1) * inv[..., None], 0, 1.2)
    E = np.clip(np.stack(out[4:7], -1) * inv[..., None], 0, 2)
    return a, C, E


class Kit:
    """A kitbash canvas (any surface's own px): colour C, emission E, coverage A, contact-shadow factor D, height H."""

    def __init__(self, w, h):
        self.w, self.h = int(w), int(h)
        self.C = np.zeros((self.h, self.w, 3), F32)
        self.C[:] = np.array([0.12, 0.12, 0.13], F32)
        self.E = np.zeros((self.h, self.w, 3), F32)
        self.E2 = np.zeros((self.h, self.w, 3), F32)   # a second emission layer (the engine bells' heat)
        self.A = np.zeros((self.h, self.w), F32)
        self.D = np.ones((self.h, self.w), F32)
        self.H = np.zeros((self.h, self.w), F32)

    def paste(self, p, cx, cy, scale=1.0, rot=0.0, flip=False, sx=1.0, sy=1.0, shadow=0.55, lift=0.0, tint=None,
              emit=1.0, seam=0.0, clip=None):
        a, C, E = xform(p, scale, rot, flip, sx, sy)
        ph, pw = a.shape
        x0, y0 = int(round(cx - pw / 2)), int(round(cy - ph / 2))
        dx0, dy0 = max(0, x0), max(0, y0)
        dx1, dy1 = min(self.w, x0 + pw), min(self.h, y0 + ph)
        if dx1 <= dx0 or dy1 <= dy0:
            return
        sl = (slice(dy0, dy1), slice(dx0, dx1))
        ps = (slice(dy0 - y0, dy1 - y0), slice(dx0 - x0, dx1 - x0))
        a = a[ps]
        C = C[ps]
        E = E[ps]
        if clip is not None:
            a = a * clip[sl]
        if tint is not None:
            C = C * np.asarray(tint, F32)
        if shadow > 0:
            o = max(1, int(round(1.5 + 3.0 * scale)))
            m = o + 6
            ry0, ry1 = max(0, dy0 - m), min(self.h, dy1 + m)
            rx0, rx1 = max(0, dx0 - m), min(self.w, dx1 + m)
            big = np.zeros((ry1 - ry0, rx1 - rx0), np.float64)
            big[dy0 - ry0:dy1 - ry0, dx0 - rx0:dx1 - rx0] = a
            sh = gw.fblur(gw.shift(big, o, o), 1.0 + 1.4 * scale) * shadow
            self.D[ry0:ry1, rx0:rx1] *= (1 - sh * (1 - big)).astype(F32)
        a3 = a[..., None]
        lum = C @ LUM.astype(F32)
        self.C[sl] = self.C[sl] * (1 - a3) + C * a3
        self.E[sl] = self.E[sl] * (1 - a3) + E * a3 * emit
        self.E2[sl] *= (1 - a3)
        self.D[sl] = self.D[sl] * (1 - a) + a
        self.H[sl] = self.H[sl] * (1 - a) + (lift + lum * 3.0) * a
        self.A[sl] = self.A[sl] * (1 - a) + a
        if seam > 0:
            e = np.zeros(a.shape, bool)
            e[:1, :] = e[-1:, :] = True
            e[:, :1] = e[:, -1:] = True
            self.C[sl][e] *= (1 - seam)
            self.H[sl][e] -= 1.0

    def cells(self, rng, fams, x0, x1, y0, y1, ch, roles=HULLS + STATIONS, stretch=None, tone=0.06, seam=0.45, lift=0.0):
        """Rows y0..y1 tiled with crops of stock hulls about ch px tall (widths ch x 0.8..1.6; `stretch(y)` widens a
        row, e.g. 1 / cos(lat) on the globe's map)."""
        y = y0
        while y < y1:
            h = int(ch * rng.choice([1.0, 1.0, 0.7, 1.35]))
            h = max(4, min(h, y1 - y))
            k = 1.0 if stretch is None else stretch(y + h / 2)
            x = x0 - int(rng.integers(0, ch))
            while x < x1:
                w = int(round(h * rng.uniform(0.8, 1.6) * k))
                side = int(min(max(h, w / k), 240))
                crop = None
                for q in range(12):
                    crop = opaque_crop(rng, pick_piece(rng, fams, roles), max(6, int(side * (1.0, 0.8, 0.65, 0.5)[min(3, q // 3)])))
                    if crop is not None:
                        side = crop['A'].shape[0]
                        break
                if crop is not None:
                    t = 1 + rng.normal(0, tone)
                    warm = rng.normal(0, 0.025)
                    k90 = int(rng.integers(4))
                    c = {'A': crop['A'], 'C': np.rot90(crop['C'], k90), 'E': np.rot90(crop['E'], k90)}
                    self.paste(c, x + w / 2, y + h / 2, 1.0, 0, bool(rng.random() < 0.5), sx=w / side, sy=h / side,
                               shadow=0.0, lift=lift, tint=(t * (1 + warm), t, t * (1 - warm)), seam=seam)
                x += w
            y += h


# ---------------------------------------------------------------------------------------------------------------
# The globe: a dense kitbash of whole stock frames over a mat of hull crops, mapped (equirectangular, frame px)
# ---------------------------------------------------------------------------------------------------------------

POLE_CAP = math.radians(24)    # the polar cap's own (azimuthal) kit reaches this far from the pole
POLE_BLEND = (math.radians(68), math.radians(72))


class GlobeMap(Kit):
    def __init__(self):
        MW = int(math.ceil(2 * math.pi * RPX * 1.02 / 256)) * 256
        super().__init__(MW, MW // 2)
        self.MW, self.MH = MW, MW // 2
        self.ppr = MW / (2 * math.pi)
        self.j0 = int((math.pi - LON_VIS) * self.ppr)
        self.j1 = int((math.pi + LON_VIS) * self.ppr)
        self.i1 = int((math.pi / 2 + math.radians(76)) * self.ppr)

    def u_of(self, lon):
        return (lon + math.pi) * self.ppr

    def v_of(self, lat):
        return (math.pi / 2 - lat) * self.ppr

    def lat_of(self, v):
        return math.pi / 2 - v / self.ppr


def districts():
    """The palette of each part of the globe (0 cool steel, 1 warm bronze / olive, 2 blue steel): broad districts."""
    fa = noise3(seeded('dist-a'), 8, 3.2)
    fb = noise3(seeded('dist-b'), 8, 4.0)

    def f(v):
        a = fa(v)
        b = fb(v)
        return np.where(a > 0.62, 1, np.where(b > 0.66, 2, 0))

    return f


DIST_FAMS = (FAM_COOL, FAM_WARM, FAM_BLUE)


def vec_of(lat, lon):
    return np.array([math.cos(lat) * math.sin(lon), math.sin(lat), math.cos(lat) * math.cos(lon)])


def sample_cap(rng, n, lat0=-72, lat1=88, minvis=0.0):
    """n points spread over the near side (area-weighted), as (lat, lon)."""
    out = []
    while len(out) < n:
        lat = math.asin(rng.uniform(math.sin(math.radians(lat0)), math.sin(math.radians(lat1))))
        lon = rng.uniform(-LON_VIS + 0.05, LON_VIS - 0.05)
        vis = float(vec_of(lat, lon) @ VP)
        if vis > minvis or rng.random() < 0.05:
            out.append((lat, lon))
    return out


def paint_globe(gm, rng):
    """The globe's skin: (1) a mat of hull-plating crops over everything (rows of cells, dark seams), each district in
    its families' palette; (2) whole capital hulls, carriers and freighters; (3) whole stations and bases (the
    megastructures); (4) small hulls and stations as greebles; (5) two habitation belts: rows of stations along the
    parallels, close packed; (6) a crown of hulls round the north pole. Every whole piece casts a soft contact shadow
    and keeps its own painted colour and lit windows (tinted a little warm or cool)."""
    dist = districts()
    calm_f = noise3(seeded('calm'), 8, 3.6)
    S = gm.ppr / RPX    # map px per frame px at the equator (~1)

    def fams_at(lat, lon):
        return DIST_FAMS[int(dist(vec_of(lat, lon)[None])[0])]

    def calm_at(lat, lon):
        """0..1: the calm regions (broad plating, few modules on it, a little darker)."""
        return float(sstep(0.56, 0.68, calm_f(vec_of(lat, lon)[None]))[0])

    # (1) the mat, row by row; each cell's district from its centre
    y = 0
    base_h = max(16, int(0.11 * gm.ppr))
    while y < gm.i1:
        h = int(base_h * rng.choice([1.0, 0.75, 1.3]))
        lat = gm.lat_of(y + h / 2)
        cl = max(0.12, math.cos(lat))
        x = gm.j0 - int(rng.integers(0, base_h))
        while x < gm.j1:
            w = int(round(h * rng.uniform(0.8, 1.7) / cl))
            lon = (x + w / 2) / gm.ppr - math.pi
            fams = fams_at(lat, lon)
            cm = calm_at(lat, lon)
            if cm > 0.5 and rng.random() < 0.7:
                w = int(w * 1.8)
            # the crop as large as the cell is on the sphere (squeezed into the map, never magnified)
            side = int(min(max(8, h, w * cl), 220))
            crop = None
            for k in range(12):
                # a crop that size, else smaller (stretched a little to fill: big opaque crops are rare)
                crop = opaque_crop(rng, pick_piece(rng, fams, STATIONS + ("capitalship", "carrier")), max(8, int(side * (1.0, 0.8, 0.65, 0.5)[min(3, k // 3)])))
                if crop is not None:
                    side = crop['A'].shape[0]
                    break
            if crop is not None:
                k90 = int(rng.integers(4))
                c = {'A': crop['A'], 'C': np.rot90(crop['C'], k90), 'E': np.rot90(crop['E'], k90)}
                t = (1 + rng.normal(0, 0.035)) * (1 - 0.22 * cm)
                warm = rng.normal(0, 0.02)
                gm.paste(c, x + w / 2, y + h / 2, 1.0, 0, bool(rng.random() < 0.5), sx=w / side, sy=h / side, shadow=0.0,
                         tint=(t * (1 + warm), t, t * (1 - warm)), seam=0.5, emit=0.8)
            x += w
        y += h

    lat0, lat1 = math.radians(-72), math.radians(86)
    area = RPX * RPX * 2 * (LON_VIS - 0.05) * (math.sin(lat1) - math.sin(lat0))   # the painted part (frame px^2)

    def scatter(cover, roles, s0, s1, lift, shadow, step=90.0):
        # whole pieces until about `cover` of the painted area is covered (their own area, scaled)
        got = 0.0
        while got < cover * area:
            lat = math.asin(rng.uniform(math.sin(lat0), math.sin(lat1)))
            lon = rng.uniform(-LON_VIS + 0.05, LON_VIS - 0.05)
            p = pick_piece(rng, fams_at(lat, lon), roles)
            cl = max(0.15, math.cos(lat))
            sc = float(rng.uniform(s0, s1))
            if rng.random() < 0.85 * calm_at(lat, lon):
                got += float(p['A'].sum()) * sc * sc
                continue
            t = 1 + rng.normal(0, 0.06)
            warm = rng.normal(0, 0.03)
            rot = step * int(rng.integers(0, int(360 / step))) + float(rng.normal(0, 4))
            gm.paste(p, gm.u_of(lon), gm.v_of(lat), sc * S, rot, bool(rng.random() < 0.5), sx=1 / cl, shadow=shadow,
                     lift=lift, tint=(t * (1 + warm), t, t * (1 - warm)))
            got += float(p['A'].sum()) * sc * sc

    scatter(1.1, HULLS, 0.55, 1.0, 3.0, 0.6)
    scatter(0.7, STATIONS, 0.45, 1.0, 6.0, 0.65, 45.0)
    scatter(0.35, SMALL, 0.35, 0.8, 9.0, 0.55)
    # (5) the habitation belts: stations close packed along two parallels, long axis along the belt
    for latd, s in ((58.0, 0.42), (38.0, 0.5)):
        lat = math.radians(latd)
        cl = math.cos(lat)
        lon = -LON_VIS + 0.05
        while lon < LON_VIS - 0.05:
            p = pick_piece(rng, FAM_COOL, ('mediumspaceport', 'resortbase', 'genericbase', 'smallspaceport'))
            sc = s * float(rng.uniform(0.85, 1.15)) * S
            gm.paste(p, gm.u_of(lon), gm.v_of(lat) + rng.normal(0, 3), sc, 90.0 if rng.random() < 0.5 else -90.0,
                     bool(rng.random() < 0.5), sx=1 / cl, shadow=0.7, lift=12.0, emit=1.3)
            lon += p['A'].shape[0] * sc * 0.78 / (gm.ppr * cl)
    # spines: chains of capital hulls end to end along a few meridians (the frame the districts hang on)
    for lond in (-78.0, -38.0, 12.0, 52.0, 92.0):
        lon = math.radians(lond)
        lat = math.radians(14)
        while lat < math.radians(70):
            cl = math.cos(lat)
            p = pick_piece(rng, FAM_COOL, ('capitalship', 'carrier', 'largefreighter', 'cruiser'))
            sc = 0.62 * S
            gm.paste(p, gm.u_of(lon), gm.v_of(lat), sc, 0.0, bool(rng.random() < 0.5), sx=1 / cl, shadow=0.7, lift=11.0, emit=1.2)
            lat += p['A'].shape[0] * sc * 0.82 / gm.ppr
    # (6) the crown: hulls round the pole, bows out
    for k in range(18):
        lon = -LON_VIS + (k + 0.5) * 2 * LON_VIS / 18
        lat = math.radians(rng.uniform(74, 80))
        cl = math.cos(lat)
        p = pick_piece(rng, FAM_COOL, ('capitalship', 'cruiser', 'carrier'))
        gm.paste(p, gm.u_of(lon), gm.v_of(lat), 0.6 * S, 0.0, bool(rng.random() < 0.5), sx=1 / cl, shadow=0.6, lift=10.0)
    # window speckle: warm lights strewn over the dark machinery (the stock lights are mostly cyan)
    dark = (gm.C.max(-1) < 0.3) & (rng.random((gm.h, gm.w)) < 0.0015)
    dark[:, :gm.j0] = False
    dark[:, gm.j1:] = False
    cols = np.array([[1.0, 0.78, 0.48], [1.0, 0.88, 0.7], [1.0, 0.65, 0.35]], F32)
    gm.E[dark] += cols[rng.integers(0, 3, int(dark.sum()))] * 0.85


def paint_pole(gm, rng):
    """The north polar cap in its own azimuthal kit (the map pinches there): the mat, whole hulls and stations, a crown
    of capital hulls round the pole, bows out, and a hub station on it."""
    R = POLE_CAP * gm.ppr
    W = int(2 * R) + 8
    pk = Kit(W, W)
    pk.c = W / 2
    pk.cells(rng, FAM_COOL, 0, W, 0, W, max(16, int(0.11 * gm.ppr)), roles=STATIONS + ('capitalship', 'carrier'), tone=0.035, seam=0.5)
    got = 0.0
    while got < 1.6 * (2 * R) ** 2:
        p = pick_piece(rng, FAM_COOL + FAM_WARM, HULLS + STATIONS)
        sc = float(rng.uniform(0.5, 1.1))
        pk.paste(p, rng.uniform(0, W), rng.uniform(0, W), sc, 90.0 * int(rng.integers(4)) + float(rng.normal(0, 4)), bool(rng.random() < 0.5),
                 shadow=0.6, lift=4.0)
        got += float(p['A'].sum()) * sc * sc
    for k in range(14):
        a = 2 * math.pi * k / 14
        r = R * 0.42
        p = pick_piece(rng, FAM_COOL, ('capitalship', 'carrier', 'cruiser'))
        pk.paste(p, pk.c + r * math.cos(a), pk.c + r * math.sin(a), 0.75, -math.degrees(a) - 90, False, shadow=0.7, lift=8.0)
    hub = stock('family22/largespaceport.png')
    pk.paste(hub, pk.c, pk.c, 0.9, 0, False, shadow=0.75, lift=12.0)
    gy, gx = np.gradient(pk.H)
    pk.GX, pk.GY = gx.astype(F32), gy.astype(F32)
    return pk


PLATES = 70     # the hull's great plates (Voronoi cells of a jittered Fibonacci sphere)


def plate_centres():
    rng = seeded('plates')
    k = np.arange(PLATES) + 0.5
    phi = np.arccos(1 - 2 * k / PLATES)
    th = math.pi * (1 + 5 ** 0.5) * k
    v = np.stack([np.cos(th) * np.sin(phi), np.cos(phi), np.sin(th) * np.sin(phi)], -1) + rng.normal(0, 0.09, (PLATES, 3))
    v /= np.linalg.norm(v, axis=1, keepdims=True)
    tilt = rng.normal(0, 0.07, (PLATES, 3))
    tone = 1 + rng.normal(0, 0.07, PLATES)
    return v, tilt, tone


PLATE_V, PLATE_TILT, PLATE_TONE = plate_centres()


def plates_at(P):
    """Per globe point (3, n): its plate's tilt (3, n) and tone (n,), and how close it is to the plate's edge (the
    seam: 1 on it), and which side of the seam faces the light (the rim catching it)."""
    d = PLATE_V @ P
    i1 = np.argmax(d, 0)
    d1 = d[i1, np.arange(P.shape[1])]
    d[i1, np.arange(P.shape[1])] = -9
    i2 = np.argmax(d, 0)
    d2 = d[i2, np.arange(P.shape[1])]
    gap = (d1 - d2) / max(1e-6, 1.0)        # ~ the angle to the seam x the plates' separation
    seam = sstep(0.009, 0.003, gap) * 0.7
    rim = sstep(0.016, 0.009, gap) * sstep(0.003, 0.009, gap)
    # the rim is lit where the seam lies away from the light (the plate's edge stands up toward it)
    side = (PLATE_V[i2] - PLATE_V[i1]) @ LP
    return PLATE_TILT[i1].T, PLATE_TONE[i1], seam, rim * (side < 0)


def build_map(root):
    t0 = time.time()
    gm = GlobeMap()
    paint_globe(gm, seeded('globe'))
    gm.pole = paint_pole(gm, seeded('pole'))
    gy, gx = np.gradient(gm.H)
    gm.GX, gm.GY = gx.astype(F32), gy.astype(F32)
    print('map', gm.MW, 'x', gm.MH, round(time.time() - t0, 1), 's', flush=True)
    return gm


# ---------------------------------------------------------------------------------------------------------------
# Strips: the band's zones and steps, the ring's rim and deck, the spokes (each in its own frame px: along x across)
# ---------------------------------------------------------------------------------------------------------------

ENGINE_STEP = math.radians(12)   # the engine bells round the engine deck
ENGINE_R = 0.052                 # their radius (globe radii)


def lay_hulls(st, rng, fams, y0, y1, scale_h, roles=HULLS, lift=4.0, shadow=0.6, gap=0.85, emit=1.0):
    """Whole hulls laid along a strip (bow along x), packed end to end between rows y0..y1, each scaled so its beam
    fills about scale_h of the row."""
    x = -int(rng.integers(0, 40))
    while x < st.w:
        p = pick_piece(rng, fams, roles)
        hh, ww = p['A'].shape
        sc = (y1 - y0) * scale_h / ww * float(rng.uniform(0.85, 1.1))
        L = hh * sc
        st.paste(p, x + L / 2, (y0 + y1) / 2 + rng.normal(0, (y1 - y0) * 0.05), sc, 90.0 if rng.random() < 0.5 else -90.0,
                 bool(rng.random() < 0.5), shadow=shadow, lift=lift, emit=emit)
        x += int(L * gap)


def band_strips(rng):
    out = {}
    for k, (rb, hb) in enumerate(BAND):
        W = int(2 * LON_VIS * rb * RPX) + 4
        Hh = int(2 * hb * RPX) + 4
        st = Kit(W, Hh)
        st.kpx = rb * RPX
        st.hb = hb
        if k == 0:
            mid = Hh // 2
            top = mid - int(BAND[1][1] * RPX)      # the visible upper deck: rows 0..top
            st.cells(rng, FAM_COOL, 0, W, 0, Hh, max(8, int(0.05 * RPX)))
            lay_hulls(st, rng, FAM_COOL + FAM_BLUE, 2, top - 1, 0.95, HULLS + ('largespaceport', 'mediumspaceport'))
            lay_hulls(st, rng, FAM_COOL, 2, top * 0.55, 0.9, SMALL, lift=7.0)
            lay_hulls(st, rng, FAM_COOL, Hh - top + 1, Hh - 2, 0.95, HULLS, emit=0.8)
            # habitation decks: dark grooves with rows of warm windows across the upper deck
            for f in (0.3, 0.62, 0.9):
                v = int(f * top)
                st.C[v:v + 2] *= 0.35
                xx = np.arange(W)
                on = (xx % 5 < 2) & (np.sin(xx * 0.013 + f * 9) > -0.4)
                st.E[v:v + 2][:, on] += np.array([1.0, 0.82, 0.55], F32) * 0.9
            st.C[:2] = st.C[:2] * 0.6 + 0.25
        else:
            st.cells(rng, FAM_WARM + FAM_COOL, 0, W, 0, Hh, max(8, int(0.06 * RPX)), tone=0.06)
            mid = Hh // 2
            st.engines = []
            yy, xx = np.mgrid[0:Hh, 0:W].astype(np.float64)
            for lon in np.arange(-math.pi + ENGINE_STEP / 2, math.pi, ENGINE_STEP):
                if abs(lon) > LON_VIS or abs(lon - IRIS_LON) * rb < IRIS_SA * 1.62 + ENGINE_R * 1.3:
                    continue
                uc = (lon + LON_VIS) * st.kpx
                rr = ENGINE_R * RPX
                a0, a1 = max(0, int(uc - rr * 1.5)), min(W, int(uc + rr * 1.5) + 1)
                sl = (slice(0, Hh), slice(a0, a1))
                dx = (xx[sl] - uc) / rr
                dy = (yy[sl] - mid) / rr
                d = np.hypot(dx, dy)
                ang = np.arctan2(dy, dx)
                collar = (d < 1.25) & (d >= 1.0)
                bell = d < 1.0
                base = st.C[sl].mean(-1, keepdims=True)
                bronze = np.array([0.42, 0.33, 0.24], F32)
                cc = bronze * (0.55 + 0.9 * base) * (0.75 + 0.25 * np.cos(ang * 16) ** 2)[..., None]
                st.C[sl] = np.where(collar[..., None], cc, st.C[sl])
                st.H[sl] = np.where(collar, 5.0, st.H[sl])
                ribs = 0.5 + 0.5 * np.cos(d * 22)
                ci = np.array([0.13, 0.11, 0.1], F32) * (0.6 + 0.8 * ribs * (d > 0.35))[..., None] * (0.7 + 0.6 * base)
                st.C[sl] = np.where(bell[..., None], ci, st.C[sl])
                st.H[sl] = np.where(bell, -rr * 0.5 * (1 - d * d), st.H[sl])
                st.E[sl] = np.where((collar | bell)[..., None], 0.0, st.E[sl])
                core = np.clip(1 - d / 0.65, 0, 1)
                st.E2[sl] += (core ** 1.5)[..., None] * np.array([1.0, 0.55, 0.25], F32) * 0.6
                ring_ = (np.abs(d - 1.12) < 0.04) & (np.abs(((ang / (2 * math.pi) * 12) % 1) - 0.5) < 0.15)
                st.E[sl] += ring_[..., None] * np.array([1.0, 0.8, 0.5], F32) * 0.6
                st.engines.append(lon)
        out[k] = st
    # the top steps: rails of small hulls, radial (x along the band, y outward from the inner edge)
    for k in (0, 1):
        r_in = math.sqrt((1.0 if k == 0 else BAND[0][0]) ** 2 - BAND[k][1] ** 2)
        r_out = math.sqrt(BAND[k][0] ** 2 - BAND[k][1] ** 2)
        W = int(2 * LON_VIS * r_out * RPX) + 4
        Hh = max(6, int((r_out - r_in) * RPX) + 4)
        st = Kit(W, Hh)
        st.kpx = r_out * RPX
        st.r_in = r_in
        st.cells(rng, FAM_COOL, 0, W, 0, Hh, max(4, Hh // 2))
        lay_hulls(st, rng, FAM_COOL, 0, Hh, 0.9, SMALL, lift=3.0, gap=1.3)
        out['wall%d' % k] = st
    return out


def ring_strip(rng, rad, h_px, inner=False, deck=False):
    W = int(2 * math.pi * rad * RPX) + 4
    st = Kit(W, h_px)
    st.kpx = rad * RPX
    fams = FAM_COOL if not inner else FAM_COOL + FAM_WARM
    st.cells(rng, fams, 0, W, 0, h_px, max(6, int(h_px * (0.5 if deck else 1.0))))
    if deck:
        e = max(2, h_px // 9)
        lay_hulls(st, rng, FAM_COOL + FAM_BLUE, e, h_px - e, 1.0, HULLS + ('largespaceport', 'mediumspaceport', 'genericbase'), lift=5.0, gap=0.9, emit=1.2)
        lay_hulls(st, rng, FAM_COOL, e, h_px // 2, 0.7, SMALL, lift=8.0, gap=1.6)
        st.C[:e] = st.C[:e] * 0.5 + 0.2
        st.C[-e:] = st.C[-e:] * 0.5 + 0.2
        for u in range(0, W, max(4, int(0.03 * RPX))):
            st.E[1:e, u:u + 2] += np.array([0.7, 0.85, 1.0], F32) * 0.8
    else:
        lay_hulls(st, rng, fams, 1, h_px - 1, 0.95, HULLS, lift=3.0, gap=0.9, emit=1.1)
        st.C[:max(1, h_px // 10)] = st.C[:max(1, h_px // 10)] * 0.5 + 0.22
    return st


def spoke_strip(rng):
    L = int((RING_I - BAND[1][0]) * RPX) + 8
    circ = int(2 * math.pi * SPOKE_R * RPX) + 4
    st = Kit(L, max(8, circ))
    st.cells(rng, FAM_COOL, 0, L, 0, st.h, max(4, st.h // 2), tone=0.04)
    lay_hulls(st, rng, FAM_COOL, 0, st.h, 0.9, SMALL, lift=2.0, gap=1.4)
    return st


def all_strips(rng):
    strips = band_strips(rng)
    strips['rimo'] = ring_strip(rng, RING_O, int(2 * RING_H * RPX) + 4)
    strips['rimi'] = ring_strip(rng, RING_I, int(2 * RING_H * RPX) + 4, inner=True)
    strips['deck'] = ring_strip(rng, RING_O, int((RING_O - RING_I) * RPX) + 4, deck=True)
    strips['spoke'] = spoke_strip(rng)
    for st in strips.values():
        gy, gx = np.gradient(st.H)
        st.GX, st.GY = gx.astype(F32), gy.astype(F32)
    return strips


def kit_sample(st, u, v):
    """Bilinear samples of a Kit at float px (C, E, E2, D, GX, GY)."""
    u = np.clip(u - 0.5, 0, st.w - 1.001)
    v = np.clip(v - 0.5, 0, st.h - 1.001)
    u0 = np.floor(u).astype(np.int32)
    v0 = np.floor(v).astype(np.int32)
    fu = (u - u0).astype(F32)
    fv = (v - v0).astype(F32)

    def bl(a):
        if a.ndim == 3:
            f1, f2 = fu[:, None], fv[:, None]
        else:
            f1, f2 = fu, fv
        return a[v0, u0] * (1 - f1) * (1 - f2) + a[v0, u0 + 1] * f1 * (1 - f2) + a[v0 + 1, u0] * (1 - f1) * f2 + a[v0 + 1, u0 + 1] * f1 * f2

    return bl(st.C), bl(st.E), bl(st.E2), bl(st.D), bl(st.GX), bl(st.GY)


# ---------------------------------------------------------------------------------------------------------------
# The docking iris (procedural, in its own tangent frame on the globe)
# ---------------------------------------------------------------------------------------------------------------

def iris_basis():
    """The hangar's frame on the engine deck: its outward normal, the along-band (east) and across-band (north) axes."""
    lo = IRIS_LON
    n = np.array([math.sin(lo), 0.0, math.cos(lo)])
    e = np.array([math.cos(lo), 0.0, -math.sin(lo)])
    nn = np.array([0.0, 1.0, 0.0])
    return n, e, nn


IRIS_N, IRIS_E, IRIS_NN = iris_basis()


def iris_fields(X, Y, Z, open_f):
    """The docking iris (a hangar mouth in the engine deck: an elongated iris IRIS_SA x IRIS_SB globe radii across) over
    band points (planet frame): (weight, L, material weights (K, n), emission (n, 3), slope along, slope across (height
    px per build px), the hole mask). Twelve blades meet in the ellipse; open_f turns them back and opens the mouth onto
    the bay inside: walls ribbed with rings of guide lights going in, the bay's floor (berths with lit pads, a docked
    transport or two, floor strips) at the bottom."""
    kpx = RPX * SS
    rb = BAND[1][0]
    lon = np.arctan2(X, Z)
    s_ = (np.mod(lon - IRIS_LON + math.pi, 2 * math.pi) - math.pi) * rb     # along the band (globe radii)
    t_ = Y                                                                   # across (globe radii)
    us, ut = s_ / IRIS_SA, t_ / IRIS_SB
    q = np.sqrt(us * us + ut * ut)                                           # 1 on the mouth's rim
    psi = np.arctan2(ut, us)
    n = X.shape[0]
    QC, QA = 1.32, 1.62      # the collar's and the apron's outer rims (units of the mouth)
    w = sstep(QA + 0.03, QA - 0.01, q) * (np.abs(t_) < BAND[1][1] + 0.001)
    L = np.full(n, 0.5)
    M = np.zeros((len(MATS), n))
    E = np.zeros((n, 3))
    sa = np.zeros(n)
    sb = np.zeros(n)
    # apron: pale deck plate, hazard chevrons along the long sides, landing lights in rows out from the ends
    apron = q >= QC
    L = np.where(apron, 0.58 - 0.12 * (q - QC) / (QA - QC), L)
    chev = apron & (np.abs(ut) > 0.6) & ((((us * 6 + np.abs(ut) * 2) % 1) < 0.45)) & (q < QA - 0.08)
    M[MI['plate']] = apron & ~chev
    M[MI['hazard']] = chev
    L = np.where(chev, 0.62, L)
    L = np.where(apron & (q > QA - 0.05), 0.2, L)
    rows = apron & (np.abs(ut) < 0.12) & ((np.abs(us) * 8) % 1 < 0.3)
    E[rows] += np.array([1.0, 0.9, 0.75]) * 0.7
    # collar: a heavy elliptic frame (a rounded profile), clamp blocks round it, approach lamps on its crest
    col = (q >= 1.0) & (q < QC)
    tt = np.clip((q - 1.0) / (QC - 1.0), 0, 1)
    prof = np.sin(tt * math.pi)
    clamp = np.abs(((psi / (2 * math.pi) * 20) % 1) - 0.5) < 0.2
    L = np.where(col, np.where(clamp, 0.6, 0.36) + 0.14 * prof, L)
    M[:, col] = 0
    M[MI['mach'], col & ~clamp] = 1
    M[MI['bronze'], col & clamp] = 1
    # the profile's slope along the ellipse's outward normal (in build px of height per build px)
    hcol = 0.012 * kpx
    gq_s, gq_t = us / np.maximum(q, 1e-6) / IRIS_SA, ut / np.maximum(q, 1e-6) / IRIS_SB   # grad q (per globe radius)
    dq = np.cos(tt * math.pi) * math.pi / (QC - 1.0)
    sl = np.where(col, hcol * dq / kpx, 0.0)
    sa += sl * gq_s
    sb += sl * gq_t
    crest = col & (np.abs(tt - 0.5) < 0.14) & (np.abs(((psi / (2 * math.pi) * 40) % 1) - 0.5) < 0.12)
    E[crest] += np.array([1.0, 0.88, 0.7]) * 0.9
    # the blades: twelve, in the ellipse's own (normalised) frame; each a tilted plate overlapping the next
    ins = q < 1.0
    turn = open_f * 0.9
    phi = psi - 1.1 * q - turn
    fr = (phi / (2 * math.pi) * IRIS_BLADES) % 1
    bi = np.floor(phi / (2 * math.pi) * IRIS_BLADES) % IRIS_BLADES
    tone = 0.46 + 0.06 * np.sin(bi * 2.3)
    Lb = tone - 0.06 + 0.16 * fr - 0.05 * q
    Lb = np.where(fr < 0.05, 0.12, Lb)
    tip = (q < 0.3) & (np.abs(fr - 0.55) < 0.12)
    L = np.where(ins, np.where(tip & (open_f < 0.02), 0.72, Lb), L)
    M[:, ins] = 0
    M[MI['plate'], ins & ~tip] = 0.5
    M[MI['mach'], ins & ~tip] = 0.5
    M[MI['hazard'], ins & tip] = 1
    tilt = np.where(ins, 1.2 / (2 * math.pi / IRIS_BLADES * np.maximum(q, 0.05) * IRIS_SB * kpx), 0.0)
    sa += tilt * -np.sin(psi) / IRIS_SA * IRIS_SB
    sb += tilt * np.cos(psi)
    hole = np.zeros(n, bool)
    if open_f > 0.001:
        ra = 0.97 * open_f
        poly = np.cos(math.pi / IRIS_BLADES) / np.cos(((psi - turn) % (2 * math.pi / IRIS_BLADES)) - math.pi / IRIS_BLADES)
        hole = ins & (q < ra * poly)
        # the bay: the view ray goes in along -n; scaled so the walls are the unit ellipse cylinder x ra
        V = VP
        vs, vt, vn = V @ IRIS_E, V @ IRIS_NN, V @ IRIS_N
        ks, kt = vs / vn / IRIS_SA, vt / vn / IRIS_SB
        A2 = ks * ks + kt * kt + 1e-9
        B2 = -2 * (us * ks + ut * kt)
        C2 = us * us + ut * ut - ra * ra
        disc = np.clip(B2 * B2 - 4 * A2 * C2, 0, None)
        dw = (-B2 + np.sqrt(disc)) / (2 * A2)      # depth (globe radii) where the ray meets the wall
        depth_max = 0.11
        bottom = dw > depth_max
        dn = np.clip(dw / depth_max, 0, 1)
        wpsi = np.arctan2(ut - dw * kt, us - dw * ks)
        rib = np.abs(((wpsi / (2 * math.pi) * 40) % 1) - 0.5) < 0.12
        ringl = np.abs(((dw / 0.022) % 1) - 0.5) < 0.08
        wall_L = (0.34 - 0.24 * dn) * np.where(rib, 0.6, 1.0)
        # the floor: berths in two rows along the bay, each a lit pad outline; docked transports on some; light strips
        fs = (us - depth_max * ks) * IRIS_SA        # floor coords (globe radii)
        ft = (ut - depth_max * kt) * IRIS_SB
        bw, bh = 0.034, 0.03
        ci = np.floor(fs / bw)
        cj = np.floor(ft / bh)
        u_, v_ = fs / bw - ci, ft / bh - cj
        pad_edge = (np.abs(u_ - 0.5) > 0.4) | (np.abs(v_ - 0.5) > 0.38)
        rnd = np.abs(np.sin(ci * 12.9898 + cj * 78.233) * 43758.5453) % 1
        docked = (rnd < 0.45) & (np.abs(u_ - 0.5) < 0.3) & (np.abs(v_ - 0.5) < 0.22)
        strip = np.abs(v_ - 0.02) < 0.04
        floor_L = np.where(docked, 0.55, np.where(pad_edge, 0.2, 0.3))
        Lh = np.where(bottom, floor_L, wall_L)
        L = np.where(hole, Lh, L)
        M[:, hole] = 0
        M[MI['mach'], hole & ~(bottom & docked)] = 1
        M[MI['pale'], hole & bottom & docked] = 1
        ring_e = hole & ~bottom & ringl & ~rib
        E[ring_e] += (np.array([0.75, 0.88, 1.0])[None, :] * (1 - 0.6 * dn[ring_e])[:, None]) * 0.95
        bay = hole & bottom
        padl = bay & pad_edge & ~strip
        E[padl] += np.array([1.0, 0.8, 0.45]) * 0.75
        E[bay & strip] += np.array([0.8, 0.9, 1.0]) * 0.9
        E[bay & docked & (np.abs(u_ - 0.5) > 0.25)] += np.array([1.0, 0.95, 0.85]) * 0.8
        E[bay] += np.array([1.0, 0.75, 0.45]) * 0.12
        lip = ins & ~hole & (q < ra * poly + 0.05)
        E[lip] += np.array([1.0, 0.85, 0.6]) * 0.35
        sa = np.where(hole, 0.0, sa)
        sb = np.where(hole, 0.0, sb)
    return w, L, M, E, sa, sb, hole, (us, ut, q, psi)


# ---------------------------------------------------------------------------------------------------------------
# Shading
# ---------------------------------------------------------------------------------------------------------------

FILL_S = np.array([0.55, 0.45, -0.35])   # a faint cool fill from the lower right / behind (the night side keeps its form)
FILL_P = np.array(view_to_planet(*unlean(FILL_S[0], -FILL_S[1]), FILL_S[2]))
FILL_P = FILL_P / np.linalg.norm(FILL_P)
FILL_COL = np.array([0.55, 0.65, 0.85])
KEY_COL = np.array([1.0, 0.97, 0.92])
BUMP = 0.22      # how much the kitbash's relief (the pieces' lift and their own light) tilts the normals


def ramp_albedo(L, M):
    """Albedo of procedural parts (the iris, its collar): the materials through their ramps; and their gloss."""
    n = L.shape[0]
    alb = np.zeros((n, 3))
    tot = np.zeros(n)
    gl = np.zeros(n)
    for k, m in enumerate(MATS):
        w = M[k]
        if not np.any(w > 1e-4):
            continue
        alb += ramp(m, L) * w[:, None]
        gl += w * GLOSS[m][0]
        tot += w
    alb = np.where(tot[:, None] > 1e-4, alb / np.maximum(tot, 1e-4)[:, None], ramp('mach', L))
    return alb, gl / np.maximum(tot, 1e-4)


def shade(C, N, shadow, ao=1.0, gloss=0.16):
    """The painted colour of surface points lit: the key light (diffuse, a broad dull sheen on the metal), the cool fill.
    C (n, 3), N (3, n) planet frame, shadow / ao / gloss (n,) or scalars."""
    nd = N[0] * LP[0] + N[1] * LP[1] + N[2] * LP[2]
    diff = np.clip(nd, 0, 1) * shadow
    nh = np.clip(N[0] * HP[0] + N[1] * HP[1] + N[2] * HP[2], 0, 1)
    lum = C @ LUM
    spec = gloss * (nh ** 22) * shadow * (nd > 0) * (0.35 + lum)
    fill = np.clip(N[0] * FILL_P[0] + N[1] * FILL_P[1] + N[2] * FILL_P[2], 0, 1)
    amb = (0.05 + 0.08 * fill)[:, None] * FILL_COL[None, :] * np.reshape(ao, (-1, 1))
    return C * 1.38 * (amb + 1.7 * (diff ** 0.8)[:, None] * KEY_COL[None, :]) + spec[:, None] * KEY_COL[None, :]


def normalize3(N):
    return N / np.maximum(np.sqrt((N * N).sum(0)), 1e-9)


def render(gm, strips, iris_open=0.0, box=None, chunk=160):
    """The whole Ark at the build resolution (or `box` = (y0, y1, x0, x1) of it): straight colour, coverage, the
    emission layers (hab, band, engine, iris), the deck's occlusion / shadow masks, the surface ids, the iris weight and
    the hit points."""
    Nb = FRAME * SS
    y0, y1, x0, x1 = box if box is not None else (0, Nb, 0, Nb)
    h, w = y1 - y0, x1 - x0
    out = {k: np.zeros((h, w, 3), F32) for k in ('col', 'hab', 'band', 'eng', 'iris')}
    for k in ('A', 'occ', 'dsh', 'irisw'):
        out[k] = np.zeros((h, w), F32)
    out['sid'] = np.zeros((h, w), np.int8)
    out['P'] = np.zeros((h, w, 3), F32)
    for cy in range(y0, y1, chunk):
        cy1 = min(y1, cy + chunk)
        yy, xx = np.mgrid[cy:cy1, x0:x1].astype(np.float64) + 0.5
        xs = (xx.ravel() / SS - C0) / RPX
        ys = -(yy.ravel() / SS - C0) / RPX
        x, y = unlean(xs, ys)
        sid, z, (X, Y, Z), deck_z = cast(x, y)
        n = x.shape[0]
        C = np.zeros((n, 3))
        Nn = np.zeros((3, n))
        sh = np.ones(n)
        ao = np.ones(n)
        gl = np.full(n, 0.16)
        Eh = np.zeros((n, 3))
        Eb = np.zeros((n, 3))
        Ee = np.zeros((n, 3))
        Ei = np.zeros((n, 3))
        Ed = np.zeros((n, 3))
        irw = np.zeros(n)
        lon = np.arctan2(X, Z)
        # --- the globe
        g = sid == S_GLOBE
        if g.any():
            Xg, Yg, Zg = X[g], Y[g], Z[g]
            la = np.arcsin(np.clip(Yg, -1, 1))
            lo = lon[g]
            Cs, Es, _, Ds, gx, gy = kit_sample(gm, (lo + math.pi) * gm.ppr, (math.pi / 2 - la) * gm.ppr)
            k = RPX / gm.ppr
            cl = np.maximum(np.cos(la), 0.05)
            se_ = gx / (cl * k) * BUMP
            sn_ = -gy / k * BUMP
            Te = np.stack([np.cos(lo), 0 * lo, -np.sin(lo)])
            Tn = np.stack([-np.sin(la) * np.sin(lo), np.cos(la), -np.sin(la) * np.cos(lo)])
            P = np.stack([Xg, Yg, Zg])
            ptilt, ptone, pseam, prim = plates_at(P)
            C[g] = Cs * Ds[:, None] * (ptone * (1 - 0.6 * pseam) * (1 + 0.3 * prim))[:, None]
            Ng = P - se_[None] * Te - sn_[None] * Tn + ptilt
            # the polar cap from its own kit (x along lon 90, y along lon 180 from the pole)
            wp = sstep(POLE_BLEND[0], POLE_BLEND[1], la)
            if np.any(wp > 0):
                pk = gm.pole
                rr = (math.pi / 2 - la) * gm.ppr
                Cp, Ep, _, Dp, gxp, gyp = kit_sample(pk, pk.c + rr * np.sin(lo), pk.c - rr * np.cos(lo))
                Cs2 = Cp * Dp[:, None]
                C[g] = C[g] * (1 - wp)[:, None] + Cs2 * wp[:, None]
                Es = Es * (1 - wp)[:, None] + Ep * wp[:, None]
                # the cap kit's gradient: x is east at lon 90; turned into the local east / north at each point
                ge = (gxp * np.cos(lo) + gyp * np.sin(lo))
                gn = (gxp * np.sin(lo) - gyp * np.cos(lo))
                Ng = Ng * (1 - wp) + (P - (ge * BUMP / k)[None] * Te - (gn * BUMP / k)[None] * Tn) * wp
            Nn[:, g] = normalize3(Ng)
            Eh[g] = Es
            sh[g] = (1 - in_ring_shadow(Xg, Yg, Zg) * 0.92) * (1 - in_band_shadow(Xg, Yg, Zg) * 0.85)
            ao[g] = 1 - 0.55 * np.exp(-np.clip(np.abs(Yg) - BAND[0][1], 0, None) / 0.018)
        # --- the band zones
        for kz in (0, 1):
            m = sid == (S_BANDA + kz)
            if not m.any():
                continue
            st = strips[kz]
            rb, hb = BAND[kz]
            lo = lon[m]
            Cs, Es, E2s, Ds, gx, gy = kit_sample(st, (lo + LON_VIS) * st.kpx, (hb - Y[m]) * RPX)
            P = np.stack([X[m], Y[m], Z[m]]) / rb
            Te = np.stack([np.cos(lo), 0 * lo, -np.sin(lo)])
            Tn = np.stack([0 * lo, np.ones_like(lo), 0 * lo])
            Ng = P - (gx * BUMP)[None] * Te + (gy * BUMP)[None] * Tn
            Cz = Cs * Ds[:, None]
            glz = np.full(int(m.sum()), 0.16)
            shz = 1 - in_ring_shadow(X[m], Y[m], Z[m]) * 0.92
            if kz == 1:
                # the docking iris (the hangar mouth) in the engine deck: its parts painted through the ramps, the
                # deck's own paint showing through as wear
                wI, LI, MI_, EI, sa, sb, hole, _ = iris_fields(X[m], Y[m], Z[m], iris_open)
                irw[m] = wI
                if np.any(wI > 0):
                    alb, gli = ramp_albedo(LI, MI_)
                    wear = 0.7 + 0.6 * np.clip(Cs @ LUM, 0, 1)
                    alb = alb * np.where(hole, 1.0, wear)[:, None]
                    Cz = Cz * (1 - wI)[:, None] + alb * wI[:, None]
                    glz = glz * (1 - wI) + gli * wI
                    Es = Es * (1 - wI)[:, None]
                    E2s = E2s * (1 - wI)[:, None]
                    Ei[m] = EI * wI[:, None]
                    Ng = P - ((gx * BUMP * (1 - wI)) + sa * wI)[None] * Te + ((gy * BUMP * (1 - wI)) - sb * wI)[None] * Tn
                    shz = np.where(hole, 0.45, shz)
                Ee[m] = E2s
            Eb[m] = Es
            C[m], Nn[:, m], sh[m], gl[m] = Cz, normalize3(Ng), shz, glz
        # --- the band's top steps (flat, facing north)
        for kz in (0, 1):
            m = sid == (S_WALLA + kz)
            if not m.any():
                continue
            st = strips['wall%d' % kz]
            rho = np.sqrt(X[m] ** 2 + Z[m] ** 2)
            Cs, Es, _, Ds, gx, gy = kit_sample(st, (lon[m] + LON_VIS) * st.kpx, (rho - st.r_in) * RPX)
            C[m] = Cs * Ds[:, None]
            Nn[:, m] = np.array([0.0, 1.0, 0.0])[:, None]
            sh[m] = 1 - in_ring_shadow(X[m], Y[m], Z[m]) * 0.92
            Eb[m] = Es
        # --- the ring's deck (flat; the runtime turns it)
        m = sid == S_DECK
        if m.any():
            st = strips['deck']
            rho = np.sqrt(X[m] ** 2 + Z[m] ** 2)
            ang = np.mod(lon[m], 2 * math.pi)
            Cs, Es, _, Ds, gx, gy = kit_sample(st, ang * st.kpx, (RING_O - rho) * RPX)
            C[m] = Cs * Ds[:, None]
            Nn[:, m] = np.array([0.0, 1.0, 0.0])[:, None]
            sh[m] = 1 - in_globe_shadow(X[m], Y[m], Z[m]) * 0.95
            Ed[m] = Es
        # --- the rim (the ring's stationary walls)
        for (key, s_id, sign) in (('rimo', S_RIMO, 1.0), ('rimi', S_RIMI, -1.0)):
            m = sid == s_id
            if not m.any():
                continue
            st = strips[key]
            rho = np.sqrt(X[m] ** 2 + Z[m] ** 2)
            ang = np.mod(lon[m], 2 * math.pi)
            Cs, Es, _, Ds, gx, gy = kit_sample(st, ang * st.kpx, (RING_H - Y[m]) * RPX)
            C[m] = Cs * Ds[:, None]
            Nn[:, m] = np.stack([sign * X[m] / rho, 0 * rho, sign * Z[m] / rho])
            sh[m] = 1 - in_globe_shadow(X[m], Y[m], Z[m]) * 0.95
            Eb[m] = Es
            if key == 'rimo':
                nav = (np.abs(((ang / math.radians(30)) % 1) - 0.5) > 0.497) & (np.abs(Y[m]) < RING_H * 0.5)
                Eb[m] += nav[:, None] * np.array([1.0, 0.15, 0.1]) * 1.0
        # --- the spokes
        m = sid == S_SPOKE
        if m.any():
            Xs, Ys, Zs = X[m], Y[m], Z[m]
            Nsp = np.zeros((3, int(m.sum())))
            along = np.zeros_like(Xs)
            around = np.zeros_like(Xs)
            dmin = np.full_like(Xs, np.inf)
            for ph in SPOKES:
                a = np.array([math.sin(ph), 0.0, math.cos(ph)])
                pa = Xs * a[0] + Zs * a[2]
                q = np.stack([Xs - pa * a[0], Ys, Zs - pa * a[2]])
                d = np.sqrt((q * q).sum(0))
                sel = d < dmin
                dmin = np.where(sel, d, dmin)
                Nsp[:, sel] = (q / np.maximum(d, 1e-9))[:, sel]
                along = np.where(sel, pa, along)
                side = np.array([a[2], 0.0, -a[0]])
                around = np.where(sel, np.arctan2(q[1], q[0] * side[0] + q[2] * side[2]), around)
            st = strips['spoke']
            Cs, Es, _, Ds, gx, gy = kit_sample(st, (along - BAND[1][0]) * RPX + 4, (around / (2 * math.pi) % 1) * st.h)
            C[m] = Cs * Ds[:, None]
            Nn[:, m] = Nsp
            sh[m] = (1 - in_globe_shadow(Xs, Ys, Zs) * 0.95) * (1 - in_ring_shadow(Xs, Ys, Zs) * 0.9)
            Eb[m] = Es
        hit = sid > 0
        col = np.zeros((n, 3))
        if hit.any():
            col[hit] = shade(C[hit], Nn[:, hit], sh[hit], ao[hit], gl[hit])
        col += Ed
        r0 = cy - y0
        rs = slice(r0, r0 + (cy1 - cy))
        rh = cy1 - cy
        out['col'][rs] = col.reshape(rh, w, 3)
        out['A'][rs] = hit.reshape(rh, w)
        out['hab'][rs] = Eh.reshape(rh, w, 3)
        out['band'][rs] = Eb.reshape(rh, w, 3)
        out['eng'][rs] = Ee.reshape(rh, w, 3)
        out['iris'][rs] = Ei.reshape(rh, w, 3)
        out['sid'][rs] = sid.reshape(rh, w)
        out['irisw'][rs] = irw.reshape(rh, w)
        out['P'][rs] = np.stack([X, Y, Z], -1).reshape(rh, w, 3)
        occ = np.isfinite(deck_z) & (sid != S_DECK) & (sid > 0)
        out['occ'][rs] = occ.reshape(rh, w)
        dsh = np.zeros(n)
        md = sid == S_DECK
        if md.any():
            dsh[md] = in_globe_shadow(X[md], Y[md], Z[md])
        out['dsh'][rs] = dsh.reshape(rh, w)
    return out


def tone(c):
    """A soft shoulder over 0.75 (the lights and the highlights roll off instead of clipping)."""
    k = 0.75
    over = np.clip(c - k, 0, None)
    return np.where(c > k, k + over / (1 + over / (1 - k)), c)


def compose_base(r, hab=0.4, band=0.4, eng=0.3):
    col = r['col'] + hab * r['hab'] + band * r['band'] + eng * r['eng'] + r['iris']
    return tone(col), r['A']


def to_frame(col, A, W=None, H=None, sharpen=0.3):
    """Build px straight colour + coverage down to frame px (premultiplied Lanczos, a light unsharp mask), RGBA8."""
    H = H or int(round(A.shape[0] / SS))
    W = W or int(round(A.shape[1] / SS))
    a = np.clip(gw.down(A, W, H), 0, 1)
    rgb = np.stack([gw.down(col[..., k] * A, W, H) for k in range(3)], -1) / np.maximum(a, 1e-4)[..., None]
    rgb = np.where(a[..., None] > 1e-3, rgb, 0)
    if sharpen > 0:
        rgb = gw.unsharp(rgb, sharpen)
    res = np.zeros((H, W, 4), np.uint8)
    res[..., :3] = np.round(np.clip(rgb, 0, 1) * 255)
    res[..., 3] = np.round(a * 255)
    return res


# ---------------------------------------------------------------------------------------------------------------
# The runtime layers
# ---------------------------------------------------------------------------------------------------------------

def render_deck(strips):
    """The turning deck in its own plane (texture px = frame px; X right, Z down = toward the viewer), lit as it is
    at the top of the ring (flat, unshadowed: the occluder lays the globe's shadow over it), its lights included."""
    kpx = RPX * SS
    Db = int(math.ceil(2 * RING_O * kpx / (2 * SS))) * 2 * SS + 4 * SS
    col = np.zeros((Db, Db, 3), F32)
    A = np.zeros((Db, Db), F32)
    st = strips['deck']
    for r0 in range(0, Db, 256):
        r1 = min(Db, r0 + 256)
        yy, xx = np.mgrid[r0:r1, 0:Db].astype(np.float64) + 0.5
        X = (xx - Db / 2) / kpx
        Z = (yy - Db / 2) / kpx
        rho = np.sqrt(X * X + Z * Z)
        m = (rho >= RING_I) & (rho <= RING_O)
        if not m.any():
            continue
        ang = np.mod(np.arctan2(X[m], Z[m]), 2 * math.pi)
        Cs, Es, _, Ds, _, _ = kit_sample(st, ang * st.kpx, (RING_O - rho[m]) * RPX)
        n = int(m.sum())
        N = np.zeros((3, n))
        N[1] = 1
        c = shade(Cs * Ds[:, None], N, np.ones(n)) + Es
        blk = np.zeros((r1 - r0, Db, 3))
        blk[m] = c
        col[r0:r1] = blk
        A[r0:r1] = m
    return tone(col), A, Db // SS


def glow_layer(E, A, scale=2, halo=2.2, gain=1.0):
    """An additive glow layer (straight RGBA: colour, alpha = brightness) at 1/scale of the frame: the emission brought
    down, a soft halo round it."""
    W = FRAME // scale
    ed = np.stack([np.clip(gw.down(E[..., k] * A, W, W), 0, None) for k in range(3)], -1) * gain
    hl = np.stack([gw.fblur(ed[..., k], halo) for k in range(3)], -1) * 1.3
    tot = np.clip(np.maximum(ed, hl), 0, 1)
    a = tot.max(2)
    rgb = np.where(a[..., None] > 1e-3, tot / np.maximum(a, 1e-3)[..., None], 0)
    res = np.zeros((W, W, 4), np.uint8)
    res[..., :3] = np.round(np.clip(rgb, 0, 1) * 255)
    res[..., 3] = np.round(np.clip(a, 0, 1) * 255)
    return res


def bbox_of(a, pad=2, mult=1):
    ys, xs = np.nonzero(a)
    if len(ys) == 0:
        return (0, 0, 1, 1)
    y0, y1 = max(0, ys.min() - pad), min(a.shape[0], ys.max() + pad + 1)
    x0, x1 = max(0, xs.min() - pad), min(a.shape[1], xs.max() + pad + 1)
    if mult > 1:
        y0, x0 = y0 // mult * mult, x0 // mult * mult
        y1, x1 = -(-y1 // mult) * mult, -(-x1 // mult) * mult
    return (y0, y1, x0, x1)


def hangar_point(us, ut):
    """The engine-deck point at the hangar's normalised coords (planet frame)."""
    rb = BAND[1][0]
    lo = IRIS_LON + us * IRIS_SA / rb
    return np.array([rb * math.sin(lo), max(-BAND[1][1], min(BAND[1][1], ut * IRIS_SB)), rb * math.cos(lo)])


def iris_box():
    """The iris atlas frames' box (build px, a multiple of SS): round the hangar's apron as seen."""
    pts = []
    for k in range(64):
        ps = 2 * math.pi * k / 64
        fx, fy, _ = planet_to_frame(*hangar_point(1.68 * math.cos(ps), 1.68 * math.sin(ps)))
        pts.append((fx, fy))
    pts = np.array(pts) * SS
    x0, y0 = np.floor(pts.min(0) / SS - 3).astype(int) * SS
    x1, y1 = np.ceil(pts.max(0) / SS + 3).astype(int) * SS
    return (int(y0), int(y1), int(x0), int(x1))


IRIS_FRAMES = 12    # the atlas: the iris opening (the base frame holds it shut), equal steps to fully open


def iris_atlas(sm, strips):
    box = iris_box()
    y0, y1, x0, x1 = box
    frames = []
    for k in range(1, IRIS_FRAMES + 1):
        o = k / IRIS_FRAMES
        r = render(sm, strips, o, box=box)
        col, _ = compose_base(r)
        w = np.clip(r['irisw'], 0, 1) * (r['sid'] == S_BANDB)
        frames.append(to_frame(col, w))
    fh, fw = frames[0].shape[:2]
    cols = 4
    rows = -(-len(frames) // cols)
    atlas = np.zeros((rows * (fh + 2), cols * (fw + 2), 4), np.uint8)
    for i, f in enumerate(frames):
        r_, c_ = divmod(i, cols)
        atlas[r_ * (fh + 2):r_ * (fh + 2) + fh, c_ * (fw + 2):c_ * (fw + 2) + fw] = f
    return atlas, (x0 // SS, y0 // SS, fw, fh, cols)


def occluder(r):
    """The frame's pixels in front of the deck (the globe, the band, the spokes where the deck passes behind them),
    and the globe's shadow on the deck (black, as alpha): drawn over the turning deck."""
    occ = r['occ'] * (r['sid'] != S_DECK)
    col, _ = compose_base(r)
    a_occ = occ
    sh = r['dsh'] * 0.9 * (r['sid'] == S_DECK)
    # the deck's own AA fringe: the deck coverage
    res_occ = to_frame(col, a_occ, sharpen=0.0)
    shadow = np.clip(gw.down(sh, FRAME, FRAME), 0, 1)
    a = res_occ[..., 3].astype(np.float64) / 255
    out_a = a + shadow * (1 - a)
    rgb = res_occ[..., :3].astype(np.float64) * a[..., None] / np.maximum(out_a, 1e-4)[..., None]
    res = np.zeros_like(res_occ)
    res[..., :3] = np.round(np.clip(rgb, 0, 255))
    res[..., 3] = np.round(np.clip(out_a, 0, 1) * 255)
    y0, y1, x0, x1 = bbox_of(res[..., 3] > 0, pad=2)
    return res[y0:y1, x0:x1], (x0, y0)


# --- damage (while the shields are broken) ---

DAMAGE_SITES = [  # (lat, lon, angular radius) on the globe's near face; the biggest first
    (24.0, 18.0, 0.13), (52.0, -58.0, 0.095), (8.0, -38.0, 0.085), (64.0, 30.0, 0.08), (-22.0, 30.0, 0.09),
    (30.0, 52.0, 0.07), (44.0, 2.0, 0.055),
]


def damage_overlay(r, rng):
    """The scorched and breached hull: a soot bloom round each hit (ragged, streaked outward), a heat-tinted ring, and
    at the heart of the bigger ones a torn crater (black depths, girders across it) with a molten rim; RGBA over the
    base, and the fires (the molten rims' light) as a glow layer the runtime flickers."""
    P = r['P']
    g = r['sid'] == S_GLOBE
    Nb = P.shape[0]
    alpha = np.zeros((Nb, Nb), F32)
    col = np.zeros((Nb, Nb, 3), F32)
    fire = np.zeros((Nb, Nb, 3), F32)
    sites = []
    for k, (la, lo, rad) in enumerate(DAMAGE_SITES):
        la, lo = math.radians(la), math.radians(lo)
        c = np.array([math.cos(la) * math.sin(lo), math.sin(la), math.cos(la) * math.cos(lo)])
        e = np.array([math.cos(lo), 0.0, -math.sin(lo)])
        nn = np.cross(c, e)
        fx, fy, fz = planet_to_frame(*c)
        sites.append((fx, fy, rad * RPX, c))
        # the pixels near this hit only
        cx, cy = int(fx * SS), int(fy * SS)
        rr = int(3.5 * rad * RPX * SS) + 4
        y0, y1, x0, x1 = max(0, cy - rr), min(Nb, cy + rr), max(0, cx - rr), min(Nb, cx + rr)
        sl = (slice(y0, y1), slice(x0, x1))
        gm = g[sl]
        Pp = P[sl].astype(np.float64)
        Pp = np.where(gm[..., None], Pp, 0.0)
        X, Y, Z = Pp[..., 0], Pp[..., 1], Pp[..., 2]
        dot = np.clip(X * c[0] + Y * c[1] + Z * c[2], -1, 1)
        d = np.where(gm, np.arccos(dot), 9.0) / rad
        a = X * e[0] + Y * e[1] + Z * e[2]
        b = X * nn[0] + Y * nn[1] + Z * nn[2]
        ang = np.arctan2(b, a)
        nz = noise3(seeded('dmg%d' % k), 12, 28.0)(Pp)
        nz2 = noise3(seeded('dmgf%d' % k), 14, 90.0)(Pp)
        dj = d * (0.72 + 0.45 * nz + 0.18 * nz2)
        streak = (np.abs(np.sin(ang * 7 + k * 1.7 + 2 * nz)) ** 6) * sstep(3.3, 0.8, d) * 0.75
        soot = np.clip(np.maximum(sstep(2.9, 0.3, dj) ** 0.8 * 0.97, streak), 0, 0.97)
        c_new = np.zeros(d.shape + (3,), F32)
        c_new[...] = np.array([0.018, 0.015, 0.013], F32)
        heat = sstep(1.25, 0.8, dj) * sstep(0.45, 0.75, dj)
        c_new += heat[..., None] * np.array([0.16, 0.09, 0.04], F32)
        big = k < 5
        a_new = soot
        if big:
            crater = dj < 0.5
            gird = crater & ((np.abs(((a / (rad * 0.14)) % 1) - 0.5) < 0.08) | (np.abs(((b / (rad * 0.19)) % 1) - 0.5) < 0.07)) & (nz2 > 0.35)
            c_new[crater] = np.array([0.008, 0.007, 0.006], F32)
            c_new[gird] = np.array([0.2, 0.17, 0.14], F32)
            hot = sstep(0.68, 0.5, dj) * sstep(0.36, 0.5, dj) * (0.6 + 0.6 * nz2)
            molten = np.array([1.0, 0.42, 0.1], F32)
            c_new = c_new * (1 - np.clip(hot, 0, 1)[..., None]) + molten * np.clip(hot, 0, 1)[..., None]
            a_new = np.where(dj < 0.68, 1.0, a_new)
            f = (np.clip(hot, 0, 1) + 0.25 * sstep(0.5, 0.2, dj) * (gird == 0) * crater)[..., None] * np.array([1.0, 0.5, 0.15], F32)
            fire[sl] = np.maximum(fire[sl], f * gm[..., None])
        upd = gm & (a_new > alpha[sl])
        col[sl][upd] = c_new[upd]
        alpha[sl][upd] = a_new[upd]
    res = to_frame(col, alpha, sharpen=0.0)
    y0, y1, x0, x1 = bbox_of(res[..., 3] > 0, pad=2)
    glow = glow_layer(fire, g.astype(F32), gain=1.4, halo=2.5)
    return res[y0:y1, x0:x1], (x0, y0), sites, glow


# --- small textures ---

def tex_shield(size=640, cells=1400):
    """The shield bubble: a mesh of hexagonal cells (the Voronoi cells of a Fibonacci sphere: hexagons with a few
    pentagons) over a sphere seen from outside, faint over the face and bright at the limb (fresnel), pale cyan."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float64) + 0.5
    x = (xx - size / 2) / (size / 2 - 2)
    y = (yy - size / 2) / (size / 2 - 2)
    r2 = x * x + y * y
    inside = r2 < 1
    z = np.sqrt(np.clip(1 - r2, 0, None))
    k = np.arange(cells) + 0.5
    phi = np.arccos(1 - 2 * k / cells)
    th = math.pi * (1 + 5 ** 0.5) * k
    pts = np.stack([np.cos(th) * np.sin(phi), np.cos(phi), np.sin(th) * np.sin(phi)], -1)
    V = np.stack([x[inside], -y[inside], z[inside]], -1)
    edge = np.zeros(V.shape[0])
    for c0 in range(0, V.shape[0], 20000):
        d = V[c0:c0 + 20000] @ pts.T
        top2 = -np.partition(-d, 1, axis=1)[:, :2]
        edge[c0:c0 + 20000] = top2[:, 0] - top2[:, 1]
    line = np.zeros(size * size)
    line[inside.ravel()] = sstep(0.0014, 0.0003, edge)
    line = line.reshape(size, size)
    fres = np.clip(r2, 0, 1) ** 3
    a = inside * (0.02 + 0.5 * fres + 0.45 * line * (0.2 + 0.8 * fres)) * sstep(1.0, 0.985, np.sqrt(r2))
    res = np.zeros((size, size, 4), np.uint8)
    res[..., 0] = 140
    res[..., 1] = 215
    res[..., 2] = 255
    res[..., 3] = np.round(np.clip(a, 0, 1) * 255)
    res[res[..., 3] < 4] = 0
    return res


def tex_beam(w=256, h=128):
    """The tractor beam: a cone from its apex (left edge, middle) widening out to the right, fading with length;
    faint bands across it (the runtime slides it)."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64) + 0.5
    t = xx / w
    half = 0.08 + 0.92 * t
    d = np.abs(yy - h / 2) / (h / 2) / half
    core = np.exp(-(d / 0.35) ** 2) * 0.6 + np.exp(-(d / 0.9) ** 2) * 0.4
    a = core * (1 - t) ** 1.2 * sstep(0.0, 0.06, t) * (0.8 + 0.2 * np.cos(t * 40) ** 2)
    res = np.zeros((h, w, 4), np.uint8)
    res[..., 0], res[..., 1], res[..., 2] = 175, 220, 255
    res[..., 3] = np.round(np.clip(a, 0, 1) * 255)
    res[res[..., 3] < 4] = 0
    return res


def tex_plume(w=256, h=64):
    """An engine plume: hot white at the nozzle (left edge) through orange to nothing, streaky."""
    rng = seeded('plume')
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64) + 0.5
    t = xx / w
    d = np.abs(yy - h / 2) / (h / 2)
    wid = 0.35 + 0.65 * t ** 0.6
    n = gw.fbm(rng, h, w, 12, 3)
    a = np.exp(-(d / wid / 0.55) ** 2) * (1 - t) ** 1.6 * (0.75 + 0.5 * n)
    hot = np.clip(1 - t * 2.2, 0, 1)
    rgb = np.stack([np.ones_like(t), 0.55 + 0.4 * hot, 0.25 + 0.7 * hot ** 2], -1)
    res = np.zeros((h, w, 4), np.uint8)
    res[..., :3] = np.round(np.clip(rgb, 0, 1) * 255)
    res[..., 3] = np.round(np.clip(a, 0, 1) * 255)
    res[res[..., 3] < 4] = 0
    return res


def tex_smoke(size=64):
    rng = seeded('smoke')
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float64) + 0.5
    d = np.hypot(xx - size / 2, yy - size / 2) / (size / 2)
    n = gw.fbm(rng, size, size, 8, 3)
    a = np.clip(1 - d, 0, 1) ** 1.5 * (0.5 + 0.7 * n) * 0.8
    res = np.zeros((size, size, 4), np.uint8)
    g = 0.42 + 0.12 * n
    res[..., 0] = np.round(g * 255)
    res[..., 1] = np.round(g * 0.95 * 255)
    res[..., 2] = np.round(g * 0.9 * 255)
    res[..., 3] = np.round(np.clip(a, 0, 1) * 255)
    res[res[..., 3] < 4] = 0
    return res


# ---------------------------------------------------------------------------------------------------------------
# The light table (frame px) and the build
# ---------------------------------------------------------------------------------------------------------------

def front_most(fx, fy, sids, z_of):
    """Whether a point at frame px (fx, fy) with view depth z_of is what the frame shows there (within its surfaces)."""
    xs = np.array([(fx - C0) / RPX])
    ys = np.array([-(fy - C0) / RPX])
    x, y = unlean(xs, ys)
    sid, z, _, _ = cast(x, y)
    return int(sid[0]) in sids and z[0] <= z_of + 0.004


def screen_dir(X, Y, Z):
    x, y, z = planet_to_view(X, Y, Z)
    xs, ys = relean(x, y)
    return xs, -ys, z


def light_table(strips, sites):
    rb2 = BAND[1][0]
    eng = []
    for lon in strips[1].engines:
        P = (rb2 * math.sin(lon), 0.0, rb2 * math.cos(lon))
        fx, fy, fz = planet_to_frame(*P)
        if not front_most(fx, fy, (S_BANDB,), fz):
            continue
        dx, dy, dz = screen_dir(math.sin(lon), 0.0, math.cos(lon))
        eng.append((fx, fy, dx, dy, dz))
    tur = []
    rA, hA = BAND[0]
    r_in, r_out = math.sqrt(1 - hA * hA), math.sqrt(rA * rA - hA * hA)
    for k in range(72):
        lon = (k + 0.5) * math.radians(5.0)
        rho = r_in + 0.35 * (r_out - r_in)
        P = (rho * math.sin(lon), hA, rho * math.cos(lon))
        fx, fy, fz = planet_to_frame(*P)
        if front_most(fx, fy, (S_WALLA,), fz):
            tur.append((fx, fy))
    for k in range(30):
        lon = k * math.radians(12.0)
        P = (rb2 * math.sin(lon), 0.05, rb2 * math.cos(lon))
        fx, fy, fz = planet_to_frame(*P)
        if front_most(fx, fy, (S_BANDB,), fz):
            tur.append((fx, fy))
    strobe = []
    for k in range(8):
        lon = k * math.radians(45) + math.radians(22.5)
        P = (RING_O * math.sin(lon), RING_H * 0.6, RING_O * math.cos(lon))
        fx, fy, fz = planet_to_frame(*P)
        if front_most(fx, fy, (S_RIMO, S_DECK), fz + 0.01):
            strobe.append((fx, fy))
    for (la, lo) in ((80, 0), (70, -40), (70, 40)):
        la, lo = math.radians(la), math.radians(lo)
        P = (math.cos(la) * math.sin(lo), math.sin(la), math.cos(la) * math.cos(lo))
        fx, fy, fz = planet_to_frame(*P)
        if front_most(fx, fy, (S_GLOBE,), fz):
            strobe.append((fx, fy))
    nav = []
    for k in range(12):
        lon = k * math.radians(30)
        P = (RING_O * math.sin(lon), 0.0, RING_O * math.cos(lon))
        fx, fy, fz = planet_to_frame(*P)
        if front_most(fx, fy, (S_RIMO,), fz):
            nav.append((fx, fy))
    cx, cy, _ = planet_to_frame(*hangar_point(0, 0))
    ex, ey, _ = planet_to_frame(*hangar_point(1, 0))
    nx_, ny_, _ = planet_to_frame(*hangar_point(0, 1))
    odx, ody, _ = screen_dir(*IRIS_N)
    lam = LEAN
    lean_d = np.array([[math.cos(lam), math.sin(lam)], [-math.sin(lam), math.cos(lam)]])
    M = lean_d @ np.array([[1.0, 0.0], [0.0, math.sin(ELEV)]])
    off = lean_d @ np.array([0.0, -RING_H * math.cos(ELEV) * RPX])
    return {
        'engines': eng, 'turrets': tur, 'strobes': strobe, 'nav': nav,
        'iris': (cx, cy, ex - cx, ey - cy, nx_ - cx, ny_ - cy, odx, ody),
        'deckM': (M[0, 0], M[0, 1], M[1, 0], M[1, 1], off[0], off[1]),
        'globe': (C0, C0, RPX), 'band': (BAND[1][0] * RPX, BAND[0][0] * RPX),
        'damage': [(x, y, r) for (x, y, r, _) in sites],
    }


ARK_REF_SIZE, ARK_VISUAL_SCALE = 4000, 7     # sim/scenario/threats/giantworks/ark.ts


def drawn_world_side(res):
    """The world units the frame's crop square spans at zoom factor 1 in game: builtObjectLayer.ts shipImageMetrics
    (content = alpha > 0 and not opaque black; the padded bbox squared) and builtObjectSizePx x arkDrawScale (for any
    hull under ARK_VISUAL_SCALE^2 x ARK_REF_SIZE: 7 sqrt(4000 x 8 x areaRatio))."""
    a = res[..., 3].astype(np.int32)
    blk = (a == 255) & (res[..., :3].max(-1) == 0)
    content = (a > 0) & ~blk
    count = int(content.sum())
    ys, xs = np.nonzero(content)
    n8 = (ys.max() + 4) - (ys.min() - 4)
    n9 = (xs.max() + 4) - (xs.min() - 4)
    side = max(n8, n9) + 1
    ar = side * side / count
    return ARK_VISUAL_SCALE * math.sqrt(ARK_REF_SIZE * 8.0 * ar)


def num(v, dp):
    """A number for the table: dp decimals at most, trailing zeros of the decimals dropped (never the integer's)."""
    t = '%.*f' % (dp, float(v))
    if '.' in t:
        t = t.rstrip('0').rstrip('.')
    return '0' if t in ('-0', '') else t


def write_lights(path, tab, meta):
    def rows(rs, dp=1):
        return ', '.join('[' + ', '.join(num(v, dp) for v in r) + ']' for r in rs)

    def tup(t, dp=3):
        return '[' + ', '.join(num(v, dp) for v in t) + ']'

    txt = ("// Generated by scripts/ark-art.py: do not edit. The Ark Engine's runtime table (threatArt.ts ArkFxLayer), frame px of\n"
           "// public/art/giantworks/ark.png (the frame's side is `frame`).\n"
           "export const ARK_LOOK = {\n"
           "    frame: %d,\n"
           "    /** World units the frame spans at zoom factor 1 in game (its drawn size: threatArt.ts greatWorkDrawPx). */\n"
           "    worldSide: %s,\n"
           "    /** The globe's centre and radius; the band's engine-deck and outer radii. */\n"
           "    globe: %s,\n    band: %s,\n"
           "    /** The engine bells seen: x, y, the bell's outward direction on screen (dx, dy: its length the share in the\n"
           "     * screen plane) and dz (how squarely it faces the viewer). */\n"
           "    engines: [%s] as readonly (readonly number[])[],\n"
           "    /** Defence turrets (x, y), warning strobes, the ring's red nav lamps. */\n"
           "    turrets: [%s] as readonly (readonly number[])[],\n"
           "    strobes: [%s] as readonly (readonly number[])[],\n"
           "    nav: [%s] as readonly (readonly number[])[],\n"
           "    /** The docking iris (the hangar mouth in the band): its centre, its mouth's half axes on screen along and across the\n"
           "     * band (x, y vectors), and the direction it faces on screen (dx, dy: its length the share in the screen plane). */\n"
           "    iris: %s,\n"
           "    /** The iris atlas (ark-iris.png): the frames' place in the frame (x, y), their size, the atlas columns, frames. */\n"
           "    irisBox: %s,\n"
           "    /** The turning deck (ark-deck.png, its own plane, `deckSide` px square): frame px = M * R(spin) * (texture px -\n"
           "     * side / 2) + (ox, oy) from the frame's centre; M = [a, b, c, d] (row-major), then ox, oy. */\n"
           "    deckSide: %d,\n    deckM: %s,\n"
           "    /** The overlays' place in the frame (x, y of their top-left): the occluder over the deck, the damage. */\n"
           "    occluder: %s,\n    damage: %s,\n"
           "    /** The hits (x, y, r) the damage shows: the sparks and the smoke come out of them. */\n"
           "    hits: [%s] as readonly (readonly number[])[],\n"
           "    /** The glow layers' scale (their px per frame px is 1 / glowScale). */\n"
           "    glowScale: %d,\n"
           "} as const;\n") % (
        FRAME, num(meta['worldSide'], 1), tup(tab['globe'], 1), tup(tab['band'], 1),
        rows([(x, y, dx, dy, dz) for (x, y, dx, dy, dz) in tab['engines']], 3),
        rows(tab['turrets']), rows(tab['strobes']), rows(tab['nav']),
        tup(tab['iris'], 2), tup(meta['irisBox'], 0), meta['deckSide'], tup(tab['deckM'], 4),
        tup(meta['occluder'], 0), tup(meta['damage'], 0), rows(tab['damage']), 2)
    with open(path, 'w') as f:
        f.write(txt)


def overlay_safe(res):
    """No faint pixels (a premultiplied read turns them into marker colours), no opaque black, no marker colours."""
    res = gw.no_faint(res)
    blk = (res[..., 3] == 255) & (res[..., :3].max(2) == 0)
    res[blk, :3] = 2
    m = (res[..., 3] > 0) & (((res[..., 0] == 0) & (res[..., 1] == 0) & (res[..., 2] == 255)) | ((res[..., 0] == 255) & (res[..., 1] == 255) & (res[..., 2] == 0)))
    res[m, 2] = np.where(res[m, 2] > 0, res[m, 2] - 1, 1)
    return res


def connected_check(res):
    """The frame is one connected structure (8-connected opaque pixels from the centre cover them all)."""
    a = res[..., 3] > 40
    seed = np.zeros_like(a)
    c = a.shape[0] // 2
    seed[c - 4:c + 4, c - 4:c + 4] = True
    body = gw.connected_to(seed, a)
    loose = int((a & ~gw.dilate(body, 1)).sum())
    return loose


def build_all(root):
    t0 = time.time()
    _ROOT[0] = root
    sm = build_map(root)
    strips = all_strips(seeded('strips'))
    print('strips', round(time.time() - t0, 1), 's', flush=True)
    r = render(sm, strips, 0.0)
    print('render', round(time.time() - t0, 1), 's', flush=True)
    made = {}
    col, A = compose_base(r)
    base = to_frame(col, A)
    loose = connected_check(base)
    print('   loose px', loose)
    made['ark'] = gw.sanitize(gw.no_faint(base))
    made['ark-glow-hab'] = glow_layer(r['hab'], r['A'], gain=0.75)
    made['ark-glow-band'] = glow_layer(r['band'], r['A'], gain=0.8)
    made['ark-glow-eng'] = glow_layer(r['eng'], r['A'], gain=1.6, halo=3.0)
    occ, occ_at = occluder(r)
    made['ark-occluder'] = occ
    dcol, dA, dside = render_deck(strips)
    made['ark-deck'] = to_frame(dcol, dA, dside, dside)
    atlas, ibox = iris_atlas(sm, strips)
    made['ark-iris'] = atlas
    print('iris', round(time.time() - t0, 1), 's', flush=True)
    dmg, dmg_at, sites, dglow = damage_overlay(r, seeded('damage'))
    made['ark-damage'] = dmg
    made['ark-glow-fire'] = dglow
    made['ark-shield'] = tex_shield()
    made['ark-beam'] = tex_beam()
    made['ark-plume'] = tex_plume()
    made['ark-smoke'] = tex_smoke()
    for k in list(made):
        if k != 'ark':
            made[k] = overlay_safe(made[k])
    tab = light_table(strips, sites)
    meta = {'worldSide': drawn_world_side(made['ark']), 'irisBox': (ibox[0], ibox[1], ibox[2], ibox[3], ibox[4], IRIS_FRAMES), 'deckSide': dside, 'occluder': occ_at, 'damage': dmg_at}
    print('built', round(time.time() - t0, 1), 's', flush=True)
    return made, tab, meta, r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dwu', default=os.path.join(GAME, 'public', 'assets', 'dwu'))
    ap.add_argument('--out', default=os.path.join(GAME, 'public', 'art', 'giantworks'))
    ap.add_argument('--lights', default=os.path.join(GAME, 'src', 'render', 'arkLights.ts'))
    ap.add_argument('--frame', type=int, default=2048)
    args = ap.parse_args()
    configure(args.frame)
    made, tab, meta, r = build_all(args.dwu)
    os.makedirs(args.out, exist_ok=True)
    for name, res in made.items():
        Image.fromarray(res, 'RGBA').save(os.path.join(args.out, name + '.png'), optimize=True)
        print(name, res.shape[1], 'x', res.shape[0])
    if args.lights:
        write_lights(args.lights, tab, meta)


if __name__ == '__main__':
    main()
