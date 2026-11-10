"""Score + foley + voice → out/mix.wav, all timed from events.json (the picture's own event list).
Two resolutions: a hi-fi band (Salamander piano, upright bass pizz, VCSL hi-hat / rim / claps / toms / cymbal, glockenspiel)
is the world; a band-limited pulse wave is the ball. G major, 104 BPM, bar 1 at t = 0.
Shape: solo piano → the ball's three-note motif when it hatches → band on the pull-back → drums drop, true silence, click →
the flight is a glide whose pitch follows the ball's height over a snare roll → full band on the landing → a held chord under the
spotlight → filtered "thinking" groove under the answer → piano and pulse play the theme together → final chord on the wink."""
import os, sys, json
import numpy as np, soundfile as sf, soxr
LIB = os.environ.get('LIB', os.path.expanduser('~/lemo-opuscar'))
sys.path.insert(0, LIB)
from core.audio.sfx import SR, bp, lp, hp, noise, add, compress, limit, click as sclick
from core.audio import sampler as S

HERE = os.path.dirname(os.path.abspath(__file__))
EVJ = json.load(open(os.path.join(HERE, 'events.json'))); E = EVJ['ev']; DUR = EVJ['dur']
rng = np.random.default_rng(7); S.seed(7)
NS = int((DUR + 1.5) * SR)
B = 60 / 104; BAR = 4 * B
def tt(d): return np.arange(int(round(d * SR))) / SR
def db(x): return 10 ** (x / 20)
def first(tp, **kw): return next(e['t'] for e in E if e['type'] == tp and all(e.get(k) == v for k, v in kw.items()))
def all_(tp): return [e for e in E if e['type'] == tp]
def cue(n): return first('cue', n=n)
def snapbar(t): return round(t / BAR) * BAR

# ───────── pixel layer: band-limited pulse
def pulse(f, d, duty=.25, vol=1., att=.003, rel=.04, fr=None):
    t = tt(d); f = np.full(len(t), float(f)) if fr is None else fr[:len(t)]
    ph = np.cumsum(f) / SR; x = np.zeros(len(t))
    for k in range(1, 24):
        m = (f * k) < 16000
        x += m * (np.sin(np.pi * k * duty) / k) * np.cos(2 * np.pi * k * (ph - duty / 2))
    e = np.minimum(1, t / att) * np.clip((d - t) / rel, 0, 1)
    return (x * e * vol * .5).astype(np.float32)
def crush(x, bits=5): q = 2 ** bits; return (np.round(x * q) / q).astype(np.float32)
def nz(d, lo, hi, vol=1., tau=None):
    x = bp(rng.standard_normal(int(d * SR)), lo, hi) * vol
    if tau: x *= np.exp(-tt(d)[:len(x)] / tau)
    return x.astype(np.float32)
hz = S.hz

# ───────── cue points from the picture
T_POP = first('hatch'); T_BORN = T_POP + .55
T_BAND = cue('band'); T_DROP = snapbar(cue('drop')); T_CLICK = cue('click'); T_LAUNCH = first('launch'); T_LAND = first('touch')
FLY = first('fly'); FLY_D = next(e['d'] for e in E if e['type'] == 'fly')
T_SPOT0 = cue('spot'); T_SPOT = first('ding'); T_SIDE = cue('side'); T_OUTRO = cue('outro'); T_FINAL = cue('final')
WIPES = [e['t'] for e in all_('wipe')]; T_WIPE2, T_WIPE3 = WIPES
T_DIVE = first('dive'); T_WINK = first('wink')
T_SEND = first('send')
PROG = [('G2', ['D3', 'G3', 'B3', 'F#4']), ('E2', ['E3', 'G3', 'B3', 'D4']), ('C2', ['E3', 'G3', 'B3', 'C4']), ('D2', ['D3', 'F#3', 'A3', 'C4'])]
def chord_at(t): return PROG[int(np.floor(t / BAR + 1e-6)) % 4]

band = np.zeros((NS, 2), np.float32); chip = np.zeros((NS, 2), np.float32); filt = np.zeros((NS, 2), np.float32)
EVN, FILT, KICKS, KICKS_F = [], [], [], []
def N(t, inst, p, d, v, pan=0., dest=None): (EVN if dest is None else dest).append((t, inst, p, d, v, pan, 1.))
def kick(v=1.):
    d = .32; t = tt(d); f = 52 + 90 * np.exp(-t * 32)
    return (np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / .11) * v * .9 + nz(d, 1500, 5000, .05 * v, .004)[:len(t)]).astype(np.float32)

