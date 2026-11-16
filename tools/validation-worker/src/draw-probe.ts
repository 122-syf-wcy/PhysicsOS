/**
 * Small, deliberately bounded adaptation of the native Canvas instrumentation
 * in tests/acceptance/chat-code-experiment.mjs (draw calls + CTM + pixel reads).
 *
 * Only a filled, full world-coordinate arc is an attributable body here. We do
 * not infer a projection from moving pixels, accept renderer attributes, or
 * paint anything ourselves. Pixel-space renderers, SVG, Path2D, WebGL and
 * changing projections remain unverified, not implicitly accepted.
 *
 * The readout closes over native methods and private records installed before
 * authored scripts. Its only mutator clears observations; neither it nor the
 * instrumented context ever receives an engine snapshot.
 */
export const canvasDrawProbeScript = (key: string): string => String.raw`(() => {
  const proto = globalThis.CanvasRenderingContext2D?.prototype;
  if (!proto) return;
  const getContext = HTMLCanvasElement.prototype.getContext;
  const getImageData = proto.getImageData;
  const getTransform = proto.getTransform;
  const states = new Map();
  let nextSurface = 0;
  const stateOf = context => {
    if (!states.has(context.canvas)) states.set(context.canvas, { surface: nextSurface++, path: undefined, draws: [], nextDraw: 0 });
    return states.get(context.canvas);
  };
  const matrixOf = context => {
    const m = getTransform.call(context);
    return [m.a, m.b, m.c, m.d, m.e, m.f];
  };
  const patch = (context, x, y) => getImageData.call(context, Math.floor(x) - 2, Math.floor(y) - 2, 5, 5).data;
  const nativeBegin = proto.beginPath;
  proto.beginPath = function (...args) {
    const result = nativeBegin.apply(this, args);
    stateOf(this).path = undefined;
    return result;
  };
  // These paths are not circles with an unambiguous centre. Never guess one.
  for (const name of ['moveTo', 'lineTo', 'rect', 'roundRect', 'ellipse', 'arcTo', 'bezierCurveTo', 'quadraticCurveTo', 'reset']) {
    const native = proto[name];
    if (!native) continue;
    proto[name] = function (...args) {
      const result = native.apply(this, args);
      stateOf(this).path = null;
      return result;
    };
  }
  const nativeArc = proto.arc;
  proto.arc = function (x, y, radius, start, end, anticlockwise) {
    const result = nativeArc.call(this, x, y, radius, start, end, anticlockwise);
    const state = stateOf(this);
    const sweep = anticlockwise ? start - end : end - start;
    state.path = state.path === undefined && [x, y, radius, start, end].every(Number.isFinite)
      && radius > 0 && sweep >= Math.PI * 2
      ? { x, y, radius, transform: matrixOf(this) } : null;
    return result;
  };
  const nativeFill = proto.fill;
  proto.fill = function (...args) {
    const state = stateOf(this), path = state.path;
    const drawIndex = state.nextDraw++;
    let before, pixelX, pixelY, outlinePoints;
    if (path && state.draws.length < 256 && (args.length === 0 || typeof args[0] === 'string')
      && this.globalAlpha > 0 && this.globalCompositeOperation === 'source-over' && this.filter === 'none') {
      const [a, b, c, d, e, f] = path.transform;
      pixelX = a * path.x + c * path.y + e;
      pixelY = b * path.x + d * path.y + f;
      const radiusX = path.radius * Math.hypot(a, c), radiusY = path.radius * Math.hypot(b, d);
      // A full-canvas background or an offscreen arc is not a visible body.
      if (path.transform.every(Number.isFinite) && Math.abs(a * d - b * c) > 1e-12
        && radiusX >= 3 && radiusY >= 3
        && pixelX - radiusX >= 3 && pixelY - radiusY >= 3
        && pixelX + radiusX < this.canvas.width - 3 && pixelY + radiusY < this.canvas.height - 3) {
        try {
          before = patch(this, pixelX, pixelY);
          outlinePoints = [[pixelX - radiusX - 2, pixelY], [pixelX + radiusX + 2, pixelY], [pixelX, pixelY - radiusY - 2], [pixelX, pixelY + radiusY + 2]];
        } catch { /* unreadable: no evidence */ }
      }
    }
    const result = nativeFill.apply(this, args);
    if (before) {
      try {
        const after = patch(this, pixelX, pixelY);
        let paintedPixels = 0;
        for (let i = 0; i < after.length; i += 4) {
          let delta = 0;
          for (let channel = 0; channel < 4; channel++) delta += Math.abs(after[i + channel] - before[i + channel]);
          if (after[i + 3] > 0 && delta > 8) paintedPixels++;
        }
        const outline = outlinePoints.map(([x, y]) => ({ x: Math.floor(x), y: Math.floor(y), pixels: Array.from(getImageData.call(this, Math.floor(x), Math.floor(y), 1, 1).data) }));
        // A visible silhouette must contrast with its surroundings. Keeping the
        // outside witnesses also catches a later same-colour full-canvas cover.
        const outlined = outline.every(point => point.pixels.reduce((delta, value, channel) => delta + Math.abs(value - after[48 + channel]), 0) > 8);
        if (paintedPixels >= 16 && outlined) state.draws.push({
          source: 'canvas-2d-arc-fill', surface: state.surface, drawIndex,
          x: path.x, y: path.y, transform: path.transform.slice(), pixelX, pixelY, paintedPixels,
          pixels: Array.from(after), outline,
        });
      } catch { /* tainted or reset canvas: no evidence */ }
    }
    return result;
  };
  const visible = canvas => {
    const rect = canvas.getBoundingClientRect();
    if (!canvas.isConnected || rect.width <= 0 || rect.height <= 0) return false;
    for (let node = canvas; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) < 0.1
        || style.filter !== 'none' || style.mixBlendMode !== 'normal' || style.maskImage !== 'none') return false;
    }
    return rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
  };
  Object.defineProperty(window, ${JSON.stringify(key)}, { value: Object.freeze({
    reset() { for (const state of states.values()) { state.draws = []; state.nextDraw = 0; } },
    read() {
      const root = document.getElementById('canvas') ?? document.body;
      const canvases = root instanceof HTMLCanvasElement ? [root] : Array.from(root.querySelectorAll('canvas'));
      const drawnBodies = [];
      const svgs = root instanceof SVGSVGElement ? [root] : Array.from(root.querySelectorAll('svg'));
      let paintHash = '', opaquePixels = 0, distinctColors = 0, nativeSurface = svgs.some(visible);
      for (const canvas of canvases) {
        if (!visible(canvas) || canvas.width <= 0 || canvas.height <= 0) continue;
        nativeSurface = true;
        try {
          const context = getContext.call(canvas, '2d');
          if (!context) continue;
          const image = getImageData.call(context, 0, 0, canvas.width, canvas.height);
          let hash = 2166136261;
          const colors = new Set();
          for (let y = 0; y < image.height; y += Math.max(1, Math.floor(image.height / 64))) {
            for (let x = 0; x < image.width; x += Math.max(1, Math.floor(image.width / 96))) {
              const offset = (y * image.width + x) * 4;
              for (let channel = 0; channel < 4; channel++) { hash ^= image.data[offset + channel]; hash = Math.imul(hash, 16777619) >>> 0; }
              if (image.data[offset + 3] > 0) opaquePixels++;
              colors.add(Array.from(image.data.subarray(offset, offset + 4)).join(','));
            }
          }
          paintHash += canvas.width + 'x' + canvas.height + ':' + hash.toString(16) + ';';
          distinctColors += colors.size;
          const rect = canvas.getBoundingClientRect();
          for (const draw of states.get(canvas)?.draws ?? []) {
            const now = patch(context, draw.pixelX, draw.pixelY);
            const screenX = rect.left + draw.pixelX / canvas.width * rect.width;
            const screenY = rect.top + draw.pixelY / canvas.height * rect.height;
            // Discard overpainted, cleared, detached, hidden or covered marks.
            if (!draw.pixels.every((value, i) => value === now[i]) || document.elementFromPoint(screenX, screenY) !== canvas) continue;
            if (!draw.outline.every(point => {
              const current = getImageData.call(context, point.x, point.y, 1, 1).data;
              return point.pixels.every((value, i) => value === current[i]);
            })) continue;
            const { pixels, outline, ...evidence } = draw;
            drawnBodies.push({ ...evidence, transform: evidence.transform.slice() });
          }
        } catch { /* a surface without readable native pixels proves nothing */ }
      }
      return { paintHash, opaquePixels, distinctColors, geometryCount: drawnBodies.length, drawnBodies, nativeSurface };
    },
  }) });
})();`
