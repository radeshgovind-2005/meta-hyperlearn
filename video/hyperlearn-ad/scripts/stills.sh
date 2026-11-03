#!/bin/sh
# scripts/stills.sh <Composition> <prefix> <scale> <seconds...>  → out/stills/<prefix>_<sec>.png + sheet
comp=$1; pre=$2; sc=$3; shift 3
for sec in "$@"; do f=$(python3 -c "print(round($sec*30))"); npx remotion still src/index.ts $comp out/stills/${pre}_$sec.png --frame=$f --scale=$sc --log=error >/dev/null 2>&1 || echo "fail $sec"; done
.venv/bin/python - "$pre" "$@" <<'PY'
import sys
from PIL import Image, ImageDraw, ImageFont
pre=sys.argv[1]; secs=sys.argv[2:]
ims=[Image.open(f'out/stills/{pre}_{x}.png').convert('RGB') for x in secs]
w,h=ims[0].size; cols=4 if w>h else 6; rows=(len(ims)+cols-1)//cols
S=Image.new('RGB',(w*cols,h*rows),'#777'); font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf',22)
for i,(im,x) in enumerate(zip(ims,secs)):
  d=ImageDraw.Draw(im); d.rectangle((0,0,70,26),fill='black'); d.text((4,1),x,fill='yellow',font=font); S.paste(im,((i%cols)*w,(i//cols)*h))
S.save(f'out/stills/sheet_{pre}.jpg',quality=85); print(f'out/stills/sheet_{pre}.jpg')
PY