# ═════ intro: solo piano, then the ball's motif on the hatch
N(0.02, 'piano', 'G2', 2.4, .32, -.1); [N(.05 + j * .03, 'piano', p, 2.4, .3, -.15 + j * .08) for j, p in enumerate(['D3', 'B3', 'F#4', 'A4'])]
ARP = {0: ['G4', 'B4', 'D5', 'F#5'], 1: ['E4', 'G4', 'B4', 'D5'], 2: ['C4', 'E4', 'G4', 'B4'], 3: ['D4', 'F#4', 'A4', 'C5']}
t = BAR
while t < T_BAND - .01:
    bi = int(np.floor(t / BAR + 1e-6)) % 4; n = int(round((t % BAR) / (B / 2)))
    if n % 2 == 0 or t > 2 * BAR: N(t, 'piano', ARP[bi][n % 4], .55, .3 + .14 * min(1, t / T_BAND), -.2)
    if n == 0: N(t, 'piano', chord_at(t)[0][:-1] + '3', 1.8, .34, -.1)
    t += B / 2
for k, p in enumerate(['G5', 'B5', 'D6']): add(chip, pulse(hz(p), .11, .25, .3), T_POP + .08 + k * .085, 1, .15)
for k, p in enumerate(['D6', 'G6']): add(band, S.note('glockenspiel', p, .8, .42), T_BORN - .05 + k * .09, .5, .25)
for k in range(10): tk = T_BAND - 1.2 + k * B / 4; N(tk, 'snare2', 'roll', .2, .08 + .22 * k / 10, .1)

# ═════ grooves (dest=FILT routes a groove through the low-pass)
def groove(t0, t1, lite=False, dest=None):
    K = KICKS if dest is None else KICKS_F
    n0, n1 = int(round(t0 / B)), int(round(t1 / B))
    for n in range(n0, n1):
        t = n * B; bi = n % 4; root, ch = chord_at(t + 1e-3)
        if not lite or bi == 0:
            if bi in (0, 2): K.append((t, .9 if bi == 0 else .7))
            if bi == 2 and not lite: K.append((t + B * .5, .45))
        if bi in (1, 3): N(t, 'snare2', 'stick', .2, .42 if not lite else .3, .08, dest)
        if bi == 3 and not lite: N(t, 'claps', 'group', .3, .32, -.05, dest)
        for h in (0, .5): N(t + h * B, 'hihat', 'closed', .1, .3 if h == 0 else .18, .3, dest)
        N(t, 'jazz_bass', root, .32, .72, 0, dest); N(t + B / 2, 'jazz_bass', root if bi != 3 else S.name(S.midi(root) + 7), .24, .44, 0, dest)
        if bi == 0: [N(t + j * .012, 'piano', p, 1.7, .34, -.15, dest) for j, p in enumerate(ch)]
        else: [N(t + B / 2, 'piano', p, .22, .22, -.15, dest) for p in ch[1:]]
groove(T_BAND, T_DROP)
def fill(w):
    for k, tm in enumerate(['high', 'high', 'low', 'low']): N(w - B + k * B / 4, 'toms', tm, .3, .45 + .1 * k, (k - 1.5) * .3)
    N(w, 'clash', 'crash', 2.2, .42, -.2); KICKS.append((w, 1.))
fill(T_WIPE2)
# drums drop: a held chord, then true silence before the click
T_HUSH = T_CLICK - .8
[N(T_DROP + j * .02, 'piano', p, min(BAR * 1.1, T_HUSH - .5 - T_DROP), .28, -.1) for j, p in enumerate(['C3', 'G3', 'B3', 'E4'])]
N(T_DROP, 'jazz_bass', 'C2', min(BAR * .9, T_HUSH - .6 - T_DROP), .45, 0)
if T_DROP + BAR < T_HUSH - .6: [N(T_DROP + BAR + j * .02, 'piano', p, T_HUSH - .55 - (T_DROP + BAR), .2, -.1) for j, p in enumerate(['D3', 'A3', 'C4', 'E4'])]
# the flight: snare roll crescendo and a soft bowed-vibraphone swell under the glide
for k in range(int(FLY_D / (B / 4))):
    tk = T_LAUNCH + .2 + k * B / 4
    if tk > T_LAND - .05: break
    N(tk, 'snare2', 'roll', .15, .12 + .5 * ((tk - T_LAUNCH) / FLY_D) ** 1.5, .1)
