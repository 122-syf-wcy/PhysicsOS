# Harness Web Client × PhysicsOS Overlay

日期：2026-08-19

状态：正式 Web 入口已统一到 Harness；磁场、首批力学、Question Space 与 Question → Lab 纵向链路已接通。图片/PDF 识别、持久化和 AI 助教业务仍未完成。

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
Inspector / Timeline / Question
        ↓
PhysicsScene + revision
        ↓
Engine (Magnetic / Mechanics)
        ↓
Verifier
        ↓
Observation
        ↓
SceneVisualModel
        ↓
PhysicsCanvas
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

- 匀速、匀加速、平抛/斜抛、牛顿第二定律、无摩擦斜面
- Engine 解析状态、Observation、轨迹、速度、加速度、合力与几何
- 数据表、`x(t) / v(t) / a(t)`、公式与离散事件
- 从 Question Space 带同一个 Scene revision 打开，并保持题目场景只读

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

## 启动与验证

```sh
pnpm dev
pnpm typecheck:web
pnpm lint:web
pnpm test:web
pnpm build:web
```

默认地址：`http://127.0.0.1:3080/`

验收要求：

- Scene revision 与 Question → Lab 所有权一致
- Engine / Verifier / Observation 不在 UI 中被绕过
- SVG 网格 `pattern path` 显式 `fill="none"`
- 动画无 50ms 定时器、无每帧重新 simulate/verify
- 桌面、窄桌面、手机无横向溢出或互相遮挡
- console、page error、unhandled rejection 为 0
