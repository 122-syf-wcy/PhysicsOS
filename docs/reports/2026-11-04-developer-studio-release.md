# 开发者界面美化与发布记录

状态：2026-11-04 已完成界面、生图、候选与正式站点验收，已上线并推送 GitHub main。用户本轮明确授权美化、生图、GitHub 提交和正式部署。

## 界面与素材

- 后台“开发提示词”：当前发布版概览、草稿编辑、完整预览、发布历史分区；带图标的玻璃按钮，中文 Markdown 文件选择入口，统一高度、焦点和禁用状态。保存草稿/手动发布、版本和固定模板绑定语义保持不变。
- 实验上传：IP 页头、三个开发资源卡片、分组表单、投稿与审核记录。ZIP/头像仍由原生文件选择器选择，但操作入口采用统一玻璃控件。
- 公开开发者页：提示词表单、复制/下载、文档工具栏及下载列表统一圆角、玻璃材质和排版。
- 用户指定的 `gpt-image-2.5-sunburst` 服务生成一个角色新姿态及三枚玻璃图标。沿用原有女孩和灰色虎斑小猫身份，装饰图片不替代状态和可访问文字。原始图已检查；五份网页 WebP 共约 100 KB，附透明边缘。提示词和来源记录在 `overlays/harness/files/apps/web/public/physicsos/developers/assets/studio/`，无凭据。

## 验证

全部构建与测试在 `107.151.246.59` 的 Docker `physicsos-experiments-build` 内执行，本机只编辑源码和 Git。

| 项目 | 结果 |
| --- | --- |
| 最终 UI 类型、定向 lint、UI bundle、Vite | 通过，lint 0 error / 0 warning；Vite 仍有已有大块提示 |
| 提示词、管理壳层、上传面板、上传入口组件 | 14/14 通过 |
| 公开开发者文档浏览器 | 7/7 通过：加载、错误/空响应、重试、任务保留及下载 |
| 真实提示词全流程 | MD 选择/导入/编辑、草稿/发布、公开复制/下载一致、旧链接、模板摘要、历史回滚、冲突保留编辑、权限、惰性 HTML、手机、console 均通过 |
| 真实投稿全流程 | 学生 ZIP 选择/提交、错误指引、管理员预览/审核/下载、刷新历史、延迟同步导航、实验内弹窗、手机和 console 均通过 |
| 视觉和键盘 | 桌面/390px 手机/深色截图；图片实际加载；Enter 打开 Markdown 选择器；无横向溢出或 pageerror |

服务器日志：`/tmp/physicsos-studio-final-checks.log`、`physicsos-studio-docs.log`、`physicsos-studio-prompts.log`、`physicsos-studio-upload.log`、`physicsos-studio-screens.log`。截图位于 `docs/reports/screenshots/developer-studio/`。

默认上游 Vitest 配置在 jsdom 启动阶段外部化 Node 模块，未收集到用例；改用上一轮已有的 `task2-client.config.ts` 原生 Web 测试配置后通过。原提示词验收点击旧文件输入框，已更新为新按钮；正文明确设置 aria-label，避免隐式 label 混入正文内容。没有放宽行为断言。

## 发布准备

GitHub main 与服务器 `/opt/physicsos` 检出均为 `33023a2`，它是本开发分支的祖先；实际生产镜像 `45c40254bef05b8218c586a538c45f246a653da2a8ebdbe210c31455271b95b8`（`physicsos-app:candidate-33023a2`），healthy。服务器仅有未跟踪的 backups/，原本机工作区和 vendor 指针保留。

清理可重建的 24 小时以前 BuildKit 缓存，释放 2.577 GB；保留所有生产/回滚镜像、数据卷和源码。运行文件清单对比采用实际现网镜像作为基础，增量约 65 MB，包含新功能的程序、浏览器产物和依赖，保留旧哈希资源。

打包检查发现构建容器中三条临时/错误依赖链接（根目录 eslint、根目录及 experiment-host 的 zod），在制作镜像前修正。Zod 固定使用已安装的 4.6.7，已比对临时与正式位置内容并通过真实镜像启动检验。测试数据、生成凭据、缓存、.git、.env 文件均不进入增量包。

预检数据库备份已通过 `pg_restore --list`：`/opt/physicsos/backups/postgres/20261104-studio-preflight`。候选 PostgreSQL 使用单独数据库 `physicsos_studio_20261104`；正式数据库不用于验收写入。最终镜像、切换恢复点、GitHub 提交和 HTTPS 验收见下文。

## 镜像与 PostgreSQL 验证补记

候选镜像 `physicsos-app:studio-32adcc1`，ID `sha256:d6f608e5a37ccbb45b0034e8064a67670045818d34ca96111001122f2885e061`。基础镜像标签 `physicsos-app:studio-base-33023a2` 保留。实际增量 3,305 项、64,588,670 字节。

