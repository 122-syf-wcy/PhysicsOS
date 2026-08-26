/**
 * PhysicsOS Knowledge Graph V1.
 *
 * A small, explicit curriculum graph: three subject roots (力学 / 电磁学 / 电路)
 * with the knowledge points the current teaching content actually exercises,
 * plus an explicit question → node mapping. Everything here is DATA — no
 * physics is computed, and the mapping is a hand-audited table rather than a
 * keyword heuristic, so a question can never drift onto the wrong node silently.
 *
 * Consumers:
 *  - Question Space shows the nodes of the current question as 知识总结.
 *  - The learning record aggregates student attempts per node (掌握度).
 *  - The Lab's experiment self-checks (see experiment-self-checks.ts) write
 *    attempts against the circuit nodes, which have no golden questions yet.
 */

/** Subject roots. */
export type KnowledgeDomain = 'mechanics' | 'electromagnetism' | 'circuit'

export interface KnowledgeNode {
  readonly id: string
  readonly label: string
  readonly domain: KnowledgeDomain
  /** Parent node id; roots omit it. */
  readonly parentId?: string
}

/** The curriculum tree, roots first. Order is the display order. */
export const KNOWLEDGE_NODES: readonly KnowledgeNode[] = [
  { id: 'mechanics', label: '力学', domain: 'mechanics' },
  /* 平均速度 is a 初中 lab node: no golden question maps to it yet — the Lab's
     测平均速度 self-checks are what write attempts against it. */
  { id: 'kin-average-speed', label: '平均速度', domain: 'mechanics', parentId: 'mechanics' },
  { id: 'kin-uniform-acceleration', label: '匀变速直线运动', domain: 'mechanics', parentId: 'mechanics' },
  { id: 'kin-projectile', label: '抛体运动', domain: 'mechanics', parentId: 'mechanics' },
  { id: 'dyn-newton-second', label: '牛顿第二定律', domain: 'mechanics', parentId: 'mechanics' },
  { id: 'dyn-force-analysis', label: '受力分析', domain: 'mechanics', parentId: 'mechanics' },
  { id: 'dyn-incline', label: '斜面模型', domain: 'mechanics', parentId: 'mechanics' },
  { id: 'method-units', label: '单位与数量级', domain: 'mechanics', parentId: 'mechanics' },

  { id: 'electromagnetism', label: '电磁学', domain: 'electromagnetism' },
  { id: 'em-field-strength', label: '电场强度', domain: 'electromagnetism', parentId: 'electromagnetism' },
  { id: 'em-superposition', label: '电场叠加', domain: 'electromagnetism', parentId: 'electromagnetism' },
  { id: 'em-electric-force', label: '电场力', domain: 'electromagnetism', parentId: 'electromagnetism' },
  { id: 'em-uniform-deflection', label: '匀强电场偏转（类平抛）', domain: 'electromagnetism', parentId: 'electromagnetism' },
  { id: 'em-bounded-field', label: '有界电场与极板', domain: 'electromagnetism', parentId: 'electromagnetism' },
  { id: 'em-energy', label: '电场力做功与动能', domain: 'electromagnetism', parentId: 'electromagnetism' },
  { id: 'em-lorentz', label: '洛伦兹力', domain: 'electromagnetism', parentId: 'electromagnetism' },
  { id: 'em-circular', label: '磁场中的圆周运动', domain: 'electromagnetism', parentId: 'electromagnetism' },
  { id: 'em-crossed-fields', label: '复合场 E+B', domain: 'electromagnetism', parentId: 'electromagnetism' },
  { id: 'em-velocity-selector', label: '速度选择器', domain: 'electromagnetism', parentId: 'electromagnetism' },
  { id: 'em-mass-spectrometer', label: '质谱仪', domain: 'electromagnetism', parentId: 'electromagnetism' },
  { id: 'em-three-field', label: '电、磁、重力三场平衡', domain: 'electromagnetism', parentId: 'electromagnetism' },

  /* 电路 nodes are exercised by the Lab's experiment self-checks (there are no
     circuit golden questions yet); QUESTION_KNOWLEDGE therefore never maps to
     them, and the learning record reaches them through lab attempts instead. */
  { id: 'circuit', label: '电路', domain: 'circuit' },
  { id: 'circ-ohm-law', label: '欧姆定律', domain: 'circuit', parentId: 'circuit' },
  { id: 'circ-series', label: '串联电路', domain: 'circuit', parentId: 'circuit' },
  { id: 'circ-parallel', label: '并联电路', domain: 'circuit', parentId: 'circuit' },
  { id: 'circ-dynamic', label: '动态电路分析', domain: 'circuit', parentId: 'circuit' },
  { id: 'circ-power', label: '电功率', domain: 'circuit', parentId: 'circuit' },
  { id: 'circ-emf-internal', label: '电动势与内阻', domain: 'circuit', parentId: 'circuit' },
]

const NODE_BY_ID: ReadonlyMap<string, KnowledgeNode> = new Map(
  KNOWLEDGE_NODES.map((node) => [node.id, node]),
)

export const knowledgeNodeOf = (id: string): KnowledgeNode | undefined => NODE_BY_ID.get(id)

/**
 * Golden question → knowledge node ids. Hand-audited, one entry per question;
 * the test suite asserts the table covers every golden question and only
 * references declared nodes.
 */
