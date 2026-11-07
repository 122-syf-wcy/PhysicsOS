const TAU = Math.PI * 2;
const FRAME_INTERVAL = 1000 / 30;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const rgba = (color, alpha) => `rgba(${color.join(',')},${alpha})`;

const ORBITS = [
  { radiusX: 0.46, radiusY: 0.275, tilt: -0.43, phase: 0, color: [102, 164, 141] },
  { radiusX: 0.40, radiusY: 0.315, tilt: 0.66, phase: 2.4, color: [139, 163, 105] },
];

const PEARLS = [
  { orbit: 0, phase: 0.24, speed: 0.080, radius: 9.2, color: [143, 208, 177] },
  { orbit: 0, phase: 2.98, speed: 0.080, radius: 6.1, color: [175, 211, 224] },
  { orbit: 0, phase: 4.68, speed: 0.080, radius: 4.8, color: [185, 209, 152] },
  { orbit: 1, phase: 1.42, speed: -0.057, radius: 7.3, color: [200, 218, 151] },
  { orbit: 1, phase: 4.24, speed: -0.057, radius: 5.7, color: [142, 202, 203] },
];

const GLINTS = [
  { x: 0.23, y: 0.18, size: 3.5, phase: 0.2 },
  { x: 0.79, y: 0.22, size: 2.7, phase: 2.1 },
  { x: 0.88, y: 0.62, size: 3.9, phase: 4.2 },
  { x: 0.26, y: 0.79, size: 2.5, phase: 1.4 },
  { x: 0.10, y: 0.46, size: 2.2, phase: 3.3 },
];

