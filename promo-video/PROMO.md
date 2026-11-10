# PhysicsOS 宣传视频 · 制作包（3 分钟叙事版 + 96s MV 版）

> 成片 A · 叙事版：`promo-video/out/physicsos-promo.mp4`（1920×1080 · 30fps · **180 秒 · 含配乐音效**）
> 成片 B · MV 版：`promo-video/mv/out/physicsos-mv.mp4`（1920×1080 · 30fps · **96 秒 · 含配乐音效**，制作包见 `mv/STORYBOARD.md` 与下文第七节）
> 制作方式：Claude「Opus 5.5 代码生成视频」工作流 = 确定性 HTML 动画 + 真实生产站录屏 + AI 生图素材 + 程序化合成配乐。

## 一、片源结构（先困惑、后产品的四幕叙事）

**第一幕 · 困惑（0:00–0:52）** —— 先讲学生的痛，产品到 0:52 才出现
| 段 | 时间 | 画面 | 旁白 |
| --- | --- | --- | --- |
| P0 | 0–8.5s | 生图：晚自习课桌 | 这道题，你刷过三遍。换个数字——又不会了 |
| P1 | 8.5–17s | 生图：学生苦思 | 公式背得滚瓜烂熟，一到新题，脑子一片空白 |
| P2 | 17–25.5s | 生图：课本静态图 | 课本上的图是死的：小滑块印在纸上，永远不动 |
| P3 | 25.5–34s | 错题卡堆叠动画 | 错题本抄了半本，同一个坑——还是再踩 |
| P4 | 34–43s | 公式雨动画 | —— |
| P5 | 43–52s | 黑屏光点转折 | 如果每一道题，都能亲眼看见呢？ |

**第二幕 · 方案（0:52–1:12）**：粒子汇聚 → 原子 logo + PhysicsOS → "把抽象的物理过程，变成看得见的实验" + 可交互/可观察/可计算/可验证 → 三行定位："✗ 不是题库 App / ✗ 不是网课 / ✓ 是一间装得下整个初高中物理的实验室"

**第三幕 · 四章深度展示（1:12–2:36）**
- **PART 01 实验中心**（72–96s）：12 分类 + 4 张真实生产截图轮播（每张 4.5s 带收益文案）
- **PART 02 AI 解题教练**（96–124s）：真实录屏 19.7s 四步——引擎校验 17/17 → 在物理世界中打开 → 运行圆周动画 → r=mv/qB 推导
- **PART 03 题海闭环**（124–156s）：**题库完整遍历**——80 道内置题从第一题滚到最后一题（头部慢速可读 → 中段加速体现题量 → 尾部减速收束），8 个分类标签随滚动高亮轮换，实时计数器「第 X / 80 题」跳动；后半段接「在实验室打开」虚线箭头 + 正确率曲线爬升至 90% + 跨设备同步

**第四幕 · 公益 CTA（2:36–3:00）**："物理不该看不见 → 纯公益·永久免费 → 开源 Apache-2.0" → 域名大条 + 光标闪烁 → 弹性碰撞彩蛋（呼应产品首页 Hero）→ 落款"让看不见的物理，被看见"。星域背景叠深色遮罩保证文字对比度。

## 二、配乐与音效（`audio.mjs` 程序化合成 → `out/score.wav`）

纯 Node DSP 合成（44.1kHz 立体声），与画面时间轴精确对齐，可随分镜改动重生成：

| 段 | 时间 | 音乐设计 |
| --- | --- | --- |
| 困惑 | 0–52s | A 小调，低回克制：闷 pad（低截止）+ 心跳低鼓 + 稀疏钢琴 |
| 转折 | 48.5–72s | riser 上扫 + **52s 低频 impact** → C 大调转调，明亮 pad + 左右交替琶音 |
| 展示 | 72–150s | 满编制，**8 小节副歌交替**（满鼓/半鼓起落），旋律双八度叠加，146s 五连鼓点填充收束 |
| CTA | 150–180s | 恢弘宽 pad（声像拓宽）+ sub 低音 + 钢琴和弦 → 176s 定音 → 渐弱收尾 |

层次要点：段落间响度与明暗对比拉大（困惑段刻意轻、副歌刻意满）、pad 和弦各音左右分布拓宽声场、转场处 impact/fill 强调节奏点。

