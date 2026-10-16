#!/usr/bin/env python3
"""The Purifier's escort and dock art (Galactic Threats add-on): "war-forged", the planet destroyer's sister ships
after ages of fighting, broken war machines refitted round one great weapon each. Hulls of our own outline (angled
armour, wedge prows, stepped shoulders) with stock detail cut up and set into them: parts of the AncientHelpers set
(the planet destroyer's own family: champagne and silver plates, copper rods) in their own colours, machinery from the
Shakturi, Freedom Alliance and Phantom Pirates sets painted in the destroyer's metal, so no stock ship is recognisable.
Battered: missing plates exposing the ribbed frame inside, gouges, craters, scorch, melted edges, gunmetal / steel
patches welded over old holes, chipped edges.
Offline build step; the outputs are our derived art, committed under public/art/purifier/ (src/render/threatArt.ts
purifierArtUrl draws them for the Purifier faction's escorts and guards by subRole, base_1 for its dock - the repair
station - and base_0 for any other base of the faction). The planet destroyer itself keeps the stock
other/planetdestroyer.png: the one unbroken weapon, the only one with a glowing core.

    python3 -I scripts/purifier-ships.py [--dwu <DW:U install>] [--out public/art/purifier] [--preview <dir>]
        [--only frigate,base_1]

Reads images/units/ships/other/MajorSets/{AncientHelpers,Shakturi,FreedomAlliance,PhantomPirates}/<file>.png and
other/planetdestroyer.png from the install (default public/assets/dwu, the symlink npm run import-assets makes). Needs
Python 3 with numpy and Pillow only. Deterministic (fixed seeds per output).

Per output frame (bow up, as the stock frames; square canvas with a margin for the masts):
1. Assembly: a drawn hull per escort (our polygon outline shaded as faceted angled armour either side of a ridge, a
   creased prow, seams, a spine), stock detail crops from four families re-scaled / rotated / flipped and clipped to
   that outline, parts cut out of AncientHelpers frames along polygons (a curved leaf of armour, a copper rod rack),
   the Shakturi station bodies for the dock and outpost, and procedural parts (tapered gun barrels with baffled
   muzzle brakes and copper rings, turrets with mantlets, armoured gun collars, a sensor dish, a missile launcher,
   antennas, rounded stepped bridge towers, curved fairings, weapon struts, engine blocks, an angled flight deck,
   drop pods, see-through lattice trusses, the dock's cradle ring and clamp arms, drifting debris), layered back to
   front, each casting a soft contact shadow on what is below. The stock pieces carry their shading (levelled
   luminance), their native colour (AncientHelpers), their lights as a glow channel and their thruster (pure blue) /
   light (pure yellow) marker pixels as points, mapped through each placement and dropped where a later piece covers
   them (the drawn engine blocks carry the escorts' thrusters).
   Asymmetric by design: one dominant feature on one side, counterweighted by armour / engine mass on the other: a
   small frigate with an offset sensor array (lattice mast, dish, long antennas) on a starboard sponson; a slim
   destroyer with a missile-launcher pod on a boom to port and a counterweight pod to starboard; a cruiser with a
   modest offset pair of turrets on its port shoulder; the capital ship, the only big gun, under an off-centre siege
   cannon the length of the hull and past the bow (its breech sunk into the hull, armoured collars), armour along the
   port flank and an offset bridge tower; a carrier with an angled flight deck to port (lanes, chevrons, landing
   lights, hangar lifts) and its superstructure to starboard; a troop transport with a drop-pod rack to port and a
   ram prow. Like the planet destroyer's spikes, thin antennas and masts radiate past every outline (the dock's too),
   their tips and beads pure-yellow nav-light markers, so they blink at runtime as the Purifier's own lights do.
2. Paint: the stock AncientHelpers pieces keep their own colour at the new value (a little toward the destroyer's
   ramp); procedural parts and the other families' pieces are gradient-mapped onto the planet destroyer's metal ramp
   (the median colour of its pixels per luminance band: silver, champagne, warm dark steel, a touch warmed as its
   champagne plates); guns in its dark steel, trims in its copper.
3. Battle damage (never mirrored): grime, gunmetal / steel / dark champagne patches (seams, rivet rows, some
   overhanging the hull edge), broad scorch, missing plates (a dark hole with the ribs and stringers inside, a torn lit
   lip), skeletal breaches at the hull edge (the skin gone, space showing between the ribs, the edge rail of the
   outline left standing), impact craters (lit rim, cracks, soot halo), long gouges, shallow melted edges (slag rim,
   heat tint), small chips and fine pitting: the damage sits inside the silhouette, which keeps its shape. Value
   contrast: recesses darkened, raised detail lifted, lit metal on the outline's upper-left edges and shadow on the
   far ones, then a dark outline (1 px on the ships, 2 px on the stations) so the frames read on bright and red
   nebulae. Sized for the drawn sizes (about 60-130 px at the closest zoom, 15-35 px at play zoom).
4. Lights: the core lights and lamps become small dim points of the destroyer's pale core light, a third of them dead.
   The marker pixels are written back exactly ((0,0,255) thruster runs at the engines, (255,255,0) nav-light points),
   no other pixel left in either marker colour (ambientLayer.ts scanShipMarkers) and no opaque black
   (shipImageMetrics).
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

# 'nat' / 'cr' 'cg' 'cb': the native colour of the stock pieces kept as they are (weight, colour·weight)
MATS = ('dark', 'thin', 'pod', 'cradle', 'gun', 'gold', 'nat', 'cr', 'cg', 'cb')


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
    def load(cls, root, name, crop=None, lo=0.03, hi=0.97, keep_marks=True, kit='AncientHelpers'):
        """A stock frame (or a crop of it). The AncientHelpers pieces (the planet destroyer's own family) keep their
        native colour; their pale core lights ride along as the glow channel. Shakturi pieces: shading only, their red
        lamps as the glow."""
        key = (name, crop, lo, hi, keep_marks, kit)
        if key in cls.cache:
            return cls.cache[key]
        img = Image.open(os.path.join(root, 'MajorSets', kit, name + '.png')).convert('RGBA')
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
        native = kit == 'AncientHelpers'
        if native:  # the pale cyan-white core light (blue over red, bright)
            glow = (rgb[..., 2] > rgb[..., 0] + 0.04) & (val > 0.7) & ~marker & (alpha > 0.3)
        else:  # the red lamps
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
        mats = None
        if native:
            c = np.where(glow[..., None], fill[..., None] * 0.5, rgb)  # the lights' own pixels repainted dim
            mats = {'nat': np.ones(alpha.shape)[sl], 'cr': c[..., 0][sl], 'cg': c[..., 1][sl], 'cb': c[..., 2][sl]}
        p = cls(L[sl], alpha[sl], gl[sl], mats, marks)
        p.off = ((crop[0] if crop else 0) + bb[0], (crop[1] if crop else 0) + bb[1])
        cls.cache[key] = p
        return p

    @classmethod
    def cut(cls, root, name, poly, kit='AncientHelpers', keep_marks=False):
        """A part cut out of a stock frame along the polygon `poly` (frame px): a leaf of armour, a rod rack."""
        xs_, ys_ = [q[0] for q in poly], [q[1] for q in poly]
        crop = (int(min(xs_)), int(min(ys_)), int(math.ceil(max(xs_))) + 1, int(math.ceil(max(ys_))) + 1)
        src = cls.load(root, name, crop, keep_marks=keep_marks, kit=kit)
        h, w = src.A.shape
        k = 4
        im = Image.new('L', (w * k, h * k), 0)
        ImageDraw.Draw(im).polygon([((x - src.off[0]) * k, (y - src.off[1]) * k) for (x, y) in poly], fill=255)
        m = np.asarray(im.resize((w, h), Image.BOX)).astype(np.float64) / 255
        return cls(src.L, src.A * m, src.G, src.mats, [mk for mk in src.marks if m[min(h - 1, int(mk[1])), min(w - 1, int(mk[0]))] > 0.5])

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
    def __init__(self, w, h=None, pad=0):
        """A w x h layout area (the coordinates every put uses), with `pad` px of margin all round for the masts."""
        h = w if h is None else h
        self.pad = pad
        self.w0 = w
        w, h = w + 2 * pad, h + 2 * pad
        self.w, self.h = w, h
        self.L = np.zeros((h, w))  # premultiplied
        self.A = np.zeros((h, w))
        self.G = np.zeros((h, w))
        self.T = np.zeros((h, w))  # per-piece tone offset
        self.M = {m: np.zeros((h, w)) for m in MATS}
        self.marks = []            # (x, y, kind) canvas px

    def put(self, piece, cx, cy, scale=1.0, rot=0, flipx=False, flipy=False, shadow=0.55, gain=1.0, tone=0.0, mirror=False,
            sx=1.0, sy=1.0, mat=None, marks=True, glow=1.0, clip=None):
        """Layer a piece over the canvas centred at (cx, cy). `mirror`: also at the mirrored x. `mat`: tag the
        piece's pixels with a material (MATS). `clip`: a canvas mask the piece is cut to (detail set into a hull)."""
        cy = cy + self.pad
        for m in ([False, True] if mirror else [False]):
            x = self.pad + (self.w0 - cx if m else cx)
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
            if clip is not None:
                full = [f * clip for f in full]
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


def chaikin(poly, n=1):
    """Corner-cutting: each pass bevels every corner of the closed polygon (n=1: angled armour, n=3: curves)."""
    for _ in range(n):
        q = []
        for i in range(len(poly)):
            (x0, y0), (x1, y1) = poly[i], poly[(i + 1) % len(poly)]
            q += [(0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1), (0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1)]
        poly = q
    return poly


def poly_mask(w, h, poly):
    k = 4
    im = Image.new('L', (w * k, h * k), 0)
    ImageDraw.Draw(im).polygon([(x * k, y * k) for (x, y) in poly], fill=255)
    return np.asarray(im.resize((w, h), Image.BOX)).astype(np.float64) / 255


def hull(poly, bevel=1, round_=0.3, seams=(), spine=None, keel=None):
    """A hull of our own outline, bow up: the polygon `poly` (px; corners bevelled `bevel` times) as an armoured
    volume (shaded from its blurred outline: rounded flanks, a lit upper-left edge band, a dark far one), stock
    plating ground in, armour seams (`seams`: (y, slope) lines across, angled), an optional raised spine strip
    (`spine`: (x, y0, y1, width)) and a dark keel groove (`keel`: (x0, y0, x1, y1))."""
    poly = chaikin(poly, bevel)
    w = int(math.ceil(max(p[0] for p in poly))) + 2
    h = int(math.ceil(max(p[1] for p in poly))) + 2
    A = poly_mask(w, h, poly)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64) + 0.5
    solid = A > 0.5
    span = max(3.0, np.sqrt(solid.sum() / max(1, solid.any(1).sum())) * round_ * 4)
    b = fblur(A, span * 0.5)
    gy, gx = np.gradient(b)
    nx, ny = -gx * span * 1.6, -gy * span * 1.6
    # angled armour: two facets either side of a ridge (the row's midline, or the spine), a creased prow facet
    rows = solid.any(1)
    lft = np.where(rows, np.argmax(solid, 1), 0).astype(np.float64)
    rgt = np.where(rows, w - 1 - np.argmax(solid[:, ::-1], 1), 0).astype(np.float64)
    ridge = (lft + rgt) / 2 if spine is None else np.full(h, float(spine[0]))
    fx = np.tanh((xx - ridge[:, None]) / 1.2) * 0.52
    y_top = np.argmax(rows) if rows.any() else 0
    prow = yy < y_top + (h - y_top) * 0.2
    fy = np.where(prow, -0.38, 0.06)
    nx = np.clip(nx + fx, -1, 1)
    ny = np.clip(ny + fy, -1, 1)
    nz = np.sqrt(np.clip(1 - nx ** 2 - ny ** 2, 0.05, 1))
    L = _shade(nx, ny, nz, amb=0.16, k=0.8)
    crease = (np.abs(yy - (y_top + (h - y_top) * 0.2)) < 0.8) | (np.abs(xx - ridge[:, None]) < 0.7)
    L = np.where(crease & solid, np.minimum(1, L * 1.3 + 0.04), L)
    # a chamfered armour band round the outline (lit where it faces the light, dark on the far side), an inset
    # panel line following the outline, rivets along it
    dep = depth_inside(solid, 8)
    bg = fblur(A, 2.0)
    oy, ox = np.gradient(bg)
    on = np.hypot(ox, oy) + 1e-6
    face = (-(ox / on) * LIGHT[0] - (oy / on) * LIGHT[1])
    band = solid & (dep <= 3)
    L = np.where(band, L * np.where(face > 0.15, 1.35, np.where(face < -0.15, 0.55, 0.9)) + np.where(band & (face > 0.15), 0.05, 0), L)
    L = np.where(solid & (dep == 6), L * 0.5, L)
    L = np.where(solid & (dep == 7), np.minimum(1, L * 1.2), L)
    L = np.where(solid & (dep == 4) & (((xx + yy).astype(int) % 6) == 0), L * 0.55, L)
    L = tex(L, yy * 0.9, xx * 1.1 + 5, 0.34)
    for (y, sl) in seams:
        line = np.abs(yy - (y + sl * (xx - w / 2))) < 0.7
        L = np.where(line, L * 0.4, L)
        L = np.where(np.abs(yy - (y + 1.4 + sl * (xx - w / 2))) < 0.7, np.minimum(1, L * 1.25), L)
    gold = np.zeros((h, w))
    if spine is not None:
        sx_, y0, y1, sw = spine
        m = (np.abs(xx - sx_) < sw / 2) & (yy > y0) & (yy < y1)
        L = np.where(m, np.where(xx < sx_ - sw / 2 + 1.5, np.minimum(1, L * 1.4 + 0.05), np.where(xx > sx_ + sw / 2 - 1.5, L * 0.5, L * 1.12)), L)
        gold = np.where(m & (np.abs(xx - sx_) < 0.8), 0.7, gold)
    if keel is not None:
        x0, y0, x1, y1 = keel
        t = np.clip(((xx - x0) * (x1 - x0) + (yy - y0) * (y1 - y0)) / max(1e-6, (x1 - x0) ** 2 + (y1 - y0) ** 2), 0, 1)
        d = np.hypot(xx - (x0 + t * (x1 - x0)), yy - (y0 + t * (y1 - y0)))
        L = np.where(d < 1.6, L * 0.35, L)
    return Piece(L, A, None, {'gold': gold * (A > 0.5)})


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
    L = tex(L, yy * 0.9, xx * 1.1 + 7, 0.45) * 0.86
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


