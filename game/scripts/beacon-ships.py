#!/usr/bin/env python3
"""The Beacon's art (Giantworks add-on, the Beacon wonder): the Reclaimers' warships, the two Watchers and the finished
Beacon. Offline build step; the outputs are our own art, committed under public/art/beacon/ (src/render/threatArt.ts
beaconArtUrl draws them; src/render/beaconFx.ts animates them), plus the table src/render/beaconArtData.ts (the cores,
the pulse-layer atlases, the Watcher plates' hinges), written by this script.

    python3 -I scripts/beacon-ships.py [--dwu <DW:U install>] [--out public/art/beacon]
        [--data src/render/beaconArtData.ts] [--preview <dir>] [--only escort,watcher]

Needs Python 3 with numpy and Pillow only; reads one stock frame from the install (default public/assets/dwu; the
machinery in the middle of family2/capitalship.png, as shading only) for the machine inlays round the hearts.
Deterministic (fixed seeds per output). --preview writes sheet.png (every frame at rest and at a beat's peak),
small.png (in-game sizes) and watcher-sheet.png (the pod closed, opening and open).

The look (the user's direction): a dark stained-glass, purple-speckled black ribbed hull with beating organs and
veins. Nothing here is bilateral: every hull is grown with three-way radial symmetry (no front, no back), most of them
swirled one way, each with one red heart.

Per frame (built at 3-4x the output size from signed-distance parts, then downsampled with Lanczos; nothing blurred):
1. Form: parts (hubs, swept arms, forks, pods, rings, membranes, tendons) unioned smoothly into one silhouette; a
   height field (tubes, domes, tiers) with the parts' ribbing on top: chevron ribs across the arms, spiral or radial
   gills on the hubs, meridian ribs on the pods; contact shadows and occlusion from the height field.
2. Hull: black chitin (a faint violet sheen, a glossy lavender highlight on every rib crest, a violet rim light on the
   silhouette so it reads on black space), fine growth striations, speckled with purple and lilac flecks that glint.
3. Stained glass: windows let into the hull (domes, lancets along the arms, wing membranes, egg sacs), leaded into
   cells (deep purple, wine red, dark teal, indigo, a little magenta) with black lead lines, the hull's bones running
   over them. Behind the glass a dim violet fluid with the organs (lobed, folded, crimson flesh) and the veins
   (branching from the heart) in it, seen through the colour of each pane; surface veins run on over the black hull.
4. The heart: one red core per hull in a ribbed socket ringed with machine inlays (stock pieces' shading).
5. Pulse layers (beaconFx.ts adds them at runtime): the organs' light (their glow seen through the panes' colours) and
   the veins' light in three bands by distance from the heart (a pulse travels outward after each beat), packed into
   one atlas per frame; the heart's glow is procedural. The frame bakes the resting light.
6. The Watchers: a seed pod (three domed, ribbed plates with spiral seams over a great rose window) that unfolds: the
   body and the three plates are separate layers in one canvas (watcher-body.png, watcher-plate-<k>.png) and
   beaconFx.ts swings each plate out about its hinge; watcher.png is the closed pod (the body under the plates at rest).
7. The Beacon: a stepped tower seen from above (gilled tiers, six lancets, a rose window with tracery under the red
   eye), three great thorned claws and three relay needles beaded with glass nodes; beaconFx.ts adds its call (a ring
   sent out with each beat).
8. Frames: the content box centred on the heart (four all-but-transparent balance pixels; the game turns a frame about
   its content box's centre), no thruster or light marks (they glide), no pixel in either marker colour, no opaque black.
"""
import argparse
import math
import os
import zlib

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
F32 = np.float32

# Light from the upper left and above (the stock frames' light).
LIGHT = np.array([-0.46, -0.58, 0.67], F32)
LIGHT /= np.linalg.norm(LIGHT)
HALF = (LIGHT + np.array([0, 0, 1], F32))
HALF /= np.linalg.norm(HALF)

# Stained glass: deep purple, wine red, dark teal, indigo, magenta (linear 0..1 colours of the pane).
GLASS_COLOURS = np.array([
    [0.34, 0.07, 0.50],   # deep purple
    [0.26, 0.05, 0.42],   # violet
    [0.50, 0.04, 0.13],   # wine red
    [0.40, 0.02, 0.09],   # claret
    [0.03, 0.30, 0.32],   # dark teal
    [0.02, 0.22, 0.27],   # deep teal
    [0.12, 0.08, 0.44],   # indigo
    [0.50, 0.06, 0.36],   # magenta
], F32)
GLASS_WEIGHTS = np.array([0.2, 0.14, 0.17, 0.1, 0.14, 0.09, 0.09, 0.07])

HULL = np.array([0.040, 0.032, 0.050], F32)       # black chitin, a breath of violet
SHEEN = np.array([0.30, 0.13, 0.46], F32)         # the violet sheen / rim light
SPEC = np.array([0.80, 0.72, 0.98], F32)          # lavender highlight
EDGE_LIGHT = np.array([0.42, 0.24, 0.66], F32)    # the edge light
FLUID = np.array([0.30, 0.17, 0.36], F32)         # the fluid behind the glass (resting light)
ORGAN = np.array([0.50, 0.05, 0.11], F32)         # flesh
VEIN = np.array([0.42, 0.03, 0.08], F32)
CORE_HOT = np.array([1.0, 0.86, 0.80], F32)
CORE_RED = np.array([1.0, 0.16, 0.10], F32)
CORE_DEEP = np.array([0.45, 0.01, 0.04], F32)


# ---------------------------------------------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------------------------------------------

def smin(a, b, k):
    """Polynomial smooth minimum (k: blend width, px)."""
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def box_blur(v, r, axis):
    if r < 1:
        return v
    k = 2 * r + 1
    pad = [(0, 0)] * v.ndim
    pad[axis] = (r + 1, r)
    p = np.pad(v, pad, mode='edge')
    c = np.cumsum(p, axis=axis, dtype=np.float64)
    n = v.shape[axis]
    hi = np.take(c, np.arange(k, k + n), axis=axis)
    lo = np.take(c, np.arange(0, n), axis=axis)
    return ((hi - lo) / k).astype(F32)


def gblur(v, sigma):
    """Gaussian-ish blur: three box passes per axis."""
    if sigma <= 0.3:
        return v.astype(F32)
    r = max(1, int(round(math.sqrt(12 * sigma * sigma / 3 + 1) / 2)))
    out = v.astype(F32)
    for _ in range(3):
        out = box_blur(out, r, 0)
        out = box_blur(out, r, 1)
    return out


def value_noise(rng, h, w, cell):
    gw = max(2, int(math.ceil(w / cell)) + 3)
    gh = max(2, int(math.ceil(h / cell)) + 3)
    g = Image.fromarray((rng.random((gh, gw)) * 255).astype(np.uint8))
    big = np.asarray(g.resize((int(gw * cell), int(gh * cell)), Image.BICUBIC)).astype(F32) / 255
    return big[int(cell):int(cell) + h, int(cell):int(cell) + w]


def fbm(rng, h, w, cell, octaves=3):
    v = np.zeros((h, w), F32)
    amp, tot = 1.0, 0.0
    for _ in range(octaves):
        v += amp * value_noise(rng, h, w, max(1.0, cell))
        tot += amp
        amp *= 0.5
        cell = max(1.0, cell / 2)
    return v / tot


def rot(x, y, a):
    c, s = math.cos(a), math.sin(a)
    return x * c - y * s, x * s + y * c


def polar(r, th):
    """Frame point at radius r and angle th (0 = up, clockwise; screen coordinates, y down)."""
    return r * math.sin(th), -r * math.cos(th)


def lerp(a, b, t):
    return a + (b - a) * t


def down(ch, S):
    """Lanczos downsample of one float channel to S x S."""
    return np.asarray(Image.fromarray(ch.astype(F32), 'F').resize((S, S), Image.LANCZOS)).astype(F32)


def up(ch, N):
    """Bilinear upsample of a smooth float field to N x N."""
    return np.asarray(Image.fromarray(ch.astype(F32), 'F').resize((N, N), Image.BILINEAR)).astype(F32)


# ---------------------------------------------------------------------------------------------------------------
# The form: signed-distance parts on a supersampled grid (units: output px, origin at the frame centre)
# ---------------------------------------------------------------------------------------------------------------

class Part:
    __slots__ = ('win', 'h', 'rib', 'ribr', 'grow')


