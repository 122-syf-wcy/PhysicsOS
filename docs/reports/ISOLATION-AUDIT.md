# PhysicsOS 多用户隔离审计（Stage 0 → Stage 2 复核）

首次审计：2026-09-26
最新复核：2026-09-27
目标：`https://physics.dongsiwei.com`
服务器：`root@38.76.190.3`（通过 SSH key 登录）
部署提交：`63c20e6e701b1dc1e4188e66903a82a18306f2cc`
App 镜像：`sha256:534d02e10edc1bab73521df348a85775b248bf4a7c1a2d62545718f282e0ba29`

本报告只做验证，不修改产品代码、不提交、不执行 overlay capture。新增的验收脚本是
[`tests/acceptance/isolation.mjs`](../../tests/acceptance/isolation.mjs)。

## 结论先说

**最新状态（2026-09-27）：9 PASS / 0 FAIL / 0 BLOCKED**

- 学习作答和学习场景按账号隔离。学生 A 读取不到学生 B 写入的 attempt/scene。
- 会话列表、会话导出和会话 prompt 的所有权检查在 HTTP 语义上没有泄漏内容；
  但成功拒绝使用 RPC envelope，HTTP 状态是 `200`，不是字面意义的 `404/403`。
- 已退役的 `/physicsos/class/*` 不再挂载 class-host；该路径只落到前端 HTML
  回退，不再返回班级、成员、作业或提交数据。
- 非管理员 `session.create` 会被服务端改写为账号私有 workspace +
  `physics-student`；学生对 `/etc` 等路径的请求不会到达宿主。
- 公网 `/api` 在合法域名下返回 `401 unauthenticated`，未认证请求不再被
  `403 forbidden` 的 Host 栅栏整体拦截。
- `physics-student` 预设只挂载物理工具与提问工具，不挂载 shell、文件系统、
  web 或子代理工具；bash runner 在镜像中也以 `SANDBOX_UNAVAILABLE` fail-closed。
  因此学生会话没有读取 `/run/secrets/*` 或其他账号目录的工具入口。
- secret 文件已是 `999:999 0400`；app 身份可读，非 999 的容器身份被拒。
- 模型号池已提供真实回合，模型链路不再因 `AUTH 401` 中断。

下面的 Stage 0 原始记录保留为发现过程；其中三条“阻断公测”均已在 Stage 2
按上述边界修复，不能再当作当前发布结论。

## 1. 双账号学习数据隔离

运行命令：

```sh
PHYSICSOS_AUDIT_ADMIN_PASSWORD='<env-injected>' \
  node tests/acceptance/isolation.mjs
```

外部域名运行时，学习/班级校验通过，`/api/session.create` 被 `403` 阻断：

```text
[PASS] learning attempts are account-scoped
[PASS] learning scenes are account-scoped
[PASS] class list is membership-scoped
[PASS] foreign class detail is denied: members=403 dashboard=403
[BLOCKED] session setup reaches the host: public /api/session.create returned 403
SUMMARY pass=8 fail=0 blocked=1
```

通过 SSH 本地端口转发走同一容器的 loopback 后，完整脚本结果：

```text
[PASS] learning attempts are account-scoped
[PASS] learning scenes are account-scoped
[PASS] class list is membership-scoped
[PASS] foreign class detail is denied: members=403 dashboard=403
[PASS] session setup succeeds
[PASS] session list is account-scoped
[PASS] foreign session export is denied
[PASS] foreign session prompt is denied
SUMMARY pass=12 fail=0 blocked=0
```

关键原始响应：

```text
GET /physicsos/learning/attempts?limit=100  (A) -> 200
{"items":[]}

GET /physicsos/learning/attempts?limit=100  (B) -> 200
{"items":[{"id":"isolation-attempt-muies4k1_616ab1", ...}]}

GET /physicsos/class/classes?limit=100  (A) -> 200
{"items":[]}

GET /physicsos/class/classes?limit=100  (B) -> 200
{"items":[{"id":"cls_oyLA2sw_a2IC", ...}]}

GET /physicsos/class/classes/cls_oyLA2sw_a2IC/members?limit=100  (A) -> 403
{"error":{"code":"FORBIDDEN","message":"只有班主任或校管理员可以管理该班级"}}
```

