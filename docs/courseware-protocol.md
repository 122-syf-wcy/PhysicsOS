# HTML 课件导入与授课协议 v1

本文是课件功能的实现合同，不是实验 ZIP／实验 embed 协议。课件单独使用 `physicsos_courseware_v1`（unit version 1）和 `<DSH_HOME>/physicsos/courseware/v1` 私有不可变目录，禁止把上传 HTML 混入应用 JS bundle、公共静态目录或实验安全白名单。

## 功能开关与回滚

- `teachingToolsMode: off | bridge | enabled`，默认 `bridge`。
- `off` 不注册课件路径；`bridge` 读取已存在资源、授课和笔迹，可颁发只读播放票据，但不新建课件／版本／授课／笔迹，不清理 reservation 或写元数据。首次 bridge 目录不存在也可返回空列表与能力响应，不创建目录、不拖垮其它服务。
- `enabled` 才允许新业务写入，且每次服务端核验身份、权限、CAS、生命周期、额度与完整请求字节。
- 桥接回滚底线必须包含本单元严格 parser、opaque 播放器及私有目录备份；不能回滚到不认识新单元／目录的镜像再自动清理它们。备份须配对元数据、原始 HTML、适配 HTML、完整批注 blobs。删除本轮均为软删除，不提供永久清空。
- 自定义 `coursewareDshHome`，否则沿用既有 `canvasDshHome`／DSH home。配额由 `coursewareLimits` 严格配置；不得下调 256 MiB 全局空闲保留底线。

## 身份、共享与 HTTP

身份仅来自实际 Cookie session identity；认证业务路径拒绝任何 Authorization 请求，不能把 read-scoped bearer token 当成浏览器写权限。预期账号头 `x-physicsos-canvas-owner: encodeURIComponent(JSON.stringify({schoolId,username}))` 只能拒绝旧账号操作，不能授予权限。与 Canvas 共用 `canvasActor`、`canvasResponseActor`、`canvasJsonMutation`、实际字节 body reader：JSON／Origin／Host／Fetch Metadata 校验及响应前身份复核不另造弱版本。

所有 POST／PUT 还须发送 `x-physicsos-courseware-capability: courseware-v1`。能力响应在 `GET /physicsos/courseware/capabilities`，前端不得仅靠角色文案推断是否允许写入。

- 教师、校管、超管只能导入／管理本人课件；管理员没有跨账号 override。
- 首次导入私有。`publish` 是显式本校发布，学生与本校教师仅能读取当前发布版本。历史版本／原始文件／授课笔迹不随发布公开。跨校不按角色绕过。
- 授课实例及批注属于授课账号，而不是学校共享课件的上传者。批注计入授课账号额度；课件上传者也不能读取另一教师的私有笔迹。
- 归档停止共享和新保存；软删除拒绝授课／批注读取，保留恢复入口。恢复回到删除前的正常或归档状态，不自动重新公开。旧自动保存、离线重试或 IDB 草稿不能复活墓碑。

路径均以 `/physicsos/courseware` 为前缀：

| 方法／路径 | 合同 |
| --- | --- |
| `GET /capabilities` | 能力、读写开关、角色能力、关键额度 |
| `GET /?search=&lifecycle=active|archived|deleted&scope=all|mine|school&cursor=&limit=` | 授权列表、稳定 ID 游标，最多 100 项／页 |
| `POST /` | `{title,description,operationId,htmlBase64}`，完整原始字节 |
| `GET /:deckId` | 元数据与授权版本，原始／适配摘要、大小、adapterVersion |
| `POST /:deckId/versions` | 同导入，必须增加 `expectedActiveId` |
| `POST /:deckId/activate` | `{versionId,expectedActiveId,operationId}` 原子回退指针 |
| `POST /:deckId/manage` | `{action,expectedRevision,operationId,title?,description?}`，action 为 rename/publish/unpublish/archive/unarchive/delete/restore |
| `GET /:deckId/source/:versionId` | 本人不可变原始 HTML 附件，不以 text/html 直接播放 |
| `POST /:deckId/tickets` | `{versionId}`，认证后取得短时 wrapperUrl／nonce |
| `GET /:deckId/lessons?versionId=` | 本账号、该版本的可恢复授课 |
| `POST /:deckId/lessons` | `{versionId,operationId}` 新开一堂课 |
| `GET /:deckId/lessons/:lessonId` | 本人准确版本授课与空白页成员关系 |
| `POST /:deckId/lessons/:lessonId/blank-pages` | `{expectedRevision,operationId}` 增加独立空白页 |
| `GET /:deckId/lessons/:lessonId/pages/:slideId` | 单页完整批注与 revision |
| `PUT /:deckId/lessons/:lessonId/pages/:slideId` | `{scene,expectedRevision,operationId}`，独立页 CAS |
| `GET /embed/:ticket`、`GET /content/:ticket` | 精确短时能力路径；没有通用资源／fetch 代理 |

