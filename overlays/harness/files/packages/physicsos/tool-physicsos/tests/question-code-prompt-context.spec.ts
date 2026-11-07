import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { focusedRenderContract, publishedVisualGuidance, registeredParameterGuidance, QUESTION_CODE_ENTRY_EXAMPLE, QUESTION_CODE_LABEL_EXAMPLE } from '../src/question-code-prompt-context.ts'
import { QUESTION_CODE_RENDER_CONTRACT } from '../../experiment-host/src/question-code-render-contract.ts'
import { PROMPT_SEED } from '../../experiment-host/src/prompt-seed.ts'
import { questionComposition } from '../src/question-code-composition.ts'
import registry from '../../experiment-host/src/experiment-registry.json' with { type: 'json' }

it('gives authors a screen-only label helper that draws coincident force names at finite distinct positions', () => {
  const place = runInNewContext(`${QUESTION_CODE_LABEL_EXAMPLE};putLabel`) as (ctx: unknown, text: string, p: { x: number; y: number }, used: unknown[], w: number, h: number) => void
  const drawn: { text: string; x: number; y: number }[] = []
  const ctx = { font: '', textAlign: '', textBaseline: '', measureText: (text: string) => ({ width: text.length * 7 }),
    fillText: (text: string, x: number, y: number) => { drawn.push({ text, x, y }) } }
  const used: unknown[] = []
  for (const text of ['mg', 'N', 'f', 'a', 'F合', 'v']) place(ctx, text, { x: 110, y: 180 }, used, 219, 360)
  expect(drawn).toHaveLength(6)
  expect(new Set(drawn.map(p => `${p.x},${p.y}`)).size).toBe(6)
  expect(drawn.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 8 && p.y >= 8 && p.x < 211 && p.y < 352)).toBe(true)
  expect(() => { place(ctx, 'invalid', { x: 1, y: NaN }, used, 219, 360) }).toThrow()
})

it.each([-30, 45])('finishes geometry before unified mobile labels and keeps them off a block rotated %s degrees', async (rotation) => {
  const drawn: { text: string; x: number; y: number }[] = []
  const events: string[] = []
  const bodies: { left: number; right: number; top: number; bottom: number }[] = []
  const width = (text: string) => text.length * 7
  const ctx = {
    font: '', textAlign: '', textBaseline: '',
    setTransform() {}, clearRect() {}, drawImage() {},
    stroke: () => { events.push('geometry') },
    measureText: (text: string) => ({ width: width(text) }),
    fillText: (text: string, x: number, y: number) => { events.push('text'); drawn.push({ text, x, y }) },
    recordBody: (p: { x: number; y: number }, radius: number, degrees: number) => {
      const angle = degrees * Math.PI / 180
      const corners = [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([x, y]) => ({
        x: p.x + radius * (x! * Math.cos(angle) - y! * Math.sin(angle)),
        y: p.y + radius * (x! * Math.sin(angle) + y! * Math.cos(angle)),
      }))
      bodies.push({ left: Math.min(...corners.map(p => p.x)), right: Math.max(...corners.map(p => p.x)),
        top: Math.min(...corners.map(p => p.y)), bottom: Math.max(...corners.map(p => p.y)) })
    },
  }
  const canvas = { width: 0, height: 0, style: {}, getContext: () => ctx }
  const host = { clientWidth: 234, clientHeight: 360, replaceChildren() {} }
  // This painter queues the three real text sources while it is still drawing.
  // It deliberately never invokes putLabel; only the reference entry may flush.
  const painter = `function drawScene(ctx,view,t,labels=[]){
    ctx.stroke();
    for(const body of view.bodies){const p=point(body.at,t);ctx.recordBody(p,Math.max(8,body.size*t.s),body.rotation);labels.push({text:body.label,p})}
    for(const vector of view.vectors)if(view.visible[vector.observable]===true)labels.push({text:vector.symbol,p:point(vector.to,t)});
    for(const label of view.labels)labels.push({text:label.text,p:point(label.at,t)});
    ctx.stroke();
  }`
  const render = runInNewContext(`${QUESTION_CODE_ENTRY_EXAMPLE.replace('export ', '')}\n${QUESTION_CODE_LABEL_EXAMPLE}\n${painter};renderFrame`, {
    document: { getElementById: () => host, createElement: () => canvas }, devicePixelRatio: 1,
    Image: class { decode() { return Promise.resolve() } },
  }) as (snapshot: unknown) => Promise<void>
  const view = {
    extent: { width: 8.825069538022674, height: 4.964101615137754 }, origin: { x: -3.9325347690113373, y: -2.759178936779898 },
    bodies: [{ at: { x: 0, y: 0 }, size: 0.28, rotation, label: 'm' }],
    vectors: [
      { symbol: 'a', observable: 'acceleration', to: { x: 0.7351355160707085, y: -0.424430688094278 } },
      { symbol: 'F_net', observable: 'netForce', to: { x: 0.8168172400785649, y: -0.4715896534380866 } },
      { symbol: 'mg', observable: 'forces', to: { x: 0, y: -0.9431793068761734 } },
      { symbol: 'N', observable: 'forces', to: { x: 0.43684008506874433, y: 0.756629222121776 } },
      { symbol: 'f', observable: 'forces', to: { x: -0.44538005085263854, y: 0.25714029225146 } },
      { symbol: 'v', observable: 'velocity', to: { x: 0.8168172400785649, y: -0.4715896534380866 } },
    ],
    labels: [{ text: '标记', at: { x: 0, y: 0 } }],
    visible: { acceleration: true, netForce: true, forces: true, velocity: true },
  }
  await render({ view })
  expect(drawn.map(label => label.text).sort()).toEqual(['m', 'a', 'F_net', 'mg', 'N', 'f', 'v', '标记'].sort())
  expect(events.indexOf('text')).toBeGreaterThan(events.lastIndexOf('geometry'))
  const tiles = drawn.map(label => ({ left: label.x - 4, top: label.y - 4, right: label.x + width(label.text) + 4, bottom: label.y + 16 }))
  const overlaps = (a: typeof tiles[number], b: typeof tiles[number]) =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  for (const [index, tile] of tiles.entries()) {
    expect(Object.values(tile).every(Number.isFinite)).toBe(true)
    expect(tile.left).toBeGreaterThanOrEqual(8); expect(tile.top).toBeGreaterThanOrEqual(8)
    expect(tile.right).toBeLessThanOrEqual(226); expect(tile.bottom).toBeLessThanOrEqual(352)
    expect(bodies.some(body => overlaps(tile, body))).toBe(false)
    expect(tiles.slice(index + 1).some(other => overlaps(tile, other))).toBe(false)
  }
  const firstFrame = [...drawn]
  drawn.length = 0; events.length = 0; bodies.length = 0
  await render({ view })
  expect(drawn).toEqual(firstFrame)
})

