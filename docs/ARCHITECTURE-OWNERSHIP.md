# PhysicsOS 架构归属核对

本文回答一个具体问题：**PhysicsOS 相对上游 DeepSeek Harness，究竟自有什么、借用什么。**
所有结论只依赖仓库内的文件与可在本地复现的命令；每条数字都给出复核命令，可自行重跑。
上游快照是 submodule `vendor/deepseek-harness`，pin 在提交 `477b4f4`（tag `dsh-v0.1.7-rc.2`，见 `docs/HARNESS-UPSTREAM.md`）。

## 结论

**Agent 运行时按设计来自上游，不做自研；物理域、结果校验、题目语义与多租户产品层是自有。**
具体地：PhysicsOS 不重写 Harness 的 Agent Loop / Session / Tools（`README.md:159`），把 Harness 当作 Agent 基础设施；在它之下，自有代码提供上游没有的三类能力——物理引擎与数值校验、题目语义解析与判分、以及承载这些能力的多租户产品宿主（账号、加密模型密钥池、签名插件、论文流水线）。因此「只是给 DeepSeek Harness 换皮的 UI」不成立：`packages/` 下有 84,540 行自有 `.ts`（31 个包），overlay 下另有 36,620 行产品宿主与 49,565 行产品 UI `.ts`，均为上游不含的代码。反过来，「Agent 运行时自研」同样不成立——我们不自建、也不维护独立 Agent runtime（**Harness 是 Agent 宿主**）；曾经的 `packages/agent-runtime` 与 `packages/agent-dsh-adapter` 零消费者骨架已于 2026-09-27 退役删除（ADR-0002），见第 4 节。

## 1. 规模测量表

| 区域                                                                | 规模（口径见下）                                          |
| ------------------------------------------------------------------- | --------------------------------------------------------- |
| 自有源包 `packages/*`                                               | 84,540 行 `.ts`，347 个文件，31 个包目录                  |
| 自有产品宿主 `overlays/harness/files/packages/physicsos`            | 36,620 行 `.ts`，178 个文件                               |
| 自有产品 UI `overlays/harness/files/packages/client/ui-physicsos`   | 49,565 行 `.ts`（124 文件）+ 40,897 行 `.tsx`（120 文件） |
| 上游 vendored Harness `vendor/deepseek-harness`（commit `477b4f4`） | 783,758 行 `.ts`，3,643 个文件                            |
| 我方补丁 `overlays/harness/upstream-changes.patch`                  | 25 个文件，3,383 行（1,504 增 / 373 删）                  |

复核命令（在仓库根目录执行，输出即上表数字）：

```sh
# 自有源包（.ts，排除 node_modules）
find packages -name '*.ts' -not -path '*/node_modules/*' -print0 | xargs -0 cat | wc -l   # 84540
find packages -name '*.ts' -not -path '*/node_modules/*' | wc -l                          # 347
ls -d packages/*/ | wc -l                                                                 # 31

# 自有产品宿主
find overlays/harness/files/packages/physicsos -name '*.ts' -not -path '*/node_modules/*' -print0 | xargs -0 cat | wc -l   # 36620

# 自有产品 UI
find overlays/harness/files/packages/client/ui-physicsos -name '*.ts'  -not -path '*/node_modules/*' -print0 | xargs -0 cat | wc -l   # 49565
find overlays/harness/files/packages/client/ui-physicsos -name '*.tsx' -not -path '*/node_modules/*' -print0 | xargs -0 cat | wc -l   # 40897

# 上游 vendored Harness：只数 git 跟踪的上游文件，避免把 overlay 物化副本算进来（见附录）
(cd vendor/deepseek-harness && git ls-files 'packages/**' | grep '\.ts$' | grep -v '\.d\.ts$' | xargs cat | wc -l)   # 783758
(cd vendor/deepseek-harness && git ls-files 'packages/**' | grep '\.ts$' | grep -v '\.d\.ts$' | wc -l)               # 3643

# 我方补丁
grep -c '^diff --git' overlays/harness/upstream-changes.patch   # 25
wc -l < overlays/harness/upstream-changes.patch                 # 3383
```

口径：行数用 `cat | wc -l`（按换行计），排除 `node_modules`；上游行数另排除 `.d.ts`。测试文件默认**计入**（`packages/` 剔除 `tests/` 与 `*.test.ts` 后为 67,021 行 / 265 文件）。

## 2. 上游无法提供的能力（自有）

逐条给出真实路径，可打开核对。

