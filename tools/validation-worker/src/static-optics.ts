import type { StaticOpticsFacts } from './types.ts'

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200
const point = (value: unknown): value is { x: number; y: number } => record(value) && finite(value.x) && finite(value.y)
const close = (left: number, right: number): boolean => Math.abs(left - right) <= 1e-6
const points = (value: unknown, count: number): value is { x: number; y: number }[] => Array.isArray(value) && value.length === count && value.every(point)

/** Bound only the concrete OpticsWorkspaceRuntime/opticsSceneVisual thin-lens real-image wire. */
export function staticOpticsFacts(snapshot: Record<string, unknown>): StaticOpticsFacts | undefined {
  const clock = snapshot.clock, view = snapshot.view, verification = snapshot.verification
  if (snapshot.source !== 'platform-engine' || snapshot.domain !== 'optics'
    || typeof snapshot.experimentId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(snapshot.experimentId)
    || !Number.isSafeInteger(snapshot.revision) || Number(snapshot.revision) < 0
    || !record(clock) || clock.time !== 0 || clock.total !== 0 || clock.running !== false || !finite(clock.rate) || clock.rate <= 0
    || !record(view) || view.domain !== 'optics' || !record(view.visible) || view.visible.rays !== true || view.visible.image !== true
    || !Array.isArray(view.bodies) || view.bodies.length !== 0 || !Array.isArray(view.particles) || view.particles.length !== 0
    || !['lightRig', 'lightRefraction', 'ground', 'incline', 'field', 'electricField'].every(key => view[key] === undefined)
    || !['circuitComponents', 'circuitWires', 'chargeFlows', 'waveStrings', 'pointChargeSources'].every(key => { const field = view[key]; return field === undefined || Array.isArray(field) && field.length === 0 })
    || !Array.isArray(view.opticalObjects) || view.opticalObjects.length !== 1
    || !Array.isArray(view.opticalElements) || view.opticalElements.length !== 1
    || !Array.isArray(view.opticalImages) || view.opticalImages.length !== 1
    || !Array.isArray(view.opticalRays) || view.opticalRays.length !== 3
    || !Array.isArray(view.opticalScreens) || view.opticalScreens.length > 1
    || !Array.isArray(view.opticalAxisMarks) || view.opticalAxisMarks.length !== 4
    || !point(view.origin) || !record(view.extent) || !finite(view.extent.width) || view.extent.width <= 0
    || !finite(view.extent.height) || view.extent.height <= 0
    || !record(snapshot.table) || !Array.isArray(snapshot.table.rows) || snapshot.table.rows.length !== 1
    || !Array.isArray(snapshot.charts) || snapshot.charts.length !== 0
    || !Array.isArray(snapshot.events) || snapshot.events.length !== 0
    || !Array.isArray(snapshot.trajectoryTimes) || snapshot.trajectoryTimes.length !== 0
    || !Array.isArray(verification) || !verification.every(item => record(item) && item.status === 'passed')
    || !['thin_lens_equation', 'principal_rays_converge'].every(id => verification.some(item => record(item) && item.id === id && item.status === 'passed'))
    || !Array.isArray(snapshot.inspector)) return undefined
  const object = view.opticalObjects[0], element = view.opticalElements[0], image = view.opticalImages[0]
  if (!record(object) || !text(object.id) || !point(object.at) || object.at.y !== 0 || !finite(object.height) || object.height <= 0 || !text(object.label)
    || !record(element) || !text(element.id) || element.kind !== 'thin_lens' || !point(element.at) || element.at.y !== 0
    || !finite(element.halfAperture) || element.halfAperture <= 0 || !text(element.label)
    || !record(image) || !text(image.id) || !point(image.at) || image.at.y !== 0 || !finite(image.height) || image.height >= 0
    || image.nature !== 'real' || !text(image.label) || !(object.at.x < element.at.x && image.at.x > element.at.x)) return undefined
  const parameters = snapshot.inspector.flatMap(section => record(section) && Array.isArray(section.parameters) ? section.parameters : [])
  const heights = parameters.filter(parameter => record(parameter) && parameter.id === 'object-height')
  const height = heights[0]
  const distance = parameters.find(parameter => record(parameter) && parameter.id === 'object-distance')
  const focal = parameters.find(parameter => record(parameter) && parameter.id === 'focal-length')
  if (heights.length !== 1 || !record(height) || height.label !== '物高' || height.unit !== 'cm' || height.min !== 0.5 || height.step !== 0.5
    || height.max !== undefined || !finite(height.value) || height.value < 0.5 || !close(height.value, object.height)
    || !record(distance) || distance.unit !== 'cm' || !finite(distance.value) || !close(distance.value, element.at.x - object.at.x)
    || !record(focal) || focal.unit !== 'cm' || !finite(focal.value) || focal.value <= 0) return undefined
  const marks: StaticOpticsFacts['marks'][number][] = []
  const expectedMarks = [
    ['mark-f-left', element.at.x - focal.value, 'F'], ['mark-f-right', element.at.x + focal.value, 'F'],
    ['mark-2f-left', element.at.x - 2 * focal.value, '2F'], ['mark-2f-right', element.at.x + 2 * focal.value, '2F'],
  ] as const
  for (const [id, x, label] of expectedMarks) {
    const mark = view.opticalAxisMarks.find(item => record(item) && item.id === id)
    if (!record(mark) || !point(mark.at) || !close(mark.at.x, x) || mark.at.y !== 0 || mark.label !== label) return undefined
    marks.push({ id, at: { ...mark.at }, label })
  }
  const rays: StaticOpticsFacts['rays'][number][] = []
  for (const kind of ['parallel', 'central', 'focal'] as const) {
    const ray = view.opticalRays.find(item => record(item) && item.kind === kind)
    if (!record(ray) || !text(ray.id) || !points(ray.points, 3) || ray.extension !== undefined) return undefined
    const [first, hit, end] = ray.points
    if (!close(first!.x, object.at.x) || !close(first!.y, object.height) || !close(hit!.x, element.at.x)
      || !close(end!.x, image.at.x) || !close(end!.y, image.height)
      || kind === 'parallel' && !close(hit!.y, object.height) || kind === 'central' && hit!.y !== 0
      || kind === 'focal' && !close(hit!.y, image.height)) return undefined
    rays.push({ id: ray.id, kind, points: ray.points.map(item => ({ ...item })) })
  }
  if (new Set(rays.map(ray => ray.id)).size !== rays.length) return undefined
  const screens: StaticOpticsFacts['screens'][number][] = []
  for (const screen of view.opticalScreens) {
    if (!record(screen) || !text(screen.id) || !point(screen.at) || screen.at.y !== 0 || !finite(screen.halfHeight)
      || screen.halfHeight <= 0 || typeof screen.lit !== 'boolean' || !text(screen.label)) return undefined
    screens.push({ id: screen.id, at: { ...screen.at }, halfHeight: screen.halfHeight, lit: screen.lit, label: screen.label })
  }
  const ids = [object.id, element.id, image.id, ...screens.map(screen => screen.id)]
  if (new Set(ids).size !== ids.length) return undefined
  const axis = { from: view.origin.x, to: view.origin.x + view.extent.width, y: 0 }
  if (!finite(axis.to) || axis.to <= axis.from) return undefined
  const derived = snapshot.inspector.flatMap(section => record(section) && Array.isArray(section.derived) ? section.derived : [])
  const nature = derived.find(item => record(item) && item.id === 'image-nature')
  const readout = record(view.overlay) ? view.overlay.readout : undefined
  if (!record(nature) || !text(nature.value) || !Array.isArray(readout) || readout.length < 4 || !readout.every(text) || !readout.includes(nature.value)) return undefined
  const screenState = derived.find(item => record(item) && item.id === 'image-on-screen')
  if (screens.length > 0 && (!record(screenState) || !text(screenState.value)
    || screenState.value !== (screens[0]!.lit ? '清晰的实像在光屏上' : '光屏上无像'))) return undefined
  // Limits native-label ambiguity: a real positive lens and a real inverted
  // image must carry this runtime's exact semantic vocabulary, not arbitrary
  // renderer captions that happen to share a geometry array name.
  if (element.label !== '凸透镜' || image.label !== '像' || readout[0] !== '成像读数'
    || !/^物距 u = .+ cm$/.test(readout[1]!) || !/^像距 v = .+ cm$/.test(readout[2]!)
    || !/^倒立、(?:缩小|等大|放大)的实像$/.test(nature.value)) return undefined
  const frozenObject = { id: object.id, at: { ...object.at }, height: object.height, label: object.label }
  const frozenElement = { id: element.id, kind: 'thin_lens' as const, at: { ...element.at }, halfAperture: element.halfAperture, label: element.label }
  const frozenImage = { id: image.id, at: { ...image.at }, height: image.height, nature: 'real' as const, label: image.label }
  return {
    object: frozenObject, element: frozenElement, image: frozenImage, rays, screens, marks, axis,
    heightParameter: { id: 'object-height', label: '物高', unit: 'cm', value: height.value, min: 0.5, step: 0.5 },
    semanticText: [...new Set([object.label, element.label, image.label, ...readout, ...screens.map(screen => screen.label),
      ...(screens.length > 0 && record(screenState) && text(screenState.value) ? [screenState.value] : [])])],
  }
}
