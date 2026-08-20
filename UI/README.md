# PhysicsOS UI 视觉素材

> 视觉事实源。实现冲突时：页面原型图 > 组件图 > `docs/06-UI-DESIGN-SYSTEM.md` > 第三方组件库默认样式。
>
> **原图一律保留，禁止删除。** 语义文件名为原图副本，便于工程引用。

## 目录

```text
UI/
├── 原型图/     页面级视觉事实
└── 组件图/     组件形态事实
```

## 原型图映射

判断依据：逐张阅读画面结构，不按创建时间猜测。

| 语义名 | 原文件 | 页面 | 视觉判定 |
| --- | --- | --- | --- |
| `01-home.png` | `ChatGPT Image 2026年8月16日 11_49_34 (1).png` | 首页 | 顶部 Web 导航 + Hero「让看不见的物理过程被看见」+ Physics Lab / Question Space 双入口 + 最近继续 / 热门专题 / 最近文件 + 学习路径 / 学科分类 |
| `02-physics-lab-workspace.png` | `ChatGPT Image 2026年8月16日 11_49_35 (2).png` | 物理实验室工作区 | Web 顶栏 + 场景树 + 2D Physics Canvas（磁场 × 符号、圆周轨迹、速度/洛伦兹力矢量）+ Inspector + 可观察量 + Timeline + 底部图表/数据表 + AI 助手 |
| `03-question-space.png` | `ChatGPT Image 2026年8月16日 11_49_35 (3).png` | 试题空间 | 三栏：历史/题集、题目正文+可视化、AI 解析；底部「在物理世界中打开」 |
| `04-desktop-workspace.png` | `ChatGPT Image 2026年8月16日 11_49_35 (4).png` | Desktop Workspace | 左侧 App Sidebar + 窗口工具栏 + 对象树 + 3D Canvas + 参数面板 + 底栏 Timeline / Engine 状态 |

## 组件图映射

| 语义名 | 原文件 | 类别 | 视觉判定 |
| --- | --- | --- | --- |
| `01-navigation-components.png` | `ChatGPT Image 2026年8月16日 12_32_45 (4).png` | 导航 / Shell | Web 顶栏、Nav 状态、Desktop Title Bar、Sidebar 展开/折叠、Tabs、面包屑、工具栏、题目标题区 |
| `02-workspace-components.png` | `ChatGPT Image 2026年8月16日 12_32_45 (2).png` | 工作区 | Object Tree、属性表单、Quantity Input、可观察量、实时数据卡、AI 面板、Timeline、图表、数据表、3D 视口控件 |
| `03-question-components.png` | `ChatGPT Image 2026年8月16日 12_32_45 (3).png` | 试题 | 上传/新建、题目标签、题目正文、已知条件/求解目标、参数调节、AI 解析步骤、相关题、底部操作 |
| `04-content-components.png` | `ChatGPT Image 2026年8月16日 12_32_44 (1).png` | 首页内容 | 双入口卡、功能图标行、统计卡、最近继续、热门专题、最近文件、学习路径、学科 Chip、状态徽标、空状态、存储卡 |

## 工程引用

Web 实现与 Playwright 对比优先使用语义文件名：

```text
UI/原型图/01-home.png
UI/原型图/02-physics-lab-workspace.png
UI/原型图/03-question-space.png
UI/原型图/04-desktop-workspace.png
```

## 设计红线（摘自设计系统）

- 明亮暖白 / 雾白，自然蓝，冰蓝透明感
- 禁止大面积紫色、黑色赛博朋克、默认 shadcn 风格直接交付
- Canvas 必须是工作区视觉核心
- 禁止 Emoji 当正式图标
