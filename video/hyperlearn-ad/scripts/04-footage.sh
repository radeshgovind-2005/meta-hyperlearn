#!/bin/sh
# Genuine production captures (../cl/*.mp4, 2160x1350 CDP screencast of hyperlearn.radesh-govind.com, 2026-11-03).
# One crop (x >= 300 px drops the sidebar with account usage) + one Lanczos 1.9x upscale. Disclosed as upscaled.
set -e
SRC=../cl; OUT=public/captures; mkdir -p $OUT
F="crop=1860:1350:300:0,scale=3534:2565:flags=lanczos,unsharp=5:5:0.35:5:5:0"
seg() { # name source start duration [extra filter]
  ffmpeg -v error -y -ss $3 -i $SRC/$2.mp4 -t $4 -an -vf "$F${5:+,$5}" -r 30 -c:v libx264 -preset slow -crf 10 -pix_fmt yuv444p -g 15 -movflags +faststart $OUT/$1.mp4
  echo "$1 <- $2 @$3 +$4s"
}
seg outline  tour     0.0  1.7
seg cite     sources  8.2  4.4
seg request  mutate   1.5  7.2
seg waitlapse mutate  8.6  62.4 "setpts=PTS/30"
seg result   mutate  70.5 11.5
seg trace    mutate  82.5  5.5
seg answer   practice 4.0  4.2
seg adapted  practice 138.0 8.0
seg share    share    1.0  6.6
