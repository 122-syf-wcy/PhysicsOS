# PhysicsOS

> **开源公益项目**：面向初高中物理教学，公益定位。授权见 [`LICENSE`](./LICENSE)（Apache License 2.0，OSI 认证的开源许可，允许修改、分发与商业使用）。项目欢迎外部开发者共同维护，参与方式见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。
>
> **状态：公测开放（public beta）**。正式入口为 <https://physics.dongsiwei.com>。账户体系、班级作业、出卷专区、学习记录跨设备同步、生产部署、模型号池与管理员运维面板均已上线；接口与界面仍会迭代，真实教学反馈会直接影响后续优先级。

PhysicsOS 是一个面向初高中物理学习的公益可视化智能体，通过 AI 理解题目并结合物理引擎，将抽象物理过程转化为可交互、可观察、可计算、可验证的真实物理场景。

当前正式产品运行在 DeepSeek Harness Web Client 中，Physics Engine 负责结果，Observation 与统一 `PhysicsCanvas` 负责把结果变成可交互视觉。

## 界面截图

以下截图取自 2026-09-27 的正式生产站点，由
`tests/acceptance/promo-shots.mjs` 使用真实浏览器登录后自动拍摄。

| 平台首页 | 实验中心 |
| --- | --- |
| ![平台首页](docs/reports/screenshots/promo/01-home.png) | ![实验中心](docs/reports/screenshots/promo/02-experiment-center.png) |

| 串联电路 | 凸透镜成像规律 |
| --- | --- |
| ![串联电路](docs/reports/screenshots/promo/03-lab-series-circuit.png) | ![凸透镜成像规律](docs/reports/screenshots/promo/04-lab-convex-lens.png) |

| 探究液体内部的压强 | 探究晶体的熔化过程 |
| --- | --- |
| ![液体压强](docs/reports/screenshots/promo/05-lab-liquid-pressure.png) | ![晶体熔化](docs/reports/screenshots/promo/06-lab-melting.png) |

| 资源库 | 学习记录 |
| --- | --- |
| ![资源库](docs/reports/screenshots/promo/07-library.png) | ![学习记录](docs/reports/screenshots/promo/08-learning-record.png) |

完整上线范围、生产复验和教师演示顺序见
[`docs/reports/BETA-LAUNCH-REPORT.md`](./docs/reports/BETA-LAUNCH-REPORT.md)。

## 正式入口

唯一正式 Web Runtime Host：

```text
vendor/deepseek-harness/apps/web
        +
@deepseek-ai/dsh-client-ui-physicsos
```

旧版独立原型 `apps/web` 已删除；浏览器端正式入口是 vendor harness 的 `dsh-client-ui-physicsos`。

## 当前能力

