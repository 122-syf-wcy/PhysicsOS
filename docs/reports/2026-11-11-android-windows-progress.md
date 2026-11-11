# Windows 安卓学生端：源码补齐与界面整合记录

日期：2026-11-11。**这是开发阶段记录，不是完整应用验收或发布批准。**

## 基线与边界

- 从 GitHub 实际获取交接分支最新提交 `997ff40ae7795b80cfada3aae8d42bd0f13ae4b3`，在独立工作区执行 `pull --ff-only`，结果为 Already up to date。
- 工作分支：`codex/android-windows-student-completion`。原 main 工作区既有修改未被 reset、clean、stash 或覆盖。
- 本次只修改安卓工程、独立实验模块、安卓脚本及本报告。Web、后端、共享物理包、overlay 源和根依赖/锁文件的 diff 为空；未部署、发布或推送。
- 网络曾使 Git 完整历史和按需 blob 拉取反复断连。最终按基线 SHA 从 GitHub 获取所需文件，逐个验证 Git blob 哈希后检出；共享源码内容没有改写。

## 本次落地

### 原生界面与本地资源

补齐账户、通知设置、实验目录、实验工作台、数学文档入口，并接入已有 AppGraph、Room、同步队列和受限 WebView。文案中英文完整，格式参数有独立测试。

按用户提供的参考图调整为暖白、深青绿、轻边框白卡片、圆角悬浮底部导航。首页使用仓库现有物理实验封面，不引入旅行素材或模拟学习记录。实验目录保留全部条目、筛选、搜索和存档入口。

实验页只保留一行原生标题/保存/更多菜单；移除本地网页重复标题和重复保存/导出按钮。画布优先，播放/复位/单步保持一行，速率/撤销/重做收纳到更多选项，参数、器材、读数、验证和报告按需展开。访客与同步细节可以明确查看；异常、冲突、旧格式和保存失败不被隐藏成成功。

官方蓝色 Logo 从官网资源逐字节复用。新的桌面自适应前景图和单色通知图按用户要求由生图模型生成，再进行透明度清理、安全区与密度适配。圆形、Android 13 主题图标一致；通知小图标仅用于真实完成且完整性校验通过的本地下载，受设备通知偏好和系统权限约束，不代表厂商推送已接通。

### 独立实验模块

- 从真实共享目录生成 **76 个实验模板、153 道题**，生产 bundle 包含 Worker、公式字体、器材图、已有实验封面等 **180 个文件**。
- 继续复用唯一 TypeScript 引擎；计算在 Worker，显示采样不改变权威精度，原生桥不传逐帧场景。
- 完整检查点保留 scene、originScene、播放、编辑、视口和撤销重做历史；禁止检查点加载同时重复发送 templateId/scene。
- 修复 Android `postWebMessage` 的空发送 origin 兼容性：仅限已有原生桥、本地受限顶层来源、null source 的原生投递；精确 targetOrigin、主框架、大小和 generation 校验仍保留，并有浏览器回归。
- APK 构建验证 manifest，拒绝把含测试 origin/调试钩子的 browser-test bundle 打进包。

### 账户与恢复

补齐交接遗漏的账户实例激活、退出通知和场景移除入口。同 userKey 的缓存用不可变 userId 绑定；新实例或无可信实例标记的旧缓存不会直接被采用。清理限定到对应账户的数据库和哈希目录，不清其他账户或访客内容。

注销必须先验证真实 status/requestId，区分已受理与已完成。离线退出可以清本机凭据，但服务端撤销未确认必须单独提示。反馈后端契约缺失时仅提供明确标注的本地草稿/导出，不显示已发送。

### 启动动画对齐 Web

用户要求开屏动画与 Web 一致。实现按线上站点实际的 boot 模块还原，而不是另做一套动画：

