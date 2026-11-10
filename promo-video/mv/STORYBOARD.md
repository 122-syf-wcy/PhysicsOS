# PhysicsOS · MV 版宣传片 · 逐镜头节拍表（STORYBOARD）

> 参考 PDoomVideo（JohnHeibel/PDoomVideo，Claude Opus 5.5 代码渲染音乐视频）的视频逻辑：
> **音乐是骨架、九章一文件、中央时间轴、角色贯穿、每句词有专属视觉、强转场、先节拍表后代码。**
> 成片目标：`promo-video/mv/out/physicsos-mv.mp4`（1920×1080 · 30fps · 96s · 含配乐音效）

## 一、为什么是 MV 版

已有 180s 叙事版（`out/physicsos-promo.mp4`）走"先痛点后产品"的纪录片叙事。
MV 版换用 PDoomVideo 的**音乐视频逻辑**：120 BPM 节拍网格驱动一切剪切与弹入，
角色（Q 仔 · 一颗带表情的电荷）贯穿九章，口号行动效字幕（kinetic typography）逐拍弹入，
真实生产素材（截图 / 解题录屏帧）作为窗口 cameo 保留"无演示造假"口径。

## 二、中央时间轴（120 BPM · 1 beat = 0.5s · 1 bar = 2s · 全片 48 bars）

| 章 | 区间 | bars | 情绪 | 音乐 | 画面主线 | Q 仔动作 | 口号行（动效字幕） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CH1 痛 | 0–8s | 0–4 | 压抑 | verse1 闷 pad+心跳鼓 | 公式雨砸落，暗蓝底 | 被"？"砸扁 squash | 「同一道题，刷了三遍」「换个数字——又不会了」 |
| CH2 憾 | 8–16s | 4–8 | 压抑+堆积 | verse1 续 | 错题卡层层堆叠成墙 | 被卡片掩埋只露天线 | 「公式背得滚瓜烂熟」「可它长什么样，从没见过」 |
| CH3 转 | 16–24s | 8–12 | 上升 | build + riser(22–24) | 黑场光点汇聚成光柱 | 被光吸起苏醒、伸懒腰 | 「如果每道题」「都能亲眼看见呢？」 |
| CH4 名 | 24–32s | 12–16 | 爆发 | **impact@24 + 副歌1** | 粒子汇聚成原子 logo，极光背景 | 化身原子核，轨道粒子绕转 | 「PhysicsOS」「把物理，变成一间实验室」 |
| CH5 玩 | 32–48s | 16–24 | 欢快 | 副歌1 满 | 四实验分镜轮换：斜面滑下→圆周环绕→弹性对碰→透镜聚焦；2 张真实实验截图窗口飞入 | 每景亲历：滑/转/弹/被聚焦发亮 | 「抛体 · 圆周 · 碰撞 · 光学」「12 大类，每个都能亲手调」 |
| CH6 教 | 48–64s | 24–32 | 专注 | verse2 半鼓+钢琴 | 真实解题录屏帧窗口（sol-frames cameo）+ AI 对话气泡逐条弹出 + 17/17 徽章 | 坐窗沿戴学者帽，跟随打字点头 | 「AI 教练，一步步推」「17 步引擎验证 · 17/17」 |
| CH7 题 | 64–80s | 32–40 | 冲刺 | **副歌2 更满** | 题卡瀑布轮换 + 计数器 1→80 + 正确率曲线爬升 90% | 踩题卡冲浪，曲线冲顶 | 「80 道黄金题，一题一实验」「错过的坑，不再二踩」 |
| CH8 义 | 80–88s | 40–44 | 恢弘 | bridge 宽 pad | 星域背景，两行大字逐拍落版 | 悬浮星域中央微光呼吸 | 「纯公益 · 永久免费」「开源 Apache-2.0」 |
| CH9 召 | 88–96s | 44–48 | 收束 | 定音@88.5 + 渐弱 | 域名大条 + 弹性碰撞彩蛋 + 落款 | 弹性撞上域名条弹两下，落款旁眨眼 | 「physics.dongsiwei.com」「让看不见的物理，被看见」 |

## 三、转场（PDoomVideo：每场必须"长进"下一场）

1. CH1→2：公式雨落地**堆成**错题卡墙（素材延续）
2. CH2→3：光柱**劈开**卡堆，闪白 2 帧
3. CH3→4：光点**汇聚**成 logo（同一粒子系统）
4. CH4→5：原子轨道**甩出** Q 仔飞入实验室（惯性运动）
5. CH5→6：实验分镜**收缩**为录屏窗口（推镜）
6. CH6→7：窗口边缘**溢出**题卡瀑布（溢出构图）
7. CH7→8：正确率曲线**冲出**画面顶 → 星域
8. CH8→9：星域**聚焦**到域名条（景深收束）

