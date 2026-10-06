# PhysicsOS Backlog

> 文件：`docs/reports/BACKLOG.md`
> 用途：登记已识别但明确不阻塞当前 Completion Gate 的工作项。
> 每条必须写清 **为什么现在不做** 与 **满足什么条件才做**。

---

## ELECTRIC_TIMELINE_EVENT_MARKERS_BACKLOG

**状态**：**已关闭**（2026-08-23，`ELECTRIC_BOUNDARY_RUNTIME_COMPLETE`）。

开始条件「Electric Engine 产出离散事件（进入场区 / 离开场区 / 打到极板）」由
`@physicsos/engine-electric-region` 满足：它对平行板有界场分段解析，在场区边界
与极板处产出 `PhysicsEventLike`（`EnterField` / `ExitField` / `HitPlate`）。

预判也成立 —— **UI 侧零改动**。`TimelineMarkers` 的 class 是动态拼的
（`css[\`eventMark_${event.kind}\`]`），新增三种 kind 自动生效；只加了
`.eventMark_enter`/`.eventMark_exit`/`.eventMark_plate-impact`三条样式，
以及 runtime 侧把`SimulationResult.events`映射成`TimelineEvent`的`eventsOf`。

浏览器验收：`electric-region-acceptance.mjs` Case D —— 标记数 ≥ 2（进入 + 离开）、
点击标记 seek 时钟生效、5 项门禁为 0。无界匀强场与点电荷场景仍为空数组
（Case B 断言 `no region events in an unbounded field`），没有伪造 marker。

以下为关闭前的原始记录。

---

**现象**：电场工作台的时间轴没有事件标记；`WorkspaceSnapshot.events`
对 electric 域恒为空数组。

**原因**：`ElectricEngine` 目前不产生离散事件。力学的抛体模型有物理上真实的
离散时刻（发射 / 最高点 / 落地），因此 `eventsOf` 能给出 launch / apex / impact；
点电荷模型是**静态模型**（单一 SimulationState，无轨迹积分），匀强电场中
带电粒子在采样窗口内也没有等价的物理事件（进入/离开场区、极板碰撞等边界
事件尚未建模）。

**为什么现在不做**：伪造 marker 会违反「画布只显示引擎断言过的事实」这条底线 ——
在没有对应 PhysicsEvent 的情况下画一个「事件」就是编造物理。
`ELECTRIC_FIELD_RUNTIME_PACK_V2`（多源点电荷 + 等势线）已完成，但其范围明确排除
时间轴事件标记（静态模型无离散事件）。补齐它需要先在 Electric Engine 里
建模场区边界与极板碰撞（匀强电场，V3）或运动电荷的轨迹事件（后续动态电场切片）。

**开始条件**：Electric Engine 产出离散事件（进入场区 / 离开场区 /
打到极板，或动态点电荷轨迹的离散时刻）。届时 UI 侧零改动即可显示 ——
`TimelineMarkers` 与 `DataPanelBody` 的事件页已是域无关实现。

---

## QUESTION_IMAGE_PDF_INGEST_BACKLOG

**状态**：**已关闭（2026-09-25）**。视觉模型转录、文本层 PDF 本地抽文、扫描页逐页渲染、
图片录入 API、教师核对 UI 与 pending 入库链路均已落地并通过测试。仍待扩充的是可授权
的真实卷源，不是识别能力本身。

**关闭前记录**：当时判断需要 OCR / VLM 服务与整卷拆题流水线，属于
Question Pipeline 的独立阶段，不是 Mechanics UI 的一部分。

### 后续真实缺口

- 真实卷源获取仍受版权、登录和官方发布方式限制。
- 整卷自动拆题已可用，但复杂双栏、跨页题和手写批注仍需教师确认。

---

## AGENT_MODEL_BACKED_ANSWERS_BACKLOG

**状态**：登记（2026-09-25 复核）。当前实验室抽屉内问答仍是确定性意图匹配
（`physics-agent-answers.ts` → `AgentDrawer`）。**但"模型答案"路径事实上已
存在**:`physics-student` preset 挂了 `tool-physicsos` + persona,学生经会话
主链路拿到的就是模型驱动答案 —— 本项剩下的问题收窄为「抽屉内嵌的快速问答
要不要花 token 升级为模型应答」,是产品决策而非阻塞工程。确定性层本身是
特性（即时、离线、零成本）,不是过渡残留。

**已经就位的部分**：Agent Context Adapter（读 scene / revision / simulation /
verification / observations / time / question context）、工具契约
（`physics.ui.highlight` 为纯视图，`physics.scene.setParameter` 走 SceneCommand）、
以及「答案必须引用 runtime 已产出的事实」的 source chip 机制。

**开始条件（已变化）**：Agent Service 已可用（dsh agent + tool-physicsos）；
真正待定的是产品面——抽屉内嵌问答升级模型应答意味着每次提问一次 LLM
往返与配额消耗，需要与「确定性即时层」定位拍板后再动。

---

## APPS_WEB_STANDALONE_RETIREMENT_BACKLOG

**状态**：**已关闭**(2026-09-25)。整目录删除(25 个文件,git 历史可查);
`pnpm-workspace.yaml` 去掉 `apps/*` glob,`boundary.ts` 注释指向
harness 客户端包,README/01 开发指南两处文字改为「已删除,正式入口是
`dsh-client-ui-physicsos`」。无代码 import 引用它——`boundary.ts` 里
只是注释。

**遗留**:pnpm-lock.yaml 还残留 `apps/web` 的 importer 段,下一次能跑
`pnpm install` 时会自动清掉(当前 worktree 配置使 install 不可跑)。

## GUIZHOU_SCHOOL_ROSTER_HIGH_SCHOOL_GAP

**状态**：部分修复（2026-09-21 补 15 所）。**仍不全**，但远没有本文档上一版
写的那么严重——上一版的判断是错的，先更正。

### 更正：上一版"15 所旗舰校缺失"是误判

上一版用**口语短名**去 grep（`贵阳一中`、`凯里一中`、`都匀一中` …），得出
"20 所里 15 所不在册"。这个结论**不成立**：名录用的是**官方全称**，短名当然
grep 不到。逐条复核后：

| 口语名              | 名录里的实际条目                    | 状态     |
| ------------------- | ----------------------------------- | -------- |
| 贵阳一中            | `贵阳市第一中学`                    | 在册     |
| 贵阳实验三中        | `贵阳市第三实验中学`                | 在册     |
| 贵阳六中 / 九中     | `贵阳市第六中学` / `贵阳市第九中学` | 在册     |
| 清华中学            | `贵阳市清华中学`                    | 在册     |
| 安顺一中            | `安顺市第一高级中学`                | 在册     |
| 铜仁一中            | `铜仁第一中学`                      | 在册     |
| 毕节一中            | `毕节市第一中学`                    | 在册     |
| 凯里一中            | `贵州省凯里市第一中学`              | 在册     |
| 都匀一中            | `黔南州都匀第一中学`                | 在册     |
| 兴义一中 / 兴义八中 | —                                   | **缺失** |
| 遵义四中            | —                                   | **缺失** |

**方法论的教训**：核对名录必须用官方全称或做归一化匹配（去掉"省/市/州"、
"第…中学"↔"…中"等变体），否则会得出完全相反的结论。这正是
`resolveSchoolByName` 做 name/shortName 双路匹配的原因。

### 独立验证：黔东南州高中覆盖其实是好的

抓黔东南州教育局《2025年全州高中教育学校名录》并**解析表格**（序号/名称/
负责人/师资/教学环境/电话六列，共 52 行，其中 4 行是职业技术学校）：

```
https://www.qdn.gov.cn/zwgk_5871642/zdlyxxgk/ggqsy_5872177/202408/t20240820_85407269.html
```

**48 所普通高中里 46 所已在册**，只补了 2 所（镇远县文德民族中学校、
贵州省镇远中学校）。所以"黔东南只有 80 条、严重不足"这个印象也需要修正——
那 80 条是**初中**侧的缺口（州站确无初中名录），不是高中侧。

### 真实缺口（本轮已补 15 所）

| 来源                                                               | 抓到    | 在册 | 补入 |
| ------------------------------------------------------------------ | ------- | ---- | ---- |
| 黔东南州教育局《2025年全州高中教育学校名录》                       | 48 普高 | 46   | 2    |
| 黔西南州教育局《2025年高中阶段民办学校年检结果公示》+ 基础教育栏目 | 13      | 0    | 13   |

**根因很清楚**：黔西南州那批数据当初来自《黔西南州义务教育统计表》——
**义务教育**，所以兴义市在册的几乎全是镇/街道初中（七舍镇中学、万屯镇中学、
乌沙镇中学 …），**州府的高中一所都没有**。

**仍然缺失**（本轮没找到官方名录页）：

- 兴义市的**公办**高中：兴义一中、兴义八中、兴义五中 …
- 遵义市第四中学（省级一类示范性普通高中）
- 贵阳/遵义/六盘水/安顺/毕节/铜仁/黔南 六市州的**完整高中名录**——
  这些只做过抽查，没有逐条比对过，所以"是否完整"目前**没有证据**，
  不能声称它们没问题

### 为什么没做完

需要各市州教育局的官方高中名录页。本轮打通了黔东南与黔西南两条路
（政府门户 → 栏目重定向 → 文档页），其余市州没找到对应页面，且：

- `web_search` 工具未配置（HTTP 401，端点未设）
- 搜索引擎（Bing / DuckDuckGo / Baidu）返回挑战页或 0 结果
- 贵州省教育厅站内搜索是纯 JS 驱动，静态 HTML 里没有端点
- 阳关高考院校库实测 412 拒绝；维基百科被解析到非公网 IP

**开始条件**：拿到其余市州的官方高中名录（同样的"政府门户 → 教育局栏目 →
名录/招生计划文档"路径即可，黔东南/黔西南的 URL 已作为范例记在上面）。
补齐后按市州加下限断言到 `schools-data.spec.ts`，并用一所**高中**校名跑
`auth-acceptance.mjs` 的 CASE B 做注册回归。

### 附：名录仍不可复现

`schools-data.ts` 头部此前写"regenerate from the source TSV"，但**源 TSV
不在仓库里**（全仓无 `*.tsv`），这句话是空头支票。已改为如实说明：1566 行
来自一份不在库内的源表，无法重建；2026-09-21 新增的 15 行在数组尾部
**内联标注来源 URL**，可逐条追溯。要真正可复现，需要把源表落进仓库并补一个
生成脚本。

---

## LAB_CURRICULUM_TEMPLATE_GAPS

**状态**：**已关闭**（2026-09-22，§B 表全部补完，`lab-search-recall` 的已知缺口清零）。原批次①②③④与 ⑤ 的全反射已上线（流体压强 / 电生磁全组 /
机械能 / 光的直线传播 / 全反射）。实验中心现有 **71 个模板**（70 个可创建；
`cyclotron` 标「即将支持」，仍出现在书架上 —— 59 是 2026-09-22 在书架上一张张数出来的，
②b ③ ④ ⑤ 又各加了台）。剩下的七组集中在 §B 表的末几行。

