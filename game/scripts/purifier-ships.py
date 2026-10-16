#!/usr/bin/env python3
"""The Purifier's escort and dock art (Galactic Threats add-on): "worn-down war machines", the planet destroyer's
sister ships after ages of fighting. Kitbashed from the install's Shakturi set (the destroyer's builders), painted in
the destroyer's own aged bronze and battered: missing plates exposing the ribbed frame inside, gouges, craters,
scorch, melted edges, mismatched alloy patches welded over old holes, verdigris in the crevices, chipped edges.
Offline build step; the outputs are our derived art, committed under public/art/purifier/ (src/render/threatArt.ts
purifierArtUrl draws them for the Purifier faction's escorts and guards by subRole, base_1 for its dock - the repair
station - and base_0 for any other base of the faction). The planet destroyer itself keeps the stock
other/planetdestroyer.png: the one unbroken weapon.

    python3 -I scripts/purifier-ships.py [--dwu <DW:U install>] [--out public/art/purifier] [--preview <dir>]
        [--only frigate,base_1]

Reads images/units/ships/other/MajorSets/Shakturi/<file>.png and other/planetdestroyer.png from the install (default
public/assets/dwu, the symlink npm run import-assets makes). Needs Python 3 with numpy and Pillow only. Deterministic
(fixed seeds per output).

Per output frame (bow up, as the stock frames; square canvas):
1. Assembly: Shakturi frames and crops (scaled, squashed, mirrored) and a few procedural parts (see-through lattice
   trusses, drop pods, the dock's cradle ring and clamp arms, drifting debris) layered back to front, each casting a
   soft contact shadow on what is below. Every piece is reduced to its shading (luminance, levelled per piece); the
   Shakturi red lamps ride along as a glow channel, and the thruster (pure blue) / light (pure yellow) marker pixels
   as points, mapped through each placement and dropped where a later piece covers them. Distinct per role at play
   zoom: a needle frigate, a destroyer with gun sponsons on outriggers, a cruiser with swept aft wings, a broad
   fortress capital ship flanked by bulwark hulls, a twin-hulled carrier joined by an open ribbed hangar deck, a fat
   troop transport racked with drop pods (some clamps empty).
2. Paint: the shading gradient-mapped onto the planet destroyer's bronze ramp (its saturated pixels' median colour
   per luminance band), dulled and a little desaturated (tarnish); trusses and cradles in a darker bronze.
3. Battle damage (never mirrored): verdigris pooled in the crevices and streaked aft, mismatched alloy patches (dull
   steel, dark bronze, verdigris-green; seams, rivet rows, some overhanging the hull edge), broad scorch, missing
   plates (a dark hole with the ribs and stringers inside, a torn lit lip), skeletal breaches at the hull edge (the
   skin gone, the ribs standing out to the old outline, space showing between them), impact craters (lit rim, cracks,
   soot halo), long gouges, melted edges (eaten silhouette, slag rim, heat tint), chipped edges and fine pitting.
   Sized for the drawn sizes (about 60-130 px at the closest zoom, 15-35 px at play zoom), so the patches, the
   notches in the outline and the breaches still read small.
4. Lights: the red lamps become a dim amber ember (as the destroyer's palette), a third of them dead. The marker
   pixels are written back exactly ((0,0,255) thruster runs at the engines, (255,255,0) nav-light points), no other
   pixel left in either marker colour (ambientLayer.ts scanShipMarkers) and no opaque black (shipImageMetrics).
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
FILES = ['frigate', 'destroyer', 'cruiser', 'capitalship', 'carrier', 'trooptransport', 'base_0', 'base_1']


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


def run_aft(src, decay):
    """Streaks: every source value runs aft (+y), fading by `decay` per px (one-sided)."""
    out = src.copy()
    for y in range(1, out.shape[0]):
        out[y] = np.maximum(out[y], out[y - 1] * decay)
    return out


LIGHT = np.array([-0.42, -0.55, 0.72])
LIGHT = LIGHT / np.linalg.norm(LIGHT)


def _shade(nx, ny, nz, amb=0.16, k=0.78):
    d = np.clip(nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2], 0, 1)
    return amb + k * d + 0.12 * d ** 12


# ---------------------------------------------------------------------------------------------------------------
# 1. Pieces and assembly
# ---------------------------------------------------------------------------------------------------------------

MATS = ('dark', 'thin', 'pod', 'cradle')


class Piece:
    """Levelled shading L, alpha A, glow G (the red lamps), material masks (MATS) and marker points
    [(x, y, kind)] in piece px (kind 1 thruster, 2 light)."""

    cache = {}

    def __init__(self, L, A, G=None, mats=None, marks=None):
        self.L, self.A = L, A
        self.G = np.zeros_like(L) if G is None else G
        self.mats = mats or {}
        self.marks = marks or []

    @classmethod
    def load(cls, root, name, crop=None, lo=0.03, hi=0.97, keep_marks=True):
        key = (name, crop, lo, hi, keep_marks)
        if key in cls.cache:
            return cls.cache[key]
        img = Image.open(os.path.join(root, 'MajorSets', 'Shakturi', name + '.png')).convert('RGBA')
        if crop is not None:
            img = img.crop(crop)
        a = np.asarray(img).astype(np.float64) / 255
        rgb = a[..., :3]
        alpha = a[..., 3]
        raw = np.asarray(img)[..., :3].astype(np.int32)
        blue = (raw[..., 0] == 0) & (raw[..., 1] == 0) & (raw[..., 2] == 255) & (alpha > 0)
        yel = (raw[..., 0] == 255) & (raw[..., 1] == 255) & (raw[..., 2] == 0) & (alpha > 0)
        marker = blue | yel
        hue, sat, val = hsv(rgb)
        lum = rgb @ LUM
        glow = (sat > 0.35) & (val > 0.15) & ((hue < 0.07) | (hue > 0.9)) & ~marker & (alpha > 0.3)
        gl = np.where(glow, val, 0.0)
        op = alpha > 0.6
        vals = lum[op & ~glow & ~marker]
        p0, p1 = (np.quantile(vals, lo), np.quantile(vals, hi)) if vals.size > 50 else (0.0, 1.0)
        L = np.clip((lum - p0) / max(1e-3, p1 - p0), 0, 1)
        bad = glow | marker
        keep = (~bad & (alpha > 0.5)).astype(np.float64)
        fill = fblur(L * keep, 1.5) / np.maximum(fblur(keep, 1.5), 1e-3)
        L = np.where(glow, fill * 0.45, np.where(marker, fill, L))
        bb = Image.fromarray((alpha * 255).astype(np.uint8)).getbbox()
        marks = []
        if keep_marks:
            for (y, x) in np.argwhere(blue):
                marks.append((x - bb[0] + 0.5, y - bb[1] + 0.5, 1))
            for (y, x) in np.argwhere(yel):
                marks.append((x - bb[0] + 0.5, y - bb[1] + 0.5, 2))
        sl = (slice(bb[1], bb[3]), slice(bb[0], bb[2]))
        p = cls(L[sl], alpha[sl], gl[sl], None, marks)
        cls.cache[key] = p
        return p

    def transformed(self, scale, rot, flipx, flipy, sx=1.0, sy=1.0):
        """Premultiplied (L·A, A, G·A, mats·A) images, scaled / rotated (deg, CCW) about the piece centre; and the
        marker points mapped to the output image's px."""
        chans = [self.L * self.A, self.A, self.G * self.A] + [self.mats.get(m, np.zeros_like(self.A)) * self.A for m in MATS]
        out = []
        h0, w0 = self.A.shape
        nw, nh = max(1, round(w0 * scale * sx)), max(1, round(h0 * scale * sy))
        for ch in chans:
            im = Image.fromarray(ch.astype(np.float32), 'F')
            if flipx:
                im = im.transpose(Image.FLIP_LEFT_RIGHT)
            if flipy:
                im = im.transpose(Image.FLIP_TOP_BOTTOM)
            im = im.resize((nw, nh), Image.BICUBIC if scale * min(sx, sy) > 1 else Image.LANCZOS)
            if rot % 360:
                im = im.rotate(rot, resample=Image.BICUBIC, expand=True)
            out.append(np.clip(np.asarray(im).astype(np.float64), 0, None))
        out[1] = np.clip(out[1], 0, 1)
        for k in range(len(out)):
            if k != 1:
                out[k] = np.minimum(out[k], out[1])
        oh, ow = out[1].shape
        th = math.radians(rot)
        marks = []
        for (x, y, kind) in self.marks:
            if flipx:
                x = w0 - x
            if flipy:
                y = h0 - y
            x, y = x * nw / w0 - nw / 2, y * nh / h0 - nh / 2
            xr = x * math.cos(th) + y * math.sin(th)
            yr = -x * math.sin(th) + y * math.cos(th)
            marks.append((xr + ow / 2, yr + oh / 2, kind))
        return out, marks


