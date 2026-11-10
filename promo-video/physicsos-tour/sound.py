"""Score + foley + voice → out/mix.wav, all timed from events.json (the picture's own event list).
As in the first film, a sampled band is the world and a band-limited pulse wave is the ball. D major, 96 BPM, bar 1 at t = 0.
The hour sets the arrangement: room tone and the clock, then the ball's pulse motif as it drops out of the clock → piano and
glockenspiel at 07:30 → the full band for the lab lessons (the current runs as pulse sixteenths, the string swings on a harp, the
bar slides on filtered noise) → a lighter groove at 16:00, low-passed while the answer streams, half a beat of silence before
67/67 → vibraphone and taps at dusk → piano and bass at 21:30 → at night only the piano and the ball's pulse; the last chord
when it falls asleep."""
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
B = 60 / 96; BAR = 4 * B
def tt(d): return np.arange(int(round(d * SR))) / SR
def db(x): return 10 ** (x / 20)
def first(tp, **kw): return next(e['t'] for e in E if e['type'] == tp and all(e.get(k) == v for k, v in kw.items()))
def all_(tp): return [e for e in E if e['type'] == tp]
def cue(n): return first('cue', n=n)
def bar(n): return (n - 1) * BAR

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
TICKS = [e['t'] for e in all_('tick')]
T_POP = first('pop'); T_BAND = cue('band')
W1, W2, W3, W4 = [e['t'] for e in all_('wipe')]
RIDE = all_('ride')[0]; SLIDE = all_('slide')[0]; PLUCKS = all_('pluck')
STREAMS = all_('stream'); T_S0 = STREAMS[0]['t'] - .05; T_S1 = STREAMS[-1]['t'] + (STREAMS[1]['t'] - STREAMS[0]['t'])
T_HUSH = cue('hush'); T_DING = first('ding'); T_NIGHT = cue('night'); T_FINAL = cue('final'); T_SNORE = first('snore')

PROG = [('D2', ['F#3', 'A3', 'D4', 'E4']), ('B1', ['F#3', 'A3', 'B3', 'D4']), ('G1', ['F#3', 'G3', 'B3', 'D4']), ('A1', ['E3', 'G3', 'A3', 'C#4'])]
ARP = [['D4', 'F#4', 'A4', 'E5'], ['B3', 'D4', 'F#4', 'A4'], ['G3', 'B3', 'D4', 'F#4'], ['A3', 'C#4', 'E4', 'G4']]
def bi_of(t): return int(np.floor(t / BAR + 1e-6)) % 4
def chord_at(t): return PROG[bi_of(t)]
def up(p, k=1): return S.name(S.midi(p) + 12 * k)

band = np.zeros((NS, 2), np.float32); chip = np.zeros((NS, 2), np.float32); filt = np.zeros((NS, 2), np.float32)
EVN, FILT, KICKS, KICKS_F = [], [], [], []
def N(t, inst, p, d, v, pan=0., dest=None): (EVN if dest is None else dest).append((t, inst, p, d, v, pan, 1.))
def kick(v=1.):
    d = .32; t = tt(d); f = 52 + 90 * np.exp(-t * 32)
    return (np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / .11) * v * .9 + nz(d, 1500, 5000, .05 * v, .004)[:len(t)]).astype(np.float32)
def groove(t0, t1, mode='full', dest=None, comp='piano'):
    K = KICKS if dest is None else KICKS_F
    for n in range(int(round(t0 / B)), int(round(t1 / B))):
        t = n * B; bi = n % 4; root, ch = chord_at(t + 1e-3)
        if mode == 'full':
            if bi in (0, 2): K.append((t, .9 if bi == 0 else .7))
            if bi == 2: K.append((t + B * .5, .45))
            if bi in (1, 3): N(t, 'snare2', 'stick', .2, .42, .08, dest)
            if bi == 3: N(t, 'claps', 'group', .3, .3, -.05, dest)
            for h in (0, .5): N(t + h * B, 'hihat', 'closed', .1, .3 if h == 0 else .18, .3, dest)
        elif mode == 'lite':
            if bi == 0: K.append((t, .7))
            if bi in (1, 3): N(t, 'snare2', 'stick', .2, .26, .08, dest)
            for h in (0, .5): N(t + h * B, 'hihat', 'closed', .1, .2 if h == 0 else .12, .3, dest)
        elif mode == 'taps':
            if bi == 0: K.append((t, .6))
            if bi in (1, 3): N(t, 'snare2', 'taps', .25, .4, .1, dest)
            N(t + B / 2, 'hihat', 'pedal', .1, .22, .3, dest)
        N(t, 'jazz_bass', root, .32, .7 if mode == 'full' else .62, 0, dest)
        if mode != 'taps': N(t + B / 2, 'jazz_bass', root if bi != 3 else S.name(S.midi(root) + 7), .24, .4, 0, dest)
        if comp == 'piano':
            if bi == 0: [N(t + j * .012, 'piano', p, 1.7, .32, -.15, dest) for j, p in enumerate(ch)]
            else: [N(t + B / 2, 'piano', p, .22, .2, -.15, dest) for p in ch[1:]]
        elif comp == 'vib':
            if bi == 0: [N(t + j * .015, 'vibraphone', up(p) if S.midi(p) < S.midi('F3') else p, 2.2, .46, .2, dest) for j, p in enumerate(ch)]
            if bi == 2: [N(t + B / 2, 'vibraphone', up(p) if S.midi(p) < S.midi('F3') else p, .5, .3, .2, dest) for p in ch[1:]]
