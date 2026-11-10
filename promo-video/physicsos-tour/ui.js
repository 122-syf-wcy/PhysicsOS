// PhysicsOS redrawn in HTML/SVG from the live site (physics.dongsiwei.com, captured 2026-11-06/07).
// Every function: state → HTML string, deterministic. Coordinates inside pages are the product's 1920×1080 viewport.
export const WIN = { x: 96, y: 36, w: 1728, h: 1012, tb: 40 };
export const S = 0.9;                                    // page → window scale
export const W2 = (px, py) => ({ x: WIN.x + px * S, y: WIN.y + WIN.tb + py * S });

// front view of the projectile bench (page px): ground line, platform, metres → px
export const BENCH = { x0: 525, y0: 245, w: 883, h: 540, ground: 704, platL: 650, platW: 62, k: 20 };
export const BALL_R = 22 / S;                            // the ball (11 px × 4 world px) as a radius in page px
export const launchPt = h => ({ x: BENCH.platL + BENCH.platW - BALL_R + 4, y: BENCH.ground - h * BENCH.k - BALL_R });
export const ballAt = (h, v0, tau) => { const L = launchPt(h); return { x: L.x + v0 * tau * BENCH.k, y: L.y + 4.9 * tau * tau * BENCH.k, vx: v0, vy: 9.8 * tau }; };

const I = {
  plusc: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  home: '<circle cx="12" cy="12" r="8.5"/><path d="M10.5 8.5 14 12l-3.5 3.5"/>',
  flask: '<path d="M9.5 3.5h5M10.5 3.5V9L5.6 18.4A1.6 1.6 0 0 0 7 20.7h10a1.6 1.6 0 0 0 1.4-2.3L13.5 9V3.5"/><path d="M7.6 15h8.8"/>',
  doc: '<path d="M7 3.5h7l4 4V20.5H7z"/><path d="M14 3.5v4h4M9.8 12.5h5M9.8 16h5"/>',
  mega: '<path d="M4.5 10v4h3l5.5 4V6L7.5 10z"/><path d="M16.5 9.2a4 4 0 0 1 0 5.6"/>',
  book: '<path d="M3.5 5.5h6a2.5 2.5 0 0 1 2.5 2.5v12a2 2 0 0 0-2-2H3.5z"/><path d="M20.5 5.5h-6A2.5 2.5 0 0 0 12 8v12a2 2 0 0 1 2-2h6.5z"/>',
  upload: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M17.5 8.5v7M14.8 11.2l2.7-2.7 2.7 2.7"/>',
  plug: '<path d="M9 3.5v4M15 3.5v4M7 7.5h10v3a5 5 0 0 1-10 0z"/><path d="M12 15.5v5"/>',
  chat: '<path d="M4.5 5.5h15v10.5H10l-5.5 4z"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  chevd: '<path d="M7 10l5 5 5-5"/>', chevl: '<path d="M14.5 6.5 9 12l5.5 5.5"/>', chevr: '<path d="M9.5 6.5 15 12l-5.5 5.5"/>',
  panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15"/>', search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  play: '<path d="M8.5 6v12l9.5-6z" fill="currentColor"/>', playo: '<path d="M9 6.5v11l9-5.5z"/>',
  playc: '<circle cx="12" cy="12" r="8.5"/><path d="M10.3 8.7v6.6l5.2-3.3z" fill="currentColor" stroke="none"/>',
  replay: '<path d="M5 12a7 7 0 1 0 2.1-5"/><path d="M5 4.5V8h3.5"/>', pause: '<circle cx="12" cy="12" r="8.5"/><path d="M10.2 9v6M13.8 9v6"/>',
  reset: '<path d="M19 12a7 7 0 1 1-2.1-5"/><path d="M19 4.5V8h-3.5"/>', guide: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11.2v5M12 8h.01"/>',
  report: '<path d="M6.5 3.5h11v17h-11z"/><path d="M9.5 8h5M9.5 11.5h5M9.5 15h3"/>', focus: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  more: '<circle cx="6" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18" cy="12" r="1.2" fill="currentColor"/>',
  up: '<path d="M12 18.5v-13M6.5 11 12 5.5 17.5 11"/>', shield: '<path d="M12 3.5 18.5 6v5.5c0 4.2-2.7 7.2-6.5 8.8-3.8-1.6-6.5-4.6-6.5-8.8V6z"/><path d="m9.2 12 2 2 3.8-3.8"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', arrowr: '<path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5"/>', ext: '<path d="M8 16 16 8M10 8h6v6"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="m15.2 8.8-1.9 4.5-4.5 1.9 1.9-4.5z"/>', folder: '<path d="M3.5 6.5h6l2 2h9v10.5h-17z"/>',
  box: '<rect x="5" y="7" width="14" height="10" rx="1.5"/><path d="M9 7V5h6v2"/>', arrowd: '<path d="M12 4v16M7 15l5 5 5-5"/>', lines: '<path d="M4 15h16M7 11h10"/>',
  slash: '<path d="M4 18h3l9-12h4"/>', diag: '<path d="M5 19 19 5M13 5h6v6"/>', back: '<path d="M14.5 6.5 9 12l5.5 5.5"/>', fwd: '<path d="M9.5 6.5 15 12l-5.5 5.5"/>',
  wifi: '<path d="M3.5 9.5a12 12 0 0 1 17 0M6.5 12.8a7.5 7.5 0 0 1 11 0M9.5 16a3 3 0 0 1 5 0"/><circle cx="12" cy="19" r=".9" fill="currentColor"/>',
  batt: '<rect x="2.5" y="7.5" width="17" height="9" rx="2.2"/><rect x="4.5" y="9.5" width="11" height="5" rx="1" fill="currentColor"/><path d="M21.5 10.5v3"/>',
  file: '<path d="M7 3.5h7l4 4V20.5H7z"/><path d="M14 3.5v4h4"/>', zip: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 4v6M10.5 6h3M10.5 8h3"/>', user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  reload: '<path d="M18.5 12a6.5 6.5 0 1 1-1.9-4.6"/><path d="M18.5 4.5v3.5H15"/>', share: '<path d="M12 4v11M8 8l4-4 4 4M6 12v7h12v-7"/>', tabs: '<rect x="4" y="6" width="12" height="12" rx="2"/><path d="M8 4h10a2 2 0 0 1 2 2v10"/>',
};
export const ic = (n, s = 16, sw = 1.7) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${I[n]}</svg>`;
const st = (o = {}) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}:${v}`).join(';');
const abs = (x, y, w, h, extra = '') => `left:${x}px;top:${y}px;${w !== undefined ? `width:${w}px;` : ''}${h !== undefined ? `height:${h}px;` : ''}${extra}`;
const K = s => `<span class="ki">${s}</span>`;           // KaTeX math italic
const KB = s => `<span class="kb">${s}</span>`;          // KaTeX bold (vectors)
const KM = s => `<span class="km">${s}</span>`;

/* ───────── desktop (time-of-day wallpaper + menu bar clock) + browser window */
export function world(F) {
  const P = { ec: () => ec(F.ec || {}), lab: () => lab(F.lab), home: () => home(F.home || {}), chat: () => chat(F.chat || {}), trace: () => trace(F.trace || {}),
    exam: () => exam(F.exam || {}), lib: () => lib(F.lib || {}), upload: () => upload(F.upload || {}) };
  const page = (P[F.page] ? P[F.page]() : '') + side(F.side || {});
  const W = F.wall || { day: 1 }, night = W.night || 0;
  const ink = night > .5 ? '#E8EDF7' : '#1F2328';
  return `<div class="wall" style="background-image:url(assets/wallpaper.jpg);opacity:1"></div>
  ${W.dusk ? `<div class="wall" style="background-image:url(assets/wallpaper-dusk.jpg);opacity:${W.dusk.toFixed(3)}"></div>` : ''}
  ${night ? `<div class="wall" style="background-image:url(assets/wallpaper-night.jpg);opacity:${night.toFixed(3)}"></div>` : ''}
  <div class="mbar" style="color:${ink}"><span class="mb-r">${ic('wifi', 15)}${ic('batt', 18)}<b data-a="clock">${F.clock || '周一 07:30'}</b></span></div>
  <div class="win" style="${abs(WIN.x, WIN.y, WIN.w, WIN.h)}">
    <div class="tbar"><div class="lights"><i></i><i></i><i></i></div>
      <span class="navb" style="left:78px">${ic('back', 17)}</span><span class="navb" style="left:106px;opacity:.45">${ic('fwd', 17)}</span><span class="navb" style="left:136px">${ic('reload', 15)}</span>
      <div class="addr" data-a="addr"><img src="assets/mark.png"><span>physics.dongsiwei.com</span></div>
      <span class="navb" style="left:${WIN.w - 70}px">${ic('share', 16)}</span><span class="navb" style="left:${WIN.w - 40}px">${ic('tabs', 16)}</span></div>
    <div class="content"><div class="page">${page}</div></div>
    ${F.dim ? `<div class="dim" style="opacity:${F.dim.toFixed(3)}"></div>` : ''}
  </div>`;
}

