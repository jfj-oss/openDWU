"""The Leviathan's old wear and its embedded harpoons (imported by scripts/leviathan-parts.py; Pillow + numpy).

weather(...)  paints the permanent battered hide onto the toned reference picture before it is cut into parts: a faint
              grime mottle, worn (rubbed pale) patches, fine scratches and scrapes, raked and healed scars, abrasions,
              pits, a few barnacle crusts, small chips bitten out of the fin and fluke edges, and the puckered scar
              tissue with dried-blood / rust stains round every harpoon's entry. Everything is subtle and dark (it sits
              in the dark of space) and is painted at the reference's resolution, so the downscale to the parts keeps
              it no sharper than the rest of the hide.
harpoons(...) draws each harpoon (rusted shaft, barbed head, ring / broken end / lashing / shackle) and its trailing
              line or cable at the body texture's scale into one atlas (public/art/leviathan/harpoons.png), and returns
              their placements for leviathanParts.ts. The rig (leviathanRig.ts) pins each one to its part (body rope,
              fin or flukes) and sways the lines.

All randomness comes from fixed seeds: the output is reproducible.
"""
import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SEED = 1851

# Harpoons, in body texture px at rest (head toward +x, y down; the fins and flukes as they lie unrotated). `ang` is
# the direction (degrees) the shaft leaves the hide; `len` its visible length; `head` how much of the barbed head
# shows ('buried': only the barb tips peek out of the scar, 'exposed': half torn out, 'through': driven through a fin,
# the head out past the far edge); `end` the butt (eye ring, broken, rope lashing, cable shackle); `line` an optional
# trailing line (kind, length px).
HARPOONS = [
    dict(part='body', x=440, y=70, ang=-150, len=132, w=6.6, head='buried', end='eye', line=('hemp', 150), bend=0.0),
    dict(part='body', x=612, y=188, ang=106, len=78, w=5.8, head='exposed', end='eye', line=None, bend=0.04),
    dict(part='body', x=585, y=46, ang=-118, len=46, w=5.0, head='buried', end='broken', line=None, bend=0.0),
    dict(part='body', x=232, y=142, ang=140, len=112, w=6.2, head='buried', end='shackle', line=('cable', 170), bend=-0.03),
    dict(part='body', x=104, y=106, ang=-140, len=40, w=4.6, head='buried', end='broken', line=None, bend=0.08),
    dict(part='finL', x=440, y=-60, ang=188, len=96, w=5.6, head='through', end='lashing', line=('hemp', 118), bend=0.0),
    dict(part='fluke', x=-52, y=176, ang=166, len=92, w=5.4, head='buried', end='eye', line=('hemp', 92), bend=0.02),
    dict(part='finR', x=470, y=272, ang=124, len=36, w=4.6, head='buried', end='broken', line=None, bend=0.0),
    dict(part='body', x=690, y=164, ang=64, len=84, w=5.8, head='buried', end='lashing', line=('hemp', 38), bend=0.0),
]

# Colours (dim: they sit on a dark hide in the dark of space).
PALE = np.array([116.0, 122.0, 132.0])
SCAR = np.array([104.0, 108.0, 116.0])
SEAM = np.array([40.0, 42.0, 50.0])
DARK = np.array([8.0, 10.0, 14.0])
WORN = np.array([82.0, 87.0, 96.0])
BLOOD = np.array([46.0, 14.0, 16.0])
BLOOD_DEEP = np.array([20.0, 6.0, 8.0])
RUST_STAIN = np.array([74.0, 40.0, 22.0])
BARNACLE = np.array([128.0, 128.0, 122.0])


def _noise(shape, cell, rng):
    """Smooth value noise in about [-1, 1] with features ~`cell` px."""
    h, w = shape
    small = rng.standard_normal((max(2, int(h / cell) + 3), max(2, int(w / cell) + 3))).astype(np.float32)
    big = np.asarray(Image.fromarray(small, 'F').resize((w + 2 * cell, h + 2 * cell), Image.BICUBIC))[cell: cell + h, cell: cell + w]
    return big / (np.abs(big).max() + 1e-6)


