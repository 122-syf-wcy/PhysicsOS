# 15. Runtime Architecture

> 文件：`docs/15-RUNTIME-ARCHITECTURE.md`
> 编号说明：`06` 已被 `06-UI-DESIGN-SYSTEM.md` 占用，为避免重编号既有文档，
> 本文取下一个空闲编号 `15`。

本文描述 PhysicsOS 从「一个物理场景」到「学生看到的界面」之间的完整运行链，
以及每一层**不允许**做的事。新增物理域（电场 / 电路 / 光学）时按本文对齐，
不要新建平行结构。

---

## 1. 全景

```text
                    ┌──────────────────────────────┐
                    │  Question Pipeline           │
                    │  text → IR → Scene           │
                    └───────────────┬──────────────┘
                                    │ PhysicsScene
                                    ▼
┌───────────────┐   SceneCommand   ┌──────────────────────────────┐
│  UI / Agent   │ ───────────────► │  Scene Runtime               │
│  (caller)     │ ◄─────────────── │  revision + PhysicsEvent     │
└───────────────┘   Snapshot        └───────────────┬──────────────┘
                                    │ PhysicsScene @ revision
                                    ▼
                    ┌──────────────────────────────┐
                    │  Engine Layer                │
                    │  canHandle / simulate /      │
                    │  stateAt                     │
                    └───────────────┬──────────────┘
                                    │ SimulationResult
                                    ▼
                    ┌──────────────────────────────┐
                    │  Verifier                    │
                    │  named physical checks       │
                    └───────────────┬──────────────┘
                                    │ verified result
                                    ▼
                    ┌──────────────────────────────┐
                    │  Observation Layer           │
                    │  what is worth showing       │
                    └───────────────┬──────────────┘
                                    │ Observation[]
                                    ▼
                    ┌──────────────────────────────┐
                    │  Visual Bridge               │
                    │  → SceneVisualModel          │
                    └───────────────┬──────────────┘
                                    ▼
                    ┌──────────────────────────────┐
                    │  PhysicsCanvas               │
                    │  RENDERERS[view.domain]      │
                    └──────────────────────────────┘
```

一条铁律贯穿全链：**下游永不重算上游已经断言过的事实**。
Renderer 不算力，Canvas 不算轨迹，Agent 不算 vₓ。

---

## 2. 分层职责与禁止事项

| 层 | 拥有 | 禁止 |
| --- | --- | --- |
| `physics-core` | Quantity / QuantityVector / SimulationRequest / SimulationResult / VerificationCheck 等**跨域**契约 | 加入任何单一物理域的概念（点电荷、斜面、回旋半径） |
| 域 core（`physics-electric-core` …） | 该域的纯契约与纯数学（E = kq/r²、F = qE） | 引用 Scene、Engine、Runtime、UI |
| `physics-scene` | PhysicsScene 结构、Scene Command / PhysicsEvent、revision 闸门、scene 校验、场景工厂、实验分支 fork | 求解物理；调用 Engine |
| `engine-*` | `canHandle` 前提判定、解析求解、`stateAt(t)`、derivedQuantities、离散事件 | 读 UI 状态；决定「显示什么」 |
| `physics-verifier` | 具名物理检查（水平速度守恒、N = mg·cosθ …） | 修正引擎结果 |
| `physics-observation` | 把已验证事实变成「值得展示的观测」，并受 scene observable 开关控制 | 计算新的物理量；决定颜色与坐标 |
| Visual Bridge（UI 内） | Observation → `SceneVisualModel`（场景单位、y 向上）、取景包围盒、显示长度 | 调用 Engine；读 Scene 的物理字段去算数 |
| `PhysicsCanvas` | 投影（唯一一次 y 翻转）、网格、坐标轴、刻度、比例尺、renderer 派发、hover/seek | 知道什么是抛体或洛伦兹力 |
| Renderer | 用共享图元把 `SceneVisualModel` 画出来 | import 任何 engine；做物理算术 |
| Agent Tool Layer | 读 context、调用工具 | 自己算物理；绕过 Scene Command |

---

## 3. Scene Runtime 与 revision

`revision` 描述**当前世界的状态版本**，每条成功的 SceneCommand +1，
并产出一条 PhysicsEvent。命令携带 `expectedRevision`，不匹配即冲突失败 ——
这是并发与「陈旧 UI 覆盖新状态」的唯一防线。

`lineage.parentRevision` 描述**来源**，与 `revision` 语义不同，不可混用：

```text
scene-question-001  revision 4          ← 题目世界（不被实验修改）
        └── fork on first fact edit
            experiment-…  revision 0 → 1
            lineage.parentRevision = 4  ← 来源，不是版本
```

分支从 0 开始：它是另一个世界，沿用父级版本号会让两个场景声称同一版本。

### 什么会 fork

只有**修改物理事实**的命令会 fork 一个来自题目的场景
（定义唯一处：`physics/experimental-branch.ts` 的 `FACT_COMMANDS`）。
播放、seek、切换 observable、Agent 高亮都不会 —— 它们改变「在看什么」，
不改变「什么是真的」。