def barrel(w, length, jacket=0.38, bands=(0.3, 0.5, 0.7), brake=True):
    """A long gun barrel along y, muzzle up: a tube widening a little aft, a muzzle brake (a wider block with vent
    slots, copper-edged) at the tip, copper reinforcing rings, a heavier dark jacket over the aft `jacket` of it with
    cooling grooves, a dark bore at the muzzle."""
    W = int(math.ceil(w * 1.8)) + 2
    yy, xx = np.mgrid[0:length, 0:W].astype(np.float64) + 0.5
    t = yy / length
    half = w * (0.34 + 0.2 * t)  # tapering to the muzzle
    jk = t > 1 - jacket
    half = np.where(jk, w * 0.8, half)
    bk = max(5.0, min(w * 1.5, 7 + w * 0.5))
    if brake:  # a baffled muzzle brake: wider than the tube, cut through by two side ports
        half = np.where(yy < bk, w * 0.62, half)
        ports = (yy > bk * 0.3) & (yy < bk * 0.3 + max(1.5, bk * 0.18)) | (yy > bk * 0.62) & (yy < bk * 0.62 + max(1.5, bk * 0.18))
        half = np.where(ports, w * 0.36, half)
    nx = (xx - W / 2) / half
    A = np.clip((1 - np.abs(nx)) * half * 1.4, 0, 1) * (yy > 0.5)
    nz = np.sqrt(np.clip(1 - nx ** 2, 0, 1))
    L = _shade(nx, np.full_like(nx, -0.05), nz, amb=0.12, k=0.66)
    gold = np.zeros((length, W))
    dark = np.where(jk, 0.55, 0.0)
    L = np.where(jk & ((yy.astype(int) % 7) == 0), L * 0.7, L)
    if w >= 12:  # recoil rails down the tube: a lit line on the light side, a dark groove on the far one
        tube = (yy >= bk) & ~jk
        L = np.where(tube & (np.abs(nx + 0.55) < 0.08), np.minimum(1, L * 1.25), L)
        L = np.where(tube & (np.abs(nx - 0.5) < 0.1), L * 0.55, L)
    if brake:
        gold = np.where(np.abs(yy - bk - 0.5) < 1.0, 1.0, gold)
    bw = max(1, int(round(w * 0.16)))
    for f in bands:
        y = int(f * length)
        gold[y:y + bw] = 1
        if y + bw < length:
            L[y + bw] *= 0.55
    y = int((1 - jacket) * length)
    gold[y:y + bw] = 1
    bore = (yy < 3) & (np.abs(xx - W / 2) < max(1.0, w * 0.24))
    L = np.where(bore, 0.04, L)
    gold = np.where(bore, 0, gold)
    return Piece(L, A, None, {'gun': np.ones((length, W)), 'gold': gold * (A > 0.3), 'dark': dark})


