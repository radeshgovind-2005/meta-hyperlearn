#!/bin/sh
# Masters (ProRes HQ from Remotion, silent, untagged BT.709 limited range — declared with setparams so ffmpeg 8 does not colour-convert) + audio/mix.wav → delivery MP4s (H.264 High, yuv420p, AAC, faststart),
# thumbnails and captions in deliverables/. Run after the renders in README "Rerender".
set -e
D=deliverables; mkdir -p $D
enc() { # master out
  ffmpeg -v error -y -i "$1" -i audio/mix.wav -map 0:v:0 -map 1:a:0 -t 30 \
    -vf "setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709,format=yuv420p" \
    -c:v libx264 -preset slow -crf 14 -profile:v high -level:v 5.2 -pix_fmt yuv420p -r 30 \
    -x264-params "keyint=60:min-keyint=30" -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
    -c:a aac -b:a 320k -ar 48000 -movflags +faststart "$2"
  echo "wrote $2"
}
[ -f out/master-h.mov ] && enc out/master-h.mov $D/hyperlearn-ad-4k.mp4
[ -f out/master-h-clean.mov ] && enc out/master-h-clean.mov $D/hyperlearn-ad-4k-clean.mp4
[ -f out/master-v.mov ] && enc out/master-v.mov $D/hyperlearn-ad-vertical-4k.mp4
[ -f out/master-v-clean.mov ] && enc out/master-v-clean.mov $D/hyperlearn-ad-vertical-4k-clean.mp4
cp out/hyperlearn-ad.srt $D/hyperlearn-ad.srt
for o in H V; do
  [ -f out/thumb$o.png ] && ffmpeg -v error -y -i out/thumb$o.png -q:v 2 $D/hyperlearn-ad-thumbnail-$(echo $o | tr HV hv).jpg
done
ls -la $D