---

## 4. Engine Layer

每个引擎实现同一接口：

```ts
canHandle(scene): ModelSupport      // 前提不满足要说清哪一条
validate(scene): VerificationResult
stateAt(scene, t): SimulationState  // 解析解，不做数值积分
simulate(scene, request): SimulationResult
```

`SimulationRequest` 必须引用被仿真的**精确 revision**，否则拒绝执行；
这保证「解答」与「场景」永远同版本。

已实现：`engine-magnetic`（匀强磁场圆周运动）、
`engine-mechanics`（5 个模型）、`engine-electric`（匀强电场粒子运动；
点电荷模型在 `ELECTRIC_FIELD_RUNTIME_PACK_V1` 中加入）。

---

## 5. Observation Layer

Observation 回答的是「**这一帧值得展示什么**」，而不是「物理是什么」。
它只从已验证的 `SimulationResult` / `SimulationState` 取值，
并且受 scene 的 `observableDefinitions[].visible` 控制。

因此**图层开关必须走 SceneCommand**（`SetObservableEnabled`），
而不是组件内的局部 boolean：否则画布会显示 scene 并未声称的东西。

新增域时扩展现有 observation 模块，不要新建平行的 `XxxObservation` 体系。
个别力（mg / N / f）的**方向**由 observation 层用模型自有的坐标系投影得到，
绘制代码不参与决定方向。

---

## 6. Visual Contract 与 Renderer Registry

`SceneVisualModel`（`physics/scene-visual-model.ts`）是 renderer 的唯一输入：
场景单位、y 向上、显示长度已由 bridge 决定。图元词汇：
Body / Ground / Incline / Platform / Trajectory / Vector / Angle / Dimension /
KeyPoint / Coordinate / Label / Measurement / Field / Particle / Guide。

```ts
RENDERERS = { magnetic, mechanics, electric }   // domain → renderer
```

新增域 = **registry 一个条目 + 一个 renderer 文件**。
禁止新增 `XxxWorkspace.tsx`：只有一个 `PhysicsWorkspace` 外壳。

### Canvas 坐标与缩放

viewBox **跟随容器像素尺寸**（ResizeObserver），所以 1 viewBox 单位 = 1 CSS px，
`preserveAspectRatio` 永不放大线宽与字号；场景在 plot box 内等比 fit，
缩放恒 ≤ 1。按内容 bbox 生成 viewBox 是已知反模式（竖幅场景实测被放大 1.5×）。

---

## 7. Workspace Runtime

UI 外壳只认一个接口：

```ts
interface WorkspaceRuntime {
  getSnapshot(); editParameter(id, value); setChoice(id, value)
  setObservable(key, enabled); setRunning(r); setRate(r)
  seek(t); step(dt); advance(wallSeconds); setHighlight(ids)
  restoreOrigin?()
}
```

`WorkspaceSnapshot` 是纯数据（title / status / sceneRevision / view / tree /
inspector / charts / table / derivation / verification / events / clock /
trajectoryTimes / branch? / error?）。域适配器负责把各自 bridge 的输出映射成它。

---

## 8. Agent Tool Layer

Agent 读 context（scene / revision / simulation / verification / observations /
clock / **当前实际绘制的视觉 id** / branch），答案只引用这些事实。

两类工具严格分离：

| 工具 | 性质 | revision | PhysicsEvent |
| --- | --- | --- | --- |
| `physics.ui.*`（如 `highlight`） | 视图交互 | 不变 | 不产生 |
| `physics.scene.*`（如 `setParameter`） | 域命令 | +1 | 产生 |

`physics.scene.*` 走 UI 完全相同的路径：`expectedRevision` → Scene Runtime →
Engine → Verifier → Observation → UI。Agent 只是调用者，没有旁路。
指向未绘制的对象时必须明确报「画布当前没有显示…」，不得静默高亮空集。

---

## 9. Question Pipeline

```text
text → Parser → Semantic IR → Semantic Validator → Scene Builder
     → Engine → Verifier → Solution
```

Scene Builder 必须写入 `metadata.sourceQuestionId`：
它既是溯源，也是实验分支判据的依据（缺失会导致题目场景被实验污染）。

---

## 10. 新增物理域清单

1. `packages/physics-<domain>-core`：纯契约 + 纯数学，不依赖 Scene / Engine / UI
2. `packages/engine-<domain>`：`canHandle` / `stateAt` / `simulate` / derived
3. `physics-scene`：场景工厂 + 必要的 Scene Command 与事件
4. `physics-verifier`：具名物理检查
5. `physics-observation`：扩展现有模块（不要新建体系）
6. UI：一个 visual bridge + `RENDERERS` 一个条目 + 一个 renderer 文件
7. `physics-tokens`：颜色语义加进现有 Physics Token System
   （**禁止**新增 `physics-<domain>-tokens.css` 再靠 import 偶然生效）
8. Agent：扩展高亮别名表，不要写第二套 highlight
9. Golden Questions + 浏览器验收 Case
