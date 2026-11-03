# PhysicsOS 实验开发约定

规范版本：2.0 · 更新：2026-11-03
适用范围：实验 convex-lens。将本文件保存到实验目录的 AGENTS.md。

## 任务与事实

你正在独立制作一个可上传到 PhysicsOS 的三维实验文件包。工作目录是下载的实验模板，不是 PhysicsOS 主仓库。先阅读包内 AGENTS.md、README.md、PACKAGE_SPEC.md、HOST_PROTOCOL.md 和模板源码。用户明确要求优先；发现契约冲突时说明，不暗自改变协议。

交付目标是 convex-lens 的实验 ZIP。贡献者不需要克隆 PhysicsOS、不修改主站源码、不提交 PR、不接触生产部署。仅修改独立包内源码与素材；保留已有工作。dist 是 npm run build 的输出，不手工改它绕过源码。

## 固定 V2 契约（必须）

- experimentId 固定为 convex-lens；schemaVersion 与 protocolVersion 都是 2，engine 固定 optics / contractVersion 1。
- 只编辑稳定 X.Y.Z 内容版本、src 三维呈现与交互、public 自有素材、teaching.json 教学内容和许可声明；不修改生成的 src/contract-wire.ts、tools/contract-wire.ts、tools/contract-v2.ts、tools/package-resources.ts、tools/html.ts 或平台光学模块，不改协议校验或发布检查绕过失败。
- parameters.json 必须保留模板的三个 cm 参数、固定安全与显示范围和只读字段；cases.json 保留五个必需用例，额外用例也由可信平台光学引擎验证。物距、焦距、光屏距离意图安全范围 [1,200] cm；物高、result、rays、visible 为只读事实。
- beyond-2f: u=30, f=10, h=4 cm；at-2f: u=20, f=10, h=4 cm；between-f-2f: u=15, f=10, h=4 cm；at-f: u=10, f=10, h=4 cm；within-f: u=5, f=10, h=4 cm。
- V2 接收带 frameId/revision 的快照，必须等待真实绘制成功后回复 experiment/rendered。experiment/connected 不代表首帧完成；渲染失败发送协议安全错误。新投稿不接受 V1，旧冻结 V1 由平台保留。

## 统一代码风格（必须）

- TypeScript / ESM。strict 为 true；数据边界使用 unknown 后校验；禁止 any 扩散、非空断言和用 @ts-ignore / @ts-nocheck 跳过错误。
- 两空格缩进，LF 换行，UTF-8，无 BOM，文件末尾换行；无分号、单引号、多行末尾逗号。格式化以项目工具为准，目标行宽 100。
- 源码使用 kebab-case.ts，样式 kebab-case.css，测试 kebab-case.test.ts。组件扩展可以使用 kebab-case.tsx，但基础模板不依赖 React。
- 类型导出用 PascalCase；函数、变量用 camelCase；全局常量用 UPPER_SNAKE_CASE。使用有物理含义的名称，避免 data1、temp、helper2。
- 类型依赖使用 import type；源码相对模块引用使用 .ts 后缀；rewriteRelativeImportExtensions 编译为浏览器 .js。优先具名导出。Props 和只读快照使用 readonly。
- 一个模块一个职责：页面组织、运行时接入、三维渲染、交互、资源与测试分别组织。不要把计算、状态、DOM 与 Three.js 场景堆进一个组件。
- 用类型收窄和提前返回处理分支。异步任务必须 await 或显式处理 rejection；错误要提供可恢复入口，不能空 catch 冒充成功。
- 注释解释单位、坐标变换、约束和取舍；导出契约说明输入、输出与清理责任，避免逐行复述代码。

## 实验包边界（必须）

- 一个 ZIP 对应一个 experimentId。experiment.json.entry 指向 dist/index.html；同时包含 src、dist、参数描述、参考用例、教学说明和素材许可，所有本地引用都在包内。
- 三维脚本只在实验视图区运行。不得导入 PhysicsOS 内部包、依赖宿主 React 实例、操作 parent.document、读取 Cookie/登录状态或直接请求主站数据库。
- 平台持有页面布局、参数控件、记录、报告、作者和版本。实验接收标准快照并发出预览/提交/取消意图，不重写整个网站。
- 使用 HOST_PROTOCOL.md 与 src/protocol.ts 定义的消息边界。实验只向精确宿主来源握手，再使用 MessageChannel；仅宿主向已绑定的不透明 iframe 转移端口时允许协议规定的 wildcard bootstrap，不携带用户数据。凸透镜主站接入使用正式引擎快照，模板本地预览仍使用明确标记的开发快照。
- 本地预览是开发工具，不是投稿接口。最终通过对应实验页上传 ZIP，后台审核通过后同步为默认效果；首版仅开放凸透镜；其他实验尚待协议适配，不伪造成功或改走 PR。
- 发布包不包含 node_modules、.env、密钥、绝对本地路径、跨包资源、外部 CDN 或运行时安装脚本。GitHub 链接只用于署名/源码参考，不是同步部署来源。