错误为 `{error:{status,code,message,retryable,details?}}`。典型：401 账号变化，403 角色／来源拒绝，404 未授权资源，410 墓碑，409 CAS／operationId 内容冲突，413 完整文件／单页／数量／账号或学校额度，423 bridge 或归档只读，426 旧客户端能力不足，429 并发／票据预算，507 全局／磁盘／元数据预算。不得把这些统称“离线”。

## 完整字节、持久化和容量

初始硬上限 16 MiB 原文件、17 MiB 适配文件、4 MiB 单页批注；另有限制账号 512 MiB、学校 2 GiB、全局 8 GiB、账号 100 课件／200 授课、课件 20 版本、授课 100 空白页、全局 2000 课件、100000 操作回执和 32 MiB 元数据。配置只能在严格 schema 上限内调整。归档／软删除仍计费，因为恢复依赖原文件。

元数据采用一个有界 catalog 行，完整值原子 `update` 保证额度 reservation、不可变引用、active pointer、墓碑和去重回执串行一致；HTML／笔迹正文不进入 KV。现 backend 会整表载入，本实现没有宣称分页等于索引，也不接无限增长的正文表。

发布顺序：完整静态解析 → 原始／适配／批注 SHA-256 → 账号／学校／全局／磁盘准入 → durable reservation → owner-private 临时文件完整写入及 fsync → exclusive link 到摘要路径并验证 → 元数据一次发布引用／回执。失败不返回截断内容；保留 reservation 直到 enabled 恢复清理或同操作重试。目录拒绝符号链接、非应用所有者和非私有文件；读取校验长度与摘要。

操作标识与请求内容哈希绑定。丢响应重试同一操作返回原 `appliedRevision` 和当前最新页 head，避免用旧回执把另一个设备已更新的页倒退。复用 ID 但改内容明确 409。

## 首个示例入口

课件库为可导入的教师／管理员提供“导入 31 页声音课件”。该操作按需获取 `/physicsos/teaching-samples/sound-properties-c-v1.txt`，只接受 `text/plain`、精确 3,317,789 字节及 SHA-256 `9ab882e3643fc669d04138388b590f492151ca48c1022b61dc68627acb92403e`，随后走与用户选文件相同的私有导入 API。不会在平台 origin 以 HTML 执行示例，不把 3.16 MiB 内容放入 JS 首包；原 HTML、teacher-preview 和来源／许可不改。导入失败、账号切换或取消会阻断旧结果，不能把示例自动发布到学校。

代理配置源码已在 `scripts/deploy/install-nginx-security-headers.sh` 补独立课件位置：仅 embed／content 能力路径覆盖继承 DENY、保留上游精确 CSP、移除 Cookie／Authorization／Set-Cookie 并禁用普通访问日志；API 路径保留认证及 32 MiB JSON body 预算。Fetch Metadata 原样转发，不能伪造 iframe metadata。该配置尚未在服务器应用或通过 nginx／浏览器验收；正式切换前须备份并精确保留并行教师预览。

## 静态导入边界

服务端只解析，不执行、不启动浏览器／VM、不抓取远程依赖。使用 parse5 的完整 HTML 树、Acorn 的 JS AST、css-tree 的 CSS AST。

允许受限 `data:image/png|jpeg|webp|gif|avif;base64`、字体 woff/woff2/ttf/otf 的 data URI、普通内联样式、JSON 数据块以及不依赖模块的内联经典脚本。每个实际服务脚本使用精确 CSP SHA-256；无 `unsafe-eval`、无 script unsafe-inline、无 event-attribute 哈希豁免。CSS inline 放行只用于原课件布局与脚本更新 style，外部资源仍由 AST 与 CSP 双重限制。

