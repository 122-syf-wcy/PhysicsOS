# 交接说明（换机 / 新环境上手指南）

本文件写给"在另一台机器上继续开发 PhysicsOS"的人。读完这一页就能把环境跑起来，
并知道当前代码处于什么状态、哪些做完了、哪些没做。

---

## 1. 当前分支与这次的工作

| 项     | 值                                                            |
| ------ | ------------------------------------------------------------- |
| 仓库   | `https://github.com/122-syf-wcy/PhysicsOS.git`                |
| 分支   | `codex/experiment-studio-polish`（与 `main` 同一提交）        |
| 分支头 | `1f41b3a`（2026-09-26，P0-P2 收口工作在工作区，尚未提交）      |
| 内容   | 实验工作室 → 账户体系 → 管理后台 → 资源库 → 出卷专区 → 全校共享 `/api` 账号隔离 → P0-P2 收口 |

当前 P0-P2 收口计划见
[`docs/superpowers/plans/2026-09-26-p0-p2-program.md`](superpowers/plans/2026-09-26-p0-p2-program.md)。
计划覆盖生产部署、密码恢复、跨设备学习记录、班级作业、物理内容扩展、桌面壳和工程门禁。

> **本节此前写的是 `feat/circuit-living-effects` / `794b9d0`，已过期。**
> 那条分支早已 fast-forward 进 `main`（`git branch --contains 794b9d0` 可见），
> 现状是 `main` 与 `codex/experiment-studio-polish` 指向同一个提交。

`main` 已包含全部历史，直接：

```bash
git clone https://github.com/122-syf-wcy/PhysicsOS.git
```

---

## 1.1 一周的工作面（2026-09-12 → 09-21）

这段工作**曾经整整一周没有提交**（335 个文件、+16724/−5747 行只存在于工作区，
一次 `apply` 误操作或磁盘故障就全没了）。09-21 已按主题补成交付：

| 主题                   | 代表内容                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `fix(packages)`        | 09-14 审计的 5 条 P0 物理正确性缺陷全修（题给时长 / 斜抛发射条件 / 平行板偏转 / 牛二水平合力 / 比较类题诚实拒识） |
| `feat(question-paper)` | 出卷域模型新包：细目表 / 组卷算法 / 检查 / 版本哈希 / markdown 导出                                               |
| `feat(auth-host)`      | 学校一级租户账户体系：argon2id、HttpOnly 会话、限流、CSRF、`/physicsos/auth`                                      |
| 管理后台               | 申请审批 / 学校 / 用户 / 审计四 tab，`/physicsos/admin`，路由级角色 + 租户收窄                                    |
| `feat(ui)`             | 登录注册门、侧栏学校身份、资源库（926 项配套资源）、出卷专区、题库录入                                            |
| 实验台                 | 器材精灵接入、自由拖动 + 导线自动重排、开关/滑变画布直接操作                                                      |
| 资产                   | 器材精灵（电路 + 力学）、资源库/登录页素材、KaTeX、官网静态站                                                     |
| 门禁                   | `auth-host`/`paper-host` 接入 `pnpm typecheck/lint/test`；`lint` 与 `test` 全绿                                   |

**未做**：见 `docs/reports/BACKLOG.md`（`GUIZHOU_SCHOOL_ROSTER_HIGH_SCHOOL_GAP`、
`DSH_CREDENTIALS_SCHEMA_SKEW` 等）。

---

## 2. 环境搭建（按顺序）

### 2.1 依赖与子模块

`vendor/deepseek-harness` 是 pin 住的 submodule，克隆后是空的，必须先物化：

```bash
git submodule update --init --recursive
pnpm install
```

### 2.1.1 Node 版本：**必须 ≥ 24.7，且 OpenSSL 带 argon2id**

`auth-host` 用 `node:crypto` 的 argon2id 做口令哈希，没有它插件**拒绝加载**，
整个 web 服务起不来。这不是"建议版本"——它是硬门槛，故根 `engines.node`
已从 `>=20.19.0` 提到 `>=24.7.0`。

两个坑：

- **"有函数"不等于"能算"**。有的构建暴露了 `crypto.argon2Sync`，但底层
  OpenSSL 没有 argon2id，调用时抛 `ERR_CRYPTO_ARGON2_NOT_SUPPORTED`。
  本机就撞上过一个 vendored Node 24.18.1 属于这种情况。
  `passwords.ts` 现在用最低合法参数真跑一次来判定能力，报错是单行的：
  `auth-host requires a working argon2id: … (Node v24.18.1; needs >= 24.7 built
against an OpenSSL with argon2id)`。裸 `typeof … === 'function'` 判据已废弃。
- **`pnpm exec` 会继承调用方的 PATH**，所以从某个自带 Node 的宿主里跑
  `pnpm …`，脚本里的 `node` 可能是那个宿主版本而非你的 `node -v`。
  症状是测试在 auth-host 上批量失败。核对：
  `pnpm -C vendor/deepseek-harness exec node -v` 不适用时，直接在脚本里
  `node -v` 打印一次；必要时 `PATH="/opt/homebrew/bin:$PATH" pnpm test`。

```bash
node -v                                   # 期望 v24.7+ 且 argon2 可用
node -e "console.log(typeof require('node:crypto').argon2Sync)"   # function
```

### 2.2 把 overlay 铺进 vendor（关键步骤）

本仓库**不直接改 vendor**。`overlays/harness/files/` 才是 PhysicsOS 自有代码的
真身，由脚本叠加进 vendor 工作区：

```bash
node scripts/overlay/harness-overlay.mjs apply
```

`apply` 是叠加复制，不会删除 vendor 里已有的 `node_modules/` 与 `lib/`。

反过来，如果你在 vendor 里直接改了代码，必须回写，否则下次 `apply` 会覆盖掉：

```bash
node scripts/overlay/harness-overlay.mjs capture
```

**这是最容易踩的坑**：不要只改 vendor 就以为改完了。

> ⚠️ **`OVERLAY_PATHS` 漏一个包 = 那个包只活在 vendor 里 = 会被静默丢掉。**
> `paper-host`（出卷专区整个后端，13 个文件）就曾经如此：它在 submodule 里是
> 未跟踪状态（`?? packages/physicsos/`），不在 overlay、父仓库也看不到它
> （`git ls-files | grep paper-host` 为空）。于是 HANDOVER 里那条"新机器上手"
> 流程走完，出卷专区后端**根本不存在**，`git clean -fdx` 或任何一次 submodule
> 重建都会删掉它。09-21 已补进 overlay 并验证 `apply` 能逐字节重建。
>
> **加新 host 插件时的检查清单**（三步都要做，缺一不可）：
>
> 1. `overlays/harness/files/...` 下建目录（排除 `node_modules` / `lib`）
> 2. `scripts/overlay/harness-overlay.mjs` 的 `OVERLAY_PATHS` 加路径
> 3. `cordis.patch.yml` 挂载 + `package.json` 加依赖 + 重建
>
> 自查：`git -C vendor/deepseek-harness status --short | grep '^??'` 列出的每条
> 未跟踪路径都应该能在 `OVERLAY_PATHS` 里找到对应项。

> ⚠️ `overlays/harness/upstream-changes.patch` 必须是**完整版**（约 43 个上游
> 文件、1860+ 行，声明并渲染 `sidebar.brand/nav/new`、`conversation.hero.*`、
> `conversation.surface` 等 PhysicsOS 自定义槽位）。`ecc7286` 曾误把它削到
> 14 行，已恢复为 `8c50de7` 版——若新机器上 `typecheck:web` 报
> `"sidebar.nav" not in SlotMap` 之类错误，先检查这个 patch 是否完整。

> ⚠️ **`apply` 不会恢复 `lib/` 与 `node_modules/`。**（`node_modules` 是
> pnpm 的 workspace link，`lib` 是构建产物。）如果你把整个包目录挪走再
> `apply` 回来，拿到的只有源码——必须重跑 `pnpm install` 与包内
> `pnpm run bundle`，否则类型解析会退化成 `any`，`oxlint` 的 type-aware
> 规则会从几十条暴涨到上千条 `no-unsafe-*`。这个症状很好认：
> 报错数量突然一个数量级变化，就是类型解析断了，不是代码坏了。

### 2.4 新机器首次构建顺序（实测）

`pnpm dev` 起服务前，vendor 侧需要先有这些产物（overlay apply 之后）：

```bash
cd vendor/deepseek-harness
pnpm install                       # 生成 workspace link 条目；lefthook postinstall 失败可忽略
./node_modules/.bin/tsc -b tsconfig.host.json
./node_modules/.bin/tsdown --config tsdown.config.ts --env.DSH_BUILD_FACE=host
./node_modules/.bin/tsc -b tsconfig.client.json   # 上游测试文件有既有类型报错，与 overlay 无关
./node_modules/.bin/tsdown --config tsdown.config.ts --env.DSH_BUILD_FACE=client
pnpm --filter @deepseek-ai/dsh-web-frontend exec vite build   # 前端 dist
```

首次 `pnpm dsh dev` 若报 profile 缺包，先跑 `pnpm dsh plugin --profile web install`
初始化 `~/.dsh/profiles/`。

### 2.3 `.env`（不随仓库走，必须手工重建）

`.env` 被 `.gitignore` 忽略，里面是生图网关凭据。新机器上从 `.env.example` 复制
并填值：

```
PHYSICSOS_IMAGE_PRIMARY_BASE_URL=
PHYSICSOS_IMAGE_PRIMARY_API_KEY=
PHYSICSOS_IMAGE_PRIMARY_MODEL=gpt-image-2.5-sunburst
PHYSICSOS_IMAGE_SECONDARY_BASE_URL=
PHYSICSOS_IMAGE_SECONDARY_API_KEY=
PHYSICSOS_IMAGE_SECONDARY_MODEL=
```

当前在用的主网关是 `https://image.haqiuhaqiu.xyz`，模型 `gpt-image-2.5-sunburst`。
注意两套凭据**域名不通用**：`imageapi.top` 的 key 在 haqiuhaqiu 上是
`INVALID_API_KEY`，反之亦然；`imageapi.top` 这套可作备选（同一模型在列）。
密钥由持有人单独交接，**不要写进任何被提交的文件**。