## 四、角色设定 · Q 仔

- 一颗半径 ~46px 的品牌蓝（#4E8CFF→#2563EB 径向渐变）电荷球，头顶一根小天线（尖端光点）
- 表情：两点眼睛 + 弧线嘴；受击 X 眼；专注时戴学者帽；开心时嘴变 D 形
- 动画原则：squash & stretch（被砸扁/弹起）、运动拖尾（6 段残影）、落点震屏（2–4px 衰减）
- 弧线：挨打（CH1-2）→ 苏醒（CH3）→ 成核（CH4）→ 玩耍（CH5）→ 学习（CH6）→ 冲刺（CH7）→ 沉静（CH8）→ 点题（CH9）

## 五、音频（audio-mv.mjs，纯 Node DSP，与节拍表同源）

| 段 | 时间 | 设计 |
| --- | --- | --- |
| verse1 | 0–16s | A 小调：低截止 pad + 心跳双跳低鼓 + 稀疏钢琴（每 2 bar 一音） |
| build | 16–24s | 和声上 行 + riser 22–24s，**24.0s 低频 impact** |
| chorus1 | 24–48s | C 大调满鼓：kick 四踩 + hat 十六分 + 左右琶音 + 旋律双八度 |
| verse2 | 48–64s | 半鼓 + 钢琴主导 + 打字 tick 层（52–57s，每 0.25s） |
| chorus2 | 64–80s | 副歌重复 + 高八度叠加 + 78s 五连鼓填充 |
| bridge | 80–88s | 宽 pad（声像拓宽）+ sub 低音 + 钢琴和弦 |
| outro | 88–96s | 88.5s 定音（C 大三和弦 ding）→ 94–96s 渐弱收尾 |

音效点（与画面逐一对齐）：whoosh ×8（各章转场）、pop（口号字组弹入）、tick 簇（CH6 打字）、ding ×2（17/17 徽章 @58、域名条 @88.5）、thud+shimmer（CH9 碰撞 @91）、全片尾 fade。

## 六、素材与事实口径

| 素材 | 来源 | 用途 |
| --- | --- | --- |
| 极光背景 | assets2/brand-aurora.png（AI 生图，已用于叙事版） | CH4–CH5 背景 |
| 星域背景 | assets2/cta-cosmos.png（AI 生图） | CH8 背景 |
| 真实实验截图 ×2 | assets/02-experiment-center.png、03-lab-series-circuit.png（生产站实拍） | CH5 窗口 cameo |
| 真实解题帧序列 | capture/sol-frames/f_00000–f_00329（生产站解题会话滚屏 30fps 帧，预缩 960×600 JPEG） | CH6 窗口 cameo |
| 其余全部 | 代码绘制（单 canvas 全量重绘） | — |

事实口径（沿用 PROMO.md 已核实）：12 大类实验、80 道内置黄金题（README 口径）、
AI 17 步真调引擎校验 17/17、Apache-2.0 开源、公测免费、域名 physics.dongsiwei.com。
**不使用 PDOOM 原曲**（版权），配乐为程序化原创合成；口号行为原创中文文案。

## 七、技术契约（与叙事版同宗 + PDoomVideo 结构）

```
promo-video/mv/
├── studio.html      # 单 canvas 1920×1080；经典 script 标签全局注册（file:// 兼容）
├── src/timeline.js  # 中央时间轴：章节区间 / BPM 节拍 helper / 口号行 / 调色板
├── src/qchar.js     # Q 仔 + 粒子 + 震屏 + 速度线 + 公式碎片 绘制库
├── src/ch/ch1.js…ch9.js   # 九章，每章一个文件：window.CH[n] = { dur, draw(ctx, t) }
├── audio-mv.mjs     # 120BPM 配乐合成 → ../out/mv-score.wav
├── render-mv.mjs    # Playwright 逐帧 seek → JPEG → ffmpeg 混流 → out/physicsos-mv.mp4
└── out/
```

- `window.DURATION = 96`；`async window.seek(t)`：先按需加载该帧需要的素材帧（LRU ≤48），再全量重绘
- 禁 rAF 主循环 / Date.now / 定时器 / CSS transition / 未播种 Math.random（mulberry32 固定种子）
- 全 canvas 单层重绘：无 DOM 显隐分支 → 从根上规避叙事版的残留/泄漏坑
- 渲染：`node promo-video/mv/render-mv.mjs`（先 `node promo-video/mv/audio-mv.mjs`）
