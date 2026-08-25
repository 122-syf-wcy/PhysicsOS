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
