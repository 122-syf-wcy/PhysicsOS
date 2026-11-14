# PhysicsOS 62项UI映射与验收矩阵

源码：`/Users/dongsiwei/Desktop/PhysicsOS-UI`。该文件仅为源码入口研究，**所有62项均待验收**，未将组件存在、样式改动或设计图当作完成证据。截图、测试及部署证据尚为空。

角色：登录用户=学生/教师/校管/超管；教学角色=教师/校管/超管；管理员=校管/超管。前端入口限制仍需服务端越权测试。

| 编号 | 设计/页面 | 真实入口/状态 | 角色 | 组件 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 1 | 首页与新建对话 | 首页 → 新对话；home = layout.selectPanel(null) | STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `HomeHero.tsx`, `HomeBrand.tsx`, `HomeActions.tsx`, `index.ts` | 待验收 |
| 2 | 对话与实验预览 | 已有对话 → 实验卡片/右侧实验预览（sidebar.right.pane.tab） | STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `SceneChatCard.tsx`, `SceneTurnCard.tsx`, `PhysicsWorkspace.tsx`, `index.ts` | 待验收 |
| 3 | 实验中心 | 实验导航 → physicsos-lab；#/experiments | STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `LabWorkspace.tsx`, `ExperimentPicker.tsx`, `experiments/experiment-navigation.ts` | 待验收 |
| 4 | 全幅实验运行台 | 实验中心选模板；#/experiments/<template-id>（可带scene查询） | STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `LabWorkspace.tsx`, `PhysicsWorkspace.tsx`, `physics/PhysicsCanvas.tsx` | 待验收 |
| 5 | 实验报告 | 运行台 → 实验报告（reportOpen） | STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `ExperimentReportPanel.tsx`, `physics/experiment-report.ts`, `PhysicsWorkspace.tsx` | 待验收 |
| 6 | 项目列表 | 项目导航 → physicsos-projects | STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `StudyProjects.tsx` | 待验收 |
| 7 | 实验自由画布列表 | 画布导航 → physicsos-canvas；#/canvases | STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `canvas/CanvasSurface.tsx`, `canvas/navigation.ts` | 待验收 |
| 8 | 全幅自由画布编辑器 | 画布列表 → 画布；#/canvases/<id> | STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `canvas/CanvasWorkspace.tsx`, `canvas/CanvasSurface.tsx`, `canvas/navigation.ts` | 待验收 |
| 9 | 教学画板列表与空态 | 教学画板导航 → physicsos-whiteboard；#/whiteboards | STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `whiteboard/WhiteboardSurface.tsx`, `whiteboard-entry.tsx`, `canvas/navigation.ts` | 待验收 |
| 10 | 出卷：新建试卷 | 出卷专区 → physicsos-paper → tab=new / NewPaperPanel | TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `PaperWorkspace.tsx` | 待验收 |
| 11 | 出卷：草稿与审核列表 | 出卷专区 → tab=jobs / JobsPanel | TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `PaperWorkspace.tsx` | 待验收 |
| 12 | 出卷：逐题审核 | 出卷专区 → jobs → JobDetail | TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `PaperWorkspace.tsx` | 待验收 |
| 13 | 出卷：已定稿试卷 | 出卷专区 → tab=final / FinalPanel | TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `PaperWorkspace.tsx` | 待验收 |
| 14 | 出卷：题库与导入 | 出卷专区 → tab=bank / BankPanel | TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `PaperWorkspace.tsx` | 待验收 |
| 15 | 出卷：真题资料库 | 出卷专区 → tab=sources / SourcesPanel | TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `PaperWorkspace.tsx` | 待验收 |
| 16 | 提交反馈 | 反馈导航 → physicsos-notice → tab=new | STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `NoticeBoard.tsx` | 待验收 |
| 17 | 物理资源库 | 资源库导航 → physicsos-library | STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `LibraryWorkspace.tsx` | 待验收 |
| 18 | 实验上传与贡献 | 上传贡献导航 → physicsos-contribute；#/contribute | STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `ContributeWorkspace.tsx`, `experiments/experiment-navigation.ts` | 待验收 |
| 19 | 项目内容与整理 | 项目列表 → 选择项目内容 | STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `StudyProjects.tsx` | 待验收 |
| 20 | 全幅教学画板编辑器 | 教学画板列表 → #/whiteboards/<id> | STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `whiteboard/WhiteboardWorkspace.tsx`, `whiteboard/WhiteboardSurface.tsx` | 待验收 |
| 21 | 定稿 PDF 预览 | 出卷专区 → final → 试卷.pdf / 答案解析.pdf → iframe | TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `PaperWorkspace.tsx` | 待验收 |
| 22 | 资源题目详情 | 资源库 → 题目内容/练习（非独立考试路由） | STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `LibraryWorkspace.tsx` | 待验收 |
| 23 | 登录 | 匿名进入系统 → shell.overlay → view=login | ANONYMOUS | `AuthGate.tsx`, `auth-store.ts` | 待验收 |
| 24 | 创建学习空间 | 认证覆盖层 → view=register | ANONYMOUS | `AuthGate.tsx`, `auth-store.ts` | 待验收 |
| 25 | 找回密码申请 | 认证覆盖层 → view=forgot | ANONYMOUS | `AuthGate.tsx` | 待验收 |
| 26 | 设置新密码 | 密码重置链接/注入resetToken → view=reset | ANONYMOUS,STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `AuthGate.tsx` | 待验收 |
| 27 | 学校申请待审核 | register 返回 kind=pending → pendingReview回执 | ANONYMOUS | `AuthGate.tsx` | 待验收 |
| 28 | 通用设置 | 上游 SettingsRoot → 通用设置 | STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `chrome.ts`, `index.ts` | 待验收 |
| 29 | 模型目录与只读配置 | 上游 SettingsRoot → 模型目录（ui-settings-models） | STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `chrome.ts` | 待验收 |
| 30 | Agent 预设与权限说明 | 设置 → Agent预设；首页已有预设席位 | STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `PhysicsProfileSeat.tsx`, `PhysicsProfileLabel.tsx`, `profiles.ts` | 待验收 |
| 31 | 我的访问与用量 | 账户菜单 → 我的访问/用量 → physicsos-record（surface=record） | STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `UsageWorkspace.tsx`, `LabWorkspace.tsx`, `SidebarFooter.tsx` | 待验收 |
| 32 | 账户菜单 | 账户按钮 → Menu | STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `SidebarFooter.tsx` | 待验收 |
| 33 | 后台：使用汇总 | 账户菜单 → 管理后台 → overview → summary | SCHOOL_ADMIN,SUPER_ADMIN | `AdminWorkspace.tsx`, `AdminOverviewTab.tsx`, `UsageWorkspace.tsx` | 待验收 |
| 34 | 后台：运维 | 管理后台 → overview → operations | SCHOOL_ADMIN,SUPER_ADMIN | `AdminWorkspace.tsx`, `AdminOverviewTab.tsx`, `AdminOpsTab.tsx`, `AdminOpsPanel.tsx` | 待验收 |
| 35 | 后台：审计日志 | 管理后台 → overview → audit / AuditTab | SCHOOL_ADMIN,SUPER_ADMIN | `AdminWorkspace.tsx`, `AdminOverviewTab.tsx` | 待验收 |
| 36 | 后台：用户管理 | 管理后台 → users → accounts / UsersTab | SCHOOL_ADMIN,SUPER_ADMIN | `AdminWorkspace.tsx`, `AdminAccountsTab.tsx` | 待验收 |
| 37 | 后台：密码重置请求 | 管理后台 → users → resets / PasswordResetQueue | SCHOOL_ADMIN,SUPER_ADMIN | `AdminAccountsTab.tsx`, `AuthGate.tsx` | 待验收 |
| 38 | 后台：设备管理 | 管理后台 → users → devices | SCHOOL_ADMIN,SUPER_ADMIN | `AdminAccountsTab.tsx`, `AdminDeviceTab.tsx` | 待验收 |
| 39 | 后台：学校申请审核 | 管理后台 → requests / RequestsTab | SUPER_ADMIN | `AdminWorkspace.tsx` | 待验收 |
| 40 | 后台：学校管理 | 管理后台 → schools / SchoolsTab | SUPER_ADMIN | `AdminWorkspace.tsx` | 待验收 |
| 41 | 后台：对话审核 | 管理后台 → moderation | SUPER_ADMIN | `AdminWorkspace.tsx`, `AdminModerationTab.tsx` | 待验收 |
| 42 | 后台：实验投稿审核 | 管理后台 → experimentReview → experiments | SUPER_ADMIN | `AdminWorkspace.tsx`, `AdminExperimentTab.tsx` | 待验收 |
| 43 | 后台：题目内容核验 | 管理后台 → experimentReview → content | SCHOOL_ADMIN,SUPER_ADMIN | `AdminWorkspace.tsx`, `AdminContentTab.tsx` | 待验收 |
| 44 | 后台：用户反馈处理 | 管理后台 → feedback → feedback | SCHOOL_ADMIN,SUPER_ADMIN | `AdminWorkspace.tsx`, `AdminNoticeTab.tsx` | 待验收 |
| 45 | 后台：公告编辑与发布 | 管理后台 → feedback → announcements | SUPER_ADMIN | `AdminWorkspace.tsx`, `AdminPlatformNoticeTab.tsx` | 待验收 |
| 46 | 官网管理：展示反馈 | 管理后台 → website → testimonials | SUPER_ADMIN | `AdminWebsiteTab.tsx` | 待验收 |
| 47 | 官网管理：贡献者与项目 | 管理后台 → website → contributors | SUPER_ADMIN | `AdminWebsiteTab.tsx` | 待验收 |
| 48 | 官网管理：反馈收件箱与截图 | 管理后台 → website → inbox / FeedbackInbox | SUPER_ADMIN | `AdminWebsiteTab.tsx` | 待验收 |
| 49 | 后台：平台模型号池 | 管理后台 → modelPool | SUPER_ADMIN | `AdminModelPoolTab.tsx` | 待验收 |
| 50 | 公开官网首页 | https://physicsos.dongsiwei.com/；/physicsos/website/index.html | ANONYMOUS,STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `@website/index.html`, `@website/motion.js` | 待验收 |
| 51 | 官网功能与实验演示 | 官网 → 功能与实验演示区段 | ANONYMOUS,STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `@website/index.html`, `@website/motion.js` | 待验收 |
| 52 | 官网用户声音与共创项目 | 官网 → 用户声音与共创项目区段 | ANONYMOUS,STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `@website/index.html`, `@website/motion.js` | 待验收 |
| 53 | 官网反馈与截图上传 | 官网 → feedback-trigger → #feedback-dialog | ANONYMOUS,STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `@website/index.html`, `@website/motion.js` | 待验收 |
| 54 | 官网反馈提交成功 | 官网反馈POST返回真实id/createdAt → #feedback-success | ANONYMOUS,STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `@website/index.html`, `@website/motion.js` | 待验收 |
| 55 | 实验开发者文档 | https://physics.dongsiwei.com/physicsos/developers/index.html | ANONYMOUS,STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `@developers/index.html`, `@scripts/generate.mjs` | 待验收 |
| 56 | 全幅电路搭建实验 | 实验中心 → 电路实验/自由搭建；运行台buildMode | STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `PhysicsWorkspace.tsx`, `physics/PhysicsCanvas.tsx`, `physics/CircuitBuilderPanel.tsx`, `physics/circuit-renderer.tsx` | 待验收 |
| 57 | 历史对话面板 | 历史/最近空间入口（原sidebar.workspacepanel slot） | STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `RecentSpaces.tsx`, `index.ts` | 待验收 |
| 58 | 悬浮导航：更多功能 | 短导航 → 更多功能菜单（目标）；原SidebarNav导航动作 | STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `SidebarNav.tsx`, `SidebarFooter.tsx` | 待验收 |
| 59 | 我的反馈与处理状态 | 反馈 → tab=history | STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `NoticeBoard.tsx` | 待验收 |
| 60 | 实验生成失败与重试 | 实验生成对话 → 失败卡片/题目代码任务失败状态 | STUDENT,TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `SceneTurnCard.tsx`, `SceneChatCard.tsx`, `experiments/QuestionCodeCanvas.tsx` | 待验收 |
| 61 | 后台：号池轮询与冷却策略 | 管理后台 → modelPool → 轮询/冷却策略区域 | SUPER_ADMIN | `AdminModelPoolTab.tsx` | 待验收 |
| 62 | 题库：导入核验详情 | 出卷 → bank → 导入识别结果/待核验详情 | TEACHER,SCHOOL_ADMIN,SUPER_ADMIN | `PaperWorkspace.tsx` | 待验收 |

