/* CH5 玩（32–48s）：Q 仔亲历四个实验场景 + 真实生产截图 cameo —— 副歌 1 */
(() => {
  const { C, seg, lerp, out, io, in: easeIn, outBack, clamp01, rng, popText, fadeRange, vignette, chip, winFrame, flash, shake, roundRect, font } = window.TL;
  const QK = window.QK;
  const IMG = () => window.IMG || {};
  const FLOOR = 880;

  window.CH = window.CH || {};
  window.CH[5] = {
    t0: 32, dur: 16,
    draw(ctx, t) {
      /* 背景：延续 CH4 极光（无缝），略压暗 */
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, 1920, 1080);
      const aur = IMG().aurora;
      if (aur && aur.complete) {
        const s = Math.max(1920 / aur.naturalWidth, 1080 / aur.naturalHeight);
        ctx.drawImage(aur, (1920 - aur.naturalWidth * s) / 2, (1080 - aur.naturalHeight * s) / 2, aur.naturalWidth * s, aur.naturalHeight * s);
      }
      ctx.fillStyle = 'rgba(6,12,26,.58)'; ctx.fillRect(0, 0, 1920, 1080);

      /* cameo 窗口（46.5 起，真实生产截图） */
      if (t >= 46.3) {
        const fade = seg(t, 46.3, 46.7);
        ctx.save(); ctx.globalAlpha = fade;
        ctx.fillStyle = 'rgba(6,12,26,.5)'; ctx.fillRect(0, 0, 1920, 1080);
        ctx.restore();
        winFrame(ctx, IMG().exp, 165, 250, 760, 470, seg(t, 46.5, 47.0), { url: 'physics.dongsiwei.com' });
        winFrame(ctx, IMG().cir, 995, 250, 760, 470, seg(t, 47.0, 47.5), { url: 'physics.dongsiwei.com' });
        if (fadeRange(t, 47.4, 47.95, 0.3, 0.1) > 0) {
          ctx.save(); ctx.globalAlpha = fadeRange(t, 47.4, 47.95, 0.3, 0.1);
          popText(ctx, '12 大类，每个都能亲手调', 960, 920, t, 47.4, { size: 56 });
          ctx.restore();
        }
        vignette(ctx, 0.4);
        return;
      }

      /* 地面 */
      ctx.strokeStyle = 'rgba(143,192,255,.35)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(140, FLOOR); ctx.lineTo(1780, FLOOR); ctx.stroke();
      ctx.strokeStyle = 'rgba(143,192,255,.12)'; ctx.lineWidth = 1.5;
      for (let i = 1; i <= 5; i++) { const y = FLOOR + i * 34; ctx.beginPath(); ctx.moveTo(lerp(140, 420, i / 5), y); ctx.lineTo(lerp(1780, 1500, i / 5), y); ctx.stroke(); }

      /* ---------- S1 斜面滑下（32–36） ---------- */
      if (t < 36) {
        chip(ctx, '抛体与斜面', 150, 130, seg(t, 32.15, 32.5));
        /* 斜面 */
        ctx.fillStyle = 'rgba(20,36,66,.9)';
        ctx.beginPath(); ctx.moveTo(640, FLOOR); ctx.lineTo(1520, FLOOR); ctx.lineTo(1520, 540); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(143,192,255,.45)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(640, FLOOR); ctx.lineTo(1520, 540); ctx.stroke();
        /* 沿斜面参数 */
        const ax = 640, ay = FLOOR, bx = 1520, by = 540;
        const ang = Math.atan2(by - ay, bx - ax);
        const u = easeIn(seg(t, 32.35, 35.3));                     /* 匀加速 */
        const px = lerp(bx, ax, 1 - u) === 0 ? bx : lerp(bx, ax + 60, 0) + 0; /* 占位防呆 */
        const sx = lerp(bx - 46, ax + 90, u), sy = lerp(by - 46 * Math.sin(ang) * 0 - 46, ay - 46, u) + 0;
        /* 上面两行简化：直接用插值 */
        const qx = lerp(bx - 50, ax + 74, u);
        const qy = lerp(by - 32, ay - 40, u);
        const posAt = (tt) => {
          const uu = easeIn(seg(tt, 32.35, 35.3));
          return { x: lerp(bx - 50, ax + 74, uu), y: lerp(by - 32, ay - 40, uu) };
        };
        QK.trail(ctx, posAt, 46, t, 7, 0.05);
        QK.speedlines(ctx, qx, qy, ang + Math.PI, 260, 6, { seed: 12, spread: 90 });
        QK.draw(ctx, qx, qy, 46, t, { tilt: ang * 0.6, mood: 'happy', glow: 0.5, stretch: u * 0.12 });
        /* 速度箭头（长度∝速度） */
        const v = 40 + 240 * u;
        arrow(ctx, qx, qy - 86, ang, v, `v`, C.blueSoft);
        /* g 箭头 */
        arrow(ctx, 1560, 620, Math.PI / 2, 120, 'g', C.gold);
        if (fadeRange(t, 34.2, 35.7, 0.25, 0.25) > 0) {
          ctx.save(); ctx.globalAlpha = fadeRange(t, 34.2, 35.7, 0.25, 0.25);
          popText(ctx, '亲手拖参数，看它动起来', 960, 260, t, 34.2, { size: 52 });
          ctx.restore();
        }
      }

      /* ---------- S2 圆周运动（36–40） ---------- */
      if (t >= 36 && t < 40) {
        chip(ctx, '圆周运动', 150, 130, seg(t, 36.15, 36.5));
        const cx = 960, cy = 560, R = 265;
        /* 虚线圆轨道 */
        ctx.save();
        ctx.strokeStyle = 'rgba(143,192,255,.5)'; ctx.lineWidth = 3; ctx.setLineDash([14, 12]);
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
        ctx.restore();
        /* 磁场标记 × */
        ctx.strokeStyle = 'rgba(175,203,255,.4)'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
        const rr = rng(55);
        for (let i = 0; i < 14; i++) {
          const mx = 300 + rr() * 1320, my = 300 + rr() * 520;
          if (Math.hypot(mx - cx, my - cy) < R + 90) continue;
          ctx.beginPath(); ctx.moveTo(mx - 9, my - 9); ctx.lineTo(mx + 9, my + 9); ctx.moveTo(mx + 9, my - 9); ctx.lineTo(mx - 9, my + 9); ctx.stroke();
        }
        /* 圆心 */
        ctx.fillStyle = C.blueSoft;
        ctx.beginPath(); ctx.arc(cx, cy, 10, 0, 7); ctx.fill();
        const a0 = -Math.PI / 2;
        const turns = 1.5;
        const u = seg(t, 36.35, 39.7);
        const ea = a0 + turns * 6.283 * u;
        const posAt = (tt) => ({ x: cx + Math.cos(a0 + turns * 6.283 * seg(tt, 36.35, 39.7)) * R, y: cy + Math.sin(a0 + turns * 6.283 * seg(tt, 36.35, 39.7)) * R });
        const px = posAt(t).x, py = posAt(t).y;
        /* 半径杆 */
        ctx.strokeStyle = 'rgba(143,192,255,.4)'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(px, py); ctx.stroke();
        ctx.font = font(34, 800); ctx.fillStyle = C.blueSoft; ctx.textAlign = 'center';
        ctx.fillText('r', (cx + px) / 2 + 26, (cy + py) / 2 - 16);
        QK.trail(ctx, posAt, 44, t, 9, 0.045);
        QK.draw(ctx, px, py, 44, t, { tilt: ea + Math.PI / 2, mood: 'happy', glow: 0.5 });
        /* 切向速度箭头 */
        const vt = ea + Math.PI / 2;
        arrow(ctx, px + Math.cos(vt) * 62, py + Math.sin(vt) * 62, vt, 130, 'v', C.blueSoft);
        if (fadeRange(t, 37.6, 39.4, 0.25, 0.25) > 0) {
          ctx.save(); ctx.globalAlpha = fadeRange(t, 37.6, 39.4, 0.25, 0.25);
          popText(ctx, 'qvB = mv² / r', 960, 250, t, 37.6, { size: 60, color: C.bluePale, glow: 'rgba(78,140,255,.4)' });
          ctx.restore();
        }
      }

      /* ---------- S3 弹性碰撞（40–44） ---------- */
      if (t >= 40 && t < 44) {
        chip(ctx, '弹性碰撞', 150, 130, seg(t, 40.15, 40.5));
        ctx.save();
        shake(ctx, t, 41.55, 7);
        const hitT = 41.55;
        const meet = 960;
        /* Q 从左，红球从右，等质量弹性：碰后速度交换 */
        const vq = (620 - 260) / 1.55; /* px/s 到达相遇点 */
        const qx = t < hitT ? lerp(340, meet - 46, seg(t, 40.35, hitT)) : meet - 46;
        const rx = t < hitT ? lerp(1580, meet + 46, seg(t, 40.35, hitT)) : meet + 46 + 620 * out(seg(t, hitT, 43.6));
        /* 红球 */
        const rg = ctx.createRadialGradient(rx - 12, FLOOR - 62 - 12, 4, rx, FLOOR - 62, 48);
        rg.addColorStop(0, '#FFB9A3'); rg.addColorStop(1, '#D9534F');
        ctx.fillStyle = rg;
        ctx.beginPath(); ctx.arc(rx, FLOOR - 46, 44, 0, 7); ctx.fill();
        if (t > hitT) QK.trail(ctx, (tt) => ({ x: meet + 46 + 620 * out(seg(tt, hitT, 43.6)), y: FLOOR - 46 }), 40, t, 6, 0.04, 'rgba(255,154,143,');
        /* Q：碰后小幅后坐并停住 */
        const qbx = t > hitT ? qx - 26 * Math.exp(-(t - hitT) * 6) * Math.cos((t - hitT) * 18) : qx;
        QK.draw(ctx, t > hitT ? meet - 46 - 20 : qx, FLOOR - 46, 46, t, {
          squash: t > hitT ? 0.4 * Math.exp(-(t - hitT) * 5) : 0,
          mood: t > hitT ? 'wow' : 'focus', glow: 0.5,
        });
        /* 撞击闪光 */
        if (t >= hitT && t < hitT + 0.09) flash(ctx, 0.5);
        QK.burst(ctx, meet, FLOOR - 52, t, hitT, { n: 18, speed: 420, dur: 0.6, color: C.bluePale, seed: 8 });
        QK.ring(ctx, meet, FLOOR - 52, t, hitT, { r0: 20, r1: 300, dur: 0.5 });
        /* 动量标签 */
        ctx.font = font(30, 700); ctx.fillStyle = 'rgba(232,240,255,.55)';
        ctx.fillText('m₁v₁ + m₂v₂ = 守恒', 830, FLOOR + 60);
        if (fadeRange(t, 42.3, 43.7, 0.25, 0.25) > 0) {
          ctx.save(); ctx.globalAlpha = fadeRange(t, 42.3, 43.7, 0.25, 0.25);
          popText(ctx, '碰撞前后，动量说话', 960, 250, t, 42.3, { size: 52 });
          ctx.restore();
        }
        ctx.restore();
      }

      /* ---------- S4 凸透镜聚焦（44–46.5） ---------- */
      if (t >= 44 && t < 46.5) {
        chip(ctx, '凸透镜聚焦', 150, 130, seg(t, 44.15, 44.5));
        const cx = 900, cy = 560;
        /* 透镜 */
        const lg = ctx.createLinearGradient(cx - 46, 0, cx + 46, 0);
        lg.addColorStop(0, 'rgba(143,192,255,.1)'); lg.addColorStop(0.5, 'rgba(175,225,255,.55)'); lg.addColorStop(1, 'rgba(143,192,255,.1)');
        ctx.fillStyle = lg;
        ctx.beginPath(); ctx.ellipse(cx, cy, 52, 215, 0, 0, 7); ctx.fill();
        ctx.strokeStyle = 'rgba(175,225,255,.7)'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.ellipse(cx, cy, 52, 215, 0, 0, 7); ctx.stroke();
        /* 平行光 → 焦点 */
        const fx = 1330;
        const rays = [-150, -75, 0, 75, 150];
        rays.forEach((ry, i) => {
          const u = seg(t, 44.3 + i * 0.06, 44.9 + i * 0.06);
          ctx.strokeStyle = 'rgba(255,226,150,.75)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(lerp(560, 300, 1), cy + ry);
          ctx.lineTo(lerp(560, cx, u), cy + ry);
          if (u >= 1) {
            const u2 = seg(t, 44.9 + i * 0.06, 45.5 + i * 0.06);
            ctx.lineTo(lerp(cx, fx, u2), lerp(cy + ry, cy, u2));
          }
          ctx.stroke();
        });
        /* 焦点上的 Q 仔：越点越亮 */
        const glow = seg(t, 45.2, 46.4);
        QK.draw(ctx, fx, cy, 46, t, { mood: 'wow', glow: 0.4 + glow * 1.5, antenna: 1 });
        ctx.font = font(32, 800); ctx.fillStyle = C.gold; ctx.textAlign = 'center';
        ctx.fillText('F', fx, cy + 108);
        if (fadeRange(t, 45.3, 46.3, 0.25, 0.15) > 0) {
          ctx.save(); ctx.globalAlpha = fadeRange(t, 45.3, 46.3, 0.25, 0.15);
          popText(ctx, '光的路径，看得见', 960, 250, t, 45.3, { size: 52 });
          ctx.restore();
        }
      }

      vignette(ctx, 0.42);
    },
  };

  /* 带标签的速度/加速度箭头 */
  function arrow(ctx, x, y, ang, len, label, color) {
    const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.shadowColor = color; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
    const a1 = ang + 2.62, a2 = ang - 2.62;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex + Math.cos(a1) * 20, ey + Math.sin(a1) * 20);
    ctx.lineTo(ex + Math.cos(a2) * 20, ey + Math.sin(a2) * 20);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.font = font(30, 800); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, ex + Math.cos(ang) * 26, ey + Math.sin(ang) * 26);
    ctx.restore();
  }
})();