**怎么发现的**：写了一个搜索召回探针，把学生/教师真会输入的说法打进实验中心的
搜索框，只看 `[data-physicsos-shelf]` 里的浏览卡片。
（**注意**：推荐栏那 3 张卡在任何输入下都在，所以统计整个面板会把"零命中"
看成"3 命中"——第一版探针就是这么骗过我的。）

第一轮 51 个口语词里 **26 个零命中**。分成两类：

**A. 别名缺口（已修，12 个模板补词）** —— 实验确实覆盖该概念，只是那个说法没进
索引。补了 `光的反射`、`折射`、`凝固`、`物态变化`、`浮沉`、`自由落体运动`、
`串并联`、`滑变`、`发电机`、`声音`、`反射定律`、`声学` 等，零命中 26 → 18。

**B. 真模板缺口（本文档条目）** —— 引擎里没有对应物理，**没有诚实的别名可指**
（硬指过去会把学生送到错的实验室）：

| 缺失课题                                    | 所属      | 备注                                                                                                                                                                                                                                         |
| ------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~压强 / 大气压~~                           | 力学·流体 | ✅ **批次①已补**（2026-09-22，见下）                                                                                                                                                                                                         |
| ~~机械能 / 势能~~                           | 力学·能量 | ✅ **批次③已补**（2026-09-22，见下）                                                                                                                                                                                                         |
| ~~向心力~~                                  | 力学·天体 | ✅ **已补**（2026-09-22）：挂在 `magnetic-circular` 上的**有据别名** —— `qvB = mv²/r` 与 `r = mv/(qB)` 是**同一个方程的两种写法**，洛伦兹力就是那个指向圆心的合力                                                                            |
| 万有引力                                    | 力学·天体 | 🟡 **物理层已落地并验证**（`engine-mechanics/src/orbit.ts`，5 条金子测试：空间站 7656 m/s / 93 min、同步轨道 42164 km、开普勒第三定律作为推论、质量从轨道里约掉）；**尚未接成实验**——缺 `circular_orbit` 模型接线 + 场景工厂 + 模板 + 客户端 |
| ~~通电螺线管 / 安培定则 / 电磁铁 / 电动机~~ | 电磁      | ✅ **批次②（a + b）已补**（2026-09-22，见下）                                                                                                                                                                                                |
| ~~小孔成像 / 光的直线传播~~                 | 光学      | ✅ **批次④已补**（2026-09-22，见下）                                                                                                                                                                                                         |
| ~~全反射~~                                  | 光学      | ✅ **批次⑤已补**（2026-09-22，见下）                                                                                                                                                                                                         |
| ~~音调 / 响度~~                             | 声学      | ✅ **已补**（2026-09-22）：挂在横波台面上的**有据别名** —— 音调是频率、响度是振幅，两者在那台实验里都是可读可调的旋钮                                                                                                                        |
| 噪声                                        | 声学      | ❌ **判定为不该补（2026-09-22）**：噪声控制（隔声 / 吸声 / 消声）是工程问题，没有诚实的台面可指                                                                                                                                              |
| ~~沸腾（水的沸腾）~~                        | 热学      | ✅ **批次⑤已补**（2026-09-22，见下）：heating-curve 加了**第二个平台**（等温汽化）                                                                                                                                                           |
| 温度计                                      | 热学      | ❌ **判定为不该补（2026-09-22）**：课标那节讲的是**仪器**（量程 / 分度值 / 读数 / 体温计的特殊结构），热学台面只是**用到**温度计而不是在教它 —— 判据同「噪声」：实验真的覆盖该概念才挂别名                                                   |
| ~~变压器~~                                  | 电磁感应  | ✅ **批次⑤已补**（2026-09-22，见下）：`ideal_transformer` 模型 + 模板 `transformer`                                                                                                                                                          |
| ~~短路~~                                    | 电路      | ✅ **批次⑤已补**（2026-09-22，见下）——回路里没有负载，`I = E/r`，路端电压 0                                                                                                                                                                  |

**批次①（2026-09-22）：流体压强三台** —— 引擎**本来就够**
（`packages/engine-fluid/src/pressure-engine.ts` 早就在，带派生量与 6 条校验），
这一批是把它**接到界面上**：

- `solid-pressure` 探究压力的作用效果：同一个 20 N 先压 200 cm²（1000 Pa）再压
  50 cm²（4000 Pa）—— 压力一动不动、压强翻四倍，`contact_force_invariant` 守着它
- `liquid-pressure` 探究液体内部的压强：水 20 cm / 40 cm / 盐水同深度，
  三条校验分别是「随深度线性」「随密度线性」「静水梯度积分」
- `atmospheric-pressure` 大气压的测量：托里拆利柱 `p₀/(ρ_液·g)` = 760.05 mm 与
  马德堡半球 `p₀·πr²` = 795.61 N —— 两个数都不在场景里存着，是从同一个 p₀ 派生出来的

新增 2 条场景命令（`SetPressureBarometerFluidDensity` / `SetPressureHemisphereRadius`），
各自要走 **四处**：physics-scene 的命令联合 + 载荷表 + 事件联合 + 载荷表，再镜像到
agent-tools 的命令表、`experimental-branch.ts` 的 FACT_COMMANDS、以及检查器运行时表 ——
少任何一处就是「检查器上有一行能改的输入，改了却永远不会生效」。界面侧新增
渲染器 / 视觉桥 / 工作区运行时 / 客户端 spec 四个文件。

**这一批的教训**：三台装置都是**先按算术摆好、事后才第一次看图**的，结果两张图各
有一个缺陷 —— 大气压的「汞柱顶（真空）」与「汞面」两个标注被摆到画布外（导引线画到
了 extent 之外），液体压强的「液面」标注则被整条丢掉了。修完把它们变成了常驻门禁
`tests/acceptance/pressure-rigs-shot.mjs`：两个视口截图 + 标注越界检查 + 「汞柱画在
玻璃管里」的矩形实测 + 「标注不压在汞柱上」的重叠实测。**摆出来的坐标必须被量过，
看一眼是看不出来的。**

**批次②a（2026-09-22）：电流的磁场两台** —— 这一批**引擎是新的**
（`magnetic` 只有洛伦兹力的粒子解算器，没有任何电流磁场模型）：

- `straight-wire-field` 通电直导线周围的磁场：`B = μ₀I/(2πr)`，
  10 A 在 5 cm 处是 40 µT、10 cm 处正好 20 µT —— μ₀ 里的 π 与 2πr 抵消，
  两个读数都是整数，这是"距离加倍磁场减半"在图上一眼可见的原因
- `solenoid-field` 通电螺线管内部的磁场：`B = μ₀(N/L)I`，
  n = 2000 匝/米、I = 5 A → 4π×10⁻³ T ≈ 12.57 mT，匝数翻倍磁场翻倍，
  管口恰好是管内的一半

引擎落在 `packages/engine-magnetic/src/current*.ts`（模型 / 物理 / 引擎三个文件），
`canHandle` 靠"有没有 currentBenches"与洛伦兹解算器互斥。物理侧有 4 条校验，
每条都是**两种算法对得上**而不是把公式再说一遍：直导线的无限长极限对毕奥–萨伐尔
有限长结果（取 100 倍探测距离长，差 < 10⁻³）、B·r 不变量、螺线管管口磁场 ×2、
匝数比。新增 6 条场景命令（电流 / 探测距离 / 对比距离 / 匝数 / 对比匝数 / 长度），
每条都要走 **四处**（命令联合 + 载荷表 + 事件联合 + 载荷表）再镜像到 agent-tools、
FACT_COMMANDS 与检查器运行时表。

**两处设计决定直接承载物理**：直导线画成**垂直纸面**（⊙ 出纸面 / ⊗ 进纸面），
磁场才画得成同心圆，安培定则从图上直接读得出（拇指指电流、四指绕磁场，箭头就按
这个方向画）；螺线管轴向磁感线的**顶点顺序就是磁场方向**，电流反向时是整条线反过
来，而不是留着箭头指旧方向。

**这一批的教训**：两张图第一眼都"看着没问题"，是新门禁
`tests/acceptance/magnetic-rigs-shot.mjs` 量出来的 —— 探测点的读数标签**压在它自己
读数的那圈上**（标签宽 37 px、环间空隙 40 px，放哪儿都蹭）。修法不是挪一点点，而是
按几何算：标签放在"本圈与下一圈之间"的带子中点，且留在自己那条射线上。同一份门禁
还量"两个探测点是否真的落在各自读数的圈上"（圆心距 = 半径）与"读数是否压在匝上"。

**顺带修掉一个真缺陷**：`numeric-audit.client.spec.ts` 里手抄了一份
`buildWorkspaceRuntime` 的调度镜像；一个域出现第二个台面时它就烂掉了（新台面落到
隔壁运行时手里、被判 `failed`）。现在直接调用 LabWorkspace 的那一份，镜像不可能再烂。

**批次②b（2026-09-22）：电磁铁** —— 与螺线管**共用同一台线圈**，差别只是插了铁芯，
所以它不是新台面而是同一台面的第三种模型（`electromagnet`）：同一个 200 匝 / 20 cm /
1 A 的线圈，空气芯只有 1.257 mT，插上 μ_r = 200 的铁芯变成 0.2513 T。

真正要教的是**平方**：铁芯把磁场乘 μ_r，而吸力 F = B²A/(2μ₀) 与 B 的平方成正比，于是
按 μ_r² 放大 —— 4 cm² 的极面从 0.25 mN 变成 10.05 N，**四万倍**，能吸起约 1 kg 铁；
换 μ_r = 800 的铁芯再涨 16 倍到 160.8 N。三条校验各守一个平方：B_core/B_air = μ_r、
电流加倍吸力四倍、换芯按 μ_r² 变。表里排的是**空气芯 / 主铁芯 / 对比铁芯三行** ——
空气芯那一行才是"铁芯有什么用"的答案。

**这一批的教训**：μ_r 一开始写在铁芯棒上（"把材料写在材料上"），门禁立刻量出来
**压在匝上** —— 铜线每 9 px 横穿一次，任何贴在棒上的字都会被划断。读数只能写在装置
旁边。同一门禁还补了一条**标注互相压住**的检查：文字在画布内、也没压装置，仍可能被
另一条标注盖住，那是前面几种检查都看不见的一种坏法。

**批次②b-2（2026-09-22）：电动机** —— 电生磁这一组最后一块，也是与前两台
**方向相反**的一台：前两台问「电流能生出什么磁场」，这台问「磁场能把电流推成什么」。