class Art:
    def __init__(self, name, S, B, seed=None):
        self.name, self.S, self.B = name, S, B
        self.N = N = S * B
        c = ((np.arange(N, dtype=F32) + 0.5) / B - S / 2).astype(F32)
        self.c = c
        self.D = np.full((N, N), 1e4, F32)        # signed distance of the silhouette (px)
        self.H = np.full((N, N), -1e4, F32)       # height (px)
        self.GLASS = np.zeros((N, N), F32)        # stained-glass windows (0..1)
        self.MEMB = np.zeros((N, N), F32)         # glass that is the whole thickness (membranes): no hull rim needed
        self.NOGLASS = np.zeros((N, N), F32)      # hull laid over the windows (tracery)
        self.parts = []
        self.organs = []
        self.veins = []     # (ax, ay, bx, by, wa, wb, ta, tb, surface_ok)
        self.seeds = []     # glass cell seeds (x, y)
        self.inlays = []    # machine inlays (x, y, r_in, r_out)
        self.core = None
        self.rng = np.random.default_rng(seed if seed is not None else zlib.crc32(('beacon:' + name).encode()))
        self.grow_lines = np.zeros((N, N), F32)   # growth-striation coordinate (px along the rib direction)
        self.blend = 5.0

    # --- windows ---------------------------------------------------------------------------------------------
    def win(self, x0, y0, x1, y1):
        S, B, N = self.S, self.B, self.N
        j0 = max(0, int(math.floor((x0 + S / 2) * B)) - 2)
        j1 = min(N, int(math.ceil((x1 + S / 2) * B)) + 2)
        i0 = max(0, int(math.floor((y0 + S / 2) * B)) - 2)
        i1 = min(N, int(math.ceil((y1 + S / 2) * B)) + 2)
        if j0 >= j1 or i0 >= i1:
            return None
        return (slice(i0, i1), slice(j0, j1))

    def xy(self, w):
        return np.meshgrid(self.c[w[1]], self.c[w[0]])

    def sample(self, field, x, y):
        S, B, N = self.S, self.B, self.N
        j = int((x + S / 2) * B)
        i = int((y + S / 2) * B)
        if 0 <= i < N and 0 <= j < N:
            return field[i, j]
        return None

    # --- merging ---------------------------------------------------------------------------------------------
    def merge(self, w, d, h, rib=None, ribr=None, grow=None, k=None):
        k = self.blend if k is None else k
        self.D[w] = smin(self.D[w], d, k)
        hh = np.where(d < k, h, -1e4).astype(F32)
        self.H[w] = smax(self.H[w], hh, k * 0.6)
        p = Part()
        p.win, p.h = w, hh
        p.rib = rib
        p.ribr = ribr
        p.grow = grow
        self.parts.append(p)

    # --- primitives ------------------------------------------------------------------------------------------
    def hub(self, cx, cy, R, lobes=3, amp=0.0, phase=0.0, height=None, ribs=None, k=None, flat=0.0, pinch=0.0, hbase=0.0):
        """A rounded hub: polar radius R(1 + amp cos(lobes (th - phase))); dome height; ribs:
        ('spiral', n, twist, amp) radial gills swirled by `twist` turns over the radius, or ('rings', spacing, amp)."""
        ext = R * (1 + abs(amp)) + 4
        w = self.win(cx - ext, cy - ext, cx + ext, cy + ext)
        X, Y = self.xy(w)
        dx, dy = X - cx, Y - cy
        r = np.hypot(dx, dy)
        th = np.arctan2(dx, -dy)
        Rt = R * (1 + amp * np.cos(lobes * (th - phase)))
        if pinch:
            Rt = Rt * (1 - pinch * np.cos(lobes * (th - phase)) ** 8)
        d = (r - Rt) * 0.92
        height = R * 0.45 if height is None else height
        q = np.clip(r / np.maximum(Rt, 1e-3), 0, 1)
        h = hbase + height * np.sqrt(np.clip(1 - q ** 2, 0, 1)) * (1 - flat) + height * flat * np.sqrt(np.clip((1 - q) * R / 6, 0, 1))
        rib = ribr = grow = None
        if ribs is not None:
            jit = self.rib_noise(X.shape, R)
            if ribs[0] == 'spiral':
                _, n, twist, a = ribs
                u = th * n / (2 * math.pi) + twist * r / R * n / 3 + jit
                fade = np.clip((q - 0.22) * 5, 0, 1) * np.clip((1 - q) * R / 3, 0, 1)
                grow = u * 2 * math.pi * r / n
            elif ribs[0] == 'chevron':
                # herringbone across each lobe: ribs bent into chevrons pointing out along the lobe's axis
                _, sp, chev, a = ribs
                sec = 2 * math.pi / lobes
                rel = ((th - phase + sec / 2) % sec) - sec / 2
                s = r * np.cos(rel)
                p = r * np.sin(rel)
                u = (s - chev * np.abs(p)) / sp + jit
                fade = np.clip((1 - q) * R / 3, 0, 1) * np.clip((np.abs(p) - 1.0) * 0.8, 0, 1) * np.clip((q - 0.15) * 5, 0, 1)
                grow = p
            else:
                _, sp, a = ribs
                u = r / sp + jit
                fade = np.clip((1 - q) * R / 3, 0, 1)
                grow = th * r
            rib, ribr = self.rib_fields(u, fade, a, X.shape, R)
        self.merge(w, d.astype(F32), h.astype(F32), rib, ribr, grow, k)
        return w

    def rib_fields(self, u, fade, a, shape, scale):
        """Ribs along the coordinate u (one per integer): the hull's relief (rounded tubes with V grooves between,
        their strength varying along the hull) and the narrow crests that run on over the glass as bones."""
        amp = self.rib_amp(shape, scale)
        tube = np.sqrt(np.clip(1 - (2 * ((u + 0.5) - np.floor(u + 0.5)) - 1) ** 2, 0, 1))
        rib = (tube * fade * amp * a).astype(F32)
        ribr = (ridge(u, 7) * fade * np.minimum(amp, 1)).astype(F32)
        return rib, ribr

    def rib_noise(self, shape, scale):
        """A slow wobble (in rib periods) so no two ribs run quite parallel."""
        return ((fbm(self.rng, shape[0], shape[1], max(4.0, scale * self.B * 0.5), 2) - 0.5) * 0.7).astype(F32)

    def rib_amp(self, shape, scale):
        """Rib strength varies along the hull (some ribs proud, some worn low)."""
        return (0.55 + 0.75 * fbm(self.rng, shape[0], shape[1], max(3.0, scale * self.B * 0.25), 2)).astype(F32)

    def arm(self, pts, radii, hk=0.75, ribs=(5.0, 0.5, 1.4), k=None, hbase=0.0, glass=None, ridge_spine=0.0, noglass=False):
        """A tube along a polyline (pts: [(x, y)], radii per point). ribs: (spacing, chevron, amp): ribs across the arm,
        bent into chevrons pointing along it. glass: (t0, t1, frac) a window along the spine between arc fractions t0..t1,
        `frac` of the local radius wide."""
        pts = np.asarray(pts, F32)
        radii = np.asarray(radii, F32)
        seg = np.hypot(*(pts[1:] - pts[:-1]).T)
        acc = np.concatenate([[0], np.cumsum(seg)]).astype(F32)
        L = float(acc[-1])
        rmax = float(radii.max())
        x0, y0 = pts.min(0) - rmax - 4
        x1, y1 = pts.max(0) + rmax + 4
        w = self.win(x0, y0, x1, y1)
        X, Y = self.xy(w)
        best = np.full(X.shape, 1e4, F32)
        S_ = np.zeros(X.shape, F32)
        R_ = np.ones(X.shape, F32)
        P_ = np.zeros(X.shape, F32)
        Dd = np.full(X.shape, 1e4, F32)
        for i in range(len(pts) - 1):
            ax, ay = pts[i]
            bx, by = pts[i + 1]
            dx, dy = bx - ax, by - ay
            l2 = dx * dx + dy * dy
            if l2 < 1e-6:
                continue
            t = np.clip(((X - ax) * dx + (Y - ay) * dy) / l2, 0, 1)
            px, py = ax + t * dx, ay + t * dy
            dd = np.hypot(X - px, Y - py)
            rr = radii[i] + (radii[i + 1] - radii[i]) * t
            sd = dd - rr
            m = sd < best
            best = np.where(m, sd, best)
            S_ = np.where(m, acc[i] + t * math.sqrt(l2), S_)
            R_ = np.where(m, rr, R_)
            side = np.sign(dx * (Y - ay) - dy * (X - ax))
            P_ = np.where(m, dd * side, P_)
            Dd = np.where(m, dd, Dd)
        q = np.clip(Dd / np.maximum(R_, 1e-3), 0, 1)
        h = hbase + hk * R_ * np.sqrt(np.clip(1 - q ** 2, 0, 1))
        if ridge_spine:
            h = h + ridge_spine * R_ * np.clip(1 - q * 3, 0, 1) ** 2
        rib = ribr = None
        sp, chev, a = ribs
        u = (S_ - chev * np.abs(P_)) / sp + self.rib_noise(X.shape, rmax * 2) * 0.6
        fade = np.clip((1 - q) * R_ / 2.0, 0, 1) * np.clip(S_ / 3, 0, 1)
        rib, ribr = self.rib_fields(u, fade, a, X.shape, rmax)
        grow = P_
        self.merge(w, best, h.astype(F32), rib.astype(F32), ribr.astype(F32), grow.astype(F32), k)
        if noglass:
            self.NOGLASS[w] = np.maximum(self.NOGLASS[w], np.clip(0.5 - best * self.B, 0, 1).astype(F32))
        if glass is not None:
            t0, t1, frac = glass
            s = S_ / max(L, 1e-3)
            ends = np.clip(np.minimum(s - t0, t1 - s) * L / max(2.0, rmax * 0.6), 0, 1)
            gw = frac * R_ * np.sqrt(np.clip(ends, 0, 1))
            cov = np.clip((gw - np.abs(P_)) * self.B, 0, 1) * (best < 0)
            self.GLASS[w] = np.maximum(self.GLASS[w], cov.astype(F32))
        return dict(pts=pts, radii=radii, acc=acc, L=L)

    def ellipse(self, cx, cy, rx, ry, ang=0.0, height=None, ribs=None, k=None, hbase=0.0, glass=0.0, memb=False, noglass=False):
        """An ellipsoid pod rotated by `ang`; ribs: (n, amp) meridian ribs; glass: fraction of the radius that is a window."""
        ext = max(rx, ry) + 4
        w = self.win(cx - ext, cy - ext, cx + ext, cy + ext)
        X, Y = self.xy(w)
        u, v = rot(X - cx, Y - cy, -ang)
        q = np.sqrt((u / rx) ** 2 + (v / ry) ** 2)
        d = (q - 1) * min(rx, ry)
        height = min(rx, ry) * 0.8 if height is None else height
        h = hbase + height * np.sqrt(np.clip(1 - q ** 2, 0, 1))
        rib = ribr = grow = None
        if ribs is not None:
            n, a = ribs
            phi = np.arctan2(v / ry, u / rx)
            uu = phi * n / (2 * math.pi)
            fade = np.clip((q - 0.25) * 4, 0, 1) * np.clip((1 - q) * min(rx, ry) / 2, 0, 1)
            rib, ribr = self.rib_fields(uu, fade, a, X.shape, min(rx, ry))
            grow = phi * min(rx, ry)
        self.merge(w, d.astype(F32), h.astype(F32), rib, ribr, grow, k)
        if noglass:
            self.NOGLASS[w] = np.maximum(self.NOGLASS[w], np.clip((1 - q) * min(rx, ry) * self.B, 0, 1).astype(F32))
        if glass > 0:
            cov = np.clip((glass - q) * min(rx, ry) * self.B, 0, 1)
            self.GLASS[w] = np.maximum(self.GLASS[w], cov.astype(F32))
            if memb:
                self.MEMB[w] = np.maximum(self.MEMB[w], cov.astype(F32))
        return w

    def membrane(self, poly, height=2.0, k=2.0, hbase=0.0):
        """A flat stained-glass membrane (a closed polygon, given as points): all glass, leaded."""
        poly = np.asarray(poly, F32)
        x0, y0 = poly.min(0) - 3
        x1, y1 = poly.max(0) + 3
        w = self.win(x0, y0, x1, y1)
        X, Y = self.xy(w)
        dmin = np.full(X.shape, 1e4, F32)
        inside = np.zeros(X.shape, bool)
        n = len(poly)
        for i in range(n):
            ax, ay = poly[i]
            bx, by = poly[(i + 1) % n]
            dx, dy = bx - ax, by - ay
            l2 = dx * dx + dy * dy
            if l2 < 1e-9:
                continue
            t = np.clip(((X - ax) * dx + (Y - ay) * dy) / l2, 0, 1)
            dmin = np.minimum(dmin, np.hypot(X - ax - t * dx, Y - ay - t * dy))
            cond = ((ay > Y) != (by > Y)) & (X < ax + (Y - ay) * dx / (by - ay + 1e-12))
            inside ^= cond
        d = np.where(inside, -dmin, dmin).astype(F32)
        h = (hbase + height * np.clip(-d / 3, 0, 1)).astype(F32)
        self.merge(w, d, h, None, None, None, k)
        cov = np.clip((-d - 1.2) * self.B, 0, 1)
        self.GLASS[w] = np.maximum(self.GLASS[w], cov.astype(F32))
        self.MEMB[w] = np.maximum(self.MEMB[w], cov.astype(F32))

    def glass_disc(self, cx, cy, R, lobes=3, amp=0.0, phase=0.0):
        ext = R * (1 + abs(amp)) + 3
        w = self.win(cx - ext, cy - ext, cx + ext, cy + ext)
        X, Y = self.xy(w)
        dx, dy = X - cx, Y - cy
        th = np.arctan2(dx, -dy)
        Rt = R * (1 + amp * np.cos(lobes * (th - phase)))
        cov = np.clip((Rt - np.hypot(dx, dy)) * self.B, 0, 1)
        self.GLASS[w] = np.maximum(self.GLASS[w], cov.astype(F32))

    def glass_lancet(self, cx, cy, ang, r0, r1, width, point=0.6):
        """A pointed (ogive) window along the ray at angle `ang` from radius r0 to r1, `width` px wide."""
        a0 = polar(r0, ang)
        a1 = polar(r1, ang)
        ext = max(r1, 4) + width
        w = self.win(cx + min(a0[0], a1[0]) - ext * 0.5 - width, cy + min(a0[1], a1[1]) - ext * 0.5 - width,
                     cx + max(a0[0], a1[0]) + ext * 0.5 + width, cy + max(a0[1], a1[1]) + ext * 0.5 + width)
        X, Y = self.xy(w)
        # coordinates along / across the ray
        ux, uy = math.sin(ang), -math.cos(ang)
        s = (X - cx) * ux + (Y - cy) * uy
        p = (X - cx) * (-uy) + (Y - cy) * ux
        L = r1 - r0
        t = (s - r0) / L
        # half width: full over the shaft, an ogive point at the outer end, a round inner end
        hw = width / 2 * np.where(t > 1 - point, np.sqrt(np.clip(1 - ((t - (1 - point)) / point) ** 2, 0, 1)), 1.0)
        hw = np.where(t < 0, width / 2 * np.sqrt(np.clip(1 - (t * L / (width / 2)) ** 2, 0, 1)), hw)
        cov = np.clip((hw - np.abs(p)) * self.B, 0, 1) * (t > -width / 2 / L) * (t < 1)
        self.GLASS[w] = np.maximum(self.GLASS[w], cov.astype(F32))

    # --- contents --------------------------------------------------------------------------------------------
    def organ(self, cx, cy, rx, ry, ang=0.0, lobes=None, hot=1.0):
        rng = self.rng
        if lobes is None:
            lobes = [(k, rng.uniform(0.03, 0.11), rng.uniform(0, 6.283)) for k in (2, 3, 5)]
        self.organs.append(dict(cx=cx, cy=cy, rx=rx, ry=ry, ang=ang, lobes=lobes, seed=int(rng.integers(1 << 30)), hot=hot))

    def set_core(self, cx, cy, r):
        self.core = (cx, cy, r)

    def inlay(self, cx, cy, r_in, r_out):
        self.inlays.append((cx, cy, r_in, r_out))

    def vein_path(self, pts, w0, w1, t0=0.0):
        """An explicit vein along a polyline (trunks): widths w0 -> w1, path length from t0."""
        pts = list(pts)
        n = len(pts)
        seg = [math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(n - 1)]
        L = sum(seg) or 1.0
        acc = t0
        a = 0.0
        for i in range(n - 1):
            wa = lerp(w0, w1, a / L)
            wb = lerp(w0, w1, (a + seg[i]) / L)
            self.veins.append((pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], wa, wb, acc, acc + seg[i]))
            acc += seg[i]
            a += seg[i]
        return acc

    def vein_tree(self, x, y, ang, length, w, t0=0.0, curl=0.22, branch=0.09, depth=0, maxdepth=3, step=1.6,
                  guide=None, region='hull', pull=0.0, spread=0.7):
        """A random branching vein from (x, y) heading `ang` (0 = up, clockwise): stays inside the hull (or the glass),
        branches now and then (children thinner and shorter), tapers. `guide`: a direction the walk is pulled toward."""
        rng = self.rng
        t = t0
        travelled = 0.0
        px, py = x, y
        w0 = w
        while travelled < length:
            if guide is not None:
                d = math.atan2(math.sin(guide - ang), math.cos(guide - ang))
                ang += d * pull
            ang += rng.normal(0, curl)
            nx, ny = px + step * math.sin(ang), py - step * math.cos(ang)
            dv = self.sample(self.D, nx, ny)
            if dv is None or dv > -1.2:
                break
            if region == 'glass':
                gv = self.sample(self.GLASS, nx, ny)
                if gv is None or gv < 0.5:
                    break
            k = travelled / max(length, 1e-3)
            wa = w0 * (1 - 0.65 * k)
            wb = w0 * (1 - 0.65 * min(1, (travelled + step) / max(length, 1e-3)))
            self.veins.append((px, py, nx, ny, wa, wb, t, t + step))
            px, py = nx, ny
            t += step
            travelled += step
            if depth < maxdepth and rng.random() < branch and travelled > 3:
                side = 1 if rng.random() < 0.5 else -1
                self.vein_tree(px, py, ang + side * rng.uniform(0.45, 1.0) * spread / 0.7, (length - travelled) * rng.uniform(0.4, 0.75),
                               wa * 0.62, t, curl, branch * 0.9, depth + 1, maxdepth, step, guide=None, region=region)
        return t

    def trunk(self, pts, w0, w1, t0=0.0, wobble=1.0, every=(6.0, 12.0), blen=(8.0, 20.0), spread=0.9, region='hull',
              maxdepth=2, curl=0.2, branch=0.07, stop=1.0):
        """A main vein along a guide polyline (wobbling off it), throwing side branches (vein_tree) now and then."""
        rng = self.rng
        P = densify(pts, 1.5)
        n = len(P)
        ph = rng.uniform(0, 6.283, 3)
        out = []
        for i in range(n):
            a = P[max(0, i - 1)]
            b = P[min(n - 1, i + 1)]
            tx, ty = b[0] - a[0], b[1] - a[1]
            l = math.hypot(tx, ty) or 1.0
            tx, ty = tx / l, ty / l
            env = min(1.0, i / 6.0)
            off = wobble * env * (0.6 * math.sin(i * 0.23 + ph[0]) + 0.4 * math.sin(i * 0.071 + ph[1]) + 0.25 * math.sin(i * 0.53 + ph[2]))
            out.append((P[i][0] - ty * off, P[i][1] + tx * off))
        m = max(2, int(len(out) * stop))
        out = out[:m]
        self.vein_path(out, w0, w1, t0)
        # branches
        t = t0
        nxt = rng.uniform(*every)
        side = 1 if rng.random() < 0.5 else -1
        for i in range(1, len(out)):
            seg = math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1])
            t += seg
            nxt -= seg
            if nxt <= 0 and i < len(out) - 3:
                nxt = rng.uniform(*every)
                tx, ty = out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]
                ang = math.atan2(tx, -ty) + side * rng.uniform(0.55, 1.1) * spread
                side = -side
                wl = lerp(w0, w1, i / len(out)) * 0.6
                self.vein_tree(out[i][0], out[i][1], ang, rng.uniform(*blen), wl, t, curl=curl, branch=branch,
                               maxdepth=maxdepth, region=region)
        return t

    def seeds_jitter(self, spacing, x0, y0, x1, y1, jitter=0.42):
        rng = self.rng
        ny = int((y1 - y0) / (spacing * 0.866)) + 2
        nx = int((x1 - x0) / spacing) + 2
        for j in range(ny):
            for i in range(nx):
                x = x0 + (i + (0.5 if j % 2 else 0)) * spacing + rng.uniform(-jitter, jitter) * spacing
                y = y0 + j * spacing * 0.866 + rng.uniform(-jitter, jitter) * spacing
                self.seeds.append((x, y))

    def seeds_rose(self, cx, cy, rings, sym=3, jitter=0.0, phase=0.0):
        """Rose-window seeds: rings of (radius, count, offset turns); symmetric (`sym`-fold), optionally jittered."""
        rng = self.rng
        self.seeds.append((cx, cy))
        for (r, n, off) in rings:
            per = n // sym
            jit = [(rng.uniform(-jitter, jitter), rng.uniform(-jitter, jitter)) for _ in range(per)]
            for k in range(n):
                a = phase + (k + off) * 2 * math.pi / n
                jr, ja = jit[k % per]
                x, y = polar(r * (1 + jr), a + ja * 2 * math.pi / n)
                self.seeds.append((cx + x, cy + y))


