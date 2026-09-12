# 交接说明（换机 / 新环境上手指南）

本文件写给"在另一台机器上继续开发 PhysicsOS"的人。读完这一页就能把环境跑起来，
并知道当前代码处于什么状态、哪些做完了、哪些没做。

---

## 1. 当前分支与这次的工作

| 项 | 值 |
| --- | --- |
| 仓库 | `https://github.com/122-syf-wcy/PhysicsOS.git` |
| 分支 | `feat/circuit-living-effects`（提交 `794b9d0`） |
| 内容 | 电学台活体化：电流流光 / 灯泡分层辉光 / 电缆导线 + 器材精灵生成流水线 |

`main` 上还没有这次的工作。要在新机器上拿到它，二选一：

```bash
git clone https://github.com/122-syf-wcy/PhysicsOS.git && git checkout feat/circuit-living-effects
```

或者把 `main` 快进过去（仓库历史全在 `main`，这是 fast-forward，没有分叉）：

```bash
git checkout main && git merge --ff-only feat/circuit-living-effects && git push
```

---

## 2. 环境搭建（按顺序）

### 2.1 依赖与子模块

`vendor/deepseek-harness` 是 pin 住的 submodule，克隆后是空的，必须先物化：

```bash
git submodule update --init --recursive
pnpm install
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

### 2.3 `.env`（不随仓库走，必须手工重建）

`.env` 被 `.gitignore` 忽略，里面是生图网关凭据。新机器上从 `.env.example` 复制
并填值：

```
PHYSICSOS_IMAGE_PRIMARY_BASE_URL=
PHYSICSOS_IMAGE_PRIMARY_API_KEY=
PHYSICSOS_IMAGE_PRIMARY_MODEL=gpt-image-2
PHYSICSOS_IMAGE_SECONDARY_BASE_URL=
PHYSICSOS_IMAGE_SECONDARY_API_KEY=
PHYSICSOS_IMAGE_SECONDARY_MODEL=
```

当前在用的主网关是 `https://zz.211b.site`，模型 `gpt-image-2`。密钥由持有人单独
交接，**不要写进任何被提交的文件**。

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

---

## 4. 视觉层在哪里

电学台（以及全部领域）的渲染代码在：

```
overlays/harness/files/packages/client/ui-physicsos/src/client/physics/
```

| 文件 | 作用 |
| --- | --- |
| `*-renderer.tsx` | 各领域 SVG 渲染器（`circuit-renderer.tsx` 是电学台） |
| `renderers.module.css` | 渲染器样式（导线、电流、灯光都在这里） |
| `scene-visual-model.ts` | 渲染层消费的视觉模型契约 |
| `*-visual-bridge.ts` | 引擎结果 → 视觉模型的桥（数值诚实性的关键层） |
| `tests/circuit.client.spec.tsx` | 电学台测试 |

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

### 未完成

- **器材精灵尚未接进渲染层**。页面上看到的器材本体仍是矢量符号；精灵只是资产
  躺在 `parts3d/` 里。接线时要用 `manifest.json` 的 `solidBox` 把零件实体映射到
  导线的接线端跨度上。
- `manifest.json` 的锚点来自**几何约定**（`anchorSource: "geometry-convention"`），
  不是逐件目视测量。非轴向器材（电表、开关）的两端位于底边，接线时会需要覆盖值。
- `lamp-off` / `lamp-on` 尚未启用：当前视觉模型里没有独立的"灯泡"类型，耗散负载
  一律按电阻元件绘制。等场景侧有了灯泡类型再接。
- 除电路外的领域（力学、波动、感应……）本轮未动。

### 验证证据与已知问题

- `pnpm typecheck:web` 干净通过。
- 改动过的 `circuit.client.spec.tsx` 单独运行 **17/17 通过**。
- 全量 `pnpm test:web` 有 **11 项失败，全部是 `Test timed out in 5000ms`**，没有
  一条是断言失败。本机环境很慢（单文件 import 约 37 秒）是主因。**未跑干净基线
  逐条对照**，所以不能百分百排除改动影响，但失败形态全部指向环境。
- `pnpm lint:web` 有报错，全部落在本次未改动的文件上（`induction-visual-bridge.ts`、
  `mechanics-visual-bridge.ts`、`wave-renderer.tsx`、`workspace-parts.tsx`、
  `numeric-audit.client.spec.ts`），属既有问题。

---

## 7. 下一步建议顺序

1. 把精灵接进 `circuit-renderer.tsx`：按 `kind` 选择精灵，用 `solidBox` 计算摆放与
   缩放，符号几何保留为精灵缺失时的回退。
2. 用真实截图校准非轴向器材的锚点，把 `anchorSource` 从几何约定换成实测值。
3. 视需要给场景增加灯泡类型，启用 `lamp-off` / `lamp-on`。
4. 把同一套流水线推广到其他领域——每添一个领域要先定该领域的器材清单与相机约定。