def fill(w, n=4, crash=.4):
    for k, tm in enumerate(['high', 'high', 'low', 'low'][-n:]): N(w - n * B / 4 + k * B / 4, 'toms', tm, .3, .45 + .1 * k, (k - 1.5) * .3)
    N(w, 'clash', 'crash', 2.2, crash, -.2); KICKS.append((w, 1.))
def glock_arp(t0, notes=('D6', 'F#6', 'A6', 'D7'), v=.36):
    for k, p in enumerate(notes): N(t0 + k * .07, 'glockenspiel', p, 1.2, v - .03 * k, -.3 + .2 * k)

# ═════ 07:30: room tone and the clock; the ball's motif as it drops out of the clock; then piano + glockenspiel
for k, p in enumerate(['D6', 'F#6', 'A6']): add(chip, pulse(hz(p), .1, .25, .26), T_POP + .04 + k * .085, 1, .3)
N(T_BAND, 'piano', 'D2', 2.4, .4, -.1); [N(T_BAND + .02 + j * .03, 'piano', p, 2.4, .3, -.15 + j * .08) for j, p in enumerate(['A2', 'F#3', 'D4', 'E4'])]
N(T_BAND + .03, 'glockenspiel', 'A6', 1.4, .34, .3)
t = T_BAND + B
while t < W1 - B / 4:
    n = int(round((t % BAR) / (B / 2))); ar = ARP[bi_of(t + 1e-3)]
    N(t, 'piano', ar[n % 4] if n < 4 else ar[3 - n % 4], .6, .24 + .08 * (n % 2 == 0), -.2)
    if n == 0: N(t, 'piano', chord_at(t + 1e-3)[0][:-1] + '2', 2.2, .32, -.1); N(t, 'glockenspiel', up(ar[3]), .9, .18, .35)
    t += B / 2
# ═════ 09:00 the lab lessons: full band
fill(bar(7), 2, crash=.2)                        # the band comes in under the first lab line: a soft crash
groove(bar(7), W2 - B)
# the current: the ball's pulse in sixteenths round the loop, one note per component
for k in range(int(RIDE['d'] / (B / 4))):
    tk = RIDE['t'] + k * B / 4; ar = ARP[bi_of(tk + 1e-3)]
    add(chip, pulse(hz(up(ar[k % 4])), B / 4 * .8, .125, .07 + .025 * (k % 4 == 0)), tk, 1, -.25 + .5 * (k % 8) / 7)
# the string: a harp on every swing, high at the top of the swing
for e in PLUCKS:
    ch = chord_at(e['t'] + 1e-3)[1]
    N(e['t'], 'harp', up(ch[3]) if e['up'] else ch[2], 1.2, .44 if e['up'] else .34, -.25 if e['up'] else .25)
