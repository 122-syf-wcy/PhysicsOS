/**
 * PhysicsOS question bank — the hand-entered Guizhou seed table.
 *
 * Every item is a real-exam-pattern question (真题改编) carrying its 考点
 * labels, difficulty, verified answer and 解析. The compose sampler draws
 * from this bank; items the engine cannot verify never enter it, which is
 * what keeps generated papers honest. Bank size deliberately exceeds one
 * full blueprint per level so sampling has room to work.
 */

import type { BankQuestion } from './paper.ts'

const q = (item: BankQuestion): BankQuestion => item

/* ---------------------------------------------------------------- 中考 -- */

const ZK: readonly BankQuestion[] = [
  /* ---- 选择题（单选） ---- */
  q({
    id: 'zk-cs-sound-timbre', level: 'zhongkao', kind: 'choice-single',
    domain: 'acoustics', knowledge: ['声音的特性'], difficulty: 'basic', score: 3,
    stem: '侗族大歌被誉为"清泉般的音乐"。听众能分辨出歌声中不同声部，主要是根据声音的（ ）',
    options: ['A. 音调', 'B. 响度', 'C. 音色', 'D. 传播速度'],
    answer: 'C', source: '贵州中考真题改编（声学高频）',
    analysis: '音色由发声体的材料、结构决定，是区分不同发声体的依据。音调指高低、响度指强弱，均不能区分声部来源。',
  }),
  q({
    id: 'zk-cs-light-reflection', level: 'zhongkao', kind: 'choice-single',
    domain: 'optics', knowledge: ['光的反射', '平面镜成像'], difficulty: 'basic', score: 3,
    stem: '《淮南万毕术》记载："取大镜高悬，置水盆于其下，则见四邻。"人通过盆中水面及高悬的平面镜观察墙外景物，均利用了（ ）',
    options: ['A. 光的折射', 'B. 光的色散', 'C. 光的反射', 'D. 光的直线传播'],
    answer: 'C', source: '2024 贵州中考真题改编',
    analysis: '水面与平面镜成像都是光的反射现象：光在两种介质分界面上改变传播方向返回原介质。',
  }),
  q({
    id: 'zk-cs-village-football', level: 'zhongkao', kind: 'choice-single',
    domain: 'mechanics', knowledge: ['运动状态', '惯性'], difficulty: 'basic', score: 3,
    stem: '"贵州村超"足球赛精彩纷呈。比赛中，足球在空中划过一道弧线飞向球门。此过程中对足球分析正确的是（ ）',
    options: ['A. 相对球门静止', 'B. 运动状态改变', 'C. 惯性逐渐消失', 'D. 受平衡力作用'],
    answer: 'B', source: '2024 贵州中考真题改编（本土情境）',
    analysis: '足球速度和方向都在变化，运动状态改变；它受重力（和空气阻力），不是平衡力。惯性是物体固有属性，不会"消失"。',
  }),
  q({
    id: 'zk-cs-internal-energy', level: 'zhongkao', kind: 'choice-single',
    domain: 'thermal', knowledge: ['内能', '能量转化'], difficulty: 'basic', score: 3,
    stem: '内能的利用推动了工业和社会发展。下列机器设备利用内能工作的是（ ）',
    options: ['A. 电动机', 'B. 计算机', 'C. 汽油机', 'D. 照相机'],
    answer: 'C', source: '2024 贵州中考真题改编',
    analysis: '汽油机将燃料燃烧释放的内能转化为机械能；电动机、计算机利用电能，照相机利用光能。',
  }),
  q({
    id: 'zk-cs-pressure-icebreaker', level: 'zhongkao', kind: 'choice-single',
    domain: 'mechanics', knowledge: ['压强', '增大减小压强的方法'], difficulty: 'basic', score: 3,
    stem: '安装在考察船船底的破冰艏犹如一把利刃，能______对冰层的压强实现破冰。下列做法与破冰艏增大压强原理相同的是（ ）',
    options: ['A. 铁轨铺在枕木上', 'B. 书包带做得较宽', 'C. 菜刀磨得锋利', 'D. 坦克安装履带'],
    answer: 'C', source: '贵州中考真题改编',
    analysis: '菜刀磨锋利是减小受力面积增大压强；其余三项都是增大受力面积减小压强。',
  }),
  q({
    id: 'zk-cs-circuit-identify', level: 'zhongkao', kind: 'choice-single',
    domain: 'circuit', knowledge: ['串并联电路识别'], difficulty: 'basic', score: 3,
    stem: '关于家庭电路，下列说法正确的是（ ）',
    options: ['A. 各用电器之间是串联的', 'B. 控制灯泡的开关接在零线上', 'C. 各用电器之间是并联的', 'D. 保险丝熔断后可用铜丝代替'],
    answer: 'C', source: '贵州中考高频考点（家庭电路）',
    analysis: '家庭用电器并联才能各自独立工作、互不影响；开关接火线才安全；铜丝熔点高不能代替保险丝。',
  }),
  q({
    id: 'zk-cs-estimation', level: 'zhongkao', kind: 'choice-single',
    domain: 'mechanics', knowledge: ['物理量估测'], difficulty: 'basic', score: 3,
    stem: '下列估测最接近实际的是（ ）',
    options: ['A. 中学生百米跑速度约 $15\\ \\mathrm{m/s}$', 'B. 一枚鸡蛋的质量约 $50\\ \\mathrm{g}$', 'C. 人体感觉舒适的气温约 $37^\\circ\\mathrm{C}$', 'D. 教室内空气的质量约 $2\\ \\mathrm{kg}$'],
    answer: 'B', source: '贵州中考常考估测题',
    analysis: '百米冠军约 $10\\ \\mathrm{m/s}$；舒适气温约 $25^\\circ\\mathrm{C}$；教室空气质量约 $200\\ \\mathrm{kg}$（$\\rho V$）。',
  }),
  q({
    id: 'zk-cs-energy-nuclear', level: 'zhongkao', kind: 'choice-single',
    domain: 'energy', knowledge: ['能源分类', '核能'], difficulty: 'basic', score: 3,
    stem: '"华龙一号"核电机组是我国核电技术的国家名片。它发电时利用核裂变释放的能源属于（ ）',
    options: ['A. 可再生能源', 'B. 核能', 'C. 太阳能', 'D. 生物质能'],
    answer: 'B', source: '2024 贵州中考真题改编',
    analysis: '核电站利用核裂变释放的核能发电；核能属于不可再生能源。',
  }),
  /* ---- 多项选择题 ---- */
  q({
    id: 'zk-cm-dynamic-circuit', level: 'zhongkao', kind: 'choice-multi',
    domain: 'circuit', knowledge: ['动态电路', '欧姆定律', '电功率'], difficulty: 'medium', score: 3,
    stem: '如图电路，电源电压恒为 $9\\ \\mathrm{V}$，灯泡 L 额定电压 $6\\ \\mathrm{V}$，其 $I\\text{-}U$ 图像为曲线。闭合开关，滑动变阻器滑片移动时，下列分析正确的是（ ）',
    options: [
      'A. 灯泡电阻始终保持不变',
      'B. 滑片向左移动接入电阻减小时，灯泡实际功率增大',
      'C. 灯泡两端电压越高，其电阻越大',
      'D. 灯泡正常发光时功率为额定功率',
    ],
    answer: 'BCD', source: '2024 贵州中考真题改编（多选压轴位）',
    analysis: '灯泡电阻随温度升高而增大（A错C对）；滑片左移接入电阻变小、灯压升高、功率增大（B对）；额定电压下的功率即额定功率（D对）。',
  }),
  q({
    id: 'zk-cm-buoyancy', level: 'zhongkao', kind: 'choice-multi',
    domain: 'fluid', knowledge: ['浮力', '浮沉条件'], difficulty: 'medium', score: 3,
    stem: '把同一鸡蛋分别放入盛有清水和盐水的烧杯中，鸡蛋在清水中沉底、在盐水中漂浮。下列说法正确的是（ ）',
    options: [
      'A. 鸡蛋在盐水中受到的浮力较大',
      'B. 鸡蛋在清水中受到的浮力较大',
      'C. 盐水密度大于清水密度',
      'D. 鸡蛋在两杯中排开液体的体积相同',
    ],
    answer: 'AC', source: '贵州中考高频考点（浮力）',
    analysis: '漂浮时浮力等于重力、沉底时浮力小于重力，故盐水中浮力大（A对B错）；漂浮说明盐水密度大于鸡蛋密度（C对）；沉底排开全部自身体积、漂浮只排开一部分（D错）。',
  }),
  /* ---- 填空题 ---- */
  q({
    id: 'zk-bl-card-reader', level: 'zhongkao', kind: 'blank',
    domain: 'electromagnetism', knowledge: ['电磁感应'], difficulty: 'basic', score: 2,
    stem: '将银行卡的磁条在读卡器刷卡槽内快速刷过时，相当于磁体穿过闭合金属线圈，线圈中产生了______，读卡器据此识别卡片信息。',
    answer: '感应电流', source: '2024 贵州中考真题改编',
    analysis: '磁体与线圈相对运动使穿过线圈的磁通量变化，产生感应电流——电磁感应现象。',
  }),
  q({
    id: 'zk-bl-tea-buoyancy', level: 'zhongkao', kind: 'blank',
    domain: 'fluid', knowledge: ['浮力', '浮沉条件'], difficulty: 'basic', score: 2,
    stem: '泡茶时部分茶叶表面附着气泡使其排开水的体积增大，由于浮力大于重力而______；茶叶充分吸水后由于其密度______水的密度而下沉。',
    answer: '上浮；大于', source: '2024 贵州中考真题改编',
    analysis: '浮力大于重力则上浮；物体密度大于液体密度时下沉。',
  }),
  q({
    id: 'zk-bl-heat-value', level: 'zhongkao', kind: 'blank',
    domain: 'thermal', knowledge: ['热值', '热量计算'], difficulty: 'medium', score: 2,
    stem: '完全燃烧 $0.1\\ \\mathrm{kg}$ 的酒精可放出______$\\mathrm{J}$ 的热量；若这些热量的 $42\\%$ 被水吸收，可使 $10\\ \\mathrm{kg}$ 水温度升高______$^\\circ\\mathrm{C}$。（$q_{\\text{酒精}}=3.0\\times10^{7}\\ \\mathrm{J/kg}$，$c_{\\text{水}}=4.2\\times10^{3}\\ \\mathrm{J/(kg\\cdot{}^\\circ C)}$）',
    answer: '$3.0\\times10^{6}$；$30$', source: '贵州中考轮换考点（热值计算）',
    analysis: '$Q_{\\text{放}}=mq=0.1\\times3.0\\times10^{7}=3.0\\times10^{6}\\ \\mathrm{J}$；$\\Delta t=\\dfrac{\\eta Q}{cm}=\\dfrac{0.42\\times3.0\\times10^{6}}{4.2\\times10^{3}\\times10}=30^\\circ\\mathrm{C}$。',
  }),
  q({
    id: 'zk-bl-lever', level: 'zhongkao', kind: 'blank',
    domain: 'mechanics', knowledge: ['杠杆平衡条件'], difficulty: 'medium', score: 2,
    stem: '跷跷板上，体重 $400\\ \\mathrm{N}$ 的同学坐在距支点 $1.5\\ \\mathrm{m}$ 处，另一端体重 $600\\ \\mathrm{N}$ 的同学应坐在距支点______$\\mathrm{m}$ 处才能保持水平平衡。',
    answer: '$1$', source: '贵州中考高频考点（杠杆）',
    analysis: '杠杆平衡条件 $F_1l_1=F_2l_2$：$l_2=\\dfrac{400\\times1.5}{600}=1\\ \\mathrm{m}$。',
  }),
  q({
    id: 'zk-bl-circuit-calc', level: 'zhongkao', kind: 'blank',
    domain: 'circuit', knowledge: ['欧姆定律', '串联电路'], difficulty: 'medium', score: 2,
    stem: '电源电压恒定，定值电阻 $R=10\\ \\Omega$，灯泡 L 标有"$6\\ \\mathrm{V}\\ 3\\ \\mathrm{W}$"。只闭合开关 S 后灯泡正常发光，则电源电压为______$\\mathrm{V}$（设灯丝电阻不变）。',
    answer: '$11$', source: '贵州中考真题改编（电路计算填空）',
    analysis: '正常发光时 $I=\\dfrac{P}{U}=\\dfrac{3}{6}=0.5\\ \\mathrm{A}$；$U_{\\text{总}}=U_{\\text{灯}}+IR=6+0.5\\times10=11\\ \\mathrm{V}$。',
  }),
  /* ---- 作图题 ---- */
  q({
    id: 'zk-dr-force-diagram', level: 'zhongkao', kind: 'drawing',
    domain: 'mechanics', knowledge: ['力的示意图'], difficulty: 'basic', score: 2,
    stem: '一把带电塑料梳子靠近桌上的小纸片，纸片 A 离开桌面上升。请在答题卡上画出纸片 A 所受重力 $G$ 和静电吸引力 $F$ 的示意图。',
    answer: '重力 $G$ 竖直向下、静电吸引力 $F$ 竖直向上，$F$ 的线段长于 $G$（纸片上升合力向上）。', source: '2024 贵州中考真题改编',
    analysis: '作图规范：作用点均在纸片上，重力竖直向下，吸引力向上且更长（合力向上才有向上的加速度）。',
  }),
  q({
    id: 'zk-dr-mirror-light', level: 'zhongkao', kind: 'drawing',
    domain: 'optics', knowledge: ['光的反射', '平面镜成像作图'], difficulty: 'basic', score: 2,
    stem: '如图，一束光斜射到平面镜上。请画出反射光线并标出反射角。',
    answer: '反射光线与入射光线分居法线两侧，反射角等于入射角，反射角标注在反射光线与法线之间。', source: '贵州中考常考作图',
    analysis: '光的反射定律：三线共面、两线分居、两角相等。',
  }),
  q({
    id: 'zk-dr-circuit-connect', level: 'zhongkao', kind: 'drawing',
    domain: 'circuit', knowledge: ['实物电路连接'], difficulty: 'medium', score: 2,
    stem: '如图是未完成连接的实物电路。请用笔画线代替导线完成连接：两灯串联，电压表测量小灯泡两端电压，导线不能交叉。',
    answer: '两灯首尾相连串入电路；电压表与待测灯泡并联，正接线柱接高电势端。', source: '2024 贵州中考真题改编',
    analysis: '串联只有一条电流路径；电压表并联使用，注意量程与正负接线柱。',
  }),
  /* ---- 简答题 ---- */
  q({
    id: 'zk-sa-train-line', level: 'zhongkao', kind: 'short-answer',
    domain: 'fluid', knowledge: ['流体压强与流速'], difficulty: 'basic', score: 3,
    stem: '高铁站台上画有安全线，列车进站时乘客必须站在安全线以外。请用流体压强与流速的关系解释原因。',
    answer: '列车高速驶过时，人与车之间空气流速大、压强小，人外侧空气流速小、压强大，压强差会把人推向列车，易发生危险。', source: '贵州中考真题改编（公共安全情境）',
    analysis: '流体流速越大的位置压强越小。压强差产生指向列车的力。',
  }),
  q({
    id: 'zk-sa-safe-electricity', level: 'zhongkao', kind: 'short-answer',
    domain: 'circuit', knowledge: ['安全用电'], difficulty: 'basic', score: 3,
    stem: '为什么不能用湿手触摸开关或正在工作的用电器？',
    answer: '通常的水含杂质能导电，湿手使人体电阻大幅减小；触摸开关或用电器时易形成电流通路造成触电事故。', source: '贵州中考高频考点（安全用电）',
    analysis: '安全用电原则：不接触低压带电体；湿手电阻小，相同电压下电流更大更危险。',
  }),
  q({
    id: 'zk-sa-phase-change', level: 'zhongkao', kind: 'short-answer',
    domain: 'thermal', knowledge: ['物态变化', '液化'], difficulty: 'basic', score: 3,
    stem: '夏天，从冰箱取出的冰镇饮料瓶外壁很快"冒汗"。请解释这一现象。',
    answer: '空气中温度较高的水蒸气遇到温度很低的饮料瓶，放热液化成小水珠附着在瓶壁上。', source: '贵州中考常考简答',
    analysis: '"冒汗"不是瓶内渗出的水，而是空气中水蒸气遇冷液化的结果。',
  }),
  /* ---- 实验与科学探究题 ---- */
  q({
    id: 'zk-ex-lever', level: 'zhongkao', kind: 'experiment',
    domain: 'mechanics', knowledge: ['杠杆平衡条件探究'], difficulty: 'medium', score: 8,
    stem: '在"探究杠杆平衡条件"实验中：（1）实验前杠杆左端下沉，应将平衡螺母向______端调节，使杠杆在水平位置平衡，这样做的目的是便于测量______。（2）小明在杠杆两侧挂上不同数量钩码，记录三组数据如表。分析数据可得杠杆平衡条件是______。（3）实验中多次测量的目的是______。',
    answer: '（1）右；力臂（2）$F_1l_1=F_2l_2$（动力×动力臂=阻力×阻力臂）（3）避免偶然性，寻找普遍规律', source: '贵州中考必考实验（杠杆）',
    analysis: '水平平衡时力臂与杠杆重合可直接读数；多次实验为归纳普遍结论而非求平均值。',
  }),
  q({
    id: 'zk-ex-volt-ampere', level: 'zhongkao', kind: 'experiment',
    domain: 'circuit', knowledge: ['伏安法测电阻'], difficulty: 'medium', score: 10,
    stem: '在"伏安法测定值电阻"实验中：（1）连接电路时开关应______，滑片移到阻值最______处。（2）某次电流表、电压表示数分别为 $0.3\\ \\mathrm{A}$、$2.4\\ \\mathrm{V}$，则该次测得电阻为______$\\Omega$。（3）移动滑片多次测量求平均值的目的是______。（4）若电压表损坏，只用电流表和已知电阻 $R_0$ 如何测 $R_x$？写出思路。',
    answer: '（1）断开；大（2）$8$（3）减小误差（4）$R_0$ 与 $R_x$ 并联，分别测两支路电流 $I_0$、$I_x$，$R_x=\\dfrac{I_0R_0}{I_x}$', source: '贵州中考轮换高频实验（伏安法）',
    analysis: '伏安法核心 $R=\\dfrac{U}{I}=\\dfrac{2.4}{0.3}=8\\ \\Omega$；缺电压表时利用并联电压相等转换测量。',
  }),
  q({
    id: 'zk-ex-pulley-efficiency', level: 'zhongkao', kind: 'experiment',
    domain: 'mechanics', knowledge: ['滑轮组', '机械效率'], difficulty: 'medium', score: 10,
    stem: '在"测滑轮组机械效率"实验中：（1）实验原理是______。（2）用滑轮组将重 $1200\\ \\mathrm{N}$ 的物体匀速提升 $2\\ \\mathrm{m}$，拉力 $F=500\\ \\mathrm{N}$，承重绳段数 $n=3$。总功______$\\mathrm{J}$，机械效率______。（3）要提高同一滑轮组的机械效率，可采取的措施是______。',
    answer: '（1）$\\eta=\\dfrac{W_{\\text{有}}}{W_{\\text{总}}}$（2）$3000$；$80\\%$（3）增大提升的物重（或减小动滑轮自重/摩擦）', source: '贵州中考压轴位实验（机械效率）',
    analysis: '$W_{\\text{总}}=Fs=500\\times3\\times2=3000\\ \\mathrm{J}$；$W_{\\text{有}}=Gh=2400\\ \\mathrm{J}$，$\\eta=\\dfrac{2400}{3000}=80\\%$。',
  }),
  /* ---- 综合应用题 ---- */
  q({
    id: 'zk-cal-pressure-buoyancy', level: 'zhongkao', kind: 'calculation',
    domain: 'fluid', knowledge: ['压强', '浮力综合'], difficulty: 'hard', score: 8,
    stem: '一个重 $8\\ \\mathrm{N}$、底面积 $0.01\\ \\mathrm{m^2}$ 的圆柱形容器放在水平桌面上，内装 $2\\ \\mathrm{kg}$ 的水，水深 $0.2\\ \\mathrm{m}$。（$g$ 取 $10\\ \\mathrm{N/kg}$）求：（1）水对容器底部的压强；（2）容器对桌面的压强。',
    answer: '（1）$2\\times10^{3}\\ \\mathrm{Pa}$（2）$2.8\\times10^{3}\\ \\mathrm{Pa}$', source: '贵州中考综合应用位（压强浮力）',
    analysis: '（1）$p=\\rho gh=1.0\\times10^{3}\\times10\\times0.2=2\\times10^{3}\\ \\mathrm{Pa}$；（2）$F=G_{\\text{容}}+G_{\\text{水}}=8+20=28\\ \\mathrm{N}$，$p=\\dfrac{F}{S}=\\dfrac{28}{0.01}=2.8\\times10^{3}\\ \\mathrm{Pa}$。注意区分液体压强（$\\rho gh$）与固体压强（$F/S$）。',
  }),
  q({
    id: 'zk-cal-power-cooker', level: 'zhongkao', kind: 'calculation',
    domain: 'circuit', knowledge: ['电功率', '多档位电路'], difficulty: 'hard', score: 8,
    stem: '某电饭锅有"加热"和"保温"两档，内部电路可等效为电源、开关与两个定值电阻 $R_1=44\\ \\Omega$、$R_2=440\\ \\Omega$ 的串并联组合。家庭电压 $U=220\\ \\mathrm{V}$。求：（1）加热档（仅 $R_1$ 工作）的电功率；（2）保温档（两电阻串联）工作 $10\\ \\mathrm{min}$ 产生的热量。',
    answer: '（1）$1100\\ \\mathrm{W}$（2）$6\\times10^{4}\\ \\mathrm{J}$', source: '贵州中考压轴（电功率多档位，能效情境）',
    analysis: '（1）$P=\\dfrac{U^2}{R_1}=\\dfrac{220^2}{44}=1100\\ \\mathrm{W}$；（2）$R_{\\text{串}}=484\\ \\Omega$，$Q=W=\\dfrac{U^2}{R_{\\text{串}}}t=\\dfrac{220^2}{484}\\times600=6\\times10^{4}\\ \\mathrm{J}$。',
  }),
  q({
    id: 'zk-cal-work-energy', level: 'zhongkao', kind: 'calculation',
    domain: 'mechanics', knowledge: ['功', '功率', '机械效率'], difficulty: 'hard', score: 8,
    stem: '工人用滑轮组在 $20\\ \\mathrm{s}$ 内将重 $600\\ \\mathrm{N}$ 的货物匀速提升 $4\\ \\mathrm{m}$，拉力 $F=400\\ \\mathrm{N}$，承重绳段数 $n=2$。求：（1）有用功；（2）拉力的功率；（3）滑轮组的机械效率。',
    answer: '（1）$2400\\ \\mathrm{J}$（2）$160\\ \\mathrm{W}$（3）$75\\%$', source: '贵州中考综合应用位（功与机械效率）',
    analysis: '$W_{\\text{有}}=Gh=600\\times4=2400\\ \\mathrm{J}$；$s=2\\times4=8\\ \\mathrm{m}$，$W_{\\text{总}}=Fs=3200\\ \\mathrm{J}$，$P=\\dfrac{3200}{20}=160\\ \\mathrm{W}$；$\\eta=\\dfrac{2400}{3200}=75\\%$。',
  }),
]