- **物理引擎**：`packages/engine-*`，共 15 个 —— `engine-mechanics`、`engine-electric`、`engine-magnetic`、`engine-optics`、`engine-thermal`、`engine-wave`、`engine-acoustics`、`engine-fluid`、`engine-lever`、`engine-collision`、`engine-induction`、`engine-composite`、`engine-circuit`、`engine-modern`、`engine-electric-region`。核：`ls -d packages/engine-*`。
- **数值校验**：`packages/physics-verifier/src/{mechanics,electric,magnetic,composite}-verifier.ts` —— 模型给出的数字必须通过这些校验器。核：`ls packages/physics-verifier/src/*-verifier.ts`。
- **题目语义**：`packages/question-core/src/` —— 9 个 `deterministic-*-parser.ts`、`semantic-validator.ts`、`engine-selector.ts`、`question-runtime.ts`；对无法建模的题报 `UNSUPPORTED_MODEL` 而不是编答案（`workflow.ts:16`）。核：`ls packages/question-core/src/deterministic-*-parser.ts`。
- **让模型答案由引擎坐实的桥**：`packages/agent-tools/src/physics-tool-runtime.ts` 导出 `createPhysicsToolRuntime`（第 778 行），被 `overlays/harness/files/packages/physicsos/tool-physicsos/src/index.ts:36` 消费。核：`grep -n createPhysicsToolRuntime packages/agent-tools/src/physics-tool-runtime.ts`。
- **论文评审流水线（持久状态机）**：状态 `spec|drafting|checking|review|approved|exported|failed` 在 `overlays/harness/files/packages/physicsos/paper-host/src/domain.ts:277`；重启后把残留的 `drafting`/`checking` 判为失败并允许教师重试（死进程恢复）在 `paper-host/src/index.ts:132`。核：`git grep -n "'drafting', 'checking'" HEAD -- overlays/harness/files/packages/physicsos/paper-host/src/domain.ts`。
- **多租户账号/归属隔离**：`auth-host` —— 动作先解析为服务端权威 actor，tenant 不由调用方决定（`auth-host/src/identity.ts`）。
- **加密模型密钥池**：`model-pool-host/src/crypto.ts` —— AES-256-GCM + HKDF 封存，缺/换 secret 时 fail-closed。
- **签名插件清单**：`plugin-center/src/trust.ts` 用 Ed25519 公钥校验每个插件条目（`plugin-center/src/manifest.ts` 调用 `node:crypto` 的 `verify`）。

后四条路径前缀均为 `overlays/harness/files/packages/physicsos/`。

## 3. 边界：我们刻意不改的上游

- Harness core 的 Agent Loop、Session 和 Tools **不做** PhysicsOS 特化修改（`README.md:159`）。
- 自有 UI 与产品代码放在 `overlays/harness/`，由脚本叠加进 pin 住的上游 submodule，仓库不改上游历史（`README.md:166`；`node scripts/overlay/harness-overlay.mjs apply|capture`）。
- 对上游的改动收敛为一个补丁文件 `overlays/harness/upstream-changes.patch`：25 个文件、3,383 行，相对 783,758 行上游约 0.4%。改动以注册与配置为主（`package.json`、`tsconfig.*`、`pnpm-workspace.yaml`、`packages/bundle/web-app/presets/physics-student.patch.yml`），另含少量集成接缝（`packages/client/connection/src/*`、`packages/core/session/src/known-event-types.ts`、`packages/typert/protocol/src/types.ts`、`packages/api/gateway/src/index.ts`）。

## 4. 诚实说明 / 已知短板

本节记录**未成立**的部分。

- **`packages/agent-runtime` 与 `packages/agent-dsh-adapter` 曾是零消费者骨架（已于 2026-09-27 退役删除）。**
  - 退役前：`packages/agent-runtime` 的 `src/` 非测试代码 196 行（另 `contract.test.ts` 47 行）；全仓唯一消费者是 `packages/agent-dsh-adapter`，无生产路径 import。`packages/agent-dsh-adapter/src/deepseek-harness-adapter.ts` 是 PHASE-01 骨架：`createSession` / `send` / `resume` / `cancel` 等方法直接 `return Promise.reject(new UnimplementedError(...))`。
  - 处置记录见 `docs/adr/0002-agent-runtime-adapter-disposition.md`（**状态：已采纳并已执行**，方案 (b) 退役）。2026-09-27 已删除两个目录及其 workspace 成员与 `pnpm-lock.yaml` importer 引用；除包自身外全仓零命中 import，`apps/desktop` 与其余 `packages/**` 均无依赖。
  - 真正在跑的 Agent 链是上游循环：Harness Agent Loop → Harness Tool Runtime → `tool-physicsos` → `@physicsos/agent-tools` → 物理引擎 / verifier。**Harness 是 Agent 宿主，PhysicsOS 不自建独立 Agent runtime。**
- **论文流水线目前调用裸模型，尚未接引擎（进行中）。**
  - `paper-host/src/draft.ts` 的 `callModel` 直接走 `ctx.llm.stream`（第 90 / 92 行）；另有独立的二次求解 `paper-host/src/solve.ts`。
  - `paper-host` 包当前 **0 处** import `@physicsos/agent-tools`。核：`git grep -ln '@physicsos/agent-tools' HEAD -- overlays/harness/files/packages/physicsos/paper-host/`（无输出）。
  - 因此：**进行中**。有一条独立工作流正在把论文流水线改为引擎校验；在它落地并有端到端证据之前，不得声称论文结果已由引擎校验。

## 附录：测量口径与工作区注意

- **不要对 `vendor/deepseek-harness/packages` 直接 `find`**：该 submodule 工作区已被 overlay 物化（未跟踪文件 87,192 行，含 `packages/physicsos`、`packages/client` 下的 `ui-physicsos`、`packages/storage`）。直接 `find vendor/deepseek-harness/packages -name '*.ts' -not -name '*.d.ts' | xargs cat | wc -l` 会得到 870,950 —— 那是「上游 + 我方 overlay」的混合值，不是上游。上游的正确口径是上表的 `git ls-files`（783,758 行 / 3,643 文件，pin 在 `477b4f4`）。
- **数字随工作区漂移**：`paper-host/src/solve.ts` 等文件正被并发修改，`find` 于工作区测得的行数会变动；要稳定值请用 `git` 对 `HEAD` 测量，例如 `git grep -h '' HEAD -- ':(glob)overlays/harness/files/packages/physicsos/**/*.ts' | wc -l`（→ 36,620）。