### 2.3.1 Agent 模型路由（`~/.dsh`，不在仓库里）

物理助教走 Harness 的 `llm-pi-ai` provider（`llm-deepseek` 硬编码 text-only，
发不出图）。配置写在 **Harness home**（`~/.dsh/`），不是仓库 `.env`：

- `~/.dsh/.env`：`PHYSICSOS_MODEL_API_KEY=<持有人交接的 sk-… key>`
- `~/.dsh/settings.yaml` 追加 provider profile + 默认模型：

```yaml
llm-pi-ai:
  providers:
    anna:
      displayName: Anna
      api: openai-completions
      baseURL: https://ai.anna.tf/v1
      apiKeyEnv: PHYSICSOS_MODEL_API_KEY
      transport: sse
      # 网关 WAF 拦 OpenAI SDK 默认 UA（OpenAI/JS * → 403），必须自定义
      headers:
        User-Agent: physicsos-dev/1.0
      compat:
        thinkingFormat: deepseek
      defaultInput: [text, image]
      models:
        - id: DeepSeek V4.1 Flash # 必须用这个确切 id（区分大小写）
          name: DeepSeek V4.1 Flash
          contextWindow: 1000000
          maxTokens: 8192
          input: [text, image]
agent-default-model:
  provider: anna
  model: DeepSeek V4.1 Flash
```

验证：`node tests/agent/real-model-smoke.mjs`（需要上面两个文件就位；headless
全链路，断言 anna 路由 + physics_solve_question 调用 + physics/scene 事件）。

---

### 2.5 `~/.dsh/.credentials.yaml` 的 schema 偏差（会挡住启动）

**症状**：`pnpm dev` 起不来，报

```
credentials-local: the value for "version" in ~/.dsh/.credentials.yaml must be a string
```

**原因**：这个文件有两个不兼容的写法。

- 本仓库 pin 的 harness 里，`credentials-local` 把 YAML **根节点**当成一张扁平表
  （键 → 字符串密钥），逐条 `credentialRef()` 校验键名是不是 POSIX 标识符。
- DSH Desktop 2.x 会把它改写成**嵌套文档**：

```yaml
version: 1 # ← 数字，不是字符串
records:
  client-connection/browser-session: { … } # ← 键名不是 POSIX 标识符
refs:
  LUCK_API_KEY: sk-…
  CLINE_API_KEY: sk_…
```

于是旧解析器读到根键 `version: 1` 就抛错，服务**完全起不来**。这不是代码缺陷，
是**宿主版本与 vendored harness 的偏差**——文件被谁改写过，重启就会踩到。

**临时绕开**（不要动 DSH Desktop 的那个文件，它可能是新版格式）：

```bash
H=/tmp/dsh-physicsos-home
mkdir -p "$H/storages"
for f in profiles settings.yaml .env .anonymous-user-id; do
  ln -s "$HOME/.dsh/$f" "$H/$f"
done
# 只把 refs 那段重建成扁平映射（注意 0600 权限）
DSH_HOME="$H" pnpm -C vendor/deepseek-harness dsh web
```

`DSH_HOME` 是官方支持的覆盖点（`packages/util/home-paths`）。注意 `profiles/`
要用 symlink——它带约 300MB `node_modules`，拷不动。

`tests/acceptance/support.mjs` 的 `startIsolatedServer()` 做的就是这件事，
可以直接抄。

**根治方向**（未做）：把 pin 的 harness 升到能读嵌套文档的版本，或让宿主与
仓库共用同一份 credentials 实现。见 `docs/reports/BACKLOG.md` 的
`DSH_CREDENTIALS_SCHEMA_SKEW`。

---

### 2.6 题库数据从哪来（`scripts/ingest-ceval-physics.mjs`）

题库（`bank_items`）的真实数据由一条可重复执行的脚本灌入：

```bash
node scripts/ingest-ceval-physics.mjs --dry-run   # 只映射并打印样例
node scripts/ingest-ceval-physics.mjs             # 写入 :3080
node scripts/ingest-ceval-physics.mjs --base http://127.0.0.1:3099
node scripts/ingest-ceval-physics.mjs --retag     # 改关键词表后重新打标
```

**批量核验**：388 条一次落下后，逐张点不现实。出卷专区 → 真题资料库 → 待核验区
有范围筛选 + 「批量核验入库 / 批量退回」，二次确认里明说"接受该来源不等于逐题
校对"。接口是 `POST /physicsos/paper/bank/items/review-batch`（≤500 条/请求）。
注意 **`verified` 的内容是冻结的**：`PUT /bank/items/:id` 会 409 `FROZEN`，
要改先退回 pending。

数据源是 **C-Eval**（`ceval/ceval-exam`，CC BY-NC-SA 4.0）的
`middle_school_physics` + `high_school_physics`，共 401 道单选题。
选它是因为它是本环境下唯一**有明确许可、且机器可读**的中国中学物理题源；
商业题库付费且有版权，省级考试院不公开整卷。

脚本是幂等的（服务端按题干指纹去重，重复跑只会得到"已存在"）。默认
**先起服务**——它就是个 HTTP 客户端，不直接写存储文件。

> **这批数据不是贵州真题**，也没与任何试卷核对过。因此每条都是
> `status: pending`（待教师核验）、`reuseModes: ['adapt']`（只能当改写骨架，
> 不会原样印成试卷）、`answerTier: web-public`，并且把数据源**没有提供**的
> 字段（官方考点/难度/能力/分值）逐条登记在 `anomalies` 里——审核界面直接
> 可见。考点标签是机器从题干+选项推的，标了 `knowledge-derived-from-stem`。
>
> 详细取舍见 `docs/reports/MILESTONES.md` 的 `QUESTION_BANK_DATA_V1` 与
> `docs/reports/BACKLOG.md` 的 `PAPER_STUDIO_DATA_STATE`。

**卷库（`source_papers`）仍是 4 张卷**：C-Eval 提供题目集合，不含卷级元数据
（年份/地区/学校），凭空补卷名就是编。扩卷库需要真实卷源。

> ⚠️ `pnpm format`（`prettier --check .`）**全仓 751 个文件不通过**，包括几个
> 早于本轮就存在的脚本。它不在 `lint`/`test` 门禁里，所以一直没暴露。别被它
> 的红吓到，也别顺手 `--write`——先补 `.prettierignore` 排除 `vendor/` 与
> 生成物，见 `BACKLOG.md` 的 `PNPM_FORMAT_IS_RED`。

---

## 3. 常用命令

```bash
pnpm dev              # 起 Web 开发服务
pnpm typecheck:web    # 类型检查（client 侧）
pnpm lint:web         # oxlint（client 侧）
pnpm test:web         # vitest（client 侧测试）
```

`typecheck` / `lint` / `test` 都有 `:core` / `:web` / `:agent` 三个分片，裸命令是
串行跑全部。

**2026-09-21 起三条门禁全绿**（此前 `lint` 与 `test` 都有既存红）：

| 命令             | 覆盖                                                             | 结果      |
| ---------------- | ---------------------------------------------------------------- | --------- |
| `pnpm typecheck` | core + web + **tool-physicsos / auth-host / paper-host**         | 0 错      |
| `pnpm lint`      | core（eslint）+ web（oxlint 171 文件）+ 三个 host 插件           | 0 错 0 警 |
| `pnpm test`      | core + web（44 文件 686 测试）+ 三个 host 插件（7 文件 91 测试） | 全绿      |

> `test:agent` 此前**只跑 `tool-physicsos`**，`auth-host` 的 4 个 spec 与
> `paper-host` 的 1 个 spec 不在任何日常门禁里——只有跑 harness 自己的 vitest
> 才会被 `packages/*/*/tests/**` 命中。现改为 `vitest run packages/physicsos`。
> `typecheck:agent` / `lint:agent` 同步覆盖三个包。接线当场暴露出 141 项从未
> 检查过的 lint 错误（已清偿）。

### 3.0 浏览器验收（`tests/acceptance/*.mjs`）

```bash
node tests/acceptance/auth-acceptance.mjs        # 账户体系 + 管理后台（自带隔离服务）
node tests/acceptance/library-home-acceptance.mjs  # 需要先 pnpm dev（连 3080）
```

`auth-acceptance.mjs` **自带服务**：临时 `DSH_HOME` + 独立端口 3099 +
由它自己决定密码的 `SUPER_ADMIN`，跑完什么都不留下，因此可重复执行、
不依赖也不破坏你本机的 dev 数据。它要求运行它的 `node` 能算 argon2id，
否则一行报错说清原因。

其余套件连 `http://127.0.0.1:3080`，所以要先把 `pnpm dev` 起着。

### 3.1 改了前端源码，界面不会自己变（必读）

Web 服务加载的是**预打包产物**，不是 `src/`：

```
vendor/deepseek-harness/packages/client/ui-physicsos/lib/client.js
```

改 `overlays/harness/files/packages/client/ui-physicsos/src/` 之后必须重新打包，
否则浏览器里跑的仍是旧代码：

```bash
pnpm -C vendor/deepseek-harness --filter @deepseek-ai/dsh-client-ui-physicsos run bundle
```

（想常驻增量构建就用同目录的 `run watch`。）刷新页面即生效；页面 `<head>` 里
`client.js?rev=` 的值变化说明服务端换包成功。

**这个坑很隐蔽**：`pnpm test:web` 跑的是 `src/`，全绿；应用跑的是 `lib/`。
2026-09-14 就踩过一次——`circuit-renderer.tsx` 里修好的仪表读数改动进了 `src/`
没进 `lib/`，浏览器验收看到的还是修复前的画面，误判为"没修好"。

Agent 侧同理：`dsh-tool-physicsos` 把 `@physicsos/*` 源码内联进
`vendor/deepseek-harness/packages/physicsos/tool-physicsos/lib/index.js`，
改 `packages/` 下任何 physics 源码后必须 `pnpm run build:agent` 并重启
`pnpm dev`，否则 `physics_solve_question` 等工具返回旧行为（2026-09-14 力学
endTime 修复在浏览器里仍报 v=30/200m，就是这个原因——重建后恢复 v=20/75m）。
`grep "关键改动代码片段" lib/index.js` 可直接确认 bundle 新旧。