/* ───────── sidebar (shared by every page) */
const RECENT = [['水平面（极缓斜面）上受摩擦减速到停止', '18 分钟前'], ['磁场中的带电粒子运动', '1 天前'], ['凸透镜成像规律', '1 天前'], ['匀速直线运动', '1 天前'],
  ['光电效应', '1 天前'], ['磁通量变化产生感应电流', '1 天前'], ['导轨双棒 · 恒力型', '1 天前'], ['导轨双棒 · 冲量型', '1 天前']];
const HISTORY = [['匀速运动路程计算题', '1 天前'], ['圆筒与无人机运动问题', '5 天前'], ['两弹簧物块升降距离求解', '5 天前'], ['洛伦兹力为何不做功', '6 天前']];
function side(Sd) {
  const nav = [['home', '首页', 'home', 150], ['lab', '物理实验室', 'flask', 228], ['exam', '出卷专区', 'doc', 268], ['fb', '反馈', 'mega', 308],
    ['lib', '资源库', 'book', 348], ['up', '实验上传', 'upload', 388], ['plug', '插件', 'plug', 428]];
  const recent = (Sd.recent || (Sd.newRecent ? [[Sd.newRecent, '刚刚']] : []).concat(RECENT)).slice(0, 8);
  const hist = (Sd.newHist ? [Array.isArray(Sd.newHist) ? Sd.newHist : [Sd.newHist, '刚刚']] : []).concat(HISTORY).slice(0, 5);
  let h = `<div class="side">
    <div class="brand"><span class="mk" data-a="logo"><img src="assets/mark.png">${Sd.logoFx || ''}</span><div><b data-a="brandname">PhysicsOS</b><small>PhysicsOS 开放学校</small></div></div>
    <span class="sic" style="left:242px;top:22px">${ic('panel', 17)}</span>
    <div class="newc" data-a="newc">${ic('plusc', 15)}<span>新会话</span></div>
    <div class="sec" style="top:124px">主页</div><span class="sic" style="left:244px;top:122px">${ic('chevd', 14)}</span>
    <div class="sec" style="top:202px">探索</div><span class="sic" style="left:244px;top:200px">${ic('chevd', 14)}</span>`;
  for (const [k, label, icon, y] of nav) {
    const cls = Sd.active === k ? ' on' : Sd.hover === k ? ' hov' : '';
    h += `<div class="it${cls}" data-a="nav-${k}" style="top:${y}px">${ic(icon, 16)}<span>${label}</span></div>`;
  }
  h += `<div class="sec" style="top:484px">最近空间</div>`;
  recent.forEach(([t, tm], i) => { h += `<div class="rs${(Sd.newRecent && i === 0 && Sd.recentOn) || Sd.recentOnName === t ? ' on' : ''}${Sd.recentHover === t ? ' hv' : ''}" data-a="rs-${t}" style="top:${502 + i * 33}px">${ic('flask', 14)}<span class="t">${t}</span><span class="tag">实验</span><span class="tm">${tm}</span></div>`; });
  h += `<div class="sec" style="top:778px">历史对话</div>`;
  hist.forEach(([t, tm], i) => { h += `<div class="rs${Sd.newHist && i === 0 && Sd.histOn !== false ? ' on' : ''}" style="top:${796 + i * 33}px">${ic('chat', 14)}<span class="t">${t}</span><span class="tm">${tm}</span></div>`; });
  h += `<div class="who"><span class="av">演</span><span>演示账号</span></div><div class="it" style="top:1032px;height:34px">${ic('gear', 16)}<span>设置</span></div></div>`;
  return h;
}

/* ───────── 实验中心 (experiment center) */
const TABS = [['全部', null], ['力学', '#2F9E5A'], ['光学', '#CA8A04'], ['声学', '#0284C7'], ['机械波', '#DB2777'], ['浮力与压强', '#0891B2'], ['热学', '#DC2626'],
  ['电场', '#2563EB'], ['磁场', '#7C3AED'], ['电路', '#0D9488'], ['复合场', '#EA580C'], ['电磁感应', '#4338CA'], ['近代物理', '#61666B']];
export const TAB_X = [528, 582, 649, 716, 783, 862, 965, 1032, 1099, 1166, 1233, 1312, 1403];
export const TAB_W = [48, 61, 61, 61, 73, 97, 61, 61, 61, 61, 73, 85, 85];
export const CARDS = [
  ['uniform-linear', '匀速直线运动', '恒定速度 · a = 0', '初中'], ['average-speed', '测量平均速度', '斜面小车 · v̄ = s/t 分段测量', '初中'],
  ['uniform-acceleration', '匀变速直线运动', '恒定加速度 · a = 1.5 m/s²', '高中'], ['projectile-horizontal', '平抛运动', '水平抛出 · h = 20 m · v<sub>0</sub> = 10 m/s', '高中'],
  ['projectile-oblique', '斜抛运动', '抛射角 40° · v<sub>0</sub> = 20 m/s', '高中']];
const CARDS2 = ['newton-second-law', 'incline', 'mechanical-energy', 'ramp-friction', 'lever-balance'];
export const CARD = { x0: 528, dx: 232, y: 761, w: 218, h: 252 };
// the launch ball inside the 平抛运动 thumbnail (art is 512², shown as object-fit:cover in 192×120 at card +13,+13)
export const THUMB_BALL = { x: 13 + 150.5 * .375, y: 13 + (195.5 - 96) * .375, r: 9.5 * .375 };