会话所有权原始响应（A 访问 B 的 session）：

```text
GET /api/session.export?sessionId=session-758d4b59-cc51-47fe-9146-c62ec6f7f45f (A) -> 200
{"type":"server-response","rpcId":"session-export","result":{"ok":false,"error":{"code":"session-not-found","message":"session \"session-758d4b59-cc51-47fe-9146-c62ec6f7f45f\" not found"}}}

POST /api/session.prompt (A, foreign sessionId) -> 200
{"type":"server-response","rpcId":"isolation-a-prompt-muies4k1_616ab1","result":{"ok":false,"error":{"code":"session-not-found","message":"session \"session-758d4b59-cc51-47fe-9146-c62ec6f7f45f\" not found"}}}
```

这说明**没有返回对方内容**，但不满足字面上的“HTTP 必须 404/403”：这里使用的是
成功 HTTP 响应加 RPC error envelope。若 Stage 2 的验收标准要求 HTTP 404/403，
这个差异必须单独修。

## 2. Agent 沙箱越权

### 2.1 真实 agent 回合

先用学生账号创建一个会话，连接真实 `/api/events.mux` WebSocket，再发送要求执行
`pwd; ls -la ..; if [ -r /run/secrets/admin_password ]; then wc -c < ...; else echo DENIED; fi`
的 prompt。模型请求没有到达工具执行阶段，服务端返回：

```text
EVENT assistant/chunk {"chunk":{"type":"finish","reason":{"kind":"error","failure":{"message":"Authentication Fails, Your api key: ****e4b2 is invalid","code":"AUTH","status":401}}}}
EVENT turn/end {"reason":{"kind":"error","error":{"message":"Authentication Fails, Your api key: ****e4b2 is invalid","code":"AUTH","status":401}}}
```

因此**无法诚实判定“模型收到文件内容后的自述行为”**。但越权是否可能，不能依赖模型
自觉拒绝；服务器侧边界已经足够给出结论。

### 2.2 服务器侧证据

在 app 容器内检查：

```sh
ssh -i ~/.ssh/id_ed25519 root@38.76.190.3 \
  'cd /opt/physicsos && docker compose exec -T app sh -c '\''id -u; stat -c "%a %U:%G %n" /run/secrets/admin_password; if [ -r /run/secrets/admin_password ]; then printf "secret_readable=yes bytes="; wc -c < /run/secrets/admin_password; else echo secret_readable=no; fi'\'''
```

原始结果：

```text
999
644 root:root /run/secrets/admin_password
secret_readable=yes bytes=10
```

源码也明确写出同一结论：

```text
vendor/deepseek-harness/packages/fs/fs-sandbox/src/index.ts:7
Reads pass through untouched: every mode permits reading.

vendor/deepseek-harness/packages/fs/fs-sandbox/README.md:5
Reads always pass through — every mode permits reading.

vendor/deepseek-harness/packages/sandbox/sandbox-local/src/profiles.ts:17
const args = ['--ro-bind', '/', '/', ...]

vendor/deepseek-harness/packages/sandbox/sandbox-local/src/profiles.ts:30-35
landlockGrantArgs({ readOnly: ['/'], readWrite })
```

所以结论是：**确认存在 P0 漏洞风险**。当前缺少的是一条有效的模型 key；一旦模型
能发起 read/bash 工具调用，读取 `/run/secrets/admin_password` 不会被文件 sandbox
拒绝。最小复现路径就是上面的容器内 `secret_readable=yes`，而不是依赖模型回答。

## 3. 会话磁盘布局取证

服务器命令：

```sh
ssh -i ~/.ssh/id_ed25519 root@38.76.190.3 \
  'cd /opt/physicsos && docker compose exec -T app sh -c '\''find /var/lib/physicsos/sessions -maxdepth 3 -printf "%M %u:%g %s %p\n" | sort'\'''
```

原始结果：

