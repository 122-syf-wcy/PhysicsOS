# PhysicsOS 安卓学生端

Kotlin + Jetpack Compose 原生主应用；物理引擎和本地实验渲染模块与 Web 共享。目标是完整学生端，不是整站套壳或精简演示。

**当前为开发中版本，尚未达到完整应用交付标准。**Windows 已补齐原生页面、文案与独立实验打包链，并通过本机 Debug/测试 APK 编译、JVM 单元测试和 lint；后端接线、新版设备验收和真机性能仍有未完成项。最新证据见[Windows 实现与验证记录](../../docs/reports/2026-11-11-android-windows-progress.md)，原始缺口见[交接快照](../../docs/reports/2026-11-10-android-windows-handoff.md)。不要把可构建 APK 当作完整交付。

2026-11-12 已将最新网页／服务端源码同步到 `codex/android-student-app`，并保存其余本地源码变体。Windows 拉取方式及核查范围见[全量源码交接](../../docs/reports/2026-11-12-windows-full-source-handoff.md)。

## 工作分工

- Windows：本工程的原生开发、Gradle 构建、模拟器和安卓真机调试。
- Mac：Web 与服务端源码开发；正式 Web/服务端验证、备份和部署仍走服务器 Docker。
- 两端共享[独立实验包](../mobile-lab/)和[物理领域包](../../packages/)，使用同一个 Git 仓库、不同工作目录与分支。

完整协作规则见[跨平台开发规范](../../docs/CROSS-PLATFORM-DEVELOPMENT.md)。

## Windows 工具链

推荐原生 Windows + Android Studio + PowerShell，不把 Android SDK、Gradle 缓存或 ADB 放进 WSL 路径。项目尽量放本地短路径，例如 `C:\src\PhysicsOS`，不要放 OneDrive/iCloud 同步目录。

准备：

- Git for Windows；需要真实文档大图时安装 Git LFS。
- Node.js 24.7.0 或更新版本；根工作区 pnpm 11.9.0。
- JDK 17。终端 JAVA_HOME 与 Android Studio 的 Gradle JDK 使用同一版本。
- Android Studio SDK Manager 中的 Android SDK Platform 36、Build-Tools 36.0.0、Platform-Tools；设置 ANDROID_HOME 指向 Windows SDK。
- 模拟器或经授权的安卓真机。模拟器用于功能检查，性能验收必须用真机。

不要单独安装全局 Gradle。仓库已包含官方校验过的 Wrapper。版本由[版本目录](gradle/libs.versions.toml)和[Wrapper 配置](gradle/wrapper/gradle-wrapper.properties)固定：Gradle 8.13、AGP 8.13.2、Kotlin/Compose compiler 2.2.21，compile/target SDK 36、min SDK 29。

Android Studio 自带的 JBR 不一定是 JDK 17；不要只凭“安装了 Studio”就认为 CLI 与 IDE 的编译器已经一致。

