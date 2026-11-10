/* CH6 教（48–64s）：真实解题录屏 cameo + AI 对话气泡 + 17/17 徽章 —— verse2 */
(() => {
  const { C, seg, lerp, out, outBack, clamp01, popText, fadeRange, vignette, chip, winFrame, roundRect, font, mono } = window.TL;
  const QK = window.QK;

  /* AI 推导气泡（节拍弹入） */
  const BUBBLES = [
    { t0: 52.0, txt: '读取题面 → 提取已知量' },
    { t0: 53.5, txt: '受力分析：洛伦兹力提供向心力' },
    { t0: 55.0, txt: 'qvB = mv² / r' },
    { t0: 56.5, txt: 'r = mv / qB ✓' },
  ];
  const WX = 150, WY = 210, WW = 950, WH = 590;

  window.CH = window.CH || {};
  window.CH[6] = {
    t0: 48, dur: 16,
    draw(ctx, t) {
      ctx.fillStyle = C.bgMid; ctx.fillRect(0, 0, 1920, 1080);

      /* 章首压暗（5→6 场景切换的缓冲） */
      const dip = 1 - seg(t, 48.0, 48.45);
      if (dip > 0) { ctx.fillStyle = `rgba(6,13,29,${0.85 * dip})`; ctx.fillRect(0, 0, 1920, 1080); }

      /* 真实解题窗口（sol-frames cameo） */
      const solIdx = clamp01((t - 48) / 11) * 329;                    /* 48–59 滚动，之后停在末帧 */
      const solImg = window.SOLGET ? window.SOLGET(Math.floor(solIdx)) : null;
      winFrame(ctx, solImg, WX, WY, WW, WH, seg(t, 48.25, 48.8), { url: 'physics.dongsiwei.com', contentBg: '#0E1B33' });

      /* 窗口左下角「真实录屏」角标（无演示造假口径） */
      if (t > 49) {
        ctx.save();
        ctx.globalAlpha = clamp01(seg(t, 49, 49.4));
        ctx.font = font(24, 700);
        const tag = '· 真实会话回放';
        const w = ctx.measureText(tag).width + 30;
        ctx.fillStyle = 'rgba(61,148,66,.92)';
        roundRect(ctx, WX + 18, WY + 44 + WH - 56, w, 42, 21); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
        ctx.fillText(tag, WX + 33, WY + 44 + WH - 34);
        ctx.restore();
      }

      /* Q 仔坐在窗口右上沿，戴学者帽随打字点头 */
      if (t > 49.2) {
        const nod = (t >= 52 && t < 57.5) ? Math.sin((t - 52) * 12.566) * 0.09 * Math.exp(-((t - 54.75) ** 2) * -0.2) : 0;
        QK.draw(ctx, WX + WW - 120, WY - 6, 40, t, {
          mood: 'focus', cap: clamp01(seg(t, 49.4, 49.9)), glow: 0.4,
          tilt: Math.sin((t - 52) * 6.283) * (t >= 52 && t < 57.5 ? 0.07 : 0),
        });
      }

      /* 右侧 AI 气泡 */
      BUBBLES.forEach((b, i) => {
        const u = seg(t, b.t0, b.t0 + 0.45);
        if (u <= 0) return;
        const y = 300 + i * 128;
        const fade = t > 62 ? 1 - seg(t, 62, 63) : 1;
        if (fade <= 0) return;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(1210 + lerp(70, 0, outBack(u)), y);
        ctx.scale(outBack(u), outBack(u));
        ctx.font = font(31, 600);
        const w = ctx.measureText(b.txt).width + 96;
        ctx.fillStyle = 'rgba(16,30,56,.96)';
        roundRect(ctx, 0, -52, w, 92, 18); ctx.fill();
        ctx.strokeStyle = i === 3 ? 'rgba(127,232,154,.55)' : 'rgba(143,192,255,.3)'; ctx.lineWidth = 2;
        roundRect(ctx, 0, -52, w, 92, 18); ctx.stroke();
        /* AI 头标点 */
        ctx.fillStyle = C.blue;
        ctx.beginPath(); ctx.arc(46, -6, 19, 0, 7); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = font(21, 800); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('AI', 46, -5);
        ctx.fillStyle = i === 3 ? C.ok : 'rgba(232,240,255,.92)';
        ctx.font = font(31, 700); ctx.textAlign = 'left';
        ctx.fillText(b.txt, 82, -5);
        ctx.restore();
      });

      /* 17/17 徽章（58.0 ding） */
      if (t > 58) {
        const u = seg(t, 58.0, 58.5);
        const pulse = 1 + 0.05 * Math.sin((t - 58) * 9) * Math.exp(-(t - 58) * 1.4);
        ctx.save();
        ctx.translate(1490, 880);
        ctx.scale(outBack(u) * pulse, outBack(u) * pulse);
        ctx.font = font(34, 800);
        const txt = '引擎校验 17 / 17 · 全部通过';
        const w = ctx.measureText(txt).width + 92;
        ctx.shadowColor = 'rgba(61,148,66,.5)'; ctx.shadowBlur = 34; ctx.shadowOffsetY = 10;
        ctx.fillStyle = 'rgba(43,122,48,.96)';
        roundRect(ctx, -w / 2, -46, w, 92, 46); ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.strokeStyle = 'rgba(187,227,188,.8)'; ctx.lineWidth = 2.5;
        roundRect(ctx, -w / 2, -46, w, 92, 46); ctx.stroke();
        ctx.fillStyle = C.ok;
        ctx.beginPath(); ctx.arc(-w / 2 + 44, 0, 15, 0, 7); ctx.fill();
        ctx.fillStyle = '#0B2A10'; ctx.font = font(22, 900); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('✓', -w / 2 + 44, 1);
        ctx.fillStyle = '#fff'; ctx.font = font(34, 800); ctx.textAlign = 'left';
        ctx.fillText(txt, -w / 2 + 72, 0);
        ctx.restore();
      }

      /* 口号 */
      if (fadeRange(t, 49.0, 55.6, 0.3, 0.3) > 0) {
        ctx.save(); ctx.globalAlpha = fadeRange(t, 49.0, 55.6, 0.3, 0.3);
        popText(ctx, 'AI 教练，一步步推', 1210, 200, t, 49.0, { size: 50 });
        ctx.restore();
      }
      if (fadeRange(t, 58.3, 63.6, 0.3, 0.3) > 0) {
        ctx.save(); ctx.globalAlpha = fadeRange(t, 58.3, 63.6, 0.3, 0.3);
        popText(ctx, '17 步引擎验证 · 17/17', 1210, 200, t, 58.3, { size: 50, color: C.bluePale });
        ctx.restore();
      }
      vignette(ctx, 0.45);
    },
  };
})();