function ec(E) {
  let h = `<div class="ec">
    <div class="ecav" style="${abs(528, 30, 78, 78)}"><img src="assets/mascot-wave-320.webp"></div>
    <div class="ectitle" style="${abs(620, 24)}">实验中心</div>
    <div class="ecsub" style="${abs(620, 72)}">从一个模板开始，PhysicsOS 会建立真实的物理场景、求解并验证。</div>
    <div class="ecup" style="${abs(620, 100, 92, 32)}">实验上传 ${ic('up', 13)}</div>
    <div class="eclink" style="${abs(724, 108)}">开发者文档与贡献规范 ↗</div>
    <div class="stat" data-a="stat" style="${abs(1543, 52, 125, 58)}"><b>76</b><span>可用实验</span></div>
    <div class="hr" style="${abs(528, 158, 1140, 1)}"></div>
    <div class="cont${E.contHover ? ' hv' : ''}" data-a="cont" style="${abs(528, 180, 410, 285)}"><div class="k">继续上次实验</div><div class="t">斜面运动</div><div class="m">力学 · 实验 · 13 小时前</div><div class="go">继续 ${ic('playo', 12, 2)}</div><img src="assets/art/lab.jpg" style="${abs(290, 104, 104, 72)}"></div>
    <div class="rk" data-a="rk" style="${abs(961, 180)}">为你推荐</div>`;
  [['projectile-horizontal', '平抛运动', '水平抛出 · h = 20 m · v<sub>0</sub> = 10 m/s'], ['parallel-plate', '平行板电场偏转', '类平抛 · 电子穿越极间'], ['magnetic-circular', '磁场中的带电粒子运动', '正电粒子垂直进入匀强磁场']]
    .forEach(([id, t, s], i) => { h += `<div class="rec${E.recHover === i ? ' hv' : ''}" data-a="rec-${i}" style="${abs(961, 205 + i * 89, 705, 81)}"><img src="assets/art/${id}.jpg"><div class="k">经典实验</div><div class="t">${t}</div><div class="s">${s}</div></div>`; });
  h += `<div class="free" style="${abs(528, 480, 1138, 74)}"><span class="fi">${ic('box', 18)}</span><div class="t">自由搭建电路</div><div class="s">自己选器材，自己接线，搭完直接求解。</div><span class="fa">开始搭建</span></div>
    <div class="allh" style="${abs(528, 594)}">所有实验</div><div class="alls" style="${abs(528, 624)}">按学科分组，点击一张卡片即可创建实验</div>
    <div class="srch" style="${abs(1130, 598, 360, 40)}">${ic('search', 16)}<span>搜索实验</span></div>
    <div class="segm" style="${abs(1500, 598, 166, 40)}"><span class="on">全学段</span><span>初中</span><span>高中</span></div>`;
  TABS.forEach(([n, c], i) => { h += `<div class="tab${i === 0 ? ' on' : ''}${E.litTab === i ? ' lit' : ''}" data-a="tab-${i}" style="${abs(TAB_X[i], 669, TAB_W[i], 34)}">${c ? `<i style="background:${c}"></i>` : ''}${n}</div>`; });
  h += `<div class="grp" style="${abs(528, 728)}"><i></i><b>力学</b><span>24</span></div><div class="hr" style="${abs(620, 740, 1046, 1)}"></div>`;
  CARDS.forEach(([id, t, s, lv], i) => {
    const x = CARD.x0 + i * CARD.dx, hov = E.hoverCard === id, down = E.downCard === id;
    let th = `<img src="assets/art/${id}.jpg">`;
    if (id === 'projectile-horizontal' && E.hatch) {
      const b = THUMB_BALL, k = E.hatch;
      th += `<div style="position:absolute;left:${b.x - b.r - 1.2}px;top:${b.y - b.r - 1.2}px;width:${2 * b.r + 2.4}px;height:${2 * b.r + 2.4}px;border-radius:50%;background:#CBE4F8;opacity:${Math.min(1, k * 3)}"></div>`;
      th += `<div style="position:absolute;left:${b.x - b.r}px;top:${b.y - b.r}px;width:${2 * b.r}px;height:${2 * b.r}px;border-radius:50%;border:1.1px dashed #2B4C8C;opacity:${Math.min(.8, k * 2)}"></div>`;
    }
    h += `<div class="card${hov ? ' hov' : ''}${down ? ' down' : ''}" data-a="card-${id}" style="${abs(x, CARD.y, CARD.w, CARD.h)}"><div class="th">${th}</div>
      <div class="tt" data-a="ctitle-${id}">${t}</div><div class="st">${s}</div><div class="ln"></div><div class="lv">${lv}</div><div class="pl">${ic('playo', 13, 2)}</div></div>`;
  });
  CARDS2.forEach((id, i) => { h += `<div class="card" style="${abs(CARD.x0 + i * CARD.dx, 1027, CARD.w, 271)}"><div class="th"><img src="assets/art/${id}.jpg"></div></div>`; });
  return h + '</div>';
}

/* ───────── 首页 (home) with the composer */
export const COMPOSER = { x: 620, y: 440, w: 952, h: 114 };
function home(Hm) {
  const balls = Hm.balls || [];
  let o = `<div class="hm"><div class="hmgrid"></div><div class="hmblob"></div>
    <div class="hmhd"><img src="assets/mark.png"><b>探索未至之境</b><span>预览版</span></div><span class="sic" style="left:1888px;top:20px">${ic('panel', 17)}</span>
    <div class="wsp" style="${abs(632, 120)}">${ic('folder', 14)}我的工作区 ${ic('chevd', 12)}</div><div class="wsp" style="${abs(752, 120)}">${ic('compass', 14)}探索模式 ${ic('chevd', 12)}</div>
    <div class="hero"><div class="herog"></div>`;
  for (const b of balls) o += `<div class="hb" style="left:${b.x - 13}px;top:${b.y - 13}px"></div><div class="ha" style="left:${b.x + 16}px;top:${b.y - 1}px;width:${b.l}px;transform:rotate(${b.a}rad)"></div>`;
  o += `<div class="hcopy"><div class="hp"><img src="assets/mark.png">PhysicsOS</div><h1>探索一个物理世界</h1><p>描述一个物理现象、创建实验，或直接输入一道试题。</p></div>
    <img class="hmas" src="assets/mascot-wave-640.webp"><div class="hlive"><i></i>LIVE PHYSICS</div></div>
    <div class="cmp${Hm.focus ? ' foc' : ''}" data-a="composer" style="${abs(COMPOSER.x, COMPOSER.y, COMPOSER.w, COMPOSER.h)}">
      <div class="ctx" data-a="ctext">${Hm.typed ? Hm.typed : '<span class="ph">描述你想要构建的内容，/ 调用指令，@ 文件或对话</span>'}${Hm.caret ? '<i class="crt2"></i>' : ''}</div>
      <span class="cpl">${ic('plus', 16)}</span><span class="cws">${ic('shield', 14)}工作区内修改 ${ic('chevd', 12)}</span><span class="cmd">平台公益模型 <em>High</em> ${ic('chevd', 12)}</span>
      <span class="csd${Hm.typed ? ' on' : ''}" data-a="send">${ic('up', 17, 2.2)}</span></div>
    <div class="fhint" style="${abs(690, 600)}">F = qv × B</div><div class="fhint" style="${abs(1420, 600)}">r = mv / qB</div>`;
  ['正电粒子垂直进入匀强磁场', '比较不同角度的平抛轨迹', '为什么洛伦兹力不做功?'].forEach((c, i) => { o += `<div class="chip${Hm.chipHover === i ? ' hv' : ''}" data-a="chip-${i}" style="${abs([851, 1025, 1187][i], 586, [166, 154, 154][i], 28)}">${c}</div>`; });
  o += `<div class="portal" style="${abs(636, 638, 455, 249)}"><img src="assets/lab-portal-hero.jpg"><div class="pt">${ic('flask', 15)}新建物理实验</div><div class="pd">调节磁场与粒子参数、观察轨迹、受力与周期。</div><div class="pf">实时引擎 · 可验证<span>›</span></div></div>
    <div class="portal" style="${abs(1101, 638, 455, 249)}"><img src="assets/question-portal-hero.jpg"><div class="pt">${ic('doc', 15)}题目练习</div><div class="pd">题库练习交给助教求解，场景卡片直接出现在对话里。</div><div class="pf">88 道内置题 · 解题即建场景<span>›</span></div></div>
    <div class="hl2" style="${abs(668, 922)}">${ic('folder', 14)}打开场景</div><div class="hl2" style="${abs(1130, 922)}">${ic('doc', 14)}浏览实验模板</div>
    <div class="rk" style="${abs(636, 968)}">最近空间</div><div class="hrs" style="${abs(636, 994, 920, 40)}">${ic('folder', 14)}<b>水平面（极缓斜面）上受摩擦减速到停止</b><span>17 分钟前</span></div></div>`;
  return o;
}