**三个 host 插件同理**（`auth-host` / `paper-host` / `tool-physicsos`）：
服务加载的是各自的 `lib/index.js`，不是 `src/`。改完源码必须重建再重启：

```bash
cd vendor/deepseek-harness
for p in auth-host paper-host tool-physicsos; do
  ./node_modules/.bin/tsc -b packages/physicsos/$p/tsconfig.json
  (cd packages/physicsos/$p && ../../../node_modules/.bin/tsdown)
done
```

**注意顺序**：`tsdown` 的入口是 `lib/types/index.js`（`tsc` 产物），
**必须先 `tsc -b` 再 `tsdown`**；直接跑 `tsdown` 打的是上一次的旧产物，
表现是"路由/数据明明在源码里却 404 或查不到"。
（包内有 `pnpm run bundle` 按正确顺序跑两步，但它会触发 pnpm 的依赖检查，
在 lefthook postinstall 失败的环境里会被打断——所以上面给的是直连写法。）

> 2026-09-21 就踩过一次：往名录里加了 15 所学校、`apply` 也同步了、
> 单测全绿，但隔离服务注册新校名仍然 `SCHOOL_NOT_FOUND`——因为
> `auth-host/lib` 还是旧的。重建后 4 所全部 201。
> **症状识别**：单测（跑 `src/`）与真实服务（跑 `lib/`）结论不一致。

排查手法：`lib/client.js.map` 的 `sourcesContent` 里存着**打包当时**的全部源码，
把它和当前 `src/` 逐文件 diff，就能看出 `lib/` 落后在哪：

```bash
node -e '
const m=require("./vendor/deepseek-harness/packages/client/ui-physicsos/lib/client.js.map");
const i=m.sources.findIndex(s=>s.includes("circuit-renderer"));
console.log(m.sourcesContent[i])' | diff - overlays/harness/files/packages/client/ui-physicsos/src/client/physics/circuit-renderer.tsx
```

---

## 4. 视觉层在哪里

电学台（以及全部领域）的渲染代码在：

```
overlays/harness/files/packages/client/ui-physicsos/src/client/physics/
```

| 文件                            | 作用                                                 |
| ------------------------------- | ---------------------------------------------------- |
| `*-renderer.tsx`                | 各领域 SVG 渲染器（`circuit-renderer.tsx` 是电学台） |
| `renderers.module.css`          | 渲染器样式（导线、电流、灯光都在这里）               |
| `scene-visual-model.ts`         | 渲染层消费的视觉模型契约                             |
| `*-visual-bridge.ts`            | 引擎结果 → 视觉模型的桥（数值诚实性的关键层）        |
| `tests/circuit.client.spec.tsx` | 电学台测试                                           |

设计 token（`--physics-*`）**不在 CSS 文件里**，而是以字符串形式注入 DOM，位于：

```
overlays/harness/files/packages/client/ui-physicsos/src/client/chrome.ts
```

新加变量必须加在这里。在样式表里凭空写一个 `var(--physics-xxx)` 且未定义，
会静默画不出东西。

---

## 5. 器材精灵流水线（生图）

三支脚本，都在 `scripts/design/`：

```bash
# 1) 生成（约 60 秒/张；并发 3；从 .env 读凭据；不打印密钥）
node scripts/design/generate-parts3d.mjs              # 全部
node scripts/design/generate-parts3d.mjs lamp-off     # 只生成指定 id

# 2) 后处理：裁到实体轮廓、按统一基准归一化、压缩、写 manifest.json
python scripts/design/postprocess-parts3d.py

# 3) 像素验收：边缘截断 / 多件同框 / 轮廓是否是"只剩一根线"
python scripts/design/verify-parts3d.py
```

产出落在：

```
overlays/harness/files/apps/web/public/physicsos/parts3d/
```

（注意是 **overlay 侧**的 `apps/web/public/`，不是仓库根的 `apps/web/public/`。
写到根目录的话 `apply` 不会同步，等于白生成。）

网关行为（已实测）：返回 `data[0].url`（无 base64）；`size: 1024x1024`；
`background: "transparent"` 真实生效，出图自带 alpha，无需抠图；单张约 60–120 秒。

风格统一靠 `generate-parts3d.mjs` 里的 `STYLE` 常量（3/4 视角、左上主光、共用
参照尺度）。**改风格就要重生成全套**，否则新旧器材的相机与光向对不上。

第一版器材清单（10 件）：`lamp-off`、`lamp-on`、`resistor`、`rheostat`、`battery`、
`switch-open`、`switch-closed`、`ammeter`、`voltmeter`、`terminal`。

---

## 6. 当前状态：做完的 / 没做的

### 已完成并有证据

- **电流流光**：深色圆点改为金色虚线路径，每帧推进 `stroke-dashoffset`，速率
  ∝|I|（钳制 8–90 px/s），方向随解出的电流符号。逐段 KCL 诚实性未变——动的只是
  虚线相位，几何仍是导线自身的折线。
- **灯泡分层辉光**：单个径向渐变圆盘改为三段同色温叠层（bloom / disc / core，
  后两者 `mix-blend-mode: screen`），并补灯丝路径；灯丝与光晕共用同一个归一化
  `glow`，不会互相矛盾。
- **电缆导线**：1.6px 中灰细线升级为带高光与轻微投影的电缆。
- **精灵流水线 + 10 件器材**：已生成、已归一化、已通过像素验收、已入库。
- **器材精灵已接进渲染层**（本轮）：`parts3d-catalog.ts` 静态目录与
  `manifest.json` 保持 parity（有测试看守）；`circuit-renderer.tsx` 按
  `kind` 选精灵，用 `solidBox` 归一化摆放，矢量符号保留为回退
  （无映射 / `<image>` onError，失败按 component id 逐个记）。开关开/合、
  滑变滑块指针、A/V 表盘字母、电流箭头、辉光中心均已实机验证。
- **器材自由拖动 + 导线自动跟随**（本轮）：新增场景命令
  `SetComponentPlacement`（`physics-scene/src/scene-runtime.ts`）——校验
  circuitId/componentId、有限坐标、可选 90° 步进旋转，写
  `circuit.metadata.layout.components`；相连导线按"物理导线"模型重排
  （`circuitLayoutPlace` → `rerouteWire`，`circuit/circuit-scene.ts`）：
  未动一侧的弯折全部保留，移动端拉到旧脊线上补一个桥接弯，矩形回路
  在拖动后仍是矩形而不是被斜线割裂；发 `ComponentPlacementChanged` 事件。
  该命令是展示元数据而非物理事实：**不 fork 题面场景**
  （`experimental-branch.ts` 的 `FACT_COMMANDS` 明确缺席）、
  **不回卷时间轴**（`rewind: false`）。渲染器侧走指针拖拽：命中区是盖住
  `solidBox` 的透明 rect（精灵图 `pointer-events: none`），<3px 视为点击；
  拖动中 runtime 只做预览快照（钉住视口防自动缩放），松手才提交一次正式
  命令；`pointercancel` 走 `cancelComponentPlacement` 回弹。预览与提交都
  对元件中心做 **0.5 栅格吸附**——自由拖动但落点对齐，这是拖动后画面
  依然协调的关键。逆投影 `sx/sy` 加在 `RendererProjection` 上
  （`PhysicsCanvas`），其他领域渲染器不受影响。
- **开关/滑片画布直接操作**（本轮）：`ComponentControlChannel`
  （`renderer-registry.tsx`）与拖拽通道并列，经 `PhysicsCanvas` 转发；
  运行时四方法 `setSwitchState`/`previewSliderPosition`/`commitSliderPosition`/
  `cancelSliderPosition`（`circuit-workspace-runtime.ts`）。手势状态机
  在 `circuit-renderer.tsx`：按下滑变滑块柱（按 `sliderRail` 实测几何
  判定）直接推，不按整件拖；开关 <3px 释放为拨动、过阈值为位移；
  `pointercancel` 走 `cancelSliderPosition` 回弹。滑块预览只画不重放、
  在 t=0 按抓取位求解（`sliderPositionAt` 恒等式），表盘与标注实时跟手；
  松手一条 `SetSliderPosition` 命令进版本。键盘：`data-control="switch-*"`
  （role=switch，Enter/Space）与 `data-control="slider-*"`（role=slider，
  方向键 ±5%、Home/End）。QuestionSpace 不挂该通道，题面画布保持只读。
- **力学器材精灵接入**（本轮，C1–C3）：`mechanics-parts3d-catalog.ts`
  新增，锚点取自 `parts3d/mechanics/manifest.json` 实测值——`anchorLine`
  （plank 顶面线段）、`anchorPoint`（block/cart/weight-hook 底部接触点）、
  `radius`+圆心（ball）。`primitives.tsx` 的 `Body` 按 kind 选精灵：
  球心锚定用中心对齐，其余用底部接触点压到场景几何上；`Incline` 用
  `plank` 锚线旋转到斜边（正交侧视旋转是精确变换），楔形支撑与地面
  排线保留代码绘制；矢量/轨迹/尺寸线/打点全部不动。无映射或
  `<image>` onError 时回退原矢量画法。`verify-parts3d.py` 已合并
  mechanics manifest（`mechanics/` 前缀），24 件全过；parity 测试
  同步按前缀识别力学条目。
- **实验结构化元数据**（P0，本轮）：新增 `physics/experiment-summaries.ts`——
  44 个模板逐个声明 `coreModel/parameters/feedback/errors` + 人教版教材映射
  - 搜索别名 + 分步指南，与 `experiment-templates.ts` 分离映射（照
    `experiment-artwork.tsx` 先例，模板文件零侵入）。parity 测试
    `experiment-summaries.client.spec.ts`（7 用例）看守：每模板必有且四条非空，
    已实现模板必有教材映射与指南，别名非空且条内唯一。工作台数据面板新增
    「要点」页签渲染四件套卡片 + 教材映射；实验中心搜索纳入别名。
- **实验工具**（P1，本轮）：工具栏「实验指南」模态
  （`ExperimentGuidePanel.tsx`，分步 + 预期现象 + 教材映射）；数据面板头
  「数据导出」按钮把当前数据表写成 CSV 下载。