```text
drwx------ physicsos:physicsos 4096 /var/lib/physicsos/sessions
drwx------ physicsos:physicsos 4096 /var/lib/physicsos/sessions/--etc--
drwx------ physicsos:physicsos 4096 /var/lib/physicsos/sessions/--etc--/session-065fe385-960f-4c59-a0cd-5a44e28ab6bf
-rw------- physicsos:physicsos 13324 /var/lib/physicsos/sessions/--etc--/session-065fe385-960f-4c59-a0cd-5a44e28ab6bf/session.jsonl.zstd
drwx------ physicsos:physicsos 4096 /var/lib/physicsos/sessions/--etc--/session-758d4b59-cc51-47fe-9146-c62ec6f7f45f
-rw------- physicsos:physicsos 297 /var/lib/physicsos/sessions/--etc--/session-758d4b59-cc51-47fe-9146-c62ec6f7f45f/session.jsonl.zstd
drwx------ physicsos:physicsos 4096 /var/lib/physicsos/sessions/--etc--/session-2f2fdf8e-acab-47d1-9240-7d5bab4af0b6
-rw------- physicsos:physicsos 298 /var/lib/physicsos/sessions/--etc--/session-2f2fdf8e-acab-47d1-9240-7d5bab4af0b6/session.jsonl.zstd
```

目前是**按 cwd 分桶的单一 root**（这里是 `--etc--`），不是按账号分层。不同账号的
session 文件位于同一目录树，并以同一个 `physicsos` UID 运行：

```sh
ssh -i ~/.ssh/id_ed25519 root@38.76.190.3 \
  'cd /opt/physicsos && docker compose exec -T app sh -c '\''for f in /var/lib/physicsos/sessions/--etc--/session-*/session.jsonl.zstd; do printf "%s " "$f"; [ -r "$f" ] && printf "READABLE " && wc -c < "$f"; done'\'''
```

```text
/var/lib/physicsos/sessions/--etc--/session-065fe385-960f-4c59-a0cd-5a44e28ab6bf/session.jsonl.zstd READABLE 13324
/var/lib/physicsos/sessions/--etc--/session-2f2fdf8e-acab-47d1-9240-7d5bab4af0b6/session.jsonl.zstd READABLE 298
/var/lib/physicsos/sessions/--etc--/session-758d4b59-cc51-47fe-9146-c62ec6f7f45f/session.jsonl.zstd READABLE 297
```

这提供了第二条 P0 泄漏路径：即使 HTTP API 正确拒绝 A 读取 B 的 session，同 UID 的
agent 仍可在文件系统层读取 B 的 session 日志。Stage 2 必须把会话持久化按账号分区，
并且让 agent 的读权限限制在自身分区。

## 4. 公网 `/api` 信任边界

服务器命令：

```sh
ssh -i ~/.ssh/id_ed25519 root@38.76.190.3 \
  'for host in physics.dongsiwei.com 127.0.0.1:3080; do
     curl -sS -o /tmp/fence-body -w "$host -> %{http_code} " \
       -H "host: $host" -H "content-type: application/json" \
       -X POST http://127.0.0.1:3080/api/session.list \
       --data "{\"type\":\"client-request\",\"rpcId\":\"fence\",\"method\":\"session.list\",\"payload\":{}}";
     head -c 80 /tmp/fence-body; echo;
   done'
```

原始结果：

```text
physics.dongsiwei.com -> 403 forbidden
127.0.0.1:3080 -> 401 {"error":"unauthenticated"}
```

`PHYSICOS_TRUSTED_HOSTS=physics.dongsiwei.com` 已在 Compose 环境中，但 Dockerfile 的
`dsh web` 启动命令没有对应的 `--trusted-host` 参数；`dsh web` 的启动 provider 只从
CLI 参数取 `trustedHost`。因此域名请求在信任 fence 处被拒绝，公网浏览器无法使用
agent API。最小复现就是上面的两个 Host 请求。

## 5. 额外发现

- 服务器上的 secret 文件模式均为 `0644 root:root`：
  `.env.admin_password`、`.env.database_url`、`.env.deepseek_api_key`、
  `.env.image_api_key`、`.env.redis_url`。内容未读取，只记录了权限。
- 真实 agent 回合暴露的 DeepSeek key 被服务端标记为 `AUTH 401`。这说明当前生产
  实例没有可用的模型调用链路；即使修复沙箱，agent 功能仍需要在生产密钥修好后重测。