/* ───────── 对话 (chat): the answer as it was live, cut before the failed code-experiment note */
export const BLOCKS = [
  `<h2>结论</h2>`,
  `<p>因为磁场对运动电荷的力<b>永远垂直于速度</b>，而做功要求力在位移（速度）方向上有分量。</p>`,
  `<h2>数学上的原因</h2>`,
  `<p>洛伦兹力的磁场部分：</p>`,
  `<div class="eq">${KB('F')} ${KM('=')} ${K('q')}${KM('(')}${KB('v')} ${KM('×')} ${KB('B')}${KM(')')}</div>`,
  `<p>由叉乘的定义，${KB('v')} ${KM('×')} ${KB('B')} 同时垂直于 ${KB('v')} 和 ${KB('B')}，所以 ${KB('F')} ${KM('⊥')} ${KB('v')}。于是瞬时功率</p>`,
  `<div class="eq">${K('P')} ${KM('=')} ${KB('F')} ${KM('·')} ${KB('v')} ${KM('=')} ${K('q')}${KM('(')}${KB('v')} ${KM('×')} ${KB('B')}${KM(')')} ${KM('·')} ${KB('v')} ${KM('= 0')}</div>`,
  `<p>再由动能定理 <span class="frac"><span>${K('dE')}<sub class="ki">k</sub></span><span>${K('dt')}</span></span> ${KM('=')} ${K('P')} ${KM('= 0')}，得到<b>动能不变、速率不变</b>。力的作用只体现在改变速度方向上，它充当向心力。</p>`,
  `<h2>引擎里的实证</h2>`,
  `<p data-a="verify">我在「磁场中的带电粒子运动」场景跑了完整模拟，<span class="selw"><span data-a="vsel">守恒校验 67/67 项通过</span></span>：</p>`,
  `<ul><li>力大小恒为 <b>1.6×10<sup>−13</sup> N</b>（${K('F')} ${KM('= |')}${K('q')}${KM('|')}${K('vB')}）</li><li>回旋半径 <b>0.04175 m</b>（${K('r')} ${KM('=')} ${K('mv')}${KM('/|')}${K('q')}${KM('|')}${K('B')}），周期 <b>1.312×10<sup>−7</sup> s</b></li><li>速度方向一直在转，但速率始终不变：</li></ul>`,
  `<table><tr><th>时刻</th><th>速度 (m/s)</th></tr><tr><td>t = 0</td><td>(2×10<sup>6</sup>, 0)</td></tr><tr><td>t = 3.28×10<sup>−9</sup> s</td><td>(−922.3, 2×10<sup>6</sup>)</td></tr><tr><td>t = 6.56×10<sup>−9</sup> s</td><td>(−2×10<sup>6</sup>, −1845)</td></tr></table>`,
  `<p>从 +x 方向 → +y 方向 → −x 方向，速度被“掰弯”了，但没有被“加快”或“减慢”，轨迹因此是一个圆。</p>`,
];
function chat(C) {
  const n = C.reveal ?? 0;
  let body = '';
  BLOCKS.forEach((b, i) => {
    const k = Math.max(0, Math.min(1, n - i)); if (k <= 0) return;
    body += `<div class="blk" data-a="blk-${i}" style="opacity:${k.toFixed(3)};transform:translateY(${((1 - k) * 8).toFixed(1)}px)">${b}</div>`;
  });
  body = body.replace('class="selw"', `class="selw" style="--sel:${((C.sel || 0) * 100).toFixed(1)}%"`);
  return `<div class="ct"><div class="cth"><b>为什么洛伦兹力不做功？</b><span>2 个子智能体 ${ic('chevd', 12)}</span><span>${ic('compass', 13)} 探索模式</span><em>${ic('more', 16)}</em></div>
    <div class="ctab"><span class="on" data-a="tab-chat">对话</span><span data-a="tab-trace"${C.trHover ? ' class="hv"' : ''}>轨迹</span></div>
    <div class="cscroll"><div class="cin" style="transform:translateY(${-(C.scroll || 0)}px)">
      <div class="ubub" data-a="bubble" style="${C.bub ? `transform:${C.bub.tf};opacity:${C.bub.op}` : ''}">为什么洛伦兹力不做功？</div>
      <div class="ans">${body}</div></div></div></div>`;
}

/* ───────── a lab page in today's production layout: breadcrumb toolbar, scene tree, stage, conditions, inspector */
export function lab(L) {
  const C = L.cfg; let o = `<div class="bn lab2">`;
  o += `<div class="ltb"><span class="crumb">${ic('chevl', 12)}实验中心 / ${C.crumb}</span><span class="ltt">${C.title}</span><span class="lds">${C.desc}</span>
    <div class="lrt"><span class="badge" data-a="badge">${ic('shield', 13)}引擎已验证</span>`;
  o += `<span class="tb3">${ic('guide', 14)}实验指南</span><span class="tb3">${ic('report', 14)}报告</span><span class="tb3">${ic('focus', 14)}专注实验</span><span class="aib"><img src="assets/mascot-wave-320.webp">AI 助教</span><span class="tb3">${ic('chat', 14)}返回对话</span></div></div>`;
  o += `<div class="tree"><div class="th2">场景与对象<span>${ic('chevl', 14)}</span></div>`;
  let y = 66;
  for (const g of C.tree) {
    o += `<div class="ti${g.sel ? ' sel' : ''}" style="top:${y}px">${ic('chevd', 12)}${g.h}</div>`; y += 32;
    for (const it of g.items || []) { const tall = it[1] && it[1].length > 9; o += `<div class="ti c${tall ? ' tall' : ''}" style="top:${y}px">${ic(it[2] || 'box', 13)}<span class="tl">${it[0]}</span>${it[1] ? `<em>${it[1]}</em>` : ''}</div>`; y += tall ? 50 : 32; }
    for (const [n, on] of g.checks || []) { o += `<div class="ti c" style="top:${y}px"><b class="cb${on ? ' on' : ''}">${on ? ic('check', 10, 3) : ''}</b>${n}</div>`; y += 32; }
    y += 6;
  }
  o += `</div><div class="stg"><div class="cap1">PHYSICSOS · 交互实验</div><div class="cap2">${C.title}</div><div class="ver">PhysicsOS&nbsp; v2.0.0</div><div class="cap3">调节条件，观察变化</div></div>`;
  o += `<div class="cvs"><div class="cvt"><span>装置视角</span><span class="on">正视</span><span>查看全程</span><em>拖动旋转 · 自由观察</em></div>
    <svg class="cv" data-a="canvas" width="883" height="440" viewBox="0 0 883 440">${C.canvas(L)}</svg>
    ${C.readout ? `<div class="rdo">${C.readout(L).map(r => `<span>${r}</span>`).join('')}</div>` : ''}</div>`;
  if (C.time) {
    const k = Math.max(0, Math.min(1, L.tk || 0));
    o += `<div class="tml"><span class="tr0${L.playHover ? ' hov' : ''}${L.playDown ? ' dn' : ''}" data-a="play">${ic(L.playing ? 'pause' : 'playc', 17, 1.8)}</span><span class="tr1">${ic('chevl', 13)}</span><span class="tr1">${ic('chevr', 13)}</span><span class="tr1">${ic('reload', 14)}</span>
      <span class="tt0">${(L.tm || 0).toFixed(2)} s</span><span class="ttk"><i style="width:${(k * 100).toFixed(2)}%"></i><b style="left:${(k * 100).toFixed(2)}%"></b></span><span class="tt0 r">${C.time}</span><span class="spd">1x ${ic('chevd', 12)}</span></div>`;
  }
  o += `<div class="cond"><div class="ch">实验条件<span>—</span></div>`;
  C.cond.forEach(([lab, val], i) => { const yy = 52 + i * 78; o += `<div class="cl" style="top:${yy}px">${lab}</div><div class="cf" style="top:${yy + 18}px">${val}${val === '闭合' ? `<span style="margin-left:auto;color:#8A9097">${ic('chevd', 12)}</span>` : ''}</div>`; });
  o += `</div><div class="btabs"><span>要点</span><span>数据</span><span>图像</span><span>推导</span><span>事件</span><em>展开</em></div>`;
  o += `<div class="insp"><div class="ih">检查器<span>${ic('chevr', 15)}</span></div><div class="itabs"><span class="on">属性</span><span>读数</span><span>校验</span></div>`;
  let iy = 114;
  for (const sec of C.insp) { o += `<div class="isec" style="top:${iy}px">${sec.h}</div>`; iy += 24;
    for (const f of sec.f) { o += `<div class="il" style="top:${iy}px">${f[0]}<em>${f[1] ? K(f[1]) : ''}</em></div><div class="if" style="top:${iy + 17}px"><span>${f[2]}</span>${f[3] ? `<b>${f[3]}</b>` : ''}</div>`; iy += 66; } }
  o += `<div class="isec" data-a="derived" style="top:${iy + 2}px">派生量</div>`; iy += 24;
  C.derived.forEach(([lab, val, unit, key], i) => { o += `<div class="dr${L.hoverRow === (key || i) ? ' hov' : ''}" data-a="row-${key || i}" style="top:${iy}px"><span>${lab}</span><b>${val}</b><i>${unit}</i></div>`; iy += 33; });
  return o + `</div></div>`;
}
const pill = (x, y, t, o = {}) => { const w = o.w || (t.replace(/<[^>]+>/g, '').length * (o.fs || 12) * .62 + 18); return `<g${o.id ? ` data-a="${o.id}"` : ''} opacity="${o.op ?? 1}"><rect x="${(x - w / 2).toFixed(1)}" y="${y - 12}" width="${w.toFixed(1)}" height="24" rx="7" fill="${o.bg || '#FFFFFF'}" stroke="${o.st || '#D7DCD8'}"/><text x="${x}" y="${y + 4.5}" text-anchor="middle" class="${o.cls || 'cvl'}"${o.fill ? ` fill="${o.fill}"` : ''}>${t}</text></g>`; };
const board = () => `<defs><linearGradient id="bg2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#EAE7DF"/><stop offset="1" stop-color="#E1DDD3"/></linearGradient></defs><rect width="883" height="440" fill="url(#bg2)"/>`;

const SB = n => `<tspan baseline-shift="sub" font-size="9">${n}</tspan>`;   // Noto Sans SC has no ₁ ₂