def densify(pts, step):
    out = [tuple(pts[0])]
    for i in range(len(pts) - 1):
        ax, ay = pts[i]
        bx, by = pts[i + 1]
        l = math.hypot(bx - ax, by - ay)
        k = max(1, int(l / step))
        for j in range(1, k + 1):
            out.append((ax + (bx - ax) * j / k, ay + (by - ay) * j / k))
    return out


def ridge(u, sharp):
    """Ridges at the integers of u: crests `sharp`-ly peaked, wide valleys (0..1)."""
    return ((0.5 + 0.5 * np.cos(2 * math.pi * u)) ** sharp).astype(F32)


# ---------------------------------------------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------------------------------------------

def voronoi(art, seeds, mask, spacing):
    """Nearest-two seeds per pixel inside `mask` (window-limited per seed): cell id and the distance to the cell edge."""
    N, B, S = art.N, art.B, art.S
    ys, xs = np.nonzero(mask > 0.01)
    cell = np.full((N, N), -1, np.int32)
    edge = np.full((N, N), 1e4, F32)
    if len(ys) == 0 or not seeds:
        return cell, edge
    i0, i1, j0, j1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    c = art.c
    X, Y = np.meshgrid(c[j0:j1], c[i0:i1])
    d1 = np.full(X.shape, 1e9, F32)
    d2 = np.full(X.shape, 1e9, F32)
    id1 = np.full(X.shape, -1, np.int32)
    id2 = np.full(X.shape, -1, np.int32)
    rad = spacing * 3.2
    sx = np.array([s[0] for s in seeds], F32)
    sy = np.array([s[1] for s in seeds], F32)
    for k in range(len(seeds)):
        a0 = max(i0, int((sy[k] - rad + S / 2) * B))
        a1 = min(i1, int((sy[k] + rad + S / 2) * B) + 1)
        b0 = max(j0, int((sx[k] - rad + S / 2) * B))
        b1 = min(j1, int((sx[k] + rad + S / 2) * B) + 1)
        if a0 >= a1 or b0 >= b1:
            continue
        ws = (slice(a0 - i0, a1 - i0), slice(b0 - j0, b1 - j0))
        dd = (X[ws] - sx[k]) ** 2 + (Y[ws] - sy[k]) ** 2
        m1 = dd < d1[ws]
        m2 = ~m1 & (dd < d2[ws])
        d2w, id2w = d2[ws], id2[ws]
        d2[ws] = np.where(m1, d1[ws], np.where(m2, dd, d2w))
        id2[ws] = np.where(m1, id1[ws], np.where(m2, k, id2w))
        d1[ws] = np.where(m1, dd, d1[ws])
        id1[ws] = np.where(m1, k, id1[ws])
    ok = (id1 >= 0) & (id2 >= 0)
    a = np.maximum(id1, 0)
    b = np.maximum(id2, 0)
    sep = np.hypot(sx[a] - sx[b], sy[a] - sy[b])
    e = np.where(ok, (d2 - d1) / (2 * np.maximum(sep, 1e-3)), 1e4)
    cell[i0:i1, j0:j1] = id1
    edge[i0:i1, j0:j1] = e.astype(F32)
    return cell, edge


def draw_veins(art):
    """Coverage, path length and width of the veins at build resolution."""
    N, B, S = art.N, art.B, art.S
    cov = np.zeros((N, N), F32)
    T = np.zeros((N, N), F32)
    core = np.zeros((N, N), F32)
    for (ax, ay, bx, by, wa, wb, ta, tb) in art.veins:
        wm = max(wa, wb)
        w = art.win(min(ax, bx) - wm - 1, min(ay, by) - wm - 1, max(ax, bx) + wm + 1, max(ay, by) + wm + 1)
        if w is None:
            continue
        X, Y = art.xy(w)
        dx, dy = bx - ax, by - ay
        l2 = dx * dx + dy * dy + 1e-9
        t = np.clip(((X - ax) * dx + (Y - ay) * dy) / l2, 0, 1)
        d = np.hypot(X - ax - t * dx, Y - ay - t * dy)
        ww = (wa + (wb - wa) * t) * 0.5
        c = np.clip((ww - d) * B + 0.5, 0, 1)
        m = c > cov[w]
        T[w] = np.where(m, ta + (tb - ta) * t, T[w])
        cov[w] = np.maximum(cov[w], c)
        core[w] = np.maximum(core[w], np.clip(1 - d / np.maximum(ww, 0.3), 0, 1) * c)
    return cov, T, core


def draw_organs(art):
    """Organ coverage, dome (0..1), folds and heat at build resolution."""
    N, B = art.N, art.B
    cov = np.zeros((N, N), F32)
    dome = np.zeros((N, N), F32)
    fold = np.zeros((N, N), F32)
    heat = np.zeros((N, N), F32)
    for o in art.organs:
        ext = max(o['rx'], o['ry']) * 1.35 + 2
        w = art.win(o['cx'] - ext, o['cy'] - ext, o['cx'] + ext, o['cy'] + ext)
        if w is None:
            continue
        X, Y = art.xy(w)
        u, v = rot(X - o['cx'], Y - o['cy'], -o['ang'])
        phi = np.arctan2(v, u)
        lob = 1 + sum(a * np.cos(k * phi + p) for (k, a, p) in o['lobes'])
        q = np.sqrt((u / o['rx']) ** 2 + (v / o['ry']) ** 2) / lob
        r = min(o['rx'], o['ry'])
        c = np.clip((1 - q) * r * B + 0.5, 0, 1)
        dm = np.sqrt(np.clip(1 - q ** 2, 0, 1))
        rng = np.random.default_rng(o['seed'])
        n = fbm(rng, X.shape[0], X.shape[1], max(2.0, r * B * 0.45), 3)
        f = np.clip(1 - np.abs(n - 0.5) / 0.045, 0, 1) * np.clip((1 - q) * 4, 0, 1)
        rim = np.clip(1 - np.abs(q - 0.9) / 0.1, 0, 1)
        f = np.maximum(f, rim * 0.8)
        m = c > cov[w]
        dome[w] = np.where(m, dm, dome[w])
        fold[w] = np.where(m, f, fold[w])
        heat[w] = np.where(m, o['hot'] * np.clip(dm * 1.2 - 0.1, 0, 1), heat[w])
        cov[w] = np.maximum(cov[w], c)
    return cov, dome, fold, heat


def normals(H, B):
    gy, gx = np.gradient(H.astype(F32))
    gx *= B
    gy *= B
    inv = 1 / np.sqrt(gx * gx + gy * gy + 1)
    return -gx * inv, -gy * inv, inv