- **MathText → KaTeX**（P2 定案，本轮）：用户拍板换渲染方式后，
  `MathText.tsx` 改为 `toTexExpression` 归一化（`math-symbol.ts`：unicode
  方言→TeX，`½`→`\tfrac`、`ᵢ`→`_{i}`、`√`→`\sqrt`、希腊字母、全角标点、
  CJK→`\text{}`、≥4 字母散文词→`\mathrm{}`）+ `renderTexToReact`
  （`dsh-client-ui-primitives` 新导出，KaTeX 排版）。`katex.min.css` 与
  字体作为静态资产挂在 `/physicsos/katex/`（组件挂载时注入 `<link>` 一次）。
  SVG 侧 `MathLabel` 仍走 `parseMathSymbol`——画布标签无分式需求。
- **P3-a 力学补强批**（本轮，7 个新模板）：
  - `force-composition` 力的合成：3-4-5 自由物体，`appliedForce`+新增
    `appliedForces` 多力字段（`mechanics-scene-factory.ts`），合力 5 N 直接
    可验；**无重力场**——mg/N 力对只会互相抵消还添两个虚构箭头。
  - `concurrent-equilibrium` 共点力平衡：8 N 三力互成 120°，ΣF 严格为零。
  - `apparent-weight` 超重失重：竖直匀加速（m=60, a=2），inspector 派生
    「视重」行 N=m(g+a)=708 N，竖直加速度非零时自动出现。
  - `chase-meeting` 追及相遇：复用 collision 双体（y 车道错开 1.4 m >
    两半径和，永不碰撞），t=2 s 在 x=2 m 相遇，x–t 图交点即结论。
  - `vt-area` v–t 图像与位移：v₀=2、a=1.5 梯形面积。
  - `hooke-law` / `friction-static`：引擎无弹簧变力与静/动摩擦求解器，
    诚实标 `comingSoon`，`createScene` 抛错而非假实现。
  - **observation 层补发 custom 力**：此前 `applied` 力观测完全缺失
    （`FORCE_STYLES.applied` 是死配置），现按 `scene.forces` 逐个发布，
    visual bridge 去重编号 F₁/F₂/F₃。
  - **bridge 轨道判定收紧**：`isLinearModel→画轨道`改为
    `isHorizontalLinear`（v0y≈0 且 ay≈0）——竖直与斜向运动不再被画上
    水平轨道，车形只在真水平一维用 cart，其余用 block。

### 未完成

- `manifest.json` 的锚点来自**几何约定**（`anchorSource: "geometry-convention"`），
  不是逐件目视测量。电池/滑变/灯泡的 `axis` 已修正为 `base`（接线柱在底座/顶面，
  非左右两端）；如需更精确的接线锚点仍要逐件实测。
- `lamp-off` / `lamp-on` 尚未启用：当前视觉模型里没有独立的"灯泡"类型，耗散负载
  一律按电阻元件绘制。等场景侧有了灯泡类型再接。
- `terminal` 精灵尚无对应组件类型，未接。
- 力学精灵已接 `Body`/`Incline`；`Platform`、weight-hook 悬挂件等仍走矢量，
  其余领域（波动、感应……）未动。
- plank 精灵两端带金属卡具、略超出楔形斜边（锚线占图宽 ~92%），视觉上
  像板架在三角上而非板即斜面——C4 决策点待定是否裁端部余量。
- 直接操作目前只覆盖开关与滑变滑片；其他器材（如电表）无可操作件。

### 验证证据与已知问题

- `pnpm typecheck:web` 干净通过（需在完整 `upstream-changes.patch` 已 apply、
  上游引用图已构建的前提下）。
- `circuit.client.spec.tsx` **29/29 通过**，含 5 个精灵专项用例与 7 个拖拽
  专项（预览不改 revision、视口钉住、半格吸附、落点提交+导线重排、指针事件
  链路、亚阈值点击、pointercancel 回弹）。
- `circuit-scene-runtime.test.ts` **13/13 通过**，含
  `SetComponentPlacement` 的位移落库/脊线保留重排/非有限坐标拒绝。
- **真实浏览器验证**（Chromium + Playwright，`tests/acceptance/support.mjs`
  门禁）：串联电路 5 精灵 `<image>` 全部 200、矢量体互斥、开关断开时
  `switch-open.png` + 电流归零；变阻器模板 6 精灵 + 滑块在位；R1 真机拖拽
  中预览逐帧跟随指针、落点像素级一致、7 条导线路径全部重排、开关同样可拖；
  console/page error/失败请求/4xx5xx 四项全零。截图证据：
  `docs/reports/screenshots/parts3d-{series-lab,series-switch-open,rheostat-lab,series-r1-dragged}.png`。
- **力学精灵实机验证**（本轮）：Playwright 逐实验重载（避开单页导航态），
  斜面/平抛/匀速直线三实验 `sprite-*` `<image>` 实际加载且 href 指向
  `/physicsos/parts3d/mechanics/*.png`，plank `rotate=30` 与场景倾角一致，
  四项门禁全零。截图：
  `docs/reports/screenshots/parts3d-mechanics-{incline,projectile,cart}.png`。
- `upstream-changes.patch` 里的 `pnpm-lock.yaml` hunk 已摘除——lockfile 由
  `pnpm install` 生成（含 `engine-collision` 等 link 条目），hunk 内的
  旧清单已过时，`git apply --3way` 会在其上制造假冲突。
- 拖动落点若改变布局包围盒，提交时视口自动重 fit（画幅整体缩放）——
  属预期行为：落点在场景坐标系里是准的，只是投影缩放变了。
- 首启有两个引导弹窗（内测声明 → API key 引导），验收脚本需依次点
  `Continue` / `Configure later`（或中文 `继续` / `稍后配置`）。
- 上游 `tsc -b tsconfig.client.json` 全量图有既有报错（`@types/react` 双版本
  的 `ReactNode`/`bigint` 冲突、`numeric-audit` 严格性），与本改动无关；
  官方 `typecheck:web` 范围干净。
- `pnpm lint:web` 有报错，全部落在本次未改动的文件上，属既有问题。
- 本机验证用 `node_modules/playwright` 是手工符号链接（指向 vendor store），
  已被 `.gitignore`，勿提交。
- **P3-a 浏览器实测**（本轮）：picker 列出全部 7 个新条目；力的合成画布
  F₁/F₂/ΣF 箭头齐备、读数页签「合力 5 N」；共点力平衡三施加力箭头、无
  多余合力箭头；超重失重读数页签「视重 708 N」；追及相遇双球精灵在位；
  推导页签 MathText 分式节点 6 处实渲染；console/page/失败请求/4xx5xx
  四门全零。截图：`docs/reports/screenshots/p3a-*.png`。
- **KaTeX 浏览器实测**（本轮）：`tests/acceptance/katex-mathtext-acceptance.mjs`
  11/11——样式表/字体可达且仅注入一次、读数页签 KaTeX 节点在位、vt-area
  推导页签 `.katex .mfrac` 分式实渲染、无遗留 `.frac` 旧节点、四门零错误。
  注意：web 运行时把 `dsh-client-ui-primitives` 别名到 `src/index.ts` 打进
  `apps/web/dist`，改其导出后必须 `vite build` 重建 web 壳并重载页面。
- **工作台布局塌陷已修**（本轮）：根因是并行会话把 `conversation.surface`
  移入 `scrollBody` 并加 `position:relative`——`.cover`（`absolute;
inset:0`）改为相对 scrollBody 定位后，`[data-conversation-scroll] .cover`
  的 `padding-bottom: calc(--dsh-composer-height + 12px)` 生效；无会话
  直接开实验室时 composer seat 装的是 ~956px 居中 hero，padding 把
  cover 内容盒吃到 ~10px。修复：`min(--dsh-composer-height, 220px)` 封顶，
  只清出停靠输入框的真实高度。实测 `.body` 0→568px、画布 svg 450px。
- **播放契约统一 + 动画优化**（本轮）：
  - **重播死按钮修复**：`setRunning(true)` 在 `currentTime >= total` 时归零
    重播，补齐 mechanics/collision/composite/electric/circuit 五个 runtime
    （wave/lever/acoustics/fluid/thermal/induction 本来就有）。
  - **周期模型循环**：mechanics 的 `uniform_linear_motion`/`inclined_plane`/
    `newton_second_law` 到窗口边缘取模回绕（名义窗口无物理终点，演示循环）；
    `projectile_motion` 停在落地、`uniformly_accelerated_motion` 停在末态
    （填满的 v–t 面积即读数）。`CYCLIC_MODELS` 常量在
    `mechanics-runtime-bridge.ts`，注释与实现已对齐。
  - **播完态 UI**：`ended`（total>0 且 !running 且 time>=total）→ 工具栏
    按钮文案 `lab.replay` 重播 + transport 换刷新图标/aria。
  - **键盘**：document 级 keydown——Space 播放暂停、←/→ 步进 ±10%、Home
    复位。可编辑元素（input/textarea/select/contentEditable）全让；
    按钮/链接只让 Space/Enter（原生激活），方向键照常步进。
  - **数据表当前行**：行是均匀时间采样，`round(time/total*(rows-1))`
    得播放头所在行，`.dataRowCurrent` 用 `--physics-highlight`（同图表
    游标语义色）淡染。
  - **场景切换淡入**：`.canvas` 24ms `canvasIn` fade，section 按
    `domain:title` 当 key——只在切实验时重挂，改参数不重放；
    prefers-reduced-motion 兜底。
  - 验证：`mechanics.client.spec.tsx` 播放契约 4 例（循环/落地停+重播/
    匀加速停+重播/碰撞重播）、`workspace-presentation` 键盘+重播 2 例；
    全量 610/610；浏览器 `tests/acceptance/playback-acceptance.mjs`
    12/12（键盘端到端、重播、运行态、数据行高亮、四门零错误）。
    截图：`docs/reports/screenshots/animation-running-state.png`。

---

## 7. 宣传官网（新增）

静态站点在 overlay 的 public 树里，**无构建步骤**：

```
overlays/harness/files/apps/web/public/physicsos/website/
```

本地预览与素材再生成：

```bash
cd overlays/harness/files/apps/web/public/physicsos/website
python3 -m http.server 4192 --bind 127.0.0.1

node scripts/design/website-shots.mjs     # 需先 pnpm dev（3080）
```

