# 服务器发布流程

正式服务仍为 `https://physics.dongsiwei.com`，服务器为 `107.151.246.59`，项目目录为 `/opt/physicsos`。源码在 Git 中整合；构建、测试、候选验证和切换使用服务器 Docker。

## 正式更新

`deploy-server.sh` 仅用于首次安装，已有部署会拒绝再次运行。正式更新使用以下阶段：

1. 提交并冻结源码。`release-build.mjs project` 从指定 Git revision、固定 Harness submodule、上游补丁和 overlay 生成完整源码投影，含构建配置与测试，排除私密文件和生成产物。
2. 准备一次完整开发构建器。依赖、Node ABI、原生源码和构建配置共同确定缓存身份。正常通过 Dockerfile `--target builder` 建立；资源受限时仅接受经过验证的 runtime seed receipt，不能把 production 依赖目录当作完整开发环境。
3. `release.mjs build` 比较已发布源码与新源码，只同步 SHA256 变化及明确拥有的删除项，重建受影响包。共享声明目录和 buildinfo 成对保留；UI 插件的两半产物同时构建，静态入口未变时跳过 Vite。
4. `release-runtime.py` 仅复制与基础镜像不同的文件，合并为一个增量层；通过镜像中已有的 TypeScript 语法树识别真实运行时依赖，避免将正则、注释或字符串误判为导入；验证信任根、签名、代码文件摘要及 source/code 两种摘要。没有运行代码变化时返回 noop，不提升已发布基线。
5. `release-candidate.py` 在独立数据库、独立网络和私有 loopback 端口启动候选。CLI 日志不存储；候选网络与生产模型代理隔离。先验证容器/镜像/端口归属，再检查真实登录、账户范围及受保护读取。
6. 对候选完成相关功能与页面检查，推送并核对服务器 checkout/远端 main；使用私有发布计划执行 `release.mjs publish`。它与定时备份共用操作锁，在停机前完成镜像、配置、数据卷、writer lease、空间和 hook 前置检查，停写后再次复核。

常用入口不需要服务器安装宿主 Node：

```bash
cd /opt/physicsos
scripts/deploy/server-node.sh --prepare
scripts/deploy/server-node.sh --check
scripts/deploy/server-node.sh scripts/deploy/release.mjs build
scripts/deploy/server-node.sh scripts/deploy/release.mjs publish --plan-file .physicsos-release/publish.json
```

构建器名称保存在私有 `.physicsos-release/builder.json`，已发布源码基线保存在 `.physicsos-release/published-source.json`。第一次注册这些记录必须来自经过验证的构建器和当前实际镜像源码版本。`build` 支持显式 `--builder`、`--baseline-manifest`、`--revision` 和 `--output-dir`；构建失败不会提升发布基线。

运维入口使用独立环境，仅传入项目目录、工具 PATH 和明确设置的备份选项；应用镜像自带的运行时密钥路径不会覆盖服务器 `.env` 的 Compose 文件配置。候选容器的健康检查使用候选自身端口。Docker CLI 配置通过受控 `DOCKER_CONFIG` 放在工具容器独立的 `/tmp/physicsos-docker`，避免构建命令向只读 `/root/.docker` 写入；不继承宿主或镜像的 Docker 登录配置。

## 内存受限时的聚合类型检查

若原 `tsc -b tsconfig.host.json` 的根测试程序耗尽 JavaScript 堆，可使用 `scripts/deploy/typecheck-aggregate.mjs`。它先用同一 TypeScript 编译器检查所有原项目引用，再让每个独立缓存进程创建**同一完整聚合 Program**：原根文件、配置、项目引用和全局类型合并均不变，仅按文件分配待收集的诊断。所有源文件（包括声明文件）恰好覆盖一次；配置、语法、语义及声明诊断仍检查，`noCheck` 不得启用，不接受自定义局部配置或空程序。

每批核对整个源文件集合的摘要，失败、超时、输入改变或覆盖不足均拒绝最终通过。报告保留原直接聚合命令的失败，不把原命令的堆耗尽写成成功。新工具仍只在服务器既有完整开发依赖中运行，不安装或降低依赖信任策略。

```bash
node --expose-gc scripts/deploy/typecheck-aggregate.mjs \
  --root /app/vendor/deepseek-harness --config tsconfig.host.json \
  --output-dir /tmp/physicsos-host-aggregate-evidence --batch-size 96 --heap-mib 2048
```

## 发布计划和恢复

计划文件必须为私有普通文件，填写实际 image ID、预期旧 image ID、代码 revision、checkout revision、`sourceDigest`、`codeDigest`。登录验证通过既有 `usernameFile` / `passwordFile` 读取，期望角色与学校显式匹配；不要把密码或 Cookie 写入计划、终端、日志或仓库。

默认 paired 模式保留 PostgreSQL、gzip 应用数据与 Redis、原 `.env` / Compose、私有 0600 密钥恢复副本及文件摘要；应用停写持续到新镜像验收或旧镜像恢复完成。完整加密定时备份仍使用原 v1 格式。失效的前置条件在停机前拒绝；中断、部分 Docker 成功、备份或认证失败进入恢复。候选已经接收真实业务写入后，不自动用旧快照覆盖数据库。

