# 生产快速构建与部署手册

本页记录 2026-10-31 实际跑通的服务器构建、切换与回滚流程，供日常发版照做。完整的运维说明（secret、备份恢复、加固）仍以 [`13-DEPLOYMENT-OPERATIONS.md`](./13-DEPLOYMENT-OPERATIONS.md) 为准。

## 一句话流程

本机提交并推送 `main` → 服务器 `git pull --ff-only` → 后台 `docker build` 出候选 tag → 备份数据库并给当前镜像打回滚 tag → 把候选 tag 改名为 `physicsos-app:local` → **只跑一次** `docker compose up -d --no-build --wait app` → 验证。

## 环境

| 项 | 值 |
| --- | --- |
| 正式入口 | `https://physics.dongsiwei.com` |
| 服务器 | `root@107.151.246.59`（2026-10-31 起域名解析到这台；`AGENTS.md` 里的 `38.76.190.3` 是旧机） |
| 部署目录 | `/opt/physicsos`（git 检出，跟踪 `origin/main`） |
| 运行镜像 | compose 默认 `physicsos-app:local`，容器名 `physicsos-app-1` |
| 宿主条件 | 4 核，带宽约 10 Mbps（≈1.25 MB/s），磁盘 49G；宿主**没有** node，仓库脚本要在容器里跑 |

构建只在服务器上做。本机只改源码、跑测试、提交推送，不为部署另装本机环境。

## 为什么现在能快

以前每次构建 45–55 分钟，还经常在 vendor 安装阶段约 250 秒时失败。下面三处改动都已经在 `Dockerfile` 里，**不要删**：

1. **pnpm 下载超时**：vendor 依赖里有几十个大二进制包，带宽被平分后 60 秒下不完，pnpm 11 默认的 `fetchTimeout` 就会中止重试，日志表现为 `error (23)`。安装前往 `vendor/deepseek-harness/pnpm-workspace.yaml` 追加顶层 `fetchTimeout: 1800000`。pnpm 11 只认这个顶层键，`.npmrc`、`settings:` 嵌套写法和命令行参数都无效。
2. **pnpm store 缓存挂载**：`--mount=type=cache,target=/pnpm/store`。依赖下载过一次后就留在 BuildKit 缓存里，后续构建基本不再走网络。
3. **tsc 增量状态缓存**：`--mount=type=cache,target=/tsc-state,id=physicsos-harness-tsc-state`。每次构建成功后，把 harness 约 250 个 composite 项目的 `lib/` 和 `*.tsbuildinfo` 打包存进缓存，下次构建先解包再编译。改一个 `.tsx` 时，`build:lib + build:web` 这一步从 840 秒降到约 204 秒。

实测耗时：

| 情况 | 总耗时 |
| --- | --- |
| 依赖没变、中间层仍在缓存 | 约 10 分钟 |
| 刚执行过 `builder prune`（中间层清空，缓存挂载保留） | 约 14 分钟 |
| 其中镜像导出（写出约 10G 的 node_modules 层） | 约 4.5 分钟 |

## 步骤

下面的命令都在本机执行，通过 `ssh` 操作服务器。每条 ssh 命令用**单引号**包住远端脚本，不要用 heredoc 或 `bash -s`，否则命令可能中途静默结束。

### 0. 本机：验证并推送

- 改了 `vendor/deepseek-harness` 里的文件，要先用 `node scripts/overlay/harness-overlay.mjs capture` 收回补丁，再用 `verify` 确认补丁无漂移。capture 会把 vendor 里的游离文件一起收进补丁，提交前要看一眼 diff。
- 类型检查要跑两个聚合项目：`tsc -b tsconfig.client.json` 和 `tsc -b tsconfig.host.json`。镜像里的 `build:lib` 会连 `tests/` 一起检查，只检查单个包不够。
- 判断成败要读命令本身的退出码。`cmd | tail` 之后的 `$?` 是 `tail` 的退出码，几乎总是 0。

```bash
git fetch -q origin && git status -sb && git log --oneline -3 origin/main
```

```bash
git push origin HEAD:main
```

### 1. 核对三方版本

