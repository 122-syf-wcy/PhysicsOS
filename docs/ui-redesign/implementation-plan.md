# PhysicsOS 全站新 UI 实现与上线

## Context

用户要求按照本轮已确认的新 UI 全站改造、一比一复刻视觉，核查并合理复用现有素材／图标，必要时使用生图模型补充素材，完成后部署正式新版本。用户已明确授权：**独立 UI 分支分阶段提交，全部验收后合入并推送 main，再备份和切换上线；不强推、不改写历史，保留原有无关改动。**

视觉基准为[设计稿清单](/Users/dongsiwei/Desktop/PhysicsOS/design-refs/ui-redesign-2026-11-14/manifest.json)中的 **62 个页面、标签、覆盖层和重要状态**，优先采用 04、13、14、18、29、30、33、36、49、53、60 修订版。必须完成全部覆盖，不以少数页面换皮、静态截图或 Demo 代替。

复刻布局、配色、材质、间距和视觉层级；真实业务、权限、数据、单位与物理结果优先于生成图中的错字、错误选中态和占位内容。不把示例统计、评价或试卷直接搬到生产。

## 1. 保护工作区并建立集成基线

- 当前主仓库在 `codex/android-student-app`，有大量原有未提交改动及未跟踪视频／源码。记录 tracked/untracked/vendor 差异及归属，保留原文件；**不在此树 pull、stash、reset、全量 apply/capture**。
- 从实施时最新远端 main 建立**普通独立 clone，不创建 worktree**，使用专用 UI 分支。设计参考只读引用原目录，不把设计图和压缩包打进应用。
- 规划时实查 main 为 `6f2f0dcd`；服务器检出也已前进至该提交，但实际 app 与 published-source 仍为 `b50232a4`。实施及切换前重查三者，保留主线已加入的生成实验任务、检索、验证与修复闭环；不以旧页面覆盖新功能。
- 与其他会话协调共享补丁、Compose、构建器及发布操作。各业务模块可以并行实现，**补丁整合、Compose、正式构建与切换由同一负责人串行执行**。

## 2. 建立逐页映射和素材清单

维护 62 项验收矩阵：设计编号／推荐版本、真实入口、适用角色、组件、保留业务动作、实现状态、截图、自动测试和偏差说明。它们不是 62 条独立路由。

优先复用已核验资产：

- [品牌标志](/Users/dongsiwei/Desktop/PhysicsOS/overlays/harness/files/apps/web/public/physicsos/brand/physicsos-mark-128.png)及同目录不同尺寸版本。
- [玻璃吉祥物](/Users/dongsiwei/Desktop/PhysicsOS/overlays/harness/files/apps/web/public/physicsos/website/assets/mascot-glass.webp)：800×800、约 40KB，与新官网稿一致，默认无需重生图。
- [实验封面](/Users/dongsiwei/Desktop/PhysicsOS/overlays/harness/files/apps/web/public/physicsos/experiment-art)：78 张，共约 1.29MB；按需要选用，或复用已有简洁科学线稿。
- [物理图标体系](/Users/dongsiwei/Desktop/PhysicsOS/overlays/harness/files/packages/client/ui-physicsos/src/client/icons/physics-icons.tsx)：延续线宽、语义及 currentColor。三枚历史用户指定的导航 PNG mask 先保留不同语义，不擅删；不新增 AI 位图小字形。

生成机器可读 asset audit，记录来源、尺寸、字节、哈希、引用、分配页面及保留／衍生决定。新增大图默认零张，仅确有构图／透明度／清晰度缺口才有限补图并留提示词。玻璃由 CSS 实现，科学图形由真实引擎绘制。现有 LICENSE／NOTICE 表述差异只登记，不擅改许可或扩大授权。

## 3. 先统一设计系统与全局壳层

关键入口为 [chrome.ts](/Users/dongsiwei/Desktop/PhysicsOS/overlays/harness/files/packages/client/ui-physicsos/src/client/chrome.ts)、[产品注册入口](/Users/dongsiwei/Desktop/PhysicsOS/overlays/harness/files/packages/client/ui-physicsos/src/client/index.ts)、[SidebarNav.tsx](/Users/dongsiwei/Desktop/PhysicsOS/overlays/harness/files/packages/client/ui-physicsos/src/client/SidebarNav.tsx)，以及上游 [AppFrame.tsx](/Users/dongsiwei/Desktop/PhysicsOS/vendor/deepseek-harness/packages/client/ui-layout/src/client/AppFrame.tsx)所属布局模块。