### 可选 validation-worker 联动切换

不提供 `validationWorker` 时，原 app-only 切换、恢复策略和回执结构不变。只有新 app 确实需要同步升级生产 worker 时才启用；此扩展仅支持 `backup.mode: "paired"`，不接受任意 companions、服务或环境变量覆盖。

`plan.validationWorker` 必须恰好包含以下六个字段，全部必填；`null`、数组、缺字段、额外字段均拒绝：

| 字段 | 精确约束 |
| --- | --- |
| `service` | 固定字符串 `"validation-worker"` |
| `imageEnv` | 固定字符串 `"PHYSICSOS_VALIDATION_IMAGE"` |
| `expectedOldImage` | 旧 worker 完整 image ID：`sha256:` + 64 位小写十六进制 |
| `candidateImage` | 新 worker 完整 image ID，格式同上，必须不同于旧镜像 |
| `expectedOldContainerId` | 当前旧 worker 完整 container ID：64 位小写十六进制，不带前缀 |
| `inputsSha256` | 冻结 worker 输入清单的 SHA256：64 位小写十六进制，不带 `sha256:` 前缀 |

worker revision 不单独配置，必须与顶层 `plan.revision` 一致。主执行代理先从同一冻结源码编译新 worker，继承旧镜像的 `pwuser` 和全部非 label `Config`，仅追加一个 RootFS 层，再提供真实 image ID 和输入摘要；切换脚本不编译、不 pull、不生成镜像验证通过的假回执。候选镜像必须具备 `org.opencontainers.image.revision=plan.revision` 和 `io.physicsos.worker.inputs=inputsSha256`，平台、非 label Config、旧 RootFS 前缀及单层增量均严格核对。

停机前核对旧 worker 的完整 ID、完整旧 image ID、精确名称及 Compose project/service/container-number/oneoff 标签、运行与健康状态，以及 Compose 配置 hash。worker 必须以 `pwuser` 使用只读 rootfs，不得特权运行或挂载任何持久化可写路径、数据 volume；只允许只读普通文件 bind 和 tmpfs。生产 `.env` 必须为 0400 或 0600 私有普通 UTF-8 文件，已有且仅有一行 app image 和一行 worker image，其中 worker 值仍须为计划中的完整旧 ID。不得先改 `.env` 的 worker 值来绕过前置检查。旧容器若以旧 tag 字面值创建，只允许通过只读配置投影证明 hash 差异仅来自这一绑定的 image 字段；实际旧 image ID 仍须精确匹配，tag 不用于 up/pull。

仅当旧容器完整 CID 等于计划绑定的 `expectedOldContainerId`，且 daemon 的 `Image` 和容器 `Config.Image` 都等于完整旧镜像 ID 时，可兼容历史导入遗留的、格式合法但已过期的 Compose image 标签；其他配置仍受全部 guard 约束。新创建 CID 必须携带与本次实际镜像精确一致的标签。候选镜像如有 `io.physicsos.worker.source-digest`，必须等于顶层 `sourceDigest`，创建时显式保留；不能把任意来源标签变化加入豁免。该兼容与拒绝路径均有定向回归。

同时只读投影新配置，确保仅 app/worker 的两个 `image` 字段变化。固定 MAC 不在此最小 worker 扩展的支持范围：service-level `mac_address` 或任意逻辑 network 配置里的 `mac_address` 一律在停机前拒绝，包括逻辑 `default` 映射到实际 `physicsos_default` 的情况；ownership、创建参数与恢复配置校验也不允许该配置漂移，不尝试猜测逻辑/物理网络映射。原 `.env`、Compose、所有已声明 secret 文件、worker 只读 bind 文件及 seccomp 文件的内容/权限与运行配置在停机前、捕获后和恢复中继续受 guard 保护；不得豁免 worker 端口、token 环境变量/挂载、readonly、cap、seccomp、网络、其他服务或其他环境变量。比较在内存中完成，不输出完整 inspect/config、token 或环境变量。

worker 不再使用 Compose recreate。预检核对 Docker CLI 与固定 `/var/run/docker.sock` 的 daemon ID 一致并协商 Engine API 版本；只使用 Node 自带 HTTP Unix socket，不安装库。内存中保留已核验旧 worker 的完整 Config、HostConfig 和静态 NetworkingConfig。HostConfig 的唯一语义规范化是 `OomKillDisable`：缺省/`undefined`、`null`、`false` 均表示 OOM killer enabled，预检及后续 guard 拒绝 `true` 或其他类型；创建 payload 显式写 `false`，HostConfig 比较与 ownership 请求指纹只对此字段将缺省/`null` 归一为 `false`。所有其他 Config/HostConfig 字段继续完整比较，不丢字段、不引入通用 null/empty 等价，尤其不将隔离 probe 主动清空的 Volumes/Links/Mounts 纳入生产规范化。create JSON 只改变完整 Image ID、Docker 自动 hostname、上述 OOM enabled 的等价表达、OCI revision/inputs/已核验 source-digest、Compose image/config-hash 标签，以及两个本次唯一的 runtime-only 标签 `io.physicsos.release.operation` / `io.physicsos.release.create`；其他标签、Env/token、health、mount、cap、seccomp、只读选项及网络配置保持原 snapshot。不把 Config/Env 写入 argv、日志或创建脚本文件。