// 串联电路: the schematic in front view; current dots run the loop at one speed (current is the same everywhere)
export const LOOP = { x0: 210, x1: 690, y0: 110, y1: 340 };
export function loopPt(s) {          // distance along the loop, clockwise from the bottom-left corner
  const { x0, x1, y0, y1 } = LOOP, a = y1 - y0, b = x1 - x0, P = 2 * (a + b); s = ((s % P) + P) % P;
  if (s < a) return { x: x0, y: y1 - s }; s -= a; if (s < b) return { x: x0 + s, y: y0 }; s -= b; if (s < a) return { x: x1, y: y0 + s }; s -= a; return { x: x1 - s, y: y1 };
}
export function circuitCanvas(L) {
  const { x0, x1, y0, y1 } = LOOP, hi = L.hi || {};
  let s = board() + `<rect x="70" y="36" width="743" height="368" rx="18" fill="#D8DCD6" opacity=".55"/>`;
  s += `<path d="M${x0} ${y1} V${y0} H${x1} V${y1} Z" fill="none" stroke="#3D6B57" stroke-width="4" stroke-linejoin="round"/>`;
  const P = 2 * ((y1 - y0) + (x1 - x0));
  for (let k = 0; k < P / 36; k++) { const p = loopPt(k * 36 + (L.flow || 0)); s += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.6" fill="#F2B33D"/>`; }
  // R₁ (top), ammeter (top right), switch (right), R₂ (left), battery + voltmeter (bottom)
  s += `<rect x="350" y="${y0 - 13}" width="80" height="26" rx="4" fill="#ECE7D9" stroke="#56635C" stroke-width="1.6" data-a="r1"/>`;
  s += `<circle cx="560" cy="${y0}" r="18" fill="#F7F5EE" stroke="#56635C" stroke-width="1.6" data-a="amm"/><text x="560" y="${y0 + 5}" text-anchor="middle" class="cvl">A</text>`;
  s += `<rect x="${x1 - 6}" y="200" width="12" height="50" fill="#D8DCD6"/><circle cx="${x1}" cy="200" r="4" fill="#3D6B57"/><circle cx="${x1}" cy="250" r="4" fill="#3D6B57"/><line x1="${x1}" y1="200" x2="${x1 + 2}" y2="250" stroke="#3D6B57" stroke-width="4"/>`;
  s += `<rect x="${x0 - 13}" y="185" width="26" height="80" rx="4" fill="#ECE7D9" stroke="#56635C" stroke-width="1.6" data-a="r2"/>`;
  s += `<rect x="430" y="${y1 - 22}" width="40" height="44" fill="#D8DCD6"/><line x1="442" y1="${y1 - 22}" x2="442" y2="${y1 + 22}" stroke="#2F3A34" stroke-width="3"/><line x1="458" y1="${y1 - 12}" x2="458" y2="${y1 + 12}" stroke="#2F3A34" stroke-width="5"/>`;
  s += `<path d="M400 ${y1} V${y1 + 52} H432 M468 ${y1 + 52} H500 V${y1}" fill="none" stroke="#3D6B57" stroke-width="2.4"/><circle cx="450" cy="${y1 + 52}" r="17" fill="#F7F5EE" stroke="#56635C" stroke-width="1.6"/><text x="450" y="${y1 + 57}" text-anchor="middle" class="cvl">V</text>`;
  s += pill(390, y0 - 38, `R${SB(1)} · 10 Ω`) + pill(390, y0 + 40, 'I=0.2 A · U=2 V · P=0.4 W', { bg: hi.r1 ? '#EAF0FD' : '#FFFFFF', st: hi.r1 ? '#9DB8F0' : '#D7DCD8' });
  s += pill(560, y0 - 38, '0.2 A', { id: 'ammtag' }) + pill(x1 + 46, 210, 'S 闭合') + pill(x1 + 50, 250, 'I=0.2 A');
  s += pill(x0 - 72, 190, `R${SB(2)} · 20 Ω`) + pill(x0 - 18, 300, 'I=0.2 A · U=4 V · P=0.8 W', { bg: hi.r2 ? '#EAF0FD' : '#FFFFFF', st: hi.r2 ? '#9DB8F0' : '#D7DCD8' }) + pill(x0 + 44, 225, '4 V');
  s += pill(450, y1 + 84, 'U=6 V') + pill(450, y1 - 36, 'E · 6 V');
  return s;
}
export const WAVE = { xa: 120, xb: 763, y: 222, A: 78, n: 2 };
export const waveY = (x, ph) => WAVE.y - WAVE.A * Math.sin(Math.PI * WAVE.n * (x - WAVE.xa) / (WAVE.xb - WAVE.xa)) * Math.cos(ph);
export function waveCanvas(L) {
  const { xa, xb, y, A } = WAVE, ph = L.phase || 0;
  let s = board(), d = '', e1 = '', e2 = '';
  for (let i = 0; i <= 120; i++) { const x = xa + (xb - xa) * i / 120; d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${waveY(x, ph).toFixed(1)}`; e1 += `${i ? 'L' : 'M'}${x.toFixed(1)} ${waveY(x, 0).toFixed(1)}`; e2 += `${i ? 'L' : 'M'}${x.toFixed(1)} ${waveY(x, Math.PI).toFixed(1)}`; }
  s += `<line x1="${xa}" y1="${y}" x2="${xb}" y2="${y}" stroke="#B8B2A4" stroke-dasharray="3 5"/>`;
  s += `<path d="${e1}" fill="none" stroke="#9AA6B4" stroke-width="1.2" stroke-dasharray="6 6"/><path d="${e2}" fill="none" stroke="#9AA6B4" stroke-width="1.2" stroke-dasharray="6 6"/>`;
  s += `<rect x="${xa - 22}" y="${y - 70}" width="22" height="150" rx="4" fill="#8F969C"/><rect x="${xb}" y="${y - 70}" width="22" height="150" rx="4" fill="#8F969C"/>`;
  s += `<path d="${d}" fill="none" stroke="#3D7BC4" stroke-width="3.2" stroke-linecap="round"/>`;
  for (const k of [0, .5, 1]) { const x = xa + (xb - xa) * k; s += `<circle cx="${x}" cy="${y}" r="5.5" fill="#2E6B4F"/>` + pill(x, y + 112, '波节', { op: L.nodeOp ?? 1 }); }
  for (const k of [.25, .75]) { const x = xa + (xb - xa) * k; s += pill(x, y - A - 34, '波腹', { op: L.antiOp ?? 1, bg: '#EAF0FD', st: '#9DB8F0' }); }
  s += pill(206, 40, 'v = λf = 1 m × 40 Hz = 40 m/s', { fs: 12.5 }) + pill(xb - 20, 40, 'n = 2 · L = 1 m');
  return s;
}
export const IND = { x0: 140, x1: 840, top: 150, bot: 300, start: 330 };
export function inductionCanvas(L) {
  const { x0, x1, top, bot } = IND, xb = L.barX ?? IND.start;
  let s = board();
  s += `<rect x="${x0}" y="${top}" width="${xb - x0}" height="${bot - top}" fill="rgba(65,118,230,.10)"/>`;
  for (let gx = 205; gx < x1; gx += 54) for (let gy = 182; gy < bot; gy += 46) s += `<g opacity=".55"><circle cx="${gx}" cy="${gy}" r="8" fill="none" stroke="#5A82D6" stroke-width="1.3"/><path d="M${gx - 4.5} ${gy - 4.5}l9 9M${gx + 4.5} ${gy - 4.5}l-9 9" stroke="#5A82D6" stroke-width="1.3"/></g>`;
  s += `<line x1="${x0}" y1="${top}" x2="${x1}" y2="${top}" stroke="#6E747A" stroke-width="6" stroke-linecap="round"/><line x1="${x0}" y1="${bot}" x2="${x1}" y2="${bot}" stroke="#6E747A" stroke-width="6" stroke-linecap="round"/>`;
  s += `<line x1="${x0}" y1="${top}" x2="${x0}" y2="${bot}" stroke="#3D6B57" stroke-width="4"/><rect x="${x0 - 13}" y="${(top + bot) / 2 - 36}" width="26" height="72" rx="4" fill="#ECE7D9" stroke="#56635C" stroke-width="1.6"/>`;
  s += `<rect x="${xb - 6}" y="${top - 14}" width="12" height="${bot - top + 28}" rx="4" fill="#4A4F55" data-a="bar"/>`;
  const arrow = (xa, ya, xc, yc) => { const dx = xc - xa, dy = yc - ya, l = Math.hypot(dx, dy), ux = dx / l, uy = dy / l; return `<line x1="${xa}" y1="${ya}" x2="${xc}" y2="${yc}" stroke="#E8892B" stroke-width="3"/><path d="M${xc} ${yc} l${(-ux * 11 - uy * 6).toFixed(1)} ${(-uy * 11 + ux * 6).toFixed(1)} M${xc} ${yc} l${(-ux * 11 + uy * 6).toFixed(1)} ${(-uy * 11 - ux * 6).toFixed(1)}" stroke="#E8892B" stroke-width="3" fill="none"/>`; };
  const k = L.arrowOp ?? 1;
  s += `<g opacity="${k}">${arrow(xb + 22, bot - 40, xb + 22, top + 40)}${arrow((x0 + xb) / 2 + 40, top - 22, (x0 + xb) / 2 - 40, top - 22)}${arrow(x0 - 30, top + 40, x0 - 30, bot - 40)}${arrow((x0 + xb) / 2 - 40, bot + 22, (x0 + xb) / 2 + 40, bot + 22)}</g>`;
  s += pill(x0 - 2, (top + bot) / 2 + 58, 'R = 5 Ω') + pill(x1 - 60, top - 36, 'B = 0.5 T ⊗') + pill(xb + 66, (top + bot) / 2, 'v = 2 m/s →');
  s += pill((x0 + xb) / 2, top - 52, 'I = 0.04 A', { op: k }) + pill(xb, bot + 56, 'E = BLv = 0.5 T × 0.2 m × 2 m/s = 0.2 V', { id: 'emf', fs: 12.5 });
  return s;
}

// the three labs as the inspector and scene tree read on 2026-11-07
const R1 = 'R<sub>1</sub>', R2 = 'R<sub>2</sub>';
export const LABS = {
  circuit: { crumb: '电路', title: '串联电路', desc: '串联分压：电流处处相等，电压按电阻分配。', canvas: circuitCanvas,
    tree: [{ h: '电路结构', items: [['E · 电源', '6 V'], ['S · 开关', '闭合'], ['A · 电流表', '理想表'], [`${R1} · 定值电阻`, '10 Ω'], [`${R2} · 定值电阻`, '20 Ω'], ['V · 电压表', '理想表']] },
      { h: '可观察量', checks: [['电流', 1], ['电压', 1], ['功率', 1]] }],
    cond: [['电动势 E / V', '6'], [`${R1} / Ω`, '10'], [`${R2} / Ω`, '20'], ['开关 S', '闭合']],
    insp: [{ h: '电源', f: [['电动势', 'E', '6', 'V'], ['内阻', 'r', '0', 'Ω']] }, { h: '电阻元件', f: [[R1, 'R', '10', 'Ω'], [R2, 'R', '20', 'Ω']] }, { h: '开关', f: [['S', '', '闭合', '']] }],
    derived: [['电动势 E', '6', 'V'], ['干路电流 I', '0.2', 'A', 'I'], ['路端电压 U', '6', 'V', 'U'], ['电源总功率', '1.2', 'W', 'P'], ['输出功率', '1.2', 'W'], ['内阻耗散功率', '0', 'W'], ['外电路等效电阻', '30', 'Ω']],
    readout: () => ['I = 0.2 A', 'U<sub>1</sub> = 2 V', 'U<sub>2</sub> = 4 V', 'P<sub>总</sub> = 1.2 W'] },
  wave: { crumb: '机械波', title: '两端固定的弦驻波', desc: 'Wave Engine · L = nλ/2 与波节波腹', canvas: waveCanvas, time: '1.00 s',
    tree: [{ h: '弦驻波装置', items: [['两端固定的弦', 'A = 4 cm · λ = 1 m · f = 40 Hz']] }, { h: '可观察量', checks: [['波形', 1], ['波速读数 v = λf', 1], ['波节与波腹', 1]] }],
    cond: [['振幅 A / cm', '4'], ['弦长 L / m', '1'], ['谐波次数 n', '2'], ['波速 v / m/s', '40']],
    insp: [{ h: '弦驻波', f: [['振幅', 'A', '4', 'cm'], ['弦上波速（由介质决定）', 'v', '40', 'm/s'], ['弦长', 'L', '1', 'm'], ['谐波次数', 'n', '2', '']] }],
    derived: [['波速 v', '40', 'm/s'], ['周期 T', '0.025', 's'], ['波长 λ', '1', 'm'], ['频率 f', '40', 'Hz'], ['振幅 A', '4', 'cm'], ['弦长 L', '1', 'm'], ['谐波次数 n', '2', ''], ['基频 f<sub>1</sub>', '20', 'Hz'], ['波节数', '3', '', 'nodes'], ['波腹数', '2', '', 'anti']],
    readout: () => ['A = 4 cm', 'λ = 1 m', 'f = 40 Hz', 'v = 40 m/s', '波节 3 · 波腹 2'] },
  induction: { crumb: '电磁感应', title: '导体棒切割磁感线', desc: 'Induction Engine · 导体棒切割磁感线 E = BLv', canvas: inductionCanvas, time: '5.00 s',
    tree: [{ h: '切割磁感线装置', items: [['导体棒与导轨', 'B = 0.5 T · R = 5 Ω'], ['导体棒', 'L = 20 cm · v = 2 m/s']] }, { h: '可观察量', checks: [['感应电动势', 1], ['感应电流', 1], ['磁通量', 1], ['导体棒运动', 1]] }],
    cond: [['磁感应强度 B / T', '0.5'], ['棒长 L / cm', '20'], ['棒速 v / m/s', '2'], ['回路电阻 R / Ω', '5']],
    insp: [{ h: '切割磁感线', f: [['磁感应强度', 'B', '0.5', 'T'], ['回路电阻', 'R', '5', 'Ω'], ['棒长', 'L', '20', 'cm'], ['棒速（正负 = 方向）', 'v', '2', 'm/s']] }],
    derived: [['感应电动势 E', '0.2', 'V', 'E'], ['感应电流 I', '0.04', 'A', 'I'], ['回路电阻 R', '5', 'Ω'], ['磁感应强度 B', '0.5', 'T'], ['棒长 L（导轨间距）', '20', 'cm'], ['棒速 v', '2', 'm/s'], ['磁通量变化率 dΦ/dt', '0.2', 'Wb'], ['感应方向（+1/−1）', '1', '']],
    readout: L => [`t = ${(L.tm || 0).toFixed(2)} s`, 'v = 2 m/s', 'E = 0.2 V', 'I = 0.04 A'] },
};

/* ───────── 轨迹 (the agent's real trace for 「为什么洛伦兹力不做功？」, cut before its failed code-experiment row) */
export const TRACE = [
  ['系统', '初始系统提示词'], ['turn', '第 1 轮'], ['用户', '为什么洛伦兹力不做功？'],
  ['助手', '用户问的是「为什么洛伦兹力不做功？」这是一个概念性问题，不是一道具体计算题。我需要用 PhysicsOS 的工具来辅助回答吗？工具里有 physics_create_experiment / physics_solve_question / physics_simulate 等。这个问题属于概念解释，但可以用磁场中的带电粒子运动实验（magnetic-circular）来演示'],
  ['工具', 'physics_create_experiment', '{"templateId":"magnetic-circular","title":"洛伦兹力为什么不做功：带电粒子在匀强磁场中的运动"}', '场景 agent-magnetic-circular-mw55fhyu-1 · 修订 0 · 洛伦兹力为什么不做功：带电粒子在匀强磁场中的运动 领域 magnetic · 引擎 engine-magnetic Frozen uniform magnetic field circular-motion model.'],
  ['助手', '（仅工具调用）'],
  ['工具', 'physics_simulate', '{"sceneId":"agent-magnetic-circular-mw55fhyu-1"}', '模拟完成：场景 agent-magnetic-circular-mw55fhyu-1 修订 0 · 引擎 engine-magnetic（magnetic） 采样 65 个状态，t = 0 s → 1.312e-7 s <span class="pass" data-a="pass">校验：passed（67/67 项通过）</span> 导出量： cyclotron_radius = 0.04175 m（r = mv / |q|B）'],
  ['助手', '（仅工具调用）'],
  ['工具', 'physics_observe', '{"sceneId":"agent-magnetic-circular-mw55fhyu-1","time":0}', '场景 agent-magnetic-circular-mw55fhyu-1 修订 0 在 t = 0 s 的状态： particle-1：位置 (0, 0) m；速度 (2e+6, 0) m/s'],
  ['工具', 'physics_observe', '{"sceneId":"agent-magnetic-circular-mw55fhyu-1","time":3.28e-8}', '场景 agent-magnetic-circular-mw55fhyu-1 修订 0 在 t = 3.28e-8 s 的状态： particle-1：位置 (0.04175, 0.04177) m；速度 (-922.3, 2e+6) m/s'],
  ['工具', 'physics_observe', '{"sceneId":"agent-magnetic-circular-mw55fhyu-1","time":6.56e-8}', '场景 agent-magnetic-circular-mw55fhyu-1 修订 0 在 t = 6.56e-8 s 的状态： particle-1：位置 (-3.851e-5, 0.0835) m；速度 (-2e+6, -1845) m/s'],
  ['助手', 'The observations show velocity magnitude stays 2e6 m/s (approximately, with small numerical noise). Force direction perpendicular to velocity. Let me enable velocity/force observables?'],
  ['工具', 'physics_scene_command', '{"sceneId":"agent-magnetic-circular-mw55fhyu-1","type":"SetObservableEnabled","payload":{"observableId":"observable-velocity","enabled":true}}', '已执行：场景 agent-magnetic-circular-mw55fhyu-1 现在是修订 1（事件 ObservableEnabled）。调用 physics_simulate 获取新结果。'],
  ['工具', 'physics_scene_command', '{"sceneId":"agent-magnetic-circular-mw55fhyu-1","type":"SetObservableEnabled","payload":{"observableId":"observable-force","enabled":true}}', '已执行：场景 agent-magnetic-circular-mw55fhyu-1 现在是修订 2（事件 ObservableEnabled）。调用 physics_simulate 获取新结果。'],
];
function trace(Tr) {
  let rows = '', y = 172;
  TRACE.forEach((r, i) => {
    const k = Tr.n === undefined ? 1 : Math.max(0, Math.min(1, Tr.n - i)), vis = `opacity:${k.toFixed(3)};transform:translateX(${((1 - k) * -12).toFixed(1)}px)`;
    if (r[0] === 'turn') { if (k > 0) rows += `<div class="trn" style="top:${y + 4}px;${vis}">${r[1]}</div><div class="trn2" style="top:${y + 4}px;${vis}">#1</div>`; return; }
    const tag = { 系统: 'sy', 用户: 'us', 助手: 'as', 工具: 'tl' }[r[0]];
    const body = r[0] === '工具' ? `<b class="mono" data-a="tn-${i}">${r[1]}</b><span class="mono args">${r[2]}</span><span class="arr">→</span><span class="res">${r[3]}</span>` : `<span class="res${r[1].startsWith('（') ? ' dimt' : ''}">${r[1]}</span>`;
    if (k > 0) rows += `<div class="trw${Tr.hover === i ? ' hv' : ''}" data-a="tr-${i}" style="top:${y}px;${vis}"><i class="tg ${tag}">${r[0]}</i>${body}</div>`;
    y += 30;
  });
  const bars = [['输入', '#7FA3E8', [[0, .04], [.1, .13], [.3, .33], [.52, .55]]], ['模型', '#8B6CC9', [[.04, .1], [.13, .3], [.33, .52], [.55, .7], [.74, .8]]], ['工具', '#E39545', [[.1, .12], [.3, .32], [.4, .46], [.52, .54], [.7, .74]]]];
  let strip = ''; bars.forEach(([n, c, segs], k) => { strip += `<span class="stl" style="top:${k * 13}px">${n}</span>`; for (const [a, b] of segs) strip += `<i style="left:${(48 + a * 1520).toFixed(0)}px;width:${((b - a) * 1520).toFixed(0)}px;top:${k * 13 + 3}px;background:${c}"></i>`; });
  return `<div class="ct"><div class="cth"><b>为什么洛伦兹力不做功？</b><span>2 个子智能体 ${ic('chevd', 12)}</span><span>${ic('compass', 13)} 探索模式</span><em>${ic('more', 16)}</em></div>
    <div class="ctab"><span data-a="tab-chat">对话</span><span class="on" data-a="trtab">轨迹</span></div>
    <div class="trf"><span>${ic('lines', 12)}时长</span><span>${ic('lines', 12)}轮次</span><span>${ic('lines', 12)}调用</span><em>${ic('search', 13)}搜索</em></div>
    <div class="trs">${strip}</div>${rows}
    <div class="cmp tc"><div class="ctx"><span class="ph">发消息或创建任务，/ 调用指令，@ 文件或对话</span></div><span class="cpl">${ic('plus', 16)}</span><span class="cws">${ic('shield', 14)}工作区内修改 ${ic('chevd', 12)}</span><span class="cmd">平台公益模型 <em>High</em> ${ic('chevd', 12)}</span><span class="csd">${ic('up', 17, 2.2)}</span></div>
    <div class="tstat">2 轮 9 步 · 98 tok/s　|　90.8K tok · 缓存命中 84%　|　1%</div></div>`;
}

