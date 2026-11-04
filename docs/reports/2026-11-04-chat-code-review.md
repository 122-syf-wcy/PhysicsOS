# 对话题目代码实验独立审查

当前补审范围：用户明确否定旧 renderer 加标注的包装方案，以下历史 source 绑定及验证不代表新视觉方案验收。本次依据 `docs/superpowers/specs/2026-11-04-independent-question-code-design.md`，仅审查 `ff002643a41177299106e62bf6f91ee7ba3b30c9` 之后未提交的独立 Canvas/SVG 增量，最终 source SHA 待发布者冻结。

审查基线：`68bd8d0551d8d69867dde7d153a38b766a7b39a8`。同一次审查最终绑定产品/runtime source 提交：`16f3932cb629c93cf0e71bcf417f99cf1be80abe`，已独立核对 parent 为 `970e002500b5e9748f8dd4ab75a2aec7b7de3285`，后者 parent 为 cached-solve 修复 `7cdc1e5792b5614ccbdd33b63f5b0bf6b864922e`，再前一 parent 为 `3621ae27d3da1f5036452b53411545c3712404b3`。此前窄范围审查链为 `3621ae2` → `bddb5a943407a98681c1e1a2219cac5dd6bb7f40` → `340dd0657cad7ae6933db777853e13e8520f4d38` → 完整审查的 `dfd004ceed5cb4da56dc0e8bfc8f45d901f9452a` → 上述基线。审查对象为 `codex/experiment-contribution` 完整实现及新增文件；不纳入 vendor 脏指针或既有生成资源的无关审计。审查者只读取产品代码和服务器发布工具，唯一写入为本记录。后续 E2E harness 与部署文档另行记录，不改变本次产品范围。

## 结论

此前 Important/P2“持久化 generating 状态没有中断恢复入口”及“重复 cached solve 绕过同轮生成边界”均已修复。新独立方案当前发现一项未解决 Important/P2：renderer guard 的全模块绘制证据可让空入口或纯背景获得 independent 标记；无 Critical 项。原风格版本记录时点的 Minor/P3 仍不阻塞发布。新独立源码须实际绘制对应题目画面，参数与关键时刻符合引擎，真实模型 ready 及视觉验收都不能由代码/协议测试替代。

## 已修复的 Important/P2：恢复历史生成任务

最初 `code-generation.ts` 发布的 `generating` 仅包含任务和场景身份，没有启动时间、截止时间或活动任务探测；`QuestionCodeCanvas.tsx` 则在 `status === 'generating'` 时隐藏唯一重新生成按钮。服务器在该状态写入后重启，持久日志会继续展示“正在生成本题实验”，但已没有进程负责完成它。后续 turn/latest 变化还会让生成器的 stale catch 跳过终态，因此同类历史卡片也可能保留这一状态。

修复核对：共享状态类型、projection schema 和 invariant 兼容可选 `deadlineAt`；新任务在 `code-generation.ts:94` 使用同一超时值设置截止时间并持久化。`QuestionCodeCanvas.tsx:27` 安排截止时间刷新，`:66` 将旧无期限记录和超期记录呈现为 `interrupted`，`:90` 保留显式重试。未过期任务继续等待。没有读取历史自动调用模型，也没有通过补写过时 scene 改动 latest 或覆盖后来题目。

独立读取服务器构建容器 `/tmp/chat-code-review-ui-green.log`，确认正确 client 配置下 `question-code-chat.client.spec.tsx` 11/11 通过，包括旧记录、超期记录与活动任务跨越截止时间三项恢复回归。实现者另报告这三项在修复前均失败，符合故障复现。

## Minor/P3：风格版本的记录时点

`question-code-service.ts` 在最终创建 artifact 时重新读取发布提示词，并将当时的 `styleVersion` 记录进 immutable row。子代理使用的是生成开始时读取的正文。后台若恰在生成期间发布新版本，记录的风格版本可能比代码实际使用的正文更新。这不影响题目条件、资源哈希、权限或播放器；可后续将开始时的风格版本固定到 create 输入。