export const QUESTION_KNOWLEDGE: Readonly<Record<string, readonly string[]>> = {
  /* -------------------------------------------------------------- magnetic -- */
  '01-proton-basic': ['em-lorentz', 'em-circular'],
  '02-electron-negative-charge': ['em-lorentz', 'em-circular'],
  '03-field-out-of-page': ['em-lorentz', 'em-circular'],
  '04-radius-only': ['em-circular'],
  '05-period-only': ['em-circular'],
  '06-missing-charge-sign': ['em-lorentz'],
  '07-zero-field': ['em-lorentz'],
  '08-parallel-velocity': ['em-lorentz'],
  '09-unit-conversion': ['em-circular', 'method-units'],
  '10-scientific-notation': ['em-circular', 'method-units'],

  /* -------------------------------------------------------------- electric -- */
  'electric-01-perpendicular-deflection': ['em-uniform-deflection', 'em-electric-force'],
  'electric-02-negative-parallel': ['em-electric-force', 'em-uniform-deflection'],
  'electric-03-point-charge-field': ['em-field-strength'],
  'electric-04-point-charge-force': ['em-field-strength', 'em-electric-force'],
  'electric-05-point-charge-direction': ['em-field-strength', 'em-electric-force'],
  'electric-06-dipole-midpoint-field': ['em-field-strength', 'em-superposition'],
  'electric-07-like-charges-midpoint': ['em-field-strength', 'em-superposition'],
  'electric-08-dipole-axis-field': ['em-field-strength', 'em-superposition'],
  'electric-09-off-axis-field': ['em-field-strength', 'em-superposition'],
  'electric-10-electron-deflection': ['em-bounded-field', 'em-uniform-deflection'],
  'electric-11-proton-deflection': ['em-bounded-field', 'em-uniform-deflection'],
  'electric-12-exit-velocity': ['em-bounded-field', 'em-uniform-deflection'],
  'electric-13-hit-plate-time': ['em-bounded-field', 'em-uniform-deflection'],
  'electric-14-deflection-direction': ['em-bounded-field', 'em-electric-force'],
  'electric-15-field-reversed': ['em-bounded-field', 'em-electric-force'],
  'electric-16-different-velocity': ['em-bounded-field', 'em-uniform-deflection'],
  'electric-17-different-charge': ['em-bounded-field', 'em-uniform-deflection'],
  'electric-18-plate-length-effect': ['em-bounded-field', 'em-uniform-deflection'],
  'electric-19-energy': ['em-energy', 'em-bounded-field'],

  /* ------------------------------------------------------------- mechanics -- */
  'mech-01-uniform-acceleration': ['kin-uniform-acceleration'],
  'mech-02-projectile-horizontal': ['kin-projectile'],
  'mech-03-projectile-oblique': ['kin-projectile'],
  'mech-04-newton-second-law': ['dyn-newton-second', 'dyn-force-analysis'],
  'mech-05-incline-no-friction': ['dyn-incline', 'dyn-force-analysis'],
  'mech-06-unit-conversion': ['kin-uniform-acceleration', 'method-units'],

  /* ------------------------------------------------------------- composite -- */
  'comp-01-selector-balance': ['em-velocity-selector', 'em-crossed-fields', 'em-lorentz'],
  'comp-02-selector-selected-velocity': ['em-velocity-selector', 'em-crossed-fields'],
  'comp-03-selector-too-fast': ['em-velocity-selector', 'em-crossed-fields'],
  'comp-04-selector-too-slow': ['em-velocity-selector', 'em-crossed-fields'],
  'comp-05-selector-electron': ['em-velocity-selector', 'em-lorentz'],
  'comp-06-selector-low-field': ['em-velocity-selector', 'em-crossed-fields'],
  'comp-07-selector-trajectory': ['em-velocity-selector', 'em-crossed-fields'],
  'comp-08-selector-missing-direction': ['em-velocity-selector'],
  'comp-09-spectrometer-radius': ['em-mass-spectrometer', 'em-circular'],
  'comp-10-spectrometer-charge-mass': ['em-mass-spectrometer', 'em-circular'],
  'comp-11-spectrometer-isotope': ['em-mass-spectrometer', 'em-circular'],
  'comp-12-spectrometer-period': ['em-mass-spectrometer', 'em-circular'],
  'comp-13-spectrometer-electron': ['em-mass-spectrometer', 'em-lorentz'],
  'comp-14-spectrometer-selected-velocity': ['em-mass-spectrometer', 'em-velocity-selector'],
  'comp-15-eb-crossed': ['em-crossed-fields', 'em-lorentz'],
  'comp-16-eb-electron-trajectory': ['em-crossed-fields', 'em-lorentz'],
  'comp-17-eb-energy': ['em-crossed-fields', 'em-energy'],
  'comp-18-ebg-balance': ['em-three-field', 'dyn-force-analysis'],
  'comp-19-ebg-droplet': ['em-three-field', 'dyn-force-analysis'],
  'comp-20-ebg-heavy-particle': ['em-three-field', 'dyn-force-analysis'],
  'comp-21-cyclotron-unsupported': ['em-crossed-fields'],
}

/** Knowledge nodes for a question id, in table order; unknown ids yield []. */
export const knowledgeNodesOfQuestion = (questionId: string): readonly KnowledgeNode[] =>
  (QUESTION_KNOWLEDGE[questionId] ?? []).flatMap((nodeId) => {
    const node = NODE_BY_ID.get(nodeId)
    return node === undefined ? [] : [node]
  })
