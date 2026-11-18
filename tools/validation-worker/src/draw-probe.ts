/**
 * Bounded adaptation of tests/acceptance/chat-code-experiment.mjs's native
 * Canvas calls + CTM + pixel reads. No snapshots enter this instrumentation.
 *
 * A full filled arc supplies a native centre. A separately painted horizontal
 * line can supply a ground anchor; the verdict, not the renderer, calibrates
 * that anchor against engine ground facts. We never fit a camera to the body.
 * The optional optics extension observes solid segments, closed arrowhead
 * triangles and native text ink. SVG, Path2D and WebGL remain unverified.
 */
export const canvasDrawProbeScript = (key: string, staticOptics = false): string => String.raw`(() => {
  const optics = ${staticOptics ? 'true' : 'false'};
  const proto = globalThis.CanvasRenderingContext2D?.prototype;
  if (!proto) return;
  const getContext = HTMLCanvasElement.prototype.getContext;
  const getImageData = proto.getImageData, getTransform = proto.getTransform, getLineDash = proto.getLineDash;
  const states = new Map();
  let nextSurface = 0;
  const stateOf = context => {
    if (!states.has(context.canvas)) states.set(context.canvas, { surface: nextSurface++, path: undefined, draws: [], grounds: [], segments: [], triangles: [], texts: [], nextDraw: 0, nextStroke: 0 });
    return states.get(context.canvas);
  };
  const matrixOf = context => { const m = getTransform.call(context); return [m.a, m.b, m.c, m.d, m.e, m.f]; };
  const project = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
  const patch = (context, x, y, size = 3) => {
    const left = Math.floor(x) - Math.floor(size / 2), top = Math.floor(y) - Math.floor(size / 2);
    return { x: left, y: top, size, pixels: Array.from(getImageData.call(context, left, top, size, size).data) };
  };
  const delta = (a, b) => a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0);
  const changedPixels = (before, after) => {
    let count = 0;
    for (let i = 0; i < after.pixels.length; i += 4) {
      if (after.pixels[i + 3] > 0 && delta(after.pixels.slice(i, i + 4), before.pixels.slice(i, i + 4)) > 8) count++;
    }
    return count;
  };
  const unchanged = (context, witness) => {
    const current = getImageData.call(context, witness.x, witness.y, witness.size, witness.size).data;
    return witness.pixels.every((value, i) => value === current[i]);
  };
  const paintable = context => context.globalAlpha > 0 && context.globalCompositeOperation === 'source-over' && context.filter === 'none';
  if (optics) {
    for (const name of ['width','height']) {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,name);
      if (!descriptor?.set) continue;
      Object.defineProperty(HTMLCanvasElement.prototype,name,{ ...descriptor,set(value) {
        descriptor.set.call(this,value);
        const state = states.get(this);
        if (state) { state.path=undefined; state.draws=[]; state.grounds=[]; state.segments=[]; state.triangles=[]; state.texts=[]; state.nextDraw=0; state.nextStroke=0; }
      }});
    }
  }
  const nativeBegin = proto.beginPath;
  proto.beginPath = function (...args) { const result = nativeBegin.apply(this, args); stateOf(this).path = undefined; return result; };
  for (const name of ['rect', 'roundRect', 'ellipse', 'arcTo', 'bezierCurveTo', 'quadraticCurveTo', 'reset']) {
    const native = proto[name];
    if (!native) continue;
    proto[name] = function (...args) { const result = native.apply(this, args); stateOf(this).path = null; return result; };
  }
  const nativeMove = proto.moveTo, nativeLine = proto.lineTo;
  proto.moveTo = function (x, y) {
    const result = nativeMove.call(this, x, y), state = stateOf(this);
    state.path = state.path === undefined && [x, y].every(Number.isFinite)
      ? { kind: 'line', from: { x, y }, transform: matrixOf(this) } : null;
    return result;
  };
  proto.lineTo = function (x, y) {
    const result = nativeLine.call(this, x, y), state = stateOf(this), path = state.path;
    state.path = path?.kind === 'line' && [x, y].every(Number.isFinite) && path.transform.every((value, i) => value === matrixOf(this)[i])
      ? !path.to ? { ...path, to: { x, y } } : optics ? { kind: 'triangle', points: [path.from, path.to, { x, y }], transform: path.transform } : null : null;
    return result;
  };
  const nativeClose = proto.closePath;
  proto.closePath = function (...args) {
    const result = nativeClose.apply(this, args), state = stateOf(this);
    if (state.path?.kind === 'line') state.path = null;
    else if (optics && state.path?.kind === 'triangle') state.path.closed = true;
    return result;
  };
  const nativeArc = proto.arc;
  proto.arc = function (x, y, radius, start, end, anticlockwise) {
    const result = nativeArc.call(this, x, y, radius, start, end, anticlockwise), state = stateOf(this);
    const sweep = anticlockwise ? start - end : end - start;
    state.path = state.path === undefined && [x, y, radius, start, end].every(Number.isFinite) && radius > 0 && sweep >= Math.PI * 2
      ? { kind: 'arc', x, y, radius, transform: matrixOf(this) } : null;
    return result;
  };
  const triangleInside = (point, vertices) => {
    const sign = (p, a, b) => (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
    const signs = [sign(point, vertices[0], vertices[1]), sign(point, vertices[1], vertices[2]), sign(point, vertices[2], vertices[0])];
    return signs.every(value => value > 0) || signs.every(value => value < 0);
  };
  const nativeFill = proto.fill;
  proto.fill = function (...args) {
    const state = stateOf(this), path = state.path, drawIndex = state.nextDraw++;
    let centreBefore, sites, outside, centre, triangleSites, trianglePixels, triangleOutside;
    if (optics && path?.kind === 'triangle' && path.closed && state.triangles.length < 256
      && (args.length === 0 || typeof args[0] === 'string') && paintable(this)
      && path.transform.every((value, i) => Number.isFinite(value) && value === matrixOf(this)[i])) {
      trianglePixels = path.points.map(point => project(path.transform, point.x, point.y));
      const [a, b, c] = trianglePixels;
      const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
      const minX = Math.min(...trianglePixels.map(p => p.x)), maxX = Math.max(...trianglePixels.map(p => p.x));
      const minY = Math.min(...trianglePixels.map(p => p.y)), maxY = Math.max(...trianglePixels.map(p => p.y));
      if (area >= 36 && minX >= 3 && minY >= 3 && maxX < this.canvas.width - 3 && maxY < this.canvas.height - 3) {
        try {
          triangleSites = [[1/3,1/3,1/3], [0.5,0.25,0.25], [0.25,0.5,0.25], [0.25,0.25,0.5]].map(weights => {
            const x = trianglePixels.reduce((sum, p, i) => sum + p.x * weights[i], 0);
            const y = trianglePixels.reduce((sum, p, i) => sum + p.y * weights[i], 0);
            return patch(this, x, y, 1);
          }).filter((site,index,all) => triangleInside({ x: site.x + 0.5, y: site.y + 0.5 }, trianglePixels)
            && all.findIndex(other => other.x === site.x && other.y === site.y) === index);
          triangleOutside = [[minX - 2, (minY + maxY)/2], [maxX + 2, (minY + maxY)/2], [(minX + maxX)/2, minY - 2], [(minX + maxX)/2, maxY + 2]];
        } catch { triangleSites = undefined; }
      }
    }
    if (path?.kind === 'arc' && state.draws.length < 256 && (args.length === 0 || typeof args[0] === 'string') && paintable(this)) {
      const [a, b, c, d] = path.transform, determinant = a * d - b * c;
      centre = project(path.transform, path.x, path.y);
      const rx = path.radius * Math.hypot(a, c), ry = path.radius * Math.hypot(b, d);
      if (path.transform.every(Number.isFinite) && Math.abs(determinant) > 1e-12 && rx >= 3 && ry >= 3
        && centre.x - rx >= 3 && centre.y - ry >= 3 && centre.x + rx < this.canvas.width - 3 && centre.y + ry < this.canvas.height - 3) {
        try {
          centreBefore = patch(this, centre.x, centre.y, 5);
          sites = [];
          // Eight non-central interior patches. A small keypoint over the ball
          // centre need not erase evidence of the surrounding actual ball fill.
          for (let i = 0; i < 8; i++) {
            const angle = i * Math.PI / 4;
            const point = project(path.transform, path.x + path.radius * 0.6 * Math.cos(angle), path.y + path.radius * 0.6 * Math.sin(angle));
            const witness = patch(this, point.x, point.y);
            const inside = [[0.5, 0.5], [2.5, 0.5], [0.5, 2.5], [2.5, 2.5]].every(([dx, dy]) => {
              const px = witness.x + dx - centre.x, py = witness.y + dy - centre.y;
              return Math.hypot((d * px - c * py) / determinant, (-b * px + a * py) / determinant) < path.radius * 0.95;
            });
            if (inside && Math.hypot(point.x - centre.x, point.y - centre.y) >= 4) sites.push(witness);
          }
          outside = [[centre.x - rx - 2, centre.y], [centre.x + rx + 2, centre.y], [centre.x, centre.y - ry - 2], [centre.x, centre.y + ry + 2]];
        } catch { centreBefore = undefined; }
      }
    }
    const result = nativeFill.apply(this, args);
    if (triangleSites) {
      try {
        const patches = triangleSites.map(before => ({ before, after: patch(this, before.x, before.y, 1) }))
          .filter(item => changedPixels(item.before, item.after) === 1).map(item => item.after);
        const color = patches[0]?.pixels.slice(0, 4);
        const outline = color ? triangleOutside.map(([x,y]) => patch(this, x, y, 1)).filter(site => delta(site.pixels, color) > 8) : [];
        if (patches.length >= 2 && outline.length >= 2) state.triangles.push({
          source: 'canvas-2d-triangle-fill', surface: state.surface, drawIndex,
          points: path.points.map(point => ({ ...point })), transform: path.transform.slice(), pixelPoints: trianglePixels, patches, outline,
        });
      } catch { /* unreadable fill provides no arrowhead evidence */ }
    }
    if (centreBefore) {
      try {
        const centreAfter = patch(this, centre.x, centre.y, 5), paintedPixels = changedPixels(centreBefore, centreAfter);
        const patches = sites.map(before => ({ before, after: patch(this, before.x + 1, before.y + 1) }))
          .filter(item => changedPixels(item.before, item.after) >= 7).map(item => item.after);
        const centreColor = centreAfter.pixels.slice(48, 52);
        const outline = outside.map(([x, y]) => patch(this, x, y, 1)).filter(point => delta(point.pixels, centreColor) > 8);
        if ((paintedPixels >= 16 || patches.length >= 2) && outline.length >= 2) state.draws.push({
          source: 'canvas-2d-arc-fill', surface: state.surface, drawIndex, x: path.x, y: path.y,
          transform: path.transform.slice(), pixelX: centre.x, pixelY: centre.y,
          paintedPixels, centre: centreAfter, patches, outline,
        });
      } catch { /* tainted or reset canvas: no evidence */ }
    }
    return result;
  };
  const nativeStroke = proto.stroke;
  proto.stroke = function (...args) {
    const state = stateOf(this), path = state.path, strokeIndex = state.nextStroke++;
    let sites, outside, from, to, segmentSites, segmentOutside;
    if (optics && path?.kind === 'line' && path.to && state.segments.length < 256 && args.length === 0 && paintable(this)
      && getLineDash.call(this).length === 0 && path.transform.every((value, i) => Number.isFinite(value) && value === matrixOf(this)[i])) {
      const start = project(path.transform, path.from.x, path.from.y), end = project(path.transform, path.to.x, path.to.y);
      const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy);
      const [a,b,c,d] = path.transform, scale = Math.hypot(a,b);
      const equal = scale > 0 && Math.abs(Math.hypot(c,d) - scale) <= 1e-6 && Math.abs(a*c + b*d) <= 1e-6 * Math.max(1, scale*scale);
      const padding = this.lineWidth * scale / 2 + 3;
      if (equal && length >= 4 && this.lineWidth * scale >= 1.5 && [start.x,start.y,end.x,end.y,padding].every(Number.isFinite)
        && Math.min(start.x,end.x) >= padding && Math.min(start.y,end.y) >= padding
        && Math.max(start.x,end.x) < this.canvas.width - padding && Math.max(start.y,end.y) < this.canvas.height - padding) {
        try {
          const nx = -dy/length, ny = dx/length;
          segmentSites = [0.15,0.35,0.65,0.85].map(t => patch(this, start.x + dx*t, start.y + dy*t));
          segmentOutside = segmentSites.flatMap(site => [[site.x + 1 + nx*padding, site.y + 1 + ny*padding], [site.x + 1 - nx*padding, site.y + 1 - ny*padding]]);
        } catch { segmentSites = undefined; }
      }
    }
    if (path?.kind === 'line' && path.to && state.grounds.length < 256 && args.length === 0 && paintable(this)
      && getLineDash.call(this).length === 0 && path.transform.every((value, i) => value === matrixOf(this)[i])) {
      from = project(path.transform, path.from.x, path.from.y); to = project(path.transform, path.to.x, path.to.y);
      const padding = this.lineWidth * Math.hypot(path.transform[1], path.transform[3]) / 2 + 3;
      if ([from.x, from.y, to.x, to.y, padding].every(Number.isFinite) && Math.abs(from.y - to.y) <= 1e-6 && Math.abs(to.x - from.x) >= 16
        && Math.min(from.x, to.x) >= 3 && Math.max(from.x, to.x) < this.canvas.width - 3
        && from.y - padding >= 1 && from.y + padding < this.canvas.height - 1) {
        try {
          sites = [0.15, 0.35, 0.65, 0.85].map(t => patch(this, from.x + (to.x - from.x) * t, from.y));
          outside = sites.flatMap(site => [[site.x + 1, from.y - padding], [site.x + 1, from.y + padding]]);
        } catch { sites = undefined; }
      }
    }
    const result = nativeStroke.apply(this, args);
    if (segmentSites) {
      try {
        const patches = segmentSites.map(before => ({ before, after: patch(this, before.x + 1, before.y + 1) }))
          .filter(item => changedPixels(item.before, item.after) >= 3).map(item => item.after);
        const color = patches[0]?.pixels.slice(16,20);
        const outline = color ? segmentOutside.map(([x,y]) => patch(this,x,y,1)).filter(point => delta(point.pixels,color) > 8) : [];
        if (patches.length >= 2 && outline.length >= 2) state.segments.push({
          source: 'canvas-2d-segment-stroke', surface: state.surface, strokeIndex,
          from: path.from, to: path.to, transform: path.transform.slice(),
          pixelFrom: project(path.transform,path.from.x,path.from.y), pixelTo: project(path.transform,path.to.x,path.to.y), patches, outline,
        });
      } catch { /* unreadable stroke provides no optics geometry */ }
    }
    if (sites) {
      try {
        const patches = sites.map(before => ({ before, after: patch(this, before.x + 1, before.y + 1) }))
          .filter(item => changedPixels(item.before, item.after) >= 3).map(item => item.after);
        const color = patches[0]?.pixels.slice(16, 20);
        const outline = color ? outside.map(([x, y]) => patch(this, x, y, 1)).filter(point => delta(point.pixels, color) > 8) : [];
        if (patches.length >= 2 && outline.length >= 2) state.grounds.push({
          source: 'canvas-2d-line-stroke', surface: state.surface, strokeIndex,
          from: path.from, to: path.to, transform: path.transform.slice(), pixelFrom: from, pixelTo: to, patches, outline,
        });
      } catch { /* unreadable stroke supplies no ground anchor */ }
    }
    return result;
  };
  if (optics) {
    const nativeText = proto.fillText, nativeMeasure = proto.measureText;
    proto.fillText = function (text,x,y,...rest) {
      const state = stateOf(this), m = matrixOf(this);
      let before, witnesses, outside;
      if (typeof text === 'string' && text.length > 0 && text.length <= 200 && rest.length === 0 && state.texts.length < 128 && paintable(this)
        && [x,y,...m].every(Number.isFinite) && m[0] > 0 && m[3] > 0 && m[1] === 0 && m[2] === 0) {
        const metric = nativeMeasure.call(this,text);
        const corners = [[x-metric.actualBoundingBoxLeft,y-metric.actualBoundingBoxAscent],[x+metric.actualBoundingBoxRight,y+metric.actualBoundingBoxDescent]]
          .map(([a,b]) => project(m,a,b));
        const left = Math.floor(corners[0].x)-1, top = Math.floor(corners[0].y)-1;
        const width = Math.ceil(corners[1].x)-left+2, height = Math.ceil(corners[1].y)-top+2;
        if (width >= 3 && height >= 6 && width <= 700 && height <= 100 && left >= 3 && top >= 3 && left+width < this.canvas.width-3 && top+height < this.canvas.height-3) {
          try {
            before = { x:left,y:top,width,height,pixels:Array.from(getImageData.call(this,left,top,width,height).data) };
            outside = [[left-2,top+height/2],[left+width+2,top+height/2],[left+width/2,top-2],[left+width/2,top+height+2]]
              .map(([x,y]) => patch(this,x,y,1));
          } catch { before = undefined; }
        }
      }
      const result = nativeText.call(this,text,x,y,...rest);
      if (before) {
        try {
          const after = Array.from(getImageData.call(this,before.x,before.y,before.width,before.height).data);
          const changed = [];
          for (let i=0;i<after.length;i+=4) if (after[i+3]>0 && delta(after.slice(i,i+4),before.pixels.slice(i,i+4))>8) changed.push(i/4);
          if (changed.length >= 6) {
            witnesses = [0,0.2,0.4,0.6,0.8,1].map(t => changed[Math.floor((changed.length-1)*t)])
              .map(index => patch(this,before.x + index%before.width,before.y + Math.floor(index/before.width),1));
            const color = witnesses[0].pixels;
            const outline = outside.filter(site => delta(site.pixels,color)>8);
            if (outline.length >= 2) state.texts.push({ source:'canvas-2d-text-fill',surface:state.surface,text,paintedPixels:changed.length,inkHeight:before.height,witnesses,outline });
          }
        } catch { /* unreadable text ink is not semantic evidence */ }
      }
      return result;
    };
  }
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
    reset() { for (const state of states.values()) { state.path = undefined; state.draws = []; state.grounds = []; state.segments = []; state.triangles = []; state.texts = []; state.nextDraw = 0; state.nextStroke = 0; } },
    read() {
      const root = document.getElementById('canvas') ?? document.body;
      const canvases = root instanceof HTMLCanvasElement ? [root] : Array.from(root.querySelectorAll('canvas'));
      const drawnBodies = [], drawnGrounds = [], drawnSegments = [], drawnTriangles = [], drawnTexts = [], drawnSurfaces = [];
      const svgs = root instanceof SVGSVGElement ? [root] : Array.from(root.querySelectorAll('svg'));
      let paintHash = '', opaquePixels = 0, distinctColors = 0, taintedSurfaces = 0, nativeSurface = svgs.some(visible);
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
          if (optics) {
            let distorted = false;
            for (let node=canvas;node;node=node.parentElement) if (getComputedStyle(node).transform !== 'none') distorted=true;
            const state = states.get(canvas);
            if (!distorted && state) drawnSurfaces.push({ source:'canvas-2d-surface',surface:state.surface,width:canvas.width,height:canvas.height,displayWidth:rect.width,displayHeight:rect.height });
          }
          const survives = witness => unchanged(context, witness) && document.elementFromPoint(
            rect.left + (witness.x + witness.size / 2) / canvas.width * rect.width,
            rect.top + (witness.y + witness.size / 2) / canvas.height * rect.height) === canvas;
          for (const draw of states.get(canvas)?.draws ?? []) {
            const paintedPixels = survives(draw.centre) ? draw.paintedPixels : 0;
            const paintedPatches = draw.patches.filter(survives).length;
            if ((paintedPixels < 16 && paintedPatches < 2) || draw.outline.filter(point => unchanged(context, point)).length < 2) continue;
            const { centre, patches, outline, ...evidence } = draw;
            drawnBodies.push({ ...evidence, paintedPixels, paintedPatches, transform: evidence.transform.slice() });
          }
          for (const ground of states.get(canvas)?.grounds ?? []) {
            const paintedPatches = ground.patches.filter(survives).length;
            if (paintedPatches < 2 || ground.outline.filter(point => unchanged(context, point)).length < 2) continue;
            const { patches, outline, ...evidence } = ground;
            drawnGrounds.push({ ...evidence, paintedPatches, transform: evidence.transform.slice(),
              from: { ...evidence.from }, to: { ...evidence.to }, pixelFrom: { ...evidence.pixelFrom }, pixelTo: { ...evidence.pixelTo } });
          }
          for (const segment of states.get(canvas)?.segments ?? []) {
            const paintedPatches = segment.patches.filter(survives).length;
            if (paintedPatches < 2 || segment.outline.filter(point => unchanged(context,point)).length < 2) continue;
            const { patches,outline,...evidence } = segment;
            drawnSegments.push({ ...evidence,paintedPatches,transform:evidence.transform.slice(),
              from:{...evidence.from},to:{...evidence.to},pixelFrom:{...evidence.pixelFrom},pixelTo:{...evidence.pixelTo} });
          }
          for (const triangle of states.get(canvas)?.triangles ?? []) {
            const paintedPatches = triangle.patches.filter(survives).length;
            if (paintedPatches < 2 || triangle.outline.filter(point => unchanged(context,point)).length < 2) continue;
            const { patches,outline,...evidence } = triangle;
            drawnTriangles.push({ ...evidence,paintedPatches,transform:evidence.transform.slice(),
              points:evidence.points.map(p=>({...p})),pixelPoints:evidence.pixelPoints.map(p=>({...p})) });
          }
          for (const text of states.get(canvas)?.texts ?? []) {
            if (!text.witnesses.every(survives) || text.outline.filter(point => unchanged(context,point)).length < 2) continue;
            drawnTexts.push({ source:text.source,surface:text.surface,text:text.text,paintedPixels:text.paintedPixels,inkHeight:text.inkHeight });
          }
        } catch (error) {
          // Do not disguise the real opaque-frame image taint as a blank scene.
          // There is no screenshot-based acceptance fallback until it can prove
          // actual shape/material and preserve the existing negative cases.
          if (error?.name === 'SecurityError') taintedSurfaces++;
        }
      }
      return { paintHash, opaquePixels, distinctColors, taintedSurfaces, geometryCount: drawnBodies.length + drawnGrounds.length + drawnSegments.length + drawnTriangles.length,
        drawnBodies, drawnGrounds, drawnSegments, drawnTriangles, drawnTexts, drawnSurfaces, nativeSurface };
    },
  }) });
})();`
