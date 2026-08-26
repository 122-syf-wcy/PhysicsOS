# PhysicsOS

> **开源公益项目**：面向初高中物理教学，免费、非商业。授权见 [`LICENSE`](./LICENSE)（PolyForm Noncommercial 1.0.0），仅限个人学习、学校与公益机构等非商业用途使用。
>
> **状态：正在开发中（work in progress）**。当前为早期开发版本，接口、数据结构与界面随时可能变化，尚不适合直接用于正式教学，也不接受“功能已完备”的预期。已完成与未完成范围见下文，界面会明确标记尚未接通的能力。

PhysicsOS 是一个面向初高中物理学习的公益可视化智能体，通过 AI 理解题目并结合物理引擎，将抽象物理过程转化为可交互、可观察、可计算、可验证的真实物理场景。

当前正式产品运行在 DeepSeek Harness Web Client 中，Physics Engine 负责结果，Observation 与统一 `PhysicsCanvas` 负责把结果变成可交互视觉。

## 正式入口

唯一正式 Web Runtime Host：

```text
vendor/deepseek-harness/apps/web
        +
@deepseek-ai/dsh-client-ui-physicsos
```

根目录 `apps/web` 是已废弃的旧版独立界面，只保留作迁移参考；新功能、运行时接入和验收不得继续写入该入口。

## 当前能力

- PhysicsOS 首页、侧栏、学生模式与正式 Harness 工作区
- 实验中心：21 个可创建实验模板（力学/电场/磁场/复合场/电路五个分类），继续上次实验与按学习记录的薄弱点推荐
- 匀强磁场带电粒子实验：参数编辑、运行/暂停/单步/重置、倍速、时间轴、可观察量、数据、图像、推导和事件
- 五类力学场景：匀速、匀加速、平抛/斜抛、牛顿第二定律、无摩擦斜面
- 电场与复合场：点电荷/多点电荷/匀强场/平行板偏转，速度选择器、质谱仪、E+B(+g)、多场区
- 直流动态电路：串联/并联/混联、开关、滑动变阻器准静态扫描、电流表/电压表读数、测电动势与内阻（MNA 直流引擎）
- 统一 `PhysicsCanvas`：粒子域共用坐标、网格、轨迹、矢量、标注与交互；电路以原理图范式接入同一画布
- Question Space：56 道内置题，真实 Question Runtime、Engine、Verifier 与 Observation 链
- Question → Lab：题目使用同一个 `PhysicsScene` revision 打开实验室（题面事实不可被实验污染）
- 基于 `requestAnimationFrame` 的连续动画；磁场微观周期使用稳定展示时钟，力学逐帧读取 Engine `stateAt`
- 桌面、窄桌面和手机布局；手机导航完成后自动收起侧栏

## 尚未完成

- 图片/PDF/OCR/VLM 试题识别与整卷拆题
- AI 助教接真实模型（当前为确定性意图匹配）、保存、更多菜单等按钮对应的完整业务闭环
- 学习记录的服务端持久化（当前仅本地 localStorage）
- 电路试题解析与 Agent 电路意图（实验室已接通，Question 切片待做）
- Induction、Optics、Wave 等后续物理领域
- 教师端、发布协作和 Desktop 壳层

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
- `vendor/deepseek-harness/apps/web/public/physicsos/`：经过网页压缩的正式运行资产

当前正式首页使用真实磁场实验器材图，原始 4K 文件保留在 `UI/generated/`，网页不直接加载 8-10 MB 原图。

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

- 自有代码与文档：[`LICENSE`](./LICENSE)，PolyForm Noncommercial 1.0.0，**禁止商业使用**。个人学习、学校教学、公益与公共研究机构使用均属许可范围。
- 第三方组件与上游归属：见 [`NOTICE.md`](./NOTICE.md)。DeepSeek Harness 为上游 MIT 项目，本仓库只分发自有插件与改动补丁。
- 该许可证不是 OSI 认证的开源许可证（因为限制商用），项目定位是“公益、源码公开、非商业授权”。
