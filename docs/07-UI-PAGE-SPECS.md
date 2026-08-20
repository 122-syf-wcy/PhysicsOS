# PhysicsOS UI Page Specifications

> 文件：`docs/07-UI-PAGE-SPECS.md`  
> 文档定位：PhysicsOS 页面级一比一复刻与布局规范  
> 依赖：`06-UI-DESIGN-SYSTEM.md`

---

# 1. 页面集合

当前核心：

```text
01 首页
02 物理实验室工作区
03 试题空间
04 Desktop Workspace
```

---

# 2. Web Shell

Top Navigation：

```text
高度 62px
左右 padding 28–36px
Logo 区 160–180px
Nav gap 34–44px
Search 280–320px
```

内容区左右安全区：

```text
24–32px
```

---

# 3. 首页

设计基准：

```text
1600×900
```

Hero：

```text
350–390px
左文案 42–48%
右视觉 52–58%
```

主标题：

```text
36–44px
```

---

# 4. 首页双入口

```text
2 columns
gap 18–24px
height 170–190px
```

卡内：

```text
左 42%
右 58%
```

---

# 5. 首页信息区

推荐：

```text
最近继续 24%
热门专题 46%
最近文件 30%
```

底部：

```text
学习路径 66%
学科分类 34%
```

---

# 6. Physics Workspace

结构：

```text
Top Nav
Title / Action
Workspace Grid
Timeline
Bottom Data
```

---

# 7. Workspace Grid

1600 推荐：

```text
Left Scene Panel 250px
Canvas 1fr
Inspector 275px
Observation 270px
Gap 12px
```

---

# 8. Left Panel

包含：

```text
场景与对象
图层控制
场景设置
```

内部滚动。

---

# 9. Canvas

必须至少保持工作区：

```text
45%+
```

---

# 10. Timeline

高度：

```text
64–78px
```

---

# 11. Bottom Data

高度：

```text
220–270px
```

1366 下变为 Tabs。

---

# 12. Inspector

Tabs：

```text
属性
可观察量
数据
```

分组：

```text
粒子属性
初始条件
磁场设置
```

---

# 13. Observation / Agent

右栏可以：

```text
可观察量
实时数据
AI 助手
```

纵向堆叠。

---

# 14. 试题空间

三栏：

```text
历史记录
题目 + 可视化
AI 解析
```

1600：

```text
Left 235px
Center 1fr
Right 390–420px
```

---

# 15. 左侧历史

顶部：

```text
上传题目
新建题目
```

下：

```text
历史记录
我的题集
```

---

# 16. 题目正文

顶部：

```text
返回
标题
Tags
收藏
加入错题本
更多
```

正文：

```text
题干
题图
子问
```

下：

```text
已知条件
求解目标
```

---

# 17. Tabs

```text
题目理解
可视化
解析步骤
变式练习
```

---

# 18. 可视化区

```text
Physics Canvas
+
场景信息 / 参数调整
```

---

# 19. 右侧 AI

```text
AI 解析
完成状态
解析步骤
推荐相关题
```

---

# 20. 底部操作

```text
上一题
下一题
加入错题本
在物理世界中打开
```

---

# 21. Desktop Shell

```text
Windows Title Bar
App Toolbar
Left Sidebar
Tab Bar
Workspace
Bottom Status Bar
```

---

# 22. Desktop Sidebar

```text
展开 210px
折叠 64px
```

---

# 23. Desktop Toolbar

```text
48–52px
```

---

# 24. Desktop Workspace

```text
Object Tree 210px
Main Canvas flexible
Property Panel 320px
```

下：

```text
Data Table + Charts
```

---

# 25. Status Bar

```text
38–42px
```

显示：

```text
仿真时间
时间步长
网格
精度
Engine Version
```

---

# 26. Breakpoints

```text
>=1800 XL
1440–1799 Large
1280–1439 Medium
<1280 Compact
```

---

# 27. Medium

策略：

```text
Observation / Agent 合并 Tab
左侧缩窄
Bottom Data Tab 化
```

---

# 28. Compact

使用：

```text
Drawer
Tabs
Floating Inspector
```

---

# 29. 页面滚动

首页：

```text
整页
```

Workspace：

```text
页面不滚动，Panel 独立滚动
```

Question：

```text
Center / Right 独立滚动
```

---

# 30. Loading / Error

每页必须设计：

```text
loading
empty
error
permission denied
```

---

# 31. 路由

```text
/
 /lab
 /lab/:sceneId
 /questions
 /questions/:questionId
 /history
 /resources
 /profile
```

---

# 32. Screenshot 验收

至少：

```text
1440×900
1600×900
1920×1080
```

---

# 33. Pixel Review

检查：

```text
导航高度
Logo
列宽
面板高度
Canvas 占比
字体
CTA
状态
```

---

# 34. AI 页面复刻

先：

```text
读原型
拆布局
确认尺寸
再写组件
```

禁止凭印象做“相似版本”。

---

# 35. Definition of Done

```text
布局匹配
尺寸匹配
各状态存在
真实功能接通
主分辨率无溢出
视觉差异可接受
```

---

# 36. 一句话页面规范

> **页面不是“做得像”，而是以原型为视觉事实源，把布局、比例、层级和交互状态工程化复刻出来。**
