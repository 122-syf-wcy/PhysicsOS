import { describe, expect, it } from 'vitest'
import { fitWorkbenchFloat, layoutWorkbenchPanels, readWorkbenchRect, workbenchSafeRect, type WorkbenchPanelRequest } from '../src/client/workbench-geometry.ts'

const graph: WorkbenchPanelRequest = { id: 'graph', placement: 'top-right', width: 400, height: 310 }
const params: WorkbenchPanelRequest = { id: 'params', placement: 'bottom-right', width: 310, height: 210 }
const intersects = (a: ReturnType<typeof workbenchSafeRect>, b: ReturnType<typeof workbenchSafeRect>) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

function assertInside(rect: ReturnType<typeof workbenchSafeRect>, bounds: ReturnType<typeof workbenchSafeRect>) {
  expect(rect.x).toBeGreaterThanOrEqual(bounds.x)
  expect(rect.y).toBeGreaterThanOrEqual(bounds.y)
  expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.x + bounds.width)
  expect(rect.y + rect.height).toBeLessThanOrEqual(bounds.y + bounds.height)
}

describe('workbench safe geometry', () => {
  it('uses measured scene edges, including browser zoom and a visual keyboard viewport', () => {
    const scene = { x: 82, y: 154, width: 1278, height: 534 }
    expect(workbenchSafeRect(scene, { x: 0, y: 0, width: 1360, height: 768 }))
      .toEqual({ x: 94, y: 166, width: 1254, height: 510 })
    const keyboard = workbenchSafeRect({ x: 0, y: 140, width: 390, height: 540 }, { x: 0, y: 80, width: 390, height: 340 })
    expect(keyboard.y + keyboard.height).toBe(408)
    expect(keyboard.y).toBe(152)
    expect(workbenchSafeRect({ x: 0, y: 900, width: 320, height: 300 }, { x: 0, y: 0, width: 320, height: 500 }).height).toBe(0)
  })

  it.each([1, 20, 40, 50, 64])('keeps real visual-viewport space reachable when only %i pixels remain', height => {
    const scene = { x: 0, y: 140, width: 390, height: 500 }
    const viewport = { x: 0, y: 140, width: 390, height }
    const bounds = workbenchSafeRect(scene, viewport)
    expect(bounds.height).toBe(Math.min(height, Math.max(40, height - 24)))
    const layout = layoutWorkbenchPanels(bounds, [graph, params], 'params')
    const panel = layout.panels.params!
    expect(panel.visible).toBe(true)
    expect(panel.rect.height).toBeGreaterThan(0)
    assertInside(panel.rect, bounds)
  })

  it.each([532, 600, 720])('stacks the graph and quick parameters with a gap at %i available pixels', height => {
    const bounds = { x: 80, y: 100, width: 1240, height }
    // Call order must not put the bottom panel before the graph.
    const { single, panels } = layoutWorkbenchPanels(bounds, [params, graph], 'graph')
    expect(single).toBe(false)
    expect(Object.values(panels).every(panel => panel.visible)).toBe(true)
    expect(panels.params!.rect.y - panels.graph!.rect.y - panels.graph!.rect.height).toBeGreaterThanOrEqual(12)
    expect(intersects(panels.graph!.rect, panels.params!.rect)).toBe(false)
  })

  it.each([519, 520, 531, 689, 701])('keeps detailed parameters and graphs mutually exclusive at %i available pixels', height => {
    const bounds = { x: 0, y: 120, width: 1360, height }
    const detail = { ...params, height: 380 }
    const charts = layoutWorkbenchPanels(bounds, [graph, detail], 'graph')
    expect(charts.single).toBe(true)
    expect(Object.entries(charts.panels).filter(([, panel]) => panel.visible).map(([id]) => id)).toEqual(['graph'])
    const controls = layoutWorkbenchPanels(bounds, [graph, detail], 'params')
    expect(Object.entries(controls.panels).filter(([, panel]) => panel.visible).map(([id]) => id)).toEqual(['params'])
  })

  it.each([
    [1360, 768, 1], [1360, 540, 1], [1360, 768, 1.25], [1360, 768, 2],
    [390, 844, 1], [390, 520, 1], [320, 568, 1], [320, 568, 1.25],
  ])('contains every automatic panel at %ix%i and %sx zoom', (width, height, zoom) => {
    const viewport = { x: 0, y: 0, width: width / zoom, height: height / zoom }
    const scene = { ...viewport, y: 112, height: Math.max(0, viewport.height - 112 - 82) }
    const bounds = workbenchSafeRect(scene, viewport)
    for (const active of ['graph', 'params']) {
      const { panels } = layoutWorkbenchPanels(bounds, [graph, params], active)
      const visible = Object.values(panels).filter(panel => panel.visible)
      for (const panel of visible) assertInside(panel.rect, bounds)
      for (let a = 0; a < visible.length; a++) for (let b = a + 1; b < visible.length; b++) {
        expect(intersects(visible[a]!.rect, visible[b]!.rect)).toBe(false)
      }
      if (width <= 390) expect(visible).toHaveLength(1)
    }
  })

  it('reclamps a saved desktop rectangle when restored on a phone', () => {
    const restored = readWorkbenchRect('{"x":920,"y":600,"width":400,"height":380}')!
    const phone = { x: 12, y: 130, width: 296, height: 260 }
    expect(fitWorkbenchFloat(restored, phone)).toEqual(phone)
    expect(readWorkbenchRect('{"x":0,"y":0,"width":"400","height":300}')).toBeUndefined()
    expect(readWorkbenchRect('{"x":0,"y":0,"width":1e999,"height":300}')).toBeUndefined()
    expect(readWorkbenchRect('{')).toBeUndefined()
  })

  it('does not expose a zero-area panel while the bench is outside the visual viewport', () => {
    const bounds = workbenchSafeRect({ x: 0, y: 900, width: 320, height: 300 }, { x: 0, y: 0, width: 320, height: 500 })
    const layout = layoutWorkbenchPanels(bounds, [graph, params], 'params')
    expect(Object.values(layout.panels).some(panel => panel.visible)).toBe(false)
  })

  it('keeps the tree and right rail apart, or switches the whole group on a narrow bench', () => {
    const tree: WorkbenchPanelRequest = { id: 'tree', placement: 'top-left', width: 230, height: 300 }
    const wide = layoutWorkbenchPanels({ x: 0, y: 100, width: 1280, height: 600 }, [tree, graph, params], 'tree')
    expect(wide.single).toBe(false)
    expect(intersects(wide.panels.tree!.rect, wide.panels.graph!.rect)).toBe(false)
    const narrow = layoutWorkbenchPanels({ x: 0, y: 100, width: 700, height: 900 }, [tree, graph, params], 'tree')
    expect(narrow.single).toBe(true)
    expect(Object.values(narrow.panels).filter(panel => panel.visible)).toHaveLength(1)
    expect(narrow.panels.tree!.visible).toBe(true)
  })
})
