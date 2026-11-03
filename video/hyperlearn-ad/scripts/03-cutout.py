# Key generated characters off their flat white background: flood fill from the border only,
# so interior whites (tees, sneakers) survive. Soft 1px edge, trim to content, PNG with alpha.
import sys, glob, os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

def cut(src, dst, box=None):
    im = Image.open(src).convert('RGB')
    if box: im = im.crop(box)
    a = np.asarray(im).astype(np.int16)
    near = a.min(axis=2) >= 243
    lab, _ = ndimage.label(near)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    bg = np.isin(lab, list(border))
    fg = ~bg
    fg = ndimage.binary_opening(fg, iterations=1)
    keep, n = ndimage.label(fg)
    if n > 1:  # drop specks, keep components above 0.2% of the largest
        sizes = ndimage.sum(fg, keep, range(1, n + 1)); big = sizes.max()
        fg = np.isin(keep, [i + 1 for i, s in enumerate(sizes) if s > big * 0.002])
    alpha = Image.fromarray((fg * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))
    out = im.convert('RGBA'); out.putalpha(alpha)
    bb = alpha.point(lambda v: 255 if v > 8 else 0).getbbox()
    out = out.crop((max(0, bb[0] - 4), max(0, bb[1] - 4), min(im.width, bb[2] + 4), min(im.height, bb[3] + 4)))
    out.save(dst); print(dst, out.size)

os.makedirs('public/cut', exist_ok=True)
for f in sorted(glob.glob('public/gen/*-*.png')):
    cut(f, 'public/cut/' + os.path.basename(f))
# lineup: split into the four standing figures by empty columns
im = Image.open('public/gen/lineup.png').convert('RGB'); a = np.asarray(im).min(axis=2) < 243
cols = a.any(axis=0); runs = []; inside = False
for x, c in enumerate(cols):
    if c and not inside: start = x; inside = True
    if not c and inside: runs.append((start, x)); inside = False
runs = [r for r in runs if r[1] - r[0] > 80]
print('lineup runs', runs)
for name, (x0, x1) in zip(['student', 'worker', 'teacher', 'learner'], runs):
    cut('public/gen/lineup.png', f'public/cut/{name}-stand.png', (max(0, x0 - 20), 0, min(im.width, x1 + 20), im.height))