hero 背景是 `lib/flow-field.js` 里的 WebGL2 流场着色器，做法与 DeepSeek Harness
官网 hero 同类（深色站 + 发光蓝场），参数按 PhysicsOS 重调。真正让它发光的是
着色器末尾的 bloom / 光源 / 暗角三步，不是噪声本身；调色板亮端必须接近白。
细节与降级行为见该目录 `README.md`。

**一个教训**：本轮曾只读源码不渲染参考站，把参考站误判为"白色正文"，
做出来差距很大。改视觉前先把参考页截出来看。

**页面上的数字要跟产品一起核对**：hero 写「43 个可运行实验模板 / 80 道内置题」，
依据是实验库实际标题与实际题目数——实验模板共 45 个，回旋加速器与弦驻波
标记「即将支持」故不计入。改产品后重跑截图脚本，图片会更新，数字要人工改。

---

## 8. 自由搭建电路（已提交）

学生可以自己选器材、自己接线，电路由现有 DC 引擎真实求解。入口两处：
实验中心「自由搭建电路」卡片，以及电学台（`surface.openBuilder`）。

- **装配模型**：`ui-physicsos/src/client/physics/circuit-builder.ts`。
  草稿 = 元件 + 整数网号 + 摆放；增删/移动/旋转/改参/并网/拆网全是纯函数，
  `draftToScene` 投影成 `createCircuitScene` 的入参，`draftFromScene` 反向读回。
  **场景是唯一真源**，草稿只是它的一个视图，不要在别处再存一份电路。
- **结构提交不走命令词表**：`SceneCommandType` 是冻结的「改参数」集合，没有 AddComponent/Connect。
  结构改动走运行时**原地换 `SceneRuntime`**（`applyDraftEdit`），**不要**改用 `surface.open`——
  `LabWorkspace` 的 `runtimeKey` 含 `scene.revision` 且当作 React `key`，那样每次编辑都会重挂工作区。
- **解不出来也要画**：`PhysicsWorkspace` 在 `status==='failed'` 时原本整块替换画布；装配模式
  （`buildMode`）下改为保留原理图、无读数，引擎原因内联显示。`RuntimeErrorView.condition` 把引擎的
  条件名带出来，由 shell 映射到 `lab.condition.*` 的 zh/en 文案。
- **接线**：画布上每个接线柱是可聚焦目标（`data-terminal`）。按住拖到另一个接线柱完成接线
  （鼠标走 window release，触摸/笔走 pointer capture）；键盘 Enter/Space 也能点选接线。
- **器材只有 6 种**（电源/开关/定值电阻/滑动变阻器/电流表/电压表）——即引擎建模的那 6 种。
  元件 id 沿用 AI 助教别名约定（`bat`/`sw`/`am`/`vm`/`rv`/`r0…`），
  换成 `c1`/`c2` 会让「指一下电流表」失效（`physics-agent.ts` 的别名表）。
- **验证**：`tests/circuit-builder.client.spec.tsx`（32 例）；
  真机脚本 `scripts/design/qa-build.mjs`（放一个电阻拖成并联，主电流 0.6 A → 1.2 A）。
  Playwright 浏览器缓存可能与本仓 pin 的版本不符，用 `PHYSICSOS_CHROMIUM=<chrome 可执行文件>` 指过去。

已知未做：画布上拖拽**放置**新元件（拖拽**移动**已有元件早就有了）；自建电路命名保存/另存为模板
（目前只随「最近空间」按固定 sceneId 恢复一份）；手机尺寸未单独验收。

---

## 9. 下一步建议顺序

1. 用真实截图逐件校准非轴向器材的接线锚点，把 `anchorSource` 从几何约定换成
   实测值（当前电池/电表/开关的视觉锚点已是 `base` 语义，精度可再提）。
2. 视需要给场景增加灯泡类型，启用 `lamp-off` / `lamp-on`。
3. 把同一套流水线推广到其他领域——每添一个领域要先定该领域的器材清单与相机约定。

---

## 10. 解题入口收口：试题空间下线，解题卡进会话（已提交）

试题空间（QuestionWorkspace，~1900 行）整体下线，能力并入会话与学习记录，
**流水线自始至终只有一条**：`processQuestion`（question-core 确定性解析 →
引擎求解 → 校验 → 建场景），主会话与旧试题空间共用，不新增第二条解题路径。

- **`physics/scene` 事件带 `solve` 载荷**（`tool-physicsos/types.ts`
  `PhysicsSceneSolveSummary`）：knowns/targets/answers/steps/verification/
  issues/goldenQuestionId。`physics_solve_question` 在 `cause:'solved'`
  快照上发布；command 修订的快照不带 solve，`scene-chat-node` 折叠时
  **保留**旧 solve（per-scene 与 per-turn 两层 fold 都保）。
- **解题卡 = `SceneChatCard` 内的 `SolveSection`**：已知量 chips（点击点亮
  画布对应元件，`question-highlights.ts` 从旧 QW 提取成共享模块，纯视觉
  `setHighlight`，不动场景）、求解目标、答案、解题步骤、验证徽章、题面问题；
  golden 题命中题库时内嵌 `LabSelfCheckCard`（与实验室自测同一组件、同一
  `recordAttempt` 记录路径）。
- **`physics_solve_question` 新增可选 `questionId` 参数**：练习链路把题库 id
  原样交接——模型转述题干不等于逐字命中，`questionId` 命中即按题库原文求解，
  `goldenQuestionId` 才不断链（runtime `solveQuestion(text, questionId?)`）。
- **练习闭环迁移**：`practiceQuestion(questionId)`（`index.ts`）把题库题干
  - questionId 提示词塞进当前会话（`submitToTutor`），成功即回对话面等卡片
    流入；学习记录页顶置「题库练习」列表；错题行分流：实验 attempt →
    `重做实验` 深链回同模板 Lab；题目 attempt → `重新练习` 走 practiceQuestion。
- **面收敛**：`openSurface` 只剩 `home | lab | record`；侧栏剩 首页/物理实验室；
  学习记录入口在 sidebar footer；首页「输入试题」门户卡指向 record。
- **验收**：`tests/acceptance/learning-acceptance.mjs` CASE C-G 全绿——
  真实模型链路跑通「题库练习 → tutor 调 physics_solve_question → 解题卡
  （已知量/步骤/验证/自测 + 可播画布）流入会话」。

**布局塌陷教训**：并行会话把 `conversation.surface` 挪进 `scrollBody` 后，
各 surface 根的 `padding-bottom: calc(var(--dsh-composer-height) + …)` 会吃到
hero 态的 ~956px 变量——四处（LabWorkspace/ExperimentPicker/LabEmptyState/
LearningRecordWorkspace）全部改成 `min(…, 220px)` 封顶，只清停靠输入框的真实高度。

---

## 11. 弹簧/单摆/摩擦模型 + 力学器材精灵（已提交）

对标 liziwuli 后按"单位引擎解锁实验数"排的第一批：四个新解析模型
（`spring_statics`/`spring_oscillator`/`simple_pendulum`/`horizontal_friction`）

- 5 个模板（hooke-law、friction-static 由占位做实；spring-oscillator、
  simple-pendulum、friction-mu 新增），全链走
  `PhysicsScene → Engine → Verifier → Observation → PhysicsCanvas`。

* **场景事实走约束/观察量**：弹簧 k/L₀/anchor/axis 挂在 `spring` 约束
  （`spring-1`），摆长/pivot 挂在 `rope` 约束（`rope-1`），摩擦台 μs 在
  body 材质、ramp/cap 在 `obs-friction-surface` 几何观察量。新场景命令
  `SetSpringConstant`/`SetPendulumLength`/`SetStaticFrictionCoefficient`
  （`agent-tools/scene-commands.ts` 同步登记）。
* **观察层修正**：竖直悬挂体不再发幻影 `normal` 箭头（仅竖向 connector
  时抑制；水平振子的滑轨支持力保留）。`spring_force` 是矢量——
  inspector 派生行取模长显示。
* **读数跟播放头**：`buildSnapshot` 优先取当前帧 `state.derived`，仿真级
  聚合兜底——拉力/摩擦力这类随时间量不再钉死在末态。
* **高亮接真实元素 id**：`spring`/`pendulum` 视觉带场景约束 id，
  inspector 的 highlights 全部指向渲染出的元素。
* **statics 回稳**：改 k/m/g 时除参数命令外再发一次 `SetBodyPosition`
  把物块落回新平衡点——静止模型描述的是稳定后的状态，两条命令两个事件，
  审计链诚实。

### 素材决策（imageapi.top / gpt-image-2.5-sunburst）

走既有 `generate-mechanics-parts.mjs` 管线（侧视正交 + 透明底 + 1m 基准）。
本批新增两件**静态器材**：

| id              | 用途                 | 锚点（实测 alpha 轮廓）                                  |
| --------------- | -------------------- | -------------------------------------------------------- |
| `spring-scale`  | 摩擦台拉力仪器本体   | 钩尖 (0.9613, 0.51)，`flip` 镜像后贴物块受力面，逐帧跟随 |
| `support-clamp` | hooke-law/单摆悬挂点 | 挂环内底 (0.326, 0.91)，杆部伸出画外                     |

- **渲染路径**：`SceneVisualModel.apparatus` 通用精灵槽 +
  `Apparatus` 原语（加载失败静默退回参数化台架）。动态几何
  （弹簧圈长度、摆线角度）仍是参数化 SVG——长度方向就是物理量，
  不能用位图。
- **没生成的**：弹簧圈、摆球（已有 `ball` 精灵直接复用）、测力计
  刻度盘（读数由派生行承担，位图刻度是死数字）。
- **注意**：dev server 服务 `apps/web/dist`（构建产物），新增 PNG 要
  同步进 dist 或重建 web 才生效——`public/` 下的新文件不会自动上线。
- 锚点已写入 manifest（`anchorSource: alpha-silhouette-measurement`），
  catalog parity 测试（`mechanics-parts3d.client.spec.tsx`）值守。

### 验收

- 单测：ui-physicsos 619/619（含 3 个新精灵用例 + parity 锚点核对）；
  engine/observation/scene 各包全绿。
- 浏览器验收 `mechanics-springs-acceptance.mjs` A–E 全绿（含精灵
  DOM 断言），console/network 门禁零错误。

