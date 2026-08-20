# PHASE-01 Foundation Report

日期：2026-08-16  
范围：PHASE-0 / PHASE-1 Foundation  
结论：基础设施、Harness pin、Adapter 边界与 Web UI 壳层已落地。未进入 Physics Engine / 完整 Agent / Question Parser。

## 技能选择

- must（已读 raw）：`screenshot-to-ui`、`react-development`、`typescript-development`、`javascript-typescript-development`（清单命中，本步按 TS/React 工具链执行）、`test-engineering`、`browser-automation`、`git-workflow`、`code-audit`
- conditional（未读 raw）：`ui-design`（anti：1:1 还原，改走 screenshot-to-ui）、`web-security`、`ai-engineering`、`document-authoring`
- skip：Spring / 支付 / 地图 / 逆向 / Tauri 实现 / Physics Engine

## 1. 项目审计结果

开工时事实：

| 项 | 结果 |
| --- | --- |
| Git | 不是 repository |
| 根目录 | 仅 `docs/`、`UI/` |
| 源码 / package.json / pnpm workspace | 无 |
| Harness | 无 |
| Node | `v24.18.0` |
| pnpm | `11.9.0` |
| 重复文件 | `01-DEVELOPMENT-GUIDE.md` 与 `01-DEVELOPMENT_GUIDE.md` 并存 |
| `00-PRODUCT-OVERVIEW.md` | 缺失 |

两份 `01` **不是同一文档**：

- 连字符版标题为「产品总览与系统架构」（40 738 bytes）
- 下划线版标题为「开发指南」（35 577 bytes）

未做空文件冒充恢复。

## 2. docs 修复情况

| 动作 | 结果 |
| --- | --- |
| 连字符 `01-DEVELOPMENT-GUIDE.md` → `00-PRODUCT-OVERVIEW.md` | 已重命名，保留全部原文并补文件头 |
| 下划线 `01-DEVELOPMENT_GUIDE.md` → `01-DEVELOPMENT-GUIDE.md` | 已重命名 |
| 交叉引用 `00-PRODUCT_OVERVIEW` / `01-DEVELOPMENT_GUIDE` | 已统一为连字符规范 |
| 合并 | 无需合并：两份内容职责不同 |

当前 docs 命名：`数字-大写英文-连字符.md`。

## 3. Harness upstream commit

- repository：`https://github.com/deepseek-ai/deepseek-harness.git`
- path：`vendor/deepseek-harness`（git submodule）
- pinned SHA：`47f943859bef60e4160492346772ded9b24f765a`
- branch：`master`
- remote：`origin`
- packageManager：`pnpm@11.7.0`
- Node requirement：`^22.19.0 || >=24.0.0`
- 记录文件：`docs/HARNESS-UPSTREAM.md`

## 4. Harness build 结果

在 `vendor/deepseek-harness`：

```text
pnpm install --ignore-scripts
pnpm run build
```

`pnpm run build` **成功**（Host tsc + tsdown + Client + Web frontend，exit 0）。

默认 `pnpm install` 的 lefthook `postinstall` 在 **submodule** 下失败：

```text
cannot enable extensions.worktreeConfig while core.worktree is in the common config
```

未修改 upstream 源码。改用 `--ignore-scripts` 完成依赖安装。这是 Windows + git submodule + lefthook 交互问题，不是业务源码缺陷。

## 5. Harness startup 结果

```text
pnpm dsh web
```

实际地址：`http://127.0.0.1:3080`  
未配置真实 API Key / 未提交 `.env`。

## 6. Harness 是否有本地 diff

验证时：

```text
git status --short
git diff --stat
```

均为空。未改 Harness Agent Loop / Session Store / Web UI / 业务源码。

## 7. Monorepo 结构

```text
apps/web
packages/ui
packages/shared
packages/platform-bridge
packages/agent-runtime
packages/agent-dsh-adapter
services/          （占位）
tests/             （占位 + 说明）
vendor/deepseek-harness
docs/
UI/
```

技术锁定（npm 查询 + Harness 兼容，不是文档旧版本猜测）：

