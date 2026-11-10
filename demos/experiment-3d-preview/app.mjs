import { Simulation, EXPERIMENTS, PARAMETERS, DURATION, chartData, format } from './simulation.mjs';

const $ = selector => document.querySelector(selector);
const simulation = new Simulation();
let lab = null;
let chart = null;
let chartMode = 'motion';
let currentChart = null;
let renderedKind = null;
let dataKey = '';
let toastTimer;
let sceneFailed = false;

function text(id, value) { document.getElementById(id).textContent = value; }
function showToast(message) {
  clearTimeout(toastTimer);
  text('toast', message);
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3200);
}
function fillRange(input, value) {
  const percent = 100 * (value - Number(input.min)) / (Number(input.max) - Number(input.min));
  input.style.setProperty('--fill', `${Math.max(0, Math.min(100, percent))}%`);
}

function buildParameters() {
  const fragment = document.createDocumentFragment();
  for (const field of PARAMETERS[simulation.kind]) {
    const group = document.createElement('div');
    group.className = 'parameter-field';
    const row = document.createElement('div');
    row.className = 'parameter-label-row';
    const label = document.createElement('label');
    label.className = 'parameter-name';
    label.htmlFor = `parameter-${field.key}`;
    label.append(document.createTextNode(field.label));
    const symbol = document.createElement('span');
    symbol.className = 'parameter-symbol';
    symbol.textContent = field.symbol;
    label.append(symbol);
    const valueWrap = document.createElement('span');
    valueWrap.className = 'parameter-value';
    const number = document.createElement('input');
    number.type = 'number';
    number.id = `parameter-${field.key}`;
    number.dataset.parameter = field.key;
    number.min = field.min;
    number.max = field.max;
    number.step = field.step;
    number.value = simulation.params[field.key].toFixed(field.digits);
    number.setAttribute('aria-label', `${field.label} ${field.symbol}，单位 ${field.unit}`);
    number.addEventListener('change', () => {
      if (!number.value.trim() || !Number.isFinite(number.valueAsNumber)) {
        number.value = simulation.params[field.key].toFixed(field.digits);
        return;
      }
      simulation.setParameter(field.key, number.valueAsNumber);
      number.value = simulation.params[field.key].toFixed(field.digits);
    });
    number.addEventListener('keydown', event => { if (event.key === 'Enter') number.blur(); });
    const unit = document.createElement('span');
    unit.textContent = field.unit;
    valueWrap.append(number, unit);
    row.append(label, valueWrap);
    const rangeWrap = document.createElement('div');
    rangeWrap.className = 'range-wrap';
    const low = document.createElement('span');
    low.className = 'range-edge';
    low.textContent = String(field.min);
    const range = document.createElement('input');
    range.type = 'range';
    range.min = field.min;
    range.max = field.max;
    range.step = field.step;
    range.value = simulation.params[field.key];
    range.dataset.range = field.key;
    range.setAttribute('aria-label', `${field.label}滑块`);
    range.addEventListener('input', () => simulation.setParameter(field.key, range.value));
    const high = document.createElement('span');
    high.className = 'range-edge';
    high.textContent = String(field.max);
    rangeWrap.append(low, range, high);
    group.append(row, rangeWrap);
    fragment.append(group);
  }
  $('#parameter-fields').replaceChildren(fragment);
}

function refreshParameters() {
  for (const field of PARAMETERS[simulation.kind]) {
    const number = $(`[data-parameter="${field.key}"]`);
    const range = $(`[data-range="${field.key}"]`);
    if (document.activeElement !== number) number.value = simulation.params[field.key].toFixed(field.digits);
    range.value = simulation.params[field.key];
    fillRange(range, simulation.params[field.key]);
    range.setAttribute('aria-valuetext', `${simulation.params[field.key]} ${field.unit}`);
  }
}