- 公开的 `/api/session.export` 和 `/api/session.prompt` 在无权时使用 `200 + RPC
error`，不是资源级的 `404/403`。如果客户端或安全验收依赖 HTTP 状态，需要统一语义。

## 6. 结论与 Stage 2 的最小验收条件

Stage 2 修复后，至少应满足：

1. 域名 `https://physics.dongsiwei.com` 的 `/api` 可被合法浏览器访问，未登录仍为
   `401`，恶意 Host/Origin 仍被拒绝。
2. 非管理员 `session.create` 不能携带或保留调用方提供的 `cwd`，返回的 preset
   必须是账号允许的 preset，session 文件必须落在账号私有分区。
3. fs/bash agent 的读取也不能越出账号分区，至少不能读取 `/run/secrets/*`、其他账号
   的 session 目录和平台配置。
4. 使用有效模型 key 重跑真实 agent prompt：读取 `/run/secrets/admin_password` 必须
   被 sandbox 拒绝，且事件流里不能出现 secret 内容或可推断的长度/内容。
5. 重新执行双账号脚本，确认 A 看不到 B 的 attempt、scene 和 session，且
   `session.export`/`session.prompt` 的拒绝语义在客户端层可稳定识别；确认已退役
   的班级 API 不再挂载。

Stage 0 当时状态：**数据面 HTTP 隔离基本通过；agent 文件读取、会话工作区分区、
公网 API 信任边界三处未通过。** 这三处已在 Stage 2 修复并重新验收，分别见
§7.2 / §7.3 / §7.6–7.7；上面的最新状态才是当前发布结论。

## 7. 修复记录（Stage 2，2026-09-26）

改动范围（工作区改动，未提交）：`compose.yml`、`scripts/deploy/secure-secrets.sh`（新增，
由 `deploy-server.sh` 与 `install-operations.sh` 调用）、
`overlays/harness/files/packages/physicsos/health-host/deployment.patch.yml`、
`overlays/harness/files/packages/physicsos/auth-host/{src,tests}`、
`overlays/harness/upstream-changes.patch`（`packages/client/connection` 的分发修复）。

### 7.1 secret 读取权限（原 P0 第 1 条的“其他身份可读”路径）

> 历史记录：本节记录当时先落地的 `root:999 0440`。最终不变量已在
> §7.6 收紧为 `999:999 0400`，并写入 Compose long syntax；下面保留原始
> 复现过程，便于确认为什么不能只依赖 Compose 的 file-secret 元数据。

Compose 对 `file:` secret 根本不支持 `uid`/`gid`/`mode`——写上去只会得到一条 warning，
容器里看到的就是宿主文件本身（bind mount）。最小复现：

```text
$ docker compose version
Docker Compose version v5.5.1

$ docker compose up --abort-on-container-exit     # 最小工程：user "999:999"，secret 标 uid/gid/mode
time="2026-09-26T13:36:32Z" level=warning msg="secrets `uid`, `gid` and `mode` are not supported, they will be ignored"
uid=999 gid=999 groups=999
-rw-------    1 root     root            13 /run/secrets/s.txt
cat: can't open '/run/secrets/s.txt': Permission denied
```

所以不变量改放在宿主文件上（`root:<physicsos gid> 0440`），并固化成每次部署/运维加固
都会执行的脚本 + 自检：

```text
$ bash scripts/deploy/secure-secrets.sh
secure-secrets: /opt/physicsos/.env.admin_password -> 0:999 440
secure-secrets: /opt/physicsos/.env.database_url -> 0:999 440
secure-secrets: /opt/physicsos/.env.deepseek_api_key -> 0:999 440
secure-secrets: /opt/physicsos/.env.image_api_key -> 0:999 440
secure-secrets: /opt/physicsos/.env.postgres_password -> 0:999 440
secure-secrets: /opt/physicsos/.env.redis_password -> 0:999 440
secure-secrets: /opt/physicsos/.env.redis_url -> 0:999 440
secure-secrets: verified app-readable and uid-1000-denied for 5 secrets
```