- React `19.2.8` / Vite `8.2.1` / TypeScript `6.0.3`（Harness 限制 `<7`）
- React Router `8.3.0` / Zustand `5.0.15` / TanStack Query `5.101.4`
- Tailwind `4.3.3` / KaTeX `0.18.4` / Vitest `4.1.10` / Playwright `1.62.1`
- pnpm workspace + Turborepo；`strict: true`

## 8. 已创建 packages

| Package | 职责 | PHASE-01 状态 |
| --- | --- | --- |
| `@physicsos/shared` | Brand ID / 错误 | 完成 |
| `@physicsos/platform-bridge` | Browser bridge；Tauri 预留抛 UnimplementedError | 完成 |
| `@physicsos/agent-runtime` | PhysicsAgentRuntime / Transport / Event Contract | 仅类型 + contract test |
| `@physicsos/agent-dsh-adapter` | 唯一 Harness 边界；方法拒绝假成功 | 骨架 |
| `@physicsos/ui` | tokens / primitives / domain components | 完成 |
| `@physicsos/web` | 产品 UI | UI + fixture |

业务组件未出现 `window.__TAURI__`。  
`apps/web` 未 import `@deepseek-ai/*`。

## 9. UI 页面完成度

| 页面 | 路由 | 完成度 | 说明 |
| --- | --- | --- | --- |
| 首页 | `/` | 高 | Hero、双入口、最近继续 / 专题 / 文件、学习路径、学科 |
| Physics Workspace | `/lab` | 高 | Scene Tree、Canvas 壳、Inspector、Observables、Timeline、Charts、Data、Agent |
| Question Space | `/questions` | 高 | 三栏、题目、可视化、AI 解析、在物理世界中打开 |
| Desktop Workspace | `/desktop` | 中高 | Sidebar + Canvas + 参数 + Timeline；非 Web 主产品 |
| 学习记录 / 资源库 / 我的 | `/history` `/resources` `/profile` | 壳 | 明确写未实现，无假 API |

Canvas：grid / 坐标轴 / × 场符 / 粒子 / 轨迹 / 矢量 / viewport / toolbar / timeline。  
数据来自 `apps/web/src/fixtures/prototype/`（文件头 PROTOTYPE ONLY）。  
组件内未实现正式物理公式求解。

## 10. 原型对应关系

| 语义文件 | 原文件 | 页面 |
| --- | --- | --- |
| `UI/原型图/01-home.png` | `11_49_34 (1)` | 首页 |
| `UI/原型图/02-physics-lab-workspace.png` | `11_49_35 (2)` | 物理实验室 |
| `UI/原型图/03-question-space.png` | `11_49_35 (3)` | 试题空间 |
| `UI/原型图/04-desktop-workspace.png` | `11_49_35 (4)` | Desktop |
| `UI/组件图/01-navigation-components.png` | `12_32_45 (4)` | 导航 |
| `UI/组件图/02-workspace-components.png` | `12_32_45 (2)` | 工作区 |
| `UI/组件图/03-question-components.png` | `12_32_45 (3)` | 试题 |
| `UI/组件图/04-content-components.png` | `12_32_44 (1)` | 首页内容模块 |

原图全部保留。映射见 `UI/README.md`。

## 11. Screenshot 路径

Playwright `pnpm test:e2e` **12/12 通过**（2026-08-16）。截图写入仓库根，磁盘已核对 12 个 PNG，合计 2 311 048 bytes：

```text
docs/reports/screenshots/home-1440x900.png
docs/reports/screenshots/home-1600x900.png
docs/reports/screenshots/home-1920x1080.png
docs/reports/screenshots/physics-lab-workspace-1440x900.png
docs/reports/screenshots/physics-lab-workspace-1600x900.png
docs/reports/screenshots/physics-lab-workspace-1920x1080.png
docs/reports/screenshots/question-space-1440x900.png
docs/reports/screenshots/question-space-1600x900.png
docs/reports/screenshots/question-space-1920x1080.png
docs/reports/screenshots/desktop-workspace-1440x900.png
docs/reports/screenshots/desktop-workspace-1600x900.png
docs/reports/screenshots/desktop-workspace-1920x1080.png
```

e2e 路径已改为相对仓库根的绝对解析（`apps/web/e2e` → `docs/reports/screenshots`），避免 cwd 写错目录。

