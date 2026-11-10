/* CH1 痛（0–8s）：公式雨砸落，Q 仔被「？」击中 —— verse1 压抑开场 */
(() => {
  const { C, seg, lerp, out, in: easeIn, clamp01, rng, popText, fadeRange, font, shake, vignette, BEAT } = window.TL;
  const QK = window.QK;

  /* 公式雨列（固定种子确定性） */
  const COLS = [];
  {
    const r = rng(21);
    for (let i = 0; i < 20; i++) {
      COLS.push({
        x: 90 + r() * 1740,
        speed: 300 + r() * 340,
        off: r() * 1400,
        txt: QK.FORMULAS[i % QK.FORMULAS.length],
        wob: 0.5 + r() * 1.4,
        ph: r() * 6.28,
        sz: 28 + r() * 12,
      });
    }
  }
  const QX = 960, QY = 812, QR = 46;

  window.CH = window.CH || {};
  window.CH[1] = {
    t0: 0, dur: 8,
    draw(ctx, t) {
      ctx.fillStyle = C.bgDeep; ctx.fillRect(0, 0, 1920, 1080);
      /* 地平线 */
      ctx.strokeStyle = 'rgba(143,192,255,.14)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(120, 880); ctx.lineTo(1800, 880); ctx.stroke();

      ctx.save();
      shake(ctx, t, 5.0, 7);
      /* 公式雨 */
      for (const c of COLS) {
        const y = ((t * c.speed + c.off) % 1360) - 160;
        QK.formulaCard(ctx, c.x + Math.sin(t * c.wob + c.ph) * 16, y, Math.sin(t * 0.9 + c.ph) * 0.12, 1, c.txt, { size: c.sz });
      }

      /* 「？」大卡：4.0 起从天而降，5.0 命中 */
      const qu = seg(t, 4.0, 5.0);
      if (qu > 0 && qu < 1) {
        QK.formulaCard(ctx, QX, lerp(-120, QY - 96, easeIn(qu)), 0.06, 2.1, '？', { size: 64, bg: 'rgba(60,16,28,.95)', border: 'rgba(255,154,143,.55)', color: C.warn });
      }
      if (qu >= 1 && t < 6.4) {
        const settle = seg(t, 5.0, 5.35);
        ctx.globalAlpha = 1 - seg(t, 5.7, 6.3);
        QK.formulaCard(ctx, QX, QY - 96 + out(settle) * 0, Math.sin(t * 14) * (1 - settle) * 0.2, 2.1, '？', { size: 64, bg: 'rgba(60,16,28,.95)', border: 'rgba(255,154,143,.55)', color: C.warn });
        ctx.globalAlpha = 1;
      }

      /* Q 仔：5.0 被砸扁 → 缓慢恢复，晕星绕头 */
      const hit = seg(t, 5.0, 6.6);
      QK.trail(ctx, (tt) => ({ x: QX, y: QY }), QR, t, 0, 0); /* 静止：无残影 */
      QK.draw(ctx, QX, QY, QR, t, {
        squash: (1 - hit) * 0.72,
        mood: t > 5.0 && t < 7.6 ? 'dizzy' : 'normal',
        glow: 0.15,
      });
      if (t > 5.05 && t < 7.4) QK.dizzyStars(ctx, QX, QY - 6, t, QR);
      if (t >= 5.0 && t < 5.6) QK.burst(ctx, QX, QY - 70, t, 5.0, { n: 14, color: C.warn, speed: 260, dur: 0.55, seed: 5 });

      /* 口号 */
      if (fadeRange(t, 0.8, 4.6, 0.3, 0.4) > 0) {
        ctx.save(); ctx.globalAlpha = fadeRange(t, 0.8, 4.6, 0.3, 0.4);
        popText(ctx, '同一道题，刷了三遍', 960, 250, t, 0.8, { size: 62 });
        ctx.restore();
      }
      if (fadeRange(t, 5.7, 7.9, 0.3, 0.25) > 0) {
        ctx.save(); ctx.globalAlpha = fadeRange(t, 5.7, 7.9, 0.3, 0.25);
        popText(ctx, '换个数字——又不会了', 960, 250, t, 5.7, { size: 62, color: (i, n) => (i >= 7 ? C.warn : C.white) });
        ctx.restore();
      }
      ctx.restore();
      vignette(ctx, 0.6);
    },
  };
})();
