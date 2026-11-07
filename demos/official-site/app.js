import { loadContent, STORAGE_KEY } from './content.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let globalMotionPaused = document.documentElement.dataset.motion === 'paused';
const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const icon = (name) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon'); svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(svg.namespaceURI, 'use'); use.setAttribute('href', `#i-${name}`);
  svg.append(use); return svg;
};

$('#menu-toggle').addEventListener('click', () => {
  const open = $('#main-nav').classList.toggle('is-open');
  $('#menu-toggle').setAttribute('aria-expanded', String(open));
  $('#menu-toggle').setAttribute('aria-label', open ? '关闭导航' : '打开导航');
});
$$('#main-nav a').forEach(a => a.addEventListener('click', () => {
  $('#main-nav').classList.remove('is-open'); $('#menu-toggle').setAttribute('aria-expanded', 'false');
}));

// Only approved, shape-checked content from this browser is rendered; no HTML injection.
let content = loadContent();
let contentSnapshot = JSON.stringify(content);
let carouselIndex = content.testimonials.length;
let carouselBusy = false;
let carouselPaused = reducedMotion.matches;
let carouselHovered = false;
let carouselVisible = false;
let carouselTimer;

function avatar(person) {
  const node = make('span', 'person-avatar', person.name.slice(0, 1).toUpperCase());
  node.style.backgroundColor = person.color;
  if (person.avatar) {
    const img = make('img'); img.src = person.avatar; img.alt = `${person.name}的头像`;
    img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => img.remove(), { once: true }); node.append(img);
    img.style.position = 'absolute'; node.style.position = 'relative';
  }
  return node;
}
function testimonialCard(person, duplicate) {
  const card = make('article', 'testimonial-card');
  if (duplicate) card.setAttribute('aria-hidden', 'true');
  card.append(make('span', 'testimonial-topic', person.topic), make('blockquote', '', person.quote));
  const author = make('div', 'person'); const detail = make('div');
  detail.append(make('div', 'person-name', person.name), make('div', 'person-role', person.role));
  author.append(avatar(person), detail, make('span', 'person-heart', '♡')); card.append(author); return card;
}
function renderContent() {
  const items = content.testimonials;
  carouselIndex = items.length; carouselBusy = false;
  $('#testimonials').dataset.count = String(items.length);
  ['#voices-prev', '#voices-next', '#voices-pause'].forEach(selector => $(selector).disabled = items.length < 2);
  $('#testimonials').replaceChildren(...[...items, ...items, ...items].map((person, i) => testimonialCard(person, i < items.length || i >= items.length * 2)));
  $('#carousel-dots').replaceChildren(...items.map((_, i) => {
    const dot = make('button'); dot.type = 'button'; dot.setAttribute('aria-label', `查看第 ${i + 1} 条反馈`);
    dot.addEventListener('click', () => carouselGo(items.length + i)); return dot;
  }));
  $('#contributors').replaceChildren(...content.contributors.map(person => {
    const card = make('a', 'contributor-card'); card.href = person.url; card.target = '_blank'; card.rel = 'noopener noreferrer';
    card.setAttribute('aria-label', `${person.name}的${person.project}，打开项目`);
    const top = make('div', 'contributor-card-top'); const detail = make('div');
    detail.append(make('div', 'person-name', person.name), make('div', 'person-role', person.role)); top.append(avatar(person), detail);
    const project = make('div', 'contributor-project'); project.append(make('h3', '', person.project), icon('up-right'));
    const bottom = make('div', 'project-bottom'); bottom.append(icon('github'), make('span', '', 'OPEN COLLABORATION'), make('span', '', '一起共创 ↗'));
    card.append(top, project, make('p', '', person.description), bottom); return card;
  }));
  requestAnimationFrame(() => positionCarousel(false));
}
function positionCarousel(animate = true) {
  const track = $('#testimonials'); const first = track.firstElementChild; if (!first) return;
  const step = first.getBoundingClientRect().width + parseFloat(getComputedStyle(track).gap);
  track.style.transition = animate && !reducedMotion.matches && !globalMotionPaused ? '' : 'none';
  track.style.transform = `translateX(${-carouselIndex * step}px)`;
  const active = ((carouselIndex % content.testimonials.length) + content.testimonials.length) % content.testimonials.length;
  $$('#carousel-dots button').forEach((dot, i) => dot.setAttribute('aria-current', String(i === active)));
}
function carouselGo(next) {
  if (carouselBusy || content.testimonials.length < 2) return;
  carouselBusy = true; carouselIndex = next; positionCarousel(true);
  clearTimeout(carouselTimer);
  carouselTimer = setTimeout(() => {
    const n = content.testimonials.length;
    carouselIndex = n + ((carouselIndex % n) + n) % n;
    positionCarousel(false); carouselBusy = false;
  }, reducedMotion.matches || globalMotionPaused ? 0 : 620);
}
$('#voices-prev').addEventListener('click', () => carouselGo(carouselIndex - 1));
$('#voices-next').addEventListener('click', () => carouselGo(carouselIndex + 1));
function updateCarouselPause() {
  $('#voices-pause').textContent = carouselPaused ? '▷' : 'Ⅱ';
  $('#voices-pause').setAttribute('aria-label', carouselPaused ? '播放反馈轮播' : '暂停反馈轮播');
}
$('#voices-pause').addEventListener('click', () => { carouselPaused = !carouselPaused; updateCarouselPause(); });
$('.testimonial-window').addEventListener('mouseenter', () => carouselHovered = true);
$('.testimonial-window').addEventListener('mouseleave', () => carouselHovered = false);
setInterval(() => {
  if (!carouselPaused && !globalMotionPaused && !carouselHovered && carouselVisible && !document.hidden && !$('#voices').contains(document.activeElement)) carouselGo(carouselIndex + 1);
}, 6000);
new IntersectionObserver(([entry]) => carouselVisible = entry.isIntersecting, { threshold: .2 }).observe($('#voices'));
new ResizeObserver(() => positionCarousel(false)).observe($('.testimonial-window'));
function reloadContent() {
  const next = loadContent(); const snapshot = JSON.stringify(next);
  if (snapshot !== contentSnapshot) { content = next; contentSnapshot = snapshot; renderContent(); }
}
window.addEventListener('storage', event => { if (event.key === STORAGE_KEY) reloadContent(); });
window.addEventListener('focus', reloadContent);
renderContent(); updateCarouselPause();