与 `UI/原型图` 人工对比（主基准 1600×900；Workspace 另核 1920×1080）：

| 维度 | 首页 | Workspace | Question | Desktop |
| --- | --- | --- | --- | --- |
| 顶栏 / 搜索 / Ctrl K / 铃铛 / 李明同学 | 对齐 | 对齐 | 对齐 | Desktop 为侧栏壳，不是 Web 顶栏 |
| 主布局 | Hero + 双入口 + 三列内容 + 路径/学科 | 左树 + Canvas 核心 + Inspector + 底图表/表 | 左历史/题集 + 中题目 + 右 AI | 侧栏 + 对象树 + Canvas + 参数 |
| Canvas 占比 | n/a | 保持视觉核心；1920 出现独立 AI 第五列 | 中栏可视化存在 | 中栏核心 |
| 色板 | 雾白 + 自然蓝，无大面积紫 / 赛博黑 | 同左 | 同左 | 同左 |
| 文案/数据 | Hero 与统计卡对齐（`8,600+`） | 场景名、q/m/B、轨迹/矢量语义对齐 | 题干、已知条件、求解目标、绿 CTA 对齐 | 约束通过文案对齐 |
| 明显差距 | 缺原型 3D 资产（玻璃球/轨道/题卡）；专题是色块不是实拍；最近继续无缩略图 | 1600 下 AI 与 Observables 同列堆叠（符合 07 规格，原型更像独立列）；图层开关密度低于原型 | 可视化是 2D SVG，不是原型 3D 视口；缺题干几何附图 | 缺完整 Windows chrome、完整工具条、3D 视口控件、轨迹图 |

**不能写成「已经高度还原」。** 信息架构、分栏、色板、关键文案已按原型落地；3D/实拍资产与 Desktop chrome 仍有像素级差距。

## 12. typecheck

```text
pnpm typecheck
```

通过（6 packages）。

## 13. lint

```text
pnpm lint
```

通过。

## 14. test

```text
pnpm test
```

通过：shared 1、ui 2、platform-bridge 2、agent-runtime 3、adapter 3、web route smoke 3。

```text
pnpm test:e2e
```

Playwright 12 passed。

## 15. build

```text
pnpm build
```

通过。`apps/web` Vite production build 成功。

## 16. 未完成事项

- Adapter 未接 Harness 公开 API（有意：只建边界，拒绝假成功）
- Physics Engine / Scene Runtime / Verifier
- Question Parser / OCR / VLM
- 真实 Agent Loop / Tools / Skills
- Spring Boot 业务服务
- 主仓库正式 git commit（submodule 已 add，未按你的要求自动 commit）
- 原型 3D/实拍资产替换
- 1366 折叠交互未单独截图验收（布局 CSS 已按 breakpoint 预留）
- KaTeX `dangerouslySetInnerHTML` 仅用于受控 fixture；接入用户/Agent 文本前必须 sanitizer

## 17. 风险

| 风险 | 等级 | 说明 |
| --- | --- | --- |
| Harness 快速演进 | 高 | 已 pin SHA；升级必须走 Adapter + 本文档流程 |
| submodule + lefthook | 中 | Windows 下默认 postinstall 失败；不要为此改 upstream |
| UI 资产缺口 | 中 | 无 3D/摄影素材时无法像素级对齐 Hero/入口卡 |
| Fixture 被误当成 Engine | 中 | 已集中存放并标注 PROTOTYPE ONLY |
| KaTeX HTML | 低 | 当前 tex 来自仓库 fixture，不是用户输入 |

code-audit 结论：**无架构阻断**。未宣称可上线。未 mock Physics Engine。

## 18. 下一阶段建议

按 `docs/14-DEVELOPMENT-ROADMAP.md`，下一步应是 **Phase 2 Contract**，而不是继续堆页面：

1. `Quantity` / `Vector` / `PhysicsScene` / Event / SimulationResult 的 TS + Zod
2. Contract tests
3. 再进入 Units / Scene Runtime
4. 第一条 Vertical Slice 仍建议：带电粒子匀强磁场圆周运动

本轮停止。不自动进入 Physics Engine 开发。