## 保留动作与待核对项

### 1 首页与新建对话

- 保留：新建会话；Lexical输入/附件/图片/草稿；IME；发送/停止/排队。
- 推荐设计：`screens/01-home.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 2 对话与实验预览

- 保留：会话共享与ownerSession；预览展开收起；参数修改；返回主实验。
- 推荐设计：`screens/02-chat.png`。
- 说明：对话主体由上游 ui-conversation 提供，不能另建 Agent Loop。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 3 实验中心

- 保留：分类/搜索/模板选择；继续当前场景；真实模板封面。
- 推荐设计：`screens/03-experiment-center.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 4 全幅实验运行台

- 保留：播放暂停/重置/时间轴；参数preview/commit/revision；原题恢复；保存与重开；图像/数据表；社区及透镜独立分支。
- 推荐设计：`revisions/04-experiment-workbench-v2.png`。
- 说明：包括PhysicsCanvas、透镜及社区/题目代码运行分支，不能仅按单个内置实验验收。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 5 实验报告

- 保留：按真实快照生成；测量记录与单位；打印；Markdown下载；关闭返回。
- 推荐设计：`screens/05-experiment-report.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 6 项目列表

- 保留：创建/选择项目；内容归档；拖拽整理；账户范围持久化。
- 推荐设计：`screens/06-projects.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 7 实验自由画布列表

