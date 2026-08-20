# PhysicsOS UI Design System

> 文件：`docs/06-UI-DESIGN-SYSTEM.md`  
> 文档定位：PhysicsOS Web / Desktop UI 设计系统与视觉工程规范  
> 视觉事实源：`UI/原型图/`、`UI/组件图/`
>
> 本文件不是“设计参考”，而是前端实现时必须遵守的视觉规范。
>
> **原型图定义页面视觉事实，组件图定义组件形态，本文件负责把视觉规则工程化。**

---

# 1. 设计目标

PhysicsOS 不应呈现为传统教育 SaaS、政务后台、暗黑科技平台或满屏卡片管理系统。

目标视觉：

> **明亮、精密、科学、克制、高级、空间感强、信息密度高但不压迫。**

核心关键词：

```text
Bright
Precise
Scientific
Calm
Premium
Spatial
Readable
Interactive
```

PhysicsOS 的真正主角是：

```text
Physics World
Physics Canvas
Question Content
Experiment Object
Trajectory
Force
Field
Energy
Data
```

UI 只是承载这些内容的“精密仪器外壳”。

---

# 2. 视觉事实源优先级

实现冲突时按以下优先级处理：

```text
页面原型图
>
组件图
>
本设计系统
>
第三方组件库默认样式
```

如果 shadcn / Radix / Tailwind 默认样式与原型冲突：

> 必须覆盖默认样式，而不是修改原型方向。

---

# 3. 品牌视觉

品牌：

```text
PhysicsOS
```

Logo：

```text
蓝色几何空间结构图形
+
PhysicsOS 字标
```

视觉特征：

```text
科学
几何
空间
秩序
精密
```

禁止：

```text
卡通化
重霓虹
重金属质感
大面积紫色
复杂高饱和渐变
```

---

# 4. 基础颜色 Token

推荐：

```css
:root {
  --bg-app: #F7F9FC;
  --bg-page: #FAFBFD;
  --bg-surface: #FFFFFF;
  --bg-subtle: #F5F7FA;
  --bg-hover: #F2F6FF;
  --bg-selected: #EDF4FF;

  --text-primary: #14213D;
  --text-secondary: #5F6B7A;
  --text-tertiary: #8A94A6;
  --text-disabled: #B5BDCA;

  --primary-50: #F3F7FF;
  --primary-100: #E8F0FF;
  --primary-200: #D4E3FF;
  --primary-300: #AFCBFF;
  --primary-400: #76A5FF;
  --primary-500: #3B82F6;
  --primary-600: #2563EB;
  --primary-700: #1D4ED8;

  --success-50: #F2FBF4;
  --success-500: #4CAF50;
  --success-600: #3D9442;

  --warning-50: #FFF9EE;
  --warning-500: #F2A93B;

  --danger-50: #FFF3F2;
  --danger-500: #E95B54;

  --border-soft: #E8ECF2;
  --border-default: #DDE3EC;
  --border-strong: #CCD5E1;

  --glass: rgba(255,255,255,.72);
  --glass-strong: rgba(255,255,255,.88);
}
```

品牌主色永远以自然蓝为核心。

绿色用于：

```text
验证通过
试题空间 CTA
成功状态
```

橙色用于：

```text
警告
能量类强调
难度
```

红色用于：

```text
错误
冲突
失败
```

禁止把紫色作为主要品牌色。

---

# 5. 页面背景

默认：

```css
background:
  radial-gradient(circle at 35% 0%, rgba(214,229,255,.22), transparent 34%),
  linear-gradient(180deg, #FBFCFE 0%, #F7F9FC 100%);
```

工作区 Canvas 背景可使用：

```text
#FBFDFF
```

配极轻蓝灰网格。

---

# 6. AI 组件裁剪背景规范

为了方便 AI / CV / 前端人工裁剪组件图：

> **组件图统一使用近纯白、无纹理、低干扰背景。**

建议：

```text
背景色：#FFFFFF 或 #FAFBFD
组件之间间距：至少 48px
每个组件完整独立
不重叠
不带复杂背景图
不带阴影叠层遮挡
不在组件背后放渐变大光斑
```

如果需要透明素材：

```text
单独导出透明 PNG
```

对于 AI 自动切图总览图：

```text
优先 #FFFFFF
```

---

# 7. 字体体系

中文：

