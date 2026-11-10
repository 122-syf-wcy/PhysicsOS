import { LensModel } from '/shared/lens-model.js';

export const DURATION = 12;
export const DEFAULTS = {
  pendulum: { length: 2, mass: 0.5, angle: 15, gravity: 9.8 },
  spring: { mass: 1, stiffness: 50, amplitude: 0.5 },
  lens: { u: 30, f: 10, d: 15, h: 6 },
};

export const EXPERIMENTS = {
  pendulum: {
    title: '单摆', english: 'SIMPLE PENDULUM', number: '01', domain: '力学 · 简谐运动',
    description: '改变一根细线的长度，看见周期与能量的关系。',
    question: '摆球更重，摆动会更快吗？',
    insight: '试着增加摆球质量。小角度下，周期只由摆长和重力加速度决定，与质量无关。',
    formula: 'T = 2π √(L / g)',
    assumption: '小角近似 · 理想细线 · 忽略空气阻力',
    note: 'θ = θ₀ cos(√(g/L) · t)，与现有实验的小角模型一致。',
  },
  spring: {
    title: '弹簧振子', english: 'SPRING OSCILLATOR', number: '02', domain: '力学 · 简谐运动',
    description: '让弹簧伸缩，把回复力与简谐运动联系起来。',
    question: '弹簧越硬，振动会怎样变化？',
    insight: '保持质量不变，增大劲度系数。周期会缩短，而同样振幅下储存的弹性势能会增加。',
    formula: 'T = 2π √(m / k)',
    assumption: '理想弹簧 · 水平无摩擦 · 忽略弹簧质量',
    note: '位移以平衡位置为零点，x = A cos(√(k/m) · t)。',
  },
  lens: {
    title: '凸透镜成像', english: 'CONVEX LENS', number: '03', domain: '光学 · 几何成像',
    description: '移动物体与光屏，在空间里理解光线如何会聚。',
    question: '物体越靠近焦点，像会在哪里？',
    insight: '把物体从二倍焦距移向焦点。实像会变大、变远；物体进入焦距以内时，形成不可投屏的虚像。',
    formula: '1 / f = 1 / u + 1 / v',
    assumption: '薄透镜模型 · 近轴光线 · 物高 6 cm',
    note: '这是静态成像实验。虚像由反向延长线定位，不能在光屏上承接。',
  },
};

export const PARAMETERS = {
  pendulum: [
    { key: 'length', label: '摆长', symbol: 'L', unit: 'm', min: 0.6, max: 2.5, step: 0.1, digits: 1 },
    { key: 'angle', label: '初始摆角', symbol: 'θ₀', unit: '°', min: 3, max: 20, step: 1, digits: 0 },
    { key: 'mass', label: '摆球质量', symbol: 'm', unit: 'kg', min: 0.2, max: 2, step: 0.1, digits: 1 },
    { key: 'gravity', label: '重力加速度', symbol: 'g', unit: 'm/s²', min: 1.62, max: 12, step: 0.01, digits: 2 },
  ],
  spring: [
    { key: 'mass', label: '振子质量', symbol: 'm', unit: 'kg', min: 0.2, max: 2, step: 0.1, digits: 1 },
    { key: 'stiffness', label: '劲度系数', symbol: 'k', unit: 'N/m', min: 10, max: 100, step: 5, digits: 0 },
    { key: 'amplitude', label: '初始振幅', symbol: 'A', unit: 'm', min: 0.1, max: 0.65, step: 0.05, digits: 2 },
  ],
  lens: [
    { key: 'u', label: '物距', symbol: 'u', unit: 'cm', min: 5, max: 60, step: 0.5, digits: 1 },
    { key: 'f', label: '焦距', symbol: 'f', unit: 'cm', min: 5, max: 20, step: 0.5, digits: 1 },
    { key: 'd', label: '光屏位置', symbol: 'd', unit: 'cm', min: 5, max: 80, step: 0.5, digits: 1 },
  ],
};

export function motionAt(kind, p, time) {
  if (kind === 'pendulum') {
    const amplitude = p.angle * Math.PI / 180;
    const frequency = Math.sqrt(p.gravity / p.length);
    const theta = amplitude * Math.cos(frequency * time);
    const thetaDot = -amplitude * frequency * Math.sin(frequency * time);
    const velocityX = p.length * thetaDot * Math.cos(theta);
    const velocityY = p.length * thetaDot * Math.sin(theta);
    // This is the energy of the same linearized model, not a nonlinear pendulum.
    const potential = 0.5 * p.mass * p.gravity * p.length * theta * theta;
    const kinetic = 0.5 * p.mass * (p.length * thetaDot) ** 2;
    return {
      theta, thetaDot, x: p.length * Math.sin(theta), y: -p.length * Math.cos(theta),
      velocityX, velocityY, velocity: p.length * thetaDot,
      speed: Math.abs(p.length * thetaDot), displacement: theta * 180 / Math.PI,
      period: 2 * Math.PI / frequency, potential, kinetic, energy: potential + kinetic,
    };
  }
  const frequency = Math.sqrt(p.stiffness / p.mass);
  const x = p.amplitude * Math.cos(frequency * time);
  const velocity = -p.amplitude * frequency * Math.sin(frequency * time);
  const potential = 0.5 * p.stiffness * x * x;
  const kinetic = 0.5 * p.mass * velocity * velocity;
  return {
    x, displacement: x, velocity, velocityX: velocity, velocityY: 0,
    acceleration: -frequency * frequency * x, speed: Math.abs(velocity),
    period: 2 * Math.PI / frequency, potential, kinetic, energy: potential + kinetic,
  };
}

