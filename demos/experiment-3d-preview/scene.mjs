import * as THREE from 'three';
import { OrbitControls } from '/shared/OrbitControls.js';

const BACKGROUND = 0xe9ede6;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const rodDirection = new THREE.Vector3();
const DEFAULTS = {
  pendulum: { length: 2, mass: 0.5, angle: 15, gravity: 9.8 },
  spring: { mass: 1, stiffness: 50, amplitude: 0.5 },
  lens: { u: 30, f: 10, d: 15, h: 6 },
};

const clamp = THREE.MathUtils.clamp;
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const number = (value, digits = 1) => finite(value).toFixed(digits).replace('-', '−');

function parameters(kind, supplied = {}) {
  const p = { ...DEFAULTS[kind] };
  for (const key of Object.keys(p)) p[key] = finite(supplied[key], p[key]);
  if (kind === 'pendulum') {
    p.length = clamp(p.length, 0.6, 2.5);
    p.mass = clamp(p.mass, 0.2, 2);
    p.angle = clamp(p.angle, 3, 20);
    p.gravity = clamp(p.gravity, 1.62, 12);
  } else if (kind === 'spring') {
    p.mass = clamp(p.mass, 0.2, 2);
    p.stiffness = clamp(p.stiffness, 10, 100);
    p.amplitude = clamp(p.amplitude, 0.1, 0.65);
  } else {
    p.u = clamp(p.u, 5, 60);
    p.f = clamp(p.f, 5, 20);
    p.d = clamp(p.d, 5, 100);
    p.h = clamp(p.h, 0.1, 20);
  }
  return p;
}

class Resources {
  geometries = new Set();
  materials = new Set();
  textures = new Set();

  geometry(value) { this.geometries.add(value); return value; }
  material(value) { this.materials.add(value); return value; }
  texture(value) { this.textures.add(value); return value; }

  mesh(parent, geometry, material, x = 0, y = 0, z = 0, shadows = true) {
    this.geometry(geometry);
    if (Array.isArray(material)) material.forEach(item => this.material(item));
    else this.material(material);
    const result = new THREE.Mesh(geometry, material);
    result.position.set(x, y, z);
    result.castShadow = shadows;
    result.receiveShadow = shadows;
    parent.add(result);
    return result;
  }

  dispose() {
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    for (const texture of this.textures) texture.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.textures.clear();
  }
}

function materials(r) {
  const standard = (color, metalness, roughness) => r.material(new THREE.MeshStandardMaterial({ color, metalness, roughness }));
  return {
    graphite: standard(0x343c3a, 0.45, 0.42),
    black: standard(0x202825, 0.35, 0.5),
    aluminum: standard(0xb9c1ba, 0.93, 0.29),
    chrome: standard(0xe0e7e2, 1, 0.16),
    brass: standard(0xb29a65, 0.88, 0.31),
    copper: r.material(new THREE.MeshPhysicalMaterial({
      color: 0xbd8557, metalness: 1, roughness: 0.22, clearcoat: 0.35, clearcoatRoughness: 0.2,
    })),
    rubber: standard(0x242a26, 0, 0.92),
    ivory: standard(0xf1eee2, 0, 0.72),
  };
}

function roundedShape(width, depth, radius) {
  const w = width / 2, d = depth / 2;
  const q = Math.min(radius, w * 0.7, d * 0.7);
  const shape = new THREE.Shape();
  shape.moveTo(-w + q, -d);
  shape.lineTo(w - q, -d);
  shape.quadraticCurveTo(w, -d, w, -d + q);
  shape.lineTo(w, d - q);
  shape.quadraticCurveTo(w, d, w - q, d);
  shape.lineTo(-w + q, d);
  shape.quadraticCurveTo(-w, d, -w, d - q);
  shape.lineTo(-w, -d + q);
  shape.quadraticCurveTo(-w, -d, -w + q, -d);
  return shape;
}

function beveledGeometry(w, h, d, radius = 0.06) {
  const bevel = Math.min(0.025, h * 0.2, d * 0.12, w * 0.12);
  const geometry = new THREE.ExtrudeGeometry(roundedShape(w - bevel * 2, d - bevel * 2, radius), {
    depth: h - bevel * 2, bevelEnabled: true, bevelThickness: bevel,
    bevelSize: bevel, bevelSegments: 2, curveSegments: 5, steps: 1,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -h / 2 + bevel, 0);
  return geometry;
}

function box(r, parent, w, h, d, material, x = 0, y = 0, z = 0, bevel = false) {
  return r.mesh(parent, bevel ? beveledGeometry(w, h, d) : new THREE.BoxGeometry(w, h, d), material, x, y, z);
}

function cylinder(r, parent, radius, height, material, x = 0, y = 0, z = 0) {
  return r.mesh(parent, new THREE.CylinderGeometry(radius, radius, height, 32), material, x, y, z);
}

function ring(r, parent, radius, thickness, material, x = 0, y = 0, z = 0, axis = 'z') {
  const mesh = r.mesh(parent, new THREE.TorusGeometry(radius, thickness, 10, 64), material, x, y, z);
  if (axis === 'x') mesh.rotation.y = Math.PI / 2;
  if (axis === 'y') mesh.rotation.x = Math.PI / 2;
  return mesh;
}

function screw(r, parent, x, y, z, metal, dark, radius = 0.031) {
  cylinder(r, parent, radius, 0.016, metal, x, y, z);
  box(r, parent, radius * 1.25, 0.003, radius * 0.19, dark, x, y + 0.009, z);
  box(r, parent, radius * 0.19, 0.003, radius * 1.25, dark, x, y + 0.009, z);
}

function frontScrew(r, parent, x, y, z, metal, dark, radius = 0.033) {
  const head = cylinder(r, parent, radius, 0.018, metal, x, y, z);
  head.rotation.x = Math.PI / 2;
  box(r, parent, radius * 1.2, radius * 0.2, 0.003, dark, x, y, z + 0.011);
}

function setRod(mesh, ax, ay, az, bx, by, bz) {
  rodDirection.set(bx - ax, by - ay, bz - az);
  const length = rodDirection.length();
  mesh.visible = Number.isFinite(length) && length > 0.00001;
  if (!mesh.visible) return;
  mesh.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  mesh.scale.y = length;
  mesh.quaternion.setFromUnitVectors(Y_AXIS, rodDirection.multiplyScalar(1 / length));
}

function canvasTexture(r, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建仪器文字画布。');
  const texture = r.texture(new THREE.CanvasTexture(canvas));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { canvas, context, texture };
}

function decal(r, parent, text, width, height, x, y, z, color = '#d6ded4') {
  const { context, texture } = canvasTexture(r, 1536, 160);
  context.clearRect(0, 0, 1536, 160);
  context.font = '500 56px ui-monospace, SFMono-Regular, Menlo, monospace';
  context.textBaseline = 'middle';
  context.fillStyle = color;
  context.fillText(text, 12, 80, 1500);
  texture.needsUpdate = true;
  const material = r.material(new THREE.MeshStandardMaterial({
    map: texture, transparent: true, depthWrite: false, roughness: 0.67, metalness: 0.2,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  }));
  return r.mesh(parent, new THREE.PlaneGeometry(width, height), material, x, y, z, false);
}

function ruler(r, parent, width, min, max, { depth = 0.19, major = 0.5, minor = 0.1 } = {}) {
  const { context: ctx, texture } = canvasTexture(r, 2048, 160);
  const material = r.material(new THREE.MeshStandardMaterial({ map: texture, metalness: 0.68, roughness: 0.43 }));
  const mesh = r.mesh(parent, new THREE.PlaneGeometry(1, depth), material, 0, 0, 0, false);
  mesh.rotation.x = -Math.PI / 2;
  mesh.scale.x = width;
  function draw(lo, hi) {
    ctx.fillStyle = '#c2c9bf';
    ctx.fillRect(0, 0, 2048, 160);
    ctx.fillStyle = '#47534a';
    ctx.font = '500 43px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const first = Math.ceil((lo - 1e-6) / minor);
    const last = Math.floor((hi + 1e-6) / minor);
    for (let i = first; i <= last; i++) {
      const value = i * minor;
      const x = (value - lo) / (hi - lo) * 2048;
      const isMajor = Math.abs(value / major - Math.round(value / major)) < 0.0001;
      ctx.fillRect(x, 0, isMajor ? 3 : 1.7, isMajor ? 65 : 31);
      if (isMajor && x > 23 && x < 2025) {
        ctx.fillText(Math.abs(value) < 0.0001 ? '0' : String(Number(value.toFixed(2))).replace('-', '−'), x, 111);
      }
    }
    texture.needsUpdate = true;
  }
  draw(min, max);
  return { mesh, draw };
}

function dynamicLine(r, parent, material) {
  const geometry = r.geometry(new THREE.BufferGeometry());
  const position = new THREE.BufferAttribute(new Float32Array(6), 3).setUsage(THREE.DynamicDrawUsage);
  const distance = new THREE.BufferAttribute(new Float32Array(2), 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', position);
  geometry.setAttribute('lineDistance', distance);
  const line = new THREE.Line(geometry, material);
  line.frustumCulled = false;
  parent.add(line);
  r.material(material);
  return {
    line,
    set(ax, ay, az, bx, by, bz) {
      if (![ax, ay, az, bx, by, bz].every(Number.isFinite)) { line.visible = false; return; }
      position.setXYZ(0, ax, ay, az);
      position.setXYZ(1, bx, by, bz);
      distance.setX(0, 0);
      distance.setX(1, Math.hypot(bx - ax, by - ay, bz - az));
      position.needsUpdate = true;
      distance.needsUpdate = true;
      line.visible = true;
    },
  };
}

function arrow(r, parent, color = 0x987341) {
  const group = new THREE.Group();
  parent.add(group);
  const material = r.material(new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.35 }));
  const shaft = r.mesh(group, new THREE.CylinderGeometry(0.013, 0.013, 1, 10), material, 0, 0, 0, false);
  const tip = r.mesh(group, new THREE.ConeGeometry(0.055, 0.13, 20), material, 0, 0, 0, false);
  const direction = new THREE.Vector3();
  return {
    group,
    set(x, y, z, vx, vy, length) {
      const magnitude = Math.hypot(vx, vy);
      group.visible = Number.isFinite(magnitude) && magnitude > 0.0001 && length > 0.03;
      if (!group.visible) return;
      direction.set(vx / magnitude, vy / magnitude, 0);
      group.position.set(x, y, z);
      group.quaternion.setFromUnitVectors(Y_AXIS, direction);
      const head = Math.min(0.13, length * 0.4);
      shaft.scale.y = Math.max(0.001, length - head);
      shaft.position.y = (length - head) / 2;
      tip.scale.set(head / 0.13, head / 0.13, head / 0.13);
      tip.position.y = length - head / 2;
    },
  };
}

