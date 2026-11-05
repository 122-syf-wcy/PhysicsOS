/** Select exact type declarations needed by this domain; never rewrite physics values. */
import type { PhysicsSceneSolveSummary } from './types.ts'
/** Repeated per-answer provenance stays in the session; authors only need verified quantities. */
export function authorSolveFacts(solve: PhysicsSceneSolveSummary | undefined): unknown {
  if (solve === undefined) return null
  return {
    knowns: solve.knowns, targets: solve.targets,
    answers: solve.answers.map(({ key, label, symbol, value, unit }) => ({ key, label, symbol, value, unit })),
    steps: solve.steps, issues: solve.issues,
    verification: solve.verification === undefined ? undefined : { status: solve.verification.status,
      checks: solve.verification.checks.map(({ id, passed }) => ({ id, passed })) },
  }
}
export function focusedRenderContract(contract: string, domain: string, experimentId?: string): string {
  const marker = 'Exact field shapes (TypeScript notation describes data; do not import these types):'
  const split = contract.indexOf(marker)
  if (split < 0) return contract
  const guide = contract.slice(0, split).split('\n').find(line => line.startsWith(domain + ':'))
  if (guide === undefined) return contract
  const declarations = new Map<string, string>()
  const body = contract.slice(split + marker.length)
  const starts = [...body.matchAll(/^(?:interface|type) ([A-Za-z_$][\w$]*)/gm)]
  for (let i = 0; i < starts.length; i++) {
    const entry = starts[i]
    if (entry?.[1]) declarations.set(entry[1], body.slice(entry.index, starts[i + 1]?.index ?? body.length).trim())
  }
  const view = declarations.get('SceneVisualModel')
  if (view === undefined || !declarations.has('UniversalExperimentSnapshot')) return contract
  const common = ['domain', 'extent', 'origin', 'grid', 'axes', 'tickStep', 'tickLabelAvoid', 'bodies', 'particles', 'vectors', 'trajectories', 'keyPoints', 'angles', 'dimensions', 'labels', 'guides', 'overlay', 'visible', 'highlighted']
  const mechanicsFields: Record<string, string[]> = {
    incline: ['incline', 'ground', 'platform', 'motionMarks'],
    'hooke-law': ['spring', 'platform'], 'spring-oscillator': ['spring', 'platform'],
    'simple-pendulum': ['pendulum'], 'lever-balance': ['leverBeam', 'leverFulcrum', 'leverHangers'],
    'mechanical-energy': ['energyRamp', 'energyBar'], 'ramp-friction': ['energyRamp', 'energyBar'],
  }
  const domainFields = (domain === 'mechanics' && experimentId ? mechanicsFields[experimentId] : undefined)
    ?? guide.split(':').slice(1).join(':').match(/[A-Za-z_$][\w$]*/g) ?? []
  const fields = new Set([...common, ...domainFields])
  declarations.set('SceneVisualModel', view.split('\n').filter((line) => {
    const field = /^([A-Za-z_$][\w$]*)\??:/.exec(line)?.[1]
    return field === undefined || fields.has(field)
  }).join('\n'))
  if (experimentId) {
    const rootFields = new Set(['experimentId', 'revision', 'source', 'domain', 'title', 'ariaLabel', 'view', 'inspector', 'clock', 'trajectoryTimes'])
    declarations.set('UniversalExperimentSnapshot', declarations.get('UniversalExperimentSnapshot')!.split('\n').filter(line => {
      const field = /^([A-Za-z_$][\w$]*)\??:/.exec(line)?.[1]
      return field === undefined || rootFields.has(field)
    }).join('\n'))
  }
  const selected = new Set<string>()
  const include = (name: string): void => {
    if (selected.has(name)) return
    const declaration = declarations.get(name)
    if (declaration === undefined) return
    selected.add(name)
    for (const word of declaration.match(/[A-Za-z_$][\w$]*/g) ?? []) if (declarations.has(word)) include(word)
  }
  include('UniversalExperimentSnapshot')
  const heading = experimentId ? `V3 renderer: export async function renderFrame(snapshot). Draw inside #canvas and resolve only after drawing the current frame. No imports; only native Canvas2D/SVG and local helpers. All fields are read-only engine facts. Coordinates are y-up; origin is lower-left, extent is width/height. Use one uniform scale and flip y once. Vector from/to are pre-scaled DISPLAY endpoints, never infer force/speed magnitudes from arrow length. Read magnitudes from inspector.derived or view.overlay.readout. Arrays can be empty, optional fields absent, zero values valid. Respect view.visible and highlighted. clock is platform time; never advance a second physics clock. Do not fabricate missing geometry.\n${guide}\n` : contract.slice(0, split).split('\n').filter(line => !/^(mechanics|magnetic|electric|composite|circuit|optics|acoustics|fluid|thermal|induction|wave|modern):/.test(line) || line === guide).join('\n')
  return heading + marker + '\n' + [...selected].map(name => declarations.get(name)).join('\n\n')
}
export function publishedVisualGuidance(body: string): string {
  const sections = body.split(/(?=^## )/m)
  const relevant = sections.filter(section => /^## (?:统一代码风格|三维与视觉标准)/.test(section))
  return relevant.length ? relevant.join('') : body
}
export function registeredParameterGuidance(prompt: string): string {
  const start = prompt.indexOf('## 当前平台配置')
  if (start < 0) return prompt
  const end = prompt.indexOf('## 构建与提交', start)
  return prompt.slice(start, end < 0 ? undefined : end).trim()
}