export function lensAt(p, u = p.u) {
  const atFocus = Math.abs(u - p.f) < 0.025;
  const v = atFocus ? null : u * p.f / (u - p.f);
  const m = v === null ? null : -v / u;
  return { v, m, height: m === null ? null : p.h * m, atFocus };
}

export class Simulation extends EventTarget {
  constructor() {
    super();
    this.kind = 'pendulum';
    this.values = Object.fromEntries(Object.entries(DEFAULTS).map(([key, p]) => [key, { ...p }]));
    this.lens = new LensModel();
    this.time = 0;
    this.speed = 1;
    this.playing = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.layers = { grid: true, path: true, vectors: false, labels: true };
  }
  get params() { return this.values[this.kind]; }
  get state() { return this.kind === 'lens' ? this.lens.result : motionAt(this.kind, this.params, this.time); }
  snapshot() {
    return { kind: this.kind, params: this.params, state: this.state, time: this.time, layers: this.layers };
  }
  changed() { this.dispatchEvent(new Event('change')); }
  select(kind) {
    if (!EXPERIMENTS[kind] || kind === this.kind) return;
    this.kind = kind;
    this.time = 0;
    this.playing = kind !== 'lens' && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.changed();
  }
  setParameter(key, value) {
    const field = PARAMETERS[this.kind].find(item => item.key === key);
    if (!field || !Number.isFinite(Number(value))) return;
    const bounded = Math.min(field.max, Math.max(field.min, Number(value)));
    const next = Number((field.min + Math.round((bounded - field.min) / field.step) * field.step).toFixed(6));
    this.params[key] = Math.min(field.max, Math.max(field.min, next));
    if (this.kind === 'lens') {
      this.lens.set(key, next);
      Object.assign(this.params, { u: this.lens.u, f: this.lens.f, d: this.lens.d });
    }
    this.time = 0;
    this.changed();
  }
  reset() {
    Object.assign(this.params, DEFAULTS[this.kind]);
    if (this.kind === 'lens') this.lens.reset();
    this.time = 0;
    this.changed();
  }
  seek(time) {
    this.time = Math.max(0, Math.min(DURATION, Number(time) || 0));
    this.playing = false;
    this.changed();
  }
  toggle() {
    if (this.kind === 'lens') return;
    if (this.time >= DURATION) this.time = 0;
    this.playing = !this.playing;
    this.changed();
  }
  rewind() { this.time = 0; this.changed(); }
  focus() {
    this.lens.focus();
    this.params.d = this.lens.d;
    this.changed();
  }
  preset(ratio) {
    this.lens.preset(ratio);
    this.params.u = this.lens.u;
    this.changed();
  }
  advance(seconds) {
    if (!this.playing || this.kind === 'lens') return;
    this.time = Math.min(DURATION, this.time + seconds * this.speed);
    if (this.time === DURATION) { this.playing = false; this.changed(); }
  }
}

export const SERIES = { primary: '#2a78d6', secondary: '#eb6834' };

export function chartData(kind, p, mode = 'motion') {
  if (kind === 'lens') {
    const values = Array.from({ length: 221 }, (_, index) => {
      const u = 5 + index * 0.25;
      return { x: u, y: lensAt(p, u).v };
    });
    return {
      title: '物距与像距', unit: 'cm', xLabel: '物距 u / cm', yLabel: '像距 v / cm',
      domainX: [5, 60], domainY: [-60, 80], focusX: p.f,
      series: [{ key: 'v', label: '像距', color: SERIES.primary, values }],
      note: '正像距为实像，负像距为虚像；焦点处不成有限像。纵轴显示 −60 至 80 cm，完整值见数据表。',
    };
  }
  const samples = Array.from({ length: 481 }, (_, index) => {
    const time = index * DURATION / 480;
    return { time, state: motionAt(kind, p, time) };
  });
  if (mode === 'energy') {
    const energy = motionAt(kind, p, 0).energy;
    return {
      title: '动能与势能', unit: 'J', xLabel: '时间 t / s', yLabel: '能量 / J',
      domainX: [0, DURATION], domainY: [0, Math.max(0.001, energy) * 1.15],
      series: [
        { key: 'kinetic', label: '动能 K', color: SERIES.primary, values: samples.map(({ time, state }) => ({ x: time, y: state.kinetic })) },
        { key: 'potential', label: '势能 U', color: SERIES.secondary, dash: true, values: samples.map(({ time, state }) => ({ x: time, y: state.potential })) },
      ],
      note: kind === 'pendulum' ? '小角线性化模型：U = ½mgLθ²，K = ½mL²θ̇²。' : '理想无摩擦模型：U = ½kx²，K = ½mv²。',
    };
  }
  const extent = kind === 'pendulum' ? p.angle : p.amplitude;
  const unit = kind === 'pendulum' ? '°' : 'm';
  return {
    title: kind === 'pendulum' ? '摆角随时间变化' : '位移随时间变化', unit,
    xLabel: '时间 t / s', yLabel: kind === 'pendulum' ? '摆角 θ / °' : '位移 x / m',
    domainX: [0, DURATION], domainY: [-extent * 1.15, extent * 1.15],
    series: [{ key: 'displacement', label: kind === 'pendulum' ? '摆角 θ' : '平衡位移 x', color: SERIES.primary, values: samples.map(({ time, state }) => ({ x: time, y: state.displacement })) }],
    note: kind === 'pendulum' ? '小角近似；改变摆长后，曲线与空间中的运动同步更新。' : '位移以平衡位置为零点，周期与振幅无关。',
  };
}

export function format(value, digits = 2) {
  if (value === null || !Number.isFinite(value)) return '∞';
  return (Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value).toFixed(digits).replace('-', '−');
}