class Labels {
  constructor(parent) {
    this.root = document.createElement('div');
    this.root.setAttribute('aria-hidden', 'true');
    Object.assign(this.root.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden', zIndex: '2' });
    parent.append(this.root);
    this.items = [];
    this.projected = new THREE.Vector3();
    this.viewPoint = new THREE.Vector3();
  }

  add(text, x, y, z, { dx = 0, dy = -24, priority = 50, layer = null, compact = false } = {}) {
    const element = document.createElement('div');
    Object.assign(element.style, {
      position: 'absolute', left: '0', top: '0', visibility: 'hidden', maxWidth: '238px',
      padding: compact ? '3px 6px' : '5px 8px', borderRadius: compact ? '4px' : '5px',
      color: '#4a5549', background: compact ? 'rgba(246,248,241,.87)' : 'rgba(248,249,244,.94)',
      border: '1px solid rgba(95,111,89,.16)', boxShadow: '0 3px 10px rgba(51,65,45,.035)',
      font: `${compact ? '10' : '11'}px/1.25 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif`,
      fontWeight: '500', letterSpacing: '.015em', whiteSpace: 'nowrap', willChange: 'transform',
    });
    element.textContent = text;
    this.root.append(element);
    const item = {
      element, point: new THREE.Vector3(x, y, z), dx, dy, priority, layer, visible: true, width: 0, height: 0,
      text(value) {
        if (element.textContent === value) return;
        element.textContent = value;
        item.width = 0;
      },
    };
    this.items.push(item);
    this.items.sort((a, b) => b.priority - a.priority);
    return item;
  }

  invalidate() { for (const item of this.items) item.width = 0; }

  update(camera, width, height, layers) {
    this.root.style.display = layers.labels ? '' : 'none';
    if (!layers.labels) return;
    const occupied = [];
    for (const item of this.items) {
      const style = item.element.style;
      if (!item.visible || (item.layer && !layers[item.layer])) { style.visibility = 'hidden'; continue; }
      this.viewPoint.copy(item.point).applyMatrix4(camera.matrixWorldInverse);
      this.projected.copy(item.point).project(camera);
      const p = this.projected;
      if (this.viewPoint.z >= -camera.near || ![p.x, p.y, p.z].every(Number.isFinite)
        || p.z < -1 || p.z > 1 || Math.abs(p.x) > 1.08 || Math.abs(p.y) > 1.08) {
        style.visibility = 'hidden';
        continue;
      }
      if (!item.width) {
        item.width = item.element.offsetWidth || 90;
        item.height = item.element.offsetHeight || 25;
      }
      const w = item.width, h = item.height;
      if (w > width - 12 || h > height - 12) { style.visibility = 'hidden'; continue; }
      const anchorX = (p.x * 0.5 + 0.5) * width + item.dx;
      const anchorY = (-p.y * 0.5 + 0.5) * height + item.dy;
      let chosen = null;
      for (const shift of [0, -25, 25, -50, 50, -75, 75]) {
        const rect = {
          x: clamp(anchorX - w / 2, 7, width - w - 7),
          y: clamp(anchorY - h / 2 + shift, 7, height - h - 7), w, h,
        };
        if (!occupied.some(other => rect.x < other.x + other.w + 5 && rect.x + w + 5 > other.x
          && rect.y < other.y + other.h + 4 && rect.y + h + 4 > other.y)) {
          chosen = rect;
          break;
        }
      }
      if (!chosen) { style.visibility = 'hidden'; continue; }
      occupied.push(chosen);
      style.transform = `translate3d(${Math.round(chosen.x)}px,${Math.round(chosen.y)}px,0)`;
      style.visibility = 'visible';
    }
  }

  clear() { for (const item of this.items) item.element.remove(); this.items.length = 0; }
  dispose() { this.clear(); this.root.remove(); }
}

function apparatusShell() {
  const resources = new Resources();
  const group = new THREE.Group();
  const path = new THREE.Group();
  const vectors = new THREE.Group();
  group.add(path, vectors);
  return { resources, group, path, vectors };
}

function buildPendulum(labels) {
  const instrument = apparatusShell();
  const { resources: r, group, path, vectors } = instrument;
  const m = materials(r);
  instrument.bounds = new THREE.Box3(new THREE.Vector3(-2.02, 0, -0.95), new THREE.Vector3(2.02, 3.9, 0.95));
  instrument.direction = new THREE.Vector3(3.7, 2.1, 9.5).normalize();
  instrument.contact = [4.8, 2.5];
  // Fit the actual silhouette, not the empty upper corners of a deep AABB.
  // That distinction matters on the short, wide desktop experiment stage.
  instrument.framingPoints = [];
  for (const x of [-1.96, 1.96]) for (const z of [-0.87, 0.87]) {
    instrument.framingPoints.push(new THREE.Vector3(x, 0.12, z), new THREE.Vector3(x, 0.4, z));
  }
  for (const x of [-1.72, 1.72]) for (const z of [-0.7, 0.7]) instrument.framingPoints.push(new THREE.Vector3(x, 0.005, z));
  for (const x of [-1.55, 1.55]) for (const z of [-0.33, 0.09]) instrument.framingPoints.push(new THREE.Vector3(x, 3.8, z));
  instrument.framingPoints.push(new THREE.Vector3(0, 3.75, 0.25));

  box(r, group, 3.9, 0.22, 1.72, m.graphite, 0, 0.23, 0, true);
  box(r, group, 3.72, 0.05, 1.56, m.black, 0, 0.365, 0, true);
  box(r, group, 3.36, 0.009, 0.012, m.brass, 0, 0.292, 0.866);
  for (const x of [-1.6, 1.6]) for (const z of [-0.58, 0.58]) {
    cylinder(r, group, 0.12, 0.10, m.rubber, x, 0.06, z);
    cylinder(r, group, 0.105, 0.035, m.aluminum, x, 0.127, z);
  }
  for (const x of [-1.73, 1.73]) for (const z of [-0.63, 0.63]) screw(r, group, x, 0.394, z, m.chrome, m.black);
  decal(r, group, 'PHYSICS / 01     SIMPLE PENDULUM', 2.47, 0.12, -0.28, 0.23, 0.862);
  box(r, group, 0.3, 0.09, 0.009, m.brass, 1.5, 0.23, 0.865);
  decal(r, group, 'SI · 2.0', 0.25, 0.067, 1.5, 0.23, 0.872, '#334039');
  const scale = ruler(r, group, 3.28, -1.64, 1.64);
  scale.mesh.position.set(0, 0.393, 0.59);

  for (const x of [-1.4, 1.4]) {
    box(r, group, 0.44, 0.1, 0.51, m.aluminum, x, 0.45, -0.2, true);
    for (const side of [-1, 1]) screw(r, group, x + side * 0.155, 0.508, -0.2, m.chrome, m.black, 0.027);
    cylinder(r, group, 0.067, 3.15, m.chrome, x, 2.055, -0.2);
    cylinder(r, group, 0.108, 0.32, m.aluminum, x, 0.66, -0.2);
    cylinder(r, group, 0.11, 0.085, m.black, x, 0.85, -0.2);
    ring(r, group, 0.109, 0.009, m.chrome, x, 0.8, -0.2, 'y');
    cylinder(r, group, 0.105, 0.18, m.black, x, 3.49, -0.2);
    cylinder(r, group, 0.077, 0.16, m.aluminum, x, 3.7, -0.2);
    ring(r, group, 0.079, 0.012, m.chrome, x, 3.77, -0.2, 'y');
    const joint = cylinder(r, group, 0.13, 0.19, m.aluminum, x, 3.58, -0.16);
    joint.rotation.x = Math.PI / 2;
    frontScrew(r, group, x, 3.58, -0.05, m.chrome, m.black, 0.055);
  }
  const crossbar = cylinder(r, group, 0.078, 3.02, m.chrome, 0, 3.59, -0.2);
  crossbar.rotation.z = Math.PI / 2;
  box(r, group, 0.32, 0.37, 0.14, m.aluminum, 0, 3.49, -0.095, true);
  box(r, group, 0.23, 0.29, 0.03, m.black, 0, 3.47, -0.005, true);
  const hinge = cylinder(r, group, 0.139, 0.11, m.brass, 0, 3.4, 0.055);
  hinge.rotation.x = Math.PI / 2;
  ring(r, group, 0.111, 0.009, m.chrome, 0, 3.4, 0.116);
  frontScrew(r, group, 0, 3.4, 0.126, m.chrome, m.black, 0.047);

  const protractorShape = new THREE.Shape();
  const arcPoint = (radius, angle) => [radius * Math.sin(angle), -radius * Math.cos(angle)];
  for (let i = 0; i <= 60; i++) {
    const [x, y] = arcPoint(0.405, (-36 + i * 1.2) * Math.PI / 180);
    if (i === 0) protractorShape.moveTo(x, y); else protractorShape.lineTo(x, y);
  }
  for (let i = 60; i >= 0; i--) {
    const [x, y] = arcPoint(0.335, (-36 + i * 1.2) * Math.PI / 180);
    protractorShape.lineTo(x, y);
  }
  protractorShape.closePath();
  r.mesh(group, new THREE.ShapeGeometry(protractorShape), m.brass, 0, 3.4, 0.01, false);
  const ticks = [];
  for (let degree = -35; degree <= 35; degree += 5) {
    const theta = degree * Math.PI / 180;
    const a = arcPoint(degree % 10 === 0 ? 0.34 : 0.36, theta);
    const b = arcPoint(0.397, theta);
    ticks.push(a[0], a[1] + 3.4, 0.013, b[0], b[1] + 3.4, 0.013);
  }
  const tickGeometry = r.geometry(new THREE.BufferGeometry());
  tickGeometry.setAttribute('position', new THREE.Float32BufferAttribute(ticks, 3));
  const tickMaterial = r.material(new THREE.LineBasicMaterial({ color: 0x4d5141 }));
  group.add(new THREE.LineSegments(tickGeometry, tickMaterial));

  const bobGroup = new THREE.Group();
  group.add(bobGroup);
  const bob = r.mesh(bobGroup, new THREE.SphereGeometry(1, 64, 40), m.copper);
  const seam = ring(r, bobGroup, 1, 0.006, m.brass, 0, 0, 0, 'y');
  const cap = cylinder(r, bobGroup, 0.052, 0.065, m.brass);
  const eye = ring(r, bobGroup, 0.029, 0.008, m.chrome);
  const cord = cylinder(r, group, 0.008, 1, m.chrome);
  cord.castShadow = false;
  const pivot = new THREE.Vector3(0, 3.4, 0.15);
  const bobPoint = new THREE.Vector3();
  const up = new THREE.Vector3();

  const arcGeometry = r.geometry(new THREE.BufferGeometry());
  const arcPositions = new THREE.BufferAttribute(new Float32Array(97 * 3), 3).setUsage(THREE.DynamicDrawUsage);
  arcGeometry.setAttribute('position', arcPositions);
  const trajectoryMaterial = r.material(new THREE.LineBasicMaterial({ color: 0xa57547, transparent: true, opacity: 0.65 }));
  path.add(new THREE.Line(arcGeometry, trajectoryMaterial));
  const ghostMaterial = r.material(new THREE.MeshPhysicalMaterial({ color: 0xb88d63, metalness: 0.65, roughness: 0.5, transparent: true, opacity: 0.085, depthWrite: false }));
  const ghostGeometry = r.geometry(new THREE.SphereGeometry(1, 32, 20));
  const ghosts = [-1, 1].map(() => r.mesh(path, ghostGeometry, ghostMaterial, 0, 0, 0, false));
  const plumb = dynamicLine(r, path, r.material(new THREE.LineDashedMaterial({ color: 0x77816e, transparent: true, opacity: 0.3, dashSize: 0.045, gapSize: 0.055 })));
  const speed = arrow(r, vectors);
  const lengthLabel = labels.add('', -0.25, 2.45, 0.2, { dx: -44, dy: 0, priority: 80 });
  const massLabel = labels.add('', 0.6, 1.3, 0.18, { dx: 47, dy: 3, priority: 90 });
  const leftLabel = labels.add('', 0, 0, 0, { dy: 24, layer: 'path', compact: true, priority: 30 });
  const rightLabel = labels.add('', 0, 0, 0, { dy: 24, layer: 'path', compact: true, priority: 30 });
  const velocityLabel = labels.add('速度 v', 0, 0, 0, { dy: -18, layer: 'vectors', compact: true, priority: 45 });
  let radius = 0.22;

  instrument.setParameters = p => {
    radius = clamp(0.22 * Math.cbrt(p.mass / 0.5), 0.16, 0.35);
    bob.scale.setScalar(radius);
    seam.scale.setScalar(radius * 0.998);
    cap.position.y = radius + 0.008;
    eye.position.y = radius + 0.059;
    const amplitude = p.angle * Math.PI / 180;
    for (let i = 0; i <= 96; i++) {
      const a = -amplitude + 2 * amplitude * i / 96;
      arcPositions.setXYZ(i, p.length * Math.sin(a), pivot.y - p.length * Math.cos(a), pivot.z - 0.025);
    }
    arcPositions.needsUpdate = true;
    arcGeometry.computeBoundingSphere();
    ghosts.forEach((ghost, index) => {
      ghost.scale.setScalar(radius);
      ghost.position.set((index === 0 ? -1 : 1) * p.length * Math.sin(amplitude), pivot.y - p.length * Math.cos(amplitude), pivot.z);
    });
    plumb.set(0, pivot.y - 0.43, 0.07, 0, pivot.y - p.length - radius - 0.1, 0.07);
    leftLabel.point.copy(ghosts[0].position).add(new THREE.Vector3(-0.09, -radius, 0));
    rightLabel.point.copy(ghosts[1].position).add(new THREE.Vector3(0.09, -radius, 0));
    leftLabel.text(`−${number(p.angle, 0)}°`);
    rightLabel.text(`+${number(p.angle, 0)}°`);
    lengthLabel.text(`摆长 L = ${number(p.length)} m`);
    massLabel.text(`摆球 m = ${number(p.mass)} kg`);
    return false;
  };
  instrument.update = (p, state) => {
    const theta = finite(state.theta, p.angle * Math.PI / 180);
    const x = finite(state.x, p.length * Math.sin(theta));
    const y = finite(state.y, -p.length * Math.cos(theta));
    bobPoint.set(x, pivot.y + y, pivot.z);
    bobGroup.position.copy(bobPoint);
    up.copy(pivot).sub(bobPoint).normalize();
    bobGroup.quaternion.setFromUnitVectors(Y_AXIS, up);
    const cordEnd = bobPoint.clone().addScaledVector(up, radius + 0.08);
    setRod(cord, pivot.x, pivot.y, pivot.z, cordEnd.x, cordEnd.y, cordEnd.z);
    lengthLabel.point.copy(pivot).lerp(bobPoint, 0.48);
    massLabel.point.copy(bobPoint);
    massLabel.point.x += radius;
    const vx = finite(state.velocityX), vy = finite(state.velocityY);
    const magnitude = Math.hypot(vx, vy);
    const arrowLength = Math.min(1.0, magnitude * 0.5);
    speed.set(bobPoint.x, bobPoint.y, bobPoint.z + radius + 0.035, vx, vy, arrowLength);
    velocityLabel.visible = speed.group.visible;
    velocityLabel.point.set(bobPoint.x + (magnitude ? vx / magnitude * arrowLength : 0), bobPoint.y + (magnitude ? vy / magnitude * arrowLength : 0), bobPoint.z + radius);
  };
  return instrument;
}

function helix(r, parent, material) {
  const sections = 336, sides = 8, turns = 14;
  const positions = new Float32Array((sections + 1) * (sides + 1) * 3);
  const normals = new Float32Array(positions.length);
  const indices = [];
  for (let i = 0; i < sections; i++) for (let j = 0; j < sides; j++) {
    const a = i * (sides + 1) + j, b = a + sides + 1;
    indices.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const geometry = r.geometry(new THREE.BufferGeometry());
  const position = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  const normal = new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', position);
  geometry.setAttribute('normal', normal);
  geometry.setIndex(indices);
  const mesh = r.mesh(parent, geometry, material);
  mesh.frustumCulled = false;
  const phase = Array.from({ length: sections + 1 }, (_, i) => [Math.cos(i / sections * turns * Math.PI * 2), Math.sin(i / sections * turns * Math.PI * 2)]);
  const cross = Array.from({ length: sides + 1 }, (_, i) => [Math.cos(i / sides * Math.PI * 2), Math.sin(i / sides * Math.PI * 2)]);
  const radius = 0.185, wire = 0.026;
  return {
    update(start, end, y) {
      const length = Math.max(0.1, end - start);
      const tangentLength = Math.hypot(length, radius * turns * Math.PI * 2);
      const tx = length / tangentLength;
      const bx = -radius * turns * Math.PI * 2 / tangentLength;
      for (let i = 0; i <= sections; i++) {
        const [c, s] = phase[i];
        for (let j = 0; j <= sides; j++) {
          const [ca, sa] = cross[j];
          const nx = sa * bx, ny = ca * c - sa * tx * s, nz = ca * s + sa * tx * c;
          const index = i * (sides + 1) + j;
          position.setXYZ(index, start + length * i / sections + wire * nx, y + radius * c + wire * ny, radius * s + wire * nz);
          normal.setXYZ(index, nx, ny, nz);
        }
      }
      position.needsUpdate = true;
      normal.needsUpdate = true;
    },
  };
}

function buildSpring(labels) {
  const instrument = apparatusShell();
  const { resources: r, group, path, vectors } = instrument;
  const m = materials(r);
  instrument.bounds = new THREE.Box3(new THREE.Vector3(-3.0, 0, -1.02), new THREE.Vector3(3.0, 1.85, 1.02));
  instrument.direction = new THREE.Vector3(3.4, 3.3, 9).normalize();
  instrument.contact = [6.7, 2.7];
  instrument.frameLift = 0.05;
  instrument.framingPoints = [];
  for (const x of [-2.91, 2.91]) for (const z of [-0.84, 0.84]) {
    instrument.framingPoints.push(new THREE.Vector3(x, 0.125, z), new THREE.Vector3(x, 0.38, z));
  }
  for (const x of [-2.55, 2.55]) for (const z of [-0.67, 0.67]) instrument.framingPoints.push(new THREE.Vector3(x, 0.005, z));
  for (const x of [-2.45, -2.2]) for (const z of [-0.42, 0.42]) instrument.framingPoints.push(new THREE.Vector3(x, 1.33, z));
  // Include the whole moving envelope, so oscillation never pumps the camera.
  for (const x of [-0.51, 1.81]) for (const z of [-0.53, 0.53]) instrument.framingPoints.push(new THREE.Vector3(x, 1.51, z));
  box(r, group, 5.8, 0.2, 1.65, m.graphite, 0, 0.23, 0, true);
  box(r, group, 5.58, 0.047, 1.48, m.black, 0, 0.354, 0, true);
  for (const x of [-2.43, 2.43]) for (const z of [-0.56, 0.56]) {
    cylinder(r, group, 0.105, 0.1, m.rubber, x, 0.06, z);
    cylinder(r, group, 0.09, 0.03, m.aluminum, x, 0.125, z);
    screw(r, group, x, 0.384, z, m.chrome, m.black);
  }
  for (const z of [-0.32, 0.32]) {
    const rod = cylinder(r, group, 0.054, 5.35, m.chrome, 0, 0.65, z);
    rod.rotation.z = Math.PI / 2;
    for (const x of [-2.47, 2.47]) {
      box(r, group, 0.2, 0.27, 0.24, m.aluminum, x, 0.51, z, true);
      screw(r, group, x, 0.654, z, m.chrome, m.black, 0.025);
    }
  }
  const scale = ruler(r, group, 5.28, -2.64, 2.64, { major: 0.5, minor: 0.1 });
  scale.mesh.position.set(0, 0.381, 0.665);
  decal(r, group, 'PHYSICS / 02     LINEAR OSCILLATOR', 2.68, 0.115, -0.55, 0.23, 0.829);
  box(r, group, 0.17, 0.92, 0.8, m.aluminum, -2.34, 0.84, 0, true);
  box(r, group, 0.045, 0.7, 0.62, m.black, -2.24, 0.84, 0, true);
  for (const z of [-0.28, 0.28]) screw(r, group, -2.34, 1.308, z, m.chrome, m.black, 0.034);
  const anchor = cylinder(r, group, 0.07, 0.16, m.brass, -2.17, 1.19, 0);
  anchor.rotation.z = Math.PI / 2;
  const stop = cylinder(r, group, 0.105, 0.15, m.rubber, 2.48, 0.91, 0);
  stop.rotation.z = Math.PI / 2;
  box(r, group, 0.12, 0.54, 0.44, m.aluminum, 2.6, 0.65, 0, true);

  const cart = new THREE.Group();
  group.add(cart);
  box(r, cart, 0.99, 0.31, 0.93, m.graphite, 0, 0.93, 0, true);
  box(r, cart, 0.89, 0.065, 0.83, m.aluminum, 0, 1.117, 0, true);
  box(r, cart, 0.77, 0.105, 0.70, m.ivory, 0, 1.193, 0, true);
  const ballast = box(r, cart, 0.6, 0.16, 0.51, m.copper, 0, 1.31, 0, true);
  for (const x of [-0.34, 0.34]) for (const z of [-0.31, 0.31]) screw(r, cart, x, 1.155, z, m.chrome, m.black, 0.023);
  for (const z of [-0.32, 0.32]) {
    const bearing = cylinder(r, cart, 0.115, 0.69, m.aluminum, 0, 0.65, z);
    bearing.rotation.z = Math.PI / 2;
    for (const x of [-0.35, 0.35]) {
      const collar = cylinder(r, cart, 0.118, 0.045, m.black, x, 0.65, z);
      collar.rotation.z = Math.PI / 2;
    }
  }
  const wheels = [];
  for (const x of [-0.29, 0.29]) for (const z of [-0.49, 0.49]) {
    const wheel = new THREE.Group();
    cart.add(wheel);
    wheel.position.set(x, 0.6, z);
    const tire = cylinder(r, wheel, 0.126, 0.075, m.rubber);
    tire.rotation.x = Math.PI / 2;
    const hub = cylinder(r, wheel, 0.084, 0.081, m.aluminum);
    hub.rotation.x = Math.PI / 2;
    frontScrew(r, wheel, 0, 0, z > 0 ? 0.046 : -0.046, m.chrome, m.black, 0.027);
    wheels.push(wheel);
  }
  const hook = cylinder(r, cart, 0.055, 0.16, m.brass, -0.54, 1.19, 0);
  hook.rotation.z = Math.PI / 2;
  decal(r, cart, 'MASS / SI', 0.61, 0.093, 0, 0.94, 0.471);
  const coil = helix(r, group, m.chrome);
  const equilibrium = 0.65;
  const pathMaterial = r.material(new THREE.LineBasicMaterial({ color: 0xa67b47, transparent: true, opacity: 0.65 }));
  const travel = dynamicLine(r, path, pathMaterial);
  const endpointMarks = [-1, 0, 1].map(() => box(r, group, 0.016, 0.012, 0.18, m.brass, 0, 0.39, 0.65));
  const guideTicks = [-1, 0, 1].map(() => dynamicLine(r, path, pathMaterial));
  const speed = arrow(r, vectors);
  const cartLabel = labels.add('', equilibrium, 1.5, 0.12, { dy: -22, priority: 95 });
  const stiffnessLabel = labels.add('', -1, 1.24, 0, { dy: -25, priority: 80 });
  const equilibriumLabel = labels.add('平衡位置  x = 0', equilibrium, 0.39, 0.75, { dy: 29, priority: 75, compact: true });
  const minusLabel = labels.add('', 0, 0.39, 0.75, { dy: 27, priority: 35, compact: true, layer: 'path' });
  const plusLabel = labels.add('', 0, 0.39, 0.75, { dy: 27, priority: 35, compact: true, layer: 'path' });
  const velocityLabel = labels.add('速度 v', 0, 0, 0, { dy: -18, priority: 40, compact: true, layer: 'vectors' });
  let lastX = NaN;
  instrument.setParameters = p => {
    const height = 0.1 + 0.12 * Math.cbrt(p.mass);
    ballast.scale.y = height / 0.16;
    ballast.position.y = 1.246 + height / 2;
    cartLabel.text(`振子 m = ${number(p.mass)} kg`);
    stiffnessLabel.text(`弹簧 k = ${number(p.stiffness, 0)} N/m`);
    travel.set(equilibrium - p.amplitude, 0.4, 0.89, equilibrium + p.amplitude, 0.4, 0.89);
    [-1, 0, 1].forEach((sign, index) => {
      const x = equilibrium + sign * p.amplitude;
      endpointMarks[index].position.x = x;
      guideTicks[index].set(x, 0.4, 0.82, x, 0.4, 0.97);
    });
    minusLabel.point.x = equilibrium - p.amplitude;
    plusLabel.point.x = equilibrium + p.amplitude;
    minusLabel.text(`−A  ${number(-p.amplitude, 2)} m`);
    plusLabel.text(`+A  ${number(p.amplitude, 2)} m`);
    lastX = NaN;
    return false;
  };
  instrument.update = (p, state) => {
    const x = clamp(finite(state.x, p.amplitude), -1.1, 1.1);
    const position = equilibrium + x;
    if (x !== lastX) {
      cart.position.x = position;
      coil.update(-2.08, position - 0.62, 1.005);
      for (const wheel of wheels) wheel.rotation.z = -x / 0.126;
      lastX = x;
    }
    cartLabel.point.x = position;
    cartLabel.point.y = ballast.position.y + 0.16;
    stiffnessLabel.point.x = (-2.08 + position - 0.62) / 2;
    const velocity = finite(state.velocity, finite(state.velocityX));
    const length = Math.min(1.25, Math.abs(velocity) * 0.23);
    speed.set(position, 1.58, 0.14, velocity, 0, length);
    velocityLabel.visible = speed.group.visible;
    velocityLabel.point.set(position + Math.sign(velocity) * length, 1.58, 0.14);
    equilibriumLabel.visible = true;
  };
  return instrument;
}

// Liang–Barsky clipping keeps near-focus rays finite without changing their slopes.
function clippedSegment(ax, ay, bx, by, bounds) {
  if (![ax, ay, bx, by].every(Number.isFinite)) return null;
  const dx = bx - ax, dy = by - ay;
  let start = 0, end = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [ax - bounds.left, bounds.right - ax, ay - bounds.bottom, bounds.top - ay];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-12) { if (q[i] < 0) return null; continue; }
    const ratio = q[i] / p[i];
    if (p[i] < 0) start = Math.max(start, ratio); else end = Math.min(end, ratio);
    if (start > end) return null;
  }
  return [ax + dx * start, ay + dy * start, ax + dx * end, ay + dy * end];
}