B = 0.5 T、n = 100、I = 2 A、6 cm × 4 cm 的线圈：两条边各受 F = B·I·L = 0.06 N，
方向相反、相距一个线圈宽度，合成力矩 τ = n·B·I·A·cosθ = 0.24 N·m。三条校验：
安培力合成与 nBIA 两条算法对上、θ = 90° 时力矩恰好为零、以及**换向器**——
跨过平衡位置时裸线圈的力矩会反向，把电流反向一次就回到原方向。这里的规律与
电磁铁形成对照：**吸力按 B² 涨，力矩与 B 成正比**，同一片磁场两种装置两种"更强"。

画法沿用一台一台试出来的经验：转子**沿轴向看**，两条受力边就是两个点，而 B 是水平的
所以力始终竖直 —— 角度改变的是**力臂**而不是力。转过 90° 时两个点上下对齐、两股力
在同一条直线上拉，那就是平衡位置，画出来比讲一遍清楚。

**这一批的教训**（门禁自己抓出来的，三次都不是我"看"出来的）：

1. **符号不能取绝对值**：力矩写成 `n·B·|I|·A·cosθ` 时，电流反向力矩不变 —— 于是
   换向器那条校验永远算不出"反向一次就回到原方向"。金子测试直接把它照出来了：
   `afterCommutated` 与 `before` 反号。
2. **均匀场不能画成两半**：B 的箭头一开始左右各指向外侧，那是**两个**场不是**一个**。
3. **读数标注不能贴在铁芯/铜线上，也不能放在面板底下**：μ_r 写在铁芯棒上被匝划断；
   电动机的力矩标注放在转子上方，被**阅读面板的底衬**盖住 —— 标注互相压住的检查看不见
   背板，因为面板的画布文字没和它重叠。最后把它挪到转子左侧、两行场线之间的空带里。

**批次③（2026-09-22）：机械能两台** —— 引擎是新的（`engine-mechanics` 只有动力学，
没有能量账本），落在 `packages/engine-mechanics/src/energy*.ts`：

- `mechanical-energy` 动能与势能的转化：2 kg 的小车从 90 cm 高处沿光滑斜面滑下，
  Ep = mgh = **17.64 J** 全部变成动能，到底端 **v = √(2gh) = 4.2 m/s** —— 两个数都
  落在整数上（2gh = 17.64 正好是完全平方），而且**速度与质量无关**
- `ramp-friction` 机械能的损失去哪儿了：同样的车与高度、μ = 0.2，到底端的动能少掉
  3.53 J，那部分变成摩擦生的热；把倾角调缓，摩擦**反而拿走更多**

三条校验：账本两边相等（Ep = Ek + Q）、速度与 √(2gh) 对得上、摩擦做功两条算式一致。

**这一批的教训（测试又一次纠正了我写错的物理）**：我原本断言「摩擦做功只与高度有关，
W = μmg·cosθ·L 化简后就是 μmg·h」—— **错**。代入 L = h/sinθ 得到的是
**W = μmg·h·cotθ**：斜面越缓，路程按 cotθ 变长而正压力只按 cosθ 变小，**摩擦拿走的
反而更多**；只有当 θ = 45°（cot = 1）时它才在数值上等于 μmg·h，而我的默认倾角正是
45°，所以这个错误在默认场景上"看着是对的"。金子测试在 22.5° 上把它照了出来
（8.517 J ≠ 3.528 J）。引擎、命令文档、模板文案与教学摘要四处都跟着改了。

界面侧的账本画成**一条堆叠条**：动能与热两段的宽度就是各自占出发时总能量的比例，
两段之和**必须正好铺满整条**——守恒与否在图上是一条条的，所以常驻门禁
`tests/acceptance/energy-rigs-shot.mjs` 直接断言这条（两个视口、两台各一次）。

**批次④（2026-09-22）：光的直线传播** —— 引擎是新的（`engine-optics` 只做成像，
没有直线传播模型），落在 `packages/engine-optics/src/light*.ts`：

- `pinhole` 小孔成像：6 cm 的箭头在孔前 30 cm、屏在孔后 15 cm → **3 cm 的倒像**，
  放大率 **v/u = 1/2**（两个数都是整数，因为 6 的一半就是 3）

**倒立不是存下来的标志位**：`imagePointOf` 让「物点 → 孔 → 屏」的直线自己给出像点
（顶端落在轴下、底端落在轴上），引擎再用它与 `h′ = h·v/u` 互校 —— 三条校验分别是
直线的像点、倒立的符号、以及两个距离各自的比例（屏越远像越大、物越远像越小）。

图上物与像**都按真实尺寸画**（6 cm 对 3 cm）：这张图要说的就是这两个箭头之比，
任何一个被缩放，这处实验就成了唯一会说谎的地方。门禁
`tests/acceptance/light-rigs-shot.mjs` 因此直接量几何：**两条光线都过小孔**（两条折线
的中间顶点是同一点）、**像在屏上倒过来**（顶端那条的落点在孔的下方、底端那条在上方）、
物与像分居小孔两侧。

**批次⑤-1（2026-09-22）：全反射** —— 引擎扩成判别联合
`ResolvedPinholeModel | ResolvedRefractionModel`，同一台光具台的第二种模型：

- `total-reflection` 全反射：玻璃（n₁ = 1.5）→ 空气（n₂ = 1.0），临界角
  θ_c = arcsin(n₂/n₁) = **41.81°**。45° 入射**已过临界角，折射光线不复存在**；
  降到 30° 折射光线立刻出现在 48.59°

**这一组建模上最要紧的一句话**：全反射是**折射支路的消失**，不是"折射角接近 90° 的
强烈折射"。所以 `refractedAngleOf` 在过临界角时返回 `undefined`（而不是夹到 90°），
三条校验都围绕这个"缺席"写（临界角两侧各探一点，确认一边有解、一边无解），图上不画
那条掠射光线 —— 画了就是与旁边的读数自相矛盾。

**又一处 dispatch 漏洞（门禁抓的）**：`OpticsDomainRenderer` 只认 `lightRig`，而折射台面
carry 的是 `lightRefraction` —— 于是全反射场景静默落到了成像渲染器上：**读数面板全对，
图一条线都没有**。这类"分发器只认识两台中的一台"的错，这一会话已经出现三次（数值审计
的调度镜像、光学的渲染分发、以及最开始的流体），每次都只有靠**在真浏览器里量图**才能
照出来。

**批次⑤-7（2026-09-22）：变压器** —— 独立的新引擎 `engine-transformer`
（induction 的 `flux_change` 是"磁通匀变"，变压器是"两个绕组共享同一磁通"，是两个模型）：

- 场景 `TransformerBench`（一次电压/电流 + 两个匝数），dΦ/dt **不存**，由
  `U₁ = N₁·dΦ/dt` 推出
- 校验三条：**两绕组共享一个磁通**（各自 `U/N` 反算的 dΦ/dt 必须相等）、
  **功率守恒** `U₁I₁ = U₂I₂`、**匝比就是这台机器**（副绕组加倍 → 电压加倍、电流减半、
  功率不动）
- 模板 `transformer`：1000 匝进 200 匝出、220 V / 0.1 A → **输出 44 V / 0.5 A，
  功率依旧 22 W**
- 命令四条（电压 / 电流 / 两个匝数），客户端为 induction 域加了第二支渲染（两个绕组 +
  铁芯 + 三组读数，**匝数只画圈数当墨色**——一千匝画不出一千个圈）

**批次⑤-6（2026-09-22）：万有引力与向心力** —— 从「一段孤立物理」接成一条可跑的链路
（工厂 → 选择器 → 解析器 → 引擎 → 校验）：

- 场景：`MechanicsModelId` 加 `circular_orbit`；工厂把 GM 与 r 声明成**一个 observable**
  （`kind: 'orbit'`），并据此把天体放到 (r, 0)、给上 √(GM/r) 的切向速度 ——
  **引擎再从 GM 与 r 重算一遍**，所以场景那句不是第二个事实来源
- 选择器：`kind === 'orbit'` 就是信号（那台场景里没有别的东西能表示圆轨道）
- 状态：位置在圆上、速度沿切向、加速度**始终指向圆心**（同一个矢量转一圈）
- 派生量：r / v = √(GM/r) / T = 2πr/v / a = v²/r / F = GMm/r²；**运行长度 = 一个周期**
- 校验：①**引力供给的加速度 = 速度要求的加速度**（v²/r vs GM/r²）②开普勒第三定律作为
  **比值**（r ×4 → T ×8，在第二个半径上另算）
- 模板 `circular-orbit`：地球 GM = 3.986×10¹⁴、r = 6.8×10⁶ m（约 420 km 高）→
  **v = 7.656 km/s、T = 93.0 min** —— 正是国际空间站的轨道

测试里最要紧的一条是**几何自洽**：每个采样点上速度大小恒定、`a·v = 0`、`a·r < 0` ——
三条同时成立才是圆周运动，只对上一条都不算。

**批次⑤-5（2026-09-22）：水的沸腾** —— 热学引擎加了**第二个平台**，加法式改动，
两相台面一条行为都没变：

- 场景 `ThermalSample` 两个**可选**字段：`boilingPoint` + `vaporizationHeat`（不写就还是
  原来的熔化工况）
- 曲线多一个相位 `'boiling'`：**加热器还在供 P，热全进相变，温度计不动** ——
  这正是「探究水沸腾时温度变化的特点」要读的那一段
- 模板 `boiling-water`：500 g 水从 20 °C 起、500 W 加热，**336 s 到 100 °C，之后 2260 s
  温度纹丝不动**（Q = mL_v = 0.5 × 2.26×10⁶ = 1.13 MJ）

**三个被引擎自己的校验逼出来的真问题**（都不是看出来的）：

1. **液相从哪开始升温**：沸腾计时原来从**熔点**算，于是 20 °C 的水被算成从 0 °C 升上来
   （420 s 而不是 336 s）——测试在 336 上把它照出来
2. **运行该在哪结束**：`runDuration` 写到 3600 s，可水在 2596 s 就烧干；账本拿 `P·3600`
   比一个早已停止吸热的样品，残差恰好 502 kJ。改成**运行在物理结束时结束**
3. **「已熔化的样品必须给时长」这条前置条件**：它的理由是"没有平台可停"，而沸腾**给了**
   第二个平台（水烧干），所以这条限制现在只对**永不沸腾**的液体成立

客户端也跟着补了 `'boiling'` 相位（视觉模型的相位联合 + 两个平台共用一种"正在相变"的
墨色）——**类型系统在 4 处把漏掉的分支点了出来**。

**批次⑤-4（2026-09-22）：短路** —— **没有新引擎**：短路本来就是一个纯电阻网络里
`R = 0` 的回路，而 circuit 引擎早就在解 netlist。所以这一组是**一个新场景模板**：
电源（带内阻）→ 开关 → 电流表 → 回到电源，回路里**什么负载都没有**。

E = 6 V、内阻 r = 0.5 Ω → **I = E/r = 12 A**，路端电压掉到 **0 V**（全部电动势落在
内阻上，外电路分到零）。数字审计自动把它跑过真实调度链，确认引擎认这个回路并给出
合格校验 —— "负载拿掉之后还剩什么" 这句话因此是可验证的，而不是一句说明文字。