# the bar: dry friction for its five simulated seconds, and the induced current as a soft pulse drone
sd = SLIDE['d']; fr_ = nz(sd, 350, 1600, .22) * (.7 + .3 * np.sin(2 * np.pi * 7 * tt(sd)[:int(sd * SR)])) * np.clip(tt(sd)[:int(sd * SR)] / .15, 0, 1) * np.clip((sd - tt(sd)[:int(sd * SR)]) / .25, 0, 1)
add(band, fr_.astype(np.float32), SLIDE['t'], .5, .15)
add(chip, pulse(hz('A4'), sd, .5, .05, att=.3, rel=.4), SLIDE['t'] + .1, 1, -.1)
# ═════ 16:00 a lighter groove; the answer streams under a low-pass; half a beat of nothing before 67/67
fill(W2)
groove(W2, T_S0, 'lite')
groove(T_S0, T_S1, 'lite', dest=FILT)
groove(T_S1, T_HUSH, 'lite')
for p in ['D4', 'F#4', 'A4', 'C#5']: EVN.append(dict(t=T_DING, inst='vibraphone_bowed', pitch=p, dur=W3 - T_DING - .2, vel=.3, pan=0, attack=.5))
N(T_DING, 'jazz_bass', 'D2', W3 - T_DING - .3, .4, 0)
N(T_DING, 'hand_chimes', 'A5', 2.4, .5, .2); N(T_DING + .06, 'hand_chimes', 'D6', 2.4, .44, .25)
for j, p in enumerate(['D6', 'F#6', 'A6']): N(T_DING + .1 + j * B / 4, 'glockenspiel', p, 1.2, .38, .3)
# ═════ 19:00 dusk: vibraphone and taps
glock_arp(W3)
groove(bar(25), W4, 'taps', comp='vib')
# ═════ 21:30: piano and bass, a little hi-hat
glock_arp(W4, ('A5', 'D6', 'F#6', 'A6'), .32)
groove(W4, T_NIGHT - .05, 'lite', comp='piano')
# ═════ 22:30 night: the ball's pulse sings the first phrase as a lullaby, the piano holds; the last chord when it sleeps
for j, p in enumerate(['D3', 'A3', 'F#4', 'E5']): N(T_NIGHT + j * .03, 'piano', p, bar(41) - T_NIGHT, .26, -.1 + j * .06)
for p, o, d in [('A5', 0, .5), ('F#5', .5, .5), ('D5', 1, .5), ('E5', 1.5, .5), ('F#5', 2, 1.5)]:
    add(chip, pulse(hz(p), d * B * .9, .25, .14), T_NIGHT + .3 + o * B, 1, .2)
tn = bar(41)
while tn < T_FINAL - .3:
    root, ch = chord_at(tn + 1e-3); dn = min(BAR, T_FINAL - tn + .15)
    N(tn, 'piano', root[:-1] + '2', dn, .26, -.1); [N(tn + .2 + j * .2, 'piano', p, dn - .2 - j * .2, .18, -.1) for j, p in enumerate(ch[1:])]
    tn += BAR
N(T_FINAL, 'jazz_bass', 'D2', DUR - T_FINAL, .6, 0)
for j, p in enumerate(['D2', 'A2', 'E3', 'F#3', 'A3', 'D4', 'E4']): N(T_FINAL + j * .03, 'piano', p, DUR - T_FINAL, .44, -.15 + j * .05)
for p in ['A3', 'D4', 'E4', 'F#4']: EVN.append(dict(t=T_FINAL, inst='vibraphone_bowed', pitch=p, dur=DUR - T_FINAL, vel=.4, pan=.1, attack=.3))
N(T_FINAL + .05, 'hand_chimes', 'A5', DUR - T_FINAL, .36, .2)
for k, p in enumerate(['A5', 'F#5', 'D5']): add(chip, pulse(hz(p), .2, .25, .13), T_FINAL + .3 + k * .26, 1, .2)

bandmix = S.render(EVN, dur=DUR + 1.5); band[:len(bandmix)] += bandmix[:NS]
fm = S.render(FILT, dur=DUR + 1.5)
fm = np.stack([lp(fm[:, c], 1200, 2) for c in (0, 1)], 1).astype(np.float32) * 1.2
filt[:len(fm)] += fm[:NS]
for t0, v in KICKS: add(band, kick(v), t0, .55, 0)
for t0, v in KICKS_F: add(filt, lp(kick(v), 1200).astype(np.float32), t0, .55, 0)
music = band + filt + chip
music = S.room(music, size=.32, mix=.1)
# the hush is real: nothing from the band for half a beat (room tone stays)
tn_ = np.arange(NS) / SR
music *= (1 - np.clip((tn_ - T_HUSH) / .03, 0, 1) * np.clip((T_DING - .01 - tn_) / .03, 0, 1))[:, None]

# ═════ foley
fx = np.zeros((NS, 2), np.float32)
def tick(v=.5, f=2600): t = tt(.05); return (np.sin(2 * np.pi * f * t) * np.exp(-t / .008) * v + nz(.05, 3000, 8000, .15 * v, .004)[:len(t)]).astype(np.float32)
def pop(v=.6, f0=520, f1=980): t = tt(.12); f = f0 * (f1 / f0) ** np.minimum(1, t / .05); return (np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / .035) * v).astype(np.float32)
def swish(d=.35, v=.5, lo=400, hi=4000):
    x = rng.standard_normal(int(d * SR)); t = tt(d)[:len(x)]; e = np.sin(np.pi * t / d) ** 2
    return (bp(x, lo, hi) * e * v).astype(np.float32)
def clock(v=.5):   # a mechanical tick: a sharp transient, then the escapement's softer second click
    return (tick(v, 3200) + np.pad(tick(v * .45, 2100), (int(.045 * SR), 0))[:int(.05 * SR)]).astype(np.float32)
