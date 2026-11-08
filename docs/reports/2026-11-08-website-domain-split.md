# 官网独立域名与系统根入口恢复

2026-11-08（Asia/Shanghai）已完成发布：

- 官网：`https://physicsos.dongsiwei.com/`。
- 系统：`https://physics.dongsiwei.com/`，恢复原根入口。
- 官网所有产品入口、开发文档和后台「打开官网」分别指向正确域名；后台官网管理、反馈、截图、排序和上下架保持。
- 旧 `/app`、`/app/` 链接跳回系统根路径，保留查询串和浏览器 hash；重置密码链接与 PWA `start_url` 恢复 `/`，PWA `id: /` 保持。

## 版本与实现

发布前远端 main、服务器检出为 `7aafeee0e3029ecb5199014e2444f820a0c6bd28`，实际生产镜像为 `sha256:c84f9f5afa163726d59891e5d3672d7b5f06a7c1dd95398f66a9fbe1e1624c4e`。在隔离工作区实现，没有改动桌面主工作区的其他未提交内容。

运行源码提交为 `8563e9d1195e44e88efcb74d88ecba2d540eab93`，实际运行镜像为 `sha256:cb6e2498e7fa88ee08694eb3192cbdd430e9d06d930133d5d9b2b41e88a706da`。构建以精确生产镜像的已校验本地标签为基础，仅追加 web-app、auth-host、官网静态资源/PWA 清单及独立 `optional-admin.js`；既有其他模块和产物保留。`/app/domain-split-source-manifest.json` 记录精确基础镜像、运行源码和 140 项 SHA256。

web-app 不再因官网文件存在自动接管根路径。保留明确的 upstream-relative 管理补丁，确保现有 vendor 树重应用 overlay 时也清除旧接管逻辑。官网单独使用 Nginx vhost，只开放官网静态资源与两个 public notice 接口，去除 Cookie/Authorization 并隐藏 Set-Cookie；系统保留管理接口和原反代配置。官网 A 记录指向 `107.151.246.59`，服务器已有 Certbot 成功签发证书。

## 验证

- 服务器 Docker 内完成官网 16、密码重置 9、frontend-static 4、管理员界面 8 项相关测试，共 37 项通过，关键链接变更先观察失败再通过。
- 完整 overlay 对原始 upstream 文件通过 `git apply --check` 和应用检查。两个宿主及 UI 类型检查/构建通过；只重建对应管理员可选 bundle。
- 候选实际系统根页面、PWA 根启动地址、官网产品入口与后台「打开官网」正确；390/768/1440 px 页面无横向溢出，可滚至完整页脚。
- 真实 1440×1000 PNG 通过官网同源接口提交成功，后台读取一致；配置版本和截图 SHA256 在候选重启、后台身份服务完成挂载后保留。候选 DB、Redis 和可写状态与生产隔离。
- 候选临时诊断后恢复原始运行文件，重新通过全部 140 项来源校验。发布只使用最终已验证的同一镜像。
- 正式 HTTPS 两域名、官网按钮跳到系统根、PWA `/`、旧 `/app?source=legacy#/experiments` 跳至 `/?source=legacy#/experiments` 的浏览器验收通过。正式公开评价和贡献者均为 0，未带入候选内容。
- 官网匿名管理路径返回 404，系统匿名管理配置返回 401。原始反斜杠与 `%5c` 逃逸路径返回 400；此前候选复现过绕过静态前缀的路径，现已阻止。
- Docker healthy，HTTPS `/readyz` 的 PostgreSQL 与 Redis 均正常。切换前后 76 个已批准 2.1.0 实验指针、归档 SHA256 和模型通道配置一致。

浏览器系统长连接不能使用 `networkidle` 作为就绪标准；正式验收改用 DOM 加载、明确页面元素及 URL 条件。候选重启后同时等待后台身份接口，避免只凭基础依赖 readyz 提前读取管理数据。

## 切换与恢复点

首次切换时系统跳转正确，但发布脚本错误地只接受相对 Location，实际 Nginx 返回完整 HTTPS 地址，触发自动回滚。回滚验证通过、旧镜像与实验指针一致；修正为解析并规范化 URL 后，使用新恢复点重新备份并成功切换，未覆盖首次备份。

- 成功切换前应用数据与私密配置：`/opt/physicsos/backups/releases/20261108-website-domain-split-r2`。
- 配对 PostgreSQL 恢复点：`/opt/physicsos/backups/postgres/20261108-website-domain-split-r2`。
- 旧镜像标签：`physicsos-app:rollback-website-domain-split-20261108-r2`，指向精确的 `c84f9f5a…`。
- 首次尝试的 `20261108-website-domain-split` 配对备份、回滚日志及旧标签保留；此前官网/性能发布恢复点也保留。

发布持有 release 锁和既有 full-backup 锁，停止应用写入后生成配对数据库与应用数据备份，归档/转储校验通过。失败回滚一起恢复 Git、镜像和 Nginx，保留当前数据库；切换后新增数据不能用旧备份直接覆盖。私密脚本、校验日志和候选状态保留在服务器 `/opt/physicsos-previews/website-domain-split`。

最终文档提交随后同步到 main 和服务器，不更换实际运行镜像。
