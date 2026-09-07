# Agent Tool Runtime V1 — Harness 接线报告

> 日期：2026-09-02（宿主侧接线）；2026-09-07 收口（场景推送 + 档位映射，§6）
> 状态：`AGENT_TOOL_RUNTIME_V1_COMPLETE`（已完成）
> 范围：docs/14 §19 Phase 16 Tool Runtime 的宿主侧接线 + 运行时本体 + 「模型改场景推送到画布」。
> §1–§5 记录宿主侧接线这一半；§6 是本报告的收口第二半。

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

---

## 6. 收口：场景镜像 + 档位映射（2026-09-07）

§5 的待接线在本收口中落地（"实验室 AI 助教抽屉"一条是独立 backlog，不变），`AGENT_TOOL_RUNTIME_V1`
关闭。新增代码走同一条 doc/04 §92 契约：引擎场景是物理真相，`physics/scene` 事件是
`SceneRevisionChanged` 通知，projection 是其 last-wins 折叠。

### 6.1 运行时本体

- `PhysicsToolRuntime.sceneSnapshot(sceneId)`：当前修订的无损深拷贝，宿主凭它把场景推出进程镜像到
  Lab；拷贝不能绕过 SceneRuntime 的命令闸门。
- 修复 §5 记录的严格可选属性隐患：solved 分支不再直赋 `domain: ir?.domain` / `model: ir?.model`
  （`undefined` 直赋在 `exactOptionalPropertyTypes` 下非法），改为与 rejected 分支一致的条件展开。
  插件侧 tsconfig 的放宽从此可以收紧；本轮未对整图做全量严格收严（避免牵连内联的其余源码），留待
  下轮。

### 6.2 场景镜像链

- **类型单点**：`tool-physicsos/src/types.ts` —— `physics/scene` SessionEvent 与 `physicsScenes`
  projection-key 的唯一声明处，模块增广挂到 `dsh-session` / `dsh-session-projection`；包根
  `./types`（宿主）与 `./client`（浏览器只取类型，不碰插件值图）两个命名空间零内容重复。
- **发布**：`tool-physicsos/src/index.ts` —— `physics_create_experiment` / `physics_solve_question` /
  被接受的 `physics_scene_command` 三处 execute 调 `publish(...)`：
  `exec.agent.session.append('physics/scene', snapshot)`。快照内嵌 `runtime.sceneSnapshot` 生成的完整
  `physics-scene/1.0` JSON，附 revision / cause / commandType / eventType / sourceQuestionId。被运行时
  拒绝的命令不发（场景未变）；无 agent 的调用方不发。声明留在插件的 `./types`，无宿主值依赖。
- **折叠**：`physicsScenes` session projection —— `foldPhysicsScene` 按 scene id last-wins、
  `latest` 跟随最新；仅在 `sessionProjections` seam 组合时注册（headless 无 seam 的装配不受影响）。
- **镜像**：`ui-physicsos physics/agent-scene-sync.ts` —— 纯框架同步器。`readAgentScenesProjection`
  对来自 wire 的值做防御式 shape 校验（表头必须与内嵌 scene 同 id / revision / `physics-scene/1.0`，
  否则整体拒收）；`createAgentSceneSync` 按会话记忆 `sceneId@revision`：会话首个值是基线 → 静默
  adopt（reload / 切会话不把学生从当前面拽走），后续修订 → live 打开 Lab；挂载前再过场景校验器，
  坏快照只记一次、projection 不动不重试。五条 spec 覆盖基线 adopt / 修订 shown / 重投 no-op / 切
  会话 / 坏 scene 拒挂载。
- **接线**：`ui-physicsos/src/client/index.ts` —— `surface.open` 提供 adopt（保持当前面）与 show
  （进 Lab）两个面动作；订阅 session 列表行、读 `projectionValues['physicsScenes']` 喂 sync。
- **不变量**：`tool-physicsos/src/invariant.ts` 从占位升级为真实伴生 —— 任何到达 durable log 的
  `physics/scene` 快照写前校验表头与内嵌 scene 一致，配合 projection schema 双闸。

### 6.3 档位映射

`ui-physicsos/profiles.ts`：三个学生档（探索 / 解题 / 引导）`runtimePreset` → `physics-student`，
教师档保留 `standard`。新建会话即进「物理学习模式」（persona 物理宪法 + 七工具 + 提问工具，无编码
工具），不再因默认档位落回编码 Agent。`overlay.client.spec` 三处断言随映射更新。

### 6.4 验收

- `typecheck`（core + web + agent）与 `lint`（core + web + agent）零错误。
- `test:agent` 22 用例（+5 scene mirroring：发布折叠 / 拒发不发 / solve 发布 + sourceQuestionId /
  agent-less 不发 / fold last-wins 不改状态）；`test:web` 28 文件 360 用例（+`agent-scene-sync.client
  .spec` 5 条、`overlay.client.spec` 档位断言更新）；agent-tools 32 用例。
- 端到端 `headless-physics-acceptance.mjs` **16 项门禁全 PASS**：在真实 `dsh` 进程 + mock LLM 下，
  `physics_solve_question` 之后会话日志出现恰一条 `physics/scene`（cause `solved`），内嵌 scene 与
  工具结果登记的场景同 id / revision、schema 为 `physics-scene/1.0`，本轮无 create / command 类发布。

### 6.5 仍不在本轮范围

- 浏览器画布「模型改场景实时跟随」的 GUI 端到端脚本：真实模型联调仍受中继无
  `DeepSeek-V4-Flash-0731` 通道限制（§5），本机跑不了真实 GUI agent 回合。publish 由真实 dsh 进程的
  会话日志断言承载，客户端镜像由纯函数 spec + 组合 spec 覆盖，`physicsScenes` projection 已随 session
  行投影到 Web —— GUI 脚本可作为真实模型通道恢复后的下一道验收，非阻塞。
- Timeline 逐刻 streaming（快照按工具调用粒度发布，非每帧）；教师侧专用预设；
  `AGENT_MODEL_BACKED_ANSWERS_BACKLOG` 等 backlog 不变。