### 第二批器材（量角器 / 导轨 / 刻度尺）+ 物块换装

| id               | 用途                           | 锚点                                                              |
| ---------------- | ------------------------------ | ----------------------------------------------------------------- |
| `protractor`     | 单摆悬点后方量角盘（摆角可读） | 直径边中点 (0.499, 0.129)，正对盘心轴钉；生成图带底座，已裁只留盘 |
| `track-rail`     | 一切水平一维场景的承载导轨     | 轨顶面中点 (0.5, 0.388)；`width` 字段按轨道跨度拉伸               |
| `ruler-vertical` | 胡克台伸长量读数尺             | 尺顶铜箍中点 (0.49, 0.047)                                        |

- `ApparatusSpriteVisual.width`：显式场景宽度（拉伸用），缺省仍按
  aspect 自适应；`track-rail` 靠它铺满 `trackGround` 跨度。
- `BodyVisual.kind` 新增 `'weight-hook'`：胡克台挂**钩码**（教科书画法），
  矢量兜底走 block 分支；弹簧振子物块换 `cart`（气垫导轨滑块），
  水平摩擦保持 `block`（木块）。
- 渲染顺序：apparatus 画在 spring/pendulum rig **之前**——量角器盘在
  摆线后方、导轨在物块下方、夹具环包住弹簧顶节。
- **坑**：`generate-mechanics-parts.mjs` 的过滤参数是裸位置参数
  （`node … protractor track-rail`），`--only=x` 会被当成 flag 滤掉
  导致**全量重生成**覆盖已校好的精灵。重出旧件必须单独跑后处理
  重新实测锚点；本批误触发后已从 vendor 回滚旧 PNG。
- 验收：ui-physicsos 622/622（+3 用例：量角器/刻度尺锚点、导轨跨度、
  钩码/小车换装）；浏览器 A–E 全绿，新增断言 rulers/protractors/
  rails/weightHooks/cartSprites 计数。

### 第三批：画布图元精修 + 电路导线圆角 + 选择器 hover

电路精灵（电池/电阻/开关/电表/灯泡）早已接入，本批补的是剩余视觉欠账：

- **`wirePath`（circuit-renderer.tsx）**：`M…L…` 硬折线改为 Q 段圆角
  （`WIRE_BEND_PX` 上限，两侧线段各截半取最小），导体线缆化；
  预览导线、电荷珠路径同走此函数，电气端点不变。
- **`SpringCoil` 双股螺旋**：L 折线锯齿 → 正反相位双正弦股（前股实线
  - 背股透明感），螺旋景深；长度仍随场景坐标逐帧参数化。
- **力箭头加重**：stroke 加宽 + drop-shadow，与线缆同族质感。
- **实验选择器 hover**：卡片描边着色/抬升/阴影过渡，播放键实心化；
  `focus-visible` 描边保留；`prefers-reduced-motion` 下全部过渡关闭。
- 验收：电路 acceptance 全绿（断言已改为 sprite 计数，修了一处
  检查器 tab 时序）；力学 acceptance 回归全绿；截图目检：
  导线圆角、螺旋弹簧、hover 抬升均生效。
- lint：本批文件零错误（`no-non-null-assertion` 禁 `!`——数组索引
  改显式 `=== undefined` 收窄）。

### 卡片配图与播放键修正（用户反馈）

- 卡片配图 `object-fit: contain → cover`（仅栅格 img）：生成的方形图版在
  16:10 画板里不再左右留边；inline SVG 舞台仍走 contain 保完整器材。
- `entryPlay` 播放键从 `.art` 内绝对定位挪到 `.tagColumn` 行尾
  （`margin-left:auto`）——不再遮挡配图右下角；hover 实心化规则不变。
- 实测 picker 滚动链正常（`.panel` overflow:auto，5601/628 滚到底），
  「下面看不全」实为播放键压图 + 配图留边的观感问题。

### 画布标注冲突修正（用户反馈「文字数据重叠」）

- `tickLabelAvoid` 扩展用于力学：发射点贴 y 轴时（|x| < 0.45·majorGrid），
  其行附近 [y−0.2Δ, y+0.6Δ] 的 y 刻度数字消隐（刻度线保留）——`起点`
  标签不再和 `50` 刻度叠印。比挪标签更稳：标签远离点位就读不出归属。
- `地面` 表面标签从右端移到左端下方：右端本就是 `x/m` 轴名 + 标尺的角落。
- `y/m` 轴名从左侧（刻度同侧，撞顶部刻度）移到轴线右侧 start 锚定，
  并向右边界内钳制（全负 x 场景防溢出）。
- `.surfaceLabel` 补 canvas-bg 光晕描边（其余标签类早已有）。
- DOM 级重叠检测（全 text bbox 两两比对）：密场景（h=45m 台+θ）与
  平地斜抛均 0 冲突；622/622 回归、改动面 lint 0。

### 实验面与会话内容隔离（用户反馈「选实验还显示别会话内容」）

Lab 注册在 `conversation.surface` 槽位，是盖在当前会话上的覆盖层；外壳
`ConversationRoot` 的 session header（标题/面包屑/视图 tab）、会话视图与
sticky composer 都在覆盖层之外——选「非弹性碰撞」时旧会话「斜抛运动…」
标题仍露在顶部。

修法（`LabWorkspace.module.css`，纯 CSS、零跨包代码依赖）：当
`[data-slot='conversation.surface']` 内出现 `[data-physicsos-surface]` 时
（`:has()` 读 DOM 真实状态，surface 'home' 返回 null 即自动解除），隐藏：

- `[data-slot='conversation.session.header'] > *`——session 标题区
- `[data-slot='conversation.session'] > *`——被盖住的转录/视图
- `[data-composer-seat]`——composer 输入条

关键坑位：slot 锚点 div 带**内联** `display: contents`（scoped-slots.tsx
`ANCHOR_STYLE`，文档化的「dynamic styles 定位缝」契约），样式表只能藏
其子元素不能藏锚点本身；composer seat 无内联样式可直接 `display:none`。

**为什么不保留 composer**：seat 是 `position:sticky;bottom:0`，其贴底
依赖前置内容把自然位推过视口底——转录隐藏后 seat 自然位跳到顶部，
遮挡 lab 工具栏（实测拦截「返回对话」点击）。且 lab 自带 AI 助教抽屉，
辅导通道不丢。

验证（真实会话「斜抛运动求最大高度与飞行时间」）：开 lab 前 header=block/
session=flex/seat=flex；开 lab 后三者 none、无陈旧标题、截图整版干净；
「返回对话」后全部恢复、surface 卸载；门禁零错误。覆盖 picker/lab/record/
paper 全部 surface 形态（均带 `data-physicsos-surface`）。

### 验收脚本陈旧契约修复（mechanics-acceptance.mjs）

与本次改动无关的存量测试债，为拿到干净回归信号顺手修了：

- `derivedRows`：行容器 `.derived` 的值子节点类名已是 `derivedReading`
  （脚本还找旧的 `derivedValue`），名称内嵌 MathText 需剔除 math 节点
  （否则 key 带 "RRR" 尾巴）。
- 检查器 tab 互斥（属性=参数输入、读数=派生行），读写序列每次都要先选
  tab；revision bump 触发 runtimeKey 重挂载，inspector 回落 属性。
- CASE H：agent 命令后右栏被 AgentDrawer 占据，需先 Esc 再读检查器。
- CASE C/D/F：整个段落依赖已退休的「试题空间」入口（练习已迁入辅导会话），
  包 `if (entry exists)` 守卫——入口缺席时大声 SKIP 而非硬崩；按新练习流
  重写是独立任务（learning-acceptance CASE G 已覆盖辅导链路端到端）。
- 结果：E/A/B/G/H + 响应式 + 浏览器门禁全绿。

**composer 净空 padding 清除**（用户反馈「下方留白」）：四个 surface
（picker/LabEmptyState/record/lab cover）曾各留 ~180-250px padding-bottom
给 sticky composer 让位；composer 隐藏后这些净空全成死白。已全部删除
（`ExperimentPicker`/`LabEmptyState`/`LearningRecordWorkspace`/`LabWorkspace`
的 `[data-conversation-scroll]` 覆盖块）——实测 picker 死白 250px→24px
（仅剩 root 对称 padding）、lab 画布吃下全部高度。隔离规则回归全绿。

### 浮力物块直接拖拽（用户反馈「物体下去页面无变化」）

播放/单步/拖时间轴的动画链路本就健康（探针实测 blockY 195→239→301、
读数随时间走）——用户真正想要的交互是**像粒子先生一样直接抓住物块
往下按**，画布此前零拖拽响应。

实现：复用 `ComponentDragChannel`（电路拖拽同款通道，workspace 检测到
runtime 实现三方法即自动接线）。`FluidWorkspaceRuntime` 实现
`previewComponentPlacement`/`commitComponentPlacement`/`cancelComponentPlacement`
——拖块即沿下放路径刷浸入时钟：指针 scene-y → 底面深度 → `t=depth/lowerRate`
→ `seek()`。读数/力箭头/V_排/相位全部来自引擎真实状态，不是 UI 假动画。
`dragBaseline` 记录抓取起点（time+running），cancel 原样弹回；越界由
seek 天然钳到 [0, settleTime]（漂浮场景钳在平衡深度，与松绳模型一致）。

`fluid-renderer.tsx` 物块 `<g>` 接 pointerdown/move/up/cancel（电路同款
`sceneAt` 反投影 + 3px 拖拽阈值 + `setPointerCapture` jsdom 守卫），
`.fluidDraggable`/`.fluidDragging` 光标态。

**关键坑**：受力箭头（Vectors）画在物块上层，G/F_示 箭头正好穿过块体
中心——按下时 `elementFromPoint` 命中 `line.vectorLine`，块组永远收不到
pointerdown。修法：Vectors 原语根 `<g>` 加 `pointerEvents="none"`
（矢量标注本就只读，全域禁用命中，顺带防住后续域接入拖拽时同款坑）。

验证：单测 623/623（新增拖拽用例：非块组件不响应、中心贴液面=半浸、
过深钳 settle、cancel 回弹、commit 落位）；浏览器实测双向拖拽
（t=0→4.33s 已浸没→拖回 t=0 未入水，光标 grab/grabbing 切换正确）；
力学验收回归全绿、门禁零错误、typecheck 干净、overlay 已 capture。