function buildLens(labels) {
  const instrument = apparatusShell();
  const { resources: r, group, path, vectors } = instrument;
  const m = materials(r);
  const SCALE = 0.065, AXIS = 1.36, RADIUS = 0.58, RAY_Z = 0.018;
  const SCREEN_HEIGHT = 1.56, PAPER_HEIGHT = 1.38;
  instrument.direction = new THREE.Vector3(-5.4, 1.8, 10).normalize();
  instrument.bounds = new THREE.Box3(new THREE.Vector3(-3.5, 0, -0.95), new THREE.Vector3(3.5, 2.4, 0.95));
  instrument.contact = [7, 2.6];
  instrument.frameLift = 0.045;
  instrument.framingPoints = [];

  const rail = new THREE.Group();
  group.add(rail);
  const base = box(r, rail, 1, 0.2, 1.42, m.graphite, 0, 0.23, 0, true);
  const top = box(r, rail, 1, 0.045, 1.26, m.black, 0, 0.352, 0, true);
  const track = [];
  for (const z of [-0.3, 0.3]) {
    track.push(box(r, rail, 1, 0.115, 0.18, m.aluminum, 0, 0.435, z));
    track.push(box(r, rail, 1, 0.017, 0.045, m.black, 0, 0.499, z));
  }
  const scale = ruler(r, rail, 1, -45, 45, { depth: 0.18, major: 10, minor: 1 });
  scale.mesh.position.set(0, 0.378, 0.565);
  const feet = [];
  for (let i = 0; i < 2; i++) for (const z of [-0.45, 0.45]) {
    const foot = new THREE.Group();
    group.add(foot);
    cylinder(r, foot, 0.105, 0.1, m.rubber, 0, 0.06, z);
    cylinder(r, foot, 0.091, 0.03, m.aluminum, 0, 0.127, z);
    screw(r, foot, 0, 0.383, z, m.chrome, m.black);
    feet.push(foot);
  }
  const nameplate = decal(r, group, 'PHYSICS / 03    OPTICAL BENCH · cm', 2.3, 0.11, -0.5, 0.23, 0.716);

  function carriage(parent, postTop) {
    box(r, parent, 0.53, 0.1, 0.78, m.graphite, 0, 0.565, 0, true);
    box(r, parent, 0.43, 0.036, 0.67, m.aluminum, 0, 0.636, 0, true);
    cylinder(r, parent, 0.079, 0.16, m.black, 0, 0.73, 0);
    const length = Math.max(0.06, postTop - 0.69);
    cylinder(r, parent, 0.035, length, m.chrome, 0, 0.69 + length / 2, 0);
    const knob = cylinder(r, parent, 0.061, 0.095, m.black, 0.24, 0.606, 0.18);
    knob.rotation.z = Math.PI / 2;
    ring(r, parent, 0.062, 0.006, m.aluminum, 0.29, 0.606, 0.18, 'x');
    for (const z of [-0.255, 0.255]) screw(r, parent, -0.14, 0.66, z, m.chrome, m.black, 0.02);
  }

  const object = new THREE.Group();
  group.add(object);
  carriage(object, AXIS - 0.04);
  cylinder(r, object, 0.145, 0.055, m.brass, 0, AXIS - 0.042, 0);
  cylinder(r, object, 0.083, 0.053, m.black, 0, AXIS, 0);
  const wax = cylinder(r, object, 0.056, 1, m.ivory);
  const wick = cylinder(r, object, 0.0045, 0.032, m.black);
  const flameMaterial = r.material(new THREE.MeshBasicMaterial({ color: 0xe6a24c }));
  const flame = r.mesh(object, new THREE.SphereGeometry(1, 24, 20), flameMaterial, 0, 0, 0, false);
  const coreMaterial = r.material(new THREE.MeshBasicMaterial({ color: 0xffecc1 }));
  const flameCore = r.mesh(object, new THREE.SphereGeometry(1, 20, 16), coreMaterial, 0, 0, 0, false);

  const lens = new THREE.Group();
  group.add(lens);
  carriage(lens, AXIS - RADIUS + 0.035);
  box(r, lens, 0.23, 0.09, 0.23, m.black, 0, AXIS - RADIUS - 0.03, 0, true);
  ring(r, lens, RADIUS + 0.018, 0.042, m.aluminum, -0.046, AXIS, 0, 'x');
  ring(r, lens, RADIUS + 0.018, 0.042, m.aluminum, 0.046, AXIS, 0, 'x');
  ring(r, lens, RADIUS - 0.014, 0.013, m.black, -0.072, AXIS, 0, 'x');
  const glassMaterial = r.material(new THREE.MeshPhysicalMaterial({
    color: 0xe0eae2, metalness: 0, roughness: 0.055, transmission: 0.86,
    thickness: 0.16, ior: 1.52, transparent: true, opacity: 0.72, depthWrite: false,
    attenuationColor: new THREE.Color(0xb4c6b8), attenuationDistance: 2.5,
    clearcoat: 1, clearcoatRoughness: 0.06, side: THREE.DoubleSide,
  }));
  const glass = r.mesh(lens, new THREE.SphereGeometry(1, 64, 40), glassMaterial, 0, AXIS, 0, false);
  glass.scale.set(0.105, RADIUS, RADIUS);
  for (const z of [-RADIUS - 0.028, RADIUS + 0.028]) {
    const retainingScrew = cylinder(r, lens, 0.027, 0.045, m.chrome, 0, AXIS, z);
    retainingScrew.rotation.x = Math.PI / 2;
  }
  frontScrew(r, lens, 0.01, AXIS - RADIUS - 0.03, 0.13, m.chrome, m.black, 0.025);

  const screen = new THREE.Group();
  group.add(screen);
  carriage(screen, 0.7);
  const screenFrame = box(r, screen, 0.095, SCREEN_HEIGHT, 1.71, m.aluminum, 0, AXIS, 0, true);
  screenFrame.receiveShadow = false;
  box(r, screen, 0.102, SCREEN_HEIGHT - 0.12, 1.59, m.black, 0, AXIS, 0);
  const { canvas: screenCanvas, context: sc, texture: screenTexture } = canvasTexture(r, 512, 640);
  const screenMaterial = r.material(new THREE.MeshStandardMaterial({ map: screenTexture, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }));
  const screenFace = r.mesh(screen, new THREE.PlaneGeometry(1.54, PAPER_HEIGHT), screenMaterial, -0.056, AXIS, 0, false);
  screenFace.rotation.y = -Math.PI / 2;
  const back = box(r, screen, 0.012, PAPER_HEIGHT, 1.54, m.ivory, 0.058, AXIS, 0);
  back.receiveShadow = false;
  box(r, screen, 0.13, 0.045, 0.24, m.black, 0, AXIS + SCREEN_HEIGHT / 2 + 0.015, 0, true);

  const rayMaterial = r.material(new THREE.LineBasicMaterial({ color: 0xb68035, transparent: true, opacity: 0.88 }));
  const extensionMaterial = r.material(new THREE.LineDashedMaterial({ color: 0xb68035, transparent: true, opacity: 0.52, dashSize: 0.065, gapSize: 0.05 }));
  const incoming = Array.from({ length: 3 }, () => dynamicLine(r, path, rayMaterial));
  const outgoing = Array.from({ length: 3 }, () => dynamicLine(r, path, rayMaterial));
  const extensions = Array.from({ length: 3 }, () => dynamicLine(r, path, extensionMaterial));
  const axis = dynamicLine(r, path, r.material(new THREE.LineDashedMaterial({ color: 0x6e7e69, transparent: true, opacity: 0.3, dashSize: 0.08, gapSize: 0.065 })));
  const rayLabels = [1, 2, 3].map(i => labels.add(String(i), 0, 0, RAY_Z, { dy: -13, priority: 25, compact: true, layer: 'path' }));

  const focalMaterial = r.material(new THREE.MeshStandardMaterial({ color: 0x9e7d44, metalness: 0.45, roughness: 0.45 }));
  const focalPoints = [-2, -1, 1, 2].map(multiplier => {
    const point = new THREE.Group();
    vectors.add(point);
    r.mesh(point, new THREE.SphereGeometry(0.022, 16, 12), focalMaterial, 0, AXIS, RAY_Z, false);
    box(r, point, 0.009, 0.14, 0.009, focalMaterial, 0, AXIS, RAY_Z);
    const text = multiplier === -2 ? '2F' : multiplier === -1 ? 'F' : multiplier === 1 ? 'F′' : '2F′';
    const label = labels.add(text, 0, AXIS, RAY_Z, { dy: 23, layer: 'vectors', compact: true, priority: 40 });
    return { point, label, multiplier };
  });

  const image = new THREE.Group();
  group.add(image);
  const imageWaxMaterial = r.material(new THREE.MeshStandardMaterial({ color: 0xb9a175, transparent: true, opacity: 0.3, depthWrite: false, roughness: 0.58 }));
  const imageFlameMaterial = r.material(new THREE.MeshBasicMaterial({ color: 0xc08b41, transparent: true, opacity: 0.42, depthWrite: false }));
  r.mesh(image, new THREE.CylinderGeometry(1, 1, 0.74, 24), imageWaxMaterial, 0, 0.37, 0, false);
  const imageFlame = r.mesh(image, new THREE.SphereGeometry(1, 24, 16), imageFlameMaterial, 0, 0.9, 0, false);
  imageFlame.scale.set(0.63, 0.1, 0.63);
  const imageSpine = dynamicLine(r, group, r.material(new THREE.LineDashedMaterial({ color: 0x9d7946, transparent: true, opacity: 0.62, dashSize: 0.045, gapSize: 0.035 })));

  const objectLabel = labels.add('', -2, 2.1, 0, { dy: -23, priority: 95 });
  const lensLabel = labels.add('', 0, 0.6, 0.58, { dy: 31, priority: 90 });
  const screenLabel = labels.add('', 2, AXIS + SCREEN_HEIGHT / 2 + 0.03, 0, { dy: -22, priority: 95 });
  const imageLabel = labels.add('', 1, 1, 0, { dx: 18, dy: -24, priority: 70 });
  const statusLabel = labels.add('', 0, AXIS + RADIUS + 0.12, 0, { dy: -21, priority: 80 });
  let railLeft = -3, railRight = 3, railKey = '', opticalKey = '', framingKey = '';
  let rayBounds = { left: -3, right: 3, bottom: 0.5, top: 2.82 };

  function setRay(line, ax, ay, bx, by) {
    const clipped = clippedSegment(ax, ay, bx, by, rayBounds);
    if (!clipped) { line.line.visible = false; return; }
    line.set(clipped[0], clipped[1], RAY_Z, clipped[2], clipped[3], RAY_Z);
  }

  function drawScreen(p, result) {
    const W = screenCanvas.width, H = screenCanvas.height;
    sc.filter = 'none';
    sc.globalAlpha = 1;
    sc.fillStyle = '#f6f4e9';
    sc.fillRect(0, 0, W, H);
    sc.strokeStyle = 'rgba(103,119,96,.17)';
    sc.lineWidth = 1;
    for (let x = 32; x < W; x += 32) for (let y = 32; y < H; y += 32) sc.strokeRect(x, y, 0.65, 0.65);
    sc.strokeStyle = 'rgba(103,119,96,.25)';
    sc.beginPath();
    sc.moveTo(W / 2 - 14, H / 2); sc.lineTo(W / 2 + 14, H / 2);
    sc.moveTo(W / 2, H / 2 - 14); sc.lineTo(W / 2, H / 2 + 14); sc.stroke();
    if (!result.atFocus && result.v !== null && result.v > 0) {
      const defocus = Math.abs(1 - p.d / result.v);
      const pixelsPerWorld = H / PAPER_HEIGHT;
      const height = result.height * SCALE * p.d / result.v * pixelsPerWorld;
      const blur = result.lit ? Math.min(1.5, defocus * 10) : clamp(defocus * RADIUS * pixelsPerWorld * 0.22, 2, 36);
      const imageWidth = clamp(0.056 * p.d / p.u * W / 1.54, 5, 45);
      sc.save();
      sc.beginPath(); sc.rect(9, 9, W - 18, H - 18); sc.clip();
      sc.filter = `blur(${number(blur, 2)}px)`;
      sc.globalAlpha = result.lit ? 0.94 : 0.65 / (1 + defocus);
      sc.translate(W / 2, H / 2);
      sc.fillStyle = '#a9824d';
      const py = -height;
      sc.fillRect(-imageWidth, 0, imageWidth * 2, py * 0.74);
      sc.fillStyle = '#dc9d45';
      sc.beginPath();
      sc.ellipse(0, py * 0.9, imageWidth * 0.65, Math.max(3, Math.abs(py) * 0.1), 0, 0, Math.PI * 2);
      sc.fill();
      sc.fillStyle = '#f4d18b';
      sc.beginPath();
      sc.ellipse(0, py * 0.875, imageWidth * 0.28, Math.max(1.5, Math.abs(py) * 0.047), 0, 0, Math.PI * 2);
      sc.fill();
      sc.restore();
    }
    sc.fillStyle = '#7d8775';
    sc.font = '500 15px ui-monospace, SFMono-Regular, Menlo, monospace';
    sc.textAlign = 'center';
    sc.fillText(result.atFocus || result.v === null || result.v < 0 ? 'NO REAL IMAGE' : result.lit ? 'FOCUS · REAL IMAGE' : 'DEFOCUSED', W / 2, H - 27);
    screenTexture.needsUpdate = true;
  }

  instrument.setParameters = p => {
    const lo = -Math.max(52, Math.ceil((p.u + 8) / 5) * 5, p.f * 2 + 4);
    const hi = Math.max(55, Math.ceil((p.d + 8) / 5) * 5, p.f * 2 + 4);
    const nextRailKey = `${lo}|${hi}`;
    const changed = nextRailKey !== railKey;
    railLeft = lo * SCALE;
    railRight = hi * SCALE;
    if (changed) {
      railKey = nextRailKey;
      const width = railRight - railLeft;
      const center = (railLeft + railRight) / 2;
      base.scale.x = width;
      top.scale.x = width - 0.15;
      base.position.x = top.position.x = center;
      for (const piece of track) { piece.scale.x = width - 0.31; piece.position.x = center; }
      scale.mesh.scale.x = width - 0.28;
      scale.mesh.position.x = center;
      scale.draw(lo + 0.14 / SCALE, hi - 0.14 / SCALE);
      feet.forEach((foot, index) => { foot.position.x = index < 2 ? railLeft + 0.4 : railRight - 0.4; });
      nameplate.position.x = railLeft + 1.35;
      instrument.bounds.min.set(railLeft - 0.08, 0, -0.95);
      instrument.bounds.max.set(railRight + 0.08, 2.4, 0.95);
      instrument.contact = [width + 1.1, 2.5];
      rayBounds = { left: railLeft + 0.03, right: railRight - 0.03, bottom: 0.52, top: 2.32 };
    }
    object.position.x = -p.u * SCALE;
    screen.position.x = p.d * SCALE;
    const height = p.h * SCALE;
    wax.scale.y = height * 0.72;
    wax.position.y = AXIS + height * 0.36 + 0.015;
    wick.position.y = AXIS + height * 0.75;
    flame.position.set(0, AXIS + height * 0.89, 0);
    flame.scale.set(0.026, height * 0.11, 0.023);
    flameCore.position.set(-0.002, AXIS + height * 0.865, 0.012);
    flameCore.scale.set(0.012, height * 0.056, 0.011);
    focalPoints.forEach(({ point, label, multiplier }) => {
      point.position.x = multiplier * p.f * SCALE;
      label.point.x = point.position.x;
    });
    axis.set(railLeft + 0.05, AXIS, RAY_Z, railRight - 0.05, AXIS, RAY_Z);
    objectLabel.point.set(object.position.x, AXIS + height, 0);
    objectLabel.text(`物体 · u = ${number(p.u)} cm`);
    lensLabel.text(`凸透镜 · f = ${number(p.f)} cm`);
    screenLabel.point.x = screen.position.x;
    const nextFramingKey = [lo, hi, p.u, p.d, p.h].join('|');
    const framingChanged = nextFramingKey !== framingKey;
    if (framingChanged) {
      framingKey = nextFramingKey;
      const points = instrument.framingPoints;
      points.length = 0;
      for (const x of [railLeft, railRight]) for (const z of [-0.72, 0.72]) {
        points.push(new THREE.Vector3(x, 0.12, z), new THREE.Vector3(x, 0.38, z));
      }
      for (const x of [railLeft + 0.4, railRight - 0.4]) for (const z of [-0.56, 0.56]) points.push(new THREE.Vector3(x, 0.005, z));
      for (const x of [screen.position.x - 0.065, screen.position.x + 0.065]) {
        for (const y of [AXIS - SCREEN_HEIGHT / 2 - 0.01, AXIS + SCREEN_HEIGHT / 2 + 0.05]) for (const z of [-0.87, 0.87]) points.push(new THREE.Vector3(x, y, z));
      }
      for (const x of [-0.1, 0.1]) for (let i = 0; i < 16; i++) {
        const angle = i / 16 * Math.PI * 2;
        points.push(new THREE.Vector3(x, AXIS + Math.cos(angle) * (RADIUS + 0.07), Math.sin(angle) * (RADIUS + 0.07)));
      }
      for (const z of [-0.15, 0.15]) points.push(new THREE.Vector3(object.position.x, AXIS + height + 0.025, z));
    }
    opticalKey = '';
    return changed || framingChanged;
  };

  instrument.update = (p, state) => {
    const key = [p.u, p.f, p.d, p.h, state.v, state.m, state.height, state.atFocus, state.lit, state.nature].join('|');
    if (key === opticalKey) return;
    opticalKey = key;
    const atFocus = Boolean(state.atFocus) || Math.abs(p.u - p.f) < 0.025;
    const fallbackV = atFocus ? null : p.u * p.f / (p.u - p.f);
    const v = atFocus ? null : Number.isFinite(state.v) ? state.v : fallbackV;
    const magnification = v === null ? null : finite(state.m, -v / p.u);
    const imageHeight = magnification === null ? null : finite(state.height, p.h * magnification);
    const result = { v, height: imageHeight, atFocus, lit: Boolean(state.lit) && v !== null && v > 0 };
    const objectX = -p.u * SCALE, objectY = AXIS + p.h * SCALE;
    // At u = f the focus-parallel construction degenerates. A finite third
    // aperture ray then obeys the same thin-lens equation; all three exit parallel.
    const intercepts = [p.h, 0, atFocus ? -p.h : -p.h * p.f / (p.u - p.f)];
    const slopes = [-p.h / p.f, -p.h / p.u, atFocus ? -p.h / p.f : 0];
    const endX = Math.max(0, Math.min(p.d * SCALE - 0.058, railRight));
    for (let i = 0; i < 3; i++) {
      if (Math.abs(intercepts[i] * SCALE) > RADIUS - 0.008) {
        incoming[i].line.visible = outgoing[i].line.visible = extensions[i].line.visible = false;
        rayLabels[i].visible = false;
        continue;
      }
      const y = AXIS + intercepts[i] * SCALE;
      const slope = slopes[i];
      setRay(incoming[i], objectX, objectY, 0, y);
      setRay(outgoing[i], 0, y, endX, y + slope * endX);
      extensions[i].line.visible = false;
      if (v !== null && v < 0) setRay(extensions[i], 0, y, v * SCALE, AXIS + imageHeight * SCALE);
      rayLabels[i].visible = incoming[i].line.visible && y >= rayBounds.bottom && y <= rayBounds.top;
      const t = [0.48, 0.63, 0.77][i];
      rayLabels[i].point.set(objectX * (1 - t), objectY + (y - objectY) * t, RAY_Z);
    }
    const real = v !== null && v > 0;
    const virtual = v !== null && v < 0;
    const imageX = v === null ? 0 : v * SCALE;
    const imageY = imageHeight === null ? AXIS : AXIS + imageHeight * SCALE;
    const fits = v !== null && Math.abs(v) <= 80 && Number.isFinite(imageX) && Number.isFinite(imageY)
      && imageX > railLeft + 0.08 && imageX < railRight - 0.08
      && imageY > rayBounds.bottom + 0.03 && imageY < rayBounds.top - 0.03;
    const onScreen = real && result.lit;
    image.visible = fits && !onScreen;
    imageSpine.line.visible = fits && !onScreen;
    if (fits) {
      const height = Math.abs(imageHeight * SCALE);
      const width = clamp(0.056 * Math.abs(magnification), 0.018, 0.23);
      image.position.set(imageX, AXIS, 0.052);
      image.rotation.z = imageHeight < 0 ? Math.PI : 0;
      image.scale.set(width, Math.max(0.001, height), width);
      imageWaxMaterial.opacity = virtual ? 0.21 : 0.3;
      imageFlameMaterial.opacity = virtual ? 0.28 : 0.42;
      if (!onScreen) imageSpine.set(imageX, AXIS, 0.077, imageX, imageY, 0.077);
      imageLabel.point.set(imageX, imageY, 0.06);
      imageLabel.text(`${virtual ? '正立虚像' : '倒立实像'} · v = ${number(v)} cm`);
    }
    imageLabel.visible = fits && !atFocus && !onScreen;
    statusLabel.visible = atFocus || !fits;
    if (atFocus) statusLabel.text('物在焦点 · 出射光平行，不成有限像');
    else if (!fits) statusLabel.text(`${virtual ? '虚像' : '实像'}超出视野 · v = ${number(v)} cm`);
    screenLabel.text(`光屏 · ${onScreen ? '清晰实像' : real ? '未合焦' : '无可投屏实像'}`);
    drawScreen(p, result);
  };
  return instrument;
}