for p in ['G3', 'B3', 'D4']: EVN.append(dict(t=T_LAUNCH + .1, inst='vibraphone_bowed', pitch=p, dur=FLY_D - .1, vel=.32, pan=.1, attack=1.4))
# landing: full band with the theme in the piano's right hand
N(T_LAND, 'clash', 'crash', 2.6, .62, .2); KICKS.append((T_LAND, 1.15)); N(T_LAND, 'jazz_bass', 'G1', .9, .9, 0)
[N(T_LAND + j * .02, 'piano', p, 2.2, .5, -.1 + j * .05) for j, p in enumerate(['G2', 'D3', 'A3', 'B3', 'F#4'])]
for j, p in enumerate(['D6', 'G6', 'B6']): N(T_LAND + .12 + j * B / 4, 'glockenspiel', p, 1.2, .4, .3)
T_STOP = snapbar(T_SPOT0)
groove(T_LAND + B, T_STOP)
THEME = [('D5', 0, .5), ('B4', .5, .5), ('G4', 1, .5), ('A4', 1.5, .5), ('B4', 2, 1), ('D5', 3, 1), ('E5', 4, .5), ('D5', 4.5, .5), ('B4', 5, 1), ('A4', 6, 2)]
def theme(t0, inst='piano', vel=.36, pan=.1, chipvol=0):
    for p, o, d in THEME:
        ts = t0 + o * B
        N(ts, inst, p, d * B * .95, vel, pan)
        if chipvol: add(chip, pulse(hz(p) * 2, d * B * .9, .25, chipvol), ts, 1, .2)
theme(snapbar(T_LAND) + 2 * BAR - 0.0, vel=.3)
# spotlight: drums out, a held chord, room tone shows through
for p in ['C4', 'E4', 'G4', 'B4']: EVN.append(dict(t=T_STOP, inst='vibraphone_bowed', pitch=p, dur=T_WIPE3 - T_STOP - B, vel=.3, pan=0, attack=.6))
N(T_SPOT, 'hand_chimes', 'G5', 2.4, .5, .2); N(T_SPOT + .06, 'hand_chimes', 'D6', 2.4, .42, .25)
N(T_STOP, 'jazz_bass', 'C2', 2 * BAR, .38, 0)
# chat: tom fill, then a filtered "thinking" groove until the sidebar
fill(T_WIPE3)
groove(T_WIPE3, T_SIDE, dest=FILT)
# sidebar → outro: the filter opens, the theme on piano and pulse together
groove(snapbar(T_SIDE), snapbar(T_OUTRO) + 2 * BAR)
T_TH = snapbar(T_OUTRO)
theme(T_TH, vel=.34, chipvol=.16); theme(T_TH + 2 * BAR, vel=.34, chipvol=.18)
T_END = snapbar(T_WINK)
groove(snapbar(T_OUTRO) + 2 * BAR, T_END - BAR, lite=True)
N(T_DIVE - .6, 'sus_cymbal', 'cresc', 1.0, .28, 0)
N(T_WINK, 'clash', 'short', 1.6, .3, -.2); KICKS.append((T_WINK, .9))
N(T_WINK, 'jazz_bass', 'G1', DUR - T_WINK, .7, 0)
for j, p in enumerate(['G2', 'D3', 'A3', 'B3', 'D4', 'F#4', 'A4']): N(T_WINK + j * .025, 'piano', p, DUR - T_WINK, .5, -.15 + j * .05)
for p in ['G3', 'B3', 'D4', 'A4']: EVN.append(dict(t=T_WINK, inst='vibraphone_bowed', pitch=p, dur=DUR - T_WINK, vel=.46, pan=.1, attack=.25))
N(T_WINK + .05, 'hand_chimes', 'G5', DUR - T_WINK, .42, .2); N(T_WINK + .11, 'hand_chimes', 'D6', DUR - T_WINK, .36, .25)
for k, p in enumerate(['D6', 'G6']): add(chip, pulse(hz(p), .16, .25, .2), T_WINK + .1 + k * .1, 1, .2)