/* ───────── 出卷专区 */
const DRAFTS = [['≈0.44 · 选拔（教研估计） · v2 · 2026-11-02', 0], ['≈0.54 · 偏难（教研估计） · v2 · 2026-10-31', 0], ['≈0.54 · 偏难（教研估计） · v2 · 2026-11-01', 15]];
function exam(Ex) {
  const tab = Ex.tab || 'new';
  let o = `<div class="ex"><div class="exb" style="${abs(311, 17, 92, 30)}">${ic('back', 14)}返回首页</div><div class="ext" style="${abs(420, 20)}">贵州高考物理 · 出卷工作台</div>
    <div class="exs" style="${abs(664, 27)}">贵州本土 · 2027 届 — 初中理综 / 高中物理 · 单元 · 周考 · 月考 · 期中 · 期末 · 模拟</div>
    <div class="exr" style="${abs(1700, 22)}">复核人<span>教研组</span></div>
    <div class="exsteps"><span class="${tab === 'new' ? 'on' : ''}" data-a="ex-new"><i>1</i>新建试卷</span><span class="${tab === 'drafts' ? 'on' : ''}" data-a="ex-drafts"><i>2</i>草稿与审核<em>3</em></span><span class="${tab === 'final' ? 'on' : ''}" data-a="ex-final"><i>3</i>已定稿<em>1</em></span><span>题库</span><span>真题资料库</span></div>`;
  if (tab === 'new') {
    o += `<div class="exform" style="${abs(312, 132, 857, 404)}"><div class="h">试卷结构</div><div class="lbl" style="top:52px">结构模板（已核验）</div><div class="sel${Ex.f === 'tpl' ? ' hv' : ''}" data-a="ex-tpl" style="top:76px">— 选择 —<span>${ic('chevd', 13)}</span></div>
      <div class="h" style="top:150px">内容范围</div><div class="lbl" style="top:196px">已教章节（分号或换行分隔）</div><div class="ta${Ex.f === 'ta' ? ' hv' : ''}" data-a="ex-ta" style="top:220px">人教版九年级·第十三章 内能；第十四章 内能的利用</div>
      <div class="adv" style="top:344px">${ic('chevr', 13, 2)}高级设置（卷型 · 难度 · 排除内容）</div></div>
      <div class="exsum" style="${abs(1187, 132, 701, 432)}"><div class="h">试卷摘要</div>
      ${[['规范 Profile', '未选择'], ['试卷结构', '未选择'], ['总分 / 时长', '—'], ['题量', '—'], ['卷型', '单元测试'], ['目标年份', '2027 届'], ['教材版本', '人教版'], ['知识覆盖', '未填写'], ['难度目标', '难度系数 ≈0.71 · 标准（教研估计）']].map(([k, v], i) => `<div class="kv" style="top:${44 + i * 24}px"><span>${k}</span><b>${v}</b></div>`).join('')}
      <div class="chk${Ex.chk === 'verify' ? ' hv' : ''}" data-a="ex-verify" style="top:270px"><b>物理验证</b><small>Physics Verification</small><em>待生成</em></div><div class="chk${Ex.chk === 'compl' ? ' hv' : ''}" data-a="ex-compl" style="top:316px"><b>考试规范校验</b><small>Exam Compliance</small><em>待检查</em></div>
      <div class="note" data-a="ex-note" style="top:366px">点击「AI 起草 + 自动检查」一键完成：细目表自动确认并起草，过程实时可见；物理验证通过、考试规范校验到达 READY_FOR_TEACHER_REVIEW 再由教研复核。</div></div>
      <div class="exbtn" style="${abs(312, 590, 150, 36)}">生成双向细目表</div><div class="exbtn2" style="${abs(476, 590, 90, 36)}">前往审核</div><div class="exhint" style="${abs(580, 600)}">请先选择试卷结构模板</div>`;
  } else if (tab === 'drafts') {
    DRAFTS.forEach(([meta, n], i) => { const y = 135 + i * 110; o += `<div class="dcard${Ex.hover === i ? ' hv' : ''}" data-a="draft-${i}" style="${abs(313, y, 320, 98)}"><b>2027 贵州省高考物理模拟预测卷</b><i>待审核</i><small>模拟预测 · 难度系数 ${meta}</small><div class="pb${n === 15 ? ' done' : ''}"><span style="width:${(n / 15 * 100).toFixed(0)}%"></span><em>${n}/15 题已审</em></div></div>`; });
    o += `<div class="exfold" style="${abs(651, 136)}">收起列表 »</div><img class="exempty" src="assets/paper-empty.jpg" style="${abs(1205, 245, 128, 90)}"><div class="exet" style="${abs(1160, 400)}">从左侧选择一个试卷任务</div>`;
  } else {
    o += `<div class="exft" style="${abs(313, 136)}">已定稿试卷</div><div class="fcard" data-a="fcard" style="${abs(313, 168, 320, 140)}"><b>2027 贵州省高考物理模拟预测卷</b><div class="fm"><i>已定稿</i>v2 · 难度系数 ≈0.44 · 选拔（教研估计）</div>
      <div class="files">${[['f-pdf', '试卷.pdf'], ['f-apdf', '答案解析.pdf'], ['f-docx', '试卷.docx'], ['f-adocx', '答案解析.docx']].map(([k, n]) => `<span data-a="${k}"${Ex.file === k ? ' class="hv"' : ''}>${n}</span>`).join('')}</div></div>
      <div class="exet2" style="${abs(651, 182)}">选择一份 PDF 在此预览（即最终打印版式）。</div>`;
  }
  return o + `</div>`;
}