音效表：幕间 whoosh（13 处）、元素弹入 pop（9 处）、录屏段打字 tick（6 声）、引擎徽章/域名条 ding、碰撞 thud+shimmer（168.75s）、全片结尾 fade。

## 三、素材来源

| 素材 | 来源 | 文件 |
| --- | --- | --- |
| 痛点插画 ×3 / 品牌极光 / CTA 星域 | **gpt-image-2.5-sunburst** @ `image.haqiuhaqiu.xyz`（`gen-art.mjs` 批量生成，统一品牌蓝调风格后缀） | `assets2/*.png` |
| 4 张实验界面 | 生产站真实截图（`tests/acceptance/promo-shots.mjs` 拍摄） | `assets/*.png` |
| 解题过程 19.7s | 生产站真实录屏（`capture-agent.mjs`，CDP screencast 逐帧） | `capture/agent-solve-cut2.mp4` |
| 其余全部动画 | 代码绘制（Canvas/DOM，确定性 seek(t)） | `scene.html` |

文案事实口径均取自 README 与生产界面：12 分类、80 道内置黄金题（README 核实口径；生产界面首页实时显示 88）、AI 17 步真调引擎、校验 17/17、r=4.17cm/T=1.31e-7s（引擎推导面板实测值）、Apache-2.0 开源、公测免费。

## 四、文件与迭代

```
promo-video/
├── scene.html          # 180s 确定性场景（改文案/时间轴 → T 常量与各 updateX 函数）
├── player.html         # 实时预览（空格播放/R 重播/←→ 微调，进度条 0-180s）
├── render.mjs          # 逐帧渲染 + 混流配乐 → MP4（node promo-video/render.mjs）
├── audio.mjs           # 配乐音效合成 → out/score.wav（node promo-video/audio.mjs）
├── capture-agent.mjs   # 生产站解题录屏（默认回放历史会话；--fresh 现场发题）
├── gen-art.mjs         # 生图素材批量生成（改 JOBS 后重跑）
├── assets2/            # AI 生图素材（1536×1024）
└── out/                # physicsos-promo.mp4 + score.wav
```

常见迭代：
1. **改文案/时长/分镜**：编辑 `scene.html` → `player.html` 预览 → `node promo-video/render.mjs`（约 11 分钟出片）
2. **换配乐**：改 `audio.mjs` 的段表/音色参数 → 重跑（秒级）→ 重渲染（或只 `ffmpeg -i 视频 -i score.wav -c copy -c:a aac` 重混）
3. **重新生图**：改 `gen-art.mjs` 的 JOBS → 重跑；scene.html 里引用 `assets2/<name>.png`
4. **重录解题段**：`node promo-video/capture-agent.mjs` → ffmpeg 重剪 `agent-solve-cut2.mp4` → 重渲染

## 五、「Opus 5.5 生成视频」方法论（GitHub / L 站社区玩法）

社区玩法（GitHub motion-graphics 43 种电影风格仓库、280+ prompt 合集、HuggingFace 确定性渲染管线教程、L 站鹈鹕对决帖）的本质：**Claude 不直接出视频，而是写"每一像素都是时间 t 的纯函数"的单文件 HTML 场景，浏览器逐帧截图、ffmpeg 编码成 MP4；音轨同样程序化合成后混流。**

核心契约（本包 scene.html / audio.mjs 原样遵循）：

```text
1. 场景暴露 window.DURATION 与 async window.seek(t)
2. 禁止 rAF 主循环 / Date.now / 定时器 / CSS transition / 未播种的 Math.random
3. 随机数用固定种子 PRNG（mulberry32），缓动由 t 计算的 easing 实现
4. 渲染器循环 await seek(k/fps) → 截图 → ffmpeg 编码；音频用离线确定性合成
5. 先给节拍表（beat sheet）与关键帧，确认后再写场景
6. 真实素材（截图/录屏/生图）以 <img>/<video> 嵌入，seek 时设置 currentTime
```

提示词模板（教程原文，中文场景直接套用）：