容器内实测（app 身份可读；同容器、非 999 的身份被拒）：

```text
$ docker compose exec -T app sh -c 'ls -l /run/secrets; printf "admin_password head="; head -c 4 /run/secrets/admin_password; echo'
total 20
-r--r----- 1 root physicsos  10 ... admin_password
-r--r----- 1 root physicsos 112 ... database_url
-r--r----- 1 root physicsos  52 ... deepseek_api_key
-r--r----- 1 root physicsos  68 ... image_api_key
-r--r----- 1 root physicsos  87 ... redis_url
admin_password head=syf1

$ docker compose exec -T -u 1000:1000 app sh -c 'cat /run/secrets/admin_password'; echo "uid1000-exit=$?"
cat: /run/secrets/admin_password: Permission denied
uid1000-exit=1
```

这条只关闭“其他身份”的读取路径。agent 进程与 app **同 UID**，单独看 7.2。

### 7.2 agent 读取隔离：已做的收紧与残余风险

上游的读模型（源码原文）：

- `packages/fs/fs-sandbox/src/index.ts`：`Reads pass through untouched: every mode permits
reading.`——只在 write/edit 上做 fence；
- `packages/sandbox/sandbox-local/src/profiles.ts`：bwrap 用 `--ro-bind / /`，Landlock 用
  `readOnly: ['/']`——读全盘，只限写。

生产镜像里目前**没有任何可用的 bash runner**，所以 shell 读路径是 fail-closed：

```text
$ docker compose exec -T app sh -lc 'command -v bwrap || echo no-bwrap-in-container'
no-bwrap-in-container

$ docker compose exec -T app node /tmp/sandbox-probe.cjs
{
  "launcherPath": "/app/vendor/deepseek-harness/native/landlock-run/packages/linux-x64/bin/landlock-run",
  "launcherExists": false,
  "probe": "unusable",
  "prebuilds": "{ \"platform\": \"linux-x64\", \"binaries\": [ { \"tool\": \"landlock-run\", \"kind\": \"static-musl\", \"path\": \"bin/landlock-run\" } ] }"
}
```

（`prebuilds.json` 声明了二进制，但镜像里 `bin/landlock-run` 不存在，`probe()` 返回
`unusable`，`bash`/`terminal` 因此以 `SANDBOX_UNAVAILABLE` 失败关闭。）

已做的收紧：部署 patch 把 fallback 根钉到账号工作区父目录，未显式携带 cwd 的会话不再
回落到 `process.cwd()`（镜像里是 `/app`，整个源码树）或 `/etc`：

```yaml
- id: sandbox-policy
  config:
    mode: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'
    workspaceRoot: !!js dshHomePath('physicsos-users')
- id: fs-sandbox
  config:
    cwd: !!js dshHomePath('physicsos-users')
```

**残余风险（Stage 2 未解决，需要 harness 侧改动）**：

1. fs 工具（`read`/`list`/`stat`）没有任何读 allow-list，agent 仍能读同 UID 可读的一切
   ——`/run/secrets/*`、其他账号的 session 日志、`/proc/1/environ` 都在内。彻底关闭需要给
   `fs-sandbox` 增加 per-session READ fence，或让 agent 以独立 UID / 用户命名空间运行。
2. 不要把 landlock/bwrap runner 单独装回镜像：那会把 shell 读路径一起打开。要装就和读
   allow-list 一起做。

**当前学生产品边界**：`physics-student` 预设是一个显式 allow-list，只挂载
`tool-physicsos` 与 `tool-ask-user`，没有 fs / shell / web / subagent 行；
`preset-composition.spec.ts` 会对这个组合 fail-closed。上述通用 fs-sandbox
读取风险因此在当前学生和教师路径都不可达。未来若新增文件工具，必须先同时
实现 per-session READ fence，不能只加 preset 行。

### 7.3 会话绑定账号工作区（原 P0 第 2 条）

根因不在 auth-host。`packages/client/connection/src/rpc-host.ts` 的共享 `/api` 分发把
`dispatch` 写成无参闭包并直接 `fallback.fetch(request)`，**忽略了 `wrapFetch(next)` 交给它的
request**。后果是：response 改写生效（列表过滤看起来正常），而 request body 改写被静默丢弃。
在线上产物里加临时探针可见分支确实进入了，但宿主收到的 payload 仍是原样：