/* ───────── 资源库 */
const CH8 = [['第一章 机械运动', '1 道题'], ['第二章 声现象', '2 道题'], ['第三章 物态变化', '—'], ['第四章 光现象', '3 道题'], ['第五章 透镜及其应用', '6 道题']];
const CH8b = [['第八章 运动和力', '1 道题'], ['第九章 压强', '—'], ['第十章 浮力', '—'], ['第十一章 功和机械能', '—'], ['第十二章 简单机械', '—']];
const CH9 = [['第十三章 内能', '—'], ['第十五章 电流和电路', '2 道题'], ['第十六章 电压 电阻', '2 道题'], ['第十七章 欧姆定律', '5 道题'], ['第十八章 电功率', '1 道题']];
const COURSES = [['国家课', '第1节 长度和时间的测量'], ['精品课', '第一节 长度和时间的测量'], ['知识点微课', '用刻度尺测量长度，用表测量时间'], ['国家课', '第2节 运动的描述'], ['精品课', '第二节 运动的描述'], ['国家课', '第3节 运动的快慢'], ['精品课', '第三节 运动的快慢'], ['国家课', '第4节 速度的测量'], ['精品课', '第四节 速度的测量'], ['知识点微课', '测量平均速度']];
function lib(Lb) {
  let o = `<div class="lb"><div class="lbc" style="${abs(300, 18)}">PhysicsOS / 资源库</div><img src="assets/library-hero.png" style="${abs(300, 50, 56, 56)};position:absolute;border-radius:12px;object-fit:cover">
    <div class="lbt" style="${abs(370, 54)}">物理资源库</div><div class="lbd" style="${abs(370, 92)}">按人教版教材章节整理的练习题、真题卷与书籍。</div>`;
  [['88', '道题'], ['0', '份真题'], ['9', '册教材'], ['926', '项资源']].forEach(([n, u], i) => { o += `<div class="lbs${Lb.stat === i ? ' hv' : ''}" data-a="lbs-${i}" style="${abs(1248 + i * 110, 56, 102, 58)}"><b>${n}</b><span>${u}</span></div>`; });
  o += `<div class="lbtabs" style="${abs(303, 160)}"><span class="on">教材章节</span><span>知识点</span><span>真题卷</span><span>书籍</span><span>配套资源</span></div>
    <div class="lbsrch" style="${abs(640, 156, 1260, 40)}">${ic('search', 15)}搜索题目、真题、书籍或课程</div><div class="lbseg" style="${abs(303, 206)}"><span class="on">全学段</span><span>初中</span><span>高中</span></div>
    <div class="lbrail" style="${abs(300, 252, 300, 830)}"><div class="g">人教版 · 初中物理</div>`;
  const grp = (title, rows, sel) => `<div class="b">${title}</div>` + rows.map(([c, n], i) => `<div class="r${sel && i === 0 ? ' on' : ''}" ${sel && i === 0 ? 'data-a="lb-ch"' : ''}><span>${c}</span><em>${n}</em></div>`).join('');
  o += grp('八年级上册', CH8, true) + grp('八年级下册', CH8b) + grp('九年级全一册', CH9) + `</div>`;
  o += `<div class="lbmain" style="${abs(624, 214, 1270, 860)}"><div class="lbh"><small>八年级上册</small>第一章 机械运动</div><div class="lbtags"><span>运动的快慢</span><span>速度</span><span>测量平均速度</span></div>
    <div class="lbcs" data-a="lb-courses">同步课程 · 11</div>${COURSES.map(([k, t], i) => `<div class="lbrow" style="top:${142 + i * 34}px"><i class="${k === '国家课' ? 'k1' : k === '精品课' ? 'k2' : 'k3'}">${k}</i><span>${t}</span></div>`).join('')}</div></div>`;
  return o;
}