- 从 `https://physics.dongsiwei.com` 取得启动屏资源与样式（`splash-portrait-1080.webp`、`_boot_*` CSS、boot 控制器），把竖屏启动图原样放入 `drawable-nodpi/splash_portrait.webp`，没有重新生图或改色。
- 时序：照片 0.9 s 淡入并轻微回落（`scale 1.015 → 1`）；字标、标语、进度条、提示分别在 80/180/260/320 ms 上浮 10 dp 淡入；进度条 2.4 s 内按 `0.96 × (1 − (1 − t)³)` 逼近 96%，就绪后 420 ms 到 100%，停 380 ms，再 520 ms 淡出。
- 视觉：始终白底（Web 的 boot 屏在深色模式下也是白色，因此不随夜间主题变化）；字标 30 sp、青蓝渐变 44 × 2 dp 短线、13.5 sp 标语（均衡断行）、132 × 3 dp 轨道进度条带 1.4 s 扫光、12.5 sp 带字距的百分比提示、底部 22 vh 白色渐隐。
- 接入：`AppGraph.bootFinished` 以进程为界，只在冷启动展示一次，旋转和 Activity 重建不重播；`AuthState.Restoring` 对应 Web 的插件加载，最长等待 8 s 后放行，避免恢复缓慢时卡住启动屏。动画期间消耗触摸，底层页面不响应误触。
- 系统启动窗口改用 `Theme.PhysicsOS.Student.Boot`（白底、透明图标），再切回常规主题，避免 Android 12+ 图标启动屏与照片动画之间闪一下深色。
- 文案进入 `strings_boot.xml`，中英文齐全；`boot_preparing` 使用 `%1$d%%`，已按项目资源测试的格式化契约书写。

验证：本机 APK 编译通过，API 34 模拟器冷启动录屏确认白屏→照片→字标/标语→进度条 65%→退场→首页的完整顺序；标语断行在加入 `LineBreak.Heading` 后复查。

### 设备测试断言修正（非放宽标准）

首轮设备套件 10 项中 2 项失败，逐项定位后修正的是测试对 WebView 的假设，不是产品行为：

- 实验页在 WebView 中，只有系统级 `accessibility_enabled` 打开时 DOM 才会进入无障碍树；UiAutomation 本身不会打开它。测试现在显式打开该开关。
- WebView 桥把 `aria-label` 暴露为 `text` 而不是 `content-desc`，`By.desc("单步 1/60 s")` 永远匹配不到；改为 `By.text`。
- 时钟只把 `aria-label="实验时间"` 暴露为名称，数值不在可访问文本里，所以 `textContains("0.017")` 无从匹配。时钟的可访问名称改为带读数（`实验时间 0.017 / 10.00 s`），对读屏用户也更有用，测试据实断言。
- 资料页搜索空态被软键盘遮住，`assertIsDisplayed()` 失败；测试在断言前收起键盘。空态本身在手动验证中正常显示。

同时补上助手消息缺少的 `chat-copy-*` 测试标记（用户气泡一直有，属上一轮聊天改版的遗漏，并已让 `ChatUiTest` 恢复通过）。

## 本机验证证据

本机工具链：Windows 原生 JDK 17、SDK 36 / Build-Tools 36.0.0、Gradle 8.13、Node 24.18.0、pnpm 11.9.0。Gradle 分发包 SHA-256 与仓库固定值一致；没有升级版本来绕过问题。

