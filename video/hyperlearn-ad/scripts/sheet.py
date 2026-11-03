# Contact sheet: python sheet.py VIDEO START END STEP OUT [COLS] [WIDTH]
import sys, subprocess, tempfile, os
from PIL import Image, ImageDraw, ImageFont
v, a, b, step, out = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), sys.argv[5]
cols = int(sys.argv[6]) if len(sys.argv) > 6 else 4; w = int(sys.argv[7]) if len(sys.argv) > 7 else 600
font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 22)
tiles = []; t = a
with tempfile.TemporaryDirectory() as d:
    while t <= b + 1e-6:
        f = os.path.join(d, f'{t:.2f}.png')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{t:.3f}', '-i', v, '-frames:v', '1', '-vf', f'scale={w}:-1', f], check=True)
        im = Image.open(f).convert('RGB'); dr = ImageDraw.Draw(im); dr.rectangle((0, 0, 90, 28), fill='black'); dr.text((6, 2), f'{t:.2f}', fill='yellow', font=font); tiles.append(im); t += step
rows = (len(tiles) + cols - 1) // cols; W, H = tiles[0].size
S = Image.new('RGB', (W * cols, H * rows), 'white')
for i, im in enumerate(tiles): S.paste(im, ((i % cols) * W, (i // cols) * H))
S.save(out, quality=85); print(out, len(tiles))