已在新镜像内逐项验证 3,260 个文件的 SHA-256，以及 45 条改变链接的精确目标、存在性和最终 /app 内解析路径；原生 flock 实际获取文件锁成功。Zod 临时依赖与正式 pnpm 4.6.7 目录逐文件内容摘要一致，再改为正式相对链接。

候选容器 `physicsos-studio-candidate` 使用由生产备份恢复的独立数据库 `physicsos_studio_20261104`、独立文件目录和 memory 共享状态。完整提示词浏览器验收在该镜像和 PostgreSQL 副本上再次通过（`/tmp/physicsos-studio-postgres-browser.log`），没有向正式数据库写入验收内容。测试脚本支持 `PHYSICSOS_ACCEPTANCE_ADMIN` 选择候选账号，不改变默认测试账号或产品逻辑。

独立审查范围 `fb56e23..32adcc1`，报告见 [审查记录](2026-11-04-developer-studio-review.md)：可合并，无 Critical/Important。一项 Minor 指出宿主上的链接比较本身不证明最终镜像链接完整性，已以上述容器内逐项验证补齐发布证据，没有将初步检查夸大为完整依赖证明。审查范围外的旧 V2/业务逻辑继续采用已有验收记录；正式切换和 HTTPS 验收由本轮执行者完成；不声称全量从零构建的逐字节可复现或全仓库审计。

候选镜像真实重启后，PostgreSQL 中的当前版本、历史和草稿与验收存证一致（`/tmp/physicsos-studio-postgres-persistence.log`，通过）。最终依赖检查和候选验证均已完成，随后正式切换通过。


## 正式发布结果

- 正式入口：<https://physics.dongsiwei.com>；开发者文档：<https://physics.dongsiwei.com/physicsos/developers/index.html>。
- GitHub `main` 与 `codex/experiment-contribution` 原子快进推送成功：`33023a2 → a4a629c`，包括本分支此前的实验上传/审核/自动展示、V2 格式和提示词后台管理。运行代码提交为 `32adcc1`；后续提交只补测试配置和交接记录。
- 服务器 `/opt/physicsos` 已同步。实际运行 `physicsos-app:studio-32adcc1`，镜像 ID 与经过 PostgreSQL 验收的候选完全一致；`physicsos-app:local` 已指向同一镜像。app/postgres/redis 全部 healthy。
- nginx 更新了实验上传 32 MB 请求上限及实验资源 iframe 规则，保留原出卷预览 SAMEORIGIN 规则；`nginx -t` 通过。
- 正式 HTTPS 真实浏览器：管理员提示词界面与 ZIP 上传入口可见，图片加载正常；匿名管理 API 401，管理员读取成功；当前 MD 与公开正文一致，模板真实字节摘要匹配；会话 Cookie Secure/HttpOnly；出卷预览 SAMEORIGIN 与实验资源无继承 DENY 均通过；手机文档无横向溢出，无 pageerror。未在生产上传测试实验或发布测试提示词。
- 最终日志：服务器 `/tmp/physicsos-studio-production-smoke.log`。部署验证未调用真实出卷或模型生成任务，不代表对无关业务的全量回归。GitHub Actions 状态未读取（本机 gh 未认证），不作 CI 通过声明。

## 恢复点与保留项

切换时仅停止 app；数据库和 Redis 保持运行。在 app 停止后生成并校验以下恢复点，再启动新镜像：

| 恢复内容 | 服务器位置 |
| --- | --- |
| 切换前镜像 | `physicsos-app:rollback-studio-20261104`，ID `45c40254bef05b8218c586a538c45f246a653da2a8ebdbe210c31455271b95b8` |
| 切换前 PostgreSQL | `/opt/physicsos/backups/postgres/20261104-studio-switch/postgres.dump`，约 473 KB，已验证 archive TOC |
| 切换前文件 | `/opt/physicsos/backups/releases/20261104-studio/app-data.tar.gz`，约 16 MB，已验证目录与 SHA-256 |
| nginx、Compose、环境配置及版本记录 | `/opt/physicsos/backups/releases/20261104-studio/`，仅管理员可读 |
| 候选构建上下文、文件清单及隔离数据 | `/opt/physicsos-previews/studio-release-20261104/` |

实际 secret 文件继续由既有挂载提供，抽查权限为 `0400 / 999:999`。Compose 对非 Swarm secret uid/gid/mode 的提示是已知行为，文件自身权限没有放宽。保留原工作区和开发分支，不提交 vendor 指针。候选测试容器在验收后停止，恢复资料保留。

镜像回滚可在 `/opt/physicsos` 使用 `PHYSICSOS_APP_IMAGE=physicsos-app:rollback-studio-20261104 docker compose up -d --no-deps --no-build --wait app`，并将 `physicsos-app:local` 标签指回该镜像。数据库和文件恢复点分别保留；本次没有执行数据回滚。
