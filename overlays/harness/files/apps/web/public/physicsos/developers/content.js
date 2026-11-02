import { agentInstructions, styleRows } from './standards.js'

const p = text => ({ type: 'paragraph', text })
const note = (title, text) => ({ type: 'note', title, text })
const list = items => ({ type: 'list', items })
const code = (title, language, value) => ({ type: 'code', title, language, value })
const table = (headers, rows) => ({ type: 'table', headers, rows })
const section = (id, title, blocks) => ({ id, title, blocks })

export const documents = [
  {
    id: 'start', group: '开始贡献', title: '从这里开始', subtitle: '用共同的约定，把每个独立实验做成同一个 PhysicsOS。', tag: '指南', file: 'GETTING_STARTED.md',
    sections: [
      section('path', '一条清晰的贡献路径', [
        p('先让代码说同一种语言，再让不同的实验各自精彩。平台统一页面与物理能力，你专注于真实、清楚、可操作的三维装置。'),
        list(['阅读代码规范，下载代码风格工具包。', '复制 AGENTS.md 到实验目录，或把生成的任务提示词交给你的开发助手。', '找到对应实验的场景工厂、WorkspaceRuntime 和已有行为测试，先复用，再扩展。', '实现纯三维装置，遵循 Warm Lab 视觉与生命周期标准。', '完成类型、lint、行为测试和桌面/手机检查，通过 GitHub PR 提交。']),
        note('当前开放范围', '文档、AGENTS.md、格式配置与代码风格工具包可直接使用。公开实验 SDK、ZIP 投稿、审核后自动发布仍在建设；当前贡献通过仓库 PR。'),
      ]),
      section('responsibility', '先分清谁负责什么', [table(['平台负责', '贡献者负责'], [['引擎、单位、场景命令、结果校验', '三维器材、场景、光照、材质'], ['页面、参数控件、记录、报告、作者展示', '器材拖动、选择、高亮、观察视角'], ['登录、权限、版本与发布流程', '教学内容、参考用例、素材许可']])]),
      section('workflow', '在现有仓库中工作', [
        code('克隆与准备 · 不包含生产凭据', 'shell', 'git clone https://github.com/你的用户名/PhysicsOS.git\ncd PhysicsOS\ngit submodule update --init --recursive\nnode scripts/overlay/harness-overlay.mjs apply\npnpm install\npnpm -C vendor/deepseek-harness install'),
        p('Node.js ≥ 24.7；根工作区使用 packageManager 固定的 pnpm 版本，Harness 使用它自己的版本。项目维护者的构建/测试环境遵循项目 AGENTS.md；社区开发者不需要生产服务器权限。'),
        note('源码位置', 'Web 自有代码以 overlays/harness/files 为真值，packages 存放领域包。overlay 应用进 vendor 后再构建；不能在生成结果里修好后忘记同步源码。'),
      ]),
      section('first', '第一个贡献应该足够小', [p('建议从凸透镜的一种器材或一段交互开始：补全光屏拖动与取消、改进器材材质、修复手机标注遮挡。一个 PR 只解决一个可以验证的问题，不连带重写整个工作台。')]),
    ],
  },
  {
    id: 'code-style', group: '统一标准', title: '代码风格', subtitle: '明确到文件名、类型边界和 Promise，让人与 Agent 都有同一份依据。', tag: '必须遵守', file: 'CODE_STYLE.md',
    sections: [
      section('rules', '一张表，约定日常代码', [table(['项目', '统一约定', '例子 / 说明'], styleRows)]),
      section('naming', '新代码统一命名，旧代码保持稳定', [
        code('推荐目录命名', 'text', 'convex-lens/\n  experiment-page.tsx\n  experiment-page.module.css\n  lens-renderer.ts\n  lens-interaction.ts\n  lens-assets.ts\n  types.ts\n  tests/\n    lens-interaction.test.ts'),
        note('与已有代码的关系', 'docs/02-ENGINEERING-STANDARDS.md §40 要求 kebab-case 文件名；旧 Web 中存在 PascalCase 文件。新实验采用文档规则，既有文件不为本次贡献批量改名。组件导出仍然是 PascalCase。'),
      ]),
      section('types', '让类型表达边界', [
        code('先验证，再使用', 'typescript', "interface ScreenReading {\n  readonly distanceMeters: number\n  readonly isSharp: boolean\n}\n\nexport function isScreenReading(value: unknown): value is ScreenReading {\n  if (typeof value !== 'object' || value === null) return false\n  if (!('distanceMeters' in value) || !('isSharp' in value)) return false\n\n  return typeof value.distanceMeters === 'number'\n    && Number.isFinite(value.distanceMeters)\n    && typeof value.isSharp === 'boolean'\n}"),
        list(['Props 和可视快照只读；不通过类型断言把错误数据“变正确”。', '非空断言、any、@ts-ignore 不能用来代替边界校验。', '单位写进边界类型或变量名称：distanceMeters 与 distanceCm 不混用。', '优先具名导出；功能相近的文件放在同一实验目录。']),
      ]),
      section('async', '异步与副作用必须有归属', [
        code('取消、错误和清理都有出口', 'typescript', "export async function loadTexture(\n  url: string,\n  signal: AbortSignal,\n): Promise<Blob> {\n  const response = await fetch(url, { signal })\n  if (!response.ok) throw new Error('纹理加载失败，请重试。')\n  return response.blob()\n}"),
        p('异步结果返回时检查实例是否仍存在。不要在渲染函数里启动请求，不吞掉错误后显示成功，不把整个页面订阅到每一帧。'),
      ]),
      section('tools', '提示词约束意图，工具约束结果', [
        table(['层级', '负责检查'], [['AGENTS.md', '范围、架构边界、物理事实、资源清理、交付方式'], ['Prettier', '缩进、引号、分号、换行与尾逗号'], ['ESLint / 仓库 oxlint', '类型使用、未处理 Promise、危险写法'], ['TypeScript', '契约、参数与空值边界'], ['测试与评审', '行为正确性、物理真实性、性能和体验']]),
        p('独立工具包使用 ESLint；正式 Harness Web 继续使用现有 oxlint。格式化目标为 100 列，仓库 oxlint 有 140 列上限，两者不是相互替代。根 prettier 默认忽略 overlays，修改 Web 应使用仓库 Web lint，并按所在目录规则整理格式。'),
      ]),
    ],
  },
  {
    id: 'structure', group: '统一标准', title: '目录与模块边界', subtitle: '把计算、呈现与交互拆开，给后来接手的人留出空间。', tag: '架构', file: 'ARCHITECTURE.md',
    sections: [
      section('source', '先找到真实源码', [table(['位置', '用途'], [['packages/engine-*', '物理求解与领域模型'], ['packages/physics-scene', '场景结构、命令、修订与来源'], ['overlays/harness/files/packages/client/ui-physicsos/src/client', '平台 UI 与运行时适配源码'], ['vendor/deepseek-harness', '上游源码与 overlay 应用结果；不是自有代码编辑入口']])]),
      section('layers', '每个文件只回答一个问题', [table(['模块', '允许做', '不允许做'], [['experiment-page.tsx', '组合共享控件、教学内容和实验台', '另做账号、报告和第二套参数面板'], ['lens-renderer.ts', '把可视快照投影为三维装置', '导入求解器、自己推算物理量'], ['lens-interaction.ts', '拾取、坐标转换、preview/commit/cancel', '直接改 Scene 字段或数据库'], ['lens-assets.ts', '资源加载、引用计数与释放', '无归属的全局缓存'], ['领域引擎', '计算、可处理条件、校验结果', '引用 React、DOM 或 Three 对象']])]),
      section('shared', '复用现有能力', [p('优先接入现有 WorkspaceRuntime、场景命令、实验指南、报告和学习记录。跨实验都需要的能力放到共享层，并为已有消费者保留兼容；只有某个实验使用的装置留在该实验目录。'),note('不要提前依赖尚未发布的 SDK', '当前仓库接口与未来公共 SDK 是两层契约。公开 SDK 仍在设计，文档中的生命周期结构仅表达约定，不代表已经存在的 npm 包。')]),
    ],
  },
  {
    id: 'physics', group: '统一标准', title: '物理与状态', subtitle: '代码风格的核心，也包括“谁有权决定这个数字”。', tag: '架构红线', file: 'PHYSICS_STANDARD.md',
    sections: [
      section('truth', '唯一事实源', [p('PhysicsScene Runtime 保存已提交的物理条件；引擎生成结果与校验。React、Three Object3D、图表和助教只展示或解释它们，不能各自维护一套质量、速度、焦距或时间。'),code('一条状态链', 'text', '参数操作 / 器材拖动\n  → 场景命令与校验\n  → 场景修订\n  → 引擎结果与可视快照\n  → 三维装置、读数、记录、报告')]),
      section('preview', '把预览与提交分开', [list(['pointermove：显示临时预览，不写持久化记录。', 'pointerup：提交一次有效命令，产生可追溯的场景修订。', 'pointercancel / Escape：恢复上次已提交条件。', '切换页面与卸载：取消未完成拖动，移除事件。', '从题目进入实验：变更题面条件时建立实验分支，保留恢复原题入口。'])]),
      section('units', '单位与时间要明确', [p('计算采用平台单位系统。场景坐标可以采用便于展示的尺度，但转换必须集中在桥接边界，说明原点、方向和比例。不得把显示时间当物理时间，不得通过改变物理结果来追求顺滑动画。'),note('三维呈现 ≠ 任意三维求解', '将薄透镜光路放入三维光具座是呈现升级；若改变空间模型或引入新力学自由度，需要扩展求解器和独立验证。')]),
      section('cases', '验算用例要独立给出', [table(['条件（cm）', '预期结果'], [['f=10，u=30', 'v=15；倒立、缩小、实像'], ['f=10，u=20', 'v=20；倒立、等大、实像'], ['f=10，u=15', 'v=30；倒立、放大、实像'], ['f=10，u=10', '无有限位置的像；出射光平行'], ['f=10，u=5', '虚像位于物体同侧；正立放大；光屏不能承接']]),p('测试期望来自独立参考值或推导，不调用被测函数来计算期望。临界值附近、非法参数与保存恢复同样要检查。')]),
    ],
  },
  {
    id: 'three', group: '统一标准', title: '三维与交互', subtitle: '统一生命周期、输入方式与性能边界，实验才能长期稳定运行。', tag: '3D ONLY', file: 'THREE_STANDARD.md',
    sections: [
      section('lifecycle', '四个清楚的生命周期', [table(['阶段', '责任'], [['mount', '创建相机、renderer、controls、装置与监听；绑定资源所有权'], ['update', '消费已有快照，更新变换、读数、显示状态；不重建整页'], ['resize', '同步画布、相机和分辨率，不重置实验条件'], ['dispose', '取消 RAF，移除监听/Observer，释放控件与自有 GPU 资源']]),note('这是一份接口责任约定', '公开 mount/update/resize/dispose SDK 尚未发布。仓库实现继续使用真实接口，不复制虚构 import。')]),
      section('input', '直接操作，也能精确操作', [list(['统一三维入口，无二维切换；视角归位与复位实验分开。', '拖动器材时锁定相机；拖动空白才旋转，滚动/双指按约定缩放。', '同一参数支持拖动、数值输入与键盘；触摸目标至少 44 CSS px。', '标签避让器材与彼此，超出视野时保留真实读数，不把离屏物体硬贴到边界。', '加载失败与 context loss 提供重试和状态说明，保留已提交条件与记录。'])]),
      section('performance', '建议的首版验收预算', [table(['项目', '首版目标（需真机记录）'], [['像素比', '默认 DPR ≤ 1.5，按设备降低'], ['静态实验', '只在条件、视角或尺寸变化时绘制'], ['动态实验', '使用平台时钟；后台暂停；不每帧重渲染整页'], ['手机', '目标设备持续交互 ≥ 30fps；记录设备、浏览器、采样时段'], ['资源', '压缩模型与纹理；按实验加载；提交压缩体积与显存统计'], ['销毁', '连续进入/退出至少 10 次，无持续增长的 listener / renderer / GPU 资源']]),p('这些是规范目标，不是当前全部实验已经达到的指标。性能优化不能牺牲物理精度。大场景的预算需在评审中给出理由。')]),
    ],
  },
  {
    id: 'visual', group: '统一标准', title: 'Warm Lab 视觉规范', subtitle: '同一间温暖、安静的实验室，容纳不同开发者的好作品。', tag: '设计基准', file: 'VISUAL_STANDARD.md',
    sections: [
      section('foundation', '统一的是系统，不是每个像素', [p('采用已选定的暖色拟真实验台：暖白底色、自然木质或领域适配背景、柔和光照、可信器材和灰绿色控件。装置占据主视野，页面保持清楚的层次与留白。'),table(['层级', '要求'], [['页面', '标题与目标 → 实验台与参数 → 关键读数 → 探究条件 → 记录与作者'], ['控件', '复用共享按钮、输入、滑杆、图层、错误与加载状态'], ['场景', '桌面装置可用木桌；波动/天体等使用适合背景，仍遵循同一色彩与材质规则'], ['标注', '物理语义色固定，数值始终来自快照；单位与可读性优先'], ['手机', '先装置后参数；无页面横向溢出；控件不压住器材']])]),
      section('tokens', '主题基准值', [code('候选主题 token · 接入时映射到平台语义 token', 'css', ':root {\n  --lab-bg: #fafaf7;\n  --lab-surface: #fffdf9;\n  --lab-text: #2e3d38;\n  --lab-muted: #687369;\n  --lab-accent: #567d70;\n  --lab-border: #e5e6df;\n  --lab-radius: 10px;\n}'),p('这是新的 Warm Lab 基准，尚未替换全站主题。贡献实现不得用全局 :root 覆盖宿主；由共享主题容器提供 token。细小文字不使用过浅灰，键盘焦点和状态对比度必须清楚。')]),
      section('materials', '素材服务于物理表达', [list(['模型用 GLB/glTF，纹理优先压缩并注明来源。', '生图可用于环境、贴图和封面；不能把动态读数、光路、坐标或公式烘焙进图片。', '玻璃、金属、塑料的材质要可信，但不堆叠发光、后处理和昂贵反射。', '光屏模糊等非完整物理模拟，注明教学示意，不假称波动光学求解。', '外部素材保留作者、许可证与修改记录，不能只提供一条“网络图片”来源。'])]),
    ],
  },
  {
    id: 'package', group: '贡献与发布', title: '实验包格式', subtitle: '先约定可审阅、可验证的格式，再开放自动上传。', tag: 'V1 草案', file: 'PACKAGE_SPEC.md',
    sections: [
      section('status', '格式正在收敛，上传尚未开放', [note('明确边界', '本页是实验包 V1 草案。当前提供清单示例与 JSON Schema 供讨论和准备，不是已接通的上传协议。公开 SDK 和服务器包校验发布前，以仓库 PR 为准。')]),
      section('tree', '建议的提交结构', [code('一个实验，一个贡献包', 'text', 'convex-lens/\n  experiment.json\n  src/\n    main.ts\n    lens-renderer.ts\n    lens-interaction.ts\n  assets/\n    apparatus.glb\n    cover.webp\n  teaching.json\n  cases.json\n  README.md\n  MODEL.md\n  ASSET-LICENSES.json\n  LICENSE'),p('main.ts 入口需等待 SDK 契约确定。源码包不包含 node_modules、密钥、会话或预装依赖；平台构建不执行投稿者任意安装脚本。')]),
      section('manifest', '清单中需要表达的内容', [code('experiment.json · 候选结构', 'json', JSON.stringify({ schemaVersion: 1, experimentId: 'convex-lens', version: '1.0.0', entry: 'src/main.ts', renderer: 'three', theme: 'physicsos-warm-lab-v1', engine: { id: 'optics', contractVersion: 1 }, cover: 'assets/cover.webp', teaching: 'teaching.json', referenceCases: 'cases.json', assetLicenses: 'ASSET-LICENSES.json', license: 'Apache-2.0' }, null, 2)),p('SDK 版本范围待正式发布时加入必填契约，不填写一个不存在的版本。experimentId 必须与投稿入口对应；版本号冻结到具体产物摘要。作者主身份由登录账号绑定，不信任包里自填的用户 ID。')]),
      section('validation', 'Schema 只是第一道检查', [p('下载包附带的 JSON Schema 检查字段与基本格式；解压路径、符号链接、资源 MIME、压缩炸弹、依赖与执行隔离必须由服务器单独验证。通过 JSON Schema 不代表物理正确、资源安全或已获审核。')]),
    ],
  },
  {
    id: 'review', group: '贡献与发布', title: '提交与审核', subtitle: '让代码、结果和作者一起被看见，也让每一次发布可追溯。', tag: '当前 + 规划', file: 'SUBMISSION_REVIEW.md',
    sections: [
      section('today', '当前：通过 Pull Request 贡献', [list(['从最新 main 创建聚焦的贡献分支。', '提交源码与资料，运行对应检查，附清楚的变更说明。', '包含典型/边界用例、桌面/手机截图与限制说明。', '由维护者评审，CI 通过后整合；不要自行绕过生产发布流程。']),code('正式 Web 检查', 'shell', 'pnpm typecheck:web\npnpm lint:web\npnpm test:web\npnpm build:web\ngit diff --check'),p('这些命令用于完整 PhysicsOS 仓库，不用于下载的独立风格工具包。修改领域引擎时补对应包测试；本机缺少依赖不代表服务器环境不可用。')]),
      section('future', '规划：对应实验上传，审核后自动发布', [code('计划中的流程', 'text', '对应实验 → 贡献实验 → 上传 ZIP 与作者资料\n  → 自动校验 / 隔离构建\n  → 管理员交互预览 / 审核\n  → 通过后自动更新默认版本\n  → 实验页显示新效果与本次作者'),p('最新审核通过的版本直接成为默认效果，不新增普通用户社区版本选择器。历史版本保留作追溯与回滚。发布失败保留旧版；正在运行的实验继续固定原版本。')]),
      section('evidence', '审核需要的证据', [table(['检查面', '材料'], [['代码一致性', '格式、命名、lint、类型检查结果'], ['物理可信', '引擎绑定、参考值、临界值、适用模型'], ['交互', '拖动提交/取消、键盘/触摸、复位与保存恢复'], ['三维稳定', '资源大小、性能数据、重复挂载、context loss'], ['作者与许可', '署名、GitHub、共同作者、每项素材来源']]),note('独立实验代码需要隔离', '未来投稿在隔离构建和受限实验视图区中运行，通过允许的消息协议调用平台能力。源码不能访问主站凭据、Cookie、其他用户记录或生产数据库。')]),
    ],
  },
  {
    id: 'authors', group: '贡献与发布', title: '作者与 GitHub', subtitle: '把作品署名展示清楚，同时保留共同贡献和素材来源。', tag: '资料标准', file: 'AUTHOR_STANDARD.md',
    sections: [
      section('profile', '每份作品都有明确作者', [table(['字段', '说明'], [['显示名称', '公开署名；与登录账号绑定'], ['简介', '简短介绍与贡献范围，不发布联系方式或私人资料'], ['GitHub 个人主页', '用于展示个人链接与对应头像'], ['源码仓库', '单独填写；仓库组织不一定等于作者'], ['头像上传', '未提供 GitHub 时使用上传图片'], ['共同作者', '列出姓名、链接、分工与授权']])]),
      section('avatar', '头像显示优先级', [list(['提供 GitHub 个人主页 → 自动显示对应 GitHub 头像。', '未提供 GitHub → 使用上传头像。', '没有头像或加载失败 → 使用姓名缩写。']),p('GitHub 头像应缓存并统一裁切尺寸。链接仅代表填写了该地址，不代表身份已认证；完成 GitHub 绑定后才能出现认证标识。服务端仅通过受控 GitHub 接口获取资料，不能抓取任意头像 URL。')]),
      section('credit', '署名与版本一起发布', [p('实验顶部展示当前默认版本主要作者，底部展示共同作者、仓库、许可证和版本。新作品审核通过后，默认效果与作者同时更新。既有作者的贡献历史和第三方素材署名仍保留。'),note('许可不是装饰字段', '自有代码与文档遵循仓库 Apache-2.0 规则。第三方模型、纹理和图片分别记录许可证、来源与是否修改；不把不兼容素材一并宣称为 Apache-2.0。')]),
    ],
  },
  {
    id: 'agents', group: '开发工具', title: 'AGENTS.md 提示词', subtitle: '让开发助手从第一行代码开始，就遵循相同的实验标准。', tag: '复制即用', file: 'AGENTS.md',
    sections: [
      section('use', '放到实验目录，让规则随代码走', [p('填写实验 ID，生成只针对该实验的提示词。将 AGENTS.md 保存到实验目录；如果编辑器不会自动读取它，把完整内容作为任务上下文提供。各类工具的自动加载机制不同，不要只假设它已经读过。'),note('一致性来自组合', '提示词表达意图，格式化和 lint 检查代码，行为测试与评审确认结果。AGENTS.md 不能单独保证正确性，也不替代父目录约定。')]),
      section('prompt', '统一开发约定', [{ type: 'agent' }]),
    ],
  },
  {
    id: 'downloads', group: '开发工具', title: '规范与工具包', subtitle: '把规范、提示词和自动检查一起带回你的编辑器。', tag: '可下载', file: 'DOWNLOADS.md',
    sections: [
      section('kit', '代码风格工具包', [p('ZIP 包含可执行的 Prettier、ESLint、TypeScript 和命名检查配置，附最小类型示例、全部 Markdown 文档和 AGENTS.md。它是代码一致性工具包，不包含完整实验 SDK、Three.js 样板或上传客户端。'),{ type: 'downloads' }]),
      section('commands', '在独立工具包里验证', [code('解压后运行 · 首次安装需联网', 'shell', 'npm install\nnpm run format:write\nnpm run check'),p('Node.js ≥ 24.7。依赖使用精确版本；首次安装后保留生成的锁文件，之后使用 npm ci。工具包里的 check = 格式 + 文件命名 + ESLint + TypeScript；不等于完成物理测试或视觉验收。'),note('接入已有仓库时', '不要覆盖仓库现有 package.json、ESLint、TypeScript 配置。将新实验代码和必要规则按现有机制接入，继续执行项目 required checks。')]),
      section('versions', '规范版本跟随贡献记录', [p('本页代码风格规范为 v1.0，包格式与公开 SDK 仍属候选设计。每次修改规范应更新版本和变更记录；旧投稿按其兼容版本复验，不静默改写已审核产物。')]),
    ],
  },
]

export function documentMarkdown(doc) {
  if (doc.id === 'agents') return agentInstructions()
  const chunks = [`# ${doc.title}`, '', doc.subtitle, '']
  for (const item of doc.sections) {
    chunks.push(`## ${item.title}`, '')
    for (const block of item.blocks) {
      if (block.type === 'paragraph') chunks.push(block.text, '')
      if (block.type === 'note') chunks.push(`> **${block.title}**：${block.text}`, '')
      if (block.type === 'list') chunks.push(...block.items.map(text => `- ${text}`), '')
      if (block.type === 'code') chunks.push(`### ${block.title}`, '', '```' + block.language, block.value, '```', '')
      if (block.type === 'table') chunks.push(`| ${block.headers.join(' | ')} |`, `| ${block.headers.map(() => '---').join(' | ')} |`, ...block.rows.map(row => `| ${row.map(text => text.replaceAll('|', '\\|')).join(' | ')} |`), '')
      if (block.type === 'downloads') chunks.push('下载项：physicsos-code-style-v1.zip、AGENTS.md、experiment.schema.json、experiment.example.json。', '')
    }
  }
  return chunks.join('\n')
}