## 核对结果

- 子代理创建窗口先建立结构化工具，再通过 awaited `agent/created` 挂载空专用 preset，清除继承工具并建立执行 guard；在第一次 inbox/模型请求前检查工具仅有 `structured_output`。使用新会话，不继承父对话历史，深度限定为一层。
- 生成器校验当前任务、场景 ID、修订、完整场景哈希和当前 turn/latest；过时结果不会发布。子 run 在成功、校验修复、取消和失败路径均由 holder dispose；封闭代码修复至多一次。
- source/preview 使用服务端账号与精确持久会话归属，管理员无绕过；签名 assets 每次检查原会话归属、摘要与时限。源代码及 capability URL 不进入对话事件。文件通过独立私有域和内容哈希冻结，重启可重读并重新授权。
- 聊天和显式 Lab 都从完整题目 scene 建立相同引擎 runtime；代码只接收平台快照。新控件通过原 runtime/意图边界修改本地探索，结构化已验证答案保持附着。ready 的源码响应须匹配完整不可变引用；同修订状态变化进入 turn data；preview 更新和重试保留物理 session。
- 社区 active-release 指针未参与私有实验流程。模板文件返回独立 Buffer，防止私有 source 替换污染社区模板。
- upstream patch 的实际 lock 增量为八个 workspace 依赖；其余为补丁行号与既有条目的重排，没有新外部版本升级。
- 只读核对服务器 `/opt/physicsos-previews/chat-code-release-20261104/tooling`：实际 DDC 镜像作为基础、候选使用隔离 PostgreSQL/文件根、运行差异受路径和大小边界约束、保留基础镜像独有资产、精确 SHA/link/native 验证、发布核对 main/HEAD/运行镜像与已接受候选身份。切换前停止 app 后保存数据库/文件恢复点，并保留旧镜像回滚入口。

验证证据：实现者报告服务器 Docker 专项宿主/身份38、工具42、UI86、question-core449项通过；审查者未在本机运行构建或依赖。最终服务器 bundle、真实主代理→子代理浏览器验收、候选重启和 HTTPS 发布结果由对应执行者另行记录，不能由本代码审查替代。

冻结提交时，发布者报告最终 core/tool/auth/experiment/UI/Web 阶段均以 0 退出，全部50个本轮实现和测试文件与服务器副本 SHA 核对无差异，未提交 vendor 指针。完整 overlay verify 发现旧部分 overlay 副本及 AppleDouble 共566项 drift，不能称其全量通过；本轮精确验证范围是50个意图内 source、实际 lock exact apply 与基于真实 DDC 运行镜像的 runtime delta。此范围说明不扩大本代码审查的成功声明。

## 同次窄范围补审：抛体初速度控件

真实浏览器发现竖直上抛速度20改25后变为32.0156且方向变化。故障来自旧 bridge 将“初速度”当作 x 分量，保留原 y 分量。本次仅补审 `mechanics-runtime-bridge.ts` 与 `mechanics.client.spec.tsx` 相对 `dfd004ceed5cb4da56dc0e8bfc8f45d901f9452a` 的必要修复，没有重开原代码实验架构审查。

窄范围结论：当前二维题目场景无新阻塞项。非零抛体初速度在 recompute 时由原 scene 速度归一化；初速度控件缩放完整方向，置零保留方向 cache。零速改角只设置之后发射的方向，不造出1m/s；指示角从该 cache 读取。实际速度写入仍通过 `SetBodyVelocity` → `SceneRuntime.execute` 的场景校验/事件边界，再由原 MechanicsEngine 和 verifier 重新验证，没有计算或覆写题目答案。命令拒绝会恢复之前的选定方向；恢复原题清理 cache 后由原题非零速度重建方向。非抛体速度分量编辑行为保持原有语义。