串行顺序固定为：停 app/Redis → 复核原身份/配置及 writer lease=0 → 一次捕获真实 paired 数据 → 原子 rename 新 `.env` → 核验并按**旧完整 CID** stop/rm worker → Engine `POST /containers/create` → 将 daemon 返回的完整 CID、operation/create nonce 和请求摘要先写私有回执 → inspect 该 CID、核对创建参数与 nonce → start 该 CID → 等精确新 worker 健康并严格复核运行配置 → 启动 Redis → app 原生 `compose up -d --no-build --no-deps --pull never --force-recreate app` → 原 readiness、lease 与真实登录/受保护读取验收。全部操作逐个 await，不能并发或另开 compose up，不 build、不 pull。新/回退 `.env` 仅替换两行，其他字节、CRLF、末尾换行策略及原 0400/0600 权限保留。

`release.json`、`paired-recovery.json`、`success.json` / `rollback.json` 的 `validationWorker` 记录旧/新完整镜像、输入摘要、原完整 CID、配置 hash、两个回滚 tag 引用，以及本轮 operation nonce；每次 create 另有唯一 nonce、已提交状态、请求 SHA256 和实际 daemon CID。CID 必须先私有持久化，再 inspect/start；**名称、时间窗、同镜像或同配置本身从不构成归属证明**。本轮已记录 CID 必须同时匹配其 nonce，不能被另一同时间创建的 foreign worker 替代或删除。只有未收到 CID 的已提交 create，才允许按该次 operation/create nonce 对唯一对象做受限归因，再先记录完整 CID；不凭名称或时间猜测。

创建态尚未分配 NetworkID、端口或挂载时，以请求中的 Config/HostConfig/静态 endpoints 校验，不与旧 running 态的分配结果做全等；任何已出现的 mount/endpoint 必须属于原请求。启动后恢复严格的原网络 ID、端口、mount 和运行配置 guard。私有 `.physicsos-release/validation-worker.json` 保存当前 CID、image、两个 nonce、配置 hash、完整标签摘要与创建请求摘要（无完整 Env）；下一次旧 worker 预检必须核对这些数据，nonce 缺失/漂移、其他标签或 HostConfig 漂移均拒绝，不能把 runtime-only 标签一概忽略。未由此流程管理的旧 worker 只允许无 nonce 且无矛盾 ownership 记录的原完整 CID。

失败仍先停 app/Redis，核对核心依赖、writer、lease=0、原配置/secret 与 nonce 归属 guard，再恢复旧 `.env`。只对原已核验 CID 或本次已持久化 CID＋nonce 的 worker 做 exact-CID stop/rm，以新 create nonce 通过同一 Engine API 恢复完整旧镜像，确认健康后才恢复原 app。明确拒绝且无创建对象的请求可恢复旧 worker；超时后没有唯一 nonce 对象、归因冲突、未知对象、配置/secret 漂移等均 operator-only，不再并发/猜测提交第二个 create，也不删除 foreign worker。旧 worker 或旧 app 恢复验收失败时保持/重新停止 writer 并记录异常回执。自动恢复只回退两镜像及 image 配置，不回灌 PostgreSQL、Redis 或应用数据，不覆盖新 app 已接收的业务写入。

由主执行代理在服务器现有工具准备好后执行以下 focused tests；这不是发布命令，不会调用真实 Compose 切换（测试注入 Docker fixture）。源码静态审阅不能代替服务器实测，结果须来自真实运行记录：

```bash
cd /opt/physicsos
scripts/deploy/server-node.sh --check && \
  scripts/deploy/server-node.sh --test --test-concurrency=1 scripts/deploy/release-switch.test.mjs
```

hook 默认关闭。需要一次性数据操作时，显式提供经过摘要验证的 `preflight` / `apply` / `rollback` argv；停机前只读检查与实际执行条件须一致，停写后再复验。学校清理、审核重排等业务操作不属于每次发布的默认步骤。

定时或手工 PostgreSQL 备份通过 `operation-run.mjs` 使用同一操作锁；完整备份也使用该锁。不能删除仍被活进程持有的锁。保留当前镜像、上一成功镜像及恢复点引用的镜像；仅清理有所有权和再生成证明的旧构建缓存，保留用户交互过的候选数据。

运维 Docker 使用相同的主机项目路径和 host PID 命名空间，停止宽限 900 秒以完成取消后的恢复；只挂载项目、Docker CLI/socket、已配置的 secret/备份目录，拒绝以宽泛的可写祖先目录覆盖生产 Docker 数据。