def turret(r, slot=True):
    """A gun mount seen from above: a round armoured base with a raised mantlet over the barrel (forward), a dark
    gap round the base, the barrel slot, a copper ring on the mantlet's front arc."""
    s_ = int(math.ceil(2 * r)) + 2
    yy, xx = np.mgrid[0:s_, 0:s_].astype(np.float64) + 0.5
    nx, ny = (xx - s_ / 2) / r, (yy - s_ / 2) / r
    rr = np.sqrt(nx ** 2 + ny ** 2)
    A = np.clip((1 - rr) * r * 1.3, 0, 1)
    nz = np.sqrt(np.clip(1 - (rr * 0.85) ** 2, 0, 1))
    L = _shade(nx * 0.85, ny * 0.85, nz, amb=0.16, k=0.7)
    L = np.where((rr > 0.84) & (rr < 0.92), L * 0.45, L)  # the gap round the base
    # the mantlet: a raised rounded block over the forward half
    mu, mv = nx / 0.6, (ny + 0.15) / 0.62
    mr = np.sqrt(mu ** 2 + np.where(mv > 0, mv * 1.6, mv) ** 2)
    mant = mr < 1
    L = np.where(mant, _shade(mu * 0.6, mv * 0.5, np.sqrt(np.clip(1 - (mr * 0.7) ** 2, 0, 1)), amb=0.24, k=0.72), L)
    L = np.where(mant & (mr > 0.86), L * np.where(mu + mv < 0, 1.3, 0.55), L)
    gold = (mant & (mr > 0.78) & (mr < 0.9) & (mv < -0.2)).astype(np.float64)
    if slot:
        sl = (np.abs(nx) < 0.13) & (ny < -0.3) & mant
        L = np.where(sl, 0.06, L)
        gold = np.where(sl, 0, gold)
    return Piece(L, A, None, {'gun': np.ones((s_, s_)), 'gold': gold})


def tower(w, h, tiers=3, windows=True):
    """An offset bridge tower seen from above: stacked rounded tiers (each smaller, set back and higher: brighter),
    pointed at the bow, a lit rim and a shadowed far side on each, a row of small dim windows across the front of
    each tier (glow), a sensor spike on top."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64) + 0.5
    L = np.zeros((h, w))
    A = np.zeros((h, w))
    G = np.zeros((h, w))
    gold = np.zeros((h, w))
    for k in range(tiers):
        f = k / tiers
        cx, cy = w / 2, h * (0.56 + 0.06 * f)
        rx, ry = w / 2 * (1 - f * 0.32), h / 2 * (1 - f * 0.36)
        u, q = (xx - cx) / rx, (yy - cy) / ry
        q = np.where(q < 0, q * (1 + 0.35 * np.abs(u)), q)  # a pointed bow
        rr = np.sqrt(u ** 2 + q ** 2)
        m = rr < 1
        base = 0.4 + k * 0.1
        nz = np.sqrt(np.clip(1 - rr ** 2 * 0.5, 0, 1))
        lk = _shade(u * 0.7, q * 0.7, nz, amb=base * 0.5, k=0.55)
        L = np.where(m, lk, L)
        L = np.where(m & (rr > 0.86), lk * np.where(u + q < 0, 1.35, 0.5), L)
        A = np.where(m, np.maximum(A, np.clip((1 - rr) * min(rx, ry) * 1.3, 0, 1)), A)
        if windows:
            win = (np.abs(q + 0.62) < 0.09) & (np.abs(u) < 0.55) & ((xx.astype(int) % 3) == 0) & m
            G = np.where(win, 0.6, G)
            L = np.where(win, 0.12, L)
        gold = np.where(m & (np.abs(rr - 0.8) < 0.04), 0.7, gold)
    spike = (np.abs(xx - w / 2) < 1.0) & (yy > h * 0.08) & (yy < h * 0.5)
    L = np.where(spike, 0.7, L)
    A = np.where(spike, 1.0, A)
    gold = np.where(spike, 1.0, gold)
    L = tex(L, yy * 1.3, xx * 1.3 + 3, 0.3)
    return Piece(L, A, G, {'gun': np.ones((h, w)) * 0.35, 'gold': gold})


def engine(w, h):
    """An engine block, bow up: an armoured housing with a ribbed top, a round bell at the stern, the thruster marks
    along the bell's aft rim (ambientLayer.ts draws the exhaust there)."""
    bh = max(6, int(h * 0.22))
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64) + 0.5
    body = yy < h - bh
    nx = (xx - w / 2) / (w / 2)
    cap = yy < w * 0.35
    A = np.where(body, np.clip((1 - np.abs(nx)) * w * 0.6, 0, 1), 0)
    A = np.where(cap, A * ((nx ** 2 + ((w * 0.35 - yy) / (w * 0.35)) ** 2) <= 1.05), A)
    L = _shade(nx * 0.7, np.full_like(nx, -0.1), np.sqrt(np.clip(1 - (nx * 0.7) ** 2, 0, 1)), amb=0.16, k=0.7)
    L = np.where(body & ((yy.astype(int) % 6) == 0), L * 0.6, L)
    bw0, bw1 = w * 0.55, w * 0.8
    tb = (yy - (h - bh)) / bh
    half = (bw0 + (bw1 - bw0) * np.clip(tb, 0, 1)) / 2
    bell = (~body) & (np.abs(xx - w / 2) < half)
    bnx = (xx - w / 2) / np.maximum(half, 1)
    L = np.where(bell, _shade(bnx, np.full_like(bnx, 0.1), np.sqrt(np.clip(1 - bnx ** 2, 0, 1)), amb=0.12, k=0.6) * 0.8, L)
    A = np.where(bell, 1.0, A)
    L = tex(L, yy * 1.1, xx * 1.6 + 21, 0.4)
    marks = [(x + 0.5, h - 1.5, 1) for x in range(int(w / 2 - bw1 / 2 + 2), int(w / 2 + bw1 / 2 - 1))]
    return Piece(L, A, None, {'gun': np.where(bell, 1.0, 0.0)}, marks)


