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

**状态**：登记。**高中生源的学校名录严重不全** —— 这直接卡住产品主链路。

`auth-host/src/schools-data.ts` 有 1566 条贵州中学名录，但结构是失衡的：

| 口径 | 数量 |
| --- | --- |
| 名称以「中学」结尾 | 1430 |
| 名称以「高级中学」结尾 | 2 |
| 名称以「高中」结尾 | 2（含上） |

抽查 20 所公认的省市重点 / 各市州旗舰校，**15 所不在名录里**：

```
缺失：贵阳一中  贵阳实验三中  贵阳六中  贵阳九中  清华中学
      遵义四中  遵义南白中学  凯里一中  都匀一中  安顺一中
      安顺二中  铜仁一中  毕节一中  兴义一中  兴义八中  贵阳民族中学
在册：遵义航天中学  六盘水市第一实验中学  贵州大学附属中学  贵州省实验中学
```

**为什么这是 P0 级数据问题**：产品定位是中考/高考（出卷专区就是高考导向），
但名录主体是**县域义务教育阶段初中**；高中、尤其是各市州的一中/实验中学几乎
缺席。后果是**一名贵阳一中的学生用自己的真实校名根本注册不了**——
而"学校是一级租户"正是账户体系的立身之本。

**为什么现在不做**（本轮没做）：需要权威名录来源，而本轮三条路都被挡：

- `web_search` 工具未配置（HTTP 401，端点未设）
- 维基百科被解析到非公网 IP，拒绝抓取
- 搜索引擎（Bing / DuckDuckGo / Baidu）返回挑战页或 0 结果；
  贵州省教育厅站内搜索是纯 JS 驱动、静态 HTML 里没有端点

**在这三条路里任一条打通前，不添任何校名。** 凭空补 100 所学校的名字会直接
污染租户表——那正是 `schools-data.ts` 头部注释所强调的"如实标注来源"要防的
事。名录宁可诚实地不全，也不能编。

**开始条件**：拿到以下任一权威源后按市州补齐，并在文件头注明来源与抓取日期：

1. 贵州省教育厅年度《普通高中招生计划》或省级示范性普通高中评估名单
2. 阳光高考（`gaokao.chsi.com.cn`）院校库的中学检索接口 —— 本轮实测 412 拒绝
3. 各市州教育局官网的招生计划/学校名录（黔南、黔东南两州此前已用此法）

补齐后需要同步做的两件事：把 `schools-data.spec.ts` 的断言从"少于 N 条"改成
按市州的下限断言；并用 `auth-acceptance.mjs` 的 CASE B 换一所**高中**校名做
注册回归，确保高中侧真的可用。

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

## PAPER_HOST_COMPOSITION_TEST_GAP

**状态**：登记。`paper-host` 只有 `routes.spec.ts`（9 项，Map-backed domain），
**没有** `auth-host` 那样的 REAL-composition 测试（真实插件链 + 真 http 服务）。

`auth-host/tests/composition.spec.ts` 的 2 项正是抓出"插件在真实组合里能否
激活 + 路由是否真的挂上"的那一层——`paper-host` 缺这一层，意味着
`cordis.patch.yml` 里 paper-host 的接线错误只会在浏览器验收或手工 e2e 里暴露。

**开始条件**：把 `composition.spec.ts` 的 boot 链扩到同时挂 paper-host，
断言 `/physicsos/paper/blueprints` 在真实组合下 200。

---

