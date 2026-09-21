/**
 * Per-experiment teaching metadata — the structured summary every template
 * carries, keyed by template id (same pattern as `experiment-artwork.tsx`'s
 * SCENE_ID_BASES: template data lives beside the registry, not inside it).
 *
 * `coreModel` is a CONTRACT, not marketing copy: it must describe the model
 * the engine actually solves for that scene. A parity test requires every
 * selectable template to have an entry with all four sections non-empty —
 * an experiment whose honest model cannot be written down gets flagged the
 * same way a fake implementation would.
 */

/** What the experiment is, in the student's language. */
export interface ExperimentSummary {
  /** The model the engine solves (formulas + criterion), stated plainly. */
  readonly coreModel: string
  /** The knobs the scene exposes. */
  readonly parameters: readonly string[]
  /** What visibly responds when the model runs. */
  readonly feedback: readonly string[]
  /** Measurement error / model approximation the honest lab admits to. */
  readonly errors: readonly string[]
}

/** Curriculum anchor — which textbook chapter this experiment belongs to. */
export interface TextbookMapping {
  readonly edition: string
  readonly volume: string
  readonly chapter: string
  readonly topics: readonly string[]
}

/** Full metadata block for one template. */
export interface ExperimentMeta {
  readonly summary: ExperimentSummary
  readonly textbook?: readonly TextbookMapping[]
  /** Extra search terms (synonyms, exam keywords) the picker matches on. */
  readonly aliases?: readonly string[]
  /** Procedural steps for the 实验指南 overlay. */
  readonly guide?: readonly string[]
}

const PEP = '人教版 / 高中物理 / 2019'
const PEP_J = '人教版 / 初中物理 / 2012'

const hs = (volume: string, chapter: string, topics: readonly string[]): TextbookMapping => ({
  edition: PEP,
  volume,
  chapter,
  topics,
})
const js = (volume: string, chapter: string, topics: readonly string[]): TextbookMapping => ({
  edition: PEP_J,
  volume,
  chapter,
  topics,
})

