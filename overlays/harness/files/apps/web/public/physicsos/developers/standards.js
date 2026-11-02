export const STANDARD_VERSION = '1.0'
export const UPDATED_AT = '2026-11-02'
export const REPOSITORY = 'https://github.com/122-syf-wcy/PhysicsOS'
export const EXPERIMENT_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

export function normalizeExperimentId(value) {
  const id = value.trim()
  if (!EXPERIMENT_ID_PATTERN.test(id) || id.length > 64) {
    throw new Error('使用 1–64 位小写英文、数字和连字符，例如 convex-lens。')
  }
  return id
}

export function agentInstructions(experimentId = '') {
  const id = experimentId.trim() === '' ? '<experiment-id>' : normalizeExperimentId(experimentId)
  return `# PhysicsOS 实验开发约定

规范版本：${STANDARD_VERSION} · 更新：${UPDATED_AT}
适用范围：实验 ${id}。将本文件保存到实验目录的 AGENTS.md。

## 任务与事实

你正在为 PhysicsOS 贡献三维物理实验。先阅读项目根与父目录的 AGENTS.md、CONTRIBUTING.md、docs/02-ENGINEERING-STANDARDS.md 和邻近实现，再开始修改。用户的明确要求和项目已有强制约束优先；发现冲突时说明具体冲突，不暗自改变标准。

本任务仅修改 ${id} 及直接必要的共享接口。先检查 git status，保留其他人的未提交改动。不要整仓格式化，不重构不相关实验，不改动生成物。

## 统一代码风格（必须）

- TypeScript / ESM。strict 为 true；数据边界使用 unknown 后校验；禁止 any 扩散、非空断言和用 @ts-ignore / @ts-nocheck 跳过错误。
- 两空格缩进，LF 换行，UTF-8，无 BOM，文件末尾换行；无分号、单引号、多行末尾逗号。格式化以项目工具为准，目标行宽 100。
- 新实验源码使用 kebab-case.ts / kebab-case.tsx，样式 kebab-case.module.css，测试 kebab-case.test.ts(x)。既有 Harness 测试遵循所在目录的 *.client.spec.ts(x)，不批量改名旧文件。
- React 组件和类型导出用 PascalCase；函数、变量用 camelCase；Hook 用 use 前缀；全局常量用 UPPER_SNAKE_CASE。使用有物理含义的名称，避免 data1、temp、helper2。
- 类型依赖使用 import type；相对 TypeScript 导入遵循仓库 .ts/.tsx 扩展名约定。优先具名导出。Props 和只读快照使用 readonly。
- 一个模块一个职责：页面组织、运行时接入、三维渲染、交互、资源与测试分别组织。不要把计算、状态、DOM 与 Three.js 场景堆进一个组件。
- 用类型收窄和提前返回处理分支。异步任务必须 await 或显式处理 rejection；错误要提供可恢复入口，不能空 catch 冒充成功。
- 注释解释单位、坐标变换、约束和取舍；导出契约说明输入、输出与清理责任，避免逐行复述代码。

## 仓库边界（必须）

- Harness 自有 UI 源码修改 overlays/harness/files/packages/client/ui-physicsos/；领域引擎修改 packages/ 对应包。vendor 是 overlay 应用结果，不是源码真值。
- 不增加第二套 UI 框架、状态管理器或全局 CSS。React 18 + TypeScript + CSS Modules，类名组合沿用 clsx。新依赖说明用途、体积与许可。
- 宿主定义页面、导航、参数控件、记录、报告、作者信息。实验实现专注装置、三维表现和操作映射。
- 公开实验 SDK 与 ZIP 上传审核尚未上线。不得编造 @physicsos/experiment-sdk 包、create 命令、接口地址或上传成功状态。当前贡献通过仓库 PR。

## 物理与状态（必须）

- PhysicsScene Runtime 是唯一物理事实源，物理量来自平台引擎与校验结果。Renderer 只消费可视快照，不导入引擎自行求解。
- 修改条件通过场景命令 / 已有 runtime 接口。拖动时 preview，松手 commit 一次，pointercancel/Escape 恢复；预览不保存修订、不污染原题。
- 不在 React state、Three Object3D 或数据库里独立维护第二套物理状态。相机、选中对象等纯显示状态可以独立保存。
- SI 是计算单位。显示单位和场景坐标必须在边界显式转换，注释写明比例、原点和方向。二维物理模型也可以三维呈现，不能伪装成支持任意三维求解。
- 报告、记录、标注和画面来自同一快照。题目来源、sceneId、revision 与恢复原题能力保留。

## 三维与视觉标准（必须）

- 每个实验独立路由，默认且仅提供三维实验；不增加二维/三维切换。既有未迁移实验不要在本任务中直接删除。
- 统一 Warm Lab：暖白页面、自然材质、柔和光照、克制的灰绿色控件。桌面器材使用木质实验台，其他物理领域使用适合的场景，但保持同一 token 和组件体系。
- 装置是主体。物理矢量、光线和标注使用固定语义色，不能只有颜色区分状态。生图素材可做环境或材质，不承载动态物理量、文字和公式。
- 参数区由共享控件组成，不能每个实验重写一套输入与滑杆。提供拖动、数值输入、键盘操作；触摸命中区域至少 44 CSS px。
- 相机有稳定默认视角和视角归位。器材拖动与相机旋转互斥，参数预览不造成整个页面每帧重渲染。
- 静态实验按需绘制；动态实验共用平台时钟。页面隐藏暂停；默认 DPR 上限 1.5，降低阴影和纹理成本，不能降低物理结果精度。
- 卸载时清理 RAF、事件、Observer、controls、geometry、material、texture 与 renderer。共享资源明确所有权，不能提前释放其他实例仍使用的资源。
- 处理加载失败、WebGL 不可用、context loss，保留实验条件和记录，给重试或设备提示，不回退到二维实验。

## 提交与验证（必须）

- 当前仓库环境按项目约定运行构建与测试；没有本机依赖不能推断服务器不可用。不要把部署主机、真实账号、密钥、Cookie 或完整环境变量写入提交或文档。
- 先做与改动相关的验证，再运行 required checks。记录真实命令、结果和未运行原因，不声称未执行的检查通过。
- 有意义的行为测试覆盖：典型值与临界值、非法输入、拖动提交/取消、旧记录恢复、实例隔离、资源释放；不要只测试 mock 被调用或复制实现公式作为期望值。
- 手机 390×844 与桌面 1440×1000 检查布局；覆盖触摸、键盘、加载失败、WebGL 错误和反复挂载。性能数据写明设备、浏览器、网络与资源大小。
- 当前正式 Web 检查：pnpm typecheck:web、pnpm lint:web、pnpm test:web、pnpm build:web；改领域包时补对应引擎测试。git diff --check 无错误。
- 提供源码、说明、已知限制、参考用例、截图、素材来源与许可证。作者/GitHub 资料不得冒用；GitHub 链接不等于身份已验证。
- 最新审核通过的版本成为默认版本。版本与产物冻结，保留历史回滚，运行中的实验不热替换；这是计划中的投稿流程，不由前端自行发布。

## 完成时汇报

依次说明：修改范围、复用的接口、交互与物理结果、验证命令及结果、截图、已知限制。不要把 demo 标成上线，不绕过校验，不因赶工降低类型或物理标准。
`
}

export const styleRows = [
  ['语言', 'TypeScript 严格模式', 'unknown → 校验 → 具体类型；类型依赖使用 import type'],
  ['格式', '2 空格 · 单引号 · 无分号', '多行尾逗号；目标行宽 100；UTF-8 / LF / 末尾换行'],
  ['新文件', 'kebab-case.ts / .tsx', '例如 lens-renderer.ts、experiment-page.tsx'],
  ['组件 / 类型', 'PascalCase', '例如 LensStage、ExperimentSnapshot'],
  ['函数 / 变量', 'camelCase', '例如 updateScreen、imageDistanceMeters'],
  ['Hook / 常量', 'use… / UPPER_SNAKE_CASE', '例如 useExperimentSession、MAX_PIXEL_RATIO'],
  ['样式', 'CSS Modules + 共享 token', '不引入第二套主题；不写会污染宿主的全局选择器'],
  ['测试', '行为优先，期望值独立', '新模板 *.test.ts(x)；现有 Harness 继续 *.client.spec.ts(x)'],
]
