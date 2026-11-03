# 凸透镜实验文件贡献闭环交接

## 交付状态

开发分支 `codex/experiment-contribution` 已接通独立 ZIP 上传、平台管理员预览与审核、自动展示、历史版本和回滚。真实浏览器已完成整个流程，候选重启后默认版本与冻结资源保持一致。最终功能修复提交为 `a7bea9a`，独立复核四项发现全部关闭、无新增问题。生产站点尚未切换；本报告不表示已经构建或发布正式生产镜像。

本轮沿用旧聊天 `01a19b48-eea2-7163-8489-3b8e017e3af3` 的配置和用户选择：独立实验路由、纯三维、Warm Lab、文件投稿、最新审核版作为新会话默认、作者署名。用户再次确认服务器为 `107.151.246.59`，原 `38.76.190.3` 已废弃；两个工作区的 AGENTS.md 均已同步。

源码工作区：`/Users/dongsiwei/.codex/worktrees/experiment-contribution/PhysicsOS`。原工作区 `/Users/dongsiwei/Desktop/PhysicsOS` 的其他题目/试卷改动保留，未混入本分支。构建、测试和浏览器验收均在服务器 Docker 中完成，本机仅编辑源码与整合 Git。

## 用户可用流程

1. 从开发者文档下载独立实验模板，在模板内安装、开发、构建并打包。模板源码 ZIP 与实际上传的构建 ZIP 是两种产物。
2. 登录后打开 `/#/experiments/convex-lens`，点击“贡献实验”，上传构建 ZIP、作者名、简介、GitHub 主页、可选头像和修改说明。
3. 平台管理员在同一面板下载冻结的原始 ZIP 核对源码、许可证与案例，并预览真实三维运行结果，然后通过并发布或填写理由退回。下载内容与批准所用 SHA-256 一致。学校管理员没有替换全站实验的权限。
4. 新打开的实验自动使用最新通过的版本；已打开或保存的实验保留自己的版本。官方场景也有明确身份，首次社区发布不会替换历史官方记录。
5. 平台管理员可回滚到此前通过的版本。历史公开版本可由其他登录用户预览，无需作者的私有预览权限。

平台继续拥有参数、真实光学引擎、测量记录、报告和身份服务；投稿包承担三维视图。公开快照传递物高、像/光线显示开关、真实引擎的光线路径与虚线延长线，模板直接绘制这些事实。包向平台发送的参数意图仍仅限物距、焦距、光屏距离三项。当前只接受凸透镜 `convex-lens`、`browser-static`、protocol v1、optics contract v1、Three.js、`physicsos-warm-lab-v1`，入口固定为 `dist/index.html`。

## 配置与持久化

生产基线在本轮验收时重新核对：

| 项目 | 值 |
| --- | --- |
| 正式入口 | https://physics.dongsiwei.com |
| 服务器与源码 | `107.151.246.59`，`/opt/physicsos` |
| 远端 main 与服务器 HEAD | `33023a2c8d708c84fdf14210e7be9fcc7c8c363c` |
| 运行容器 | `physicsos-app-1`，healthy |
| 运行镜像 | `sha256:45c40254bef05b8218c586a538c45f246a653da2a8ebdbe210c31455271b95b8` |
| 应用持久化目录 | `DSH_HOME=/var/lib/physicsos`，volume `physicsos_app_data` |
| 元数据 / 共享状态 | PostgreSQL / Redis |
| 可信主机 / 代理 | `physics.dongsiwei.com` / `172.18.0.1` |

运行容器的 `/app` 没有额外文件改动。没有修改生产代码、账户、数据或 Nginx，也没有切换镜像。

新宿主默认把包存到 `dshHomePath('experiment-packages')`，正式配置对应 `/var/lib/physicsos/experiment-packages`，在现有持久化卷内。版本和默认指针保存在 `physicsos_experiments` storage-domain。可配置 `packagesRoot` 与 `assetOrigin`；后者只改变资源 origin，不自动创建独立服务或代理。当前发布协调面向单个应用进程。

## 候选环境与继续验证