def _seg_dist(px, py, pts):
    """Distance from pixel centres to a polyline and the arc fraction 0..1 of the nearest point."""
    best = np.full(px.shape, np.inf)
    at = np.zeros(px.shape)
    cum = [0.0]
    for (x0, y0), (x1, y1) in zip(pts[:-1], pts[1:]):
        cum.append(cum[-1] + math.hypot(x1 - x0, y1 - y0))
    total = max(cum[-1], 1e-6)
    for j, ((x0, y0), (x1, y1)) in enumerate(zip(pts[:-1], pts[1:])):
        dx, dy = x1 - x0, y1 - y0
        l2 = max(dx * dx + dy * dy, 1e-9)
        t = np.clip(((px - x0) * dx + (py - y0) * dy) / l2, 0, 1)
        d = np.hypot(px - x0 - dx * t, py - y0 - dy * t)
        sel = d < best
        best = np.where(sel, d, best)
        at = np.where(sel, (cum[j] + (cum[j + 1] - cum[j]) * t) / total, at)
    return best, at


class Hide:
    """Paints onto the toned picture (H x W x 3 floats, in place) only where the animal is (cover) and away from the
    glowing spots (avoid)."""

    def __init__(self, tone, cover, avoid):
        self.t = tone
        self.m = np.clip((cover - 0.55) * 3, 0, 1) * (~avoid)
        self.h, self.w = cover.shape

    def box(self, x0, y0, x1, y1):
        x0, y0 = max(0, int(math.floor(x0))), max(0, int(math.floor(y0)))
        x1, y1 = min(self.w, int(math.ceil(x1)) + 1), min(self.h, int(math.ceil(y1)) + 1)
        if x1 <= x0 or y1 <= y0:
            return None
        py, px = np.mgrid[y0:y1, x0:x1]
        return (y0, y1, x0, x1), px + 0.5, py + 0.5

    def blend(self, b, a, col):
        y0, y1, x0, x1 = b
        a = np.clip(a, 0, 1) * self.m[y0:y1, x0:x1]
        t = self.t[y0:y1, x0:x1]
        col = np.asarray(col, dtype=np.float64)
        t += (col - t) * a[..., None]

    def stroke(self, pts, width, col, alpha, soft=0.8, gaps=None):
        """A tapering line along `pts` (half-width `width` px at the middle), alpha-blended in `col`."""
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        r = width + 2
        bx = self.box(min(xs) - r, min(ys) - r, max(xs) + r, max(ys) + r)
        if bx is None:
            return
        b, px, py = bx
        d, at = _seg_dist(px, py, pts)
        w = np.maximum(0.35, width * np.sin(np.pi * np.clip(at, 0.02, 0.98)) ** 0.6)
        a = np.clip((w + soft * 0.5 - d) / soft, 0, 1) * np.minimum(1, w * 1.6)
        if gaps is not None:
            a = a * gaps(at)
        self.blend(b, a * alpha, col)
        return b, d, at, w


def _wander(cx, cy, ang, L, seg, jag, bend, rng):
    pts = []
    for j in range(seg + 1):
        t = j / seg - 0.5
        off = (rng.random() - 0.5) * L * jag + bend * L * (0.25 - t * t)
        pts.append((cx + math.cos(ang) * L * t - math.sin(ang) * off, cy + math.sin(ang) * L * t + math.cos(ang) * off))
    return pts


