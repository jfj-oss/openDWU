#!/usr/bin/env python3
"""The Purifier's escort art (Galactic Threats add-on): the stock Shakturi set recoloured to aged bronze, the planet
destroyer's sister ships, with the wear of warships older than any living empire. Offline build step; the outputs are
our derived art, committed under public/art/purifier/ (src/render/threatArt.ts purifierArtUrl draws them for the
Purifier faction's escorts and its repair station).

    python3 -I scripts/purifier-ships.py [--dwu <DW:U install>] [--out public/art/purifier] [--preview <dir>]

Reads images/units/ships/other/MajorSets/Shakturi/<file>.png and other/planetdestroyer.png from the install (default
public/assets/dwu, the symlink npm run import-assets makes). Needs Python 3 with numpy and Pillow only. Deterministic
(fixed seeds per file).

Per frame:
- the alpha channel is kept exactly (the crop metrics, the drawn size and picking read it), and so is every pure blue
  (0,0,255) / pure yellow (255,255,0) pixel (the thruster and light markers, ambientLayer.ts scanShipMarkers);
- the grey hull is gradient-mapped onto the planet destroyer's own bronze ramp (its saturated pixels' median colour
  per luminance band), a little dulled and darkened, the gold highlights kept on the brightest edges;
- the red running lights become a dim amber ember; other coloured glows are kept, slightly warmed;
- wear (only on the opaque hull, away from the silhouette): dulled / mismatched panels, verdigris in streaks running aft
  and pooled in the recesses, fine pitting, a few broad scorch marks, one to three hull breaches (dark torn holes with
  a lit lip) and a missing plate or two (exposed ribs). Sized for the stock frame sides so the scorches and the patina
  still read when a frame is drawn 20-40 px tall.
"""
import argparse
import os
import zlib

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
FILES = ['frigate', 'destroyer', 'cruiser', 'capitalship', 'carrier', 'trooptransport', 'base_0', 'base_1']
# Wear per frame: (scorches, breaches, missing plates).
WEAR = {
    'frigate': (2, 1, 1),
    'destroyer': (3, 2, 1),
    'cruiser': (3, 2, 2),
    'capitalship': (4, 3, 2),
    'carrier': (3, 2, 2),
    'trooptransport': (2, 1, 1),
    'base_0': (3, 2, 2),
    'base_1': (4, 2, 2),
}
LUM = np.array([0.299, 0.587, 0.114])


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


def value_noise(rng, h, w, cell, stretch_y=1.0):
    """Smooth noise in [0, 1]: a random grid of `cell` px (stretched along y) resized bicubically."""
    gw = max(2, int(np.ceil(w / cell)) + 2)
    gh = max(2, int(np.ceil(h / (cell * stretch_y))) + 2)
    g = Image.fromarray((rng.random((gh, gw)) * 255).astype(np.uint8))
    big = np.asarray(g.resize((w + 2 * cell, h + 2 * cell), Image.BICUBIC)).astype(np.float64) / 255
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


def blur(v, r):
    """Cheap box blur (two passes) of a float image."""
    k = 2 * r + 1
    for axis in (0, 1):
        p = np.pad(v, [(r, r) if a == axis else (0, 0) for a in range(2)], mode='edge')
        c = np.cumsum(p, axis=axis)
        c = np.concatenate([np.zeros_like(np.take(c, [0], axis=axis)), c], axis=axis)
        v = (np.take(c, np.arange(k, c.shape[axis]), axis=axis) - np.take(c, np.arange(0, c.shape[axis] - k), axis=axis)) / k
    return v