### 检查器默认视图「无变化」修复（浮力实验用户反馈续）

用户二次反馈「物体下去页面无变化」。排查结论：播放/单步/时间轴/拖拽
四条交互链在当前 bundle 全部健康（实测 t 前进、块体移动、读数跟随），
真缺陷是**检查器默认「属性」tab 视觉死区**——参数是静态输入，「派生量」
section 只渲染空头标题（其 derived 行只在「读数」tab 下出现），用户盯
着默认面板时数值确实一动不动。

修复（`workspace-parts.tsx` InspectorTabs）：属性 tab 现在为每个 section
在字段下方同屏渲染 `SectionDerived` 读数行——拖物块/播放时派生量实时
跳动（浸入状态 未入水→已完全浸没 实测切换）；全空 section 才跳过标题。
顺带覆盖所有域：力学属性 tab 默认即见 飞行时间/射程/最大高度 活读数，
参数仍居上不破坏「先输入后读数」的既有分层。

浮力物块拖拽补可发现性：块组内嵌 SVG `<title>`（悬停提示「拖动物块改变
浸入深度，读数实时跟随」），grab/grabbing 光标态上轮已就位。

验证：单测 623/623、typecheck 干净、属性 tab 实测派生量填充且随拖拽更新、
力学跨域布局正常、门禁零错误、overlay 已 capture。

### 画布读数卡片可拖拽（遮挡问题修复）

用户反馈左上读数卡片（声学「回声读数」等）会挡住画面。根因：
`PhysicsCanvas` 把读数卡硬编码在 `(PAD.left+8, PAD.top+8)`，无避让。

修复（`PhysicsCanvas.tsx` + `PhysicsCanvas.module.css`）：卡片改为可拖拽
画布 chrome——本地 `readoutPos` 状态存 viewBox 坐标（非物理状态，不走
场景命令）；`<g>` 挂 pointer 手势（viewPoint 反投影 client→viewBox、
2px 拖拽阈值、pointer capture 带 jsdom 守卫），grab/grabbing 光标 +
`<title>` 悬停提示。双重钳制：拖动时 setReadoutPos 钳在画布内，渲染期
再钳一次（读数变宽/画布变窄后停放位置自动收回）。隔离：拖拽中
handleMove 早退不追 hover；`suppressClickRef` 吞掉卡片按下-抬起派生的
click，永不误触轨迹 seek；pointerdown/move stopPropagation 防外泄。

验证：单测 626/626（新 spec：阈值不动/拖动落位/远角钳制/release click
不 seek/异指针与 cancel 忽略/无布局 rect 不炸）；浏览器实测拖拽移动、
松手保持、越界钳回画布内，cursor:grab 生效，门禁零错误；typecheck
干净、overlay 已 capture（3 文件逐字节同步）。

### 学习记录页实质化（用户反馈「没有实现」）

表面已实现但体感空壳：只列错题（0 条时全空）、答对记录无处可见、
知识点面板零数据时无空态、80 题 chip 无分组糊成墙。

修复（`LearningRecordWorkspace.tsx` + `.module.css` + `locales.ts` +
question-core `golden-questions.ts`/`index.ts`）：

- **最近自测 feed**：「最近错题」扩成统一自测账本——全部 attempt
  （答对+答错）按时间倒序列出，答对挂绿底「答对」徽章
  （`data-result="correct"`）、答错挂错误类型徽章，保留题面/你的回答/
  重新练习/重做实验按钮。核心诉求落地：记录页终于能看到「记录」。
- **知识点掌握空态**：无已练叶子节点时显示引导文案
  「完成自测后，这里会按知识点显示你的掌握情况」，不再裸空白盒。
- **题库按 domain 分组**：question-core 把 id 前缀推断抽成
  `goldenQuestionDomain()`（factory 复用同一份），题库分 8 组
  （磁场与洛伦兹力/电场/复合场/力学/电路/几何光学/电磁感应/振动与波）
  带小标题，不再是一面 chip 墙。

验证：learning spec 26/26（新增：答对行进账本带绿徽章/孤儿题空态文案/
8 组标题齐全）、ui-physicsos 629/629、question-core 412/412、两包
typecheck 干净、浏览器实测分组/徽章/掌握度柱全渲染、门禁零错误、
overlay 4 文件逐字节同步。

### Auth V1 收口：组合测试 + 两个真 bug 修复 + 素材上线

**REAL Loader 组合测试**（`auth-host/tests/composition.spec.ts`，包规约要求）：
cordis.yml 起 webserver(port 0) + storage + storage-json(tmpdir) +
storage-domain(backend json) + auth-host 全链，真 HTTP 打
`/physicsos/auth`：schools 200 → register 201+HttpOnly cookie →
me 200（schoolId/username/role=STUDENT）→ logout 200 → me 401。
`loadYaml` 用 `(root)=>lines` 回调拿到 mkdtemp 后的路径再渲染 yaml。

**顺手修出两个真 bug**：

- `invariant.ts`：伴生插件 fiber 级 `inject=['invariants','storageDomain']`
  会被测试基建在组合就绪前挂载 → `storageDomain` 未提供即失败。
  按 message-feedback 范式改为 fiber inject 仅 `invariants`，
  `storageDomain` 挪到 `InvariantInstaller.inject`（检查器子 fiber
  等待服务）——Object.assign 字面量丢上下文类型，参数需显式标注。
  另修同文件跨行 `as` 断言：tsc 接受但 vitest 的 oxc transform
  报 parse error，收进单行。
- `index.ts`：`ctx.effect(async function*)` 的完成 Promise 只在卸载时
  await——fiber 激活时路由可能尚未注册，生产启动存在 404 窗口期。
  改 `async apply` + `await ctx.effect`（directory-picker-auto 范式），
  激活即含路由注册，组合测试从 404 变 200。

**密码框对齐**（用户反馈）：`.input` 无 `box-sizing`，
`.passwordWrap .input{width:100%}` 按 content-box 渲染 =
100%+58px padding。加 `border-box`（`.input` + SchoolPicker `.search`），
像素实测密码框右缘 847→789 与账号/学校/按钮完全对齐。

**素材前缀冲突**：`frontend-static` 只认领未匹配路径，
`/physicsos/auth/horizon.png` 被 auth 前缀路由吃掉返回 JSON 404。
素材迁出 API 前缀：`public/physicsos/login/horizon.png`，CSS 同步改。
备选图与 manifest 移出 public → `apps/web/design-assets/`（新增
OVERLAY_PATHS 条目，apply/capture 双向往返，dist 不带冗余素材）。

**library-hero.png**：LibraryWorkspace 引用的资源库卡片图已生成
（透明底，轨道+书本+烧瓶，与 horizon 同语言）→
`public/physicsos/library/library-hero.png`，双端口实测 200。
新网关 `image.haqiuhaqiu.xyz` 需专用 key：旧 key 报 INVALID_API_KEY，
用户提供的新 key 已验证 `/v1/models` 200 + 出图正常，`.env` 已更新。

**验证**：auth-host 18/18（17 route + 1 REAL composition）、
auth.client 18/18、tsc -b 干净、client lib + web dist 已重建、
浏览器实测 gate 三视图/对齐/背景全渲染。已知遗留（用户 WIP，
未动）：`library.*` en 文案缺口致 locales 对齐 spec 红、
`LabWorkspace`/`LibraryWorkspace` 若干 typecheck 错。

### 出卷专区工作台重设计（用户反馈「UI 布局需要重新打造」）

`PaperWorkspace.tsx` + `.module.css` 改版，全部 API 流程不变：

- **头部**：40px 高 hero → 紧凑工具栏（标题+一行副标+复核人），
  hero 图降为右侧淡背景。
- **导航**：四枚胶囊 tab → 流程步骤条（1 新建试卷 → 2 草稿与审核
  → 3 已定稿，下划线激活态+计数徽章），「真题资料库」独立右置。
- **新建试卷**：单列表单 → 三步向导（选择试卷结构 / 划定考试范围 /
  设定难度配比，编号徽章 stepCard）+ 右侧粘性「试卷摘要」卡
  （结构/满分/卷型/章节数/难度目标+CTA）。难度配比改 MixBar
  三段比例条（基础绿/中档蓝/提高黄）。
- **任务卡**：标题取 `document.title`（回退卷型+blueprintId），
  状态徽章右上、meta 行加版本号+日期、`review` 态显示
  「n/N 题已审」进度条。
- **任务详情**：新增 StageRail 阶段轨道（细目表→AI 起草→自动检查
  →逐题审核→定稿导出，完成打勾/当前高亮/失败红）。
- **资料库表单**：纯 placeholder 网格 → 标签化字段（`.fld` 小标题+
  `.fldWide` 通栏），录入原卷/逐题考点/CSV 三卡同改。

新 spec `tests/paper-workspace.client.spec.tsx`（4 例：步骤条/
向导+摘要/任务卡进度/StageRail）。663/663 绿、typecheck 干净、
浏览器四 tab 实测全渲染、console 零错误。**注意**：改完必须
`node scripts/overlay/harness-overlay.mjs capture`——
`apply` 会把 vendor 回滚成 overlay 旧版（本轮被回滚两次，已 capture）。

### 管理后台 V1：申请 → 审批 → 建校 → 校管理员 全链路

后端 `auth-host`（不新开包，同 domain 唯一写权限）：

- `domain.ts`：新增 `school_requests`/`admin_audit` 两张表 +
  `schoolRequestWire`/`approveRequestWire`/`rejectRequestWire`/
  `createSchoolWire`/`schoolStatusWire`/`createUserWire`/`userStatusWire`/
  `resetPasswordWire` wire schema。`createUserWire.role` 枚举不含
  `SUPER_ADMIN`——线上根本造不出超管。
- `service.ts`：`AdminActor` + `ROLE_RANK` 角色矩阵 + `manageRank`。
  审批建校+种子校管理员、手动建校、学校启停、用户列表（校管理员
  schoolId 过滤强制收窄到自己租户）、建号（校管理员省略 schoolId
  落自己租户；填了别的租户 403）、禁用（连带吊销全部 session；
  self-target 先于角色检查返回 400）、重置密码（连带吊销）、
  会话吊销、审计追加/租户收窄读取。