- 容器：`physicsos-experiments-build`，源码 `/app`，Node 24.7、pnpm 11.7，Chromium Headless 151。
- 应用地址：容器内 `http://127.0.0.1:3095`。这是隔离候选端口，不是正式公开入口。
- 当前候选数据：`/tmp/physicsos-contribution-review-20261103-d`，独立 JSON 存储和本地模型 fixture，不连接生产数据。此前 c 数据保留为修复前的验收记录，进程已停止。
- `preview.json` 记录候选进程与地址；`acceptance-result.json` 记录验收默认包 ID/SHA。测试密码与日志只在该私有目录中读取，不写进报告、聊天或版本库。
- 验收发布过 `1.0.0` 和 `1.1.0`，已回滚到 `1.0.0`；`1.1.0` 保留在历史中。
- 当前默认包为 `exp_8e66b68aaef29bf87354b507a47b85b4`，SHA-256 `b3153b9a6ed03d7fe821711f226c8c4b230b43f08926ce6b568b1724925abacc`。

候选启动命令（启动前先确认端口和 `preview.json` 进程，避免重复启动）：

```sh
docker exec \
  -e PHYSICSOS_CONTRIBUTION_PREVIEW_HOME=/tmp/physicsos-contribution-review-20261103-d \
  physicsos-experiments-build \
  sh -c 'cd /app && node scripts/developers/start-contribution-preview.mjs'
```

重启后只读持久化检查：

```sh
docker exec \
  -e PHYSICSOS_CONTRIBUTION_PREVIEW_HOME=/tmp/physicsos-contribution-review-20261103-d \
  physicsos-experiments-build \
  sh -c 'cd /app && node tests/acceptance/experiment-contribution.mjs --check-persistence'
```

完整验收脚本去掉 `--check-persistence`；它会写入测试包和账号，必须使用新的独立候选 home，不能对生产执行。

## 验证证据

| 检查 | 实际结果与范围 |
| --- | --- |
| 完整 UI 单元套件 | 85 文件、1072 测试通过；在最后两轮针对性修复之前运行 |
| 官方身份 / 公开预览回归 | 17/17，通过；新增回归先失败后修复 |
| 登录状态 / 审核面板回归 | 30/30，通过；覆盖 Hook 顺序、审核后即时反馈与预览保留 |
| 宿主完整套件 | 6 文件、73/73，通过；包含 ZIP、权限、并发、故障恢复、真实 Cordis 组合；在最后的归档下载修复之前运行 |
| 最终修复回归 | 关联范围 11 文件、44/44；最终代码 6 文件、33/33；覆盖真实 Three 几何/图层、取消与正常提交、归档权限/摘要/篡改 |
| 宿主 lint | 17 文件、90 规则，零错误、零警告 |
| 类型与构建 | 最终宿主、UI tsc 和 tsdown 通过；Vite Web 构建通过；最终变更文件的 UI ESLint、宿主 Oxlint 无错误 |
| 锁文件 | `pnpm install --lockfile-only --offline --frozen-lockfile --ignore-scripts` 通过 |
| 代理配置 fixture | 新路由、32 MiB 请求体、iframe 头部、Cookie 隔离、重复执行一致性通过 |
| 新脚本 | Node 语法检查及适用 ESLint 检查通过 |
| 开发文档 | 12 路由、搜索、复制、下载、无效 ID、目录跳转和移动端浏览器验收通过 |
| 下载一致性 | 14 文档/Schema、24 文件风格包、47 文件独立模板经生成器检查一致 |
| 实际模板上传产物 | 36 文件，2,095,226 字节，宿主验证通过 |
| HTTP 实际下载 | app.js、风格 ZIP、源码模板 ZIP 与生成文件 SHA-256 完全一致 |
| 最终独立复核 | 4/4 ADDRESSED，零遗留、零新增问题 |
| 重启持久化 | 候选 `/readyz` 200；默认 ID、SHA 和冻结入口资源保留 |

完整真实浏览器验收输出：

```text
PASS: real upload, sandbox preview, approve, exact authenticated review archive, height/image/ray controls, Escape cancellation, engine bridge, pinned session, fresh default, rollback, mobile, external/same-host navigation containment
PASS: release state and frozen assets survive candidate restart
```

