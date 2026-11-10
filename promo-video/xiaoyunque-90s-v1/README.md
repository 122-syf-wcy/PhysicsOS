# PhysicsOS · 90 秒 Q 版 AI 宣传片制作包 v1

**直接从 [18 页图文分镜 PDF](PhysicsOS-90s-storyboard-v1.pdf)、[手机友好素材与分镜预览](index.html) 或 [分镜总览图](storyboard-contact-sheet.jpg) 开始。**

确认方向：90 秒、16:9 横版、面向物理教师、所有人物与 IP 均为可爱 Q 版。故事串起备课、实验、AI 辅助分析、物理校验示例、出题草稿与教师把关。用户最后用小云雀/剪辑软件完成视频、配乐与融合。

## 已交付

- **9 张真实调用生图模型生成的素材**：4 张角色参考（初始双人定妆、独立教师、产品老师与猫、官网星球）+ 5 张 1920×1080 故事关键帧。
- **5 张本次正式官网高清截图**：首屏、互动小样、AI/题目到实验介绍、结尾、长页。来自 https://physicsos.dongsiwei.com/，不是本地预览。
- **10 张历史真实产品截图的隐私裁切版本**：实验、分类、AI 回答、原生验证卡、对应场景、出卷准备、首页与资源库。
- **1 段 8.9 秒、1080p/30 fps 历史真实实验回放**：依据原浏览器录屏时间戳还原，静音，无生成式物理运动。
- **16 镜、总计 90 秒的逐镜剧本**：画面、动作、运镜、旁白、字幕、衔接、声音与验收。
- **5 条核心小云雀逐镜提示词 + 1 条官网 IP 可选镜头**，分别保存为可复制文本。
- 原创 BGM 中英文生成提示词、分层编曲与音效设计、剪辑混音操作单。
- 旁白文字、SRT 时间草案、机器可读时间线与 CSV。
- 原产品 logo、Noto Sans SC / JetBrains Mono 字体及 OFL 许可。

## 需要说明的缺口

**没有新捕获成功的登录产品功能截图。** 独立产品会话在内容写入/WebSocket 保护条件下停在启动遮罩，未放宽保护以强行取图。本包明确使用 H 系列既有历史产品实拍；准确来源、原文件修改时间与裁切坐标见 [来源与捕获状态](01-real-ui/CAPTURE-STATUS.md) 与 [历史素材记录](01-real-ui/historical-assets.json)。原文件修改时间不冒充精确拍摄时间。

**本包不是视频成片。** 尚未在小云雀提交生成，尚无实际 BGM、配音音频和最终 90 秒混音成片。16 秒揭幕、72 秒高潮等为创作目标，拿到音乐与配音后还需实测校准。

## 你实际怎么用

1. 看 [完整分镜与旁白](04-90s-director-script.md)，确认故事和真实素材范围。
2. 在小云雀建立角色参考，使用 [逐镜提示词](05-xiaoyunque-copy-prompts.md) 生成 5 段人物/空屏底片。不要一口气生成全片。
3. 产品镜头直接导入本包真实截图/回放，不交给 AI 重绘。
4. 用 [音乐制作单](06-music-and-sound-design.md) 生成/委托原创 BGM，检查实际授权。
5. 按 [剪辑操作单](09-editing-and-delivery.md) 融合、配音、对拍和导出。

## 结构

- [00-BRIEF.md](00-BRIEF.md)：已确认需求、事实口径与边界。
- [01-real-ui](01-real-ui/)：W 系列本次官网、H 系列历史产品、来源记录。
- [02-characters](02-characters/)：C01–C04 角色；同目录 manifest 保存实际生图提示词与参数。
- [03-ai-keyframes](03-ai-keyframes/)：K01–K05 关键帧；同目录 manifest 保存实际生图提示词与参数。
- [04-90s-director-script.md](04-90s-director-script.md)：完整逐镜剧本。
- [05-xiaoyunque-copy-prompts.md](05-xiaoyunque-copy-prompts.md)：小云雀操作与逐镜提示。
- [06-music-and-sound-design.md](06-music-and-sound-design.md)：BGM、分轨、揭幕落点、音效、混音和授权。
- [07-copy-prompts](07-copy-prompts/)：A01–A06 与 BGM 中英文复制文本。
- [08-brand](08-brand/)：真实 logo、字体和许可。
- [09-editing-and-delivery.md](09-editing-and-delivery.md)：最后融合剪辑与发布验收。
- [timeline.json](timeline.json)、[timeline.csv](timeline.csv)：16 镜，0–90 秒，30fps 共 2700 帧。
- [voiceover.txt](voiceover.txt)、[voiceover-draft.srt](voiceover-draft.srt)：文本与尚未按真实音频对齐的字幕草案。

角色与故事关键帧的生成服务为 GPT Image 2.5 Sunburst；没有用代码绘制人物或插画。真实 UI 仅做明确裁切，不增加虚构按钮、验证项或成功状态。

## 工具资料

- [小云雀 Web 官方手册](https://xyq.jianying.com/tutorials/web-manual)
- [Seedance 2.5 官方手册](https://xyq.jianying.com/tutorials/seedance-2-5)

本地源码中的 tools 文件用于复现/校验，打包交付不含私人诊断图、凭据或会话状态；没有部署、提交 Git 或发布到外部站点。
