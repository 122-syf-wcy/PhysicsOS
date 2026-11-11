# PhysicsOS 实验体验 Demo

三个独立交互页面，共用凸透镜模型，用于用户直接比较视觉与交互，不接入生产数据。

- A / a.html：真实实验室，生图桌面背景 + 可拖动的 Three.js 器材，固定观察视角。
- B / b.html：光的剧场，深色 Three.js 场景，可以旋转、缩放、拖动器材。
- C / c.html：探索手册，轻量 SVG 光路，预测—观察—记录的教学步骤。

每套支持物距、焦距、五区预设和多次记录；A/B 还支持光屏拖动、对焦与光路切换。刷新清空 demo 记录。3D 光屏离焦模糊为视觉示意，不是波动光学求解。

预览：服务器 107.151.246.59 上的 physicsos-experiment-demos Docker 容器，绑定服务器 loopback 3094；本地 SSH 转发至 http://127.0.0.1:3094。

运行纯静态页面无需编译：node server.mjs。Three.js 0.180.0 与 OrbitControls 随 demo 保存在 vendor，许可证一起保存。

素材：assets/tabletop.webp 为指定 gpt-image-2.5-sunburst 服务生成的实验桌面，使用 imagegen CLI。原始图片及最终提示词在 output/imagegen/experiment-directions/；密钥未保存到 demo 或源码。