拒绝远程／相对缺失资源、外部脚本／模块／动态 import、eval／Function／字符串定时器、已知网络或持久存储入口、危险／外域 href、srcset、表单、srcdoc、任意嵌套 frame/object/embed、meta refresh／base、事件属性、CSS import／危险 URL／不可静态解析片段。拒绝时返回有界资源／问题清单，不自动修复、下载或静默删掉用户内容。

AST 静态拒绝不是 JavaScript 完整能力证明。恶意程序能用计算属性构造 API 名，因此真实安全边界还必须是下述 CSP／sandbox／固定父 frame-src，验收脚本包含这种绕过静态名称检查的 self-navigation、popup、frame 和 fetch 负例。

## 三层播放器与票据

```
已认证应用（平台域）
  └─ 可信 wrapper（平台代码，scripts + same-origin）
       └─ 上传内容（opaque origin，sandbox="allow-scripts"）
```

上传 child 不包含 allow-same-origin、top-navigation、popups、forms 或 downloads。它不能读取平台 Cookie、DOM 或 owner 信息。试听保留真实 WebAudio，仅用户主动播放；摄像头、麦克风、位置、USB、付款、剪贴板能力不授予。

`/content/:ticket` 不接受顶层执行：必须具有浏览器 `Sec-Fetch-Dest: iframe`、`Sec-Fetch-Mode: navigate`、`Sec-Fetch-Site: same-origin`，并校验准确 `cwNonce` 与 `parentOrigin`。顶层 document、fetch／XHR、跨站 iframe 或缺失 Fetch Metadata 全部 fail-closed 403 JSON，不返回上传 HTML、不执行脚本、不重定向。这样不能用直接打开 raw URL 绕过 wrapper 的固定 frame-src；不支持该上下文标识的旧浏览器明确不播放。反代必须保留这些浏览器头，验收覆盖正常 wrapper 初始 iframe 和 raw 顶层负例。

票据由认证 POST 颁发，默认 120 秒、最多 5 分钟、随机 256 位。wrapper／content 两条能力 URL 使用 `private,no-store`、no-referrer、nosniff，不设置 Cookie。child 只知道本次能力 URL 与 handshake nonce，不知道通用凭据。过期后需从认证 API 重取；已加载的独立 HTML 不会因 TTL 中断本地声音／交互。

可信 wrapper 的 `frame-src` **固定为本次原点＋精确 content 能力路径**，不能写成 self、data:、blob: 或任意 URL。配合 child 的 `default-src none`、`connect-src none`、`frame-src none`、`worker-src none`、`object-src none`、`base-uri none`、`form-action none`，用于拦截外域子 frame 自导航等不是 connect 请求的绕路。`navigate-to none` 只是额外提示，不能将其浏览器支持当作安全保证。候选真实 Chromium 必须验证自导航没有发出请求。

现有反向代理若覆盖 CSP／X-Frame-Options，需仅对 `/physicsos/courseware/embed/` 与 `/physicsos/courseware/content/` 精确采用服务端头，不改全站实验安全策略。wrapper 必须以浏览器实际原点生成；正式反代已设置单值 `X-Forwarded-Proto` 时可推导，或挂载 handler 时明确传入可信 `publicOrigin`。不从上传文件或任意 query 取外部原点。

## 一次 MessagePort 握手

1. wrapper 给 content URL 注入 `cwNonce`（32–80 个 base64url 字符）与 `parentOrigin`（wrapper 的精确 origin）。
2. child 仅向 parent 的明确 origin 发 `{type:'courseware/ready',protocol:1,nonce}`。
3. wrapper 验证 `event.source===child.contentWindow`、`event.origin==='null'`、nonce，向平台父级的精确 origin 转发 ready。
4. 应用验证 `event.source===wrapper.contentWindow`、精确 origin、nonce；创建一个 MessageChannel，发送 `{type:'courseware/connect',protocol:1,nonce}` 并转移一个 port。
5. wrapper 验证 parent source/origin/nonce、仅一个 port、只允许一次连接后移除窗口监听，将 port 转交 child。
6. child 同样验证 parent source/origin/nonce、只一次接收并移除 listener。之后业务仅走该 port。没有窗口广播 RPC、资源代理或 Cookie 消息。

每个 port 包为严格普通对象，`protocol:1`、正整数 `seq` 严格递增；最大完整 UTF-8 JSON 16384 B、滚动 1 秒最多 90 条、目录最多 500 页，状态报告最多 30 Hz。坏 schema、超长、速率或 seq 错误关闭连接；父最多 16 个未确认命令并有超时。不截短标题／requestId 来掩盖坏包。

