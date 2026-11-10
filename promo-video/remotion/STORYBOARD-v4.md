# PhysicsOS 宣传片 v4 · 线上实拍产品片（video-shotcraft 流水线）

- 成片：`out/v4/physicsos-promo-v4.mp4`（1920×1080 · 30fps · 约 87 s · H.264 + AAC）；另出无配乐版 `physicsos-promo-v4-nobgm.mp4`（保留旁白与音效）
- 方法：GitHub 热门「代码做视频」技能，装进项目 `.claude/skills/`（`.claude/` 不入库）
  - [Vincentwei1021/video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft)（17.4k ★，Apache-2.0）：真实页面三件套采集 → 镜头配方卡 → Remotion → 卡拍 + 声音设计 → 逐帧 QA。本片走「自主自由创作」模式（`references/pipeline.md` 阶段 0–7），镜头卡与 demo 源码按卡片「参考实现」逐一读取后改写到本产品的视觉系统
  - [remotion-dev/skills](https://github.com/remotion-dev/skills)（官方）与 [Rieranthony/product-film-skill](https://github.com/Rieranthony/product-film-skill)：旁白先于画面定长、节拍网格、`src/kit/` 相机与弹簧工具沿用 v3
  - 其他候选（调研记录）：OpenMontage 77k ★（AGPL，整套系统过重）、hyperframes 60k ★（HTML→MP4，非 Remotion）、video-talkcraft 2.1k ★（非商业许可）、claude-motion-design 779 ★、cinetic 856 ★、product-launch-motion 350 ★
- 旁白：小米 MiMo `mimo-v2.5-tts`（预置音色「茉莉」，风格指令「二十多岁的年轻女老师…像和学生面对面聊天」），`scripts/voiceover-v4.mjs` 合成、-16 LUFS 归一、按停顿切短语（`src/v4/voiceover-timing.json`）
- 配乐：Mixkit「Motivating Mornings」（Ahjay Stelino，Mixkit Stock Music Free License），实测 121.0 BPM，一小节 1.9835 s；按小节剪成 44 小节（去掉原曲第 36–39 小节），原曲自然收尾落在片尾字标
- 素材：全部来自线上 https://physics.dongsiwei.com 当天实拍（`scripts/capture-v4.mjs`，1920×1080 ×2 纹理 + 76 张实验卡切片 + `src/v4/layout.json` 坐标表）。三维实验是沙箱 iframe 里的 WebGL，用有界面的 Chromium（本机 GPU）等 `data-community-status="ready"` 再拍

## 阶段 0 · 产品简报与执行决策

| 项 | 决定 | 依据 |
| --- | --- | --- |
| 用途 / 受众 | 产品介绍片：学生、物理老师、开源社区（B 站 / LINUX DO / README） | README「开源公益项目 · 面向初高中物理教学」 |
| 必须展示 | 实验中心（76 实验 / 12 分类）、实验台（平抛：调参 → 运行 → 引擎派生量）、学习对话（提问 → 分步讲解 → 可运行实验）、出卷专区（新建 / 审核 / 定稿）、资源库（88 题 / 9 册 / 926 项）、开源公益 | 线上导航与首页卡片 |
| 不展示 | 真题 0 份、插件页、实验上传页、管理员面板、历史对话里的哈希标题 | 空状态 / 内部功能 / 可读性 |
| 画幅 / 时长 / 语言 | 16:9 · 1080p30 · 约 87 s · 中文旁白 + 字幕 | 发布平台横屏为主 |
| 数据口径 | 演示账号为平台管理员账号：侧栏左下「平台管理员」只在全景里出现（≤14px），不做特写；最近空间 / 历史对话均为真实公开演示数据 | 与 v3、README 截图同一口径 |
| 事实（线上核对 2026-11-06） | 76 可用实验、12 个学科分类、88 道题 / 9 册教材 / 926 项资源、平抛 h=20 m、v₀=10 m/s → 飞行时间 2.02 s、水平射程 20.2 m、落地速度 22.18 m/s、「引擎已验证」徽章、Apache-2.0 | `src/v4/layout.json` 与纹理 |

## 阶段 1 · 视觉方向与动效 tokens（从产品里抽）

- 色板：底 `#F4F6F7`（应用主区）/ `#F9FAFB`（侧栏）；纸白卡 `#FFFFFF`；分割线 `#DADBDC`；首页 Hero 渐变 `#F8FBFF → #E4EDFD`；实验卡缩略底 `#C5E0F5`；**主蓝 `#4176E6`**（运行按钮 / 选中页签）；品牌标志蓝 `#005DFC`；墨色 `#0F1115`；次级灰 `#6B7280`；校验绿 `#5C9A76`
- 字体：产品用系统无衬线（PingFang SC）；片中标题 PingFang SC 600、数字 tabular-nums；不用衬线、不用等宽（产品里没有）
- 材质 / 光：纸白 + 极浅蓝渐变 + 柔和投影；无暗场、无霓虹、无粒子
- 动效性格：**平静关怀（教育）** 预设——入场约 36–42f、ease-in-out 对称 / 不对称 bezier(0.33,0,0.15,1)，无回弹过冲（落地隐喻除外，`y1 > 1` 仅用于卡片落位）、squash 0；相机全片稳定（Q3 无手持）；光效只给主角一次（Q4）
- 偏离记录：无

## 阶段 2 · 功能到镜头映射（镜头卡 → 本片改写）

| 功能 | 镜头卡（gallery/api/library.json 校验） | demo 源码 | 改写要点 |
| --- | --- | --- | --- |
| 开场（问题） | `blur-slide`（逐词 y/blur/opacity 三通道收敛） | demos/typography/blur-slide/BlurSlide.tsx | 两句旁白各一组词；底是产品自己的启动页插画（线上 `/physicsos/splash/splash-2560.webp`）极缓推镜 |
| 品牌亮相 | `brand-ink-open`（字标逐字 letterpress + hold ≥1s） | demos/typography/brand-ink-open/BrandInkOpen.tsx | 准星换成产品标志（mark-128）描画入场；字标 PingFang；副标「让看不见的物理过程被看见」打字机 |
| 首页揭示 | `crane-rise-reveal`（焦点 → 全局） | demos/opening/crane-rise-reveal/CraneRiseReveal.tsx | 从首页输入框特写 3.0× 升降臂拉升到整页；行洗光改为模块逐块点亮（Hero / 输入框 / 两张入口卡） |
| 实验中心 | `page-waterfall-wall`（3 列 3D 后仰差速瀑布） | demos/ui-entrance/page-waterfall-wall/PageWaterfallWall.tsx + assets/lib/VerticalTicker.tsx | 76 张实验卡真实切片，3 列 12/9/14 s 差速反向，rotateX 20°，外层 CSS zoom 缓推；计数 76 用 DigitRoll；12 个分类 chip 踩旁白弹出 |
| 实验台 | `cursor-flyover`（光标先行 + 点击涟漪）+ `scanline-annotate-focus`（取景括号 + 标签） | demos/camera/cursor-flyover/CursorFlyover.tsx · demos/effects/scanline-annotate-focus/ScanlineAnnotateFocus.tsx | PageCam 在实验台纹理上：先框 初始高度 / 初速度，光标点「运行」，真实三维动画帧序列（0.5× 慢放实拍），再用取景括号依次对准 飞行时间 / 水平射程 / 落地速度 |
| 学习对话 | `type-and-filter`（真实 UI 上打字 3f/字）+ `scroll-brake-moves` A 式（长卷急刹） | demos/interaction/type-and-filter/TypeAndFilter.tsx · demos/data/scroll-brake-moves/ChangelogScrollBrake.tsx | 输入框揭示式打字（home-typed 纹理裁切）→ 点发送（flash-cut）→ 回答长卷 bezier(.45,0,.06,1) 高速掠过（位移差分驱动方向模糊）急停在「引擎里的实证」一节 → 推近「守恒校验 67/67 项通过」并加取景括号 |
| 出卷专区 | `title-demote-to-label` A 式 | demos/typography/title-demote-to-label/TitleDemoteToLabel.tsx | 大标题「老师出卷」缩成左上小标签，工作台页面在其下升起；三个步骤页签踩旁白依次点亮 |
| 资源库 | DigitRoll 三连 + PageCam 纵向摇镜 | assets/lib/DigitRoll.tsx · assets/lib/PageCam.tsx | 88 / 9 / 926 在真实数字胶囊位置滚动落定，再沿章节目录下摇 |
| 价值字卡 | `paper-title-card` | demos/typography/paper-title-card/PaperTitleCard.tsx | 「开源 · 公益」逐词压印，公益为强调词；副行 Apache-2.0 |
| 结尾 | `logo-shrink-wordmark-lockup` 的落版结构 + R1 hold ≥1s | demos/outro/logo-shrink-wordmark-lockup/LogoShrinkWordmarkLockup.tsx | 启动页插画回归 + 口号逐词；标志 + 字标 + 域名 lockup，hold 到曲终 |
| 转场 | `shot-transitions` A 推进流白（品牌 ↔ 页面）、C 穿窗（实验卡 → 实验台）；其余横推 | assets/lib/FlashCut.tsx · demos/transition/shot-transitions/PortalWipeV2.tsx | 一个接缝只用一式；全画面级冲击 ≤3 处（品牌落定 / 发送 / 落版） |

## 阶段 3 · 分镜（一小节 = 1.9835 s，共 44 小节 ≈ 87.3 s）

| # | 小节 | 时间 | 镜头 | 关键动效 | 旁白 |
| --- | --- | --- | --- | --- | --- |
| 1 | 1–5 | 0–9.9 | 启动页插画 | 插画极缓推近 1.00→1.06；两句逐词 blur-slide；第二句时插画轻微压暗 | 物理，本来就应该看得见。/ 可是在很多教室里，它只停在课本的插图上。 |
| 2 | 6–9 | 9.9–17.9 | 品牌 → 首页 | 冲击音 + 标志描画 + 字标逐字压印 + 副标打字机，hold 1 s；「把一间物理实验室」起升降臂从输入框特写拉到整页，模块逐块点亮 | PhysicsOS，把一间物理实验室，装进了浏览器。 |
| 3 | 10–14 | 17.9–27.8 | 实验瀑布墙 | 3 列实验卡差速瀑布 + 缓推；「七十六」计数滚动；「十二个分类」12 个 chip 弹出；「力学…电磁感应」对应 chip 亮；「打开就能做」平抛卡抬起 → 穿窗进入实验台 | 七十六个可视化实验，十二个分类，从力学到电磁感应，打开就能做。 |
| 4 | 15–20 | 27.8–39.7 | 平抛实验台 | 括号框 初始高度 / 初速度；光标飞到「运行」点击（涟漪）；真实三维动画 0.5× 慢放约 4 s；扫描式括号依次对准 飞行时间 / 水平射程 / 落地速度，「引擎已验证」徽章脉冲 | 设好高度和初速度，点一下运行，小球怎么飞、飞多久、落地多快，引擎都算给你看。 |
| 5 | 21–26 | 39.7–51.6 | 学习对话 | 首页输入框推近，问题逐字打出（3f/字，占位提示随第一个字消失）；「直接问它」光标点发送（第 22 小节强拍 41.65 s）→ 白闪换景；回答长卷高速下滚急刹停在「引擎里的实证」；「都用物理引擎算过一遍」推近校验句并框住 | 想不通的题，直接问它。/ 它会一步一步讲清楚，每一步结论，都用物理引擎算过一遍。 |
| 6 | 27–30 | 51.6–59.5 | 出卷专区 | 大字「老师出卷」→ 缩成左上标签，工作台升起；新建 / 审核 / 定稿 三页签踩词点亮；拉远看整页 | 老师出卷也在这里，新建、审核、定稿，一个工作台就搞定。 |
| 7 | 31–34 | 59.5–67.4 | 资源库 | 推近页头数字胶囊，88 / 9 / 926 踩词滚动落定；「都按章节整理好了」沿章节目录下摇 | 八十八道题、九册教材、九百多项资源，都按章节整理好了。 |
| 8 | 35–37 | 67.4–73.4 | 价值字卡 | 「开源 · 公益」逐词压印（公益强调），副行 Apache-2.0；第二行「每一所学校都能直接用」 | 它开源、公益，每一所学校都能直接用。 |
| 9 | 38–41 | 73.4–81.3 | 口号 | 插画回归（与开场同一张，机位反向），口号三段逐词落下（产品启动页原文） | 如果物理是一束光，我想让它，照到没有实验室的地方。 |
| 10 | 42–44 | 81.3–87.3 | 落版 | 标志 + PhysicsOS + physics.dongsiwei.com lockup，原曲收尾，静止 ≥1 s | PhysicsOS，欢迎你来试试。 |

hold 预算：字标落定 ≥30f（镜 2、10）、瀑布墙收尾 15f、实验台括号后 ≥45f、推近实验卡后 ≥60f、每张字卡 ≥50f。

## 采集时发现的线上状态（2026-11-06 23:00–00:30，影响分镜的事实）

- **代码实验生成失败**：现场提问「为什么洛伦兹力不做功？」，模型回答完整（结论 / 数学原因 / 引擎实证 67/67 校验 / 常见误区），但 `physics_generate_experiment` 两轮都返回「本轮未完成」，回答里的实验卡显示「本题实验生成失败」，「在实验室中探索」按钮不可用；从「最近空间」打开同名实验空间也是同一失败态。因此镜 5 改为落在引擎校验，旁白 v07 由「还能把答案变成一个能动手跑的实验」改为「每一步结论，都用物理引擎算过一遍」——只展示线上真实可见的东西。6 天前的历史对话「洛伦兹力为何不做功」里的场景卡现在显示「这段历史记录还没有本地代码实验」。
- **三维实验是沙箱 iframe 里的 WebGL**（`CommunityExperimentFrame`，`/physicsos/experiment-assets/embed/releases/<id>/dist/index.html`）：无头 Chromium 渲不出首帧，有界面 Chromium 等 `data-community-status="ready"` 约 6–8 s；平抛运动的实拍（0.25× 倍速，CDP screencast 74 帧 / 8.8 s）在片中按 2.24× 回放成 3.6 s 慢放，就近取帧不做交叉淡化（读数文字会重影）。
- **连接不稳**：实拍期间站点多次出现「重新连接中…」/「正在加载…」，首页就绪耗时 17–112 s 不等；采集脚本按页面标志文字等待并重试。服务器上同时有 `physicsos-chat-code-candidate`（question-visual）候选容器在跑，`physicsos-experiments-build` 为 unhealthy。
- 资源库页头右侧有一块空白卡（x≈1700–1900，内容未加载），取景时避开；真题 0 份不特写。

## 有意识的偏离（审美准则）

- Q11：旁白字幕 40px（≈3.7% 帧高）而非 ≥56px——中文字形密度高，一行最长 37 字在 1920 宽内放不下 56px；辅助文字（派生量标签 38px、落版域名 52px、CTA 40px）达标。
- R2：瀑布墙三列匀速滚动是配方卡本身的"持续状态"语法（差速反向制造视差），不是匀速入场。
- 阶段 6 的 Freesound 选音未执行（无 Freesound API key，且本机对 GitHub/PyPI 网络受限）：沿用 v3 的合成音效（`scripts/sfx.mjs` 生成，原创、无许可问题），按本片动作重新钉帧。

## 声音

- BGM：`src/v4/music-edit.json` → `public/audio/music/promo-v4.wav`；旁白期间压到约 -28 LUFS（×0.15），其余约 -18 LUFS
- SFX（合成音，`public/audio/sfx/`，峰值偏移见 `src/sfx-peaks.json`）：impact+shimmer（品牌落定）、tick（字标逐字 / 打字）、whoosh（横推 / 升降臂 / 穿窗）、pop（chip / 页签 / 数字）、click（运行 / 发送）、riser→impact（急刹）、shimmer（落版）。连发按 0.22→0.14 递减、不同样本交替。
- 全画面级冲击 3 处：9.9 s 品牌落定、41.6 s 发送（原曲最强拍）、83.3 s 落版抬升（原曲第 44 小节）。

## 文件与命令

```
src/v4/cues.ts              节拍表：镜头小节数、旁白起点、每个动作对齐的短语
src/v4/scenes/*.tsx         10 个镜头     src/v4/lib/   PageCam / DigitRoll / FlashCut / 光标 / 括号（改写自 video-shotcraft assets/lib 与 demos）
src/v4/Promo4.tsx           转场、混音、音效、字幕
src/v4/voiceover*.json      文案、时长、短语起点    src/v4/layout.json  线上元素坐标
scripts/capture-v4.mjs      线上三件套采集   scripts/voiceover-v4.mjs  MiMo 合成
```

```bash
cd promo-video/remotion
npm run studio                                   # Remotion Studio 预览（PhysicsOSPromoV4）
node scripts/voiceover-v4.mjs                    # 改文案后重做旁白并重新对齐
npm run audio4                                   # 重剪配乐
npm run render4 && npm run render4:nobgm         # 出片 → out/v4/
```
