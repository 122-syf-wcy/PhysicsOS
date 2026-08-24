# Harness Web Client × PhysicsOS Overlay

日期：2026-08-20

状态：`MECHANICS_RUNTIME_PACK_V1_COMPLETE`。三个物理域（磁场 / 力学 / 匀强电场）共用**同一个**工作台外壳与画布；Question → Lab 会在首次修改物理事实时 fork 实验分支；Agent Drawer 读取真实 runtime 并通过工具高亮/下发 SceneCommand。图片 / PDF 识别与模型驱动的 Agent 答案仍未接入（见 `docs/reports/BACKLOG.md`）。

## 产品组合

```text
DeepSeek Harness Web Client
        │ Sidebar / Conversation Workspace / Session / Tools
        ↓
@deepseek-ai/dsh-client-ui-physicsos
        │ Home / Physics Lab / Question Space
        ↓
PhysicsOS domain packages
```

根目录 `apps/web` 是废弃的过渡实现，不是第二套 Runtime Host。

## Harness 扩展边界

PhysicsOS 只占用正式 slot：

| Slot | PhysicsOS 内容 |
| --- | --- |
| `sidebar.brand` | PhysicsOS 品牌与回首页 |
| `sidebar.nav` | 首页 / 物理实验室 / 试题空间 |
| `sidebar.new` | 新建菜单 |
| `sidebar.workspaces` | 最近空间 |
| `sidebar.footer.action` | 学习记录入口 |
| `conversation.hero.brand` | 首页品牌 |
| `conversation.hero.actions` | 示例、实验/试题入口、最近空间 |
| `conversation.hero.agentPreset` | 学生学习模式 |
| `conversation.surface` | Physics Lab / Question Space |

不修改 Harness Agent Loop、Session Store、Tools 和 ConversationRoot。

## 统一运行链

```text
Inspector / Timeline / Scene Tree / Question
        ↓  plain callback（组件不知道自己在哪个物理域）
WorkspaceRuntime
        ↓  SceneCommand + expectedRevision
PhysicsScene + revision
        ↓
Engine (Magnetic / Mechanics / Electric)
        ↓
Verifier
        ↓
Observation
        ↓
SceneVisualModel
        ↓
PhysicsCanvas → RENDERERS[view.domain]
```

**一个工作台，不是每个域一个页面。** `PhysicsSurface`（`LabWorkspace.tsx`）只做
dispatch：按 `domainOfScene(scene)` 选一个 `WorkspaceRuntime`，交给唯一的
`PhysicsWorkspace` 外壳。此前 `MechanicsLabWorkspace`（734 行）与
`ElectricLabWorkspace`（615 行）与磁场外壳有 ~80% 重复结构，已删除。
新增域 = 一个 runtime adapter + renderer registry 一个条目，不再新增页面。

```text
WorkspaceRuntime（physics/workspace-runtime.ts）
  getSnapshot / editParameter / setChoice / setObservable
  setRunning / setRate / seek / step / advance / setHighlight
        ├── MagneticWorkspaceRuntime  → MagneticRuntimeBridge（已验收，语义未改）
        ├── MechanicsWorkspaceRuntime → MechanicsRuntimeBridge
        └── ElectricWorkspaceRuntime  → SceneRuntime + ElectricEngine
```

`PhysicsCanvas` 是磁场与力学唯一正式画布。它只消费 `SceneVisualModel`，负责投影、坐标、网格、刻度、轨迹、矢量、标注和交互，不导入 Engine，也不重新计算答案。

`lab-view-model.ts` 仍是磁场 Runtime 与 Inspector 的纯数据契约；它不再对应第二套画布实现。

## Physics Lab

实验室由工具栏、场景树、统一画布、Inspector、时间轴、数据面板和 Agent 入口组成。

磁场场景支持：

- `B / q / m / v` 与磁场方向修改
- revision 校验的 `SceneCommand`
- 运行、暂停、单步、重置、拖动时间轴与 0.25-2 倍速
- 速度、洛伦兹力、轨迹、圆心、半径与辅助线
- Engine 派生量、数据、图像、推导与事件