it.each([
  ['mechanics', 'ground', 'GroundVisual'],
  ['magnetic', 'currentCoil', 'CurrentCoilVisual'],
  ['electric', 'pointChargeSources', 'PointChargeSourceVisual'],
  ['composite', 'compositeRegions', 'CompositeRegionVisual'],
  ['circuit', 'circuitWires', 'CircuitWireVisual'],
  ['optics', 'opticalRays', 'OpticalRayVisual'],
  ['acoustics', 'acousticWavefronts', 'AcousticWavefrontVisual'],
  ['fluid', 'pressureProbes', 'PressureProbeVisual'],
  ['thermal', 'thermalSample', 'ThermalSampleVisual'],
  ['induction', 'inductionRails', 'InductionRailVisual'],
  ['wave', 'waveFronts', 'WaveFrontVisual'],
  ['modern', 'particles', 'ParticleVisual'],
])('retains exact %s geometry and avoids unrelated projectile composition', (domain, field, type) => {
  const profile = registry.find(item => item.domain === domain)
  expect(profile).toBeDefined()
  const result = focusedRenderContract(QUESTION_CODE_RENDER_CONTRACT, domain, profile!.id)
  expect(result).toMatch(new RegExp(`\\b${field}\\??:`))
  expect(result).toContain(`interface ${type}`)
  expect(result).toContain('interface ScenePoint')
  expect(result).not.toContain('interface InspectorSection')
  expect(result).toContain('interface PlaybackClock')
  expect(result).not.toContain('interface ChartSeries')
  expect(result.length).toBeLessThan(QUESTION_CODE_RENDER_CONTRACT.length * 0.65)
  const composition = questionComposition(domain, profile!.id)
  expect(composition).toContain('snapshot.view.visible')
  if (domain !== 'mechanics') expect(composition).not.toContain('最高点映射到18%')
})
it('retains exact mechanics primitive shapes and transitive types without unrelated field families', () => {
  const result = focusedRenderContract(QUESTION_CODE_RENDER_CONTRACT, 'mechanics')
  expect(result).toContain('bodies:BodyVisual[]')
  expect(result).toContain('interface BodyVisual')
  expect(result).toContain('at:ScenePoint')
  expect(result).toContain('interface ScenePoint')
  expect(result).not.toContain('interface InspectorSection')
  expect(result).toContain('interface PlaybackClock')
  expect(result).not.toContain('opticalRays?:')
  expect(result).not.toContain('interface OpticalRayVisual')
  expect(result.length).toBeLessThan(QUESTION_CODE_RENDER_CONTRACT.length * 0.65)
})
it('gives incline authors the exact surface and vectors without unrelated mechanics apparatus', () => {
  const result = focusedRenderContract(QUESTION_CODE_RENDER_CONTRACT, 'mechanics', 'incline')
  expect(result).toContain('interface InclineVisual')
  expect(result).toContain('interface VectorVisual')
  expect(result).not.toContain('interface InspectorSection')
  expect(result).toContain('interface CoordinateVisual')
  expect(result).toContain('points?:ScenePoint[]')
  expect(result).toContain('直接按incline.points顺序画多边形')
  expect(result).not.toContain('base*tan(angle°)')
  expect(result).toContain('history实线/predicted虚线')
  expect(result).not.toContain('interface PendulumVisual')
  expect(result).not.toContain('interface ChartSeries')
  expect(result.length).toBeLessThan(2200)
})
it('keeps the optional engine incline polygon synchronized in host and client contracts', () => {
  const client = readFileSync(new URL('../../../client/ui-physicsos/src/client/physics/scene-visual-model.ts', import.meta.url), 'utf8')
  const shape = (contract: string): string => {
    const declaration = /(?:export )?interface InclineVisual\s*\{([\s\S]*?)\n\}/.exec(contract)?.[1]
    expect(declaration).toBeDefined()
    return declaration!.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '')
  }
  expect(shape(client)).toContain('points?:readonlyScenePoint[]')
  expect(shape(QUESTION_CODE_RENDER_CONTRACT)).toBe(shape(client))
  const composition = questionComposition('mechanics', 'incline')
  expect(composition).toContain('直接按incline.points顺序画多边形')
})
it('keeps native drawing fields and direction semantics while omitting unrelated readout contracts', () => {
  for (const domain of ['magnetic', 'electric', 'composite', 'optics', 'induction', 'wave']) {
    const result = focusedRenderContract(QUESTION_CODE_RENDER_CONTRACT, domain)
    expect(result).toContain('source:')
    expect(result).toContain('view:SceneVisualModel')
    expect(result).toContain('clock:PlaybackClock')
    expect(result).toContain('visible:')
    expect(result).not.toContain('inspector:')
    expect(result).not.toContain('interface DerivedQuantityView')
    expect(result).not.toContain('type ObservableKey =')
    if (['magnetic', 'composite'].includes(domain)) expect(result).toContain("direction:'into-page'|'out-of-page'")
    if (domain === 'optics') {
      expect(result).toContain("nature:'real'|'virtual'")
      expect(result).toContain('extension虚线')
      expect(result).toContain('refractedTo缺省时不补造')
    }
    if (domain === 'induction') expect(result).toContain("marks:'into'|'out'")
  }
})
it('retains coordinate axes and suspended apparatus in their matching mechanics variants', () => {
  expect(focusedRenderContract(QUESTION_CODE_RENDER_CONTRACT, 'mechanics', 'incline')).toContain('coordinate?:CoordinateVisual')
  for (const id of ['simple-pendulum', 'spring-oscillator', 'hooke-law']) {
    expect(focusedRenderContract(QUESTION_CODE_RENDER_CONTRACT, 'mechanics', id)).toContain('apparatus?:ApparatusSpriteVisual[]')
  }
  for (const id of ['lever-balance', 'mechanical-energy', 'ramp-friction']) {
    expect(focusedRenderContract(QUESTION_CODE_RENDER_CONTRACT, 'mechanics', id)).toContain('dimensions:DimensionVisual[]')
  }
})
it('keeps the distinct wave and modern visibility defaults after omitting the global enum roster', () => {
  expect(focusedRenderContract(QUESTION_CODE_RENDER_CONTRACT, 'wave')).toContain('!==false')
  expect(focusedRenderContract(QUESTION_CODE_RENDER_CONTRACT, 'modern')).toContain('不检查visible.trajectory')
  const mechanics = focusedRenderContract(QUESTION_CODE_RENDER_CONTRACT, 'mechanics', 'incline')
  expect(mechanics).toContain('view.visible[vector.observable]===true')
  expect(mechanics).toContain('angles/dimensions按已给几何绘制')
})
it('keeps published visual requirements verbatim while excluding unrelated upload procedures', () => {
  const result = publishedVisualGuidance(PROMPT_SEED.body)
  expect(PROMPT_SEED.body).toContain(result.trim())
  expect(result).toContain('统一 Warm Lab')
  expect(result).toContain('生图素材可做环境或材质')
  expect(result).not.toContain('交付目标是 convex-lens')
  expect(registeredParameterGuidance('before\n## 当前平台配置\nexact-values\n## 构建与提交\nnpm')).toBe('## 当前平台配置\nexact-values')
})