**批次⑤-3（2026-09-22）：音调与响度（别名，非新台面）** —— 这两个词属于本文档开头
说的 **A 类缺口**：实验确实覆盖该概念，只是那个说法没进索引。判据写进代码里了——
**声音的音调由频率决定、响度由振幅决定**，而横波台面把 `振幅 A` 与 `频率 f` 都做成
可读可调的旋钮（`v = λf` 连着波长），换的只是介质（绳而不是空气），不是那条规律。
所以它们是挂在 `wave-travelling` 上的**有据别名**，不是硬指；摘要里也补了两步引导
（「把频率调高：若这是一根发声的弦，音调会怎样」「把振幅调大：波峰更高而波长不变」）。
`噪声` 留在缺口里——「噪声控制」是工程问题，没有诚实的台面可指。

**批次⑤-2（2026-09-22）：万有引力与向心力（物理层）** —— 走的是**自足的物理 + 金子
测试**这一步，没有动场景与客户端，因此主链路保持全绿：

`packages/engine-mechanics/src/orbit.ts`：`v = √(GM/r)`、`T = 2πr/v`、`a_需 = v²/r`、
`a_供 = GM/r²`、`F = GMm/r²`，`GM_地球 = 3.986004418e14`。

金子测试用一个**真实锚点**锁住整组数——国际空间站（r = 6.8×10⁶ m）：**v = 7656 m/s、
T = 93.0 min**，420 t 的站体受 **3.62 MN** 引力。另有三条关系在互校而不是抄公式：
①圆轨道的定义就是 `v²/r` 与 `GM/r²` 两个独立算法必须相等（"向心力由引力提供"的可执行
版本）②开普勒第三定律是**推论**：r ×4 → v ÷2、T ×8 ③地球同步轨道 42 164 km /
23.93 h / 3075 m/s 由 `GM/r³ = (2π/T)²` 反解验算。**质量从轨道里约掉**（重卫星受力
×10，速度与周期一模一样）。

**下一步**：把它接成 `circular_orbit` 模型（types / resolvers / selector / engine 四处
＋场景工厂与模板＋客户端），然后放出 `万有引力`、`向心力` 两个搜索词。

**规模**：拿产品自己的考点表（题库考点 + 已核验标注，共 126 个考点）去搜实验中心，
**只有 31 个能搜到**；补别名后升到 **70 个**，其余是本文档登记的模板缺口。
（31/70 是 2026-09-21 那次实测的数字，① ② ③ ④ 之后**都没有重跑过那条统计** ——
现在的覆盖面以 `lab-search-recall.mjs` 为准，它数的是词，不是考点。）

**已把它变成常驻门禁**：`tests/acceptance/lab-search-recall.mjs`（132 个必须可搜到
的词 + **0 个已知缺口**）。它是**双向棘轮**——已知缺口必须仍然搜不到，哪天有人把
实验补上，测试会失败并提示把该词移到 `FINDABLE`，所以这份清单不会烂掉。
每一批都是被它逼出来的：①上线后 `压强`、`大气压` 从缺口侧失败，②a 上线后
`通电螺线管`、`安培定则` 同样失败，②b 上线后轮到 `电磁铁`、`铁芯`、`电动机`、
`换向器` —— 按提示移过去，再补上 `液体压强`、`托里拆利`、`马德堡半球`、`受力面积`、
`压力的作用效果`、`磁场`、`右手螺旋定则` 等新词。

```
node tests/acceptance/lab-search-recall.mjs
→ 可搜到 132/132｜已知缺口 0/0｜ALL CHECKS PASSED
```

**开始条件**：按课标优先级补模板，**每批收尾保持 `pnpm typecheck` / `lint` / `test`
全绿**。**当前进度（2026-09-22 收工时）**：① 流体压强三台、② 电生磁四台、
③ 机械能两台、④ 小孔成像一台、⑤ 全反射 / 短路 / 音调 / 响度 —— 共 **66 个模板**，
召回 **132/132 词｜已知缺口 0/0**，四组截图门禁 + `typecheck` / `lint` / `test`
（web 762 + agent 95）全绿。

**批次⑤-8 / ⑤-9（2026-09-22）：温度计与噪声，以及两次判断反转** —— 这两项我都先
判过「不该补」，后来**自己推翻了自己**，因为按同一条标准一查，它们背后都有诚实的物理：

- **温度计** —— 液体温度计就是一条关系：`ΔV = V₀βΔT` 与 `Δh = ΔV/A` 合起来给出
  `h = h₀ + k·t`，灵敏度 `k = V₀β/A`。0.1 cm³ 泡 + 0.16 mm 细管 + β = 2×10⁻⁴ 给出
  **k = 0.9947 mm/°C**。**刻度之所以能画均匀，正是因为膨胀是线性的**；而冰水 0 °C 与
  沸水 100 °C 是**固定点**而不是另外两个读数 —— 它们之间的距离被分成 100 等份才有"度"。
  三条校验：液柱升高 = ΔV/A 两条算法一致、若干个 10 °C 间隔的升高等长、固定点定出量程。
- **噪声** —— `L = 10·lg(I/I₀)` 与 `I = P/(4πr²)` 合起来就是
  `L = Lw − 20·lg r − 10·lg(4π) − A`，于是**距离加倍少 6 dB**、10 倍少 20 dB；
  而 dB 是对数，少 6 dB 意味着**声强只剩四分之一** —— 这正是「在传播过程中减弱」
  管用的原因。屏障的隔声量是与距离无关的独立减法项。四条校验：Lw 与声强两条路线一致、
  6 dB 规律、屏障的独立性、dB 是对数不是差数。

**两次判断反转的教训**：「没有诚实的台面可指」这句话，只有在**真的去找过模型**之后才能说。
两次我都是凭"这看起来像工程/使用问题"下的判断，而实际上它们各自都有一条干净的定律。
（为此还给单位表加了 `intensity` 维度与 `W/m^2` —— 声强是这台装置真正算出来的量。）

**追加的封面**：`total-reflection` / `short-circuit` / `boiling-water` / `circular-orbit` /
`transformer` / `thermometer` / `noise` 七张 —— 图片站当天有段时间从本机 SSL 连不上，
后来恢复，全部生成并发布，并把 id 加回 `RASTER_ART`。

**规模终值（2026-09-22 收工）**：实验中心 **70 个可创建模板**（71 张书架卡片，
`cyclotron` 仍标「即将支持」）；召回词 **94 → 132**，**已知缺口 20 → 0**。
`typecheck` / `lint` / `test`（web 767 + agent 95 + core）全绿，四条截图门禁全绿，
七张追加封面已生成发布。本节关闭。

---

## DSH_CREDENTIALS_SCHEMA_SKEW

**状态**:**已修复(2026-09-25)** —— 读两种格式,并按读到的格式写回。

**为什么原判断(「环境治理而非产品能力」)是错的**:README 的「启动」一节把
`pnpm dev` 写成**唯一入口**,而它在任何被 Desktop 碰过 credentials 的机器上
**100% 起不来**(exit 1,profile 加载失败)。让 documented 入口无法启动的缺陷
是发布阻塞级。本轮先复现(`pnpm dev` → 3080 不监听,日志报
`the value for "version" … must be a string`),再修。

**修法**(`credentials-local/src/index.ts`,经 overlay 携带):

- 读出时先判形状:根节点带**映射**型 `refs` 即版本化文档(扁平文档的值全是
  字符串,不可能撞上这个判据),凭据从 `refs` 取;否则仍按根节点扁平映射读。
- `version` / `records` **不再被误当凭据引用** —— 否则会多出两个假键。
- **按读到的形状写回**(版本化文档写进 `refs`):不做这一步,两个写入方会在每次
  启动时**互相改写对方的格式**。
- 非字符串值、坏 `refs` 仍抛错 —— 放宽的只是「在哪一层找凭据」,不是「接受什么值」。

**验证**:`desktop-format.spec.ts` **4 条**(扁平可读 / 版本化可读且不漏
`version` 与 `records` / 版本化里的非字符串仍被拒 / `refs` 非映射仍被拒);
`credentials-local` 整包 **58/58**。**真启动验证**:修复后 `pnpm dev` →
端口 3080 LISTEN,`GET /` → **200**(12,416 字节,标题 `DeepSeek Harness`,
页面含 `physicsos`)。反向验证:读取改回「只认扁平」后该用例**确实失败**
(exit 1)。

**顺带修掉的机制缺陷**:`harness-overlay.mjs capture` 用 `git diff`,
**看不到 untracked 文件** —— 新增的 spec / 模块会不进 patch,在干净 clone 上
静默消失(本例的 `desktop-format.spec.ts` 就是)。现改为先
`add --intent-to-add` 纳入 diff,再 `reset` 还原索引,并把 `spawnSync` 的
`maxBuffer` 提到 64 MiB(patch 已越过默认 1 MiB,否则 ENOBUFS)。

### 原登记(保留,作为判断依据的更正记录)

- 本仓库 pin 的 `credentials-local` 把 YAML 根节点当扁平映射（键 → 字符串），
  逐条校验键名是 POSIX 标识符
- DSH Desktop 2.0.13 会把它改写成嵌套文档
  `{version: 1, records: {client-connection/browser-session: …}, refs: {…}}`

于是解析器读到 `version: 1`（数字，不是字符串）就抛
`the value for "version" … must be a string`，插件树加载失败。

**为什么现在不做**：修它要么升 pinned harness、要么让宿主与仓库共用同一份实现，
两条都要动 submodule pin 或宿主，属于环境治理而非产品能力；而且**改错方向会
弄坏 DSH Desktop 自己**（它可能正依赖新格式）。

**已提供的绕开手段**：`DSH_HOME` 指向镜像目录（symlink `profiles/` +
`settings.yaml`，空 `storages/`，只重建扁平 `refs`），
见 `docs/HANDOVER.md` §2.5 与 `tests/acceptance/support.mjs` 的
`startIsolatedServer()`。

**开始条件**：确认宿主版本与 harness 的 credentials 契约应当以哪一侧为准
（建议以新版为准，因为它已经落盘了），再统一。

---

## PAPER_STUDIO_DATA_STATE

**状态**：题库已灌入真实公开数据（2026-09-21）；**卷库仍只有 4 张卷**。
**引擎初筛已上线（2026-09-25）**:`POST /physicsos/paper/bank/items/triage`
对 pending 条目逐条盲解（复用 `independentSolve` 独立解题链）,把
`engine-check:agreed|mismatch(<engine答案>)|unresolved` 写进 `anomalies`,
**status 不动** —— 核验仍是人的判决。教师端「引擎初筛」按钮 +
「选中引擎一致」一键勾出盲解一致项,配合既有批量核验把 388 条的人工
过一遍压成一次确认。`review-batch` 的逐条审计语义不变。