```text
PingFang SC
Microsoft YaHei
Noto Sans SC
system-ui
```

英文/数字：

```text
Inter
SF Pro Display
system-ui
```

公式：

```text
KaTeX
```

---

# 8. 字号体系

```text
Display XL    44 / 52 / 700
Display L     36 / 44 / 700
H1            30 / 38 / 700
H2            24 / 32 / 700
H3            20 / 28 / 650
H4            18 / 26 / 600
Body L        16 / 26 / 400
Body          14 / 22 / 400
Body S        13 / 20 / 400
Caption       12 / 18 / 400
Micro         11 / 16 / 400
```

---

# 9. 间距系统

基础单位：

```text
4px
```

推荐：

```text
4
8
12
16
20
24
32
40
48
64
```

---

# 10. 圆角

```text
4px  极小控件
6px  Input
8px  默认 Button
10px Mini Card
12px Panel / Card
16px Hero Card
20px 大型首页入口卡片
```

---

# 11. 边框与阴影

默认：

```css
border: 1px solid #E8ECF2;
```

选中：

```css
border-color: #8BB4FF;
box-shadow: 0 0 0 2px rgba(59,130,246,.08);
```

阴影：

```css
--shadow-xs: 0 1px 2px rgba(20,33,61,.04);
--shadow-sm: 0 4px 14px rgba(20,33,61,.06);
--shadow-md: 0 10px 30px rgba(20,33,61,.08);
```

---

# 12. Glass

只用于：

```text
导航
浮动 Toolbar
Inspector
Hero 数据浮层
Modal
```

推荐：

```css
background: rgba(255,255,255,.76);
backdrop-filter: blur(18px) saturate(140%);
border: 1px solid rgba(222,229,239,.72);
```

---

# 13. Button

分类：

```text
Primary
Secondary
Ghost
Danger
```

Primary：

```text
蓝底白字
高度 36–40px
圆角 8px
```

首页 CTA：

```text
42–46px
```

---

# 14. Input / Select

默认高度：

```text
34–38px
```

Focus：

```text
蓝色边框 + 轻外环
```

数值输入提供：

```text
NumericStepper
```

支持：

```text
步长
单位
科学计数法
min/max
```

---

# 15. Tabs

Section Tabs：

```text
属性
可观察量
数据
图像
高级选项
```

激活：

```text
蓝字 + 底部 2px 蓝线
```

---

# 16. Chip / Status

Chip 用于：

```text
学科
知识点
难度
状态
```

状态：

```text
已保存 Green
运行中 Blue
未开始 Amber
未通过 Red
草稿 Gray
```

---

# 17. Card

按领域区分：

```text
Entry Card
Data Card
Topic Card
Question Card
History Item
Panel Card
Summary Card
```

不要所有内容统一一套 Card。

---

# 18. 首页入口卡

两张核心入口：

```text
Physics Lab
Question Space
```

要求：

```text
左文右图
强视觉资产
主 CTA
大量留白
```

---

# 19. Top Navigation

Web：

```text
Logo
首页
物理实验室
试题空间
学习记录
资源库
我的
全局搜索
通知
头像
```

高度：

```text
60–64px
```

---

# 20. Desktop Sidebar

支持：

```text
展开
折叠
Hover
Active
```

---

# 21. Workspace Toolbar

包含：

```text
新建
打开
保存
另存为
运行
暂停
停止
重置
参数扫描
导出
截图
撤销
重做
```

---

# 22. Scene Tree

节点状态：

```text
normal
hover
selected
hidden
locked
disabled
```

---

# 23. Inspector

分组：

```text
粒子属性
初始条件
磁场设置
高级设置
```

---

# 24. Observation Panel

条目：

```text
Checkbox
Name
Symbol
Unit
Drag Handle
```

---

# 25. Physics Canvas

Canvas 必须是视觉中心。

网格：

```text
主网格 #DCE6F5
次网格 #EEF3FA
坐标轴 #75859A
```

---

# 26. Physics 语义色

```text
Velocity      Green
Force         Blue
Acceleration  Orange
Momentum      Cyan
Electric      Blue-Cyan
Magnetic      Blue
Trajectory    Primary Blue
Energy        Amber
Error         Red
```

---

# 27. Magnetic Field

纸内：

```text
×
```

纸外：

```text
·
```