def render(art, inlay_src=None):
    """Composite the frame and its pulse layers. Returns (rgba uint8 S x S x 4, fx dict of float S x S x 3 layers)."""
    N, B, S = art.N, art.B, art.S
    rng = art.rng
    D = art.D
    alpha = np.clip(0.5 - D * B, 0, 1).astype(F32)
    inside = D < 0
    H = np.where(inside, np.maximum(art.H, 0), 0).astype(F32)
    # ribs: from the part on top
    RIB = np.zeros((N, N), F32)
    RIBR = np.zeros((N, N), F32)
    GROW = np.zeros((N, N), F32)
    for p in art.parts:
        if p.rib is None:
            continue
        wgt = np.clip(1 - (H[p.win] - p.h) / 1.2, 0, 1)
        r = p.rib * wgt
        m = r > RIB[p.win]
        RIB[p.win] = np.where(m, r, RIB[p.win])
        RIBR[p.win] = np.where(m, p.ribr * wgt, RIBR[p.win])
        if p.grow is not None:
            GROW[p.win] = np.where(wgt > 0.5, p.grow, GROW[p.win])
    # glass: kept off the silhouette (a hull rim) except membranes
    G = art.GLASS * np.clip((-D - 2.2) * B / 2, 0, 1)
    G = np.maximum(G, art.MEMB * np.clip((-D - 0.9) * B / 2, 0, 1)).astype(F32)
    G = (G * (1 - art.NOGLASS)).astype(F32)
    # bones over the glass: the rib crests
    BONE = (np.clip((RIBR - 0.45) * 5, 0, 1) * G * (1 - art.MEMB * 0.6)).astype(F32)
    spacing = getattr(art, 'cell', 10.0)
    cell, edge = voronoi(art, art.seeds, G, spacing)
    lw = getattr(art, 'lead', 0.7)
    LEAD = (np.clip((lw - edge) * B + 0.5, 0, 1) * G).astype(F32)
    # glass rim lead: the inner edge of every window
    Gs = gblur(G, B * 0.5)
    RIM = np.clip(1 - np.abs(Gs - 0.5) * 4, 0, 1) * (G > 0.02)
    LEAD = np.maximum(LEAD, RIM * 0.9).astype(F32)
    PANE = (G * (1 - BONE) * (1 - LEAD)).astype(F32)

    VC, VT, VK = draw_veins(art)
    OC, OD, OF, OH = draw_organs(art)
    OC *= G
    OD *= G

    # height: the hull, ribs off the glass, the glass recessed, bones and lead proud of it, surface veins raised
    recess = getattr(art, 'recess', 2.2)
    Hn = H + RIB * (1 - G) - recess * Gs + BONE * (recess + 1.2) + LEAD * 0.9 * (1 - BONE)
    surf_v = VC * (1 - G)
    Hn = Hn + surf_v * 0.9
    grain = (fbm(rng, N, N, B * 1.6, 2) - 0.5) * 0.14
    striae = 0.07 * np.sin(GROW * 2 * math.pi / 1.7)
    Hn = Hn + (grain + striae) * (1 - G)
    Hn = Hn * np.clip(-D * B / 1.5, 0, 1)
    nx, ny, nz = normals(Hn, B)
    ndl = np.clip(nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2], 0, 1)
    ndh = np.clip(nx * HALF[0] + ny * HALF[1] + nz * HALF[2], 0, 1)
    # occlusion: recesses darker; contact shadow toward the lower right
    Hb = gblur(Hn, B * 3)
    ao = np.clip(1 - (Hb - Hn) * 0.09, 0.35, 1)
    sh = np.zeros_like(Hn)
    for k, d in ((1, 2.0), (2, 4.5), (3, 8.0)):
        sx = int(round(-LIGHT[0] / math.hypot(LIGHT[0], LIGHT[1]) * d * B))
        sy = int(round(-LIGHT[1] / math.hypot(LIGHT[0], LIGHT[1]) * d * B))
        shifted = np.roll(np.roll(Hn, sy, axis=0), sx, axis=1)
        sh = np.maximum(sh, np.clip((shifted - Hn - d * 1.5) / 4, 0, 1))
    shadow = 1 - 0.65 * gblur(sh, B * 0.8)

    # --- hull
    fres = (1 - nz) ** 2
    diff = ndl * 1.35 + 0.28
    hull = HULL[None, None, :] * diff[..., None]
    hull += SHEEN[None, None, :] * (0.08 * ndh ** 6 + 0.45 * fres * (0.3 + 0.7 * ndl))[..., None]
    # a violet edge light round the silhouette (reads on black space at play zoom)
    edge = np.clip(1 - (-D) / 1.6, 0, 1) * (D < 0)
    hull += EDGE_LIGHT[None, None, :] * (edge * (0.25 + 0.75 * np.clip(-(nx * LIGHT[0] + ny * LIGHT[1]) * 2 + 0.3, 0, 1)))[..., None]
    spec = ndh ** 70 * 0.85 + ndh ** 18 * 0.10
    hull += SPEC[None, None, :] * spec[..., None]
    hull *= (ao * shadow)[..., None]
    # speckles: purple / lilac flecks on the hull that glint
    dens = getattr(art, 'speckle', 0.03)
    sp = rng.random((N, N)) < dens / (B * B)
    sp_size = gblur(sp.astype(F32), B * 0.3) * (B * B * 0.8)
    sp2 = rng.random((N, N)) < dens * 0.12 / (B * B)
    sp_size = np.maximum(sp_size, gblur(sp2.astype(F32), B * 0.55) * (B * B * 1.6))
    fleck = np.clip(sp_size, 0, 1) * (1 - G) * (alpha > 0.5)
    tone = fbm(rng, N, N, B * 30, 2)
    fcol = np.stack([0.42 + 0.30 * tone, 0.18 + 0.20 * tone, 0.62 + 0.25 * tone], axis=-1).astype(F32)
    glint = (0.28 + 0.55 * ndl + 1.4 * ndh ** 30) * ao
    hull = hull * (1 - fleck[..., None] * 0.9) + fcol * (fleck * glint)[..., None]
    # fine dust of dimmer violet specks
    dust = (rng.random((N, N)) < 0.03 / (B * B) * 3) * (1 - G)
    dust = np.clip(gblur(dust.astype(F32), B * 0.25) * B * B * 0.6, 0, 1)
    hull = hull + np.array([0.10, 0.04, 0.16], F32) * (dust * (0.4 + ndl))[..., None]
    # surface veins: dark crimson ridges with a dull glow
    vglow = VC * (1 - G)
    hull = hull * (1 - vglow[..., None] * 0.75) + VEIN[None, None, :] * (0.45 + 0.5 * ndl + 0.8 * VK)[..., None] * vglow[..., None] * 0.75
    hull += SPEC[None, None, :] * (vglow * ndh ** 40 * 0.6)[..., None]

    # --- behind the glass: the fluid, the veins, the organs; the heart's light
    fl = fbm(rng, N, N, B * 14, 3)
    behind = FLUID[None, None, :] * (0.75 + 0.5 * fl)[..., None]
    core_light = np.zeros((N, N), F32)
    if art.core is not None:
        cx, cy, cr = art.core
        X, Y = np.meshgrid(art.c, art.c)
        dd = np.hypot(X - cx, Y - cy)
        core_light = np.exp(-np.maximum(dd - cr, 0) / (cr * 2.2)).astype(F32)
        del X, Y
    behind += np.array([0.55, 0.06, 0.08], F32) * (core_light * 0.55)[..., None]
    vb = VC * G
    behind = behind * (1 - vb[..., None]) + VEIN[None, None, :] * (0.75 + 1.0 * VK)[..., None] * vb[..., None]
    # organs: lobed flesh, lit from within, folds dark, a dark rim
    oc = OC
    halo = np.clip(gblur(OC, B * 1.6) * 1.6 - OC, 0, 1)
    behind = behind * (1 - 0.7 * halo)[..., None]
    flesh = ORGAN[None, None, :] * (0.3 + 1.1 * OD)[..., None] + np.array([0.5, 0.12, 0.12], F32) * (OH ** 2 * 0.8)[..., None]
    flesh *= (1 - 0.75 * OF)[..., None]
    flesh = flesh * (0.35 + 0.65 * np.clip(OD * 2.5, 0, 1))[..., None]
    # veins over the organs
    flesh = flesh * (1 - vb[..., None] * 0.6) + (VEIN * 1.4)[None, None, :] * (vb * 0.6)[..., None]
    behind = behind * (1 - oc[..., None]) + flesh * oc[..., None]
    # the panes: each cell's colour (a little variation within a cell: hand-made glass)
    ncol = len(art.seeds)
    pick = rng.choice(len(GLASS_COLOURS), size=max(ncol, 1), p=GLASS_WEIGHTS / GLASS_WEIGHTS.sum())
    bright = rng.uniform(0.75, 1.2, max(ncol, 1)).astype(F32)
    cols = GLASS_COLOURS[pick] * bright[:, None]
    if hasattr(art, 'glass_override'):
        cols = art.glass_override(cols, np.array(art.seeds, F32))
    cc = np.where(cell[..., None] >= 0, cols[np.maximum(cell, 0)], GLASS_COLOURS[0][None, None, :])
    streak = 0.88 + 0.24 * fbm(rng, N, N, B * 3, 2)
    trans = (0.3 + 1.55 * cc) * streak[..., None]
    seen = behind * trans
    # glass surface: a soft sheen and a sharp glint
    gsp = ndh ** 40 * 0.32 + ndh ** 6 * 0.035
    seen += np.array([0.85, 0.82, 1.0], F32) * gsp[..., None]
    # lead: dark metal, a little lit on its crest
    lead = np.array([0.035, 0.03, 0.04], F32)[None, None, :] * (0.7 + 1.2 * ndl)[..., None] + SPEC * (ndh ** 50 * 0.35)[..., None]
    col = hull * (1 - G[..., None]) + seen * PANE[..., None] + lead * (LEAD * (1 - BONE))[..., None] + hull * BONE[..., None]
    # machine inlays round the heart (stock shading, dark gunmetal)
    if inlay_src is not None:
        for (cx, cy, ri, ro) in art.inlays:
            col = apply_inlay(art, col, inlay_src, cx, cy, ri, ro, ndl)
    # the heart
    if art.core is not None:
        col, alpha = draw_core(art, col, alpha)
    col = np.clip(col, 0, 1)

    # --- downsample
    out = np.zeros((S, S, 4), F32)
    a_s = down(alpha, S)
    for ch in range(3):
        out[..., ch] = down(col[..., ch] * alpha, S)
    out[..., 3] = np.clip(a_s, 0, 1)
    rgb = out[..., :3] / np.maximum(out[..., 3:4], 1e-4)
    rgb = np.clip(rgb, 0, 1)
    a8 = np.round(out[..., 3] * 255)
    a8[a8 < 3] = 0
    rgb8 = np.round(rgb * 255)
    img = np.concatenate([rgb8, a8[..., None]], axis=-1).astype(np.uint8)
    img = fix_markers(img)
    if getattr(art, 'balance', True):
        img = balance(img)

    # --- pulse layers (output resolution)
    fx = pulse_layers(art, G, PANE, cc, OC, OH, VC, VT, VK, alpha)
    return img, fx


def apply_inlay(art, col, src, cx, cy, ri, ro, ndl):
    """Machine inlays: a ring of stock-frame shading (dark gunmetal) round the heart's socket, rotated into C3."""
    N, B = art.N, art.B
    w = art.win(cx - ro - 2, cy - ro - 2, cx + ro + 2, cy + ro + 2)
    X, Y = art.xy(w)
    dx, dy = X - cx, Y - cy
    r = np.hypot(dx, dy)
    th = (np.arctan2(dx, -dy) % (2 * math.pi / 3)) / (2 * math.pi / 3)
    band = np.clip((r - ri) * B, 0, 1) * np.clip((ro - r) * B, 0, 1)
    # unwrap the stock patch (src: float luminance image) onto the ring
    hs, ws = src.shape
    sx = np.clip((th * (ws - 1)).astype(np.int32), 0, ws - 1)
    sy = np.clip(((r - ri) / max(ro - ri, 1e-3) * (hs - 1)).astype(np.int32), 0, hs - 1)
    L = src[sy, sx]
    metal = np.stack([0.10 + 0.32 * L, 0.09 + 0.29 * L, 0.12 + 0.36 * L], axis=-1).astype(F32) * (0.45 + 0.75 * ndl[w])[..., None]
    sub = col[w]
    col[w] = sub * (1 - band[..., None]) + metal * band[..., None]
    return col


def draw_core(art, col, alpha):
    cx, cy, cr = art.core
    B = art.B
    w = art.win(cx - cr * 1.6, cy - cr * 1.6, cx + cr * 1.6, cy + cr * 1.6)
    X, Y = art.xy(w)
    dx, dy = X - cx, Y - cy
    r = np.hypot(dx, dy) / cr
    th = np.arctan2(dy, dx)
    cov = np.clip((1 - r) * cr * B + 0.5, 0, 1)
    # a hot centre, red body, a deep rim; faint dark veining across it
    t = np.clip(r, 0, 1)
    c = np.where((t < 0.35)[..., None], CORE_HOT + (CORE_RED - CORE_HOT) * (t / 0.35)[..., None],
                 CORE_RED + (CORE_DEEP - CORE_RED) * (np.clip((t - 0.35) / 0.65, 0, 1) ** 1.4)[..., None])
    vein = np.clip(1 - np.abs(np.sin(th * 3 + r * 5.0)) * 6, 0, 1) * np.clip((r - 0.3) * 3, 0, 1) * 0.45
    c = c * (1 - vein[..., None])
    # a glint on the orb
    hl = np.exp(-(((dx / cr + 0.35) ** 2 + (dy / cr + 0.4) ** 2) / 0.03))
    c = c + np.array([1.0, 0.9, 0.9], F32) * (hl * 0.35)[..., None]
    # a dark socket lip round it
    lip = np.clip(1 - np.abs(r - 1.12) / 0.12, 0, 1) * 0.85
    sub = col[w]
    sub = sub * (1 - lip[..., None]) + np.array([0.02, 0.012, 0.02], F32) * lip[..., None]
    col[w] = sub * (1 - cov[..., None]) + c * cov[..., None]
    return col, alpha


def pulse_layers(art, G, PANE, cc, OC, OH, VC, VT, VK, alpha):
    """The runtime pulse layers at output size (float RGB, additive light): the organs' light seen through the panes,
    and the veins' light in three bands by path length from the heart."""
    S, B = art.S, art.B
    tint = (0.35 + 2.3 * cc) * PANE[..., None]   # light through the pane's colour
    a_d = down(alpha, S)
    tint_d = np.stack([down(tint[..., c], S) for c in range(3)], -1)
    oc_d = down(OC * (0.6 + 0.4 * OH), S)
    # the organs' light: the flesh itself (crimson) and a spill into the panes round it
    spill = gblur(oc_d, max(1.0, S / 110))
    org = np.array([1.0, 0.09, 0.14], F32) * np.clip(oc_d, 0, 1)[..., None] * 0.9
    org += tint_d * np.clip(spill * 1.2, 0, 1)[..., None] * 0.5
    # the veins' light, split in three bands by path length from the heart (normalised per frame; read on the veins
    # and carried into their halo, so a band's light never cuts across a vein's width)
    vc_d = np.clip(down(VC, S), 0, 1)
    vk_d = np.clip(down(VK * VC, S), 0, 1)
    on = VT[VC > 0.5]
    tmax = float(np.quantile(on, 0.97)) if on.size else 1.0
    halo = gblur(vc_d, 1.2)
    tn = gblur(down(VT * VC, S), 1.2) / np.maximum(halo, 1e-4) / max(tmax, 1e-3)
    g_d = down(G, S)
    vein_col = np.array([1.0, 0.12, 0.20], F32)
    light = vein_col[None, None, :] * (vc_d * 0.55 + vk_d * 0.6)[..., None]
    # through glass the vein light takes the pane's colour a little
    light = light * (1 - g_d[..., None] * 0.35) + tint_d * (vc_d * g_d * 0.25)[..., None]
    light += vein_col * (halo * 0.2)[..., None]
    light *= ((halo > 0.003) * a_d)[..., None]
    bands = []
    for k in range(3):
        # hat weights over the normalised path length (a partition of unity)
        c = (k + 0.5) / 3
        wk = np.clip(1 - np.abs(tn - c) * 3, 0, 1)
        if k == 0:
            wk = np.where(tn < c, 1, wk)
        if k == 2:
            wk = np.where(tn > c, 1, wk)
        bands.append(light * wk[..., None])
    return dict(organs=org * a_d[..., None], veins=bands)