/* ───────── 实验上传与贡献 */
function upload(Up) {
  return `<div class="up"><div class="uph" style="${abs(306, 26, 1582, 280)}"><span class="upi">${ic('upload', 22)}</span><small>实验开发者</small><h1>实验上传与贡献</h1>
    <p data-a="up-p">独立制作实验文件包，上传后由平台管理员审核。通过后自动展示，历史版本保留。</p><span class="upb">开发者文档 ↗</span><img src="assets/mascot-developer-640.webp"></div>
    <div class="upn" style="${abs(312, 330)}" data-a="up-all">全部 <b data-a="up-76">76</b> 个已有实验均支持上传与审核</div><div class="upl" style="${abs(1760, 330)}">打开凸透镜实验 →</div>
    ${[['开发文档 ↗', '了解规范与提交流程', 'guide'], ['下载独立模板 ↓', '从可运行的凸透镜成像规律样板开始', 'box'], ['复制 AGENTS.md ↗', '获取当前版本的开发提示词', 'doc']].map(([t, s, icn], i) => `<div class="upc" style="${abs(336 + i * 511, 390, 498, 83)}"><span class="upci">${ic(icn, 22)}</span><b>${t}</b><small>${s}</small></div>`).join('')}
    <div class="upf" style="${abs(336, 500, 1522, 600)}"><span class="no">01</span><b class="ft">提交一个新版本</b><small class="fs">上传实验包，补充作者信息，审核通过后自动展示。</small>
      <div class="fl" style="top:104px">对应实验</div><div class="fsel" data-a="up-sel" style="top:124px">凸透镜成像规律 ${ic('chevd', 13)}</div><div class="fn" style="top:178px">全部已有实验均可上传；ZIP 清单中的 experimentId 必须与所选实验一致。</div>
      <div class="fl" style="top:214px">实验文件 ZIP</div><div class="fzip${Up.zip ? ' hv' : ''}" data-a="up-zip" style="top:234px"><i>ZIP</i><b>添加你的实验文件</b><small>ZIP 文件 · 最大 20 MiB</small><span>${ic('upload', 13)}选择 ZIP 文件</span></div>
      <div class="fn" style="top:326px">上传模板构建后 release 目录中的 ZIP，适用于凸透镜成像规律。</div>
      <div class="fl" style="top:362px">作者显示名</div><div class="fin" style="top:382px;width:720px"></div><div class="fl" style="top:362px;left:780px">GitHub 个人主页</div><div class="fin" style="top:382px;left:780px;width:720px">https://github.com/your-name</div>
      <div class="fl" style="top:452px">作者简介</div><div class="fin" style="top:472px;height:84px;width:720px"></div></div></div>`;
}
