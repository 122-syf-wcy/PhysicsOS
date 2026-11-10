/* CH2 憾（8–16s）：错题卡层层堆叠，掩埋 Q 仔 —— verse1 收尾 */
(() => {
  const { C, seg, lerp, out, outBack, clamp01, rng, popText, fadeRange, vignette } = window.TL;
  const QK = window.QK;

  /* 卡墙布局：5 行 × 3 列，行号越大越靠下（堆叠从地面起） */
  const ROWS = [];
  {
    const r = rng(33);
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        ROWS.push({
          /* 中间列第 1 行起右移 170：给 Q 仔头顶的天线留出缝 */
          x: 420 + col * 540 + (col === 1 && row >= 1 ? 170 : 0) + (r() - 0.5) * 60,
          y: 806 - row * 96,
          rot: (r() - 0.5) * 0.16,
          t0: 9.6 + row * 0.85 + col * 0.16 + r() * 0.1,   /* 自下而上逐层堆 */
        });
      }
    }
  }
  const QX = 960, QY = 812, QR = 46;

  window.CH = window.CH || {};
  window.CH[2] = {
    t0: 8, dur: 8,
    draw(ctx, t) {
      const lt = t - 8; /* 章内 0..8 */
      ctx.fillStyle = C.bgDeep; ctx.fillRect(0, 0, 1920, 1080);
      ctx.strokeStyle = 'rgba(143,192,255,.14)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(120, 880); ctx.lineTo(1800, 880); ctx.stroke();

      /* 残余公式雨：减速并沉降 */
      const slow = 1 - seg(t, 8, 10.5);
      if (slow > 0.02) {
        const r = rng(21);
        for (let i = 0; i < 20; i++) {
          const x = 90 + r() * 1740, speed = 300 + r() * 340, off = r() * 1400;
          const y = ((8 * speed + off) % 1360) - 160 + seg(t, 8, 11) * (120 + r() * 220) * slow;
          if (y < 860) {
            ctx.globalAlpha = slow;
            QK.formulaCard(ctx, x, y, Math.sin(t * 0.9 + r() * 6) * 0.12, 1, QK.FORMULAS[i % 20], { size: 30 });
            ctx.globalAlpha = 1;
          }
        }
      }

      /* Q 仔（先画，让卡压在身上） */
      QK.draw(ctx, QX, QY, QR, t, { mood: t < 12 ? 'dizzy' : 'sleep', glow: 0.1 });

      /* 卡墙（自下而上出现） */
      for (const c of ROWS) {
        const u = seg(t, c.t0, c.t0 + 0.42);
        if (u > 0) QK.wrongCard(ctx, c.x, c.y - lerp(180, 0, out(u)), c.rot, outBack(u));
      }

      /* 天线尖在墙顶闪烁（被埋中，从缝里露头求救） */
      const buried = t > 11.4;
      if (buried) {
        const bl = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 6));
        ctx.save();
        ctx.globalAlpha = clamp01(seg(t, 11.4, 12)) * (t > 15.4 ? 1 - seg(t, 15.4, 15.9) : 1);
        ctx.strokeStyle = 'rgba(175,203,255,.9)'; ctx.lineWidth = 4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(960, 772); ctx.lineTo(962, 744); ctx.stroke();
        ctx.fillStyle = `rgba(175,203,255,${0.4 + 0.6 * bl})`;
        ctx.beginPath(); ctx.arc(962, 738, 6, 0, 7); ctx.fill();
        const gg = ctx.createRadialGradient(962, 738, 0, 962, 738, 26);
        gg.addColorStop(0, `rgba(175,203,255,${0.5 * bl})`); gg.addColorStop(1, 'rgba(175,203,255,0)');
        ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(962, 738, 26, 0, 7); ctx.fill();
        ctx.restore();
      }

      /* 口号 */
      if (fadeRange(t, 8.8, 12.6, 0.3, 0.4) > 0) {
        ctx.save(); ctx.globalAlpha = fadeRange(t, 8.8, 12.6, 0.3, 0.4);
        popText(ctx, '公式背得滚瓜烂熟', 960, 250, t, 8.8, { size: 62 });
        ctx.restore();
      }
      if (fadeRange(t, 13.0, 15.8, 0.3, 0.25) > 0) {
        ctx.save(); ctx.globalAlpha = fadeRange(t, 13.0, 15.8, 0.3, 0.25);
        popText(ctx, '可它长什么样，从没见过', 960, 250, t, 13.0, { size: 62, color: (i) => (i >= 9 ? C.blueSoft : C.white) });
        ctx.restore();
      }
      vignette(ctx, 0.62);
    },
  };
})();
