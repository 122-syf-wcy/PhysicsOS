/** Optical image geometry is checked against the engine at two lens configurations. */
import { expect } from '@playwright/test'
export async function verifyAuthoredOptics({ page, card, frame, latestSnapshot, authoredPaint, geometryOf, canonical, shot, check, writeEvidence }) {
  await card().locator('[data-question-code-status]').scrollIntoViewIfNeeded()
  const parameters = snapshot => snapshot.inspector.flatMap(section => section.parameters ?? [])
  const value = (snapshot, id) => parameters(snapshot).find(item => item.id === id)?.value
  const imageDistance = snapshot => snapshot.view.opticalImages[0].at.x - snapshot.view.opticalElements[0].at.x
  const original = await latestSnapshot()
  expect(original.domain).toBe('optics')
  expect(value(original, 'object-distance')).toBe(30)
  expect(value(original, 'focal-length')).toBe(10)
  expect(value(original, 'object-height')).toBe(4)
  expect(Math.abs(original.view.opticalImages[0].height)).toBeCloseTo(2, 6)
  expect(imageDistance(original)).toBeCloseTo(15, 6)
  expect(original.view.opticalRays.length).toBeGreaterThanOrEqual(2)
  expect(original.clock.total).toBe(0)
  await expect.poll(async () => {
    const paint = await authoredPaint(frame)
    return paint.canvas.some(c => c.opaquePixels > 0 && c.distinctColors > 8) || paint.svg.some(svg => svg.primitives > 3)
  }).toBe(true)
  const before = await authoredPaint(frame)
  await shot('optics-original')
  const input = card().locator('[data-question-code-controls] label').filter({ hasText: '物距' }).locator('input[type="number"]')
  await input.fill('15'); await input.blur()
  await expect.poll(async () => value(await latestSnapshot(), 'object-distance')).toBe(15)
  await expect.poll(async () => imageDistance(await latestSnapshot())).toBeCloseTo(30, 6)
  await expect.poll(async () => canonical(geometryOf(await authoredPaint(frame)))).not.toBe(canonical(geometryOf(before)))
  const changed = await latestSnapshot(), changedPaint = await authoredPaint(frame)
  expect(changed.view.opticalImages[0].nature).toBe('real')
  await shot('optics-changed-distance')
  await card().getByRole('button', { name: '恢复原题', exact: true }).click()
  await expect.poll(async () => value(await latestSnapshot(), 'object-distance')).toBe(30)
  await expect.poll(async () => imageDistance(await latestSnapshot())).toBeCloseTo(15, 6)
  await expect.poll(async () => canonical(geometryOf(await authoredPaint(frame)))).toBe(canonical(geometryOf(before)))
  await page.setViewportSize({ width: 375, height: 812 })
  await card().locator('[data-question-code-status]').scrollIntoViewIfNeeded()
  await expect.poll(() => card().evaluate(node => node.getBoundingClientRect().x)).toBeGreaterThanOrEqual(0)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(frame.locator('canvas, svg').first()).toBeVisible()
  await expect.poll(() => frame.locator('canvas').evaluateAll(nodes => nodes.every(node => {
    const b = node.getBoundingClientRect(), scale = node.width / b.width
    return b.x >= -1 && b.right <= innerWidth + 1 && Math.abs(node.height / b.height - scale) < 0.02
  }))).toBe(true)
  await shot('optics-mobile')
  const mobile = await authoredPaint(frame)
  await page.setViewportSize({ width: 1440, height: 1080 })
  await card().locator('[data-question-code-status]').scrollIntoViewIfNeeded()
  await expect.poll(() => frame.locator('canvas').evaluateAll(nodes => nodes.every(node => Math.abs(node.width / node.clientWidth - node.height / node.clientHeight) < 0.02))).toBe(true)
  const frames = [{ name: 'u30', snapshot: original, paint: before }, { name: 'u15', snapshot: changed, paint: changedPaint }]
  await writeEvidence('optics-engine-frames.json', frames)
  check('engine optical image moves v15→v30; authored geometry changes and restores exactly, with visible mobile scene', { objectDistances: [30, 15], imageDistances: [15, 30], mobileWidth: mobile.viewport.width })
  return { liveFrames: frames, exploration: { mobile, originalImageDistance: 15, changedImageDistance: 30 } }
}
