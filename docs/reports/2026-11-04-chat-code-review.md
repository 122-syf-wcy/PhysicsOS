# 对话题目代码实验独立审查

审查基线：`68bd8d0551d8d69867dde7d153a38b766a7b39a8`。审查对象为 `codex/experiment-contribution` 完整实现及新增文件；不纳入 vendor 脏指针或既有生成资源的无关审计。审查者只读取产品代码和服务器发布工具，唯一写入为本记录。

## 结论

初次审查发现的 Important/P2“持久化 generating 状态没有中断恢复入口”已在同一次审查中修复并核对。当前没有未解决的 Critical/Important 项；一项风格版本记录时点的 Minor/P3 不阻塞发布。最终被审查 commit SHA 在完整构建和浏览器验收后由发布者补充。

## 已修复的 Important/P2：恢复历史生成任务

最初 `code-generation.ts` 发布的 `generating` 仅包含任务和场景身份，没有启动时间、截止时间或活动任务探测；`QuestionCodeCanvas.tsx` 则在 `status === 'generating'` 时隐藏唯一重新生成按钮。服务器在该状态写入后重启，持久日志会继续展示“正在生成本题实验”，但已没有进程负责完成它。后续 turn/latest 变化还会让生成器的 stale catch 跳过终态，因此同类历史卡片也可能保留这一状态。

修复核对：共享状态类型、projection schema 和 invariant 兼容可选 `deadlineAt`；新任务在 `code-generation.ts:75` 使用同一超时值设置截止时间并持久化。`QuestionCodeCanvas.tsx:27` 安排截止时间刷新，`:65` 将旧无期限记录和超期记录呈现为 `interrupted`，`:89` 保留显式重试。未过期任务继续等待。没有读取历史自动调用模型，也没有通过补写过时 scene 改动 latest 或覆盖后来题目。

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
