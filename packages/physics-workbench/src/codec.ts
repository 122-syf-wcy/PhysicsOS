import type { SimulationRequest, SimulationResult, SimulationState } from '@physicsos/physics-core'
import { parsePhysicsScene } from '@physicsos/physics-scene'
import { canonicalValue, findUnit, isPhysicalDimension, type PhysicalDimension } from '@physicsos/physics-units'

import {
  boolean, canonicalStringify, digest, exactKeys, fail, finite, freezeData, integer, isoDate, jsonObject,
  jsonValue, list, nonnegative, oneOf, optional, parsed, pointer, positive, record,
  text, unique, unwrap, WorkbenchDataError,
} from './json.ts'
import {
  readQuantity, readQuantityVector, readRendererRelease, readSimulationRequest,
  readSimulationResult, readSimulationState,
} from './simulation-codec.ts'
import type {
  AnalysisDataset, AxisDescriptor, CanvasEdge, CanvasLayout, CanvasManifest, CanvasNode,
  CanvasStoredValue, CanvasViewport, CaptureCursor, ComparisonConfig, ComparisonMember,
  ConditionValue, DatasetObject, DatasetOrigin, DatasetRow, DataValue, EngineIdentity,
  ExperimentInstance, HistoryEntry, HistoryObject, InstanceSource, JsonObject,
  MetricDescriptor, MetricScale, MetricSemantics, ObjectKind, ObjectRef, ParseIssue,
  ParseResult, QuantityReference, SceneObject, SnapshotAlias, SnapshotObject,
  TemplateReleaseIdentity, WorkbenchClock, WorkbenchObject,
} from './types.ts'

export { canonicalStringify, canonicalBytes, canonicalByteLength, copyJsonObject, copyDiagnosticObject, parseJsonObject, WorkbenchDataError } from './json.ts'

const id = (value: unknown, path: string): string => text(value, path, true)
const stringList = (value: unknown, path: string): string[] => list(value, path, text)
const metadata = (value: unknown, path: string): JsonObject | undefined => optional(value, path, jsonObject)
const optionalText = (value: unknown, path: string): string | undefined => optional(value, path, text)
const optionalId = (value: unknown, path: string): string | undefined => optional(value, path, id)

export const readObjectRef = <K extends ObjectKind>(input: unknown, path: string, expected: K): ObjectRef<K> => {
  const value = record(input, path)
  exactKeys(value, ['kind', 'digest'], path)
  const kind = oneOf(value.kind, [expected], pointer(path, 'kind'))
  return { kind, digest: digest(value.digest, pointer(path, 'digest')) }
}

export const readWorkbenchClock = (input: unknown, path = ''): WorkbenchClock => {
  const value = record(input, path)
  exactKeys(value, ['time', 'total', 'running', 'rate'], path)
  const time = nonnegative(value.time, pointer(path, 'time'))
  const total = nonnegative(value.total, pointer(path, 'total'))
  const running = boolean(value.running, pointer(path, 'running'))
  const rate = positive(value.rate, pointer(path, 'rate'))
  if (total === 0 && running) fail(path, 'clock', 'A static or unavailable clock cannot be running.')
  if (total > 0 && time > total) fail(pointer(path, 'time'), 'clock', 'Clock time cannot exceed its known total.')
  return { time, total, running, rate }
}
export const readCaptureCursor = (input: unknown, path = ''): CaptureCursor => {
  const value = record(input, path)
  const kind = oneOf(value.kind, ['time', 'parameter', 'space', 'static'], pointer(path, 'kind'))
  if (kind === 'static') {
    exactKeys(value, ['kind', 'identity'], path)
    return { kind, identity: id(value.identity, pointer(path, 'identity')) }
  }
  if (kind === 'time') {
    exactKeys(value, ['kind', 'time'], path)
    const time = readQuantity(value.time, pointer(path, 'time'), 'time')
    nonnegative(time.value, pointer(pointer(path, 'time'), 'value'))
    return { kind, time }
  }
  exactKeys(value, ['kind', 'axisId', 'value'], path)
  return { kind, axisId: id(value.axisId, pointer(path, 'axisId')), value: readQuantity(value.value, pointer(path, 'value')) }
}
/** Keeps requested cursor and evaluated state time distinct for legitimately sampled runtimes. */
export const sampledStateDiagnostic = (
  cursor: CaptureCursor,
  state: SimulationState | undefined,
  result: SimulationResult | undefined,
  request: SimulationRequest | undefined,
  path = '',
): JsonObject | undefined => {
  if (cursor.kind !== 'time' || state === undefined) return undefined
  const requested = canonicalValue(cursor.time)
  const evaluated = canonicalValue(state.time)
  if (requested === evaluated) return undefined
  if (result === undefined) return fail(path, 'cursor-state', 'A differently timed captured state requires its held sampled result.')
  const captured = canonicalStringify(state)
  if (!result.states.some((sample) => canonicalStringify(sample) === captured)) {
    return fail(path, 'cursor-state', 'The differently timed state must be an unchanged sample from the held simulation result.')
  }
  let sampleStart: number | undefined
  let sampleEnd: number | undefined
  for (const sample of result.states) {
    const time = canonicalValue(sample.time)
    sampleStart = sampleStart === undefined ? time : Math.min(sampleStart, time)
    sampleEnd = sampleEnd === undefined ? time : Math.max(sampleEnd, time)
  }
  const start = request?.options.startTime === undefined ? sampleStart : canonicalValue(request.options.startTime)
  const end = request?.options.endTime === undefined ? sampleEnd : canonicalValue(request.options.endTime)
  if (start === undefined || end === undefined || requested < start || requested > end) {
    return fail(path, 'cursor-range', 'The requested cursor must be within the held simulation range.')
  }
  return { code: 'SAMPLED_STATE_CURSOR_OFFSET', requestedTimeSI: requested, evaluatedTimeSI: evaluated,
    offsetSI: evaluated - requested, selection: 'held-result-sample' }
}