```bash
ssh root@107.151.246.59 'cd /opt/physicsos && git fetch -q origin && echo "server=$(git rev-parse --short HEAD) origin/main=$(git rev-parse --short origin/main)" && git status --short | grep -v "^?? backups/"; docker inspect physicsos-app-1 --format "running={{.Image}} health={{.State.Health.Status}}"; docker images --format "{{.Repository}}:{{.Tag}} {{.ID}} {{.CreatedSince}}" | grep physicsos-app'
```

服务器工作区应当是干净的。如果有手改文件，先弄清楚来源再决定保留或 `git checkout --`；服务器上已上线的修复必须先合进 `main`，不要被覆盖。

### 2. 检查磁盘

```bash
ssh root@107.151.246.59 'df -h / | tail -1; docker system df'
```

根分区使用率超过约 85% 就先清理普通构建缓存。这条命令**保留**两个缓存挂载（pnpm store 和 tsc 状态），本次释放了 19.7G：

```bash
ssh root@107.151.246.59 'docker builder prune -a -f --filter type=regular | tail -1; df -h / | tail -1'
```

不要用不带过滤条件的 `docker builder prune -a` 或 `docker system prune -a`，它们会把缓存挂载一起删掉，下一次构建又要从网络重下所有依赖、全量编译。旧的候选镜像和回滚镜像可以按需 `docker rmi`，但至少保留最近一个回滚 tag。

### 3. 拉代码并在后台构建候选镜像

`TAG` 写一个能看出内容的名字，例如提交短哈希或功能名：

```bash
ssh root@107.151.246.59 'cd /opt/physicsos && git pull -q --ff-only origin main && git log --oneline -1 && TAG=candidate-$(git rev-parse --short HEAD) && echo $TAG && setsid nohup sh -c "date +%s > /tmp/build.start; docker build -t physicsos-app:$TAG . > /tmp/build.log 2>&1; echo \$? > /tmp/build.exit; date +%s > /tmp/build.end" </dev/null >/dev/null 2>&1 & echo started'
```

构建由 `setsid nohup` 托管，SSH 断开也会继续跑。查看进度：

```bash
ssh root@107.151.246.59 'cat /tmp/build.exit 2>/dev/null || echo running; tail -3 /tmp/build.log | cut -c1-200'
```

`/tmp/build.exit` 出现且内容为 `0` 才算构建成功。不要用 `pgrep -f "docker build"` 判断构建是否还在跑，它会匹配到 ssh 命令自己。失败时：

```bash
ssh root@107.151.246.59 'grep -nE "ERROR|error TS|ENOSPC|ERR_PNPM" /tmp/build.log | head -20'
```

- `ENOSPC`：回到第 2 步清理后重新构建。
- `error TS…`：回本机修复，修好后从第 0 步重来。
- `error (23)`：检查 `Dockerfile` 里的 `fetchTimeout` 是否被改掉了。

### 4. 备份数据库并保留回滚点

```bash
ssh root@107.151.246.59 'cd /opt/physicsos && PHYSICSOS_DIR=/opt/physicsos ./scripts/deploy/backup-postgres.sh > /tmp/backup.log 2>&1; echo "backup rc=$?"; tail -1 /tmp/backup.log; docker tag physicsos-app:local physicsos-app:rollback-$(date +%Y%m%d%H%M) && docker images --format "{{.Repository}}:{{.Tag}} {{.ID}}" | grep physicsos-app'
```

`backup rc=0` 并且看到新的 `rollback-…` tag 后才能继续。备份文件在 `/opt/physicsos/backups/postgres/`。

### 5. 切换

把 `TAG` 换成第 3 步打印出来的值：

```bash
ssh root@107.151.246.59 'cd /opt/physicsos && docker tag physicsos-app:TAG physicsos-app:local && docker compose up -d --no-build --wait --wait-timeout 300 app > /tmp/up.log 2>&1; echo "up rc=$?"; tail -5 /tmp/up.log; docker inspect physicsos-app-1 --format "running={{.Image}} health={{.State.Health.Status}}"'
```