class Canvas:
    def __init__(self, w, h=None):
        h = w if h is None else h
        self.w, self.h = w, h
        self.L = np.zeros((h, w))  # premultiplied
        self.A = np.zeros((h, w))
        self.G = np.zeros((h, w))
        self.T = np.zeros((h, w))  # per-piece tone offset
        self.M = {m: np.zeros((h, w)) for m in MATS}
        self.marks = []            # (x, y, kind) canvas px

    def put(self, piece, cx, cy, scale=1.0, rot=0, flipx=False, flipy=False, shadow=0.55, gain=1.0, tone=0.0, mirror=False,
            sx=1.0, sy=1.0, mat=None, marks=True, glow=1.0):
        """Layer a piece over the canvas centred at (cx, cy). `mirror`: also at the mirrored x. `mat`: tag the
        piece's pixels with a material (MATS)."""
        for m in ([False, True] if mirror else [False]):
            x = self.w - cx if m else cx
            r = -rot if m else rot
            ch, pm = piece.transformed(scale, r, flipx != m, flipy, sx, sy)
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
            fl, fa, fg = full[0] * gain, full[1], full[2] * glow
            if mat is not None:
                full[3 + MATS.index(mat)] = fa.copy()
            if shadow > 0:
                off = max(1, int(round(3 * scale + 1)))
                sh = fblur(shift(fa, off, off // 2), 2.0 + 1.5 * scale) * shadow
                self.L *= 1 - sh * (1 - fa)
            # markers under this piece are covered
            self.marks = [mk for mk in self.marks if not (0 <= int(mk[1]) < self.h and 0 <= int(mk[0]) < self.w and fa[int(mk[1]), int(mk[0])] > 0.5)]
            inv = 1 - fa
            self.L = fl + self.L * inv
            self.G = fg + self.G * inv
            self.T = fa * tone + self.T * inv
            for k, mname in enumerate(MATS):
                self.M[mname] = full[3 + k] + self.M[mname] * inv
            self.A = fa + self.A * inv
            if marks:
                for (mx, my, kind) in pm:
                    self.marks.append((mx + x0, my + y0, kind))

    def result(self):
        a = np.maximum(self.A, 1e-6)
        return np.clip(self.L / a, 0, 1), self.A, np.clip(self.G / a, 0, 1), self.T, {m: np.clip(v / a, 0, 1) for m, v in self.M.items()}


# --- procedural parts (shading only; painted with everything else) ---

_TEX = []  # a stock hull strip, ground into the procedural parts so they carry the Shakturi plating detail


def tex(L, yy, xx, amt):
    if not _TEX:
        return L
    st = _TEX[0]
    sh, sw = st.L.shape
    t = np.where(st.A[(yy.astype(int)) % sh, (xx.astype(int)) % sw] > 0.5, st.L[(yy.astype(int)) % sh, (xx.astype(int)) % sw], 0.5)
    return L * (1 - amt + amt * 1.25 * t)


def truss(w, h, rail=3, bay=None, brace=0.8, cut=None):
    """A see-through lattice girder along y: two rails, cross bars and diagonal braces (alpha only on the members).
    `cut`: (y0, y1) rows snapped away (a jagged break)."""
    bay = bay or max(6, w)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64) + 0.5
    A = np.zeros((h, w))
    A[:, :rail] = 1
    A[:, w - rail:] = 1
    t = (yy % bay)
    A[t < 1.6] = 1
    u = xx / w
    diag = np.abs(t / bay - np.where(((yy // bay) % 2) == 0, u, 1 - u)) * bay < brace + 0.4
    A = np.maximum(A, diag.astype(np.float64))
    nx = np.where(xx < rail, -0.6, np.where(xx >= w - rail, 0.6, 0.0))
    L = _shade(nx, np.zeros_like(nx), np.sqrt(1 - nx ** 2), amb=0.18, k=0.62)
    L = np.where(t < 1.6, L * 1.12, L)
    if cut is not None:
        y0, y1 = cut
        jag = (np.sin(xx * 1.7) * 2 + np.cos(xx * 0.9) * 1.5)
        A = np.where((yy > y0 + jag) & (yy < y1 + jag), 0, A)
    return Piece(L, A, None, {'thin': np.ones((h, w)), 'dark': np.ones((h, w)) * 0.6})


def plate(w, h, chamfer=0.25, taper=0.0, bevel=2, seams=(), skew=0.0):
    """A heavy armour slab, bow up: bevelled (lit top / left), chamfered front corners, `taper` narrows the front,
    `skew` shears it aft (swept wings), panel seams at the `seams` fractions; stock plating ground in."""
    W = w + int(abs(skew) * h) + 2
    yy, xx = np.mgrid[0:h, 0:W].astype(np.float64) + 0.5
    t = yy / h
    off = skew * yy + (0 if skew >= 0 else abs(skew) * h)
    hw = w / 2 * (1 - taper * (1 - t))
    cxl = w / 2 + off + 1
    dx = np.abs(xx - cxl)
    dside = hw - dx
    ch = chamfer * w
    A = np.clip(dside + 0.5, 0, 1) * np.clip(yy + dside - ch + 0.5, 0, 1) * np.clip(h - yy + 0.5, 0, 1)
    nx = 0.3 * (xx - cxl) / np.maximum(hw, 1)
    L = _shade(nx, np.full_like(nx, -0.1), np.sqrt(np.clip(1 - nx ** 2 - 0.01, 0, 1)), amb=0.2, k=0.6)
    L = np.where((dside < bevel) & (xx < cxl), np.minimum(1, L * 1.25 + 0.05), L)
    L = np.where((dside < bevel) & (xx >= cxl), L * 0.55, L)
    L = np.where(yy + dside - ch < bevel + 1, np.minimum(1, L * 1.2 + 0.04), L)
    L = np.where(h - yy < bevel, L * 0.5, L)
    for f in seams:
        y = int(round(f * h))
        L[y:y + 1] *= 0.45
        if y + 1 < h:
            L[y + 1] = np.minimum(1, L[y + 1] * 1.25)
    L = tex(L, yy * 0.9, xx * 1.1 + 7, 0.45)
    return Piece(L, A)


def pod(w, h, bands=(0.5,)):
    """A drop pod lying along y: cylinder shading, rounded ends, dark bands; stock plating ground in."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64) + 0.5
    r = w / 2
    nx = (xx - r) / r
    ny = np.zeros_like(nx)
    A = (np.abs(nx) <= 1).astype(np.float64)
    for (cyc, sel) in ((r, yy < r), (h - r, yy > h - r)):
        dy = (yy - cyc) / r
        A = np.where(sel, (nx ** 2 + dy ** 2 <= 1).astype(np.float64), A)
        ny = np.where(sel, dy, ny)
    nz = np.sqrt(np.clip(1 - nx ** 2 - ny ** 2, 0, 1))
    L = _shade(nx, ny, nz, amb=0.14, k=0.7)
    L = tex(L, yy * 1.2, (nx + 1) * 20 + 30, 0.35)
    for f in bands:
        y = int(round(f * h))
        L[y:y + 2] *= 0.45
    edge = np.clip((1 - np.sqrt(nx ** 2 + ny ** 2)) * r * 1.2, 0, 1)
    A = A * edge
    return Piece(L, A, None, {'pod': np.ones((h, w))})


def clamp_arm(w, h):
    """An empty pod clamp: a C bracket (two prongs and a back bar), bow up."""
    A = np.zeros((h, w))
    A[:, :3] = 1
    A[:3, :] = 1
    A[-3:, :] = 1
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    L = np.full((h, w), 0.45)
    L[:1, :] = 0.8
    L[:, :1] = 0.75
    return Piece(L, A, None, {'thin': np.ones((h, w)), 'dark': np.ones((h, w))})


def hangar(w, h, pitch=10, missing=()):
    """An open hangar deck between twin hulls, bow up: a dark recessed floor with launch-lane lines, heavy frames
    across every `pitch` px (lit top, a shadow on the floor below), side rails; `missing`: frame indices gone."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64) + 0.5
    L = np.full((h, w), 0.2)
    L = tex(L, yy * 1.1, xx * 1.3 + 11, 0.5)
    lane = (np.abs(xx - w / 2) < 1) | (np.abs(xx - w * 0.25) < 0.6) | (np.abs(xx - w * 0.75) < 0.6)
    L = np.where(lane, L * 1.6 + 0.04, L)
    k = (yy // pitch).astype(int)
    t = yy % pitch
    frame = (t < 3) & ~np.isin(k, list(missing))
    L = np.where(frame & (t < 1), 0.72, np.where(frame, 0.46, L))
    L = np.where(~frame & (t < 5) & ~np.isin(k, list(missing)), L * 0.5, L)
    rail = (xx < 4) | (xx > w - 4)
    L = np.where(rail, _shade(np.where(xx < 4, -0.5, 0.5), np.zeros_like(xx), np.full_like(xx, 0.85), amb=0.2, k=0.6), L)
    return Piece(L, np.ones((h, w)), None, {'dark': np.ones((h, w)) * 0.5})


def ring(R, tb, gaps=(), ribs=36, arms=()):
    """The dock's cradle: a heavy torus segment of radius R, `tb` thick, radial ribs; `gaps`: (a0, a1) degree spans
    snapped away; `arms`: (angle, length, width) clamp arms reaching in to the empty berth."""
    s = int(math.ceil(2 * (R + tb))) + 4
    yy, xx = np.mgrid[0:s, 0:s].astype(np.float64) + 0.5
    dx, dy = xx - s / 2, yy - s / 2
    rr = np.sqrt(dx ** 2 + dy ** 2)
    ang = (np.degrees(np.arctan2(dy, dx)) + 360) % 360
    u = (rr - R) / (tb / 2)
    A = np.clip((1 - np.abs(u)) * tb * 0.6, 0, 1)
    nr = np.clip(u, -1, 1)
    nx, ny = nr * dx / np.maximum(rr, 1), nr * dy / np.maximum(rr, 1)
    nz = np.sqrt(np.clip(1 - nr ** 2, 0, 1))
    L = _shade(nx, ny, nz, amb=0.16, k=0.7)
    rib = np.abs(((ang / 360 * ribs) % 1) - 0.5) > 0.42
    L = np.where(rib, L * 0.55, L)
    L = np.where(np.abs(np.abs(u) - 0.55) < 0.12, L * 0.7, L)
    L = tex(L, ang * 3, rr * 2, 0.4)
    for (a0, a1) in gaps:
        jag = 2.5 * np.sin(rr * 0.9) + 1.5 * np.cos(rr * 2.1)
        A = np.where((ang > a0 + jag) & (ang < a1 + jag), 0, A)
    mats = {'cradle': np.ones((s, s))}
    for (a, ln, wd) in arms:
        th = math.radians(a)
        ux, uy = math.cos(th), math.sin(th)
        along = -(dx * ux + dy * uy) + R  # 0 at the ring's centre line, growing inward
        across = -dx * uy + dy * ux
        half = wd / 2 * (1 - 0.45 * np.clip(along / ln, 0, 1))
        arm = (along > -tb * 0.2) & (along < ln) & (np.abs(across) < half)
        claw = (along > ln - 4) & (along < ln + 3) & (np.abs(across) < wd * 0.75)
        m = arm | claw
        la = _shade(np.where(across < 0, -0.5, 0.5) * np.clip(np.abs(across) / np.maximum(half, 1), 0, 1), np.zeros_like(rr), np.full_like(rr, 0.8), amb=0.2, k=0.6)
        la = np.where((np.abs(along % 7) < 1.2) & arm, la * 0.6, la)
        L = np.where(m, la, L)
        A = np.where(m, 1.0, A)
    return Piece(L, A, None, mats)


def debris(rng, root, size):
    """A drifting hull fragment: a random crop of a Shakturi frame, its edges torn (noise-eaten)."""
    src = ['capitalship', 'cruiser', 'base_1', 'carrier'][int(rng.integers(4))]
    big = Piece.load(root, src)
    h, w = big.A.shape
    cw = max(8, int(rng.integers(size // 2, size + 1)))
    ch = max(8, int(rng.integers(size // 2, size + 1)))
    for _ in range(40):
        x0 = int(rng.integers(0, max(1, w - cw)))
        y0 = int(rng.integers(0, max(1, h - ch)))
        A = big.A[y0:y0 + ch, x0:x0 + cw]
        if A.mean() > 0.7:
            break
    L = big.L[y0:y0 + ch, x0:x0 + cw].copy()
    yy, xx = np.mgrid[0:ch, 0:cw].astype(np.float64)
    d = np.maximum(np.abs(xx - cw / 2) / (cw / 2), np.abs(yy - ch / 2) / (ch / 2))
    n = fbm(rng, ch, cw, max(2, size // 4))
    A = A * ((d + (n - 0.5) * 0.9) < 0.85)
    L = np.where(d > 0.6, L * 0.75, L)
    return Piece(L, A.astype(np.float64), None, {'dark': np.full((ch, cw), 0.4)}, [])


# ---------------------------------------------------------------------------------------------------------------
# 2. Paint
# ---------------------------------------------------------------------------------------------------------------

def bronze_ramp(dest):
    """The planet destroyer's bronze: median colour of its saturated opaque pixels per 16-level luminance band."""
    a = np.asarray(dest.convert('RGBA')).astype(np.float64)
    m = a[..., 3] == 255
    rgb = a[..., :3][m]
    mx = rgb.max(1)
    mn = rgb.min(1)
    sat = (mx - mn) / np.maximum(mx, 1)
    lum = rgb @ LUM
    xs, cols = [], []
    for lo in range(0, 256, 16):
        q = (lum >= lo) & (lum < lo + 16) & (sat > 0.3)
        if q.sum() < 20:
            continue
        xs.append(np.median(lum[q]) / 255)
        cols.append(np.median(rgb[q], 0) / 255)
    xs = np.array([0.0] + xs + [1.0])
    cols = np.array([[0.0, 0.0, 0.0]] + cols + [cols[-1]])
    return xs, cols


def ramp_lookup(xs, cols, v):
    out = np.empty(v.shape + (3,))
    for c in range(3):
        out[..., c] = np.interp(v, xs, cols[:, c])
    return out


# Alloys of the patches (multipliers of the painted value): dull steel, dark bronze, verdigris green, pale brass.
STEEL = np.array([0.70, 0.72, 0.74])
DARKB = np.array([0.62, 0.46, 0.32])
VERD = np.array([0.50, 0.66, 0.56])
BRASS = np.array([0.98, 0.84, 0.58])
SOOT = np.array([0.055, 0.042, 0.034])
VOID = np.array([0.035, 0.026, 0.022])
SLAG = np.array([0.10, 0.065, 0.045])
EMBER = np.array([1.0, 0.52, 0.16])


def paint(L, A, T, M, xs, cols):
    v = np.clip(L * 0.76 * (1 + T), 0, 1)
    v = np.where(v > 0.5, 0.5 + (v - 0.5) * 0.6, v)  # aged: highlights compressed (dull, not polished)
    bronze = ramp_lookup(xs, cols, v)
    grey = np.repeat(v[..., None], 3, axis=2)
    out = bronze * 1.0 + (bronze - grey) * 0.12  # a touch richer than the ramp: old bronze, not grey
    dark = ramp_lookup(xs, cols, np.clip(v * 0.82, 0, 1)) * 0.78 + grey * 0.1
    k = np.clip(M['dark'] * 0.7, 0, 1)[..., None]
    out = out * (1 - k) + dark * k
    return out, v


# ---------------------------------------------------------------------------------------------------------------
# 3. Battle damage
# ---------------------------------------------------------------------------------------------------------------

def pick_points(rng, cand, n, min_dist, avoid=()):
    ys, xs = np.nonzero(cand)
    pts = []
    if len(ys) == 0:
        return pts
    for _ in range(600):
        if len(pts) >= n:
            break
        i = rng.integers(len(ys))
        p = (int(ys[i]), int(xs[i]))
        if all((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 >= min_dist ** 2 for q in list(pts) + list(avoid)):
            pts.append(p)
    return pts


def ribs_pattern(yy, xx, y0, x0, pitch, rng):
    """Exposed structure in local hole coords: frames across (every `pitch` px, 2-3 px), bowed a little as the hull's
    cross-section, a stringer or two along."""
    bow = rng.uniform(0.006, 0.016) * (1 if rng.random() < 0.5 else -1)
    rib = ((yy - y0 - bow * (xx - x0) ** 2) % pitch) < (3 if pitch >= 7 else 2)
    k = rng.integers(1, 3)
    str_ = np.zeros_like(rib)
    for i in range(int(k)):
        sxp = x0 + rng.uniform(-0.3, 0.3) * pitch * 2
        str_ |= np.abs(xx - sxp) < 1.1
    return rib, str_


class Damage:
    """The battle-damage pass on a painted frame: out (h, w, 3) floats, alpha (h, w) floats, hull masks."""

    def __init__(self, name, out, alpha, v, M, protect, rng):
        self.name, self.out, self.alpha, self.v, self.M, self.rng = name, out, alpha, v, M, rng
        self.h, self.w = alpha.shape
        self.side = max(self.h, self.w)
        self.protect = protect
        self.yy, self.xx = np.mgrid[0:self.h, 0:self.w].astype(np.float64)
        self.jag = fbm(rng, self.h, self.w, 3)
        self.tear = fbm(rng, self.h, self.w, 5, octaves=3)
        self.refresh()
        self.taken = []

    def refresh(self):
        self.solid = self.alpha > 0.85
        self.depth = depth_inside(self.solid, 12)
        self.hull = self.solid & (self.M['thin'] < 0.5) & ~self.protect

    def cand(self, dmin, dmax=99):
        return self.hull & (self.depth >= dmin) & (self.depth <= dmax)

    # -- verdigris: pooled in the crevices (darker than the neighbourhood), streaked aft, blotched
    def verdigris(self, amt=1.0):
        out, v, rng = self.out, self.v, self.rng
        h, w, side = self.h, self.w, self.side
        cav = np.clip((fblur(v, 2.0) - v) * 5, 0, 1)
        blotch = fbm(rng, h, w, max(4, side // 9))
        streak = fbm(rng, h, w, max(3, side // 30), stretch_y=4.0)
        coln = value_noise(rng, 1, w, max(2, side // 40))[0]
        run = np.clip((streak - 0.5) * 4, 0, 1) * np.clip((coln[None, :] - 0.4) * 3, 0, 1)
        pool = np.clip((blotch - 0.52) * 4, 0, 1) * np.clip(1.25 - v * 2.0, 0, 1)
        m = np.clip(cav * 0.65 * np.clip(blotch * 1.6 - 0.2, 0, 1) + run * 0.3 + pool * 0.35, 0, 0.75) * amt
        m *= (self.depth >= 2) & (self.alpha > 0.5)
        lv = np.clip(v * 1.5 + 0.12, 0, 1)[..., None]
        col = np.stack([0.24 + v * 0.30, 0.46 + v * 0.48, 0.40 + v * 0.40], axis=2) * lv
        self.out = out * (1 - m[..., None]) + col * m[..., None]

    # -- mismatched alloy plates welded over old holes: seams, rivets, some overhanging the edge
    def patches(self, n, size=None):
        rng, side = self.rng, self.side
        alloys = [STEEL, DARKB, VERD, STEEL, DARKB, BRASS]
        size = size or ((0.03, 0.065) if self.name.startswith('base') else (0.045, 0.1))
        for (py, px) in pick_points(rng, self.cand(3) & (self.M['dark'] < 0.3), n, side * 0.13, self.taken):
            pw = side * rng.uniform(*size)
            ph = pw * rng.uniform(0.6, 1.5)
            ang = rng.choice([0, 0, 0, rng.uniform(-14, 14)])
            th = math.radians(ang)
            u = (self.xx - px) * math.cos(th) + (self.yy - py) * math.sin(th)
            w_ = -(self.xx - px) * math.sin(th) + (self.yy - py) * math.cos(th)
            # a cut corner or two
            cut = (u / pw * 2 + w_ / ph * 2) > (1.6 if rng.random() < 0.5 else 9)
            m = (np.abs(u) <= pw / 2) & (np.abs(w_) <= ph / 2) & ~cut
            over = m & ~self.solid
            # overhang only a little past the hull (welded-on slabs, not floating plates)
            near = dilate(self.solid, 2)
            m &= near
            m &= ~self.protect
            if m.sum() < 9:
                continue
            alloy = alloys[int(rng.integers(len(alloys)))]
            base = np.clip(self.v * 0.45 + rng.uniform(0.22, 0.4), 0, 1)
            grad = 1 + 0.12 * (-w_ / max(ph, 1))
            col = (base * grad)[..., None] * alloy[None, None, :] * 0.85
            col *= (0.8 + 0.4 * self.jag)[..., None]
            out = self.out
            out[m] = col[m] * 0.8 + out[m] * 0.2
            # bevel: lit top / left, dark bottom / right; a dark seam just outside
            inner = m & ~(shift(m, 1, 1) & shift(m, -1, -1))
            tl = inner & ~shift(m, 1, 0) | inner & ~shift(m, 0, 1)
            out[tl] = np.minimum(1, out[tl] * 1.35 + 0.05)
            br = inner & ~tl
            out[br] *= 0.55
            seam = dilate(m, 1) & ~m & self.solid
            out[seam] *= 0.4
            # rivets inset along the edges
            ins = dilate(~m, 2) & m & ~inner
            riv = ins & (((self.xx + self.yy).astype(int) % 4) == 0)
            out[riv] *= 0.45
            rl = shift(riv, -1, -1) & m
            out[rl] = np.minimum(1, out[rl] * 1.3 + 0.03)
            self.alpha[over & m] = 1.0
            self.taken.append((py, px))
        self.refresh()

    # -- age: broad low-frequency staining and grime streaked aft from the crevices
    def grime(self):
        rng, side, v = self.rng, self.side, self.v
        g = fbm(rng, self.h, self.w, max(6, side // 7))
        stain = 0.74 + 0.36 * g
        cav = np.clip((fblur(v, 1.5) - v) * 6, 0, 1)
        streak = run_aft(cav * 0.5, 0.93) * fbm(rng, self.h, self.w, max(3, side // 40), stretch_y=3.0)
        k = np.clip(stain - streak * 0.6, 0.45, 1.05)
        self.out = self.out * k[..., None]

    # -- broad soot
    def scorch(self, n):
        rng, side = self.rng, self.side
        soot = np.zeros((self.h, self.w))
        for (py, px) in pick_points(rng, self.cand(3), n, side * 0.16):
            r = side * rng.uniform(0.07, 0.12)
            d = np.sqrt(((self.xx - px) / r) ** 2 + ((self.yy - py) / (r * 1.6)) ** 2)
            soot = np.maximum(soot, np.clip(1.1 - d, 0, 1) ** 1.2)
        soot *= 0.55 + 0.7 * fbm(rng, self.h, self.w, max(2, side // 30))
        soot = np.clip(soot, 0, 0.88) * (self.alpha > 0) * ~self.protect
        self.out = self.out * (1 - soot[..., None]) + (self.out * 0.22 + SOOT * 0.78) * soot[..., None]

    def _structure(self, hole, pitch, y0, x0, see_through):
        """Paint the exposed frame inside `hole`: ribs across (2 px every `pitch`), a stringer along, an inner deck
        between them (or space, `see_through`, with the outermost rail of the old outline left standing, broken)."""
        rng, out = self.rng, self.out
        rib, stringer = ribs_pattern(self.yy, self.xx, y0, x0, pitch, rng)
        # some ribs snapped: a random stretch of each one gone
        broken = np.zeros_like(rib)
        for k in range(int(self.h // pitch) + 2):
            if rng.random() < 0.3:
                yb = y0 + k * pitch
                xa = x0 + rng.uniform(-1, 1) * pitch * 2
                broken |= (np.abs(self.yy - yb - 0.5) < 1.5) & (np.abs(self.xx - xa) < rng.uniform(1, pitch * 1.2))
        struct = hole & (rib | stringer) & ~broken
        if see_through:
            rail = hole & (self.depth <= 1) & (self.jag < 0.6)
            struct |= rail
        # shadow cast into the hole by the upper-left skin
        sh = np.zeros(hole.shape)
        for k in (1, 2, 3, 4):
            sh = np.maximum(sh, shift(~hole, k, k) * (1 - k / 5))
        floor = hole & ~struct
        if see_through:
            self.alpha[floor] = 0
        else:
            fv = (0.07 + 0.06 * self.jag) * (1 - 0.6 * sh)
            fc = ramp_lookup(*self.ramp, np.clip(fv, 0, 1)) * 0.75
            out[floor] = fc[floor]
            under = floor & shift(struct, 1, 0)  # the frame's own shadow on the deck below it
            out[under] *= 0.45
        rv = (0.24 + 0.2 * self.jag) * (1 - 0.45 * sh) * (0.8 if see_through else 1.0)
        rc = ramp_lookup(*self.ramp, np.clip(rv, 0, 1)) * 0.85
        out[struct] = rc[struct]
        lit = struct & ~shift(struct, 1, 0)
        out[lit] = np.minimum(1, out[lit] * 1.35 + 0.03)
        lit2 = struct & ~shift(struct, 0, 1)
        out[lit2] = np.minimum(1, out[lit2] * 1.15)
        self.alpha[struct] = 1.0
        # the torn lip: lit raw metal on the hole's upper-left rim, a dark lower-right rim, burnt around
        rim = dilate(hole, 1) & ~hole & self.solid
        ul = rim & (shift(hole, 1, 1) | shift(hole, 1, 0) | shift(hole, 0, 1))
        out[ul] = np.minimum(1, out[ul] * 1.35 + 0.05)
        out[rim & ~ul] *= 0.45
        burn = dilate(hole, 3) & ~dilate(hole, 1) & self.solid
        out[burn] *= 0.7

    # -- missing plates: a dark hole with the frame inside
    def missing(self, n, size=(0.1, 0.15)):
        rng, side = self.rng, self.side
        for (py, px) in pick_points(rng, self.cand(6), n, side * 0.14, self.taken):
            pw = side * rng.uniform(*size)
            ph = pw * rng.uniform(0.7, 1.6)
            d = np.sqrt(((self.xx - px) / (pw / 2)) ** 2 + ((self.yy - py) / (ph / 2)) ** 2) + (self.tear - 0.5) * 1.4
            hole = (d < 1) & self.hull & (self.depth >= 3) & (self.M['dark'] < 0.3)
            if hole.sum() < 10:
                continue
            pitch = int(rng.integers(6, 8))
            self._structure(hole, pitch, py - ph / 2 + 1, px, see_through=False)
            self.taken.append((py, px))
        self.refresh()

    # -- skeletal breaches at the hull edge: the skin gone, the ribs standing out to the old outline
    def breaches(self, n, size=(0.055, 0.085), flank=True):
        rng, side = self.rng, self.side
        c = self.cand(1, 2)
        if flank:  # on the flanks (not the bow / stern tips)
            ys = np.nonzero(self.solid.any(1))[0]
            if len(ys):
                y0, y1 = ys[0], ys[-1]
                c &= (self.yy > y0 + (y1 - y0) * 0.12) & (self.yy < y1 - (y1 - y0) * 0.1)
        for (py, px) in pick_points(rng, c, n, side * 0.2, self.taken):
            r = side * rng.uniform(*size)
            d = np.sqrt(((self.xx - px) / r) ** 2 + ((self.yy - py) / (r * 1.3)) ** 2) + (self.jag - 0.5) * 0.6
            hole = (d < 1) & self.solid & ~self.protect & (self.M['thin'] < 0.5)
            if hole.sum() < 10:
                continue
            pitch = int(rng.integers(6, 8))
            # the inner part of the breach (deeper in the hull) shows the dark interior, the outer part space
            deep = hole & (self.depth > r * 0.55)
            self._structure(hole & ~deep, pitch, py, px, see_through=True)
            if deep.any():
                self._structure(deep, pitch, py, px, see_through=False)
            self.taken.append((py, px))
        self.refresh()

    # -- impact craters
    def craters(self, n, size=(0.012, 0.024)):
        rng, side, out = self.rng, self.side, self.out
        for (py, px) in pick_points(rng, self.cand(5), n, side * 0.09, self.taken):
            r = side * rng.uniform(*size) + 1.0
            ang = np.arctan2(self.yy - py, self.xx - px)
            j = 1 + 0.12 * np.sin(ang * 5 + rng.uniform(0, 6.3))
            d0 = np.sqrt((self.yy - py) ** 2 + (self.xx - px) ** 2) / r
            d = d0 / j
            hullm = self.hull
            halo = (d0 < 2.4) & hullm
            out[halo] *= (0.55 + 0.45 * np.clip((d0[halo] - 1) / 1.4, 0, 1) ** 0.7)[:, None]
            # radial cracks
            for _ in range(int(rng.integers(2, 5))):
                a = rng.uniform(0, 2 * math.pi)
                ln = r * rng.uniform(1.4, 2.2)
                for t in np.linspace(r * 0.9, ln, int(ln * 2)):
                    a2 = a + 0.15 * math.sin(t)
                    x, y = int(round(px + math.cos(a2) * t)), int(round(py + math.sin(a2) * t))
                    if 0 <= x < self.w and 0 <= y < self.h and hullm[y, x]:
                        out[y, x] *= 0.45
            bowl = (d < 1) & hullm
            # bowl shading: lit lower-right inner wall, dark upper-left
            sx = (self.xx - px) / r
            sy = (self.yy - py) / r
            lightw = np.clip(0.5 + 0.5 * (sx * 0.6 + sy * 0.8), 0, 1)
            col = (0.04 + 0.2 * lightw * np.clip(d, 0, 1) ** 1.5)[..., None] * np.array([1.0, 0.75, 0.55])[None, None, :]
            out[bowl] = col[bowl]
            rim = (d >= 1) & (d < 1.45) & hullm
            ul = rim & ((self.xx - px) + (self.yy - py) < 0)
            out[ul] = np.minimum(1, out[ul] * 1.55 + 0.08)
            out[rim & ~ul] *= 0.6
            self.taken.append((py, px))

    # -- long gouges: a dark groove, a lit lip on the side facing the light, scorch along
    def gouges(self, n, length=(0.16, 0.34)):
        rng, side, out = self.rng, self.side, self.out
        for (py, px) in pick_points(rng, self.cand(4), n, side * 0.18):
            ln = side * rng.uniform(*length)
            a = rng.uniform(-0.9, 0.9) + (math.pi / 2 if rng.random() < 0.5 else 0)
            ux, uy = math.cos(a), math.sin(a)
            dx, dy = self.xx - px, self.yy - py
            t = dx * ux + dy * uy
            s = -dx * uy + dy * ux
            s = s - 0.004 * t * t * (1 if rng.random() < 0.5 else -1)  # a slight curve
            half = ln / 2
            tt = np.clip(np.abs(t) / half, 0, 1)
            wd = (1.0 + side * 0.006) * (1 - tt ** 3)
            seg = (np.abs(t) < half)
            groove = seg & (np.abs(s) < wd) & self.hull
            nside = -uy * LIGHT[0] + ux * LIGHT[1]  # which side faces the light
            lip = seg & (np.abs(s) >= wd) & (np.abs(s) < wd + 1.3) & self.hull & ((s * nside) < 0)
            shadow = seg & (np.abs(s) >= wd) & (np.abs(s) < wd + 1.3) & self.hull & ((s * nside) >= 0)
            sc = seg & (np.abs(s) < wd + side * 0.02) & self.hull
            out[sc] *= 0.72
            out[groove] = out[groove] * 0.25 + SOOT * 0.6
            mid = groove & (np.abs(s) < 0.5)
            out[mid] = np.minimum(1, out[mid] * 2.4 + 0.06)
            out[lip] = np.minimum(1, out[lip] * 1.55 + 0.08)
            out[shadow] *= 0.5
            # where the gouge runs off the hull it bites the outline
            bite = seg & (np.abs(s) < wd * 0.9) & (self.depth <= 2) & self.solid & ~self.protect
            self.alpha[bite] = 0
        self.refresh()

    # -- melted edges: the outline eaten into rounded bays, a slag rim, heat tint further in
    def melted(self, n, size=(0.05, 0.09)):
        rng, side = self.rng, self.side
        for (py, px) in pick_points(rng, self.cand(1, 2), n, side * 0.22, self.taken):
            r = side * rng.uniform(*size)
            d = np.sqrt((self.xx - px) ** 2 + (self.yy - py) ** 2) / r
            n2 = fbm(rng, self.h, self.w, max(2, int(r // 2)))
            eat = (d + (n2 - 0.5) * 0.8 < 0.6) & ~self.protect
            self.alpha[eat] = 0
            self.solid = self.alpha > 0.85
            dep = depth_inside(self.solid, 8)
            zone = (d < 1.3) & self.solid
            out = self.out
            edge = zone & (dep <= 2)
            out[edge] = out[edge] * 0.25 + SLAG * 0.75
            sheen = edge & shift(~self.solid, 1, 1)
            out[sheen] = np.minimum(1, out[sheen] + np.array([0.12, 0.08, 0.05]))
            tint = zone & (dep > 2) & (dep <= 6)
            k = (1 - (dep[tint] - 2) / 4.0)[:, None] * 0.55
            out[tint] = out[tint] * (1 - k) + (out[tint] * np.array([0.72, 0.58, 0.85]) + np.array([0.03, 0.02, 0.06])) * k
            self.taken.append((py, px))
            self.refresh()

    # -- chipped edges: small bites out of the outline, raw lit metal on the upper-left edges
    def chips(self, n):
        rng = self.rng
        c = self.solid & (self.depth == 1) & ~self.protect & (self.M['thin'] < 0.5)
        for (py, px) in pick_points(rng, c, n, 4):
            r = rng.uniform(1.0, 2.6)
            m = ((self.xx - px) ** 2 + (self.yy - py) ** 2) < r * r
            self.alpha[m & ~self.protect] = 0
        self.refresh()
        out = self.out
        e = self.solid & (self.depth == 1) & (shift(~self.solid, 1, 0) | shift(~self.solid, 0, 1)) & (self.jag > 0.68) & ~self.protect
        out[e] = np.minimum(1, out[e] * 1.18 + 0.03)

    def pitting(self, density=0.03):
        rng, out = self.rng, self.out
        pits = (rng.random((self.h, self.w)) < density) & self.hull & (self.depth >= 2)
        out[pits] *= 0.55
        lip = shift(pits, 1, 0) & ~pits & self.hull
        out[lip] = np.minimum(1, out[lip] * 1.18)


# ---------------------------------------------------------------------------------------------------------------
# 4. The frames
# ---------------------------------------------------------------------------------------------------------------

# Damage per frame: patches, scorches, missing plates, edge breaches, craters, gouges, melted edges, chips.
WEAR = {
    'frigate': (3, 2, 1, 1, 2, 1, 1, 14),
    'destroyer': (4, 3, 2, 2, 3, 2, 1, 18),
    'cruiser': (5, 3, 2, 2, 4, 2, 1, 22),
    'capitalship': (6, 4, 3, 3, 5, 3, 2, 26),
    'carrier': (5, 3, 2, 2, 4, 2, 1, 22),
    'trooptransport': (4, 3, 2, 1, 3, 2, 1, 18),
    'base_0': (5, 3, 2, 2, 3, 2, 2, 20),
    'base_1': (7, 4, 3, 2, 5, 3, 2, 30),
}


def build(root, name, rng):
    P = lambda f, crop=None, **k: Piece.load(root, f, crop, **k)  # noqa: E731
    if name == 'frigate':
        # A needle: the slim Shakturi destroyer hull squeezed narrower still, swept fins and the frigate's engine
        # block aft.
        c = Canvas(200)
        c.put(plate(14, 34, chamfer=0.1, skew=0.8, seams=(0.4,)), 82, 150, shadow=0, mirror=True)
        c.put(P('frigate', (31, 100, 129, 159)), 100, 166, 0.62, shadow=0)
        c.put(P('destroyer'), 100, 96, 0.82, shadow=0.5, sx=0.62, sy=1.0)
        return c
    if name == 'destroyer':
        # The Shakturi destroyer with two gun sponsons (frigate hulls cut short) out on lattice outriggers.
        c = Canvas(240)
        sp = P('frigate', (31, 30, 129, 159))
        c.put(truss(10, 150, bay=10), 120, 124, rot=90, shadow=0.3)
        c.put(truss(10, 150, bay=10, cut=(30, 36)), 120, 156, rot=90, shadow=0.3)
        c.put(sp, 56, 140, 0.48, shadow=0.45, mirror=True, sy=1.25)
        c.put(P('destroyer'), 120, 116, 0.92, shadow=0.55, sx=0.95)
        c.put(plate(16, 26, chamfer=0.45, taper=0.4), 120, 16, shadow=0.3, gain=0.95)
        return c
    if name == 'cruiser':
        # Long, with heavy swept wings aft (an arrowhead at play zoom) and a dorsal armour spine.
        c = Canvas(280)
        wing = plate(46, 74, chamfer=0.2, skew=0.55, seams=(0.33, 0.66))
        c.put(wing, 86, 186, shadow=0, mirror=True)
        c.put(P('capitalship', (73, 190, 197, 266)), 140, 236, 0.9, shadow=0.3, gain=0.9)
        c.put(P('cruiser'), 140, 132, 1.0, shadow=0.55, sx=0.92, sy=1.0)
        c.put(plate(14, 70, chamfer=0.4, taper=0.3, seams=(0.25, 0.5, 0.75)), 140, 96, shadow=0.4, gain=0.85, tone=-0.08)
        return c
    if name == 'capitalship':
        # A broad fortress: the Shakturi capital hull widened, flanked by two bulwark hulls (destroyer frames) and
        # slab armour across the bow (a hammerhead).
        c = Canvas(320)
        c.put(P('destroyer'), 98, 176, 0.86, shadow=0, mirror=True, sx=0.9)
        c.put(truss(12, 70, bay=12), 160, 132, rot=90, shadow=0.3)
        c.put(truss(12, 70, bay=12), 160, 222, rot=90, shadow=0.3)
        c.put(P('capitalship'), 160, 168, 1.0, shadow=0.6, sx=1.12, sy=1.04)
        c.put(plate(110, 26, chamfer=0.12, taper=0.15, seams=(0.5,)), 160, 44, shadow=0.45, gain=0.92)
        return c
    if name == 'carrier':
        # Twin hulls (the carrier frame split down the keel) joined by an open, ribbed hangar deck.
        c = Canvas(300)
        left = P('carrier', (63, 5, 125, 245))
        right = P('carrier', (125, 5, 187, 245))
        c.put(hangar(64, 176, missing=(5, 6, 11)), 150, 152, shadow=0)
        c.put(plate(70, 20, chamfer=0.3, seams=(0.5,)), 150, 70, shadow=0.35, gain=0.9)
        c.put(plate(70, 16, chamfer=0.0), 150, 236, shadow=0.35, gain=0.85)
        c.put(left, 92, 150, 1.0, shadow=0.55, sx=1.05)
        c.put(right, 208, 150, 1.0, shadow=0.55, sx=1.05)
        return c
    if name == 'trooptransport':
        # A fat drop-ship: the troop transport hull racked both sides with drop pods, some clamps empty.
        c = Canvas(240)
        pd = pod(20, 30, bands=(0.35, 0.7))
        cl = clamp_arm(14, 28)
        c.put(P('trooptransport'), 120, 120, 1.0, shadow=0.6, sx=0.92, sy=1.05)
        c.put(truss(8, 132, bay=8), 61, 114, shadow=0.3, mirror=True, marks=False)
        for k, y in enumerate((66, 98, 130, 162)):
            for side in (0, 1):
                x = 48 if side == 0 else 192
                empty = (k, side) in ((1, 1), (3, 0))
                if empty:
                    c.put(cl, x + (8 if side == 0 else -8), y, shadow=0.3, flipx=(side == 1), marks=False)
                else:
                    c.put(pd, x, y, shadow=0.35, tone=0.02 * k)
        return c
    if name == 'base_0':
        # A broken outpost: the Shakturi station body inside a half-ring of gantry, one arm snapped, debris adrift.
        c = Canvas(260)
        c.put(ring(96, 12, gaps=((200, 262), (300, 318)), ribs=40), 130, 130, shadow=0, marks=False)
        c.put(truss(10, 70, bay=10, cut=(40, 48)), 130, 34, shadow=0.3, marks=False)
        c.put(truss(10, 64, bay=10), 222, 150, rot=95, shadow=0.3, marks=False)
        c.put(P('base_0', keep_marks=True), 130, 132, 0.95, shadow=0.6)
        for (x, y, s, r) in ((40, 60, 22, 30), (226, 228, 16, 75), (30, 210, 14, 140), (210, 30, 12, 200)):
            c.put(debris(rng, root, s), x, y, rot=r, shadow=0, marks=False, gain=0.85)
        return c
    if name == 'base_1':
        # The Purifier's dock: a half-ruined orbital shipyard. An empty cradle ring (the berth where the Purifier
        # slept: space shows through it) with its clamp arms reaching in to nothing, one of them snapped off; an
        # outer scaffold ring mostly gone; a forge block (the Shakturi station) on the ring's aft side braced by
        # scaffold arms; gantry towers out to the sides, the right one broken and its end drifting; debris.
        c = Canvas(360)
        cx, cy = 180, 158
        c.put(ring(138, 8, gaps=((10, 140), (160, 205), (240, 335)), ribs=90), cx, cy, shadow=0, marks=False, mat='thin')
        c.put(truss(18, 120, bay=16), 50, cy - 6, rot=90, shadow=0, marks=False)
        c.put(plate(26, 34, chamfer=0.15, seams=(0.5,)), 14, cy - 6, shadow=0.3, marks=False)
        c.put(truss(18, 76, bay=16, cut=(56, 66)), 296, cy + 8, rot=92, shadow=0, marks=False)
        c.put(truss(18, 54, bay=16), 336, cy + 52, rot=124, shadow=0, marks=False)  # the snapped end, drifting
        c.put(truss(10, 70, bay=10), cx - 84, 44, rot=-34, shadow=0, marks=False)
        c.put(truss(10, 60, bay=10, cut=(34, 40)), cx + 86, 48, rot=36, shadow=0, marks=False)
        c.put(truss(10, 86, bay=10), cx - 104, cy + 104, rot=40, shadow=0, marks=False)
        c.put(truss(10, 86, bay=10), cx + 104, cy + 104, rot=-40, shadow=0, marks=False)
        arms = [(a, 40, 24) for a in (150, 210, 330)] + [(30, 16, 24)]
        c.put(ring(92, 34, gaps=((246, 282),), ribs=44, arms=arms), cx, cy, shadow=0.4, marks=False, gain=1.12)
        c.put(P('base_1', (30, 96, 160, 186)), cx, cy + 136, 1.2, shadow=0.6, sx=1.15)
        c.put(plate(84, 22, chamfer=0.2, seams=(0.5,)), cx, cy + 92, shadow=0.45)
        # the snapped clamp arm adrift in the berth, and the debris
        arm = ring(92, 34, arms=[(0, 40, 24)])
        sl = (slice(100, 156), slice(176, 222))
        frag = Piece(arm.L[sl], arm.A[sl], None, {m: v[sl] for m, v in arm.mats.items()})
        c.put(frag, cx + 30, cy - 30, rot=63, shadow=0, marks=False)
        for (x, y, sz, r) in ((150, 128, 26, 20), (206, 186, 18, 110), (290, 284, 28, 60), (66, 280, 24, 150),
                              (310, 86, 22, 210), (50, 70, 20, 300), (262, 40, 14, 80), (196, 104, 12, 140)):
            c.put(debris(rng, root, sz), x, y, rot=r, shadow=0, marks=False, gain=0.85)
        return c
    raise KeyError(name)


def finish(name, c, xs, cols, rng):
    L, A, G, T, M = c.result()
    h, w = A.shape
    out, v = paint(L, A, T, M, xs, cols)
    alpha = A.copy()
    # marker points (deduped, kept only where the hull is there)
    marks = {}
    for (mx, my, kind) in c.marks:
        x, y = int(mx), int(my)
        if 0 <= x < w and 0 <= y < h and A[y, x] > 0.5:
            marks[(x, y)] = kind
    # thruster runs: fill short gaps along each row
    rows = {}
    for (x, y), k in marks.items():
        if k == 1:
            rows.setdefault(y, []).append(x)
    for y, xs_ in rows.items():
        xs_.sort()
        for a, b in zip(xs_, xs_[1:]):
            if 1 < b - a <= 3:
                for x in range(a + 1, b):
                    if A[y, x] > 0.5:
                        marks[(x, y)] = 1
    mk = np.zeros((h, w), bool)
    for (x, y) in marks:
        mk[y, x] = True
    protect = dilate(mk, 3)
    dm = Damage(name, out, alpha, v, M, protect, rng)
    dm.ramp = (xs, cols)
    npatch, nsc, nmiss, nbr, ncr, ngo, nmel, nch = WEAR[name]
    dm.grime()
    dm.verdigris(1.0)
    dm.scorch(nsc)
    dm.missing(nmiss)
    dm.patches(npatch)
    dm.breaches(nbr)
    dm.craters(ncr)
    dm.gouges(ngo)
    dm.melted(nmel)
    dm.chips(nch)
    dm.pitting()
    out, alpha = dm.out, dm.alpha
    # lights: the red lamps -> a dim amber ember, a third of them dead (dark lenses)
    dead = value_noise(rng, h, w, 6) < 0.36
    g = np.where(alpha > 0.5, G, 0)
    lit = (g > 0.15) & ~dead
    out[lit] = EMBER * (g[lit] * 0.72)[:, None] + out[lit] * 0.15
    off = (g > 0.15) & dead
    out[off] = np.array([0.16, 0.06, 0.035]) * (0.6 + g[off])[:, None]
    if name.startswith('base'):
        out = out * 1.12  # the stations sit in nebulae and gas clouds: a little lift so the ruin still reads there
    out = np.clip(out, 0, 1)
    res = np.zeros((h, w, 4), np.uint8)
    res[..., :3] = np.round(out * 255)
    res[..., 3] = np.round(np.clip(alpha, 0, 1) * 255)
    # no opaque black (shipImageMetrics counts opaque non-black pixels)
    blk = (res[..., 3] == 255) & (res[..., :3].max(2) == 0)
    res[blk, :3] = 2
    # no accidental marker colours, then the markers exactly
    acc = (res[..., 3] > 0) & (((res[..., 0] == 0) & (res[..., 1] == 0) & (res[..., 2] == 255)) | ((res[..., 0] == 255) & (res[..., 1] == 255) & (res[..., 2] == 0)))
    res[acc, 2] = np.where(res[acc, 2] > 0, res[acc, 2] - 1, 1)
    for (x, y), k in marks.items():
        if res[y, x, 3] == 0:
            continue
        res[y, x, :3] = (0, 0, 255) if k == 1 else (255, 255, 0)
        res[y, x, 3] = 255
    return Image.fromarray(res, 'RGBA')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dwu', default=os.path.join(GAME, 'public', 'assets', 'dwu'))
    ap.add_argument('--out', default=os.path.join(GAME, 'public', 'art', 'purifier'))
    ap.add_argument('--preview', default=None)
    ap.add_argument('--only', default=None)
    args = ap.parse_args()
    root = os.path.join(args.dwu, 'images', 'units', 'ships', 'other')
    dest = Image.open(os.path.join(root, 'planetdestroyer.png'))
    xs, cols = bronze_ramp(dest)
    strip = Piece.load(root, 'capitalship', (100, 60, 170, 200))
    _TEX.append(strip)
    os.makedirs(args.out, exist_ok=True)
    made = []
    names = FILES if args.only is None else [n for n in FILES if n in args.only.split(',')]
    for name in names:
        rng = np.random.default_rng(zlib.crc32(('purifier2:' + name).encode()))
        c = build(root, name, rng)
        img = finish(name, c, xs, cols, rng)
        img.save(os.path.join(args.out, name + '.png'), optimize=True)
        a = np.asarray(img)
        nb = int(((a[..., 0] == 0) & (a[..., 1] == 0) & (a[..., 2] == 255) & (a[..., 3] > 0)).sum())
        ny = int(((a[..., 0] == 255) & (a[..., 1] == 255) & (a[..., 2] == 0) & (a[..., 3] > 0)).sum())
        print(name, img.size, 'thruster px', nb, 'light px', ny)
        made.append((name, img))
    if args.preview:
        contact_sheet(args.preview, made, dest)


# In-game sizes (BuiltObject.size) the sheet scales by: the planet destroyer and the escorts / dock of a typical wake.
SIZES = {'frigate': 351, 'destroyer': 396, 'cruiser': 664, 'capitalship': 993, 'carrier': 616, 'trooptransport': 348,
         'base_0': 900, 'base_1': 1477, 'planetdestroyer': 2373}


def as_drawn(img):
    """The frame as the game draws it: marker pixels painted out (shipArt.ts paintOutShipMarkers)."""
    a = np.asarray(img).copy()
    m = (((a[..., 0] == 0) & (a[..., 1] == 0) & (a[..., 2] == 255)) | ((a[..., 0] == 255) & (a[..., 1] == 255) & (a[..., 2] == 0))) & (a[..., 3] > 0)
    for y, x in np.argwhere(m):
        up, dn = a[max(0, y - 1), x].astype(int), a[min(a.shape[0] - 1, y + 1), x].astype(int)
        a[y, x] = ((up + dn) // 2).astype(np.uint8)
    return Image.fromarray(a, 'RGBA')


def crop_square(img):
    """shipImageMetrics: the square crop round the non-transparent, non-opaque-black pixels (padded by 4), and the
    drawn side at the closest zoom, sqrt(size * areaRatio * 8) for areaRatio = side^2 / count."""
    a = np.asarray(img.convert('RGBA'))
    m = (a[..., 3] > 0) & ~((a[..., :3].max(2) == 0) & (a[..., 3] == 255))
    ys, xs = np.nonzero(m)
    x0, x1, y0, y1 = xs.min() - 4, xs.max() + 4, ys.min() - 4, ys.max() + 4
    side = max(x1 - x0, y1 - y0) + 1
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    box = (int(cx - side / 2), int(cy - side / 2), int(cx - side / 2) + side, int(cy - side / 2) + side)
    return img.convert('RGBA').crop(box), side * side / int(m.sum())


def contact_sheet(out_dir, made, dest):
    """Row 1: each frame at full size. Rows 2-3: the frames and the planet destroyer at their drawn sizes at the
    closest zoom and at a quarter of it (play zoom)."""
    os.makedirs(out_dir, exist_ok=True)
    full = [as_drawn(img) for _, img in made]
    W = sum(i.width + 16 for i in full) + 16
    top = max(i.height for i in full) + 24
    sheet = Image.new('RGBA', (max(W, 1400), top + 300), (6, 7, 11, 255))
    x = 16
    for i in full:
        sheet.alpha_composite(i, (x, 8))
        x += i.width + 16
    for zoom, py in ((1.0, top), (0.25, top + 230)):
        x = 16
        for name, i in [(n, f) for (n, _), f in zip(made, full)] + [('planetdestroyer', dest.convert('RGBA'))]:
            crop, ratio = crop_square(i)
            s = max(3, int(math.sqrt(SIZES[name] * ratio * 8) * zoom))
            sheet.alpha_composite(crop.resize((s, s), Image.LANCZOS), (x, py))
            x += s + 12
    sheet.save(os.path.join(out_dir, 'sheet.png'))
    print('sheet', os.path.join(out_dir, 'sheet.png'))


if __name__ == '__main__':
    main()