export const readEngineIdentity = (input: unknown, path = ''): EngineIdentity => {
  const value = record(input, path)
  exactKeys(value, ['id', 'version', 'model', 'release'], path)
  const model = optionalId(value.model, pointer(path, 'model'))
  const release = optional(value.release, pointer(path, 'release'), readRendererRelease)
  return {
    id: id(value.id, pointer(path, 'id')), version: id(value.version, pointer(path, 'version')),
    ...(model === undefined ? {} : { model }), ...(release === undefined ? {} : { release }),
  }
}
const readTemplateRelease = (input: unknown, path: string): TemplateReleaseIdentity => {
  const value = record(input, path)
  exactKeys(value, ['id', 'version', 'digest'], path)
  const contentDigest = optional(value.digest, pointer(path, 'digest'), digest)
  return {
    id: id(value.id, pointer(path, 'id')), version: id(value.version, pointer(path, 'version')),
    ...(contentDigest === undefined ? {} : { digest: contentDigest }),
  }
}
export const readInstanceSource = (input: unknown, path = ''): InstanceSource => {
  const value = record(input, path)
  exactKeys(value, ['kind', 'id', 'title', 'url', 'questionId', 'artifactId', 'release', 'metadata'], path)
  const kind = oneOf(value.kind, ['template', 'question', 'community', 'question-code', 'import', 'free-build'], pointer(path, 'kind'))
  const sourceId = optionalId(value.id, pointer(path, 'id'))
  const title = optionalText(value.title, pointer(path, 'title'))
  const url = optionalText(value.url, pointer(path, 'url'))
  const questionId = optionalId(value.questionId, pointer(path, 'questionId'))
  const artifactId = optionalId(value.artifactId, pointer(path, 'artifactId'))
  const release = optional(value.release, pointer(path, 'release'), readRendererRelease)
  const extra = metadata(value.metadata, pointer(path, 'metadata'))
  return {
    kind, ...(sourceId === undefined ? {} : { id: sourceId }), ...(title === undefined ? {} : { title }),
    ...(url === undefined ? {} : { url }), ...(questionId === undefined ? {} : { questionId }),
    ...(artifactId === undefined ? {} : { artifactId }), ...(release === undefined ? {} : { release }),
    ...(extra === undefined ? {} : { metadata: extra }),
  }
}
export const readExperimentInstance = (input: unknown, path = ''): ExperimentInstance => {
  const value = record(input, path)
  exactKeys(value, ['instanceId', 'currentScene', 'originScene', 'templateId', 'domain', 'source', 'buildMode', 'clock', 'instanceEditRevision', 'templateRelease', 'rendererRelease', 'metadata'], path)
  const templateId = optionalId(value.templateId, pointer(path, 'templateId'))
  const templateRelease = optional(value.templateRelease, pointer(path, 'templateRelease'), readTemplateRelease)
  const rendererRelease = optional(value.rendererRelease, pointer(path, 'rendererRelease'), readRendererRelease)
  const extra = metadata(value.metadata, pointer(path, 'metadata'))
  return {
    instanceId: id(value.instanceId, pointer(path, 'instanceId')),
    currentScene: readObjectRef(value.currentScene, pointer(path, 'currentScene'), 'scene'),
    originScene: readObjectRef(value.originScene, pointer(path, 'originScene'), 'scene'),
    domain: oneOf(value.domain, ['magnetic', 'mechanics', 'electric', 'circuit', 'composite', 'optics', 'acoustics', 'fluid', 'thermal', 'induction', 'wave', 'modern'], pointer(path, 'domain')),
    source: readInstanceSource(value.source, pointer(path, 'source')),
    buildMode: oneOf(value.buildMode, ['inspect', 'construct'], pointer(path, 'buildMode')),
    clock: readWorkbenchClock(value.clock, pointer(path, 'clock')),
    instanceEditRevision: integer(value.instanceEditRevision, pointer(path, 'instanceEditRevision')),
    ...(templateId === undefined ? {} : { templateId }), ...(templateRelease === undefined ? {} : { templateRelease }),
    ...(rendererRelease === undefined ? {} : { rendererRelease }), ...(extra === undefined ? {} : { metadata: extra }),
  }
}
const readViewport = (input: unknown, path: string): CanvasViewport => {
  const value = record(input, path)
  exactKeys(value, ['x', 'y', 'zoom'], path)
  return { x: finite(value.x, pointer(path, 'x')), y: finite(value.y, pointer(path, 'y')), zoom: positive(value.zoom, pointer(path, 'zoom')) }
}
const readLayout = (input: unknown, path: string): CanvasLayout => {
  const value = record(input, path)
  exactKeys(value, ['x', 'y', 'width', 'height', 'zIndex'], path)
  return {
    x: finite(value.x, pointer(path, 'x')), y: finite(value.y, pointer(path, 'y')),
    width: positive(value.width, pointer(path, 'width')), height: positive(value.height, pointer(path, 'height')),
    zIndex: finite(value.zIndex, pointer(path, 'zIndex')),
  }
}
const readNode = (input: unknown, path: string): CanvasNode => {
  const value = record(input, path)
  const kind = oneOf(value.kind, ['experiment', 'result', 'note', 'comparison', 'group'], pointer(path, 'kind'))
  const title = optionalText(value.title, pointer(path, 'title'))
  const groupId = optionalId(value.groupId, pointer(path, 'groupId'))
  const locked = optional(value.locked, pointer(path, 'locked'), boolean)
  const extra = metadata(value.metadata, pointer(path, 'metadata'))
  const base = {
    id: id(value.id, pointer(path, 'id')), layout: readLayout(value.layout, pointer(path, 'layout')),
    ...(title === undefined ? {} : { title }), ...(groupId === undefined ? {} : { groupId }),
    ...(locked === undefined ? {} : { locked }), ...(extra === undefined ? {} : { metadata: extra }),
  }
  const fields = ['id', 'kind', 'title', 'layout', 'groupId', 'locked', 'metadata']
  switch (kind) {
    case 'experiment':
      exactKeys(value, [...fields, 'instanceId'], path)
      return { ...base, kind, instanceId: id(value.instanceId, pointer(path, 'instanceId')) }
    case 'result': {
      exactKeys(value, [...fields, 'snapshotAliasId', 'view', 'metricIds'], path)
      const view = optional(value.view, pointer(path, 'view'), (entry, at) => oneOf(entry, ['scene', 'table', 'chart', 'summary'] as const, at))
      const metricIds = optional(value.metricIds, pointer(path, 'metricIds'), stringList)
      if (metricIds !== undefined) unique(metricIds, (entry) => entry, pointer(path, 'metricIds'))
      return { ...base, kind, snapshotAliasId: id(value.snapshotAliasId, pointer(path, 'snapshotAliasId')),
        ...(view === undefined ? {} : { view }), ...(metricIds === undefined ? {} : { metricIds }) }
    }
    case 'note':
      exactKeys(value, [...fields, 'body', 'format'], path)
      return { ...base, kind, body: text(value.body, pointer(path, 'body')), format: oneOf(value.format, ['plain', 'markdown'], pointer(path, 'format')) }
    case 'comparison':
      exactKeys(value, [...fields, 'comparisonId'], path)
      return { ...base, kind, comparisonId: id(value.comparisonId, pointer(path, 'comparisonId')) }
    case 'group':
      exactKeys(value, [...fields, 'collapsed'], path)
      return { ...base, kind, collapsed: boolean(value.collapsed, pointer(path, 'collapsed')) }
  }
}
const readEdge = (input: unknown, path: string): CanvasEdge => {
  const value = record(input, path)
  exactKeys(value, ['id', 'kind', 'from', 'to', 'label', 'metadata'], path)
  const label = optionalText(value.label, pointer(path, 'label'))
  const extra = metadata(value.metadata, pointer(path, 'metadata'))
  return {
    id: id(value.id, pointer(path, 'id')), kind: oneOf(value.kind, ['relation', 'sequence', 'comparison'], pointer(path, 'kind')),
    from: id(value.from, pointer(path, 'from')), to: id(value.to, pointer(path, 'to')),
    ...(label === undefined ? {} : { label }), ...(extra === undefined ? {} : { metadata: extra }),
  }
}
const readSnapshotAlias = (input: unknown, path: string): SnapshotAlias => {
  const value = record(input, path)
  exactKeys(value, ['id', 'title', 'snapshot', 'instanceId', 'metadata'], path)
  const instanceId = optionalId(value.instanceId, pointer(path, 'instanceId'))
  const extra = metadata(value.metadata, pointer(path, 'metadata'))
  return {
    id: id(value.id, pointer(path, 'id')), title: text(value.title, pointer(path, 'title')),
    snapshot: readObjectRef(value.snapshot, pointer(path, 'snapshot'), 'snapshot'),
    ...(instanceId === undefined ? {} : { instanceId }), ...(extra === undefined ? {} : { metadata: extra }),
  }
}
const readComparisonMember = (input: unknown, path: string): ComparisonMember => {
  const value = record(input, path)
  exactKeys(value, ['id', 'snapshotAliasId', 'dataset', 'metricId', 'axisId', 'label'], path)
  const axisId = optionalId(value.axisId, pointer(path, 'axisId'))
  const label = optionalText(value.label, pointer(path, 'label'))
  return {
    id: id(value.id, pointer(path, 'id')), snapshotAliasId: id(value.snapshotAliasId, pointer(path, 'snapshotAliasId')),
    dataset: readObjectRef(value.dataset, pointer(path, 'dataset'), 'dataset'), metricId: id(value.metricId, pointer(path, 'metricId')),
    ...(axisId === undefined ? {} : { axisId }), ...(label === undefined ? {} : { label }),
  }
}
const readBindings = (input: unknown, path: string): Readonly<Record<string, string>> => {
  const value = record(input, path)
  const output: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) output[key] = id(entry, pointer(path, key))
  return output
}
const readComparison = (input: unknown, path: string): ComparisonConfig => {
  const value = record(input, path)
  exactKeys(value, ['id', 'title', 'members', 'mode', 'alignment', 'targetUnit', 'axisUnit', 'targetBindings', 'metadata'], path)
  const title = optionalText(value.title, pointer(path, 'title'))
  const targetUnit = optionalText(value.targetUnit, pointer(path, 'targetUnit'))
  const axisUnit = optionalText(value.axisUnit, pointer(path, 'axisUnit'))
  for (const [name, unit] of [['targetUnit', targetUnit], ['axisUnit', axisUnit]] as const) {
    if (unit !== undefined && findUnit(unit) === undefined) fail(pointer(path, name), 'unit', 'Expected a registered unit.')
  }
  const targetBindings = optional(value.targetBindings, pointer(path, 'targetBindings'), readBindings)
  const extra = metadata(value.metadata, pointer(path, 'metadata'))
  const members = list(value.members, pointer(path, 'members'), readComparisonMember)
  unique(members, (member) => member.id, pointer(path, 'members'))
  const mode = oneOf(value.mode, ['overlay', 'difference', 'conditions'], pointer(path, 'mode'))
  const alignment = oneOf(value.alignment, ['native', 'exact-coordinate'], pointer(path, 'alignment'))
  if (mode === 'difference' && alignment !== 'exact-coordinate') fail(pointer(path, 'alignment'), 'alignment', 'Differences require exact-coordinate alignment; interpolation is not supported.')
  return {
    id: id(value.id, pointer(path, 'id')), members, mode, alignment,
    ...(title === undefined ? {} : { title }), ...(targetUnit === undefined ? {} : { targetUnit }),
    ...(axisUnit === undefined ? {} : { axisUnit }), ...(targetBindings === undefined ? {} : { targetBindings }),
    ...(extra === undefined ? {} : { metadata: extra }),
  }
}

