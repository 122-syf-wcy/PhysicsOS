import { createHash } from 'node:crypto'
import { createOpticalBenchScene, parsePhysicsScene } from '../../../packages/physics-scene/src/index.ts'
import { createOpticsWorkspaceRuntime } from '../../../overlays/harness/files/packages/client/ui-physicsos/src/client/physics/optics-workspace-runtime.ts'
import { planScene } from '../src/planner.ts'
import { staticOpticsFacts } from '../src/static-optics.ts'
import type { BrowserFrame, DrawnSegment, DrawnTriangle } from '../src/types.ts'

export function realOpticsPlan() {
  const scene = createOpticalBenchScene({ sceneId: 'validation-real-lens', revision: 3, now: '2026-11-18T00:00:00Z',
    object: { id: 'object', position: -30, height: 6 }, element: { type: 'thin_lens', id: 'lens', position: 0, focalLength: 10, apertureRadius: 8 } })
  const plan = planScene({ ...scene }, value => {
    const parsed = parsePhysicsScene(value)
    return parsed.ok ? createOpticsWorkspaceRuntime(parsed.value) : null
  }, 'convex-lens')
  return { scene, plan }
}

/** Synthetic probe records test verdict logic; only the opt-in browser suite claims painted pixels. */
export function opticsSample(snapshot: Record<string, unknown>, scale = 8): BrowserFrame {
  const facts = staticOpticsFacts(snapshot)
  if (facts === undefined) throw new Error('real optics fixture lacks verified facts')
  const at = (point: { readonly x: number; readonly y: number }) => ({ x: 200 + point.x * scale, y: 130 - point.y * scale })
  const segments: DrawnSegment[] = [], triangles: DrawnTriangle[] = []
  const line = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const a = at(from), b = at(to)
    segments.push({ source: 'canvas-2d-segment-stroke', surface: 0, strokeIndex: segments.length,
      from: a, to: b, transform: [1,0,0,1,0,0], pixelFrom: a, pixelTo: b, paintedPatches: 4 })
  }
  line({ x: facts.axis.from, y: 0 }, { x: facts.axis.to, y: 0 })
  const arrow = (point: { x: number; y: number }, height: number) => {
    const tip = at({ x: point.x, y: point.y + height }), direction = height > 0 ? -1 : 1
    const baseY = tip.y - direction * 4
    line(point, { x: point.x, y: (130 - baseY) / scale })
    const pixelPoints = [tip, { x: tip.x - 6, y: baseY }, { x: tip.x + 6, y: baseY }]
    triangles.push({ source: 'canvas-2d-triangle-fill', surface: 0, drawIndex: triangles.length,
      points: pixelPoints, transform: [1,0,0,1,0,0], pixelPoints, paintedPatches: 3 })
  }
  arrow(facts.object.at, facts.object.height)
  arrow(facts.image.at, facts.image.height)
  line({ x: facts.element.at.x, y: -facts.element.halfAperture }, { x: facts.element.at.x, y: facts.element.halfAperture })
  for (const ray of facts.rays) for (let i = 1; i < ray.points.length; i++) line(ray.points[i - 1]!, ray.points[i]!)
  for (const screen of facts.screens) line({ x: screen.at.x, y: -screen.halfHeight }, { x: screen.at.x, y: screen.halfHeight })
  return {
    time: 0, revision: Number(snapshot.revision), optics: facts,
    drawnSegments: segments, drawnTriangles: triangles,
    drawnTexts: facts.semanticText.map(text => ({ source: 'canvas-2d-text-fill', surface: 0, text, paintedPixels: 24, inkHeight: 12 })),
    drawnSurfaces: [{ source: 'canvas-2d-surface', surface: 0, width: 600, height: 300, displayWidth: 600, displayHeight: 300 }],
    paintHash: createHash('sha256').update(JSON.stringify({ facts, scale })).digest('hex'),
    snapshotSha256: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
    geometryCount: segments.length + triangles.length, opaquePixels: 600, distinctColors: 15,
  }
}