力学场景支持：

- 匀速、匀加速、平抛/斜抛、牛顿第二定律、斜面（含摩擦）
- 六个实验模板由「新建」分组 popover 进入，直接建真实 Scene
- 可编辑 `m / h / v₀ / θ / g / μ / F`，每次提交都是一次 revision 校验的 SceneCommand
- 自由体图 mg / N / f / ΣF / a，力的分解 mg·sinθ / mg·cosθ 可开关
- 关键点（起点 / 最高点 / 落地点）、h 与 R 标注、倾角弧、时间轴事件标记
- 数据表、`x(t) / y(t) / vₓ(t) / v_y(t)`、结构化推导与验证
- 从 Question Space 带同一个 Scene revision 打开，并在 Lab 中继续可编辑

关键实现约束：

- `--physics-*` 语义 token 必须由 `mountPhysicsOSChrome()` 在 document 级注入。
  插件 bundle 只自动注入 `*.module.css`，普通 `.css` 的 import 会静默失效，而
  未定义的 `var()` 用在 `stroke` 上回退到继承值（画布根节点是 `fill="none"`）
  —— 后果是整块画布进入 DOM 但完全不着墨。`tests/chrome.client.spec.ts` 守住这点。
- `PhysicsCanvas` 的 plot box 固定为 960×540，场景在框内居中。按内容尺寸生成
  viewBox 会让竖幅场景被 `preserveAspectRatio` 放大（实测 1.52×），线宽与字号同步变粗。
- 个别力的**方向**来自 Observation 层（由模型的斜面坐标系投影引擎已算出的幅值），
  不由绘制代码决定。
- `packages/*` 用 `link:` 协议接入，不是 `file:`：pnpm 会复制 `file:` 依赖且不随
  源码刷新，导致浏览器 bundle 编译旧副本而 vitest 读源码，两边静默分歧。

## 动画时钟

- 浏览器使用 `requestAnimationFrame`，每次提交使用真实帧间时间。
- 磁场的微观周期不再直接映射现实秒；1 倍速约 5 秒展示一整圈，避免毫秒时钟跨越几十万周期产生混叠跳点。
- 已验证的磁场 Simulation 与 Verification 会缓存；每帧只调用解析 `stateAt`、Observation 与视觉投影。
- 力学每帧直接读取 `MechanicsEngine.stateAt`，不再只显示离散 Simulation 样本。

## Question Space

当前包含 16 道可复现内置题。磁场与五类力学题经过真实 Question Runtime、Scene、Engine、Verifier、Observation 和 PhysicsCanvas。

图片、PDF、OCR/VLM 与整卷拆题尚未接入，界面明确显示为未开放；不能把这部分记为已完成。

## 响应式

- 桌面：三栏实验室；宽度不足时依次隐藏 Inspector 与场景树，优先保证画布。
- Question Space：中等宽度使用完整高度主解题区，输入与结果在右侧堆叠；手机为单列。
- 手机：Harness 侧栏为抽屉式导航，选择 PhysicsOS 页面后自动收起。
- 移动力学画布保持 16:9，避免竖向容器把物理图缩成小点。

## 实验分支与 Agent

题干条件是陈述的事实，因此 Question → Lab 在**第一次修改物理事实**时 fork：

```text
scene-question-001 rev.4        （原题，永不被实验修改）
        └── fork on first fact edit
            experiment-… rev.0 → rev.1
            metadata.lineage = { origin, branchType, originQuestionId,
                                 originSceneId, parentSceneId, parentRevision, forkedAt }
```

播放 / seek / 切换 Observation / Agent 高亮**不**触发 fork ——
它们改变「在看什么」，不改变「什么是真的」。判据只有一处定义：
`physics/experimental-branch.ts` 的 `FACT_COMMANDS`。

Agent（`physics/physics-agent.ts`）读取 scene / revision / simulation /
verification / observations / 当前时间 / 已绘制视觉 id，答案引用这些事实并显示
source chips；它**不重新计算物理量**，匹配不到就明确说无法回答。两类工具严格分离：