- 保留：新建/重命名/删除/打开；账户隔离；离线草稿与同步状态。
- 推荐设计：`screens/07-canvas-list.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 8 全幅自由画布编辑器

- 保留：选择/拖拽/分组；器材和实验节点；导入导出；撤销；CAS版本冲突副本；保存重开。
- 推荐设计：`screens/08-canvas-editor.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 9 教学画板列表与空态

- 保留：新建/打开/管理画板；空态与失败重试；账号范围。
- 推荐设计：`screens/09-whiteboard-list.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 10 出卷：新建试卷

- 保留：蓝图/学段学科/难度配置；创建真实任务；错误与未配置反馈。
- 推荐设计：`screens/10-exam-new.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 11 出卷：草稿与审核列表

- 保留：刷新/轮询任务；草稿选择；真实生成状态；失败重试。
- 推荐设计：`screens/11-exam-review-list.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 12 出卷：逐题审核

- 保留：逐题检查/求解报告；替换和审核；人工审核人；质量校验；定稿门槛。
- 推荐设计：`screens/12-exam-review-detail.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 13 出卷：已定稿试卷

- 保留：读取已定稿任务；导出文件；预览；真实审核状态。
- 推荐设计：`revisions/13-exam-final-v2.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 14 出卷：题库与导入

- 保留：搜索题库；粘贴或文件识别导入；核验/退回；原文对照；批量确认。
- 推荐设计：`revisions/14-exam-bank-v2.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 15 出卷：真题资料库

