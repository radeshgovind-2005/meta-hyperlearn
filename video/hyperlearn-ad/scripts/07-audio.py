# Original music bed + sound design, synthesised here (no samples, no third-party audio), then the
# final mix: narration + ducked music + accents, loudness-normalised to -16 LUFS / -1 dBTP by ffmpeg.
# Event times mirror src/lib/anim.ts sceneTimes() and src/scenes/AppStory.tsx beats() (same offsets).
import json, math, subprocess, sys
import numpy as np
import soundfile as sf
from scipy.signal import lfilter

SR = 48000
DUR = 30.0
N = int(SR * DUR)
rng = np.random.default_rng(7)  # seeded: every render is identical
nar = json.load(open('src/lib/narration.json'))
L = {l['id']: l for l in nar['lines']}

# ---------- timeline (seconds), mirrored from the picture ----------
paths = L['v2']['start'] - 0.1
reveal = L['v4']['start'] - 0.45
cite = L['v5']['start'] + 0.2
graph = L['v6']['start'] + 0.9
K = 0.78
result = L['v7']['start'] + 1.45
answer = L['v8']['start'] - 0.05
adapted = answer + 1.15
share = adapted + 1.45
branch = L['v8']['end'] - 0.6
end = L['v9']['start'] - 0.35
gap_arrive = L['v3']['start'] - 0.25
swaps = []
for speed, swap_at in zip([0.9, 0.75, 0.62], [0.9, 1.7, 0.5]):
    period = 2 * math.pi / speed
    for j in range(3):
        t0 = swap_at - j * (2 * math.pi / 3) / speed
        for n in range(-3, 4):
            ts = t0 + n * period
            if 0.4 < ts < paths - 0.1: swaps.append(ts)

def note(m): return 440.0 * 2 ** ((m - 69) / 12)
t = np.arange(N) / SR

def env(n, a, r, sustain=True):
    e = np.ones(n)
    ai = max(1, int(a * SR)); ri = max(1, int(r * SR))
    e[:ai] = np.linspace(0, 1, ai)
    e[-ri:] *= np.linspace(1, 0, ri)
    return e

def add(buf, start, sig, gain=1.0):
    i = int(start * SR)
    if i >= len(buf): return
    sig = sig[: len(buf) - i]
    buf[i:i + len(sig)] += sig * gain

def lowpass(x, fc):  # one-pole
    a = math.exp(-2 * math.pi * fc / SR)
    return lfilter([1 - a], [1, -a], x)

def pad(freqs, dur, a=0.6, r=0.9):
    n = int(dur * SR); tt = np.arange(n) / SR; out = np.zeros(n)
    for f in freqs:
        for k, amp in [(1, 1.0), (2, 0.32), (3, 0.12), (4, 0.05)]:
            det = 1 + (rng.random() - 0.5) * 0.004
            out += amp * np.sin(2 * np.pi * f * k * det * tt + rng.random() * 6.28)
    out *= 0.5 + 0.5 * (0.5 + 0.5 * np.sin(2 * np.pi * 0.23 * tt))  # slow breathing
    return out / (len(freqs) * 1.5) * env(n, a, r)

def pluck(f, dur=0.55, bright=1.0):
    n = int(dur * SR); tt = np.arange(n) / SR
    s = np.sin(2 * np.pi * f * tt) + 0.35 * bright * np.sin(4 * np.pi * f * tt) * np.exp(-tt * 9) + 0.12 * np.sin(6 * np.pi * f * tt) * np.exp(-tt * 14)
    return s * np.exp(-tt * 5.5) * env(n, 0.004, 0.05)

def thump(dur=0.35, f0=90):
    n = int(dur * SR); tt = np.arange(n) / SR
    f = f0 * (1 + 1.2 * np.exp(-tt * 30))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 11)

def tick(f=2400, dur=0.09):
    n = int(dur * SR); tt = np.arange(n) / SR
    return (np.sin(2 * np.pi * f * tt) * 0.6 + rng.standard_normal(n) * 0.08) * np.exp(-tt * 70)