def balance(img):
    """Centre the content's bounding box on the frame centre (the heart) with four all-but-transparent pixels (alpha 1):
    the game crops a frame to its content box and turns it about that box's centre (shipImageMetrics), so a hull that is
    not mirror-symmetric would otherwise pivot off its heart. They add 4 to the content count: the drawn size is unchanged."""
    S = img.shape[0]
    ys, xs = np.nonzero(img[..., 3] > 0)
    c = S // 2
    m = max(c - xs.min(), xs.max() - c, c - ys.min(), ys.max() - c)
    m = min(m, c - 1)
    for (y, x) in ((c, c - m), (c, c + m), (c - m, c), (c + m, c)):
        if img[y, x, 3] == 0:
            img[y, x] = (6, 4, 8, 1)
    return img


def fix_markers(img):
    """No pixel in a marker colour (pure blue / pure yellow), no opaque black."""
    r, g, b, a = (img[..., i].astype(np.int32) for i in range(4))
    vis = a > 0
    blue = vis & (r == 0) & (g == 0) & (b == 255)
    yel = vis & (r == 255) & (g == 255) & (b == 0)
    img[blue, 2] = 254
    img[yel, 1] = 254
    black = (a == 255) & (r == 0) & (g == 0) & (b == 0)
    img[black, 0] = 2
    img[black, 1] = 1
    img[black, 2] = 3
    return img


# ---------------------------------------------------------------------------------------------------------------
# Pulse-layer atlases
# ---------------------------------------------------------------------------------------------------------------

def layer_rgba(light):
    """An additive light layer as straight-alpha RGBA: alpha = intensity (max channel), colour = light / intensity."""
    inten = np.clip(light.max(-1), 0, 1)
    colour = light / np.maximum(inten[..., None], 1e-4)
    out = np.zeros(light.shape[:2] + (4,), F32)
    out[..., :3] = np.clip(colour, 0, 1)
    out[..., 3] = inten
    out[out[..., 3] < 2 / 255] = 0
    return out


def pack_atlas(layers):
    """Crop each layer to its content and pack them in a column. Returns (atlas uint8, rects [(x, y, w, h, dx, dy)])."""
    crops = []
    for L in layers:
        a = L[..., 3]
        ys, xs = np.nonzero(a > 0)
        if len(ys) == 0:
            crops.append((np.zeros((1, 1, 4), F32), 0, 0))
            continue
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        y0, x0 = max(0, y0 - 1), max(0, x0 - 1)
        y1, x1 = min(L.shape[0], y1 + 1), min(L.shape[1], x1 + 1)
        crops.append((L[y0:y1, x0:x1], int(x0), int(y0)))
    W = max(c[0].shape[1] for c in crops)
    Hh = sum(c[0].shape[0] + 2 for c in crops)
    atlas = np.zeros((Hh, W, 4), F32)
    rects = []
    y = 0
    for (c, dx, dy) in crops:
        h, w = c.shape[:2]
        atlas[y:y + h, 0:w] = c
        rects.append((0, y, w, h, dx, dy))
        y += h + 2
    a8 = np.round(np.clip(atlas, 0, 1) * 255).astype(np.uint8)
    # loadShipArt paints marker-coloured pixels out: keep none
    return fix_markers(a8), rects


# ---------------------------------------------------------------------------------------------------------------
# Designs
# ---------------------------------------------------------------------------------------------------------------

TAU = 2 * math.pi


def spiral_pts(r0, r1, th0, sweep, n=28, ease=1.0, wobble=0.0):
    pts = []
    for i in range(n):
        s = i / (n - 1)
        r = lerp(r0, r1, s)
        th = th0 + sweep * s ** ease + wobble * math.sin(s * math.pi)
        pts.append(polar(r, th))
    return pts


def taper(n, r0, r1, bulge=0.0, at=0.35, tip=1.0):
    out = []
    for i in range(n):
        s = i / (n - 1)
        r = lerp(r0, r1, s ** tip) + bulge * math.exp(-((s - at) / 0.22) ** 2)
        out.append(max(0.6, r))
    return out


def three(fn):
    for k in range(3):
        fn(k, k * TAU / 3)


def design_escort(a):
    """The Thorn-seed: a compact, fat trefoil seed, a window in each lobe, three short hooked thorns."""
    a.blend = 4.0
    a.cell, a.lead = 5.5, 0.55
    a.hub(0, 0, 40, lobes=3, amp=0.24, height=18, ribs=('chevron', 4.2, 0.6, 1.5))

    def lobe(k, th):
        pts = spiral_pts(40, 66, th + 0.1, 0.55, n=14, ease=1.6)
        a.arm(pts, taper(14, 9.5, 0.9, tip=0.75), hk=0.6, ribs=(3.4, 0.5, 1.1))
        cx, cy = polar(27, th)
        a.ellipse(cx, cy, 11.5, 8.5, ang=th + math.pi / 2, height=4, hbase=12, glass=0.86, k=3)
        a.seeds_rose(cx, cy, [(6.0, 6, 0.5)], sym=3, jitter=0.15)
        a.organ(cx, cy, 6.6, 4.6, ang=th + math.pi / 2 + 0.3, hot=1.0)
        a.trunk([polar(r, th + math.pi / 3 + 0.05 * math.sin(r)) for r in range(6, 44, 2)], 1.3, 0.5, 0, wobble=0.7,
                every=(5, 9), blen=(5, 10))
        a.trunk(pts[:11], 1.0, 0.5, 30, wobble=0.4, every=(6, 9), blen=(3, 6))
    three(lobe)
    a.glass_disc(0, 0, 9)
    a.seeds_rose(0, 0, [(5.8, 6, 0)])
    a.set_core(0, 0, 4.6)
    a.inlay(0, 0, 5.5, 7.4)


def design_frigate(a):
    """The Triskel: three long spiral arms, fusiform, a window along each spine."""
    a.blend = 5.0
    a.cell, a.lead = 6.5, 0.55
    a.hub(0, 0, 22, lobes=3, amp=0.14, phase=math.pi / 3, height=12, ribs=('spiral', 24, -0.6, 1.1))

    def arm(k, th):
        pts = spiral_pts(10, 93, th, 1.55, n=34, ease=1.15)
        rad = taper(34, 13.5, 1.1, bulge=4.5, at=0.33, tip=1.1)
        a.arm(pts, rad, hk=0.7, ribs=(5.5, 0.75, 1.5), glass=(0.13, 0.66, 0.62))
        for (i, rx, ry, hot) in ((10, 7.2, 4.2, 1.0), (17, 5.0, 3.0, 0.8)):
            x, y = pts[i]
            x2, y2 = pts[i - 2]
            a.organ(x, y, rx, ry, ang=math.atan2(y - y2, x - x2), hot=hot)
        a.trunk(pts[:30], 1.5, 0.45, 0, wobble=1.2, every=(4, 8), blen=(4, 9), spread=1.0)
        for (x, y) in pts[3:24]:
            a.seeds.append((x + a.rng.uniform(-2, 2), y + a.rng.uniform(-2, 2)))
            a.seeds.append((x + a.rng.uniform(-6, 6), y + a.rng.uniform(-6, 6)))
    three(arm)
    a.glass_disc(0, 0, 12)
    a.seeds_rose(0, 0, [(7.5, 6, 0.5)])
    a.set_core(0, 0, 5.0)
    a.inlay(0, 0, 6.0, 8.0)


def design_destroyer(a):
    """The Trident-bloom: three arms that fork into two prongs, a stained-glass wing stretched between each pair."""
    a.blend = 4.5
    a.cell, a.lead = 7.0, 0.55
    a.hub(0, 0, 27, lobes=3, amp=0.1, phase=math.pi / 3, height=14, ribs=('spiral', 27, 0.7, 1.3))

    def fork(k, th):
        stem = spiral_pts(14, 46, th, 0.2, n=11)
        a.arm(stem, taper(11, 11.5, 8.5), hk=0.75, ribs=(4.4, 0.6, 1.6))
        fx, fy = stem[-1]
        pa = [(fx, fy)] + [(fx + q[0], fy + q[1]) for q in arc_pts(64, th + 0.2 - 0.78, 0.55, n=17)]
        pb = [(fx, fy)] + [(fx + q[0], fy + q[1]) for q in arc_pts(56, th + 0.2 + 0.74, 0.4, n=15)]
        a.arm(pa, taper(len(pa), 7.0, 0.9, tip=0.9), hk=0.7, ribs=(3.6, 0.4, 1.2))
        a.arm(pb, taper(len(pb), 6.5, 0.9, tip=0.9), hk=0.7, ribs=(3.6, 0.4, 1.2))
        # the wing: from the fork along both prongs, a scalloped trailing edge between their tips
        ea = pa[1:15]
        eb = pb[1:13]
        tip_a, tip_b = ea[-1], eb[-1]
        mid = ((tip_a[0] + tip_b[0]) / 2, (tip_a[1] + tip_b[1]) / 2)
        inward = (fx - mid[0], fy - mid[1])
        sc = []
        for i in range(1, 16):
            t = i / 16
            sag = 0.2 * math.sin(t * math.pi) + 0.06 * abs(math.sin(t * 3 * math.pi))
            sc.append((lerp(tip_a[0], tip_b[0], t) + inward[0] * sag, lerp(tip_a[1], tip_b[1], t) + inward[1] * sag))
        poly = [(fx, fy)] + ea + sc + eb[::-1]
        a.membrane(poly, height=1.5, hbase=1.0)
        a.ellipse(fx, fy, 10.5, 9.5, ang=th, height=5, hbase=9, glass=0.72, k=3, ribs=(12, 1.0))
        a.organ(fx, fy, 6.2, 5.0, ang=th, hot=1.0)
        a.seeds_jitter(7.0, min(p[0] for p in poly), min(p[1] for p in poly), max(p[0] for p in poly), max(p[1] for p in poly))
        # wing veins: from the fork out across the membrane like an insect's wing
        for j in range(5):
            ang = th + 0.2 - 0.5 + j * 0.25
            a.vein_tree(fx, fy, ang, 75, 1.2, 40, curl=0.07, branch=0.07, maxdepth=2, region='hull')
        a.trunk(stem, 1.4, 1.0, 0, wobble=0.8, every=(6, 10), blen=(4, 8))
    three(fork)
    a.glass_disc(0, 0, 12.5, amp=0.1, phase=math.pi / 3)
    a.seeds_rose(0, 0, [(7, 6, 0.5)])
    a.set_core(0, 0, 5.2)
    a.inlay(0, 0, 6.2, 8.4)


def design_cruiser(a):
    """The Lantern: a Reuleaux body, a great lancet window down each lobe under herringbone ribs, horns at the corners."""
    a.blend = 6.0
    a.cell, a.lead = 7.5, 0.65
    a.hub(0, 0, 98, lobes=3, amp=0.17, phase=0, height=26, ribs=('chevron', 9.0, 0.65, 2.8))

    def lobe(k, th):
        pts = spiral_pts(104, 132, th, 0.3, n=10, ease=1.4)
        a.arm(pts, taper(10, 10, 1.0), hk=0.6, ribs=(4.0, 0.4, 1.0))
        a.glass_lancet(0, 0, th, 18, 100, 34, point=0.42)
        for i, (r, rx, ry) in enumerate(((36, 12, 8.5), (59, 10.5, 7.5), (80, 7.5, 5.5))):
            x, y = polar(r, th + (0.04 if i % 2 else -0.04))
            a.organ(x, y, rx, ry, ang=th + math.pi / 2 + a.rng.uniform(-0.3, 0.3), hot=1.0 - i * 0.15)
        a.trunk([polar(r, th) for r in range(8, 102, 3)], 2.0, 0.6, 0, wobble=2.5, every=(5, 9), blen=(6, 14), spread=1.1)
        # the valley between lobes: a porthole with one organ, a vein along the seam to the horn
        vx, vy = polar(66, th + math.pi / 3)
        a.ellipse(vx, vy, 10, 8, ang=th + math.pi / 3, height=4, hbase=22, glass=0.8, k=3)
        a.organ(vx, vy, 6, 4.5, ang=th + math.pi / 3 + 0.5, hot=0.9)
        a.seeds_rose(vx, vy, [(5.5, 6, 0.25)], jitter=0.2)
        a.trunk([polar(r, th + math.pi / 3 + 0.03 * math.sin(r / 7)) for r in range(14, 90, 3)], 1.4, 0.5, 0, wobble=1.5,
                every=(7, 12), blen=(6, 14))
    three(lobe)
    a.glass_disc(0, 0, 17)
    a.seeds_rose(0, 0, [(9.5, 6, 0.5)])
    a.seeds_jitter(7.5, -100, -100, 100, 100, jitter=0.36)
    a.set_core(0, 0, 7.5)
    a.inlay(0, 0, 9.0, 12.5)