完整流程还验证了：头像上传、官方历史场景恢复、物距 15 cm / 焦距 10 cm 由真实平台引擎得出像距 30 cm、物高改为 9 cm 时像高为 -18 cm、实际画面的高度及像/光线开关变化、Esc 保留原物距及修订号、观察记录、另一用户预览公开版本、作者/管理员下载精确原 ZIP、匿名和其他作者无法下载、拒绝私有预览和审核越权、恶意外部及同主机跳转均无目标请求、直接原始 HTML 返回 403。正常页面无 console.error 或 pageerror。桌面 1440×1000 与移动端 390×844 无横向溢出。

最终源码模板下载 ZIP 为 111,469 字节，SHA-256 `d97ae9172ffa9ad193f2b38520aff7569012a3bace086620bbc0797d4974e188`；模板直接构建出的上传 ZIP 为 `0917fc64b38a5f0b849265171380d3eeb8731700def7bc53b3c09c93f267bfd8`。浏览器验收为识别两版额外写入测试标记，因此其已发布 ZIP 摘要与未加标记的模板产物不同。

未重新安装整套主站依赖；使用既有隔离依赖树。锁文件解析时补齐过一个缺失的既有 SheetJS 缓存文件。原有 vite-tsconfig-paths 弃用提示仍存在。原生子模块保持固定提交 `477b4f4205`，现有 patch 的 56 个路径及旧补丁新增文件均保留，未提交新子模块指针。

## 边界与实现决定

- 全站审核限 `SUPER_ADMIN`，所有已登录账号可投稿。代价是学校管理员需请平台管理员发布。
- 凸透镜纯三维，无二维切换或 WebGL 失败时的二维降级；无法使用 WebGL 时保留参数和记录并显示状态。
- 上传 ZIP 上限 20 MiB，展开 40 MiB，单文件 20 MiB，最多 1000 条目。服务器不执行贡献代码或安装脚本。
- 主站加载平台可信外层，上传代码只在内层 `allow-scripts` 不透明 iframe 中执行。外层同源能力仅用于受控 MessagePort 转交；原始 HTML/SVG 导航受 Fetch Metadata 与 CSP 限制。
- 元数据写入失败后保留已冻结文件并封锁不确定状态，可能留下孤立文件。多项 I/O 同时失败可能连恢复标记也无法写入；重启可能采用有效的新版本。失败响应不能证明发布未发生，恢复后要刷新服务器状态再决定重试。
- 修正原有登录界面把注册邮箱放错位置的问题，以及登录状态转换造成的 Hook 顺序错误；否则真实贡献登录流程无法稳定使用。
- 在原五条业务路由外增加 `GET /physicsos/experiments/packages/:id/archive`，仅作者或 SUPER_ADMIN 可下载。读取时验证文件和 SHA-256，返回 attachment/no-store/nosniff；源码不进入公开 dist 资源接口。这项补充使人工审查能访问与批准摘要一致的文件。
- 最终审查发现的三维控件遗漏、Esc 意外提交与审核材料不可取得均已修复；过时的“上传未启用”文案同步更新。最终复核仅检查这些修复，未重新扩展范围。
- 模板是可运行的三维起点；静态校验不证明源码与 dist 对应，也不代替人工教学/物理审核或真实设备性能测试。本轮不承诺真实手机 FPS、多进程发布或其他实验已支持投稿。

## 正式发布前的剩余操作

重新比较远端 main、服务器检出和实际镜像，整合届时新增功能；用服务器 Docker 构建完整候选镜像，并以生产相同 PostgreSQL/Redis 配置和独立数据再做发布验收。现有验证没有把 JSON 候选等同于正式镜像验收。

发布时备份 PostgreSQL、`physicsos_app_data` 及恢复日志，保留当前镜像与恢复点。应用 `scripts/deploy/install-nginx-security-headers.sh` 的实验路由配置，在真实 TLS 代理后检查请求体限制、CSP、X-Frame-Options 和无凭据资源加载，再执行切换与回滚检查。该脚本已验证 fixture，尚未应用于生产。

## 界面记录

![已发布实验桌面总览](screenshots/experiment-contribution/overview-desktop.png)

![已发布实验移动端总览](screenshots/experiment-contribution/overview-mobile.png)

其余真实验收截图位于同目录：`review-desktop.png`、`published-desktop.png`、`published-mobile.png`。