- 保留：资料筛选；试卷/标注读取；CSV导入；真实统计。
- 推荐设计：`screens/15-exam-sources.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 16 提交反馈

- 保留：选择类别；正文校验；提交真实反馈；失败保留草稿；公告读取。
- 推荐设计：`screens/16-feedback.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 17 物理资源库

- 保留：题目/真题筛选检索；查看标注；打开实验或练习；真实掌握记录。
- 推荐设计：`screens/17-resources.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 18 实验上传与贡献

- 保留：上传experiment.json实验包；校验预览；投稿/版本；失败重试。
- 推荐设计：`revisions/18-contribute-v2.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 19 项目内容与整理

- 保留：归档会话/实验；整理与移除；保存项目结构；重开真实内容。
- 推荐设计：`screens/19-project-detail.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 20 全幅教学画板编辑器

- 保留：书写/选择/撤销；板书生成；导入导出；保存/任务恢复；版本冲突与离线草稿。
- 推荐设计：`screens/20-whiteboard-editor.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 21 定稿 PDF 预览

- 保留：使用api.fileUrl真实产物；切换文件；下载；权限与失败态。
- 推荐设计：`screens/21-exam-pdf-preview.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 22 资源题目详情

- 保留：题干/答案/知识点真实读取；练习结果；关联实验。
- 推荐设计：`screens/22-resource-detail.png`。
- 说明：设计稿为补充详情状态；现有 LibraryWorkspace 中是否已有完整详情容器待实现者核对。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 23 登录

- 保留：用户名/学校选择；真实登录；错误提示；会话建立后按账户重载。
- 推荐设计：`screens/23-auth-login.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 24 创建学习空间