def weather(tone, alpha, regions, chippable, avoid, to_ref, S, placed):
    """The permanent old wear (see the module doc) and the harpoons' entry scars. `regions`: name -> (boolean mask in
    reference px, grain angle in the reference frame); `chippable`: the fin / fluke area whose edges may be chipped;
    `to_ref(x, y)` maps body texture px to reference px; `placed`: from place(). Returns the new alpha (the chips)."""
    rng = np.random.default_rng(SEED)
    H, W = alpha.shape
    hide = Hide(tone, alpha, avoid)
    animal = alpha > 0.6
    k = 1 / S  # reference px per texture px

    # 1. A faint grime mottle and worn, rubbed-pale patches (with a darker rim where the top layer broke off).
    n1 = _noise((H, W), 60, rng)
    n2 = _noise((H, W), 14, rng)
    grime = 1 - 0.09 * np.clip(n1 + 0.35 * n2, -1, 1)
    tone *= np.where(animal, grime, 1.0)[..., None]
    wear = _noise((H, W), 22, rng) * 0.75 + _noise((H, W), 7, rng) * 0.25
    worn = np.clip((wear - 0.42) / 0.08, 0, 1) * animal
    rim = np.clip(1 - np.abs(wear - 0.40) / 0.035, 0, 1) * animal
    hide.blend((0, H, 0, W), worn * 0.16, WORN)
    hide.blend((0, H, 0, W), rim * 0.18, DARK)

    # Where marks can go: points sampled on the animal, weighted by region.
    ys, xs = np.nonzero(animal & ~avoid)

    def spot():
        i = rng.integers(len(xs))
        x, y = xs[i] + rng.random(), ys[i] + rng.random()
        grain = 0.0
        for name, (mask, ang) in regions.items():
            if mask[int(y), int(x)]:
                grain = ang
        return x, y, grain

    # 2. Fine scratches and scrapes (1-4 parallel lines along the grain; pale where rubbed, a few dark).
    for _ in range(760):
        x, y, g = spot()
        ang = g + (rng.random() - 0.5) * 0.9 + (math.pi / 2 if rng.random() < 0.2 else 0)
        L = (6 + 30 * rng.random() ** 1.5) * k
        lines = 1 + int(rng.random() * 4)
        light = rng.random() < 0.65
        a = (0.1 + 0.16 * rng.random()) if light else (0.22 + 0.25 * rng.random())
        for q in range(lines):
            o = (q - (lines - 1) / 2) * (1.4 + rng.random()) * k * 0.7
            pts = _wander(x - math.sin(ang) * o, y + math.cos(ang) * o, ang, L * (0.6 + 0.4 * rng.random()), 3, 0.1, 0, rng)
            hide.stroke(pts, (0.45 + 0.35 * rng.random()) * k * 0.7, PALE if light else DARK, a)

    # 3. Old raked scars (claws, hull plates, other beasts): 3-5 long parallel healed lines with a dark seam.
    for _ in range(16):
        x, y, g = spot()
        ang = g + (rng.random() - 0.5) * 0.6 + (math.pi / 2 - 0.4 if rng.random() < 0.5 else 0)
        L = (40 + 70 * rng.random()) * k
        n = 3 + int(rng.random() * 3)
        bend = (rng.random() - 0.5) * 0.3
        sp = (3 + 2.5 * rng.random()) * k
        for q in range(n):
            o = (q - (n - 1) / 2) * sp
            pts = _wander(x - math.sin(ang) * o, y + math.cos(ang) * o, ang, L * (0.65 + 0.35 * rng.random()), 8, 0.03, bend, rng)
            gapAt, gapLen = rng.random(), 0.06 + 0.1 * rng.random()
            gaps = lambda t, gA=gapAt, gL=gapLen: np.where(np.abs(t - gA) < gL, 0.0, 1.0)
            wd = (0.9 + 0.5 * rng.random()) * k * 0.75
            hide.stroke(pts, wd * 1.5, SCAR, 0.21, gaps=gaps)
            hide.stroke(pts, wd * 0.5, SEAM, 0.35, gaps=gaps)

    # 4. Healed gashes: single lumpy pale scars with a dark seam and stitch-like cross ridges.
    for _ in range(12):
        x, y, g = spot()
        ang = g + (rng.random() - 0.5) * 1.6
        L = (16 + 34 * rng.random()) * k
        pts = _wander(x, y, ang, L, 6, 0.08, (rng.random() - 0.5) * 0.4, rng)
        wd = (1.6 + 1.0 * rng.random()) * k * 0.75
        hide.stroke(pts, wd, SCAR, 0.3)
        hide.stroke(pts, wd * 0.35, SEAM, 0.45)
        for j in range(int(L / (4 * k))):
            t = (j + 0.5) / max(1, int(L / (4 * k)))
            i = min(len(pts) - 2, int(t * (len(pts) - 1)))
            (x0, y0), (x1, y1) = pts[i], pts[i + 1]
            a2 = math.atan2(y1 - y0, x1 - x0) + math.pi / 2
            cx, cy = x0 + (x1 - x0) * 0.5, y0 + (y1 - y0) * 0.5
            r = wd * 1.6
            hide.stroke([(cx - math.cos(a2) * r, cy - math.sin(a2) * r), (cx + math.cos(a2) * r, cy + math.sin(a2) * r)], 0.45 * k, SCAR, 0.18)

    # 5. Abrasions: small rough patches, lifted pale and broken up, with a few dark specks.
    for _ in range(170):
        x, y, g = spot()
        R = (2 + 6 * rng.random() ** 1.5) * k
        rx = R * (1.3 + rng.random())
        ang = g + (rng.random() - 0.5) * 0.8
        bx = hide.box(x - rx - 1, y - rx - 1, x + rx + 1, y + rx + 1)
        if bx is None:
            continue
        b, px, py = bx
        u = ((px - x) * math.cos(ang) + (py - y) * math.sin(ang)) / rx
        v = (-(px - x) * math.sin(ang) + (py - y) * math.cos(ang)) / R
        d = np.hypot(u, v)
        rough = rng.random(d.shape) > 0.4
        hide.blend(b, np.clip(1 - d, 0, 1) * rough * (0.14 + 0.12 * rng.random()), WORN if rng.random() < 0.75 else DARK)

    # 6. Pits and nicks: tiny dark dots, some with a pale rim.
    for _ in range(650):
        x, y, _g = spot()
        r = (0.5 + 0.7 * rng.random()) * k
        bx = hide.box(x - r - 2, y - r - 2, x + r + 2, y + r + 2)
        if bx is None:
            continue
        b, px, py = bx
        d = np.hypot(px - x, py - y) / r
        if rng.random() < 0.4:
            hide.blend(b, np.clip(1 - np.abs(d - 1.4) / 0.5, 0, 1) * 0.16, PALE)
        hide.blend(b, np.clip(1.2 - d, 0, 1) * (0.3 + 0.25 * rng.random()), DARK)

    # 7. Barnacle crusts: a few clusters of small pale rings near the head's flanks and the fins' leading edges.
    crusts = [(700, 72), (705, 168), (560, 34), (558, 206), (470, -20), (476, 258), (330, 52), (-40, 40)]
    for tx, ty in crusts:
        cx, cy = to_ref(tx, ty)
        for _ in range(10 + int(rng.random() * 10)):
            x = cx + rng.normal() * 6 * k
            y = cy + rng.normal() * 4 * k
            if not (0 <= int(y) < H and 0 <= int(x) < W) or not animal[int(y), int(x)]:
                continue
            r = (0.7 + 0.8 * rng.random()) * k
            bx = hide.box(x - r - 2, y - r - 2, x + r + 2, y + r + 2)
            if bx is None:
                continue
            b, px, py = bx
            d = np.hypot(px - x, py - y) / r
            hide.blend(b, np.clip(1 - np.abs(d - 0.75) / 0.4, 0, 1) * 0.42, BARNACLE)
            hide.blend(b, np.clip(1 - d / 0.45, 0, 1) * 0.5, DARK)

    # 8. Chips bitten out of the fin and fluke edges (away from their roots), a darker scar rim round each.
    newA = alpha.copy()
    edge = animal & ~(np.asarray(Image.fromarray((animal * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3))) > 0)
    ey, ex = np.nonzero(edge & chippable)
    for _ in range(34):
        i = rng.integers(len(ex))
        x, y = ex[i] + 0.5, ey[i] + 0.5
        r = (1.6 + 3.5 * rng.random() ** 1.4) * k
        bx = hide.box(x - r - 3 * k, y - r - 3 * k, x + r + 3 * k, y + r + 3 * k)
        b, px, py = bx
        y0, y1, x0, x1 = b
        # A ragged bite: the radius wobbles with the angle.
        ph = rng.random() * 6.28
        ang = np.arctan2(py - y, px - x)
        rr = r * (1 + 0.25 * np.sin(3 * ang + ph) + 0.15 * np.sin(7 * ang + 2 * ph))
        d = np.hypot(px - x, py - y)
        cut = np.clip((rr - d) / 1.0, 0, 1)
        newA[y0:y1, x0:x1] *= 1 - cut
        hide.blend(b, np.clip(1 - np.abs(d - rr - 1.2 * k) / (1.6 * k), 0, 1) * 0.4, SEAM)

    # 9. The harpoons' entry wounds (and the far side of one driven through a fin).
    srng = np.random.default_rng(SEED + 3)
    for p in placed:
        entry_scar(tone, alpha, p['rx'], p['ry'], p['rang'], k, srng, big=p['w'] / 5, shaft=p['len'] * 0.6)
        if p['far'] is not None:
            entry_scar(tone, alpha, p['far'][0], p['far'][1], p['rang'] + math.pi, k, srng, big=p['w'] / 6)
    return newA


