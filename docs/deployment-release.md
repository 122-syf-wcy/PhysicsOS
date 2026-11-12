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

## 发布计划和恢复

计划文件必须为私有普通文件，填写实际 image ID、预期旧 image ID、代码 revision、checkout revision、`sourceDigest`、`codeDigest`。登录验证通过既有 `usernameFile` / `passwordFile` 读取，期望角色与学校显式匹配；不要把密码或 Cookie 写入计划、终端、日志或仓库。

默认 paired 模式保留 PostgreSQL、gzip 应用数据与 Redis、原 `.env` / Compose、私有 0600 密钥恢复副本及文件摘要；应用停写持续到新镜像验收或旧镜像恢复完成。完整加密定时备份仍使用原 v1 格式。失效的前置条件在停机前拒绝；中断、部分 Docker 成功、备份或认证失败进入恢复。候选已经接收真实业务写入后，不自动用旧快照覆盖数据库。

hook 默认关闭。需要一次性数据操作时，显式提供经过摘要验证的 `preflight` / `apply` / `rollback` argv；停机前只读检查与实际执行条件须一致，停写后再复验。学校清理、审核重排等业务操作不属于每次发布的默认步骤。

定时或手工 PostgreSQL 备份通过 `operation-run.mjs` 使用同一操作锁；完整备份也使用该锁。不能删除仍被活进程持有的锁。保留当前镜像、上一成功镜像及恢复点引用的镜像；仅清理有所有权和再生成证明的旧构建缓存，保留用户交互过的候选数据。

运维 Docker 使用相同的主机项目路径和 host PID 命名空间，停止宽限 900 秒以完成取消后的恢复；只挂载项目、Docker CLI/socket、已配置的 secret/备份目录，拒绝以宽泛的可写祖先目录覆盖生产 Docker 数据。