function updateReadouts() {
  const s = simulation.state;
  if (simulation.kind === 'lens') {
    text('hero-label', '理论像距 v');
    text('hero-value', s.v === null ? '∞' : format(s.v, 1));
    text('hero-unit', 'cm');
    text('metric-a-label', '放大率 m');
    text('metric-a-value', s.m === null ? '—' : format(s.m));
    text('metric-a-unit', '');
    text('metric-b-label', '成像性质');
    text('metric-b-value', s.atFocus ? '不成像' : s.v < 0 ? '正立虚像' : '倒立实像');
    text('metric-b-unit', '');
    const status = s.atFocus ? '位于焦点 · 无有限像' : s.v < 0 ? '虚像不可投屏' : s.v > 80 ? '实像超出光屏行程' : s.lit ? '光屏已合焦' : '光屏尚未合焦';
    $('#focus-status span').textContent = status;
    $('#focus-status use').setAttribute('href', s.lit ? '#i-check' : '#i-info');
    $('#focus-button').disabled = s.v === null || s.v <= 0 || s.v > 80;
    $('#focus-button').title = $('#focus-button').disabled ? '只有位于光轨范围内的实像可以自动对焦' : '把光屏移到理论像距位置';
    for (const button of document.querySelectorAll('[data-preset]')) {
      button.disabled = simulation.params.f * Number(button.dataset.preset) < 5;
      button.title = button.disabled ? '当前焦距下，预设物距小于 5 cm 的轨道范围' : '';
    }
  } else {
    text('hero-label', '理论周期 T');
    text('hero-value', format(s.period));
    text('hero-unit', 's');
    text('metric-a-label', simulation.kind === 'pendulum' ? '当前摆角 θ' : '平衡位移 x');
    text('metric-a-value', format(s.displacement));
    text('metric-a-unit', simulation.kind === 'pendulum' ? '°' : 'm');
    text('metric-b-label', '瞬时速率 v');
    text('metric-b-value', format(s.speed));
    text('metric-b-unit', 'm/s');
  }
  text('current-time', format(simulation.time));
  $('#timeline').value = simulation.time;
  fillRange($('#timeline'), simulation.time);
  $('#timeline').setAttribute('aria-valuetext', `${simulation.time.toFixed(2)} 秒`);
  const running = simulation.playing && simulation.kind !== 'lens';
  $('#play-symbol').setAttribute('href', running ? '#i-pause' : '#i-play');
  $('#play-button').setAttribute('aria-label', running ? '暂停模拟' : simulation.time >= DURATION ? '重新播放模拟' : '播放模拟');
  $('#status-dot').classList.toggle('paused', !running);
  text('scene-status-label', sceneFailed ? '三维不可用 · 数据可用' : simulation.kind === 'lens' ? '静态光路' : running ? '实时模拟' : simulation.time >= DURATION ? '本次观测结束' : '已暂停');
  text('readout-mode', simulation.kind === 'lens' ? 'OPTICS' : running ? 'LIVE' : 'PAUSED');
  $('#scene-hint').hidden = sceneFailed;
}

function refresh() {
  const experiment = EXPERIMENTS[simulation.kind];
  if (renderedKind !== simulation.kind) {
    renderedKind = simulation.kind;
    chartMode = 'motion';
    text('experiment-title', experiment.title);
    text('experiment-english', experiment.english);
    text('experiment-domain', experiment.domain);
    text('experiment-number', experiment.number);
    text('experiment-description', experiment.description);
    text('model-assumption', experiment.assumption);
    text('formula', experiment.formula);
    text('discovery-question', experiment.question);
    text('discovery-insight', experiment.insight);
    document.title = `${experiment.title} · PhysicsOS 空间实验台`;
    for (const button of document.querySelectorAll('[data-experiment]')) {
      const active = button.dataset.experiment === simulation.kind;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    }
    const optical = simulation.kind === 'lens';
    $('#transport').hidden = optical;
    $('#lens-transport').hidden = !optical;
    $('#lens-presets').hidden = !optical;
    $('#chart-tabs').hidden = optical;
    text('chart-heading', optical ? '成像规律' : '同步观测');
    text('path-label', optical ? '主光线' : '运动轨迹');
    text('vector-label', optical ? '焦点标记' : '速度矢量');
    buildParameters();
  }
  refreshParameters();
  for (const button of document.querySelectorAll('[data-layer]')) {
    const active = simulation.layers[button.dataset.layer];
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  for (const button of document.querySelectorAll('[data-chart]')) {
    const active = button.dataset.chart === chartMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  const key = `${simulation.kind}:${JSON.stringify(simulation.params)}:${chartMode}`;
  if (key !== dataKey) {
    dataKey = key;
    currentChart = chartData(simulation.kind, simulation.params, chartMode);
    chart?.setData(currentChart);
    text('chart-note', currentChart.note);
  }
  updateReadouts();
  if (!sceneFailed) lab?.render(simulation.snapshot());
  chart?.setCursor(simulation.kind === 'lens' ? simulation.params.u : simulation.time);
}

simulation.addEventListener('change', refresh);
for (const button of document.querySelectorAll('[data-experiment]')) button.addEventListener('click', () => simulation.select(button.dataset.experiment));
for (const button of document.querySelectorAll('[data-layer]')) button.addEventListener('click', () => {
  simulation.layers[button.dataset.layer] = !simulation.layers[button.dataset.layer];
  simulation.changed();
});
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => {
  for (const item of document.querySelectorAll('[data-view]')) {
    const active = item === button;
    item.classList.toggle('active', active);
    item.setAttribute('aria-pressed', String(active));
  }
  lab?.setView(button.dataset.view);
  $('#scene-hint > span:last-child').textContent = button.dataset.view === 'front' ? '正视观察 · 滚轮缩放' : '拖动旋转 · 滚轮缩放';
  if (!sceneFailed) lab?.render(simulation.snapshot());
});
for (const button of document.querySelectorAll('[data-chart]')) button.addEventListener('click', () => { chartMode = button.dataset.chart; refresh(); });
for (const button of document.querySelectorAll('[data-preset]')) button.addEventListener('click', () => simulation.preset(Number(button.dataset.preset)));
$('#home-button').addEventListener('click', () => lab?.home());
$('#play-button').addEventListener('click', () => simulation.toggle());
$('#rewind-button').addEventListener('click', () => simulation.rewind());
$('#timeline').addEventListener('input', event => simulation.seek(event.target.value));
$('#speed').addEventListener('change', event => { simulation.speed = Number(event.target.value); });
$('#reset-button').addEventListener('click', () => { simulation.reset(); showToast('已恢复当前实验的默认参数'); });
$('#focus-button').addEventListener('click', () => { simulation.focus(); showToast(`光屏已移至 ${format(simulation.params.d, 1)} cm`); });
$('#retry-button').addEventListener('click', () => location.reload());

function openDialog(dialog) {
  dialog.dataset.wasPlaying = String(simulation.playing);
  simulation.playing = false;
  simulation.changed();
  dialog.showModal();
}
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('close', () => {
    if (dialog.dataset.wasPlaying === 'true' && simulation.kind !== 'lens' && simulation.time < DURATION) simulation.playing = true;
    simulation.changed();
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
  });
}
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => document.getElementById(button.dataset.close).close());
$('#guide-button').addEventListener('click', () => openDialog($('#guide-dialog')));
$('#table-button').addEventListener('click', () => {
  if (!currentChart) return;
  const title = `${EXPERIMENTS[simulation.kind].title} · ${currentChart.title}`;
  text('table-title', title);
  text('table-caption', title);
  text('table-description', `与图表同源的 ${currentChart.series[0].values.length} 个采样点。${simulation.kind === 'lens' ? '∞ 表示焦点处无有限像距。' : '参数修改后，所有采样重新计算。'}`);
  const head = document.createElement('tr');
  for (const label of [currentChart.xLabel, ...currentChart.series.map(series => `${series.label} / ${currentChart.unit}`)]) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = label;
    head.append(cell);
  }
  $('#sample-table thead').replaceChildren(head);
  const body = document.createDocumentFragment();
  for (let index = 0; index < currentChart.series[0].values.length; index++) {
    const row = document.createElement('tr');
    const values = [currentChart.series[0].values[index].x, ...currentChart.series.map(series => series.values[index].y)];
    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = format(value, 3);
      row.append(cell);
    }
    body.append(row);
  }
  $('#sample-table tbody').replaceChildren(body);
  openDialog($('#table-dialog'));
});

