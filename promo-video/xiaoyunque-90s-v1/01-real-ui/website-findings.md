# 官网真实截图

- 实际地址：https://physicsos.dongsiwei.com/（HTTP 200）
- 页面标题：PhysicsOS · 让好奇心，有处发生
- 实际捕获时间（UTC）：2026-11-09T15:48:03.817Z 至 2026-11-09T15:48:43.422Z；每张的时间见 website-capture.json。
- 环境：Chromium revision 1234；1920×1080 CSS px；DPR 2；light；zh-CN；现有 SOCKS 代理。
- 安全边界：仅允许 GET/HEAD/OPTIONS；Service Worker 与 WebSocket 均拦截。只滚动，不点击、不提交，不操作服务器或隧道。
- 标语：让好奇心，有处发生。；首屏说明为「把抽象的公式，变成看得见的世界」。
- 真实页面配色：薄荷绿／奶油白；纸色 #f8faf6、墨绿 #24392e、主绿 #42734d、浅青柠 #d8efab、次级文字 #788579（读取网站 CSS 变量）。
- 字体及可见图片解码完成；逐段滚动触发网站原生入场动画并等待稳定。保留原生持续动画，不改 DOM、样式、文字或指标，不遮罩、不拼贴、不生成 UI。

## 文件与裁切

- W01-official-hero.png：3840×2000 px；原生裁切 CSS x=0, y=0, w=1920, h=1000；Official hero, navigation, mascot, tagline, and native value strip。
- W02-official-exploration.png：2720×1408 px；原生裁切 CSS x=280, y=1000, w=1360, h=704；Interactive exploration feature: heading, live wave demo, tabs, and frequency control; not testimonials。
- W03-official-ai-workflow.png：2720×1342 px；原生裁切 CSS x=280, y=1194, w=1360, h=671；Live experiment context plus native AI tutor, question-to-experiment, and learning-record feature text。
- W04-official-closing.png：2720×1174 px；原生裁切 CSS x=280, y=3126, w=1360, h=587；Final discovery call-to-action, native mascot, and footer。
- W00-official-fullpage.png：3840×7428 px；完整长页、无裁切；Complete public homepage, including genuine loaded empty states。

## 真实内容与边界

- W02 是「波的旅行」互动小样：波形、公式 v = λf、频率滑块与物理解释，不是用户证言。未更改默认频率或操作控件。
- W03 包含真实文案「一个问题，接住你的好奇」「从题目，走进实验里」与 AI 讲题／引擎验证；不是登录后的实际 AI 对话演示。
- 反馈与共创区已加载，当前为「这里还没有公开的反馈／共创项目」真实空状态。重点四张避开这些区域；完整长页如实保留，不制造证言、贡献者或指标。
- 视觉验收：已用 Read 逐张查看最终 5 张 PNG。首屏标语及吉祥物完整；W02 为真实互动区；W03 的 AI／题目→实验文案清晰、无吸顶导航残边；结尾完整；长页没有入场留白或反馈加载态。
- 缺口：无缺图；部分镜头为保持完整分区而裁切，并非全部为 16:9。

## 复现

在仓库根目录运行 `node promo-video/xiaoyunque-90s-v1/tools/capture-website.mjs`。需保留现有 127.0.0.1:18963 SOCKS 代理、已安装的 @playwright/test 与 Chromium 1234。目标文件存在时会拒绝覆盖；无需安装、启动本地服务或部署。