/** Summary/metadata for every selectable template, keyed by `ExperimentTemplate.id`. */
export const EXPERIMENT_META: Readonly<Record<string, ExperimentMeta>> = {
  /* ----------------------------------------------------------- mechanics -- */

  'uniform-linear': {
    summary: {
      coreModel: 'x = x₀ + vt：v 恒定、a = 0，物体处于力的平衡状态。',
      parameters: ['质量 m', '初速度 v₀', '初始位置 x₀'],
      feedback: ['x–t 图是一条斜直线，斜率即速度', 'v–t 图是水平直线', '打点计时纸带等间距'],
      errors: ['匀速直线运动是理想模型，实际运动总有微小阻力', '打点间隔受采样精度限制'],
    },
    textbook: [js('八年级上册', '第一章 机械运动', ['运动的快慢', '速度'])],
    aliases: ['匀速', 'v=s/t', '速度', 's-t图', '平衡状态'],
    guide: ['运行实验，观察 x–t 图线的形状', '增大初速度 v₀，比较两条 x–t 图线的斜率', '查看数据页：任意相等时间内的位移是否相等'],
  },
  'average-speed': {
    summary: {
      coreModel: 'v̄ = s/t：小车沿缓坡由静止匀加速下滑，全程与前后半程分别计算平均速度——v̄全 ≠ (v̄上 + v̄下)/2。',
      parameters: ['小车质量 m', '加速度 a', '初始位置 x₀'],
      feedback: ['v–t 图是过原点的斜直线', '数据页可读出各段的 s 与 t'],
      errors: ['全程平均速度必须用总路程除以总时间，不能对分段值再平均', '停表反应时间是主要测量误差'],
    },
    textbook: [js('八年级上册', '第一章 机械运动', ['测量平均速度'])],
    aliases: ['平均速度', '测速', '斜面小车', '停表', 'v=s/t'],
    guide: ['运行实验，记下全程的 s 与 t，算 v̄全', '用单步把时间停在中点，再算前半程 v̄上', '比较 v̄全 与 (v̄上 + v̄下)/2，说明为什么不等'],
  },
  'uniform-acceleration': {
    summary: {
      coreModel: 'v = v₀ + at，x = x₀ + v₀t + ½at²：加速度恒定；把 a 调成 −g 就是竖直上抛。',
      parameters: ['初速度 v₀', '加速度 a', '初始位置 x₀', '质量 m'],
      feedback: ['v–t 图是斜直线，斜率即 a', 'x–t 图是抛物线', 'a–t 图是水平直线'],
      errors: ['a 与 v₀ 方向相反时要带符号运算', '图像斜率读数受坐标比例影响'],
    },
    textbook: [hs('必修第一册', '第二章 匀变速直线运动的研究', ['匀变速直线运动的速度与时间的关系', '位移与时间的关系'])],
    aliases: ['匀加速', '匀减速', '竖直上抛', 'v-t图', 'at', '自由落体', '自由落体运动', '重力加速度'],
    guide: ['运行实验，对比 v–t 斜率与 a 的数值', '把 a 改为负值，观察物体先减速再反向加速', '在数据页验证 v = v₀ + at 在每一时刻成立'],
  },
  'projectile-horizontal': {
    summary: {
      coreModel: 'x = v₀t，y = h − ½gt²：水平匀速与竖直自由落体的合成；落地时间 t = √(2h/g)，射程 R = v₀√(2h/g)。',
      parameters: ['初始高度 h', '初速度 v₀', '重力加速度 g', '抛射角 θ = 0'],
      feedback: ['轨迹是抛物线', 'x–t 线性增长、y–t 抛物线下降', '打点时间戳标出等时位置'],
      errors: ['水平与竖直两个分运动互不影响——v₀ 不改变落地时间', '忽略空气阻力'],
    },
    textbook: [hs('必修第二册', '第五章 抛体运动', ['实验：探究平抛运动的特点', '抛体运动的规律'])],
    aliases: ['平抛', '水平抛出', '抛物线', '落地时间', '射程'],
    guide: ['运行一次，观察轨迹与打点等时位置', '只改 v₀：落地时间不变、射程变长', '只改 h：验证 t = √(2h/g)'],
  },
  'projectile-oblique': {
    summary: {
      coreModel: 'x = v₀cosθ·t，y = v₀sinθ·t − ½gt²：斜上抛；射高 H = v₀²sin²θ/(2g)，射程 R = v₀²sin2θ/g（落点同高）。',
      parameters: ['初速度 v₀', '抛射角 θ', '重力加速度 g'],
      feedback: ['轨迹是开口向下的抛物线', '顶点处只剩水平分速度', '射程与射高随 θ 变化'],
      errors: ['45° 射程最大只在起止同高时成立', '互余角射程相等是理想情形'],
    },
    textbook: [hs('必修第二册', '第五章 抛体运动', ['抛体运动的规律'])],
    aliases: ['斜上抛', '斜抛', '射高', '射程', '45度', '互余角'],
    guide: ['保持 v₀ 不变，把 θ 从 30° 调到 60°，比较射程', '找最高点：此时竖直分速度为多少？', '验证 R = v₀²sin2θ/g'],
  },
  'newton-second-law': {
    summary: {
      coreModel: 'F = ma：水平拉力产生加速度，重力与支持力平衡；a = F/m 与质量成反比。',
      parameters: ['质量 m', '拉力 F', '重力加速度 g'],
      feedback: ['a–t 图是水平直线', 'v–t 图是斜直线', '受力标注显示合力方向'],
      errors: ['a 由合外力决定——水平方向拉力即合力时才等于 F/m', '本场景忽略摩擦力'],
    },
    textbook: [hs('必修第一册', '第四章 运动和力的关系', ['牛顿第二定律'])],
    aliases: ['牛二', 'F=ma', '加速度', '合外力'],
    guide: ['固定 F 改 m：a 如何变化？', '固定 m 改 F：验证 a ∝ F', '查看受力标注，确认竖直方向平衡'],
  },
  incline: {
    summary: {
      coreModel: 'a = g(sinθ − μcosθ)：重力沿斜面分力减滑动摩擦；μ ≥ tanθ 时物块静止或匀速。',
      parameters: ['质量 m', '倾角 θ', '摩擦系数 μ', '重力加速度 g'],
      feedback: ['重力分解为沿面与垂直面两个分量', 'a–t 恒定、v–t 线性', 'θ 或 μ 改变时加速度即时响应'],
      errors: ['μ ≥ tanθ 时滑不下来——静摩擦会取所需值而非最大值', '支持力 N = mgcosθ 不是 mg'],
    },
    textbook: [hs('必修第一册', '第四章 运动和力的关系', ['牛顿运动定律的应用', '受力分析'])],
    aliases: ['斜面', '受力分解', '摩擦力', '倾角', '下滑'],
    guide: ['运行并观察受力分解标注', '增大 θ：什么时候 a 变为正？验证 tanθ > μ', '增大 μ 到 0.6 以上，物块还下滑吗'],
  },
  'lever-balance': {
    summary: {
      coreModel: 'F₁L₁ = F₂L₂：力臂是支点到力的作用线的垂直距离；两侧力矩相等即平衡。',
      parameters: ['两侧钩码（力）', '两侧悬挂位置（力臂）'],
      feedback: ['杠杆保持水平表示平衡', '读数直接给出两侧力×臂的乘积'],
      errors: ['力臂不是支点到悬挂点的杆长——斜拉时要取垂直距离', '杠杆自重忽略'],
    },
    textbook: [js('八年级下册', '第十二章 简单机械', ['杠杆'])],
    aliases: ['杠杆', '力臂', '力矩', '平衡条件', 'F1L1=F2L2'],
    guide: ['移动一侧钩码位置直到杠杆平衡', '读出两侧 F×L，验证相等', '一侧加倍力，力臂减半，还平衡吗'],
  },
  'collision-elastic': {
    summary: {
      coreModel: 'Σmᵢvᵢ 与 Σ½mᵢvᵢ² 双守恒：等质量对心弹性碰撞后交换速度。',
      parameters: ['两球质量 m₁、m₂', '初速度 v₁、v₂', '恢复系数 e = 1'],
      feedback: ['碰撞瞬间速度交换', '事件页标出碰撞时刻', '动量与动能读数全程守恒'],
      errors: ['e = 1 是完全弹性理想情形', '边界碰撞同样按恢复系数处理'],
    },
    textbook: [hs('选择性必修第一册', '第一章 动量守恒定律', ['弹性碰撞和非弹性碰撞'])],
    aliases: ['弹性碰撞', '动量守恒', '动能守恒', '对心碰撞'],
    guide: ['运行并观察碰撞前后两球速度', '在事件页找到碰撞时刻核对读数', '改一个球的质量，还交换速度吗'],
  },
  'collision-inelastic': {
    summary: {
      coreModel: '动量守恒、动能有损失：e = 0.5 时碰后相对速度减半；v′ 由动量守恒与恢复系数联立解出。',
      parameters: ['两球质量 m₁、m₂', '初速度 v₁、v₂', '恢复系数 e = 0.5'],
      feedback: ['大球追小球碰后仍向前', '系统动量不变、总动能下降'],
      errors: ['损失的动能转化为内能/形变，不是算错了', '边界恢复系数独立设置'],
    },
    textbook: [hs('选择性必修第一册', '第一章 动量守恒定律', ['弹性碰撞和非弹性碰撞'])],
    aliases: ['非弹性碰撞', '恢复系数', '动量守恒', '动能损失'],
    guide: ['记录碰前总动能，碰后再看一次', '把 e 改成 0：两球行为怎样变？', '验证碰后相对速度 = e × 碰前相对速度'],
  },
  'collision-perfectly-inelastic': {
    summary: {
      coreModel: '完全非弹性碰撞：碰后两球粘合共速 v′ = (m₁v₁ + m₂v₂)/(m₁ + m₂)，动能损失最大。',
      parameters: ['两球质量 m₁、m₂', '初速度 v₁、v₂', '恢复系数 e = 0'],
      feedback: ['碰后两球同速同向', '动能读数出现最大降幅'],
      errors: ['动量仍守恒——损失的是动能不是动量'],
    },
    textbook: [hs('选择性必修第一册', '第一章 动量守恒定律', ['弹性碰撞和非弹性碰撞'])],
    aliases: ['完全非弹性碰撞', '共速', '粘合', '动量守恒'],
    guide: ['验证共速值 = 总动量 ÷ 总质量', '算一算动能损失占原来的比例', '与弹性碰撞实验对比同一组初条件'],
  },
  'vt-area': {
    summary: {
      coreModel: 'x = v₀t + ½at² 与 v = v₀ + at：匀变速直线运动的 v–t 图是斜直线，图线与 t 轴围成的梯形面积在数值上等于位移。',
      parameters: ['初速度 v₀', '加速度 a', '质量 m'],
      feedback: ['v–t 图为过 (0, v₀) 的斜直线', 'x–t 图为抛物线', '数据页 s 列与图线梯形面积数值一致'],
      errors: ['图线斜率是加速度不是速度', 'v–t 面积为代数面积——图线在 t 轴下方时位移为负'],
    },
    textbook: [hs('必修第一册', '第二章 匀变速直线运动的研究', ['匀变速直线运动的位移与时间的关系'])],
    aliases: ['v-t图', '图像面积', '位移', '匀变速', 'x-t图'],
    guide: ['运行实验，在图表页看 v–t 图线', '用 v₀、a、t 手算梯形面积，与数据页位移列比对', '把 a 调为 0，图线变成什么形状？面积还等于位移吗？'],
  },
  'force-composition': {
    summary: {
      coreModel: 'F_合 = F₁ + F₂（矢量加）→ a = F_合/m：3 N 与 4 N 正交合成 5 N 合力，物块沿合力方向加速。',
      parameters: ['质量 m', 'F₁ = 3 N（+x 方向）', 'F₂ = 4 N（+y 方向）'],
      feedback: ['F₁、F₂ 两支力箭头与 ΣF 合力箭头同屏显示', '加速度方向即合力方向', '派生量合力读数为 5 N'],
      errors: ['力是矢量——不能直接 3 + 4 = 7', 'mg 与 N 竖直平衡，不参与水平合成'],
    },
    textbook: [hs('必修第一册', '第三章 相互作用——力', ['力的合成和分解'])],
    aliases: ['力的合成', '平行四边形', '合力', '矢量加法', '分力'],
    guide: ['看 F₁、F₂ 两支箭头的方向与相对长短', '验证派生量：|ΣF| = √(3² + 4²) = 5 N', '加速度方向角应为 arctan(4/3) ≈ 53°'],
  },
  'concurrent-equilibrium': {
    summary: {
      coreModel: 'ΣF = 0 → a = 0：三个互成 120° 的 8 N 共点力矢量和为零，物块保持静止——平衡条件的直接演示。',
      parameters: ['质量 m', 'F₁ = 8 N（+x）', 'F₂、F₃ 各 8 N（与 F₁ 成 ±120°）'],
      feedback: ['三支力箭头对称分布', '物块全程静止', '派生量加速度读数为 0'],
      errors: ['共点力平衡要求矢量和为零，不是标量和为零', '静止与匀速直线运动都是平衡态（此处演示静止情形）'],
    },
    textbook: [hs('必修第一册', '第三章 相互作用——力', ['共点力的平衡'])],
    aliases: ['共点力', '力的平衡', '三力平衡', '平衡条件', 'ΣF=0'],
    guide: ['观察三支力箭头的几何关系（互成 120°）', '验证 ΣF 各分量均为 0', '把其中一力去掉（想象），物块会往哪边动？'],
  },
  'apparent-weight': {
    summary: {
      coreModel: 'N = m(g + a_y)：电梯加速上升时支持力大于重力（超重）；a_y < 0 为失重，a_y = −g 时 N = 0 完全失重。',
      parameters: ['质量 m = 60 kg', '竖直加速度 a = 2 m/s²', '初速度 v₀ = 1 m/s'],
      feedback: ['物块竖直上升', '派生量「视重（支持力）」读数为 m(g+a) = 708 N > mg = 588 N'],
      errors: ['视重是支持力/秤读数，不是重力本身——mg 不变', '超重看加速度方向，与运动方向无关（减速下降同样超重）'],
    },
    textbook: [hs('必修第一册', '第四章 运动和力的关系', ['超重和失重'])],
    aliases: ['超重', '失重', '视重', '电梯', '支持力', '完全失重'],
    guide: ['读派生量「视重（支持力）」并与 mg 比较', '想象 a_y 调为 −g：读数应为多少？', '为什么减速下降的电梯里人也感觉变重？'],
  },
  'chase-meeting': {
    summary: {
      coreModel: 'x₁ = x₀₁ + v₁t，x₂ = x₀₂ + v₂t：相遇条件 x₁ = x₂ → t = 4/(3−1) = 2 s，在 x = 2 m 处追上。两球分处两条车道，引擎只做真实运动学不做碰撞。',
      parameters: ['追者 v₁ = 3 m/s（落后 4 m）', '前者 v₂ = 1 m/s', '两车道间距 1.4 m'],
      feedback: ['双车各自匀速行驶', 'x–t 图两条直线相交即相遇点', '轨迹双车道平行'],
      errors: ['相遇是位置相等不是速度相等', '若 v₁ ≤ v₂ 永远追不上——相对位移不缩小'],
    },
    textbook: [hs('必修第一册', '第二章 匀变速直线运动的研究', ['匀变速直线运动的速度与时间的关系'])],
    aliases: ['追及', '相遇', '相遇问题', '追赶', '相对运动'],
    guide: ['运行实验，找到 x–t 图两线交点', '用 Δx/Δv = 4/2 手算相遇时间并比对', '若前车同样 3 m/s，图线会怎样？'],
  },
  'hooke-law': {
    summary: {
      coreModel: 'kΔx = mg：钩码静止悬挂时弹力与重力平衡，Δx = mg/k 与质量成正比——改 m 或 k，伸长量与弹力读数同步变化。',
      parameters: ['劲度系数 k', '悬挂质量 m', '重力加速度 g'],
      feedback: ['弹簧长度随钩码质量伸缩', '派生量给出 Δx 与弹力 F', '验证行检查 kΔx = mg 与悬点位置'],
      errors: ['超出弹性限度 F = kx 不再成立（本模型始终假设弹性限度内）', '弹簧自身质量忽略'],
    },
    textbook: [hs('必修第一册', '第三章 相互作用——力', ['重力与弹力', '实验：探究弹簧弹力与形变量的关系'])],
    aliases: ['胡克定律', '弹簧', '弹力', '形变量', 'k值', '弹簧测力计'],
    guide: ['记录派生量中的 Δx 与 F，验证 F = kΔx', '把 m 加倍：Δx 是否也加倍？', '把 k 减半再观察——k 的物理意义是什么？'],
  },
  'spring-oscillator': {
    summary: {
      coreModel: 'F = −kx → x = x_eq + A·cos(ωt + φ)，ω = √(k/m)：回复力驱动下的简谐振动，周期 T = 2π√(m/k) 与振幅无关。',
      parameters: ['振子质量 m', '劲度系数 k', '振幅 A', '重力加速度 g'],
      feedback: ['滑块在平衡位置两侧往复', 'x–t 图是正弦曲线', '弹簧随伸长量实时伸缩', '派生量给出 T、ω、回复力'],
      errors: ['模型假设光滑水平面（无摩擦）与理想弹簧', '大振幅下真实弹簧会偏离线性'],
    },
    textbook: [hs('选择性必修第一册', '第二章 机械振动', ['简谐运动', '简谐运动的描述'])],
    aliases: ['弹簧振子', '简谐', '振动', '周期', '回复力', 'SHM'],
    guide: ['运行实验，数一个完整往复对应 x–t 图的一个周期', '把 m 改为 4 倍：T 变几倍？验证 T ∝ √m', '把 A 加倍：T 变吗？体会「等时性」'],
  },
  'simple-pendulum': {
    summary: {
      coreModel: 'θ = θ₀·cos(ωt)，T = 2π√(L/g)：小角近似下单摆做简谐运动，周期只由摆长与 g 决定。',
      parameters: ['摆球质量 m', '摆长 L', '摆角 θ₀', '重力加速度 g'],
      feedback: ['摆球沿弧线往复', 'x–t / v–t 图呈周期性', '派生量给出 T 与摆线张力'],
      errors: ['θ₀ 较大时小角近似失真（真实周期略长）', '忽略空气阻力与摆线质量'],
    },
    textbook: [hs('选择性必修第一册', '第二章 机械振动', ['单摆', '实验：用单摆测量重力加速度'])],
    aliases: ['单摆', '摆', '摆长', '周期', '测重力加速度'],
    guide: ['改摆长 L：T 怎么变？验证 T ∝ √L', '改质量 m：T 变吗——为什么？', '用 T 与 L 反算 g，与场景设定值比较'],
  },
  'friction-static': {
    summary: {
      coreModel: 'f_静 = F ≤ μ_s N，滑动后 f_动 = μ_k N：拉力以 2 N/s 渐增，t = μsN/2 s 时物块起滑，摩擦力在滑动瞬间从 9.8 N 突降为 5.88 N。',
      parameters: ['物块质量 m', '拉力（渐增）', '静摩擦系数 μs', '动摩擦系数 μk', '重力加速度 g'],
      feedback: ['静止段 f 随 F 同步增大', '起滑瞬间 f 突降、物块开始加速', '数据页可读最大静摩擦与滑动摩擦', '验证行检查静段平衡与滑动段 a = (F−μkN)/m'],
      errors: ['本模型 μs 是精确阈值；真实接触面有 creep 与速度依赖', '拉力线性增长是实验协议假设'],
    },
    textbook: [js('八年级下册', '第八章 运动和力', ['摩擦力']), hs('必修第一册', '第三章 相互作用——力', ['摩擦力'])],
    aliases: ['静摩擦', '滑动摩擦', '摩擦力', '最大静摩擦', 'μs', 'μk', '测力计'],
    guide: ['运行实验，找到 f 突降的时刻——此时拉力多大？', '验证最大静摩擦 = μsN', '把 μs 调大：起滑时刻如何变化？'],
  },
  'friction-mu': {
    summary: {
      coreModel: '恒定拉力下滑动：f = μkN、a = (F − f)/m。数据页直接给出 f 与 N，由 μk = f/N 反算动摩擦因数。',
      parameters: ['物块质量 m', '拉力 F', '动摩擦系数 μk', '重力加速度 g'],
      feedback: ['物块立即起滑并匀加速', '派生量给出 f、N 与滑动时刻', 'v–t 是斜直线'],
      errors: ['μk 假设与速度无关', '读数取滑动段的 f——静止段的 f = F 不能用'],
    },
    textbook: [js('八年级下册', '第八章 运动和力', ['摩擦力'])],
    aliases: ['动摩擦因数', '测摩擦', 'μk', '摩擦系数测量'],
    guide: ['运行实验，在派生量读 f 与 N', '用 μk = f/N 算出动摩擦因数，与设定值比较', '改 F：f 变吗？体会 f 与拉力无关'],
  },

  /* ------------------------------------------------------------ electric -- */

  'point-charge': {
    summary: {
      coreModel: 'E = kQ/r²：点电荷的球对称电场；检验点处场强与电势随距离平方反比变化。',
      parameters: ['源电荷 Q', '检验点位置'],
      feedback: ['场线从正电荷向外辐射', '等势面是以电荷为心的同心圆', '检验点读数随 r 变化'],
      errors: ['点电荷是理想模型', '场线密度是示意，读数以 E = kQ/r² 为准'],
    },
    textbook: [hs('必修第三册', '第九章 静电场及其应用', ['电场 电场强度'])],
    aliases: ['点电荷', '库仑定律', '场强', '等势面', 'kQ/r2'],
    guide: ['把检验点向远处拖，看 E 怎么变', '把 Q 变负，场线方向怎样', '读出 2r 处的 E 与 r 处的比值'],
  },
  'multi-point-charge': {
    summary: {
      coreModel: 'E⃗ = ΣkQᵢr̂ᵢ/rᵢ²：多个点电荷的场按矢量叠加；等量异号电荷中垂线上场强有特征分布。',
      parameters: ['各源电荷 Qᵢ 与位置', '检验点位置'],
      feedback: ['两组场线相互作用变形', '检验点读数是矢量和'],
      errors: ['场强是矢量叠加，不能直接把大小相加', '电势是标量可以直接相加'],
    },
    textbook: [hs('必修第三册', '第九章 静电场及其应用', ['电场 电场强度', '电场的叠加'])],
    aliases: ['电偶极子', '场叠加', '等量异号电荷', '中垂线'],
    guide: ['把检验点放在两电荷中垂线上，看合场方向', '把检验点移到连线中点：E 是多少', '把其中一个电荷改同号，场线怎么变'],
  },
  'uniform-electric': {
    summary: {
      coreModel: 'a = qE/m：带电粒子以水平初速进入竖直匀强电场，做类平抛运动；偏转量 y = qEt²/(2m)。',
      parameters: ['电荷量 q', '质量 m', '初速度 v₀', '场强 E 与方向'],
      feedback: ['轨迹是抛物线（电学版平抛）', '速度竖直分量线性增长'],
      errors: ['只计电场力，忽略重力（粒子尺度成立）', '匀强场限定了极板间区域'],
    },
    textbook: [hs('必修第三册', '第十章 静电场中的能量', ['带电粒子在电场中的运动'])],
    aliases: ['匀强电场', '类平抛', '偏转', 'qE'],
    guide: ['对比本实验与平抛运动的轨迹形状', 'E 加倍：偏转量如何变', '把 q 改负：抛物线朝哪边弯'],
  },
  'parallel-plate': {
    summary: {
      coreModel: 'E = U/d：平行板间匀强电场中的偏转，y = qUL²/(2dmv₀²)，出射后匀速直线到屏。',
      parameters: ['板间电压 U', '板距 d', '粒子 q/m/v₀'],
      feedback: ['板内抛物线、板外直线两段轨迹', '屏上偏移量随 U 线性变化'],
      errors: ['偏转量以引擎发布的 deflection 为准', '边缘场忽略'],
    },
    textbook: [hs('必修第三册', '第十章 静电场中的能量', ['带电粒子在电场中的运动', '示波管原理'])],
    aliases: ['平行板', '电容器', '偏转', '示波管', 'U/d'],
    guide: ['调 U：屏上偏移量与 U 成正比吗', '调 d：E = U/d 怎么变', '增大 v₀：偏转为什么变小'],
  },

  /* ------------------------------------------------------------ magnetic -- */

  'magnetic-circular': {
    summary: {
      coreModel: 'qvB = mv²/r：洛伦兹力提供向心力，r = mv/(qB)、T = 2πm/(qB) 与速度无关。',
      parameters: ['电荷 q', '质量 m', '速率 v', '磁感应强度 B 与方向'],
      feedback: ['轨迹是完整圆周', '半径随 v、B 即时变化', '周期读数与 v 无关'],
      errors: ['洛伦兹力不做功——速率不变只改方向', 'v⊥B 才有圆周，平行分量会成螺旋线'],
    },
    textbook: [hs('选择性必修第二册', '第一章 磁场对运动电荷的作用力', ['带电粒子在匀强磁场中的运动'])],
    aliases: ['洛伦兹力', '圆周运动', '回旋半径', 'r=mv/qB'],
    guide: ['把 v 加倍：半径怎样变、周期变吗', '把 B 加倍：半径怎样变', '换粒子电性：旋转方向怎样'],
  },

  /* ------------------------------------------------------------- circuit -- */

  'series-circuit': {
    summary: {
      coreModel: '串联：I 处处相等，U = ΣUᵢ，R = ΣRᵢ；分压与电阻成正比。',
      parameters: ['电源电压', '各电阻阻值'],
      feedback: ['电流表读数处处相同', '各电阻电压按阻值分配', '开关断开整条回路归零'],
      errors: ['电流表内阻忽略', '导线电阻忽略'],
    },
    textbook: [js('九年级全一册', '第十五章 电流和电路', ['串联和并联']), js('九年级全一册', '第十七章 欧姆定律', ['电阻的串联'])],
    aliases: ['串联', '电流规律', '分压', '串并联'],
    guide: ['读出电流表与各电阻电压', '验证 U总 = U₁ + U₂', '拨动开关：整个电路同时断电'],
  },
  'parallel-circuit': {
    summary: {
      coreModel: '并联：U 各支路相等，I干 = ΣIᵢ，1/R = Σ1/Rᵢ；分流与电阻成反比。',
      parameters: ['电源电压', '各支路电阻'],
      feedback: ['各支路电压相同', '干路电流等于支路之和', '断一支路其余不受影响'],
      errors: ['支路互不影响的前提是电源无内阻'],
    },
    textbook: [js('九年级全一册', '第十五章 电流和电路', ['串联和并联']), js('九年级全一册', '第十七章 欧姆定律', ['电阻的并联'])],
    aliases: ['并联', '分流', '支路', '干路', '串并联'],
    guide: ['比较各支路电流与电阻的关系', '验证 I干 = I₁ + I₂', '断开一个支路开关，看另一支路'],
  },
  'mixed-circuit': {
    summary: {
      coreModel: '混联：先并后串（或反之）分步等效；从最远端向电源逐步合并电阻。',
      parameters: ['电源电压', '各电阻阻值'],
      feedback: ['总电流随等效电阻变化', '并联部分两端电压相同'],
      errors: ['等效顺序错了结果就错——先认清拓扑再合并'],
    },
    textbook: [js('九年级全一册', '第十七章 欧姆定律', ['欧姆定律', '电阻的串并联'])],
    aliases: ['混联', '等效电阻', '复杂电路'],
    guide: ['先找并联部分合并成一个等效电阻', '再与串联部分相加得总电阻', '验证 I = U/R总'],
  },
  'rheostat-circuit': {
    summary: {
      coreModel: '滑动变阻器分压：R接入 = Rmax·(滑片位置)，I = U/(R定 + R接入)；滑片推到哪里，电流就改变多少。',
      parameters: ['电源电压', '定值电阻', '变阻器总阻值', '滑片位置'],
      feedback: ['滑片拖动时电流表、电压表实时变化', '电流流向箭头随解更新', '图表随参数同步重画'],
      errors: ['滑片两端都有阻值——注意接入的是哪一段', '线性电阻网络，无接触电阻'],
    },
    textbook: [js('九年级全一册', '第十六章 电压 电阻', ['变阻器'])],
    aliases: ['滑动变阻器', '滑片', '变阻', '限流', '滑变'],
    guide: ['直接拖动画布上的滑片，看电流表怎么变', '把滑片推到 0 和 100%，读出两个极端电流', '换用键盘方向键微调滑片（±5%）'],
  },
  'va-resistance': {
    summary: {
      coreModel: '伏安法测电阻：R = U/I；移动滑片取多组 (U, I) 求平均，内接/外接有系统误差。',
      parameters: ['电源电压', '待测电阻 Rx', '变阻器总阻值', '滑片位置'],
      feedback: ['每组滑片位置对应一组 U、I 读数', 'R = U/I 在各组读数下应基本不变'],
      errors: ['电流表内接测的是 Rx + RA，外接测的是 Rx∥RV——系统误差方向要会判断', '多读几组取平均减小偶然误差'],
    },
    textbook: [js('九年级全一册', '第十七章 欧姆定律', ['电阻的测量'])],
    aliases: ['伏安法', '测电阻', '内接', '外接', 'Rx'],
    guide: ['移动滑片取三组 (U, I)，分别算 R', '三组 R 一致吗？差在哪', '想想内接和外接各测大了还是测小了'],
  },
  'bulb-power': {
    summary: {
      coreModel: 'P = UI：调节滑片使灯泡两端达到额定电压，读出电流即得额定功率；实际功率随实际电压变。',
      parameters: ['电源电压', '灯泡等效电阻', '变阻器总阻值', '滑片位置'],
      feedback: ['电压表读数随滑片变化', 'P = UI 即时可算', '灯越亮表示实际功率越大'],
      errors: ['本模型把灯泡当定值电阻——真实灯丝电阻随温度变化', '额定功率只在额定电压下成立'],
    },
    textbook: [js('九年级全一册', '第十八章 电功率', ['测量小灯泡的电功率'])],
    aliases: ['电功率', '额定功率', '小灯泡', 'P=UI'],
    guide: ['把滑片调到电压表读数为额定值，读 I 算 P', '电压低于额定值时，实际功率偏大还是偏小', '为什么真实灯泡的电阻不是定值'],
  },
  'emf-measurement': {
    summary: {
      coreModel: 'E = U + Ir：路端电压随负载电流线性下降；U–I 拟合的截距是 E、斜率绝对值是 r。',
      parameters: ['电动势 E', '内阻 r', '外电阻 R'],
      feedback: ['R 变化时 U 与 I 沿一条直线移动', '短路 I = E/r、开路 U = E'],
      errors: ['电压表分流带来系统误差——测的 E、r 都偏小', '数据点太少拟合不稳'],
    },
    textbook: [hs('必修第三册', '第十二章 电能 能量守恒定律', ['实验：电池电动势和内阻的测量'])],
    aliases: ['电动势', '内阻', '闭合电路', '路端电压', 'U-I图'],
    guide: ['改变 R 记录几组 (I, U)', '在图像页看 U–I 直线的截距与斜率', 'R = r 时输出功率最大——找一找'],
  },

  /* -------------------------------------------------------------- optics -- */

  'plane-mirror': {
    summary: {
      coreModel: '平面镜成等大、正立虚像，像距 = 物距；反射光线的反向延长线交于像点。',
      parameters: ['物体（蜡烛）位置', '镜面位置'],
      feedback: ['镜后出现对称虚像', '光屏放在像的位置也接不到像', '反射光线与反向延长线可观察'],
      errors: ['虚像不是光实际会聚——光屏承接法可证', '玻璃板有厚度会成两个微弱像'],
    },
    textbook: [js('八年级上册', '第四章 光现象', ['平面镜成像'])],
    aliases: ['平面镜', '虚像', '等大等距', '成像', '光的反射', '反射定律'],
    guide: ['移动蜡烛，看像的位置和大小怎么变', '把光屏放到像的位置：能接到吗', '量一量物距与像距'],
  },
  'convex-lens': {
    summary: {
      coreModel: '1/f = 1/u + 1/v：u > 2f 倒立缩小实像、u = 2f 等大、f < u < 2f 放大、u = f 不成像、u < f 正立放大虚像。',
      parameters: ['焦距 f', '物距 u'],
      feedback: ['物距扫过 2f 与 f 时像的性质突变', '光屏只在实像位置接得到像', '三条特殊光线交于像点'],
      errors: ['虚像要透过透镜观察，光屏接不到', 'u = f 是成像与否的分界，不是"放大"'],
    },
    textbook: [js('八年级上册', '第五章 透镜及其应用', ['凸透镜成像的规律'])],
    aliases: ['凸透镜', '成像规律', '焦距', '实像', '虚像', '照相机', '放大镜', '折射', '光的折射'],
    guide: ['把 u 从大于 2f 逐步调小，记录每个区间的像', 'u = f 时发生了什么', 'u < f 时光屏接不到像——像在哪里'],
  },
  'concave-mirror': {
    summary: {
      coreModel: '凹面镜与凸透镜同公式 1/f = 1/u + 1/v，但实像成在镜前同一侧；u 扫过 2f、f 复现整张成像表。',
      parameters: ['焦距 f', '物距 u'],
      feedback: ['镜前成倒立实像', 'f 调成负值即变凸面镜', '特殊光线（过心、平行、过焦）可追踪'],
      errors: ['球面镜是近轴近似——边缘光线有球差'],
    },
    textbook: [js('八年级上册', '第四章 光现象', ['光的反射'])],
    aliases: ['凹面镜', '球面镜', '会聚', '太阳灶', '光的反射'],
    guide: ['u > 2f 时镜前成什么像', '把 f 改成负值：成像性质变成哪种镜子', '找出使像与物等大的物距'],
  },
  'convex-mirror': {
    summary: {
      coreModel: '凸面镜 f < 0：无论物距多大，永远成正立缩小虚像——视野变大正是后视镜用它的原因。',
      parameters: ['焦距 f（负）', '物距 u'],
      feedback: ['像永远正立缩小', '光屏永远接不到', '可见视野范围随镜面弯曲变宽'],
      errors: ['"物体比看起来更近"——缩小虚像让距离估计失真', '虚像位置可用 f 为负的成像公式计算'],
    },
    textbook: [js('八年级上册', '第四章 光现象', ['光的反射', '球面镜'])],
    aliases: ['凸面镜', '后视镜', '发散', '视野', '光的反射'],
    guide: ['拖动物距：像的性质变过吗', '与凹面镜对比同一物距下的成像', '解释为什么汽车后视镜是凸面镜'],
  },

  /* ----------------------------------------------------------- acoustics -- */

  'echo-ranging': {
    summary: {
      coreModel: 'd = v·t/2：声波往返峭壁一次，单程距离是总路程的一半；v 取介质对应声速。',
      parameters: ['峭壁距离', '介质（决定声速）'],
      feedback: ['声波去程与回程分两段动画', '回声时间随距离线性变化'],
      errors: ['计时误差直接翻倍进距离', '温度改变声速——15 ℃ 空气取 340 m/s'],
    },
    textbook: [js('八年级上册', '第二章 声现象', ['声音的产生与传播', '声速'])],
    aliases: ['回声', '测距', '声速', 's=vt/2', '声音', '声学'],
    guide: ['记录发出与听到回声的时差', '用 d = vt/2 验算峭壁距离', '换一种介质，回声时间怎么变'],
  },

  /* --------------------------------------------------------------- fluid -- */

  buoyancy: {
    summary: {
      coreModel: 'F浮 = ρ液gV排 = G − F拉：称重法与阿基米德原理互相验证；全浸后浮力与深度无关。',
      parameters: ['物块质量与体积', '液体密度', '下放深度'],
      feedback: ['弹簧测力计读数随浸入体积减小', '全浸后读数不再随深度变', 'F浮 = G − F拉 可直接验证'],
      errors: ['"越深浮力越大"是错觉——全浸后 V排 不再变', '读数差法要求物块不触底'],
    },
    textbook: [js('八年级下册', '第十章 浮力', ['浮力', '阿基米德原理'])],
    aliases: ['浮力', '阿基米德', '称重法', '溢水法', 'F浮', '浮沉', '浮沉条件'],
    guide: ['把铝块缓慢下放，看测力计读数什么时候停止变化', '算 F浮 = G − F拉，再对 ρ液gV排 验算', '换成盐水：同一深度浮力怎么变'],
  },

  /* ------------------------------------------------------------- thermal -- */

  'crystal-melting': {
    summary: {
      coreModel: 'Q = cmΔT + λm：晶体熔化过程中持续吸热但温度保持熔点不变——图像出现水平段。',
      parameters: ['冰的质量', '加热功率', '熔化热 λ'],
      feedback: ['T–t 图像出现明显水平段', '熔化段吸热全部用于破坏晶格', 'λ 改为 0 即退化为非晶体'],
      errors: ['水平段不是"没吸热"，是吸热不升温', '容器吸热与散热忽略'],
    },
    textbook: [js('八年级上册', '第三章 物态变化', ['熔化和凝固'])],
    aliases: ['熔化', '晶体', '熔点', '冰', '水平段', '凝固', '物态变化'],
    guide: ['找出 T–t 图上的水平段：对应什么过程', '比较升温段与熔化段的时长', '把 λ 调成 0：水平段还在吗'],
  },
  'heat-capacity-comparison': {
    summary: {
      coreModel: 'Q = cmΔT：等质量不同物质吸相同热量，ΔT 与比热容 c 成反比——水升温慢因为 c 大。',
      parameters: ['两种液体的质量与比热容', '加热功率', '加热时间'],
      feedback: ['两支温度计升温快慢对比', '相同 Q 下 ΔT 反比于 c'],
      errors: ['散热损失使实际 ΔT 略低于理想值', '搅拌不均匀带来局部温差'],
    },
    textbook: [js('九年级全一册', '第十三章 内能', ['比热容'])],
    aliases: ['比热容', '吸热能力', '水和煤油', 'Q=cmΔT'],
    guide: ['同时加热等质量的水和煤油，比较 ΔT', '验证 ΔT水/ΔT煤油 ≈ c煤油/c水', '解释为什么海边昼夜温差小'],
  },

  /* ----------------------------------------------------------- composite -- */

  'velocity-selector': {
    summary: {
      coreModel: 'qE = qvB ⇒ v = E/B：只有满足该速率的粒子直线通过正交电磁场，与 q、m 无关。',
      parameters: ['场强 E', '磁感应强度 B', '入射速度 v₀', '区域尺寸'],
      feedback: ['v₀ = E/B 时轨迹笔直', '偏离选择速度即向上或向下偏', '改变 q/m 不影响选择条件'],
      errors: ['电场力与磁场力必须真的反向——B 的方向决定能否抵消', '选择性与电荷、质量无关是结论不是近似'],
    },
    textbook: [hs('选择性必修第二册', '第一章 磁场对运动电荷的作用力', ['质谱仪与回旋加速器'])],
    aliases: ['速度选择器', '正交场', 'v=E/B', '滤速器'],
    guide: ['默认参数下粒子直线通过——验证 v₀ = E/B', '把 v₀ 调大：向哪边偏？哪份力赢了', '换 B 的方向：还能直线吗'],
  },
  'mass-spectrometer': {
    summary: {
      coreModel: '先经速度选择器 v = E/B，再入纯磁场做半圆偏转 r = mv/(qB)：落点距离分离同位素。',
      parameters: ['选择区 E/B', '偏转区 B', '粒子 q/m/v'],
      feedback: ['两段区域轨迹明显不同：直线 + 半圆', '落点位置随 m 变化', 'r = mv/(qB) 可验证'],
      errors: ['落点测的是直径 2r 不是 r', '边缘进入角差会散焦'],
    },
    textbook: [hs('选择性必修第二册', '第一章 磁场对运动电荷的作用力', ['质谱仪与回旋加速器'])],
    aliases: ['质谱仪', '同位素', '半圆偏转', '荷质比'],
    guide: ['认出轨迹哪段在选择区、哪段在偏转区', '把 m 加倍：落点怎么移', '由落点直径反推 m'],
  },
  'composite-eb': {
    summary: {
      coreModel: '正交 E、B 叠加：qE 与 qv×B 的矢量和决定轨迹；v₀ = E/B 附近出现漂移与摆线类运动。',
      parameters: ['E 与方向', 'B 与方向', 'q/m/v₀'],
      feedback: ['轨迹不是单纯圆或抛物线——两种力逐时叠加', 'v₀ 改变即打破平衡'],
      errors: ['洛伦兹力随速度方向变化——不能按恒力套', '合力逐点重算，不是初态值'],
    },
    textbook: [hs('选择性必修第二册', '第一章 磁场对运动电荷的作用力', ['带电粒子在复合场中的运动'])],
    aliases: ['复合场', 'E+B', '交叉场', '漂移'],
    guide: ['v₀ = E/B 时轨迹接近直线——为什么', 'v₀ 翻倍后轨迹成什么形', '把 E 关掉对比纯磁场圆周'],
  },
  'composite-ebg': {
    summary: {
      coreModel: '重力 + 电场 + 磁场三力叠加：可用等效重力场法把恒力合成一个等效 g′，再叠加洛伦兹力。',
      parameters: ['E、B、g 及方向', 'q/m/v₀'],
      feedback: ['重力可见性开关单独控制', '轨迹是三力逐时合成的结果'],
      errors: ['等效重力法只合并恒力——洛伦兹力随 v 变不能并入'],
    },
    textbook: [hs('选择性必修第二册', '第一章 磁场对运动电荷的作用力', ['带电粒子在复合场中的运动'])],
    aliases: ['三场', 'E+B+g', '等效重力'],
    guide: ['开关重力可见性，看轨迹差别', '先用等效重力思路预判偏转方向', '比较 composite-eb 与本实验的轨迹'],
  },
  'multi-region-field': {
    summary: {
      coreModel: '分区场：粒子依次穿过不同场区，每区内按该区场型运动，边界处速度连续、受力突变。',
      parameters: ['各区 E/B 配置', '区域尺寸', 'q/m/v₀'],
      feedback: ['轨迹在不同区域呈现不同曲率', '穿界瞬间受力方向突变'],
      errors: ['出射角由上一段轨迹决定——逐段求解不能跳步'],
    },
    textbook: [hs('选择性必修第二册', '第一章 磁场对运动电荷的作用力', ['带电粒子在复合场中的运动'])],
    aliases: ['多区域', '分区场', '组合场'],
    guide: ['指出每个区域用的是哪种场模型', '追踪粒子穿过边界时的速度变化', '改一个区域的场强，后续轨迹怎样连锁变化'],
  },
  cyclotron: {
    summary: {
      coreModel: '回旋加速器：D 盒内 r = mv/(qB) 半圆回旋、盒缝交变电场同步加速；回旋周期 T = 2πm/(qB) 与 v 无关——等时性是它能加速的根本。',
      parameters: ['磁场 B', '交变电压频率', '粒子 q/m'],
      feedback: ['本实验需要时变交变电场——当前引擎只支持静态匀强场，故标注"即将支持"而非给出错误轨迹'],
      errors: ['相对论效应限制了最大能量——v 接近 c 时等时性失效'],
    },
    textbook: [hs('选择性必修第二册', '第一章 磁场对运动电荷的作用力', ['质谱仪与回旋加速器'])],
    aliases: ['回旋加速器', 'D形盒', '等时性'],
  },

  /* ----------------------------------------------------------- induction -- */

  'induction-bar-motion': {
    summary: {
      coreModel: 'ε = BLv，I = ε/(R + r)：切割磁感线产生感应电流，安培力反向形成阻尼——v 按指数衰减，动能转化为焦耳热。',
      parameters: ['磁感应强度 B', '棒长 L', '回路电阻 R + r', '棒的初速度/外力'],
      feedback: ['速度越大电流越大', '安培力使棒减速——v–t 曲线变缓', '电流流向随运动方向判定'],
      errors: ['收尾速度条件：安培力 = 外力时才匀速', '导轨电阻与接触电阻已并入 r'],
    },
    textbook: [hs('选择性必修第二册', '第二章 电磁感应', ['法拉第电磁感应定律', '电磁感应中的动力学问题'])],
    aliases: ['单棒', '导轨', '切割磁感线', 'BLv', '收尾速度', '安培力', '发电机', '感应电流'],
    guide: ['给棒一个初速度，看 v–t 曲线形状', '算一算：什么时候安培力与外力平衡', '改 B 或 L，看收尾速度怎么变'],
  },
  'induction-double-bar-momentum': {
    summary: {
      coreModel: '双棒无外力：安培力是系统内力 → 动量守恒，共速 v = m₁v₀/(m₁+m₂)；相对速度 u(t) = u₀·e^(−t/τ)，τ = R·m₁m₂/(B²L²(m₁+m₂))。',
      parameters: ['B、L、R', '两棒质量 m₁、m₂', '初速度 v₁、v₂'],
      feedback: ['前棒减速、后棒加速直至共速', '回路电流随相对速度衰减', '两棒永不相撞（间距只增不减）'],
      errors: ['间距增大会让后棒看似"追不上"——相对位移有上限', '引擎不建模碰撞，初位形要保证不相撞'],
    },
    textbook: [hs('选择性必修第二册', '第二章 电磁感应', ['电磁感应中的动力学问题', '动量守恒在电磁感应中的应用'])],
    aliases: ['双棒', '导轨', '动量守恒', '共速', '电磁感应'],
    guide: ['验证共速值 = m₁v₀/(m₁+m₂)', '看电流怎么随时间衰减', '改质量比：τ 与共速怎么变'],
  },
  'induction-double-bar-force': {
    summary: {
      coreModel: '双棒恒力：终态两棒共同加速度 a = F/(m₁+m₂)，相对速度 u∞ = F·R·m₂/(B²L²(m₁+m₂))，回路稳态电流 I∞ = F·m₂/(BL(m₁+m₂))。',
      parameters: ['B、L、R', '两棒质量', '恒定外力 F'],
      feedback: ['前棒始终快于后棒——速度差收敛到定值', '电流趋于稳态值而非归零'],
      errors: ['终态是"同加速度 + 定速度差"，不是共速——与冲量型对照', 'F 撤去后按冲量型演化'],
    },
    textbook: [hs('选择性必修第二册', '第二章 电磁感应', ['电磁感应中的动力学问题'])],
    aliases: ['双棒', '恒定外力', '稳态电流', '加速度'],
    guide: ['等两棒稳定后读电流——是 0 吗', '验证 a = F/(m₁+m₂)', '与冲量型双棒对比终态差别'],
  },
  'induction-flux-change': {
    summary: {
      coreModel: 'ε = −N·dΦ/dt：穿过线圈的磁通量变化产生感应电动势；楞次定律判定方向——感应效果阻碍变化。',
      parameters: ['线圈匝数 N', '磁通变化率 dΦ/dt', '回路电阻'],
      feedback: ['磁通变化时电流表偏转', '变化停止电流归零', '方向随 Φ 增/减反转'],
      errors: ['感应看的是"变化率"不是"磁场大小"——恒定强磁场无感应', '方向判定先想阻碍什么变化'],
    },
    textbook: [hs('选择性必修第二册', '第二章 电磁感应', ['楞次定律', '法拉第电磁感应定律'])],
    aliases: ['磁通量', '楞次定律', '感应电动势', '线圈', 'NΔΦ/Δt'],
    guide: ['改变 dΦ/dt：电流怎么变', '磁通增加与减小时电流方向相反——验证楞次', 'N 加倍：电动势怎么变'],
  },

  /* ----------------------------------------------------------------- wave -- */

  'wave-travelling': {
    summary: {
      coreModel: 'v = λf：绳上简谐横波以恒定波速传播；介质质点只在平衡位置上下振动，不随波迁移。',
      parameters: ['振幅 A', '波长 λ', '频率 f', '绳长'],
      feedback: ['波形整体平移而质点上下振动', '标记质点画出振动轨迹', 'v = λf 读数随 λ、f 更新'],
      errors: ['波速由介质决定——不是"波源推多快就走多快"', '相邻同相点间距才是 λ'],
    },
    textbook: [hs('选择性必修第一册', '第三章 机械波', ['波的形成', '波的描述'])],
    aliases: ['横波', '波长', '波速', 'v=λf', '绳波'],
    guide: ['盯住一个标记质点：它随波走了吗', '改 f 看 λ 怎么变（v 不变）', '用标尺量一个波长的距离'],
  },
  'wave-interference': {
    summary: {
      coreModel: '相干叠加：路程差 Δs = nλ 处加强、(n + ½)λ 处减弱；合振幅 = |A₁ ± A₂|。',
      parameters: ['两波源间距', '波长 λ', '振幅 A', '观察点位置'],
      feedback: ['观察点振幅随路程差周期性变化', '加强区与减弱区交替分布'],
      errors: ['"加强"是振幅变大不是位移恒大——该点仍在振动', '两源须相干（同频同相差恒定）'],
    },
    textbook: [hs('选择性必修第一册', '第三章 机械波', ['波的干涉'])],
    aliases: ['干涉', '相干', '路程差', '加强点', '减弱点'],
    guide: ['把观察点放在 Δs = 0 处：合振幅多少', '移到 Δs = λ/2：变成什么', '沿中垂线移动：为什么始终加强'],
  },
  'wave-standing': {
    summary: {
      coreModel: '两端固定弦驻波：λ = 2L/n，fₙ = n·v/(2L)；波节不动、波腹振幅最大——入射波与反射波叠加。',
      parameters: ['弦长 L', '波速 v', '谐波次数 n'],
      feedback: ['波节位置始终不动', 'n 增大时节-腹相间加密', '各点振幅随位置呈驻波分布'],
      errors: ['驻波不传播能量——波形不移动', '两端固定才有 n 取整的谐波系列'],
    },
    textbook: [hs('选择性必修第一册', '第三章 机械波', ['波的反射、折射和衍射', '驻波'])],
    aliases: ['驻波', '波节', '波腹', '谐波', '弦'],
    guide: ['找出所有波节位置并验证间距 = λ/2', '把 n 从 1 调到 4：f 怎么变', '为什么波节处质点永远不动'],
  },
}

/** Summary + metadata for a template id; `undefined` means the parity test
   *  should have caught a missing entry. */
export const experimentMetaOf = (templateId: string): ExperimentMeta | undefined =>
  EXPERIMENT_META[templateId]
