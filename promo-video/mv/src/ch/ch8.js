/* CH8 义（80–88s）：星域 + 公益开源大字 —— bridge 恢弘 */
(() => {
  const { C, seg, lerp, out, clamp01, rng, popText, fadeRange, vignette, font, mono, roundRect } = window.TL;
  const QK = window.QK;
  const IMG = () => window.IMG || {};

  /* 上升微光粒子 */
  const SPARKS = [];
  {
    const r = rng(88);
    for (let i = 0; i < 18; i++) SPARKS.push({ x: r() * 1920, sp: 26 + r() * 44, ph: r() * 6.28, sz: 1.5 + r() * 2.6 });
  }

  window.CH = window.CH || {};
  window.CH[8] = {
    t0: 80, dur: 8,
    draw(ctx, t) {
      /* 深底 → 星域渐显（延续 CH7 的 bgDeep，无缝） */
      ctx.fillStyle = C.bgDeep; ctx.fillRect(0, 0, 1920, 1080);
      const u = seg(t, 80.0, 82.2);
      const cos = IMG().cosmos;
      if (cos && cos.complete) {
        ctx.save(); ctx.globalAlpha = 0.95 * u;
        const s = Math.max(1920 / cos.naturalWidth, 1080 / cos.naturalHeight);
        ctx.drawImage(cos, (1920 - cos.naturalWidth * s) / 2, (1080 - cos.naturalHeight * s) / 2, cos.naturalWidth * s, cos.naturalHeight * s);
        ctx.restore();
      }
      ctx.fillStyle = `rgba(6,12,26,${0.42})`; ctx.fillRect(0, 0, 1920, 1080);
      window.TL.stars(ctx, t, 7, 80, seg(t, 80.5, 82));

      /* 上升微光 */
      for (const s of SPARKS) {
        const y = 1120 - ((t * s.sp + s.ph * 120) % 1240);
        ctx.globalAlpha = 0.24 + 0.22 * Math.sin(t * 1.8 + s.ph);
        ctx.fillStyle = C.bluePale;
        ctx.beginPath(); ctx.arc(s.x + Math.sin(t * 0.7 + s.ph) * 18, y, s.sz, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;

      /* Q 仔悬浮呼吸 */
      const bob = Math.sin(t * 1.3) * 12;
      QK.draw(ctx, 960, 322 + bob, 50, t, {
        mood: 'normal', glow: 0.5 + 0.25 * Math.sin(t * 1.9), antenna: 1,
      });

      /* 大字两行 */
      popText(ctx, '纯公益 · 永久免费', 960, 556, t, 80.8, { size: 112, step: 0.11, glow: 'rgba(37,99,235,.45)' });

      /* 开源徽标 pill */
      if (t > 83.4) {
        const u = out(clamp01((t - 83.4) / 0.5));
        ctx.save();
        ctx.translate(960, 716);
        ctx.scale(u, u);
        ctx.font = mono(46, 700);
        const txt = '开源 · Apache-2.0';
        const w = ctx.measureText(txt).width + 108;
        ctx.strokeStyle = 'rgba(143,192,255,.75)'; ctx.lineWidth = 3;
        ctx.fillStyle = 'rgba(16,30,56,.55)';
        roundRect(ctx, -w / 2, -44, w, 88, 44); ctx.fill(); ctx.stroke();
        ctx.fillStyle = C.bluePale; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(txt, 0, 1);
        ctx.restore();
      }

      vignette(ctx, 0.5);
    },
  };
})();
