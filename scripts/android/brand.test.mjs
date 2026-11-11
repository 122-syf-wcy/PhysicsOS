import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import test from 'node:test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const res = path.join(root, 'apps/android/app/src/main/res')
const read = relative => readFileSync(path.join(res, relative))
function png(bytes) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  let width, height, stride
  const chunks = []
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset), kind = bytes.toString('ascii', offset + 4, offset + 8)
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4)
      assert.equal(data[8], 8); assert.equal(data[9], 6, 'icons must be 8-bit RGBA, not a flattened background')
      assert.equal(data[12], 0); stride = width * 4
    }
    if (kind === 'IDAT') chunks.push(data)
    offset += length + 12
  }
  const encoded = inflateSync(Buffer.concat(chunks)), pixels = Buffer.alloc(stride * height)
  let source = 0
  const paeth = (a, b, c) => {
    const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c)
    return da <= db && da <= dc ? a : db <= dc ? b : c
  }
  for (let row = 0; row < height; row++) {
    const filter = encoded[source++]
    assert.ok(filter <= 4)
    for (let column = 0; column < stride; column++) {
      const index = row * stride + column
      const a = column >= 4 ? pixels[index - 4] : 0, b = row ? pixels[index - stride] : 0, c = row && column >= 4 ? pixels[index - stride - 4] : 0
      const prediction = [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter]
      pixels[index] = (encoded[source++] + prediction) & 255
    }
  }
  return { width, height, pixels }
}

test('in-app official brand is byte-identical, not a recolored or generated replacement', () => {
  assert.deepEqual(read('drawable-nodpi/ic_physicsos_brand.png'), readFileSync(path.join(root, 'overlays/harness/files/apps/web/public/physicsos/website/assets/logo.png')))
})

test('generated launcher foreground has transparency and stays inside adaptive icon safe margins', () => {
  const { width, height, pixels } = png(read('drawable-nodpi/ic_launcher_art.png'))
  assert.equal(width, 432); assert.equal(height, 432)
  let opaque = 0
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const alpha = pixels[(y * width + x) * 4 + 3]
    if (alpha > 32) { opaque++; assert.ok(x >= 80 && x < 352 && y >= 80 && y < 352) }
  }
  assert.ok(opaque > 15_000)
})

test('notification icons use a genuine white alpha mask at every Android density', () => {
  for (const [density, size] of [['mdpi', 24], ['hdpi', 36], ['xhdpi', 48], ['xxhdpi', 72], ['xxxhdpi', 96]]) {
    const { width, height, pixels } = png(read(`drawable-${density}/ic_stat_physicsos.png`))
    assert.equal(width, size); assert.equal(height, size)
    let visible = 0, empty = 0
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] > 0) { assert.deepEqual([...pixels.subarray(index, index + 3)], [255, 255, 255]); visible++ }
      else empty++
    }
    assert.ok(visible > size * size * 0.2 && empty > size * size * 0.4)
  }
})

test('round, adaptive, and themed launchers use the new assets consistently', () => {
  for (const configuration of ['mipmap-anydpi', 'mipmap-anydpi-v33']) for (const name of ['ic_launcher', 'ic_launcher_round']) {
    const source = read(`${configuration}/${name}.xml`).toString()
    assert.match(source, /foreground android:drawable="@drawable\/ic_launcher_art"/)
    assert.match(source, /monochrome android:drawable="@drawable\/ic_launcher_monochrome"/)
  }
})