- 扩展现有 chrome／ui-theme 语义 token：米白、深绿、鼠尾草、品牌蓝、玻璃边缘／模糊／阴影，保留深色模式和减少动效降级，不引入第二套组件库。
- 短悬浮导航同时修改 AppFrame 的栏宽计算，清除旧 264px 栏占位；顶部安置品牌、工作区、历史、设置和账户。更多菜单保留角色受限入口，手机采用不遮内容的适配布局。
- 移动现有 slot 的呈现位置，复用 RecentSpaces、账户／设置和原导航动作，避免重复注册、会话重建或手写订阅。
- 复用 `Modal/useModalLayer`、`Menu/MenuSurface`、定位／外点关闭、Tooltip、Toast、SettingsForm；浮窗优先扩展既有 FloatLayer，不另造窗口管理系统。
- 图标按钮有可访问名称及 Tooltip；菜单处理 Escape、焦点恢复、portal 和视口边缘。保留 macOS／Windows 顶栏安全距离、IME 和快捷键归属。新文案走现有 typed locale，新增 feature CSS 遵守 token 和字重 ≤500 约定。

先验收首页、对话、全幅实验台和一个后台页面的真实渲染，固定共用样式后再铺开其余模块。

## 4. 全量业务迁移

### A. 对话、导航、实验与资源

- 首页围绕输入展开；保留 Lexical 输入、图片／附件、草稿、IME、发送／停止及队列。历史改顶部抽屉，更多功能和账户菜单按设计组织。
- 对话右侧预览接既有 `sidebarRightTabs`／`sidebar.right.pane.tab`，与主实验共用状态，不建平行会话或 Agent Loop。
- [LabWorkspace.tsx](/Users/dongsiwei/Desktop/PhysicsOS/overlays/harness/files/packages/client/ui-physicsos/src/client/LabWorkspace.tsx)、[PhysicsWorkspace.tsx](/Users/dongsiwei/Desktop/PhysicsOS/overlays/harness/files/packages/client/ui-physicsos/src/client/PhysicsWorkspace.tsx)改为连续大场景，图像／快捷参数／对象与工具使用可收起、可移动且受视口约束的浮层；播放、缩放悬浮。
- 复用 PhysicsCanvas、CommunityWorkspaceCanvas、TimelineScrubber、InspectorTabs、QuantityField、[workspace-parts.tsx](/Users/dongsiwei/Desktop/PhysicsOS/overlays/harness/files/packages/client/ui-physicsos/src/client/workspace-parts.tsx)的图表和数据表。覆盖透镜独立分支、电路、社区实验及题目代码，不只改通用三栏 CSS。
- 保留逐帧通道／250ms 摘要、preview/commit/revision、原题恢复、记录与 ownerSession；保留新题目代码任务轮询、候选验证／修复、sceneHash、短期预览续期及失败重试。
- 完成实验中心、报告、资源库及详情、上传贡献；所有实验参数、单位、图表、验证状态来自真实数据。图表复用单轴／薄线／悬停／数据表，并校验双主题配色。

### B. 项目、自由画布、教学画板与出卷

- 在 StudyProjects、CanvasSurface/CanvasWorkspace、WhiteboardSurface/WhiteboardWorkspace/NativeEditor 中改造表现层，保留原入口、拖拽、选择、分组、撤销、器材／实验节点、导入导出和板书生成。
- 画布和画板全幅展示，工具与小型原图／助手悬浮；不改变账号隔离、CAS、版本冲突副本、离线草稿、保存重开及任务恢复。
- PaperWorkspace 覆盖新建、审核列表、逐题审核、定稿、PDF、题库、真题资料和导入核验全部状态；不删除校验／人工审核，也不新增平行出卷服务。

### C. 账户、反馈、设置、后台、官网与文档

- AuthGate 完成登录、注册、密码请求／重设、学校待审核回执；待审不能画成登录成功。设置延续 SettingsRoot 注册，普通用户模型配置只读。
- AdminWorkspace 复用 AdminPrimitives/AdminSectionTabs，完成全部 18 项后台视图。保留学校／角色范围、host guard、审批、确认、审计、版本冲突及缺加密时凭据禁写；不能因设计图省略而删入口。
- 官网管理保留真实反馈与截图查看、展示反馈、头像与贡献项目、排序及上下架、权限和持久化。绝不用 demos 静态后台替代。
- 正式[官网入口](/Users/dongsiwei/Desktop/PhysicsOS/overlays/harness/files/apps/web/public/physicsos/website/index.html)保持横向导航、真实公开反馈 API；开发文档改造共用模板并保留搜索、锚点、提示词／模板下载，不重写技术规范。

## 5. Overlay、构建与回归