```text
app-1  | DIAG rewriteRequest session.create
app-1  | DIAG session-create-branch {"agentPreset":"standard","cwd":"/etc"}
# POST /api/session.create -> 200 {"result":{"ok":true,"value":{"sessionId":"session-...","agentPreset":"standard"}}}
```

修复（`overlays/harness/upstream-changes.patch`）：

```ts
const dispatch = (outbound: Request): Promise<Response> => {
  const endpoint = endpointFromPath(channel, new URL(outbound.url).pathname)
  …
  return fallback.fetch(outbound)
}
…
return active?.wrapFetch === undefined ? dispatch(request) : active.wrapFetch(dispatch)(request)
```

auth-host 侧保持“非管理员 `session.create` 一律改写为账号 workspace + `physics-student`”，
并新增两条 fail-closed 断言：

- 客户端传 `cwd: '/etc'`（连同 `workspaceId`/`sessionId`）时，到达宿主的是账号
  workspace + 学生预设；
- 宿主返回的 preset 若不是 `physics-student`，策略回 `session-scope-mismatch`（中文消息），
  而不是把一个越界会话认领成该账号的资源。

### 7.4 账号工作区标题与服务器文件系统暴露

1. **人类可读的工作区名**：harness 的 workspace registry 用目录 basename 命名记录，账号
   工作区因此显示成 `sha256(userKey)`。auth-host 在首次建立/接管工作区时把它
   durable 重命名为「我的工作区」（`workspace.rename`，用户已改过的标题不会被覆盖），
   并在账号自己的 `workspace.list` / `workspace.create` 视图里只暴露这个标题。每个账号
   （含管理员）都有自己的那一份：非管理员的 `workspace.list` 只列自己的工作区，管理员
   仍能看到完整 registry，但自己那条也带可读标题。`workspace.rename` 只允许改自己名下的
   workspace（跨账号是 `workspace-not-found`），路径始终由服务端决定、请求里不接受路径。
2. **服务器文件系统浏览**：`host.listDirectory` / `host.pickDirectory` /
   `host.createDirectory` 现在对所有角色默认 **403**（新增
   `hostFilesystemAccess: 'deny' | 'admin'`，默认 `deny`，错误码
   `HOST_FILESYSTEM_DENIED`，中文消息）。hosted 部署就是默认值：向导不需要目录选择器
   ——`session.create` 的 cwd 由服务端绑定到账号工作区。只有显式把
   `hostFilesystemAccess` 设为 `admin` 的单用户/自托管部署才保留该能力；那时管理员能
   看到的是 harness 进程所在的整台机器（容器内 `/app`、`/var/lib/physicsos`，包括
   `physicsos-users/<sha256>` 目录），仅建议在“运行者即机器所有者”的场景开启。

### 7.5 验证

本地（vendor 工作区，改动经 overlay 镜像）：

```text
$ tsc -b packages/physicsos/auth-host/tsconfig.json packages/client/connection/tsconfig.host.json --pretty false
TSC OK

$ vitest run packages/client/connection/tests packages/physicsos/auth-host/tests
Test Files  33 passed (33)
Tests       310 passed (310)

$ oxlint packages/physicsos/auth-host/src packages/physicsos/auth-host/tests \
    packages/client/connection/src packages/client/connection/tests
exit 0
```

补丁本身在干净 worktree 上的可应用性（等价于镜像构建路径）：

```text
$ git worktree add --detach /tmp/phy-vendor-verify HEAD
$ git apply --3way --whitespace=nowarn overlays/harness/upstream-changes.patch
apply exit=0
$ diff <working tree> <clean+patched tree>      # packages/client/connection/{src/index.ts,src/rpc-host.ts,tests/node-half.host.spec.ts}
MATCH
```

服务器侧（`root@38.76.190.3:/opt/physicsos`）：`docker compose config --quiet` 通过；secret
权限与 uid-1000 拒绝见 7.1；部署后 `session.create` 的 cwd/preset、`workspace.list` 标题与
公网 `/api` 授权边界的原始输出见下方。

