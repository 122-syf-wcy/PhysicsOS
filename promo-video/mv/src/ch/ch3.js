/* CH3 转（16–24s）：光柱劈开卡墙，Q 仔苏醒升起 —— build + riser */
(() => {
  const { C, seg, lerp, out, io, outBack, clamp01, rng, popText, fadeRange, vignette, flash, shake } = window.TL;
  const QK = window.QK;

  /* 与 CH2 同源的卡墙终态（全部就位） */
  const ROWS = [];
  {
    const r = rng(33);
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        ROWS.push({
          x: 420 + col * 540 + (col === 1 && row >= 1 ? 170 : 0) + (r() - 0.5) * 60,
          y: 806 - row * 96,
          rot: (r() - 0.5) * 0.16,
          dx: (r() - 0.5) * 900, dy: -300 - r() * 700, dr: (r() - 0.5) * 7,   /* 吹散参数 */
        });
      }
    }
  }
  /* 汇聚粒子（从四周奔向 Q 仔） */
  const CONV = [];
  {
    const r = rng(77);
    for (let i = 0; i < 26; i++) {
      const ang = r() * 6.283, rad = 620 + r() * 560;
      CONV.push({
        x0: 960 + Math.cos(ang) * rad, y0: 540 + Math.sin(ang) * rad,
        t0: 16.4 + r() * 4.2, dur: 2.4 + r() * 1.6, sz: 2 + r() * 4,
      });
    }
  }

  window.CH = window.CH || {};
  window.CH[3] = {
    t0: 16, dur: 8,
    draw(ctx, t) {
      ctx.fillStyle = C.bgDeep; ctx.fillRect(0, 0, 1920, 1080);
      ctx.strokeStyle = 'rgba(143,192,255,.14)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(120, 880); ctx.lineTo(1800, 880); ctx.stroke();

      ctx.save();
      shake(ctx, t, 20.0, 6);
      /* 光柱（17.0 起） */
      const beam = seg(t, 17.0, 18.6);
      if (beam > 0 && t < 20.6) {
        const w = 130 * beam * (t > 20 ? 1 + (t - 20) * 3 : 1);
        ctx.save();
        ctx.globalAlpha = 0.9 * (t > 20 ? Math.max(0, 1 - (t - 20) * 2.4) : 1);
        const g = ctx.createLinearGradient(960 - w / 2, 0, 960 + w / 2, 0);
        g.addColorStop(0, 'rgba(143,192,255,0)'); g.addColorStop(0.5, 'rgba(175,225,255,.75)'); g.addColorStop(1, 'rgba(143,192,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(960 - 26 * beam, 0); ctx.lineTo(960 + 26 * beam, 0);
        ctx.lineTo(960 + w / 2, 900); ctx.lineTo(960 - w / 2, 900); ctx.closePath(); ctx.fill();
        ctx.restore();
      }

      /* 裂纹（18.8 起，从墙面中心炸开） */
      const crack = seg(t, 18.8, 19.9);
      if (crack > 0 && t < 20.1) {
        ctx.save();
        ctx.strokeStyle = `rgba(175,225,255,${0.85 * Math.min(1, crack * 2)})`;
        ctx.lineWidth = 3; ctx.lineCap = 'round';
        const r = rng(99);
        for (let k = 0; k < 7; k++) {
          let px = 960, py = 740;
          ctx.beginPath(); ctx.moveTo(px, py);
          const ang = -Math.PI / 2 + (k - 3) * 0.42 + (r() - 0.5) * 0.3;
          const len = (150 + r() * 260) * crack;
          ctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len * 0.8);
          ctx.lineTo(px + Math.cos(ang) * len + Math.cos(ang + 0.5) * 70 * crack, py + Math.sin(ang) * len * 0.8 + Math.sin(ang + 0.5) * 56 * crack);
          ctx.stroke();
        }
        ctx.restore();
      }

      /* 卡墙：20.0 前静止，20.0 后径向吹散消散 */
      const blow = seg(t, 20.0, 20.85);
      for (const c of ROWS) {
        if (blow <= 0) { QK.wrongCard(ctx, c.x, c.y, c.rot, 1); continue; }
        if (blow >= 1) break;
        QK.wrongCard(ctx, c.x + c.dx * out(blow), c.y + c.dy * out(blow) + 460 * blow * blow, c.rot + c.dr * out(blow), 1 - blow);
      }

      /* 闪白劈开 */
      flash(ctx, 1 - Math.min(1, (t - 20.0) / 0.09));

      /* Q 仔：20.2 破土 → 升起到 (960,540)，苏醒发光 */
      if (t > 20.2) {
        const rise = io(seg(t, 20.2, 22.6));
        const qy = lerp(812, 540, rise);
        QK.draw(ctx, 960, qy, 46, t, {
          stretch: Math.sin(Math.min(1, rise) * Math.PI) * 0.3,
          mood: t < 21.4 ? 'sleep' : 'wow',
          glow: 0.3 + 0.6 * seg(t, 20.6, 23),
          antenna: seg(t, 21, 22.5),
        });
        QK.ring(ctx, 960, qy, t, 21.0, { r0: 40, r1: 420, dur: 0.8 });
      } else {
        /* 仍被埋：只画天线尖（呼应 CH2） */
        QK.draw(ctx, 960, 812, 46, t, { mood: 'sleep', glow: 0.15, alpha: 1 });
        if (t <= 20.2) { /* 卡墙盖着 */ }
      }

      /* 汇聚粒子 */
      for (const p of CONV) {
        const u = out(seg(t, p.t0, p.t0 + p.dur));
        if (u <= 0 || u >= 1) continue;
        const px = lerp(p.x0, 960, u), py = lerp(p.y0, lerp(540, 812, 1 - Math.min(1, (22.6 - p.t0) / 6)), Math.min(1, u));
        ctx.globalAlpha = Math.sin(u * Math.PI) * 0.9;
        ctx.fillStyle = C.bluePale;
        ctx.beginPath(); ctx.arc(px, py, p.sz, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;

      /* 口号 */
      if (fadeRange(t, 17.2, 20.4, 0.3, 0.3) > 0) {
        ctx.save(); ctx.globalAlpha = fadeRange(t, 17.2, 20.4, 0.3, 0.3);
        popText(ctx, '如果每道题', 960, 250, t, 17.2, { size: 62 });
        ctx.restore();
      }
      if (fadeRange(t, 21.0, 23.8, 0.3, 0.2) > 0) {
        ctx.save(); ctx.globalAlpha = fadeRange(t, 21.0, 23.8, 0.3, 0.2);
        popText(ctx, '都能亲眼看见呢？', 960, 250, t, 21.0, { size: 70, color: C.blueSoft, glow: 'rgba(78,140,255,.55)' });
        ctx.restore();
      }
      ctx.restore();
      vignette(ctx, 0.55);
    },
  };
})();
