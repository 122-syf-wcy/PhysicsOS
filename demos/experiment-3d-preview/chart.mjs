import { format } from './simulation.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const INSTRUCTIONS = '左右方向键检查相邻数据，回车键或空格键跳转。按 Escape 关闭提示，也可用图表外的数据表查看完整数值。';
const axisNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });
let chartId = 0;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const near = (a, b) => Math.abs(a - b) <= Math.max(1, Math.abs(a), Math.abs(b)) * 1e-10;
const label = (value, fallback = '') => value == null ? fallback : String(value);

function domain(input, values, fallback) {
  let min = Infinity;
  let max = -Infinity;
  const source = Array.isArray(input) && input.length === 2 && input.every(Number.isFinite) ? input : values;
  for (const value of source) {
    if (!Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [...fallback];
  if (min === max) {
    const padding = Math.abs(min) * 0.1 || 1;
    return [min - padding, max + padding];
  }
  return [min, max];
}

function prepare(input) {
  if (!input || !Array.isArray(input.series)) return null;
  const series = input.series.filter(Boolean).map(item => ({
    key: label(item.key),
    label: label(item.label, label(item.key, '数据')),
    color: /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(item.color) ? item.color : '#2a78d6',
    dash: item.dash ? '5 4' : '',
    values: (Array.isArray(item.values) ? item.values : [])
      .filter(point => point && Number.isFinite(point.x))
      .map(point => ({ x: point.x, y: Number.isFinite(point.y) ? point.y : null }))
      .sort((a, b) => a.x - b.x),
  }));
  const allX = series.flatMap(item => item.values.map(point => point.x));
  const domainX = domain(input.domainX, allX, [0, 1]);
  const domainY = domain(input.domainY, series.flatMap(item => item.values.map(point => point.y)), [-1, 1]);
  const samples = [...new Set(allX.filter(x => x >= domainX[0] && x <= domainX[1]))].sort((a, b) => a - b);
  const xLabel = label(input.xLabel, '时间');
  const xParts = xLabel.match(/^(.*?)\s+\/\s+(.+)$/u);
  return {
    title: label(input.title, '实验数据曲线'),
    unit: label(input.unit),
    xLabel,
    xName: xParts ? xParts[1] : xLabel,
    xUnit: xParts ? xParts[2] : '',
    yLabel: label(input.yLabel),
    note: label(input.note),
    focusX: Number.isFinite(input.focusX) ? input.focusX : null,
    domainX, domainY, series, samples,
  };
}

function ticks([min, max], limit) {
  const raw = (max - min) / (limit - 1);
  const power = 10 ** Math.floor(Math.log10(raw));
  const steps = [1, 1.5, 2, 2.5, 3, 5, 10, 15, 20].map(value => value * power);
  let index = 0;
  while (index + 1 < steps.length && steps[index + 1] <= raw * (1 + 1e-10)) index += 1;
  for (; index < steps.length; index += 1) {
    const step = steps[index];
    const first = Math.ceil(min / step - 1e-9);
    const last = Math.floor(max / step + 1e-9);
    const count = last - first + 1;
    if (count > limit || count < 1) continue;
    return Array.from({ length: count }, (_, i) => Number(((first + i) * step).toPrecision(12)));
  }
  return [];
}

function tickText(value) {
  if (value !== 0 && Math.abs(value) < 0.0001) {
    return value.toExponential(1).replace('.0e', 'e').replace(/-/g, '−');
  }
  return axisNumber.format(value).replace('-', '−');
}

function valueText(value, unit = '') {
  if (value === undefined) return '—';
  const magnitude = Math.abs(value);
  const digits = magnitude > 0 && magnitude < 0.01 ? Math.min(6, Math.ceil(-Math.log10(magnitude)) + 1) : 2;
  return `${format(value, digits)}${unit ? `${unit === '°' ? '' : ' '}${unit}` : ''}`;
}

function lowerBound(values, x, getX = value => value.x) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (getX(values[middle]) < x) low = middle + 1;
    else high = middle;
  }
  return low;
}

function nearest(samples, x) {
  const index = lowerBound(samples, x, value => value);
  if (index === 0) return 0;
  if (index === samples.length) return samples.length - 1;
  return x - samples[index - 1] <= samples[index] - x ? index - 1 : index;
}

function splitsSegment(a, b, data) {
  if (data.focusX !== null && a.x <= data.focusX && b.x >= data.focusX) return true;
  const [min, max] = data.domainY;
  return Math.abs(a.y - b.y) > (max - min) * 2 &&
    ((a.y < min && b.y > max) || (a.y > max && b.y < min));
}