def entry_scar(tone, alpha, x, y, ang_ref, k, rng, big=1.0, shaft=0.0):
    """Puckered scar tissue round a harpoon's entry (ref px), a dark hole, dried blood and rust weeping toward the tail
    (+x in the reference) and along the shaft."""
    hide = Hide(tone, alpha, np.zeros(alpha.shape, bool))
    R = (7 + 2 * rng.random()) * k * big
    # Blood and rust stains first (under the pucker).
    for j in range(3):
        sa = (rng.random() - 0.5) * 0.7
        L = (10 + 14 * rng.random()) * k * big
        pts = [(x, y), (x + L * 0.5 * math.cos(sa), y + L * 0.5 * math.sin(sa) + (rng.random() - 0.5) * 3 * k), (x + L * math.cos(sa), y + L * math.sin(sa))]
        hide.stroke(pts, (1.6 + 1.6 * rng.random()) * k * big, BLOOD, 0.34, soft=2.5 * k)
    pts = [(x, y), (x + math.cos(ang_ref) * R * 1.6, y + math.sin(ang_ref) * R * 1.6)]
    hide.stroke(pts, 2.2 * k * big, RUST_STAIN, 0.3, soft=2 * k)
    if shaft > 0:
        # The shaft's soft shadow on the hide (it leans out of the wound), only where it still lies over the hide.
        L = shaft * k
        ox, oy = 1.8 * k, 2.4 * k
        pts = [(x + ox * t, y + oy * t) for t in (0.3,)] + [(x + math.cos(ang_ref) * L + ox * 2, y + math.sin(ang_ref) * L + oy * 2)]
        hide.stroke(pts, 2.6 * k * big, DARK, 0.32, soft=3 * k)
    bx = hide.box(x - R * 1.6, y - R * 1.6, x + R * 1.6, y + R * 1.6)
    b, px, py = bx
    d = np.hypot(px - x, py - y) / R
    phi = np.arctan2(py - y, px - x)
    n = 9 + int(rng.random() * 5)
    wr = np.sin(n * phi + rng.random() * 6.28 + 2 * np.sin(3 * phi))
    # Bruised dark halo, the raised pale ring with radial wrinkles, the dark hole.
    hide.blend(b, np.clip(1 - np.abs(d - 1.15) / 0.45, 0, 1) * 0.3, BLOOD_DEEP)
    ring = np.clip(1 - np.abs(d - 0.6) / 0.4, 0, 1)
    hide.blend(b, ring * np.clip(wr, 0, 1) * 0.5, SCAR)
    hide.blend(b, ring * np.clip(-wr, 0, 1) * 0.45, SEAM)
    hide.blend(b, np.clip((0.32 - d) / 0.12, 0, 1) * 0.85, BLOOD_DEEP)


