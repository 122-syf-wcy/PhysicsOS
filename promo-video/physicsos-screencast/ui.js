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
  replay: '<path d="M5 12a7 7 0 1 0 2.1-5"/><path d="M5 4.5V8h3.5"/>', pause: '<circle cx="12" cy="12" r="8.5"/><path d="M10.2 9v6M13.8 9v6"/>',
  reset: '<path d="M19 12a7 7 0 1 1-2.1-5"/><path d="M19 4.5V8h-3.5"/>', guide: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11.2v5M12 8h.01"/>',
  report: '<path d="M6.5 3.5h11v17h-11z"/><path d="M9.5 8h5M9.5 11.5h5M9.5 15h3"/>', focus: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  more: '<circle cx="6" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="18" cy="12" r="1.2" fill="currentColor"/>',
  up: '<path d="M12 18.5v-13M6.5 11 12 5.5 17.5 11"/>', shield: '<path d="M12 3.5 18.5 6v5.5c0 4.2-2.7 7.2-6.5 8.8-3.8-1.6-6.5-4.6-6.5-8.8V6z"/><path d="m9.2 12 2 2 3.8-3.8"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', arrowr: '<path d="M5 12h14M13.5 6.5 19 12l-5.5 5.5"/>', ext: '<path d="M8 16 16 8M10 8h6v6"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="m15.2 8.8-1.9 4.5-4.5 1.9 1.9-4.5z"/>', folder: '<path d="M3.5 6.5h6l2 2h9v10.5h-17z"/>',
  box: '<rect x="5" y="7" width="14" height="10" rx="1.5"/><path d="M9 7V5h6v2"/>', arrowd: '<path d="M12 4v16M7 15l5 5 5-5"/>', lines: '<path d="M4 15h16M7 11h10"/>',
  slash: '<path d="M4 18h3l9-12h4"/>', diag: '<path d="M5 19 19 5M13 5h6v6"/>', back: '<path d="M14.5 6.5 9 12l5.5 5.5"/>', fwd: '<path d="M9.5 6.5 15 12l-5.5 5.5"/>',
  reload: '<path d="M18.5 12a6.5 6.5 0 1 1-1.9-4.6"/><path d="M18.5 4.5v3.5H15"/>', share: '<path d="M12 4v11M8 8l4-4 4 4M6 12v7h12v-7"/>', tabs: '<rect x="4" y="6" width="12" height="12" rx="2"/><path d="M8 4h10a2 2 0 0 1 2 2v10"/>',
};
export const ic = (n, s = 16, sw = 1.7) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${I[n]}</svg>`;
const st = (o = {}) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}:${v}`).join(';');
const abs = (x, y, w, h, extra = '') => `left:${x}px;top:${y}px;${w !== undefined ? `width:${w}px;` : ''}${h !== undefined ? `height:${h}px;` : ''}${extra}`;
const K = s => `<span class="ki">${s}</span>`;           // KaTeX math italic
const KB = s => `<span class="kb">${s}</span>`;          // KaTeX bold (vectors)
const KM = s => `<span class="km">${s}</span>`;

/* ───────── desktop + browser window */
export function world(F) {
  let page = '';
  if (F.page === 'ec') page = ec(F.ec || {}) + side(F.side || {});
  else if (F.page === 'bench') page = bench(F.bench || {}) + side(F.side || {});
  else if (F.page === 'home') page = home(F.home || {}) + side(F.side || {});
  else if (F.page === 'chat') page = chat(F.chat || {}) + side(F.side || {});
  return `<div id="wall"></div>
  <div class="win" style="${abs(WIN.x, WIN.y, WIN.w, WIN.h)}">
    <div class="tbar"><div class="lights"><i></i><i></i><i></i></div>
      <span class="navb" style="left:78px">${ic('back', 17)}</span><span class="navb" style="left:106px;opacity:.45">${ic('fwd', 17)}</span><span class="navb" style="left:136px">${ic('reload', 15)}</span>
      <div class="addr" data-a="addr"><img src="assets/mark.png"><span>physics.dongsiwei.com</span></div>
      <span class="navb" style="left:${WIN.w - 70}px">${ic('share', 16)}</span><span class="navb" style="left:${WIN.w - 40}px">${ic('tabs', 16)}</span></div>
    <div class="content"><div class="page">${page}</div></div>
  </div>`;
}

