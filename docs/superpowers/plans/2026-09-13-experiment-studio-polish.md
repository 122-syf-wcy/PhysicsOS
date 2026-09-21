# 实验模块整体美化实施计划

> 执行要求：使用 superpowers:subagent-driven-development，逐任务实现和评审；控制器同时处理独立的素材生成与视觉检查，不并行修改共享前端文件。

**目标：** 完成全部实验页面的统一视觉升级及已确认的电路直接操作。

**架构：** 保留 PhysicsScene → Engine → Verifier → Observation → PhysicsCanvas。改变共享呈现与用户手势适配，不在 React 中计算物理解答。

**技术栈：** React 18、TypeScript、CSS Modules、SVG/Canvas、Vitest、既有 Harness 插件。

**设计：** `docs/superpowers/specs/2026-09-13-experiment-studio-polish-design.md`

## 全局约束

- 保留用户现有未提交改动；不重置、不清理、不自动提交或推送。
- 只修改正式实验插件、相应测试及任务指定素材；不修改废弃的根 `apps/web`。
- 使用现有语义 token、CSS Modules 和 `clsx`，不添加依赖或第二套全局主题。
- 不新增自由接线编辑器、后端接口、账号流程或求解器；禁止 UI 编造物理读数。
- 用户可见文案走现有中英文 locale，默认中文；代码命名与代码注释用英文。
- 行为变化先写失败用例、运行确认红灯，再实现并确认绿灯；纯样式用浏览器图像核验。
- 仅同步本任务改动文件到 vendor 对应位置；不运行 overlay capture，不覆盖无关文件。
- 所有生成素材只使用指定服务和 `gpt-image-2.5-sunburst`，不得记录密钥。

### Task 1: 实验中心与共享工作台

**文件：**
- 修改 `overlays/harness/files/packages/client/ui-physicsos/src/client/ExperimentPicker.tsx`、`ExperimentPicker.module.css`、`LabEmptyState.tsx`、`LabEmptyState.module.css`。
- 修改同目录 `PhysicsWorkspace.tsx`、`LabWorkspace.module.css`、`workspace-parts.tsx`、`locales.ts`。
- 可新增一个小型工作台局部组件，避免继续膨胀主文件；不能新增插件公共导出。
- 测试 `overlays/harness/files/packages/client/ui-physicsos/tests/overlay.client.spec.tsx`、`renderer-decoupling.client.spec.tsx`；新增行为测试放 `workspace-presentation.client.spec.tsx`。

**接口：** 消费现有 `WorkspaceSnapshot`、`runtime.getSnapshot()`、`t`、场景模板与实验列表；不改变引擎和场景数据。专注模式属于组件本地 state，不能持久化到场景。

- [ ] 读取所有将改文件，搜索 CSS class、组件 props 与 locale 引用，核对正式入口。
- [ ] 对新增展示行为编写真实 PhysicsSurface 组件测试：专注模式可进入退出且工具仍可用；有曲线场景默认可见数据区；无曲线场景不默认展开空图区。使用 `circuit.client.spec.tsx` 的 `createPhysicsSurfaceController()` + `PhysicsSurface` 挂载模式。
- [ ] 用例核心断言采用真实可访问控件和数据，不断言 CSS 字符串。例如：

```tsx
fireEvent.click(screen.getByRole('button', { name: '专注实验' }))
expect(screen.getByRole('button', { name: '退出专注' })).toBeVisible()
fireEvent.click(screen.getByRole('button', { name: '退出专注' }))
expect(screen.getByRole('button', { name: '专注实验' })).toBeVisible()
```

- [ ] 运行聚焦测试，确认新行为尚不存在导致失败，并记录失败输出。
- [ ] 实现紧凑清晰的实验中心、统一卡片图片比例和明确状态；保留筛选、推荐、继续、未支持模板行为。
- [ ] 实现共享工作台的层级、间距、排版、可逆专注模式、数据区初始策略。`dataOpen` 初始化依据 `snapshot.charts.length > 0`；静态实验保留手动打开数据能力。
- [ ] 检查移动端工具栏换行、面板抽屉、长标题与键盘焦点，不能使用隐藏溢出掩盖不可达控件。
- [ ] 同步改动文件并运行聚焦测试、`pnpm typecheck:web`、`pnpm lint:web`。报告改动列表、红绿证据和剩余风险，交独立评审。

