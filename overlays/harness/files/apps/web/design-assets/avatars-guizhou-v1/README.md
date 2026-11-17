# PhysicsOS 用户头像 · 贵州文化灵感 v1

2026-11-17。首批 12 款头像以现有获批女生 IP 的 `mascot-guizhou-v1/wave.png` 为身份参考，使用图片生成工具制作独立的头肩肖像；不是把全身素材硬缩为头像，也不是 UI 图标替代物。

## 目录

| 稳定 ID | 名称 | 当代设计主题 |
| --- | --- | --- |
| silver-greeting | 银饰迎新 | 靛蓝绣边、银梳与招手 |
| indigo-reader | 靛蓝读书 | 象牙白衬衫、靛蓝马甲与书 |
| butterfly-light | 蝶光绣纹 | 紫靛色绣边与棱镜光点 |
| pendulum | 摆球探索 | 暖金色、银项圈与摆球 |
| batik-star | 蜡染星图 | 靛蓝白纹与星形装饰 |
| mountain-sound | 山水听音 | 青绿服装、远山与音叉 |
| lens-maker | 透镜小匠 | 白衣绣边与镜片 |
| copper-drum | 铜鼓节律 | 赭红绣边与小铜鼓 |
| green-wave | 青绿涟漪 | 青绿水纹 |
| red-embroidery | 绛红绣纹 | 绛红上衣与原创几何纹样 |
| silver-moon | 银月静思 | 月形银饰与灰蓝服装 |
| discovery | 灵感发现 | 青靛绣领与示意手势 |

## 生成与导出

- 生成模型由图片工具实际返回为 `@provider-3/gpt-image-2.6-sunburst`。逐项提示词、参数与三次失败后的重试记录见 `prompts.json`，不将失败请求记为成功产物。
- 12 份 1024×1024 PNG 是生成源，保留不覆盖。用户界面使用 `apps/web/public/physicsos/avatars/guizhou-v1/` 下的优化资源，不加载原始大图。
- 导出脚本：`scripts/design/export-user-avatars.py`。只对已有位图进行抗锯齿圆形 alpha 裁切和 Lanczos 缩放，不生成或重绘角色像素。
- 输出 96／192／384px WebP、AVIF，以及 192px PNG fallback。catalog 的持久路径为 `/physicsos/avatars/guizhou-v1/{id}-192.webp`。
- `manifest.json` 记录参考图、提示词文件、原图及每个输出的 SHA-256／字节数。脚本不会静默覆盖不同内容的已存在输出。
- `review-sheet.png` 是已有头像的图片缩放／排版检查表，不是用代码画出的头像。已查看 32／48／96px、浅深两种背景的圆形裁切，脸部和主要配色可辨，圆外黑色 matte 已由统一 alpha 去除。该检查不替代真实选择器的浏览器验收。

## 文化和使用边界

延续 `../mascot-guizhou-v1/culture-and-usage.md` 的来源和权利边界：服饰灵感来自贵州苗绣、苗族银饰锻制技艺及蜡染等工艺，纹样与配饰组合是原创当代表达，不宣称特定村寨、支系、仪式的准确复原，不使用“官方非遗 IP”或“传承人联名”。铜鼓、音叉、透镜等为头像主题道具，不是文物复刻或真实测量证据。

既有角色的上游授权由项目已有档案承接；本轮生成记录不构成其独立授权证明。界面只允许选择闭集头像 ID，不开放任意外链或用户上传。头像采用统计读取当前受控路径，不按图片请求或点击次数计数。