def design_capitalship(a):
    """The Cathedral: a great rose window ringed by gills, three long buttress arms with lancets, three short spurs."""
    a.blend = 7.0
    a.cell, a.lead = 7.5, 0.65
    a.hub(0, 0, 66, lobes=6, amp=0.06, phase=0, height=26, ribs=('spiral', 42, 0.5, 1.6))

    def arm(k, th):
        pts = spiral_pts(48, 162, th, 0.42, n=30, ease=1.3)
        rad = taper(30, 27, 3.0, bulge=5, at=0.3, tip=1.0)
        a.arm(pts, rad, hk=0.75, ribs=(6.0, 0.8, 1.9), glass=(0.18, 0.62, 0.58), hbase=4, ridge_spine=0.08)
        for (i, rx, ry, hot) in ((8, 11, 7.5, 1.0), (13, 8.5, 6, 0.9), (17, 6, 4, 0.75)):
            x, y = pts[i]
            x2, y2 = pts[i - 2]
            a.organ(x, y, rx, ry, ang=math.atan2(y - y2, x - x2) + a.rng.uniform(-0.25, 0.25), hot=hot)
        for (x, y) in pts[4:20]:
            for _ in range(3):
                a.seeds.append((x + a.rng.uniform(-9, 9), y + a.rng.uniform(-9, 9)))
        a.trunk(pts[:27], 2.4, 0.6, 30, wobble=2.0, every=(5, 9), blen=(6, 16), spread=1.1)
        spur = spiral_pts(52, 118, th + math.pi / 3, 0.3, n=18, ease=1.2)
        a.arm(spur, taper(18, 13, 1.2, tip=0.9), hk=0.7, ribs=(4.6, 0.6, 1.3))
        a.trunk(spur[:15], 1.3, 0.5, 30, wobble=0.8, every=(6, 10), blen=(4, 8))
    three(arm)
    a.glass_disc(0, 0, 50, lobes=6, amp=0.04)
    a.seeds_rose(0, 0, [(11, 6, 0.5), (21, 12, 0), (31, 18, 0.5), (41, 24, 0), (48.5, 30, 0.5)], sym=3, jitter=0.08)
    for k in range(6):
        th = k * TAU / 6
        big = k % 2 == 0
        x, y = polar(26 if big else 33, th + 0.2)
        a.organ(x, y, 10 if big else 6.5, 7 if big else 4.5, ang=th + math.pi / 2 + 0.3, hot=1.0 if big else 0.8)
    for k in range(3):
        th = k * TAU / 3
        a.trunk([polar(r, th + 0.12 * math.sin(r / 9)) for r in range(10, 50, 2)], 2.0, 1.4, 0, wobble=1.2,
                every=(4, 7), blen=(5, 11), region='glass')
    a.set_core(0, 0, 10)
    a.inlay(0, 0, 11.5, 16)


def design_carrier(a):
    """The Hive-ring: a ribbed ring carrying three hangar pods, the heart hung in the hollow middle on three tendons."""
    a.blend = 5.0
    a.cell, a.lead = 7.0, 0.6
    ring = [polar(104, i * TAU / 96) for i in range(97)]
    a.arm(ring, [15.5] * 97, hk=0.8, ribs=(5.5, 0.0, 1.6), hbase=2)
    a.ellipse(0, 0, 20, 20, height=10, hbase=6, glass=0.72, ribs=(18, 1.0))

    def pod(k, th):
        cx, cy = polar(106, th)
        a.ellipse(cx, cy, 38, 28, ang=th + math.pi / 2, height=16, hbase=6, glass=0.66, ribs=(22, 1.4), k=6)
        a.seeds_rose(cx, cy, [(8, 6, 0.5), (16, 12, 0)], sym=3, jitter=0.25)
        for (dx, dy, rx, ry) in ((-11, 0, 8.5, 6.5), (11, 1, 8, 6)):
            ox, oy = rot(dx, dy, th + math.pi / 2)
            a.organ(cx + ox, cy + oy, rx, ry, ang=th + a.rng.uniform(-0.5, 0.5), hot=0.95)
        # spines out of the pod's back
        for s in (-0.16, 0.0, 0.16):
            sp = spiral_pts(128, 150 - abs(s) * 60, th + s, 0.12, n=8)
            a.arm(sp, taper(8, 5, 0.8), hk=0.6, ribs=(3.0, 0.3, 0.6))
        # tendons from the heart to the ring between the pods
        tt = th + math.pi / 3
        ten = spiral_pts(16, 96, tt, 0.35, n=20)
        a.arm(ten, taper(20, 5.5, 3.4), hk=0.7, ribs=(3.2, 0.2, 0.8), hbase=1)
        a.trunk(ten, 1.6, 1.2, 0, wobble=0.5, every=(30, 40), blen=(2, 3))
        a.trunk([polar(104, tt + i * 0.03) for i in range(0, 34)], 1.4, 0.6, 52, wobble=1.0, every=(6, 10), blen=(4, 8))
        a.trunk([polar(104, tt - i * 0.03) for i in range(0, 34)], 1.4, 0.6, 52, wobble=1.0, every=(6, 10), blen=(4, 8))
    three(pod)
    a.seeds_rose(0, 0, [(8, 6, 0)])
    a.organ(0, -9, 5, 3.5, ang=0.3)
    a.organ(*polar(9, TAU / 3), 5, 3.5, ang=0.3 + TAU / 3)
    a.organ(*polar(9, 2 * TAU / 3), 5, 3.5, ang=0.3 + 2 * TAU / 3)
    a.set_core(0, 0, 5.5)


def design_trooptransport(a):
    """The Thrall carrier: a squat body with three bunches of egg sacs, a curled thrall in each."""
    a.blend = 4.0
    a.cell, a.lead = 6.0, 0.5
    a.hub(0, 0, 38, lobes=3, amp=0.18, phase=math.pi / 3, height=17, ribs=('spiral', 30, 0.6, 1.3))

    def bunch(k, th):
        stalk = spiral_pts(28, 70, th, 0.15, n=10)
        a.arm(stalk, taper(10, 12, 8), hk=0.8, ribs=(3.8, 0.5, 1.1), hbase=3)
        sacs = [(70, 0.0, 14.5), (92, -0.13, 12), (90, 0.16, 11.5), (62, -0.42, 11), (60, 0.44, 10.5), (110, 0.02, 10),
                (78, -0.3, 9.5), (79, 0.32, 9.5)]
        for (r, da, rr) in sacs:
            cx, cy = polar(r, th + da)
            ry = rr * a.rng.uniform(0.82, 0.95)
            ang = th + da + a.rng.uniform(-0.6, 0.6)
            a.ellipse(cx, cy, rr, ry, ang=ang, height=rr * 0.75, hbase=4, glass=0.8, ribs=(9, 0.9), k=2.5)
            a.organ(cx, cy, rr * 0.5, rr * 0.38, ang=ang + 0.8, hot=0.65,
                    lobes=[(1, 0.28, a.rng.uniform(0, 6.3)), (2, 0.12, a.rng.uniform(0, 6.3)), (3, 0.06, 0.0)])
            a.seeds_rose(cx, cy, [(rr * 0.55, 6, a.rng.uniform(0, 1))], sym=3, jitter=0.2)
            a.trunk([(lerp(stalk[-3][0], cx, s), lerp(stalk[-3][1], cy, s)) for s in np.linspace(0, 0.7, 8)], 1.1, 0.6, 30,
                    wobble=0.6, every=(40, 50), blen=(2, 3))
        a.trunk(stalk, 1.6, 1.2, 0, wobble=0.6, every=(9, 12), blen=(3, 6))
    three(bunch)
    a.glass_disc(0, 0, 15, amp=0.12, phase=math.pi / 3)
    a.seeds_rose(0, 0, [(8.5, 6, 0.5)])
    for k in range(3):
        x, y = polar(9, k * TAU / 3 + math.pi / 3)
        a.organ(x, y, 4.5, 3.2, ang=k * TAU / 3)
    a.set_core(0, 0, 5.5)
    a.inlay(0, 0, 6.6, 9.0)


def design_construction(a):
    """The Weaver: a small hub with three jointed, kinked arms ending in big hooked pincers."""
    a.blend = 4.0
    a.cell, a.lead = 6.0, 0.55
    a.hub(0, 0, 27, lobes=3, amp=0.12, height=14, ribs=('spiral', 21, -0.8, 1.3))

    def arm(k, th):
        j0 = polar(16, th)
        j1 = polar(48, th + 0.08)
        d2 = th + 0.08 + 0.85
        j2 = (j1[0] + 30 * math.sin(d2), j1[1] - 30 * math.cos(d2))
        d3 = d2 + 0.95
        j3 = (j2[0] + 22 * math.sin(d3), j2[1] - 22 * math.cos(d3))
        a.arm(densify([j0, j1], 3), taper(len(densify([j0, j1], 3)), 9.5, 7.5), hk=0.75, ribs=(3.6, 0.5, 1.4))
        a.arm(densify([j1, j2], 3), taper(len(densify([j1, j2], 3)), 7.0, 5.5), hk=0.75, ribs=(3.4, 0.5, 1.3))
        a.arm(densify([j2, j3], 3), taper(len(densify([j2, j3], 3)), 5.5, 4.5), hk=0.75, ribs=(3.2, 0.5, 1.2))
        for (x, y), rr in ((j1, 9.0), (j2, 7.2)):
            a.ellipse(x, y, rr, rr, height=6, hbase=4, glass=0.55, ribs=(10, 1.0), k=2)
            a.organ(x, y, rr * 0.38, rr * 0.3, hot=0.9)
            a.seeds_rose(x, y, [(rr * 0.33, 3, 0)], sym=3)
        # the pincer: two hooked jaws opening from the last joint
        ex, ey = j3
        a.ellipse(ex, ey, 5.5, 5.5, height=4, hbase=4, k=2, ribs=(8, 0.6))
        c1 = [(ex, ey)] + [(ex + q[0], ey + q[1]) for q in arc_pts(24, d3 - 0.5, 1.6, n=12)]
        c2 = [(ex, ey)] + [(ex + q[0], ey + q[1]) for q in arc_pts(21, d3 + 0.7, -1.5, n=12)]
        a.arm(c1, taper(len(c1), 4.6, 0.7, tip=0.8), hk=0.7, ribs=(2.8, 0.3, 0.8))
        a.arm(c2, taper(len(c2), 4.2, 0.7, tip=0.8), hk=0.7, ribs=(2.8, 0.3, 0.8))
        a.trunk([j0, j1, j2, j3], 1.3, 0.7, 0, wobble=0.5, every=(8, 12), blen=(3, 6))
    three(arm)
    a.glass_disc(0, 0, 14, amp=0.1)
    a.seeds_rose(0, 0, [(8, 6, 0.5)])
    for k in range(3):
        x, y = polar(8.5, k * TAU / 3 + math.pi / 3)
        a.organ(x, y, 4.2, 3.0, ang=k * TAU / 3)
    a.set_core(0, 0, 5.0)
    a.inlay(0, 0, 6.0, 8.0)


def arc_pts(L, ang, bend, n=12):
    """Points along a curve of length L leaving at angle `ang` (0 = up, clockwise) and turning by `bend` rad over its length."""
    pts = []
    x = y = 0.0
    step = L / (n - 1)
    for i in range(n):
        pts.append((x, y))
        a = ang + bend * i / (n - 1)
        x += step * math.sin(a)
        y -= step * math.cos(a)
    return pts[1:]