def deck(w, h, lean=1):
    """An angled flight deck, bow up: a long flat plate on a lopsided outline (a pointed, angled bow, the outer edge
    swept in toward the stern, an angled stern cut); deck markings (twin landing-lane lines, a dashed centre line,
    chevrons at the stern pointing the way in, a touchdown bar), rows of landing lights down both edges and an
    approach line at the stern (baked dim lights), two launch slots at the bow and two lift openings (hangars) with
    lit lips, bevelled sides, nav lights on the bow corners. `lean` -1 mirrors the outline."""
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64) + 0.5
    poly = [(w * 0.62, 0), (w, h * 0.1), (w, h * 0.9), (w * 0.72, h), (w * 0.2, h * 0.94), (0, h * 0.7), (w * 0.08, h * 0.2)]
    if lean < 0:
        poly = [(w - x, y) for (x, y) in poly]
    A = poly_mask(w, h, poly)
    solid = A > 0.5
    d = depth_inside(solid, 4)
    L = np.full((h, w), 0.5) + 0.04 * np.sin(yy * 0.08)
    L = tex(L, yy, xx + 17, 0.26)
    for k in range(1, 12):  # deck plating seams across
        y = int(k * h / 12)
        L[y] *= 0.62
    cxl = w * 0.55 if lean >= 0 else w * 0.45
    lane = (yy > h * 0.2) & (yy < h * 0.9)
    off = (yy - h / 2) * 0.06 * lean
    for dxl in (-w * 0.2, w * 0.2):
        L = np.where(lane & (np.abs(xx - cxl - dxl - off) < 0.7), 0.88, L)
    L = np.where(lane & (np.abs(xx - cxl - off) < 0.8) & ((yy.astype(int) // 6) % 2 == 0), 0.9, L)
    for k in range(3):  # chevrons at the stern
        yc = h * (0.8 - 0.035 * k)
        chev = (np.abs(yy - (yc - np.abs(xx - cxl - off) * 0.5)) < 0.8) & (np.abs(xx - cxl - off) < w * 0.16)
        L = np.where(chev, 0.92, L)
    L = np.where((np.abs(yy - h * 0.66) < 1.2) & (np.abs(xx - cxl - off) < w * 0.2), 0.85, L)  # touchdown bar
    G = np.zeros((h, w))
    for (yf, wd) in ((0.08, 0.07), (0.12, 0.07)):  # launch slots
        m = (np.abs(yy - h * yf) < 1.6) & (np.abs(xx - cxl - w * (0.12 if yf < 0.1 else -0.12)) < w * wd)
        L = np.where(m, 0.05, L)
    for yf in (0.34, 0.5):  # lift openings: dark hangar wells, a lit upper lip, a shadowed lower one
        m = (np.abs(yy - h * yf) < h * 0.035) & (np.abs(xx - cxl + w * 0.12 - off) < w * 0.16)
        L = np.where(m, 0.07, L)
        L = np.where(dilate(m, 1) & ~m & (yy < h * yf), 0.9, np.where(dilate(m, 1) & ~m, L * 0.4, L))
        G = np.where(m & (np.abs(yy - h * yf) < 0.6) & ((xx.astype(int) % 3) == 0), 0.35, G)
    edge = solid & (d <= 2)
    ul = edge & (shift(~solid, 1, 0) | shift(~solid, 0, 1))
    L = np.where(ul, 0.85, np.where(edge, L * 0.5, L))
    for y in range(int(h * 0.18), int(h * 0.9), 9):  # landing lights down both edges
        row = np.nonzero(solid[y])[0]
        if len(row) > 8:
            G[y, row[0] + 3] = G[y, row[-1] - 3] = 0.65
    for y in range(int(h * 0.9), int(h * 0.97), 3):  # the approach line
        G[y, int(cxl + (y - h / 2) * 0.06 * lean)] = 0.6
    marks = []
    for (x, y) in (poly[0], poly[1]):
        marks.append((min(w - 3, max(3, x + (3 if x < w / 2 else -3))), y + 4, 2))
    return Piece(L, A, G, {'dark': np.full((h, w), 0.12)}, marks)


def fairing(w, h, nose=0.35, tail=0.2, lean=0.0, bolts=2):
    """A curved armour fairing, bow up (the family's leaf-shaped side pods): pointed nose and tail on an ogive outline,
    `lean` bends it (the nose shifted by lean·w), rounded shading, a raised spine, seams across, bolt rings."""
    W = w + int(abs(lean) * w) + 4
    yy, xx = np.mgrid[0:h, 0:W].astype(np.float64) + 0.5
    t = yy / h
    tn = np.clip(t / nose, 0, 1)
    prof = np.where(t < nose, np.sqrt(tn * (2 - tn)), 1.0)
    prof = np.where(t > 1 - tail, np.sqrt(np.clip((1 - t) / tail, 0, 1)) * 0.6 + 0.4 * (1 - t) / tail, prof)
    cx = W / 2 - lean * w * 0.5 + lean * w * t ** 1.5
    half = np.maximum(w / 2 * prof, 0.01)
    nx = (xx - cx) / half
    A = np.clip((1 - np.abs(nx)) * half * 1.2, 0, 1) * (half > 0.6)
    nz = np.sqrt(np.clip(1 - nx ** 2, 0, 1))
    L = _shade(nx * 0.85, np.full_like(nx, -0.15) + (t < nose) * -0.25, nz, amb=0.16, k=0.78)
    L = np.where(np.abs(nx) < 0.08, np.minimum(1, L * 1.2), L)
    for f in (0.3, 0.55, 0.78):
        y = int(f * h)
        L[y:y + 1] *= 0.45
        L[y + 1:y + 2] = np.minimum(1, L[y + 1:y + 2] * 1.2)
    gold = np.zeros((h, W))
    for k in range(bolts):
        by = h * (0.42 + 0.22 * k)
        bx = W / 2 - lean * w * 0.5 + lean * w * (by / h) ** 1.5
        r = np.sqrt((xx - bx - w * 0.18) ** 2 + (yy - by) ** 2)
        ringm = (r > w * 0.07) & (r < w * 0.12)
        L = np.where(ringm, L * 0.55, L)
        gold = np.where((r <= w * 0.07) & (A > 0.5), 1.0, gold)
    L = tex(L, yy * 1.2, xx * 1.4 + 9, 0.3)
    return Piece(L, A, None, {'gold': gold * 0.8})


def strut(w, length, bevel=2):
    """A solid beam (a weapon arm or a pylon) along y: bevelled, lit top edge, ribbed every 7 px."""
    yy, xx = np.mgrid[0:length, 0:w].astype(np.float64) + 0.5
    nx = (xx - w / 2) / (w / 2)
    L = _shade(nx * 0.5, np.zeros_like(nx), np.sqrt(1 - (nx * 0.5) ** 2), amb=0.2, k=0.65)
    L = np.where(xx < bevel, np.minimum(1, L * 1.3), np.where(xx > w - bevel, L * 0.5, L))
    L = np.where((yy.astype(int) % 7) == 0, L * 0.6, L)
    return Piece(L, np.ones((length, w)), None, {'gun': np.full((length, w), 0.6)})


def antenna(length, w=2.4, bars=(0.55,), beads=(), rings=(0.3, 0.75)):
    """A thin mast along y, tip up (the planet destroyer's spikes): tapering from `w` at the root to a hair at the
    tip, lit on its left edge, copper rings, small cross-bars at `bars` fractions, a nav light at the tip and at the
    `beads` fractions: pure-yellow marker points, so they blink at runtime with the stock nav lights as the
    Purifier's own spike lights do; a small baked pale bead under each."""
    W = int(math.ceil(w * 3)) + 4
    yy, xx = np.mgrid[0:length, 0:W].astype(np.float64) + 0.5
    t = yy / length
    half = 0.45 + (w / 2 - 0.45) * t
    dx = xx - W / 2
    A = np.clip(half + 0.5 - np.abs(dx), 0, 1)
    nx = np.clip(dx / np.maximum(half, 0.5), -1, 1)
    L = _shade(nx, np.zeros_like(nx), np.sqrt(np.clip(1 - nx ** 2, 0, 1)), amb=0.3, k=0.75)
    gold = np.zeros((length, W))
    for f in rings:
        y = int(f * length)
        gold[y:y + 2] = 1
    for f in bars:
        y = int(f * length)
        bw = w * 1.6
        m = (np.abs(yy - y - 0.5) < 0.8) & (np.abs(dx) < bw)
        A = np.where(m, 1.0, A)
        L = np.where(m, 0.6, L)
    G = np.zeros((length, W))
    knob = (np.abs(dx) < 1.3) & (yy < 4.5)  # the tip knob that carries the light
    A = np.where(knob, 1.0, A)
    A[:1] = 0
    marks = [(W / 2, 2.5, 2)]
    G = np.where(knob & (yy > 3), 0.7, G)
    for f in beads:
        y = int(f * length)
        bead = (np.abs(dx) < 1.3) & (np.abs(yy - y - 0.5) < 1.6)
        A = np.where(bead, 1.0, A)
        marks.append((W / 2, y + 0.5, 2))
    return Piece(L, A, G, {'gold': gold * (A > 0.3)}, marks)


def dish(r):
    """A sensor dish seen from above: a concave bowl (lit on its far, lower-right inner wall), a lit rim, three struts
    to a feed horn with a pale light at the centre."""
    s_ = int(math.ceil(2 * r)) + 2
    yy, xx = np.mgrid[0:s_, 0:s_].astype(np.float64) + 0.5
    nx, ny = (xx - s_ / 2) / r, (yy - s_ / 2) / r
    rr = np.sqrt(nx ** 2 + ny ** 2)
    A = np.clip((1 - rr) * r * 1.3, 0, 1)
    L = _shade(-nx * 0.7, -ny * 0.7, np.sqrt(np.clip(1 - (rr * 0.7) ** 2, 0, 1)), amb=0.18, k=0.7)
    L = np.where(rr > 0.86, _shade(nx, ny, np.full_like(nx, 0.4), amb=0.25, k=0.8), L)
    ang = np.arctan2(ny, nx)
    strut_ = (np.abs(((ang + math.pi / 2) % (2 * math.pi / 3)) - math.pi / 3) > math.pi / 3 - 0.09) & (rr < 0.86)
    L = np.where(strut_, 0.7, L)
    G = np.where(rr < 0.14, 0.7, 0.0)
    gold = ((rr > 0.86) & (rr < 0.95)).astype(np.float64)
    return Piece(L, A, G, {'gold': gold})


def launcher(w, h, rows=4, cols=2):
    """A missile / torpedo launcher pod, bow up: a pointed armoured pod with a block of round launch tubes (dark
    mouths, lit rims) set into its back, copper trim round the block."""
    base = fairing(w, h, nose=0.22, tail=0.12, bolts=0)
    L, A = base.L.copy(), base.A
    hh, ww = A.shape
    yy, xx = np.mgrid[0:hh, 0:ww].astype(np.float64) + 0.5
    gold = base.mats['gold'].copy()
    y0, y1 = hh * 0.3, hh * 0.86
    x0, x1 = ww / 2 - w * 0.32, ww / 2 + w * 0.32
    block = (yy > y0) & (yy < y1) & (xx > x0) & (xx < x1)
    L = np.where(block, L * 0.6, L)
    gold = np.where(block & ~((yy > y0 + 1.2) & (yy < y1 - 1.2) & (xx > x0 + 1.2) & (xx < x1 - 1.2)), 1.0, gold)
    pr, pc = (y1 - y0) / rows, (x1 - x0) / cols
    tr = min(pr, pc) * 0.36
    for i in range(rows):
        for j in range(cols):
            cy_, cx_ = y0 + (i + 0.5) * pr, x0 + (j + 0.5) * pc
            d = np.hypot(yy - cy_, xx - cx_)
            L = np.where(d < tr, 0.05, np.where((d < tr + 1.2) & (yy + xx < cy_ + cx_), np.minimum(1, L * 1.6 + 0.1), L))
    return Piece(L, A, None, {'gun': np.ones((hh, ww)), 'gold': gold})


def collar(r, w):
    """An armoured collar round a gun barrel where it leaves the hull: a short wide band with a lit front lip, dark
    grooves and copper rivets (seen from above: a rounded block across the barrel)."""
    W, H = int(math.ceil(r * 2)) + 2, int(math.ceil(w)) + 2
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64) + 0.5
    nx = (xx - W / 2) / r
    A = np.clip((1 - np.abs(nx)) * r * 1.4, 0, 1) * np.clip(np.minimum(yy, H - yy) * 1.5, 0, 1)
    L = _shade(nx, np.zeros_like(nx), np.sqrt(np.clip(1 - nx ** 2, 0, 1)), amb=0.18, k=0.72)
    L = np.where(yy < 1.6, np.minimum(1, L * 1.4), np.where(yy > H - 1.8, L * 0.5, L))
    L = np.where(np.abs(yy - H / 2) < 0.6, L * 0.5, L)
    gold = ((np.abs(yy - H / 2 + 1.5) < 0.7) & ((xx.astype(int) % 4) == 0)).astype(np.float64)
    return Piece(L, A, None, {'gun': np.ones((H, W)), 'gold': gold})


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
    groove = np.abs(np.abs(u) - 0.55) < 0.12
    L = np.where(groove, L * 0.7, L)
    L = tex(L, ang * 3, rr * 2, 0.4)
    gold = (groove & (u < 0) & ~rib).astype(np.float64) * 0.8  # a copper inlay along the inner groove
    for (a0, a1) in gaps:
        jag = 2.5 * np.sin(rr * 0.9) + 1.5 * np.cos(rr * 2.1)
        A = np.where((ang > a0 + jag) & (ang < a1 + jag), 0, A)
    mats = {'cradle': np.ones((s, s)), 'gold': gold}
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
        gold = np.where(claw & ~arm, 0.8, np.where(m, 0, gold))
        mats['gold'] = gold
    return Piece(L, A, None, mats)


def debris(rng, root, size):
    """A drifting hull fragment: a random crop of an AncientHelpers frame, its edges torn (noise-eaten)."""
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

def metal_ramp(dest):
    """The planet destroyer's own metal: the median colour of all its opaque pixels per 1/16 luminance band (silver,
    pale gold and champagne, warm dark steel in the recesses), its near-white highlights capped a little below white."""
    a = np.asarray(dest.convert('RGBA')).astype(np.float64)
    m = a[..., 3] == 255
    rgb = a[..., :3][m]
    lum = rgb @ LUM
    xs, cols = [], []
    for lo in range(0, 240, 16):
        q = (lum >= lo) & (lum < lo + 16)
        if q.sum() < 20:
            continue
        xs.append(np.median(lum[q]) / 255)
        cols.append(np.median(rgb[q], 0) / 255)
    xs = np.array([0.0] + xs + [1.0])
    cols = np.array([[0.0, 0.0, 0.0]] + cols + [cols[-1]])
    return xs, cols


def gold_accent(dest):
    """The destroyer's copper-gold trim (its saturated bright pixels' median)."""
    a = np.asarray(dest.convert('RGBA')).astype(np.float64) / 255
    rgb = a[..., :3]
    mx, mn = rgb.max(2), rgb.min(2)
    sat = (mx - mn) / np.maximum(mx, 1e-6)
    g = (a[..., 3] > 0.99) & (sat > 0.5) & (mx > 0.5)
    return np.median(rgb[g], 0)


def ramp_lookup(xs, cols, v):
    out = np.empty(v.shape + (3,))
    for c in range(3):
        out[..., c] = np.interp(v, xs, cols[:, c])
    return out


# Alloys of the patches (multipliers of the painted value): dull steel, gunmetal, dark champagne steel.
STEEL = np.array([0.62, 0.64, 0.68])
GUNM = np.array([0.46, 0.47, 0.50])
DARKC = np.array([0.66, 0.58, 0.48])
SOOT = np.array([0.055, 0.042, 0.034])
SLAG = np.array([0.10, 0.065, 0.045])
EMBER = np.array([1.0, 0.96, 0.78])  # the destroyer's core light, only ever small and dim here
GOLD = np.array([0.62, 0.42, 0.25])


def paint(L, A, T, M, xs, cols):
    """The destroyer's metal. The stock AncientHelpers pieces keep their own colour (champagne and silver plates,
    copper rods, dark steel machinery: the destroyer's family) at the new value; everything procedural is painted from
    the destroyer's ramp (silver / champagne by value); guns and mounts in its dark steel, trims in its copper gold;
    plain dark parts (trusses) darker."""
    v = np.clip(L * 1.0 * (1 + T), 0, 1)
    v = np.where(v > 0.72, 0.72 + (v - 0.72) * 0.85, v)  # worn: the highlights only a little dulled
    # value contrast: darker recesses, brighter raised edges (so the hulls do not blur together at play zoom)
    v = np.clip(v + (v - fblur(v * (A > 0.5), 2.5) / np.maximum(fblur((A > 0.5).astype(np.float64), 2.5), 1e-3)) * 0.8, 0, 1)
    ramp = np.clip(ramp_lookup(xs, cols, v) * np.array([1.02, 1.0, 0.97]), 0, 1)  # the destroyer's champagne plates
    nat = M['nat']
    c = np.stack([M['cr'], M['cg'], M['cb']], axis=2) / np.maximum(nat, 1e-3)[..., None]
    natc = np.clip(c * (v / np.maximum(c @ LUM, 0.04))[..., None], 0, 1)
    natc = natc * 0.8 + ramp * 0.2  # a little toward the destroyer's own ramp (the set has a faint green cast)
    out = ramp * (1 - nat[..., None]) + natc * nat[..., None]
    grey = np.repeat(v[..., None], 3, axis=2)
    gun = ramp_lookup(xs, cols, v * 0.7) * 0.82 + grey * 0.08  # dark gunmetal: the weapons stand off the hull
    k = M['gun'][..., None]
    out = out * (1 - k) + gun * k
    dark = out * np.clip(0.78 - 0.1 * v, 0, 1)[..., None] * 0.9
    k = np.clip(M['dark'] * 0.7, 0, 1)[..., None]
    out = out * (1 - k) + dark * k
    pale = GOLD * 0.55 + np.array([0.95, 0.82, 0.55]) * 0.45  # the destroyer's copper, toward its pale gold
    gold = np.clip(pale[None, None, :] * (0.5 + v[..., None] * 1.3), 0, 1)
    k = M['gold'][..., None] * 0.9
    out = out * (1 - k) + gold * k
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

    # -- mismatched alloy plates welded over old holes: seams, rivets, some overhanging the edge
    def patches(self, n, size=None):
        rng, side = self.rng, self.side
        alloys = [STEEL, GUNM, DARKC, STEEL, GUNM, DARKC]
        size = size or ((0.03, 0.065) if self.name.startswith('base') else (0.03, 0.06))
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
            base = np.clip(self.v * 0.35 + rng.uniform(0.1, 0.22), 0, 1)
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
            rail = hole & (self.depth <= 2) & (self.jag < 0.78)  # the outline stays: the hull's edge rail, rarely broken
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
    def missing(self, n, size=(0.08, 0.12)):
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
        self.refresh()

    # -- melted edges: the outline eaten into rounded bays, a slag rim, heat tint further in
    def melted(self, n, size=(0.05, 0.09)):
        rng, side = self.rng, self.side
        for (py, px) in pick_points(rng, self.cand(1, 2), n, side * 0.22, self.taken):
            r = side * rng.uniform(*size)
            d = np.sqrt((self.xx - px) ** 2 + (self.yy - py) ** 2) / r
            n2 = fbm(rng, self.h, self.w, max(2, int(r // 2)))
            eat = (d + (n2 - 0.5) * 0.8 < 0.6) & ~self.protect & (self.depth <= 3)  # shallow: the outline keeps its shape
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
            r = rng.uniform(1.0, 1.8)
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
    'frigate': (3, 2, 1, 0, 2, 1, 0, 8),
    'destroyer': (4, 3, 2, 1, 3, 2, 0, 10),
    'cruiser': (5, 3, 2, 1, 4, 2, 1, 12),
    'capitalship': (6, 4, 3, 1, 5, 3, 1, 14),
    'carrier': (5, 3, 2, 1, 4, 2, 1, 12),
    'trooptransport': (4, 3, 2, 0, 3, 2, 0, 10),
    'base_0': (5, 3, 2, 2, 3, 2, 2, 20),
    'base_1': (7, 4, 3, 2, 5, 3, 2, 30),
}


def build(root, name, rng):
    P = lambda f, crop=None, **k: Piece.load(root, f, crop, **k)  # noqa: E731
    # War-forged: each escort is a hull of our own outline (angled armour, a tapered prow, deliberately lopsided)
    # refitted round one dominant weapon: the big gun on one side, counterweighted by armour / engine mass on the
    # other, the barrels reaching past the bow. The detail set into the hulls is cut up from several stock families
    # (the planet destroyer's AncientHelpers in their own colours; Shakturi, Freedom Alliance and Phantom Pirates
    # machinery painted in the destroyer's metal), re-scaled, rotated and clipped to the new outlines.

    # parts cut from the family's frames: a curved leaf of armour (the cruiser's port flank pod) and a copper rod
    # rack (the capital ship's port weapon spines)
    LEAF = Piece.cut(root, 'cruiser', [(58, 112), (46, 150), (46, 210), (62, 262), (92, 298), (112, 300), (108, 262),
                                       (94, 210), (86, 160), (80, 120)])
    RODS = Piece.cut(root, 'capitalship', [(40, 6), (76, 6), (126, 165), (124, 215), (92, 215), (56, 120)])
    # detail crops: (kit, frame, crop box)
    DETAIL = {
        'ahspine': ('AncientHelpers', 'capitalship', (150, 50, 230, 200)),
        'ahmach': ('AncientHelpers', 'carrier', (100, 270, 250, 345)),
        'ahflank': ('AncientHelpers', 'carrier', (60, 40, 140, 200)),
        'famach': ('FreedomAlliance', 'capitalship', (70, 130, 170, 220)),
        'ppplate': ('PhantomPirates', 'capitalship', (110, 60, 190, 160)),
        'ppeng': ('PhantomPirates', 'capitalship', (100, 240, 200, 300)),
        'shmid': ('Shakturi', 'capitalship', (80, 130, 190, 210)),
    }

    def hull_at(c, poly, **k):
        """Our hull outline (canvas px), placed where its polygon says; returns its mask for the detail insets."""
        hp = hull([(x - min(q[0] for q in poly) + 1, y - min(q[1] for q in poly) + 1) for (x, y) in poly], **k)
        h_, w_ = hp.A.shape
        c.put(hp, min(q[0] for q in poly) - 1 + w_ / 2, min(q[1] for q in poly) - 1 + h_ / 2, shadow=0.5, marks=False)
        m = np.zeros((c.h, c.w))
        m[:] = poly_mask(c.w, c.h, [(x + c.pad, y + c.pad) for (x, y) in chaikin(poly, k.get('bevel', 1))])
        return fblur(m, 1.0) * (m > 0.5)

    def inset(c, key, x, y, scale, clipm, rot=0, flipx=False, flipy=False, sx=1.0, sy=1.0, gain=1.0):
        kit, f, crop = DETAIL[key]
        src = P(f, crop, kit=kit, keep_marks=False)
        h_, w_ = src.A.shape
        yy, xx = np.mgrid[0:h_, 0:w_].astype(np.float64) + 0.5
        feather = np.clip(np.minimum(np.minimum(xx, w_ - xx), np.minimum(yy, h_ - yy)) / 6.0, 0, 1)  # no hard crop edges
        part = Piece(src.L, src.A * feather, src.G, src.mats)
        c.put(part, x, y, scale, rot=rot, flipx=flipx, flipy=flipy, sx=sx, sy=sy, shadow=0.3, gain=gain, clip=clipm,
              marks=False)

    def mast(c, x, y, length, ang, **k):
        """An antenna rooted at (x, y), `ang` degrees from straight ahead (positive: to port; past 90: swept back)."""
        th = math.radians(ang)
        length = int(length * 1.3)
        c.put(antenna(length, **k), x - math.sin(th) * length / 2, y - math.cos(th) * length / 2, rot=ang, shadow=0.25)

    if name == 'frigate':
        # A small hull with an offset sensor array: a lattice mast, a dish and a sheaf of long antennas on a
        # starboard sponson (a leaf of armour), counterweighted by the hull's port bulge and its extra engine.
        c = Canvas(200, pad=24)
        c.put(engine(16, 26), 74, 180, shadow=0)
        c.put(engine(14, 24), 104, 180, shadow=0)
        hm = hull_at(c, bevel=0, poly=[
            (98, 30), (108, 58), (116, 92), (113, 104), (120, 140), (116, 170), (110, 182), (66, 182), (58, 172), (46, 150),
            (50, 124), (62, 112), (66, 98), (78, 64)], seams=((96, -0.25), (142, 0.2)), spine=(44, 26, 140, 7))
        inset(c, 'ahspine', 90, 84, 0.42, hm, sx=0.8)
        inset(c, 'famach', 86, 136, 0.42, hm, rot=8)
        inset(c, 'ppeng', 88, 172, 0.42, hm, sx=1.2)
        inset(c, 'shmid', 64, 140, 0.32, hm, rot=90)
        c.put(truss(8, 72, rail=2, bay=8), 134, 84, shadow=0.3, marks=False)
        c.put(LEAF, 130, 146, 0.44, flipx=True, shadow=0.55)
        c.put(dish(13), 134, 128, shadow=0.5, marks=False)
        mast(c, 134, 50, 44, 6, beads=(0.5,))
        mast(c, 138, 76, 40, -28)
        mast(c, 146, 134, 34, -62)
        mast(c, 136, 168, 30, -150)
        mast(c, 98, 32, 22, 0)
        mast(c, 48, 136, 30, 68)
        mast(c, 62, 176, 24, 148)
        return c
    if name == 'destroyer':
        # Slim, with a missile boom: a long arm swung out to port carrying a launcher pod (a block of launch tubes)
        # well forward; a counterweight pod with its own engine slung to starboard, further aft.
        c = Canvas(240, pad=24)
        c.put(strut(12, 62), 84, 140, rot=-62, shadow=0, marks=False)
        c.put(strut(10, 40), 158, 158, rot=90, shadow=0, marks=False)
        c.put(engine(22, 34), 186, 200, shadow=0)
        c.put(LEAF, 184, 156, 0.5, flipx=True, shadow=0.4)
        c.put(engine(16, 28), 110, 214, shadow=0)
        c.put(engine(16, 28), 130, 214, shadow=0)
        hm = hull_at(c, bevel=0, poly=[
            (122, 14), (132, 40), (138, 80), (146, 96), (140, 108), (142, 170), (150, 194), (136, 212), (106, 212), (94, 194),
            (100, 170), (100, 104), (94, 90), (104, 80), (110, 40)], seams=((80, 0.3), (130, -0.2), (176, 0.25)),
            spine=(19, 30, 190, 6))
        inset(c, 'ahspine', 120, 88, 0.5, hm, sx=0.7)
        inset(c, 'shmid', 120, 150, 0.5, hm, sx=0.8)
        inset(c, 'famach', 120, 196, 0.42, hm, flipy=True)
        inset(c, 'ppplate', 120, 118, 0.36, hm, sx=0.7)
        c.put(engine(14, 22), 50, 176, shadow=0)
        c.put(launcher(30, 90, rows=5, cols=2), 50, 128, shadow=0.5)
        mast(c, 122, 16, 24, 0, beads=(0.55,))
        mast(c, 46, 86, 30, 18)
        mast(c, 96, 92, 32, 42)
        mast(c, 146, 98, 38, -36)
        mast(c, 192, 124, 30, -14)
        mast(c, 144, 204, 28, -158)
        mast(c, 98, 204, 28, 158)
        return c
    if name == 'cruiser':
        # A modest offset turret pair on an angled hull: two staggered gun turrets on an armoured sponson off the
        # broad port shoulder; a leaf of armour swept out aft to starboard to balance them.
        c = Canvas(280, pad=24)
        c.put(LEAF, 212, 196, 0.66, rot=-24, flipx=True, shadow=0, tone=-0.04)
        for x in (128, 150, 172):
            c.put(engine(18, 28), x, 250, shadow=0)
        hm = hull_at(c, bevel=0, poly=[
            (150, 22), (164, 44), (184, 84), (196, 96), (198, 150), (206, 176), (196, 214), (178, 244), (118, 244), (100, 220),
            (86, 186), (84, 150), (88, 112), (110, 92), (126, 52), (138, 34)], seams=((100, 0.35), (160, -0.3), (208, 0.2)),
            spine=(62, 30, 210, 8))
        inset(c, 'ahflank', 172, 120, 0.5, hm, rot=-6)
        inset(c, 'famach', 140, 172, 0.55, hm)
        inset(c, 'ppplate', 128, 92, 0.45, hm, rot=180)
        inset(c, 'ahmach', 146, 226, 0.5, hm)
        inset(c, 'shmid', 168, 196, 0.4, hm, rot=90)
        c.put(LEAF, 90, 158, 0.6, shadow=0.55)
        for (x, y, ln) in ((100, 112, 66), (90, 158, 58)):
            c.put(barrel(9, ln, bands=(0.4,)), x, y - ln / 2 + 4, shadow=0.45, marks=False)
            c.put(collar(12, 10), x, y - 4, shadow=0.3, marks=False)
            c.put(turret(14), x, y + 6, shadow=0.55, marks=False)
        mast(c, 150, 24, 34, 0, beads=(0.5,))
        mast(c, 196, 104, 44, -30)
        mast(c, 206, 176, 38, -58, beads=(0.6,))
        mast(c, 86, 196, 32, 52)
        mast(c, 178, 240, 28, -162)
        mast(c, 118, 240, 26, 162)
        return c
    if name == 'capitalship':
        # The one with the great gun: a massive siege cannon running off-centre the whole length of the hull and far
        # past the bow, its long breech housing sunk into a starboard extension of the hull, armoured collars where
        # the barrel leaves it and at the braces; heavy armour slabs stepped down the port flank; a stepped bridge
        # tower set off to port.
        c = Canvas(360, pad=24)
        for x in (130, 160, 190):
            c.put(engine(20, 30), x, 336, shadow=0)
        c.put(engine(30, 40), 240, 334, shadow=0)
        hm = hull_at(c, bevel=0, poly=[
            (170, 26), (184, 48), (204, 90), (214, 96), (222, 140), (226, 182), (258, 200), (262, 300), (250, 326),
            (212, 330), (110, 330), (92, 318), (62, 300), (56, 250), (70, 238), (64, 186), (80, 170), (86, 130), (104, 112),
            (116, 76), (150, 40)], seams=((110, 0.3), (180, -0.25), (250, 0.3), (300, -0.2)), spine=(90, 60, 290, 10),
            keel=(58, 140, 48, 280))
        inset(c, 'ahspine', 162, 110, 0.6, hm)
        inset(c, 'shmid', 166, 196, 0.62, hm, sx=0.9)
        inset(c, 'famach', 154, 268, 0.6, hm, rot=180)
        inset(c, 'ahmach', 162, 316, 0.55, hm)
        inset(c, 'ppplate', 104, 190, 0.5, hm, rot=90)
        inset(c, 'ppeng', 196, 150, 0.5, hm, rot=-90)
        for (x, y, w_, h_, sk) in ((76, 270, 30, 74, -0.2), (84, 190, 26, 62, -0.12)):
            c.put(plate(w_, h_, chamfer=0.6, taper=0.3, skew=sk, seams=(0.5,)), x, y, shadow=0.4, tone=-0.04)
        c.put(tower(50, 64, tiers=3), 126, 230, shadow=0.6)
        c.put(strut(10, 26), 222, 140, rot=90, shadow=0.4, marks=False)
        c.put(barrel(28, 300, jacket=0.2, bands=(0.22, 0.42, 0.6)), 240, 160, shadow=0.45, marks=False)
        c.put(fairing(54, 138, nose=0.3, tail=0.18, bolts=3), 240, 262, shadow=0.55, mat='gun')
        c.put(collar(19, 12), 240, 194, shadow=0.4, marks=False)
        c.put(collar(16, 10), 240, 140, shadow=0.4, marks=False)
        mast(c, 170, 28, 32, 6, beads=(0.5,))
        mast(c, 60, 252, 44, 72)
        mast(c, 66, 192, 50, 44, beads=(0.55,))
        mast(c, 88, 132, 40, 24)
        mast(c, 126, 206, 46, 12, beads=(0.6,))
        mast(c, 104, 326, 34, 150)
        mast(c, 262, 246, 32, -72)
        mast(c, 254, 318, 30, -148)
        return c
    if name == 'carrier':
        # Lopsided: a long angled flight deck to port (landing lanes, landing lights, hangar openings), a heavy
        # armoured superstructure hull to starboard (a leaf of armour, a tall island tower, a rod rack of
        # point-defence guns).
        c = Canvas(320, pad=24)
        for y in (130, 196, 254):
            c.put(strut(10, 30), 158, y, rot=90, shadow=0, marks=False)
        c.put(engine(20, 30), 126, 296, shadow=0)
        c.put(deck(62, 252), 128, 170, rot=-5, shadow=0.3, tone=-0.04)
        for x in (190, 214, 238):
            c.put(engine(18, 28), x, 300, shadow=0)
        hm = hull_at(c, bevel=0, poly=[
            (214, 36), (226, 56), (248, 100), (262, 110), (268, 190), (262, 250), (252, 280), (240, 298), (180, 298), (166, 274),
            (160, 180), (166, 120), (178, 92), (200, 52)], seams=((110, 0.3), (170, -0.2), (240, 0.25)),
            spine=(50, 26, 240, 8))
        inset(c, 'famach', 206, 108, 0.45, hm)
        inset(c, 'shmid', 212, 210, 0.55, hm, rot=180)
        inset(c, 'ahmach', 212, 284, 0.45, hm)
        inset(c, 'ppplate', 190, 160, 0.45, hm, rot=90)
        c.put(RODS, 266, 100, 0.5, rot=-20, flipx=True, shadow=0.4)
        c.put(LEAF, 256, 190, 0.6, flipx=True, shadow=0.5)
        c.put(tower(42, 64, tiers=3), 220, 160, shadow=0.6)
        mast(c, 220, 134, 50, -8, beads=(0.5,))
        mast(c, 214, 38, 28, 0)
        mast(c, 268, 196, 40, -62)
        mast(c, 256, 276, 32, -140)
        mast(c, 164, 286, 26, 150)
        return c
    if name == 'trooptransport':
        # An armoured drop-pod rack hung off the port side (a curved armour leaf with the pods nested along its outer
        # edge, staggered, one clamp empty), a long pointed ram on the bow, an armour leaf and an engine to starboard
        # against the rack's weight.
        c = Canvas(240, pad=24)
        pd = pod(18, 30, bands=(0.35, 0.7))
        c.put(engine(18, 28), 92, 196, shadow=0)
        for y in (96, 168):
            c.put(strut(8, 24), 98, y, rot=90, shadow=0, marks=False)
        c.put(LEAF, 84, 138, 0.62, shadow=0.45)
        for (x, y, r) in ((74, 80, 12), (66, 112, 8), (63, 146, 3), (66, 180, -4)):
            c.put(pd, x, y, rot=r, shadow=0.4, mat='gun')
        c.put(clamp_arm(16, 26), 80, 106, rot=8, shadow=0, marks=False)
        c.put(engine(16, 28), 176, 180, shadow=0)
        c.put(LEAF, 174, 146, 0.4, flipx=True, shadow=0.4)
        for x in (124, 148):
            c.put(engine(16, 26), x, 214, shadow=0)
        hm = hull_at(c, bevel=0, poly=[
            (136, 6), (142, 30), (152, 58), (164, 72), (166, 120), (160, 150), (166, 186), (156, 212), (116, 212), (106, 186),
            (110, 150), (106, 120), (110, 72), (122, 58), (130, 30)], seams=((110, 0.25), (170, -0.2)), spine=(31, 70, 196, 6))
        inset(c, 'famach', 136, 110, 0.45, hm)
        inset(c, 'ahspine', 136, 160, 0.45, hm, sx=0.8, flipy=True)
        inset(c, 'ppeng', 136, 202, 0.4, hm)
        inset(c, 'shmid', 136, 70, 0.34, hm, sx=0.7)
        c.put(fairing(36, 62, nose=0.85, tail=0.08, bolts=1), 136, 42, shadow=0.5, mat='gun')
        mast(c, 164, 74, 36, -36, beads=(0.6,))
        mast(c, 80, 72, 30, 30)
        mast(c, 178, 122, 30, -18)
        mast(c, 158, 208, 26, -160)
        mast(c, 114, 208, 24, 160)
        mast(c, 56, 190, 24, 120)
        return c
    if name == 'base_0':
        # A broken outpost: the Shakturi station body inside a half-ring of gantry, one arm snapped, debris adrift.
        c = Canvas(260, pad=12)
        c.put(ring(96, 12, gaps=((200, 262), (300, 318)), ribs=40), 130, 130, shadow=0, marks=False)
        c.put(truss(10, 70, bay=10, cut=(40, 48)), 130, 34, shadow=0.3, marks=False)
        c.put(truss(10, 64, bay=10), 222, 150, rot=95, shadow=0.3, marks=False)
        c.put(P('base_0', keep_marks=True, kit='Shakturi'), 130, 132, 0.95, shadow=0.6)
        for (x, y, s, r) in ((40, 60, 22, 30), (226, 228, 16, 75), (30, 210, 14, 140), (210, 30, 12, 200)):
            c.put(debris(rng, root, s), x, y, rot=r, shadow=0, marks=False, gain=0.85)
        for (x, y, ln, a) in ((96, 92, 40, 40), (166, 94, 34, -36), (90, 176, 36, 120), (172, 182, 40, -132)):
            mast(c, x, y, ln, a)
        return c
    if name == 'base_1':
        # The Purifier's dock: a half-ruined orbital shipyard. An empty cradle ring (the berth where the Purifier
        # slept: space shows through it) with its clamp arms reaching in to nothing, one of them snapped off; an
        # outer scaffold ring mostly gone; a forge block (the Shakturi station) on the ring's aft side braced by
        # scaffold arms; gantry towers out to the sides, the right one broken and its end drifting; debris.
        c = Canvas(360, pad=12)
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
        c.put(P('base_1', (30, 96, 160, 186), kit='Shakturi'), cx, cy + 136, 1.2, shadow=0.6, sx=1.15)
        c.put(plate(84, 22, chamfer=0.2, seams=(0.5,)), cx, cy + 92, shadow=0.45)
        # the snapped clamp arm adrift in the berth, and the debris
        arm = ring(92, 34, arms=[(0, 40, 24)])
        sl = (slice(100, 156), slice(176, 222))
        frag = Piece(arm.L[sl], arm.A[sl], None, {m: v[sl] for m, v in arm.mats.items()})
        c.put(frag, cx + 30, cy - 30, rot=63, shadow=0, marks=False)
        for (x, y, sz, r) in ((150, 128, 26, 20), (206, 186, 18, 110), (290, 284, 28, 60), (66, 280, 24, 150),
                              (310, 86, 22, 210), (50, 70, 20, 300), (262, 40, 14, 80), (196, 104, 12, 140)):
            c.put(debris(rng, root, sz), x, y, rot=r, shadow=0, marks=False, gain=0.85)
        # masts with lights off the forge block and the ring (as the Purifier's spikes)
        for (x, y, ln, a) in ((cx - 70, cy + 120, 44, 64), (cx + 70, cy + 122, 40, -66), (cx - 40, cy + 170, 30, 160),
                              (cx + 44, cy + 168, 30, -160), (cx - 128, cy - 52, 34, 66), (cx + 132, cy - 40, 30, -70)):
            mast(c, x, y, ln, a)
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
    # lights: small dim points of the destroyer's pale core light, a third of them dead (dark lenses)
    dead = value_noise(rng, h, w, 6) < 0.36
    g = np.where(alpha > 0.5, G, 0)
    lit = (g > 0.15) & ~dead
    out[lit] = EMBER * (g[lit] * 0.62)[:, None] + out[lit] * 0.2
    off = (g > 0.15) & dead
    out[off] = np.array([0.12, 0.11, 0.09]) * (0.6 + g[off])[:, None]
    if name.startswith('base'):
        out = out * 1.12  # the stations sit in nebulae and gas clouds: a little lift so the ruin still reads there
    # the silhouette: lit metal on the edges facing the light (upper left), shadowed on the far side
    solid = alpha > 0.5
    d = depth_inside(solid, 3)
    ext = ~solid
    near_ul = shift(ext, 1, 1) | shift(ext, 1, 0) | shift(ext, 0, 1) | shift(ext, 2, 2)
    near_br = shift(ext, -1, -1) | shift(ext, -1, 0) | shift(ext, 0, -1) | shift(ext, -2, -2)
    lit = solid & (d <= 2) & near_ul & ~near_br & ~protect
    out[lit] = np.minimum(1, out[lit] * 1.35 + 0.05)
    shd = solid & (d <= 2) & near_br & ~near_ul & ~protect
    out[shd] *= 0.6
    out = np.clip(out, 0, 1)
    # a dark outline round everything (2 px on the stations, 1 px on the ships): reads on bright / red nebulae
    ow = 2 if name.startswith('base') else 1
    ring_ = dilate(solid, ow) & ~solid & (alpha < 0.5)
    oa = 0.85 if name.startswith('base') else 0.6
    out[ring_] = np.array([0.025, 0.02, 0.016])
    alpha = np.where(ring_, np.maximum(alpha, oa), alpha)
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
    xs, cols = metal_ramp(dest)
    GOLD[:] = gold_accent(dest)
    strip = Piece.load(root, 'capitalship', (100, 60, 170, 200), kit='Shakturi')
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