新增五个回归覆盖竖直、30°斜抛、平抛在25→0→25时方向保持，零速选角后发射，以及原题恢复后再置零/发射。执行者报告正确服务器 client 配置下三个文件38项通过，其中 mechanics21项；Oxlint零警告/错误，overlay/vendor/server 内容哈希一致。此修复已绑定 `340dd0657cad7ae6933db777853e13e8520f4d38`；发布者另报告新构建的浏览器场景将20改25后保持90°，其余重启、历史和失败验收另行记录。

## 同次最终类型/guard 增量核对

仅核对 `dfd004c..340dd06` 忽略格式后的剩余增量，无新阻塞项。`SessionProjectionStateMap` 补充真实内部状态类型，`ctx.get.bind(ctx)` 保留动态查找 receiver；异步创建的隔离标记改为对象字段，仍在 awaited 创建后检查。专用 preset、可信模板、manifest 和 signing key 改为局部非空检查，保持缺失时拒绝；签名输入、owner 检查与摘要均未放宽。wire metadata 从 unknown 检查状态标签后收窄，canonical stringify 的 undefined 回退保留；测试 prototype spy 通过 `apply(this, args)` 保留 receiver。其余为格式和已补审的速度修复。

发布者报告本轮52个 source 与服务器 SHA 无差异，types/tool/auth/host/UI 和 Vite 均以0退出，严格40文件检查的两处类型问题及最终单文件 metadata 检查均已修正为0；新 mock 浏览器已有七个验收节点通过，剩余 Web 重启、历史和失败路径继续执行。本段区分执行者报告与审查者独立 diff 核对，不据此声明尚未完成的部署或全量 overlay 验证成功。

## 同次最后增量：冷启动再生成的 turn 标签

仅核对 `340dd06..bddb5a9` 的四行发布修复及对应回归，无新阻塞项。生成调用者将捕获的当前父 turn 覆盖到新 `physics/scene` 事件的 presentation metadata，生成器仍保留原 `value.scene`、solve、修订与哈希；turn 不进入 scene SHA。现有 current-turn/latest/job/scene 检查保持不变，因此旧任务不会覆盖后续题目，原 turn 的既有事件没有重写。

回归使用真实 JSONL 第一轮持久化、完整销毁、重新启动 Cordis 和父会话第二轮 resume；断言新状态从旧标签 `[1,1]` 改为 `[2,2]`，原事件前缀、场景、solve 和 create 输入保持一致。审查者独立读取服务器构建容器 `/tmp/chat-code-cold-turn-green.log`，确认 generation19项通过（含该冷启动回归）。发布者报告 tool tsc/bundle 与两文件严格 typed lint 均以0退出；新镜像替换及最后实际浏览器/模型验收由发布者另行记录。

## 同次性能与生命周期增量：`bddb5a9..3621ae2`

仅补审六个文件。子呈现任务输出上限改为8192并尊重更低的父预算；只选择真实模型元数据公布的 off/none/minimal/low，不硬填未知 effort，也不更改父 provider/model 或父选项。元数据查询在注册 child-created hook 之前携带 signal 并与 abort 竞争；普通查询错误回退继承，取消移除 abort listener 且不创建子代理。实际 child startup 继续由 holder 持有；场景、源码验证及账号权限没有改动。新同轮 guard 对已有失败/生成状态直接复用，对没有新展示要求或显式不同风格的 ready 引用复用，下一真实 turn 允许手动再生成。

已修复的 Important/P2：`3621ae2` 的上述复用可被再次调用 `physics_solve_question` 绕过。`packages/agent-tools/src/physics-tool-runtime.ts:611` 对同一题面和未变化的修订返回 cached scene；当时 `tool-physicsos/src/index.ts` 随后无条件发布不含 visualization 的 solved snapshot，last-wins fold 清除旧生成状态后再次生成。因此同一 scene/revision/turn 可启动第二个子任务。原新增回归只覆盖重复 `physics_generate_experiment`，没有重复 cached solve；修复和新回归见下一节。

独立读取 `/tmp/chat-code-present-lifecycle-green.log` 确认现有27项通过，并读取 `/tmp/chat-code-present-lifecycle-lint.log` 确认四文件零警告/错误。此证据不覆盖上述新发现路径；旧 budget lint 日志属于修复前四项错误，不能代替最终 lifecycle lint。真实性能预算、最终候选镜像及上线仍由发布者完成验收。