/** A decorative, dependency-free orbital field. The caller owns canvas layout. */
export function mountOrbitField(canvas, { reducedMotion } = {}) {
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) return () => {};

  const host = canvas.parentElement;
  const motionPreference = reducedMotion || window.matchMedia('(prefers-reduced-motion: reduce)');
  let width = 0;
  let height = 0;
  let pixelRatio = 1;
  let clock = 0;
  let frame = 0;
  let previousTime = null;
  let destroyed = false;
  let visible = false;
  let paused = document.documentElement.dataset.motion === 'paused';
  const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };

  function mayAnimate() {
    return !destroyed && visible && width > 0 && height > 0 &&
      !document.hidden && !paused && !motionPreference.matches;
  }

  function orbitPoint(orbit, angle) {
    const unit = Math.min(width, height);
    const breath = 1 + Math.sin(clock * 0.21 + orbit.phase) * 0.013;
    const depth = Math.sin(angle);
    const perspective = 1 + depth * 0.065;
    const tilt = orbit.tilt + Math.sin(clock * 0.13 + orbit.phase) * 0.028 + pointer.x * 0.025;
    const x = Math.cos(angle) * orbit.radiusX * unit * breath * perspective;
    const y = Math.sin(angle) * orbit.radiusY * unit * breath * perspective;
    return {
      x: width * 0.5 + x * Math.cos(tilt) - y * Math.sin(tilt) + pointer.x * 7,
      y: height * 0.48 + x * Math.sin(tilt) + y * Math.cos(tilt) + pointer.y * 5,
      depth,
    };
  }

  function drawOrbit(orbit) {
    const stroke = context.createLinearGradient(width * 0.1, height * 0.2, width * 0.9, height * 0.8);
    stroke.addColorStop(0, rgba(orbit.color, 0.045));
    stroke.addColorStop(0.3, rgba(orbit.color, 0.24));
    stroke.addColorStop(0.62, rgba(orbit.color, 0.07));
    stroke.addColorStop(1, rgba(orbit.color, 0.2));
    context.beginPath();
    for (let i = 0; i <= 120; i += 1) {
      const point = orbitPoint(orbit, i / 120 * TAU);
      if (i === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
    context.closePath();
    context.strokeStyle = stroke;
    context.lineWidth = 0.85;
    context.stroke();
  }

  function drawTrail(pearl, angle) {
    const orbit = ORBITS[pearl.orbit];
    const direction = Math.sign(pearl.speed);
    const length = 0.34;
    for (let i = 0; i < 18; i += 1) {
      const progress = i / 18;
      const start = orbitPoint(orbit, angle - direction * length * (1 - progress));
      const end = orbitPoint(orbit, angle - direction * length * (1 - (i + 1) / 18));
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.lineWidth = 0.8 + progress * 0.65;
      context.strokeStyle = rgba(pearl.color, progress * progress * 0.32);
      context.stroke();
    }
  }

  function drawPearl(pearl, point) {
    const size = clamp(Math.min(width, height) / 580, 0.65, 1.15);
    const radius = pearl.radius * size * (0.87 + point.depth * 0.15);
    const alpha = 0.72 + (point.depth + 1) * 0.12;
    context.save();
    context.translate(point.x, point.y);
    context.globalAlpha = alpha;

    const glow = context.createRadialGradient(0, 0, radius * 0.5, 0, 0, radius * 3.5);
    glow.addColorStop(0, rgba(pearl.color, 0.24));
    glow.addColorStop(0.45, rgba(pearl.color, 0.09));
    glow.addColorStop(1, rgba(pearl.color, 0));
    context.fillStyle = glow;
    context.beginPath();
    context.arc(0, 0, radius * 3.5, 0, TAU);
    context.fill();

    const body = context.createRadialGradient(-radius * 0.37, -radius * 0.4, radius * 0.06, radius * 0.08, radius * 0.12, radius * 1.12);
    body.addColorStop(0, 'rgba(255,255,252,0.98)');
    body.addColorStop(0.28, 'rgba(245,255,248,0.91)');
    body.addColorStop(0.62, rgba(pearl.color, 0.76));
    body.addColorStop(0.84, rgba(pearl.color.map(channel => Math.round(channel * 0.86)), 0.85));
    body.addColorStop(1, 'rgba(255,255,255,0.8)');
    context.fillStyle = body;
    context.beginPath();
    context.arc(0, 0, radius, 0, TAU);
    context.fill();

    const rim = context.createLinearGradient(-radius, -radius, radius, radius);
    rim.addColorStop(0, 'rgba(255,255,255,0.96)');
    rim.addColorStop(0.5, rgba(pearl.color, 0.15));
    rim.addColorStop(1, rgba(pearl.color, 0.65));
    context.strokeStyle = rim;
    context.lineWidth = 0.65;
    context.stroke();

    context.beginPath();
    context.ellipse(-radius * 0.3, -radius * 0.4, radius * 0.30, radius * 0.14, -0.55, 0, TAU);
    context.fillStyle = 'rgba(255,255,255,0.9)';
    context.fill();
    context.beginPath();
    context.arc(0, 0, radius * 0.77, 0.45, 1.65);
    context.strokeStyle = 'rgba(247,255,251,0.72)';
    context.lineWidth = 0.75;
    context.stroke();
    context.restore();
  }

  function drawGlints() {
    const unit = Math.min(width, height);
    for (const glint of GLINTS) {
      const intensity = 0.12 + (Math.sin(clock * 0.62 + glint.phase) + 1) * 0.055;
      const x = width * glint.x + Math.sin(clock * 0.11 + glint.phase) * 3 + pointer.x * 3;
      const y = height * glint.y + Math.cos(clock * 0.13 + glint.phase) * 3 + pointer.y * 2;
      const size = glint.size * clamp(unit / 560, 0.7, 1.15);
      context.beginPath();
      context.moveTo(x - size, y);
      context.quadraticCurveTo(x, y, x, y - size);
      context.quadraticCurveTo(x, y, x + size, y);
      context.quadraticCurveTo(x, y, x, y + size);
      context.quadraticCurveTo(x, y, x - size, y);
      context.fillStyle = `rgba(113,159,137,${intensity})`;
      context.fill();
    }
  }

  function draw() {
    if (destroyed || width <= 0 || height <= 0) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    drawGlints();
    ORBITS.forEach(drawOrbit);
    const particles = PEARLS.map(pearl => {
      const angle = pearl.phase + clock * pearl.speed;
      return { pearl, angle, point: orbitPoint(ORBITS[pearl.orbit], angle) };
    }).sort((a, b) => a.point.depth - b.point.depth);
    for (const { pearl, angle, point } of particles) {
      drawTrail(pearl, angle);
      drawPearl(pearl, point);
    }
  }

  function stop() {
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    previousTime = null;
  }

  function tick(now) {
    frame = 0;
    if (!mayAnimate()) return;
    if (previousTime === null) previousTime = now - FRAME_INTERVAL;
    const elapsed = now - previousTime;
    if (elapsed >= FRAME_INTERVAL) {
      const dt = Math.min(elapsed - elapsed % FRAME_INTERVAL, 80) / 1000;
      clock += dt;
      const damping = 1 - Math.exp(-dt * 4.5);
      pointer.x += (pointer.targetX - pointer.x) * damping;
      pointer.y += (pointer.targetY - pointer.y) * damping;
      draw();
      previousTime = now - elapsed % FRAME_INTERVAL;
    }
    frame = window.requestAnimationFrame(tick);
  }

  function sync() {
    if (!mayAnimate()) stop();
    else if (!frame) frame = window.requestAnimationFrame(tick);
  }

  function measure() {
    if (destroyed) return;
    const nextWidth = canvas.clientWidth;
    const nextHeight = canvas.clientHeight;
    const nextRatio = Math.min(window.devicePixelRatio || 1, window.innerWidth <= 760 ? 1.5 : 2);
    if (width !== nextWidth || height !== nextHeight || pixelRatio !== nextRatio) {
      width = nextWidth;
      height = nextHeight;
      pixelRatio = nextRatio;
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      draw();
    }
    sync();
  }

  function checkViewport() {
    const bounds = canvas.getBoundingClientRect();
    visible = bounds.bottom > 0 && bounds.right > 0 && bounds.top < window.innerHeight && bounds.left < window.innerWidth;
    sync();
  }

  function onPointerMove(event) {
    if (!mayAnimate() || event.pointerType === 'touch' || !host) return;
    const bounds = host.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    pointer.targetX = clamp((event.clientX - bounds.left) / bounds.width * 2 - 1, -1, 1);
    pointer.targetY = clamp((event.clientY - bounds.top) / bounds.height * 2 - 1, -1, 1);
  }

  function onPointerLeave() {
    pointer.targetX = 0;
    pointer.targetY = 0;
  }

  function onMotion(event) {
    if (typeof event.detail?.paused !== 'boolean') return;
    paused = event.detail.paused;
    sync();
  }

  const resizeObserver = new ResizeObserver(measure);
  resizeObserver.observe(canvas);
  const intersectionObserver = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio > 0);
      sync();
    }, { threshold: 0 })
    : null;
  intersectionObserver?.observe(canvas);
  if (!intersectionObserver) window.addEventListener('scroll', checkViewport, { passive: true });
  window.addEventListener('resize', measure, { passive: true });
  window.addEventListener('resize', checkViewport, { passive: true });
  document.addEventListener('visibilitychange', sync);
  document.addEventListener('physicsos:motion', onMotion);
  motionPreference.addEventListener('change', sync);
  host?.addEventListener('pointermove', onPointerMove, { passive: true, capture: true });
  host?.addEventListener('pointerleave', onPointerLeave, { passive: true });
  measure();
  checkViewport();

  return () => {
    destroyed = true;
    stop();
    resizeObserver.disconnect();
    intersectionObserver?.disconnect();
    window.removeEventListener('scroll', checkViewport);
    window.removeEventListener('resize', measure);
    window.removeEventListener('resize', checkViewport);
    document.removeEventListener('visibilitychange', sync);
    document.removeEventListener('physicsos:motion', onMotion);
    motionPreference.removeEventListener('change', sync);
    host?.removeEventListener('pointermove', onPointerMove, true);
    host?.removeEventListener('pointerleave', onPointerLeave);
  };
}
