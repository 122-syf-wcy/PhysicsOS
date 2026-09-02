# Agent Tool Runtime V1 — Harness 接线报告

> 日期：2026-09-02
> 状态：`AGENT_TOOL_RUNTIME_V1`（进行中；本报告覆盖 Harness 插件 + 预设 + 端到端门禁这一半）
> 范围：docs/14 §19 Phase 16 Tool Runtime 的宿主侧接线。`@physicsos/agent-tools` 本体由另一条并行会话负责，本报告只消费其 `PhysicsToolRuntime` 契约。

---

## 1. 目标

让 DeepSeek Harness 会话里的模型**真正调用 PhysicsOS 引擎**，而不是靠记忆报数：

```text
模型 → tool call → @deepseek-ai/dsh-tool-physicsos → @physicsos/agent-tools PhysicsToolRuntime
     → Question Runtime / Scene Factory / SceneCommand / Engine / Verifier → tool result → 模型
```

约束沿用 docs/02 §50、docs/04 §5–§6：不改 Harness 内核，只用公开插件 API 注册工具；物理逻辑
全部留在根仓库 `packages/*`。

## 2. 交付物

| 路径 | 内容 |
| --- | --- |
| `overlays/harness/files/packages/physicsos/tool-physicsos/` | Harness 工作区成员 `@deepseek-ai/dsh-tool-physicsos`：`src/index.ts`（7 个 `defineTool` 注册 + 按会话隔离的 `PhysicsToolRuntime`）、`src/invariant.ts`（伴生不变量占位）、`tsdown.config.ts`（Node 库打包，内联 `@physicsos/*`）、两份 vitest 规格、README |
| `overlays/harness/files/apps/cli/config/agent-presets/physics-student/` | Agent 预设「物理学习模式」：物理宪法 persona、`tool-physicsos` 行、`tool-ask-user` 行；不含 shell / fs / web / 子代理 |
| `overlays/harness/upstream-changes.patch` | 新增两处 hunk：`apps/cli/package.json` 依赖 `@deepseek-ai/dsh-tool-physicsos`，`tsconfig.host.json` 项目引用；vendor `pnpm-lock.yaml` 随之更新 |
| `scripts/overlay/harness-overlay.mjs` | `OVERLAY_PATHS` 加入上述两个路径 |
| `package.json`（根） | `build:agent` / `typecheck:agent` / `lint:agent` / `test:agent`；`build:web`、`typecheck`、`lint`、`test` 已把它们串进去 |
| `tests/agent/` | `physics-headless.patch.yml`（headless 档的同一组合）、`headless-physics-acceptance.mjs`（13 项门禁）、`run-mock-llm.mjs`、`dump-session-log.mjs` |

## 3. 设计决策

1. **工具契约的唯一来源是运行时。** 名称与描述取自 `@physicsos/agent-tools` 的
   `PHYSICS_TOOL_NAMES / PHYSICS_TOOL_DOCS`，`physics_scene_command.type` 的枚举取自 `COMMAND_TYPES`，
   插件不复制一份说明。任何 Harness 绑定呈现给模型的契约都相同。
2. **规范值是运行时 JSON，模型读运行时的文本投影。** `output.schema` 为开放对象 / 数组，
   `render` 调 `PHYSICS_TOOL_RENDERERS[name](value)`（`@physicsos/agent-tools/render.ts`：每个数值带单位、
   每条校验带判定，四位有效数字），所以任何 Harness 绑定给模型的措辞一致；被场景运行时拒绝的命令
   是合法的物理回答（"B 必须 > 0"），以 `ok: false` 值返回，不是工具错误；运行时的编码拒绝
   （`SCENE_NOT_FOUND`、`UNKNOWN_EXPERIMENT`…）包成 `HarnessError` 子类 `PhysicsToolCallError`，
   `code` 落在 `tool/result.error.info.code`。
3. **按会话隔离场景。** 插件按 `exec.agent.id` 持有一份 `PhysicsToolRuntime`（`sceneScope: session`），
   学生互不可见；`process` 模式给单会话部署与测试用。
4. **预设而非宿主行。** Web 面的 agent 平面在 preset 后面（`web-app/cordis.patch.yml`），所以物理工具
   以预设 `physics-student` 交付：一次挂载、所有选择它的会话加入；`preset.yml` 提供学生可见名
   「物理学习模式」，`order: 0` 排在最前。
5. **DEV INTEGRATION BRIDGE 的宿主侧解法。** `@physicsos/agent-tools` 以 `link:` 指向 `.ts` 源码，
   Node 运行时无法直接导入，故 tsdown 以 `deps.alwaysBundle` 把整个 `@physicsos/*` 图内联进
   `lib/index.js`（916 kB），`@deepseek-ai/*` 保持外部。插件 tsconfig 关闭 `exactOptionalPropertyTypes`
   以按根仓库方言编译被内联的运行时源码（对方源码目前有一处不满足严格可选属性）。

