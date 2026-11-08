import { mountOrbitField } from './orbit-field.js';

const root = document.documentElement;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const hero = document.querySelector('.hero-art');
const header = document.querySelector('.header');
const toggle = document.querySelector('#motion-toggle');
let userPaused = false;
try { userPaused = localStorage.getItem('physicsos-preview-motion') === 'paused'; } catch { /* Storage is optional. */ }
let paused = userPaused || reducedMotion.matches;
let heroVisible = true;
let pointerFrame = 0;
let scrollFrame = 0;
let targetX = 0, targetY = 0, currentX = 0, currentY = 0;
const glassCards = [...hero.querySelectorAll('.floating-tag, .floating-card')];
const depths = [8, -13, 16];
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function updateMotion() {
  paused = userPaused || reducedMotion.matches;
  root.dataset.motion = paused ? 'paused' : 'running';
  toggle.setAttribute('aria-pressed', String(!paused));
  toggle.setAttribute('aria-label', paused ? '开启页面动效' : '暂停页面动效');
  toggle.disabled = reducedMotion.matches;
  toggle.querySelector('.motion-toggle-label').textContent = reducedMotion.matches ? '已减少动态' : paused ? '静谧模式' : '动效开启';
  toggle.title = reducedMotion.matches ? '已遵循系统减少动态效果设置' : paused ? '开启星轨、视差与页面动效' : '暂停星轨、视差与页面动效';
  document.dispatchEvent(new CustomEvent('physicsos:motion', { detail: { paused } }));
  if (paused) {
    root.classList.add('intro-complete');
    cancelAnimationFrame(pointerFrame); pointerFrame = 0;
    targetX = targetY = currentX = currentY = 0; paintPointer();
    document.querySelectorAll('[data-reveal]').forEach(node => node.classList.add('in-view'));
    document.querySelectorAll('[data-magnetic]').forEach(node => { node.style.removeProperty('--magnet-x'); node.style.removeProperty('--magnet-y'); });
    document.querySelectorAll('.has-pointer').forEach(node => { node.classList.remove('has-pointer'); node.style.removeProperty('--card-rx'); node.style.removeProperty('--card-ry'); });
  }
}
toggle.addEventListener('click', () => {
  userPaused = !userPaused;
  try { localStorage.setItem('physicsos-preview-motion', userPaused ? 'paused' : 'running'); } catch { /* Session-only toggle still works. */ }
  updateMotion();
});
reducedMotion.addEventListener('change', updateMotion);
updateMotion();

// Native content first, then optional entrance/reveal choreography.
const revealGroups = [
  ['.facts', 0], ['.section-heading', 0], ['.experience-shell', 0],
  ['.feature-card', 100], ['.voices-meta', 0], ['.testimonial-window', 0],
  ['.community-topline', 0], ['.contributor-card', 100], ['.open-source-note', 0], ['.cta', 0],
];
const revealObserver = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) {
    entry.target.classList.add('in-view'); revealObserver.unobserve(entry.target);
    setTimeout(() => entry.target.style.removeProperty('--reveal-delay'), 1300);
  }
}, { threshold: .08, rootMargin: '0px 0px -24px 0px' });
function registerReveals(scope = document) {
  for (const [selector, interval] of revealGroups) {
    scope.querySelectorAll(selector).forEach((node, index) => {
      if (node.hasAttribute('data-reveal')) return;
      node.dataset.reveal = '';
      node.style.setProperty('--reveal-delay', `${Math.min(index % 3, 2) * interval}ms`);
      if (paused) node.classList.add('in-view'); else revealObserver.observe(node);
    });
  }
}
registerReveals();
new MutationObserver(() => registerReveals()).observe(document.querySelector('#contributors'), { childList: true });
document.addEventListener('focusin', event => event.target.closest('[data-reveal]')?.classList.add('in-view'));
root.classList.add('motion-ready');
setTimeout(() => root.classList.add('intro-complete'), 2200);

mountOrbitField(document.querySelector('.hero-orbit-field'), { reducedMotion });

// Damped pointer response. One RAF exists only while the scene is settling.
function paintPointer() {
  const style = hero.style;
  style.setProperty('--ip-x', `${(currentX * 11).toFixed(2)}px`);
  style.setProperty('--ip-y', `${(currentY * 7).toFixed(2)}px`);
  style.setProperty('--ip-rx', `${(-currentY * 4.5).toFixed(2)}deg`);
  style.setProperty('--ip-ry', `${(currentX * 5.5).toFixed(2)}deg`);
  style.setProperty('--ip-rz', `${(currentX * 1.3).toFixed(2)}deg`);
  style.setProperty('--glow-x', `${(-currentX * 15).toFixed(2)}px`);
  style.setProperty('--glow-y', `${(-currentY * 10).toFixed(2)}px`);
  glassCards.forEach((card, index) => {
    card.style.setProperty('--glass-x', `${(currentX * depths[index]).toFixed(2)}px`);
    card.style.setProperty('--glass-y', `${(currentY * depths[index] * .55).toFixed(2)}px`);
  });
}
function pointerTick() {
  pointerFrame = 0;
  if (paused || !heroVisible || document.hidden || !finePointer.matches) return;
  currentX += (targetX - currentX) * .065; currentY += (targetY - currentY) * .065;
  paintPointer();
  if (Math.abs(targetX - currentX) + Math.abs(targetY - currentY) > .002) pointerFrame = requestAnimationFrame(pointerTick);
}
function wakePointer() { if (!pointerFrame && !paused && heroVisible && !document.hidden) pointerFrame = requestAnimationFrame(pointerTick); }
hero.addEventListener('pointermove', event => {
  if (!finePointer.matches || paused || event.pointerType === 'touch') return;
  const box = hero.getBoundingClientRect();
  targetX = clamp((event.clientX - box.left) / box.width * 2 - 1, -1, 1);
  targetY = clamp((event.clientY - box.top) / box.height * 2 - 1, -1, 1);
  wakePointer();
}, { passive: true });
hero.addEventListener('pointerleave', () => { targetX = targetY = 0; wakePointer(); });
finePointer.addEventListener('change', () => { targetX = targetY = currentX = currentY = 0; paintPointer(); });

const visibleObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    entry.target.classList.toggle('is-offscreen', !entry.isIntersecting);
    if (entry.target === hero) {
      heroVisible = entry.isIntersecting;
      if (heroVisible) wakePointer(); else { cancelAnimationFrame(pointerFrame); pointerFrame = 0; }
    }
  }
});
visibleObserver.observe(hero); visibleObserver.observe(document.querySelector('.cta'));
document.addEventListener('visibilitychange', () => {
  root.dataset.pageHidden = String(document.hidden);
  if (document.hidden) { cancelAnimationFrame(pointerFrame); pointerFrame = 0; }
  else wakePointer();
});

// Precise hover feedback, leaving native scrolling, clicks and focus intact.
function magneticMove(event) {
  if (paused || !finePointer.matches || event.pointerType === 'touch') return;
  const button = event.target.closest('[data-magnetic]');
  if (button) {
    const rect = button.getBoundingClientRect();
    button.style.setProperty('--magnet-x', `${clamp((event.clientX - rect.left - rect.width / 2) * .045, -4, 4)}px`);
    button.style.setProperty('--magnet-y', `${clamp((event.clientY - rect.top - rect.height / 2) * .09, -3, 3)}px`);
  }
  const card = event.target.closest('.contributor-card, .testimonial-card');
  if (card) {
    const rect = card.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) / rect.width, 0, 1), y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    card.classList.add('has-pointer');
    card.style.setProperty('--light-x', `${x * 100}%`); card.style.setProperty('--light-y', `${y * 100}%`);
    card.style.setProperty('--card-rx', `${(y - .5) * -3}deg`); card.style.setProperty('--card-ry', `${(x - .5) * 3}deg`);
  }
}
document.querySelectorAll('.hero-actions .button, .cta .button, .nav-actions .button').forEach(button => button.dataset.magnetic = '');
document.addEventListener('pointermove', magneticMove, { passive: true });
document.addEventListener('pointerout', event => {
  const button = event.target.closest('[data-magnetic]');
  if (button && !button.contains(event.relatedTarget)) { button.style.removeProperty('--magnet-x'); button.style.removeProperty('--magnet-y'); }
  const card = event.target.closest('.contributor-card, .testimonial-card');
  if (card && !card.contains(event.relatedTarget)) { card.classList.remove('has-pointer'); card.style.removeProperty('--card-rx'); card.style.removeProperty('--card-ry'); }
}, { passive: true });

const navSections = ['explore', 'voices', 'community'].map(id => document.getElementById(id));
function readScroll() {
  scrollFrame = 0;
  const max = root.scrollHeight - innerHeight;
  root.style.setProperty('--page-progress', max > 0 ? String(clamp(scrollY / max, 0, 1)) : '0');
  header.classList.toggle('has-scrolled', scrollY > 30);
  let current = '';
  navSections.forEach(section => { if (section.getBoundingClientRect().top < innerHeight * .48) current = section.id; });
  document.querySelectorAll('#main-nav a').forEach(link => {
    const selected = link.getAttribute('href') === `#${current}`;
    link.classList.toggle('is-current', selected);
    if (selected) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current');
  });
}
window.addEventListener('scroll', () => { if (!scrollFrame) scrollFrame = requestAnimationFrame(readScroll); }, { passive: true });
window.addEventListener('resize', () => { if (!scrollFrame) scrollFrame = requestAnimationFrame(readScroll); }, { passive: true });
readScroll();

// One glass highlight glides between experiment tabs; the content follows it.
const tabs = document.querySelector('.experiment-tabs');
const indicator = document.createElement('span'); indicator.className = 'tab-indicator'; indicator.setAttribute('aria-hidden', 'true'); tabs.prepend(indicator);
function moveIndicator() {
  const selected = tabs.querySelector('[aria-selected="true"]');
  indicator.style.width = `${selected.offsetWidth}px`;
  indicator.style.transform = `translateX(${selected.offsetLeft - 4}px)`;
}
new ResizeObserver(moveIndicator).observe(tabs);
new MutationObserver(moveIndicator).observe(tabs, { subtree: true, attributes: true, attributeFilter: ['aria-selected'] });
tabs.addEventListener('click', event => {
  if (paused || !event.target.closest('[role="tab"]')) return;
  document.querySelectorAll('#experiment-title, #experiment-description').forEach((node, index) => node.animate([
    { opacity: .15, transform: 'translateY(7px)', filter: 'blur(2px)' },
    { opacity: 1, transform: 'translateY(0)', filter: 'blur(0)' },
  ], { duration: 520, delay: index * 45, easing: 'cubic-bezier(.16, 1, .3, 1)' }));
});
moveIndicator();
