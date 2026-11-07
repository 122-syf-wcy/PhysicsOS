# 官网与管理员后台发布计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. 用户已明确要求部署上线；在同一任务连续完成实现、验证和发布。

**Goal:** 发布已确认的液态玻璃官网，并接入现有管理员后台的真实内容管理及图片反馈。

**Architecture:** 扩展现有 notice-host 的持久化域，新增全站官网配置和独立官网反馈表，保留原反馈业务。公开官网只读已启用的内容；官网管理位于现有 AdminWorkspace 内容分组，仅 SUPER_ADMIN 可操作。静态官网使用同源接口，产品应用与历史 API 继续可用。

**Tech Stack:** TypeScript / React / Harness storage-domain / attachments / Redis limiter / PostgreSQL / Docker / Nginx。

**Spec:** 本任务用户确认的 `demos/official-site/README.md`「管理员后台交付要求」与现有官网设计。

## Global Constraints

- 服务器 `107.151.246.59:/opt/physicsos` 与 Docker 是构建、测试和部署环境。本机仅编辑源码和 Git 整合。
- 发布基线为远端 main `1efe1ff`，其包含当前生产 `63b17e1`；必须保留全部已上线实验及修复。
- 原始桌面工作区的未提交内容不整批覆盖或发布。
- 用户授权包含正式部署；切换前保留运行镜像、数据库和应用数据恢复点，验证失败不切换。
- 密钥、Cookie、完整环境变量不得进入聊天、日志、代码或产物。
- 不发布虚构评价/贡献者；默认公开数组为空，由管理员添加真实内容。

## Shared HTTP contract

Prefix `/physicsos/notice`， JSON 错误沿用 `{error:{code,message}}`。

- `GET /public/website` → `{testimonials, contributors}`，过滤 enabled，按 order 排序；不得泄露来源反馈 ID、联系方式、原始图片或更新者。
- `GET /website` → `{content:{version, testimonials, contributors, updatedAt, updatedBy}}`，空配置 version=0。
- `PUT /website` 请求 `{expectedVersion,testimonials,contributors}` → `{content}`；写冲突 409。
- Testimonial: `{id,name,role,quote,topic,color,order,enabled,sourceFeedbackId?}`。
- Contributor: `{id,name,role,project,description,url,avatar,color,order,enabled}`；avatar 可为空或完整 http(s) 地址，禁止凭据 URL 和其他协议。
- 每类 0–12 条；name≤40，role≤60，quote≤280，topic≤32，project≤70，description≤220，URL≤2048；color 为 6 位 hex；id 唯一且仅字母数字下划线短横线，order 为有限非负整数。
- `POST /public/website-feedback` 请求 `{kind,body,contact?,context?,images?:[{data,mediaType,name?}]}` → `{id,createdAt}`，其中 data 为纯 base64。kind=bug/content/idea/other，body 5–2000 字，contact≤100，context≤400。
- 反馈图片至多 3 张，单张解码≤5 MiB，PNG/JPEG/WebP/GIF，经 attachments 实际校验与保存。仅此路由 JSON 最大 22 MiB；普通路由仍 64 KiB。
- `GET /website-feedback?status=open|answered|closed&offset=0&limit=50` → `{feedback:[...],total}`；limit≤100。条目 `{id,kind,body,contact?,context?,status,reply?,createdAt,repliedBy?,repliedAt?,images:[{id,name,mediaType,url}]}`。
- `POST /website-feedback/:id/reply` 请求 `{reply,status:'answered'|'closed'}` → `{feedback}`。
- `GET /website-feedback/:id/images/:imageId`：从反馈记录解析真实附件，SUPER_ADMIN 才可读取；private,no-store,nosniff。
- 所有管理 GET 与写入都显式校验 SUPER_ADMIN；不能仅依赖 guard 的写入角色 floor。
- 匿名写入检查 JSON/Origin，并按可信来源地址和独立 namespace 限流；故障不退化为无限制上传。审计不记录私密正文或图片。

## Review Focus