使用低饱和蓝灰。

---

# 28. Trajectory

```text
实时：2px 蓝色实线
预测：蓝色虚线
历史：降低 alpha
```

---

# 29. Timeline

支持：

```text
播放
暂停
前进
后退
倍率
当前时间
总时间
Slider
关键事件标记
```

---

# 30. Data / Chart / Table

Data Card：

```text
Label
Symbol
Value
Unit
```

图表：

```text
浅色网格
弱坐标轴
统一语义色
```

表格：

```text
紧凑
数字右对齐
单位明确
```

---

# 31. Agent Panel

结构：

```text
Header
Current Status
Conversation
Quick Actions
Input
```

状态应具体：

```text
正在理解题目
正在创建场景
正在计算
正在验证
正在调整可视化
```

---

# 32. Question Space

视觉核心：

```text
题目正文
题图
已知条件
求解目标
可视化
解析步骤
相关题
```

---

# 33. 题目正文

要求：

```text
宽行距
公式清晰
题图比例正确
题号层级明确
```

---

# 34. AI 解析

步骤使用：

```text
编号圆点
标题
解释
公式
```

---

# 35. 首页 Hero

Hero 应展示真实物理视觉：

```text
轨迹
场
实验装置
公式淡化背景
```

而不是普通营销 Banner。

---

# 36. Loading / Empty / Error

Loading：

```text
Skeleton + 局部 Progress
```

Empty：

```text
轻插画 + 说明 + CTA
```

Error：

```text
明确错误类别 + 可恢复动作
```

---

# 37. 动效

常规：

```text
120–220ms
```

页面：

```text
200–320ms
```

曲线：

```css
cubic-bezier(.2,.8,.2,1)
```

---

# 38. 图标

统一线性图标体系。

物理专用图标自行维护：

```text
力
磁场
电场
实验器材
```

禁止 Emoji 替代正式图标。

---

# 39. 3D 教育资产

要求：

```text
浅色
精细
真实但不过度写实
统一材质
柔和阴影
```

---

# 40. 响应式

重点：

```text
1366×768
1440×900
1600×900
1920×1080
```

Workspace 为桌面横屏优先。

---

# 41. 1366

优先折叠：

```text
Observation
Agent
Bottom Data
```

不压缩 Canvas 到不可用。

---

# 42. 1920

允许：

```text
Inspector
Observation
Agent
```

同时存在。

---

# 43. Accessibility

必须：

```text
Keyboard
Focus
ARIA
Contrast
Reduced Motion
```

---

# 44. 数字与公式

物理数据：

```css
font-variant-numeric: tabular-nums;
```

科学计数：

```text
1.60 × 10⁻¹⁹
```

输入可用：

```text
1.60e-19
```

---

# 45. 组件分层

```text
Primitive
Composite
Domain Component
Feature Component
```

Domain Component：

```text
QuantityInput
ObservableItem
PhysicsVectorLegend
Timeline
SceneTreeItem
FieldDirectionSelector
```

---

# 46. Token Source

建议：

```text
packages/ui/src/tokens/
```

保存：

```text
color
spacing
radius
shadow
typography
motion
physics semantic colors
```

---

# 47. 禁止散落 Hex

业务代码不得随处硬编码颜色。

---

# 48. 一比一复刻验收

重点：

```text
整体布局
尺寸
相对间距
视觉层级
主色
边框
圆角
字体
图标
Canvas 比例
```

---

# 49. 视觉容差

建议：

```text
主要尺寸误差 <= 4px
主要间距误差 <= 4px
圆角误差 <= 2px
主色明显偏差不可接受
```

---

# 50. AI UI 开发规则

必须先读：

```text
UI/原型图
UI/组件图
06-UI-DESIGN-SYSTEM.md
07-UI-PAGE-SPECS.md
```

禁止：

```text
自行换风格
大面积紫色
默认 shadcn 样式直接交付
满屏卡片
Emoji 图标
```

---

# 51. UI Definition of Done

必须：

```text
与原型布局一致
Token 一致
响应式可用
Focus 可用
无明显布局跳动
无占位素材
无默认组件风格残留
```

---

# 52. 一句话 UI 原则

> **PhysicsOS 的 UI 必须像一套精密、明亮、可信的数字科学仪器，而不是一套套着教育内容的通用 SaaS 模板。**
