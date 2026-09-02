# @deepseek-ai/dsh-tool-physicsos

PhysicsOS 物理工具的 Harness 宿主侧插件（host-plane tool plugin）。它把
`@physicsos/agent-tools` 的 `PhysicsToolRuntime` 注册成模型可调用的七个工具，
自身不含任何物理计算——数值全部来自 PhysicsOS 引擎、验证器与题目运行时。

## 注册的工具

| 模型可见名 | 运行时方法 | 作用 |
| --- | --- | --- |
| `physics_list_experiments` | `listExperiments()` | 实验目录（id / 领域 / 学段 / 标题） |
| `physics_create_experiment` | `createExperiment(id, title?)` | 按目录 id 建真实 `PhysicsScene`，返回 `sceneId` |
| `physics_solve_question` | `solveQuestion(text)` | 题面 → 解析 → 建场景 → 引擎求解 → 校验，返回结构化解答与 `sceneId` |
| `physics_describe_scene` | `describeScene(sceneId)` | 场景当前状态：对象 id、可观察量、可用命令 |
| `physics_scene_command` | `applyCommand(sceneId, type, payload)` | 执行一条 `SceneCommand`（revision +1）；被拒绝时返回 `ok: false`，不抛错 |
| `physics_simulate` | `simulate(sceneId)` | 引擎模拟 + 守恒校验：导出量、事件、每条检查 |
| `physics_observe` | `observe(sceneId, t)` | 某时刻的引擎状态 |

名称、描述与模型可见文本都来自 `@physicsos/agent-tools`（`PHYSICS_TOOL_DOCS`、
`PHYSICS_TOOL_RENDERERS`），任何 Harness 绑定呈现给模型的契约与措辞都相同：规范值是运行时的
JSON（供 Code Mode / 程序读取），`render` 输出运行时的中文文本投影（每个数值带单位、每条校验带
判定）。运行时的编码拒绝（`SCENE_NOT_FOUND`、`UNKNOWN_EXPERIMENT`…）以 `PhysicsToolCallError`
抛出，`code` 落在 `tool/result` 的 `error.info.code` 上。

## 配置

```yaml
- id: tool-physicsos
  name: '@deepseek-ai/dsh-tool-physicsos'
  config:
    sceneScope: session   # session（默认）| process
    maxScenes: 64         # 每个运行时保留的场景上限，超出丢最旧
```

`session`：每个 Agent 会话一份 `PhysicsToolRuntime`，学生之间的场景互不可见；
`process`：本宿主上所有会话共享一份（无 Agent 的调用方——测试、Code Mode——落在匿名作用域）。

## 所属组合

- Web：`apps/cli/config/agent-presets/physics-student/agent.cordis.yml`（预设「物理学习模式」：
  物理宪法 persona + 本插件 + `tool-ask-user`，不含 shell / 文件 / 网页 / 子代理工具）。
- Headless 验收：`tests/agent/physics-headless.patch.yml`（同一组合，写成 `--patch` 覆盖层）。

## 构建与验证（在 PhysicsOS 仓库根目录）

```sh
pnpm run build:agent       # tsc -b + tsdown → lib/index.js（内联 @physicsos/*，外部化 @deepseek-ai/*）
pnpm run typecheck:agent
pnpm run lint:agent
pnpm run test:agent        # tests/tool-physicsos.spec.ts + tests/preset-composition.spec.ts
node tests/agent/headless-physics-acceptance.mjs   # 真实 dsh 进程 + mock LLM 的端到端门禁
```

## 边界

- 本包是 DEV INTEGRATION BRIDGE 的宿主侧对应物：`@physicsos/agent-tools` 通过 `link:` 引入源码，
  打包时内联进 `lib/index.js`，运行时不依赖 tsx 解析 `.ts`。
- 不修改 Harness Agent Loop / Session / Tools 内核；只注册工具（docs/04 §6、§154）。
- 物理事实的唯一来源是 `PhysicsScene` 与引擎（docs/02 §3–§7）；本包不持有第二套场景状态。