**仍未验证**：真实模型回合。线上 DeepSeek key 返回 `AUTH 401`，因此“模型驱动 `read`/`bash`
去读 `/run/secrets/*` 是否被沙箱拒绝”无法端到端重测；7.2 的结论来自 runner 探测与源码
语义，不是模型行为。

### 7.6 secret 权限最终收紧（2026-09-27）

Compose 现在对 app、Postgres、Redis 的 file secret 都写显式 long syntax
`uid: '999'` / `gid: '999'` / `mode: '0400'`。Compose v5.5.1 对 `file:` secret
仍会提示 `secrets uid, gid and mode are not supported, they will be ignored`，
所以真正的不变量继续由宿主机上的 `scripts/deploy/secure-secrets.sh` 强制：

- secret 文件所有权改为 `999:999`；
- mode 改为 `0400`；
- 每次执行都验证 app 身份可读，且 `uid 1000` 身份不可读。

本轮已在服务器执行并取得下面这组只读证据（没有在服务器重建镜像）：

```text
$ cd /opt/physicsos
$ docker compose exec -T app id
uid=999(physicsos) gid=999(physicsos) groups=999(physicsos)

$ docker compose exec -T app sh -c \
    'ls -ln /run/secrets; for f in /run/secrets/*; do test -r "$f" || exit 1; done; echo app_read_all=yes'
total 24
-r-------- 1 999 999  10 ... admin_password
-r-------- 1 999 999 112 ... database_url
-r-------- 1 999 999  52 ... deepseek_api_key
-r-------- 1 999 999  68 ... image_api_key
-r-------- 1 999 999  65 ... model_pool_secret
-r-------- 1 999 999  87 ... redis_url
app_read_all=yes

$ docker compose exec -T -u 1000:1000 app sh -c \
    'if cat /run/secrets/model_pool_secret >/dev/null 2>&1; then echo uid1000_read=yes; exit 1; else echo uid1000_read=no; fi'
uid1000_read=no
```

`secure-secrets.sh` 的部署日志同时给出了 8 个宿主 secret 的 `999:999 400`
结果，并对 app 实际挂载的 6 个 secret 输出
`verified app-readable and uid-1000-denied for 6 secrets`。

### 7.7 账号工作区、rename 与服务器文件系统浏览

以下行为已经由本地 auth-host 单元/真实 Loader 组合测试覆盖：

- 客户端对非管理员 `session.create` 传 `cwd=/etc`、伪造
  `workspaceId`/`agentPreset` 时，宿主实际收到账号 workspace +
  `physics-student`；
- 普通角色与默认管理员调用 `host.listDirectory` / `pickDirectory` /
  `createDirectory` 全部返回 `403 HOST_FILESYSTEM_DENIED`；
- 学生和管理员跨账号 `workspace.rename` 都返回 `workspace-not-found`；
- 管理员重命名自己 workspace 后，再从 `workspace.list` 读回新 title；
- `workspace.create` 只接受 `physicsos-workspace://<title>` 产品虚拟路径，
  真实目录名仍由服务端生成，管理员也不能指定宿主路径。

**待集成阶段验证**：线上镜像尚未重建，因此会话 `cwd`/preset、rename
read-back、目录浏览 403 的公网原始响应需要在统一 overlay capture 后补测。

## 7. 模型链路修复记录（2026-09-26）

### 7.1 症状与根因

症状：真实回合在事件流里返回 `AUTH 401`（`Authentication Fails, Your api key:
****e4b2 is invalid`）。逐层排查后确认三个叠加问题：

1. 生产 secret 里放的是 `PHYSICSOS_MODEL_API_KEY`（sha256 前缀 `0ee633…`），该 key
   对 `https://api.deepseek.com` 与可用网关都返回 401；可用 key 是同机
   `~/.dsh/.env` 里的另一个变量（值不记录）。
2. base 组合的默认路由是 `deepseek-official` + `https://api.deepseek.com` +
   `deepseek-v4-flash`，与实际可用的 OpenAI 兼容网关（`deepseek-v4.1-flash`）
   不一致，即使 key 正确也会 `model_not_found`。