- 保留：学校检索/选择；注册输入校验；真实注册结果；待审核分支。
- 推荐设计：`screens/24-auth-register.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 25 找回密码申请

- 保留：提交密码找回申请；学校范围；真实回执与失败。
- 推荐设计：`screens/25-auth-reset-request.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 26 设置新密码

- 保留：校验短期token；设置新密码；过期/无效/失败；不泄漏token。
- 推荐设计：`screens/26-auth-reset-password.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 27 学校申请待审核

- 保留：展示真实申请学校/账号；返回登录；不得伪造已登录。
- 推荐设计：`screens/27-auth-school-pending.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 28 通用设置

- 保留：语言/主题/原设置存储；Escape与焦点恢复；深浅主题。
- 推荐设计：`screens/28-settings-general.png`。
- 说明：具体表单归 ui-settings 上游；本清单不把 chrome 样式视作实现完成。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 29 模型目录与只读配置

- 保留：只读模型目录；普通用户不可写凭据；平台策略真实状态。
- 推荐设计：`revisions/29-settings-models-v2.png`。
- 说明：ui-settings-models/src/client/store.ts 的改动在 upstream-changes.patch；需投影后验证。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 30 Agent 预设与权限说明

- 保留：现有预设与权限说明；选择合法学习/教学预设；保留平台控制。
- 推荐设计：`revisions/30-settings-presets-v2.png`。
- 说明：预设设置表单由上游包持有；不可将首页预设席位误计成设置页面验收。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 31 我的访问与用量

- 保留：本人访问/用量读取；范围切换；真实汇总；空/失败态。
- 推荐设计：`screens/31-account-usage.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 32 账户菜单

- 保留：真实账号/学校；我的用量；管理员入口按角色；退出登录；键盘/焦点。
- 推荐设计：`screens/32-account-menu.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 33 后台：使用汇总

- 保留：真实使用汇总；学校范围；筛选与空态；保留运维/审计入口。
- 推荐设计：`revisions/33-admin-overview-v2.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 34 后台：运维

- 保留：真实健康/运行/容量读取；按权限维护动作；确认与审计。
- 推荐设计：`screens/34-admin-operations.png`。
- 说明：AdminOpsPanel指标区仅SUPER_ADMIN渲染，校管保留批量用户运维；具体写入能力仍以host guard为准。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 35 后台：审计日志

- 保留：审计筛选/读取；学校范围；真实操作记录；分页。
- 推荐设计：`screens/35-admin-audit.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 36 后台：用户管理

- 保留：查询/创建/更新账户；角色及学校范围；重置/禁用确认；审计。
- 推荐设计：`revisions/36-admin-users-v2.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 37 后台：密码重置请求

- 保留：查看申请；签发/撤销/过期状态；学校范围；不泄漏重置凭据。
- 推荐设计：`screens/37-admin-password-resets.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 38 后台：设备管理

- 保留：设备读取/筛选；会话设备管理；权限范围与确认。
- 推荐设计：`screens/38-admin-devices.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 39 后台：学校申请审核

- 保留：学校申请读取；批准/拒绝及理由；确认；真实状态/审计。
- 推荐设计：`screens/39-admin-school-applications.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 40 后台：学校管理

- 保留：学校读取/配置；管理员范围；真实持久化；确认/审计。
- 推荐设计：`screens/40-admin-schools.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 41 后台：对话审核

- 保留：对话审核筛选/详情；真实内容与处理；审计。
- 推荐设计：`screens/41-admin-chat-review.png`。
- 说明：前端当前仅SUPER_ADMIN可见，不擅自拓展给校管。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 42 后台：实验投稿审核

- 保留：投稿读取；内容预览；审核/上下架/版本；确认审计。
- 推荐设计：`screens/42-admin-experiment-review.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 43 后台：题目内容核验

- 保留：题目核验；审核人归属；真题/标注读取；学校范围。
- 推荐设计：`screens/43-admin-question-review.png`。
- 说明：需paperApi可用；以服务端核验权限为准。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 44 后台：用户反馈处理