def design_beacon(a):
    """The Beacon: a stepped tower seen from above (three tiers of gilled black hull, lancets, a great rose window, the
    red eye on top), three great claws round its base and three relay needles between them, beaded with glass nodes."""
    a.blend = 8.0
    a.cell, a.lead = 9.5, 0.75
    a.hub(0, 0, 188, lobes=3, amp=0.11, phase=math.pi / 3, height=30, flat=0.55, ribs=('spiral', 84, 0.35, 2.8))

    def claw(k, th):
        pts = spiral_pts(140, 384, th, 0.62, n=44, ease=1.25)
        rad = taper(44, 48, 4.0, bulge=8, at=0.22, tip=1.0)
        a.arm(pts, rad, hk=0.7, ribs=(9.0, 0.9, 3.2), glass=(0.14, 0.6, 0.5), hbase=8, ridge_spine=0.05)
        for (i, rx, ry, hot) in ((12, 18, 11, 1.0), (18, 14, 9, 0.9), (23, 10, 6.5, 0.8)):
            x, y = pts[i]
            x2, y2 = pts[i - 2]
            a.organ(x, y, rx, ry, ang=math.atan2(y - y2, x - x2) + a.rng.uniform(-0.2, 0.2), hot=hot)
        for (x, y) in pts[5:28]:
            for _ in range(3):
                a.seeds.append((x + a.rng.uniform(-14, 14), y + a.rng.uniform(-14, 14)))
        a.trunk(pts[:40], 3.4, 0.8, 60, wobble=3.0, every=(6, 11), blen=(10, 26), spread=1.1)
        # thorns down the claw's outer edge
        for i in (14, 20, 26, 31, 35):
            x, y = pts[i]
            x2, y2 = pts[i - 1]
            ang = math.atan2(x - x2, -(y - y2)) - math.pi / 2
            base = rad[i] * 0.85
            ox, oy = x + math.sin(ang) * base, y - math.cos(ang) * base
            th_pts = [(ox + q[0], oy + q[1]) for q in [(0.0, 0.0)] + arc_pts(rad[i] * 0.9 + 10, ang, 0.5, n=8)]
            a.arm(th_pts, taper(len(th_pts), 6.5, 0.8, tip=0.8), hk=0.6, ribs=(3.2, 0.3, 0.8), hbase=6)
        # the relay needle between this claw and the next, beaded with glass nodes
        nd = spiral_pts(150, 398, th + math.pi / 3 + 0.08, 0.28, n=36, ease=1.1)
        a.arm(nd, taper(36, 9, 1.4), hk=0.8, ribs=(4.5, 0.2, 1.2), hbase=6)
        for j, i in enumerate((10, 18, 25, 31)):
            x, y = nd[i]
            rr = 12 - j * 2
            a.ellipse(x, y, rr, rr, height=6, hbase=12, glass=0.62, ribs=(12, 1.2), k=2)
            a.organ(x, y, rr * 0.42, rr * 0.36, hot=1.0)
            a.seeds_rose(x, y, [(rr * 0.4, 3, 0)], sym=3)
        a.trunk(nd[:34], 1.8, 0.7, 60, wobble=0.8, every=(14, 20), blen=(4, 8))
    three(claw)
    # tier 2: six lancets round the tower
    a.hub(0, 0, 134, lobes=6, amp=0.03, height=26, hbase=52, flat=0.75, ribs=('spiral', 60, -0.3, 2.4))
    for k in range(6):
        th = k * TAU / 6 + TAU / 12
        a.glass_lancet(0, 0, th, 92, 130, 27, point=0.5)
        x, y = polar(109, th)
        a.organ(x, y, 9, 6.5, ang=th + math.pi / 2, hot=0.9)
        for r in (96, 104, 112, 120, 127):
            for dd in (-0.06, 0.06):
                a.seeds.append(polar(r, th + dd + a.rng.uniform(-0.03, 0.03)))
    # tier 3: the rose window under the eye
    a.hub(0, 0, 88, lobes=3, amp=0.03, height=24, hbase=104, flat=0.55, ribs=('spiral', 36, 0.5, 2.0))
    a.glass_disc(0, 0, 72)
    for k in range(9):
        th = k * TAU / 9
        a.arm([polar(32, th), polar(71, th + 0.08)], [2.6, 2.2], hk=0.8, ribs=(3.0, 0.0, 0.3), hbase=126, noglass=True, k=1.5)
    ring = [polar(32, i * TAU / 48) for i in range(49)]
    a.arm(ring, [3.0] * 49, hk=0.8, ribs=(3.0, 0.0, 0.4), hbase=127, noglass=True, k=1.5)
    a.seeds_rose(0, 0, [(40, 9, 0.5), (52, 18, 0), (63, 27, 0.5)], sym=3, jitter=0.06)
    for k in range(3):
        th = k * TAU / 3 + 0.35
        x, y = polar(51, th)
        a.organ(x, y, 13, 9, ang=th + math.pi / 2, hot=1.0)
        x, y = polar(55, th + TAU / 6)
        a.organ(x, y, 8, 6, ang=th + TAU / 6 + math.pi / 2, hot=0.85)
        a.trunk([polar(r, th - 0.35 + 0.1 * math.sin(r / 8)) for r in range(30, 70, 2)], 2.0, 1.2, 0, wobble=1.0,
                every=(5, 8), blen=(6, 12), region='glass')
        a.trunk([polar(r, th + 0.2 + 0.05 * math.sin(r / 13)) for r in range(70, 190, 3)], 2.2, 1.0, 40, wobble=2.0,
                every=(7, 12), blen=(8, 18))
    a.set_core(0, 0, 26)
    a.inlay(0, 0, 28, 31)


# ---------------------------------------------------------------------------------------------------------------
# The Watchers: a closed seed pod (the body under three plates) whose plates swing open about hinges on the rim
# ---------------------------------------------------------------------------------------------------------------

WATCH = dict(S=700, B=3, Rb=148.0, Rp=156.0, tw=0.6, gap=1.8, hole=10.0, dome=58.0, swing=-math.radians(80), beat=3.6)


def seam_angle(k, r):
    return k * TAU / 3 + WATCH['tw'] * (np.maximum(r, 0) / WATCH['Rp']) ** 1.3


def plate_height(r):
    return WATCH['dome'] * np.clip(1 - (r / WATCH['Rp']) ** 2, 0, 1) ** 0.6


def watcher_plate(a, k):
    """Plate k of the pod: the wedge between seam k and seam k + 1 (spiralling out), domed, fluted along its length
    with growth rings across, three stained-glass ocelli down its middle."""
    W = WATCH
    ext = W['Rp'] * 1.08 + 4
    w = a.win(-ext, -ext, ext, ext)
    X, Y = a.xy(w)
    r = np.hypot(X, Y)
    th = np.arctan2(X, -Y)
    s0 = seam_angle(k, r)
    psi = (th - s0) % TAU
    m = np.where(psi < TAU / 3, np.minimum(psi, TAU / 3 - psi), -np.minimum(psi - TAU / 3, TAU - psi))
    d_ang = W['gap'] - m * r * 0.85
    phi = np.clip(psi / (TAU / 3), 0, 1)
    rp = W['Rp'] * (1 + 0.09 * np.sin(math.pi * phi))
    d = smax(smax(r - rp, d_ang, 3.0), W['hole'] - r, 3.0)
    q = np.clip(r / rp, 0, 1)
    h = W['dome'] * np.clip(1 - q ** 2, 0, 1) ** 0.6 * np.sqrt(np.clip(-d / 7, 0, 1))
    jit = a.rib_noise(X.shape, 60)
    u = phi * 17 + jit * 0.6
    fade = np.clip(m * r / 5, 0, 1) * np.clip((1 - q) * rp / 5, 0, 1) * np.clip((r - W['hole']) / 8, 0, 1)
    ffade = fade * np.clip((r - 24) / 26, 0, 1)
    rib, ribr = a.rib_fields(u, ffade, 2.7, X.shape, 60)
    u2 = r / 11 + jit
    rings = np.sqrt(np.clip(1 - (2 * ((u2 + 0.5) - np.floor(u2 + 0.5)) - 1) ** 2, 0, 1)) * fade * (0.9 + 1.2 * (1 - ffade / np.maximum(fade, 1e-3)))
    a.merge(w, d.astype(F32), h.astype(F32), (rib + rings).astype(F32), (ribr * 0).astype(F32), r.astype(F32), k=2.0)
    mid = lambda rr: seam_angle(k, rr) + TAU / 6
    for (r0, rr) in ((52, 14.0), (93, 18.0), (131, 13.0)):
        ang = float(mid(r0))
        cx, cy = polar(r0, ang)
        hb = float(plate_height(r0))
        a.ellipse(cx, cy, rr, rr * 0.84, ang=ang + math.pi / 2, height=4, hbase=hb + 2, glass=0.78, ribs=(14, 1.3), k=2.0)
        a.organ(cx, cy, rr * 0.52, rr * 0.4, ang=ang + a.rng.uniform(-0.4, 0.4), hot=1.0)
        a.seeds_rose(cx, cy, [(rr * 0.36, 6, a.rng.uniform(0, 1)), (rr * 0.7, 12, 0)], sym=3, jitter=0.12)
    a.trunk([polar(rr, float(mid(rr)) + 0.05 * math.sin(rr / 9)) for rr in range(16, 146, 3)], 2.0, 0.8, 0, wobble=1.6,
            every=(6, 11), blen=(8, 18), spread=1.2)


def watcher_body(a):
    """Under the plates: a great rose window with heavy tracery, ringed by gills, three hinge knuckles on the rim."""
    W = WATCH
    a.blend = 6.0
    a.cell, a.lead = 9.0, 0.7
    a.hub(0, 0, W['Rb'], lobes=3, amp=0.03, height=30, ribs=('spiral', 72, 0.35, 2.4))
    a.glass_disc(0, 0, 113)
    for k in range(12):
        th = k * TAU / 12 + 0.12
        a.arm([polar(24, th), polar(60, th + 0.1), polar(111, th + 0.16)], [2.8, 2.5, 2.2], hk=0.8, ribs=(3.0, 0.0, 0.3),
              hbase=24, noglass=True, k=1.5)
    for (rr, wd) in ((24, 3.2), (60, 2.6), (112, 3.6)):
        ring = [polar(rr, i * TAU / 72) for i in range(73)]
        a.arm(ring, [wd] * 73, hk=0.8, ribs=(3.0, 0.0, 0.4), hbase=25, noglass=True, k=1.5)
    a.seeds_rose(0, 0, [(33, 12, 0.5), (45, 24, 0), (53, 24, 0.5), (70, 36, 0), (84, 36, 0.5), (97, 48, 0), (107, 48, 0.5)],
                 sym=3, jitter=0.07)
    for k in range(3):
        th = k * TAU / 3
        hx, hy = polar(W['Rb'] - 4, float(seam_angle(k, W['Rb'] - 4)))
        a.ellipse(hx, hy, 17, 15, ang=th, height=14, hbase=22, ribs=(16, 1.6), k=4)
        x, y = polar(42, th + 1.0)
        a.organ(x, y, 15, 10.5, ang=th + 1.0 + math.pi / 2, hot=1.0)
        x, y = polar(82, th + 0.35)
        a.organ(x, y, 13, 9, ang=th + 0.35 + math.pi / 2 + 0.3, hot=0.9)
        for dth in (1.3, 1.75):
            x, y = polar(98, th + dth)
            a.organ(x, y, 7.5, 5.5, ang=th + dth + math.pi / 2, hot=0.8)
        a.trunk([polar(r, th + 0.6 + 0.1 * math.sin(r / 7)) for r in range(26, 112, 2)], 2.4, 1.0, 0, wobble=1.4,
                every=(5, 8), blen=(8, 16), region='glass')
        a.trunk([polar(r, th + 1.6 + 0.08 * math.sin(r / 9)) for r in range(26, 112, 2)], 2.0, 0.9, 0, wobble=1.4,
                every=(6, 9), blen=(7, 14), region='glass')
        a.trunk([polar(r, float(seam_angle(k, r)) + 0.1) for r in range(114, 146, 2)], 2.2, 1.6, 90, wobble=0.8,
                every=(8, 12), blen=(5, 9))
    a.set_core(0, 0, 19)
    a.inlay(0, 0, 21, 23.5)


def over(dst, src):
    """Straight-alpha float RGBA `src` over `dst` (both S x S x 4, 0..1)."""
    a = src[..., 3:4]
    da = dst[..., 3:4]
    oa = a + da * (1 - a)
    rgb = (src[..., :3] * a + dst[..., :3] * da * (1 - a)) / np.maximum(oa, 1e-5)
    return np.concatenate([rgb, oa], -1)


def seam_light(S):
    """The light in the pod's three seams (output size, float RGB): a hot line, a soft halo, dimmer toward the rim."""
    W = WATCH
    c = np.arange(S, dtype=F32) + 0.5 - S / 2
    X, Y = np.meshgrid(c, c)
    d = np.full((S, S), 1e4, F32)
    rr = np.hypot(X, Y)
    for k in range(3):
        pts = [polar(r, float(seam_angle(k, r))) for r in np.linspace(W['hole'] - 2, W['Rp'] * 1.02, 60)]
        for i in range(len(pts) - 1):
            ax, ay = pts[i]
            bx, by = pts[i + 1]
            dx, dy = bx - ax, by - ay
            l2 = dx * dx + dy * dy
            t = np.clip(((X - ax) * dx + (Y - ay) * dy) / l2, 0, 1)
            d = np.minimum(d, np.hypot(X - ax - t * dx, Y - ay - t * dy))
    d = np.minimum(d, np.abs(rr - W['hole'] + 1.5))
    inten = (np.clip(1.4 - d, 0, 1) * 0.85 + np.exp(-d / 2.6) * 0.45) * np.clip(1 - rr / (W['Rp'] * 1.1), 0.25, 1)
    return np.array([1.0, 0.16, 0.38], F32)[None, None, :] * inten[..., None]


def plate_swing_reach(img_plate, hinge, swing):
    """Largest distance from the canvas centre any plate pixel reaches over the swing (output px)."""
    S = img_plate.shape[0]
    ys, xs = np.nonzero(img_plate[..., 3] > 8)
    px = xs + 0.5 - S / 2
    py = ys + 0.5 - S / 2
    hx, hy = hinge
    best = 0.0
    for t in np.linspace(0, 1, 9):
        a = swing * t
        c, s = math.cos(a), math.sin(a)
        qx = hx + (px - hx) * c - (py - hy) * s
        qy = hy + (px - hx) * s + (py - hy) * c
        best = max(best, float(np.hypot(qx, qy).max()))
    return best


