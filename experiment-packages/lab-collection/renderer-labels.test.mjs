import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

// Run the real paint path. Only the browser/WebGL boundary is replaced; label
// projection, placement and emitted DOM all remain production behavior.
const source = (await readFile(new URL('./src/renderer.js', import.meta.url), 'utf8'))
  .replace(/^import .*\n/gm, '').replace(/^export /gm, '').replace(/import\.meta\.url/g, JSON.stringify(import.meta.url))
const chain = () => ({ set() { return this }, normalize() { return this }, multiplyScalar() { return this } })
function paintLabels(labels, width = 390, height = 220) {
  const element = tag => ({ tag, style: {}, dataset: {}, children: [], append(...nodes) { this.children.push(...nodes) }, setAttribute(name, value) { this[name] = value } })
  const layer = { replaceChildren(fragment) { this.children = fragment.children } }
  const { paint, setState } = runInNewContext(`${source}\n({ paint, setState: value => { state = value } })`, {
    document: { createElement: element, createElementNS: (_, tag) => element(tag), createDocumentFragment: () => element('fragment') },
    fitCameraToBox() {},
    drawMechanics() {}, drawOptics() {}, drawWaves() {}, drawMatter() {}, drawCircuits() {}, drawFields() {},
  })
  setState({
    renderer: { getContext: () => ({ isContextLost: () => false }), getPixelRatio: () => 1, domElement: { width, height, dataset: {} }, render() {}, info: { render: { calls: 0, triangles: 0 } } },
    camera: { position: chain(), lookAt() {} }, scene: {}, world: { updateMatrixWorld() {} },
    host: { clientWidth: width, clientHeight: height }, span: { x: 4, y: 4, z: 1 }, yaw: 0, pitch: 0,
    measure: { measureText: text => ({ width: text.length * 7 }) }, labels: layer,
    kit: { group: { matrixWorld: {} }, labels: labels.map(label => ({
      size: 11, color: '#111', priority: 3, ...label,
      at: { clone() { return this }, applyMatrix4() { return this }, project() { return { x: label.x / width * 2 - 1, y: 1 - label.y / height * 2, z: 0 } } },
    })) },
  })
  assert.equal(paint(), true)
  return layer.children
}
function boxes(nodes) {
  return nodes.filter(node => node.tag === 'span').map(node => {
    const css = Object.fromEntries(node.style.cssText.split(';').filter(Boolean).map(rule => rule.split(':')))
    const width = parseFloat(css.width ?? css['max-width'])
    return { text: node.textContent, x: parseFloat(css.left) - width / 2, y: parseFloat(css.top), width, height: parseFloat(css.height ?? '23') }
  })
}
function assertReadable(placed, width, height) {
  for (const box of placed) {
    assert.ok(box.x >= 3 && box.x + box.width <= width - 3, `${box.text} escapes horizontally`)
    assert.ok(box.y >= 3 && box.y + box.height <= height - 3, `${box.text} escapes vertically`)
  }
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    const a = placed[i], b = placed[j]
    assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, `${a.text} overlaps ${b.text}`)
  }
}
const forces = ['F合', 'a', 'mg', 'N', 'f', 'v'].map(text => ({ text, tag: text, x: 195, y: 110 }))

test('all six coincident force labels stay readable on a phone canvas', () => {
  const nodes = paintLabels(forces)
  const placed = boxes(nodes)
  assert.equal(placed.length, 6)
  assertReadable(placed, 390, 220)
  const leaders = nodes.filter(node => node.tag === 'svg').flatMap(node => node.children)
  assert.ok(leaders.length > 0, 'displaced labels retain a leader to their real arrow tip')
  for (const line of leaders) {
    assert.equal(Number(line.x1), 195)
    assert.equal(Number(line.y1), 110)
    assert.ok(Number(line.x2) >= 4 && Number(line.x2) <= 386)
    assert.ok(Number(line.y2) >= 4 && Number(line.y2) <= 216)
  }
})

test('labels near each viewport edge move inward without changing their anchor', () => {
  const labels = [{ text: 'N', x: 2, y: 2 }, { text: 'mg', x: 388, y: 218 }, { text: 'F合', x: 388, y: 2 }, { text: 'a', x: 2, y: 218 }]
  const placed = boxes(paintLabels(labels))
  assert.equal(placed.length, 4)
  assertReadable(placed, 390, 220)
})

test('equal-priority label placement is stable when observation order changes', () => {
  const sorted = labels => boxes(paintLabels(labels)).sort((a, b) => a.text.localeCompare(b.text))
  assert.deepEqual(sorted(forces), sorted([...forces].reverse()))
})

test('offscreen labels stay hidden and important forces receive space first', () => {
  const labels = [
    { text: 'outside', x: -30, y: 50 },
    ...Array.from({ length: 22 }, (_, i) => ({ text: `quiet${i}`, tag: `quiet${i}`, priority: 0, x: 80 + i % 6 * 38, y: 30 + Math.floor(i / 6) * 40 })),
    ...forces,
  ]
  const placed = boxes(paintLabels(labels))
  for (const force of forces) assert.ok(placed.some(label => label.text === force.text), `${force.text} must survive decorative labels`)
  assert.ok(!placed.some(label => label.text === 'outside'))
  assertReadable(placed, 390, 220)
})