function sceneError(message) {
  sceneFailed = true;
  $('#scene-loading').hidden = true;
  $('#scene-error').hidden = false;
  text('scene-error-text', `${message || '浏览器未能创建 WebGL 画面。'} 参数、计算和数据表仍然可用。`);
  updateReadouts();
}

refresh();
try {
  const { createChart } = await import('./chart.mjs');
  chart = createChart($('#chart-host'), { onSeek: x => simulation.kind === 'lens' ? simulation.setParameter('u', Math.round(x * 2) / 2) : simulation.seek(x) });
  chart.setData(currentChart);
  chart.setCursor(simulation.time);
} catch (error) {
  text('chart-note', '观测曲线加载失败；仍可使用数据表查看完整计算值。');
  console.error('Chart initialization failed:', error);
}
try {
  const { createLabScene } = await import('./scene.mjs');
  lab = createLabScene($('#scene-host'), {
    onError: sceneError,
    onParameter: (key, value) => { simulation.playing = false; simulation.setParameter(key, value); },
  });
  lab.render(simulation.snapshot());
  $('#scene-host canvas')?.addEventListener('webglcontextrestored', () => {
    const diagnostics = lab?.getDiagnostics();
    if (!diagnostics || diagnostics.contextLost || diagnostics.error) return;
    sceneFailed = false;
    $('#scene-error').hidden = true;
    refresh();
  });
  $('#scene-loading').hidden = true;
} catch (error) {
  sceneError(error.message);
  console.error('3D initialization failed:', error);
}

let previous = performance.now();
let lastReadout = 0;
let active = true;
function frame(now) {
  if (!active) return;
  const elapsed = Math.max(0, (now - previous) / 1000);
  previous = now;
  if (!document.hidden) {
    simulation.advance(elapsed);
    if (!sceneFailed) lab?.render(simulation.snapshot());
    chart?.setCursor(simulation.kind === 'lens' ? simulation.params.u : simulation.time);
    if (now - lastReadout > 50) { updateReadouts(); lastReadout = now; }
  }
  requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange', () => { previous = performance.now(); });
requestAnimationFrame(frame);
window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  active = false;
  lab?.dispose();
  chart?.dispose();
});
window.__SPATIAL_LAB__ = Object.freeze({
  snapshot: () => structuredClone({ ...simulation.snapshot(), playing: simulation.playing, speed: simulation.speed, chartMode }),
  diagnostics: () => ({ renderer: lab?.getDiagnostics(), sceneFailed, chartSamples: currentChart?.series[0].values.length }),
});