/** Validates editable document references independently of lazy blob loading. */
export const manifestIssues = (manifest: CanvasManifest): readonly ParseIssue[] => {
  const issues: ParseIssue[] = []
  const problem = (path: string, message: string): void => { issues.push({ path, code: 'reference', message }) }
  const instances = new Set(manifest.instances.map((instance) => instance.instanceId))
  const aliases = new Set(manifest.snapshots.map((alias) => alias.id))
  const comparisons = new Set(manifest.comparisons.map((comparison) => comparison.id))
  const nodes = new Map(manifest.nodes.map((node) => [node.id, node]))
  manifest.nodes.forEach((node, index) => {
    const path = `/nodes/${index}`
    if (node.kind === 'experiment' && !instances.has(node.instanceId)) problem(`${path}/instanceId`, 'Experiment node references a missing instance.')
    if (node.kind === 'result' && !aliases.has(node.snapshotAliasId)) problem(`${path}/snapshotAliasId`, 'Result node references a missing snapshot alias.')
    if (node.kind === 'comparison' && !comparisons.has(node.comparisonId)) problem(`${path}/comparisonId`, 'Comparison node references a missing comparison.')
    if (node.groupId !== undefined) {
      const parent = nodes.get(node.groupId)
      if (parent?.kind !== 'group') problem(`${path}/groupId`, 'Group parent must reference a group node.')
      if (node.groupId === node.id) problem(`${path}/groupId`, 'A node cannot be its own group.')
    }
  })
  const complete = new Set<string>()
  for (const [index, node] of manifest.nodes.entries()) {
    const chain = new Set<string>()
    let current: CanvasNode | undefined = node
    while (current !== undefined && !complete.has(current.id)) {
      if (chain.has(current.id)) {
        problem(`/nodes/${index}/groupId`, 'Group membership contains a cycle.')
        break
      }
      chain.add(current.id)
      current = current.groupId === undefined ? undefined : nodes.get(current.groupId)
    }
    chain.forEach((entry) => complete.add(entry))
  }
  manifest.edges.forEach((edge, index) => {
    if (!nodes.has(edge.from)) problem(`/edges/${index}/from`, 'Edge source node is missing.')
    if (!nodes.has(edge.to)) problem(`/edges/${index}/to`, 'Edge destination node is missing.')
  })
  manifest.snapshots.forEach((alias, index) => {
    if (alias.instanceId !== undefined && !instances.has(alias.instanceId)) problem(`/snapshots/${index}/instanceId`, 'Snapshot alias association references a missing current instance.')
  })
  manifest.comparisons.forEach((comparison, index) => comparison.members.forEach((member, memberIndex) => {
    if (!aliases.has(member.snapshotAliasId)) problem(`/comparisons/${index}/members/${memberIndex}/snapshotAliasId`, 'Comparison member references a missing snapshot alias.')
  }))
  return issues
}
const readManifest = (input: unknown, path: string): CanvasManifest => {
  const value = record(input, path)
  exactKeys(value, ['schemaVersion', 'id', 'title', 'createdAt', 'updatedAt', 'viewport', 'nodes', 'edges', 'instances', 'snapshots', 'comparisons', 'history', 'metadata'], path)
  if (value.schemaVersion !== 1) fail(pointer(path, 'schemaVersion'), 'schema', 'Expected canvas manifest schemaVersion 1.')
  const history = optional(value.history, pointer(path, 'history'), (entry, at) => readObjectRef(entry, at, 'history'))
  const extra = metadata(value.metadata, pointer(path, 'metadata'))
  const manifest: CanvasManifest = {
    schemaVersion: 1, id: id(value.id, pointer(path, 'id')), title: text(value.title, pointer(path, 'title')),
    createdAt: isoDate(value.createdAt, pointer(path, 'createdAt')), updatedAt: isoDate(value.updatedAt, pointer(path, 'updatedAt')),
    viewport: readViewport(value.viewport, pointer(path, 'viewport')),
    nodes: list(value.nodes, pointer(path, 'nodes'), readNode), edges: list(value.edges, pointer(path, 'edges'), readEdge),
    instances: list(value.instances, pointer(path, 'instances'), readExperimentInstance),
    snapshots: list(value.snapshots, pointer(path, 'snapshots'), readSnapshotAlias),
    comparisons: list(value.comparisons, pointer(path, 'comparisons'), readComparison),
    ...(history === undefined ? {} : { history }), ...(extra === undefined ? {} : { metadata: extra }),
  }
  unique(manifest.nodes, (entry) => entry.id, pointer(path, 'nodes'))
  unique(manifest.edges, (entry) => entry.id, pointer(path, 'edges'))
  unique(manifest.instances, (entry) => entry.instanceId, pointer(path, 'instances'))
  unique(manifest.snapshots, (entry) => entry.id, pointer(path, 'snapshots'))
  unique(manifest.comparisons, (entry) => entry.id, pointer(path, 'comparisons'))
  unique(manifest.comparisons.flatMap((comparison) => comparison.members), (member) => member.id, pointer(path, 'comparisons'))
  const issues = manifestIssues(manifest)
  if (issues.length > 0) throw new WorkbenchDataError(issues)
  return manifest
}
export const parseManifest = (input: unknown): ParseResult<CanvasManifest> => parsed(() => readManifest(jsonValue(input), ''))
export const createManifest = (input: { readonly id: string; readonly title: string; readonly now?: string }): CanvasManifest => {
  const now = input.now ?? new Date().toISOString()
  return unwrap(parseManifest({ schemaVersion: 1, id: input.id, title: input.title, createdAt: now, updatedAt: now,
    viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [], instances: [], snapshots: [], comparisons: [] }))
}