## 同次最后两处增量：`3621ae2..970e002`

cached-solve 修复只对同父会话、同 scene/revision、同当前 turn 且完整序列化场景 `isDeepStrictEqual` 的情况跳过冗余 solved 发布，保留原失败/生成/ready 状态；新 turn、真实场景变更或修订变化仍照常发布和生成。真实主代理重复同一题面的新增回归覆盖 failed、bare SDK 校验失败和 ready，再覆盖新用户轮次及同轮真实 scene command 后生成。审查者独立读取 `/tmp/chat-code-cached-solve-green.log` 确认31项通过，并读取 cached-solve lint 日志确认两文件零警告/错误。此前 P2 关闭。

model-pool proxy 的 narrow 修复在 `upstreamModelOf` 确定实际 wire model 后执行：原 off→none 翻译保留，仅 native DeepSeek v3/v4/chat/reasoner 且 off/none 增加 `thinking:{type:'disabled'}`。新 HTTP 回归覆盖平台标签与实际通道模型互换、高 effort 主请求精确保留、非 DeepSeek 无额外 thinking 字段以及 R1 distilled 模型不添加 native 字段。没有改 pool 配置、父 high/32768 选项、Agent core、场景或源码权限。执行者报告完整 pool88项和 types/lint/bundle 通过；审查者已独立核对 proxy 的调用顺序和该四文件 diff。最终新镜像的真实模型单题 ready、预算及切换验收由发布者另行记录。

## 同次最后 READY 单任务边界补审

仅补审 `tool-physicsos/src/index.ts` 和 `tests/code-generation.spec.ts` 的最后小增量，无未解决阻塞项。同一父会话、scene/revision、当前 turn 的 ready/failed/generating 均无条件复用；额外展示 instructions 或显式不同 style 不能再打开第二个同轮任务。下一真实用户 turn 仍可带这些参数重新生成；模型文字投影与工具说明同步指出该边界。原完整场景、物理答案、账号归属与 source 验证没有变化。

审查者独立读取 `/tmp/chat-code-hard-one-job-green.log` 确认32项通过，并读取同阶段 lint 日志确认两文件零警告/错误。逐文件 SHA 核对 overlay、本机 vendor 与服务器构建容器三者一致：`src/index.ts` 为 `cbffe010903c851b122fbd9ccce37a2df5ba95bf76d05adef84afceb5fc16620`，`tests/code-generation.spec.ts` 为 `d8cea3ae5037c4a398a408c69ec06c8f41c8f7a94f0bacb3c91b1e8e13b79dc9`。冻结后独立核对最终提交 `16f3932cb629c93cf0e71bcf417f99cf1be80abe` 内两文件的 SHA 仍一致，并读取 fresh `/tmp/chat-code-hard-one-job-root-confirm.log` 再次确认32/32通过。此为同次审查最终绑定，不重审祖先，也不将测试通过替代最后真实模型和发布验收。

## 同次配置根因补审：呈现 effort 的实际 wire 值

产品 source 仍为 `16f3932`，仅补审候选 profile 的两字段修正，无新增代码阻塞项。原 `reasoningEfforts.off:null` 在实际 PiAiAdapter/SDK 请求中省略 reasoning 字段，且未声明 compat 时使用 `max_completion_tokens`，因此已审查 proxy 的 native DeepSeek off/none 条件没有机会触发。将该模型的 off 映射为 `none`，并将 `compat.maxTokensField` 设为 `max_tokens`，让实际 SDK 请求表达禁用意图并采用网关接受的输出预算字段；既有 proxy 仍只对选定 native DeepSeek 的 off/none 添加 `thinking.disabled`，high 路径保持原意图。