SCALE = ['D5', 'E5', 'F#5', 'A5', 'B5', 'D6', 'E6', 'F#6', 'A6', 'B6', 'D7', 'E7']
for e in E:
    t0, tp = e['t'], e['type']
    if tp == 'click': add(fx, sclick(1.1, .8), t0, .45, .1); add(fx, tick(.18, 1800), t0, 1, .1)
    elif tp == 'hover': add(fx, tick(.12, 3400), t0, 1, .3)
    elif tp == 'tick': add(fx, clock(.55), t0, 1, .35); add(fx, S.note('hand_chimes', 'D6' if t0 < 50 else 'A5', 1.6, .3), t0 + .02, .5, .35)
    elif tp == 'wipe': add(fx, swish(.8, .3, 250, 5000), t0, 1, 0)
    elif tp == 'fill': add(fx, pop(.2, 600, 900), t0, 1, .1)
    elif tp == 'send': add(fx, swish(.32, .26, 800, 6000), t0, 1, .2); add(fx, pop(.24, 600, 1150), t0 + .26, 1, .2)
    elif tp == 'stream': add(fx, pulse(hz(SCALE[min(11, e['i'])]), .035, .125, .08), t0, 1, .25)
    elif tp == 'row': add(fx, pulse(hz('A6' if e.get('tool') else 'D6'), .03, .125, .07 if e.get('tool') else .04), t0, 1, -.2)
    elif tp == 'jump': dd = min(.14, e.get('d', .3) * .4); f0 = 220 if e.get('big') else 300; add(fx, pulse(1, dd, .25, .2 if e.get('big') else .15, fr=f0 * 2.6 ** (tt(dd) / dd)), t0, 1, .1)
    elif tp == 'land': v = e.get('v', .6); add(fx, pulse(110, .06, .5, .2 * v), t0, 1, 0); add(fx, crush(nz(.05, 200, 2000, .22 * v, .015)), t0, 1, 0)
    elif tp == 'tab': add(fx, S.note('glockenspiel', 'A6', .5, .3), t0, .55, .2); add(fx, tick(.14, 2400), t0, 1, .2)
    elif tp == 'glock': add(fx, S.note('glockenspiel', ['F#6', 'A6', 'B6', 'D7', 'E7'][e['n'] % 5], .7, .36), t0, .55, -.3)
    elif tp == 'pop' and 'n' in e: add(fx, pop(.22, 700, 1300), t0, 1, .2); add(fx, S.note('glockenspiel', ['A6', 'D7'][e['n']], .6, .3), t0, .5, .25)
    elif tp == 'ding': add(fx, pulse(hz('A6'), .06, .25, .12), t0, 1, .2); add(fx, pulse(hz('D7'), .12, .25, .1), t0 + .07, 1, .2)
    elif tp == 'snore':   # the ball breathing in its sleep: a soft low pulse that swells and fades, every 2.5 s
        k = 0
        while t0 + k * 2.5 < DUR - .6:
            d = 1.1; tt_ = tt(d); env = np.sin(np.pi * tt_ / d) ** 2
            add(fx, (pulse(hz('D3'), d, .5, .06, att=.2, rel=.3) * env[:int(d * SR)]).astype(np.float32), t0 + k * 2.5, 1, .2); k += 1
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
depth = np.where((tn_ > W1) & (tn_ < W2), .9, .84)            # the full band of the lab lessons sits further under the voice
duck = 1 - depth * gate
music = music / (np.abs(music).max() + 1e-9) * .5
music *= duck[:, None]
music *= (1 + (db(4) - 1) * np.clip((tn_ - (T_FINAL + .7)) / .8, 0, 1))[:, None]
fx = fx / (np.abs(fx).max() + 1e-9) * .4
vo = vo / (np.abs(vo).max() + 1e-9) * .9
G_MUS, G_FX = db(float(os.environ.get('GM', 3))), db(float(os.environ.get('GF', 0)))
mix = music * G_MUS + fx * G_FX + vo + room
fade = np.ones(NS); fo = int(1.2 * SR); end = int(DUR * SR); fade[end - fo:end] = np.linspace(1, 0, fo) ** 1.5; fade[end:] = 0
mix = limit(mix * fade[:, None], .95)
os.makedirs(os.path.join(HERE, 'out'), exist_ok=True)
if os.environ.get('STEMS'):
    for nm, y in (('music', music * G_MUS), ('fx', fx * G_FX), ('vo', vo)): sf.write(os.path.join(HERE, 'out', nm + '.wav'), y[:int((DUR + .1) * SR)], SR)
sf.write(os.path.join(HERE, 'out', 'mix.wav'), mix[:int((DUR + .1) * SR)], SR)
print('out/mix.wav', round(DUR, 2), 's; notes', len(EVN) + len(FILT))