def build_watcher(src, out, preview=None):
    W = WATCH
    S, B = W['S'], W['B']
    body = Art('watcher-body', S, B)
    body.balance = False
    watcher_body(body)
    body_img, body_fx = render(body, src)
    del body
    plates = []
    for k in range(3):
        a = Art('watcher-plate-%d' % k, S, B)
        a.balance = False
        a.blend = 2.0
        a.cell, a.lead = 7.0, 0.6
        watcher_plate(a, k)
        img, fx = render(a, src)
        plates.append((img, fx))
        del a
    # the pod: the body under the plates at rest, a dim light in the seams
    pod = body_img.astype(F32) / 255
    for (img, fx) in plates:
        pod = over(pod, img.astype(F32) / 255)
    seams = seam_light(S)
    pod[..., :3] = np.clip(pod[..., :3] + seams * 0.35 * (pod[..., 3:4] > 0), 0, 1)
    pod8 = balance(fix_markers(np.round(np.clip(pod, 0, 1) * 255).astype(np.uint8)))
    Image.fromarray(pod8, 'RGBA').save(os.path.join(out, 'watcher.png'), optimize=True)
    Image.fromarray(body_img, 'RGBA').save(os.path.join(out, 'watcher-body.png'), optimize=True)
    hinges = []
    plate_rects = []
    for k, (img, fx) in enumerate(plates):
        ys, xs = np.nonzero(img[..., 3] > 0)
        y0, y1, x0, x1 = int(ys.min()), int(ys.max()) + 1, int(xs.min()), int(xs.max()) + 1
        Image.fromarray(img[y0:y1, x0:x1], 'RGBA').save(os.path.join(out, 'watcher-plate-%d.png' % k), optimize=True)
        hx, hy = polar(W['Rb'] - 4, float(seam_angle(k, W['Rb'] - 4)))
        hinges.append((hx, hy))
        plate_rects.append((x0, y0, x1 - x0, y1 - y0))
        reach = plate_swing_reach(img, (hx, hy), W['swing'])
        print('plate', k, 'reach', round(reach), 'canvas half', S // 2)
    # pulse layers: the body's organs and veins, the seams, each plate's ocelli and veins
    layers = [layer_rgba(body_fx['organs'])] + [layer_rgba(v) for v in body_fx['veins']] + [layer_rgba(seams)]
    for (img, fx) in plates:
        layers.append(layer_rgba(fx['organs'] + sum(fx['veins']) * 0.7))
    atlas, rects = pack_atlas(layers)
    Image.fromarray(atlas, 'RGBA').save(os.path.join(out, 'watcher-fx.png'), optimize=True)
    data = dict(size=S, beat=W['beat'], core=(S / 2, S / 2, 19.0), organs=rects[0], veins=rects[1:4], seams=rects[4],
                swing=W['swing'], plates=[dict(rect=plate_rects[k], hinge=(hinges[k][0] + S / 2, hinges[k][1] + S / 2),
                                               glow=rects[5 + k]) for k in range(3)])
    if preview:
        watcher_preview(preview, body_img, plates, hinges, seams, body_fx)
    return data


def watcher_preview(out_dir, body_img, plates, hinges, seams, body_fx):
    """The pod closed, opening (a third and two thirds) and open, side by side."""
    S = body_img.shape[0]
    frames = []
    for t in (0.0, 0.35, 0.7, 1.0):
        base = Image.fromarray(body_img, 'RGBA')
        canvas = Image.new('RGBA', (S, S), (8, 9, 16, 255))
        canvas.alpha_composite(base)
        for k, (img, fx) in enumerate(plates):
            a = -WATCH['swing'] * t * 180 / math.pi
            hx, hy = hinges[k]
            im = Image.fromarray(img, 'RGBA').rotate(a, resample=Image.BICUBIC, center=(hx + S / 2, hy + S / 2))
            canvas.alpha_composite(im)
        if t == 0:
            arr = np.asarray(canvas).astype(F32) / 255
            arr[..., :3] = np.clip(arr[..., :3] + seams * 0.35, 0, 1)
            canvas = Image.fromarray((arr * 255).astype(np.uint8), 'RGBA')
        frames.append(canvas)
    sheet = Image.new('RGBA', (S * 2, S * 2), (8, 9, 16, 255))
    for i, f in enumerate(frames):
        sheet.alpha_composite(f, ((i % 2) * S, (i // 2) * S))
    sheet.save(os.path.join(out_dir, 'watcher-sheet.png'))


# ---------------------------------------------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------------------------------------------

DESIGNS = {
    'escort': (170, 4, design_escort),
    'frigate': (208, 4, design_frigate),
    'destroyer': (240, 4, design_destroyer),
    'cruiser': (280, 3, design_cruiser),
    'capitalship': (352, 3, design_capitalship),
    'carrier': (320, 3, design_carrier),
    'trooptransport': (256, 4, design_trooptransport),
    'construction': (210, 4, design_construction),
    'beacon': (812, 3, design_beacon),
}

BEATS = {'escort': 1.3, 'frigate': 1.4, 'destroyer': 1.5, 'cruiser': 1.8, 'capitalship': 2.2, 'carrier': 2.0,
         'trooptransport': 1.6, 'construction': 1.5, 'beacon': 5.0}


def inlay_source(dwu):
    """A strip of stock machinery (the shading of a stock hull's middle) for the heart's inlays."""
    p = os.path.join(dwu, 'images', 'units', 'ships', 'family2', 'capitalship.png')
    if not os.path.exists(p):
        return None
    im = Image.open(p).convert('RGBA')
    w, h = im.size
    crop = im.crop((int(w * 0.36), int(h * 0.3), int(w * 0.64), int(h * 0.42)))
    a = np.asarray(crop).astype(F32) / 255
    L = (a[..., :3] @ np.array([0.299, 0.587, 0.114], F32)) * a[..., 3]
    lo, hi = np.quantile(L, 0.05), np.quantile(L, 0.97)
    return np.clip((L - lo) / max(hi - lo, 1e-3), 0, 1).astype(F32)


def build(name, src):
    S, B, fn = DESIGNS[name]
    art = Art(name, S, B)
    fn(art)
    img, fx = render(art, src)
    return art, img, fx


def ts_rect(r):
    x, y, w, h, dx, dy = r
    return '{ x: %d, y: %d, w: %d, h: %d, dx: %d, dy: %d }' % (x, y, w, h, dx, dy)


def write_data(path, frames, watcher):
    out = ['// GENERATED by scripts/beacon-ships.py (do not edit): the Beacon\'s bundled art (public/art/beacon/) —',
           '// per frame its heart (frame px: x, y, radius), its heartbeat period (s) and its pulse layers in <file>-fx.png',
           '// (x, y, w, h in the atlas; dx, dy where the layer sits on the frame); the Watcher\'s plates (watcher-plate-<k>.png',
           '// at dx, dy on the canvas), their hinges (canvas px) and the swing (rad) that opens them. beaconFx.ts reads it.',
           '',
           'export interface BeaconFxRect {',
           '    readonly x: number;',
           '    readonly y: number;',
           '    readonly w: number;',
           '    readonly h: number;',
           '    readonly dx: number;',
           '    readonly dy: number;',
           '}',
           '',
           'export interface BeaconFrameArt {',
           '    /** Frame side (px). */',
           '    readonly size: number;',
           '    readonly core: readonly [number, number, number];',
           '    /** Heartbeat period (s). */',
           '    readonly beat: number;',
           '    readonly organs: BeaconFxRect;',
           '    /** The veins\' light in three bands, from the heart outward. */',
           '    readonly veins: readonly [BeaconFxRect, BeaconFxRect, BeaconFxRect];',
           '}',
           '',
           'export const BEACON_FRAMES: Readonly<Record<string, BeaconFrameArt>> = {']
    for name, d in frames:
        out.append('    %s: {' % name)
        out.append('        size: %d,' % d['size'])
        out.append('        core: [%.1f, %.1f, %.1f],' % d['core'])
        out.append('        beat: %.2f,' % d['beat'])
        out.append('        organs: %s,' % ts_rect(d['organs']))
        out.append('        veins: [%s],' % ', '.join(ts_rect(v) for v in d['veins']))
        out.append('    },')
    out.append('};')
    out.append('')
    out.append('export interface WatcherPlateArt {')
    out.append('    /** Where watcher-plate-<k>.png sits on the canvas (px) and its size. */')
    out.append('    readonly dx: number;')
    out.append('    readonly dy: number;')
    out.append('    readonly w: number;')
    out.append('    readonly h: number;')
    out.append('    /** The hinge it swings about (canvas px). */')
    out.append('    readonly hinge: readonly [number, number];')
    out.append('    /** Its ocelli and veins\' light (in watcher-fx.png; dx, dy on the canvas, at rest). */')
    out.append('    readonly glow: BeaconFxRect;')
    out.append('}')
    out.append('')
    out.append('export interface WatcherArt extends BeaconFrameArt {')
    out.append('    /** The light in the closed pod\'s seams. */')
    out.append('    readonly seams: BeaconFxRect;')
    out.append('    /** The plates\' swing when fully open (rad, screen rotation about each hinge). */')
    out.append('    readonly swing: number;')
    out.append('    readonly plates: readonly [WatcherPlateArt, WatcherPlateArt, WatcherPlateArt];')
    out.append('}')
    out.append('')
    w = watcher
    out.append('export const WATCHER_ART: WatcherArt = {')
    out.append('    size: %d,' % w['size'])
    out.append('    core: [%.1f, %.1f, %.1f],' % w['core'])
    out.append('    beat: %.2f,' % w['beat'])
    out.append('    organs: %s,' % ts_rect(w['organs']))
    out.append('    veins: [%s],' % ', '.join(ts_rect(v) for v in w['veins']))
    out.append('    seams: %s,' % ts_rect(w['seams']))
    out.append('    swing: %.4f,' % w['swing'])
    out.append('    plates: [')
    for p in w['plates']:
        x, y, ww, hh = p['rect']
        out.append('        { dx: %d, dy: %d, w: %d, h: %d, hinge: [%.1f, %.1f], glow: %s },' % (x, y, ww, hh, p['hinge'][0], p['hinge'][1], ts_rect(p['glow'])))
    out.append('    ],')
    out.append('};')
    out.append('')
    with open(path, 'w') as f:
        f.write('\n'.join(out))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dwu', default=os.path.join(GAME, 'public', 'assets', 'dwu'))
    ap.add_argument('--out', default=os.path.join(GAME, 'public', 'art', 'beacon'))
    ap.add_argument('--data', default=os.path.join(GAME, 'src', 'render', 'beaconArtData.ts'))
    ap.add_argument('--preview', default=None)
    ap.add_argument('--only', default=None, help='comma-separated frames (and/or "watcher"); skips writing --data')
    args = ap.parse_args()
    src = inlay_source(args.dwu)
    names = list(DESIGNS) + ['watcher'] if args.only is None else args.only.split(',')
    os.makedirs(args.out, exist_ok=True)
    if args.preview:
        os.makedirs(args.preview, exist_ok=True)
    made = []
    frames = []
    watcher = None
    for name in names:
        if name == 'watcher':
            watcher = build_watcher(src, args.out, args.preview)
            print('watcher', flush=True)
            continue
        art, img, fx = build(name, src)
        Image.fromarray(img, 'RGBA').save(os.path.join(args.out, name + '.png'), optimize=True)
        layers = [layer_rgba(fx['organs'])] + [layer_rgba(v) for v in fx['veins']]
        atlas, rects = pack_atlas(layers)
        Image.fromarray(atlas, 'RGBA').save(os.path.join(args.out, name + '-fx.png'), optimize=True)
        cx, cy, cr = art.core
        frames.append((name, dict(size=art.S, core=(cx + art.S / 2, cy + art.S / 2, cr), beat=BEATS[name],
                                  organs=rects[0], veins=rects[1:4])))
        made.append((name, art, img, fx, rects))
        print(name, img.shape, 'atlas', atlas.shape, 'veins', len(art.veins), 'organs', len(art.organs), flush=True)
    if args.only is None:
        write_data(args.data, frames, watcher)
        print('data', args.data)
    if args.preview and made:
        contact_sheet(args.preview, made)


def contact_sheet(out_dir, made):
    """sheet.png: each frame at full size, at rest and at a beat's peak (the pulse layers added); small.png: every
    frame at in-game sizes (64 / 44 / 30 / 20 px) on a space-dark ground with a few stars."""
    os.makedirs(out_dir, exist_ok=True)
    rows = []
    for name, art, img, fx, rects in made:
        base = img.astype(F32) / 255
        a = base[..., 3:4]
        peak = base[..., :3] * a + fx['organs'] * 0.9 + sum(fx['veins']) * 0.9
        pk = np.concatenate([np.clip(peak / np.maximum(a, 1e-3), 0, 1) * (a > 0), a], -1)
        rows.append((name, Image.fromarray(img, 'RGBA'), Image.fromarray((np.clip(np.nan_to_num(pk), 0, 1) * 255).astype(np.uint8), 'RGBA')))
    # full size, two pairs per row
    cells = []
    for name, im, pk in rows:
        c = Image.new('RGBA', (im.width * 2 + 8, im.height), (6, 7, 12, 255))
        c.alpha_composite(im, (0, 0))
        c.alpha_composite(pk, (im.width + 8, 0))
        cells.append(c)
    W = 2 * max(c.width for c in cells) + 16
    lines, cur, cw = [], [], 0
    for c in cells:
        if cur and cw + c.width > W:
            lines.append(cur)
            cur, cw = [], 0
        cur.append(c)
        cw += c.width + 16
    if cur:
        lines.append(cur)
    sheet = Image.new('RGBA', (W, sum(max(c.height for c in l) + 12 for l in lines)), (6, 7, 12, 255))
    y = 0
    for l in lines:
        x = 0
        for c in l:
            sheet.alpha_composite(c, (x, y))
            x += c.width + 16
        y += max(c.height for c in l) + 12
    sheet.save(os.path.join(out_dir, 'sheet.png'))
    # in-game sizes
    sizes = (64, 44, 30, 20)
    rng = np.random.default_rng(5)
    sm = Image.new('RGBA', (len(rows) * 76 + 10, sum(sizes) + 12 * len(sizes) + 10), (9, 11, 20, 255))
    st = np.asarray(sm).copy()
    for _ in range(140):
        st[rng.integers(st.shape[0]), rng.integers(st.shape[1])] = (150, 150, 170, 255)
    sm = Image.fromarray(st, 'RGBA')
    for i, (name, im, pk) in enumerate(rows):
        y = 6
        for s in sizes:
            t = im.resize((s, s), Image.LANCZOS)
            sm.alpha_composite(t, (6 + i * 76 + (70 - s) // 2, y))
            y += s + 12
    sm.save(os.path.join(out_dir, 'small.png'))
    print('sheet', os.path.join(out_dir, 'sheet.png'))


if __name__ == '__main__':
    main()