def swell(dur=0.9):
    n = int(dur * SR); x = lowpass(rng.standard_normal(n), 900)
    return x * np.sin(np.linspace(0, np.pi, n)) ** 2 * 3.0

# ---------- music ----------
music = np.zeros(N)
D, Fs, A, Cs, B, G, E = 62, 66, 69, 73, 71, 67, 64
chords = [  # (start, end, midi notes)
    (0.0, paths, [D - 12, A - 12, Fs, A, Cs + 12 - 12]),
    (paths, gap_arrive, [B - 24, Fs - 12, D, Fs, A]),
    (gap_arrive, reveal + 0.05, [A - 24, E - 12, B - 12, E, A]),          # suspended: the gap
    (reveal + 0.05, cite, [D - 24, A - 12, Fs, A, Cs, E + 12]),          # reveal: bright
    (cite, graph, [G - 24, D - 12, B - 12, Fs, A]),
    (graph, graph + 2.2, [B - 24, Fs - 12, D, Fs, A]),
    (graph + 2.2, result, [G - 24, D - 12, B - 12, D, Fs]),
    (result, answer, [A - 24, E - 12, Cs, E, A]),
    (answer, share, [B - 24, Fs - 12, D, Fs, B]),
    (share, end, [G - 24, D - 12, B - 12, D, A]),
    (end, DUR, [D - 24, A - 12, Fs, A, Cs, E + 12]),
]
for a, b, notes in chords:
    add(music, a, pad([note(m) for m in notes], b - a + 0.9, a=0.35 if a > 0 else 0.9, r=0.9), 0.55)
beat = 0.6  # 100 BPM
# the world's pulse: low thumps until the gap, silence at the gap
x = 0.15
while x < gap_arrive - 0.2:
    add(music, x, thump(), 0.55 if x < paths else 0.38); x += beat
# arpeggio from the reveal onward, 8th notes; denser under the agents
arp = {  # section → pattern
    'a': [D + 12, Fs + 12, A + 12, Cs + 24 - 12, A + 12, Fs + 12],
    'b': [G + 12, B + 12, D + 24, Fs + 24 - 12, D + 24, B + 12],
    'c': [B + 12, D + 24, Fs + 24, A + 24 - 12, Fs + 24, D + 24],
}
x, i = reveal + 0.55, 0
while x < end + 1.8:
    sect = 'b' if cite <= x < graph or share <= x < end else 'c' if graph <= x < result else 'a'
    pat = arp[sect]
    g = 0.16 if x < graph else 0.2 if x < result else 0.15
    if x > end: g *= max(0, 1 - (x - end) / 1.8)
    add(music, x, pluck(note(pat[i % len(pat)]), 0.5, 0.8), g)
    x += beat / 2; i += 1
x = graph
while x < result - 0.2:  # soft pulse under the agent graph
    add(music, x, thump(0.3, 70), 0.3); x += beat
music[int((DUR - 1.4) * SR):] *= np.linspace(1, 0, N - int((DUR - 1.4) * SR)) ** 1.5
music = lowpass(music, 6500)