**`up -d` 只能跑一次。** 如果 SSH 断开，就去看 `/tmp/up.log` 和 `docker ps`，不要再发一次 `up -d`。两条 `up` 并发会互相替换容器，留下 `Created`/`Dead` 状态的 app 容器（2026-09-28 因此停服约 20 分钟）。补救方法：等删除结束后执行 `docker compose up -d app`；如果容器删不掉，先执行 `docker rm -f physicsos-app-1`。

`--no-build` 不能省：compose 自带的 build 不走上面的候选与回滚流程，而且会和刚建好的镜像重复构建。

### 6. 验证

```bash
ssh root@107.151.246.59 'cd /opt/physicsos && docker compose exec -T app node scripts/deploy/wait-for-ready.mjs http://127.0.0.1:3080/readyz && docker compose logs --since=5m app | tail -20'
```

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://physics.dongsiwei.com/
```

- 运行中的镜像 ID 要等于候选镜像 ID，健康状态为 `healthy`。
- 用浏览器打开正式入口，确认启动页、登录和本次改动都正常。
- 发一条模型对话，确认能拿到回复（见下方「模型配置」）。

### 7. 回滚

把第 4 步打的回滚 tag 改回 `local`，同样只跑一次 `up`：

```bash
ssh root@107.151.246.59 'cd /opt/physicsos && docker tag physicsos-app:rollback-YYYYMMDDHHMM physicsos-app:local && docker compose up -d --no-build --wait --wait-timeout 300 app > /tmp/rollback.log 2>&1; echo "up rc=$?"; docker inspect physicsos-app-1 --format "running={{.Image}} health={{.State.Health.Status}}"'
```

只有新版本写入了旧版本读不懂的数据时，才需要从第 4 步的备份恢复数据库。恢复步骤见 [`13-DEPLOYMENT-OPERATIONS.md`](./13-DEPLOYMENT-OPERATIONS.md) 第 8 节，恢复前必须先确认恢复点。

## 模型配置

生产的模型层配置只在 profile patch 里：`/var/lib/docker/volumes/physicsos_app_data/_data/profiles/web/cordis.patch.yml`。模型号池（`127.0.0.1:38972`）只提供 OpenAI 协议的 `/v1/chat/completions` 和 `/v1/models`，所以默认模型必须走 `llm-pi-ai` 的 `openai-completions` 提供方（provider `physicsos-pool`，模型 `deepseek-v4.1-flash`）。

在应用里打开「设置 → 模型」保存一次，就会把这份文件改写成 `llm-deepseek`。之后对话会 404，报错 `only /v1/chat/completions and /v1/models are served`。修复方法：从 `/opt/physicsos/backups/` 里取回正确的 patch 文件写回原位，执行 `docker compose restart app`，等容器 `healthy` 后再发一次对话验证。换镜像不会影响这份文件，因为它在数据卷里。

## 不要做的事

- 不要在服务器上直接改 `Dockerfile` 或源码来试构建。调试时可以临时 `scp` 上去，但结束后要 `git checkout --` 恢复，正式构建只用 `main` 上的版本。
- 不要给服务器装 git-lfs。`docs/` 下的 PNG 在服务器上是指针文件，不影响构建和线上页面。
- 不要把 secret 权限改成 `root:root 0600`。app 以 uid 999 运行，secret 必须是 `999:999 0400`；需要时执行 `PHYSICSOS_DIR=/opt/physicsos ./scripts/deploy/secure-secrets.sh`。
- 不要为了腾磁盘删除 BuildKit 的缓存挂载。
- 不要把密钥、Cookie 或完整环境变量写进命令输出、日志或这份文档。

## 2026-10-31 部署记录

| 内容 | 候选镜像 | 回滚 tag | 数据库备份 |
| --- | --- | --- | --- |
| `b445d20` 与构建修复（`9913d42`） | `970180e010c0` | `rollback-pre-b445d20`（`9dc4591cadf7`） | `20261031T095423Z` |
| 启动页加载过程（`519ca2e`） | `9fc12216c930` | `rollback-pre-boot`（`970180e010c0`） | `20261031T104934Z` |