[overlay 工具](/Users/dongsiwei/Desktop/PhysicsOS/scripts/overlay/harness-overlay.mjs)及[上游补丁](/Users/dongsiwei/Desktop/PhysicsOS/overlays/harness/upstream-changes.patch)是唯一同步途径。隔离 clone 中按明确文件清单投影／capture，审查差异，不能把其他任务的 vendor 游离文件收进补丁。验证可从冻结 commit 重建全部源码；宿主／客户端两半产物一起构建，入口摘要变化时按既有机制重签插件清单。

正式构建与测试在服务器 Docker；本机只做源码工作与浏览器验收，经 SSH 访问候选，不在 Mac 补装后端环境。

上线门槛：

1. 62/62 项均有实现和验证证据；1360×768 逐页对照推荐图，检查布局、材质、尺寸与间距；1440／1920 和约 390px 验证关键流程。动态内容不按错误像素硬抄。
2. 按匿名、学生、教师、校管、超管核验入口、学校范围与越权拒绝；空态、加载、失败、重试、未配置、确认和冲突均可达。
3. 服务器运行 `typecheck:web`、`typecheck:agent`、`lint:web`、相关宿主 lint、`test:web`、相应业务／部署测试、overlay 校验；上游壳层改动追加 `test:gui` 及 keyless replay。与未改部分有关的原有失败单列，不冒称通过。
4. 浏览器使用专用候选测试账号和合成数据，验证登录、完整对话、图片输入、生成实验验证闭环、播放／调参／保存重开、画布／画板、出卷／PDF、后台持久化、官网反馈附件及文档下载。测试写入只发生在隔离候选，不污染生产记录。
5. 保留真实截图、差异说明及交互录像；检查控制台、404、横向溢出、弹层焦点、遮挡、双主题及明显性能退化。P0/P1、权限错误、保存失败或无法解释的明显视觉偏差未清零不切换。

## 6. 可复现候选与正式发布

按[服务器发布流程](/Users/dongsiwei/Desktop/PhysicsOS/docs/deployment-release.md)及现有 `server-node.sh`、`release.mjs`、`release-candidate.py`、`release-switch.mjs` 执行，不另写绕过检查的发布捷径。

- 先核对操作锁、并行任务、空间和实际镜像；当前约 13GB 余量仍需覆盖构建峰值、备份、候选与回滚。旧 3094/3098 候选和未知归属容器不清理。
- 已注册构建器不存在，须重建与最新 lockfile、Node ABI、源码和配置匹配的完整 builder 收据；不把 production 依赖目录冒充开发构建器。
- 当前 main 的 validation-worker Dockerfile 有待核对的 `viewport`／`worker` COPY 与编译输入路径。确认真实构建 context 后在服务器证明能从冻结源码重建；与 UI 无关的修复单独提交说明，不因常驻 worker healthy 就跳过。保留新增 validation-worker／searxng 并验闭环健康。
- `release-build.mjs project`／`release.mjs build` 只读取真实提交，未提交改动不会进镜像；逐阶段提交后构建，保存 revision、sourceDigest、codeDigest 和精确 image ID，拒绝冒用旧 local tag。
- 候选使用独立数据库／schema／数据目录及私有端口，实际核验挂载、网络和 writer lease，不因文档写“隔离”便假定隔离。现有候选复用生产 bridge，须证明没有生产可写卷、生产数据写入或错误模型代理连通。经 SSH 隧道完成真实浏览器验收。
- 全部验收通过后，再核对并整合 main 新进提交、推送、同步服务器 checkout，重新验证精确发布提交；已有授权不等于允许覆盖别人后续提交。
- 发布前做隔离恢复演练；私有 0600 计划引用新旧镜像、代码／checkout revision、两种 digest、实际回滚兼容性及凭据文件，不记录秘密。
- 单执行者取得与备份共用的操作锁，停写后复查并取得 PostgreSQL／app_data／Redis／原配置与私有密钥的 paired 恢复点，再切换。SSH 中断先核对任务和回执，不重复并发 `compose up -d`。
- 切换后核验精确运行镜像、healthz/readyz、唯一 writer、认证读取及关键流程：应用 `https://physics.dongsiwei.com`，官网 `https://physicsos.dongsiwei.com`，开发文档仍在系统域的既有入口。
- 失败按既有脚本恢复旧镜像并验收；**不自动用旧快照覆盖切换后已经接收的新业务写入**。保留旧镜像、恢复点、发布回执和验证记录。

## 交付

完整可运行的新 UI、资产复用清单、62 项覆盖与截图对照、通过／失败／跳过的真实测试记录、已推送的可追溯代码版本，以及新旧镜像／备份／回滚信息。分模块实施但不把半套界面当作本次完成版上线。