| 工具 | 性质 | revision | PhysicsEvent |
| --- | --- | --- | --- |
| `physics.ui.highlight` | 纯视图交互 | 不变 | 不产生 |
| `physics.scene.setParameter` | 真实 SceneCommand | +1 | 产生 |

---

## 架构约束（不可绕过）

### PhysicsOS Token System 是唯一入口

Harness Client Plugin **不保证**普通 global CSS 被自动注入：bundler 只处理
`*.module.css`。一个普通 `.css` 的 `import` 可能被静默丢弃，而未定义的
`var(--physics-*)` 用在 `stroke` / `fill` 上会在计算值阶段失效并回退到继承值
（画布根节点是 `<svg fill="none">`）—— 结果是整块画布进入 DOM 却完全不着墨，
且没有任何报错。

因此：

- 所有 PhysicsOS semantic token 必须经由正式的 Client Chrome 安装路径
  （`mountPhysicsOSChrome()`）在 document 级注入。
- **禁止**新增 `physics-electric-tokens.css` / `physics-circuit-tokens.css`
  之类的文件再靠 `import` 偶然生效。新增物理域的颜色语义一律加进现有
  Physics Token System。
- `tests/chrome.client.spec.ts` 与 `tests/regression-gates.client.spec.ts`
  逐个断言 token 存在，使这类故障不能再静默发生。

### `link:` 依赖是开发期桥接（DEV INTEGRATION BRIDGE）

`packages/client/ui-physicsos` 通过 `link:` 引用 `packages/*`：

| 协议 | 行为 | 后果 |
| --- | --- | --- |
| `file:` | pnpm 把包**复制**进 `.pnpm` store，之后不随源码刷新 | 浏览器 bundle 编译旧副本，而 vitest 经 tsconfig paths 读源码 —— 两边静默分歧（实测：源码改了场景标题，测试看得到、浏览器看不到） |
| `link:` | node_modules 里是指向源码目录的软链 | 编辑即时生效，bundle 与测试消费同一份源码 |

标记：**DEV INTEGRATION BRIDGE**。这不是最终架构，只是在
「PhysicsOS 仓库 + vendored Harness 子模块」这个布局下让开发回路可信的最小手段。

安装可行性：

- Windows / 本机开发：已验证（`pnpm install --filter` 后软链正确建立）。
- clean clone / CI / 未来 Linux：`link:` 依赖相对路径解析到仓库内的
  `packages/*`，与 `file:` 同样只要求仓库完整 checkout（含 submodule），
  不依赖 registry 发布，因此可安装性不低于 `file:`。仍需在首个 CI 作业里
  实测一次 clean clone 安装。

最终目标不变：把 PhysicsOS overlay 变成 **PhysicsOS-owned Harness Client Plugin**，
由 PhysicsOS 侧发布、Harness 侧只做 slot 注册，届时移除这条桥接。

---

## 启动与验证

```sh
cd vendor/deepseek-harness
pnpm --filter @deepseek-ai/dsh-client-ui-physicsos bundle
pnpm --filter @deepseek-ai/dsh-client-ui-conversation bundle
pnpm dsh web
```

默认地址：`http://127.0.0.1:3080/`

验收：

```sh
node apps/web/e2e/mechanics-acceptance.mjs   # 五个产品 Case + 浏览器门禁 + 截图
node apps/web/e2e/harness-lab-shot.mjs       # 三分辨率截图 + 门禁
```

门禁：无棋盘格（`pattern path` 全部 `fill=none`）、无整页纵向滚动、
Canvas ≥ 内部工作区 55%、画布真实着墨（>20 条带 stroke 的节点，用于捕捉 token 失效）、
console error / `pageerror` / `unhandledrejection` / 失败请求 / 4xx-5xx 响应全部为 0。

验收要求：

- Scene revision 与 Question → Lab 所有权一致
- Engine / Verifier / Observation 不在 UI 中被绕过
- SVG 网格 `pattern path` 显式 `fill="none"`
- 动画无 50ms 定时器、无每帧重新 simulate/verify
- 桌面、窄桌面、手机无横向溢出或互相遮挡
- console、page error、unhandled rejection 为 0