| 检查 | 实际结果 |
| --- | --- |
| Android scope 源码预检 | PASS |
| Lab scope 源码预检 | PASS |
| 全范围 `android:source-check` | 仍以退出码 2 阻塞：缺服务端 mobile-host/account-erasure-host 入口，未修改检查器绕过 |
| TypeScript typecheck 与实验测试 | 84/84，通过全部 76 模板的共享引擎对照、恢复、协议与传输检查 |
| 浏览器 UI 回归 | 通过；覆盖触控编辑、面板展开/收起、320px 窄屏、横屏深色、离线资产、来源/generation 隔离、4Hz 摘要、文档净化 |
| 中英文资源和品牌测试 | 10/10；含官方 Logo 字节一致、通知白色 alpha、自适应图标安全区 |
| Kotlin/Android 资源、Debug APK、androidTest APK | 本机编译成功 |
| JVM 单元测试 | 32/32，无失败、错误或跳过 |
| `lintDebug` | 通过，报告 0 issue；未设置全局 lint baseline 或关闭错误检查。仅排除已批准固定版本的“有更新版本”建议，不升级工具链 |
| 模拟器设备测试 | API 34 专用 AVD 上 **11/11 通过**（含实验 WebView 真实单步、检查点保存、访客资料页），`connectedDebugAndroidTest` 返回 BUILD SUCCESSFUL |
| 新版原生首页/悬浮导航真机截图 | 尚未验证；浏览器截图不是原生截图 |
| 启动动画与 Web 一致 | 已在 API 34 模拟器冷启动录屏确认：白底、竖屏启动图、字标/标语、进度条与百分比、退场进入首页；标语均衡断行在最终构建复查 |
| 真实后端端到端 | 未执行，缺候选服务和专用测试账户 |
| 真机性能、Baseline Profile、30 分钟持续运行 | 未执行，不宣称达标 |

最终本机构建执行了 `:app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest :app:lintDebug`，返回 **BUILD SUCCESSFUL**。编译仍有既有 Kotlin 注解/弃用提示，不等于零编译器 warning。

调试包使用 `https://android-candidate.invalid` 隔离生产服务；这是不可达的验证来源，不是模拟后端，也不能用于在线解题验收。代码中的真实 API、错误处理和权限边界未被假实现替换。

专用模拟器使用独立 API 34 测试 AVD，没有修改原 Pixel AVD 或连接私人手机。模拟器后台任务达到运行时限后已停止，因此本轮不冒充新版设备/性能复验完成。

## 可重复入口

```powershell
node scripts/android/doctor.mjs --sources-only --scope=app
node scripts/android/doctor.mjs --sources-only --scope=lab
node apps/mobile-lab/scripts/test.mjs
node scripts/android/build-lab.mjs
node --test scripts/android/resources.test.mjs scripts/android/brand.test.mjs
```

然后按[安卓开发说明](../../apps/android/README.md)配置 JDK/SDK，在安卓工程使用 Wrapper。设备测试必须明确指定序列号和隔离候选来源，不操作生产学生数据。

pnpm 11 默认在 `run` 前自动校验并可能安装依赖。稀疏工作区最初因此造成根锁文件/工作区配置的本次命令改写；已逐项核对并只撤回该命令造成的变更。源码预检可以直接用 Node；需要从 pnpm 调用时本机临时使用 `pnpm_config_verify_deps_before_run=warn` 避免静默安装，不修改根配置。

## Mac / 后端协作依赖

这些都没有在 Windows 越界修改：

1. 移动认证路由、设备/改密成功封套和学生 HTTP/RPC/WebSocket 凭据接线，需要按[接口约定](../superpowers/plans/2026-11-10-android-implementation.md)确认并在候选服务测试。客户端不能仅靠域方法存在就宣称 API 已上线。
2. mobile-host 业务聚合入口、注册、签名清单、迁移及课堂/资料/记录/导出的真实回执。
3. account-erasure-host 完整账户擦除链路及关联附件清理；必须有 requestId/status，pending 不能当作全量完成。
4. 反馈 `GET/POST feedback` 的字段、幂等键、截图私有上传/访问/大小限制和回执契约；未确认前不猜字段提交。
5. 厂商推送 SDK、受保护配置、终端注册、服务端发送和真实设备证据。
6. 可用的候选 HTTPS 来源与专用测试账号、发布签名、正式隐私主体审核和目标真机设备矩阵。

完整应用标准不变：本次源码、构建及部分本地 UI 验证不能代替后端端到端、全量设备验收或真机性能交付。