父命令：

```ts
{ type:'courseware/command', protocol:1, seq, requestId,
  command:'next'|'prev'|'goto'|'state'|'outline'|'notes'|'motion'|'stop-audio',
  slideId?: string }
```

child 导航后 ack，随后报告最终状态：

```ts
{ type:'courseware/ack', protocol:1, seq, requestId, ok:boolean, error?:string }
{ type:'courseware/state', protocol:1, seq,
  slideId, index:0 /* zero-based */, total,
  slides:[{id,title}],
  stage:{width:1920,height:1080,
    rect:{x,y,width,height}, /* child CSS viewport coordinates */
    scale /* rect.width / 1920 */},
  interactive:true /* 舞台是否可被批注层覆盖；弹层打开时 false */ }
```

`courseware/fullscreen` 仅请求提示。浏览器全屏须用户直接点击平台工具栏，不能假设跨 port 保留 user activation。

所有翻页（父 next/prev/goto、内部按钮、目录、键盘、滑动／滚轮）必须调用统一 `showPage()` 并在函数完成后 report。稳定 slideId 来自作者清单；原 hash 不是协议、也不从父层猜 DOM。`ResizeObserver`、resize、visualViewport resize 和弹层 open/close 同样报告真实矩形。

### 作者显式接入（不是自动猜页）

除内置 exact-byte 适配器，作者可以在自包含 HTML 中加入以下纯 JSON 清单，并自行实现上述握手／showPage 报告程序。清单严格校验、页 ID 唯一、最多 500 页、标题最多 200 字；普通 HTML 没有此声明则仅为单文档。含 courseware 握手程序却漏清单的未知文件明确拒绝，避免重复桥接与竞态。此声明不授予额外 iframe／网络／脚本能力，仍经过完整静态校验与 CSP 隔离。

```html
<script type="application/json" id="physicsos-courseware-manifest">
{"protocol":1,"adapterVersion":"my-lesson-v1","stage":{"width":1920,"height":1080},"slides":[{"id":"cover","title":"封面"},{"id":"experiment","title":"实验"}]}
</script>
```

## 原始 31 页示例

`examples/courseware/sound-properties/` 保存原始 import 副本、独立 adapted HTML 和 provenance.json。原始大小 **3317789 B**，SHA-256：

`9ab882e3643fc669d04138388b590f492151ca48c1022b61dc68627acb92403e`

适配器 `sound-guizhou-c-v1` 只对上述 exact bytes+SHA 白名单执行变换，保留 31 个作者 slideId；独立 adapted 产物另以 **3328723 B + SHA-256 `911b5f372a3623557095139cb0c4665b7b15a80c75110dfd81947ca51ff071d1`** 精确认出，不二次注入单文档 bridge。因此原始 import 副本和该预适配副本均可导入；用户上传的实际字节始终作为该次 source 保存。原始文件或 teacher-preview 不变。后端再做独立安全解析与序列化，因此服务端 content 摘要可以不同于独立 adapted 预览文件摘要；两者 provenance 不混用。

embedded 副本隐藏重复 chrome/deck-controls 但保留其 DOM 与业务引用；舞台仍 1920×1080，不用 capture class 关闭正常动画。原目录、备注、滑块、观察记录、合成音及模型保留。外链变为来源 URL 纯文本；沙箱不下载文件，课堂记录导出改为可选择复制的真实 JSON 弹层，不伪造数据或 body。

不在白名单内的 HTML **单文档模式**：固定 1920×1080 导入视口、仅稳定页 `document`；不自动识别第三方 PPT 页码。支持作者交互，但内部滚动离开起点／打开 dialog 时暂停覆盖批注，以免把滚动位置假装成新 slide。需要多页精确笔记的作者应接入本协议；首版不提供 PPTX 转码或多人实时同步。

## 笔迹、草稿与课堂工具

