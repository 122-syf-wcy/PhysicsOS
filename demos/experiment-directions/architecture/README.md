# 与原方案一、二、三对应的交互 Demo

## 方案一：独立 HTML

`standalone/convex-lens.html` 与 `standalone/plane-mirror.html` 是两个真正的自包含文档，内联 CSS、二维视图和计算脚本。下载后可用 file:// 离线打开。切换实验是普通文档导航。各自使用独立的 sessionStorage key 保存当前会话的参数与记录，不依赖宿主应用。

`python3 build-standalone.py` 仅把共用源文件内联到文档，不安装依赖。

## 方案二：独立路由 + 二维

React 18 应用：`/route-2d/experiments/convex-lens`、`/route-2d/experiments/plane-mirror`、实验中心 `/route-2d/experiments`、共享记录 `/route-2d/records`。使用 History API 与 popstate；Node 静态服务器仅为这两个示范应用的路由提供入口回退。参数模型、记录与应用壳共享，切页不重载文档，刷新从 sessionStorage 恢复。

## 方案三：独立路由 + 可选三维

`/route-3d/experiments/convex-lens` 复用方案二的 React 应用。初次打开不请求 Three.js；点击三维后动态导入 WebGL 视图。2D/3D共用 model，不重新建立实验状态。卸载释放 WebGL 资源；模块加载失败显示二维回退。平面镜仍是二维，演示按实验选择渲染能力。

## 边界

这是架构与交互样板，使用独立的解析光学 demo 模型，不是正式引擎/账号/后端集成。保持三套视觉与教学内容一致，不把审美差异冒充架构差异。正式项目此前改造仍停留在独立工作区，尚未上线。

## 已验证（2026-11-02，服务器 Docker 提供页面）

- 单 HTML 在浏览器离线模式下仍能计算 u=15、f=10、v=30。
- 独立 HTML 切换平面镜后 performance.timeOrigin 改变；React 站内切换时保持不变。
- React 实验中心、两种实验、共享记录页、浏览器后退与直接网址刷新可用。
- 两种实验分别记录后，记录页显示两条；刷新恢复物距 15 与已有记录。
- 方案三首次二维访问未请求 Three.js；切至三维后请求，切回仍为 u=15、v=30、一条记录。
- 阻断三维模块下载时，回退按钮返回可操作二维。
- 三套 390×844 手机布局无横向溢出；浏览器没有 JavaScript 异常。
