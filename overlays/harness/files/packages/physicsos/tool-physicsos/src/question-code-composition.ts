/** Domain-specific presentation guidance; never supplies or computes physical results. */
const DOMAIN_GUIDANCE: Record<string, string> = {
  mechanics: '力学装置：以当前bodies与真实装置为主体；存在incline时保留斜面、支点和物体接触关系；弹簧/摆/杠杆按对应几何绘制。保留教学所需vectors方向，不添加题目中不存在的球、落点或地面。',
  optics: '光学实验台：以opticalObjects、opticalElements、opticalImages、opticalScreens和opticalRays组成完整装置；光轴保持清楚，物体、透镜/镜面、像和光屏按引擎位置排列。光线来自opticalRays并保留传播方向与实虚线语义，不能用背景图片代替光路。',
  circuit: '电路实验台：按circuitComponents、circuitWires和circuitJunctions的真实几何布置器材和接线；端子连接必须清楚，不能为美观改变拓扑。电流方向与电表读数来自快照，必要箭头和元件标签保留。',
  magnetic: '磁场实验：用particles、trajectories、field和vectors展示真实粒子、轨迹、磁场与方向；必要的速度/受力箭头和磁场入纸面/出纸面符号要清楚，不把磁场误画成有地板的抛体空间。',
  electric: '电场实验：用particles、electricField、plates、pointChargeSources、fieldStreamlines和vectors展示电荷、电极与电场；保留方向、正负号与等势关系，不添加力学地面。',
  composite: '复合场实验：完整显示compositeRegions、electricField、field、particles与trajectories，边界和穿越过程可辨认；vectors的方向和场方向符号按快照呈现。',
  induction: '电磁感应装置：按inductionRails、inductionBar、inductionCoil、inductionField和inductionCurrent绘制导体/线圈、磁场与电流；保留电流/力方向和真实装置关系。',
  wave: '波动实验：以waveProfile、waveEnvelope、waveSources、waveNodes和waveFronts展示真实波形与传播；使用稳定基线与比例，区分介质振动与传播方向，不添加抛体球或地面。',
  acoustics: '声学实验：按acousticSources、acousticReflectors、acousticPulse和acousticWavefronts展示声源、反射物与波前；距离、传播方向和边界来自快照。',
  fluid: '流体实验：以fluidLiquid、fluidBlock、fluidScale、pressureLiquid和pressureProbes组成真实容器与测量装置；保留液面/浸没/压强方向关系，背景不得烘焙动态液位或读数。',
  thermal: '热学实验：以thermalSample、thermalThermometer、thermalHeater及thermometer展示试样、温度计与热源；温度柱与相态读取快照，不套用运动轨迹构图。',
  modern: '近代物理实验：依照本题现有particles、trajectories、labels与overlay绘制适用的装置/现象。以已验证物理事实为准，不虚构缺失器材或把实验统一画成抛体运动。',
}
export function questionComposition(domain: string, experimentId: string): string {
  const common = '最终构图验收：本题装置或现象占据画面主体，使用统一比例与稳定视窗。绘图尊重snapshot.view.visible，保留题目需要的受力、场、光线、波形和方向符号；标签避开物体并适配219×360手机舞台。生图仅提供环境/材质，不烘焙动态事实或读数。'
  if (domain === 'mechanics' && ['projectile-horizontal', 'projectile-oblique'].includes(experimentId)) {
    return common + '\n抛体运动：使用predicted完整轨迹和关键点拟合范围；平抛/斜抛保留完整水平位移，不能强制路径居中成竖直线。只有竖直上抛时，将真实ground.y映射到舞台高度82%，最高点映射到18%，水平方向居中。背景地板与物理地面对齐，避免悬空地面色块。球半径桌面18–22px、手机14–18px；只调整视觉尺寸，不改物理数值。有起落点重合时合并标签，最高点标签避让主体。向量箭头按snapshot.view.visible与教学需要呈现，避免重叠；读数由外层控件提供。'
  }
  return common + '\n' + (DOMAIN_GUIDANCE[domain] ?? '使用当前snapshot.view实际存在的装置、物体和几何；不要套用其他物理领域的构图。')
}
