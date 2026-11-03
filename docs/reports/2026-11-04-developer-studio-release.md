# 开发者界面美化与发布记录

状态：界面实现与候选浏览器验收完成，正在进行正式镜像、PostgreSQL 候选验证和上线。用户本轮明确授权美化、生图、GitHub 提交和正式部署。

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

打包检查发现构建容器中三条临时/错误依赖链接（根目录 eslint、根目录及 experiment-host 的 zod），在制作镜像前修正。Zod 固定使用已安装的 4.6.7，需比对临时与正式位置内容并通过真实镜像启动检验。测试数据、生成凭据、缓存、.git、.env 文件均不进入增量包。

预检数据库备份已通过 `pg_restore --list`：`/opt/physicsos/backups/postgres/20261104-studio-preflight`。候选 PostgreSQL 使用单独数据库 `physicsos_studio_20261104`；正式数据库不用于验收写入。最终镜像、切换恢复点、GitHub 提交和 HTTPS 验收待本记录补齐。