`scripts/ingest-ceval-physics.mjs` 把 C-Eval 的 `middle_school_physics` 与
`high_school_physics` 两个学科全部 401 道单选题映射进题库：

```
题库   4 → 392 条   （195 中考 / 197 高考；388 待核验 + 4 原有已核验）
卷库   4 张卷        （未变）
```

**这批数据的性质必须说清楚**（NOTICE 与每条 `anomalies` 里都记了）：

- **不是贵州真题**，也未与任何试卷核对过。C-Eval 是公开评测集，不是卷源。
- 全部 `status: pending` → 需教师在出卷专区逐条核验后才参与组卷
- `reuseModes: ['adapt']`，**不含 `verbatim`** → 组卷算法只能拿它当改写骨架，
  不会原样印成试卷
- `answerTier: web-public`（最弱的、但仍具名的层级）
- 考点标签是**机器从题干+选项推得**的，标记 `knowledge-derived-from-stem`；
  难度/能力/分值该数据源没有，用了具名默认值并如实登记在 `anomalies`
- 许可：CC BY-NC-SA 4.0，与本仓库的 PolyForm Noncommercial 兼容，署名见
  `NOTICE.md`

**只有 2% 带解析（9/388）——但这不挡解析卷**。核对过链路：
`questionFromBankItem`（`verbatim`）会直接复制题库条目的 `answer.steps`，
而 `adaptBankItem` 是**让模型重新解题**并产出新的答案与步骤。本批数据只开了
`reuseModes: ['adapt']`，所以组卷只会走改编路径，解析由模型 + 独立解题轮产出，
题库缺解析**不会**传播成空解析。缺解析仍逐条记在 `anomalies` 里，供教师核验时
参考（若将来给这批题开 `verbatim`，就必须先补解析）。

**卷库为什么没动**：C-Eval 提供的是题目集合，**不含卷级元数据**（哪一年、哪个
地区、哪所学校），凭空补卷名就是编。要扩卷库仍需真实卷源——本轮已核实这条路
在当前环境下走不通：

- `web_search` 工具未配置（HTTP 401）
- Sogou / 360 搜索**可用**（本轮就是靠它们找到 C-Eval 的），但搜"贵州中考物理
  真题"只出商业聚合站（学科网 / 百度文库 / 道客巴巴 / 无忧考网 / 今日头条 /
  微信公众号），全部付费或需登录，且有版权
- **贵州省招生考试院**（`zsksy.guizhou.gov.cn`）**可达**，但只发政策、录取与
  公示信息——省级考试院不公开整卷，这是制度而非技术问题
- 开放数据集（C-Eval 等）有题目、没有卷级出处

**开始条件**（扩卷库）：拿到可核验的卷源（考试院发布、学校授权、或用户提供
扫描件/转录）。届时用同一套 `POST /physicsos/paper/sources` +
`.../annotations` 录入，`evidenceTier` 按实际来源选 `original-scan` /
`manual-transcript`，不要一律填 `web-public`。

---

## PNPM_FORMAT_IS_RED

**状态**:**已关闭**(2026-09-25)。`prettier --write` 全仓收口,
`.prettierignore` 新增 `overlays` —— overlay 文件必须与应用进 vendor 的
字节一致,不该被 prettier 改写(本轮它已把 `pdf.worker.min.js` 等 vendored
资产重排过,已从 vendor 逐字回拷复位)。`pnpm format` 现全绿。

---

## PHYSICSOS_CONSOLE_AND_DESKTOP_PLAN

**状态**:第 1 期**已完成**;第 2 期**四项已完成**(2.2 的聚合上报通道已上线,
采集字段按「学校 / 日期 / 知识点 / 对错,不收账号与答案原文」定稿;2.3 的
**离线公告缓存**也已补上 —— 见下方「2.3 的离线公告缓存」);
第 3 期的**三个 seam 契约已落地**(纯类型,不依赖 Tauri 包),但可签名的壳本身
仍**未动工**;第 4 期的**服务端半已完成**(设备登记表 / 远程注销 / 会话级失效 /
风控信号 —— 见下方「第 4 期的服务端半」),剩下的是**客户端半**,那部分要等第 3
期的 `DeviceBridge` 实现;第 5 期**只做了版本戳那一项**(方案自己标注「纯 Web
也需要」,所以不受证书阻塞)。第 3 期壳与第 4 期客户端半共同卡在非代码前置条件上
—— **别把已经落地的契约、版本戳与服务端半读成那三期整体已经动工**。方案原文在
`~/.claude/plans/merry-crafting-alpaca.md`。

**这一节存在的意义**:方案本身不在仓库里,而方案里写死的判断依据(哪个 host
零鉴权、学习记录只存 localStorage、签名证书是硬前置)如果不落进仓库,下一个
接手的人会重新查一遍,或者更糟 —— 照着界面上的空数字以为功能已经做完。

> 第二层上线后,「学习记录只存 localStorage」这句话**仍然成立**(服务端依旧
> 读不到它)。变的是我们另外开了一条只收四个字段的聚合通道 —— 别把这两件事
> 混起来,也别以为那条通道能反查个体。

### 第 4 期的服务端半(已完成,2026-09-25)

方案把第 4 期整个列在「证书阻塞」下面,但**能签名的壳**才是障碍,服务端的设备
登记与注销根本不需要证书。这一半本轮做完了,而且它自己就值得做:远程注销是**权
限**功能,不是打包功能。

- **设备登记** `POST /physicsos/auth/devices`(登录 / 注册时带上 `deviceId` 也会
  自动登记):键 `userKey|deviceId`,幂等,只累加 `seenCount` / `lastSeenAt`。
- **只收哈希**:`deviceId` 必须匹配 `^[a-f0-9]{16,128}$`。原始
  `IOPlatformUUID` / `MachineGuid`(带连字符、带大写)在解析阶段就被拒 ——
  「只上传哈希」不是注释,是正则。没带 `deviceId` 的登录照常,登记是**增项而不是
  进门门槛**(用户已确认不做一机一码锁死)。
- **远程注销** `POST /physicsos/admin/devices/:deviceId/revoked`,按**物理机器**
  记账(`device_revocations`,键 `scope|deviceId`),不是按某一行。这一条是改出来
  的:第一版把注销记在 `(账号, 设备)` 行上,同一台机器换个账号登录就是一行干净
  记录,**注销被绕过**;`devices.spec.ts` 里「换账号也一样」那条用例现在钉住它。
- **注销立即生效**:新登录拿 403 `DEVICE_REVOKED`,而**已经在线的会话下一次解析
  就是 401** —— 不必等 cookie 过期。两道机制各自独立(注销时踢会话 + 解析时判
  定),反向验证过:两条都摘掉,验收里那条断言确实红。
- **归因诚实**:注销只断**声明过这台设备**的会话。一条没带 `deviceId` 的会话不被
  连坐 —— 它可能在任何一台机器上,把账号别处的登录一起踢掉不是「注销这台设备」
  的意思。验收里有对照组钉住这一点。
- **租户边界**:超管的注销是平台级(`scope='*'`,对所有学校生效),校管理员只能
  注销本校设备;恢复只删自己那一把锁 —— **校管理员解不开平台级注销**。审计按
  **受影响租户各写一行**(GZU 有权在自己审计里看到「我们学校有台设备被平台注销
  了」),而不是只记在超管那所学校名下。
- **风控信号**(只记录与展示,**不自动封禁**):同账号 24h 内 ≥3 台设备
  (`account-multi-device`)、同设备 24h 内 ≥3 个 IP(`device-multi-ip`)。两者都
  从**已有行**推导,不新增采集;返回结构里**没有 IP**,地址只在计数时用过。
- **界面**:后台新增「设备」tab(`AdminDeviceTab.tsx`),列表 / 注销 / 恢复 / 信号,
  平台级与校级状态分开展示。

**验证**:`packages/physicsos` **102/102**(原 83 + 新增 `devices.spec.ts` 19);
`ui-physicsos` **828/828**(821 + 设备 tab 7);全量 `typecheck` / `lint` /
`test`(core 1379 / agent 164 / web 828)全绿;真服务 + 真浏览器
`tests/acceptance/devices.mjs` **24 项 ALL CHECKS PASSED**(连跑 2 次稳定,
含反向验证)。回归:`notice-board` / `paper-access` / `lab-search-recall` 全绿。

**还没做的那一半**(要等第 3 期的 `DeviceBridge` 实现,或一张证书):客户端真正
去算哈希、`TauriPlatformBridge` 实现 `device`,以及宽限期授权(签名 + 时钟单调性
—— 那两点方案里写明不能假装解决)。

### 第 1 期:安全收口(已完成)

- `paper-host` 全线鉴权已接上:`auth-host` provide 会话解析,`paper-host`
  inject;GET 要求已登录,写路由要求 `TEACHER`,并按 `schoolId` 收窄租户,
  每次写入落审计。
- `PaperWorkspace` 进入前判角色,无权限显示说明而不是空面板;侧栏入口按角色
  隐藏。
- **验证据此不重复**:见本节末尾"验证"。

### 第 2 期:后台四项

| 项             | 状态         | 落点                                                                                                                |
| -------------- | ------------ | ------------------------------------------------------------------------------------------------------------------- |
| 2.1 内容管理   | 已完成       | `AdminContentTab.tsx`;暴露 paper-host 的 list/filter/上下架/异常清理                                                |
| 2.2 数据看板   | 已完成(两层) | `AdminDashboardTab.tsx` + `auth-host/src/service.ts` 的 `dashboard(actor)`;第二层来自 `reportLearning()` 的匿名聚合 |
| 2.3 反馈与公告 | 已完成       | **新包** `packages/physicsos/notice-host/`;`NoticeBoard.tsx` + `AdminNoticeTab.tsx`                                 |
| 2.4 批量运维   | 已完成       | `AdminOpsTab.tsx`(CSV 建号 / 批量停用 / 限流只读)                                                                   |

#### 2.2 的两层,以及第二层的隐私约束(实现即承诺)

**第一层(服务端自有行)**:学校数、用户数与角色分布、**可解析会话数**
(未撤销 + 未过期 + 账号仍 active)、14 天新增趋势、限流桶快照
(`AttemptLimiter.snapshot()`,只出聚合数字,不出 IP、不出账号)。

**第二层(实验与自测成效)**:学习记录**仍然只存浏览器 localStorage**
(`learning-record-store.ts`),服务端依旧读不到它 —— 这一点没变,也不该变。
所以第二层走的是一条**独立的、opt-in 的上报通道**:

- 客户端每次自测按知识点上报一次对错:`POST /physicsos/auth/usage/learning`,
  请求体**只有** `{ knowledgeId, correct }`。
- 服务端把它累加进 `learning_counts` 的一格,键是
  `schoolId|date|knowledgeId`(`auth-host/src/domain.ts` 的 `learningKey`)。
- **采集字段恰好四个**:学校(**取会话,不信请求体**)、日期(**取服务端本地
  时钟**,不是 UTC —— 否则晚自习的自测会掉进前一天)、知识点 id、对错。