- `routes.ts`：`POST /auth/school-requests`（匿名允许，独立
  `applyAttemptLimit` IP 桶——不挤占登录额度）+
  `/physicsos/admin` 前缀全量管理路由（cookie 会话解析 →
  AdminActor → 服务层强制角色/租户）。
- `index.ts` + `bootstrap.ts`：`Config.bootstrapAdmins` 幂等种子
  （不存在才建）。`cordis.patch.yml` 用 `!!js` 读
  `PHYSICSOS_ADMIN_PASSWORD` 种 `PHYSICSOS-OPEN:admin` SUPER_ADMIN；
  env 缺失则不种。

前端 `ui-physicsos`：

- `auth-api.ts`：`submitSchoolRequest` + `createAdminApi()`
  （`/physicsos/admin` 客户端，user 路径 `schoolId:username` 编码）。
- `AdminWorkspace.tsx` 新 surface：角色塑形 tab——超管见
  申请/学校/用户/审计，校管理员只见 用户/审计（本租户）；
  非管理员渲染 forbidden 文案（菜单隐藏只是便利，边界在 host）。
- `SchoolPicker` 空态接申请加入表单（校名用搜索词预填，
  联系方式必填，busy/done/error 三态）。
- `SidebarFooter` 账户菜单加「管理后台」入口（仅
  SCHOOL_ADMIN/SUPER_ADMIN）；`surface-store` 加 `'admin'`；
  `LabWorkspace` 分发 admin surface；`index.ts` 注入
  `adminApi`/`openAdmin`/`hooks.auth`。

**本轮修的两个真 bug**：

- `cookies.ts`：非记住会话发 `Max-Age=0` = 浏览器立即过期 →
  非「记住此设备」登录在真浏览器里永远登不进（curl 测不出，
  此前能登是因为勾了 remember 拿到 30 天 cookie）。修为
  `maxAgeSeconds<=0` 时省略 Max-Age 属性（会话 cookie 语义），
  auth.spec 补对称断言。
- `createUser`：校管理员 UI 不渲染 schoolId 字段 → 空串提交 →
  wire `min(1)` 400，校管理员永远建不了号。修为 wire 可选 +
  服务层省略时落 actor 租户（显式异租户仍 403），前端省略空值。

**验证**：auth-host 45/45（auth 18 + admin 25 + composition 2，
含真实链 bootstrap→匿名申请→审批→校管理员登录）；
auth.client 23/23；tsc 干净；lib/dist 已重建。浏览器实测：
匿名申请 201+成功文案、超管登录、菜单「管理后台」、申请列表、
审批表单全字段、UI 审批→建校+管理员、两个新校管理员登录、
租户收窄（只见自己学校/跨租户 403/requests 403）、审计落账。
两树逐字节一致（IDE 陈旧缓冲区曾多次回退，最终 overlay 为准
replay + diff 核对）。

---

## 真题卷库（资源库 · 原卷区升级）——已完成

资源库「真题卷」tab 从简单卡片网格升级为完整卷库：学段 tab +
卷类型/地区动态筛选组（从数据派生，无值不渲染）、含金量置顶
→ 年份 → 录入时间排序、徽章行（类型/含金量/地区/学校）、
可展开逐题清单（题号/题型/分值/考点/能力/完整题干）。

数据链（全可选字段向后兼容）：

- `packages/question-paper`（顶层包）：`SourcePaper` +`region`/
  `school`/`kind`/`featured`；`SourcePaperKind` = real/mock/
  monthly/midterm/final/joint；`KnowledgeAnnotation` +`stem`。
- `paper-host`：`domain.ts` wire schema 同步、`service.ts`
  落库透传——**改完必须 `tsdown` 重建 `lib/`，`dsh web`
  吃 `lib/index.js` 不吃 src**（tsx 只转译入口链）。
- `paper-api.ts` wire Row 同步。
- `PaperWorkspace` 录入原卷表单 +地区/学校/卷类型/含金量；
  逐题考点 +题干（必填，真题板块按题展示；CSV 保持索引
  导入不含题干——朴素逗号切分吃不下含逗号的题面）。
- 浏览端只用 `status==='verified'` 的卷与考点。

**验证**：`library-papers.client.spec.tsx` 6/6（verified 过滤/
徽章/排序/筛选/展开题干/空态）；`paper-workspace.client.spec.tsx`
6/6（stub 补 `listBankItems` 等 4 个 Bank 方法）；UI 全套
681/681；tsc 干净；浏览器实测月考卡徽章+题干渲染、筛选 chip、
featured 置顶。

**运维坑（这轮踩实了）**：

- `harness-overlay.mjs apply` 会把 vendor 回滚成 overlay 旧版
  ——本日被批量回退 3 次（含 IDE 陈旧缓冲区同步）。规则：
  **改 overlay 副本 → apply 推 vendor → 立刻 diff 核对**。
- `dsh web` 多实例共存会共享 `~/.dsh/storages/
physicsos_paper.json` 但各自冻结启动时的代码——旧实例会
  静默丢新字段（wire schema 不认识的键直接剥掉，POST 返回
  201 但没存）。排障顺序：lsof 看全部监听端口 → 拿真实 PID
  （nohup 包一层 shell，$! 不是 node PID）→ kill → 重启。
- 存储文件直改有效但只在服务重启后生效（内存态会回写覆盖）。

**已知边界**：题干仅逐题表单可录（CSV 不支持）；pending 卷
不出现在卷库（管理端台账可见）；搜索 haystack 已含卷名/
地区/学校。

### 登录/注册契约 V2：账号密码全局解析，学校改自由填写（2026-09-19）

用户反馈"登录不该选学校、注册学校自己填、预置大学是错的"。
本轮把学校从公开 wire 上整体拿掉——它仍是内部一级租户，但
名单不再对外暴露：

- `loginWire` → `{username, password, rememberDevice?, schoolId?}`；
  `login()` 遍历 active 用户×active 学校做全局解析，密码唯一匹配
  即登录。同名同密跨校才回 `SCHOOL_REQUIRED`（409）+ `error.candidates`，
  UI 出现消歧下拉重试带 `schoolId`——正常路径永远看不到学校。
  候选上限 16（argon2 放大有界）；账号限流桶改 `acct:username`。
- `registerWire` → `{schoolName?, schoolId?, ...}`（≥1）；
  校名精确→子串唯一解析到 active 租户。0 → `SCHOOL_NOT_FOUND`
  （UI 自动展开"申请开通"面板，校名随申请提交）；多 →
  `SCHOOL_AMBIGUOUS` + candidates → 消歧重试。
- `forgotWire` → `{username, schoolId?}`；唯一候选才落重置行，
  歧义静默 200（防枚举）。
- `GET /physicsos/auth/schools` 公开列表删除——学校名单不再
  可枚举；`AuthApiError.candidates` 承载消歧数据。
- `SEED_SCHOOLS` 只留 `PHYSICSOS-OPEN`（超管挂靠运营租户）；
  六所大学种子删除。dev storage 已清（其下零用户零孤儿），
  剩余租户 PHYSICSOS-OPEN / SYZX-EXP / GY1Z。
- SchoolPicker 组件+CSS 双删；AuthGate 三视图重写（登录无学校、
  注册自由文本+申请面板、找回仅账号）；locales 删 7 键加 5 键。
- 存储键仍 `(schoolId, username)`——租户隔离、session、
  admin 收窄全部不动；`schoolId` 在三处 wire 均保留为可选
  消歧参数（admin spec 原样通过）。

**验证**：auth-host 50/50（auth 23 含 REQUIRED/AMBIGUOUS/自由文本、
admin 25、composition 2 真实链）；auth.client 23/23（含消歧选择器
+申请面板）；ui-physicsos 681/681；tsc 干净；lib/bundle/dist 重建。
浏览器实测：登录仅账号密码进 shell、注册自由填校名、SCHOOL_NOT_FOUND
→申请面板→申请落库 pending、admin 登录后「管理后台」入口正常。

**排障要点**：dev 双实例 `:3080/:3081` 共享 `~/.dsh/storages/
physicsos_auth.json`——清数据必须重启实例（内存态回写覆盖文件）。

---

## 2026-09-19 · 注册自助开通（self-provisioning）

**变更**：注册填写的校名解析不到时**自动建成 active 学校租户**
（`s_` 前缀 id），注册永不在"未开通学校"上死胡同——"申请开通"
入口从登录门整体移除。

- `service.register()`：`schoolName` 0 匹配 → `provisionSchool()`
  建租户（active，名字取输入 trim 原样）→ 照常注册。
  `SCHOOL_NOT_FOUND` 仅留给显式 `schoolId` 无效路径。
- AuthGate：applyOpen/applyContact/applyBusy/applyDone/applyError
  五状态、`submitApply`、申请面板 JSX、`authApi` prop 全删；
  index.ts gate inject 不再传 authApi。
- `AuthApi.submitSchoolRequest` 删除（无调用方）；
  `SchoolRequestRow` 保留（AdminApi/AdminWorkspace 仍在用——
  `/school-requests` 端点与审批流不动，是机构正式开通路径）。
- locales 删 7 键×2（auth.apply._、auth.school.apply_）；
  AuthGate.module.css 删 applyToggle/applyPanel/applyHint。
- 歧义保护不变：`SCHOOL_AMBIGUOUS`+candidates 仍在（多校同名）；
  `SCHOOL_REQUIRED`+candidates 仍在（跨校同名同密登录）。

**验证**：auth-host 73/73（auth.spec 两条改为断言自助建校：未知校名
→201+s_ 租户、禁用校名→新建独立租户不复用）；auth.client 23/23
（新增"无申请步骤"用例）；tsc 干净（残留报错全在 library/paper
用户 WIP spec）。lib/bundle/dist 已重建，:3080 已重启。
线上实测：`POST /register {schoolName:"遵义市第四中学"}` → 201，
落库 `s_MMVLLixqUqlz` active；浏览器注册视图无"申请"字样。

**注意**：自助建校意味着每个校名变体都是独立租户（"贵阳二中"与
"贵阳第二中学"是两所）。租户归并/改名是后续管理面工作；
storage 现有租户 PHYSICSOS-OPEN/SYZX-EXP/GY1Z/s_*。
