#!/usr/bin/env python3
"""The Dead Probe Swarm's ship and station art (Galactic Threats add-on): new silhouettes kitbashed from pieces of
stock DW:U frames, repainted as dark-slate derelict machinery. Offline build step; the outputs are our derived art,
committed under public/art/probe-swarm/ (src/render/threatArt.ts swarmArtUrl draws them for the swarm's hulls).

    python3 -I scripts/probe-swarm-ships.py [--dwu <DW:U install>] [--out public/art/probe-swarm] [--preview <dir>]

Reads images/units/ships/family*/<file>.png from the install (default public/assets/dwu, the symlink npm run
import-assets makes). Needs Python 3 with numpy and Pillow only. Deterministic (fixed seeds per output).

Per output frame (bow up, as the stock frames):
1. Assembly: stock pieces (whole frames or crops; scaled, rotated, mirrored) layered back to front, each casting a
   soft contact shadow on what is below it. Every piece is reduced to its shading (luminance, levelled per piece so
   the families match) and its own glows (purple bulbs, cyan lamps, red slits ...) are put out to dark sockets.
2. Paint: the shading gradient-mapped onto a cold blue-grey slate ramp, near black in the shadows, highlights
   compressed (worn, not polished).
3. Surface (mirrored about the centre line where the structure is symmetric): plating seams (a recursive panel
   split, a dark seam with a lit lip), panel tone variation, greeble blocks with bevels, vent grilles, conduit runs,
   antenna stubs out of the silhouette.
4. Wear (never mirrored): scuffs and long scratches (bare metal, a little lighter), micro-impacts (dark pit, lit
   rim), chipped edge highlights, grime streaks running aft, faint dust in the recesses.
5. Lights: a few tiny, dim sensor pinpoints in old sockets or dark recesses (never paired, nothing at the bow centre
   or the middle). The Mothercore (a spiked machine cube: dense stock chunks tiled on its three visible faces, two
   raised tiers, the shipset's needles and horns out of every edge) has its seams lit a dim red, baked and also
   written as mothercore-glow.png (threatArt.ts pulses it additively), and unlit orange lamp housings at the six
   corners of its silhouette (MC_LIGHTS; threatArt.ts blinks the lights). Thruster marks (pure blue runs) placed explicitly at the aft of the ships, no nav-light marks, and
   no other pixel left in either marker colour (ambientLayer.ts scanShipMarkers).
Detail sizes are tied to how large each frame is drawn in game (2-3 source px per screen px at the closest zoom), so
the surface reads as intricate up close and as a dark, textured silhouette at play zoom without shimmering.
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

# Glow hue ranges (0..1) to put out, per source family.
KILL = {
    0: [(0.5, 0.7)],
    2: [(0.7, 0.95)],
    10: [(0.08, 0.2)],
    13: [(0.1, 0.2), (0.45, 0.56)],
    15: [(0.95, 1.0), (0.0, 0.05)],
    17: [(0.7, 0.95)],
    19: [(0.75, 0.95)],
    22: [(0.42, 0.6)],
    24: [(0.42, 0.6)],
    25: [(0.42, 0.6)],
}


# ---------------------------------------------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------------------------------------------

def blur(v, r):
    return fblur(v, r)


def fblur(v, r):
    """Gaussian blur of an arbitrary float image (F mode)."""
    if r <= 0:
        return v
    n = int(math.ceil(3 * r))
    k = np.exp(-0.5 * (np.arange(-n, n + 1) / r) ** 2)
    k /= k.sum()
    p = np.pad(v.astype(np.float64), n, mode='constant')
    p = np.apply_along_axis(lambda row: np.convolve(row, k, mode='valid'), 1, p)
    p = np.apply_along_axis(lambda col: np.convolve(col, k, mode='valid'), 0, p)
    return p


def value_noise(rng, h, w, cell, stretch_y=1.0):
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


# ---------------------------------------------------------------------------------------------------------------
# 1. Assembly
# ---------------------------------------------------------------------------------------------------------------

class Piece:
    """A stock frame (or a crop of it) reduced to levelled shading + alpha + socket mask (its put-out glows)."""

    cache = {}

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
        for (h0, h1) in KILL.get(fam, []):
            sock |= (hue >= h0) & (hue <= h1) & (sat > 0.32) & (val > 0.18)
        sock &= alpha > 0.5
        # soften the socket edge: grow by one pixel
        sock_g = np.asarray(Image.fromarray(sock.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(3))) > 0
        sock_g &= alpha > 0.3
        op = alpha > 0.6
        vals = lum[op & ~sock_g]
        p0, p1 = (np.quantile(vals, lo), np.quantile(vals, hi)) if vals.size > 50 else (0.0, 1.0)
        L = np.clip((lum - p0) / max(1e-3, p1 - p0), 0, 1)
        # put-out glows: painted over with the surrounding shading, a little darker (a dead lamp, not a hole)
        keep = (~sock_g & (alpha > 0.5)).astype(np.float64)
        fill = fblur(L * keep, 3.0) / np.maximum(fblur(keep, 3.0), 1e-3)
        L = np.where(sock_g, fill * 0.7 + L * 0.1, L)
        # marker pixels: the neighbours' shading
        if marker.any():
            sm = fblur(L * (~marker), 1.5) / np.maximum(fblur((~marker).astype(np.float64), 1.5), 1e-3)
            L = np.where(marker, sm, L)
        bb = Image.fromarray((alpha * 255).astype(np.uint8)).getbbox()
        p = cls()
        p.L, p.A, p.S = L[bb[1]:bb[3], bb[0]:bb[2]], alpha[bb[1]:bb[3], bb[0]:bb[2]], sock_g[bb[1]:bb[3], bb[0]:bb[2]].astype(np.float64)
        cls.cache[key] = p
        return p

    def transformed(self, scale, rot, flipx, flipy, sx=1.0):
        """(L·A, A, S·A) premultiplied images, scaled / rotated (deg, CCW) about the piece centre."""
        out = []
        for ch in (self.L * self.A, self.A, self.S * self.A):
            im = Image.fromarray(ch.astype(np.float32), 'F')
            if flipx:
                im = im.transpose(Image.FLIP_LEFT_RIGHT)
            if flipy:
                im = im.transpose(Image.FLIP_TOP_BOTTOM)
            w, h = im.size
            nw, nh = max(1, round(w * scale * sx)), max(1, round(h * scale))
            im = im.resize((nw, nh), Image.BICUBIC if scale > 1 else Image.LANCZOS)
            if rot % 360:
                im = im.rotate(rot, resample=Image.BICUBIC, expand=True)
            out.append(np.clip(np.asarray(im).astype(np.float64), 0, None))
        out[1] = np.clip(out[1], 0, 1)
        out[0] = np.minimum(out[0], out[1])
        out[2] = np.minimum(out[2], out[1])
        return out


class Canvas:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.L = np.zeros((h, w))  # premultiplied
        self.A = np.zeros((h, w))
        self.S = np.zeros((h, w))
        self.T = np.zeros((h, w))  # per-piece tone offset (panel variation between pieces)

    def put(self, piece, cx, cy, scale=1.0, rot=0, flipx=False, flipy=False, shadow=0.55, gain=1.0, tone=0.0, mirror=False, sx=1.0):
        for m in ([False, True] if mirror else [False]):
            x = self.w - cx if m else cx
            r = -rot if m else rot
            pl, pa, ps = piece.transformed(scale, r, flipx != m, flipy, sx)
            pl = pl * gain
            ph, pw = pa.shape
            x0, y0 = int(round(x - pw / 2)), int(round(cy - ph / 2))
            full = [np.zeros((self.h, self.w)) for _ in range(3)]
            sx0, sy0 = max(0, -x0), max(0, -y0)
            dx0, dy0 = max(0, x0), max(0, y0)
            dx1, dy1 = min(self.w, x0 + pw), min(self.h, y0 + ph)
            if dx1 <= dx0 or dy1 <= dy0:
                continue
            for k, src in enumerate((pl, pa, ps)):
                full[k][dy0:dy1, dx0:dx1] = src[sy0:sy0 + dy1 - dy0, sx0:sx0 + dx1 - dx0]
            fl, fa, fs = full
            if shadow > 0:
                off = max(1, int(round(3 * scale + 1)))
                sh = fblur(shift(fa, off, off // 2), 2.5 + 2 * scale) * shadow
                self.L *= 1 - sh * (1 - fa)
            inv = 1 - fa
            self.L = fl + self.L * inv
            self.S = fs + self.S * inv
            self.T = fa * tone + self.T * inv
            self.A = fa + self.A * inv

    def result(self):
        a = np.maximum(self.A, 1e-6)
        return np.clip(self.L / a, 0, 1), self.A, np.clip(self.S / a, 0, 1), self.T


# ---------------------------------------------------------------------------------------------------------------
# 2-5. Paint, surface, wear, lights
# ---------------------------------------------------------------------------------------------------------------

# Slate ramp (luminance → linear-ish sRGB 0..1): cold blue-grey, near black in shadow.
RAMP_X = np.array([0.0, 0.1, 0.28, 0.5, 0.72, 0.9, 1.0])
RAMP_C = np.array([
    [0.012, 0.015, 0.021],
    [0.052, 0.061, 0.078],
    [0.132, 0.149, 0.178],
    [0.255, 0.280, 0.322],
    [0.390, 0.418, 0.462],
    [0.530, 0.560, 0.605],
    [0.660, 0.690, 0.730],
])
METAL = np.array([0.50, 0.53, 0.56])  # bare metal in scratches
DUST = np.array([0.30, 0.31, 0.315])
GRIME = np.array([0.025, 0.027, 0.03])
SENSOR = np.array([0.62, 0.86, 0.80])  # cold teal pinpoints
EMBER = np.array([0.95, 0.42, 0.14])
SEAM_RED = np.array([0.62, 0.075, 0.05])   # the Mothercore's seam glow: dim red, not neon
LAMP_LENS = np.array([0.42, 0.20, 0.06])  # an unlit orange lamp


def ramp(v):
    out = np.empty(v.shape + (3,))
    for c in range(3):
        out[..., c] = np.interp(v, RAMP_X, RAMP_C[:, c])
    return out


def split_panels(rng, x0, y0, x1, y1, minw, maxw, out):
    """Recursive split of a rectangle into plates (axis aligned, bow up)."""
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


def paint(name, L, A, S, T, spec, seed, G=None):
    """Slate paint + surface detail + wear on an assembled frame. Returns RGBA uint8."""
    h, w = L.shape
    rng = np.random.default_rng(seed)
    u = spec['unit']  # source px per screen px at the closest zoom (detail scale)
    solid = A > 0.55
    depth = depth_inside(A > 0.5, 12)
    cxm = w / 2

    # ---- structural detail maps, built on the left half and mirrored when symmetric
    sym = spec.get('sym', True)
    seam = np.zeros((h, w))      # dark seam lines
    lip = np.zeros((h, w))       # lit lip beside a seam
    ptone = np.zeros((h, w))     # plate tone offset
    greeb = np.zeros((h, w))     # greeble darkening / lightening (+ light, - dark)
    hw = int(math.ceil(w / 2)) if sym else w

    panels = []
    split_panels(rng, 0, 0, hw, h, max(3, int(3.2 * u)), max(8, int(14 * u)), panels)
    for (x0, y0, x1, y1) in panels:
        t = rng.normal(0, 0.05)
        ptone[y0:y1, x0:x1] = t
        if rng.random() < 0.75:
            seam[y0, x0:x1] = 1  # top edge
            if y0 + 1 < h:
                lip[y0 + 1, x0:x1] = 1
        if rng.random() < 0.75:
            seam[y0:y1, x0] = 1  # left edge
            if x0 + 1 < w:
                lip[y0:y1, x0 + 1] = 0.6
        # greebles: small bevelled blocks inside some plates
        pw, ph = x1 - x0, y1 - y0
        if pw > 4 and ph > 4 and rng.random() < 0.45:
            for _ in range(int(rng.integers(1, 4))):
                gw_ = int(rng.integers(2, max(3, min(pw - 1, int(4 * u)))))
                gh_ = int(rng.integers(2, max(3, min(ph - 1, int(4 * u)))))
                gx = int(rng.integers(x0 + 1, max(x0 + 2, x1 - gw_)))
                gy = int(rng.integers(y0 + 1, max(y0 + 2, y1 - gh_)))
                lift = rng.choice([-1, 1])
                greeb[gy:gy + gh_, gx:gx + gw_] += 0.05 * lift
                greeb[gy, gx:gx + gw_] += 0.09          # lit top bevel
                greeb[gy:gy + gh_, gx] += 0.05           # lit left bevel
                greeb[min(h - 1, gy + gh_), gx:gx + gw_] -= 0.12  # shadow below
                greeb[gy:gy + gh_ + 1, min(w - 1, gx + gw_)] -= 0.08
        # vent grilles
        if pw > 6 and ph > 6 and rng.random() < 0.18:
            n = int(rng.integers(3, 6))
            gx = int(rng.integers(x0 + 1, max(x0 + 2, x1 - 2 * n)))
            gy = int(rng.integers(y0 + 1, max(y0 + 2, y1 - 4)))
            ln = int(min(y1 - gy - 1, rng.integers(3, max(4, int(4 * u)))))
            for k in range(n):
                xx = gx + 2 * k
                if xx < w:
                    greeb[gy:gy + ln, xx] -= 0.16
                    if xx + 1 < w:
                        greeb[gy:gy + ln, xx + 1] += 0.05
    # conduits: vertical runs with jogs, 1-2 px, lit left edge
    for _ in range(int(spec.get('conduits', 3))):
        x = int(rng.integers(2, max(3, hw - 2)))
        y = int(rng.integers(0, h // 3))
        y_end = int(rng.integers(h // 2, h))
        wd = 1 + int(rng.random() < 0.4)
        while y < y_end:
            seg = int(rng.integers(6, 30))
            greeb[y:min(h, y + seg), x:x + wd] -= 0.10
            if x - 1 >= 0:
                greeb[y:min(h, y + seg), x - 1] += 0.07
            y += seg
            if rng.random() < 0.5:
                nx = int(np.clip(x + rng.integers(-6, 7), 1, hw - 2))
                lo_, hi_ = sorted((x, nx))
                greeb[min(h - 1, y), lo_:hi_ + wd] -= 0.10
                x = nx
    if sym:
        for m in (seam, lip, ptone, greeb):
            left = m[:, :hw].copy()
            m[:, w - hw:] = left[:, ::-1][:, :hw]
    # structure only where the hull is solid, away from the very edge; seams fade where the stock shading is busy
    grad = np.abs(np.gradient(blur(L, 0.7))[0]) + np.abs(np.gradient(blur(L, 0.7))[1])
    calm = np.clip(1.5 - grad * 12, 0.0, 1)
    inner = (depth >= 2).astype(np.float64)
    seam_m = seam * inner * calm * np.clip((fbm(rng, h, w, max(4, int(6 * u))) - 0.3) * 2.5, 0, 1)
    lip_m = lip * inner * calm

    # ---- base paint
    # crisper relief (local contrast), compressed highlights (worn, not polished)
    v = np.clip(L + 0.55 * (L - blur(L, 2.5 * u / 2.4)), 0, 1)
    v = np.where(v > 0.62, 0.62 + (v - 0.62) * 0.75, v)
    v = v * (1 + ptone * (0.3 + 0.7 * calm) * inner + T) + greeb * inner * (0.6 + 0.6 * v)
    v = v * (1 - 0.5 * seam_m) + 0.06 * lip_m * calm * (0.4 + v)
    # key light from the upper left on the silhouette: a lit rim facing it, a darker rim away from it
    gy_, gx_ = np.gradient(blur(A, 1.2))
    nrm = np.sqrt(gx_ ** 2 + gy_ ** 2) + 1e-6
    facing = (gx_ + gy_) / nrm / math.sqrt(2)  # +1 where the outward normal points up-left (alpha rises down-right)
    band = ((depth >= 1) & (depth <= 3)).astype(np.float64)
    v = v + band * np.clip(facing, 0, 1) * 0.16 - band * np.clip(-facing, 0, 1) * 0.10 * v
    v = np.clip(v, 0, 1)
    rgb = ramp(v)
    # large-scale tone: slightly mismatched plates / a cooler cast in places
    big = fbm(rng, h, w, max(8, int(20 * u)))
    rgb *= (0.9 + 0.2 * big)[..., None]
    rgb[..., 2] *= 1 + 0.05 * (big - 0.5)

    # ---- wear (not mirrored)
    # dust in recesses, broad and faint
    dustn = fbm(rng, h, w, max(6, int(10 * u)))
    dust = np.clip((dustn - 0.45) * 2.2, 0, 1) * np.clip(0.55 - v, 0, 1) * 0.35 * inner
    rgb = rgb * (1 - dust[..., None]) + DUST * dust[..., None] * (0.35 + v[..., None])
    # grime streaks running aft
    streak = fbm(rng, h, w, max(3, int(3 * u)), stretch_y=5.0)
    gr = np.clip((streak - 0.55) * 3, 0, 1) * 0.35 * inner
    rgb = rgb * (1 - gr[..., None]) + GRIME * gr[..., None]
    # chipped edge highlights: silhouette rim and stock ridges
    rim = ((depth >= 1) & (depth <= 2)).astype(np.float64)
    ridge = np.clip(grad * 6 - 0.4, 0, 1) * (v > 0.35)
    chip = np.clip((fbm(rng, h, w, max(2, int(2 * u))) - 0.48) * 4, 0, 1)
    ew = np.clip(rim * 0.5 + ridge * 0.35, 0, 1) * chip * solid
    rgb = rgb + (METAL - rgb) * (ew * 0.35)[..., None]
    # scratches: thin lines, mostly in two directions, bare metal (or dark gouges)
    scr = np.zeros((h, w))
    n_scr = int(spec.get('scratches', 1.0) * (A > 0.5).sum() / (14 * u * u))
    base_ang = rng.uniform(0, math.pi)
    wear_pts = np.argwhere(solid & (depth >= 2))
    for _ in range(n_scr if len(wear_pts) else 0):
        y, x = wear_pts[int(rng.integers(len(wear_pts)))]
        ang = base_ang + (rng.choice([0, math.pi / 2.3]) + rng.normal(0, 0.18))
        ln = rng.uniform(2, 9) * u * (1 + 2 * (rng.random() < 0.12))
        xs, ys = line_px(x, y, x + math.cos(ang) * ln, y + math.sin(ang) * ln)
        ok = (xs >= 0) & (xs < w) & (ys >= 0) & (ys < h)
        xs, ys = xs[ok], ys[ok]
        s = rng.uniform(0.25, 0.7) * (1 if rng.random() < 0.8 else -1)
        scr[ys, xs] = s
        if rng.random() < 0.3:  # a deeper gouge: two px wide, so it still reads at the closest zoom
            ys2 = np.clip(ys + 1, 0, h - 1)
            scr[ys2, xs] = s * 0.8
    scr *= solid
    pos = np.clip(scr, 0, 1)
    neg = np.clip(-scr, 0, 1)
    rgb = rgb + (METAL - rgb) * (pos * 0.75)[..., None]
    rgb = rgb * (1 - 0.6 * neg)[..., None]
    # scuffs: small rubbed patches (lighter, soft)
    sc = np.clip((fbm(rng, h, w, max(2, int(2.5 * u)), octaves=2) - 0.62) * 5, 0, 1) * inner * 0.18
    rgb = rgb + (METAL * 0.8 - rgb) * sc[..., None]
    # paint chips: small irregular bare flecks on the raised (lit) plating, a dark speck beside some
    n_chip = int(spec.get('scratches', 1.0) * (A > 0.5).sum() / (12 * u * u))
    for _ in range(n_chip if len(wear_pts) else 0):
        y, x = wear_pts[int(rng.integers(len(wear_pts)))]
        if v[y, x] < 0.25:
            continue
        cw, ch = int(rng.integers(1, 3)), int(rng.integers(1, 3))
        k = rng.uniform(0.35, 0.7)
        rgb[y:y + ch, x:x + cw] = rgb[y:y + ch, x:x + cw] + (METAL - rgb[y:y + ch, x:x + cw]) * k
        if rng.random() < 0.5:
            rgb[min(h - 1, y + ch), x:x + cw] *= 0.6
    # micro-impacts: dark pit, lit lower-right rim
    n_imp = int(spec.get('impacts', 1.0) * (A > 0.5).sum() / (60 * u * u))
    for _ in range(n_imp):
        y, x = int(rng.integers(1, h - 2)), int(rng.integers(1, w - 2))
        if depth[y, x] < 3:
            continue
        r = 1 if rng.random() < 0.7 else 2
        rgb[min(h - 1, y + r), x:x + r + 1] = np.minimum(1, rgb[min(h - 1, y + r), x:x + r + 1] * 1.5 + 0.03)
        rgb[y:y + r, x:x + r] *= 0.35
    # a few larger dents / breaches on the bigger frames
    for _ in range(int(spec.get('breaches', 0))):
        cand = np.argwhere((depth >= 7) & solid)
        if len(cand) == 0:
            break
        y, x = cand[int(rng.integers(len(cand)))]
        r = rng.uniform(2.2, 3.5) * u
        yy, xx = np.mgrid[0:h, 0:w]
        ang = np.arctan2(yy - y, xx - x)
        jag = 1 + 0.3 * np.sin(ang * 3 + rng.uniform(0, 6.3)) + 0.18 * np.sin(ang * 7 + rng.uniform(0, 6.3))
        d = np.sqrt((yy - y) ** 2 + (xx - x) ** 2) / (r * jag)
        hole = (d < 1) & solid
        burn = (d >= 1) & (d < 2.2) & solid
        rgb[burn] *= (0.5 + 0.5 * np.clip((d[burn] - 1) / 1.2, 0, 1))[:, None]
        litm = (d >= 1) & (d < 1.35) & ((xx - x) + (yy - y) < 0) & solid
        rgb[litm] = np.minimum(1, rgb[litm] * 1.5 + 0.04)
        rgb[hole] = GRIME * 0.6
    # old sockets (the stock glows, put out): dark, a faint cold sheen
    sk = blur(S, 0.6) * solid
    rgb = rgb * (1 - 0.5 * sk)[..., None]

    # ---- antenna stubs out of the silhouette (thin, few)
    alpha = A.copy()
    stub_c = ramp(np.array([0.32]))[0]
    tips = []
    edge_pts = np.argwhere((depth == 1) & (A > 0.5))
    for _ in range(int(spec.get('stubs', 4)) * 40):
        if len(tips) >= int(spec.get('stubs', 4)) or len(edge_pts) == 0:
            break
        y, x = edge_pts[int(rng.integers(len(edge_pts)))]
        if sym and x > cxm:
            continue
        dy_, dx_ = y - h / 2, x - w / 2
        rr = math.hypot(dx_, dy_)
        if rr < 0.3 * min(w, h) / 2 or y < h * 0.12:
            continue
        if any(math.hypot(x - tx, y - ty) < 0.15 * w for tx, ty in tips):
            continue
        ang = math.atan2(dy_, dx_) + rng.normal(0, 0.25)
        ln = rng.uniform(4, 9) * u
        ex, ey = x + math.cos(ang) * ln, y + math.sin(ang) * ln
        if not (2 < ex < w - 3 and 2 < ey < h - 3):
            continue
        tips.append((x, y))
        for mx in ([False, True] if sym else [False]):
            x0_, ex_ = (w - 1 - x, w - 1 - ex) if mx else (x, ex)
            xs, ys = line_px(x0_, y, ex_, ey)
            for k, (px_, py_) in enumerate(zip(xs, ys)):
                if 0 <= px_ < w and 0 <= py_ < h:
                    if alpha[py_, px_] < 0.5:
                        rgb[py_, px_] = stub_c * (0.8 + 0.3 * (k % 3 == 0))
                    alpha[py_, px_] = max(alpha[py_, px_], 0.95)
            # small knob at the tip
            tx_, ty_ = int(round(ex_)), int(round(ey))
            for oy in (0, 1):
                for ox in (0, 1):
                    if 0 <= tx_ + ox < w and 0 <= ty_ + oy < h:
                        rgb[ty_ + oy, tx_ + ox] = stub_c * 0.7
                        alpha[ty_ + oy, tx_ + ox] = 1

    # ---- sensor pinpoints: a few tiny dim lights in old sockets / dark recesses, never paired, none at the bow
    lights = []
    sock_pts = np.argwhere((S > 0.5) & (depth >= 3))
    rec_pts = np.argwhere((v < 0.18) & (depth >= 4))
    pool = sock_pts if len(sock_pts) > 10 else rec_pts
    want = int(spec.get('pinpoints', 3))
    for _ in range(want * 60):
        if len(lights) >= want or len(pool) == 0:
            break
        y, x = pool[int(rng.integers(len(pool)))]
        if y < h * 0.3 and abs(x - cxm) < w * 0.3:
            continue  # nothing that could read as a face at the bow
        if math.hypot(x - cxm, y - h / 2) < 0.14 * min(w, h):
            continue  # nor a pupil in the middle
        if any(math.hypot(x - lx, y - ly) < 0.22 * min(w, h) for lx, ly in lights):
            continue
        if any(abs(y - ly) < 0.06 * h and abs((w - 1 - x) - lx) < 0.08 * w for lx, ly in lights):
            continue  # no mirrored pairs
        lights.append((x, y))
    for (x, y) in lights:
        col = SENSOR if rng.random() < 0.7 else EMBER
        rgb[y, x] = rgb[y, x] * 0.3 + col * 0.55
        for (oy, ox) in ((0, 1), (1, 0), (0, -1), (-1, 0)):
            if 0 <= y + oy < h and 0 <= x + ox < w:
                rgb[y + oy, x + ox] = rgb[y + oy, x + ox] * 0.75 + col * 0.12

    glow = None
    if spec.get('redseams') and G is not None:
        # seams / panel gaps lit a dim red from inside (baked; threatArt.ts pulses a faint additive copy over them)
        gm = np.clip(G * (0.55 + 0.45 * fbm(rng, h, w, max(3, int(4 * u)))), 0, 1) * (A > 0.5)
        gm = np.maximum(gm, 0.35 * seam_m)  # the plating seams too, fainter
        core = blur(gm, 0.6)
        rgb = rgb * (1 - 0.5 * core[..., None]) + SEAM_RED * (core * 0.85)[..., None]
        halo = np.clip(blur(gm, 2.2) * 1.6, 0, 1) * (A > 0.3)
        glow = np.zeros((h, w, 4))
        glow[..., :3] = SEAM_RED
        glow[..., 3] = np.clip(halo * 0.32 + core * 0.45, 0, 1)
    for (lx, ly) in spec.get('lamps', []):
        # an unlit lamp housing: a dark ring with a dim orange lens (threatArt.ts blinks the light over it)
        for oy in range(-2, 3):
            for ox in range(-2, 3):
                r_ = math.hypot(ox, oy)
                if r_ <= 2.4 and 0 <= ly + oy < h and 0 <= lx + ox < w:
                    rgb[ly + oy, lx + ox] = LAMP_LENS if r_ <= 1.1 else rgb[ly + oy, lx + ox] * 0.35

    out = np.zeros((h, w, 4))
    out[..., :3] = np.clip(rgb, 0, 1)
    out[..., 3] = alpha
    r8 = np.round(out * 255).astype(np.uint8)
    r8[r8[..., 3] < 6] = 0
    # no accidental marker colours, then the explicit marks
    acc = (r8[..., 3] > 0) & (((r8[..., 0] == 0) & (r8[..., 1] == 0) & (r8[..., 2] == 255)) | ((r8[..., 0] == 255) & (r8[..., 1] == 255) & (r8[..., 2] == 0)))
    r8[acc, 2] = np.where(r8[acc, 2] > 0, r8[acc, 2] - 1, 1)
    thr = spec.get('thrusters', 'auto')
    if thr == 'auto':
        # one engine run on the aft-most solid row near the centre line (inside the hull, a pixel up from the edge)
        thr = []
        band = np.abs(np.arange(w) - (w - 1) / 2) <= max(2, w * 0.035)
        rows = np.nonzero(((r8[..., 3] == 255) & band[None, :]).any(1))[0]
        for y in range(int(rows.max()) - 1 if len(rows) else -1, h // 2, -1):
            xs_ = np.nonzero((r8[y, :, 3] == 255) & band)[0]
            if len(xs_) >= 3:
                thr = [(int(xs_.min()), int(xs_.max()), y)]
                break
    for (x0, x1, y) in thr:
        for x in range(x0, x1 + 1):
            if r8[y, x, 3] > 0:
                r8[y, x] = (0, 0, 255, 255)
    for (x, y) in spec.get('navlights', []):
        if r8[y, x, 3] > 0:
            r8[y, x] = (255, 255, 0, 255)
    g8 = None if glow is None else np.round(np.clip(glow, 0, 1) * 255).astype(np.uint8)
    return r8, lights, g8


# ---------------------------------------------------------------------------------------------------------------
# The Mothercore: a spiked machine cube
# ---------------------------------------------------------------------------------------------------------------

# Cube layout in the 480 px frame: the top face, and the oblique offset of the south / east faces (seen from above,
# a little from the south-east, so it reads as a block and not a flat square).
MC_SIZE = 480
MC_TOP = (104, 100, 254)    # top face x0, y0, side
MC_OBL = (26, 44)           # oblique offset of the lower faces (dx, dy)
# Positional lights (orange blink, threatArt.ts MOTHERCORE_LIGHTS must match): the six silhouette corners, inset.
MC_LIGHTS = [(110, 106), (352, 106), (380, 152), (380, 393), (136, 393), (110, 350)]
DENSE = [(22, 'frigate'), (22, 'cruiser'), (22, 'destroyer'), (22, 'genericbase'), (24, 'destroyer'), (24, 'genericbase'),
         (25, 'smallspaceport'), (17, 'genericbase'), (17, 'smallspaceport'), (13, 'gasminingstation'), (0, 'genericbase')]
_dense_cache = {}


def dense_windows(root, fam, name, cs):
    """Top-left corners of every fully opaque cs × cs window of a stock frame (machinery to tile a cube face with)."""
    key = (fam, name, cs)
    if key not in _dense_cache:
        a = np.asarray(Image.open(os.path.join(root, f'family{fam}', name + '.png')).convert('RGBA'))[..., 3] > 240
        ii = np.pad(a.astype(np.int32).cumsum(0).cumsum(1), ((1, 0), (1, 0)))
        s = ii[cs:, cs:] - ii[:-cs, cs:] - ii[cs:, :-cs] + ii[:-cs, :-cs]
        _dense_cache[key] = np.argwhere(s == cs * cs)
    return _dense_cache[key]


def machine_face(root, rng, S, cell):
    """A square of dense machinery: stock chunks tiled on a grid (some 2 × 2), each turned / flipped / toned, with
    the gaps between them as seams. Returns (L, A, S, G) of S × S (G: the seam lines, 0..1)."""
    c = Canvas(S, S)
    n = S // cell
    used = np.zeros((n, n), bool)
    G = np.zeros((S, S))
    tiles = []
    for j in range(n):
        for i in range(n):
            if used[j, i]:
                continue
            k = 2 if (i + 1 < n and j + 1 < n and not used[j:j + 2, i:i + 2].any() and rng.random() < 0.28) else 1
            used[j:j + k, i:i + k] = True
            tiles.append((i * cell, j * cell, k * cell))
    for (x, y, t) in tiles:
        for _ in range(30):
            fam, name = DENSE[int(rng.integers(len(DENSE)))]
            sc = rng.uniform(0.75, 1.15)
            cs = int(round((t + 4) / sc))
            win = dense_windows(root, fam, name, cs)
            if len(win):
                break
        else:
            continue
        wy, wx = win[int(rng.integers(len(win)))]
        piece = Piece.load(root, fam, name, (int(wx), int(wy), int(wx) + cs, int(wy) + cs))
        gain = rng.uniform(0.78, 1.05) if rng.random() > 0.2 else rng.uniform(0.5, 0.65)  # some recessed
        c.put(piece, x + t / 2, y + t / 2, sc, 90 * int(rng.integers(4)), flipx=rng.random() < 0.5, shadow=0, gain=gain)
        # seams on this tile's top / left edges (the grid gaps); a few glow brighter, a few not at all
        for (ys, xs) in ((slice(y, y + 2), slice(x, x + t)), (slice(y, y + t), slice(x, x + 2))):
            G[ys, xs] = np.maximum(G[ys, xs], rng.choice([0.0, 0.5, 0.8, 1.0], p=[0.3, 0.25, 0.25, 0.2]))
    # the glow comes and goes along each seam (dead stretches, brighter leaks)
    G *= np.clip((fbm(rng, S, S, max(4, cell // 3)) - 0.3) * 3.0, 0, 1)
    L, A, Sk, _ = c.result()
    gap = G > 0
    L = np.where(gap, L * 0.25, L)
    return L, np.ones((S, S)), Sk, G


def sample(img, X, Y):
    """Bilinear sample of a 2-D array at float coords (outside → 0)."""
    h, w = img.shape
    x0 = np.floor(X).astype(int)
    y0 = np.floor(Y).astype(int)
    fx, fy = X - x0, Y - y0
    out = np.zeros(X.shape)
    for dy_, wy in ((0, 1 - fy), (1, fy)):
        for dx_, wx in ((0, 1 - fx), (1, fx)):
            xx, yy = x0 + dx_, y0 + dy_
            ok = (xx >= 0) & (xx < w) & (yy >= 0) & (yy < h)
            out += np.where(ok, img[np.clip(yy, 0, h - 1), np.clip(xx, 0, w - 1)], 0) * wx * wy
    return out


def warp_face(arrs, S, W, H, origin, ex, ey):
    """Map S × S face arrays onto the parallelogram origin + u·ex + v·ey (u, v ∈ [0, 1]) of a W × H canvas."""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64) + 0.5
    px, py = xx - origin[0], yy - origin[1]
    det = ex[0] * ey[1] - ex[1] * ey[0]
    u = (px * ey[1] - py * ey[0]) / det
    v = (py * ex[0] - px * ex[1]) / det
    inside = (u >= 0) & (u <= 1) & (v >= 0) & (v <= 1)
    out = [np.where(inside, sample(a, u * S - 0.5, v * S - 0.5), 0) for a in arrs]
    # anti-aliased coverage from the distance to the parallelogram edges (px)
    el, eh = math.hypot(*ex), math.hypot(*ey)
    du = np.minimum(u, 1 - u) * abs(det) / eh
    dv = np.minimum(v, 1 - v) * abs(det) / el
    cov = np.clip(np.minimum(du, dv) + 0.5, 0, 1) * ((u > -0.05) & (u < 1.05) & (v > -0.05) & (v < 1.05))
    return out, cov


def build_mothercore(root):
    rng = np.random.default_rng(zlib.crc32(b'probe-swarm:mothercore-cube'))
    W = H = MC_SIZE
    c = Canvas(W, H)
    c.G = np.zeros((H, W))
    x0, y0, T = MC_TOP
    dx, dy = MC_OBL
    needle = Piece.load(root, 25, 'escort')
    horns = Piece.load(root, 15, 'miningstation')
    hornpair = Piece.load(root, 15, 'miningstation', (40, 0, 170, 96))  # the two upper horns, curving out
    # spikes first (behind the block): out of every outer edge a horn pair in the middle and slim needles beside it,
    # and at the four outer corners a claw cluster with a long needle through it
    outline = [((x0, y0), (x0 + T, y0), (0, -1)), ((x0, y0), (x0, y0 + T), (-1, 0)),
               ((x0 + T + dx, y0 + dy), (x0 + T + dx, y0 + T + dy), (1, 0)), ((x0 + dx, y0 + T + dy), (x0 + T + dx, y0 + T + dy), (0, 1))]

    def spike(piece, ex_, ey_, ang, sc, sx, sink, gain):
        ln = piece.A.shape[0] * sc
        c.put(piece, ex_ + math.cos(math.radians(ang)) * (ln / 2 - sink), ey_ - math.sin(math.radians(ang)) * (ln / 2 - sink),
              sc, ang - 90, shadow=0, gain=gain, sx=sx)

    for (a, b, (nx, ny)) in outline:
        base = math.degrees(math.atan2(-ny, nx))
        for t in (0.2, 0.38, 0.62, 0.8):
            t += rng.uniform(-0.04, 0.04)
            spike(needle, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, base + rng.uniform(-12, 12), rng.uniform(0.55, 0.8), 0.42, 14, rng.uniform(0.8, 1.0))
        spike(hornpair, a[0] + (b[0] - a[0]) * 0.5, a[1] + (b[1] - a[1]) * 0.5, base, rng.uniform(0.7, 0.85), 1.0, 22, 0.9)
    for (px_, py_, ang) in ((x0, y0, 135), (x0 + T + dx, y0 + dy, 45), (x0 + T + dx, y0 + T + dy, -45), (x0 + dx, y0 + T + dy, -135)):
        spike(horns, px_, py_, ang, 0.6, 1.0, 40, 0.85)
        spike(needle, px_, py_, ang, 0.95, 0.45, 10, 0.95)

    def put_face(S, cell, origin, ex, ey, gain, shadow):
        L, A, Sk, G = machine_face(root, rng, S, cell)
        (L, Sk, G), cov = warp_face([L, Sk, G], S, W, H, origin, ex, ey)
        if shadow > 0:
            sh = fblur(shift(cov, 6, 4), 5) * shadow
            c.L *= 1 - sh * (1 - cov)
        inv = 1 - cov
        c.L = L * gain * cov + c.L * inv
        c.S = Sk * cov + c.S * inv
        c.T = c.T * inv
        c.A = cov + c.A * inv
        c.G = G * cov + c.G * inv
        return cov

    # the block: south and east faces (in shade), then the lit top face with a crease along its lower edges
    put_face(256, 32, (x0, y0 + T), (T, 0), (dx, dy), 0.62, 0)
    put_face(256, 32, (x0 + T, y0), (dx, dy), (0, T), 0.44, 0)
    put_face(256, 32, (x0, y0), (T, 0), (0, T), 0.95, 0)
    # the block's edges: a worn lit lip on the top face's north / west edges, a dark crease where it meets the sides
    E = np.zeros((H, W))
    E[y0:y0 + 3, x0:x0 + T] = 1
    E[y0:y0 + T, x0:x0 + 3] = 1
    D = np.zeros((H, W))
    D[y0 + T - 2:y0 + T + 2, x0:x0 + T + 2] = 1
    D[y0:y0 + T + 2, x0 + T - 2:x0 + T + 2] = 1
    Lc = c.L / np.maximum(c.A, 1e-6)
    Lc = np.clip(Lc + E * 0.22, 0, 1) * (1 - 0.6 * D)
    c.L = Lc * c.A
    c.G = np.maximum(c.G, D * 0.6 * (rng.random((H, W)) > 0.5))
    # two raised tiers on the top face (smaller blocks of their own, casting shadows): Borg-like layering
    for (side, ox, oy, k) in ((128, x0 + 30, y0 + 40, 0.18), (64, x0 + 140, y0 + 150, 0.12)):
        odx, ody = int(dx * k * 2), int(dy * k * 2)
        put_face(128, 32, (ox, oy + side), (side, 0), (odx, ody), 0.55, 0.0)
        put_face(128, 32, (ox + side, oy), (odx, ody), (0, side), 0.42, 0.0)
        put_face(128, 32, (ox, oy), (side, 0), (0, side), 1.0, 0.6)
    spec = dict(unit=2.2, conduits=4, stubs=0, pinpoints=0, scratches=0.6, impacts=1.3, sym=False, thrusters=[],
                redseams=1.0, lamps=MC_LIGHTS)
    return c, spec


# ---------------------------------------------------------------------------------------------------------------
# The set
# ---------------------------------------------------------------------------------------------------------------

def polar(c, r, ang):
    return c + r * math.cos(math.radians(ang)), c - r * math.sin(math.radians(ang))


def build(root, name):
    P = lambda fam, f, crop=None: Piece.load(root, fam, f, crop)  # noqa: E731
    if name == 'mothercore':
        return build_mothercore(root)
    if name == 'escort':
        # Ring drone: a ring hull spitted on a long sensor needle.
        c = Canvas(200, 200)
        ring = P(13, 'escort')
        needle = P(25, 'escort')
        c.put(ring, 100, 108, 0.82, 0, shadow=0)
        c.put(needle, 100, 100, 1.25, 0, shadow=0.6, gain=1.05)
        spec = dict(unit=2.4, conduits=1, stubs=2, pinpoints=1, scratches=1.0, thrusters='auto')
        return c, spec
    if name == 'frigate':
        # Wasp: a swept, clawed forebody on a long segmented abdomen, short legs at the waist.
        c = Canvas(260, 260)
        fore = P(17, 'frigate')
        tail = P(0, 'explorationship')
        legs = P(15, 'gasminingstation')
        c.put(legs, 130, 118, 0.6, 0, shadow=0, gain=0.8)
        c.put(tail, 130, 168, 0.95, 0, flipy=True, shadow=0, gain=0.9)
        c.put(fore, 130, 92, 0.85, 0, shadow=0.6)
        spec = dict(unit=2.6, conduits=2, stubs=2, pinpoints=2, scratches=1.0)
        return c, spec
    if name == 'destroyer':
        # Mantis: a tall spined body, long raptorial arms folded forward, short claw legs aft.
        c = Canvas(280, 280)
        body = P(2, 'destroyer')
        arm = P(0, 'explorationship')
        legs = P(15, 'miningstation')
        c.put(legs, 140, 178, 0.7, 0, shadow=0, gain=0.8)
        c.put(arm, 100, 84, 0.72, 26, shadow=0, gain=0.95, mirror=True)
        c.put(body, 140, 146, 1.0, 0, shadow=0.6)
        spec = dict(unit=2.6, conduits=2, stubs=2, pinpoints=2, scratches=1.0)
        return c, spec
    if name == 'cruiser':
        # Beetle: a heavy segmented carapace, mandibles forward, legs, a spined sensor ball aft.
        c = Canvas(340, 340)
        shell = P(22, 'frigate')
        jaws = P(15, 'miningstation')
        legs = P(15, 'gasminingstation')
        ball = P(2, 'genericbase')
        c.put(legs, 170, 190, 1.15, 0, shadow=0, gain=0.8)
        c.put(jaws, 170, 85, 0.85, 0, shadow=0, gain=0.8)
        c.put(ball, 170, 270, 0.6, 180, shadow=0)
        c.put(shell, 170, 180, 0.95, 0, shadow=0.6)
        spec = dict(unit=2.4, conduits=3, stubs=3, pinpoints=3, scratches=1.1)
        return c, spec
    if name == 'explorer':
        # Long-range probe: a slim segmented sensor body on a long needle mast, a cross of short needles aft.
        c = Canvas(220, 220)
        mast = P(25, 'escort')
        body = P(22, 'explorationship')
        needles = P(0, 'smallspaceport')
        c.put(needles, 110, 150, 0.55, 0, shadow=0, gain=0.85)
        c.put(mast, 110, 104, 1.3, 0, shadow=0, gain=0.95)
        c.put(body, 110, 120, 0.95, 0, shadow=0.6)
        spec = dict(unit=2.4, conduits=1, stubs=2, pinpoints=1, scratches=1.0)
        return c, spec
    if name == 'constructor':
        # Fabricator: a long segmented hull with two manipulator needles at the bow and a spiked seed pod aft.
        c = Canvas(240, 240)
        hull = P(24, 'destroyer')
        arm = P(25, 'escort')
        seed = P(2, 'explorationship')
        c.put(arm, 104, 62, 0.62, 14, shadow=0, gain=0.85, mirror=True)
        c.put(seed, 120, 190, 0.95, 180, shadow=0, gain=0.9)
        c.put(hull, 120, 122, 0.95, 0, shadow=0.6)
        spec = dict(unit=2.4, conduits=2, stubs=3, pinpoints=2, scratches=1.0)
        return c, spec
    if name == 'miningprobe':
        # Mining probe: a compact drone body with a claw drill head.
        c = Canvas(180, 180)
        body = P(2, 'explorationship')
        drill = P(15, 'miningstation')
        c.put(drill, 90, 70, 0.42, 0, shadow=0, gain=0.8)
        c.put(body, 90, 100, 1.2, 0, shadow=0.6)
        spec = dict(unit=2.4, conduits=1, stubs=2, pinpoints=1, scratches=1.0)
        return c, spec
    if name == 'miningstation':
        # Mining rig: a spiked processing cluster on a boom, claw drills below.
        c = Canvas(260, 260)
        drills = P(15, 'miningstation')
        rig = P(2, 'miningstation')
        boom = P(24, 'genericbase')
        c.put(boom, 130, 130, 0.85, 90, shadow=0, gain=0.85)
        c.put(drills, 130, 140, 0.95, 0, shadow=0.4, gain=0.8)
        c.put(rig, 130, 125, 1.25, 0, shadow=0.6)
        spec = dict(unit=2.6, conduits=1, stubs=4, pinpoints=2, scratches=1.0, sym=False, navlights=[], thrusters=[])
        return c, spec
    if name == 'gasminingstation':
        # Gas tap: a four-lobed diamond over four collector pods, four long intake masts.
        c = Canvas(260, 260)
        pods = P(13, 'gasminingstation')
        top = P(17, 'smallspaceport')
        mast = P(25, 'escort')
        for ang in (0, 90):
            c.put(mast, 130, 130, 1.45, ang, shadow=0, gain=0.9)
        c.put(pods, 130, 130, 1.05, 45, shadow=0.3, gain=0.85)
        c.put(top, 130, 130, 0.78, 0, shadow=0.6)
        spec = dict(unit=2.6, conduits=1, stubs=4, pinpoints=2, scratches=1.0, thrusters=[])
        return c, spec
    raise KeyError(name)


FILES = ['mothercore', 'escort', 'frigate', 'destroyer', 'cruiser', 'explorer', 'constructor', 'miningprobe', 'miningstation', 'gasminingstation']


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dwu', default=os.path.join(GAME, 'public', 'assets', 'dwu'))
    ap.add_argument('--out', default=os.path.join(GAME, 'public', 'art', 'probe-swarm'))
    ap.add_argument('--preview', default=None)
    ap.add_argument('--only', default=None)
    args = ap.parse_args()
    root = os.path.join(args.dwu, 'images', 'units', 'ships')
    os.makedirs(args.out, exist_ok=True)
    made = []
    for name in FILES:
        if args.only and name not in args.only.split(','):
            continue
        c, spec = build(root, name)
        L, A, S, T = c.result()
        r8, lights, g8 = paint(name, L, A, S, T, spec, zlib.crc32(('probe-swarm:' + name).encode()), getattr(c, 'G', None))
        img = Image.fromarray(r8, 'RGBA')
        img.save(os.path.join(args.out, name + '.png'), optimize=True)
        if g8 is not None:
            Image.fromarray(g8, 'RGBA').save(os.path.join(args.out, name + '-glow.png'), optimize=True)
        made.append((name, img))
        print(name, img.size, 'lights', lights)
    if args.preview:
        contact_sheet(args.preview, made)


def contact_sheet(out_dir, made):
    """Each frame at full size, then at in-game sizes (close / play / far), on a space-dark ground."""
    os.makedirs(out_dir, exist_ok=True)
    rowh = max(img.height for _, img in made) + 20
    sheet = Image.new('RGBA', (sum(img.width + 20 for _, img in made) + 20, rowh + 220), (6, 7, 11, 255))
    x = 10
    for name, img in made:
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