1. 普通用户/学校管理员猜测反馈与图片 ID：403，不能泄露全站官网反馈。
2. 匿名提交伪装图片/超限/跨站请求：拒绝且不写入反馈；正常截图持久化后可由管理员查看。
3. 空配置、隐藏条目及私人联系方式：公开页面诚实空态，公开 DTO 无私密字段。
4. 两名管理员并发编辑：版本冲突，不静默覆盖；发布排序与展示开关一致。
5. 产品应用及已发布实验：官网入口变更不得破坏应用、API、历史资源和后台登录。

### Task 1: 官网服务端

**Files:** notice-host/src/{domain,index,routes}.ts；新增 website-service.ts / website-routes.ts；notice-host/tests/website*.spec.ts；必要的 package/tsconfig/overlay importer。

- [ ] 编写覆盖上述权限、公开投影、版本冲突、匿名反馈/图片、持久化重开的测试。
- [ ] 先在服务器测试容器运行，确认缺少官网能力时失败。
- [ ] 实现共享 HTTP contract；新增表保留 domain version=0，旧业务保持原契约。
- [ ] 在服务器运行全部 notice-host 测试与严格类型检查，确认权限和失败路径通过。

### Task 2: 现有管理员后台页面

**Files:** ui-physicsos/src/client/website-api.ts、AdminWebsiteTab.tsx、AdminWebsiteTab.module.css；修改 AdminWorkspace.tsx、locales.ts；相关客户端测试。

- [ ] 为现有后台新增 SUPER_ADMIN 的「官网管理」入口与 UI 测试。
- [ ] 实现展示反馈/贡献项目编辑、排序、上下架、保存、版本冲突提示和刷新。
- [ ] 实现反馈收件箱筛选/分页、图片查看、回复/关闭；可填充反馈展示草稿，默认不发布。
- [ ] 使用同源 authenticated fetch，复用现有后台视觉与通知原语；不使用 localStorage 作为正式数据源。
- [ ] 服务器类型检查、相关客户端测试及真实浏览器检查。

### Task 3: 官网产品化

**Files:** apps/web/public/physicsos/website/*，复用已确认设计与动效；入口路由/部署脚本按兼容性核对后补充。

- [ ] 将预览静态代码和优化素材转入正式 overlay，去除演示 admin.html、测试截图和原始素材依赖。
- [ ] 改为公开配置 GET、真实反馈 POST，上传 base64 图片，失败保留表单；成功状态反映实际服务器响应。
- [ ] 删除示例数据和虚假数字/评价，不把空态伪装为已发布内容。配置入口指向真实管理员后台。
- [ ] 核对公开根入口与 `/app` 产品入口；保留历史深链接及 API。
- [ ] 候选浏览器验证动效、移动布局、空内容、管理员发布后更新、图片反馈全链路。

### Task 4: 服务器候选、备份与上线

- [ ] 记录服务器检出、运行镜像 digest、数据卷、反代配置；评估磁盘空间，保留所需恢复点。
- [ ] 从生产镜像/完整可追溯源码构建候选，所有变更在服务器 Docker 内测试，记录精确源码与镜像。
- [ ] 候选使用隔离数据库与应用数据；验证保存重启保持、角色限制和既有代表实验。
- [ ] 独立代码审查与修复；同步远端 main，确认没有新增未整合提交。
- [ ] 服务器备份 DB + app_data + nginx/compose，校验备份，标记原镜像回滚标签。
- [ ] 单副本切换，正式域名验证官网、应用、后台和健康；失败恢复原镜像/入口。
- [ ] 记录实际地址、版本、备份路径、验证证据与已知限制。

## Progress

- 已核对：远端 main=1efe1ff；服务器 checkout=72d489b；运行 image=49e1960a，source=63b17e1。
- Ruling: 使用新官网反馈表避免混入租户反馈，降低权限泄露风险。
- Ruling: 本轮管理员头像支持 URL 配置，沿用已确认原型；反馈截图走受保护附件存储。
- Ruling: 独立文件范围与固定 API 合约允许并行实现，主代理统一集成和服务器验证。
- 当前服务器磁盘仅约 860 MiB 可用，须先检查可安全回收的构建缓存，绝不删除生产卷和回滚数据。