// Small conceptual illustrations, separate from the production physics engine.
const canvas = $('#experiment-canvas'); const ctx = canvas.getContext('2d');
let width = 600, height = 350, experiment = 'wave', time = 0;
let playing = !reducedMotion.matches, stageVisible = false, lastFrame = null, experimentFrame = null;
const presets = {
  wave: { title: '原来，波是这样\n「走」过去的。', description: '试着改变频率，观察波形的变化。看见每个质点的运动，理解波如何传递能量。', caption: '波向前走，质点留在原地。', formula: 'v = λf', label: '波源频率', value: 15, min: 5, max: 30, unit: v => `${(v / 10).toFixed(1)} Hz` },
  orbit: { title: '换个磁场，\n轨迹也会不一样。', description: '增大磁场强度，粒子的轨道半径会怎样？轻轻拖动滑块，看看方向与轨迹之间的关系。', caption: '洛伦兹力改变方向，不改变速率。', formula: 'r = mv / qB', label: '磁场强度', value: 10, min: 5, max: 20, unit: v => `${(v / 10).toFixed(1)} T` },
  projectile: { title: '同样的起点，\n不同的远方。', description: '在同一初速度下，试着改变抛射角度。忽略空气阻力时，什么角度会让小球飞得最远？', caption: '水平方向匀速，竖直方向受重力。', formula: 'R = v₀² sin(2θ) / g', label: '抛射角度', value: 45, min: 15, max: 75, unit: v => `${v}°` },
};
function pauseLabel() {
  $('#pause-experiment').setAttribute('aria-label', playing ? '暂停动画' : '播放动画');
  $('#pause-experiment').textContent = playing ? 'Ⅱ' : '▷';
}
function selectExperiment(key) {
  experiment = key; time = 0; const preset = presets[key];
  $$('.experiment-tabs button').forEach(button => {
    const selected = button.dataset.experiment === key;
    button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
  });
  $('#experiment-panel').setAttribute('aria-labelledby', `tab-${key}`);
  const title = $('#experiment-title'); title.replaceChildren();
  preset.title.split('\n').forEach((line, i) => { if (i) title.append(document.createElement('br')); title.append(document.createTextNode(line)); });
  $('#experiment-description').textContent = preset.description; $('#stage-caption').textContent = preset.caption;
  $('#stage-formula').textContent = preset.formula; $('#range-label-text').textContent = preset.label;
  const range = $('#experiment-range'); range.min = preset.min; range.max = preset.max; range.value = preset.value;
  $('#range-value').textContent = preset.unit(preset.value);
  const endpoints = $$('.range-endpoints span');
  [endpoints[0].textContent, endpoints[1].textContent] = key === 'wave' ? ['慢一点', '快一点'] : key === 'orbit' ? ['弱一点', '强一点'] : ['低一点', '高一点'];
  draw();
}
$$('.experiment-tabs button').forEach((button, i, buttons) => {
  button.addEventListener('click', () => selectExperiment(button.dataset.experiment));
  button.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight') next = (i + 1) % buttons.length;
    if (event.key === 'ArrowLeft') next = (i + buttons.length - 1) % buttons.length;
    if (event.key === 'Home') next = 0; if (event.key === 'End') next = buttons.length - 1;
    if (next !== undefined) { event.preventDefault(); selectExperiment(buttons[next].dataset.experiment); buttons[next].focus(); }
  });
});
$('#experiment-range').addEventListener('input', event => { $('#range-value').textContent = presets[experiment].unit(+event.target.value); draw(); });
$('#pause-experiment').addEventListener('click', () => { playing = !playing; pauseLabel(); syncExperimentFrame(); });
function dot(x, y, radius, color = '#8cb761') {
  const gradient = ctx.createRadialGradient(x - radius * .35, y - radius * .45, 0, x, y, radius);
  gradient.addColorStop(0, '#fcfff3'); gradient.addColorStop(.32, color); gradient.addColorStop(1, color);
  ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#ffffffba'; ctx.lineWidth = 1; ctx.stroke();
}
function draw() {
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  const value = +$('#experiment-range').value;
  const mid = height * .5, margin = width * .08;
  if (experiment === 'wave') {
    const frequency = value / 10; const amplitude = height * .15;
    const yAt = x => mid + Math.sin((x - margin) / (width - 2 * margin) * Math.PI * frequency * 1.9 - time * frequency * 1.8) * amplitude;
    ctx.strokeStyle = '#b7c7a47a'; ctx.setLineDash([4, 5]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(margin, mid); ctx.lineTo(width - margin, mid); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath();
    for (let x = margin; x <= width - margin; x += 2) { if (x === margin) ctx.moveTo(x, yAt(x)); else ctx.lineTo(x, yAt(x)); }
    ctx.strokeStyle = '#a4bd87'; ctx.lineWidth = 2; ctx.stroke();
    for (let i = 0; i <= 27; i++) {
      const x = margin + (width - 2 * margin) * i / 27;
      dot(x, yAt(x), i === 12 ? 10 : 5.5, i === 12 ? '#9fc6cc' : '#b1c993');
    }
    const selectedX = margin + (width - margin * 2) * 12 / 27;
    ctx.strokeStyle = '#8aa9a855'; ctx.setLineDash([3, 4]); ctx.beginPath(); ctx.moveTo(selectedX, mid - amplitude - 26); ctx.lineTo(selectedX, mid + amplitude + 25); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#99aa8a'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('只振动，不迁移', selectedX, mid + amplitude + 48);
    ctx.strokeStyle = '#a3b992'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(width - 129, 72); ctx.lineTo(width - 57, 72); ctx.lineTo(width - 63, 68); ctx.moveTo(width - 57, 72); ctx.lineTo(width - 63, 76); ctx.stroke();
    ctx.fillStyle = '#9cae8b'; ctx.font = '8px sans-serif'; ctx.fillText('能量传播方向', width - 94, 64);
  } else if (experiment === 'orbit') {
    const radius = Math.min(height * .34, width * .32) * (10 / value) * .7;
    const cx = width / 2, cy = height * .52, angle = time * value / 12;
    ctx.fillStyle = '#c0ceb6'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
    for (let x = margin + 5; x < width - margin; x += 46) for (let y = 84; y < height - 60; y += 42) ctx.fillText('×', x, y);
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.strokeStyle = '#97b77e'; ctx.lineWidth = 2; ctx.stroke();
    const x = cx + radius * Math.cos(angle), y = cy + radius * Math.sin(angle);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.setLineDash([3, 4]); ctx.strokeStyle = '#a0b28d99'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
    dot(x, y, 10, '#9dc4c5'); dot(cx, cy, 3, '#afbf98');
    ctx.fillStyle = '#839b6c'; ctx.font = 'italic 13px Georgia'; ctx.fillText('r', cx + (x - cx) / 2 + 9, cy + (y - cy) / 2 - 6);
  } else {
    const angle = value * Math.PI / 180; const startX = margin, ground = height - 70;
    const maxRange = width - margin * 2, flightTime = 2 * Math.sin(angle);
    const position = t => ({ x: startX + maxRange * Math.cos(angle) * t, y: ground - Math.min(height * .62, maxRange * .45) * 2 * (Math.sin(angle) * t - .5 * t * t) });
    ctx.strokeStyle = '#bfcdb0'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(margin - 5, ground); ctx.lineTo(width - margin + 5, ground); ctx.stroke();
    ctx.strokeStyle = '#a3bb88'; ctx.lineWidth = 2; ctx.setLineDash([4, 5]); ctx.beginPath();
    for (let i = 0; i <= 100; i++) { const p = position(flightTime * i / 100); if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); } ctx.stroke(); ctx.setLineDash([]);
    const p = position(((time * .28) % 1) * flightTime); dot(p.x, p.y, 10, '#a3c0c4'); dot(startX, ground, 5, '#b0c792');
    ctx.fillStyle = '#92a47e'; ctx.font = 'italic 12px Georgia'; ctx.textAlign = 'left'; ctx.fillText(`θ = ${value}°`, startX + 7, ground + 21);
  }
}
new ResizeObserver(([entry]) => {
  width = entry.contentRect.width; height = entry.contentRect.height;
  const dpr = Math.min(window.devicePixelRatio || 1, 2); canvas.width = width * dpr; canvas.height = height * dpr;
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0); draw();
}).observe($('.experiment-stage'));
new IntersectionObserver(([entry]) => {
  stageVisible = entry.isIntersecting;
  syncExperimentFrame();
}).observe($('.experiment-stage'));
function experimentShouldRun() {
  return Boolean(ctx) && playing && stageVisible && !document.hidden && !globalMotionPaused;
}
function syncExperimentFrame() {
  if (!experimentShouldRun()) {
    if (experimentFrame !== null) cancelAnimationFrame(experimentFrame);
    experimentFrame = null;
    lastFrame = null;
  } else if (experimentFrame === null) {
    experimentFrame = requestAnimationFrame(frame);
  }
}
function frame(timestamp) {
  experimentFrame = null;
  if (!experimentShouldRun()) { lastFrame = null; return; }
  const delta = lastFrame === null ? 0 : Math.min((timestamp - lastFrame) / 1000, .05);
  lastFrame = timestamp;
  time += delta;
  draw();
  syncExperimentFrame();
}
document.addEventListener('visibilitychange', syncExperimentFrame);
document.addEventListener('physicsos:motion', event => {
  if (typeof event.detail?.paused !== 'boolean') return;
  globalMotionPaused = event.detail.paused;
  if (globalMotionPaused) positionCarousel(false);
  syncExperimentFrame();
});
reducedMotion.addEventListener('change', event => {
  if (event.matches) { playing = false; carouselPaused = true; pauseLabel(); updateCarouselPause(); }
  syncExperimentFrame();
});
pauseLabel(); syncExperimentFrame();

