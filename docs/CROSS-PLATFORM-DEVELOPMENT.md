# Windows 安卓 / Mac 网页协作规范

确认日期：2026-11-10。此分工不改变完整学生端目标，也不把未完成能力降级为 Demo 或占位实现。

## 一份仓库，分开工作目录

Windows 负责[安卓工程](../apps/android/)及原生构建、模拟器和真机调试；Mac 负责 Web/服务端源码工作。两台电脑各自 clone，通过 Git 交换源码，不通过网盘或手动复制工作目录同步。各自配置 GitHub 身份验证，不在聊天、仓库或同步目录中复制另一台机器的 SSH 私钥。

网页/服务端正式集成、构建、测试、备份和部署继续以服务器 `107.151.246.59` 的 `/opt/physicsos` 和 Docker 为准。允许 Windows 本地安卓构建是这一规则的明确例外，不是将整套后端迁到 Windows，也不撤销生产环境保护要求。

[独立实验包](../apps/mobile-lab/)是两端共享代码，纯 TypeScript 引擎仍只有一份。Windows 可以构建 App 所需的 Web 资源；不得为安卓复制一套 Kotlin 物理公式或用手机 UI 动画替代真实求解。

## 模块归属与接口

- 安卓原生界面、权限、文件、通知和生命周期：Windows 侧负责。
- Web 界面与宿主插件、移动接口、数据库和服务器任务：Mac/服务器侧负责。
- 物理引擎、实验渲染、序列化检查点、API DTO：共享模块，每次改动明确一个负责人。
- 同一共享文件不能由两端同时独立改写；先确认接口、输入输出及版本，再分工写生产者和消费者。
- 学生权限在服务端强制执行，不由是否显示按钮决定。账号、任务与数据同步共用真实后端，不新造一套只给 App 演示的数据库。
- 改动 HTTP、WebSocket、检查点或本地库格式时，同时更新生产者、消费者和契约测试，保留对受支持版本的兼容行为。

具体接口与负责人边界见[安卓实现约定](superpowers/plans/2026-11-10-android-implementation.md)。

## Windows 开发要求

按[安卓 README](../apps/android/README.md)配置原生 Windows 工具链。推荐 Android Studio、JDK 17、已固定的 SDK/Wrapper、Node 与 pnpm，不把 SDK/Gradle/ADB 放进 WSL 目录。

根目录的 Gradle 版本不由全局安装决定，统一使用已校验并提交的 Wrapper。Android Studio 的 Gradle JDK 与终端 JAVA_HOME 保持一致。

Android 的 local.properties、SDK 路径和个人缓存留在本机。厂商服务配置、签名 keystore 与密码文件不进入版本库。

模拟器可验证功能，但不能证明入门/中端真机的帧率、内存、冷启动和长时间发热表现。

## Mac 与服务器要求

Mac 继续编辑网页、后端和共享源码，使用既有服务器/候选环境验证，不因本机缺 Docker 或 Android SDK 判断部署不可用，也不为后端部署另装本机环境。

修改 host 插件后，候选环境需要重建实际加载的产物并重启；不能仅检查源文件或产物里存在字符串就声称功能已生效。

发布前核对远端 main、服务器检出版本与实际镜像，保留已上线后续修复、切换前镜像和数据恢复点。不并发执行生产 compose 切换。

Windows App 的调试授权不扩展为服务器清理、数据库删除、上线或商店发布授权。

## Git 交换方式

日常工作使用不同分支，例如 codex/android-主题、codex/web-主题；当前安卓交接分支是 `codex/android-student-app`。

开始工作前先 fetch，确认自己在哪个分支及是否有未提交修改。另一台机器只在工作区受保护后执行 pull --ff-only；分叉时检查历史并正常合并，不通过强推覆盖另一端。

每次提交只包含本次任务的具体文件。禁止用 git add -A 把历史改动、截图、密钥、本地工具和缓存一起带进去。提交前检查暂存 diff，确认没有另一位开发者或另一个 agent 尚在改写同一文件。

开发中交接可提交到明确的开发分支，但提交信息和交接记录必须写明未完成、未构建或未验证的部分。开发快照不得冒充发布版本，也不自动合并 main。

不要提交 APK/AAB、Gradle 缓存、node_modules、构建目录、临时性能记录、SDK 或设备配置。Room schema 和真实生成并审阅过的 Baseline Profile 按工程要求提交；不能手写假性能证据。

## 文本与路径

[.gitattributes](../.gitattributes)规定源码与 PowerShell 脚本使用 LF，bat/cmd 使用 CRLF，JAR 作为二进制；[.editorconfig](../.editorconfig)规定 UTF-8、空格和 Kotlin 四空格缩进。

建议各 clone 使用仓库级 core.autocrlf=false、core.longpaths=true；不要为本任务改全局 Git 或系统安全策略。首次设置后也不要全仓库 renormalize 制造无关差异。

共享 Node 脚本用 node:path、fileURLToPath、参数数组和明确退出码，不依赖 Bash-only 命令或固定斜杠。PowerShell 调原生命令后立即检查 LASTEXITCODE，不能用日志管道的成功掩盖真实失败。

不要依赖只有大小写不同的文件名；必要的大小写重命名通过临时名完成。不要把任何人的绝对路径写入构建配置。

## Overlay 源真值

[overlays/harness/files](../overlays/harness/files/)与[上游补丁](../overlays/harness/upstream-changes.patch)是修改来源，[vendor/deepseek-harness](../vendor/deepseek-harness/)是固定上游及应用结果，不是第二份独立开发仓库。

首次在干净的 submodule 应用 overlay。再次应用前先保护已有差异；工具可能覆盖其负责的文件，不能以“只是同步”为由丢弃本地修改。新增覆盖文件要登记在物化清单/补丁中，不以本机偶然存在的文件作为构建依赖。

变更已签名插件入口后，必须按既有密钥流程重签并验证；不要只改哈希而留下无效签名，也不要在 App 中携带签名私钥。

## 交付证据

交接记录至少区分：源码存在、静态检查、编译、端到端、性能及发布状态。失败给出真实原因，未执行写明未执行。

任何端都不得通过删除入口、减少实验、换成模拟接口、伪造成功回执或降低物理精度让检查通过。开发中缺口在[当前交接状态](reports/2026-11-10-android-windows-handoff.md)明确列出，后续按完整架构继续完成。