```text
为{受众}制作一条{时长}秒的{主题}视频。
输出单个自包含 HTML 文件，{宽}×{高}，无任何网络请求。
契约：设置 window.DURATION = {时长}；暴露 async window.seek(t)。
每一像素都是 t 的纯函数：禁止 Date.now、requestAnimationFrame 循环、
定时器、CSS transition 和未播种的 Math.random。
风格：调色板 {HEX 色值}，字体 {字体栈}，动效"{如：干脆、不用淡入淡出}"。
事实（只允许使用以下经验证的内容）：{核实过的事实简报}
先只回复节拍表和 4 张关键帧描述；我确认后再写文件。
```

要点：**事实只用验证过的简报**（本片全部取自 README、生产界面与引擎实测值）；**先节拍表后代码**；确定性使任何一帧、任何一秒音频都能精确重现。

## 六、发布建议

- B 站：1080p 原片直发，标题角度「我做了个让物理看得见的免费网站」/「把物理题变成实验」
- 抖音/视频号：竖版需重排（scene.html 改 1080×1920 布局重渲染）；痛点段（0–52s）天然适合做竖版前钩子
- 全片画面均为真实产品界面、真实引擎输出与标注过的示意插画，可放心宣传「无演示造假」

## 七、MV 版（96s · 参考 PDoomVideo 视频逻辑 · 2026-10-05）

参考社区热仓 [JohnHeibel/PDoomVideo](https://github.com/JohnHeibel/PDoomVideo)（Claude Opus 5.5 全代码渲染音乐视频）的视频逻辑，为 PhysicsOS 制作的**节拍驱动 MV**：120 BPM 节拍网格驱动一切剪切与弹入、九章一文件共享中央时间轴、原创电荷角色「Q 仔」贯穿全片、每句口号有专属视觉与强转场。**不使用 PDOOM 原曲**（版权），配乐为 audio-mv.mjs 程序化原创合成；口号行为原创文案，事实口径与本文件第一节相同。

| 章 | 时间 | 内容 | 章 | 时间 | 内容 |
| --- | --- | --- | --- | --- | --- |
| CH1 痛 | 0–8s | 公式雨砸中 Q 仔 | CH6 教 | 48–64s | 真实解题录屏帧 cameo + AI 气泡 + 17/17 徽章 |
| CH2 憾 | 8–16s | 错题卡墙掩埋，天线求救 | CH7 题 | 64–80s | 题卡瀑布 + 计数 1→80 + 正确率 90% 曲线冲浪 |
| CH3 转 | 16–24s | 光柱劈墙、粒子汇聚 | CH8 义 | 80–88s | 星域 + 纯公益 · Apache-2.0 |
| CH4 名 | 24–32s | impact → Q 仔化身原子核 logo | CH9 召 | 88–96s | 域名大条 + 弹性碰撞彩蛋 + 落款 |
| CH5 玩 | 32–48s | 斜面/圆周/碰撞/透镜四景 + 真实截图双窗 | | | |

```
promo-video/mv/
├── STORYBOARD.md      # 逐镜头节拍表（先计划后代码，PDoomVideo 方法学）
├── studio.html        # 单 canvas 全量重绘；window.seek(t) 契约（经典 script 全局注册，file:// 兼容）
├── src/timeline.js    # 中央时间轴：章节/BPM/缓动/调色板/动效字幕与窗口助手
├── src/qchar.js       # Q 仔角色 + 粒子/残影/公式卡/速度线绘制库
├── src/ch/ch1..9.js   # 九章，每章一个文件：window.CH[n] = { t0, dur, draw }
├── sol-jpg/           # 解题录屏帧预缩 960×600（330 张，源于 capture/sol-frames，LRU 按需加载）
├── audio-mv.mjs       # 120BPM 配乐 → out/mv-score.wav（verse/build/副歌×2/bridge/outro + SFX）
├── render-mv.mjs      # 逐帧渲染 + 混流 → out/physicsos-mv.mp4（--only a,b,c 抽检指定秒）
└── sample/            # 抽检帧（20 个关键时间点）
```

迭代：改分镜 → 编辑对应 `src/ch/*.js` → `node promo-video/mv/render-mv.mjs --only <秒>` 抽检 → 全量 `node promo-video/mv/render-mv.mjs`；换音乐 → 改 `audio-mv.mjs` 段表重跑。全 canvas 单层重绘天然规避叙事版的 DOM 显隐残留坑（见第一节七坑 5/7）；330 张录屏帧不可全量预载（~2GB 位图），已预缩 JPEG + FIFO 缓存 ≤48 张。
