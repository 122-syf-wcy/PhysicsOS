# PhysicsOS 产品官网

对外宣传页。一个静态站点，**不依赖构建步骤**：直接开这个目录就能跑，
也可以整目录拷到任意静态托管上。

```
overlays/harness/files/apps/web/public/physicsos/website/
├── index.html          单页（hero / 物理领域 / 推演引擎 / 试题空间 / 可信性 / CTA）
├── site.css            设计 token 与全部样式
├── avatar-160.jpg      作者 GitHub 头像（160×160，导航与页脚共用）
├── lib/flow-field.js   hero 背景：WebGL2 流场着色器
└── shots/              产品真实截图（JPEG，由脚本生成）
```

站内 GitHub 引用两个地址：

- **个人主页** `https://github.com/122-syf-wcy` —— 顶栏头像 + GitHub mark 角标、
  页脚带头像的地址引用块。
- **项目仓库** `https://github.com/122-syf-wcy/PhysicsOS` —— 页脚带 repo 图标的
  地址引用块、CTA 的「查看源码」按钮。

页脚两块包在 `.footer-ghs` 里一起换行。头像换了直接替换 `avatar-160.jpg` 即可，
路径已写死在标记里。

## 本地预览

```bash
cd overlays/harness/files/apps/web/public/physicsos/website
python3 -m http.server 4192 --bind 127.0.0.1
```

然后打开 `http://127.0.0.1:4192/`。

## 截图素材从哪来

`shots/` 里不是设计稿，是**真实产品界面**的截图，由脚本驱动真实服务生成：

```bash
pnpm dev                                        # 另开一个终端，3080 端口
node scripts/design/website-shots.mjs           # 输出到 shots/*.jpg
```

脚本会依次打开首页、实验中心、四个领域的实验室与试题空间各截一张。
它会自行关掉首启的两个引导弹窗（内测声明 → API key 引导）。

**素材数字由实测决定**：hero 上的「43 个可运行实验模板」「80 道内置题」
对应实验库标题与实际题目数；实验模板共 45 个，其中回旋加速器与弦驻波
标记为「即将支持」，所以对外只写 43。改产品后重跑脚本，图片会更新，
但页面上的数字要人工核对。

## 背景特效

`lib/flow-field.js` 是一个 WebGL2 片元着色器：值噪声先做 domain warp 扭曲线
坐标，再做一次 swirl 折叠，最后按棋盘 mixer 把 5 个色标混成一条缓慢漂移的
光带。这是 DeepSeek 系官网 hero 背景的同类实现，参数按 PhysicsOS 重新调过。

**真正让它发光的是着色器末尾那三步，不是噪声本身**：

1. **自发光辉光（bloom）**：按亮度阈值把场的亮部再叠一层自己，
   `col += (col*.85 + warm) * bloom * strength`。没有这一步，场只是一张渐变色图。
2. **虚拟光源**：暖色 core（`exp(-ld²·4.5)`）+ 冷色 halo（`exp(-ld·1.8)`），
   跟随指针缓动（`lightFollow`），指针静止时影响力归零。
3. **暗角**：`vignette: 0.38` 把四角压暗，把视线收拢到中间的光带。

调色板必须**两端锚点都是近黑、亮端接近白**（`#03060d` / `#16355f` / `#3570bd`
/ `#e9f0fc` / `#03060d`）。亮端是"光源"而不是"颜色"，一旦换成饱和色或去掉
bloom，整个效果会塌回一团雾。中间那档海军蓝要够**亮**才读得出蓝天感。

降级与省电行为：

- `prefers-reduced-motion: reduce`：只画一帧静态画面，不起 rAF 循环。
- 滚出视口（IntersectionObserver）或标签页隐藏：暂停绘制。
- 设备像素比钳制在 1.5，避免视网膜屏上填充率翻倍。
- 没有 WebGL2：canvas 自动隐藏，hero 的 CSS 渐变单独撑住版面。

canvas 上**不要加 CSS blur**——丝带结构本身就是效果，糊一层就变回壁纸。

## 视觉基调

站点整体是**深色**的（`#0a0a0a` 纸面 + 白字），与 DeepSeek Harness 官网同构：
页面近黑，hero 是一整块发光蓝场，产品界面作为"被照亮的窗口"出现在暗底上。

产品自身的设计系统（`docs/06-UI-DESIGN-SYSTEM.md`）是明亮雾白的，这里相当于
把它反过来用：品牌蓝与琥珀色保留，雾白纸面变成截图的画框本身。
改样式时优先复用 `site.css` 顶部的 token，不要新造颜色。
