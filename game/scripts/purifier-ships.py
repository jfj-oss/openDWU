#!/usr/bin/env python3
"""The Purifier's escort and dock art (Galactic Threats add-on): "war-forged", the planet destroyer's sister ships
after ages of fighting. Each escort is two to four whole stock DW:U hulls meshed into one ship (as the Generation Ships'
and Probe Swarm's kitbashes): a main hull with others fused on as a rear, side or superstructure section, mirrored /
scaled as needed, the stock hand-painted detail kept sharp, so the merged ship is believable but no single stock ship
is recognisable; painted in the planet destroyer's metal and battered: missing plates exposing the ribbed frame
inside, gouges, craters, scorch, melted edges, gunmetal / steel patches welded over old holes, chipped edges. Thin
antennas, whips, small dishes, spikes and fins poke out all round, as the destroyer's spikes.
Offline build step; the outputs are our derived art, committed under public/art/purifier/ (src/render/threatArt.ts
purifierArtUrl draws them for the Purifier faction's escorts and guards by subRole, base_1 for its dock - the repair
station - and base_0 for any other base of the faction). The planet destroyer itself keeps the stock
other/planetdestroyer.png: the one unbroken weapon, the only one with a glowing core.

    python3 -I scripts/purifier-ships.py [--dwu <DW:U install>] [--out public/art/purifier] [--preview <dir>]
        [--only frigate,base_1]

Reads images/units/ships/family*/<role>.png, images/units/ships/other/MajorSets/*/<file>.png and
other/planetdestroyer.png from the install (default public/assets/dwu, the symlink npm run import-assets makes). Needs
Python 3 with numpy and Pillow only. Deterministic (fixed seeds per output).

Per output frame (bow up, as the stock frames; square canvas with a margin for the masts):
1. Assembly, at SS x the output resolution: whole stock hulls layered back to front (the hidden ones' engine marks
   dropped: thrusters only where open space lies aft), each casting a soft contact shadow on what is below; the
   stock pieces carry their levelled shading, the AncientHelpers ones their native colour, their lights as a glow
   channel and their thruster (pure blue) / light (pure yellow) marker pixels as points, mapped through each
   placement. The escorts are long and lean, their hulls meshed end to end: a frigate of a needle bow hull run into
   a longer main hull; a destroyer of a needle bow, a long main hull and a slim engine hull; a cruiser of a pointed
   bow hull, a broad main hull and a tapering stern hull; the capital ship, the longest, of a needle bow, two heavy
   hulls and a wide engine hull with two slim hulls along its midsection as sponsons; a troop transport of a slim
   bow hull run into the troop hull; and the carrier of three hulls end to end with the angled flight deck (landing
   lanes, chevrons, landing lights, hangar lifts) fused along its port flank, the whole bent into a banana curve
   (bend()). Then masts and the edge dressing: whips and sensor masts (single and in
   fanned clusters), short spikes, small dishes on stalks, fins, small turrets, vents and pipes planted round the
   outline pointing outward. Some tips and beads (at most 18 per frame, under the scan cap of 20) are pure-yellow
   nav-light markers, so they blink at runtime as the planet destroyer's own spike lights do. The dock and outpost:
   the Shakturi station bodies, the cradle ring and clamp arms, trusses and drifting debris, with masts.
2. Paint: the stock AncientHelpers pieces keep their own colour at the new value (a little toward the destroyer's
   ramp); everything else is gradient-mapped onto the planet destroyer's metal ramp (the median colour of its pixels
   per luminance band: silver, champagne, warm dark steel, a touch warmed as its champagne plates); guns in its dark
   steel, trims in its copper.
3. Down to the output frame (Lanczos on the premultiplied colour, a light unsharp mask), then battle damage (never
   mirrored, sized by the ship): grime, gunmetal / steel / dark champagne patches (seams, rivet rows, some
   overhanging the hull edge), broad scorch, missing plates (a dark hole with the ribs and stringers inside, a torn lit
   lip), skeletal breaches at the hull edge, impact craters (lit rim, cracks, soot halo), long gouges, shallow melted
   edges (slag rim, heat tint), small chips and fine pitting: inside the silhouette, which keeps its shape. Lit metal
   on the outline's upper-left edges and shadow on the far ones, then a dark outline (1 px on the ships, 2 px on the
   stations) so the frames read on bright and red nebulae.
4. Lights: lamps become small dim points of the destroyer's pale light, a third dead; sparse bright specular glints
   on the lit metal. The marker pixels are written back exactly ((0,0,255) thruster runs at the engines,
   (255,255,0) nav-light points), no other pixel left in either marker colour (ambientLayer.ts scanShipMarkers) and
   no opaque black (shipImageMetrics).
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
SS = 2  # the frames are assembled at SS x and downsampled at the end (Lanczos + a light unsharp mask)
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
        self.ss = False  # built at the SS resolution (placed 1:1), else scaled up by SS like the stock frames

    @classmethod
    def load(cls, root, name, crop=None, lo=0.03, hi=0.97, keep_marks=True, kit='AncientHelpers'):
        """A stock frame (or a crop of it). The AncientHelpers pieces (the planet destroyer's own family) keep their
        native colour; their pale core lights ride along as the glow channel. Shakturi pieces: shading only, their red
        lamps as the glow."""
        key = (name, crop, lo, hi, keep_marks, kit)
        if key in cls.cache:
            return cls.cache[key]
        path = os.path.join(root, '..', kit, name + '.png') if kit.startswith('family') else os.path.join(root, 'MajorSets', kit, name + '.png')
        img = Image.open(path).convert('RGBA')
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
    def __init__(self, w, h=None, pad=0, z=1.0):
        """A w x h layout area (the coordinates every put uses), with `pad` px of margin all round for the masts; the
        pixels are SS x finer (self.w / self.h, the marks in those px), the output frame (w + 2 pad) square."""
        h = w if h is None else h
        self.pad = pad
        self.w0 = w
        self.z = z  # output px per layout px
        self.k = SS * z  # canvas px per layout px
        self.out_w, self.out_h = int(round((w + 2 * pad) * z)), int(round((h + 2 * pad) * z))
        w, h = self.out_w * SS, self.out_h * SS
        self.w, self.h = w, h
        self.L = np.zeros((h, w))  # premultiplied
        self.A = np.zeros((h, w))
        self.G = np.zeros((h, w))
        self.T = np.zeros((h, w))  # per-piece tone offset
        self.M = {m: np.zeros((h, w)) for m in MATS}
        self.marks = []            # (x, y, kind) canvas px

    def put(self, piece, cx, cy, scale=1.0, rot=0, flipx=False, flipy=False, shadow=0.55, gain=1.0, tone=0.0, mirror=False,
            sx=1.0, sy=1.0, mat=None, marks=True, glow=1.0, clip=None, edge=0.0):
        """Layer a piece over the canvas centred at (cx, cy) (layout px). `mirror`: also at the mirrored x. `mat`: tag
        the piece's pixels with a material (MATS). `clip`: a canvas mask the piece is cut to (detail set into a hull).
        `edge`: crisp plate edges (a 1 px lit top-left rim, a dark bottom-right one and a deep seam outside it)."""
        cy = (cy + self.pad) * self.k
        scale = scale * self.z if piece.ss else scale * self.k
        for m in ([False, True] if mirror else [False]):
            x = (self.pad + (self.w0 - cx if m else cx)) * self.k
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
            self.last = fa
            if edge > 0:
                self.crisp(fa > 0.5, edge)
            if marks:
                for (mx, my, kind) in pm:
                    self.marks.append((mx + x0, my + y0, kind))

    def crisp(self, inside, k=1.0):
        """Plate edges, one output px wide (SS here): lit along the top / left rim of `inside`, dark along its bottom /
        right rim, a deep seam on the surface just outside its bottom / right."""
        up = np.ones_like(inside)
        dn = np.ones_like(inside)
        for d in range(1, SS + 1):
            up &= shift(inside, d, 0) & shift(inside, 0, d)
            dn &= shift(inside, -d, 0) & shift(inside, 0, -d)
        lit = inside & ~up
        dark = inside & ~dn & ~lit
        out = dilate(inside, SS) & ~inside & (self.A > 0.5)
        seam = out & ~(shift(inside, SS, 0) | shift(inside, 0, SS)) & (shift(inside, -SS, 0) | shift(inside, 0, -SS) | shift(inside, -SS, -SS))
        a = self.A
        self.L = np.where(lit, np.minimum(a, self.L * (1 + 0.4 * k) + 0.05 * k * a), self.L)
        self.L = np.where(dark, self.L * (1 - 0.5 * k), self.L)
        self.L = np.where(seam, self.L * (1 - 0.6 * k), self.L)

    def result(self):
        a = np.maximum(self.A, 1e-6)
        return np.clip(self.L / a, 0, 1), self.A, np.clip(self.G / a, 0, 1), self.T, {m: np.clip(v / a, 0, 1) for m, v in self.M.items()}


def bend(c, R, x0, yc):
    """Bend a composed canvas into a gentle arc (the carrier's banana): the straight centre line x = x0 (layout px)
    is wrapped round a circle of radius R (layout px) centred to starboard at (x0 + R, yc), lengths along it kept,
    offsets across it kept; every channel resampled (bilinear, at the SS resolution), the marks carried along."""
    Rs, X0, Yc = R * c.k, (x0 + c.pad) * c.k, (yc + c.pad) * c.k
    Cx, Cy = X0 + Rs, Yc
    yy, xx = np.mgrid[0:c.h, 0:c.w].astype(np.float64) + 0.5
    dx, dy = xx - Cx, yy - Cy
    r = np.hypot(dx, dy)
    phi = np.arctan2(dy, -dx)
    u, v = X0 + (Rs - r) - 0.5, Yc + Rs * phi - 0.5
    i0, j0 = np.floor(v).astype(int), np.floor(u).astype(int)
    fy, fx = v - i0, u - j0
    ok = (i0 >= 0) & (j0 >= 0) & (i0 < c.h - 1) & (j0 < c.w - 1)
    i0c, j0c = np.clip(i0, 0, c.h - 2), np.clip(j0, 0, c.w - 2)

    def warp(a):
        o = (a[i0c, j0c] * (1 - fy) * (1 - fx) + a[i0c + 1, j0c] * fy * (1 - fx) + a[i0c, j0c + 1] * (1 - fy) * fx
             + a[i0c + 1, j0c + 1] * fy * fx)
        return np.where(ok, o, 0.0)

    c.L, c.A, c.G, c.T = warp(c.L), warp(c.A), warp(c.G), warp(c.T)
    c.M = {k: warp(m) for k, m in c.M.items()}
    marks = []
    for (mx, my, k) in c.marks:
        d, ph = mx - X0, (my - Yc) / Rs
        marks.append((Cx - (Rs - d) * math.cos(ph), Cy + (Rs - d) * math.sin(ph), k))
    c.marks = marks


# --- procedural parts (shading only; painted with everything else) ---

_TEX = []  # a stock hull strip, ground into the procedural parts so they carry the Shakturi plating detail


def tex(L, yy, xx, amt):
    if not _TEX:
        return L
    st = _TEX[0]
    sh, sw = st.L.shape
    t = np.where(st.A[(yy.astype(int)) % sh, (xx.astype(int)) % sw] > 0.5, st.L[(yy.astype(int)) % sh, (xx.astype(int)) % sw], 0.5)
    return L * (1 - amt + amt * 1.25 * t)


def poly_mask(w, h, poly):
    k = 4
    im = Image.new('L', (w * k, h * k), 0)
    ImageDraw.Draw(im).polygon([(x * k, y * k) for (x, y) in poly], fill=255)
    return np.asarray(im.resize((w, h), Image.BOX)).astype(np.float64) / 255


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


def antenna(length, w=2.4, bars=(0.55,), beads=(), rings=(0.3, 0.75), light=True):
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
    if not light:  # a plain whip / spike: no light
        A[:1] = 0
        return Piece(L, A, G, {'gold': gold * (A > 0.3)})
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


POOL = None  # the Pool of stock windows (main)


class Pool:
    """Fully opaque windows of stock warship frames (every race family and the major sets): the hull plates. A window
    of w x h native px is a crop where every pixel is solid, so a plate pasted 1:1 at the SS resolution covers its
    cell with the stock hand-painted detail."""

    ROLES = ('capitalship', 'cruiser', 'carrier', 'destroyer', 'frigate', 'escort', 'trooptransport')

    def __init__(self, root):
        self.root = root
        self.frames = []
        ships = os.path.join(root, '..')
        for fam in sorted(os.listdir(ships), key=lambda f: (len(f), f)):
            if fam.startswith('family'):
                for r in self.ROLES:
                    if os.path.exists(os.path.join(ships, fam, r + '.png')):
                        self.frames.append((fam, r))
        for kit in ('AncientHelpers', 'Shakturi', 'ShakturiAllies', 'FreedomAlliance', 'PhantomPirates'):
            for r in self.ROLES:
                if os.path.exists(os.path.join(root, 'MajorSets', kit, r + '.png')):
                    self.frames.append((kit, r))
        self.integral = {}

    def _ii(self, f):
        if f not in self.integral:
            kit, name = f
            path = os.path.join(self.root, '..', kit, name + '.png') if kit.startswith('family') else os.path.join(self.root, 'MajorSets', kit, name + '.png')
            a = np.asarray(Image.open(path).convert('RGBA'))[..., 3] > 230
            self.integral[f] = np.pad(a.astype(np.int64).cumsum(0).cumsum(1), ((1, 0), (1, 0)))
        return self.integral[f]

    def window(self, rng, w, h, kits=None):
        """A (kit, frame, crop) of a solid w x h window, from a random frame (of `kits` if given), or None."""
        frames = [f for f in self.frames if kits is None or f[0] in kits or (kits == 'family' and f[0].startswith('family'))]
        for _ in range(60):
            f = frames[int(rng.integers(len(frames)))]
            ii = self._ii(f)
            H, W = ii.shape[0] - 1, ii.shape[1] - 1
            if w > W or h > H:
                continue
            ys, xs = np.mgrid[0:H - h + 1:3, 0:W - w + 1:3]
            tot = ii[ys + h, xs + w] - ii[ys, xs + w] - ii[ys + h, xs] + ii[ys, xs]
            ok = np.argwhere(tot >= w * h)
            if len(ok):
                y, x = ok[int(rng.integers(len(ok)))]
                y0, x0 = int(ys[y, x]), int(xs[y, x])
                return f[0], f[1], (x0, y0, x0 + w, y0 + h)
        return None


def dome(r):
    """A small sensor dome: a bright specular cap, a dark ring at its foot."""
    s_ = int(math.ceil(2 * r)) + 2
    yy, xx = np.mgrid[0:s_, 0:s_].astype(np.float64) + 0.5
    nx, ny = (xx - s_ / 2) / r, (yy - s_ / 2) / r
    rr = np.sqrt(nx ** 2 + ny ** 2)
    A = np.clip((1 - rr) * r * 1.5, 0, 1)
    L = _shade(nx, ny, np.sqrt(np.clip(1 - rr ** 2, 0, 1)), amb=0.12, k=0.8)
    L = np.where(rr > 0.82, L * 0.4, L)
    return Piece(L, A, None, {'gun': np.full((s_, s_), 0.4)})


def greeble(kind, k, rng):
    """One small surface detail at the SS resolution (k px per output px): a vent (slats), a hatch (bevelled square),
    a small dome, a pipe run (a lit tube along a short path) or a rivet row."""
    if kind == 'vent':
        w, h = int(k * rng.integers(4, 8)), int(k * rng.integers(3, 6))
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
        L = np.where((yy.astype(int) // k) % 2 == 0, 0.12, 0.6)
        L[:k] = 0.85
        L[:, :k] = np.maximum(L[:, :k], 0.7)
        L[-k:] = 0.15
        p = Piece(L, np.ones((h, w)))
    elif kind == 'hatch':
        n = int(k * rng.integers(3, 6))
        L = np.full((n, n), 0.42)
        L[:k] = L[:, :k] = 0.9
        L[-k:] = 0.12
        L[:, -k:] = 0.12
        c_ = n // 2
        L[c_ - k // 2:c_ + k // 2 + 1, c_ - k // 2:c_ + k // 2 + 1] = 0.15
        p = Piece(L, np.ones((n, n)))
    elif kind == 'dome':
        p = dome(k * rng.uniform(1.4, 2.6))
    elif kind == 'pipe':
        ln, th = int(k * rng.integers(6, 14)), max(2, int(k * 1.2))
        yy, xx = np.mgrid[0:ln, 0:th].astype(np.float64) + 0.5
        nx = (xx - th / 2) / (th / 2)
        L = _shade(nx, np.zeros_like(nx), np.sqrt(np.clip(1 - nx ** 2, 0, 1)), amb=0.15, k=0.85)
        L = np.where((yy.astype(int) % (3 * k)) < k * 0.6, L * 0.5, L)
        p = Piece(L, np.ones((ln, th)), None, {'gun': np.full((ln, th), 0.5)})
    else:  # rivets
        n = int(rng.integers(4, 9))
        w = n * 2 * k
        L = np.zeros((k + 1, w))
        A = np.zeros((k + 1, w))
        for i in range(n):
            A[:k, i * 2 * k:i * 2 * k + k] = 1
            L[:k, i * 2 * k:i * 2 * k + k] = 0.9
        p = Piece(L, A)
    p.ss = True
    return p


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


def paint(L, A, T, M, xs, cols, s=1):
    """The destroyer's metal. The stock AncientHelpers pieces keep their own colour (champagne and silver plates,
    copper rods, dark steel machinery: the destroyer's family) at the new value; everything procedural is painted from
    the destroyer's ramp (silver / champagne by value); guns and mounts in its dark steel, trims in its copper gold;
    plain dark parts (trusses) darker."""
    v = np.clip(L * 1.08 * (1 + T), 0, 1)
    v = np.where(v > 0.72, 0.72 + (v - 0.72) * 0.85, v)  # worn: the highlights only a little dulled
    # value contrast: darker recesses, brighter raised edges (so the hulls do not blur together at play zoom)
    v = np.clip(v + (v - fblur(v * (A > 0.5), 2.5 * s) / np.maximum(fblur((A > 0.5).astype(np.float64), 2.5 * s), 1e-3)) * 0.45, 0, 1)
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
        ys_, xs_ = np.nonzero(alpha > 0.5)  # damage sized by the ship itself, not its canvas
        self.side = max(ys_.max() - ys_.min(), xs_.max() - xs_.min()) if len(ys_) else max(self.h, self.w)
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

    def pitting(self, density=0.01):
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
    'frigate': (2, 1, 1, 0, 2, 1, 0, 8),
    'destroyer': (3, 2, 1, 0, 3, 1, 0, 10),
    'cruiser': (3, 2, 1, 1, 3, 1, 0, 12),
    'capitalship': (4, 2, 2, 1, 4, 2, 1, 14),
    'carrier': (3, 2, 1, 1, 3, 1, 0, 12),
    'trooptransport': (2, 1, 1, 0, 2, 1, 0, 10),
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


    def detail_over(c, k=0.8, mask=None):
        """Stock surface detail over the procedural part just placed (or `mask`): a solid stock window's shading
        multiplied in 1:1 at the SS resolution, so the part keeps its form but gains the hand-painted plating."""
        m = (c.last if mask is None else mask) > 0.5
        if not m.any():
            return
        ys, xs = np.nonzero(m)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        win = POOL.window(rng, x1 - x0, y1 - y0)
        if win is None:
            for part in ((y0, (y0 + y1) // 2), ((y0 + y1) // 2, y1)):
                sub = m.copy()
                sub[:part[0]] = False
                sub[part[1]:] = False
                if sub.any() and part[1] - part[0] < y1 - y0:
                    detail_over(c, k, sub.astype(np.float64))
            return
        kit, f, crop = win
        wl = P(f, crop, kit=kit, keep_marks=False).L
        wl = wl[:y1 - y0, :x1 - x0]
        if rng.random() < 0.5:
            wl = wl[:, ::-1]
        sub = m[y0:y1, x0:x1]
        mod = (1 - k) + k * (0.35 + 1.3 * wl)
        reg = c.L[y0:y1, x0:x1]
        c.L[y0:y1, x0:x1] = np.where(sub, np.minimum(c.A[y0:y1, x0:x1], reg * mod), reg)

    def edge_dress(c, hm, n, lights=6, avoid=(), k=1.0):
        """Break the outline up: walk the hull edge and plant, pointing outward (jittered), whips and sensor masts
        (some in fanned clusters, a few lit), short spikes, small dishes on stalks, small fins, turrets, vents and
        pipes poking out past the edge; none over the engines' thruster marks or within `avoid` (x, y, r layout)."""
        solid = hm > 0.5
        edge = solid & ~(shift(solid, SS, 0) & shift(solid, -SS, 0) & shift(solid, 0, SS) & shift(solid, 0, -SS))
        thr = [(mx, my) for (mx, my, k_) in c.marks if k_ == 1]
        ys, xs = np.nonzero(edge)
        keep = np.ones(len(ys), bool)
        for (mx, my) in thr:
            keep &= (xs - mx) ** 2 + (ys - my) ** 2 > (20 * SS) ** 2
        for (ax, ay, ar) in avoid:
            keep &= (xs - (ax + c.pad) * c.k) ** 2 + (ys - (ay + c.pad) * c.k) ** 2 > (ar * c.k) ** 2
        cand = np.zeros_like(solid)
        cand[ys[keep], xs[keep]] = True
        pts = pick_points(rng, cand, n, 7 * SS * k)
        b = fblur(hm, 3.0 * SS)
        gy, gx = np.gradient(b)
        lit = lights - sum(1 for (_, _, k_) in c.marks if k_ == 2)
        for (py, px) in pts:
            nx_, ny_ = -gx[py, px], -gy[py, px]
            nn = math.hypot(nx_, ny_) + 1e-9
            nx_, ny_ = nx_ / nn, ny_ / nn
            blocked = False
            for d in (8, 16, 24):  # facing into a gap with hull across it: leave the negative space clear
                qx, qy = int(px + nx_ * d * SS), int(py + ny_ * d * SS)
                if 0 <= qx < c.w and 0 <= qy < c.h and hm[qy, qx] > 0.5:
                    blocked = True
            if blocked:
                continue
            ang = math.degrees(math.atan2(-nx_, -ny_)) + rng.uniform(-28, 28)
            x, y = px / c.k - c.pad, py / c.k - c.pad
            kind = rng.choice(['whip', 'whip', 'whip', 'cluster', 'spike', 'spike', 'dish', 'fin', 'turret', 'vent', 'pipe'])

            def plant(piece, out, a, **k):
                th = math.radians(a)
                c.put(piece, x - math.sin(th) * out, y - math.cos(th) * out, rot=a, shadow=0.25, **k)

            if kind in ('whip', 'cluster'):
                for j in range(1 if kind == 'whip' else int(rng.integers(2, 4))):
                    a = ang + (j - 1) * rng.uniform(10, 22) if kind == 'cluster' else ang
                    ln = int(k * (rng.uniform(10, 34) if kind == 'whip' else rng.uniform(8, 26)))
                    on = lit > 0 and rng.random() < 0.35
                    lit -= int(on)
                    plant(antenna(ln, w=rng.uniform(1.4, 2.2), bars=(rng.uniform(0.3, 0.7),) if ln > 18 * k else (),
                                  rings=(0.6,), light=on), ln / 2 - 1, a)
            elif kind == 'spike':
                ln = int(k * rng.uniform(6, 14))
                plant(antenna(ln, w=3.2 * k, bars=(), rings=(0.5,), light=False), ln / 2 - 1, ang)
            elif kind == 'dish':
                ln = int(k * rng.uniform(6, 12))
                plant(antenna(ln, w=2.0, bars=(), rings=(), light=False), ln / 2, ang)
                plant(dish(k * rng.uniform(3.5, 5.5)), ln, ang, marks=False)
            elif kind == 'fin':
                plant(plate(max(3, int(k * rng.uniform(4, 7))), int(k * rng.uniform(9, 16)), chamfer=0.6, taper=0.6, seams=()), 3 * k, ang,
                      edge=0.8)
            elif kind == 'turret':
                plant(turret(k * rng.uniform(3.5, 5.5)), 1.5 * k, ang, marks=False, edge=0.6)
            else:
                g = greeble('vent' if kind == 'vent' else 'pipe', SS, rng)
                plant(g, 2, ang + 90 if kind == 'pipe' else ang, marks=False, edge=0.8)

    def greebles(c, hm, n, avoid=None):
        """Small detail scattered over the hull (vents, hatches, small domes, pipe runs, rivet rows), crisp."""
        solid = hm > 0.5
        dep = depth_inside(solid, 5 * SS)
        ok = solid & (dep >= 4 * SS)
        if avoid is not None:
            ok &= avoid < 0.5
        pts = pick_points(rng, ok, int(n * 1.6), 4 * SS)
        kinds = ['vent', 'hatch', 'dome', 'pipe', 'rivets', 'vent', 'hatch', 'pipe']
        for (py, px) in pts:
            g = greeble(kinds[int(rng.integers(len(kinds)))], SS, rng)
            c.put(g, px / c.k - c.pad, py / c.k - c.pad, 1.0, rot=int(rng.choice([0, 90, 180, 270])), shadow=0.4, clip=hm,
                  edge=0.8, marks=False)

    def mast(c, x, y, length, ang, **k):
        """An antenna rooted at (x, y), `ang` degrees from straight ahead (positive: to port; past 90: swept back)."""
        th = math.radians(ang)
        length = int(length * (1.3 if name.startswith('base') else 0.8))  # the escorts' hulls are at half scale
        k.setdefault('w', 2.4 if name.startswith('base') else 1.8)
        c.put(antenna(length, **k), x - math.sin(th) * length / 2, y - math.cos(th) * length / 2, rot=ang, shadow=0.25)

    H = lambda fam, f, **k: Piece.load(root, f, kit=fam, **k)  # noqa: E731  # a whole stock hull

    def dress(c, n, avoid=()):
        edge_dress(c, (c.A > 0.5).astype(np.float64), n, lights=18, avoid=avoid, k=0.6)

    if name == 'frigate':
        # Two hulls end to end: a needle bow hull run into a longer main hull, a sleek dart.
        c = Canvas(190, pad=20, z=1.25)
        c.put(H('family14', 'frigate'), 95, 120, 0.5, shadow=0)
        c.put(H('family25', 'frigate'), 95, 52, 0.5, shadow=0.55)
        mast(c, 95, 14, 18, 0, beads=(0.5,))
        mast(c, 72, 140, 22, 70)
        mast(c, 118, 150, 20, -110)
        dress(c, 10)
        return c
    if name == 'destroyer':
        # Three hulls end to end: a needle bow hull, a long main hull, a slim engine hull aft.
        c = Canvas(260, pad=20, z=1.25)
        c.put(H('family7', 'destroyer'), 130, 206, 0.5, shadow=0)
        c.put(H('family24', 'destroyer'), 130, 132, 0.5, shadow=0.5)
        c.put(H('family25', 'destroyer'), 130, 54, 0.5, shadow=0.55)
        mast(c, 130, 12, 20, 0, beads=(0.5,))
        mast(c, 106, 120, 26, 60)
        mast(c, 154, 170, 24, -120)
        dress(c, 14)
        return c
    if name == 'cruiser':
        # Three hulls end to end: a long pointed bow hull, a broad main hull amidships, a tapering stern hull.
        c = Canvas(320, pad=20, z=1.25)
        c.put(H('family14', 'cruiser'), 160, 250, 0.5, shadow=0)
        c.put(H('family22', 'cruiser'), 160, 152, 0.5, shadow=0.5)
        c.put(H('family25', 'cruiser'), 160, 62, 0.5, shadow=0.55)
        mast(c, 160, 14, 24, 0, beads=(0.5,))
        mast(c, 124, 150, 30, 64)
        mast(c, 196, 150, 30, -64)
        dress(c, 22)
        return c
    if name == 'capitalship':
        # Four hulls end to end, the longest ship: a needle bow hull, two heavy hulls amidships, a wide engine hull aft;
        # two slim hulls fused along the midsection flanks as heavy sponsons.
        c = Canvas(380, pad=20, z=1.25)
        c.put(H('family22', 'capitalship'), 190, 300, 0.5, shadow=0)
        c.put(H('family7', 'cruiser'), 148, 228, 0.5, shadow=0)
        c.put(H('family7', 'cruiser'), 232, 228, 0.5, flipx=True, shadow=0)
        c.put(H('family9', 'capitalship'), 190, 222, 0.5, shadow=0.5)
        c.put(H('family8', 'capitalship'), 190, 140, 0.5, shadow=0.55)
        c.put(H('family25', 'capitalship'), 190, 58, 0.5, shadow=0.55)
        mast(c, 190, 10, 26, 0, beads=(0.5,))
        mast(c, 124, 224, 34, 66)
        mast(c, 256, 224, 34, -66)
        mast(c, 166, 120, 26, 40)
        dress(c, 30)
        return c
    if name == 'carrier':
        # The banana: one long hull of three stock hulls meshed end to end (a slim bow hull, a broad carrier hull
        # amidships, a carrier stern with the engines), thickest in the middle, the angled flight deck (landing
        # lanes, landing lights, hangar lifts) fused along its port flank; the whole bent into a gentle crescent,
        # the deck's lanes following the curve.
        c = Canvas(270, pad=20, z=1.25)
        c.put(H('family25', 'carrier'), 104, 206, 0.46, shadow=0)
        c.put(deck(34, 210), 76, 140, shadow=0.3, tone=-0.04, edge=1.0)
        dk = c.last.copy()
        detail_over(c, 0.55)
        greebles(c, dk, 10)
        c.put(H('family14', 'destroyer'), 104, 70, 0.4, shadow=0.4)
        c.put(H('family12', 'carrier'), 104, 136, 0.5, shadow=0.6)
        bend(c, 150, 100, 138)
        mast(c, 124, 30, 24, -10, beads=(0.5,))
        mast(c, 132, 120, 30, -62)
        mast(c, 140, 232, 26, -140)
        dress(c, 28, avoid=tuple((60 + ((y - 138) ** 2) / 300, y, 22) for y in range(30, 260, 16)))
        return c
    if name == 'trooptransport':
        # Two hulls end to end: a slim pointed bow hull run into the troop hull, its drop bays along the flanks.
        c = Canvas(210, pad=20, z=1.25)
        c.put(H('family21', 'trooptransport'), 105, 138, 0.5, shadow=0)
        c.put(H('family25', 'trooptransport'), 105, 56, 0.5, shadow=0.55)
        mast(c, 105, 12, 18, 0, beads=(0.5,))
        mast(c, 78, 140, 22, 70)
        mast(c, 132, 150, 22, -110)
        dress(c, 10)
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


def down(v, w, h, f=Image.LANCZOS):
    return np.asarray(Image.fromarray(v.astype(np.float32), 'F').resize((w, h), f)).astype(np.float64)


def finish(name, c, xs, cols, rng):
    L, A, G, T, M = c.result()
    out, v = paint(L, A, T, M, xs, cols, SS)
    # down to the output frame: Lanczos on the premultiplied colour, a light unsharp mask; masks box-filtered
    w, h = c.out_w, c.out_h
    A = np.clip(down(A, w, h), 0, 1)
    out = np.stack([np.clip(down(out[..., k] * c.A, w, h), 0, None) for k in range(3)], axis=2) / np.maximum(A, 1e-3)[..., None]
    out = np.clip(out, 0, 1)
    usm = Image.fromarray((out * 255).astype(np.uint8)).filter(ImageFilter.UnsharpMask(radius=1.0, percent=40, threshold=2))
    out = np.where((A > 0.05)[..., None], np.asarray(usm).astype(np.float64) / 255, out)
    v = np.clip(down(v, w, h), 0, 1)
    G = np.clip(down(G, w, h, Image.BOX), 0, 1)
    M = {k: np.clip(down(m, w, h, Image.BOX), 0, 1) for k, m in M.items()}
    alpha = A.copy()
    # marker points (deduped, kept only where the hull is there)
    marks = {}
    for (mx, my, kind) in c.marks:
        x, y = int(mx / SS), int(my / SS)
        if 0 <= x < w and 0 <= y < h and A[y, x] > 0.5:
            marks[(x, y)] = kind
    # thrusters only where there is open space aft of them (merged hulls leave stock engine marks mid-ship)
    for (x, y), k in list(marks.items()):
        if k == 1 and any(A[yy_, x] > 0.3 for yy_ in range(y + 2, min(h, y + 7))):
            del marks[(x, y)]
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
    lights = sorted(p_ for p_, k in marks.items() if k == 2)
    if len(lights) > 18:  # within the scan cap of 20 (ambientLayer.ts MAX_MARKERS): keep 18 spread over the frame
        keep = set(lights[int(i_ * len(lights) / 18)] for i_ in range(18))
        marks = {p_: k for p_, k in marks.items() if k != 2 or p_ in keep}
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
    # small bright specular glints: the brightest local maxima of the lit metal, sparse
    lum = out @ LUM
    sol = alpha > 0.9
    mx_ = np.maximum.reduce([shift(lum, dy, dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx])
    cand = sol & (lum >= mx_) & (lum > np.quantile(lum[sol], 0.985)) & ~protect
    keep = rng.random(lum.shape) < 0.5
    out[cand & keep] = np.array([1.0, 0.97, 0.9])
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
    global POOL
    POOL = Pool(root)
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