- **一行里没有的东西**(这就是承诺的可执行形式,由 `learning-report.spec.ts`
  逐条钉住):没有账号 / userId / username、没有学生答案原文、没有题干、没有
  自由文本、没有 IP。两个学生报同一格 == 一个学生报两次,行数与内容完全一样。
- 知识点 id 走 `/^[a-z0-9-]{2,40}$/` 的形状闸门,客户端塞不进「学生写了什么」。
- 上报**不写审计**:审计是「谁改了什么」,而这条通道刻意没有「谁」。
- 代价说清楚:**它答不了个体学情**。那需要账号,而账号正是决定不收的东西。

看板在没人上报时显示说明文字而不是 0% 的柱子;`data-gap="learning-analytics"`
仍在,只是文案从「这层做不了」改成「还没有收到任何上报」。

#### 2.3 的离线公告缓存(**方案要求的那一条,本轮补上**)

方案原文:「公告:后台撰写 → 前端拉取并展示;桌面端离线时**缓存上一条**,
不显示空白。」这条一直没做 —— 本轮补上时先撞到一个**真缺陷**:

`NoticeBoard` 的两个面板原先共用一个 `Promise.all`,所以**公告接口失败会把
反馈表单一起带走**(`announcements` 停在 `undefined`,整个 surface 只剩一句
加载文字)。学生明明有个 bug 要报,却因为公告拉不到而看不到表单。

- **两个面板各自结算**:公告失败不影响反馈表单,反馈失败不影响公告。
- **缓存落在账户命名空间**(`auth.userStorage`,不是「这台机器」):本校公告
  不该跟着另一个账号登录出现在下一块屏幕上。键 `physicsos.notice-cache`,
  上限 20 条。
- **只缓存服务端真发过的行**,并且**画出来时标注「当前离线,这是最近一次收到的
  公告」** —— 方案要的是「上一条」,不是把旧公告冒充最新。
- 无存储 / 坏 JSON / 形状不对 / 配额写满,一律**静默退化**;版本号不该让界面
  起不来,缓存同理(`notice-cache.client.spec.ts` 的 8 条用例逐条钉住)。

**验证**:`ui-physicsos` **821/821**(808 + 缓存 8 + 面板 5);真浏览器
`notice-board.mjs` **18 项 ALL CHECKS PASSED**,新增的离线段**真的把公告接口
打成 503 再 reload** —— 断言缓存里的公告仍画出来、被标注为离线、且提交表单
还在,截图 `docs/reports/screenshots/notice-board-offline-cache-1600x900.png`
已肉眼确认。回归:整套 `typecheck` / `lint` / `test` 全绿(web 821 / agent 145 /
core 1379)。

> 那 5 条面板用例里有一条**反向验证过**:把旧的单 `Promise.all` 形状塞回去重跑,
> 它**确实失败**(`keeps the feedback form when only the announcements fetch
fails`,exit 1)—— 不是一条只会跟着代码变绿的橡皮图章。

#### 2.3 的一个语义决定(容易被误读成漏洞)

`/feedback` 是**任何登录账号**都可调的,学生提交后回来**只看到自己的行**。
这是**行过滤,不是门过滤** —— 路由本身不拦学生,拦的是可见行。回复要
`TEACHER`,发公告要 `SCHOOL_ADMIN`。学校管理员发公告时 `schoolId`
**从会话取**,不信任请求体。

### 第 3–5 期的硬前置(非代码)

- **macOS 公证需要 Apple Developer 账号($99/年)**;Windows 需要代码签名
  证书。没有这些,用户下载会看到"未知开发者"警告。**拿到证书信息之前不动工。**

#### 第 5 期里**也动了**的那一项:版本戳(方案自己标注「纯 Web 也需要」)

同一段方案写着「界面显示版本号 + 构建时间——**这是纯 Web 也需要的**」,所以它
不受证书阻塞,本轮直接做了:

- `tsdown.config.ts` 在**构建期**把 `__PHYSICSOS_VERSION__` /
  `__PHYSICSOS_BUILT_AT__` 替换成字面量(版本取自仓库根 `package.json`,唯一
  真源;时间戳取本次构建时刻)。构建产物里**没有残留占位符** —— 已用
  `grep` 核对(占位符 0 处,`"0.1.0"` 已注入)。
- `build-stamp.ts` 提供一个报障用的单行串(`0.1.0 · 2026-09-25`);**未注入时
  退化成 `dev` / `未注入`,不抛异常** —— 一个版本号不该让界面起不来。
- **构建日在构建机本地时间算好再注入**,不在浏览器里格式化那个时刻:构建日是
  **产物的属性**,不是读者的属性。否则同一次构建会在不同时区显示成两个日期;
  直接 `toISOString().slice(0,10)` 也不行 —— 那是 UTC 日界,东八区凌晨构建的包
  会被标成「昨天」。(与 2.2 里日期取服务端本地时间是同一个教训。)
  这两点由 `build-stamp.client.spec.ts` 的三条用例守着。
- 展示在两个报障时真正会被看到的地方:**登录页页脚**(没登进来的用户也能看)
  与**账户菜单底部**(已登录用户)。两处都是纯文本,不可点 —— 没有动作可做。

**验证**:`ui-physicsos` **808/808**(在 805 基础上 +3 —— 三条用例各钉上面
一个决定);构建产物已确认注入(`0.1.0` / `2026-09-25`,占位符 0 处)。

#### 第 3 期里**已经动工**的那一块:三个 seam 的契约

「等证书」卡住的是**可签名的壳**,不是设计。方案要求的顺序本来就是「先定契约、
再实现 `TauriPlatformBridge`」,所以契约这一半现在落地了,且不依赖任何 Tauri
包(纯类型):

- `packages/platform-bridge/src/types.ts` 新增 `DeviceBridge` / `UpdateBridge`
  / `StorageBridge`,作为 `PlatformBridge` 的**可选**字段。
- **设备指纹只上传哈希**:`DeviceIdentity` 同时带 `raw`(本机显示/排障)与
  `hashed`(上报),契约里写明 `raw` 绝不作为上报字段。用途仍是用户定过的
  「设备登记 / 远程注销 / 异常风控」,**不是**一机一码锁死。
- **`StorageBridge` 是断网可用的前提**:许可证要能离线读到。契约只回答
  「放哪儿」,不回答「怎么判」—— 签名校验与时钟单调性属于第 4 期,那两点
  (签名不能杜绝破解、改系统时间可绕)不在这里假装解决。
- 浏览器侧实现了 `storage`(localStorage,公告缓存用),**故意不提供**
  `device` / `updates`:`undefined` 让消费方在编译期就必须分开写两条路径,
  而不是拿到一个运行期才炸的假实现。`dataDir()` 在浏览器侧抛
  `UnimplementedError`,不返回一个会被当成真路径的 `''`。
- `createPlatformBridge('tauri')` **仍然抛 UnimplementedError** —— 契约有了
  不等于壳能跑,这条断言就是防误读的。

**验证**:`packages/platform-bridge` **6/6**(原 2 + 新增 4);
`tsc --noEmit` 与 `eslint` 全干净。

- 第 4 期宽限期授权有两处**必须在实现里明确处理、而不是假装不存在**:
  1 签名只能提高门槛,**不能杜绝破解**;2 宽限期依赖系统时间,改时间可绕,
  需要单调时钟或服务器时间校正。

### 验证(2026-09-25 实跑 · 2.2 第二层)

- `typecheck` web + agent 全绿;`lint` web + auth-host 全绿(oxlint 无输出)。
- `test`:`packages/physicsos` **145/145**(原 133 + 新增 `learning-report.spec.ts`
  12);`ui-physicsos` **805/805**(原 804 + 看板新增 1)。
- 真服务 + 真浏览器:`auth-acceptance.mjs` **ALL CHECKS PASSED**,新增 **CASE J**
  学生真登录 → 报 3 条自测 → 看板第二层出真实聚合(错得多的排前面)、且整段
  `learning` JSON 里查不到该学生账号。截图
  `docs/reports/screenshots/auth-admin-dashboard-learning-1600x900.png` 已肉眼确认。
- 回归:`notice-board.mjs` / `paper-access.mjs` /
  `lab-search-recall.mjs`(**132/132 | 已知缺口 0/0**)全部 ALL CHECKS PASSED。

**一个真实的落地陷阱**:真服务加载的是 tsdown 产物 `lib/index.js`,不是
`src/`。改完 `overlays/harness/files/...` 光跑 `apply` 不够 —— auth-host 与
ui-physicsos 都要各自重跑 `tsc -b <pkg>/tsconfig.json && tsdown`,否则验收会
对着旧 bundle 断言(症状:新路由 404、新界面元素永远等不到)。

### 验证(2026-09-24 实跑 · 后台四项)

- `typecheck` core + web + agent(含 notice-host)**全绿**。
- `lint` core / web / agent **全绿**。
- `test`:web **804**、agent **133**、core **1375**(按各包 vitest 报告累加)。
- 真服务 + 真浏览器:`paper-access.mjs`(连跑 3 次全绿)、`notice-board.mjs`
  (14 项,含"学生只看到自己提交的反馈")、`auth-acceptance.mjs`(含内容管理段
  与看板/运维段 CASE H/I)**全部 ALL CHECKS PASSED**;`lab-search-recall.mjs`
  **132/132 | 已知缺口 0/0**。

