#!/usr/bin/env python3
"""The Generation Ships' own shipset (Galactic Threats add-on): "the old colony fleet", built centuries ago for a one-way
voyage. New silhouettes kitbashed from pieces of stock DW:U frames (the Human set and a few industrial families), with
strapped-on fuel tanks, bunker-slit bows and plain round engine bells, repainted as weathered gunmetal grey with
rust. Offline build step; the outputs are our derived art, committed under public/art/generation-ships/
(src/render/threatArt.ts genShipsArtUrl draws them for the generation-ship factions' hulls and the world ship), plus
the positional-light table src/render/genShipsLights.ts (threatArt.ts blinks red lamps there).

    python3 -I scripts/generation-ships-ships.py [--dwu <DW:U install>] [--out public/art/generation-ships]
        [--lights src/render/genShipsLights.ts] [--preview <dir>] [--only worldship,escort]

Reads images/units/ships/family*/<file>.png from the install (default public/assets/dwu, the symlink npm run
import-assets makes). Needs Python 3 with numpy and Pillow only. Deterministic (fixed seeds per output).

Per output frame (bow up, as the stock frames; square canvas):
1. Assembly: stock pieces (whole frames or crops; scaled, mirrored, squashed) and a few procedural parts (capsule
   tanks with straps, truss outriggers, riveted cargo boxes, bell nozzles, glass domes, the habitat rings) layered back to front, each casting a
   soft contact shadow on what is below it. Every stock piece is reduced to its shading (luminance, levelled per
   piece so the families match) and its glows are put out (dead lamps). Material masks ride along: glass (the
   world ship's garden domes), windows, nozzles, rivets / straps / slab edges (where the rust starts). Then the bow's
   bunker slits are cut in (bunker_slits): thin dark slots at fixed depths from the smoothed hull edge, so they follow
   the bow's contour, with mullions, a heavy lit brow over each and a lit lower lip. Before that each bow is
   replaced (put_prow: the sleek stock nose cut away, a blunt stepped armoured prow grown from the cut, as wide as
   the hull there) and every engine bell not tucked under the hull gets a thrust frame up into it (mount_bells).
2. Paint: the shading gradient-mapped onto a gunmetal ramp (a neutral, slightly blue grey), highlights compressed.
3. Surface (mirrored about the centre line where the structure is symmetric): plating seams, plate tones, rivet rows.
4. Age (never mirrored): replacement plates in mismatched paint (primer grey-green, red oxide, newer darker metal)
   riveted on, rust (broad blooms at seams and rivets, streaks running aft from every seam / strap / rivet line,
   rusty edges and recesses), scorch marks, grime streaks aft, dust, a few scratches and pits. Broad enough to read
   as rust-spotted grey when a frame is drawn 20-40 px tall, fine enough to look weathered up close.
5. Lights: no glow but a faint dim green in the garden domes, a faint warm light behind stretches of the slits and a
   few dim warm windows on the rings (many dead); unlit red
   lamp housings at the hull extremities (bow, wingtips, stern corners, ring edges) where threatArt.ts blinks the red
   positional lights (their frame px are written to genShipsLights.ts). Thruster marks (pure blue runs) at the aft
   rim of each engine bell, no nav-light marks, no other pixel left in either marker colour (ambientLayer.ts
   scanShipMarkers), and no opaque black (shipImageMetrics counts opaque non-black pixels).
"""
import argparse
import math
import os
import zlib

import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
LUM = np.array([0.299, 0.587, 0.114])

# Glow hue ranges (0..1) put out per source family, with the saturation above which a pixel counts as a glow.
KILL = {
    0: ([(0.02, 0.2), (0.42, 0.58)], 0.45),   # the MIL / TROOP sets' orange, amber and cyan lamps; the chrome set's cyan
    5: ([(0.42, 0.56)], 0.35),
    13: ([(0.1, 0.2), (0.45, 0.56)], 0.32),
    22: ([(0.42, 0.6)], 0.32),
    24: ([(0.42, 0.6)], 0.32),
    25: ([(0.42, 0.6), (0.1, 0.18)], 0.4),
}


# ---------------------------------------------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------------------------------------------

def box1(v, r, axis):
    if r <= 0:
        return v
    k = 2 * r + 1
    p = np.pad(v, [(r, r) if a == axis else (0, 0) for a in range(v.ndim)], mode='constant')
    c = np.cumsum(p, axis=axis)
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


def value_noise(rng, h, w, cell, stretch_y=1.0):
    cell = max(1, int(cell))
    gw = max(2, int(np.ceil(w / cell)) + 3)
    gh = max(2, int(np.ceil(h / (cell * stretch_y))) + 3)
    g = Image.fromarray((rng.random((gh, gw)) * 255).astype(np.uint8))
    big = np.asarray(g.resize((int(gw * cell), int(gh * cell * stretch_y)), Image.BICUBIC)).astype(np.float64) / 255
    return big[cell:cell + h, cell:cell + w]