bandmix = S.render(EVN, dur=DUR + 1.5); band[:len(bandmix)] += bandmix[:NS]
fm = S.render(FILT, dur=DUR + 1.5)
fm = np.stack([lp(fm[:, c], 1300, 2) for c in (0, 1)], 1).astype(np.float32) * 1.2
filt[:len(fm)] += fm[:NS]
for t0, v in KICKS: add(band, kick(v), t0, .55, 0)
for t0, v in KICKS_F: add(filt, lp(kick(v), 1300).astype(np.float32), t0, .55, 0)
# the flight: pulse glide, pitch follows the ball's height (G6 at launch → G3 at the ground)
d = FLY_D; tl = tt(d); tau = tl * .5; hgt = np.clip(1 - (4.9 * tau ** 2) / 20, 0, 1)
fr = hz('G3') * 2 ** (3 * hgt)
add(chip, pulse(1, d, .25, .3, att=.01, rel=.08, fr=fr), T_LAUNCH, 1, .1)
music = band + filt + chip
music = S.room(music, size=.32, mix=.1)

# ═════ foley
fx = np.zeros((NS, 2), np.float32)
def key(v=.8, heavy=False):
    d = .09; t = tt(d); th = np.sin(2 * np.pi * (165 + rng.uniform(-20, 20)) * t) * np.exp(-t / .018) * .5
    ck = nz(d, 2500, 7000, .5, .006) + nz(d, 900, 2200, .3, .012)
    return ((th + ck[:len(th)]) * v * (1.5 if heavy else 1)).astype(np.float32)
def tick(v=.5, f=2600): t = tt(.05); return (np.sin(2 * np.pi * f * t) * np.exp(-t / .008) * v + nz(.05, 3000, 8000, .15 * v, .004)[:len(t)]).astype(np.float32)
def pop(v=.6, f0=520, f1=980): t = tt(.12); f = f0 * (f1 / f0) ** np.minimum(1, t / .05); return (np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / .035) * v).astype(np.float32)
def swish(d=.35, v=.5, lo=400, hi=4000):
    x = rng.standard_normal(int(d * SR)); t = tt(d)[:len(x)]; e = np.sin(np.pi * t / d) ** 2
    return (bp(x, lo, hi) * e * v).astype(np.float32)
def boom(v=1., f0=90, d=.8): t = tt(d); f = f0 * np.exp(-t * 2.4) + 34; return (np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / .26) * v * .5).astype(np.float32)
SCALE = ['G5', 'A5', 'B5', 'C6', 'D6', 'E6', 'F#6', 'G6', 'A6', 'B6', 'C7', 'D7']
for e in E:
    t0, tp = e['t'], e['type']
    if tp == 'key': add(fx, key(e.get('v', .7) * .55), t0, .5, -.1 + rng.uniform(-.1, .1))
    elif tp == 'enter': add(fx, key(1, True), t0, .38, 0)
    elif tp == 'click': add(fx, sclick(1.1, .8), t0, .45, .1); add(fx, tick(.18, 1800), t0, 1, .1)
    elif tp == 'commit': add(fx, pop(.18, 700, 1100), t0 + .02, 1, .2)
    elif tp == 'hover': add(fx, tick(.12, 3400), t0, 1, .3)
    elif tp == 'tick': add(fx, tick(.2, 3000), t0, 1, .1)
    elif tp == 'select': add(fx, nz(.28, 2500, 7000, .1) * np.sin(np.pi * tt(.28)[:int(.28 * SR)] / .28), t0, 1, .1)
    elif tp == 'whoosh': add(fx, swish(.42, .3, 300, 3800), t0 - .08, 1, (e.get('d') or 0) * .4)
    elif tp == 'wipe': add(fx, swish(.8, .3, 250, 5000), t0, 1, 0)
    elif tp == 'send': add(fx, swish(.32, .26, 800, 6000), t0, 1, .2); add(fx, pop(.24, 600, 1150), t0 + .26, 1, .2)
    elif tp == 'stream': add(fx, pulse(hz(SCALE[min(11, e['i'])]) , .035, .125, .08), t0, 1, .25)
    elif tp == 'jump': dd = min(.14, e.get('d', .3) * .4); f0 = 220 if e.get('big') else 300; add(fx, pulse(1, dd, .25, .2 if e.get('big') else .15, fr=f0 * 2.6 ** (tt(dd) / dd)), t0, 1, .1)
    elif tp == 'land': v = e.get('v', .6); add(fx, pulse(110, .06, .5, .2 * v), t0, 1, 0); add(fx, crush(nz(.05, 200, 2000, .22 * v, .015)), t0, 1, 0)
    elif tp == 'tab': i = e['i'] - 1; add(fx, S.note('glockenspiel', SCALE[i], .5, .34 + .02 * i), t0, .55, -.5 + i * .09); add(fx, pulse(hz(SCALE[i]), .04, .125, .07), t0, 1, -.5 + i * .09)
    elif tp == 'hatch':
        for k in range(22): add(fx, pulse(rng.uniform(900, 2600), .03, .125, .06), t0 + rng.uniform(0, .5), 1, rng.uniform(-.5, .5))
    elif tp == 'blink': add(fx, pulse(hz('C6'), .035, .125, .14), t0, 1, .2); add(fx, pulse(hz('G5'), .035, .125, .11), t0 + .08, 1, .2)
    elif tp == 'launch':
        dd = .3; add(fx, pulse(1, dd, .25, .26, fr=220 * 4 ** (tt(dd) / dd)), t0, 1, 0); add(fx, swish(.6, .32, 900, 7000), t0, 1, .3)
    elif tp == 'touch':
        add(fx, boom(.9, 110, .7), t0, 1, .1); add(fx, crush(nz(.12, 150, 2500, .4, .03)), t0, 1, .1); add(fx, pulse(hz('G2'), .12, .5, .3), t0, 1, .1)
    elif tp == 'ding': pass
    elif tp == 'glock': add(fx, S.note('glockenspiel', ['B5', 'D6'][e['n']], .7, .42), t0, .55, -.3)
    elif tp == 'dive':
        for k in range(14): add(fx, pulse(hz('G6') * 2 ** (-k / 9), .028, .125, .07), t0 + k * .028, 1, (k % 2 - .5) * .6)
        add(fx, pop(.25, 900, 500), t0 + .42, 1, -.4)
    elif tp == 'wink': pass