独立读取 release 的 `model-wire-change.safe.json` 与 `model-wire-capture.safe.json`：完整解析配置仅这两字段变化，high 保持 `high`、模型输出预算保持32768，其余解析配置不变，strict resolveProfiles 接受。真实候选 PiAiAdapter + 已安装 SDK 的 localhost HTTP dummy capture 显示，off 从省略 effort/`max_completion_tokens:8192` 变为 `reasoning_effort:none`/`max_tokens:8192`；high 仍发送 high，8192测试预算数值保持。capture 中 proxy 后字段由相同已审查 normalizer 推导，不能称作新的真实上游模型验收；此前 HTTP proxy 回归单独验证该映射。

脱敏 applied report 记录候选配置已应用且 SHA 为 `b410bb224bce7f047919ec42fa6ddffa9e99e6d1a0c06de701f6e4fcd5305157`，修改前 SHA 为 `04f228958efdf54a004cc726382acbb0cc92ca37b15ca6b6e74f3a2f6ca39441`。独立 stat 确认私有备份权限0600，未读取完整 profile、密钥或环境；执行者报告候选 restart/ready healthy。正式 profile 尚未改动，最终真实单题 ready 继续验收。profile 位于挂载数据 `/var/lib/physicsos/profiles/web`，候选 image 身份不会包含此配置，因此正式切换须在恢复点后应用相同已审查两字段，才能保留候选运行语义。

## 同次必要样式分层增量

真实子代理只输出补充 CSS 时，直接替换模板 CSS 会丢失 V3 基础字体及页面样式。本次仅补审 `question-code-service.ts` create 中12行及对应 host 回归，无新阻塞项。平台 CSS 单独复制到 public/dist 的 `assets/platform-base.css`，两个 index head 在 authored CSS 前加载它；然后保存原始子代理 CSS。该处理发生在资源/元数据验证和内容哈希冻结之前，source API 仍返回子代理原始四字符串，旧 immutable row 不迁移，社区模板不修改。

独立核对全部76个模板都具有唯一的 head authored-link 及基础 CSS；两个 source 文件的 overlay、本机 vendor 和服务器 SHA 一致，service 为 `a787b13aabe176397ba609414ff277c2a82896473f9ad56f5827fdb361d04163`，test 为 `c8d6967bcbfecbb5261caab05c31b8b7dee9750f9161f6ce041482ccbd88c6ea`。读取 `/tmp/chat-code-css-layer-green.log` 确认8/8通过，涵盖 source 精确保留、public/dist 对齐、资源闭合、外网 CSS 拒绝、社区摘要不变及 layered/legacy 记录跨重启原样读取；对应 lint 两文件零警告/错误。该增量新提交由发布者冻结后绑定；已有真实代码在新 host 的无模型重放和最终画面验收另行记录。

## 同次生产模型配置应用/回滚工具补审

只读复核服务器 tooling 的 `model-wire-patch.mjs`、`model-wire-config.sh`、`deploy-chat-code.sh` 和 `rollback-image.sh`，无新阻塞项。部署停 app 前核对完整旧配置 SHA；停 app 并完成数据库/文件恢复点后，精确应用两模型字段，拒绝任何其他解析配置变化，使用 wx 私有备份及 atomic 999:999/0600 替换。prepared/applied 证据支持失败时恢复；外部变更会被拒绝，恢复原配置后才启用旧镜像，手动回滚同样执行该顺序。

独立读取 `model-wire-helper-verification.safe.json`：隔离 fixture 的 apply、原字节 SHA restore、owner/mode、外部编辑拒绝且不改写及三脚本 shell syntax 均 PASS，`productionExecuted:false`。本项仅核对已准备工具，没有执行正式配置应用、切换或写入 accepted-image gate。

## 独立题目画面补审：`ff00264` 后工作增量

本次不重审祖先。新 context 移除旧 renderer/CSS 正文，改为完整原题、已验证答案和数据契约；prompt 明确零 imports、独立 native Canvas/SVG、禁止旧绘图函数及二次求解，并解释预缩放向量端点不能换算成物理量。99个具体共享 interface 形状与现有 client 类型核对一致；UniversalSnapshot 将原 object/unknown 字段细化到这些已有类型。输出8192并尊重较低父预算，共享期限300秒，同轮单任务和一次校验修复边界保持。