def fbm(rng, h, w, cell, stretch_y=1.0, octaves=3):
    v = np.zeros((h, w))
    amp, tot = 1.0, 0.0
    for _ in range(octaves):
        v += amp * value_noise(rng, h, w, max(1, cell), stretch_y)
        tot += amp
        amp *= 0.5
        cell = max(1, cell // 2)
    return v / tot


def depth_inside(mask, n):
    """Chebyshev distance (px, capped at n) from the outside of `mask`."""
    d = np.zeros(mask.shape, np.int32)
    cur = mask.copy()
    for i in range(n):
        d[cur] = i + 1
        p = np.pad(cur, 1, constant_values=False)
        cur = cur & p[:-2, 1:-1] & p[2:, 1:-1] & p[1:-1, :-2] & p[1:-1, 2:] & p[:-2, :-2] & p[2:, 2:] & p[:-2, 2:] & p[2:, :-2]
    return d


def shift(v, dy, dx):
    out = np.zeros_like(v)
    h, w = v.shape[:2]
    ys0, ys1 = max(0, dy), min(h, h + dy)
    xs0, xs1 = max(0, dx), min(w, w + dx)
    out[ys0:ys1, xs0:xs1] = v[ys0 - dy:ys1 - dy, xs0 - dx:xs1 - dx]
    return out


def hsv(rgb):
    mx = rgb.max(2)
    mn = rgb.min(2)
    dl = np.maximum(mx - mn, 1e-6)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    hue = np.where(mx == r, ((g - b) / dl) % 6, np.where(mx == g, (b - r) / dl + 2, (r - g) / dl + 4)) / 6
    return hue, sat, mx


def run_aft(src, decay):
    """Streaks: every source value runs aft (+y), fading by `decay` per px (one-sided)."""
    out = src.copy()
    for y in range(1, out.shape[0]):
        out[y] = np.maximum(out[y], out[y - 1] * decay)
    return out


# ---------------------------------------------------------------------------------------------------------------
# 1. Pieces and assembly
# ---------------------------------------------------------------------------------------------------------------

MATS = ('glass', 'win', 'nozzle', 'rivet', 'strap', 'slab', 'tank', 'slit', 'slitzone')


class Piece:
    """Levelled shading L, alpha A, socket mask S (put-out glows) and material masks (MATS)."""

    cache = {}

    def __init__(self, L, A, S=None, mats=None):
        self.L, self.A = L, A
        self.S = np.zeros_like(L) if S is None else S
        self.mats = mats or {}

    @classmethod
    def load(cls, root, fam, name, crop=None, lo=0.03, hi=0.97):
        key = (fam, name, crop, lo, hi)
        if key in cls.cache:
            return cls.cache[key]
        img = Image.open(os.path.join(root, f'family{fam}', name + '.png')).convert('RGBA')
        if crop is not None:
            img = img.crop(crop)
        a = np.asarray(img).astype(np.float64) / 255
        rgb = a[..., :3]
        alpha = a[..., 3]
        raw = (a[..., :3] * 255).round().astype(np.int32)
        marker = ((raw[..., 0] == 0) & (raw[..., 1] == 0) & (raw[..., 2] == 255)) | ((raw[..., 0] == 255) & (raw[..., 1] == 255) & (raw[..., 2] == 0))
        hue, sat, val = hsv(rgb)
        lum = rgb @ LUM
        sock = np.zeros_like(lum, bool)
        ranges, sthr = KILL.get(fam, ([], 1.1))
        for (h0, h1) in ranges:
            sock |= (hue >= h0) & (hue <= h1) & (sat > sthr) & (val > 0.18)
        sock &= alpha > 0.5
        sock_g = np.asarray(Image.fromarray(sock.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(3))) > 0
        sock_g &= alpha > 0.3
        op = alpha > 0.6
        vals = lum[op & ~sock_g]
        p0, p1 = (np.quantile(vals, lo), np.quantile(vals, hi)) if vals.size > 50 else (0.0, 1.0)
        L = np.clip((lum - p0) / max(1e-3, p1 - p0), 0, 1)
        keep = (~sock_g & (alpha > 0.5)).astype(np.float64)
        fill = fblur(L * keep, 3.0) / np.maximum(fblur(keep, 3.0), 1e-3)
        L = np.where(sock_g, fill * 0.7 + L * 0.1, L)
        if marker.any():
            sm = fblur(L * (~marker), 1.5) / np.maximum(fblur((~marker).astype(np.float64), 1.5), 1e-3)
            L = np.where(marker, sm, L)
        bb = Image.fromarray((alpha * 255).astype(np.uint8)).getbbox()
        p = cls(L[bb[1]:bb[3], bb[0]:bb[2]], alpha[bb[1]:bb[3], bb[0]:bb[2]], sock_g[bb[1]:bb[3], bb[0]:bb[2]].astype(np.float64))
        cls.cache[key] = p
        return p

    def transformed(self, scale, rot, flipx, flipy, sx=1.0, sy=1.0):
        """Premultiplied (L·A, A, S·A, mats·A) images, scaled / rotated (deg, CCW) about the piece centre."""
        chans = [self.L * self.A, self.A, self.S * self.A] + [self.mats.get(m, np.zeros_like(self.A)) * self.A for m in MATS]
        out = []
        for ch in chans:
            im = Image.fromarray(ch.astype(np.float32), 'F')
            if flipx:
                im = im.transpose(Image.FLIP_LEFT_RIGHT)
            if flipy:
                im = im.transpose(Image.FLIP_TOP_BOTTOM)
            w, h = im.size
            nw, nh = max(1, round(w * scale * sx)), max(1, round(h * scale * sy))
            im = im.resize((nw, nh), Image.BICUBIC if scale * min(sx, sy) > 1 else Image.LANCZOS)
            if rot % 360:
                im = im.rotate(rot, resample=Image.BICUBIC, expand=True)
            out.append(np.clip(np.asarray(im).astype(np.float64), 0, None))
        out[1] = np.clip(out[1], 0, 1)
        for k in range(len(out)):
            if k != 1:
                out[k] = np.minimum(out[k], out[1])
        return out


class Canvas:
    def __init__(self, w, h=None):
        h = w if h is None else h
        self.w, self.h = w, h
        self.L = np.zeros((h, w))  # premultiplied
        self.A = np.zeros((h, w))
        self.S = np.zeros((h, w))
        self.T = np.zeros((h, w))  # per-piece tone offset
        self.M = {m: np.zeros((h, w)) for m in MATS}
        self.nozzles = []          # (x0, x1, y_bottom) of each placed bell, canvas px
        self.bell_tops = []        # (x0, x1, y_bottom, y_top)

    def put(self, piece, cx, cy, scale=1.0, rot=0, flipx=False, flipy=False, shadow=0.55, gain=1.0, tone=0.0, mirror=False,
            sx=1.0, sy=1.0, clip=None):
        """Layer a piece over the canvas centred at (cx, cy). `mirror`: also at the mirrored x. `clip`: (y0, y1) canvas
        rows the piece may cover (the front / back halves of a ring)."""
        for m in ([False, True] if mirror else [False]):
            x = self.w - cx if m else cx
            r = -rot if m else rot
            ch = piece.transformed(scale, r, flipx != m, flipy, sx, sy)
            ph, pw = ch[1].shape
            x0, y0 = int(round(x - pw / 2)), int(round(cy - ph / 2))
            sx0, sy0 = max(0, -x0), max(0, -y0)
            dx0, dy0 = max(0, x0), max(0, y0)
            dx1, dy1 = min(self.w, x0 + pw), min(self.h, y0 + ph)
            if dx1 <= dx0 or dy1 <= dy0:
                continue
            full = []
            for src in ch:
                f = np.zeros((self.h, self.w))
                f[dy0:dy1, dx0:dx1] = src[sy0:sy0 + dy1 - dy0, sx0:sx0 + dx1 - dx0]
                full.append(f)
            if clip is not None:
                keep = np.zeros((self.h, 1))
                keep[max(0, clip[0]):min(self.h, clip[1])] = 1
                full = [f * keep for f in full]
            fl, fa, fs = full[0] * gain, full[1], full[2]
            if shadow > 0:
                off = max(1, int(round(3 * scale + 1)))
                sh = fblur(shift(fa, off, off // 2), 2.0 + 1.5 * scale) * shadow
                self.L *= 1 - sh * (1 - fa)
            inv = 1 - fa
            self.L = fl + self.L * inv
            self.S = fs + self.S * inv
            self.T = fa * tone + self.T * inv
            for k, mname in enumerate(MATS):
                self.M[mname] = full[3 + k] + self.M[mname] * inv
            self.A = fa + self.A * inv

    def result(self):
        a = np.maximum(self.A, 1e-6)
        return np.clip(self.L / a, 0, 1), self.A, np.clip(self.S / a, 0, 1), self.T, {m: np.clip(v / a, 0, 1) for m, v in self.M.items()}


# --- procedural parts (shading only; painted with everything else) ---

LIGHT = np.array([-0.42, -0.55, 0.72])
LIGHT = LIGHT / np.linalg.norm(LIGHT)


def _shade(nx, ny, nz, amb=0.16, k=0.78):
    d = np.clip(nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2], 0, 1)
    return amb + k * d + 0.12 * d ** 12


_TANK_TEX = []


def capsule(w, h, bands=(), caps=(True, True), rivets=True):
    """A tank lying along y: cylinder shading across, hemispherical (or flat) ends, dark strap bands at the `bands`
    fractions of its length."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64) + 0.5
    r = w / 2
    nx = (xx - r) / r
    A = (np.abs(nx) <= 1).astype(np.float64)
    ny = np.zeros_like(nx)
    top_c, bot_c = r, h - r
    for (cap, cyc, sel) in ((caps[0], top_c, yy < top_c), (caps[1], bot_c, yy > bot_c)):
        if not cap:
            continue
        dy = (yy - cyc) / r
        inside = nx ** 2 + dy ** 2 <= 1
        A = np.where(sel, inside.astype(np.float64), A)
        ny = np.where(sel, dy, ny)
    nz = np.sqrt(np.clip(1 - nx ** 2 - ny ** 2, 0, 1))
    L = _shade(nx, ny, nz, amb=0.13, k=0.64)
    if _TANK_TEX:
        # stock plating wrapped on (kitbash detail): a segmented hull strip stretched over the tank
        st = _TANK_TEX[0]
        sh, sw = st.L.shape
        ty = (yy / h * sh * max(1.0, h / (w * 3))).astype(int) % sh
        tx = np.clip(((nx + 1) / 2 * (sw - 1)), 0, sw - 1).astype(int)
        t = np.where(st.A[ty, tx] > 0.5, st.L[ty, tx], 0.5)
        L = L * (0.62 + 0.55 * t)
    # soft alpha edge
    edge = np.clip((1 - np.sqrt(nx ** 2 + ny ** 2)) * r * 1.2, 0, 1)
    A = A * np.maximum(edge, 0.0)
    strap = np.zeros((h, w))
    riv = np.zeros((h, w))
    for f in bands:
        y = int(round(f * h))
        bw = max(2, int(round(h * 0.035)))
        strap[y:y + bw] = 1
        L[y:y + bw] *= 0.5
        if y + bw < h:
            L[y + bw] = np.minimum(1, L[y + bw] * 1.3 + 0.05)
        if y - 1 >= 0:
            L[y - 1] *= 0.75
        if rivets:
            for x in range(2, w - 2, 4):
                riv[min(h - 1, y + bw // 2), x] = 1
    return Piece(L, A, None, {'strap': strap, 'rivet': riv, 'tank': np.ones((h, w))})


def nozzle(w0, w1, h):
    """A plain round engine bell pointing aft (+y): it flares from w0 to w1, ring bands, a dark mouth at the aft rim."""
    W = int(math.ceil(max(w0, w1))) + 2
    yy, xx = np.mgrid[0:h, 0:W].astype(np.float64) + 0.5
    t = yy / h
    half = (w0 + (w1 - w0) * t ** 1.6) / 2
    nx = (xx - W / 2) / half
    A = np.clip((1 - np.abs(nx)) * half * 1.2, 0, 1)
    nz = np.sqrt(np.clip(1 - nx ** 2, 0, 1))
    L = _shade(nx, -0.2 * np.ones_like(nx), nz) * 0.85
    for f in (0.18, 0.5):
        y = int(f * h)
        L[y:y + 2] *= 0.55
        L[min(h - 1, y + 2)] = np.minimum(1, L[min(h - 1, y + 2)] * 1.25)
    # the mouth: a dark ellipse at the aft end, a lit lip below it
    my = h - max(2.0, w1 * 0.16)
    mr = w1 * 0.40
    mh = max(1.6, w1 * 0.14)
    d = ((xx - W / 2) / mr) ** 2 + ((yy - my) / mh) ** 2
    L = np.where(d < 1, 0.06 + 0.05 * (yy - my + mh) / (2 * mh), L)
    lip = (d >= 1) & (d < 1.7) & (yy > my)
    L = np.where(lip, np.minimum(1, L * 1.3 + 0.08), L)
    return Piece(L, A, None, {'nozzle': np.ones((h, W))})


def slab(w, h, rivet_step=5):
    """A flat welded armour plate: even tone, bevelled edges (lit top / left), a rivet row inset along every edge."""
    L = np.full((h, w), 0.5)
    L += np.linspace(0.04, -0.04, h)[:, None]
    L[:2, :] = 0.78
    L[:, :2] = np.maximum(L[:, :2], 0.68)
    L[-2:, :] = 0.2
    L[:, -2:] = np.minimum(L[:, -2:], 0.26)
    riv = np.zeros((h, w))
    ins = 4
    for x in range(ins, w - ins + 1, rivet_step):
        riv[ins, x] = riv[h - 1 - ins, x] = 1
    for y in range(ins, h - ins + 1, rivet_step):
        riv[y, ins] = riv[y, w - 1 - ins] = 1
    edge = np.zeros((h, w))
    edge[:2, :] = edge[-2:, :] = 1
    edge[:, :2] = edge[:, -2:] = 1
    for (y, x) in np.argwhere(riv > 0):
        L[y, x] = 0.22
        if y - 1 >= 0 and x - 1 >= 0:
            L[y - 1, x - 1] = 0.85
    return Piece(L, np.ones((h, w)), None, {'rivet': riv, 'slab': edge})


def dome(r, ribs=8, rings=2):
    """A glass garden dome: hemisphere shading, a gunmetal lattice (ribs and rings) and a rim; glass mask between."""
    s = int(math.ceil(2 * r)) + 2
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float64) + 0.5
    nx, ny = (xx - s / 2) / r, (yy - s / 2) / r
    rr = np.sqrt(nx ** 2 + ny ** 2)
    A = np.clip((1 - rr) * r * 1.2, 0, 1)
    nz = np.sqrt(np.clip(1 - rr ** 2, 0, 1))
    L = _shade(nx, ny, nz, amb=0.2, k=0.7)
    ang = np.arctan2(ny, nx)
    lat = np.zeros((s, s), bool)
    lat |= (np.abs(((ang / (2 * np.pi) * ribs) % 1) - 0.5) > 0.5 - 0.5 / max(1.0, r * 0.25)) & (rr > 0.18)
    for k in range(1, rings + 1):
        lat |= np.abs(rr - k / (rings + 1)) < 0.9 / r
    lat |= rr > 1 - 2.2 / r
    glass = (~lat).astype(np.float64)
    L = np.where(lat, L * 0.9, L)
    return Piece(L, A, None, {'glass': glass})


def girder(w, h):
    """A solid box beam across x: rounded shading across it, banded and riveted every few px (no see-through web)."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64) + 0.5
    ny = (yy - h / 2) / (h / 2)
    L = _shade(np.zeros_like(ny), ny * 0.8, np.sqrt(np.clip(1 - (ny * 0.8) ** 2, 0, 1)), amb=0.15, k=0.65)
    riv = np.zeros((h, w))
    strap = np.zeros((h, w))
    for x in range(4, w - 3, 12):
        L[:, x:x + 2] *= 0.6
        strap[:, x:x + 2] = 1
        if h >= 6:
            riv[h // 2, min(w - 1, x + 5)] = 1
    return Piece(L, np.ones((h, w)), None, {'strap': strap, 'rivet': riv})


def prow(wb, wt, h, chamfer, steps=(0.4, 0.72)):
    """An old armoured prow, bow up: `wb` wide where it meets the hull, tapering to a blunt `wt`-wide flat front with
    chamfered corners; stepped in tiers of thick plate (a lit lip and a shadow under each step), a slightly barrelled
    cross-section, stock plating detail ground into it."""
    W = int(math.ceil(wb)) + 2
    yy, xx = np.mgrid[0:h, 0:W].astype(np.float64) + 0.5
    t = yy / h
    hw = wt / 2 + (wb - wt) / 2 * t ** 0.7
    dx = np.abs(xx - W / 2)
    dside = hw - dx
    A = np.clip(dside + 0.5, 0, 1) * np.clip(yy + dside - chamfer + 0.5, 0, 1)
    onch = (yy + dside < chamfer + 3)
    sgn = np.sign(xx - W / 2)
    nx = np.where(onch, 0.55 * sgn, 0.45 * (xx - W / 2) / np.maximum(hw, 1))
    ny = np.where(onch, -0.55, -0.12)
    nz = np.sqrt(np.clip(1 - nx ** 2 - ny ** 2, 0.05, 1))
    L = _shade(nx, ny, nz, amb=0.14, k=0.6)
    L = np.where(yy < 3, L * 1.12 + 0.05, L)
    riv = np.zeros((h, W))
    edge = np.zeros((h, W))
    for f in steps:
        y = int(round(f * h))
        L[y - 1] = np.minimum(1, L[y - 1] * 1.22 + 0.06)
        L[y:y + 2] *= 0.5
        edge[y:y + 2] = 1
        for x in range(4, W - 3, 5):
            if y + 3 < h:
                riv[y + 3, x] = 1
    if _TANK_TEX:
        st = _TANK_TEX[0]
        sh, sw = st.L.shape
        iy = (yy * 1.3).astype(int) % sh
        ix = np.clip(((xx - W / 2) / np.maximum(hw, 1) + 1) / 2 * (sw - 1), 0, sw - 1).astype(int)
        L = L * (0.7 + 0.45 * np.where(st.A[iy, ix] > 0.5, st.L[iy, ix], 0.55))
    return Piece(L, A, None, {'rivet': riv, 'slab': edge})


def put_prow(c, h, taper=0.78, chamfer=0.3, cut=None):
    """Replace the bow: cut away everything above the hull's row `top + cut` (sleek forks, prongs, antennas) and grow
    a blunt armoured prow `h` px long forward from the cut, as wide as the hull's centre run there."""
    sol = c.A > 0.4
    top = int(np.nonzero(sol.any(1))[0].min())
    yc = top + (h if cut is None else cut)
    cx = (c.w - 1) / 2
    wmax = 0
    for y in range(yc, min(c.h, yc + 4)):
        l = int(cx)
        while l > 0 and sol[y, l - 1]:
            l -= 1
        r = int(cx)
        while r < c.w - 1 and sol[y, r + 1]:
            r += 1
        wmax = max(wmax, r - l + 1)
    for arr in [c.L, c.A, c.S, c.T] + list(c.M.values()):
        arr[:yc] = 0
    pc = prow(wmax, wmax * taper, h + 3, int(round(wmax * taper * chamfer)))
    c.put(pc, c.w / 2, yc + 3 - (h + 3) / 2, 1.0, shadow=0.0, gain=0.92)


def mount_bells(c):
    """Engine mounts: bells whose tops are not under the hull get a thrust frame (a banded box beam across all of
    them, one per row of bells) reaching up into the hull above (no bell floats behind a gap)."""
    A = c.A
    noz = c.M['nozzle'] / np.maximum(A, 1e-6)
    loose = []
    for (x0, x1, yb, yt) in c.bell_tops:
        xc = (x0 + x1) // 2
        if A[max(0, yt - 1), xc] > 0.9 and noz[max(0, yt - 1), xc] < 0.5:
            continue  # the hull covers the bell's top
        hull = [y for y in range(yt + 2, max(0, yt - 70), -1) if A[y, xc] > 0.9 and noz[y, xc] < 0.5]
        if not hull:
            print('  WARNING: bell with no hull above', (x0, x1, yb))
            continue
        loose.append((x0, x1, yt, hull[0]))
    # one frame per group of loose bells at about the same height
    loose.sort(key=lambda b: (b[2], b[0]))
    groups = []
    for b in loose:
        if groups and abs(groups[-1][-1][2] - b[2]) <= 6:
            groups[-1].append(b)
        else:
            groups.append([b])
    for g in groups:
        x0 = min(b[0] for b in g) - 3
        x1 = max(b[1] for b in g) + 3
        yt = max(b[2] for b in g) + 5
        yh = min(b[3] for b in g) - 4
        if len(g) == 1 and (x1 - x0) < 18:
            x0, x1 = x0 - 2, x1 + 2
        c.put(girder(x1 - x0, max(6, yt - yh)), (x0 + x1) / 2, (yh + yt) / 2, 1.0, shadow=0.3)


def bunker_slits(c, span, depths, width, brow=2, seg=12, gap=2, cone=60, smooth=3.0):
    """Bunker viewing slits cut into the bow: thin dark slots at constant depths from the hull edge, so they follow
    the bow's contour (only where the nearest edge faces forward, within `cone` degrees of the bow), split by
    mullions every `seg` px, a heavy lit brow on their outer side and a lit lower lip. Writes into the canvas."""
    A = c.A
    h, w = A.shape
    solid = A > 0.5
    # the contour the slits follow: the silhouette smoothed (no antenna or greeble bends them)
    shape = fblur((A > 0.5).astype(np.float64), smooth) > 0.5
    cxm = (w - 1) / 2
    mid = np.nonzero(solid[:, int(cxm) - 2:int(cxm) + 3].any(1))[0]
    if len(mid) == 0:
        return
    tip = int(mid.min())
    y0, y1 = max(0, tip - 2), min(h, tip + span)
    P_ = np.argwhere((solid & shape)[y0:y1]) + [y0, 0]
    out = ~shape
    p = np.pad(shape, 1)
    nb = p[:-2, 1:-1] | p[2:, 1:-1] | p[1:-1, :-2] | p[1:-1, 2:]
    O = np.argwhere(out & nb)
    O = O[(O[:, 0] >= y0 - 12) & (O[:, 0] < y1 + 12)].astype(np.float64)
    if len(P_) == 0 or len(O) == 0:
        return
    best = np.full(len(P_), 1e9)
    vec = np.zeros((len(P_), 2))
    for k in range(0, len(O), 256):
        o = O[k:k + 256]
        d = (P_[:, None, 0] - o[None, :, 0]) ** 2 + (P_[:, None, 1] - o[None, :, 1]) ** 2
        j = d.argmin(1)
        dm = d[np.arange(len(P_)), j]
        upd = dm < best
        best[upd] = dm[upd]
        vec[upd] = o[j[upd]] - P_[upd]
    dist = np.sqrt(best)
    ang = np.degrees(np.arctan2(vec[:, 1], -vec[:, 0]))  # 0 = the edge straight ahead (towards the bow)
    fwd = np.abs(ang) <= cone
    Lc = c.L / np.maximum(c.A, 1e-6)
    slot = np.zeros((h, w))
    zone = np.zeros((h, w))
    ys, xs = P_[:, 0], P_[:, 1]
    mull = (np.abs(xs - cxm) % seg) < gap
    mw = mull.astype(np.float64)  # mullions: plain hull metal
    for d0 in depths:
        # anti-aliased slot coverage across its width, faded at the cone's ends
        cov = np.clip(np.minimum(dist - d0, d0 + width - dist) + 0.5, 0, 1) * np.clip((cone - np.abs(ang)) / 8, 0, 1) * (1 - mw)
        br = fwd & (dist >= d0 - brow - 0.5) & (dist < d0)
        lip = fwd & (dist >= d0 + width) & (dist < d0 + width + 1) & ~mull
        # the brow: a heavy raised lip, lit, its outer edge bevelled darker; the slot's lower lip catches light
        Lc[ys[br], xs[br]] = np.clip(Lc[ys[br], xs[br]] * 0.3 + np.where(dist[br] < d0 - brow + 0.5, 0.4, 0.74), 0, 1)
        Lc[ys[lip], xs[lip]] = np.clip(Lc[ys[lip], xs[lip]] * 0.3 + 0.48, 0, 1)
        Lc[ys, xs] = Lc[ys, xs] * (1 - cov) + 0.03 * cov
        slot[ys, xs] = np.maximum(slot[ys, xs], cov)
        zone[ys[br | lip | (cov > 0)], xs[br | lip | (cov > 0)]] = 1
    c.L = Lc * c.A
    c.M['slit'] = np.maximum(c.M['slit'], slot * c.A)
    c.M['slitzone'] = np.maximum(c.M['slitzone'], zone * c.A)


def hab_ring(root, R, tb, spokes=4, strip=(24, 'largefreighter')):
    """A rotating habitat ring seen face on (squashed into an ellipse when placed): a tube band of mid radius R and half
    thickness tb, a stock segmented hull strip wrapped round it for detail, bulkheads, spokes to the hub, a window row."""
    st = Piece.load(root, strip[0], strip[1])
    sh, sw = st.L.shape
    s = int(math.ceil(2 * (R + tb))) + 4
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float64) + 0.5
    dx, dy = xx - s / 2, yy - s / 2
    r = np.sqrt(dx ** 2 + dy ** 2)
    ang = np.arctan2(dy, dx)
    q = (r - R) / tb
    A = np.clip((1 - np.abs(q)) * tb * 1.1, 0, 1)
    nz = np.sqrt(np.clip(1 - q ** 2, 0, 1))
    L = _shade(q * dx / np.maximum(r, 1e-6), q * dy / np.maximum(r, 1e-6), nz, amb=0.2, k=0.72)
    # the strip wrapped round: its length along the ring (repeated), its width across the band
    u = ((ang + math.pi) * R) % sh
    v = np.clip((q + 1) / 2, 0, 0.999) * (sw - 1)
    tex = st.L[u.astype(int) % sh, v.astype(int)]
    texa = st.A[u.astype(int) % sh, v.astype(int)]
    L = L * (0.45 + 0.75 * np.where(texa > 0.5, tex, 0.5))
    bulk = np.abs(((ang / (2 * math.pi)) * 24) % 1 - 0.5) > 0.5 - 1.0 / (2 * math.pi * R / 24)
    L = np.where(bulk & (A > 0), L * 0.45, L)
    win = ((np.abs(q - 0.45) < 0.12) & ~bulk & ((((ang / (2 * math.pi)) * 24 * 5) % 1) < 0.35)).astype(np.float64)
    # spokes
    for k in range(spokes):
        a0 = math.pi / 4 + k * math.pi / 2
        px, py = math.cos(a0), math.sin(a0)
        along = dx * px + dy * py
        across = -dx * py + dy * px
        sp = (along > R * 0.3) & (along < R - tb * 0.8) & (np.abs(across) < tb * 0.32)
        sq = across / (tb * 0.32)
        sL = _shade(sq * -py, sq * px, np.sqrt(np.clip(1 - sq ** 2, 0, 1)), amb=0.2, k=0.6) * 0.8
        L = np.where(sp & (A < 0.5), sL, L)
        A = np.where(sp, np.maximum(A, np.clip((1 - np.abs(sq)) * tb * 0.4, 0, 1)), A)
    return Piece(L, A, None, {'win': win})


# ---------------------------------------------------------------------------------------------------------------
# 2-5. Paint
# ---------------------------------------------------------------------------------------------------------------

# Gunmetal ramp (luminance -> sRGB 0..1): a neutral grey with a faint blue cast, not near black (the rust must show).
RAMP_X = np.array([0.0, 0.12, 0.3, 0.5, 0.7, 0.88, 1.0])
RAMP_C = np.array([
    [0.030, 0.033, 0.038],
    [0.085, 0.092, 0.102],
    [0.175, 0.186, 0.200],
    [0.280, 0.298, 0.318],
    [0.392, 0.408, 0.425],
    [0.520, 0.528, 0.536],
    [0.620, 0.625, 0.630],
])
RUST_D = np.array([0.22, 0.085, 0.04])
RUST_M = np.array([0.46, 0.20, 0.08])
RUST_B = np.array([0.64, 0.32, 0.12])
PRIMER = [np.array([0.33, 0.35, 0.30]), np.array([0.34, 0.21, 0.17]), np.array([0.19, 0.205, 0.225]), np.array([0.43, 0.43, 0.41])]
SOOT = np.array([0.045, 0.04, 0.035])
GRIME = np.array([0.06, 0.05, 0.04])
DUST = np.array([0.33, 0.31, 0.28])
METAL = np.array([0.52, 0.53, 0.54])
GLASS_D = np.array([0.03, 0.07, 0.05])
GLASS_L = np.array([0.15, 0.22, 0.18])
GARDEN = np.array([0.05, 0.12, 0.045])
WINDOW = np.array([0.80, 0.68, 0.45])
LAMP_LENS = np.array([0.36, 0.06, 0.05])  # an unlit red lamp


def ramp(v):
    out = np.empty(v.shape + (3,))
    for c in range(3):
        out[..., c] = np.interp(v, RAMP_X, RAMP_C[:, c])
    return out


def split_panels(rng, x0, y0, x1, y1, minw, maxw, out):
    w, h = x1 - x0, y1 - y0
    if (w <= maxw and h <= maxw and rng.random() < 0.55) or (w < 2 * minw and h < 2 * minw):
        out.append((x0, y0, x1, y1))
        return
    if (w > h and w >= 2 * minw) or h < 2 * minw:
        s = int(rng.integers(x0 + minw, x1 - minw + 1))
        split_panels(rng, x0, y0, s, y1, minw, maxw, out)
        split_panels(rng, s, y0, x1, y1, minw, maxw, out)
    else:
        s = int(rng.integers(y0 + minw, y1 - minw + 1))
        split_panels(rng, x0, y0, x1, s, minw, maxw, out)
        split_panels(rng, x0, s, x1, y1, minw, maxw, out)


def line_px(x0, y0, x1, y1):
    n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
    xs = np.round(np.linspace(x0, x1, n)).astype(int)
    ys = np.round(np.linspace(y0, y1, n)).astype(int)
    return xs, ys


def paint(L, A, S, T, M, spec, seed):
    """Gunmetal paint + surface + age + lights on an assembled frame. Returns (RGBA uint8, lights)."""
    h, w = L.shape
    rng = np.random.default_rng(seed)
    u = spec['unit']  # source px per screen px at the closest zoom (detail scale)
    solid = A > 0.55
    depth = depth_inside(A > 0.5, 12)
    inner = (depth >= 2).astype(np.float64)
    sym = spec.get('sym', True)
    hw = int(math.ceil(w / 2)) if sym else w
    glass = M['glass'] * solid
    noz = M['nozzle']

    # ---- structure: plating seams, plate tones, rivet rows (mirrored when symmetric)
    seam = np.zeros((h, w))
    lip = np.zeros((h, w))
    ptone = np.zeros((h, w))
    rivet = np.zeros((h, w))
    panels = []
    split_panels(rng, 0, 0, hw, h, max(4, int(3.5 * u)), max(10, int(15 * u)), panels)
    for (x0, y0, x1, y1) in panels:
        ptone[y0:y1, x0:x1] = rng.normal(0, 0.06)
        if rng.random() < 0.6:
            seam[y0, x0:x1] = 1
            if y0 + 1 < h:
                lip[y0 + 1, x0:x1] = 1
            if rng.random() < 0.5:  # a rivet row under the seam
                for x in range(x0 + 2, x1 - 1, max(3, int(2.2 * u))):
                    if y0 + 2 < h:
                        rivet[y0 + 2, x] = 1
        if rng.random() < 0.6:
            seam[y0:y1, x0] = 1
            if x0 + 1 < w:
                lip[y0:y1, x0 + 1] = 0.6
    if sym:
        for m in (seam, lip, ptone, rivet):
            m[:, w - hw:] = m[:, :hw][:, ::-1][:, :hw]
    gy_, gx_ = np.gradient(fblur(L, 0.7))
    grad = np.abs(gy_) + np.abs(gx_)
    calm = np.clip(1.5 - grad * 10, 0.0, 1)
    seam_m = seam * inner * calm * (1 - noz) * (1 - glass) * (1 - M['slitzone'])
    lip_m = lip * inner * calm * (1 - noz) * (1 - glass)
    rivet = np.maximum(rivet * inner * calm * (1 - glass), M['rivet'] * solid) * (1 - M['slitzone'])

    # ---- base paint
    v = np.clip(L + 0.45 * (L - fblur(L, 2.4 * u / 2.4)), 0, 1)
    v = np.where(v > 0.6, 0.6 + (v - 0.6) * 0.6, v)  # dull, not polished
    v = v * (1 + ptone * (0.3 + 0.7 * calm) * inner + T)
    v = v * (1 - 0.35 * seam_m) + 0.035 * lip_m * (0.4 + v)
    # key light from the upper left on the silhouette: a lit rim facing it, a darker rim away from it
    ay_, ax_ = np.gradient(fblur(A, 1.2))
    nrm = np.sqrt(ax_ ** 2 + ay_ ** 2) + 1e-6
    facing = (ax_ + ay_) / nrm / math.sqrt(2)
    band = ((depth >= 1) & (depth <= 3)).astype(np.float64)
    v = v + band * np.clip(facing, 0, 1) * 0.13 - band * np.clip(-facing, 0, 1) * 0.12 * v
    v = np.clip(v, 0, 1)
    rgb = ramp(v)
    big = fbm(rng, h, w, max(8, int(22 * u)))
    rgb *= (0.9 + 0.2 * big)[..., None]

    # ---- replacement plates: whole panels in mismatched paint, riveted round (never mirrored)
    patch = np.zeros((h, w))
    plates = []
    split_panels(rng, 0, 0, w, h, max(5, int(4 * u)), max(12, int(12 * u)), plates)
    rng.shuffle(plates)
    want = int(spec.get('patches', 1.0) * solid.sum() / (520 * u * u))
    n_made = 0
    for (x0, y0, x1, y1) in plates:
        if n_made >= want:
            break
        reg = solid[y0:y1, x0:x1] & (depth[y0:y1, x0:x1] >= 3) & (glass[y0:y1, x0:x1] < 0.5) & (noz[y0:y1, x0:x1] < 0.5) & (M['slitzone'][y0:y1, x0:x1] < 0.5)
        if reg.mean() < 0.85:
            continue
        n_made += 1
        col = PRIMER[int(rng.choice(len(PRIMER), p=[0.32, 0.12, 0.36, 0.20]))]
        k = rng.uniform(0.3, 0.55)
        vv = v[y0:y1, x0:x1, None]
        tgt = col * (0.55 + 0.9 * vv)
        rgb[y0:y1, x0:x1] = rgb[y0:y1, x0:x1] * (1 - k) + tgt * k
        patch[y0:y1, x0:x1] = 1
        # weld seam round the plate, rivets inside it
        rgb[y0, x0:x1] *= 0.5
        rgb[y0:y1, x0] *= 0.55
        if y1 < h:
            rgb[min(h - 1, y1), x0:x1] *= 0.6
        if x1 < w:
            rgb[y0:y1, min(w - 1, x1)] *= 0.7
        step = max(3, int(2.4 * u))
        for x in range(x0 + 2, x1 - 1, step):
            rivet[min(h - 1, y0 + 2), x] = 1
            rivet[max(0, y1 - 2), x] = 1
        for y in range(y0 + 2, y1 - 1, step):
            rivet[y, min(w - 1, x0 + 2)] = 1
            rivet[y, max(0, x1 - 2)] = 1
    rivet *= solid * (M['slitzone'] < 0.5)

    # ---- rivets: a dark dot, a lit pixel up-left
    rv = rivet > 0.5
    rgb[rv] *= 0.5
    up = shift(rv.astype(np.float64), -1, -1) > 0.5
    rgb[up & solid & ~rv] = np.minimum(1, rgb[up & solid & ~rv] * 1.35 + 0.03)

    # ---- rust
    rnoise = fbm(rng, h, w, max(4, int(5 * u)))
    hue_n = fbm(rng, h, w, max(3, int(4 * u)))
    def rust_col(level):
        c = np.where((hue_n < 0.45)[..., None], RUST_D + (RUST_M - RUST_D) * (hue_n / 0.45)[..., None],
                     RUST_M + (RUST_B - RUST_M) * np.clip((hue_n - 0.45) / 0.4, 0, 1)[..., None])
        return c * (0.55 + 0.75 * level)[..., None]
    sources = np.clip(seam_m * 0.6 + rv * 1.0 + M['strap'] * 0.8 + M['slab'] * 0.7, 0, 1)
    # rust starts at the plate edges of the replacement plates too
    pe = np.abs(np.gradient(patch)[0]) + np.abs(np.gradient(patch)[1])
    sources = np.clip(sources + (pe > 0) * 0.25, 0, 1) * solid
    # broad blooms: where sources cluster, broken by noise
    bn = fbm(rng, h, w, max(3, int(4 * u)), stretch_y=2.5)
    bloom = np.clip(run_aft(fblur(sources, 1.6 * u), 1 - 1 / (5 * u)) * 3.5, 0, 1) * np.clip((bn - 0.42) * 3.0, 0, 1)
    # edges and recesses
    edge_r = ((depth >= 1) & (depth <= max(2, int(1.5 * u)))).astype(np.float64) * np.clip((fbm(rng, h, w, max(3, int(3 * u))) - 0.55) * 3, 0, 1)
    recess = np.clip(0.35 - v, 0, 1) * 1.6 * np.clip((rnoise - 0.45) * 2.5, 0, 1)
    # streaks running aft from the sources, thin columns
    cols = value_noise(rng, 1, w, max(1, int(0.9 * u)))[0]
    colmask = np.clip((cols - 0.55) * 4, 0, 1)
    src_pts = sources * (rng.random((h, w)) < 0.4)
    streak = run_aft(src_pts, 1 - 1 / max(6.0, 9 * u)) * colmask[None, :]
    streak *= 0.5 + 0.5 * fbm(rng, h, w, max(2, int(2 * u)), stretch_y=5.0)
    # broad rust zones (large patches: read as rust-spotted at play zoom)
    zones = np.clip((fbm(rng, h, w, max(8, int(13 * u)), stretch_y=1.6) - 0.6) * 3.0, 0, 1) * np.clip((rnoise - 0.3) * 2, 0, 1)
    rk = spec.get('rust', 1.0)
    rust = np.clip(bloom * 0.8 + edge_r * 0.5 + recess * 0.35 + streak * 0.8 + zones * 0.6, 0, 0.9) * rk
    rust *= solid * (1 - glass) * (1 - 0.5 * noz) * (1 - 0.6 * M['slitzone'])
    rc = rust_col(v)
    rgb = rgb * (1 - rust[..., None]) + rc * rust[..., None]
    # flaking: some rust spots pitted darker
    flake = (rust > 0.45) & (rng.random((h, w)) < 0.12)
    rgb[flake] *= 0.6

    # ---- nozzles: dark, sooty, a faint heat-blued band (old metal, no glow)
    nz_m = noz * solid
    soot_n = fblur(nz_m, 1.0) * (0.6 + 0.4 * fbm(rng, h, w, max(2, int(2 * u))))
    rgb = rgb * (1 - 0.45 * soot_n[..., None]) + SOOT * (0.45 * soot_n)[..., None]

    # ---- scorch marks
    soot = np.zeros((h, w))
    pts = np.argwhere(solid & (depth >= 4))
    for _ in range(int(spec.get('scorches', 2))):
        if len(pts) == 0:
            break
        py, px = pts[int(rng.integers(len(pts)))]
        r = (h + w) / 2 * rng.uniform(0.05, 0.09)
        yy, xx = np.mgrid[0:h, 0:w]
        d = np.sqrt(((xx - px) / r) ** 2 + ((yy - py) / (r * 1.6)) ** 2)
        soot = np.maximum(soot, np.clip(1.1 - d, 0, 1) ** 1.4)
    soot *= 0.55 + 0.6 * fbm(rng, h, w, max(2, int(3 * u)))
    soot = np.clip(soot, 0, 0.8) * (A > 0) * (1 - glass)
    rgb = rgb * (1 - soot[..., None]) + (rgb * 0.25 + SOOT * 0.75) * soot[..., None]

    # ---- grime streaks aft, dust in recesses
    gstreak = fbm(rng, h, w, max(3, int(3 * u)), stretch_y=6.0)
    gr = np.clip((gstreak - 0.55) * 3, 0, 1) * 0.3 * inner * (1 - glass)
    rgb = rgb * (1 - gr[..., None]) + GRIME * gr[..., None]
    dustn = fbm(rng, h, w, max(6, int(10 * u)))
    dust = np.clip((dustn - 0.5) * 2.2, 0, 1) * np.clip(0.5 - v, 0, 1) * 0.3 * inner
    rgb = rgb * (1 - dust[..., None]) + DUST * dust[..., None] * (0.4 + v[..., None])

    # ---- scratches (few, bare metal) and pits
    wear_pts = np.argwhere(solid & (depth >= 2) & (glass < 0.5))
    for _ in range(int(spec.get('scratches', 1.0) * solid.sum() / (260 * u * u)) if len(wear_pts) else 0):
        y, x = wear_pts[int(rng.integers(len(wear_pts)))]
        ang = rng.uniform(0, math.pi)
        ln = rng.uniform(2, 7) * u
        xs, ys = line_px(x, y, x + math.cos(ang) * ln, y + math.sin(ang) * ln)
        ok = (xs >= 0) & (xs < w) & (ys >= 0) & (ys < h)
        xs, ys = xs[ok], ys[ok]
        ok = solid[ys, xs]
        rgb[ys[ok], xs[ok]] = rgb[ys[ok], xs[ok]] + (METAL - rgb[ys[ok], xs[ok]]) * rng.uniform(0.12, 0.28)
    pits = (rng.random((h, w)) < 0.02) & solid & (depth >= 2) & (glass < 0.5)
    rgb[pits] *= 0.55

    # ---- put-out stock glows: dark dead lamps
    sk = fblur(S, 0.6) * solid
    rgb = rgb * (1 - 0.45 * sk)[..., None]

    # ---- garden domes: dark green glass, a faint glow of the gardens under it, a sheen
    if glass.max() > 0:
        gv = np.clip(v, 0, 1)[..., None]
        gcol = GLASS_D + (GLASS_L - GLASS_D) * gv ** 1.6
        leaf = fbm(rng, h, w, max(2, int(2 * u)))
        gcol = gcol + GARDEN * (0.5 + 0.8 * leaf)[..., None] * (1 - gv) * 0.9
        rgb = rgb * (1 - glass[..., None]) + gcol * glass[..., None]

    # ---- windows: tiny dim warm lights on the window mask, many dead
    wm = M['win'] * solid
    wpts = np.argwhere(wm > 0.5)
    lit = rng.random(len(wpts)) < spec.get('windows_lit', 0.45)
    for (y, x), on in zip(wpts, lit):
        if on:
            rgb[y, x] = rgb[y, x] * 0.3 + WINDOW * rng.uniform(0.45, 0.7)
        else:
            rgb[y, x] *= 0.55

    # ---- bunker slits: dark recessed slots, a faint dim warm light behind some stretches
    slot = M['slit'] * solid
    if slot.max() > 0:
        segn = value_noise(rng, h, w, max(3, int(3 * u)))
        warm = np.array([0.11, 0.075, 0.035]) * np.clip((segn - 0.45) * 3, 0, 1)[..., None]
        dark = np.array([0.018, 0.02, 0.024])
        rgb = rgb * (1 - slot[..., None]) + (dark + warm) * slot[..., None]

    # ---- red lamp housings (threatArt.ts blinks the lights over them)
    lights = [(int(x), int(y)) for (x, y) in spec.get('lights', [])]
    for (lx, ly) in lights:
        for oy in range(-2, 3):
            for ox in range(-2, 3):
                r_ = math.hypot(ox, oy)
                if r_ <= 2.3 and 0 <= ly + oy < h and 0 <= lx + ox < w and A[ly + oy, lx + ox] > 0.3:
                    rgb[ly + oy, lx + ox] = LAMP_LENS if r_ <= 1.05 else rgb[ly + oy, lx + ox] * 0.4

    out = np.zeros((h, w, 4))
    out[..., :3] = np.clip(rgb, 0, 1)
    out[..., 3] = A
    r8 = np.round(out * 255).astype(np.uint8)
    r8[r8[..., 3] < 6] = 0
    # no opaque black (it does not count as content), no accidental marker colours, then the explicit thruster marks
    vis = r8[..., 3] > 0
    blk = vis & (r8[..., 0] == 0) & (r8[..., 1] == 0) & (r8[..., 2] == 0)
    r8[blk, :3] = 1
    acc = vis & (((r8[..., 0] == 0) & (r8[..., 1] == 0) & (r8[..., 2] == 255)) | ((r8[..., 0] == 255) & (r8[..., 1] == 255) & (r8[..., 2] == 0)))
    r8[acc, 2] = np.where(r8[acc, 2] > 0, r8[acc, 2] - 1, 1)
    for (x0, x1, y) in spec.get('thrusters', []):
        for x in range(x0, x1 + 1):
            if 0 <= x < w and 0 <= y < h and r8[y, x, 3] > 0:
                r8[y, x] = (0, 0, 255, 255)
    return r8, lights


def thruster_rows(c, A, noz):
    """One thruster run per placed bell: its aft-most opaque row inside the bell's x range where the bell is not
    covered by later pieces, a pixel in."""
    out = []
    for (x0, x1, yb) in c.nozzles:
        for y in range(min(c.h - 1, yb + 2), max(0, yb - 12), -1):
            xs = [x for x in range(x0, x1 + 1) if 0 <= x < c.w and A[y, x] > 0.9 and noz[y, x] > 0.5]
            if len(xs) >= 2:
                out.append((xs[0] + 1, xs[-1] - 1, y - 1))
                break
    return out


def bells(c, xs, y, w0, w1, hgt, shadow=0.4):
    """Engine bells at the canvas x's, their tops at y (mirrored pairs are listed explicitly)."""
    pc = nozzle(w0, w1, hgt)
    for x in xs:
        c.put(pc, x, y + hgt / 2, 1.0, 0, shadow=shadow)
        c.nozzles.append((int(round(x - w1 / 2)), int(round(x + w1 / 2)), int(round(y + hgt))))
        c.bell_tops.append((int(round(x - w0 / 2)), int(round(x + w0 / 2)), int(round(y + hgt)), int(round(y))))


def extreme_lights(A, bow=True, stern=True, inset=3, band=None):
    """Lamp positions at the hull extremities: the bow tip, the port / starboard extremes (wingtips), the stern
    corners. Inset a few px into the opaque hull."""
    h, w = A.shape
    sol = A > 0.9
    d = depth_inside(sol, inset + 2)
    ok = d >= inset
    ys, xs = np.nonzero(ok)
    pts = []
    if bow and len(ys):
        mid = np.abs(xs - (w - 1) / 2) <= 2  # on the centre line
        if mid.any():
            y = ys[mid].min()
            pts.append((int(xs[mid][ys[mid] == y][0]), int(y)))
        else:
            y = ys.min()
            row = xs[ys == y]
            pts.append((int(row[len(row) // 2]), int(y)))
    if len(xs):
        # wingtips: the left-most solid point (and its mirror); `band`: restrict to a y range
        sel = np.ones_like(xs, bool) if band is None else (ys >= band[0]) & (ys <= band[1])
        xm = xs[sel].min()
        yl = ys[sel][xs[sel] == xm]
        y = int(yl[np.argmin(np.abs(yl - np.median(yl)))])  # on the hull (the column may have gaps)
        pts.append((int(xm), y))
        xr = w - 1 - int(xm)
        # the nearest solid inset point to the mirror
        cand = np.argwhere(ok)
        j = np.argmin((cand[:, 0] - y) ** 2 + (cand[:, 1] - xr) ** 2)
        pts.append((int(cand[j, 1]), int(cand[j, 0])))
    if stern and len(ys):
        y = ys.max()
        for side in (0, 1):
            rows = [(yy, xx) for yy, xx in zip(ys, xs) if yy >= y - 6]
            if not rows:
                break
            xx = min(r[1] for r in rows) if side == 0 else max(r[1] for r in rows)
            yy = max(r[0] for r in rows if r[1] == xx)
            pts.append((int(xx), int(yy)))
    return pts


# ---------------------------------------------------------------------------------------------------------------
# The set
# ---------------------------------------------------------------------------------------------------------------

def build(root, name):
    P = lambda fam, f, crop=None: Piece.load(root, fam, f, crop)  # noqa: E731
    if name == 'worldship':
        return build_worldship(root)
    if name == 'escort':
        # Squat and wide: a Human escort hull cut short and broad, two fat tanks at its flanks, two big bells.
        c = Canvas(190)
        bells(c, (72, 118), 132, 16, 23, 26)
        c.put(capsule(26, 62, bands=(0.25, 0.55, 0.85)), 51, 106, 1.0, 0, shadow=0, mirror=True)
        c.put(P(0, 'escort'), 95, 92, 1.0, 0, shadow=0.6, sx=1.3, sy=0.72)
        put_prow(c, 26)
        spec = dict(unit=2.4, patches=1.0, scorches=2, slits=dict(span=26, depths=(5, 10), width=2))
        return c, spec
    if name == 'frigate':
        # A long needle: a stretched old MIL hull with a long tank down its spine and one big bell.
        c = Canvas(220)
        bells(c, (110,), 188, 18, 26, 26)
        c.put(P(0, 'MIL2A'), 110, 104, 1.0, 0, shadow=0, sx=1.3, sy=1.6)
        c.put(capsule(18, 86, bands=(0.2, 0.45, 0.7, 0.9)), 110, 128, 1.0, 0, shadow=0.5)
        put_prow(c, 30, chamfer=0.34, taper=0.7)
        spec = dict(unit=2.5, patches=1.1, scorches=2, slits=dict(span=30, depths=(5, 10), width=2))
        return c, spec
    if name == 'destroyer':
        # An H: a long MIL4A hull with two long tanks out on truss outriggers, an engine bell under each.
        c = Canvas(240)
        tank = capsule(20, 100, bands=(0.15, 0.4, 0.65, 0.88))
        bells(c, (42, 198), 172, 12, 17, 22)
        bells(c, (110, 130), 196, 12, 17, 26)
        c.put(girder(150, 7), 120, 102, 1.0, shadow=0.3)
        c.put(girder(150, 7), 120, 152, 1.0, shadow=0.3)
        c.put(tank, 42, 124, 1.0, 0, shadow=0.45, mirror=True)
        c.put(P(0, 'destroyer'), 120, 132, 0.85, 0, shadow=0.3, gain=0.9)
        c.put(P(0, 'MIL4A'), 120, 112, 1.0, 0, shadow=0.6)
        put_prow(c, 34)
        spec = dict(unit=2.5, patches=1.2, scorches=3, slits=dict(span=36, depths=(6, 11), width=2))
        return c, spec
    if name == 'cruiser':
        # Fat and broad-sterned: MIL3D's chunky body on a Human cruiser, a drum-shouldered engine block aft, double tank
        # racks at the waist, five bells.
        c = Canvas(280)
        bells(c, (106, 174), 236, 16, 24, 32)
        bells(c, (124, 156), 242, 13, 18, 26)
        bells(c, (140,), 246, 13, 18, 22)
        c.put(P(25, 'colonyship'), 140, 172, 0.9, 0, shadow=0, gain=0.85)
        c.put(P(0, 'cruiser'), 140, 136, 1.0, 0, shadow=0.3, gain=0.9)
        c.put(capsule(22, 70, bands=(0.25, 0.75)), 72, 136, 1.0, 0, shadow=0.4, mirror=True)
        c.put(capsule(24, 92, bands=(0.2, 0.5, 0.8)), 94, 132, 1.0, 0, shadow=0.45, mirror=True)
        c.put(P(0, 'MIL3D'), 140, 122, 1.0, 0, shadow=0.6)
        put_prow(c, 40)
        spec = dict(unit=2.4, patches=1.2, scorches=3, slits=dict(span=40, depths=(6, 12), width=2))
        return c, spec
    if name == 'capitalship':
        # The Human capital frame lengthened by an industrial spine, tank racks both sides, slab armour, six bells.
        c = Canvas(320)
        tank = capsule(22, 80, bands=(0.25, 0.75))
        bells(c, (124, 196), 276, 18, 26, 34)
        bells(c, (146, 174), 280, 15, 21, 30)
        c.put(P(25, 'capitalship'), 160, 170, 1.25, 0, shadow=0, gain=0.85)
        for y in (128, 210):
            c.put(tank, 104, y, 1.0, 0, shadow=0.45, mirror=True)
        c.put(P(0, 'capitalship'), 160, 140, 1.0, 0, shadow=0.6)
        put_prow(c, 50, chamfer=0.26)
        spec = dict(unit=2.4, patches=1.3, scorches=4, slits=dict(span=44, depths=(6, 12), width=2))
        return c, spec
    if name == 'carrier':
        # A broad flat hangar hull (industrial deck over a Human carrier), tanks along the deck edges, four bells.
        c = Canvas(300)
        tank = capsule(18, 110, bands=(0.15, 0.4, 0.65, 0.88))
        bells(c, (120, 180), 256, 16, 23, 32)
        bells(c, (140, 160), 260, 13, 18, 26)
        c.put(P(0, 'carrier'), 150, 140, 1.05, 0, shadow=0, gain=0.9)
        c.put(P(22, 'carrier'), 150, 144, 1.0, 0, shadow=0.6, gain=0.95)
        c.put(tank, 90, 156, 1.0, 0, shadow=0.45, mirror=True)
        put_prow(c, 40, chamfer=0.26)
        spec = dict(unit=2.4, patches=1.2, scorches=3, slits=dict(span=40, depths=(6, 12), width=2))
        return c, spec
    if name == 'trooptransport':
        # A fat drop-pod carrier: a stubby spine lined both sides with landing capsules (the TROOP2 pod stack).
        c = Canvas(240)
        pod = capsule(22, 34, bands=(0.5,))
        bells(c, (104, 136), 198, 16, 22, 28)
        c.put(P(25, 'largefreighter'), 120, 116, 1.05, 0, shadow=0, gain=0.9)
        for k, y in enumerate((60, 92, 124, 156)):
            c.put(pod, 84 - (k % 2) * 4, y, 1.0, 0, shadow=0.45, mirror=True)
        c.put(P(0, 'TROOP2'), 120, 112, 1.15, 0, shadow=0.6)
        put_prow(c, 26)
        spec = dict(unit=2.4, patches=1.0, scorches=2, slits=dict(span=30, depths=(6,), width=2))
        return c, spec
    if name == 'explorer':
        # A slim Human scout on one huge strapped fuel tank, a long sensor mast at the bow, two bells.
        c = Canvas(200)
        tank = capsule(34, 92, bands=(0.2, 0.45, 0.7))
        bells(c, (88, 112), 164, 12, 17, 22)
        c.put(tank, 100, 122, 1.0, 0, shadow=0)
        c.put(P(0, 'explorationship'), 100, 94, 0.95, 0, shadow=0.6)
        c.put(girder(70, 5), 100, 70, 1.0, shadow=0.4)  # a sensor boom across the bow
        put_prow(c, 26, chamfer=0.34)
        spec = dict(unit=2.4, patches=0.9, scorches=2, slits=dict(span=26, depths=(5, 10), width=2))
        return c, spec
    if name == 'construction':
        # A yard tug: an industrial construction hull, two crane booms forward, tanks aft, two bells.
        c = Canvas(220)
        tank = capsule(18, 60, bands=(0.3, 0.7))
        boom = P(24, 'largefreighter')
        bells(c, (94, 126), 178, 14, 20, 26)
        c.put(boom, 70, 60, 0.4, 12, shadow=0, gain=0.85, mirror=True)
        c.put(tank, 66, 136, 1.0, 0, shadow=0.4, mirror=True)
        c.put(P(25, 'constructionship'), 110, 100, 0.85, 0, shadow=0.6)
        put_prow(c, 24, chamfer=0.25)
        spec = dict(unit=2.5, patches=1.1, scorches=2, slits=dict(span=30, depths=(6,), width=2))
        return c, spec
    if name == 'hauler':
        # A bulk hauler: a long cargo spine racked with containers and tanks, a cab at the bow, two bells.
        c = Canvas(220)
        box = slab(22, 26, rivet_step=6)
        pod = capsule(16, 40, bands=(0.5,))
        bells(c, (96, 124), 184, 14, 20, 26)
        c.put(P(25, 'largefreighter'), 110, 104, 1.0, 0, shadow=0)
        for k, y in enumerate((70, 100, 130)):
            c.put(box if k != 1 else pod, 84, y, 1.0, 0, shadow=0.45, mirror=True)
        c.put(P(25, 'smallfreighter'), 110, 50, 0.6, 0, shadow=0.5)
        put_prow(c, 24, chamfer=0.3)
        spec = dict(unit=2.5, patches=1.0, scorches=2, slits=dict(span=26, depths=(5,), width=2))
        return c, spec
    raise KeyError(name)


RING_Y = (200, 350)
RING_SY = 0.34


def build_worldship(root):
    """The world ship: a long spine, two rotating habitat rings, garden domes at the bow, stacked cryo / cargo pods,
    a big tank section and a cluster of bells at the stern."""
    P = lambda fam, f, crop=None: Piece.load(root, fam, f, crop)  # noqa: E731
    S = 560
    c = Canvas(S)
    cx = S // 2
    ring = hab_ring(root, 134, 13)
    ring_sc, ring_sy = 1.0, RING_SY
    # rings: back halves first (behind the spine)
    for ry in RING_Y:
        c.put(ring, cx, ry, ring_sc, 0, shadow=0, gain=0.85, sy=ring_sy, clip=(0, ry))
    # stern: engine block and bells
    bells(c, (cx - 66, cx + 66), 488, 26, 38, 54, shadow=0.5)
    bells(c, (cx - 34, cx + 34), 496, 24, 34, 50, shadow=0.5)
    bells(c, (cx,), 500, 22, 30, 44, shadow=0.5)
    # the spine
    c.put(P(25, 'resortbase'), cx, 290, 1.72, 0, shadow=0, gain=0.95)
    # engine block
    c.put(P(25, 'colonyship'), cx, 456, 1.05, 0, shadow=0.5, gain=0.9)
    # tank section between ring 2 and the engines: big strapped tanks
    big = capsule(34, 92, bands=(0.2, 0.5, 0.8))
    c.put(big, cx - 62, 416, 1.0, 0, shadow=0.5, mirror=True)
    c.put(capsule(30, 80, bands=(0.25, 0.75)), cx - 28, 420, 1.0, 0, shadow=0.5, mirror=True)
    # cryo pods between the rings: stacked capsules, three tiers each side
    pod = capsule(20, 40, bands=(0.5,))
    for k, y in enumerate((236, 274, 312)):
        for dx in (40, 62, 84):
            c.put(pod, cx - dx, y, 1.0, 0, shadow=0.45, mirror=True)
    # cargo containers by the first ring
    c.put(P(24, 'largefreighter'), cx, 270, 0.95, 0, shadow=0.5, gain=0.9)
    # bow: command section and garden domes
    c.put(P(25, 'capitalship'), cx, 104, 0.95, 0, shadow=0.5, gain=0.95)
    c.put(dome(25, ribs=10, rings=3), cx, 146, 1.0, shadow=0.5)
    c.put(dome(17, ribs=8), cx - 38, 160, 1.0, shadow=0.5, mirror=True)
    c.put(dome(13, ribs=6), cx, 100, 1.0, shadow=0.5)
    put_prow(c, 56, chamfer=0.3, taper=0.72)
    # rings: front halves over the spine
    for ry in RING_Y:
        c.put(ring, cx, ry, ring_sc, 0, shadow=0.6, gain=1.0, sy=ring_sy, clip=(ry, S))
    spec = dict(unit=2.2, patches=1.3, scorches=5, windows_lit=0.4, sym=True, slits=dict(span=60, depths=(5, 11, 17), width=3, brow=2, seg=10, cone=78))
    # positional lights: bow, ring edges (left / right extremes of each ring), stern corners
    return c, spec


def ring_lights(A, ring_y):
    out = []
    for ry in ring_y:
        row = np.nonzero(A[ry] > 0.9)[0]
        if len(row):
            out.append((int(row.min()) + 3, ry))
            out.append((int(row.max()) - 3, ry))
    return out


FILES = ['worldship', 'escort', 'frigate', 'destroyer', 'cruiser', 'capitalship', 'carrier', 'trooptransport', 'explorer', 'construction', 'hauler']


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dwu', default=os.path.join(GAME, 'public', 'assets', 'dwu'))
    ap.add_argument('--out', default=os.path.join(GAME, 'public', 'art', 'generation-ships'))
    ap.add_argument('--lights', default=os.path.join(GAME, 'src', 'render', 'genShipsLights.ts'))
    ap.add_argument('--preview', default=None)
    ap.add_argument('--only', default=None)
    args = ap.parse_args()
    root = os.path.join(args.dwu, 'images', 'units', 'ships')
    _TANK_TEX.append(Piece.load(root, 24, 'largefreighter'))
    os.makedirs(args.out, exist_ok=True)
    made = []
    table = {}
    for name in FILES:
        if args.only and name not in args.only.split(','):
            continue
        c, spec = build(root, name)
        mount_bells(c)
        if 'slits' in spec:
            bunker_slits(c, **spec['slits'])
        L, A, S, T, M = c.result()
        spec.setdefault('thrusters', thruster_rows(c, A, M['nozzle']))
        # stern lights on the hull's aft corners, never on an engine bell
        hull = A * (M['nozzle'] < 0.5)
        if name == 'worldship':
            lights = extreme_lights(A, stern=False)[:1] + ring_lights(A, RING_Y) + extreme_lights(hull, bow=False)[2:]
        else:
            lights = extreme_lights(A, stern=False) + extreme_lights(hull, bow=False)[2:]
        spec['lights'] = lights
        r8, lights = paint(L, A, S, T, M, spec, zlib.crc32(('generation-ships:' + name).encode()))
        img = Image.fromarray(r8, 'RGBA')
        img.save(os.path.join(args.out, name + '.png'), optimize=True)
        made.append((name, img, lights))
        table[name] = lights
        print(name, img.size, 'lights', lights, 'thrusters', len(spec['thrusters']))
    if not args.only:
        write_lights(args.lights, table)
    if args.preview:
        contact_sheet(args.preview, made)


def write_lights(path, table):
    lines = [
        '// GENERATED by scripts/generation-ships-ships.py (do not edit): the red positional lights of the Generation Ships\'',
        '// bundled frames (public/art/generation-ships/<file>.png), in frame px, where each frame bakes an unlit lamp housing.',
        '// threatArt.ts GenShipsFxLayer blinks a red lamp over each.',
        '',
        'export const GEN_SHIPS_LIGHTS: Readonly<Record<string, readonly (readonly [number, number])[]>> = {',
    ]
    for name in FILES:
        if name in table:
            pts = ', '.join(f'[{x}, {y}]' for x, y in table[name])
            lines.append(f'    {name}: [{pts}],')
    lines.append('};')
    with open(path, 'w') as f:
        f.write('\n'.join(lines) + '\n')
    print('lights', path)


def as_drawn(img):
    """The frame as the game draws it: thruster marks painted out (shipArt.ts paintOutShipMarkers: the pixels
    beside them along the hull), so previews show no marker blue."""
    a = np.asarray(img).copy()
    blue = (a[..., 0] == 0) & (a[..., 1] == 0) & (a[..., 2] == 255) & (a[..., 3] > 0)
    for y, x in np.argwhere(blue):
        up, dn = a[max(0, y - 1), x].astype(int), a[min(a.shape[0] - 1, y + 1), x].astype(int)
        a[y, x] = ((up + dn) // 2).astype(np.uint8)
    return Image.fromarray(a, 'RGBA')


def contact_sheet(out_dir, made):
    """Each frame at full size, then at in-game sizes (close / play / far), on a space-dark ground."""
    os.makedirs(out_dir, exist_ok=True)
    rowh = max(img.height for _, img, _ in made) + 20
    sheet = Image.new('RGBA', (sum(img.width + 20 for _, img, _ in made) + 20, rowh + 260), (6, 7, 11, 255))
    x = 10
    for name, img, _ in made:
        img = as_drawn(img)
        sheet.alpha_composite(img, (x, 10))
        y = rowh + 10
        for frac in (0.45, 0.22, 0.1):
            s = max(4, int(img.width * frac))
            t = img.resize((s, s), Image.LANCZOS)
            sheet.alpha_composite(t, (x, y))
            y += s + 8
        x += img.width + 20
    sheet.save(os.path.join(out_dir, 'sheet.png'))
    print('sheet', os.path.join(out_dir, 'sheet.png'))


if __name__ == '__main__':
    main()