3. 顺带发现：compose 只设置了 `PHYSICOS_TRUSTED_HOSTS` 环境变量，却从未把它传给
   CLI 的 `--trusted-host`（该栅栏只认 CLI 参数），因此公网
   `https://physics.dongsiwei.com/api/*` 全量 `403 forbidden`，浏览器客户端卡在
   “正在加载工作区 / Loading plugins”。

### 7.2 修复内容（不含 auth-host / session / 客户端代码）

| 位置            | 改动                                                                                                                                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `compose.yml`   | 新增 `DEEPSEEK_BASE_URL` 透传（默认 `https://api.fengshao1227.com/v1`）；app 增加 `command:`，把 `${PHYSICOS_TRUSTED_HOSTS}` 作为 `--trusted-host` 传给 CLI                                                                              |
| 服务器 secret   | `/opt/physicsos/.env.deepseek_api_key` 换成对该端点有效的 key（`0644`，值不入库不入报告）                                                                                                                                                |
| 运行时 settings | `/var/lib/physicsos/settings.yaml` 使用 `llm-deepseek.models`（`deepseek-v4-flash`, 显示名「平台公益模型」）与 `agent-default-model`（`deepseek-official` / `deepseek-v4-flash` / `off`）；旧 `deepseek-v4.1-flash` 作为上游历史兼容型号保留，详见 `docs/13-DEPLOYMENT-OPERATIONS.md` §3.3 |

### 7.3 验证证据（命令与截断输出）

直连网关（服务器上、key 从 secret 读，不回显）：

```text
GET  /v1/models                -> http=200, 列出 16 个模型，含 deepseek-v4.1-flash
POST /v1/chat/completions      -> http=200, model=deepseek-ai/deepseek-v4.1-flash,
                                  finish=stop, content='pong', reasoning_content=64 字符
```

容器内真实回合（admin / `PHYSICSOS-OPEN`，先 `session.create` + `session.selectModel`
再 `session.prompt`，事件流取 `/api/events.mux`）：

```text
request/header   config={"provider":"deepseek-official","model":"deepseek-v4.1-flash",
                         "reasoningEffort":"high","maxTokens":32768}
assistant/chunk  {"type":"text-delta","index":0,"text":"pong"}
assistant/message {"role":"assistant","content":[{"type":"text","text":"pong"}],
                   "source":{"kind":"model","provider":"deepseek-official",
                             "model":"deepseek-v4.1-flash"}}
turn/end         {"reason":{"kind":"completed"}}
sessionStats     llmMs=12596 ttftMs=12486 decodeTokens=4
```

按账号配额计数（新注册学生 `quota_probe_muih6lk5`，STUDENT；SUPER_ADMIN 按设计豁免）：

```text
GET physicsos:limiter:model:877ce432… 回合前 -> (nil)   TTL -2
GET physicsos:limiter:model:877ce432… 回合后 -> 2       TTL 545
回合本身: turn/end {"kind":"completed"}，assistant text "ok"
```

公网 `/api` 信任边界（修复前 / 后）：

```text
POST https://physics.dongsiwei.com/api/host.describe
  修复前 -> 403 forbidden
  修复后 -> 401 {"error":"unauthenticated"}
```

### 7.4 结论与残留

**模型链路已通**：`deepseek-v4.1-flash` 在部署实例上返回真实内容（`pong` / `ok`），
不再是 `AUTH 401`；按账号模型计数确实增长（0 → 2，含会话标题辅助请求）。

残留与注意点：

- `SUPER_ADMIN` 不消耗按账号配额（事故处理豁免），验证计数必须用普通账号。
- `web_search` 工具仍用 `DEEPSEEK_API_KEY` 指向 DeepSeek 官方搜索端点，在第三方
  网关下不可用；本次未纳入修复。
- 网关自带敏感词过滤，命中时返回 `500 / new_api_error`（测试中英文短句可复现），
  真实教学提示词可能被拒，需要在上线前用真实题库采样验证。
- 本次 `compose.yml` 改动已同步到服务器并生效；因本机当时无法连通 github.com，
  尚未推送到远端 `main`（服务器工作区与该文件因此处于“本地已改”状态）。
