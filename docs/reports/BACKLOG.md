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
`.eventMark_enter` / `.eventMark_exit` / `.eventMark_plate-impact` 三条样式，
以及 runtime 侧把 `SimulationResult.events` 映射成 `TimelineEvent` 的 `eventsOf`。

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

**状态**：登记。UI 已明确显示「图片和 PDF 输入会在接入识别服务后开放」。

**为什么现在不做**：需要 OCR / VLM 服务与整卷拆题流水线，属于
Question Pipeline 的独立阶段，不是 Mechanics UI 的一部分。

---

## AGENT_MODEL_BACKED_ANSWERS_BACKLOG

**状态**：登记。当前 Agent 答案是确定性意图匹配（`physics-agent-answers.ts`）。

**已经就位的部分**：Agent Context Adapter（读 scene / revision / simulation /
verification / observations / time / question context）、工具契约
（`physics.ui.highlight` 为纯视图，`physics.scene.setParameter` 走 SceneCommand）、
以及「答案必须引用 runtime 已产出的事实」的 source chip 机制。

**为什么现在不做**：接入真实模型只需替换 `matchIntent`，
上述契约与测试保持不变；而模型接入涉及 Agent Service 与配额，
属于 Agent 阶段而非 Mechanics UI 阶段。

**开始条件**：Agent Service 可用，并且能把 tool call 以结构化输出返回。

---

## APPS_WEB_STANDALONE_RETIREMENT_BACKLOG

**状态**：登记。根目录 `apps/web` 是废弃的过渡 SPA，未随本轮 UI 演进。

**进展（2026-08-25）**：前置工程已完成 —— e2e 验收脚本整体迁入独立的
`tests/acceptance` 包（浏览器门禁、检查台账与截图设施收敛进共享
`support.mjs`），`apps/web` 的 playwright 设施（唯一的 spec、配置与依赖）
已随之移除，现在它只剩旧页面参考实现。

**为什么现在不做**：删除整个 `apps/web` 是一次不可逆清理，需要先确认
旧页面实现没有仍要保留的参考价值，属于工程整理而非产品能力。

**开始条件**：确认旧页面参考不再需要，即可整目录删除并同步收掉
workspace 与根 lint/typecheck 里对它的引用。

## GUIZHOU_SCHOOL_ROSTER_HIGH_SCHOOL_GAP

**状态**：部分修复（2026-09-21 补 15 所）。**仍不全**，但远没有本文档上一版
写的那么严重——上一版的判断是错的，先更正。

### 更正：上一版"15 所旗舰校缺失"是误判

上一版用**口语短名**去 grep（`贵阳一中`、`凯里一中`、`都匀一中` …），得出
"20 所里 15 所不在册"。这个结论**不成立**：名录用的是**官方全称**，短名当然
grep 不到。逐条复核后：

| 口语名 | 名录里的实际条目 | 状态 |
| --- | --- | --- |
| 贵阳一中 | `贵阳市第一中学` | 在册 |
| 贵阳实验三中 | `贵阳市第三实验中学` | 在册 |
| 贵阳六中 / 九中 | `贵阳市第六中学` / `贵阳市第九中学` | 在册 |
| 清华中学 | `贵阳市清华中学` | 在册 |
| 安顺一中 | `安顺市第一高级中学` | 在册 |
| 铜仁一中 | `铜仁第一中学` | 在册 |
| 毕节一中 | `毕节市第一中学` | 在册 |
| 凯里一中 | `贵州省凯里市第一中学` | 在册 |
| 都匀一中 | `黔南州都匀第一中学` | 在册 |
| 兴义一中 / 兴义八中 | — | **缺失** |
| 遵义四中 | — | **缺失** |

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

| 来源 | 抓到 | 在册 | 补入 |
| --- | --- | --- | --- |
| 黔东南州教育局《2025年全州高中教育学校名录》 | 48 普高 | 46 | 2 |
| 黔西南州教育局《2025年高中阶段民办学校年检结果公示》+ 基础教育栏目 | 13 | 0 | 13 |

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

## DSH_CREDENTIALS_SCHEMA_SKEW

**状态**：登记。宿主与 vendored harness 对 `~/.dsh/.credentials.yaml` 的格式
理解不一致，**会让 `pnpm dev` 完全起不来**。

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

**卷库为什么没动**：C-Eval 提供的是题目集合，**不含卷级元数据**（哪一年、哪个
地区、哪所学校），凭空补卷名就是编。要扩卷库仍需真实卷源。

**开始条件**（扩卷库）：拿到可核验的卷源（考试院发布、学校授权、或用户提供
扫描件/转录）。届时用同一套 `POST /physicsos/paper/sources` +
`.../annotations` 录入，`evidenceTier` 按实际来源选 `original-scan` /
`manual-transcript`，不要一律填 `web-public`。

---

## PNPM_FORMAT_IS_RED

**状态**：登记。`pnpm format`（`prettier --check .`）**全仓 751 个文件不通过**，
包括 3 个早于本轮就存在的 `scripts/*.mjs`。

它不是 `pnpm lint` / `pnpm test` 门禁的一部分，所以一直没暴露；但它写在
`package.json` 里、看起来像一条应当可用的命令。

**为什么现在不做**：一次性 `prettier --write` 会产出 751 个文件的格式 diff，
把真实改动淹没，且 `.prettierignore` 目前没有排除 `vendor/`、
`overlays/.../public/` 等生成物目录——先修 ignore 再格式化，否则会把第三方
代码一起改写。

**开始条件**：先补 `.prettierignore`（`vendor/`、`UI/generated/`、
`overlays/harness/files/apps/web/public/`、`docs/reports/screenshots/`），
再单独一个提交跑 `prettier --write`，之后把 `format` 接进 `lint` 链。

---

## PAPER_HOST_COMPOSITION_TEST_GAP

**状态**：登记。`paper-host` 只有 `routes.spec.ts`（9 项，Map-backed domain），
**没有** `auth-host` 那样的 REAL-composition 测试（真实插件链 + 真 http 服务）。

`auth-host/tests/composition.spec.ts` 的 2 项正是抓出"插件在真实组合里能否
激活 + 路由是否真的挂上"的那一层——`paper-host` 缺这一层，意味着
`cordis.patch.yml` 里 paper-host 的接线错误只会在浏览器验收或手工 e2e 里暴露。

**开始条件**：把 `composition.spec.ts` 的 boot 链扩到同时挂 paper-host，
断言 `/physicsos/paper/blueprints` 在真实组合下 200。

---

