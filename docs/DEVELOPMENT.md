# PhysicsOS 本地开发手册

> 文件：`docs/DEVELOPMENT.md`
> 文档定位：可以照着敲命令的操作手册；流程与协作规范见 [`CONTRIBUTING.md`](../CONTRIBUTING.md)，工程规范见 [`02-ENGINEERING-STANDARDS.md`](./02-ENGINEERING-STANDARDS.md)。

## 1. 前置条件

| 依赖    | 版本 / 说明                                                                   |
| ------- | ----------------------------------------------------------------------------- |
| Node.js | `>= 24`（当前验证基线 `24.x`）                                                |
| pnpm    | 由仓库 `packageManager` 固定；根 `11.9.0`，`vendor/deepseek-harness` `11.7.0` |
| Git LFS | `UI/`、`docs/` 下的大图走 LFS；未安装时这些 PNG 只是 pointer 文件             |
| Docker  | 只有跑 Compose / 容器部署验证时需要                                           |

## 2. 首次克隆

```sh
git clone <your-fork>
cd PhysicsOS
git lfs install
git submodule update --init --recursive
node scripts/overlay/harness-overlay.mjs apply
```

`apply` 把 `overlays/harness/files/**` 叠加进 `vendor/deepseek-harness`，并把 `overlays/harness/upstream-changes.patch` 打到上游已跟踪文件上。没有这一步，正式 Web 入口跑不起来。

## 3. 安装依赖

根工作区（`apps/*`、`packages/*`、`tests/*`）与 `vendor/deepseek-harness` 是两个独立工作区，需要分别安装：

```sh
# 仓库根
pnpm install

# Harness 子模块（lefthook 的 postinstall 在 submodule 下会失败，官方绕法是关掉脚本）
pnpm -C vendor/deepseek-harness install --ignore-scripts
```

Linux / 容器环境里 `node-pty` 没有预编译产物，需要本地编译：

```sh
pnpm -C vendor/deepseek-harness rebuild node-pty
```

Docker 镜像里的做法见仓库根 `Dockerfile`：安装 `python3 make g++`，再用 `onlyBuiltDependencies: [node-pty]` 重建。

## 4. overlay 工作回路

`overlays/harness/files/**` 是 Harness 侧 PhysicsOS 代码的源真值，`vendor/deepseek-harness/**` 里的 `lib/`、`dist/`、`node_modules/` 是生成物。

```sh
# 源真值 → vendor（改完 overlay 里的代码后执行）
node scripts/overlay/harness-overlay.mjs apply

# vendor → overlay（在 vendor 里改了上游已跟踪文件后，由维护者执行）
node scripts/overlay/harness-overlay.mjs capture
```

只在 vendor 里手改代码、不 `capture` 回写，下一次 `apply` 就会覆盖它。升级 upstream pin 的流程见 [`HARNESS-UPSTREAM.md`](./HARNESS-UPSTREAM.md)。

## 5. 常用脚本

| 命令                               | 作用                                                          |
| ---------------------------------- | ------------------------------------------------------------- |
| `pnpm dev`                         | 启动正式 Web 入口（`dsh web`，默认 `http://127.0.0.1:3080/`） |
| `pnpm build`                       | 构建 core 包 + Agent 工具 + hosts + Client Plugin + 前端      |
| `pnpm typecheck`                   | core / web / agent 三段类型检查                               |
| `pnpm lint`                        | core / web / agent 三段 lint                                  |
| `pnpm test`                        | core / web / agent / deploy / desktop 测试                    |
| `pnpm run test:web`                | 只跑 `ui-physicsos` 客户端测试                                |
| `pnpm run test:agent`              | 只跑 `packages/physicsos/**` 宿主插件测试                     |
| `pnpm run test:acceptance`         | 浏览器验收（脚本自己拉起隔离服务器，默认端口 3095）           |
| `pnpm run test:desktop`            | 桌面端打包脚本与 sidecar bridge 测试                          |
| `pnpm run desktop:dev`             | 本地开发模式启动桌面壳                                        |
| `pnpm run desktop:build`           | 本地构建（Development fallback，不用于发布）                  |
| `pnpm run desktop:sidecar`         | 构建并收集 sidecar 运行时资源                                 |
| `pnpm run desktop:release`         | 正式发布构建（需要签名与 updater 配置）                       |
| `pnpm run format` / `format:write` | Prettier 检查 / 写入                                          |

## 6. 只跑一个包或一个 spec

领域包各自带脚本，可以直接定点执行：