# ------------------------------------------------------------------------------------------------------------------
# The harpoon sprites (body texture scale; drawn 4x and box-filtered down).

SS = 4
RUST_DARK = np.array([30.0, 22.0, 20.0])
RUST = np.array([72.0, 43.0, 29.0])
RUST_HI = np.array([120.0, 80.0, 54.0])
STEEL = np.array([72.0, 74.0, 78.0])
IRON_DARK = np.array([34.0, 32.0, 32.0])
OUTLINE = np.array([8.0, 7.0, 8.0])
HEMP = np.array([96.0, 86.0, 66.0])
HEMP_DARK = np.array([46.0, 40.0, 32.0])
CABLE = np.array([88.0, 92.0, 98.0])
CABLE_DARK = np.array([36.0, 38.0, 42.0])


def _poly_mask(shape, polys):
    m = Image.new('L', (shape[1], shape[0]), 0)
    d = ImageDraw.Draw(m)
    for p in polys:
        d.polygon([(float(a), float(b)) for a, b in p], fill=255)
    return np.asarray(m).astype(np.float64) / 255


def _down(rgb, a):
    """SS x SS box filter of straight-alpha rgb + alpha -> uint8 RGBA."""
    h, w = a.shape
    h2, w2 = h // SS, w // SS
    pa = (rgb * a[..., None])[: h2 * SS, : w2 * SS].reshape(h2, SS, w2, SS, 3).mean((1, 3))
    aa = a[: h2 * SS, : w2 * SS].reshape(h2, SS, w2, SS).mean((1, 3))
    col = np.where(aa[..., None] > 1e-4, pa / np.maximum(aa[..., None], 1e-4), 0)
    out = np.dstack([np.clip(col, 0, 255), np.clip(aa * 255, 0, 255)]).round().astype(np.uint8)
    out[aa * 255 < 2] = 0
    return out