- PhysicsOS 首页、侧栏、学生模式与正式 Harness 工作区
- 实验中心：力学/光学/声学/机械波/流体/热学/电场/磁场/电路/复合场/电磁感应/近代物理十二个分类；**回旋加速器已接通时变场求解**（不再是“即将支持”），新增纵波、反射折射、衍射、多普勒与光电效应模板；继续上次实验与按学习记录的薄弱点推荐
- 匀强磁场带电粒子实验：参数编辑、运行/暂停/单步/重置、倍速、时间轴、可观察量、数据、图像、推导和事件
- 五类力学场景：匀速、匀加速、平抛/斜抛、牛顿第二定律、无摩擦斜面
- 碰撞实验：弹性/非弹性（e = 0.5）/完全非弹性三类模板，独立碰撞引擎（多刚体圆-圆冲量求解、边界反射、恢复系数模型），动量守恒与动能守恒（弹性时）引擎验证，碰撞事件进时间轴；首页 Hero 是同一套圆形刚体 + 速度箭头的弹性碰撞小场景（装饰性，带轨迹尾迹与接触闪环）
- 电场与复合场：点电荷/多点电荷/匀强场/平行板偏转，速度选择器、质谱仪、E+B(+g)、多场区
- 直流动态电路：串联/并联/混联、开关、滑动变阻器准静态扫描、电流表/电压表读数、测电动势与内阻（MNA 直流引擎）；实验室 AI 助教 8 个电路意图（干路电流、路端电压、内阻、串联环流、并联分流、滑变扫描、功率守恒、理想电表），答案引用引擎派生量与 KCL/功率/路端电压定律/理想电表四项具名校验
- 电磁感应：导体棒切割磁感线（E = BLv，棒扫过磁场的动画）与磁通量变化（E = −dΦ/dt，楞次定律定方向）两类实验台；B/R/棒速/磁通量变化率实时可编辑，法拉第定律、楞次方向与回路欧姆定律三项引擎验证（31 个引擎测试）
- 几何光学成像：平面镜、凸透镜、凹面镜、凸面镜四类实验模板，引擎解析薄透镜/球面镜方程与五区成像规律并构造主光路（23 个引擎测试）；6 道光学黄金题（平面镜与凸透镜三区、凹面镜、凸面镜）已入题库
- 机械波：绳上的简谐横波（波形以 v = λf 平移、标记质点只振动不迁移）、双源干涉（路程差 Δ = nλ / (n+½)λ 判定加强减弱，合振幅 |2A·cos(πΔ/λ)|）、两端固定的弦驻波（L = nλ/2、f_n = n·v/2L、波节与波腹）三个实验台；A/f/v/Δ/L/n 实时可编辑，介质定波速、波源定频率，11 项引擎校验（27 个引擎测试）；6 道机械波黄金题已入题库
- 声学/流体/热学/杠杆：回声测距、阿基米德浮力、晶体熔化与比热容比较、杠杆平衡，各自有独立领域引擎
- 统一 `PhysicsCanvas`：粒子域共用坐标、网格、轨迹、矢量、标注与交互；电路以原理图范式接入同一画布
- Question Space：80 道内置题（磁场 10、电场 19、力学 6、复合场 21、光学 6、电路 6、电磁感应 6、机械波 6），真实 Question Runtime、Engine、Verifier 与 Observation 链
- Question → Lab：题目使用同一个 `PhysicsScene` revision 打开实验室（题面事实不可被实验污染）
- 基于 `requestAnimationFrame` 的连续动画；磁场微观周期使用稳定展示时钟，力学逐帧读取 Engine `stateAt`
- 桌面、窄桌面和手机布局；手机导航完成后自动收起侧栏
- Harness 会话里的模型可以真正调用物理引擎：Agent 预设「物理学习模式」（`physics-student`）挂载 `@deepseek-ai/dsh-tool-physicsos`，模型通过 `physics_solve_question / physics_create_experiment / physics_scene_command / physics_simulate / physics_observe` 等七个工具开实验、解题、改条件、模拟与校验，数值全部来自引擎（`node tests/agent/headless-physics-acceptance.mjs` 端到端门禁）

## 尚未完成

- 实验室 AI 助教抽屉仍以确定性意图匹配为主；模型化回答见 backlog
  `AGENT_MODEL_BACKED_ANSWERS_BACKLOG`，会话 Agent 已使用 `physics-student` 预设
- `web_search` 仍指向 DeepSeek 官方端点，未迁移到第三方模型网关
- 第三方网关敏感词过滤仍需用真实题库采样；命中时可能返回 `500 / new_api_error`
- 当前为单副本；扩容前必须把 `PHYSICSOS_SESSIONS_ROOT` 切到共享文件系统
- Content-Security-Policy 暂缓，当前启用 HSTS、nosniff、X-Frame-Options、
  Referrer-Policy 与 Permissions-Policy
- 管理员 TOTP 已实现但当前生产账号尚未启用
- 桌面端保留为可选壳，暂不投入签名、公证、商店发布和自动更新
- 图片 / PDF / VLM 录题已经实现；真实卷库继续扩充仍需要可授权卷源与教师核验

界面会明确标记尚未接通的能力，不用占位成功状态冒充完成。

## 已知问题

- 暂无阻塞性已知问题。`pnpm typecheck:web` 仅覆盖 `src/`（不含 `tests/`），若需检查测试代码请运行 `vitest`（测试经 esbuild 转译，不做完整类型检查）。

## 启动

前置环境：Node.js `>=24`，pnpm 由仓库 `packageManager` 字段管理。

