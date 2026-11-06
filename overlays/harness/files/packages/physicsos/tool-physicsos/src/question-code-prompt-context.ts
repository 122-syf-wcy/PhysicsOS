/** Select exact type declarations needed by this domain; never rewrite physics values. */
import type { PhysicsSceneSolveSummary } from './types.ts'
/** Browser plumbing only: no apparatus drawing or physical model is supplied. */
export const QUESTION_CODE_ENTRY_EXAMPLE = `export async function renderFrame(snapshot){
const host=document.getElementById('canvas'),w=host.clientWidth,h=host.clientHeight;
if(!(w>0&&h>0))return;
if(!board){board=document.createElement('canvas');host.replaceChildren(board)}
const d=devicePixelRatio||1,bw=Math.round(w*d),bh=Math.round(h*d);
if(board.width!==bw||board.height!==bh){board.width=bw;board.height=bh}
board.style.width=w+'px';board.style.height=h+'px';
const ctx=board.getContext('2d');ctx.setTransform(d,0,0,d,0,0);
if(!image){image=new Image();image.crossOrigin='anonymous';image.src='REPLACE_WITH_GENERATED_PATH';decoded=image.decode()}
await decoded;ctx.clearRect(0,0,w,h);ctx.drawImage(image,0,0,w,h);
const view=snapshot.view,s=Math.min((w-24)/view.extent.width,(h-24)/view.extent.height);
const ox=(w-s*view.extent.width)/2,oy=(h-s*view.extent.height)/2;
drawScene(ctx,view,{s,ox,oy,h,origin:view.origin});
}
let board,image,decoded;
function point(p,t){return{x:t.ox+(p.x-t.origin.x)*t.s,y:t.h-t.oy-(p.y-t.origin.y)*t.s}}
`
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
/** Read-only drawing subset; string taxonomies are widened, physical shape/direction fields are retained. */
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
  if (!declarations.has('SceneVisualModel') || !declarations.has('UniversalExperimentSnapshot')) return contract
  const shared: Record<string, string[]> = {
    mechanics: ['bodies', 'vectors', 'trajectories', 'keyPoints', 'angles', 'dimensions', 'guides'],
    magnetic: ['particles', 'vectors', 'trajectories', 'guides', 'dimensions'],
    electric: ['particles', 'vectors', 'trajectories', 'guides', 'dimensions'],
    composite: ['particles', 'vectors', 'trajectories'], circuit: [],
    optics: ['dimensions', 'angles'], acoustics: ['guides', 'dimensions'],
    fluid: ['vectors', 'guides', 'dimensions'], thermal: ['guides'],
    induction: [], wave: ['trajectories', 'dimensions'], modern: ['overlay'],
  }
  const mechanicsFields: Record<string, string[]> = {
    incline: ['bodies', 'vectors', 'trajectories', 'angles', 'incline', 'ground', 'coordinate', 'motionMarks'],
    'hooke-law': ['bodies', 'vectors', 'spring', 'platform', 'apparatus'],
    'spring-oscillator': ['bodies', 'vectors', 'trajectories', 'spring', 'ground', 'platform', 'apparatus'],
    'simple-pendulum': ['bodies', 'vectors', 'trajectories', 'angles', 'pendulum', 'apparatus'],
    'lever-balance': ['vectors', 'dimensions', 'leverBeam', 'leverFulcrum', 'leverHangers'],
    'mechanical-energy': ['bodies', 'vectors', 'dimensions', 'energyRamp', 'energyBar'],
    'ramp-friction': ['bodies', 'vectors', 'dimensions', 'energyRamp', 'energyBar'],
  }
  const domainFields = domain === 'mechanics' && experimentId ? mechanicsFields[experimentId] : undefined
  const fields = new Set(['domain', 'extent', 'origin', 'visible', 'highlighted', 'labels',
    ...(domainFields ?? [...(shared[domain] ?? []), ...guide.split(':').slice(1).join(':').match(/[A-Za-z_$][\w$]*/g) ?? []])])
  const keepFields = (name: string, allowed: Set<string>): void => {
    declarations.set(name, declarations.get(name)!.split('\n').filter(line => {
      const field = /^([A-Za-z_$][\w$]*)\??:/.exec(line)?.[1]
      return field === undefined || allowed.has(field)
    }).join('\n'))
  }
  keepFields('SceneVisualModel', fields)
  keepFields('UniversalExperimentSnapshot', new Set(['source', 'domain', 'title', 'view', 'clock']))
  // Display taxonomies need no global enum roster; every actual value remains
  // valid. Direction/sign/nature and apparatus kind unions stay unchanged.
  for (const [name, declaration] of declarations) declarations.set(name, declaration
    .replace(/\b(?:PhysicsDomainId|PhysicsSemanticRole|ObservableKey)\b/g, 'string')
    .replace(/\breadonly\s+/g, ''))
  const selected = new Set<string>()
  const include = (name: string): void => {
    if (selected.has(name)) return
    const declaration = declarations.get(name)
    if (declaration === undefined) return
    selected.add(name)
    for (const word of declaration.match(/[A-Za-z_$][\w$]*/g) ?? []) if (declarations.has(word)) include(word)
  }
  include('UniversalExperimentSnapshot')
  const compact = (declaration: string): string => declaration
    .replace(/\n(?=[A-Za-z_$][\w$]*\??:)/g, ';')
    .replace(/\s+/g, ' ').replace(/\s*([:{};,|<>])\s*/g, '$1').replace(/\{;/g, '{').trim()
  const visibility: Record<string, string> = {
    mechanics: 'vectors/guides必须按view.visible[vector.observable]===true；不能读取vector.visible；trajectories/motionMarks按trajectory，keyPoints按keyPoints；angles/dimensions按已给几何绘制，杠杆dimensions另按arms。',
    magnetic: 'vectors/guides按visible[observable]===true；trajectory/center/radius/fieldLines分别控制对应层。',
    electric: 'vectors/guides按visible[observable]===true；electricField/equipotentials/trajectory控制对应层。',
    composite: 'vectors按visible[observable]===true；regions/electricField/magneticField/trajectory控制对应层；场符号裁剪到区域。',
    circuit: 'current控制chargeFlows，保留真实接线拓扑。',
    optics: 'rays/image控制对应光路与像；extension虚线；refractedTo缺省时不补造。',
    acoustics: 'wavefronts/path控制波前/声路；guides按visible[observable]===true。',
    fluid: 'forces/displaced/pressure/pressureComparison控制对应层；vectors/guides按visible[observable]===true。',
    thermal: 'thermometer/phase控制温度计/相态；guides按visible[observable]===true。',
    induction: 'barMotion/inductionCurrent/flux控制运动/电流/磁通层。inductionField.origin为左下角。',
    wave: 'waveform/nodes/superposition及vectors按对应visible[key]!==false。',
    modern: '轨迹是示意层，不检查visible.trajectory。',
  }
  const notes = [visibility[domain], fields.has('trajectories') ? 'trajectories.history实线/predicted虚线，保留点序。' : '',
    fields.has('incline') ? '存在incline.points时直接按incline.points顺序画多边形，不根据angle/base自行算顶点；点来自引擎，保留物体与坡面接触关系，缺失时不补造斜面。' : '',
    fields.has('boundedField') ? 'boundedField.at是中心；场符号裁剪到边界。' : ''].filter(Boolean).join('')
  return notes + '\nV3 drawing subset (read-only; string taxonomies omit enum lists):\n'
    + [...selected].map(name => compact(declarations.get(name)!)).join('\n')
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