/* ───────── sidebar (shared by every page) */
const RECENT = [['水平面（极缓斜面）上受摩擦减速到停止', '18 分钟前'], ['磁场中的带电粒子运动', '1 天前'], ['凸透镜成像规律', '1 天前'], ['匀速直线运动', '1 天前'],
  ['光电效应', '1 天前'], ['磁通量变化产生感应电流', '1 天前'], ['导轨双棒 · 恒力型', '1 天前'], ['导轨双棒 · 冲量型', '1 天前']];
const HISTORY = [['匀速运动路程计算题', '1 天前'], ['圆筒与无人机运动问题', '5 天前'], ['两弹簧物块升降距离求解', '5 天前'], ['洛伦兹力为何不做功', '6 天前']];
function side(Sd) {
  const nav = [['home', '首页', 'home', 150], ['lab', '物理实验室', 'flask', 228], ['exam', '出卷专区', 'doc', 268], ['fb', '反馈', 'mega', 308],
    ['lib', '资源库', 'book', 348], ['up', '实验上传', 'upload', 388], ['plug', '插件', 'plug', 428]];
  const recent = (Sd.newRecent ? [[Sd.newRecent, '刚刚']] : []).concat(RECENT).slice(0, 8);
  const hist = (Sd.newHist ? [[Sd.newHist, '刚刚']] : []).concat(HISTORY).slice(0, 5);
  let h = `<div class="side">
    <div class="brand"><span class="mk" data-a="logo"><img src="assets/mark.png">${Sd.logoFx || ''}</span><div><b>PhysicsOS</b><small>PhysicsOS 开放学校</small></div></div>
    <span class="sic" style="left:242px;top:22px">${ic('panel', 17)}</span>
    <div class="newc">${ic('plusc', 15)}<span>新会话</span></div>
    <div class="sec" style="top:124px">主页</div><span class="sic" style="left:244px;top:122px">${ic('chevd', 14)}</span>
    <div class="sec" style="top:202px">探索</div><span class="sic" style="left:244px;top:200px">${ic('chevd', 14)}</span>`;
  for (const [k, label, icon, y] of nav) {
    const cls = Sd.active === k ? ' on' : Sd.hover === k ? ' hov' : '';
    h += `<div class="it${cls}" data-a="nav-${k}" style="top:${y}px">${ic(icon, 16)}<span>${label}</span></div>`;
  }
  h += `<div class="sec" style="top:484px">最近空间</div>`;
  recent.forEach(([t, tm], i) => { h += `<div class="rs${Sd.newRecent && i === 0 && Sd.recentOn ? ' on' : ''}" style="top:${502 + i * 33}px">${ic('flask', 14)}<span class="t">${t}</span><span class="tag">实验</span><span class="tm">${tm}</span></div>`; });
  h += `<div class="sec" style="top:778px">历史对话</div>`;
  hist.forEach(([t, tm], i) => { h += `<div class="rs${Sd.newHist && i === 0 ? ' on' : ''}" style="top:${796 + i * 33}px">${ic('chat', 14)}<span class="t">${t}</span><span class="tm">${tm}</span></div>`; });
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
    <div class="cont" style="${abs(528, 180, 410, 285)}"><div class="k">继续上次实验</div><div class="t">水平面（极缓斜面）上受摩擦<br>减速到停止</div><div class="m">力学 · 实验 · 18 分钟前</div><div class="go">继续 ${ic('playo', 12, 2)}</div><img src="assets/art/lab.jpg" style="${abs(290, 104, 104, 72)}"></div>
    <div class="rk" style="${abs(961, 180)}">为你推荐</div>`;
  [['projectile-horizontal', '平抛运动', '水平抛出 · h = 20 m · v<sub>0</sub> = 10 m/s'], ['parallel-plate', '平行板电场偏转', '类平抛 · 电子穿越极间'], ['magnetic-circular', '磁场中的带电粒子运动', '正电粒子垂直进入匀强磁场']]
    .forEach(([id, t, s], i) => { h += `<div class="rec" style="${abs(961, 205 + i * 89, 705, 81)}"><img src="assets/art/${id}.jpg"><div class="k">经典实验</div><div class="t">${t}</div><div class="s">${s}</div></div>`; });
  h += `<div class="free" style="${abs(528, 480, 1138, 74)}"><span class="fi">${ic('box', 18)}</span><div class="t">自由搭建电路</div><div class="s">自己选器材、自己接线，探究直接求解。</div><span class="fa">开始搭建</span></div>
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

/* ───────── 平抛运动 experiment bench */
export const physics = (h, v0, g = 9.8) => { const t = Math.sqrt(2 * h / g); return { t, R: v0 * t, H: h, v: Math.hypot(v0, g * t) }; };
const f2 = (x, d = 2) => x.toFixed(d);
function bench(B) {
  const h = B.hC ?? 5, v0 = B.v0C ?? 5, P = physics(h, v0);
  const run = B.run || 'idle', tau = B.tau || 0;
  const tShow = run === 'idle' ? 0 : Math.min(tau, P.t), vShow = Math.hypot(v0, 9.8 * tShow);
  const frac = run === 'idle' ? 0 : Math.min(1, tau / P.t);
  let o = `<div class="bn">`;
  // toolbar
  o += `<div class="btb">
    <span class="bk">${ic('chevl', 14)}返回对话</span><span class="btt">平抛运动</span><span class="bts">抛体运动 · 水平/斜抛</span><span class="sic" style="left:560px;top:24px;color:#9AA0A6">${ic('chevd', 14)}</span>
    <span class="badge" data-a="badge" style="${abs(1122 - 292, 37 - 12, 89, 26)}">${ic('shield', 13)}引擎已验证</span>
    <span class="runb${B.runHover ? ' hov' : ''}${B.runDown ? ' dn' : ''}" data-a="run" style="${abs(1221 - 292, 34 - 12, 64, 32)}">${run === 'done' ? ic('replay', 13) + '重播' : ic('play', 12) + '运行'}</span>
    <span class="tb2" style="${abs(1293 - 292, 22, 62, 32)}">${ic('pause', 14)}暂停</span><span class="tb2 dim" style="${abs(1361 - 292, 22, 56, 32)}">${ic('chevr', 13)}单步</span>
    <span class="tb2" style="${abs(1422 - 292, 22, 64, 32)}">${ic('reset', 13)}重置</span><span class="tb3" style="${abs(1500 - 292, 22, 86, 32)}">${ic('guide', 14)}实验指南</span>
    <span class="tb3" style="${abs(1592 - 292, 22, 58, 32)}">${ic('report', 14)}报告</span><span class="tb3" style="${abs(1656 - 292, 22, 86, 32)}">${ic('focus', 14)}专注实验</span>
    <span class="aib" style="${abs(1752 - 292, 22, 100, 32)}"><img src="assets/mascot-wave-320.webp">AI 助教</span><span class="tb3" style="${abs(1866 - 292, 22, 28, 32)}">${ic('more', 16)}</span></div>`;
  // scene tree
  o += `<div class="tree"><div class="th2">场景与对象<span>${ic('chevl', 14)}</span></div>
    <div class="ti sel" style="top:66px">${ic('chevd', 12)}场景</div>
    <div class="ti c" style="top:98px">${ic('box', 13)}物块<em>1 kg</em></div><div class="ti c" style="top:130px">${ic('arrowd', 13)}重力场<em>g</em></div><div class="ti c" style="top:162px">${ic('lines', 13)}地面</div>
    <div class="ti" style="top:200px">${ic('chevd', 12)}初始条件</div>
    <div class="ti c" style="top:232px">${ic('slash', 13)}初始高度<em>h</em></div><div class="ti c" style="top:264px">${ic('diag', 13)}初速度<em>v<sub>0</sub></em></div><div class="ti c" style="top:296px">${ic('slash', 13)}抛射角<em>θ</em></div>
    <div class="ti" style="top:334px">${ic('chevd', 12)}可观察量</div>
    <div class="ti c" style="top:366px"><b class="cb on">${ic('check', 10, 3)}</b>速度</div><div class="ti c" style="top:398px"><b class="cb"></b>速度分量</div>
    <div class="ti c" style="top:430px"><b class="cb on">${ic('check', 10, 3)}</b>轨迹</div><div class="ti c" style="top:462px"><b class="cb on">${ic('check', 10, 3)}</b>关键点</div></div>`;
  // stage
  o += `<div class="stg"><div class="cap1">PHYSICSOS · 交互实验</div><div class="cap2">平抛运动</div><div class="ver">PhysicsOS&nbsp; v2.0.0</div><div class="cap3">调节条件，观察变化</div></div>`;
  o += `<div class="cvs"><div class="cvt"><span>装置视角</span><span class="on">正视</span><span>查看全程</span><em>拖动旋转 · 自由观察</em></div>${canvas(B, h, v0, P, run, tau)}
    <div class="rdo"><span>${K('t')} = ${f2(tShow)} s</span><span>${K('v')} = ${f2(vShow)} m/s</span><span>${K('a')} = 9.8 m/s²</span></div>
    <div class="plb"><span class="pbt">${run === 'fly' ? '暂停' : '播放'}</span><div class="trk"><i style="width:${(frac * 100).toFixed(2)}%"></i><b style="left:${(frac * 100).toFixed(2)}%"></b></div><span class="ptm">${f2(tShow)} / ${f2(P.t)} s</span></div></div>`;
  // conditions panel
  const fld = (label, key, val, unit, y) => `<div class="cl" style="top:${y}px">${label}</div><div class="cf${B.focus === key ? ' foc' : ''}" data-a="f-${key}" style="top:${y + 18}px">${B.sel === key ? `<span class="sl">${val}</span>` : val}${B.focus === key && B.caret ? '<i class="crt"></i>' : ''}</div>`;
  o += `<div class="cond"><div class="ch">实验条件<span>—</span></div>${fld('初始高度 / m', 'h', B.hText ?? '5', 'm', 52)}${fld('初速度 / m/s', 'v0', B.v0Text ?? '5', 'm/s', 130)}${fld('抛射角 / °', 'th', '0', '°', 208)}${fld('重力加速度 / m/s²', 'g', '9.8', 'm/s²', 286)}</div>`;
  // timeline + bottom tabs
  o += `<div class="tml"><span class="tr0">${ic('replay', 14, 2)}</span><span class="tr1">${ic('chevl', 13)}</span><span class="tr1">${ic('chevr', 13)}</span><span class="tt0">${f2(tShow)} s</span>
    <div class="ttk"><i style="width:${(frac * 100).toFixed(2)}%"></i><b style="left:${(frac * 100).toFixed(2)}%"></b></div><span class="tt0">${f2(P.t)} s</span><span class="spd">0.5x ${ic('chevd', 12)}</span></div>
    <div class="btabs"><span>要点</span><span>数据</span><span>图像</span><span>推导</span><span>事件</span><em>展开</em></div>`;
  // inspector
  const ins = (label, sym, val, unit, y) => `<div class="il" style="top:${y}px">${label}<em>${K(sym)}</em></div><div class="if" style="top:${y + 16}px"><span>${val}</span><b>${unit}</b></div>`;
  const row = (key, label, sym, val, unit, y) => `<div class="dr${B.hoverRow === key ? ' hov' : ''}" data-a="row-${key}" style="top:${y}px"><span>${label} ${K(sym)}</span><b>${val}</b><i>${unit}</i></div>`;
  o += `<div class="insp"><div class="ih">检查器<span>${ic('chevr', 15)}</span></div><div class="itabs"><span class="on">属性</span><span>读数</span><span>校验</span></div>
    <div class="isec" style="top:120px">初始条件</div>${ins('初始高度', 'h', B.hC ?? 5, 'm', 146)}${ins('初速度', 'v<sub>0</sub>', B.v0C ?? 5, 'm/s', 222)}${ins('抛射角', 'θ', 0, '°', 296)}${ins('重力加速度', 'g', 9.8, 'm/s²', 371)}
    <div class="isec" data-a="derived" style="top:446px">派生量</div>
    ${row('flight', '飞行时间', 't', f2(P.t), 's', 466)}${row('range', '水平射程', 'R', (Math.round(P.R * 10) / 10).toString(), 'm', 504)}${row('height', '最大高度', 'H', String(h), 'm', 542)}${row('landing', '落地速度', 'v', f2(P.v), 'm/s', 580)}</div>`;
  return o + '</div>';
}

/** front-view canvas: grid, ground, platform, trajectory, key points, markers (page px) */
function canvas(B, h, v0, P, run, tau) {
  const { x0, y0, w, k, ground, platL, platW } = BENCH, top = ground - h * k, xl = platL + platW;
  let s = `<svg class="cv" data-a="canvas" width="${w}" height="${BENCH.h}" viewBox="${x0} ${y0} ${w} ${BENCH.h}">
    <defs><linearGradient id="gd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#EAE7DF"/><stop offset="1" stop-color="#E2DED4"/></linearGradient>
    <linearGradient id="pl" x1="0" x2="1"><stop offset="0" stop-color="#D9DFE6"/><stop offset=".55" stop-color="#F3F6F8"/><stop offset="1" stop-color="#CBD3DC"/></linearGradient></defs>
    <rect x="${x0}" y="${y0}" width="${w}" height="${BENCH.h}" fill="url(#gd)"/>`;
  for (let m = -5; m <= 40; m += 5) { const x = xl + m * k; if (x > x0 && x < x0 + w) s += `<line x1="${x}" y1="${y0}" x2="${x}" y2="${ground}" stroke="#D9D4C8" stroke-width="${m % 10 ? .6 : 1}"/>`; }
  for (let m = 0; m <= 25; m += 5) { const y = ground - m * k; if (y > y0) s += `<line x1="${x0}" y1="${y}" x2="${x0 + w}" y2="${y}" stroke="#D9D4C8" stroke-width="${m % 10 ? .6 : 1}"/>`; }
  s += `<rect x="${x0}" y="${ground}" width="${w}" height="${BENCH.y0 + BENCH.h - ground}" fill="#D8D3C6"/><line x1="${x0}" y1="${ground}" x2="${x0 + w}" y2="${ground}" stroke="#A8A293" stroke-width="1.6"/>`;
  // platform (top slab + column), its top edge is the mascot's floor
  s += `<rect x="${platL + 8}" y="${top + 10}" width="${platW - 16}" height="${ground - top - 10}" fill="url(#pl)" stroke="#B9C2CC" stroke-width="1"/>
    <rect x="${platL - 4}" y="${top}" width="${platW + 8}" height="12" rx="3" fill="#FBFCFD" stroke="#B9C2CC" stroke-width="1" data-a="plat"/>`;
  // height dimension
  s += `<line x1="${platL - 26}" y1="${top}" x2="${platL - 26}" y2="${ground}" stroke="#7E8794" stroke-width="1.2" marker-start="url(#ar)"/>
    <path d="M${platL - 31} ${top + 7} l5 -7 l5 7 M${platL - 31} ${ground - 7} l5 7 l5 -7" fill="none" stroke="#7E8794" stroke-width="1.2"/>
    <rect x="${platL - 92}" y="${(top + ground) / 2 - 12}" width="58" height="24" rx="6" fill="#FFFFFF" stroke="#D9DDE2"/><text x="${platL - 63}" y="${(top + ground) / 2 + 5}" class="cvl" text-anchor="middle">h = ${h} m</text>`;
  if (run === 'done') {
    // trajectory (dashed) + key points every 0.2 s, the engine's own overlay
    const L0 = launchPt(h), at = tt => ({ x: L0.x + v0 * tt * k, y: L0.y + 4.9 * tt * tt * k });
    let d = '', pts = '';
    for (let i = 0; i <= 40; i++) { const p = at(P.t * i / 40); d += `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`; }
    s += `<path d="${d}" fill="none" stroke="#8B9AA8" stroke-width="1.4" stroke-dasharray="5 6" opacity="${B.trajOp ?? 1}"/>`;
    for (let i = 1; i <= 10; i++) { const tt = .2 * i; if (tt > P.t) break; const p = at(tt);
      pts += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.2" fill="#9BA79F" stroke="#7E8A82" stroke-width=".8"/>`;
      if (i === 5 || i === 9) pts += `<text x="${(p.x + 10).toFixed(1)}" y="${(p.y - 8).toFixed(1)}" class="cvs2">t=${tt.toFixed(1)} s</text>`; }
    s += `<g opacity="${B.trajOp ?? 1}">${pts}</g>`;
    const x0r = L0.x, xr = L0.x + P.R * k;
    s += `<g opacity="${B.markOp ?? 1}"><path d="M${xr - 17} ${ground} a17 17 0 0 1 34 0z" fill="#2E6B4F"/><rect x="${xr - 26}" y="${ground - 82}" width="52" height="22" rx="6" fill="#fff" stroke="#D5DAD6"/><text x="${xr}" y="${ground - 67}" class="cvl" text-anchor="middle">落地点</text></g>
      <g opacity="${B.dimOp ?? 1}"><line x1="${x0r}" y1="${ground + 24}" x2="${xr}" y2="${ground + 24}" stroke="#7E8794" stroke-width="1.2"/><path d="M${x0r} ${ground + 18}v12M${xr} ${ground + 18}v12" stroke="#7E8794" stroke-width="1.2"/>
      <rect x="${(x0r + xr) / 2 - 42}" y="${ground + 13}" width="84" height="22" rx="6" fill="#fff" stroke="#D9DDE2"/><text x="${(x0r + xr) / 2}" y="${ground + 28}" class="cvl" text-anchor="middle">R = ${(Math.round(P.R * 10) / 10)} m</text></g>`;
  }
  if (B.vArrow) {          // velocity arrow on the ball (observable 速度), from the film's ball centre
    const { x, y, vx, vy } = B.vArrow, L = Math.hypot(vx, vy) * 3.6, ux = vx / Math.hypot(vx, vy), uy = vy / Math.hypot(vx, vy);
    const ex = x + ux * L, ey = y + uy * L;
    s += `<line x1="${x}" y1="${y}" x2="${ex}" y2="${ey}" stroke="#3D7BC4" stroke-width="2.4"/><path d="M${ex} ${ey} l${(-ux * 11 - uy * 6).toFixed(1)} ${(-uy * 11 + ux * 6).toFixed(1)} M${ex} ${ey} l${(-ux * 11 + uy * 6).toFixed(1)} ${(-uy * 11 - ux * 6).toFixed(1)}" stroke="#3D7BC4" stroke-width="2.4" fill="none"/>
      <rect x="${ex + 6}" y="${ey - 22}" width="22" height="20" rx="5" fill="#fff" stroke="#D5DAE2"/><text x="${ex + 17}" y="${ey - 8}" class="cvl" text-anchor="middle" font-style="italic">v</text>`;
  }
  return s + '</svg>';
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
  ['正电粒子垂直进入匀强磁场', '比较不同角度的平抛轨迹', '为什么洛伦兹力不做功?'].forEach((c, i) => { o += `<div class="chip" style="${abs([851, 1025, 1187][i], 586, [166, 154, 154][i], 28)}">${c}</div>`; });
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
    <div class="ctab"><span class="on">对话</span><span>轨迹</span></div>
    <div class="cscroll"><div class="cin" style="transform:translateY(${-(C.scroll || 0)}px)">
      <div class="ubub" data-a="bubble" style="${C.bub ? `transform:${C.bub.tf};opacity:${C.bub.op}` : ''}">为什么洛伦兹力不做功？</div>
      <div class="ans">${body}</div></div></div></div>`;
}
