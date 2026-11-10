# PhysicsOS 实验方案 Demo

当前入口 index.html 对应用户最初的三个技术方案：

1. 独立 HTML：/architecture/standalone/convex-lens.html
2. 独立路由 + 二维：/route-2d/experiments/convex-lens
3. 独立路由 + 可选三维：/route-3d/experiments/convex-lens

具体实现与验证见 architecture/README.md。预览运行于服务器 107.151.246.59 的 physicsos-experiment-demos Docker 容器，服务器 loopback 3094，通过 SSH 转发至 http://127.0.0.1:3094/。启动命令：node server.mjs。

旧 a.html / b.html / c.html 是此前误解需求制作的三种视觉风格稿，保留在 visual-studies.html，可作素材参考，不代表上述技术方案。

Three.js、React 使用本地 vendor 文件。旧风格稿桌面背景由用户指定 gpt-image-2.5-sunburst 生成；无凭据保存于此目录。