```sh
pnpm -C packages/engine-wave test
pnpm -C packages/engine-wave typecheck
pnpm -C packages/engine-wave exec vitest run tests/wave-model.spec.ts
```

Overlay 里的宿主插件在 vendor 工作区执行：

```sh
pnpm -C vendor/deepseek-harness exec vitest run packages/physicsos/auth-host/tests
pnpm -C vendor/deepseek-harness exec tsc -b packages/physicsos/auth-host/tsconfig.json --pretty false
```

根脚本偶尔会因为 `verify-deps-before-run` 的依赖状态检查直接失败，此时可以在单条命令前加：

```sh
pnpm_config_verify_deps_before_run=false pnpm -C vendor/deepseek-harness --filter <pkg> run build
```

这是排查用的旁路，不是常态；如果它成为常态，说明依赖状态需要重新 `pnpm install`。

## 7. 桌面端

```sh
pnpm run desktop:dev        # 本地开发
pnpm run desktop:build      # 本地构建（开发配置）
pnpm run desktop:sidecar    # 产出 resources/agent-sidecar
pnpm run desktop:release    # 正式打包（macOS/Windows 安装包）
pnpm run test:desktop       # 打包脚本 + bridge 测试
```

正式发布前需要提供 updater 公钥与 endpoint、`TAURI_SIGNING_PRIVATE_KEY` 及 Apple / Windows 签名材料；`desktop:config` 与 `desktop:release-config` 会校验配置文件，发布配置会拒绝开发 key、`example.invalid` 之类的占位 endpoint，以及仍指向占位页的构建。桌面端细节见 [`../apps/desktop/README.md`](../apps/desktop/README.md)。

## 8. 用 Docker Compose 起本地服务器

Compose 需要 7 个 secret 文件，默认路径都在仓库根（`.gitignore` 已忽略）：

```text
.env.postgres_password   .env.redis_password
.env.database_url        .env.redis_url
.env.deepseek_api_key    .env.admin_password
.env.image_api_key
```

文件名可用 `PHYSICSOS_*_FILE` 环境变量覆盖，清单与轮换说明见 [`13-DEPLOYMENT-OPERATIONS.md`](./13-DEPLOYMENT-OPERATIONS.md)。

```sh
docker compose config --quiet     # 先校验配置
docker compose up --build         # 起 app + postgres + redis
```

app 默认只监听 `127.0.0.1:3080`（可用 `PHYSICSOS_HTTP_PORT` 改端口），健康检查走 `/readyz`。TLS 反代后需要把 `PHYSICOS_TRUSTED_PROXIES` 设为反代的**精确 IP 字面量**（CIDR 与主机名会被拒绝）。

## 9. 故障排查

### pnpm 版本冲突

症状：`ERR_PNPM_BAD_PM_VERSION`、lockfile 被改写、CI 与本地行为不一致。

处理：用 Corepack 让 pnpm 按各目录 `packageManager` 字段取版本，不要用全局 pnpm 覆盖；根与 vendor 是两个版本（`11.9.0` / `11.7.0`），跨目录执行时用 `pnpm -C <dir>` 而不是先 `cd` 再复用同一个 shell 的 pnpm。

### overlay patch 不干净

症状：`apply` 报 patch 无法应用，或 vendor 里出现 `.rej` / `.orig`。

处理：

```sh
git -C vendor/deepseek-harness status --short
```

先确认 vendor 里没有未回写的上游文件改动（有就先 `capture`），确认没有 `.rej` / `.orig` 残留后再重跑 `node scripts/overlay/harness-overlay.mjs apply`。`apply` 是幂等的：已应用的补丁会跳过。

### 容器里 node-pty 编译失败

症状：`docker compose up --build` 阶段 `node-gyp` 报缺少 `python3`、`make` 或 `g++`。

处理：镜像构建阶段必须带上 `python3 make g++`，并只对 `node-pty` 放行安装脚本（其余依赖保持 `--ignore-scripts`）。如果是在本机 Linux 复现，执行 `pnpm -C vendor/deepseek-harness rebuild node-pty`。

### 改了代码但浏览器 / 测试没变化

先确认改的是 `overlays/harness/files/**` 并在 vendor 里重新构建（`lib/`、`dist/` 是生成物）；再确认 `apply` 之后没有旧产物残留。历史上 `link:` 桥接就是为了避免 browser bundle 与测试读到两份源码，相关说明见 [`HARNESS-UI-OVERLAY.md`](./HARNESS-UI-OVERLAY.md)。
