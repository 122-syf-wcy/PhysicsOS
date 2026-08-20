# @deepseek-ai/dsh-client-ui-physicsos

PhysicsOS 在 DeepSeek Harness Web Client 上的正式产品叠加层。它只注册已声明的侧栏、首页、学生模式与工作区 slot，不替换 `ConversationRoot`，也不修改 Agent Loop、Session 和 Tools。

## Runtime 边界

```text
Question / Inspector / Timeline
  -> PhysicsScene + revision
  -> MagneticEngine 或 MechanicsEngine
  -> Verifier
  -> Observation
  -> SceneVisualModel
  -> PhysicsCanvas
```

`PhysicsCanvas` 是磁场与力学唯一正式 Renderer。React 不计算答案事实，Question → Lab 传递同一个 `PhysicsScene` revision。

动画使用 `requestAnimationFrame`。磁场微观周期会映射为可观察的展示周期，每帧仍读取 Engine 解析状态；已验证的磁场 Simulation 在帧间缓存。力学播放直接调用 `MechanicsEngine.stateAt`，不再跳离散采样点。

## 已实现

- PhysicsOS 首页与 Harness 侧栏
- 磁场实验室：revision 编辑、可观察量、时间轴、数据、图像、推导、事件
- 力学实验室：匀速、匀加速、抛体、牛顿第二定律、无摩擦斜面
- Question Space：16 道确定性示例与 Question → Lab
- 桌面、窄桌面和手机布局

## 尚未完成

- 图片/PDF/OCR/VLM 试题输入
- 保存、AI 助教、模板库和用户学习记录的完整业务闭环
- Electric、Circuit、Induction、Optics、Wave、教师端与桌面端

## 验证

在仓库根目录执行：

```sh
pnpm typecheck:web
pnpm lint:web
pnpm test:web
pnpm build:web
```

## Model Experience

本包不直接组装或发送模型请求；模型配置和会话行为继续由 Harness 负责。