**修掉的第 4 个真缺陷(验收侧的竞态)**:`paper-access.mjs` 原本**不是稳定绿**
——同一个脚本连跑两次,会在不同的侧栏断言上失败(一次"教师的侧栏里有出卷专区
— 0 个入口",一次"学生仍然有物理实验室")。根因不在产品:`registerStudent` /
`loginUser` 是在**登录闸门 detach**(即 reload)那一刻返回的,而产品导航栏是
**再晚一拍**才挂载;紧跟其后的 `.count()` 因此会读到 0。反证是失败那次紧接着的
`.click()`(出卷专区)反而成功了 —— 说明按钮其实在。修法是给两个登录 helper 加
`await waitForShell(page)`(等 `role=navigation[name=PhysicsOS]` 可见),让
"这个角色被给了哪些入口"问的是一个已挂载的导航栏。修后连跑 3 次全绿。

- 截图已肉眼确认:`docs/reports/screenshots/auth-admin-content-tab-1600x900.png`、
  `notice-board-student-1600x900.png`。

> 注:`pnpm install` 会重写 patch 覆盖的文件,之后 overlay `apply` 的
> "already applied" 反查会失败 —— 用 `capture` 重新生成
> `overlays/harness/upstream-changes.patch`。这个坑已经踩过一次。

---

## PAPER_HOST_COMPOSITION_TEST_GAP

**状态**:**已关闭**(2026-09-24)。`paper-host/tests/composition.spec.ts` 已落地:
真实 Loader 链(`webserver + storage + storage-json + storage-domain + llm +
paper-host + auth-host`)、真 http 服务、真会话(经真实端点签发,不伪造 cookie)。
接线顺序**照抄出厂 row 顺序** —— paper-host 声明在 auth-host **之前**,与
`cordis.patch.yml` 一致 —— 因为正是这个顺序才会暴露"加载期查服务"的写法。

它一上线就抓出**三个真缺陷**,没有一个是我写测试写错:

1. **invariant companion 死锁**。`paper-host/src/invariant.ts` 原来注入
   `['invariants', 'storageDomain']`。全仓 223 个 companion 里 221 个只注入
   `invariants`(唯一的另一个例外是 `attachment-local`,它确实需要
   `attachments`)。companion 是在 invariant 屏障**内部**挂载的,所以一个去等
   Loader 托管服务的 companion,等的是被同一个屏障挡住的行 → 整条链
   `settled without becoming active`。已改为 `['invariants']`,域在 `check`
   里惰性读取(与 `auth-host/src/invariant.ts` 同款)。
2. **`imageApi` 被声明成必填**。它的内层字段全是 `.required()`,schemastery
   因此把**整个对象**也当成必填 —— 与这个字段自己的注释("absent → 题图打印
   为说明占位")和 `export.ts` 的 `if (api === undefined) return files` 直接矛盾。
   也就是说:**没有配生图端点的部署根本起不来**,只是上线时 `cordis.patch.yml`
   里恰好给了它,所以一直没暴露。改用
   `.default(undefined as unknown as {baseURL;model;apiKeyEnv;size})`。
3. **`routes.spec.ts` 从未被 lint 覆盖过的两个类型错误**:导入了根本不存在的
   `IdentityRole`,以及 `fakeDomain` 的自引用 `_tables` 字段(所有读取都被迫
   走 `as`,于是整个文件退化成 `error`/`any`)。前者已补进
   `paper-host/src/identity.ts`(两个 host 的角色联合因此只有一个出处),
   后者改成闭包局部 Map。

**schemastery 语义实测**(用 `tsx` 直接跑,不是推断):内层全 `.required()` 的
嵌套对象,外层不写 `.default()` 时 `A({req:'x'})` 抛
`$.nested.b missing required value`;`.required(false)` **无效**(同样抛);
`.default(undefined as unknown as T)` 通过。

**验证**:`packages/physicsos` **110 项全绿**(原 109 + 本组合测试 1);
`tests/acceptance/paper-access.mjs` 真服务 + 真浏览器 **ALL CHECKS PASSED**
(含"被拒的写入没有落库"与"审计在 52 ms 内落地、记的是教师本人");
`lab-search-recall` 仍 **132/132|缺口 0/0**。
---

## DOC_SYNC_CLEANUP

**状态**:**部分关闭**(2026-09-25 收口轮)。doc-sync 下属于本轮改动范围的
门禁全部绿;一条存量债务仍在账上。

**本轮修复(证据均为实跑)**:

- README 门禁:`verify-package-readme-model-experience` / `-limitations`
  **225/225 包通过**。4 个 physicsos host 包注册进 `SENTENCE_MODEL_EXPERIENCE`
  (`kind: 'none'`,理由:纯服务端宿主,不经模型);`ui-physicsos` 等包补齐
  `## Model Experience` / `## Known Limitations and Deferred Work` 规范段。
- `update-host/README.md` 整段重写 —— 原版是从 notice-host 复制的错版
  (写的是 `/physicsos/notice`、反馈与公告)。
- `verify-md-wrap`(一段一行)、`verify-md-links`、`verify-doc-refs`、
  `verify-public-repository-links`、`verify-package-paths`、
  `verify-config-source-ownership` **全绿**。两处 `docs/...` 引用原来指向
  外层仓文档(vendor 内不存在),改为不带 `docs/` 前缀的可定位文字。
- `verify-export-jsdoc`:**服务端三包 + 边界全部清零**
  (auth-host / paper-host / notice-host / update-host / ui-settings-models
  / ui-physicsos 非 `physics/` 目录)。`listExports` 顺带补了显式返回类型。
- 生成目录:`gen-tool-catalog`(`tool-physicsos` 注册进 `TOOL_PACKAGES` +
  tsconfig paths 映射)、`gen-config-catalog`(physicsos 的 Config 字段
  prose 已入册,124 行新增)、`gen-cordis-catalog`、`gen-client-catalog`、
  `gen-persistence-catalog`、`gen-scoped-events`、doc-graphs **全部
  up to date**。
- `upstream-changes.patch` 已用 `capture` 重新生成 —— 旧 patch 因
  `pnpm install` 改写覆盖文件而过期,属索引漂移不是代码损坏。

**`physics/` 449 处已全部清零(同日第二轮)**:codemod 批量补齐 `@param`/`@returns`
与缺失块,15 个 scene-visual 工厂的解构参数按 gate 要求改为
`(input: XxxVisualInput)` 具名入参 + 体内解构(调用方零改动);
`verify-export-jsdoc` 全绿。个别 `@returns` 措辞偏机械,后续可在触及
对应文件时顺手润色,不再是门禁债务。

**验证**:`tsc -b`(5 个 physicsos/客户端包)+ `tsc -p ui-physicsos`、
oxlint(web 213 文件 / agent 45 文件)**0 错**;ui-physicsos 测试
**828/828**;`git diff --check` 干净。除 15 处签名形参改写外均为
注释级,JSDoc 无行为面。

---

## V1_PRODUCT_GAP_SWEEP

**状态**:**已完成**(2026-09-25 第三轮)。上线前产品面收口,部署打包未动。

- **题库引擎初筛**:`POST /physicsos/paper/bank/items/triage` ——
  `planBankTriage` 同步挑 pending(指定的非 pending id 报 skipped/不存在报
  missing),`runTriage` 异步串行盲解(`independentSolve` 复用,per-item 隔离
  失败),结果写 `anomalies` 的 `engine-check:agreed|mismatch(...)|unresolved`
  (重跑替换不堆叠),**status 永远不动**。`triageBusy` 409 防并发重复烧钱。
  教师端加「引擎初筛」「选中引擎一致」两个操作 + 中英词条。
- **门禁面补齐 update-host**:`lint:agent`/`typecheck:agent`/`build:hosts`
  三个根脚本此前都漏它 —— 现已全部覆盖,顺手清掉它从未被 lint 过的 5 处存量
  (arrow-parens、member-delimiter、no-unnecessary-condition、测试里两个
  重复 jsonCall 助手合并为共享 `postJson`)。
- **`apps/web` 退役**:见上文 APPS_WEB_STANDALONE_RETIREMENT。
- **`pnpm format` 收口**:见上文 PNPM_FORMAT_IS_RED。
- **physics-agent-answers 定性**:确定性应答层保留(即时/零成本/离线),
  模型路径已由 dsh agent 覆盖,剩余是产品决策 —— 见上文。

**验证**:`tsc -b` 六个包(新增 update-host)0 错;oxlint 266 文件 0 错;
physicsos 测试 **195/195**(含 paper-host 新 triage 用例 21 条、update-host
composition 重构后 2 条真链);ui-physicsos 828/828;`verify-export-jsdoc` 全绿;
overlay/vendor `physics/` 与改动文件逐字节一致,`apply` 幂等。

---

## V1_PRODUCT_GAP_SWEEP_2

**状态**:**已完成**(2026-09-25 第四轮)。三个"外部依赖"项各自找到了真实路径,新页面完成液态玻璃改造。

### 图片/PDF 题目录入(原登记"等 OCR/VLM 服务")

**不需要新服务**:部署自己的模型路由(luckyg 的 deepseek-v4.1-flash)实测**接受图片输入**且中文题目转录准确 —— 已用真实图片验证(含单位、上标、选项字母)。实现:

- `paper-host/src/transcribe.ts`:图片经 `ctx.attachments` 落盘为内容寻址附件,再以 `ImageBlock` 走 `ctx.llm.stream` 转录;系统提示词要求逐字转录、不解题、图示文字化、模糊处用「□」占位。
- `POST /physicsos/paper/bank/ingest-image`:base64 图片(≤8 张)→ 转录 → 复用既有 `ingestBankText` 结构化管线 → pending 条目;转录原文随响应返回,教师对照原图核对。
- 客户端 `question-upload.ts`(从 lib/ 编译产物恢复的丢失源文件,含 CJK cmaps 等关键细节):图片 → dataURL;**文本层 PDF 本地 pdf.js 抽文**(不花模型调用,抽出原文填进编辑框);扫描版 PDF → 逐页 canvas 渲染 PNG → 走视觉转录。PaperWorkspace 录入卡升级为「粘贴 / 图片 / PDF」三入口。

### 校名录补全(原登记"数据源不可得")

找到**州政府门户公开名录页**(2024 年全州高中/初中/小学教育学校名录,州教育局 2025-03-28 发布)与**州教育局 2026 年高中招生计划全表**(经黔东南信息港转载,计划表为官方图片)。逐校比对后补 6 所真缺口:凯里市华鑫高级中学、三穗县第三中学、天柱县综合高中、天柱县恒成高级中学、岑巩县综合高级中学、台江县第一中学。另有 8 处「官方全称 vs 在册简称」写法差异未补(避免按名哈希的租户表出现同校双租户),来源与判断写在 `schools-data.ts` 注释里。初中名录页在抓取时 404(站点改版),仍不全。

### 卷库扩充(原登记"需要可核验的真实卷源")

**2024 年贵州省中考物理卷**(省级统一命题首年,90 分,22 题)已录入:`scripts/ingest-gz-2024-physics.mjs` 登录后登记原卷 + 22 条考点标注 + 8 道选择题(含官方答案与解析);题干与答案取自两处独立公开转录页并交叉核对(唯一差异是第 12 题 `8:2` 与 `4:1`,同一比值)。全部落 **pending**,由教师在出卷专区核验后进入组卷池。已在隔离服务器上端到端验证(sources=1 / annotations=22 / bank=8)。
对真实实例执行:`node scripts/ingest-gz-2024-physics.mjs --username <教师账号> --password <密码>`。

**2025 年贵州省中考物理卷**(省级统一第二年,90 分,22 题)已录入:`scripts/ingest-gz-2025-physics.mjs` 登记原卷 + 22 条考点标注 + 7 道选择题(6 单选 + 1 多选,含官方答案与解析)。来源为 czwlzx 公开 word 版(0 点券)文本层逐题转录,同页 3 张扫描图覆盖第 1–15 题与文本层逐字一致;可推导答案(选择全部、18、21、22 等)经物理复核与源答案一致,江南汇教育网的含解析版条目作独立流通佐证(会员墙,未逐题对照)。全部落 **pending**。已对本地 dev 实例端到端验证(sources +1 / annotations=22 / bank=7)。
对真实实例执行:`node scripts/ingest-gz-2025-physics.mjs --base https://… --username <教师账号> --password <密码>`。
结构发现:2025 卷与 2024 卷相比,选择 8 题(2 多选)→7 题(1 多选)、简答 2→3 题,总分与题量不变;`ZK_PHYSICS` 蓝图已按 2025 实测口径更新并在注释中记录差异。

### 出卷专区「AI 起草」修复与工作过程可视化(2026-10-05)

用户实测:点击「AI 起草 + 自动检查」无反应、确认细目表步骤多余、看不到 AI 在干什么。三个问题一次收口:

- **无反应的根因是两层**:客户端把 `/draft` 与 `/check` 背靠背连发,而服务端状态机里 check 只能在起草完成(状态到 checking)后跑——提前跑会以 NO_DOCUMENT 把任务打成 failed;且点击后 activeJob 从不刷新、failed 状态又不触发轮询,UI 整个冻住。现在客户端按「draft → 轮询到 checking → 才发 check → 轮询到终态」编排,activeJob 全程实时更新。
- **确认细目表不再是独立步骤**:单一「AI 起草 + 自动检查」按钮自动确认细目表(failed 重试同路,重确认照旧重置修订预算);细目表降级为只读信息块,阶段条从「AI 起草」起步。
- **AI 工作过程可视化(grokbot 式小人物)**:paper-host 各驱动埋 `job.progress` 遥测(规划题库/逐板块起草/逐题改编/组卷/规范检查/引擎逐题复核/导出逐题图——每张题图约 70 s 也要点名);客户端 AiWorker 面板用纯 CSS 小机器人按阶段换状态(思考/执笔/放大镜检查/画笔配图/挫败),配阶段清单、done/total 进度条与计时。导出同样走 runner 驱动可视化。
- `PaperJob.progress` 为可选字段,旧任务行无此字段照常读;zod 行校验 stage 开放字符串。测试新增:一键编排顺序(confirmSpec→runDraft→轮询→runChecks 恰一次)、小人物遥测渲染;fake timer 用例须防假时钟泄漏(afterEach 兜底 useRealTimers)。

验证:question-paper 42 / paper-host 39 / web 939 / vendor agent 460 全绿;typecheck×2、build:lib、oxlint、prettier 全过;插件清单重签(paper-host 入口变更)。

### 解题链路可信度四件套(2026-10-05)

以「金标准题最小突变」方法实测暴露并修复了三个反事实盲区,补上自纠错闭环与结构化运行日志:

- **反事实守卫**(`packages/agent-tools/tests/counterfactual-guard.test.ts`):速度选择器题声称「沿直线通过」但 v≠E/B 时,以前静默 solved(32/33 通过、状态仍 passed)——现在 `question-runtime` 在声称与 `velocity_selection_condition` 检查矛盾时发 `PASSAGE_CLAIM_CONTRADICTED` 警告;电路题声称「电流表读数为 X A」与欧姆定律矛盾时,解析器新增电流表读数模式把声称值读进 IR,引擎计算值不变并交叉核对发 `STATED_READING_INCONSISTENT` 警告(答案永远以引擎为准)。已知缺口(质谱仪「测得半径」、运动学声称末速度尚不入 IR)以 docs 用例钉住,修复后迁移为守卫。
- **自纠错闭环**(`physics-tool-runtime.ts` + `render.ts` + persona 第 9 条):rejected 结果携带结构化 `retryGuidance`(按 PARSE_FAILED/AMBIGUOUS/INVALID_SEMANTICS/UNSUPPORTED_MODEL/VERIFICATION_FAILED 给出确定性改写指引);同一规范化题面第 2 次拒收后发 `STOP_RETRY_SAME_STEM`(确定性管线,原样重试无意义),persona 同步改为「按修正建议最多重试一次」。
- **结构化运行日志**(vendor `tool-physicsos`):新增 `physics/solve-trace` 会话事件——每次 solve(solved 与 rejected 都算)落 {workflowState、domain、验证摘要、答案、issues、retryGuidance、attempt、耗时};`physicsScenes` 投影只收 READY 求解,rejected 以前在会话日志里不留痕。投影 `physicsSolveTraces` 追加式折叠,封顶 50 条。已知事件表与持久化目录经 `gen-persistence-catalog` 重生成;插件清单(tool-physicsos 入口摘要+签名)经 `scripts/plugin/sign-physicsos-manifest.mjs` 重签。本次 capture 还把上一轮漏 capture 的 persistence 目录文档段补进了 `upstream-changes.patch`。
- **真题回归集**(`packages/agent-tools/tests/real-exam-regression.test.ts`):2025 贵州中考 10 道逐字题干(概念/简答)钉死「诚实拒收、绝不编数字」契约 + 重试指引必须存在 + 同题重试收到停止信号;另守卫可计算题仍走引擎全链路,防止拒收断言一刀切。

验证:question-core 445 / agent-tools 64 / vendor agent 460 / web 937 全绿;typecheck、lint、prettier(本轮文件)全过;`verify-persistence-catalog` up to date。


### 液态玻璃 + GlassSelect

- `chrome.ts` 新增 liquid glass 材质 token:模糊(`--physics-glass-blur`)、镜面高光(带 sheen 渐变)、亮边 rim、抬升阴影、弹层密度、**环境光**(没有可折射的底色,玻璃只会是灰盒子 —— 这正是四个新页面此前"没质感"的原因)。
- 四个新页面(登录门 / 出卷专区 / 管理后台 / 学习记录)全部玻璃化;登录门露出地平线图做折射底衬。
- **`GlassSelect` 替换全部原生下拉**(AuthGate 2 + AdminWorkspace 2 + AdminContentTab 3 + PaperWorkspace 13):combobox + portal 弹层(卡片 overflow 裁切问题)、方向键/Home/End/Enter/Esc 键盘导航、外点关闭、滚动跟随、禁用项跳过、aria 完整。
- 验收:`tests/acceptance/glass-surfaces.mjs` 真服务器 + 真浏览器截图 10 张,console/pageerror/rejection/failed-request 全零;截图在 `/tmp/physicsos-glass`(可用 `GLASS_SHOTS` 改路径)。

**验证**:typecheck 三线(core/web/agent 含 update-host)全绿;oxlint 54+216 文件 0 错;physicsos 测试 **197/197**;ui-physicsos **834/834**(含 GlassSelect 6 条);`verify-export-jsdoc` 全绿;`pnpm format` 全绿;overlay ↔ vendor 逐字节一致,`apply` 幂等,patch 已重新 capture。

---

## P0_P2_COMPLETION_PROGRAM

**状态**:**已完成**(2026-09-26)。计划与任务边界见
[`docs/superpowers/plans/2026-09-26-p0-p2-program.md`](../superpowers/plans/2026-09-26-p0-p2-program.md)。
七个任务各自在隔离 worktree 实现,由控制器统一接线、capture 与验收。

### 落地内容

- **生产部署与根 CI**(Task 1):多阶段 `Dockerfile`、`compose.yml`(app /
  PostgreSQL / Redis,healthcheck、命名卷、secret 文件)、`/healthz` 与
  `/readyz` health-host、`scripts/healthcheck.mjs`、根 CI 工作流。
- **容器密钥入口**(控制器补):`scripts/docker-entrypoint.mjs` 把
  `<NAME>_FILE` 秘密物化成环境变量后再启动 CLI;缺文件/空文件直接失败,
  不做静默回退。
- **账户生命周期**(Task 2):一次性密码重置(哈希存储、过期、单次使用、
  替代与作废、管理员队列与 UI 面板)、交付适配器 seam、限流 seam
  (内存参考实现 + Redis 边界)、legacy 会话/工作区归属迁移 CLI。
- **个人学习同步**(Task 3):`/physicsos/learning` 按账号与租户隔离地存
  个人作答与已保存场景(分页、幂等写、跨设备),客户端本地优先并做
  localStorage 迁移。
- **班级教学**(Task 4):`/physicsos/class` 班级、成员(userKey)、作业
  (试卷/实验)、截止时间、学生提交与回执、教师批改、班级完成率;写路径有
  同源 + JSON 内容类型栅栏;客户端一个表面两种角色面 + 侧栏入口。
- **物理内容扩展**(Task 5):时变场回旋加速器、纵波 / 反射折射 / 衍射 /
  多普勒、近代物理(光电效应)全链路(引擎 → 场景 → 题目 → 可视化 →
  实验模板);不支持的情形返回 `UNSUPPORTED_MODEL` 而不是套用别的模型。
- **桌面壳**(Task 6):Tauri 2 壳、平台桥、本地 sidecar 传输、签名更新
  校验路径、发布校验与本地打包脚本;应用图标改由生图模型
  (`gpt-image-2.5-sunburst`)产出再经 `tauri icon` 生成全套尺寸。
- **生产运行时**(Task 7/8):`packages/storage/storage-postgres` 实现存储
  hub 的 KV 合同;`packages/physicsos/shared-state-host` 提供跨副本限流与
  一次性账本(memory + Redis,原子 Lua)。生产 compose 切 postgres/redis,
  开发保持 json/memory 默认。

### 验收证据

- `pnpm run typecheck` / `pnpm run lint` / `pnpm run test` /
  `pnpm run build` 四条根门禁**全部 exit 0**。
- 测试计数:web `60` 文件 `850` 例、agent `36` 文件 `302` 例、
  deploy `3` 例、desktop `10` 例;core 各包全绿(question-core `445`、
  agent-tools `32` 等)。新存储/共享状态包 `6` 文件 `41` 例(真 Redis +
  真 PostgreSQL 均实际执行)。
- 生产形态自检:以 `PHYSICSOS_STORAGE_BACKEND=postgres` +
  `PHYSICSOS_SHARED_STATE_BACKEND=redis` 启动真实实例 →
  `/healthz` `200`、`/readyz` `200`(postgres/redis 两项 ok);
  PostgreSQL 建出 `33` 张领域表;三次错误登录后 Redis 出现
  `physicsos:limiter:login:<sha256>` 与 `physicsos:limiter:ip:<sha256>`
  (键名只含哈希,不含账号/IP 原文)。
- overlay:`apply` 幂等(输出 `upstream-changes.patch already applied`)、
  `git apply --reverse --check` 通过、无 `.rej`/`.orig` 残留。

### 仍然存在的边界(如实登记)

- `/api/respond` 的一次性回执账本仍是 auth-host 进程内的 Map。共享实现已
  作为 `physicsosOnceLedger` 服务就绪,但 apiproxy 那条路径尚未接上;多副本
  部署下这一项仍退化为单副本语义。
- 桌面签名 / 公证 / 发布需要证书与密钥,属发布环境配置,未在本地执行。
- 本机无 Docker daemon,镜像未实际构建;`docker compose config` 与 compose
  文件已校验。
- 浏览器端到端验收脚本 `tests/acceptance/glass-surfaces.mjs` 本轮未重跑
  (此前基线全零错误),接口级验证已由 composition 测试覆盖。
- `packages/ui` 在 `apps/web` 退役后暂无仓内消费者;仍是带测试的真实组件
  库,保留待产品决策。
