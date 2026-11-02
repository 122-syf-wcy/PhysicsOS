# 实验开发者文档交付记录

## 交付

- 11 篇可搜索文档，侧栏导航、章节定位、浏览器前进后退、手机目录。
- 以代码一致性为中心：文件命名、格式、TypeScript、模块边界、物理事实、三维生命周期、Warm Lab、作者与发布规则。
- 按实验 ID 生成的 AGENTS.md：实际剪贴板复制、下载、拒绝剪贴板时手动复制回退。
- 13 个文档/Schema 下载文件，以及 23 个文件组成的代码风格工具包 ZIP。
- 页面与 Markdown、复制与下载使用共同内容源。`docs:developers:check` 会拒绝过期生成资源。
- CONTRIBUTING 与实验中心源码增加文档入口。页面随 Web 发布后位于 `/physicsos/developers/index.html`。
- 当前可审阅预览：`http://127.0.0.1:3094/developers/index.html`。由既有隔离预览容器提供，正式站点尚未发布本次修改。

## 品牌

页头与 favicon 使用正式站点已有的 physicsos-mark-128.png / physicsos-mark-32.png，原样复制。
以现有 mascot-think-640.webp 为身份参考，使用用户指定的 gpt-image-2.5-sunburst，经 imagegen CLI edit 生成开发者插画。发布压缩为 320/640 WebP，原图保存在任务 output/imagegen/developer-community/。最终提示词与来源说明见公共 assets/mascot-prompt.txt 和 assets/README.md。凭据未写入页面、源码或报告。

## 验证

- 服务器隔离 Docker：生成器成功；3 项 Node 测试通过。
- `npm run docs:developers:check`：13 个文档与 23 文件 ZIP 与内容源一致。
- 生成器及资源脚本 ESLint 通过；页面脚本 Node 语法检查通过。
- 解压 ZIP 后执行 `npm run check`：格式、命名、ESLint、TypeScript 全通过。使用隔离容器内已安装依赖，实际版本与工具包精确声明一致：Prettier 3.9.6、ESLint 10.8.1、typescript-eslint 8.67.0、TypeScript 6.0.3。未声称进行了全新联网安装。
- 负例：添加 BadName.ts，命名检查返回非零；删除该测试文件后保持工具包原状。
- 浏览器验收脚本通过：11 个路由、搜索、错误路由返回、前进后退、章节目录、实际剪贴板、下载字节一致、无效 ID、手机菜单、剪贴板拒绝回退。最新品牌素材加载通过。
- 桌面 1440×1000、手机 390×844 无横向溢出，无页面 JavaScript 异常。
- 抽查正文、导航、表格、注释和代码的对比度 ≥4.5:1。
- 正式应用全量构建与全站回归未执行；此次验证针对静态文档站、资源生成器与工具包。

## 独立审阅与修复

独立审阅发现：手机关闭目录仍可 Tab 聚焦、正文低对比度、点击章节后高亮跟随停止。已分别增加 inert、调整文字颜色、改用滚动位置追踪，并用验收脚本复验。无剩余重要问题。

## 明确的产品边界

这是可用的文档与工具页，不是实验贡献后台。公开 SDK、ZIP 上传、审核和自动发布尚未实现，文档中明确标识为规划。现阶段贡献走 GitHub PR。用户已确定最新审核通过版本作为默认、直接三维、不提供二维切换；相关规范均已记录。