/* ---------------------------------------------------------------- 高考 -- */

const GK: readonly BankQuestion[] = [
  /* ---- 单项选择题 ---- */
  q({
    id: 'gk-cs-vt-graph', level: 'gaokao', kind: 'choice-single',
    domain: 'mechanics', knowledge: ['匀变速直线运动', 'v-t 图像'], difficulty: 'basic', score: 4,
    stem: '一质点做直线运动，其 $v\\text{-}t$ 图像为一条过原点的倾斜直线。下列说法正确的是（ ）',
    options: ['A. 质点做匀速直线运动', 'B. 图线斜率表示位移', 'C. 图线与时间轴围成的面积表示位移', 'D. 加速度随时间均匀增大'],
    answer: 'C', source: '高考真题改编（运动图像基础）',
    analysis: '过原点倾斜直线表示初速度为零的匀加速运动：斜率是加速度（恒定），面积是位移。',
  }),
  q({
    id: 'gk-cs-force-balance', level: 'gaokao', kind: 'choice-single',
    domain: 'mechanics', knowledge: ['受力分析', '力的平衡'], difficulty: 'basic', score: 4,
    stem: '贵州山区常见坡道停车场景：汽车静止在倾角为 $\\theta$ 的斜坡上，它受到的力个数为（ ）',
    options: ['A. 2 个', 'B. 3 个', 'C. 4 个', 'D. 5 个'],
    answer: 'B', source: '高考真题改编（本土坡道情境）',
    analysis: '重力、支持力、沿坡面向上的静摩擦力，共 3 个力平衡。',
  }),
  q({
    id: 'gk-cs-electric-field', level: 'gaokao', kind: 'choice-single',
    domain: 'electromagnetism', knowledge: ['电场强度', '电场线'], difficulty: 'basic', score: 4,
    stem: '关于电场线，下列说法正确的是（ ）',
    options: ['A. 电场线是电荷实际运动的轨迹', 'B. 电场线越密处场强越小', 'C. 电场线上某点的切线方向即该点场强方向', 'D. 两条电场线可以相交'],
    answer: 'C', source: '高考基础题（电场概念）',
    analysis: '电场线是假想曲线，切线方向即场强方向，疏密表场强大小，永不相交。',
  }),
  q({
    id: 'gk-cs-lorentz-circle', level: 'gaokao', kind: 'choice-single',
    domain: 'electromagnetism', knowledge: ['洛伦兹力', '圆周运动'], difficulty: 'medium', score: 4,
    stem: '一带电粒子垂直射入匀强磁场做匀速圆周运动。若仅将粒子速率加倍，则其轨道半径和周期分别（ ）',
    options: ['A. 半径加倍、周期不变', 'B. 半径不变、周期减半', 'C. 半径加倍、周期减半', 'D. 半径不变、周期不变'],
    answer: 'A', source: '高考高频考点（带电粒子圆周）',
    analysis: '$r=\\dfrac{mv}{qB}$ 与速率成正比故加倍；$T=\\dfrac{2\\pi m}{qB}$ 与速率无关故不变。',
  }),
  q({
    id: 'gk-cs-satellite', level: 'gaokao', kind: 'choice-single',
    domain: 'mechanics', knowledge: ['万有引力', '圆周运动'], difficulty: 'medium', score: 4,
    stem: '我国"天眼"FAST 位于贵州平塘。若一颗地球同步卫星的轨道半径约为地球半径的 $6.6$ 倍，则其向心加速度约为地面重力加速度的（ ）',
    options: ['A. $\\dfrac{1}{6.6}$', 'B. $\\dfrac{1}{6.6^2}$', 'C. $6.6$ 倍', 'D. $6.6^2$ 倍'],
    answer: 'B', source: '高考真题改编（贵州天眼情境）',
    analysis: '$\\dfrac{GMm}{r^2}=ma$ 得 $a\\propto\\dfrac{1}{r^2}$，故 $a=\\dfrac{g}{6.6^2}$。',
  }),
  q({
    id: 'gk-cs-em-induction', level: 'gaokao', kind: 'choice-single',
    domain: 'electromagnetism', knowledge: ['电磁感应', '楞次定律'], difficulty: 'medium', score: 4,
    stem: '闭合线圈竖直放置，条形磁铁 N 极朝下向线圈中心加速靠近。从上向下看，线圈中感应电流方向为（ ）',
    options: ['A. 顺时针', 'B. 逆时针', 'C. 先顺时针后逆时针', 'D. 无感应电流'],
    answer: 'B', source: '高考高频考点（楞次定律）',
    analysis: 'N 极靠近使向下磁通量增大，感应电流磁场向上阻碍之；由右手定则俯视电流为逆时针。',
  }),
  q({
    id: 'gk-cs-ac-transformer', level: 'gaokao', kind: 'choice-single',
    domain: 'circuit', knowledge: ['交流电', '变压器'], difficulty: 'medium', score: 4,
    stem: '理想变压器原副线圈匝数比 $10:1$，原线圈接 $220\\ \\mathrm{V}$ 正弦交流电，副线圈接 $11\\ \\Omega$ 电阻。副线圈中电流的有效值为（ ）',
    options: ['A. $0.5\\ \\mathrm{A}$', 'B. $1\\ \\mathrm{A}$', 'C. $2\\ \\mathrm{A}$', 'D. $20\\ \\mathrm{A}$'],
    answer: 'C', source: '高考真题改编（变压器计算）',
    analysis: '$U_2=\\dfrac{n_2}{n_1}U_1=22\\ \\mathrm{V}$，$I_2=\\dfrac{22}{11}=2\\ \\mathrm{A}$。',
  }),
  q({
    id: 'gk-cs-atomic', level: 'gaokao', kind: 'choice-single',
    domain: 'atomic', knowledge: ['光电效应', '原子能级'], difficulty: 'basic', score: 4,
    stem: '关于光电效应，下列说法正确的是（ ）',
    options: ['A. 入射光越强，光电子最大初动能越大', 'B. 入射光频率越高，光电子最大初动能越大', 'C. 任何频率的光照射金属都能产生光电效应', 'D. 光电子的最大初动能与入射光强度成正比'],
    answer: 'B', source: '高考高频考点（光电效应）',
    analysis: '$E_{\\mathrm{k}}=h\\nu-W_0$：最大初动能只随频率增大，与光强无关；存在截止频率。',
  }),
  /* ---- 多项选择题 ---- */
  q({
    id: 'gk-cm-em-graph', level: 'gaokao', kind: 'choice-multi',
    domain: 'electromagnetism', knowledge: ['电磁感应图像', '欧姆定律'], difficulty: 'medium', score: 4,
    stem: '光滑水平导轨上导体棒在恒力作用下由静止开始切割磁感线。下列图像能正确描述其速度 $v$ 或电流 $I$ 随时间变化的是（ ）',
    options: [
      'A. $v\\text{-}t$ 图线为倾斜直线',
      'B. $v$ 增大趋近一最大值的曲线',
      'C. $I\\text{-}t$ 图线为倾斜直线',
      'D. $I$ 增大趋近一最大值的曲线',
    ],
    answer: 'BD', source: '高考真题改编（电磁感应动态过程）',
    analysis: '安培阻力随速度增大而增大，加速度渐小至零：$v$、$I$ 都渐趋最大值的收敛曲线。',
  }),
  q({
    id: 'gk-cm-charged-particle', level: 'gaokao', kind: 'choice-multi',
    domain: 'electromagnetism', knowledge: ['带电粒子在磁场中运动'], difficulty: 'hard', score: 4,
    stem: '在上下无限长平行边界间有垂直纸面向外的匀强磁场。粒子源在边界上向右侧空间各方向发射同种带正电粒子（速率相同）。下列说法正确的是（ ）',
    options: [
      'A. 所有粒子轨道半径相同',
      'B. 运动时间最短的粒子轨迹弦最短',
      'C. 速率加倍则周期加倍',
      'D. 从右边界离开的粒子在磁场中偏转角相同',
    ],
    answer: 'AB', source: '2025 贵州高考真题改编（多选压轴位）',
    analysis: '$r=\\dfrac{mv}{qB}$ 相同（A对）；时间最短对应圆心角最小即弦最短（B对）；$T$ 与速率无关（C错）；入射方向不同偏转角不同（D错）。',
  }),
  q({
    id: 'gk-cm-mech-energy', level: 'gaokao', kind: 'choice-multi',
    domain: 'mechanics', knowledge: ['机械能守恒', '功能关系'], difficulty: 'medium', score: 4,
    stem: '一物块沿粗糙斜面由顶端静止下滑到底端。下列说法正确的是（ ）',
    options: [
      'A. 重力做正功，摩擦力做负功',
      'B. 机械能守恒',
      'C. 重力势能的减少量等于动能的增加量',
      'D. 重力势能的减少量等于动能增加量与内能增加量之和',
    ],
    answer: 'AD', source: '高考真题改编（功能关系）',
    analysis: '下滑重力正功、摩擦力负功（A对）；有摩擦机械能不守恒（B错）；能量守恒：重力势能减少=动能增量+摩擦生热（C错D对）。',
  }),
  /* ---- 实验题 ---- */
  q({
    id: 'gk-ex-ticker-tape', level: 'gaokao', kind: 'experiment',
    domain: 'mechanics', knowledge: ['纸带处理', '匀变速实验'], difficulty: 'medium', score: 10,
    stem: '在"探究匀变速直线运动"实验中打出一条纸带，取清晰点标"0"，以后每隔一个点取计数点"1、2、3…"。已知相邻计数点间距 $x_1=2.10\\ \\mathrm{cm}$、$x_2=2.90\\ \\mathrm{cm}$，打点周期 $0.02\\ \\mathrm{s}$。求：（1）计数点"1"对应的速度；（2）判断该运动是否为匀变速并说明依据。',
    answer: '（1）$v_1=\\dfrac{x_1+x_2}{2T}=\\dfrac{(2.10+2.90)\\times10^{-2}}{2\\times0.04}=0.625\\ \\mathrm{m/s}$（2）若相邻相等时间位移差恒定即为匀变速', source: '高考力学实验位（纸带）',
    analysis: '中间时刻速度=该段平均速度；匀变速判据 $\\Delta x=aT^2$ 恒定。',
  }),
  q({
    id: 'gk-ex-ui-curve', level: 'gaokao', kind: 'experiment',
    domain: 'circuit', knowledge: ['伏安法', 'U-I 图像', '误差分析'], difficulty: 'medium', score: 10,
    stem: '物理兴趣小组用电学实验电路探究：（1）闭合开关前滑动变阻器滑片应置于阻值最______端；（2）某次电流表 $0.24\\ \\mathrm{A}$、电压表 $2.4\\ \\mathrm{V}$，测得电阻______$\\Omega$（保留两位有效数字）；（3）以 $U$ 为纵轴、$I$ 为横轴作图，所得图线斜率的物理意义是______。',
    answer: '（1）大（2）$10$（3）斜率表示被测电阻 $R$ 的阻值', source: '高考电学实验位（U-I 图像）',
    analysis: '$R=\\dfrac{2.4}{0.24}=10\\ \\Omega$；$U\\text{-}I$ 图线斜率即电阻。',
  }),
  /* ---- 计算题 ---- */
  q({
    id: 'gk-cal-conveyor', level: 'gaokao', kind: 'calculation',
    domain: 'mechanics', knowledge: ['牛顿第二定律', '匀变速运动', '传送带模型'], difficulty: 'hard', score: 16,
    stem: '水平传送带以 $v=4\\ \\mathrm{m/s}$ 匀速运行，将一质量 $m=2\\ \\mathrm{kg}$ 的物块轻放在传送带左端，物块与传送带间动摩擦因数 $\\mu=0.2$，传送带足够长，$g=10\\ \\mathrm{m/s^2}$。求：（1）物块刚放上传送带时的加速度大小；（2）物块加速到与传送带同速所用时间及位移；（3）此过程中摩擦力对物块做的功。',
    answer: '（1）$2\\ \\mathrm{m/s^2}$（2）$2\\ \\mathrm{s}$，$4\\ \\mathrm{m}$（3）$16\\ \\mathrm{J}$', source: '高考计算题位（力学综合）',
    analysis: '（1）$a=\\mu g=2\\ \\mathrm{m/s^2}$；（2）$t=\\dfrac{v}{a}=2\\ \\mathrm{s}$，$x=\\dfrac{v^2}{2a}=4\\ \\mathrm{m}$；（3）$W_f=\\dfrac{1}{2}mv^2=16\\ \\mathrm{J}$（动能定理）。',
  }),
  q({
    id: 'gk-cal-em-rail', level: 'gaokao', kind: 'calculation',
    domain: 'electromagnetism', knowledge: ['电磁感应', '动力学综合'], difficulty: 'hard', score: 16,
    stem: '间距 $L=0.5\\ \\mathrm{m}$ 的光滑平行导轨水平放置，处于竖直向下 $B=0.4\\ \\mathrm{T}$ 的匀强磁场中。质量 $m=0.1\\ \\mathrm{kg}$、电阻 $r=0.2\\ \\Omega$ 的导体棒在恒定外力 $F=0.4\\ \\mathrm{N}$ 作用下由静止开始运动，导轨电阻不计。求：（1）导体棒的最大速度；（2）速度为最大速度一半时导体棒的加速度。',
    answer: '（1）$2\\ \\mathrm{m/s}$（2）$2\\ \\mathrm{m/s^2}$', source: '高考计算题位（电磁综合）',
    analysis: '（1）匀速时 $F=F_{\\text{安}}=\\dfrac{B^2L^2v_m}{r}$，$v_m=\\dfrac{0.4\\times0.2}{0.16\\times0.25}=2\\ \\mathrm{m/s}$；（2）$v=1$ 时 $F_{\\text{安}}=0.2\\ \\mathrm{N}$，$a=\\dfrac{0.4-0.2}{0.1}=2\\ \\mathrm{m/s^2}$。',
  }),
  q({
    id: 'gk-cal-gas', level: 'gaokao', kind: 'calculation',
    domain: 'thermal', knowledge: ['气体实验定律'], difficulty: 'medium', score: 8,
    stem: '一定质量理想气体密封在气缸内，初态压强 $p_1=1.0\\times10^{5}\\ \\mathrm{Pa}$、体积 $V_1=2.0\\ \\mathrm{L}$、温度 $T_1=300\\ \\mathrm{K}$。保持体积不变加热到 $T_2=450\\ \\mathrm{K}$，再保持温度不变缓慢膨胀到 $V_3=3.0\\ \\mathrm{L}$。求：（1）加热后的压强 $p_2$；（2）膨胀后的压强 $p_3$。',
    answer: '（1）$1.5\\times10^{5}\\ \\mathrm{Pa}$（2）$1.0\\times10^{5}\\ \\mathrm{Pa}$', source: '高考选考位（热学）',
    analysis: '（1）等容 $\\dfrac{p_1}{T_1}=\\dfrac{p_2}{T_2}$，$p_2=1.5\\times10^{5}\\ \\mathrm{Pa}$；（2）等温 $p_2V_1=p_3V_3$，$p_3=\\dfrac{1.5\\times10^{5}\\times2.0}{3.0}=1.0\\times10^{5}\\ \\mathrm{Pa}$。',
  }),
  q({
    id: 'gk-cal-refraction', level: 'gaokao', kind: 'calculation',
    domain: 'optics', knowledge: ['光的折射', '折射定律'], difficulty: 'medium', score: 8,
    stem: '一束光从空气以入射角 $i=60^\\circ$ 射入折射率 $n=\\sqrt{3}$ 的玻璃砖。求：（1）折射角 $r$；（2）光在玻璃中的传播速度（真空中光速 $c=3.0\\times10^{8}\\ \\mathrm{m/s}$）。',
    answer: '（1）$30^\\circ$（2）$\\sqrt{3}\\times10^{8}\\ \\mathrm{m/s}\\approx1.73\\times10^{8}\\ \\mathrm{m/s}$', source: '高考选考位（光学）',
    analysis: '（1）$n=\\dfrac{\\sin i}{\\sin r}$，$\\sin r=\\dfrac{\\sin60^\\circ}{\\sqrt3}=\\dfrac12$，$r=30^\\circ$；（2）$v=\\dfrac{c}{n}=\\dfrac{3.0\\times10^{8}}{\\sqrt3}=\\sqrt3\\times10^{8}\\ \\mathrm{m/s}$。',
  }),
]

/** The seed bank: every item Guizhou-pattern, engine-checkable. */
export const QUESTION_BANK: readonly BankQuestion[] = [...ZK, ...GK]