## 4. 验收

### 4.1 单元 / 组合（`pnpm run test:agent`，2 文件 17 用例）

`tool-physicsos.spec.ts`（14）：七个工具注册且描述来自运行时；目录列举；开磁场实验 → `physics_simulate`
→ 引擎 `cyclotron_radius = mv/(qB)`；`SetMagneticFieldStrength` 使 revision 0 → 1 且半径减半；
驻波台改频率被拒绝为 `ok:false / WAVE_WRONG_SUBMODEL`；非法命令类型在 schema 边界被拒；
`physics_observe` 读到平抛 t = 1 s 的位置；`physics_solve_question` 解题并登记场景；
`SCENE_NOT_FOUND` / `UNKNOWN_EXPERIMENT` 以 `error.info.code` 暴露；参数缺失即错；按会话隔离与
`process` 共享；匿名作用域；dispose 即注销；命名空间导出形状。

`preset-composition.spec.ts`（3）：预设文件是三行具名组合、persona 含物理宪法六条、无编码工具；
`preset.yml` 元信息；在一个 agent scope 下挂载后 persona 遮蔽部署默认值、七个工具只对该 scope 可见。

### 4.2 端到端（`node tests/agent/headless-physics-acceptance.mjs`，13 项全 PASS）

真实 `dsh --profile headless --patch tests/agent/physics-headless.patch.yml` 进程 + Harness mock LLM
（脚本：先 `tool_call_success(physics_solve_question)`，再文字答复）。会话日志证明：
请求只公告七个 `physics_*` 工具、无编码工具；persona 含物理宪法；恰好一次 `tool/call`；
`tool/result` 是运行时的文本投影「已求解（magnetic / charged_particle_uniform_magnetic_field）」、
「校验：passed（63/63 项通过）」、「轨道半径 R = 7.83 cm」、「运动周期 T = 1.64×10⁻⁷ s」、
「场景已就绪：sceneId = question-agent-question-*」；`turn/end` 为 `completed`。

### 4.3 运行中的 Web 宿主

不重启 `pnpm dev`（3080）的情况下，设置 → 通用设置 → Agent 预设 菜单已列出
「物理学习模式 / 标准模式 / PTC 模式 / 极简模式 / 创造模式」，新预设未被标记为 broken——
发现与元信息在正式 Web 宿主里生效。

### 4.4 静态门禁

`pnpm run typecheck:agent` ✓、`pnpm run lint:agent`（oxlint）零错、`pnpm run build:agent` ✓；
`@physicsos/agent-tools` 自身 `typecheck` ✓、19 项测试 ✓（另一会话所有）。

## 5. 已知限制 / 待接线

- **学生模式档位仍映射到 `standard`。** `ui-physicsos/profiles.ts` 的 `runtimePreset` 需改为
  `physics-student`（并保留教师档），否则 PhysicsOS 首页新建会话时会把预设改回编码 Agent；
  该文件属 UI 会话所有，本切片未改。
- **实验室 AI 助教抽屉仍是确定性意图匹配**，与 Harness 会话里的工具调用是两条链路；把抽屉切到
  `PhysicsAgentRuntime` 是 backlog `AGENT_MODEL_BACKED_ANSWERS_BACKLOG`。
- **模型改的场景与画布不同步。** 工具运行时的场景在宿主进程内存里，浏览器画布不会跟着变；
  把 `sceneId` 推到 Lab（docs/04 §92 Streaming / §93 `SceneRevisionChanged`）是后续阶段。
- **真实模型联调受阻于中继。** 本机 `~/.dsh` 配置的中继当前无 `DeepSeek-V4-Flash-0731` 通道
  （`No available channel`），因此端到端用 mock LLM 完成；组合与工具链路与真实模型无关。
- **对方运行时的严格可选属性。** `packages/agent-tools/src/physics-tool-runtime.ts` 第 465 行附近
  `domain: ir?.domain, model: ir?.model` 在 `exactOptionalPropertyTypes: true` 下不通过；插件侧已
  用 tsconfig 放宽，运行时侧修掉后可以收紧回来。
- `pnpm dsh` 在 submodule 下会因 pnpm `verify-deps-before-run` 触发带 lefthook 的 `install` 而失败
  （HARNESS-UPSTREAM 已记录）；跑过 `pnpm -C vendor/deepseek-harness install --offline --ignore-scripts`
  之后即恢复。验收脚本直接 spawn `node --import tsx/esm apps/cli/src/bin.ts` 绕开该检查。