def draw_harpoon(spec, gap, rng):
    """One harpoon, local frame: x along the shaft from the entry (0) outward, y across. Returns (RGBA uint8, anchor
    fractions of the entry point, local x of the line's attach point)."""
    L = spec['len']
    hw = spec['w'] / 2
    hl = 7.5 + spec['w'] * 3.6  # head length
    bs = hw * 3.5  # barb half-span
    head = spec['head']
    if head == 'buried':
        h0 = -hl * 0.76
    elif head == 'exposed':
        h0 = -hl * 0.4
    else:  # through: the head out past the fin's far edge, the shaft hidden inside it
        h0 = -(gap + hl + 5)
    end = spec['end']
    ring_r = hw * 1.45
    xmin = min(0.0, h0) - 3
    xmax = L + (ring_r * 2 + 2 if end in ('eye', 'shackle') else 3)
    bend = spec['bend']
    ymax = max(bs, ring_r * 1.4) + abs(bend) * L + 4
    W = int(math.ceil((xmax - xmin) * SS))
    Hh = int(math.ceil(2 * ymax * SS))
    py, px = np.mgrid[0:Hh, 0:W]
    lx = (px + 0.5) / SS + xmin
    ly = (py + 0.5) / SS - ymax
    cy = bend * L * np.clip(lx / L, 0, 1.2) ** 2
    v = (ly - cy) / hw  # across the shaft, -1..1

    shaft_end = np.full(lx.shape, float(L))
    if end == 'broken':
        # A jagged, splayed break.
        jag = np.interp(v, np.linspace(-1.3, 1.3, 9), L - np.array([1, 6, 0.5, 4.5, 0, 5.5, 1.5, 7, 2]) * (0.7 + 0.5 * rng.random()))
        shaft_end = jag
    x_start = h0 + hl * 0.75 if head != 'buried' else 0.0
    # A thin iron shank from the head's socket, then (on the long ones) a ferrule and the thick pole: the harpoon's
    # silhouette, so it does not read as a stick.
    sock0 = h0 + hl * 0.72
    sock_end = max(sock0, 0) + 7
    xs = sock_end + 0.36 * (L - sock_end) if L > 60 else L + 99
    prof = 0.6 + 0.4 * np.clip((lx - xs) / 4, 0, 1)
    taper = prof * (1 + 0.06 * np.sin(lx * 0.9) * (lx > 0))
    ferr = (np.abs(v) < 1.22) & (lx >= xs + 2.5) & (lx <= xs + 7.5)
    if end == 'broken':
        taper = taper + 0.3 * np.clip((lx - (L - 9)) / 9, 0, 1)  # splayed where it snapped
    shaft = (np.abs(v) < taper) & (lx >= x_start) & (lx <= shaft_end)
    # The head's socket and a collar ring.
    sock = (np.abs(v) < 1.05) & (lx >= max(sock0, -0.5)) & (lx <= sock_end)
    collar = (np.abs(v) < 1.2) & (np.abs(lx - sock_end) < 0.7)
    # The barbed head polygon (tip at h0, barbs pointing back toward the shaft).
    poly = [(h0, 0), (h0 + hl * 0.5, -bs * 0.72), (h0 + hl, -bs), (h0 + hl * 0.74, -hw * 1.25), (h0 + hl * 0.9, 0),
            (h0 + hl * 0.74, hw * 1.25), (h0 + hl, bs), (h0 + hl * 0.5, bs * 0.72)]
    polyS = [((x - xmin) * SS, (y + ymax + bend * L * max(0, x / L) ** 2) * SS) for x, y in poly]
    headM = _poly_mask(lx.shape, [polyS]) > 0.5
    ringM = np.zeros(lx.shape, bool)
    if end == 'eye':
        rcx = L + ring_r * 0.9
        d = np.hypot(lx - rcx, ly - bend * L * 1.0)
        ringM = (d < ring_r) & (d > ring_r * 0.5)
    elif end == 'shackle':
        rcx = L + ring_r * 0.8
        d = np.hypot((lx - rcx) / 1.25, ly - bend * L)
        ringM = ((d < ring_r) & (d > ring_r * 0.58)) | ((np.abs(lx - L) < 1.0) & (np.abs(ly - bend * L) < ring_r * 1.3))
    lash = np.zeros(lx.shape, bool)
    if end == 'lashing':
        lash = (np.abs(v) < 1.45) & (lx > L - 13) & (lx < L - 2)
    visible = np.ones(lx.shape, bool)
    if head == 'buried':
        visible = lx >= -0.2
    elif head == 'through':
        visible = (lx >= 0) | (lx <= -gap)
    if head == 'buried':
        headM &= lx >= 0
    metal = (shaft | sock | collar | ferr | headM | ringM) & visible
    allm = metal | (lash & visible)

    # Colour: rust mottle, steel where it flaked, cylindrical shading (lit from above), a highlight down the shaft.
    n1 = _noise(lx.shape, 6 * SS, rng)
    n2 = _noise(lx.shape, 2 * SS, rng)
    streak = np.asarray(Image.fromarray(rng.standard_normal((lx.shape[0] // SS + 2, lx.shape[1] // (5 * SS) + 2)).astype(np.float32), 'F').resize((lx.shape[1], lx.shape[0]), Image.BICUBIC))
    streak = streak / (np.abs(streak).max() + 1e-6)
    m = np.clip(0.5 + 0.5 * n1 + 0.3 * n2 + 0.35 * streak, 0, 1)[..., None]
    col = RUST_DARK + (RUST - RUST_DARK) * np.clip(m * 1.6, 0, 1)
    steel = (_noise(lx.shape, 3 * SS, rng) > 0.55)[..., None]
    col = np.where(steel, STEEL * 0.85, col)
    vv = np.clip(np.abs(v), 0, 1)
    shade = (0.5 + 0.5 * np.sqrt(1 - vv ** 2))[..., None]
    col = col * shade + (RUST_HI - RUST) * np.exp(-((v + 0.35) / 0.25) ** 2)[..., None] * 0.4 * (0.4 + m)
    # A cold glint of worn metal along the top of the shaft, broken where the rust is thick.
    col = col + (STEEL * 0.8) * (np.exp(-((v / np.maximum(taper, 0.5) + 0.45) / 0.16) ** 2) * np.clip(0.9 - m[..., 0] * 1.2, 0, 1))[..., None]
    # The head and socket: darker iron with a ridge.
    hv = np.clip(np.abs(ly - cy) / max(bs, 1), 0, 1)
    hcol = IRON_DARK * (1.25 - 0.5 * hv)[..., None] + RUST * 0.35 * m + (RUST_HI * 0.5) * np.exp(-(((ly - cy)) / 0.6) ** 2)[..., None]
    col = np.where(((lx < xs) & shaft)[..., None], col * 0.55 + IRON_DARK * 0.55 * shade, col)  # the iron shank
    col = np.where((headM | sock | collar | ferr)[..., None], hcol * 0.9 + col * 0.25, col)
    col = np.where(ringM[..., None], IRON_DARK * 1.2 + RUST * 0.4 * m, col)
    if end == 'lashing':
        band = (np.sin((lx * 2.4 + v * 1.4)) > 0)[..., None]
        lc = np.where(band, HEMP, HEMP_DARK) * shade
        col = np.where(lash[..., None], lc, col)
    if end == 'broken':
        # The snapped end: torn, paler metal.
        col = np.where((lx > shaft_end - 1.6)[..., None], STEEL * 1.15 * shade, col)
    # Pitting.
    pits = (rng.random(lx.shape) < 0.02)[..., None]
    col = np.where(pits & metal[..., None], col * 0.55, col)
    # A dark outline (about one texture px) so it separates from the hide and space.
    dil = np.asarray(Image.fromarray((allm * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(2 * SS + 1))) > 0
    outline = dil & ~allm
    rgb = np.where(allm[..., None], col, OUTLINE)
    a = np.where(allm, 1.0, np.where(outline & visible, 0.55, 0.0))
    img = _down(rgb, a)
    ax = -xmin / img.shape[1]
    ay = ymax / img.shape[0]
    attach = L + (ring_r * 1.6 if end in ('eye', 'shackle') else -6 if end == 'lashing' else 0)
    return img, ax, ay, attach


def draw_line(kind, length, rng):
    """A trailing line along x (length px, a few px tall): braided hemp or twisted steel cable, frayed at the free end."""
    Hh = 8
    W = int(length * SS)
    H = Hh * SS
    py, px = np.mgrid[0:H, 0:W]
    x = (px + 0.5) / SS
    y = (py + 0.5) / SS - Hh / 2
    hw = 1.35 if kind == 'hemp' else 1.0
    fr0 = length * (0.8 if kind == 'hemp' else 0.86)
    s = np.clip((x - fr0) / (length - fr0), 0, 1)
    wob = 0.25 * np.sin(x * 0.35 + rng.random() * 6)
    a = np.zeros(x.shape)
    col = np.zeros(x.shape + (3,))
    lo, hi = (HEMP_DARK, HEMP) if kind == 'hemp' else (CABLE_DARK, CABLE)
    strands = 3 if kind == 'hemp' else 4
    for k in range(strands):
        off = (k - (strands - 1) / 2) * (0.0 + 2.8 * s ** 1.2) + 0.3 * np.sin(x * 0.8 + k * 2) * s
        sw = np.where(s > 0, hw * 0.5, hw)
        d = np.abs(y - wob - off) / sw
        cover = np.clip((1 - d) * sw * SS / 2, 0, 1) * np.clip(1 - s ** 1.5 * (0.7 + 0.3 * k / strands), 0, 1)
        if k > 0:
            cover *= s > 0
        a = np.maximum(a, cover)
    # Twist: diagonal bands.
    v = np.clip(np.abs(y - wob) / (hw + 2.8 * s), 0, 1)
    band = 0.5 + 0.5 * np.sin(x * (2.6 if kind == 'hemp' else 3.4) + (y - wob) * 2.2)
    shade = (0.55 + 0.45 * np.sqrt(1 - v ** 2))
    col = (lo + (hi - lo) * band[..., None]) * shade[..., None]
    # Grime and wear along the line, fading in at the attached end.
    col *= (0.85 + 0.15 * _noise(x.shape, 10 * SS, rng))[..., None]
    a *= np.clip(x / 1.5, 0, 1)
    dil = np.asarray(Image.fromarray((a > 0.5).astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(SS + 1))) > 0
    rgb = np.where((a > 0.02)[..., None], col, OUTLINE)
    a = np.where(a > 0.02, a, np.where(dil, 0.4, 0) * (1 - s))
    return _down(rgb, a)


def place(alpha, to_ref, to_tex, S):
    """Resolves each harpoon's entry: its point and shaft angle in the reference, and for one driven through a fin the
    trailing-edge entry, the far edge and the hidden length (texture px) between them."""
    out = []
    for spec in HARPOONS:
        p = dict(spec)
        a = math.radians(spec['ang'])
        rx, ry = to_ref(spec['x'], spec['y'])
        dx, dy = -math.cos(a), math.sin(a)  # the reference is flipped in x
        p['far'] = None
        p['gap'] = 0.0
        if spec['head'] == 'through':
            inside = lambda x, y: alpha[int(round(y)), int(round(x))] > 0.5
            assert inside(rx, ry), spec
            s1 = 0.0
            while inside(rx + dx * s1, ry + dy * s1):
                s1 += 0.5
            s0 = 0.0
            while inside(rx - dx * s0, ry - dy * s0):
                s0 += 0.5
            p['far'] = (rx - dx * (s0 - 2), ry - dy * (s0 - 2))
            # The entry a little inside the (ragged, chipped) trailing edge, so it sits on the fin's flesh.
            rx, ry = rx + dx * (s1 - 5), ry + dy * (s1 - 5)
            p['gap'] = (s0 + s1 - 4) * S
        p['rx'], p['ry'] = rx, ry
        p['rang'] = math.atan2(dy, dx)
        p['ex'], p['ey'] = to_tex(rx, ry)
        out.append(p)
    return out


def harpoons(placed):
    """Draws every harpoon and line; packs them into one atlas. Returns (atlas RGBA uint8, records)."""
    rng = np.random.default_rng(SEED + 7)
    sprites = []
    for spec in placed:
        img, ax, ay, attach = draw_harpoon(spec, spec['gap'], rng)
        line = draw_line(spec['line'][0], spec['line'][1], rng) if spec['line'] else None
        sprites.append((spec, img, ax, ay, attach, line))
    pad = 4
    aw = max(max(s[1].shape[1], s[5].shape[1] if s[5] is not None else 0) for s in sprites) + 2 * pad
    ah = sum(s[1].shape[0] + (s[5].shape[0] + pad if s[5] is not None else 0) + pad for s in sprites) + pad
    atlas = np.zeros((ah, aw, 4), np.uint8)
    y = pad
    out = []
    for spec, img, ax, ay, attach, line in sprites:
        h, w = img.shape[:2]
        atlas[y: y + h, pad: pad + w] = img
        rec = dict(spec=spec, frame=(pad, y, w, h), ax=ax, ay=ay, attach=attach, line=None)
        y += h + pad
        if line is not None:
            lh, lw = line.shape[:2]
            atlas[y: y + lh, pad: pad + lw] = line
            rec['line'] = (pad, y, lw, lh)
            y += lh + pad
        out.append(rec)
    return atlas, out