- 保留：真实反馈筛选；回复/状态变更；学校范围；失败重试。
- 推荐设计：`screens/44-admin-feedback.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 45 后台：公告编辑与发布

- 保留：公告编辑/发布；版本与通知；确认；持久化。
- 推荐设计：`screens/45-admin-announcements.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 46 官网管理：展示反馈

- 保留：展示反馈编辑；排序；上下架；真实公开配置；版本冲突处理。
- 推荐设计：`screens/46-admin-site-testimonials.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 47 官网管理：贡献者与项目

- 保留：贡献者头像/项目/链接配置；排序；上下架；持久化与冲突。
- 推荐设计：`screens/47-admin-site-contributors.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 48 官网管理：反馈收件箱与截图

- 保留：真实反馈筛选；私密截图查看；回复/处理状态；可转展示但不自动公开。
- 推荐设计：`screens/48-admin-site-inbox.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 49 后台：平台模型号池

- 保留：通道/模型/密钥池管理；探测；只显示掩码；缺加密配置禁止凭据写入。
- 推荐设计：`revisions/49-admin-model-pool-v2.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 50 公开官网首页

- 保留：产品/文档真实链接；首屏与动效偏好；旧hash转系统域兼容。
- 推荐设计：`screens/50-official-home.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 51 官网功能与实验演示

- 保留：交互概念演示；标签切换；进入真实系统；减少动效适配。
- 推荐设计：`screens/51-official-features.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 52 官网用户声音与共创项目

- 保留：GET公开配置；真实评价/贡献者；空/加载/失败重试；焦点刷新。
- 推荐设计：`screens/52-official-community.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 53 官网反馈与截图上传

- 保留：正文与类别；最多3张/每张5MiB截图校验；真实POST；失败保留草稿；焦点与关闭。
- 推荐设计：`revisions/53-official-feedback-v2.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 54 官网反馈提交成功

- 保留：真实回执；继续探索；再次反馈；失败不可展示成功。
- 推荐设计：`screens/54-official-feedback-success.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 55 实验开发者文档

- 保留：文档搜索/导航/锚点；提示词及模板下载；保留技术规范。
- 推荐设计：`screens/55-developer-docs.png`。
- 说明：共用生成器负责各章节；不是单一首页样式验收。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 56 全幅电路搭建实验

- 保留：器材放置/接线；未求解场景保持显示；真实电路求解；保存；播放/测量。
- 推荐设计：`screens/56-circuit-builder.png`。
- 说明：电路沿用PhysicsCanvas与circuit-renderer/CircuitBuilderPanel独立逻辑，不能只修改通用三栏。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 57 历史对话面板

- 保留：会话恢复；最近实验/画布恢复；账户隔离；收起/焦点。
- 推荐设计：`screens/57-history.png`。
- 说明：新顶部抽屉是目标呈现，当前源码入口仍需壳层迁移后验收。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 58 悬浮导航：更多功能

- 保留：资源库/贡献/反馈等全部入口；出卷教学角色限制；后台管理员限制；Escape/焦点。
- 推荐设计：`screens/58-navigation-more.png`。
- 说明：更多菜单属于设计目标，原组件是现有动作来源；不能推断已实现。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 59 我的反馈与处理状态

- 保留：本人反馈读取；处理状态/回复；刷新；空态；新反馈跳转。
- 推荐设计：`screens/59-feedback-history.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 60 实验生成失败与重试

- 保留：真实错误；重试/直接重新生成；任务轮询与ownerSession；验证/修复；不得显示矛盾成功。
- 推荐设计：`revisions/60-chat-retry-v2.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 61 后台：号池轮询与冷却策略

- 保留：真实策略读取/更新；轮询参数；基础/最大冷却；版本/权限；验证输入。
- 推荐设计：`screens/61-admin-model-policy.png`。
- 说明：当前策略为同一modelPool页面区域，不是独立路由或假造标签。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

### 62 题库：导入核验详情

- 保留：原文对照；逐条/批量核验；退回理由；真实审核人；入库/恢复待核验。
- 推荐设计：`screens/62-exam-bank-verify.png`。
- 实现/视觉/交互/权限：待验收；截图与测试证据尚未填写。

