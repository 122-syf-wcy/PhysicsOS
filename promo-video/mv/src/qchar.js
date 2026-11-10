/* Q 仔 · 品牌电荷角色 + 粒子/残影/道具绘制库（全部是 t 的纯函数，无跨帧状态） */
(() => {
  const { lerp, clamp01, out, outBack, seg, rng, C, font, roundRect } = window.TL;
  const Q = {};

  /* ---------- Q 仔本体 ----------
   * opt: { squash(0..), stretch, mood:'normal|dizzy|happy|focus|sleep|wow', tilt(rad),
   *        glow(0..1), cap(学者帽 0..1), antenna(0..1 天线亮), alpha }
   * 姿态由调用方给定 x,y,r（r≈46 为标准尺寸） */
  Q.draw = (ctx, x, y, r, t, opt = {}) => {
    const sq = opt.squash || 0;          /* 纵向压扁 */
    const st = opt.stretch || 0;         /* 纵向拉长 */
    const sx = 1 + sq * 0.55 - st * 0.25;
    const sy = 1 - sq * 0.42 + st * 0.35;
    const tilt = opt.tilt || 0;
    const blink = ((t * 0.9) % 4.1) < 0.14;   /* 眨眼：约 4.1s 一次，持续 0.14s */
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    ctx.scale(sx, sy);
    ctx.globalAlpha = opt.alpha ?? 1;

    /* 光晕 */
    if (opt.glow) {
      const g = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r * (2.6 + opt.glow));
      g.addColorStop(0, `rgba(78,140,255,${0.36 * opt.glow})`);
      g.addColorStop(1, 'rgba(78,140,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, r * (2.6 + opt.glow), 0, 7); ctx.fill();
    }

    /* 天线（身后先画） */
    ctx.strokeStyle = 'rgba(175,203,255,.9)'; ctx.lineWidth = Math.max(2.5, r * 0.065); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -r * 0.92); ctx.quadraticCurveTo(r * 0.16, -r * 1.3, r * 0.05, -r * 1.52); ctx.stroke();
    const tipR = r * 0.13 * (0.85 + 0.3 * (opt.antenna ?? 1));
    ctx.fillStyle = C.bluePale;
    ctx.beginPath(); ctx.arc(r * 0.05, -r * 1.55, tipR, 0, 7); ctx.fill();
    if (opt.antenna) {
      const gg = ctx.createRadialGradient(r * 0.05, -r * 1.55, 0, r * 0.05, -r * 1.55, r * 0.55);
      gg.addColorStop(0, 'rgba(175,203,255,.85)'); gg.addColorStop(1, 'rgba(175,203,255,0)');
      ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(r * 0.05, -r * 1.55, r * 0.55, 0, 7); ctx.fill();
    }

    /* 身体 */
    const bg = ctx.createRadialGradient(-r * 0.32, -r * 0.36, r * 0.12, 0, 0, r * 1.12);
    bg.addColorStop(0, '#8FC0FF'); bg.addColorStop(0.42, '#4E8CFF'); bg.addColorStop(1, '#1D4FD7');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(232,240,255,.35)'; ctx.lineWidth = Math.max(2, r * 0.05);
    ctx.beginPath(); ctx.arc(0, 0, r - ctx.lineWidth * 0.4, 0, 7); ctx.stroke();
    /* "+" 印记：它是电荷 */
    ctx.fillStyle = 'rgba(255,255,255,.5)';
    ctx.font = `800 ${Math.round(r * 0.42)}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('+', r * 0.52, r * 0.5);

    /* 表情 */
    const er = r * 0.085;
    const ey = -r * 0.16, ex = r * 0.34;
    ctx.fillStyle = '#0B1B3A';
    if (opt.mood === 'dizzy') {
      ctx.strokeStyle = '#0B1B3A'; ctx.lineWidth = Math.max(2.5, r * 0.075); ctx.lineCap = 'round';
      [[-ex, ey], [ex, ey]].forEach(([px, py]) => {
        const s = r * 0.13;
        ctx.beginPath();
        ctx.moveTo(px - s, py - s); ctx.lineTo(px + s, py + s);
        ctx.moveTo(px + s, py - s); ctx.lineTo(px - s, py + s);
        ctx.stroke();
      });
    } else if (opt.mood === 'sleep') {
      ctx.strokeStyle = '#0B1B3A'; ctx.lineWidth = Math.max(2.5, r * 0.07); ctx.lineCap = 'round';
      [[-ex, ey], [ex, ey]].forEach(([px, py]) => {
        ctx.beginPath(); ctx.arc(px, py, r * 0.13, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
      });
    } else {
      [[-ex, ey], [ex, ey]].forEach(([px, py], i) => {
        const open = blink || (opt.mood === 'happy' && i === 0 && false) ? 0.16 : 1;
        ctx.save(); ctx.translate(px, py); ctx.scale(1, open);
        ctx.beginPath(); ctx.arc(0, 0, er * (1 + (opt.mood === 'wow' ? 0.45 : 0)), 0, 7); ctx.fill();
        ctx.restore();
      });
      /* 高光点 */
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      [[-ex - er * 0.3, ey - er * 0.35], [ex - er * 0.3, ey - er * 0.35]].forEach(([px, py]) => {
        ctx.beginPath(); ctx.arc(px, py, er * 0.34, 0, 7); ctx.fill();
      });
    }
    /* 嘴 */
    ctx.strokeStyle = '#0B1B3A'; ctx.lineWidth = Math.max(2.5, r * 0.07); ctx.lineCap = 'round';
    const my = r * 0.3;
    ctx.beginPath();
    if (opt.mood === 'happy' || opt.mood === 'wow') {
      ctx.moveTo(-r * 0.22, my - r * 0.04);
      ctx.quadraticCurveTo(0, my + r * 0.26, r * 0.22, my - r * 0.04);
    } else if (opt.mood === 'dizzy') {
      ctx.arc(0, my + r * 0.05, r * 0.13, 1.15 * Math.PI, 1.85 * Math.PI);
    } else {
      ctx.moveTo(-r * 0.18, my);
      ctx.quadraticCurveTo(0, my + r * 0.14, r * 0.18, my);
    }
    ctx.stroke();

    /* 学者帽（CH6） */
    if (opt.cap) {
      const cu = clamp01(opt.cap);
      ctx.save();
      ctx.translate(0, -r * 1.02 - lerp(10, 0, cu));
      ctx.rotate(-0.06);
      ctx.globalAlpha *= cu;
      ctx.fillStyle = '#14213D';
      ctx.beginPath();
      ctx.moveTo(-r * 0.72, 0); ctx.lineTo(0, -r * 0.44); ctx.lineTo(r * 0.72, 0); ctx.lineTo(0, r * 0.14); ctx.closePath();
      ctx.fill();
      ctx.fillRect(-r * 0.5, 0, r * 0.16, r * 0.3);
      ctx.fillStyle = C.gold;
      ctx.beginPath(); ctx.arc(-r * 0.42, r * 0.34, r * 0.07, 0, 7); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  };

  /* 运动残影：posAt(k) 返回历史位置（纯函数采样过去时刻） */
  Q.trail = (ctx, posAt, r, t, n = 6, dt = 0.045, color = 'rgba(78,140,255,') => {
    for (let k = n; k >= 1; k--) {
      const p = posAt(t - k * dt);
      const a = (1 - k / (n + 1)) * 0.28;
      if (a <= 0.01) continue;
      ctx.fillStyle = `${color}${a})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, r * (1 - k * 0.055), 0, 7); ctx.fill();
    }
  };

  /* 径向粒子爆发（确定性） */
  Q.burst = (ctx, x, y, t, t0, opt = {}) => {
    const u = seg(t, t0, t0 + (opt.dur || 0.8));
    if (u <= 0 || u >= 1) return;
    const n = opt.n || 16;
    const r = rng(opt.seed || 3);
    for (let i = 0; i < n; i++) {
      const ang = opt.ang !== undefined ? opt.ang + (r() - 0.5) * (opt.spread || 6.283) : r() * 6.283;
      const sp = (opt.speed || 320) * (0.45 + r() * 0.75);
      const px = x + Math.cos(ang) * sp * out(u) * (opt.dur || 0.8);
      const py = y + Math.sin(ang) * sp * out(u) * (opt.dur || 0.8) + (opt.grav || 0) * Math.pow(u * (opt.dur || 0.8), 2);
      ctx.globalAlpha = (1 - u) * (opt.alpha || 0.9);
      ctx.fillStyle = opt.color || C.bluePale;
      const sz = (opt.sz || 6) * (1 - u * 0.55) * (0.6 + r() * 0.8);
      ctx.beginPath(); ctx.arc(px, py, Math.max(0.5, sz), 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  /* 冲击环 */
  Q.ring = (ctx, x, y, t, t0, opt = {}) => {
    const u = seg(t, t0, t0 + (opt.dur || 0.6));
    if (u <= 0 || u >= 1) return;
    ctx.save();
    ctx.globalAlpha = (1 - u) * (opt.alpha || 0.8);
    ctx.strokeStyle = opt.color || C.blueSoft;
    ctx.lineWidth = lerp(opt.w0 || 16, opt.w1 || 1.5, u);
    ctx.beginPath(); ctx.arc(x, y, lerp(opt.r0 || 30, opt.r1 || 620, out(u)), 0, 7); ctx.stroke();
    ctx.restore();
  };

  /* 公式碎片库（CH1/CH2 雨与卡墙用） */
  Q.FORMULAS = ['F=ma', 'v=v₀+at', 'x=½at²', 'r=mv/qB', 'T=2πm/qB', 'F=kq₁q₂/r²', 'W=Fs·cosθ', 'p=mv', 'a=v²/r', 'Eₖ=½mv²', 'λ=v/f', '1/f=1/u+1/v', 'I=U/R', 'P=UI', 'Q=It', 'Φ=BS', 'E=BLv', 'F=GmM/r²', 'g=GM/r²', 'μ=f/N'];

  /* 一张下落的公式卡 */
  Q.formulaCard = (ctx, x, y, rot, scale, text, opt = {}) => {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot); ctx.scale(scale, scale);
    ctx.font = font(opt.size || 34, 700);
    const w = ctx.measureText(text).width + 44;
    const h = opt.h || 64;
    ctx.fillStyle = opt.bg || 'rgba(16,30,56,.92)';
    roundRect(ctx, -w / 2, -h / 2, w, h, 12); ctx.fill();
    ctx.strokeStyle = opt.border || 'rgba(143,192,255,.28)'; ctx.lineWidth = 1.5;
    roundRect(ctx, -w / 2, -h / 2, w, h, 12); ctx.stroke();
    ctx.fillStyle = opt.color || 'rgba(175,203,255,.88)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 1);
    ctx.restore();
  };

  /* 错题卡（红 ✗） */
  Q.wrongCard = (ctx, x, y, rot, scale, u = 1) => {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot); ctx.scale(scale, scale);
    const w = 300, h = 86;
    ctx.globalAlpha = u;
    ctx.fillStyle = '#101E38';
    roundRect(ctx, -w / 2, -h / 2, w, h, 14); ctx.fill();
    ctx.strokeStyle = 'rgba(255,154,143,.4)'; ctx.lineWidth = 2;
    roundRect(ctx, -w / 2, -h / 2, w, h, 14); ctx.stroke();
    /* ✗ 标记 */
    ctx.strokeStyle = C.warn; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 24, -12); ctx.lineTo(-w / 2 + 48, 12);
    ctx.moveTo(-w / 2 + 48, -12); ctx.lineTo(-w / 2 + 24, 12);
    ctx.stroke();
    /* 假文行 */
    ctx.fillStyle = 'rgba(232,240,255,.25)';
    for (let i = 0; i < 3; i++) roundRect(ctx, -w / 2 + 70, -20 + i * 20, [180, 150, 96][i], 8, 4), ctx.fill();
    ctx.restore();
  };

  /* 速度线 */
  Q.speedlines = (ctx, x, y, ang, len, k, opt = {}) => {
    const r = rng(opt.seed || 11);
    ctx.save();
    ctx.strokeStyle = opt.color || 'rgba(143,192,255,.5)';
    ctx.lineCap = 'round';
    for (let i = 0; i < k; i++) {
      const off = (r() - 0.5) * (opt.spread || 120);
      const l = len * (0.4 + r() * 0.8);
      const a = 0.15 + r() * 0.4;
      ctx.globalAlpha = a; ctx.lineWidth = 2 + r() * 3;
      const ox = Math.cos(ang + Math.PI / 2) * off, oy = Math.sin(ang + Math.PI / 2) * off;
      ctx.beginPath();
      ctx.moveTo(x + ox - Math.cos(ang) * l, y + oy - Math.sin(ang) * l);
      ctx.lineTo(x + ox, y + oy);
      ctx.stroke();
    }
    ctx.restore();
  };

  /* 眩晕小星（dizzy 时绕头） */
  Q.dizzyStars = (ctx, x, y, t, r = 46) => {
    for (let i = 0; i < 3; i++) {
      const a = t * 5.2 + (i * 6.283) / 3;
      const px = x + Math.cos(a) * r * 1.7;
      const py = y - r * 1.15 + Math.sin(a) * r * 0.42;
      ctx.save();
      ctx.translate(px, py); ctx.rotate(a);
      ctx.fillStyle = C.gold;
      star4(ctx, 0, 0, 7, 3);
      ctx.restore();
    }
  };

  function star4(ctx, cx, cy, R, r2) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const ang = (i * Math.PI) / 4 - Math.PI / 2;
      const rr = i % 2 === 0 ? R : r2;
      const px = cx + Math.cos(ang) * rr, py = cy + Math.sin(ang) * rr;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill();
  }
  Q.star4 = star4;

  window.QK = Q;
})();
