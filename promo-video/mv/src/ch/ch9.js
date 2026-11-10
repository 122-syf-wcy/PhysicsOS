/* CH9 召（88–96s）：域名大条 + 弹性碰撞彩蛋 + 落款 —— outro 定音收束 */
(() => {
  const { C, seg, lerp, out, io, outBack, bounceOut, clamp01, popText, fadeRange, vignette, font, mono, roundRect, flash, shake } = window.TL;
  const QK = window.QK;
  const IMG = () => window.IMG || {};

  const BX = 960, BY = 520;   /* 域名条中心 */
  const BAR_W = 1330, BAR_H = 158;

  window.CH = window.CH || {};
  window.CH[9] = {
    t0: 88, dur: 8,
    draw(ctx, t) {
      /* 星域延续（比 CH8 更沉） */
      ctx.fillStyle = C.bgDeep; ctx.fillRect(0, 0, 1920, 1080);
      const cos = IMG().cosmos;
      if (cos && cos.complete) {
        ctx.save(); ctx.globalAlpha = 0.85 - 0.3 * seg(t, 93, 95.5);
        const s = Math.max(1920 / cos.naturalWidth, 1080 / cos.naturalHeight);
        ctx.drawImage(cos, (1920 - cos.naturalWidth * s) / 2, (1080 - cos.naturalHeight * s) / 2, cos.naturalWidth * s, cos.naturalHeight * s);
        ctx.restore();
      }
      ctx.fillStyle = `rgba(6,12,26,${0.5 + 0.15 * seg(t, 93, 95.5)})`; ctx.fillRect(0, 0, 1920, 1080);
      window.TL.stars(ctx, t, 7, 70, 0.9);

      ctx.save();
      shake(ctx, t, 91.0, 6, 22);

      /* 域名大条（88.6 ding 落版） */
      const u = clamp01((t - 88.6) / 0.55);
      if (u > 0) {
        ctx.save();
        ctx.translate(BX, BY);
        const sc = outBack(u) * (1 + 0.009 * Math.sin(t * 3.14));   /* 微呼吸，避免落版后死寂 */
        ctx.scale(sc, sc);
        ctx.shadowColor = 'rgba(37,99,235,.55)'; ctx.shadowBlur = 70; ctx.shadowOffsetY = 18;
        ctx.fillStyle = 'rgba(13,26,50,.92)';
        roundRect(ctx, -BAR_W / 2, -BAR_H / 2, BAR_W, BAR_H, BAR_H / 2); ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.strokeStyle = 'rgba(143,192,255,.6)'; ctx.lineWidth = 3;
        roundRect(ctx, -BAR_W / 2, -BAR_H / 2, BAR_W, BAR_H, BAR_H / 2); ctx.stroke();
        /* 锁形 HTTPS 标 */
        ctx.strokeStyle = C.ok; ctx.lineWidth = 5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(-BAR_W / 2 + 128, -14, 16, Math.PI, 0); ctx.stroke();
        ctx.fillStyle = C.ok;
        roundRect(ctx, -BAR_W / 2 + 108, -14, 40, 34, 8); ctx.fill();
        /* 域名 */
        ctx.font = mono(92, 800);
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = C.white;
        ctx.shadowColor = 'rgba(37,99,235,.4)'; ctx.shadowBlur = 26;
        ctx.fillText('physics.dongsiwei.com', 46, 2);
        ctx.shadowColor = 'transparent';
        /* 光标闪烁（89.8–92.4） */
        if (t > 89.8 && t < 92.4 && Math.floor((t - 89.8) * 2) % 2 === 0) {
          ctx.fillStyle = C.blueSoft;
          ctx.fillRect(46 + 610, -46, 8, 92);
        }
        ctx.restore();
      }

      /* Q 仔弹性碰撞入场：90.3 从左侧飞入 → 91.0 撞条 → 弹跳两次 → 落座条右上 */
      const qIn = seg(t, 90.3, 91.0);
      if (qIn > 0) {
        let qx, qy, opt = { mood: 'happy', glow: 0.6 };
        if (t < 91.0) {
          qx = lerp(-90, BX - BAR_W / 2 + 60, out(qIn));
          qy = lerp(360, BY - BAR_H / 2 - 40, out(qIn)) - Math.sin(qIn * Math.PI) * 60;
          opt.stretch = 0.3;
        } else {
          const bt = t - 91.0;
          const bx = BX - BAR_W / 2 + 60;
          /* 三段弹跳落位到条右上 */
          const settle = bounceOut(clamp01(bt / 2.1));
          qx = lerp(bx, BX + BAR_W / 2 - 92, settle);
          const arc = Math.abs(Math.sin(bt * 5.2)) * 120 * Math.exp(-bt * 1.9);
          qy = (BY - BAR_H / 2 - 40) - arc;
          opt.squash = 0.5 * Math.exp(-bt * 5.5) * (bt < 0.25 ? 1 : 0.2);
          if (bt > 1.2) opt.mood = 'normal';
        }
        QK.trail(ctx, (tt) => {
          if (tt < 91.0) { const k = out(seg(tt, 90.3, 91.0)); return { x: lerp(-90, BX - BAR_W / 2 + 60, k), y: lerp(360, BY - BAR_H / 2 - 40, k) - Math.sin(k * Math.PI) * 60 }; }
          const b = tt - 91.0;
          const st2 = bounceOut(clamp01(b / 2.1));
          return { x: lerp(BX - BAR_W / 2 + 60, BX + BAR_W / 2 - 92, st2), y: (BY - BAR_H / 2 - 40) - Math.abs(Math.sin(b * 5.2)) * 120 * Math.exp(-b * 1.9) };
        }, 44, t, 7, 0.045);
        QK.draw(ctx, qx, qy, 44, t, opt);
      }
      /* 碰撞效果 */
      if (t >= 91.0 && t < 91.09) flash(ctx, 0.35);
      QK.burst(ctx, BX - BAR_W / 2 + 60, BY - BAR_H / 2 - 10, t, 91.0, { n: 16, speed: 360, dur: 0.55, seed: 9 });
      QK.ring(ctx, BX - BAR_W / 2 + 60, BY - BAR_H / 2 - 10, t, 91.02, { r0: 20, r1: 330, dur: 0.5, alpha: 0.6 });

      /* 落款 */
      if (fadeRange(t, 92.8, 95.3, 0.5, 0.1) > 0) {
        ctx.save(); ctx.globalAlpha = fadeRange(t, 92.8, 95.3, 0.5, 0.1);
        popText(ctx, '让看不见的物理，被看见', 960, 764, t, 92.8, { size: 60, color: 'rgba(232,240,255,.95)' });
        ctx.restore();
      }
      ctx.restore();

      /* 全片收尾渐暗 */
      const fade = seg(t, 95.1, 96);
      if (fade > 0) { ctx.fillStyle = `rgba(6,13,29,${fade})`; ctx.fillRect(0, 0, 1920, 1080); }
      vignette(ctx, 0.5);
    },
  };
})();
