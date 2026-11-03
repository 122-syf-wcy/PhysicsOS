import { agentInstructions, styleRows } from './standards.js'

const p = text => ({ type: 'paragraph', text })
const note = (title, text) => ({ type: 'note', title, text })
const list = items => ({ type: 'list', items })
const code = (title, language, value) => ({ type: 'code', title, language, value })
const table = (headers, rows) => ({ type: 'table', headers, rows })
const section = (id, title, blocks) => ({ id, title, blocks })

export const documents = [
  {
    id: 'start', group: '开始贡献', title: '从这里开始', subtitle: '独立制作实验文件，上传到对应实验；审核通过后自动同步展示。', tag: '文件贡献', file: 'GETTING_STARTED.md',
    sections: [
      section('path', '贡献的是实验文件，不是主站源码', [
        p('你只需要自己的实验目录：下载模板、制作三维装置、打包 ZIP。平台负责加载与展示，后台审核通过后把最新版本设为该实验的默认效果。无需克隆 PhysicsOS、修改主站或提交 PR。'),
        list(['下载独立实验模板，填写 experimentId 与版本。', '复制 AGENTS.md 到该目录，让开发助手只修改这个实验包。', '在独立预览器中制作三维装置，使用宿主快照与参数意图接口。', '运行检查、构建与打包，取得 release 目录中的 ZIP。', '在对应实验页上传文件与作者资料；审核通过后平台自动同步。']),
        note('首个开放样板：凸透镜', '登录后点击侧栏“实验上传”，直接提交 ZIP、查看投稿及审核记录；也可打开凸透镜实验，点击“贡献实验”。统一入口地址为 /#/contribute。本版本支持凸透镜上传、平台管理员审核、默认版本切换与回滚，其他实验逐步适配。请上传 npm run pack 生成的 release ZIP，不要直接上传刚下载的源码模板 ZIP。'),
      ]),
      section('responsibility', '两边通过文件与协议连接', [table(['平台统一提供', '贡献者交付'], [['实验路由、登录、作者、审核与发布', '一个对应 experimentId 的版本化 ZIP'], ['物理引擎、参数、记录、报告', '读取快照的三维视图区与交互'], ['隔离加载、权限校验和历史回滚', '入口 HTML、编译脚本、模型、贴图、说明与参考用例']])]),
      section('workflow', '只在自己的实验目录开发', [
        code('下载模板并解压后 · 首次安装需联网', 'shell', 'npm install\nnpm run dev\n# 浏览器打开 http://127.0.0.1:4175\n# 修改 src 后，重新运行 npm run build 并刷新预览\n\nnpm run format:write\nnpm run check\nnpm run build\nnpm run pack'),
        p('模板需要 Node.js ≥ 24.7，不需要 PhysicsOS 仓库或生产服务器权限。dev 会先构建再启动独立预览；它没有自动热更新。模板内 Three.js 从本地依赖打包，发布时不依赖 CDN。'),
        note('产物在哪里', 'npm run pack 生成 release/convex-lens-1.0.0.zip。ZIP 根目录有 experiment.json，入口为 dist/index.html；平台解压后按清单直接加载。模板里的 preview 只供开发，不进入投稿 ZIP。'),
      ]),
      section('first', '先验证“文件可以独立工作”', [p('下载的模板已经演示宿主参数 → 消息快照 → 三维装置更新。它是最小开发骨架，不是完成的凸透镜成品；贡献者继续完善器材、拖动、光路、标注和手机体验。即使关闭主站，这个独立目录仍可启动自己的预览。')]),
    ],
  },
  {
    id: 'code-style', group: '统一标准', title: '代码风格', subtitle: '明确到文件名、类型边界和 Promise，让人与 Agent 都有同一份依据。', tag: '必须遵守', file: 'CODE_STYLE.md',
    sections: [
      section('rules', '一张表，约定日常代码', [table(['项目', '统一约定', '例子 / 说明'], styleRows)]),
      section('naming', '新代码统一命名，旧代码保持稳定', [
        code('推荐目录命名', 'text', 'convex-lens/\n  experiment-page.tsx\n  experiment-page.module.css\n  lens-renderer.ts\n  lens-interaction.ts\n  lens-assets.ts\n  types.ts\n  tests/\n    lens-interaction.test.ts'),
        note('文件内保持一致即可', '实验文件包是独立工程。统一采用 kebab-case、TypeScript 严格类型与具名导出；无需迁就或修改主站旧文件。基础模板是 Three.js + TypeScript，不依赖主站 React 实例。'),
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
        table(['层级', '负责检查'], [['AGENTS.md', '范围、架构边界、物理事实、资源清理、交付方式'], ['Prettier', '缩进、引号、分号、换行与尾逗号'], ['ESLint', '类型使用、未处理 Promise、危险写法'], ['TypeScript', '契约、参数与空值边界'], ['测试与评审', '行为正确性、物理真实性、性能和体验']]),
        p('实验模板自带 Prettier、ESLint、TypeScript 与文件命名检查。模板命令作用于自己的目录，不调用主站 pnpm 或 overlay 构建。平台审核还要检查行为、源码与编译产物是否对应，格式通过不等于审核通过。'),
      ]),
    ],
  },
  {
    id: 'structure', group: '统一标准', title: '目录与模块边界', subtitle: '把计算、呈现与交互拆开，给后来接手的人留出空间。', tag: '架构', file: 'ARCHITECTURE.md',
    sections: [
      section('source', '这是一个独立目录', [table(['文件', '责任'], [['experiment.json', '目标实验、版本、入口、协议与依赖声明'], ['src/main.ts / protocol.ts', '初始化三维与校验宿主消息'], ['src/lens-renderer.ts', '根据只读快照显示器材，不引用平台源码'], ['public / dist', '静态入口与编译后的自包含浏览器文件'], ['preview / tools / tests', '本地宿主、构建校验打包、行为验证']])]),
      section('layers', '每个模块只回答一个问题', [table(['模块', '允许做', '不允许做'], [['入口', '创建实验视图区、连接宿主、声明清理', '创建主站导航、登录或审核入口'], ['renderer', '把标准快照投影为三维装置', '导入主站内部求解器或自行宣称物理校验'], ['interaction', '拾取与 preview/commit/cancel 意图', '修改 parent.document、Cookie 或数据库'], ['assets', '本包资源加载与释放', '运行时 CDN、跨包路径、远端代码'], ['本地预览宿主', '提供标明来源的开发快照', '冒充已接入生产引擎或已完成审核']])]),
      section('shared', '共享能力通过协议，不通过源码引用', [p('参数面板、物理求解、记录、报告与作者由宿主管理。实验包只通过固定消息协议接收快照和发送操作意图，不 import @physicsos 内部包。平台以后如何重构，只要保持协议兼容，已审核实验文件就仍能加载。'),note('协议状态', '协议 v1 已由模板预览器与凸透镜平台适配器共同实现。本地 source 为 preview-fixture；平台实际实验为 platform-engine，物理结果由现有光学引擎提供。')]),
    ],
  },
  {
    id: 'physics', group: '统一标准', title: '物理与状态', subtitle: '代码风格的核心，也包括“谁有权决定这个数字”。', tag: '架构红线', file: 'PHYSICS_STANDARD.md',
    sections: [
      section('truth', '唯一事实源', [p('正式宿主持有已提交条件，调用平台引擎生成快照与校验。实验包只接收它，不在 Three Object3D 或其他状态中另造一套计算。独立预览宿主提供标明 preview-fixture 的调试快照，不等于正式引擎验证。'),code('一条状态链', 'text', '参数操作 / 器材拖动\n  → 场景命令与校验\n  → 场景修订\n  → 引擎结果与可视快照\n  → 三维装置、读数、记录、报告')]),
      section('preview', '把预览与提交分开', [list(['pointermove：显示临时预览，不写持久化记录。', 'pointerup：提交一次有效命令，产生可追溯的场景修订。', 'pointercancel / Escape：恢复上次已提交条件。', '切换页面与卸载：取消未完成拖动，移除事件。', '从题目进入实验：变更题面条件时建立实验分支，保留恢复原题入口。'])]),
      section('units', '单位与时间要明确', [p('计算采用平台单位系统。场景坐标可以采用便于展示的尺度，但转换必须集中在桥接边界，说明原点、方向和比例。不得把显示时间当物理时间，不得通过改变物理结果来追求顺滑动画。'),note('三维呈现 ≠ 任意三维求解', '将薄透镜光路放入三维光具座是呈现升级；若改变空间模型或引入新力学自由度，需要扩展求解器和独立验证。')]),
      section('cases', '验算用例要独立给出', [table(['条件（cm）', '预期结果'], [['f=10，u=30', 'v=15；倒立、缩小、实像'], ['f=10，u=20', 'v=20；倒立、等大、实像'], ['f=10，u=15', 'v=30；倒立、放大、实像'], ['f=10，u=10', '无有限位置的像；出射光平行'], ['f=10，u=5', '虚像位于物体同侧；正立放大；光屏不能承接']]),p('测试期望来自独立参考值或推导，不调用被测函数来计算期望。临界值附近、非法参数与保存恢复同样要检查。')]),
    ],
  },
  {
    id: 'three', group: '统一标准', title: '三维与交互', subtitle: '统一生命周期、输入方式与性能边界，实验才能长期稳定运行。', tag: '3D ONLY', file: 'THREE_STANDARD.md',
    sections: [
      section('lifecycle', '四个清楚的生命周期', [table(['阶段', '责任'], [['mount', '创建相机、renderer、controls、装置与监听；绑定资源所有权'], ['update', '消费已有快照，更新变换、读数、显示状态；不重建整页'], ['resize', '同步画布、相机和分辨率，不重置实验条件'], ['dispose', '取消 RAF，移除监听/Observer，释放控件与自有 GPU 资源']]),note('模板中的真实入口', 'src/main.ts 调用 connectExperiment 与 mountLens，后者返回 update/dispose；ResizeObserver 处理尺寸。这里的代码随模板一起交付，不依赖一个不存在的 npm SDK。')]),
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
    id: 'package', group: '贡献与发布', title: '实验包格式', subtitle: '一个独立文件包，经过审核后自动展示。', tag: 'V1 · 凸透镜', file: 'PACKAGE_SPEC.md',
    sections: [
      section('status', '平台加载的是已审核的文件包', [p('贡献者在本地编译，交付带源码的浏览器静态包。平台校验后在隔离域提供 dist/index.html，通过消息协议接入参数和快照。贡献者无需修改主仓库，主站也不需要为每次投稿重新构建。'),note('首版接收范围', '仅接收 convex-lens、optics contractVersion 1、protocolVersion 1。服务器校验并冻结已编译产物，不执行上传包中的安装或构建脚本。物理、视觉与许可由管理员交互审核；自动校验不表示审核通过。')]),
      section('tree', 'ZIP 根目录固定', [code('提交产物 · 工具自动收集', 'text', 'experiment.json\ndist/\n  index.html\n  runtime/main.js\n  runtime/protocol.js\n  runtime/lens-renderer.js\n  vendor/three.module.js\n  vendor/three.core.js\n  assets/\nsrc/\n  main.ts\n  protocol.ts\n  lens-renderer.ts\nparameters.json\nteaching.json\ncases.json\nREADME.md\nMODEL.md\nASSET-LICENSES.json\nLICENSE'),p('ZIP 不要再套一层随机目录。src 用于审核，dist 用于实际运行，二者必须对应。node_modules、preview、.env 和本机数据不会进入 pack 的白名单；dist 内的隐藏文件、符号链接和超限资源会被拒绝。')]),
      section('manifest', '实验包清单', [code('experiment.json · 参考文件协议 v1', 'json', JSON.stringify({schemaVersion:1, protocolVersion:1, packageType:'browser-static', experimentId:'convex-lens', version:'1.0.0', entry:'dist/index.html', renderer:'three', theme:'physicsos-warm-lab-v1', engine:{id:'optics',contractVersion:1}, parameters:'parameters.json', cover:'dist/assets/cover.jpg', teaching:'teaching.json', referenceCases:'cases.json', assetLicenses:'ASSET-LICENSES.json', license:'Apache-2.0'},null,2)),p('experimentId 必须匹配上传页；作者身份由登录账户绑定。入口和所有资源采用包内相对路径，不引用贡献者磁盘或外部脚本。版本和审核产物冻结；改一个文件就提交新版本。')]),
      section('validation', '本地检查与服务器审核各自负责', [table(['本地工具', '服务器与审核'], [['必需文件、入口、清单基本字段、相对入口资源', '登录权限、目标实验、清单协议与资源类型'], ['符号链接、隐藏文件、1000 文件/40 MiB 总量/20 MiB 单文件', '20 MiB ZIP、解压体积、重复路径、CRC、模块依赖与包内资源'], ['格式、命名、类型、lint、基础打包测试', '人工核对源码与产物、物理参考用例、手机操作与素材许可']]),p('本地检查不是安全认证或审核通过。即便本地工具没有发现问题，服务端也必须重新验证同一份不可变 ZIP。')]),
    ],
  },
  {
    id: 'protocol', group: '贡献与发布', title: '宿主与实验协议', subtitle: '用固定消息交换状态，实验文件不依赖主站内部代码。', tag: '参考协议 v1', file: 'HOST_PROTOCOL.md',
    sections: [
      section('boundary', '视图区与平台分开运行', [p('平台加载清单 entry 指定的 HTML 到隔离 iframe。父页面提供参数、记录、报告、作者；包内页面只创建三维实验视图区。实验文档通过强制 sandbox 与包路径 CSP 隔离，也可配置独立资源域。不能依赖 parent.document、同源存储或平台 Cookie。'),note('模板预览的身份', '独立预览器已实现参考握手和快照交互；它不是正式上传后台，也没有生产账号或引擎。不要自行写一个假 /upload 接口当成平台接入。')]),
      section('handshake', '一次握手，一条专属通道', [list(['宿主为每次挂载生成随机 channel，并将精确 hostOrigin 与 channel 放入入口查询参数。channel 不是账号令牌。', '实验向精确 hostOrigin 发送 experiment/ready，包含 protocolVersion: 1 和 channel。', '宿主检查 event.source 为该 iframe、sandbox 不透明 origin、channel 与协议版本，创建 MessageChannel。', '宿主只向这个 iframe 发送 experiment/connect 并转移一个端口；实验检查 event.source === parent、精确宿主 origin、channel 后接受。', '由于 sandbox 使用不透明 origin，宿主这一次端口转移需 targetOrigin="*"；它只面向已绑定 iframe，不携带用户数据。后续状态通过 MessagePort，不能广播到 window。', '关闭或重新加载时关闭端口，旧通道不能影响新实例。'])]),
      section('messages', '消息与方向', [table(['消息', '方向', '用途'], [['experiment/ready → experiment/connect → experiment/connected', '实验 ↔ 宿主', '握手及端口确认'], ['experiment/snapshot', '宿主 → 实验', '只读 revision、source、parameters、visible、rays、result'], ['parameter/preview', '实验 → 宿主', 'id/value，临时显示，不落库'], ['parameter/commit', '实验 → 宿主', 'id/value，校验后提交一次'], ['parameter/cancel', '实验 → 宿主', '取消当前预览']]),p('宿主必须限制参数 ID、数值范围、消息大小与频率；未知消息拒绝或忽略。实验必须验证快照类型与有限数值。作者、发布权限与学习记录不能由实验消息指定。')]),
      section('snapshot', '凸透镜开发快照示例', [code('以 src/protocol.ts 为模板中的类型真值', 'json', JSON.stringify({revision:0,source:'preview-fixture',parameters:{objectDistanceCm:30,objectHeightCm:6,focalLengthCm:10,screenDistanceCm:15},visible:{image:true,rays:true},rays:[{points:[{x:-30,y:6},{x:0,y:6},{x:15,y:-3}]}],result:{imageDistanceCm:15,imageHeightCm:-3,imageKind:'real',screenSharp:true}},null,2)),p('参数与 ray.points/extension 坐标单位都是 cm；x 以透镜为原点、向光屏为正，y 以光轴为原点、向上为正。物高与 image/rays 显示开关仅由宿主控制；包内仍只能发送 objectDistanceCm、focalLengthCm、screenDistanceCm 三种有界参数意图。正式 rays 是引擎实际生成的光路与虚像延长线，renderer 只做显示裁剪，不重算物理。source=preview-fixture 明确表示开发数据。只有平台引擎实际生成的结果才能标记 platform-engine；展示该字段不构成独立的物理验证证明。')]),
      section('future', '平台已接入的能力', [p('凸透镜已接入登录投稿、文件校验、隔离预览、正式引擎快照、不可变发布与回滚。每次打开固定版本，测量记录保留文件包 ID 与摘要。其他实验暂不接受不兼容的包；贡献者无需修改平台内部源码。')]),
    ],
  },
  {
    id: 'review', group: '贡献与发布', title: '提交与审核', subtitle: '让代码、结果和作者一起被看见，也让每一次发布可追溯。', tag: '当前 + 规划', file: 'SUBMISSION_REVIEW.md',
    sections: [
      section('today', '投稿流程只围绕实验文件', [list(['在独立模板里完成开发与预览。', '运行 npm run check、npm run build、npm run pack。', '在凸透镜实验页选择“贡献实验”，提交生成的 ZIP、作者资料和版本说明。', '自动检查通过后进入后台审核，可退回修改。', '管理员通过后自动发布，新进入该实验的用户看到最新效果与作者。']),code('贡献者实际运行的命令', 'shell', 'npm run check\nnpm run build\nnpm run pack\n# 产物：release/convex-lens-1.0.0.zip'),note('接入状态', '凸透镜的完整链路由本版本提供。任意登录账户可以投稿；只有平台管理员（SUPER_ADMIN）能够审核并发布全站默认版本，学校管理员无法替换全站内容。上传成功不等于已经上线。')]),
      section('future', '审核后同步的是发布指针', [code('平台负责的发布链路', 'text', '接收 ZIP → 隔离存储 → 解压校验 → 交互审核\n  → 冻结文件与内容摘要\n  → 更新对应 experimentId 的默认发布版本\n  → 主站加载新入口与资源、展示该版本作者'),p('最新审核通过版本直接替换默认效果；历史用于审计与回滚。更新不热替换正在运行的实验；审核退回或已确认回滚的发布失败保留上一版。若存储故障使提交结果不确定，平台暂停服务，恢复后请刷新版本列表确认实际结果。每个运行会话固定 releaseId 与 protocolVersion。')]),
      section('evidence', '审核需要什么', [table(['检查面', '材料'], [['文件一致性', '源码与编译入口、清单、可重建依赖和资源摘要'], ['代码风格', 'format、命名、lint、typecheck 结果'], ['物理与交互', '引擎接口、参考用例、拖动取消/提交和模型限制'], ['三维稳定', '移动端、重复加载、资源释放、WebGL 失败提示'], ['作者与许可', '当前作者、GitHub、共同署名与素材许可']]),p('平台管理员在选中的审核预览中下载冻结审核 ZIP，核对其中源码、dist、cases.json 和素材许可；显示的完整 SHA-256 与批准请求一致。GET /physicsos/experiments/packages/:id/archive 只允许作者或 SUPER_ADMIN 登录下载，已批准版本仍受此限制；响应为不缓存的惰性 ZIP 附件，公开资源继续只提供 dist。提交新版本不能跳过审核；上传成功只表示接收文件，不代表已经公开或替换线上效果。')]),
    ],
  },
  {
    id: 'authors', group: '贡献与发布', title: '作者与 GitHub', subtitle: '把作品署名展示清楚，同时保留共同贡献和素材来源。', tag: '资料标准', file: 'AUTHOR_STANDARD.md',
    sections: [
      section('profile', '每份作品都有明确作者', [table(['字段', '说明'], [['显示名称', '公开署名；与登录账号绑定'], ['简介', '简短介绍与贡献范围，不发布联系方式或私人资料'], ['GitHub 个人主页', '用于展示个人链接与对应头像'], ['源码仓库', '首版写入包内 README；专用资料字段后续开放'], ['头像上传', '未提供 GitHub 时使用上传图片'], ['共同作者', '首版写入包内 README 与素材授权文件，保留姓名、分工与许可']])]),
      section('avatar', '头像显示优先级', [list(['提供 GitHub 个人主页 → 自动显示对应 GitHub 头像。', '未提供 GitHub → 使用上传头像。', '没有头像或加载失败 → 使用姓名缩写。']),p('首版直接显示 GitHub 头像，加载失败显示姓名缩写；专用缓存后续完善。链接不表示已验证账号归属。未填 GitHub 可上传不超过 256 KiB 的 PNG、JPEG、WebP；不接受任意远程头像地址。')]),
      section('credit', '署名与版本一起发布', [p('实验页显示当前版本的主要作者、头像、GitHub 与版本；完整的共同署名、源码和许可保留在包内审核资料中。新作品审核通过后，默认效果与作者同时更新。既有作者的贡献历史和第三方素材署名仍保留。'),note('许可不是装饰字段', '平台模板代码采用 Apache-2.0；贡献文件须明确代码许可与授权。第三方模型、纹理和图片分别记录许可证、来源与是否修改；不把不兼容素材一并宣称为 Apache-2.0。')]),
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
      section('kit', '独立实验模板', [p('优先下载独立实验模板 ZIP。里面有真实 TypeScript 三维入口、本地宿主、消息协议、风格检查、构建与打包工具。它可以离开 PhysicsOS 主仓库开发，不需要修改主站。模板是可运行骨架，直接拖动器材、完整光路等成品功能仍需贡献者完成。'),{type:'downloads'}]),
      section('commands', '在自己的目录执行', [code('下载、解压、开发、打包', 'shell', 'npm install\nnpm run dev\n\n# 修改代码后构建并刷新\nnpm run build\n\n# 提交前\nnpm run format:write\nnpm run check\nnpm run build\nnpm run pack'),p('Node.js ≥24.7。首次安装后保留锁文件；后续使用 npm ci。发布 ZIP 为 release/<experimentId>-<version>.zip，已编译页面的依赖位于包内。'),note('工具包和实验模板不要混淆', '代码风格工具包仍可单独下载，用于格式与命名；只有独立实验模板包含 dev/build/pack 和本地预览。不要把主站内部构建命令用于独立实验包。')]),
      section('versions', '文件协议与上线状态', [p('文档规范 v1.2，文件协议 v1。本版本首先接通凸透镜的上传、审核和默认展示；其他实验逐步适配。开发者在自己的目录制作，在对应实验提交，不需要 GitHub 自动部署或主站发布凭据。')]),
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
      if (block.type === 'downloads') chunks.push('下载项：physicsos-experiment-template-v1.zip、physicsos-code-style-v1.zip、AGENTS.md、experiment.schema.json、experiment.example.json。', '')
    }
  }
  return chunks.join('\n')
}
