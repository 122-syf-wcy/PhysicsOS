/* CH7 题（64–80s）：题卡瀑布 + 计数 1→80 + 正确率爬升 —— 副歌 2 */
(() => {
  const { C, seg, lerp, out, io, outBack, clamp01, rng, popText, fadeRange, vignette, roundRect, font, mono, flash, shake } = window.TL;
  const QK = window.QK;

  const CATS = ['力学', '运动学', '电学', '磁学', '光学', '热学', '能量', '综合'];
  /* 瀑布列（背景层） */
  const COLS = [];
  {
    const r = rng(64);
    for (let i = 0; i < 7; i++) {
      COLS.push({ x: 60 + i * 285 + r() * 60, speed: 620 + r() * 480, off: r() * 1400, n: 1 + Math.floor(r() * 80) });
    }
  }
  /* 曲线区 */
  const GX0 = 1130, GX1 = 1820, GY0 = 800, GY1 = 320;

  window.CH = window.CH || {};
  window.CH[7] = {
    t0: 64, dur: 16,
    draw(ctx, t) {
      ctx.fillStyle = C.bgDeep; ctx.fillRect(0, 0, 1920, 1080);
      /* 章首压暗（6→7 切换缓冲） */
      const dip = 1 - seg(t, 64.0, 64.4);
      if (dip > 0) { ctx.fillStyle = `rgba(6,13,29,${0.85 * dip})`; ctx.fillRect(0, 0, 1920, 1080); }

      /* 题卡瀑布（背景，暗化） */
      ctx.save();
      ctx.globalAlpha = t < 70 ? 0.55 : Math.max(0, 0.55 * (1 - seg(t, 70, 71)));
      const r = rng(64);
      for (let i = 0; i < 7; i++) {
        const x = 60 + i * 285 + r() * 60, speed = 620 + r() * 480, off = r() * 1400;
        for (let k = 0; k < 3; k++) {
          const y = ((t * speed + off + k * 470) % 1560) - 240;
          cardRow(ctx, x, y, 240, i);
        }
      }
      ctx.restore();

      /* 分类 chips（顶部，随节拍轮换高亮） */
      if (t < 71) {
        const hi = Math.floor((t - 64.6) / 0.75) % CATS.length;
        CATS.forEach((c, i) => {
          const u = clamp01(seg(t, 64.5 + i * 0.05, 64.9 + i * 0.05));
          const on = i === hi;
          const x = 210 + i * 190, y = 132;
          ctx.save();
          ctx.translate(x, y);
          ctx.scale(lerp(0.7, on ? 1.12 : 1, outBack(u)), lerp(0.7, on ? 1.12 : 1, outBack(u)));
          ctx.font = font(26, 700); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillStyle = on ? C.blue : 'rgba(16,30,56,.9)';
          roundRect(ctx, -82, -30, 164, 60, 30); ctx.fill();
          ctx.strokeStyle = on ? 'rgba(143,192,255,.9)' : 'rgba(143,192,255,.22)'; ctx.lineWidth = 2;
          roundRect(ctx, -82, -30, 164, 60, 30); ctx.stroke();
          ctx.fillStyle = on ? '#fff' : 'rgba(232,240,255,.6)';
          ctx.fillText(c, 0, 1);
          ctx.restore();
        });
      }

      /* 计数器（左，大数字） */
      if (t < 70.6) {
        const u = io(seg(t, 64.7, 69.6));
        const n = 1 + Math.floor(79 * u);
        const land = t > 69.6 ? outBack(clamp01((t - 69.6) / 0.4)) : 1;
        ctx.save();
        ctx.translate(560, 560);
        ctx.scale(1 + 0.04 * Math.max(0, land - 1 + 0.04), 1);
        ctx.font = mono(150, 800); ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillStyle = C.white;
        ctx.shadowColor = 'rgba(37,99,235,.45)'; ctx.shadowBlur = 30;
        const num = String(n).padStart(2, '0');
        ctx.fillText(num, 60, -30);
        ctx.shadowColor = 'transparent';
        ctx.font = font(44, 700); ctx.textAlign = 'left';
        ctx.fillStyle = 'rgba(232,240,255,.75)';
        ctx.fillText('/ 80 题', 86, -18);
        ctx.font = font(30, 600);
        ctx.fillStyle = 'rgba(232,240,255,.5)';
        ctx.fillText('内置黄金题库 · 完整遍历', -215, 66);
        ctx.restore();
        if (t >= 69.6 && t < 69.7) flash(ctx, 0.25);
        QK.ring(ctx, 560, 540, t, 69.62, { r0: 60, r1: 420, dur: 0.5, alpha: 0.5 });
      }

      /* 正确率曲线（右，70–76 爬升，Q 仔冲浪） */
      if (t >= 69.8) {
        const au = seg(t, 70.2, 75.6);
        /* 坐标轴 */
        ctx.strokeStyle = 'rgba(143,192,255,.4)'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(GX0, GY1 - 20); ctx.lineTo(GX0, GY0); ctx.lineTo(GX1 + 10, GY0); ctx.stroke();
        ctx.font = font(26, 700); ctx.fillStyle = 'rgba(232,240,255,.55)';
        ctx.fillText('正确率', GX0 - 10, GY1 - 44);
        /* 网格线 */
        ctx.strokeStyle = 'rgba(143,192,255,.12)'; ctx.lineWidth = 1.5;
        [0.25, 0.5, 0.75, 1].forEach((v) => {
          const y = GY0 - (GY0 - GY1) * v;
          ctx.beginPath(); ctx.moveTo(GX0, y); ctx.lineTo(GX1, y); ctx.stroke();
        });
        /* 曲线（起点 55% → 90%） */
        const prog = io(au);
        const yAt = (u) => GY0 - (GY0 - GY1) * lerp(0.55, 0.9, io(u));
        ctx.save();
        const grad = ctx.createLinearGradient(0, GY1, 0, GY0);
        grad.addColorStop(0, 'rgba(78,140,255,.4)'); grad.addColorStop(1, 'rgba(78,140,255,0)');
        ctx.beginPath();
        ctx.moveTo(GX0, yAt(0));
        for (let s = 0; s <= 100; s++) ctx.lineTo(GX0 + (GX1 - GX0) * (s / 100), yAt(s / 100) - Math.sin(s / 100 * 9) * 6);
        ctx.lineTo(GX0 + (GX1 - GX0) * prog, yAt(prog) - Math.sin(prog * 9) * 6);
        ctx.strokeStyle = C.blueHi; ctx.lineWidth = 6; ctx.lineCap = 'round';
        ctx.shadowColor = 'rgba(37,99,235,.7)'; ctx.shadowBlur = 22;
        ctx.stroke();
        ctx.shadowColor = 'transparent';
        ctx.lineTo(GX0 + (GX1 - GX0) * prog, GY0); ctx.lineTo(GX0, GY0); ctx.closePath();
        ctx.fillStyle = grad; ctx.fill();
        ctx.restore();
        /* 冲浪的 Q 仔（冲完后在终点庆祝跳动） */
        if (au > 0.01 && au < 1) {
          const hx = GX0 + (GX1 - GX0) * prog, hy = yAt(prog) - Math.sin(prog * 9) * 6;
          QK.trail(ctx, (tt) => {
            const p = io(seg(tt, 70.2, 75.6));
            return { x: GX0 + (GX1 - GX0) * p, y: yAt(p) - Math.sin(p * 9) * 6 };
          }, 42, t, 8, 0.05);
          QK.draw(ctx, hx, hy - 46, 42, t, { mood: 'happy', tilt: -0.2, glow: 0.6, stretch: 0.1 });
        } else if (t >= 75.6 && t < 80) {
          /* 曲线冲顶后：Q 仔在终点庆祝弹跳 + 鼓点填充处光环 */
          const bt = t - 75.6;
          const hop = Math.abs(Math.sin(bt * 6.283 * 1.2)) * Math.exp(-(((bt % 0.833) - 0.42) ** 2) * 8) * 26;
          const ex = GX1 - 26, ey = yAt(1) - 6 - hop - 46;
          QK.draw(ctx, ex, ey, 42, t, { mood: 'happy', glow: 0.5 + 0.2 * Math.sin(t * 6), squash: hop > 20 ? 0.15 : 0 });
          for (const ft of [78.2, 78.5, 78.8]) QK.ring(ctx, ex, ey + 46, t, ft, { r0: 14, r1: 130, dur: 0.45, alpha: 0.55, w0: 8 });
        }
        /* 90% 标签 */
        if (au >= 0.999 || t > 75.7) {
          const u2 = outBack(clamp01((t - 75.7) / 0.45));
          ctx.save();
          ctx.translate(GX1 - 90, yAt(1) - 74);
          ctx.scale(u2, u2);
          ctx.font = mono(52, 800); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillStyle = C.ok;
          ctx.shadowColor = 'rgba(127,232,154,.6)'; ctx.shadowBlur = 24;
          ctx.fillText('90%', 0, 0);
          ctx.restore();
        }
      }

      /* 口号 */
      if (fadeRange(t, 64.8, 69.6, 0.3, 0.3) > 0) {
        ctx.save(); ctx.globalAlpha = fadeRange(t, 64.8, 69.6, 0.3, 0.3);
        popText(ctx, '80 道黄金题，一题一实验', 960, 960, t, 64.8, { size: 56 });
        ctx.restore();
      }
      if (fadeRange(t, 76.4, 79.7, 0.3, 0.2) > 0) {
        ctx.save(); ctx.globalAlpha = fadeRange(t, 76.4, 79.7, 0.3, 0.2);
        popText(ctx, '错过的坑，不再二踩', 640, 960, t, 76.4, { size: 56, color: C.blueSoft });
        ctx.restore();
      }
      vignette(ctx, 0.45);
    },
  };

  /* 题卡（瀑布单元） */
  function cardRow(ctx, x, y, w, seedI) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(16,30,56,.92)';
    roundRect(ctx, 0, 0, w, 116, 14); ctx.fill();
    ctx.strokeStyle = 'rgba(143,192,255,.2)'; ctx.lineWidth = 1.5;
    roundRect(ctx, 0, 0, w, 116, 14); ctx.stroke();
    ctx.fillStyle = C.blue;
    roundRect(ctx, 16, 16, 52, 52, 12); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = font(24, 800); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String((seedI * 7) % 80 + 1), 42, 43);
    ctx.fillStyle = 'rgba(232,240,255,.3)';
    roundRect(ctx, 84, 22, w - 108, 10, 5); ctx.fill();
    roundRect(ctx, 84, 44, w - 148, 10, 5); ctx.fill();
    roundRect(ctx, 84, 66, w - 180, 10, 5); ctx.fill();
    ctx.fillStyle = 'rgba(242,169,59,.8)'; ctx.font = font(18, 700); ctx.textAlign = 'right';
    ctx.fillText(['基础', '巩固', '挑战'][seedI % 3], w - 18, 30);
    ctx.restore();
  }
})();