- 工具包括交互／画笔、颜色／粗细、荧光、整笔划／整形状橡皮、线／箭头／矩形／椭圆、撤销重做、清空确认、激光、可调聚光、全屏与本堂课空白页。激光与聚光不进入持久化。
- 复用既有 `CanvasAnnotationPrimitive`、严格 parser 与内部 `inkOutline` utility。原始 coalesced samples、压力（含 0）、时间不重采样；仅可视 outline 平滑，预览按 rAF 合并。
- 坐标使用 `x=(clientX-stageRect.left)*1920/stageRect.width`、相同 y 公式；stageRect 是真正舞台，不是整个 iframe。**不乘 DPR。** 固定 SVG viewBox 与 CSS 舞台矩形一致，letterbox 不可落笔。
- pointer capture／up／cancel／lost-capture、blur、页切换、resize、工具切换和账号 epoch 都有栅栏。手势属于开始时的页与 generation；迟到 up 不提交到新页。已提交保存则继续作用于捕获的旧页，其响应不切换当前画面。
- 导航开始即撤销 editOwner；命令 pending 时不转发旧 state，ack 后最终可信 state 才恢复覆盖。握手／命令超时、port quarantine／断连都使 playerReady=false，禁用落笔并推进 generation；不把已失联的 A 页坐标用来给实际 B 页批注。页面初始化 cache＋首次 authority GET 单飞，快速 A→B→A 不会用第二 GET 提前暴露空 ready 页，再让旧 GET 覆盖新 pending；后续重读以逐页 loadSequence 与不倒退 revision 栅栏保护。
- IndexedDB key：账号 namespace＋tab clientId＋deckId＋versionId＋lessonId＋slideId。每次账号代际 lease 与草稿写入在同一 IDB transaction 检查；退出／切账号的迟到写不能覆盖新 lease。tab id 保存在 sessionStorage，刷新保留该标签页草稿，多标签不互相覆写。
- autosave 缓存完整操作 delta、base head、undo/redo 和**已发出的完整 CAS 请求**后才发送。失响应后同 operationId／payload 原样重放，不能把旧 ID 换成新 scene。
- 服务端变动 409 后可安全逐图元重放到最新 head；同图元冲突停止，不覆盖。重放新内容必须生成新 operationId。提供只读保留、完整 JSON 导出、明确放弃本机并重载。
- 401/403/404/410/423/426 不是离线，不用 IDB 掩盖墓碑／权限。真正网络／可重试失败才显示离线草稿。IDB durable 写失败停止网络自动提交并显示 draft-error，仍可导出内存草稿。
- 历史只留 changed primitive delta；完整旧历史项可有界淘汰，但不截断可见场景的采样。单页／未确认队列达限明确拒绝，不悄悄删采样。

## 统计边界

真实课件列表／播放器成功显示才发 ActivityDisplayed 打开事件；加载、失败、权限拒绝、rerender、翻页、轮询和自动保存不新计。

新授课实例成功时，同一次业务原子写保存 `ActivitySuccessCapsule={version:1,source:'courseware-session',operationId:sessionId,occurredAt:服务器首次ISO,owner:{schoolId,userKey}}`。提交后 best-effort sink，不阻断业务队列；超时／pending 保留持久 capsule。继续旧授课、翻页与后续保存不新计。`replaySource()` 按原 createdAt|id 有界枚举最近 7 天 durable capsule，即使课件归档／删除仍保留。容量不足拒绝新业务，不删掉既有 capsule 来伪造 caught-up。

## 验证入口与尚未执行的门槛

本轮提供 learning-host 的 courseware adapter/security/blob/service/http 测试，客户端的 protocol/coordinates/pointer/controller/persistence 测试，以及 `scripts/verify-courseware.browser.mjs`。源码阶段不在 Mac 执行。正式集成须在服务器 Docker 完成类型检查、现有 usage/canvas/whiteboard 回归、真实 PostgreSQL 落盘与冷启动、桥接往返及精确 CSP 反代验收。

真实脚本用独立 teacher storage-state，通过正式课件入口导入真实 31 页 HTML，检查逐页 ack、字体图片、滑块、真实合成音、opaque Cookie/DOM 拒绝、压力／DPR／letterbox／全屏坐标、空白页、撤销重做、断网重放、1440/1280/1024/390/320 布局，另以计算属性构造攻击入口测试外域自导航／弹窗／frame/fetch 不发请求。脚本不 mock body/API，不禁用 Chromium sandbox，不输出 Cookie／完整环境变量。`COURSEWARE_STUDENT_STATE`／`COURSEWARE_FOREIGN_STATE` 可增加真实授权角色矩阵；缺少这些状态不表示角色验收已通过。

服务器剩余空间不足时，必须先补容量，不能降低 minFreeBytes、自动 prune 或把源码测试文件存在当作真实验收已通过。