### Task 2: 所有领域的画布与器材呈现

**文件：**
- 修改 `overlays/harness/files/packages/client/ui-physicsos/src/client/physics/PhysicsCanvas.module.css`、`primitives.module.css`、`renderers.module.css`。
- 按需修改同目录 `PhysicsCanvas.tsx`、`renderer-registry.tsx`、`circuit-renderer.tsx`、各领域 `*-renderer.tsx`；每处只做呈现调整，禁止改物理模型。
- 新素材接入 `parts3d-catalog.ts` 与 `overlays/harness/files/apps/web/public/physicsos/parts3d/manifest.json`。控制器准备资源，实施代理只更新消费方与渲染锚点。
- 测试现有 `electric-point-charge-visual.client.spec.tsx`、`electric-region-visual.client.spec.tsx`、`circuit.client.spec.tsx` 及各领域测试。

**接口：** 保留 `RendererProps` 和 `SceneVisualModel` 的物理语义；若增加纯展示 props，更新所有实际调用方。新图片路径由控制器给出的真实素材清单提供，不预造不存在路径。

- [ ] 按全部已注册领域建立检查清单：力学/碰撞、电场、磁场/复合场、电路、电磁感应、光学、机械波、声学、流体、热学、杠杆。
- [ ] 统一坐标背景、轴/网格层级、线宽、标注、数字与单位的可读性。保留关键矢量颜色与图层开关语义。
- [ ] 优化器材比例和定位，使物体可辨认、读数不碰撞；物理几何、接线与图表由现有真实数据驱动。
- [ ] 接入新器材图，旧图和矢量 fallback 保留。测量图片尺寸与可见区域，更新 catalog/manifest 一致性；不旋转有固定机位的器材来冒充不同机位。
- [ ] 对资源失败、端子/标签位置相关行为补真实组件测试后实现。静态 CSS 不增加源码匹配式测试。
- [ ] 聚焦运行相应领域测试并检查 typecheck/lint；独立评审场景可读性与数据事实不变。

### Task 3: 电路直接操作及回归

**文件：**
- 修改 `PhysicsWorkspace.tsx`、`physics/PhysicsCanvas.tsx`、`physics/renderer-registry.tsx`、`physics/circuit-renderer.tsx`，必要时新增小型 `physics/circuit-interactions.ts`。
- 修改 `physics/renderers.module.css`、`locales.ts` 和 `tests/circuit.client.spec.tsx`。
- 只有确实需要 UI 手势桥接才修改 `physics/workspace-runtime.ts` 或 `circuit-workspace-runtime.ts`，不得改根 `packages/` 引擎。

**接口：** 沿用 `runtime.setChoice('switch:sw', 'open' | 'closed')` 与真实滑片参数 id 的 `runtime.editParameter()`。操作通道与既有 `ComponentDragChannel` 分开，避免元件移动误触；通过纯数据/回调传递，不能注册新的全局 store。

- [ ] 查全元件 pointer、`setChoice`、滑片 parameter id 和 frame 更新引用。
- [ ] 新用例先红：点击画布开关后电流为零且 Inspector 状态一致；键盘可切换；推滑片到中间/端点后真实读数变化；拖整个元件不切换开关；pointercancel 不遗留手势。
- [ ] 使用现有 `createSeriesCircuitScene()` 的独立预期：闭合时 6V/(10Ω+20Ω)=0.2A；断开为0；恢复闭合仍为0.2A。
- [ ] 使用 `createRheostatCircuitScene()` 的独立预期：滑片0/0.5/1时，6V/(10Ω+20Ω×位置)=0.6/0.3/0.2A。切换到手动位置后，原扫描播放不能悄悄覆盖手势结果。
- [ ] 先运行这些测试确认失败，再实现可访问开关和滑片操作区域；保留器件拖动、焦点、触摸和键盘路径。
- [ ] 同步文件，运行 `pnpm test:web`、`pnpm typecheck:web`、`pnpm lint:web`、`pnpm build:web`，记录所有警告和失败。
- [ ] 控制器使用真实浏览器在桌面、窄桌面和手机尺寸检查所有领域、筛选、图表、专注模式和电路手势；保留截图与日志。
- [ ] 最后执行 code-audit 与独立整体验收，更新交付报告，不自动提交/推送。
