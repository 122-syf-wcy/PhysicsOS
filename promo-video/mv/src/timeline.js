/* 中央时间轴（PDoomVideo 逻辑：九章共享一份契约，音乐与画面同源）
 * 全局：window.TL —— 章节区间 / 120BPM 节拍 / 缓动 / 调色板 / 动效字幕与窗口绘制助手 */
(() => {
  const TL = {};

  TL.DURATION = 96;
  TL.W = 1920;
  TL.H = 1080;
  TL.BPM = 120;
  TL.BEAT = 0.5;   /* 一拍 */
  TL.BAR = 2;      /* 一小节 4 拍 */

  /* ---------- 章节表（与 STORYBOARD.md / audio-mv.mjs 严格同源）---------- */
  TL.chapters = [
    { n: 1, t0: 0,  dur: 8,  key: 'pain'    },
    { n: 2, t0: 8,  dur: 8,  key: 'regret'  },
    { n: 3, t0: 16, dur: 8,  key: 'turn'    },
    { n: 4, t0: 24, dur: 8,  key: 'brand'   },
    { n: 5, t0: 32, dur: 16, key: 'play'    },
    { n: 6, t0: 48, dur: 16, key: 'coach'   },
    { n: 7, t0: 64, dur: 16, key: 'drill'   },
    { n: 8, t0: 80, dur: 8,  key: 'free'    },
    { n: 9, t0: 88, dur: 8,  key: 'cta'     },
  ];
  TL.chapterAt = (t) => TL.chapters.find((c) => t >= c.t0 && t < c.t0 + c.dur) || TL.chapters[TL.chapters.length - 1];

  /* ---------- 调色板 ---------- */
  TL.C = {
    bg: '#0A1428', bgDeep: '#060D1D', bgMid: '#0E1B33',
    blue: '#2563EB', blueHi: '#4E8CFF', blueSoft: '#8FC0FF', bluePale: '#AFCBFF',
    ink: '#14213D', white: '#F5F9FF', dim: 'rgba(232,240,255,.62)', faint: 'rgba(232,240,255,.34)',
    warn: '#FF9A8F', ok: '#7FE89A', gold: '#F2A93B', card: '#101E38', line: 'rgba(143,192,255,.22)',
  };

  /* ---------- 数学 / 缓动 ---------- */
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const lerp = (a, b, u) => a + (b - a) * u;
  TL.clamp01 = clamp01;
  TL.lerp = lerp;
  TL.seg = (t, t0, t1) => clamp01((t - t0) / (t1 - t0));            /* 时间窗 → 0..1 */
  TL.io = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
  TL.out = (u) => 1 - Math.pow(1 - u, 3);
  TL.in = (u) => u * u * u;
  TL.outBack = (u) => { const c = 1.70158; const p = u - 1; return 1 + (c + 1) * p * p * p + c * p * p; };
  TL.outElastic = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : Math.pow(2, -10 * u) * Math.sin((u * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1);
  TL.bounceOut = (u) => { const n = 7.5625, d = 2.75; if (u < 1 / d) return n * u * u; if (u < 2 / d) { u -= 1.5 / d; return n * u * u + 0.75; } if (u < 2.5 / d) { u -= 2.25 / d; return n * u * u + 0.9375; } u -= 2.625 / d; return n * u * u + 0.984375; };
  TL.beat = (t) => t / TL.BEAT;                                       /* 拍号（浮点） */
  TL.onBeat = (t, phase = 0) => {                                     /* 距最近节拍起点的进度 0..1 */
    const b = TL.beat(t) - phase;
    return b - Math.floor(b);
  };
  /* 固定种子 PRNG（mulberry32）—— 禁未播种随机 */
  TL.rng = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* ---------- 画布基础 ---------- */
  TL.clear = (ctx, color) => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = color; ctx.fillRect(0, 0, TL.W, TL.H); };
  TL.vignette = (ctx, a = 0.5) => {
    const g = ctx.createRadialGradient(TL.W / 2, TL.H / 2, TL.H * 0.42, TL.W / 2, TL.H / 2, TL.H * 0.95);
    g.addColorStop(0, 'rgba(4,8,18,0)');
    g.addColorStop(1, `rgba(4,8,18,${a})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, TL.W, TL.H);
  };
  TL.flash = (ctx, a, color = '#FFFFFF') => { if (a > 0.002) { ctx.fillStyle = color; ctx.globalAlpha = clamp01(a); ctx.fillRect(0, 0, TL.W, TL.H); ctx.globalAlpha = 1; } };
  TL.shake = (ctx, t, t0, amp = 6, freq = 26) => {   /* 冲击震屏：衰减正弦，seek 前调用 */
    const u = t - t0;
    if (u <= 0 || u > 0.7) return;
    const d = amp * Math.exp(-u * 7);
    ctx.translate(Math.sin(u * freq * 6.283) * d, Math.cos(u * freq * 4.1) * d * 0.7);
  };
  TL.font = (px, weight = 700) => `${weight} ${px}px -apple-system, "SF Pro Display", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`;
  TL.mono = (px, weight = 700) => `${weight} ${px}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;

  /* ---------- 动效字幕（kinetic typography：逐字按节拍弹入）---------- */
  /* opt: { size, color, weight, step(每字间隔 s，默认 0.09), pop(缩放峰值), y(-位移), shadow, glow } */
  TL.popText = (ctx, text, x, y, t, t0, opt = {}) => {
    const size = opt.size || 58;
    const step = opt.step ?? 0.09;
    const chars = [...String(text)];
    ctx.font = TL.font(size, opt.weight || 800);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const totalW = chars.reduce((w, ch) => w + ctx.measureText(ch).width + 6, -6);
    let cx = x - totalW / 2;
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      const w = ctx.measureText(ch).width;
      const u = TL.seg(t, t0 + i * step, t0 + i * step + 0.26);
      if (u > 0) {
        const s = lerp(0.3, 1, TL.outBack(u));
        const dy = lerp(26, 0, TL.out(u));
        ctx.save();
        ctx.translate(cx + w / 2, y + dy);
        ctx.scale(s, s);
        ctx.globalAlpha = clamp01(u * 2.2);
        if (opt.shadow !== false) { ctx.shadowColor = 'rgba(4,10,24,.85)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 3; }
        if (opt.glow) { ctx.shadowColor = opt.glow; ctx.shadowBlur = 34; }
        ctx.fillStyle = typeof opt.color === 'function' ? opt.color(i, chars.length) : (opt.color || TL.C.white);
        ctx.fillText(ch, 0, 0);
        ctx.restore();
      }
      cx += w + 6;
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    return totalW;
  };

  /* 淡入淡出的整行字幕（配合 popText 用） */
  TL.fadeRange = (t, t0, t1, fi = 0.4, fo = 0.4) => {
    if (t < t0 || t > t1) return 0;
    return Math.min(clamp01((t - t0) / fi), clamp01((t1 - t) / fo));
  };

  /* ---------- 场景标签 chip（左上角蓝色小签）---------- */
  TL.chip = (ctx, text, x, y, u, opt = {}) => {
    if (u <= 0) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(lerp(0.6, 1, TL.outBack(clamp01(u))), lerp(0.6, 1, TL.outBack(clamp01(u))));
    ctx.font = TL.font(opt.size || 30, 800);
    const w = ctx.measureText(text).width + 52;
    const h = opt.h || 58;
    ctx.fillStyle = opt.bg || TL.C.blue;
    ctx.shadowColor = 'rgba(37,99,235,.45)'; ctx.shadowBlur = 26; ctx.shadowOffsetY = 8;
    roundRect(ctx, -14, -h, w, h, h / 2); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = opt.color || '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 12, -h / 2 + 1);
    ctx.restore();
  };

  /* ---------- 窗口（macOS 风：真实截图 cameo 的画框）---------- */
  /* img: HTMLImageElement；u: 0..1 出场进度；返回窗口主体区域 {x,y,w,h} */
  TL.winFrame = (ctx, img, x, y, w, h, u, opt = {}) => {
    if (u <= 0) return null;
    const e = TL.outBack(clamp01(u));
    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.scale(lerp(0.86, 1, e), lerp(0.86, 1, e));
    ctx.globalAlpha = clamp01(u * 1.6);
    ctx.translate(-w / 2, -h / 2);
    const bar = opt.bar ?? 44;
    ctx.shadowColor = 'rgba(2,6,16,.65)'; ctx.shadowBlur = 70; ctx.shadowOffsetY = 24;
    ctx.fillStyle = opt.frame || '#FFFFFF';
    roundRect(ctx, 0, 0, w, h + bar, 16); ctx.fill();
    ctx.shadowColor = 'transparent';
    /* 标题栏 */
    ctx.fillStyle = '#F5F7FA';
    roundRect(ctx, 0, 0, w, bar + 16, 16); ctx.fill();
    ctx.fillRect(0, bar - 2, w, 18);
    ['#E95B54', '#F2A93B', '#4CAF50'].forEach((c, i) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(28 + i * 26, bar / 2, 7.5, 0, 7); ctx.fill(); });
    if (opt.url) {
      ctx.fillStyle = '#fff'; roundRect(ctx, 118, 8, w - 140, bar - 16, 8); ctx.fill();
      ctx.strokeStyle = '#E8ECF2'; ctx.lineWidth = 1.5; roundRect(ctx, 118, 8, w - 140, bar - 16, 8); ctx.stroke();
      ctx.fillStyle = '#5F6B7A'; ctx.font = TL.mono(17, 500);
      ctx.textBaseline = 'middle';
      ctx.fillText(opt.url, 134, bar / 2 + 1);
    }
    /* 内容 */
    ctx.save();
    roundRect(ctx, 0, bar, w, h, 0); ctx.clip();
    ctx.fillStyle = opt.contentBg || '#FAFBFD';
    ctx.fillRect(0, bar, w, h);
    if (img && img.complete && img.naturalWidth) {
      const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const iw = img.naturalWidth * s, ih = img.naturalHeight * s;
      ctx.drawImage(img, (w - iw) / 2, bar + (h - ih) / 2 + (opt.scroll || 0), iw, ih);
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(20,33,61,.14)'; ctx.lineWidth = 1.5;
    roundRect(ctx, 0.75, 0.75, w - 1.5, h + bar - 1.5, 16); ctx.stroke();
    ctx.restore();
    return { x, y, w, h, bar };
  };

  /* ---------- 通用圆角矩形 ---------- */
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  TL.roundRect = roundRect;

  /* ---------- 星域（CH8/CH9 共用，确定性闪烁）---------- */
  TL.stars = (ctx, t, seed = 7, n = 90, alpha = 1) => {
    const r = TL.rng(seed);
    ctx.save();
    for (let i = 0; i < n; i++) {
      const x = r() * TL.W, y = r() * TL.H;
      const ph = r() * 6.283, sz = 0.8 + r() * 2.0;
      const tw = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * 2.1 + ph));
      ctx.globalAlpha = alpha * tw;
      ctx.fillStyle = i % 7 === 0 ? TL.C.bluePale : '#FFFFFF';
      ctx.beginPath(); ctx.arc(x, y, sz, 0, 7); ctx.fill();
    }
    ctx.restore();
  };

  window.TL = TL;
})();