// Feedback stays in IndexedDB on this device; no network submission in the design prototype.
const dialog = $('#feedback-dialog'); let returnFocus; let selectedImages = []; let fileBusy = false; let savingFeedback = false;
const allowedImages = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
function closeDialog() { if (savingFeedback) return; dialog.close(); returnFocus?.focus(); }
$$('.feedback-trigger').forEach(button => button.addEventListener('click', () => {
  returnFocus = button; $('#feedback-form-view').hidden = false; $('#feedback-success').hidden = true;
  dialog.showModal(); $('#feedback-body').focus();
}));
$('.dialog-close').addEventListener('click', closeDialog); $('.dialog-done').addEventListener('click', closeDialog);
dialog.addEventListener('click', event => {
  const r = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) closeDialog();
});
dialog.addEventListener('close', () => returnFocus?.focus());
dialog.addEventListener('cancel', event => { if (savingFeedback) event.preventDefault(); });
$('#feedback-body').addEventListener('input', event => { $('#feedback-count').textContent = `${event.target.value.length} / 2000`; $('#feedback-error').textContent = ''; });
function imagePreviews() {
  $('#image-previews').replaceChildren(...selectedImages.map((entry, index) => {
    const box = make('div', 'image-preview'); const img = make('img'); img.src = entry.url; img.alt = entry.file.name;
    const remove = make('button', '', '×'); remove.type = 'button'; remove.setAttribute('aria-label', `移除图片 ${entry.file.name}`);
    remove.addEventListener('click', () => { URL.revokeObjectURL(entry.url); selectedImages.splice(index, 1); imagePreviews(); $('#feedback-error').textContent = ''; });
    box.append(img, remove); return box;
  }));
}
async function addImages(files) {
  if (fileBusy || savingFeedback) return; fileBusy = true;
  const errors = [];
  for (const file of files) {
    if (selectedImages.length >= 3) { errors.push('最多添加 3 张图片。'); break; }
    if (!allowedImages.has(file.type)) { errors.push('请使用 PNG、JPG、WebP 或 GIF 图片。'); continue; }
    if (file.size > 5 * 1024 * 1024) { errors.push('每张图片需要小于 5 MB。'); continue; }
    if (selectedImages.some(entry => entry.file.name === file.name && entry.file.size === file.size && entry.file.lastModified === file.lastModified)) continue;
    const url = URL.createObjectURL(file); const check = new Image(); check.src = url;
    try { await check.decode(); selectedImages.push({ file, url }); }
    catch { URL.revokeObjectURL(url); errors.push('有图片无法读取，请换一张试试。'); }
  }
  fileBusy = false; imagePreviews(); $('#feedback-error').textContent = [...new Set(errors)].join(' ');
  $('#feedback-images').value = '';
}
$('#feedback-images').addEventListener('change', event => addImages([...event.target.files]));
['dragenter', 'dragover'].forEach(name => $('#upload-area').addEventListener(name, event => { event.preventDefault(); $('#upload-area').classList.add('dragging'); }));
['dragleave', 'drop'].forEach(name => $('#upload-area').addEventListener(name, event => { event.preventDefault(); $('#upload-area').classList.remove('dragging'); }));
$('#upload-area').addEventListener('drop', event => addImages([...event.dataTransfer.files]));
async function saveFeedback(record) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('physicsos-website-preview', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('feedback', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('feedback', 'readwrite'); transaction.objectStore('feedback').put(record);
      transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
$('#feedback-form').addEventListener('submit', async event => {
  event.preventDefault(); const error = $('#feedback-error'); const form = event.currentTarget;
  if (savingFeedback) return;
  if (fileBusy) { error.textContent = '图片正在读取，请稍后再保存。'; return; }
  if ($('#feedback-body').value.trim().length < 5) { error.textContent = '再多说一点吧，至少需要 5 个字。'; $('#feedback-body').focus(); return; }
  savingFeedback = true;
  const kind = new FormData(form).get('kind');
  const fields = $$('input, textarea, button', form); fields.forEach(field => field.disabled = true);
  $('.dialog-close').disabled = true;
  const button = $('button[type=submit]', form); const prior = button.textContent;
  button.textContent = '正在保存…'; error.textContent = '';
  try {
    await saveFeedback({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), kind, body: $('#feedback-body').value.trim(), contact: $('#feedback-contact').value.trim(), images: selectedImages.map(entry => ({ name: entry.file.name, type: entry.file.type, blob: entry.file })) });
    $('#feedback-form-view').hidden = true; $('#feedback-success').hidden = false;
    form.reset(); selectedImages.forEach(entry => URL.revokeObjectURL(entry.url)); selectedImages = []; imagePreviews();
    $('#feedback-count').textContent = '0 / 2000'; $('.dialog-done').focus();
  } catch { error.textContent = '当前浏览器无法保存反馈，内容仍保留在表单中，请检查本地存储空间后重试。'; }
  finally { savingFeedback = false; fields.forEach(field => field.disabled = false); $('.dialog-close').disabled = false; button.replaceChildren(document.createTextNode(prior), icon('arrow')); }
});