官方参考：[Android Studio 安装](https://developer.android.com/studio/install)、[Gradle Wrapper](https://docs.gradle.org/current/userguide/gradle_wrapper.html)。

## 拉取交接分支

首次克隆示例：

```powershell
git -c core.longpaths=true clone --branch codex/android-student-app --recurse-submodules git@github.com:122-syf-wcy/PhysicsOS.git C:\src\PhysicsOS
Set-Location C:\src\PhysicsOS
git config --local core.longpaths true
git config --local core.autocrlf false
```

已有仓库：先提交或保存自己的修改，再执行：

```powershell
git fetch origin
git switch --track origin/codex/android-student-app
```

如果本地已存在该分支，改用 `git switch codex/android-student-app`，然后 `git pull --ff-only`。不要用 reset --hard 或强制 checkout 丢弃本机工作。

进入 Android Studio 时，打开[安卓 Gradle 工程](./)，不是整个 TypeScript 仓库根。SDK 路径放在被忽略的 local.properties 中，不提交个人绝对路径。

## 先检查，再准备依赖

从仓库根执行：

```powershell
node scripts/android/doctor.mjs --sources-only
powershell -NoProfile -File scripts/android/dev.ps1 -Mode Doctor
```

第一条只检查当前源码入口、资源、脚本与 Wrapper，Mac 也能运行；第二条额外检查 Windows JDK/SDK/pnpm。**全范围检查仍会报告只读后端的移动聚合/账户擦除插件缺口，退出码非零是诚实阻塞，不应绕过。**可用 `--scope=app` 与 `--scope=lab` 分别验证安卓与本地实验源码，但这不代表后端已就绪。

依赖准备：

```powershell
powershell -NoProfile -File scripts/android/dev.ps1 -Mode Prepare
```

该命令初始化尚未检出的 submodule，并按根锁文件安装依赖，不安装 JDK/SDK、不更改执行策略、不重置 vendor。若组织策略禁止 PowerShell 脚本，遵守管理员规则，手动执行等效的 Git/pnpm/Wrapper 命令，不降低全局安全策略。

仓库根与 Harness 是两个 pnpm 工作区，分别遵循自己的 packageManager。不要把 Mac 的 node_modules、Gradle 缓存或编译输出复制到 Windows。

## Overlay 的使用边界

[物化工具](../../scripts/overlay/harness-overlay.mjs)会将[源覆盖层](../../overlays/harness/files/)与[上游补丁](../../overlays/harness/upstream-changes.patch)应用到固定的 Harness submodule。

只有首次、干净的 submodule 才可执行：

```powershell
powershell -NoProfile -File scripts/android/dev.ps1 -Mode Overlay
```

该入口拒绝重置已有 vendor 改动。已应用的 overlay 本来就可能表现为 submodule dirty；更新前应先确认差异来源、保护修改，再按仓库工具流程操作。不要在 Windows 随手运行 capture，将本机生成物或残余脚本带回补丁。

共享源码以 overlays 和 packages 为准，不直接改 vendor 内的复制结果。

## 补齐源码后构建

以下命令是完整链路的开发入口，**不是当前快照已经通过的命令**：

```powershell
powershell -NoProfile -File scripts/android/dev.ps1 -Mode Lab
powershell -NoProfile -File scripts/android/dev.ps1 -Mode Debug
powershell -NoProfile -File scripts/android/dev.ps1 -Mode Verify
```

Lab 使用 Node 打包本地实验/公式资源；Debug 和 Verify 会先检查源码、准备固定版本的共享源码并构建实验包，再调用 gradlew.bat。没有本地 bundle 时 Gradle 拒绝打包，不用线上网站代替。

独立实验模块的[共享源码清单](../mobile-lab/shared-source.json)记录实际核对的 Web 提交、共享包和 UI 树哈希。[准备脚本](../../scripts/android/prepare-shared.mjs)在被忽略的独立只读工作区中检出该提交，不覆盖当前分支的 Web/物理包，也不在启动 App 时下载执行代码。需要新版 Web 时先 fetch、核对差异，再更新清单并重新测试/打包；不是永远锁在最初交接快照。直接执行独立实验测试前先运行 `node scripts/android/prepare-shared.mjs`。APK 构建会拒绝来源提交不匹配或 `test:true` 的实验 bundle。

需要单独观察 Gradle 错误时，可以从本工程执行 `./gradlew.bat :app:assembleDebug`。它仍要求实验包已生成，不代表可以跳过实验模块。

测试设备要明确选择，避免误用第一台连接的私人手机：

```powershell
powershell -NoProfile -File scripts/android/dev.ps1 -Mode DeviceTests -Serial YOUR_TEST_DEVICE_SERIAL
```

使用专用测试账号和候选服务，不在生产学生账号上自动执行注销、改密、提交作业或重复模型调用。

## 后端与调试来源

应用的 HTTPS 来源可通过 PHYSICSOS_ANDROID_SERVER_ORIGIN 或 Gradle 属性 physicsos.serverOrigin 配置，默认正式域名。值必须是没有路径、凭据、查询和片段的 HTTPS origin。

本地源码里的移动 API 尚未全部部署；将来源设为正式域名不会自动让这些接口存在。必须由 Mac/服务器侧完成移动接口与候选服务验证。

不要为调试关闭 TLS 校验、放开任意 WebView origin、把模型密钥放进 APK，或让学生调用教师/管理员接口。

## 签名与设备配置

- Debug/benchmark 使用测试签名，不替代生产签名。
- 正式 keystore、密码文件、HMS/Google 服务配置放在受保护的本机目录或 CI secret 挂载中，不提交 Git。
- Release 缺少真实签名时明确失败。不要把默认 debug key 改名为 release key。
- 厂商推送、隐私主体/条款审核、旧数据迁移和正式入口配置属于发布前置，不靠占位配置通过。
- 生产构建、发布与回滚仍需要单独确认，Windows 本机可构建不等于获准部署服务器或上架。

## 完成标准

源码结构预检、Kotlin/资源编译、单元与设备测试、真实服务端端到端、真机性能是不同阶段。必须逐项给证据，不能用一种结果代替其他阶段。

性能门槛与完整功能范围以[已批准架构](../../docs/superpowers/specs/2026-11-10-android-student-app-architecture.md)为准。最新本机构建、测试、界面调整与未验证项见[Windows 实现与验证记录](../../docs/reports/2026-11-11-android-windows-progress.md)。