## 物理与状态（必须）

- 正式环境的物理快照由平台引擎提供，实验 renderer 只消费快照，不自行伪造求解结果。预览器中的开发快照只用于独立调试，不能宣称已通过平台物理校验。
- 修改条件通过协议 parameter/preview、parameter/commit、parameter/cancel 意图；宿主验证后执行正式场景命令。拖动时 preview，松手 commit 一次，pointercancel/Escape 恢复；预览不保存修订、不污染原题。
- 不在 Three Object3D 或包内缓存中维护第二套可写物理事实源。相机、选中对象等纯显示状态可以独立保存。
- SI 是计算单位。显示单位和场景坐标必须在边界显式转换，注释写明比例、原点和方向。二维物理模型也可以三维呈现，不能伪装成支持任意三维求解。
- 报告、记录、标注和画面来自同一快照。题目来源、sceneId、revision 与恢复原题能力保留。

## 三维与视觉标准（必须）

- 平台为每个实验提供独立路由，实验直接显示三维；不增加二维切换，也不定义主站路由。
- 统一 Warm Lab：暖白页面、自然材质、柔和光照、克制的灰绿色控件。桌面器材使用木质实验台，其他物理领域使用适合的场景，但保持同一 token 和组件体系。
- 装置是主体。物理矢量、光线和标注使用固定语义色，不能只有颜色区分状态。生图素材可做环境或材质，不承载动态物理量、文字和公式。
- 参数区由共享控件组成，不能每个实验重写一套输入与滑杆。提供拖动、数值输入、键盘操作；触摸命中区域至少 44 CSS px。
- 相机有稳定默认视角和视角归位。器材拖动与相机旋转互斥，参数预览不造成整个页面每帧重渲染。
- 静态实验按需绘制；动态实验共用平台时钟。页面隐藏暂停；默认 DPR 上限 1.5，降低阴影和纹理成本，不能降低物理结果精度。
- 卸载时清理 RAF、事件、Observer、controls、geometry、material、texture 与 renderer。共享资源明确所有权，不能提前释放其他实例仍使用的资源。
- 处理加载失败、WebGL 不可用、context loss，保留实验条件和记录，给重试或设备提示，不回退到二维实验。

## 提交与验证（必须）

- 在独立模板目录运行 npm ci、npm run dev、npm run release。保留随包提供的锁文件；实验包作者无需任何生产服务器权限。
- 先做与改动相关的验证，再运行 required checks。记录真实命令、结果和未运行原因，不声称未执行的检查通过。
- 有意义的行为测试覆盖：典型值与临界值、非法输入、拖动提交/取消、旧记录恢复、实例隔离、资源释放；不要只测试 mock 被调用或复制实现公式作为期望值。
- 手机 390×844 与桌面 1440×1000 检查布局；覆盖触摸、键盘、加载失败、WebGL 错误和反复挂载。性能数据写明设备、浏览器、网络与资源大小。
- npm run release 顺序执行 check → clean build → validate:package → pack；npm run pack 是同一完整发布流程。生成 release/<experimentId>-<version>.zip 及真实 SHA-256 检查报告；平台解压后可直接服务 dist/index.html，不需要改主仓库。
- 提供源码、说明、已知限制、参考用例、截图、素材来源与许可证。作者/GitHub 资料不得冒用；GitHub 链接不等于身份已验证。
- 最新审核通过的版本成为默认版本。版本与产物冻结，保留历史回滚，运行中的实验不热替换；管理员审批后更新默认发布指针，上传成功不等于审核通过。

## 完成时汇报

依次说明：实验 ID 与包版本、ZIP 路径、协议版本、交互与物理范围、检查结果、截图、素材许可、已知限制。不要把 demo 标成上线，不绕过校验，不因赶工降低类型或物理标准。

## 可信模板发布身份

下载：https://physics.dongsiwei.com/physicsos/developers/downloads/physicsos-experiment-template-v2-f9165baa152c62ad73c1d51f9e62e68abe53e480d642bd5a655393f25061b936.zip
SHA-256：f9165baa152c62ad73c1d51f9e62e68abe53e480d642bd5a655393f25061b936
字节数：232146

先核对下载字节的 SHA-256，再解压并使用 npm ci。此模板身份摘要不替代最终投稿 ZIP 的服务器校验或管理员审核。