def pick_points(rng, cand, n, min_dist):
    ys, xs = np.nonzero(cand)
    pts = []
    if len(ys) == 0:
        return pts
    for _ in range(400):
        if len(pts) >= n:
            break
        i = rng.integers(len(ys))
        p = (int(ys[i]), int(xs[i]))
        if all((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 >= min_dist ** 2 for q in pts):
            pts.append(p)
    return pts


def age_frame(name, src, xs, cols):
    a = np.asarray(src.convert('RGBA')).astype(np.float64)
    h, w = a.shape[:2]
    side = max(h, w)
    rng = np.random.default_rng(zlib.crc32(('purifier:' + name).encode()))
    alpha = a[..., 3]
    rgb = a[..., :3] / 255
    raw = a[..., :3].astype(np.int32)
    marker = (alpha > 0) & (((raw[..., 0] == 0) & (raw[..., 1] == 0) & (raw[..., 2] == 255)) | ((raw[..., 0] == 255) & (raw[..., 1] == 255) & (raw[..., 2] == 0)))
    mx = rgb.max(2)
    mn = rgb.min(2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    lum = rgb @ LUM
    # hue (0..1) for the coloured pixels
    rc, gc, bc = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    dl = np.maximum(mx - mn, 1e-6)
    hue = np.where(mx == rc, ((gc - bc) / dl) % 6, np.where(mx == gc, (bc - rc) / dl + 2, (rc - gc) / dl + 4)) / 6
    coloured = (sat > 0.35) & (mx > 0.15) & ~marker
    red = coloured & ((hue < 0.07) | (hue > 0.9))
    other_glow = coloured & ~red
    hull = (alpha > 0) & ~marker & ~coloured
    solid = (alpha == 255) & ~marker
    depth = depth_inside(alpha == 255, 8)

    # --- panels: blocky mismatched plates (dulled, a few darker / lighter), the value structure kept
    cell = max(4, side // 22)
    gh, gw = h // cell + 2, w // (cell * 2 // 3) + 2
    pg = Image.fromarray((rng.random((gh, gw)) * 255).astype(np.uint8)).resize((gw * (cell * 2 // 3), gh * cell), Image.NEAREST)
    panel = np.asarray(pg).astype(np.float64)[:h, :w] / 255
    panel_f = 1.0 + (panel - 0.5) * 0.16
    v = lum * 0.9 * panel_f
    # aged: highlights compressed (dull, not polished), deep shadows kept
    v = np.where(v > 0.55, 0.55 + (v - 0.55) * 0.75, v)
    bronze = ramp_lookup(xs, cols, np.clip(v, 0, 1))
    grey = np.repeat(v[..., None], 3, axis=2)
    bronze = bronze * 0.85 + grey * 0.15  # a little desaturated: tarnish
    out = rgb.copy()
    out[hull] = bronze[hull]

    # --- verdigris: streaks running aft (+y, the frames are bow-up), pooled in the recesses
    streak = fbm(rng, h, w, max(3, side // 28), stretch_y=4.0)
    blotch = fbm(rng, h, w, max(4, side // 10))
    cols_n = value_noise(rng, 1, w, max(2, side // 40))[0]
    run = np.clip((streak - 0.5) * 4, 0, 1) * np.clip((cols_n[None, :] - 0.35) * 3, 0, 1)
    pool = np.clip((blotch - 0.55) * 4, 0, 1) * np.clip(1.2 - v * 2.2, 0, 1)
    verd_m = np.clip(run * 0.55 + pool * 0.6, 0, 0.7) * (depth >= 2)
    verd_col = np.stack([0.30 + v * 0.35, 0.50 + v * 0.55, 0.42 + v * 0.45], axis=2) * np.clip(v * 1.6 + 0.15, 0, 1)[..., None]
    m = hull[..., None] * verd_m[..., None]
    out = out * (1 - m) + verd_col * m

    # --- scorch marks: broad soot blotches, noise-edged
    ns, nb, npl = WEAR[name]
    soot = np.zeros((h, w))
    for (py, px) in pick_points(rng, solid & (depth >= 4), ns, side * 0.18):
        r = side * rng.uniform(0.06, 0.11)
        yy, xx = np.mgrid[0:h, 0:w]
        # soot trails aft a little
        d = np.sqrt(((xx - px) / r) ** 2 + ((yy - py) / (r * 1.5)) ** 2)
        soot = np.maximum(soot, np.clip(1.1 - d, 0, 1) ** 1.3)
    soot *= 0.6 + 0.6 * fbm(rng, h, w, max(2, side // 30))
    soot = np.clip(soot, 0, 0.85) * (alpha > 0)
    soot_col = np.array([0.07, 0.05, 0.04])
    out = out * (1 - soot[..., None]) + (out * 0.25 + soot_col * 0.75) * soot[..., None]

    # --- pitting: fine dark specks (some 2 px), lighter where the pit catches the light
    pits = (rng.random((h, w)) < 0.035) & solid & (depth >= 2)
    pits2 = pits | (np.roll(pits, 1, axis=1) & (rng.random((h, w)) < 0.4))
    out[pits2] *= 0.55
    lip = np.roll(pits, 1, axis=0) & ~pits2 & solid
    out[lip] = np.minimum(1, out[lip] * 1.18)

    # --- missing plates: exposed ribs in a dark recess, a lit lower edge
    for (py, px) in pick_points(rng, solid & (depth >= 7), npl, side * 0.2):
        ph = int(rng.integers(max(3, side // 40), max(5, side // 22)))
        pw = int(rng.integers(max(3, side // 36), max(5, side // 20)))
        y0, x0 = py - ph // 2, px - pw // 2
        for y in range(y0, y0 + ph):
            for x in range(x0, x0 + pw):
                if 0 <= y < h and 0 <= x < w and solid[y, x] and depth[y, x] >= 3:
                    rib = (x - x0) % 3 == 0
                    out[y, x] = out[y, x] * (0.5 if rib else 0.22)
        for x in range(x0, x0 + pw):
            y = y0 + ph
            if 0 <= y < h and 0 <= x < w and solid[y, x]:
                out[y, x] = np.minimum(1, out[y, x] * 1.35 + 0.04)

    # --- hull breaches: irregular dark holes, a torn lit lip on the upper-left, scorched surround
    for (py, px) in pick_points(rng, solid & (depth >= 7), nb, side * 0.22):
        r = side * rng.uniform(0.018, 0.032) + 1.2
        yy, xx = np.mgrid[0:h, 0:w]
        ang = np.arctan2(yy - py, xx - px)
        jag = 1 + 0.35 * np.sin(ang * 3 + rng.uniform(0, 6.3)) + 0.2 * np.sin(ang * 7 + rng.uniform(0, 6.3))
        d = np.sqrt((yy - py) ** 2 + (xx - px) ** 2) / (r * jag)
        hole = (d < 1) & solid & (depth >= 3)
        rim = (d >= 1) & (d < 1.5) & solid
        burn = (d >= 1) & (d < 2.6) & solid
        out[burn] *= (0.45 + 0.55 * np.clip((d[burn] - 1) / 1.6, 0, 1))[:, None]
        lit = rim & ((xx - px) + (yy - py) < 0)
        out[lit] = np.minimum(1, out[lit] * 1.6 + 0.08)
        inner = hole & (d < 0.55)
        out[hole] = np.array([0.045, 0.03, 0.025])
        out[inner] = np.array([0.02, 0.012, 0.01])

    # --- lights: red running lights -> a dim amber ember; other glows kept, a little warmed
    ember = np.array([1.0, 0.52, 0.16])
    out[red] = ember * (mx[red] * 0.72)[:, None]
    out[other_glow] = out[other_glow] * np.array([1.0, 0.95, 0.88])

    out = np.clip(out, 0, 1)
    res = np.empty_like(a)
    res[..., :3] = np.round(out * 255)
    res[..., 3] = alpha
    # markers exactly as the stock frame (and no accidental new marker colours)
    res[marker, :3] = a[marker, :3]
    r8 = res.astype(np.uint8)
    acc = ~marker & (r8[..., 3] > 0) & (((r8[..., 0] == 0) & (r8[..., 1] == 0) & (r8[..., 2] == 255)) | ((r8[..., 0] == 255) & (r8[..., 1] == 255) & (r8[..., 2] == 0)))
    r8[acc, 2] = np.where(r8[acc, 2] > 0, r8[acc, 2] - 1, 1)
    return Image.fromarray(r8, 'RGBA')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dwu', default=os.path.join(GAME, 'public', 'assets', 'dwu'))
    ap.add_argument('--out', default=os.path.join(GAME, 'public', 'art', 'purifier'))
    ap.add_argument('--preview', default=None)
    args = ap.parse_args()
    ships = os.path.join(args.dwu, 'images', 'units', 'ships', 'other')
    dest = Image.open(os.path.join(ships, 'planetdestroyer.png'))
    xs, cols = bronze_ramp(dest)
    os.makedirs(args.out, exist_ok=True)
    made = []
    for name in FILES:
        src = Image.open(os.path.join(ships, 'MajorSets', 'Shakturi', name + '.png'))
        img = age_frame(name, src, xs, cols)
        img.save(os.path.join(args.out, name + '.png'), optimize=True)
        made.append((name, src, img))
        print(name, img.size)
    if args.preview:
        contact_sheet(args.preview, made, dest)


def contact_sheet(out_dir, made, dest):
    """Stock | bronze at full size, then each bronze frame at in-game sizes (48 / 32 / 20 px), on a space-dark ground."""
    os.makedirs(out_dir, exist_ok=True)
    cellw = 300
    rows = len(made) + 1
    sheet = Image.new('RGBA', (cellw * 2 + 3 * 70 + 40, rows * 290), (8, 9, 14, 255))
    y = 0
    d = dest.convert('RGBA').copy()
    d.thumbnail((280, 280), Image.LANCZOS)
    sheet.alpha_composite(d, (10, y + 5))
    x = cellw * 2 + 20
    for s in (64, 40, 24):
        t = dest.convert('RGBA').resize((s, s), Image.LANCZOS)
        sheet.alpha_composite(t, (x, y + 140 - s // 2))
        x += 70
    y += 290
    for name, src, img in made:
        sheet.alpha_composite(src.convert('RGBA'), (10 + (280 - src.width) // 2, y + (280 - src.height) // 2))
        sheet.alpha_composite(img, (cellw + 10 + (280 - img.width) // 2, y + (280 - img.height) // 2))
        x = cellw * 2 + 20
        for s in (48, 32, 20):
            t = img.resize((s, s), Image.LANCZOS)
            sheet.alpha_composite(t, (x, y + 140 - s // 2))
            x += 70
        y += 290
    sheet.save(os.path.join(out_dir, 'sheet.png'))
    print('sheet', os.path.join(out_dir, 'sheet.png'))


if __name__ == '__main__':
    main()