function makeStudioEnvironment(renderer) {
  const resources = new Resources();
  const studio = new THREE.Scene();
  studio.background = new THREE.Color(0x92998e);
  const roomMaterial = resources.material(new THREE.MeshBasicMaterial({ color: 0x778070, side: THREE.BackSide }));
  resources.mesh(studio, new THREE.BoxGeometry(24, 20, 24), roomMaterial, 0, 2, 0, false);
  function softbox(w, h, x, y, z, brightness, tint = [1, 1, 1]) {
    const material = resources.material(new THREE.MeshBasicMaterial({
      color: new THREE.Color(brightness * tint[0], brightness * tint[1], brightness * tint[2]),
      side: THREE.DoubleSide, toneMapped: false,
    }));
    const panel = resources.mesh(studio, new THREE.PlaneGeometry(w, h), material, x, y, z, false);
    panel.lookAt(0, 1.4, 0);
  }
  softbox(4, 7, -5, 4.3, 3.8, 5.2, [1, 0.97, 0.9]);
  softbox(7, 5, 0, 8, -0.5, 4.5);
  softbox(1.7, 6, 5.7, 3.2, 2, 5.3);
  softbox(5, 2.8, 1, 4.7, -6.5, 3.5, [0.92, 0.98, 1]);
  softbox(2.2, 4, -1.4, 2, 7, 1.65);
  const generator = new THREE.PMREMGenerator(renderer);
  try {
    return generator.fromScene(studio, 0.035, 0.1, 50, { size: 128 });
  } finally {
    generator.dispose();
    resources.dispose();
    studio.clear();
  }
}