新增可选 rendererKind 只在新 create 校验后进入 immutable row/hash，旧记录不补写。新全屏通用壳加载作者 renderer；保留隐藏的 SDK 元素，作者 CustomEvent 经原 connection.send 严格 V3 单端口处理。raw title/summary/JS/CSS 四字符串精确保留，original scene/hash、owner、签名与社区 active 指针未变。UI marker 缺失时不 fetch/iframe、不自动产生模型调用；显式升级进入新轮次。私有 Lab 在独立台分支返回，旧 Canvas 和侧栏不会挂载；参数、播放、seek、restore 和帧通道继续复用原题 runtime，本地探索不会改写原题。source ref 比较包含 rendererKind，重试/到期刷新和 owner 切换仍有既有边界。

Important/P2：`question-code-service.ts:112` 到 `:133` 的独立绘制校验只在整个模块搜索 native API 和 view 字面证据，空入口只检查字面空大括号，未确认绘制能从导出的 renderFrame 到达。独立读取服务器当前函数并运行其精确校验（没有执行任何作者代码）：将已有 ownCanvas fixture 改名为未调用的 unusedDraw，再追加 `export const renderFrame = snapshot => snapshot.view;` 或 `export function renderFrame(snapshot) { return; }`，两者均 ACCEPTED。SDK 实际只调用空入口，画面为空却能确认 ready、得到 independent 元数据。

同一 P2 的背景分支也已精确复现：renderFrame 只声明 view，执行两次相同常量 `fillRect(0,0,10,10)` 并 append，没有读取任何题目几何，同样 ACCEPTED；`:123` 的矩形计数>=2即可绕过“背景 alone invalid”要求。现有测试仅覆盖字面空入口、一个背景矩形和空大括号 alias。建议将 native 绘制及 view 几何证据限定到 export 入口或其可达本地 helpers，加入这三个负回归，同时保留正常 helper/alias、Canvas/SVG 正回归。

独立读取服务器 `/tmp/independent-code-lab-green.log` 确认 UI56项通过，`/tmp/physicsos-independent-tool-green-final.log` 确认 tool33项通过。执行者报告 backend focused22及完整179项、类型/构建通过；这些现有回归不覆盖上述精确复现。统一 UI 构建、修复后的 guard 回归、真实独立画面及新镜像验收由对应执行者完成；本审查未运行付费模型、push 或部署，仅更新本记录。

## 2026-11-04 独立视觉最终增量

本轮只读 reviewer 检查272835a上的视觉brief、提示词优先级、原题/预算边界和验收改动，无Critical/Important。一个Minor是iframe navigation abort豁免使用累积成功响应集合，不能严格证明成功响应发生在中止之后；后续实际绘制门禁仍有保护。实际模型画面由发布者继续验收。

随后实际截图发现暂停后尺寸变化不重绘；6dd1654在现有宿主发布函数上注册ResizeObserver并在unmount断开，沿用connected/disposed保护，不修改物理状态、不引入作者代码执行能力。回归先RED（只有1帧而预期2帧），再GREEN，相关UI46/46。补充提示词要求同点标签聚类、固定投影和真实题名；工具70/70，类型/构建/规范检查通过。

## 运行时生图审查

image_release_review只读检查6dd1654..7c21c64，服务器纯mock确认两个Important：注释路径可被当成素材使用；非法PNG过滤类型可被接收。058e528修复两项并增加负回归；顺带修复超大响应未取消body的Minor。测试RED3fail/6pass→17专项通过，完整宿主231/231。

已有图片后空output的上游最终error保留明确失败，不无限重试；text-only的正常完成缺失structured使用唯一repair，属于已记录恢复策略。实际视觉、服务器发布由根代理验收。随后新增专用schema工具交付约束，经真实HTTP负/正回归，pool89/89、类型/lint通过；不影响其他工具schema或显式tool_choice。