function valueAt(series, x, data) {
  if (data.focusX !== null && near(x, data.focusX)) return null;
  const index = lowerBound(series.values, x);
  const right = series.values[index];
  if (right && near(right.x, x)) return right.y;
  const left = series.values[index - 1];
  if (left && near(left.x, x)) return left.y;
  if (!left || !right || left.y === null || right.y === null || splitsSegment(left, right, data)) return undefined;
  return left.y + (right.y - left.y) * (x - left.x) / (right.x - left.x);
}

function seriesPath(series, data, plot) {
  let previous = null;
  let path = '';
  for (const point of series.values) {
    if (point.y === null || (data.focusX !== null && near(point.x, data.focusX))) {
      previous = null;
      continue;
    }
    const x = plot.x(point.x);
    const y = plot.y(point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      previous = null;
      continue;
    }
    const command = previous && !splitsSegment(previous, point, data) ? 'L' : 'M';
    path += `${command}${x.toFixed(2)},${y.toFixed(2)}`;
    previous = point;
  }
  return path;
}

export function createChart(host, { onSeek = () => {} } = {}) {
  if (!host) return { setData() {}, setCursor() {}, dispose() {} };

  const document = host.ownerDocument;
  const view = document.defaultView;
  const id = `lab-chart-${++chartId}`;
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const svgElement = (tag, attributes = {}, text) => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const root = element('div', 'lab-chart');
  const svg = svgElement('svg', {
    class: 'lab-chart__svg', role: 'slider', tabindex: '-1', focusable: 'true',
    'aria-orientation': 'horizontal', 'aria-labelledby': `${id}-title`,
    'aria-describedby': `${id}-description`,
    'aria-keyshortcuts': 'ArrowLeft ArrowRight Home End Enter Space',
  });
  const title = svgElement('title', { id: `${id}-title` }, '实验数据曲线');
  const description = svgElement('desc', { id: `${id}-description` }, INSTRUCTIONS);
  const clipRect = svgElement('rect');
  const clip = svgElement('clipPath', { id: `${id}-clip`, clipPathUnits: 'userSpaceOnUse' });
  clip.append(clipRect);
  const defs = svgElement('defs');
  defs.append(clip);
  const frame = svgElement('g', { 'aria-hidden': 'true' });
  const cursor = svgElement('g', { class: 'lab-chart__cursor', 'aria-hidden': 'true', display: 'none' });
  const cursorLine = svgElement('line', { class: 'lab-chart__cursor-line', x1: 0, x2: 0 });
  const hit = svgElement('rect', { class: 'lab-chart__hit', 'aria-hidden': 'true', display: 'none' });
  const measure = svgElement('text', { visibility: 'hidden', 'aria-hidden': 'true' });
  svg.append(title, description, defs, frame, cursor, hit, measure);

  const tooltip = element('div', 'lab-chart__tooltip');
  tooltip.id = `${id}-tooltip`;
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  const tooltipAxis = element('div', 'lab-chart__tooltip-axis');
  const tooltipRows = element('div', 'lab-chart__tooltip-rows');
  const tooltipStatus = element('div', 'lab-chart__tooltip-status');
  tooltip.append(tooltipAxis, tooltipRows, tooltipStatus);
  root.append(svg, tooltip);
  host.append(root);

  let data = null;
  let plot = null;
  let currentX = null;
  let pointer = null;
  let keyboardIndex = null;
  let focused = false;
  let dismissed = false;
  let disposed = false;
  let pendingFrame = 0;
  let markers = [];
  let readouts = [];
  let lastTooltipX = null;

  function measureText(text, className) {
    measure.setAttribute('class', className);
    measure.textContent = text;
    const measured = measure.getComputedTextLength();
    return measured || [...text].reduce((width, character) => width + (character.charCodeAt(0) > 255 ? 10.5 : 6), 0);
  }

  function selectedX() {
    if (pointer) return data.samples[nearest(data.samples, pointer.x)];
    if (focused) return data.samples[keyboardIndex ?? nearest(data.samples, currentX ?? data.domainX[0])];
    return currentX;
  }

  function updateCursor() {
    if (disposed || !plot || !data || !data.samples.length) {
      cursor.setAttribute('display', 'none');
      tooltip.hidden = true;
      return;
    }
    const x = selectedX();
    const inspecting = Boolean(pointer) || focused;
    root.classList.toggle('lab-chart--inspecting', inspecting);
    if (!Number.isFinite(x) || x < data.domainX[0] || x > data.domainX[1]) {
      cursor.setAttribute('display', 'none');
      tooltip.hidden = true;
      svg.removeAttribute('aria-valuenow');
      svg.removeAttribute('aria-valuetext');
      return;
    }

    // These nodes stay mounted during playback; no path or axis is rebuilt here.
    const pixelX = plot.x(x);
    cursor.setAttribute('display', 'inline');
    cursor.setAttribute('transform', `translate(${pixelX},0)`);
    const values = data.series.map(series => valueAt(series, x, data));
    values.forEach((value, index) => {
      const inRange = Number.isFinite(value) && value >= data.domainY[0] && value <= data.domainY[1];
      markers[index].setAttribute('visibility', inRange ? 'visible' : 'hidden');
      if (inRange) markers[index].setAttribute('cy', String(plot.y(value)));
    });
    svg.setAttribute('aria-valuenow', String(x));
    if (inspecting) {
      svg.setAttribute('aria-valuetext', [
        `${data.xName} ${valueText(x, data.xUnit)}`,
        ...data.series.map((series, index) => `${series.label} ${valueText(values[index], data.unit)}`),
      ].join('；'));
    } else {
      svg.setAttribute('aria-valuetext', `${data.xName} ${valueText(x, data.xUnit)}`);
    }

    tooltip.hidden = !inspecting || dismissed;
    if (tooltip.hidden) return;
    if (lastTooltipX !== x) {
      tooltipAxis.textContent = `${data.xName} · ${valueText(x, data.xUnit)}`;
      values.forEach((value, index) => { readouts[index].textContent = valueText(value, data.unit); });
      const outside = values.some(value => Number.isFinite(value) && (value < data.domainY[0] || value > data.domainY[1]));
      tooltipStatus.textContent = outside ? '当前值超出纵轴显示范围' : values.some(value => value === null) ? '此处没有有限值' : '';
      tooltipStatus.hidden = !tooltipStatus.textContent;
      lastTooltipX = x;
    }
    const tooltipWidth = tooltip.offsetWidth;
    const tooltipHeight = tooltip.offsetHeight;
    let left = pixelX + 12;
    if (left + tooltipWidth > plot.width - 6) left = pixelX - tooltipWidth - 12;
    let top = pointer ? pointer.y - tooltipHeight - 10 : plot.top + 4;
    if (pointer && top < 4) top = pointer.y + 10;
    tooltip.style.left = `${clamp(left, 6, Math.max(6, plot.width - tooltipWidth - 6))}px`;
    tooltip.style.top = `${clamp(top, 4, Math.max(4, plot.height - tooltipHeight - 4))}px`;
  }

  function render() {
    if (disposed) return;
    const { width, height } = root.getBoundingClientRect();
    frame.replaceChildren();
    plot = null;
    tooltip.hidden = true;
    lastTooltipX = null;
    cursor.setAttribute('display', 'none');
    hit.setAttribute('display', 'none');
    svg.setAttribute('viewBox', `0 0 ${Math.max(1, width)} ${Math.max(1, height)}`);
    svg.style.visibility = width >= 100 && height >= 64 ? 'visible' : 'hidden';
    if (width < 100 || height < 64) return;
    if (!data || !data.samples.length) {
      frame.append(svgElement('text', {
        class: 'lab-chart__empty', x: width / 2, y: height / 2, 'text-anchor': 'middle',
      }, '暂无曲线数据'));
      return;
    }

    const yTicks = ticks(data.domainY, 3);
    const xTicks = ticks(data.domainX, width < 250 ? 3 : 5);
    const left = Math.max(30, ...yTicks.map(value => measureText(tickText(value), 'lab-chart__tick') + 10));
    const legendItems = data.series.length >= 2 ? data.series.map(series => ({
      series, width: 24 + measureText(series.label, 'lab-chart__legend-label'),
    })) : [];
    const legendWidth = legendItems.reduce((total, item) => total + item.width, 0) + Math.max(0, legendItems.length - 1) * 16;
    const legendSecondRow = legendItems.length && left + measureText(data.yLabel, 'lab-chart__axis-label') + 16 > width - legendWidth - 8;
    const top = legendSecondRow ? 35 : 18;
    const bottom = height - 28;
    if (bottom - top < 24 || width - left - 8 < 24) return;
    const y = value => bottom - (value - data.domainY[0]) / (data.domainY[1] - data.domainY[0]) * (bottom - top);

    const directLabels = [];
    if (width >= 540 && data.series.length <= 4) {
      for (const series of data.series) {
        const value = valueAt(series, data.domainX[1], data);
        if (!Number.isFinite(value)) continue;
        const position = y(value);
        const labelWidth = measureText(series.label, 'lab-chart__direct-label');
        if (position < top + 7 || position > bottom - 7 || labelWidth > width * 0.15) continue;
        if (directLabels.some(item => Math.abs(item.y - position) < 16)) continue;
        directLabels.push({ series, y: position, width: labelWidth });
      }
    }
    const gutter = directLabels.length ? Math.max(...directLabels.map(item => item.width)) + 29 : 0;
    const right = width - 8 - gutter;
    plot = {
      width, height, left, right, top, bottom, y,
      x: value => left + (value - data.domainX[0]) / (data.domainX[1] - data.domainX[0]) * (right - left),
    };
    for (const [name, value] of Object.entries({ x: left, y: top, width: right - left, height: bottom - top })) {
      clipRect.setAttribute(name, String(value));
    }

    const grid = svgElement('g', { class: 'lab-chart__grid' });
    const axes = svgElement('g');
    yTicks.forEach(value => {
      const position = y(value);
      grid.append(svgElement('line', {
        class: value === 0 ? 'lab-chart__zero' : 'lab-chart__grid-line',
        x1: left, x2: right, y1: position, y2: position,
      }));
      axes.append(svgElement('text', {
        class: 'lab-chart__tick', x: left - 8, y: position + 3, 'text-anchor': 'end',
      }, tickText(value)));
    });
    xTicks.forEach(value => {
      const position = plot.x(value);
      grid.append(svgElement('line', { class: 'lab-chart__grid-line', x1: position, x2: position, y1: top, y2: bottom }));
      axes.append(svgElement('text', {
        class: 'lab-chart__tick', x: position, y: bottom + 13,
        'text-anchor': near(value, data.domainX[1]) ? 'end' : 'middle',
      }, tickText(value)));
    });
    axes.append(
      svgElement('text', { class: 'lab-chart__axis-label', x: left, y: 11 }, data.yLabel),
      svgElement('text', { class: 'lab-chart__axis-label', x: (left + right) / 2, y: height - 2, 'text-anchor': 'middle' }, data.xLabel),
    );
    const curves = svgElement('g', { 'clip-path': `url(#${id}-clip)` });
    data.series.forEach(series => curves.append(svgElement('path', {
      class: 'lab-chart__series', d: seriesPath(series, data, plot), stroke: series.color,
      'stroke-dasharray': series.dash || 'none',
    })));
    frame.append(grid);
    if (data.focusX !== null && data.focusX >= data.domainX[0] && data.focusX <= data.domainX[1]) {
      const position = plot.x(data.focusX);
      const atRight = position > right - 18;
      frame.append(
        svgElement('line', { class: 'lab-chart__focus-guide', x1: position, x2: position, y1: top, y2: bottom }),
        svgElement('text', {
          class: 'lab-chart__focus-label', x: position + (atRight ? -5 : 5), y: top + 11,
          'text-anchor': atRight ? 'end' : 'start',
        }, 'f'),
      );
    }
    frame.append(curves, axes);

    let legendX = width - 8 - legendWidth;
    legendItems.forEach(({ series, width: itemWidth }) => {
      const positionY = legendSecondRow ? 25 : 7.5;
      frame.append(
        svgElement('line', {
          class: 'lab-chart__key-line', x1: legendX, x2: legendX + 18, y1: positionY, y2: positionY,
          stroke: series.color, 'stroke-dasharray': series.dash || 'none',
        }),
        svgElement('text', { class: 'lab-chart__legend-label', x: legendX + 24, y: positionY + 3.5 }, series.label),
      );
      legendX += itemWidth + 16;
    });
    directLabels.forEach(item => frame.append(
      svgElement('line', {
        class: 'lab-chart__key-line', x1: right + 4, x2: right + 18, y1: item.y, y2: item.y,
        stroke: item.series.color, 'stroke-dasharray': item.series.dash || 'none',
      }),
      svgElement('text', { class: 'lab-chart__direct-label', x: right + 24, y: item.y + 3.5 }, item.series.label),
    ));

    cursorLine.setAttribute('y1', String(top));
    cursorLine.setAttribute('y2', String(bottom));
    markers = data.series.map(series => svgElement('circle', { class: 'lab-chart__dot', cx: 0, r: 4, fill: series.color }));
    cursor.replaceChildren(cursorLine, ...markers);
    for (const [name, value] of Object.entries({ x: left - 4, y: top - 2, width: right - left + 8, height: bottom - top + 4 })) {
      hit.setAttribute(name, String(value));
    }
    hit.setAttribute('display', 'inline');
    updateCursor();
  }

  function scheduleRender() {
    if (disposed || pendingFrame) return;
    pendingFrame = view.requestAnimationFrame(() => {
      pendingFrame = 0;
      render();
    });
  }

  function pointerPosition(event) {
    if (!plot) return null;
    const bounds = svg.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    const x = (event.clientX - bounds.left) / bounds.width * plot.width;
    const y = (event.clientY - bounds.top) / bounds.height * plot.height;
    return {
      x: clamp(data.domainX[0] + (x - plot.left) / (plot.right - plot.left) * (data.domainX[1] - data.domainX[0]), ...data.domainX),
      y: clamp(y, plot.top, plot.bottom),
    };
  }

  const listeners = new view.AbortController();
  const listen = (node, name, handler) => node.addEventListener(name, handler, { signal: listeners.signal });
  listen(hit, 'pointermove', event => {
    if (!data || !data.samples.length || event.pointerType === 'touch') return;
    pointer = pointerPosition(event);
    dismissed = false;
    updateCursor();
  });
  listen(hit, 'pointerleave', () => {
    pointer = null;
    updateCursor();
  });
  listen(hit, 'click', event => {
    const position = pointerPosition(event);
    if (!position || !data.samples.length) return;
    keyboardIndex = nearest(data.samples, position.x);
    pointer = null;
    dismissed = false;
    svg.focus({ preventScroll: true });
    updateCursor();
    onSeek(position.x);
  });
  listen(svg, 'focus', () => {
    focused = true;
    dismissed = false;
    updateCursor();
  });
  listen(svg, 'blur', () => {
    focused = false;
    keyboardIndex = null;
    updateCursor();
  });
  listen(svg, 'keydown', event => {
    if (!data || !data.samples.length || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Escape') {
      dismissed = true;
      pointer = null;
      updateCursor();
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' ', 'Spacebar'].includes(event.key)) return;
    event.preventDefault();
    const index = nearest(data.samples, selectedX() ?? data.domainX[0]);
    dismissed = false;
    pointer = null;
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      keyboardIndex = index;
      updateCursor();
      onSeek(data.samples[index]);
      return;
    }
    keyboardIndex = event.key === 'Home' ? 0 : event.key === 'End' ? data.samples.length - 1 :
      clamp(index + (event.key === 'ArrowRight' ? 1 : -1), 0, data.samples.length - 1);
    updateCursor();
  });

  const observer = new view.ResizeObserver(scheduleRender);
  observer.observe(root);
  render();

  return {
    setData(input) {
      if (disposed) return;
      data = prepare(input);
      pointer = null;
      keyboardIndex = null;
      lastTooltipX = null;
      title.textContent = data?.title || '实验数据曲线';
      description.textContent = [data?.xLabel, data?.yLabel, data?.note, INSTRUCTIONS].filter(Boolean).join('。');
      const hasSamples = Boolean(data?.samples.length);
      svg.setAttribute('tabindex', hasSamples ? '0' : '-1');
      svg.setAttribute('aria-disabled', String(!hasSamples));
      svg.removeAttribute('aria-valuenow');
      svg.removeAttribute('aria-valuetext');
      if (data) {
        svg.setAttribute('aria-valuemin', String(data.domainX[0]));
        svg.setAttribute('aria-valuemax', String(data.domainX[1]));
      } else {
        svg.removeAttribute('aria-valuemin');
        svg.removeAttribute('aria-valuemax');
      }
      tooltipRows.replaceChildren();
      readouts = (data?.series || []).map(series => {
        const row = element('div', 'lab-chart__tooltip-row');
        const key = element('span', `lab-chart__swatch${series.dash ? ' lab-chart__swatch--dashed' : ''}`);
        key.style.borderTopColor = series.color;
        key.setAttribute('aria-hidden', 'true');
        const value = element('strong', 'lab-chart__tooltip-value');
        row.append(key, value, element('span', 'lab-chart__tooltip-label', series.label));
        tooltipRows.append(row);
        return value;
      });
      render();
    },
    setCursor(x) {
      if (disposed) return;
      currentX = Number.isFinite(x) ? x : null;
      updateCursor();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      listeners.abort();
      if (pendingFrame) view.cancelAnimationFrame(pendingFrame);
      root.remove();
      data = null;
      plot = null;
      markers = [];
      readouts = [];
    },
  };
}