function makeGrid(r, scene) {
  const group = new THREE.Group();
  scene.add(group);
  const background = new THREE.Color(BACKGROUND);
  const ink = new THREE.Color(0x8d9a83);
  for (const major of [false, true]) {
    const positions = [], colors = [];
    const append = (x, z) => {
      positions.push(x, 0.004, z);
      const fade = Math.pow(Math.max(0, 1 - Math.hypot(x, z) / 12), 0.8);
      const color = background.clone().lerp(ink, fade);
      colors.push(color.r, color.g, color.b);
    };
    for (let n = -40; n <= 40; n++) {
      if ((n % 4 === 0) !== major) continue;
      const value = n * 0.25;
      for (let part = -10; part < 10; part++) {
        append(value, part); append(value, part + 1);
        append(part, value); append(part + 1, value);
      }
    }
    const geometry = r.geometry(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const material = r.material(new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: major ? 0.3 : 0.17, depthWrite: false }));
    group.add(new THREE.LineSegments(geometry, material));
  }
  return group;
}

function contactShadow(r, scene) {
  const { context, texture } = canvasTexture(r, 256, 256);
  const gradient = context.createRadialGradient(128, 128, 10, 128, 128, 124);
  gradient.addColorStop(0, 'rgba(47,61,41,.27)');
  gradient.addColorStop(0.4, 'rgba(47,61,41,.17)');
  gradient.addColorStop(0.75, 'rgba(47,61,41,.045)');
  gradient.addColorStop(1, 'rgba(47,61,41,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  texture.needsUpdate = true;
  const material = r.material(new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
  const mesh = r.mesh(scene, new THREE.PlaneGeometry(1, 1), material, 0, 0.007, 0, false);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

/** A local-only renderer. The caller owns simulation time and its RAF loop. */
export function createLabScene(host, { onError = () => {}, onParameter = () => {} } = {}) {
  let renderer, controls, observer, environment, labels, scene, camera, keyLight;
  let apparatus = null, kind = null, lastParameterKey = '', lastSnapshot = null;
  let width = 1, height = 1, view = 'perspective', disposed = false, contextLost = false, failed = false;
  let defaultHalfHeight = 2.6, defaultDistance = 10, framingReady = false;
  let lastError = '', shaderError = false;
  const resources = new Resources();
  const originalPosition = host?.style?.position;
  let positionedHost = false;
  const root = document.createElement('div');
  Object.assign(root.style, { position: 'absolute', inset: '0', overflow: 'hidden', background: '#e9ede6', isolation: 'isolate' });
  root.className = 'lab-scene-surface';
  const errorNotice = document.createElement('div');
  Object.assign(errorNotice.style, {
    display: 'none', position: 'absolute', inset: '0', alignItems: 'center', justifyContent: 'center',
    padding: '28px', color: '#65705e', background: '#e9ede6', font: '13px/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif',
    textAlign: 'center', zIndex: '5',
  });
  root.append(errorNotice);
  let grid, contact;
  const perspective = new THREE.PerspectiveCamera(35, 1, 0.05, 150);
  const front = new THREE.OrthographicCamera(-5, 5, 3, -3, 0.05, 150);
  const savedPerspectiveDirection = new THREE.Vector3(3.7, 2.1, 9.5).normalize();
  const frameCenter = new THREE.Vector3(0, 1.85, 0);
  const previousFrameCenter = new THREE.Vector3();
  const cameraDirection = new THREE.Vector3();
  const right = new THREE.Vector3(), up = new THREE.Vector3(), relative = new THREE.Vector3();

  function report(message) {
    if (disposed || message === lastError) return;
    lastError = message;
    errorNotice.textContent = message;
    errorNotice.style.display = 'flex';
    try { if (typeof onError === 'function') onError(message); } catch { /* Error UI must not break cleanup. */ }
  }

  function installControls(target) {
    controls?.dispose();
    controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(target);
    controls.enableDamping = true;
    controls.dampingFactor = 0.085;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.enableRotate = view === 'perspective';
    controls.minDistance = 2.7;
    controls.maxDistance = 55;
    controls.minZoom = 0.3;
    controls.maxZoom = 3.8;
    controls.minPolarAngle = view === 'front' ? 0 : 0.2;
    controls.maxPolarAngle = view === 'front' ? Math.PI : Math.PI / 2 - 0.015;
    controls.rotateSpeed = 0.72;
    controls.zoomSpeed = 0.85;
    controls.panSpeed = 0.7;
    controls.mouseButtons.LEFT = view === 'front' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    controls.touches.ONE = view === 'front' ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
    controls.update();
  }

  function visibleHalfHeight() {
    if (!controls || !camera) return defaultHalfHeight;
    return camera.isPerspectiveCamera
      ? camera.position.distanceTo(controls.target) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
      : (camera.top - camera.bottom) / (2 * camera.zoom);
  }

  function frame(preserve = false, forceDirection = null) {
    if (!apparatus || !controls) return;
    const zoomRatio = preserve && framingReady ? clamp(visibleHalfHeight() / defaultHalfHeight, 0.35, 3.2) : 1;
    const pan = preserve && framingReady ? controls.target.clone().sub(previousFrameCenter) : new THREE.Vector3();
    const bounds = apparatus.bounds;
    bounds.getCenter(frameCenter);
    if (view === 'front') cameraDirection.set(0, 0, 1);
    else if (forceDirection) cameraDirection.copy(forceDirection);
    else if (preserve && framingReady) cameraDirection.copy(camera.position).sub(controls.target).normalize();
    else cameraDirection.copy(apparatus.direction);
    if (view === 'perspective') savedPerspectiveDirection.copy(cameraDirection);
    right.crossVectors(Y_AXIS, cameraDirection).normalize();
    up.crossVectors(cameraDirection, right).normalize();
    const tangent = Math.tan(THREE.MathUtils.degToRad(perspective.fov / 2));
    const aspect = width / height;
    let distance = 0, halfHeight = 0;
    if (apparatus.framingPoints) {
      const ty = tangent * 0.85, tx = tangent * aspect * 0.9;
      let upperX = -Infinity, lowerX = Infinity, upperY = -Infinity, lowerY = Infinity;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, nearZ = 0;
      for (const point of apparatus.framingPoints) {
        relative.copy(point).sub(frameCenter);
        const x = relative.dot(right), y = relative.dot(up), z = relative.dot(cameraDirection);
        upperX = Math.max(upperX, x + tx * z);
        lowerX = Math.min(lowerX, x - tx * z);
        upperY = Math.max(upperY, y + ty * z);
        lowerY = Math.min(lowerY, y - ty * z);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        nearZ = Math.max(nearZ, z);
      }
      if (view === 'front') {
        halfHeight = Math.max((maxY - minY) / (2 * 0.85), (maxX - minX) / (2 * aspect * 0.9));
        frameCenter.addScaledVector(right, (minX + maxX) / 2).addScaledVector(up, (minY + maxY) / 2);
      } else {
        distance = Math.max((upperX - lowerX) / (2 * tx), (upperY - lowerY) / (2 * ty), nearZ + 1);
        frameCenter.addScaledVector(right, (upperX + lowerX) / 2).addScaledVector(up, (upperY + lowerY) / 2);
      }
    } else {
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        relative.set(x, y, z).sub(frameCenter);
        const xx = Math.abs(relative.dot(right)), yy = Math.abs(relative.dot(up)), zz = relative.dot(cameraDirection);
        distance = Math.max(distance, zz + xx / (tangent * aspect * 0.88), zz + yy / (tangent * 0.81));
        halfHeight = Math.max(halfHeight, yy / 0.81, xx / (aspect * 0.88));
      }
    }
    defaultDistance = Math.max(4, distance);
    defaultHalfHeight = view === 'front' ? Math.max(0.8, halfHeight) : defaultDistance * tangent;
    if (apparatus.frameLift) frameCenter.addScaledVector(up, -defaultHalfHeight * apparatus.frameLift);
    controls.target.copy(frameCenter).add(pan);
    if (view === 'front') {
      camera.left = -defaultHalfHeight * aspect;
      camera.right = defaultHalfHeight * aspect;
      camera.top = defaultHalfHeight;
      camera.bottom = -defaultHalfHeight;
      camera.zoom = 1 / zoomRatio;
      camera.position.copy(controls.target).addScaledVector(cameraDirection, 25);
    } else {
      camera.aspect = aspect;
      camera.zoom = 1;
      camera.position.copy(controls.target).addScaledVector(cameraDirection, defaultDistance * zoomRatio);
    }
    camera.updateProjectionMatrix();
    camera.lookAt(controls.target);
    controls.update();
    previousFrameCenter.copy(frameCenter);
    framingReady = true;
  }

  function draw() {
    if (disposed || contextLost || failed || !renderer || width < 2 || height < 2) return;
    controls.update();
    camera.updateMatrixWorld();
    renderer.render(scene, camera);
    if (shaderError) throw new Error('WebGL 材质编译失败。');
    if (lastSnapshot) labels.update(camera, width, height, {
      grid: lastSnapshot.layers?.grid !== false,
      path: lastSnapshot.layers?.path !== false,
      vectors: lastSnapshot.layers?.vectors === true,
      labels: lastSnapshot.layers?.labels !== false,
    });
  }

  function resize() {
    if (disposed || !renderer) return;
    const nextWidth = Math.max(1, Math.round(host.clientWidth));
    const nextHeight = Math.max(1, Math.round(host.clientHeight));
    const ratio = Math.min(finite(window.devicePixelRatio, 1), 1.75);
    if (nextWidth === width && nextHeight === height && renderer.getPixelRatio() === ratio) return;
    width = nextWidth;
    height = nextHeight;
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    perspective.aspect = width / height;
    perspective.updateProjectionMatrix();
    if (apparatus) frame(true);
    labels?.invalidate();
    if (apparatus && !contextLost && !failed) {
      try { draw(); } catch { failed = true; report('三维画面缩放失败，请刷新页面后重试。'); }
    }
  }

  function lost(event) {
    event.preventDefault();
    if (disposed) return;
    contextLost = true;
    report('3D 画面暂时中断：WebGL 上下文已丢失，正在等待浏览器恢复。');
  }

  function restored() {
    if (disposed) return;
    try {
      environment?.dispose();
      environment = makeStudioEnvironment(renderer);
      scene.environment = environment.texture;
      contextLost = false;
      failed = false;
      shaderError = false;
      lastError = '';
      errorNotice.style.display = 'none';
      if (lastSnapshot) render(lastSnapshot);
    } catch {
      failed = true;
      report('3D 画面未能恢复，请刷新页面后重试。');
    }
  }

  const grabbing = () => { if (renderer) renderer.domElement.style.cursor = 'grabbing'; };
  const released = () => { if (renderer) renderer.domElement.style.cursor = view === 'front' ? 'move' : 'grab'; };

  function dispose() {
    if (disposed) return;
    disposed = true;
    observer?.disconnect();
    controls?.dispose();
    if (renderer) {
      const canvas = renderer.domElement;
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
      canvas.removeEventListener('pointerdown', grabbing);
      canvas.removeEventListener('pointerup', released);
      canvas.removeEventListener('pointercancel', released);
      canvas.removeEventListener('lostpointercapture', released);
    }
    labels?.dispose();
    if (apparatus) { scene?.remove(apparatus.group); apparatus.resources.dispose(); apparatus = null; }
    if (scene) { scene.environment = null; scene.clear(); }
    keyLight?.shadow.dispose();
    environment?.dispose();
    environment = null;
    resources.dispose();
    if (renderer) {
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    }
    root.remove();
    if (positionedHost && host.style.position === 'relative') host.style.position = originalPosition;
    lastSnapshot = null;
  }

  try {
    if (!host || typeof host.append !== 'function') throw new Error('缺少 3D 实验容器。');
    if (getComputedStyle(host).position === 'static') { host.style.position = 'relative'; positionedHost = true; }
    host.append(root);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.07;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(BACKGROUND, 1);
    renderer.debug.onShaderError = () => { shaderError = true; };
    const canvas = renderer.domElement;
    canvas.setAttribute('aria-label', '可拖动旋转、滚轮缩放的三维物理实验');
    canvas.setAttribute('role', 'img');
    Object.assign(canvas.style, { display: 'block', position: 'absolute', inset: '0', width: '100%', height: '100%', touchAction: 'none', cursor: 'grab' });
    root.prepend(canvas);
    canvas.addEventListener('webglcontextlost', lost, false);
    canvas.addEventListener('webglcontextrestored', restored, false);
    canvas.addEventListener('pointerdown', grabbing);
    canvas.addEventListener('pointerup', released);
    canvas.addEventListener('pointercancel', released);
    canvas.addEventListener('lostpointercapture', released);
    scene = new THREE.Scene();
    scene.background = new THREE.Color(BACKGROUND);
    scene.fog = new THREE.Fog(BACKGROUND, 22, 65);
    environment = makeStudioEnvironment(renderer);
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.8;
    labels = new Labels(root);
    scene.add(new THREE.HemisphereLight(0xf9fff5, 0xb7b4a0, 1.75));
    keyLight = new THREE.DirectionalLight(0xfff6e5, 3.2);
    keyLight.position.set(-4.5, 8, 5);
    keyLight.target.position.set(0, 1, 0);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    Object.assign(keyLight.shadow.camera, { left: -9, right: 9, top: 7, bottom: -6, near: 0.1, far: 25 });
    keyLight.shadow.bias = -0.00015;
    keyLight.shadow.normalBias = 0.018;
    keyLight.shadow.radius = 3;
    scene.add(keyLight, keyLight.target);
    const fill = new THREE.DirectionalLight(0xf1f7ee, 0.8);
    fill.position.set(5, 4, 6);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 1.6);
    rim.position.set(3, 5, -5);
    scene.add(rim);
    const floorMaterial = resources.material(new THREE.MeshStandardMaterial({ color: BACKGROUND, roughness: 0.91, metalness: 0 }));
    const floor = resources.mesh(scene, new THREE.PlaneGeometry(180, 180), floorMaterial, 0, -0.006, 0, false);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    grid = makeGrid(resources, scene);
    contact = contactShadow(resources, scene);
    camera = perspective;
    camera.position.set(4, 4, 10);
    installControls(frameCenter);
    resize();
    observer = new ResizeObserver(resize);
    observer.observe(host);
    draw();
  } catch (cause) {
    const message = '无法启动三维实验：浏览器未能建立可用的 WebGL 画面，请开启硬件加速后重试。';
    report(message);
    dispose();
    throw new Error(message, { cause });
  }

  function render(snapshot) {
    if (disposed || !snapshot || failed) return;
    try {
      const nextKind = Object.hasOwn(DEFAULTS, snapshot.kind) ? snapshot.kind : 'pendulum';
      const p = parameters(nextKind, snapshot.params);
      const parameterKey = Object.values(p).join('|');
      const switched = nextKind !== kind;
      lastSnapshot = snapshot;
      if (switched) {
        if (apparatus) {
          scene.remove(apparatus.group);
          apparatus.resources.dispose();
        }
        labels.clear();
        apparatus = nextKind === 'pendulum' ? buildPendulum(labels) : nextKind === 'spring' ? buildSpring(labels) : buildLens(labels);
        kind = nextKind;
        apparatus.group.name = `physics-lab-${kind}`;
        scene.add(apparatus.group);
        lastParameterKey = '';
        framingReady = false;
      }
      if (parameterKey !== lastParameterKey) {
        const framingChanged = apparatus.setParameters(p);
        lastParameterKey = parameterKey;
        contact.scale.set(apparatus.contact[0], apparatus.contact[1], 1);
        contact.position.x = (apparatus.bounds.min.x + apparatus.bounds.max.x) / 2;
        if (switched || !framingReady) frame(false);
        else if (framingChanged) frame(true);
      }
      apparatus.path.visible = snapshot.layers?.path !== false;
      apparatus.vectors.visible = snapshot.layers?.vectors === true;
      grid.visible = snapshot.layers?.grid !== false;
      apparatus.update(p, snapshot.state || {});
      if (!contextLost) draw();
    } catch {
      failed = true;
      report('三维实验暂时无法绘制，请刷新页面后重试。');
    }
  }

  function setView(mode) {
    if (disposed || failed || !['perspective', 'front'].includes(mode) || mode === view) return;
    const target = controls.target.clone();
    const scale = framingReady ? clamp(visibleHalfHeight() / defaultHalfHeight, 0.35, 3.2) : 1;
    if (view === 'perspective') savedPerspectiveDirection.copy(camera.position).sub(target).normalize();
    view = mode;
    camera = mode === 'front' ? front : perspective;
    installControls(target);
    framingReady = false;
    frame(false, mode === 'perspective' ? savedPerspectiveDirection : null);
    if (apparatus) {
      // Preserve the user's useful zoom and pan while changing projection.
      const offset = target.sub(previousFrameCenter);
      controls.target.add(offset);
      camera.position.add(offset);
      if (mode === 'front') camera.zoom = 1 / scale;
      else camera.position.copy(controls.target).addScaledVector(savedPerspectiveDirection, defaultDistance * scale);
      camera.updateProjectionMatrix();
      controls.update();
    }
    released();
    try { draw(); } catch { failed = true; report('三维视角切换失败，请刷新页面后重试。'); }
  }

  function home() {
    if (disposed || failed) return;
    framingReady = false;
    installControls(apparatus ? apparatus.bounds.getCenter(new THREE.Vector3()) : frameCenter);
    frame(false);
    try { draw(); } catch { failed = true; report('三维视角暂时无法恢复，请刷新页面后重试。'); }
  }

  function getDiagnostics() {
    return {
      kind, view, disposed, contextLost, error: lastError || null,
      camera: { type: camera?.type || null, position: camera?.position.toArray() || [], target: controls?.target.toArray() || [], zoom: camera?.zoom || 1 },
      geometries: renderer?.info.memory.geometries || 0,
      textures: renderer?.info.memory.textures || 0,
      drawCalls: renderer?.info.render.calls || 0,
      triangles: renderer?.info.render.triangles || 0,
      size: { width, height, pixelRatio: renderer?.getPixelRatio() || 1 },
    };
  }

  // Parameter changes intentionally remain in the caller's simulation model.
  // Orbit gestures never mutate it; onParameter is reserved for optional picking.
  void onParameter;
  return { render, setView, home, getDiagnostics, dispose };
}