正式 Web 入口依赖 Harness submodule 与 overlay 叠加，clone 后需要三步：

```sh
git submodule update --init --recursive
node scripts/overlay/harness-overlay.mjs apply
pnpm install
```

仓库使用 Git LFS 存放 `UI/` 与 `docs/` 下的大图，clone 前请先安装 `git-lfs`（未安装时这些 PNG 只会是 pointer 文件，不影响代码运行）。

然后启动：

```sh
pnpm dev
```

默认地址：`http://127.0.0.1:3080/`

也可以直接进入 Harness：

```sh
pnpm -C vendor/deepseek-harness dsh web
```

## 验证

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

需要只验证正式 Web 覆盖层时：

```sh
pnpm typecheck:web
pnpm lint:web
pnpm test:web
pnpm build:web
```

## 视觉资产

- `UI/generated/`：生成模型输出的 4K/原始资产与生成元数据
- `UI/generated/mascot/`：IP 形象「小 Q」的透明原图（wave / think / search 三个姿态）
- `UI/generated/collision/`：碰撞实验教学插画（弹性/完全非弹性/动量守恒台/牛顿摆，1024×1024 PNG 与 manifest 元数据）
- `vendor/deepseek-harness/apps/web/public/physicsos/`：经过网页压缩的正式运行资产（`mascot/` 下为 160/320/640 三档 WebP）
- `scripts/design/cutout-mascot.py`：把白底渲染切成保留柔和阴影的透明图并导出网页尺寸
- `scripts/design/imagegen-client.mjs`：OpenAI 兼容图像生成客户端（默认端点 `https://zz.211b.site`，模型 gpt-image，含模型/尺寸回退与 5xx 退避重试，输出 PNG + 元数据 manifest）

首页 Hero 是一个实时弹性碰撞小场景加小 Q（装饰性，不进入物理引擎）；入口卡片仍使用真实磁场实验器材图，原始 4K 文件保留在 `UI/generated/`，网页不直接加载 8-10 MB 原图。IP 与动效规范见 `docs/06-UI-DESIGN-SYSTEM.md` §3.1 与 §37。

## 架构边界

```text
Question / Lab
      ↓
PhysicsScene (single source of truth)
      ↓
Engine → Verifier → Observation
      ↓
SceneVisualModel → PhysicsCanvas
```

- React 不计算物理解答。
- Renderer 不决定物理事实。
- Harness core 的 Agent Loop、Session 和 Tools 不做 PhysicsOS 特化修改。
- 领域包位于根目录 `packages/`，正式界面适配层位于 `vendor/deepseek-harness/packages/client/ui-physicsos/`。

详细边界见 `docs/HARNESS-UPSTREAM.md` 与 `docs/HARNESS-UI-OVERLAY.md`。

## Harness overlay

正式 UI 代码放在 `overlays/harness/`，由脚本叠加进 pin 住的上游 submodule，仓库不改上游历史：

```sh
node scripts/overlay/harness-overlay.mjs apply     # overlay → vendor/deepseek-harness
node scripts/overlay/harness-overlay.mjs capture   # vendor/deepseek-harness → overlay
```

说明见 `overlays/harness/README.md`。

## 许可与用途

- 自有代码与文档：[`LICENSE`](./LICENSE)，**Apache License 2.0**（OSI 认证的开源许可），允许使用、修改、分发与商业使用，需保留版权、许可与 NOTICE 声明。
- 项目定位仍是面向初高中物理教学的公益项目；许可放开不等于承诺提供商业支持或 SLA，安全问题上报渠道见 [`SECURITY.md`](./SECURITY.md)。
- 第三方组件与上游归属：见 [`NOTICE.md`](./NOTICE.md)。DeepSeek Harness 为上游 MIT 项目，本仓库只分发自有插件与改动补丁；其中的 C-Eval 题库数据仍为 CC BY-NC-SA 4.0（非商业），不随本仓库 Apache-2.0 授权。
- 视觉资产 `UI/generated/**` 由图像生成模型产出，随仓库按 Apache-2.0 授权；如需商用请自行核对生成模型服务方的条款。