dd = FLY_D; ta = tt(dd); sp = np.hypot(10, 9.8 * ta * .5) / 22.2
air = bp(rng.standard_normal(len(ta)), 700, 5000) * (sp ** 2) * np.clip(ta / .3, 0, 1) * np.clip((dd - ta) / .08, 0, 1) * .16
add(fx, air.astype(np.float32), T_LAUNCH, 1, .25)
# ═════ room tone: low, constant; the silences are this, not digital zero
rt = lp(noise(DUR + 1.5), 380, 2); rt = (rt / (np.sqrt(np.mean(rt ** 2)) + 1e-9) * db(-54)).astype(np.float32)
room = np.stack([rt[:NS], np.roll(rt, 2400)[:NS]], 1)

# ═════ voice + ducking
vo = np.zeros((NS, 2), np.float32)
for e in all_('vo'):
    y, sr = sf.read(os.path.join(HERE, 'voices', e['id'] + '.wav'), dtype='float32')
    if y.ndim > 1: y = y.mean(1)
    if sr != SR: y = soxr.resample(y, sr, SR).astype(np.float32)
    y = compress(hp(y, 80).astype(np.float32), .3, 3.0); add(vo, y, e['t'], 1.0, 0)
env = np.abs(vo[:, 0]); k = int(.12 * SR); env = np.convolve(env, np.ones(k) / k, 'same')
gate = np.clip(env / (np.percentile(env[env > 1e-4], 30) + 1e-9), 0, 1)
k2 = int(.18 * SR); gate = np.convolve(gate, np.ones(k2) / k2, 'same')        # soft attack/release
tn = np.arange(NS) / SR; depth = np.where(tn < T_BAND, .5, .8)
duck = 1 - depth * gate
music = music / (np.abs(music).max() + 1e-9) * .5
music *= duck[:, None]
music *= (1 + (db(4) - 1) * np.clip((tn - (T_WINK + .6)) / .8, 0, 1))[:, None]
fx = fx / (np.abs(fx).max() + 1e-9) * .4
vo = vo / (np.abs(vo).max() + 1e-9) * .9
G_MUS, G_FX = db(float(os.environ.get('GM', 3))), db(float(os.environ.get('GF', 0)))
mix = music * G_MUS + fx * G_FX + vo + room
fade = np.ones(NS); fo = int(1.0 * SR); end = int(DUR * SR); fade[end - fo:end] = np.linspace(1, 0, fo) ** 1.5; fade[end:] = 0
mix = limit(mix * fade[:, None], .95)
os.makedirs(os.path.join(HERE, 'out'), exist_ok=True)
if os.environ.get('STEMS'):
    for nm, y in (('music', music * G_MUS), ('fx', fx * G_FX), ('vo', vo)): sf.write(os.path.join(HERE, 'out', nm + '.wav'), y[:int((DUR + .1) * SR)], SR)
sf.write(os.path.join(HERE, 'out', 'mix.wav'), mix[:int((DUR + .1) * SR)], SR)
print('out/mix.wav', round(DUR, 2), 's; notes', len(EVN) + len(FILT))
