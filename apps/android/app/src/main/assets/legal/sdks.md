# 第三方组件说明

以下组件承担应用功能，不作为广告追踪组件使用。实际版本由随应用发布的依赖清单锁定。

- **AndroidX Activity、Lifecycle、Navigation、Jetpack Compose / Material 3**：原生界面、导航、生命周期和无障碍支持。
- **AndroidX Room、Bundled SQLite、DataStore**：在应用私有空间保存记录、草稿、待同步操作及设置。
- **AndroidX WorkManager**：在 Android 允许的条件下安排后台同步，不保证后台持续联网。
- **AndroidX CameraX 和 Android 系统文件选择器**：处理你主动拍摄或选择的图片及文档。
- **AndroidX WebKit 与系统 Android WebView**：加载随应用内置的实验和数学文档资源。带应用消息接口的渲染页面不用于打开任意外部网站。
- **Kotlin Coroutines、Kotlin Serialization**：异步任务与数据编码。
- **OkHttp**：受限制的服务端网络通信。
- **Coil**：图片加载与显示。私人图片需要经过应用的授权下载流程，不把账号凭据交给任意图片地址。
- **Markwon、CommonMark 与 JLatexMath Android**：在原生对话消息中排版 Markdown、表格和数学公式。仅处理本地消息，不向第三方服务发送学习内容；未启用远程图片加载插件。
- **React、KaTeX 及本地文档安全处理组件**：实验结构、数学排版和受控文档显示；实验算法来自 PhysicsOS 共享物理引擎。

厂商推送只有在相应发布配置、服务端配置和设备能力可用时才能工作。启用时需要处理该厂商提供的应用推送标识。系统通知权限可以随时撤销；不启用推送仍可以主动打开应用查看服务器结果。

完整依赖版本、许可证和发布配置由项目构建文件及发布材料记录。主要组件的开源许可证不转让第三方教材或课程内容的权利。
