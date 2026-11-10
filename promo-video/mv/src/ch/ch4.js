/* CH4 名（24–32s）：impact 落点 · 粒子汇聚成原子 logo —— 副歌 1 爆发 */
(() => {
  const { C, seg, lerp, out, io, clamp01, popText, fadeRange, vignette, flash, shake } = window.TL;
  const QK = window.QK;
  const IMG = () => window.IMG || {};

  /* 原子轨道：三条椭圆（rx, ry, 旋转角, 电子相位, 电子角速度） */
  const ORBITS = [
    { rx: 200, ry: 74, rot: -0.52, ph: 0.0, sp: 2.6 },
    { rx: 268, ry: 98, rot: 0.38, ph: 2.1, sp: -2.0 },
    { rx: 152, ry: 56, rot: 1.18, ph: 4.2, sp: 3.3 },
  ];
  const CX = 960, CY = 470, QR = 54;

  window.CH = window.CH || {};
  window.CH[4] = {
    t0: 24, dur: 8,
    draw(ctx, t) {
      /* 极光背景淡入 */
      const bgU = seg(t, 24.0, 26.2);
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, 1920, 1080);
      const aur = IMG().aurora;
      if (aur && aur.complete) {
        ctx.save();
        ctx.globalAlpha = 0.9 * bgU;
        const s = Math.max(1920 / aur.naturalWidth, 1080 / aur.naturalHeight);
        ctx.drawImage(aur, (1920 - aur.naturalWidth * s) / 2, (1080 - aur.naturalHeight * s) / 2, aur.naturalWidth * s, aur.naturalHeight * s);
        ctx.restore();
      }
      ctx.fillStyle = `rgba(6,12,26,${0.5 + 0.12 * bgU})`; ctx.fillRect(0, 0, 1920, 1080);

      ctx.save();
      shake(ctx, t, 24.0, 9, 24);
      flash(ctx, 1 - Math.min(1, (t - 24.0) / 0.06));
      QK.ring(ctx, CX, CY, t, 24.02, { r0: 60, r1: 980, dur: 0.9, w0: 26, alpha: 0.9 });
      QK.burst(ctx, CX, CY, t, 24.0, { n: 26, speed: 900, dur: 0.9, color: C.bluePale, seed: 4 });

      /* Q 仔 = 原子核 */
      QK.draw(ctx, CX, CY, QR, t, { mood: 'happy', glow: 0.9 + 0.25 * Math.sin(t * 3.1), antenna: 1 });

      /* 轨道绘制（描边生长）+ 电子 */
      ORBITS.forEach((o, i) => {
        const draw = seg(t, 24.55 + i * 0.28, 25.9 + i * 0.28);
        if (draw <= 0) return;
        ctx.save();
        ctx.translate(CX, CY); ctx.rotate(o.rot);
        ctx.strokeStyle = 'rgba(175,203,255,.5)'; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(0, 0, o.rx, o.ry, 0, -Math.PI / 2, -Math.PI / 2 + 6.283 * io(draw));
        ctx.stroke();
        /* 电子 */
        const ea = t > 26.4 ? o.ph + o.sp * (t - 26.4) : o.ph;
        const ex = Math.cos(ea) * o.rx, ey = Math.sin(ea) * o.ry;
        ctx.fillStyle = C.blueSoft;
        ctx.shadowColor = 'rgba(143,192,255,.9)'; ctx.shadowBlur = 18;
        ctx.beginPath(); ctx.arc(ex, ey, 9, 0, 7); ctx.fill();
        ctx.restore();
        /* 尾迹电子 */
        for (let k = 1; k <= 3; k++) {
          const ta = ea - o.sp * k * 0.09;
          ctx.save(); ctx.translate(CX, CY); ctx.rotate(o.rot);
          ctx.globalAlpha = 0.4 * (1 - k / 4);
          ctx.fillStyle = C.blueSoft;
          ctx.beginPath(); ctx.arc(Math.cos(ta) * o.rx, Math.sin(ta) * o.ry, 6, 0, 7); ctx.fill();
          ctx.restore();
        }
      });

      /* 31.5 一颗电子被甩出（CH5 惯性入场的前奏） */
      const fling = seg(t, 31.5, 32.0);
      if (fling > 0 && fling < 1) {
        ctx.fillStyle = C.blueSoft;
        ctx.shadowColor = 'rgba(143,192,255,.9)'; ctx.shadowBlur = 16;
        ctx.beginPath(); ctx.arc(lerp(CX - 260, -80, out(fling)), lerp(CY - 60, 420, out(fling)), 9, 0, 7); ctx.fill();
        ctx.shadowColor = 'transparent';
      }

      /* 品牌名：PhysicsOS */
      popText(ctx, 'PhysicsOS', 960, 768, t, 27.5, {
        size: 158, step: 0.085,
        color: (i) => (i >= 7 ? C.blueSoft : C.white),
        glow: 'rgba(37,99,235,.5)',
      });
      /* 定位句 */
      if (fadeRange(t, 29.9, 31.9, 0.35, 0.25) > 0) {
        ctx.save(); ctx.globalAlpha = fadeRange(t, 29.9, 31.9, 0.35, 0.25);
        popText(ctx, '把物理，变成一间实验室', 960, 892, t, 29.9, { size: 54, color: 'rgba(232,240,255,.92)' });
        ctx.restore();
      }
      ctx.restore();
      vignette(ctx, 0.42);
    },
  };
})();