# ---------- sound design ----------
sfx = np.zeros(N)
for ts in swaps: add(sfx, ts, thump(0.4, 140) * 0.5 + pluck(note(A + 12), 0.4, 0.3) * 0.25, 0.5)
add(sfx, paths - 0.1, swell(1.1), 0.18)                                   # orbits unroll
add(sfx, gap_arrive, pluck(note(E + 12), 1.4, 0.2), 0.18)                  # pause at the gap
for k, m in enumerate([A, D + 12, Fs + 12]): add(sfx, reveal + 0.1 + k * 0.09, pluck(note(m + 12), 0.9, 1.0), 0.22)  # bridge draws
add(sfx, reveal + 0.42, tick(1800), 0.35)                                 # node pops
add(sfx, L['v4']['start'] + 0.05, pad([note(m) for m in [D, Fs, A, Cs + 12, E + 12]], 1.8, a=0.02, r=1.2), 0.5)  # reveal chord
add(sfx, cite + 0.65, tick(2600), 0.5)                                    # citation click
add(sfx, cite + 1.0, pluck(note(A + 24), 0.5, 0.5), 0.18)                 # source linked
for off in [0.05, 0.6, 0.6, 1.45]: add(sfx, graph + off * K, tick(2000), 0.32)  # nodes light
for k, off in enumerate([1.75, 2.0, 2.25]): add(sfx, graph + off * K, pluck(note([A, Cs + 12, E + 12][k] + 12), 0.35, 0.4), 0.2)  # checks
add(sfx, graph + 3.3 * K, pluck(note(D + 24), 0.6, 0.5), 0.22); add(sfx, graph + 3.3 * K + 0.1, pluck(note(A + 24), 0.8, 0.5), 0.22)  # saved
add(sfx, result - 0.3, swell(0.6), 0.12)
add(sfx, adapted, pluck(note(Fs + 24), 0.5, 0.4), 0.15)
for k in range(3): add(sfx, branch + 0.6 + k * 0.12, pluck(note([D, Fs, A][k] + 24), 0.6, 0.5), 0.18)  # branches
add(sfx, end + 0.6, pluck(note(D + 24), 1.4, 0.4), 0.18)                  # final node pulse

# ---------- narration ----------
voice = np.zeros(N)
for l in nar['lines']:
    v, sr = sf.read(f"public/audio/{l['id']}.wav")
    if v.ndim > 1: v = v.mean(axis=1)
    assert sr == SR
    add(voice, l['start'], v)
# duck music under speech (smoothed envelope, ~-6 dB)
act = np.zeros(N)
for l in nar['lines']: act[int((l['start'] - 0.15) * SR): int((l['end'] + 0.2) * SR)] = 1
act = lowpass(act, 3)

def rms_db(x): return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)
voice_db = rms_db(voice[voice != 0])
gaps = act < 0.5
music *= 10 ** ((voice_db - 9 - rms_db(music[gaps])) / 20)   # between lines the bed sits ~9 dB under the voice
music *= 1 - 0.68 * act                                         # and ducks ~10 dB under speech
sfx *= 10 ** ((voice_db - 13 - rms_db(sfx[np.abs(sfx) > 1e-4])) / 20)
mix_m = voice + music + sfx
# gentle stereo: voice centred, music/sfx slightly widened with a short Haas offset
d = int(0.011 * SR)
bed = music + sfx
L_ch = voice + bed
R_ch = voice + np.concatenate([np.zeros(d), bed[:-d]])
stereo = np.stack([L_ch, R_ch], axis=1)
stereo /= np.max(np.abs(stereo)) * 1.25
sf.write('audio/mix-pre.wav', stereo, SR, subtype='FLOAT')
sf.write('audio/stems-music.wav', music, SR, subtype='FLOAT'); sf.write('audio/stems-sfx.wav', sfx, SR, subtype='FLOAT'); sf.write('audio/stems-voice.wav', voice, SR, subtype='FLOAT')

# two-pass loudnorm → -16 LUFS integrated, -1.5 dBTP ceiling (margin under -1 after AAC)
p = subprocess.run(['ffmpeg', '-hide_banner', '-i', 'audio/mix-pre.wav', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], capture_output=True, text=True)
j = json.loads(p.stderr[p.stderr.rindex('{'):p.stderr.rindex('}') + 1])
af = f"loudnorm=I=-16:TP=-1.5:LRA=11:measured_I={j['input_i']}:measured_TP={j['input_tp']}:measured_LRA={j['input_lra']}:measured_thresh={j['input_thresh']}:offset={j['target_offset']}:linear=true"
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', 'audio/mix-pre.wav', '-af', af + ',aresample=48000', '-c:a', 'pcm_s24le', '-t', '30', 'audio/mix.wav'], check=True)
print('swaps', [round(s, 2) for s in sorted(swaps)])
print('wrote audio/mix.wav')