const dimension = (value: unknown, path: string): PhysicalDimension =>
  isPhysicalDimension(value) ? value : fail(path, 'dimension', 'Expected a registered physical dimension.')
const unitFor = (input: unknown, expected: PhysicalDimension, path: string): string => {
  const symbol = text(input, path)
  const unit = findUnit(symbol)
  if (unit === undefined || unit.dimension !== expected) fail(path, 'unit', 'Unit is unknown or does not match the declared dimension.')
  return symbol
}
const readQuantityReference = (input: unknown, path: string): QuantityReference => {
  const value = record(input, path)
  exactKeys(value, ['identity', 'value'], path)
  return { identity: id(value.identity, pointer(path, 'identity')), value: readQuantity(value.value, pointer(path, 'value')) }
}
export const readMetricScale = (input: unknown, path = ''): MetricScale => {
  const value = record(input, path)
  const kind = oneOf(value.kind, ['linear', 'temperature-absolute', 'temperature-difference', 'logarithmic', 'unresolved'], pointer(path, 'kind'))
  if (kind === 'unresolved') {
    exactKeys(value, ['kind', 'reason'], path)
    return { kind, reason: id(value.reason, pointer(path, 'reason')) }
  }
  if (kind !== 'logarithmic') {
    exactKeys(value, ['kind'], path)
    return { kind }
  }
  exactKeys(value, ['kind', 'base', 'factor', 'reference'], path)
  const base = positive(value.base, pointer(path, 'base'))
  const factor = positive(value.factor, pointer(path, 'factor'))
  if (base === 1) fail(pointer(path, 'base'), 'scale', 'A logarithmic base cannot be 1.')
  const reference = readQuantityReference(value.reference, pointer(path, 'reference'))
  if (canonicalValue(reference.value) <= 0) fail(pointer(path, 'reference'), 'scale', 'A logarithmic reference must be positive.')
  return { kind, base, factor, reference }
}
export const readMetricSemantics = (input: unknown, path = ''): MetricSemantics => {
  const value = record(input, path)
  exactKeys(value, ['semanticKey', 'scale', 'reference'], path)
  const reference = optional(value.reference, pointer(path, 'reference'), readQuantityReference)
  return { semanticKey: id(value.semanticKey, pointer(path, 'semanticKey')), scale: readMetricScale(value.scale, pointer(path, 'scale')),
    ...(reference === undefined ? {} : { reference }) }
}
const readMetric = (input: unknown, path: string): MetricDescriptor => {
  const value = record(input, path)
  exactKeys(value, ['id', 'semanticKey', 'targetId', 'component', 'dimension', 'unit', 'scale', 'reference'], path)
  const metricDimension = dimension(value.dimension, pointer(path, 'dimension'))
  const scale = readMetricScale(value.scale, pointer(path, 'scale'))
  if ((scale.kind === 'temperature-absolute' || scale.kind === 'temperature-difference') && metricDimension !== 'temperature') {
    fail(pointer(path, 'scale'), 'scale', 'Temperature scales require a temperature quantity.')
  }
  if (scale.kind === 'logarithmic' && metricDimension !== 'dimensionless') fail(pointer(path, 'scale'), 'scale', 'Logarithmic readings must use a dimensionless registered unit.')
  const component = oneOf(value.component, ['scalar', 'x', 'y', 'z', 'magnitude'], pointer(path, 'component'))
  if (scale.kind === 'logarithmic' && component !== 'scalar') fail(pointer(path, 'component'), 'scale', 'Logarithmic readings must be scalar coordinates.')
  const targetId = optionalId(value.targetId, pointer(path, 'targetId'))
  const reference = optional(value.reference, pointer(path, 'reference'), readQuantityReference)
  if (reference !== undefined && reference.value.dimension !== metricDimension) fail(pointer(path, 'reference'), 'dimension', 'Metric reference dimension must match the metric.')
  return {
    id: id(value.id, pointer(path, 'id')), semanticKey: id(value.semanticKey, pointer(path, 'semanticKey')),
    component,
    dimension: metricDimension, unit: unitFor(value.unit, metricDimension, pointer(path, 'unit')), scale,
    ...(targetId === undefined ? {} : { targetId }), ...(reference === undefined ? {} : { reference }),
  }
}
const readAxis = (input: unknown, path: string): AxisDescriptor => {
  const value = record(input, path)
  exactKeys(value, ['id', 'kind', 'identity', 'dimension', 'unit', 'origin'], path)
  const axisDimension = dimension(value.dimension, pointer(path, 'dimension'))
  const kind = oneOf(value.kind, ['time', 'parameter', 'space', 'static'], pointer(path, 'kind'))
  if (kind === 'time' && axisDimension !== 'time') fail(pointer(path, 'dimension'), 'dimension', 'A time axis must have time dimension.')
  if (kind === 'space' && axisDimension !== 'length') fail(pointer(path, 'dimension'), 'dimension', 'A spatial axis must have length dimension.')
  if (kind === 'static' && axisDimension !== 'dimensionless') fail(pointer(path, 'dimension'), 'dimension', 'A static axis must be dimensionless.')
  const origin = record(value.origin, pointer(path, 'origin'))
  exactKeys(origin, ['kind', 'value', 'reference'], pointer(path, 'origin'))
  return {
    id: id(value.id, pointer(path, 'id')), kind, identity: id(value.identity, pointer(path, 'identity')),
    dimension: axisDimension, unit: unitFor(value.unit, axisDimension, pointer(path, 'unit')),
    origin: { kind: oneOf(origin.kind, ['absolute', 'relative'], pointer(pointer(path, 'origin'), 'kind')),
      value: readQuantity(origin.value, pointer(pointer(path, 'origin'), 'value'), axisDimension),
      reference: id(origin.reference, pointer(pointer(path, 'origin'), 'reference')) },
  }
}
const readDataValue = (input: unknown, path: string): DataValue => {
  if (typeof input === 'number') return finite(input, path)
  const value = record(input, path)
  exactKeys(value, ['missing', 'details'], path)
  const details = metadata(value.details, pointer(path, 'details'))
  return { missing: id(value.missing, pointer(path, 'missing')), ...(details === undefined ? {} : { details }) }
}
const readDataMap = (input: unknown, ids: readonly string[], path: string): Readonly<Record<string, DataValue>> => {
  const value = record(input, path)
  exactKeys(value, ids, path)
  const output: Record<string, DataValue> = {}
  for (const key of ids) output[key] = readDataValue(value[key], pointer(path, key))
  return output
}
export const readConditionValue = (input: unknown, path = ''): ConditionValue => {
  const value = record(input, path)
  exactKeys(value, ['semanticKey', 'targetId', 'value', 'scale', 'reference'], path)
  const targetId = optionalId(value.targetId, pointer(path, 'targetId'))
  const scale = optional(value.scale, pointer(path, 'scale'), readMetricScale)
  const reference = optional(value.reference, pointer(path, 'reference'), readQuantityReference)
  const raw = value.value
  let condition: ConditionValue['value']
  if (raw === null || typeof raw === 'string' || typeof raw === 'boolean') condition = raw
  else if (typeof raw === 'number') condition = finite(raw, pointer(path, 'value'))
  else {
    const quantity = record(raw, pointer(path, 'value'))
    condition = 'vector' in quantity ? readQuantityVector(quantity, pointer(path, 'value')) : readQuantity(quantity, pointer(path, 'value'))
  }
  if (scale !== undefined && condition !== null && typeof condition === 'object') {
    if ((scale.kind === 'temperature-absolute' || scale.kind === 'temperature-difference') && condition.dimension !== 'temperature') {
      fail(pointer(path, 'scale'), 'scale', 'Temperature condition scales require a temperature quantity.')
    }
    if (scale.kind === 'logarithmic' && ('vector' in condition || condition.dimension !== 'dimensionless')) {
      fail(pointer(path, 'scale'), 'scale', 'Logarithmic conditions require scalar dimensionless coordinates.')
    }
  }
  if (reference !== undefined && condition !== null && typeof condition === 'object' && reference.value.dimension !== condition.dimension) {
    fail(pointer(path, 'reference'), 'dimension', 'Condition reference dimension must match the quantity.')
  }
  return { semanticKey: id(value.semanticKey, pointer(path, 'semanticKey')), value: condition,
    ...(targetId === undefined ? {} : { targetId }), ...(scale === undefined ? {} : { scale }),
    ...(reference === undefined ? {} : { reference }) }
}
const readOrigin = (input: unknown, path: string): DatasetOrigin => {
  const value = record(input, path)
  exactKeys(value, ['sceneId', 'sceneRevision', 'simulationId', 'collection', 'analysisId'], path)
  const simulationId = optionalId(value.simulationId, pointer(path, 'simulationId'))
  const analysisId = optionalId(value.analysisId, pointer(path, 'analysisId'))
  return { sceneId: id(value.sceneId, pointer(path, 'sceneId')), sceneRevision: integer(value.sceneRevision, pointer(path, 'sceneRevision')),
    collection: oneOf(value.collection, ['states', 'measurements', 'derived', 'analysis', 'captured-state'], pointer(path, 'collection')),
    ...(simulationId === undefined ? {} : { simulationId }), ...(analysisId === undefined ? {} : { analysisId }) }
}
/** Shared field validation before a runtime analysis has a stored scene reference. */
const readDatasetFields = (value: Record<string, unknown>, path: string): AnalysisDataset => {
  if (value.schemaVersion !== 1 || value.kind !== 'dataset') fail(path, 'schema', 'Expected a dataset object with schemaVersion 1.')
  const axes = list(value.axes, pointer(path, 'axes'), readAxis)
  const metrics = list(value.metrics, pointer(path, 'metrics'), readMetric)
  unique(axes, (axis) => axis.id, pointer(path, 'axes'))
  unique(metrics, (metric) => metric.id, pointer(path, 'metrics'))
  const rows = list(value.rows, pointer(path, 'rows'), (inputRow, at): DatasetRow => {
    const row = record(inputRow, at)
    exactKeys(row, ['rowId', 'axes', 'values', 'evidence'], at)
    const evidence = metadata(row.evidence, pointer(at, 'evidence'))
    return { rowId: id(row.rowId, pointer(at, 'rowId')),
      axes: readDataMap(row.axes, axes.map((axis) => axis.id), pointer(at, 'axes')),
      values: readDataMap(row.values, metrics.map((metric) => metric.id), pointer(at, 'values')),
      ...(evidence === undefined ? {} : { evidence }) }
  })
  unique(rows, (row) => row.rowId, pointer(path, 'rows'))
  const conditions = list(value.conditions, pointer(path, 'conditions'), readConditionValue)
  unique(conditions, (condition) => canonicalStringify([condition.semanticKey, condition.targetId ?? null]), pointer(path, 'conditions'))
  const extra = metadata(value.metadata, pointer(path, 'metadata'))
  return { schemaVersion: 1, kind: 'dataset', id: id(value.id, pointer(path, 'id')), axes, metrics, rows, conditions,
    origin: readOrigin(value.origin, pointer(path, 'origin')), ...(extra === undefined ? {} : { metadata: extra }) }
}
/** Complete dataset reader, also used to validate reversible full-raw CSV input. */
export const readDatasetObject = (input: unknown, path = ''): DatasetObject => {
  const value = record(jsonValue(input, path), path)
  exactKeys(value, ['schemaVersion', 'kind', 'id', 'sourceScene', 'axes', 'metrics', 'rows', 'conditions', 'origin', 'metadata'], path)
  return { ...readDatasetFields(value, path), sourceScene: readObjectRef(value.sourceScene, pointer(path, 'sourceScene'), 'scene') }
}
export const parseAnalysisDataset = (input: unknown): ParseResult<AnalysisDataset> => parsed(() => {
  const value = record(jsonValue(input), '')
  exactKeys(value, ['schemaVersion', 'kind', 'id', 'axes', 'metrics', 'rows', 'conditions', 'origin', 'metadata'], '')
  return readDatasetFields(value, '')
})
const readSceneObject = (input: unknown, path: string): SceneObject => {
  const value = record(input, path)
  exactKeys(value, ['schemaVersion', 'kind', 'scene'], path)
  const scene = parsePhysicsScene(value.scene)
  if (!scene.ok) throw new WorkbenchDataError(scene.issues.map((issue) => ({ ...issue, path: `${pointer(path, 'scene')}${issue.path}` })))
  return { schemaVersion: 1, kind: 'scene', scene: scene.value }
}
const readSnapshotObject = (input: unknown, path: string): SnapshotObject => {
  const value = record(input, path)
  exactKeys(value, ['schemaVersion', 'kind', 'scene', 'instanceId', 'capturedAt', 'sceneRevision', 'instanceEditRevision', 'source', 'engine', 'request', 'result', 'capturedState', 'rawState', 'clock', 'cursor', 'datasets', 'diagnostics', 'metadata'], path)
  const request = optional(value.request, pointer(path, 'request'), readSimulationRequest)
  const result = optional(value.result, pointer(path, 'result'), readSimulationResult)
  const capturedState = optional(value.capturedState, pointer(path, 'capturedState'), readSimulationState)
  const rawState = metadata(value.rawState, pointer(path, 'rawState'))
  if (request === undefined && result === undefined && capturedState === undefined && rawState === undefined) fail(path, 'capture-unavailable', 'A snapshot requires actual captured state or a simulation result.')
  if (result === undefined && capturedState === undefined && rawState === undefined) fail(path, 'capture-unavailable', 'A request alone is not captured data.')
  const sceneRevision = integer(value.sceneRevision, pointer(path, 'sceneRevision'))
  if (result !== undefined && result.sceneRevision !== sceneRevision) fail(pointer(path, 'result'), 'revision', 'Result revision differs from the captured scene revision.')
  if (request !== undefined && request.sceneRevision !== sceneRevision) fail(pointer(path, 'request'), 'revision', 'Request revision differs from the captured scene revision.')
  if (request !== undefined && result !== undefined && (request.sceneId !== result.sceneId || request.simulationId !== result.simulationId)) fail(path, 'capture-identity', 'Captured request and result identities differ.')
  const engine = readEngineIdentity(value.engine, pointer(path, 'engine'))
  if (result !== undefined && (result.metadata.engineId !== engine.id || result.metadata.engineVersion !== engine.version)) fail(pointer(path, 'engine'), 'engine', 'Capture engine identity differs from the result metadata.')
  const clock = readWorkbenchClock(value.clock, pointer(path, 'clock'))
  const cursor = readCaptureCursor(value.cursor, pointer(path, 'cursor'))
  if (cursor.kind === 'time' && canonicalValue(cursor.time) !== clock.time) fail(pointer(path, 'cursor'), 'cursor', 'Time cursor and playback clock must describe the same instant.')
  const sampledDiagnostic = sampledStateDiagnostic(cursor, capturedState, result, request, pointer(path, 'capturedState'))
  const datasets = list(value.datasets, pointer(path, 'datasets'), (entry, at) => readObjectRef(entry, at, 'dataset'))
  unique(datasets, (ref) => ref.digest, pointer(path, 'datasets'))
  const diagnostics = list(value.diagnostics, pointer(path, 'diagnostics'), jsonObject)
  if (sampledDiagnostic !== undefined && !diagnostics.some((entry) => canonicalStringify(entry) === canonicalStringify(sampledDiagnostic))) {
    fail(pointer(path, 'diagnostics'), 'cursor-diagnostic', 'A sampled-state cursor offset must be recorded explicitly in snapshot diagnostics.')
  }
  const extra = metadata(value.metadata, pointer(path, 'metadata'))
  return { schemaVersion: 1, kind: 'snapshot', scene: readObjectRef(value.scene, pointer(path, 'scene'), 'scene'),
    instanceId: id(value.instanceId, pointer(path, 'instanceId')), capturedAt: isoDate(value.capturedAt, pointer(path, 'capturedAt')),
    sceneRevision, instanceEditRevision: integer(value.instanceEditRevision, pointer(path, 'instanceEditRevision')),
    source: oneOf(value.source, ['client-engine', 'server-engine', 'imported'], pointer(path, 'source')), engine,
    clock, cursor, datasets, diagnostics, ...(request === undefined ? {} : { request }), ...(result === undefined ? {} : { result }),
    ...(capturedState === undefined ? {} : { capturedState }), ...(rawState === undefined ? {} : { rawState }),
    ...(extra === undefined ? {} : { metadata: extra }) }
}
const readHistoryEntry = (input: unknown, path: string): HistoryEntry => {
  const value = record(input, path)
  exactKeys(value, ['id', 'instanceId', 'scene', 'snapshot', 'at', 'operation', 'details'], path)
  const instanceId = optionalId(value.instanceId, pointer(path, 'instanceId'))
  const scene = optional(value.scene, pointer(path, 'scene'), (entry, at) => readObjectRef(entry, at, 'scene'))
  const snapshot = optional(value.snapshot, pointer(path, 'snapshot'), (entry, at) => readObjectRef(entry, at, 'snapshot'))
  const details = metadata(value.details, pointer(path, 'details'))
  return { id: id(value.id, pointer(path, 'id')), at: isoDate(value.at, pointer(path, 'at')),
    operation: oneOf(value.operation, ['create', 'edit', 'capture', 'restore-origin', 'clone', 'import', 'remove', 'merge'], pointer(path, 'operation')),
    ...(instanceId === undefined ? {} : { instanceId }), ...(scene === undefined ? {} : { scene }),
    ...(snapshot === undefined ? {} : { snapshot }), ...(details === undefined ? {} : { details }) }
}
const readHistoryObject = (input: unknown, path: string): HistoryObject => {
  const value = record(input, path)
  exactKeys(value, ['schemaVersion', 'kind', 'parents', 'entries'], path)
  const parents = list(value.parents, pointer(path, 'parents'), (entry, at) => readObjectRef(entry, at, 'history'))
  const entries = list(value.entries, pointer(path, 'entries'), readHistoryEntry)
  unique(parents, (ref) => ref.digest, pointer(path, 'parents'))
  unique(entries, (entry) => entry.id, pointer(path, 'entries'))
  return { schemaVersion: 1, kind: 'history', parents, entries }
}
const readObject = (input: unknown, path: string): WorkbenchObject => {
  const value = record(input, path)
  if (value.schemaVersion !== 1) fail(pointer(path, 'schemaVersion'), 'schema', 'Expected object schemaVersion 1.')
  const kind = oneOf(value.kind, ['scene', 'snapshot', 'dataset', 'history'], pointer(path, 'kind'))
  switch (kind) {
    case 'scene': return readSceneObject(value, path)
    case 'snapshot': return readSnapshotObject(value, path)
    case 'dataset': return readDatasetObject(value, path)
    case 'history': return readHistoryObject(value, path)
  }
}
export const parseObject = (input: unknown): ParseResult<WorkbenchObject> => parsed(() => readObject(jsonValue(input), ''))
export const parseStoredValue = (input: unknown): ParseResult<CanvasStoredValue> => {
  const safe = parsed(() => jsonValue(input))
  if (!safe.ok) return safe
  const value = safe.value
  return value !== null && typeof value === 'object' && !Array.isArray(value) && 'kind' in value
    ? parseObject(value)
    : parseManifest(value)
}
export const createSceneObject = (scene: unknown): SceneObject => {
  const object = unwrap(parseObject({ schemaVersion: 1, kind: 'scene', scene }))
  if (object.kind !== 'scene') return fail('', 'kind', 'Expected a scene object.')
  return object
}

/** Enumerates only protocol-owned references; arbitrary metadata cannot manufacture dependencies. */
export const refsOf = (input: CanvasStoredValue): readonly ObjectRef[] => {
  const refs: ObjectRef[] = []
  if (!('kind' in input)) {
    input.instances.forEach((instance) => { refs.push(instance.currentScene, instance.originScene) })
    input.snapshots.forEach((alias) => refs.push(alias.snapshot))
    input.comparisons.forEach((comparison) => comparison.members.forEach((member) => refs.push(member.dataset)))
    if (input.history !== undefined) refs.push(input.history)
  } else {
    switch (input.kind) {
      case 'scene': break
      case 'snapshot':
        refs.push(input.scene)
        for (const ref of input.datasets) refs.push(ref)
        break
      case 'dataset': refs.push(input.sourceScene); break
      case 'history':
        for (const ref of input.parents) refs.push(ref)
        input.entries.forEach((entry) => { if (entry.scene !== undefined) refs.push(entry.scene); if (entry.snapshot !== undefined) refs.push(entry.snapshot) })
        break
    }
  }
  const seen = new Set<string>()
  return freezeData(refs.filter((ref) => {
    const key = `${ref.kind}:${ref.digest}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).map((ref) => ({ ...ref })))
}
